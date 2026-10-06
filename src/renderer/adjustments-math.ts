import {
  LOG_INPUT_FLOOR,
  applyGamutAt,
  applyInverseGamutAt,
  decodeLogAt,
  encodeLogAt,
} from '../color/log-index';
import { PROPHOTO_TO_SRGB, applyMatrix3 } from '../color/matrices';
import type { ImageAdjustments } from '../types/adjustments';
import { clamp01, smoothstep } from '../utils/math';

/**
 * 调整运算的 CPU 实现，与 renderer/shaders.ts 里的 GLSL 逐行对应。
 *
 * 存在的意义有两个：
 * 1. 把像素运算从 WebGL 里拆出来，可以用单元测试盯住数学是否正确；
 * 2. 导出（票 10）在没有 GPU 的路径上复用同一套运算。
 *
 * 改这里的任何一个步骤，都要同步改 GLSL，反之亦然；
 * shaders.test.ts 会检查两者的参数名与步骤顺序是否还对得上。
 */

export type Rgb = readonly [number, number, number];

/** 线性空间的中灰，对比度的支点 */
export const MID_GRAY = 0.18;

/** Rec.709 亮度权重 */
export const LUMA_WEIGHTS: Rgb = [0.2126, 0.7152, 0.0722];

/** 白平衡的强度系数，与 GLSL 保持一致 */
export const WARMTH_STRENGTH = 0.1;
export const TINT_STRENGTH = 0.05;
export const TINT_GREEN_STRENGTH = 0.1;
/** 高光/阴影的强度系数 */
export const TONE_STRENGTH = 0.5;

/** sRGB 传递函数 → 线性空间（分支条件与 GLSL 的 step 对齐） */
export function srgbToLinear(channel: number): number {
  return channel < 0.04045 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
}

/** 线性空间 → sRGB 传递函数（分支条件与 GLSL 的 step 对齐） */
export function linearToSrgb(channel: number): number {
  return channel < 0.0031308 ? channel * 12.92 : 1.055 * Math.pow(channel, 1 / 2.4) - 0.055;
}

export function srgbToLinearRgb(rgb: Rgb): Rgb {
  return [srgbToLinear(rgb[0]), srgbToLinear(rgb[1]), srgbToLinear(rgb[2])];
}

export function linearToSrgbRgb(rgb: Rgb): Rgb {
  return [linearToSrgb(rgb[0]), linearToSrgb(rgb[1]), linearToSrgb(rgb[2])];
}

/** 亮度（Rec.709） */
export function luminance(rgb: Rgb): number {
  return rgb[0] * LUMA_WEIGHTS[0] + rgb[1] * LUMA_WEIGHTS[1] + rgb[2] * LUMA_WEIGHTS[2];
}

/** 白平衡：色温沿蓝-橙轴，色调沿绿-品红轴 */
export function applyWhiteBalance(rgb: Rgb, temperature: number, tint: number): Rgb {
  const warm: Rgb = [1 + WARMTH_STRENGTH * temperature, 1, 1 - WARMTH_STRENGTH * temperature];
  const tinted: Rgb = [
    1 + TINT_STRENGTH * tint,
    1 - TINT_GREEN_STRENGTH * tint,
    1 + TINT_STRENGTH * tint,
  ];
  return [rgb[0] * warm[0] * tinted[0], rgb[1] * warm[1] * tinted[1], rgb[2] * warm[2] * tinted[2]];
}

/** 曝光：每 +1 EV 线性亮度翻倍 */
export function applyExposure(rgb: Rgb, exposure: number): Rgb {
  const factor = Math.pow(2, exposure);
  return [rgb[0] * factor, rgb[1] * factor, rgb[2] * factor];
}

/** 对比度：以中灰为支点拉伸/压缩 */
export function applyContrast(rgb: Rgb, contrast: number): Rgb {
  const factor = 1 + contrast;
  return [
    (rgb[0] - MID_GRAY) * factor + MID_GRAY,
    (rgb[1] - MID_GRAY) * factor + MID_GRAY,
    (rgb[2] - MID_GRAY) * factor + MID_GRAY,
  ];
}

