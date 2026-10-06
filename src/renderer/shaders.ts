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
 *   ProPhoto linear → 目标 Log 色域 → Log 编码 → LUT → Log 解码 → 回 ProPhoto → sRGB 显示
 * 视频 LUT 是按 Log 编码值定义的，只有把像素送进 Log 空间，LUT 才是它被设计成的那副样子。
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

// 格点 i 的纹素中心在 (i + 0.5) / size，而输入 c 对应格点位置 c * (size - 1)
vec3 applyLut(vec3 display) {
  if (u_lutEnabled < 0.5) return display;

  vec3 coord = (clamp(display, 0.0, 1.0) * (u_lutSize - 1.0) + 0.5) / u_lutSize;
  vec3 graded = texture(u_lut, coord).rgb;
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
  if (u_logMode > 0.5) {
    // 6. Log 模式：线性光送进目标 Log 色域并按曲线编码，LUT 在 Log 空间作用，再解回线性
    vec3 gamut = applyGamutMatrix(color, u_logMatrixId);
    vec3 logColor = encodeLogRgb(gamut, u_logCurveId);
    vec3 graded = applyLut(logColor);
    vec3 decoded = decodeLogRgb(graded, u_logCurveId);
    vec3 prophoto = applyInverseGamutMatrix(decoded, u_logMatrixId);
    // 解回 ProPhoto linear 之后还得换到 sRGB 原色，只套 gamma 的话饱和度会明显偏低
    display = linearToSrgb(clamp(PROPHOTO_TO_SRGB * prophoto, 0.0, 1.0));
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
export const LUT_UNIFORMS = ['u_lut', 'u_lutSize', 'u_lutStrength', 'u_lutEnabled'] as const;

/** 由输入像素空间驱动的 uniform */
export const INPUT_UNIFORMS = ['u_inputLinear'] as const;

/** 由 Log 模式驱动的 uniform 名，定义在 renderer/log-shader.ts */
export { LOG_UNIFORMS } from './log-shader';
