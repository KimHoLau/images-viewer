/**
 * 色域矩阵的「按 id」入口：ProPhoto RGB (linear, D50) → 某个 Log 空间的目标色域 (linear)。
 *
 * 矩阵数据与下标视图在 log-spaces.ts / log-index.ts：渲染器那边拿到的是 int 下标
 * （uniform 只认下标），UI 与测试这边用的是可读的 id，这一层就是两者的接缝。
 */

import { LOG_GAMUT_FORWARD } from './log-index';
import { logSpaceIndex, type LogSpaceId } from './log-spaces';
import { applyMatrix3, type Mat3 } from './matrices';
import type { Rgb } from '../utils/math';

/**
 * 取某个 Log 空间的 3×3 矩阵（行主序，长度 9）。
 *
 * 返回的是表里的同一个只读对象，调用方不要就地改写。
 * 上传给 GLSL 必须先转成列主序（`matrices.ts` 的 `toColumnMajorArray`）：
 * `gl.uniformMatrix3fv` 的 transpose 参数在 WebGL 里只能传 false，
 * 也就是说传进去的必须本来就是列主序。
 */
export function gamutMatrixFor(spaceId: LogSpaceId): Mat3 {
  const index = logSpaceIndex(spaceId);
  const matrix = LOG_GAMUT_FORWARD[index];
  if (!matrix) {
    throw new Error(`未知的 Log 空间: ${String(spaceId)}`);
  }
  return matrix;
}

/**
 * ProPhoto RGB (linear) → 该 Log 空间色域 (linear)，`output = M · input`（列向量）。
 *
 * **不夹取结果。** ProPhoto 比其中几个目标色域更宽（例如 F-Gamut C、Cinema Gamut
 * 的原色落在可见轨迹之外），转换后出现负值或大于 1 的分量是正常且有意义的：
 * 那些分量代表目标色域装不下的颜色，夹取会改变色相而不只是裁掉饱和度。
 * log-gamut.test.ts 里有一条用例专门盯住这个「不夹取」的行为。
 */
export function applyGamutMatrix(rgb: Rgb, spaceId: LogSpaceId): Rgb {
  return applyMatrix3(gamutMatrixFor(spaceId), rgb);
}