/** 高光与阴影：按亮度加权，分别作用在亮部与暗部 */
export function applyHighlightsShadows(rgb: Rgb, highlights: number, shadows: number): Rgb {
  const luma = luminance(rgb);

  const highlightWeight = smoothstep(0.5, 1, luma);
  const highlightFactor = 1 + highlights * TONE_STRENGTH;
  const afterHighlights: Rgb = [
    rgb[0] + (rgb[0] * highlightFactor - rgb[0]) * highlightWeight,
    rgb[1] + (rgb[1] * highlightFactor - rgb[1]) * highlightWeight,
    rgb[2] + (rgb[2] * highlightFactor - rgb[2]) * highlightWeight,
  ];

  const shadowWeight = 1 - smoothstep(0, 0.5, luma);
  const shadowFactor = 1 + shadows * TONE_STRENGTH;
  return [
    afterHighlights[0] + (afterHighlights[0] * shadowFactor - afterHighlights[0]) * shadowWeight,
    afterHighlights[1] + (afterHighlights[1] * shadowFactor - afterHighlights[1]) * shadowWeight,
    afterHighlights[2] + (afterHighlights[2] * shadowFactor - afterHighlights[2]) * shadowWeight,
  ];
}

/** 饱和度：朝灰度插值，-1 完全去色 */
export function applySaturation(rgb: Rgb, saturation: number): Rgb {
  const luma = luminance(rgb);
  const factor = 1 + saturation;
  return [
    luma + (rgb[0] - luma) * factor,
    luma + (rgb[1] - luma) * factor,
    luma + (rgb[2] - luma) * factor,
  ];
}

function clampRgb(rgb: Rgb): Rgb {
  return [clamp01(rgb[0]), clamp01(rgb[1]), clamp01(rgb[2])];
}

/** 逐通道取 max，对应 GLSL 的 `max(texel, 0.0)` */
function floorRgb(rgb: Rgb, floor: number): Rgb {
  return [Math.max(rgb[0], floor), Math.max(rgb[1], floor), Math.max(rgb[2], floor)];
}

/**
 * Log 模式的开关与选择项。
 *
 * 全默认（不传）时 applyAdjustments 的行为与加 Log 支持之前逐位一致：
 * 输入按 sRGB 解释，输出也按 sRGB 解释。
 */
export interface LogPipelineOptions {
  /**
   * 输入已经是 ProPhoto linear。
   * Log 模式的 RAW 走 16 位 ProPhoto linear 解码，像素本身就是线性的，
   * 再套一次 sRGB 传递函数会把画面压暗一大截。
   */
  inputLinear?: boolean;
  /** 是否启用 Log 色彩空间转换 */
  logMode?: boolean;
  /** Log 曲线下标（`LOG_SPACES` 的位置）；越界表示不做编码 */
  logCurveId?: number;
  /** Log 色域矩阵下标；越界表示不做色域转换 */
  logMatrixId?: number;
}

/** 3D LUT 的最小形状；lut/types.ts 的 Lut3D 兼容 */
export interface LutSamplerSource {
  size: number;
  data: Float32Array;
}

/**
 * 从 3D LUT 采样，三线性插值。
 *
 * 与 GPU 上 `TEXTURE_MIN_FILTER = LINEAR` 对一个 3D 纹理取样的行为一致：
 * 输入 c 对应格点位置 c * (size - 1)，取相邻 8 个格点按小数部分插值。
 */
export function sampleLut3D(lut: LutSamplerSource, rgb: Rgb): Rgb {
  const n = lut.size;

  const x = clamp01(rgb[0]) * (n - 1);
  const y = clamp01(rgb[1]) * (n - 1);
  const z = clamp01(rgb[2]) * (n - 1);

  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const z0 = Math.floor(z);
  const x1 = Math.min(x0 + 1, n - 1);
  const y1 = Math.min(y0 + 1, n - 1);
  const z1 = Math.min(z0 + 1, n - 1);

  const tx = x - x0;
  const ty = y - y0;
  const tz = z - z0;

  const at = (r: number, g: number, b: number, channel: number): number =>
    lut.data[((b * n + g) * n + r) * 3 + channel];

  const result: number[] = [0, 0, 0];
  for (let channel = 0; channel < 3; channel++) {
    const c000 = at(x0, y0, z0, channel);
    const c100 = at(x1, y0, z0, channel);
    const c010 = at(x0, y1, z0, channel);
    const c110 = at(x1, y1, z0, channel);
    const c001 = at(x0, y0, z1, channel);
    const c101 = at(x1, y0, z1, channel);
    const c011 = at(x0, y1, z1, channel);
    const c111 = at(x1, y1, z1, channel);

    const c00 = c000 + (c100 - c000) * tx;
    const c10 = c010 + (c110 - c010) * tx;
    const c01 = c001 + (c101 - c001) * tx;
    const c11 = c011 + (c111 - c011) * tx;

    const c0 = c00 + (c10 - c00) * ty;
    const c1 = c01 + (c11 - c01) * ty;

    result[channel] = c0 + (c1 - c0) * tz;
  }

  return [result[0], result[1], result[2]];
}

