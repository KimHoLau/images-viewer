import { describe, expect, it } from 'vitest';
import { parseCubeLut } from './parse-cube';

/** 最小的 2×2×2 .cube，数据是恒等映射 */
const IDENTITY_2 = `TITLE "Identity"
LUT_3D_SIZE 2
0.0 0.0 0.0
1.0 0.0 0.0
0.0 1.0 0.0
1.0 1.0 0.0
0.0 0.0 1.0
1.0 0.0 1.0
0.0 1.0 1.0
1.0 1.0 1.0
`;

describe('parseCubeLut', () => {
  it('parses a minimal 3D LUT', () => {
    const lut = parseCubeLut(IDENTITY_2);

    expect(lut.size).toBe(2);
    expect(lut.data).toHaveLength(8 * 3);
    expect(lut.title).toBe('Identity');
  });

  it('keeps the data in file order', () => {
    const lut = parseCubeLut(IDENTITY_2);
    expect(Array.from(lut.data.slice(0, 6))).toEqual([0, 0, 0, 1, 0, 0]);
  });

  it('skips comments and blank lines', () => {
    const content = `
# 这是注释
TITLE "With comments"

LUT_3D_SIZE 2
0 0 0   # 尾部注释
1 0 0

0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;
    expect(parseCubeLut(content).size).toBe(2);
  });

  it('parses the input range', () => {
    const lut = parseCubeLut(`LUT_3D_SIZE 2\nLUT_3D_INPUT_RANGE 0 255\n${'0 0 0\n'.repeat(8)}`);
    expect(lut.inputRange).toEqual([0, 255]);
  });

  it('flags video range declarations', () => {
    const lut = parseCubeLut(
      `LUT_3D_SIZE 2\nLUT_IN_VIDEO_RANGE\nLUT_OUT_VIDEO_RANGE\n${'0 0 0\n'.repeat(8)}`,
    );
    expect(lut.inVideoRange).toBe(true);
    expect(lut.outVideoRange).toBe(true);
  });

  it('defaults the input range to [0, 1]', () => {
    expect(parseCubeLut(IDENTITY_2).inputRange).toEqual([0, 1]);
  });

  it('rejects a 1D LUT with a clear message', () => {
    expect(() => parseCubeLut('LUT_1D_SIZE 2\n0 0 0\n1 1 1\n')).toThrow(/1D/);
  });

  it('rejects a missing size declaration', () => {
    expect(() => parseCubeLut('0 0 0\n1 1 1\n')).toThrow(/LUT_3D_SIZE/);
  });

  it('rejects a data count mismatch', () => {
    expect(() => parseCubeLut('LUT_3D_SIZE 2\n0 0 0\n1 1 1\n')).toThrow(/数据量不符/);
  });

  it('rejects non-numeric data', () => {
    const bad = `LUT_3D_SIZE 2\n${'abc def ghi\n'}${'0 0 0\n'.repeat(7)}`;
    expect(() => parseCubeLut(bad)).toThrow(/非法数值/);
  });

  it('rejects a ragged data line', () => {
    expect(() => parseCubeLut('LUT_3D_SIZE 2\n0 0\n')).toThrow(/无法解析/);
  });

  it('handles CRLF line endings', () => {
    expect(parseCubeLut(IDENTITY_2.replace(/\n/g, '\r\n')).size).toBe(2);
  });
});
