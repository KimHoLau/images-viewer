import type { ImageAdjustments } from '../types/adjustments';
import { LOG_SHADER_SOURCE } from './log-shader';

/**
 * 顶点着色器：四边形直接用裁剪空间坐标，纹理坐标透传。
 * 图片的位置与缩放由 CPU 侧算好写进顶点缓冲，着色器只管颜色。
 */
export const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 a_position;
in vec2 a_texCoord;

out vec2 v_texCoord;

void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
  v_texCoord = a_texCoord;
}`;

/**
 * 片元着色器：单 pass 完成全部基础调整与 3D LUT。
 *
 * 运算顺序必须和 renderer/adjustments-math.ts 中的 applyAdjustments 完全一致：
 *   夹紧 → 转线性 → 白平衡 → 曝光 → 对比度 → 高光/阴影 → 饱和度 → 回 sRGB → 套 LUT
 * 常量（MID_GRAY / LUMA_WEIGHTS / 各强度系数）也两处共用同一组数值。
 * shaders.test.ts 会盯住这两点。
 *
 * LUT 放在线性运算之后：.cube 这类 LUT 是按 gamma 编码后的显示值定义的，
 * 喂线性值会明显偏暗。
 *
 * 两种输入空间：
 *   - u_inputLinear = 0：8 位 sRGB 位图，先套 sRGB 传递函数转线性；
 *   - u_inputLinear = 1：RAW 的 16 位 ProPhoto linear 浮点texel，本来就是线性的，
 *     只夹掉负值（Log 编码没有负半轴），不做上夹，好让高光余量进得了 Log。
 *
 * Log 模式（u_logMode = 1）在饱和度之后、LUT 之前插入色彩空间转换：
 *   ProPhoto linear → 目标 Log 色域 → Log 编码 → LUT → 显示
 * 视频 LUT 是按 Log 编码值定义的，只有把像素送进 Log 空间，LUT 才是它被设计成的那副样子。
 *
 * LUT 采样之后那一步取决于 `u_lutOutputEncoded`：
 *   - 0（默认）：LUT 输出已经是显示空间（ARRI 的 LogC4 → Rec.709 就是），
 *     只做 Rec.709 γ2.4 → sRGB；再当 Log 解码一次会把蓝通道放大到 2 以上、夹成纯青；
 *   - 1：LUT 输出仍在 Log 空间，解码 → 回 ProPhoto → sRGB（串联 Log LUT 的用法）。
 * 曲线的 GLSL 在 renderer/log-shader.ts，数值直接从 color/log-curves.ts 插值过来。
 */
export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler3D;

uniform sampler2D u_image;
uniform float u_inputLinear;

uniform float u_temperature;
uniform float u_tint;
uniform float u_exposure;
uniform float u_contrast;
uniform float u_highlights;
uniform float u_shadows;
uniform float u_saturation;

uniform sampler3D u_lut;
uniform float u_lutSize;
uniform float u_lutStrength;
uniform float u_lutEnabled;
// LUT 的输出是否仍在 Log 空间；0 = 已是显示空间（默认），1 = 仍编码
uniform float u_lutOutputEncoded;

in vec2 v_texCoord;
out vec4 outColor;

const float MID_GRAY = 0.18;
const vec3 LUMA_WEIGHTS = vec3(0.2126, 0.7152, 0.0722);
const float WARMTH_STRENGTH = 0.1;
const float TINT_STRENGTH = 0.05;
const float TINT_GREEN_STRENGTH = 0.1;
const float TONE_STRENGTH = 0.5;

float luminance(vec3 color) {
  return dot(color, LUMA_WEIGHTS);
}

vec3 srgbToLinear(vec3 srgb) {
  vec3 low = srgb / 12.92;
  vec3 high = pow((srgb + 0.055) / 1.055, vec3(2.4));
  return mix(low, high, step(vec3(0.04045), srgb));
}

vec3 linearToSrgb(vec3 linear) {
  vec3 low = linear * 12.92;
  vec3 high = 1.055 * pow(linear, vec3(1.0 / 2.4)) - 0.055;
  return mix(low, high, step(vec3(0.0031308), linear));
}

// Rec.709 的显示传递函数（γ2.4 那一段）→ 线性。ARRI 的 LogC4 → Rec.709 LUT 输出的是
// Rec.709 γ2.4 编码的显示值，而本工程的显示空间是 sRGB，这里做那一步转换。
// 与 adjustments-math.ts 的 rec709ToLinear 逐行对应。
vec3 rec709ToLinear(vec3 encoded) {
  vec3 low = encoded / 4.5;
  vec3 high = pow((encoded + vec3(0.099)) / 1.099, vec3(1.0 / 0.45));
  return mix(low, high, step(vec3(0.081), encoded));
}

// 格点 i 的纹素中心在 (i + 0.5) / size，而输入 c 对应格点位置 c * (size - 1)。
// 插值必须手写：硬件的 LINEAR 过滤是三线性，会把 3D LUT 离轴格点的色度方向在
// 中性输入上加权出来（实测官方 ARRI LogC4 LUT 能偏出 4.6/255，再被 LogC4 解码
// 放大成 10–22/255）。用 NEAREST 取整格点后自己按四面体插值，与
// adjustments-math.ts 的 sampleLut3D 逐行对应。
vec3 lutTexel(vec3 coord) {
  return texture(u_lut, (floor(coord) + 0.5) / u_lutSize).rgb;
}

// 四面体插值：按小数部分的大小关系把立方体切成 6 个四面体，只用其中 4 个角。
// 结构与 adjustments-math.ts 的 sampleLut3D 一致，六条分支逐条对应。
//
// 两处上界处理是 GPU 专有的坑，单元测试看不见：
//   - near 必须夹到 size - 2（与 TS 的 Math.min(Math.floor(x), n - 2) 一致），
//     否则格点位置贴到上界时 floor 已经在下标 size - 1，加一就出界；
//   - pos 的上界要留 1e-4 个格点的余量：clamp 到 1.0 再乘 (size - 1) 会被 float32
//     舍成比 size - 1 略大，floor 得到 size，四个角塌成同一个——纯白会被插成黑。
vec3 sampleLutTetrahedral(vec3 rgb) {
  float size = u_lutSize;
  float hiIndex = size - 1.0;
  vec3 pos = clamp(rgb, 0.0, 1.0) * (hiIndex - 1e-4);
  vec3 frac = pos - floor(pos);

  float fr = frac.r;
  float fg = frac.g;
  float fb = frac.b;

  // 立方体的两个下标，与 adjustments-math.ts 的写法等价：
  //   near = min(floor(pos), size - 2)
  //   far  = min(near + 1, size - 1)
  vec3 near = min(floor(pos), vec3(max(hiIndex - 1.0, 0.0)));
  vec3 far = min(near + vec3(1.0), vec3(hiIndex));

  // 八个角里只有两个下标：每轴取近端或远端。轴角 = 一个远端两个近端，
  // mid 角 = 两个远端一个近端。
  //   axisR = (far.r, near.g, far.b)   axisG = (near.r, far.g, far.b)   axisB = (far.r, far.g, near.b)
  //   midR  = (far.r, near.g, near.b)  midG  = (near.r, far.g, near.b)  midB  = (near.r, near.g, far.b)
  vec3 axisR = vec3(far.r, near.g, far.b);
  vec3 axisG = vec3(near.r, far.g, far.b);
  vec3 axisB = vec3(far.r, far.g, near.b);
  vec3 midR = vec3(far.r, near.g, near.b);
  vec3 midG = vec3(near.r, far.g, near.b);
  vec3 midB = vec3(near.r, near.g, far.b);
  vec3 diag = far;

  // 六条分支与 adjustments-math.ts 的 if/else 链逐条对应
  if (fr >= fg && fg >= fb) {
    return (1.0 - fr) * lutTexel(near)
      + (fr - fg) * lutTexel(midR)
      + (fg - fb) * lutTexel(axisB)
      + fb * lutTexel(diag);
  }
  if (fr >= fb && fb >= fg) {
    return (1.0 - fr) * lutTexel(near)
      + (fr - fb) * lutTexel(midR)
      + (fb - fg) * lutTexel(axisR)
      + fg * lutTexel(diag);
  }
  if (fb >= fr && fr >= fg) {
    return (1.0 - fb) * lutTexel(near)
      + (fb - fr) * lutTexel(midB)
      + (fr - fg) * lutTexel(axisR)
      + fg * lutTexel(diag);
  }
  if (fg >= fr && fr >= fb) {
    return (1.0 - fg) * lutTexel(near)
      + (fg - fr) * lutTexel(midG)
      + (fr - fb) * lutTexel(axisB)
      + fb * lutTexel(diag);
  }
  if (fg >= fb && fb >= fr) {
    return (1.0 - fg) * lutTexel(near)
      + (fg - fb) * lutTexel(midG)
      + (fb - fr) * lutTexel(axisG)
      + fr * lutTexel(diag);
  }
  return (1.0 - fb) * lutTexel(near)
    + (fb - fg) * lutTexel(midB)
    + (fg - fr) * lutTexel(axisG)
    + fr * lutTexel(diag);
}

vec3 applyLut(vec3 display) {
  if (u_lutEnabled < 0.5) return display;

  vec3 graded = sampleLutTetrahedral(display);
  return mix(display, graded, u_lutStrength);
}
${LOG_SHADER_SOURCE}
void main() {
  vec3 texel = texture(u_image, v_texCoord).rgb;
  // sRGB 路径保持原来的两步（先夹紧再转线性）；ProPhoto linear 只夹负值
  vec3 color = u_inputLinear > 0.5 ? max(texel, 0.0) : srgbToLinear(clamp(texel, 0.0, 1.0));

  // 1. 白平衡：色温沿蓝-橙轴，色调沿绿-品红轴
  vec3 warmFilter = vec3(
    1.0 + WARMTH_STRENGTH * u_temperature,
    1.0,
    1.0 - WARMTH_STRENGTH * u_temperature
  );
  vec3 tintFilter = vec3(
    1.0 + TINT_STRENGTH * u_tint,
    1.0 - TINT_GREEN_STRENGTH * u_tint,
    1.0 + TINT_STRENGTH * u_tint
  );
  color *= warmFilter * tintFilter;

  // 2. 曝光
  color *= exp2(u_exposure);

  // 3. 对比度
  color = (color - MID_GRAY) * (1.0 + u_contrast) + MID_GRAY;

  // 4. 高光 / 阴影
  float luma = luminance(color);
  float highlightWeight = smoothstep(0.5, 1.0, luma);
  color = mix(color, color * (1.0 + u_highlights * TONE_STRENGTH), highlightWeight);
  float shadowWeight = 1.0 - smoothstep(0.0, 0.5, luma);
  color = mix(color, color * (1.0 + u_shadows * TONE_STRENGTH), shadowWeight);

  // 5. 饱和度
  luma = luminance(color);
  color = mix(vec3(luma), color, 1.0 + u_saturation);

  vec3 display;
  if (u_logMode == 1) {
    // 6. Log 模式：线性光送进目标 Log 色域并按曲线编码，LUT 在 Log 空间作用
    vec3 gamut = applyGamutMatrix(color, u_logMatrixId);
    vec3 logColor = encodeLogRgb(gamut, u_logCurveId);
    vec3 graded = applyLut(logColor);
    // 没挂 LUT（或强度 0）时「LUT 输出在哪个空间」无从谈起，按「输出仍是 Log」走，
    // 结果与没有这个开关时逐位一致
    bool hasLut = u_lutEnabled > 0.5 && u_lutStrength > 0.0;
    if (u_lutOutputEncoded > 0.5 || !hasLut) {
      // LUT 输出仍在 Log 空间（串联多个 Log LUT 的用法）：解回线性、换回 sRGB 原色
      vec3 decoded = decodeLogRgb(graded, u_logCurveId);
      vec3 prophoto = applyInverseGamutMatrix(decoded, u_logMatrixId);
      // 解回 ProPhoto linear 之后还得换到 sRGB 原色，只套 gamma 的话饱和度会明显偏低
      display = linearToSrgb(clamp(PROPHOTO_TO_SRGB * prophoto, 0.0, 1.0));
    } else {
      // LUT 输出已经是显示空间（ARRI 的 LogC4 → Rec.709 就是）：它按 Rec.709 γ2.4
      // 编码，转成 sRGB 直接显示。**不能再做一次 Log 解码**——那会把蓝通道放大到 2 以上，
      // 夹紧之后得到纯青的天空。
      display = linearToSrgb(rec709ToLinear(clamp(graded, 0.0, 1.0)));
    }
  } else {
    // 6. 回到显示空间后套 LUT
    display = linearToSrgb(clamp(color, 0.0, 1.0));
    display = applyLut(display);
  }

  outColor = vec4(clamp(display, 0.0, 1.0), 1.0);
}`;

/** 参数键与 uniform 名的对应关系，两处保持同一条规则 */
export function uniformNameFor(key: keyof ImageAdjustments): string {
  return `u_${key}`;
}

/** 由基础调整驱动的 uniform */
export const BASE_ADJUSTMENT_UNIFORMS = [
  'u_temperature',
  'u_tint',
  'u_exposure',
  'u_contrast',
  'u_highlights',
  'u_shadows',
  'u_saturation',
] as const;

/** 由 LUT 驱动的 uniform */
export const LUT_UNIFORMS = [
  'u_lut',
  'u_lutSize',
  'u_lutStrength',
  'u_lutEnabled',
  'u_lutOutputEncoded',
] as const;

/** 由输入像素空间驱动的 uniform */
export const INPUT_UNIFORMS = ['u_inputLinear'] as const;

/** 由 Log 模式驱动的 uniform 名，定义在 renderer/log-shader.ts */
export { LOG_UNIFORMS } from './log-shader';
