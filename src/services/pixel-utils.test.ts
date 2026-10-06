import { describe, expect, it } from 'vitest';
import { bitmap16ToFloatRgb, bitmapToRgba, flipVertically } from './pixel-utils';

describe('bitmapToRgba', () => {
  it('expands RGB to RGBA with opaque alpha', () => {
    const rgb = new Uint8Array([255, 0, 0, 0, 255, 0]);
    const rgba = bitmapToRgba(rgb, 2, 1, 3);

    expect(Array.from(rgba)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
  });

  it('passes RGBA through unchanged', () => {
    const source = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(Array.from(bitmapToRgba(source, 2, 1, 4))).toEqual(Array.from(source));
  });

  it('expands grayscale to RGBA', () => {
    const rgba = bitmapToRgba(new Uint8Array([10, 20]), 2, 1, 1);
    expect(Array.from(rgba)).toEqual([10, 10, 10, 255, 20, 20, 20, 255]);
  });

  it('accepts a Uint8ClampedArray input', () => {
    const rgba = bitmapToRgba(new Uint8ClampedArray([1, 2, 3]), 1, 1, 3);
    expect(Array.from(rgba)).toEqual([1, 2, 3, 255]);
  });

  it('throws on unsupported color counts', () => {
    expect(() => bitmapToRgba(new Uint8Array(8), 1, 1, 2)).toThrow();
  });
});

describe('bitmap16ToFloatRgb', () => {
  /** 小端写一个 16-bit 采样 */
  const le = (value: number) => [value & 0xff, (value >> 8) & 0xff];

  /** 结果是 Float32Array，期望值按 float64 算，比较时留出单精度误差 */
  function expectRgb(actual: Float32Array, expected: number[]): void {
    expect(actual.length).toBe(expected.length);
    expected.forEach((value, index) => {
      expect(actual[index]).toBeCloseTo(value, 6);
    });
  }

  it('按小端拼回 16-bit 采样并归一化到 [0,1]', () => {
    // 两个像素：纯红 / 15-bit 的一半绿
    const data = new Uint8Array([
      ...le(65535),
      ...le(0),
      ...le(0),
      ...le(0),
      ...le(32768),
      ...le(0),
    ]);
    const rgb = bitmap16ToFloatRgb(data, 2, 1, 3);

    expectRgb(rgb, [1, 0, 0, 0, 32768 / 65535, 0]);
  });

  it('16-bit 数据不会被当成两倍数量的 8 位通道', () => {
    // 0x0100 小端是 [0, 1]；若按字节读会得到 [0, 1, ...] 而不是 1/255
    const rgb = bitmap16ToFloatRgb(new Uint8Array([0, 1, 0, 0, 0, 0]), 1, 1, 3);
    expectRgb(rgb, [256 / 65535, 0, 0]);
  });

  it('灰度图复制到三个通道', () => {
    const rgb = bitmap16ToFloatRgb(new Uint8Array([...le(65535), ...le(0)]), 2, 1, 1);
    expectRgb(rgb, [1, 1, 1, 0, 0, 0]);
  });

  it('四通道输入丢掉 alpha', () => {
    const data = new Uint8Array([...le(1000), ...le(2000), ...le(3000), ...le(4000)]);
    const rgb = bitmap16ToFloatRgb(data, 1, 1, 4);

    expectRgb(rgb, [1000 / 65535, 2000 / 65535, 3000 / 65535]);
  });

  it('拒绝不支持的通道数', () => {
    expect(() => bitmap16ToFloatRgb(new Uint8Array(16), 1, 1, 2)).toThrow(/Unsupported/);
  });

  it('缓冲过小时报错，而不是悄悄读出垃圾', () => {
    expect(() => bitmap16ToFloatRgb(new Uint8Array(4), 2, 1, 3)).toThrow(/过小/);
  });
});

describe('flipVertically', () => {
  /** 每个像素用行号填充，方便看出行的位置 */
  function makeRows(rows: number[][]): Uint8ClampedArray {
    return new Uint8ClampedArray(rows.flat());
  }

  it('swaps the first and last rows, keeping columns in place', () => {
    const pixels = makeRows([
      [1, 2, 3, 4, 5, 6, 7, 8],
      [9, 10, 11, 12, 13, 14, 15, 16],
    ]);

    flipVertically(pixels, 2, 2);

    expect(Array.from(pixels)).toEqual([9, 10, 11, 12, 13, 14, 15, 16, 1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('leaves the middle row of an odd-height image alone', () => {
    const pixels = makeRows([
      [1, 1, 1, 1],
      [2, 2, 2, 2],
      [3, 3, 3, 3],
    ]);

    flipVertically(pixels, 1, 3);

    expect(Array.from(pixels)).toEqual([3, 3, 3, 3, 2, 2, 2, 2, 1, 1, 1, 1]);
  });

  it('is a no-op for a single row', () => {
    const pixels = makeRows([[1, 2, 3, 4]]);
    flipVertically(pixels, 1, 1);
    expect(Array.from(pixels)).toEqual([1, 2, 3, 4]);
  });

  it('is its own inverse', () => {
    const original = makeRows([
      [1, 2, 3, 4],
      [5, 6, 7, 8],
      [9, 10, 11, 12],
      [13, 14, 15, 16],
    ]);
    const pixels = new Uint8ClampedArray(original);

    flipVertically(pixels, 1, 4);
    flipVertically(pixels, 1, 4);

    expect(Array.from(pixels)).toEqual(Array.from(original));
  });

  it('rejects a buffer that is too small', () => {
    expect(() => flipVertically(new Uint8ClampedArray(8), 4, 4)).toThrow(/过小/);
  });
});
