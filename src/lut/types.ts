import type { Rgb } from '../renderer/adjustments-math';

/**
 * 3D LUT。
 *
 * 数据顺序与 .cube 规范一致：R 变化最快，即 index = ((b * size + g) * size + r)。
 * 这个顺序也正好等于 WebGL texImage3D 的排布（x 最快、其次 y、最后 z），
 * 所以上传时不需要做任何搬移，着色器里直接用 (r, g, b) 作为采样坐标。
 */
export interface Lut3D {
  /** 每个维度的格点数 */
  size: number;
  /** size³ × 3 个分量，取值范围 [0, 1] */
  data: Float32Array;
  /** LUT 自带的名字（从文件头解析出来时才有） */
  title?: string;
}

/** 采样函数：输入输出都是 sRGB 空间的 [0, 1] */
export type LutSampler = (rgb: Rgb) => Rgb;

/** 从 3D LUT 取某个格点的颜色 */
export function lutEntryAt(lut: Lut3D, r: number, g: number, b: number): Rgb {
  const { size, data } = lut;
  if (r < 0 || g < 0 || b < 0 || r >= size || g >= size || b >= size) {
    throw new Error(`LUT 索引越界: (${r}, ${g}, ${b}) / size=${size}`);
  }
  const index = ((b * size + g) * size + r) * 3;
  return [data[index], data[index + 1], data[index + 2]];
}
