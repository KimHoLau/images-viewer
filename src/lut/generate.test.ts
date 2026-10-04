import { describe, expect, it } from 'vitest';
import { generateLut3D } from './generate';
import { lutEntryAt } from './types';

describe('generateLut3D', () => {
  it('samples the identity function onto the grid', () => {
    const lut = generateLut3D(2, (rgb) => rgb);

    expect(lut.size).toBe(2);
    expect(Array.from(lut.data)).toEqual([
      0, 0, 0, 1, 0, 0, 0, 1, 0, 1, 1, 0, 0, 0, 1, 1, 0, 1, 0, 1, 1, 1, 1, 1,
    ]);
  });

  it('stores entries with red varying fastest', () => {
    // 用「R 分量直接编码格点坐标」的采样函数反推排布
    const lut = generateLut3D(3, (rgb) => [rgb[0], rgb[1], rgb[2]]);

    expect(lutEntryAt(lut, 0, 0, 0)).toEqual([0, 0, 0]);
    expect(lutEntryAt(lut, 2, 0, 0)).toEqual([1, 0, 0]);
    expect(lutEntryAt(lut, 0, 2, 0)).toEqual([0, 1, 0]);
    expect(lutEntryAt(lut, 0, 0, 2)).toEqual([0, 0, 1]);
    expect(lutEntryAt(lut, 1, 1, 1)).toEqual([0.5, 0.5, 0.5]);
  });

  it('allocates size³ × 3 floats', () => {
    const lut = generateLut3D(5, () => [0, 0, 0]);
    expect(lut.data).toHaveLength(5 * 5 * 5 * 3);
  });

  it('clamps sampler output into [0, 1]', () => {
    const lut = generateLut3D(2, () => [2, -1, Number.NaN]);
    expect(Array.from(lut.data.slice(0, 3))).toEqual([1, 0, 0]);
  });

  it('keeps the title', () => {
    expect(generateLut3D(2, (rgb) => rgb, '测试').title).toBe('测试');
  });

  it('rejects sizes below 2', () => {
    expect(() => generateLut3D(1, (rgb) => rgb)).toThrow();
    expect(() => generateLut3D(2.5, (rgb) => rgb)).toThrow();
  });
});

describe('lutEntryAt', () => {
  const lut = generateLut3D(3, (rgb) => rgb);

  it('reads back a grid point', () => {
    expect(lutEntryAt(lut, 1, 2, 0)).toEqual([0.5, 1, 0]);
  });

  it('rejects out-of-range indices', () => {
    expect(() => lutEntryAt(lut, 3, 0, 0)).toThrow();
    expect(() => lutEntryAt(lut, -1, 0, 0)).toThrow();
  });
});
