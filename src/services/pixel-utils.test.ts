import { describe, expect, it } from 'vitest';
import { bitmapToRgba, flipVertically } from './pixel-utils';

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
