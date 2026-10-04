import { clamp01 } from '../utils/math';
import type { Lut3D, LutSampler } from './types';

/**
 * 把一个采样函数烘成 3D LUT。
 *
 * 遍历顺序按 R 最快、其次 G、最后 B，与 .cube 规范和纹理排布一致。
 * 输入输出都是 sRGB；输出会被夹到 [0, 1]。
 */
export function generateLut3D(size: number, sampler: LutSampler, title?: string): Lut3D {
  if (!Number.isInteger(size) || size < 2) {
    throw new Error(`LUT 尺寸必须是不小于 2 的整数，收到 ${size}`);
  }

  const data = new Float32Array(size * size * size * 3);
  const step = 1 / (size - 1);
  let index = 0;

  for (let b = 0; b < size; b++) {
    for (let g = 0; g < size; g++) {
      for (let r = 0; r < size; r++) {
        const mapped = sampler([r * step, g * step, b * step]);
        data[index++] = clamp01(mapped[0]);
        data[index++] = clamp01(mapped[1]);
        data[index++] = clamp01(mapped[2]);
      }
    }
  }

  return { size, data, title };
}
