import { LOG_CURVES } from './log-curves';
import { LOG_GAMUT_MATRICES } from './log-spaces';
import { applyMatrix3, invertMatrix3, type Mat3 } from './matrices';
import type { Rgb } from '../utils/math';

/**
 * Log 空间的「下标视角」：GLSL 那边拿到的是 int 下标（uniform 不能传字符串），
 * WebGL 的矩阵 uniform 数组也按下标摆放，所以渲染器与 CPU 镜像都从这一层取数据，
 * 保证两边用的是同一份表格、同一套越界兜底。
 *
 * 下标就是 LOG_SPACES 里的位置；-1 或其他越界值一律表示「不做转换」，
 * 与 GLSL 里 `if (curveId == ...)` 全落空后原样返回的行为一致。
 */

/** Log 曲线在编码前要抬到的最小值：与 Raw-Alchemy 的 `np.maximum(img, 1e-6)` 对齐 */
export const LOG_INPUT_FLOOR = 1e-6;

/** 把长度 9 的行主序数组收成 Mat3；长度不对直接抛，静默截断会让颜色悄悄错掉 */
function asMat3(values: readonly number[], index: number): Mat3 {
  if (values.length !== 9) {
    throw new Error(`LOG_GAMUT_MATRICES[${index}] 长度应为 9，实际 ${values.length}`);
  }
  return values as unknown as Mat3;
}

/** ProPhoto linear → 各 Log 色域，下标即 LOG_SPACES 的位置 */
export const LOG_GAMUT_FORWARD: readonly Mat3[] = LOG_GAMUT_MATRICES.map(asMat3);

/**
 * 各 Log 色域 → ProPhoto linear。
 *
 * 显示路径需要它：Log 解码后回到的是目标色域，得先换回工作空间再做 sRGB 显示转换。
 * 用求逆而不是再硬编码 14 组数字：正反两个方向因此永远互为逆运算，
 * round-trip 测试（LUT 关掉时输出应与输入一致）才有意义。
 */
export const LOG_GAMUT_INVERSE: readonly Mat3[] = LOG_GAMUT_FORWARD.map((matrix) =>
  invertMatrix3(matrix),
);

/** 下标形式的 Log 编码；越界原样返回，与 GLSL 的 encodeLogCurve 兜底一致 */
export function encodeLogAt(linear: number, index: number): number {
  return LOG_CURVES[index]?.encode(linear) ?? linear;
}

/** 下标形式的 Log 解码；越界原样返回 */
export function decodeLogAt(encoded: number, index: number): number {
  return LOG_CURVES[index]?.decode(encoded) ?? encoded;
}

/** 下标形式的 ProPhoto → Log 色域；越界当单位矩阵 */
export function applyGamutAt(rgb: Rgb, index: number): Rgb {
  const matrix = LOG_GAMUT_FORWARD[index];
  return matrix ? applyMatrix3(matrix, rgb) : rgb;
}

/** 下标形式的 Log 色域 → ProPhoto；越界当单位矩阵 */
export function applyInverseGamutAt(rgb: Rgb, index: number): Rgb {
  const matrix = LOG_GAMUT_INVERSE[index];
  return matrix ? applyMatrix3(matrix, rgb) : rgb;
}
