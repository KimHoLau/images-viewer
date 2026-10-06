import { describe, expect, it } from 'vitest';
import { LOG_GAMUT_FORWARD } from './log-index';
import {
  PROPHOTO_TO_SRGB,
  applyMatrix3,
  invertMatrix3,
  toColumnMajorArray,
  toGlslMat3,
  type Mat3,
} from './matrices';
import type { Rgb } from '../utils/math';

/**
 * 3×3 矩阵工具的单元测试。
 *
 * 这些约定的错误不会抛异常、也不会被类型系统拦住：行主序与列主序搞反、
 * uniform 数组的排布错位，结果都是「画面颜色不对」而不是「程序崩了」。
 * 这一层就是那类约定唯一的落脚点，所以逐条钉住。
 */

const IDENTITY: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];

function expectRgbClose(actual: Rgb, expected: Rgb, precision = 10): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

describe('applyMatrix3', () => {
  it('按 output = M · input（列向量）做乘法', () => {
    // 换通道矩阵：R←B、G←R、B←G
    const swap: Mat3 = [0, 0, 1, 1, 0, 0, 0, 1, 0];
    expectRgbClose(applyMatrix3(swap, [0.1, 0.2, 0.3]), [0.3, 0.1, 0.2]);
  });

  it('单位矩阵原样返回', () => {
    expectRgbClose(applyMatrix3(IDENTITY, [0.2, 0.5, 0.8]), [0.2, 0.5, 0.8]);
  });

  it('不夹紧结果，超色域的分量照实返回', () => {
    // 放大两倍：ProPhoto 的宽容度大于部分目标色域，负值与 >1 都是有意义的
    const double: Mat3 = [2, 0, 0, 0, 2, 0, 0, 0, 2];
    expectRgbClose(applyMatrix3(double, [0.6, -0.1, 0.5]), [1.2, -0.2, 1]);
  });
});

describe('invertMatrix3', () => {
  it('与正矩阵互为逆运算', () => {
    for (const matrix of [PROPHOTO_TO_SRGB, ...LOG_GAMUT_FORWARD]) {
      const inverse = invertMatrix3(matrix);
      // 先正后逆应当回到单位矩阵
      const roundTrip = applyMatrix3(inverse, applyMatrix3(matrix, [0.2, 0.5, 0.8]));
      expectRgbClose(roundTrip, [0.2, 0.5, 0.8], 9);
    }
  });

  it('两次求逆回到原矩阵', () => {
    const once = invertMatrix3(PROPHOTO_TO_SRGB);
    const twice = invertMatrix3(once);
    PROPHOTO_TO_SRGB.forEach((value, index) => {
      expect(twice[index]).toBeCloseTo(value, 9);
    });
  });

  it('奇异矩阵直接抛，不返回垃圾矩阵', () => {
    // 第三行等于第一行，行列式为 0
    const singular: Mat3 = [1, 2, 3, 4, 5, 6, 1, 2, 3];
    expect(() => invertMatrix3(singular)).toThrow(/不可逆/);
  });
});

describe('toColumnMajorArray', () => {
  it('按列主序摊平，GLSL 的 mat3 才认得', () => {
    // 行主序下第 0 行是 [1,2,3]；列主序应当先吐第 0 列 [1,4,7]
    const matrix: Mat3 = [1, 2, 3, 4, 5, 6, 7, 8, 9];

    expect(Array.from(toColumnMajorArray([matrix]))).toEqual([1, 4, 7, 2, 5, 8, 3, 6, 9]);
  });

  it('多个矩阵依次排列，每组 9 个', () => {
    const a: Mat3 = [1, 0, 0, 0, 1, 0, 0, 0, 1];
    const b: Mat3 = [2, 0, 0, 0, 2, 0, 0, 0, 2];
    const flat = toColumnMajorArray([a, b]);

    expect(flat).toHaveLength(18);
    expect(Array.from(flat.slice(9))).toEqual([2, 0, 0, 0, 2, 0, 0, 0, 2]);
  });

  it('空数组得到空缓冲', () => {
    expect(toColumnMajorArray([])).toHaveLength(0);
  });
});

describe('toGlslMat3', () => {
  /** 按 GLSL 的语义解析 mat3(...)：三个参数各是一列，所以解析结果是列主序 */
  function parseGlslMat3(literal: string): Mat3 {
    const match = /^mat3\((.+)\)$/.exec(literal);
    if (!match) throw new Error(`不是 mat3 字面量: ${literal}`);

    const columns = match[1].split(',').map((text) => Number(text.trim()));
    expect(columns).toHaveLength(9);

    // 还原成行主序才能和 TS 侧的 Mat3 比
    const rowMajor: number[] = [];
    for (let row = 0; row < 3; row++) {
      for (let column = 0; column < 3; column++) {
        rowMajor.push(columns[column * 3 + row]);
      }
    }
    return rowMajor as unknown as Mat3;
  }

  it('写出来的字面量乘出来与 TS 侧一致', () => {
    const parsed = parseGlslMat3(toGlslMat3(PROPHOTO_TO_SRGB));
    // 解析出来的是「GLSL 会装进 mat3 的那些数」；转回行主序后必须与 TS 侧同一个矩阵
    expectRgbClose(
      applyMatrix3(parsed, [0.2, 0.5, 0.8]),
      applyMatrix3(PROPHOTO_TO_SRGB, [0.2, 0.5, 0.8]),
      9,
    );
  });

  it('按列拼参，不是按行', () => {
    const matrix: Mat3 = [1, 2, 3, 4, 5, 6, 7, 8, 9];
    expect(toGlslMat3(matrix, 0)).toBe('mat3(1, 4, 7, 2, 5, 8, 3, 6, 9)');
  });
});

describe('PROPHOTO_TO_SRGB', () => {
  it('白点映射到白点', () => {
    expectRgbClose(applyMatrix3(PROPHOTO_TO_SRGB, [1, 1, 1]), [1, 1, 1], 9);
  });

  it('中性灰保持中性', () => {
    expectRgbClose(applyMatrix3(PROPHOTO_TO_SRGB, [0.18, 0.18, 0.18]), [0.18, 0.18, 0.18], 9);
  });

  it('确实换了原色，不是恒等矩阵', () => {
    const result = applyMatrix3(PROPHOTO_TO_SRGB, [1, 0, 0]);
    // ProPhoto 的红原色落在 sRGB 的色域之外，转换后必然有明显分量为负
    expect(Math.min(...result)).toBeLessThan(-0.1);
  });
});
