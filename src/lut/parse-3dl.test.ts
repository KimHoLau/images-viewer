import { describe, expect, it } from 'vitest';
import { parse3dlLut } from './parse-3dl';

/** 1 位输入 → 格点数 2^1 + 1 = 3，共 27 组；2 位输出 → 最大值 3 */
const GRID_SIZE = 3;
const OUTPUT_MAX = 3;

function build3dl(entries = GRID_SIZE ** 3): string {
  const lines: string[] = ['3DMESH', 'Mesh 1 2', String(GRID_SIZE)];
  for (let i = 0; i < entries; i++) {
    lines.push(`${i % (OUTPUT_MAX + 1)} 0 ${OUTPUT_MAX}`);
  }
  return lines.join('\n');
}

describe('parse3dlLut', () => {
  it('parses a valid mesh', () => {
    const lut = parse3dlLut(build3dl());

    expect(lut.size).toBe(GRID_SIZE);
    expect(lut.data).toHaveLength(GRID_SIZE ** 3 * 3);
  });

  it('normalizes integers by the output bit depth', () => {
    const lut = parse3dlLut(build3dl());

    // 第一组是 0 0 3 → 0, 0, 1
    expect(Array.from(lut.data.slice(0, 3))).toEqual([0, 0, 1]);
    // 第二组是 1 0 3 → 1/3, 0, 1
    expect(lut.data[3]).toBeCloseTo(1 / 3, 6);
  });

  it('accepts data wrapped across lines however the exporter chose', () => {
    const flat = build3dl().split('\n').join(' ');
    expect(parse3dlLut(flat).size).toBe(GRID_SIZE);
  });

  it('tolerates comment lines in the data', () => {
    const withComment = build3dl().replace('3DMESH', '3DMESH\n# 导出说明');
    expect(parse3dlLut(withComment).size).toBe(GRID_SIZE);
  });

  it('derives a readable title from the bit depths', () => {
    expect(parse3dlLut(build3dl()).title).toBe('1bit → 2bit');
  });

  it('rejects an empty file', () => {
    expect(() => parse3dlLut('   ')).toThrow(/为空/);
  });

  it('rejects a missing 3DMESH header', () => {
    expect(() => parse3dlLut('Mesh 1 2\n3\n0 0 0\n')).toThrow(/3DMESH/);
  });

  it('rejects a missing Mesh line', () => {
    expect(() => parse3dlLut('3DMESH\n')).toThrow(/Mesh/);
  });

  it('rejects a grid size that disagrees with the input bit depth', () => {
    const wrong = build3dl().replace('\n3\n', '\n4\n');
    expect(() => parse3dlLut(wrong)).toThrow(/格点数/);
  });

  it('rejects an insufficient data block', () => {
    expect(() => parse3dlLut(build3dl(GRID_SIZE ** 3 - 1))).toThrow(/数据量不足/);
  });

  it('rejects non-integer data', () => {
    const bad = build3dl().replace('0 0 3', '0.5 0 3');
    expect(() => parse3dlLut(bad)).toThrow(/非整数/);
  });
});