/** 套用 LUT，并按 strength 与原色混合；没有 LUT 或强度为 0 时原样返回 */
export function applyLut(rgb: Rgb, lut: LutSamplerSource | null, strength: number): Rgb {
  if (!lut || strength <= 0) return rgb;

  const graded = sampleLut3D(lut, rgb);
  const amount = clamp01(strength);
  return [
    rgb[0] + (graded[0] - rgb[0]) * amount,
    rgb[1] + (graded[1] - rgb[1]) * amount,
    rgb[2] + (graded[2] - rgb[2]) * amount,
  ];
}

/**
 * 完整调整管线，输入输出都是 sRGB。
 *
 * 顺序与 GLSL 一致：
 *   夹紧 → 转线性 → 白平衡 → 曝光 → 对比度 → 高光/阴影 → 饱和度
 *   → 转回 sRGB → 套 LUT
 *
 * LUT 放在线性运算之后：.cube 这类 LUT 是按 gamma 编码后的显示值定义的，
 * 喂线性值会得到明显偏暗的结果。
 *
 * 传了 options.logMode 时改走 Log 分支（见 applyLogPipeline），
 * 基础调整那几步仍然在同一位置、同一顺序执行。
 */
export function applyAdjustments(
  srgb: Rgb,
  adjustments: ImageAdjustments,
  lut: LutSamplerSource | null = null,
  options: LogPipelineOptions = {},
): Rgb {
  const { inputLinear = false, logMode = false, logCurveId = -1, logMatrixId = -1 } = options;

  // 与 GLSL 一致：sRGB 输入先夹到 [0,1] 再转线性，ProPhoto linear 只夹负值
  let color: Rgb = inputLinear ? floorRgb(srgb, 0) : srgbToLinearRgb(clampRgb(srgb));

  color = applyWhiteBalance(color, adjustments.temperature, adjustments.tint);
  color = applyExposure(color, adjustments.exposure);
  color = applyContrast(color, adjustments.contrast);
  color = applyHighlightsShadows(color, adjustments.highlights, adjustments.shadows);
  color = applySaturation(color, adjustments.saturation);

  if (logMode) {
    return applyLogPipeline(color, adjustments, lut, logCurveId, logMatrixId);
  }

  const display = linearToSrgbRgb(clampRgb(color));
  return clampRgb(applyLut(display, lut, adjustments.lutStrength));
}

/**
 * Log 模式的后半段，与 GLSL 里 `u_logMode > 0.5` 那一段逐行对应：
 *
 *   线性工作空间 → Log 色域 → Log 编码 → 套 LUT（在 Log 空间）→ Log 解码
 *   → 回线性工作空间 → ProPhoto → sRGB 原色 → 显示
 *
 * LUT 夹在编解码之间是关键：视频 LUT 的定义域就是 Log 编码值。
 * 解码后必须换回 sRGB 原色再套 gamma，只做 gamma 的话颜色会明显发灰。
 */
function applyLogPipeline(
  color: Rgb,
  adjustments: ImageAdjustments,
  lut: LutSamplerSource | null,
  logCurveId: number,
  logMatrixId: number,
): Rgb {
  const gamut = applyGamutAt(color, logMatrixId);
  // Log 曲线没有负半轴；抬到 LOG_INPUT_FLOOR 与 Raw-Alchemy 的 np.maximum(img, 1e-6) 一致
  const encoded = floorRgb(gamut, LOG_INPUT_FLOOR);
  const logColor: Rgb = [
    encodeLogAt(encoded[0], logCurveId),
    encodeLogAt(encoded[1], logCurveId),
    encodeLogAt(encoded[2], logCurveId),
  ];

  const graded = applyLut(logColor, lut, adjustments.lutStrength);
  const decoded: Rgb = [
    decodeLogAt(graded[0], logCurveId),
    decodeLogAt(graded[1], logCurveId),
    decodeLogAt(graded[2], logCurveId),
  ];

  const prophoto = applyInverseGamutAt(decoded, logMatrixId);
  const display = linearToSrgbRgb(clampRgb(applyMatrix3(PROPHOTO_TO_SRGB, prophoto)));
  return clampRgb(display);
}
