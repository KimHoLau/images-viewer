import type { Rgb } from '../utils/math';

/**
 * 3×3 矩阵的小工具，色彩空间转换的公共底座。
 *
 * 内部一律用「行主序的 9 个数」表示，乘法按 `output = M · input`（列向量）定义——
 * 与 colour-science 的 `matrix_RGB_to_RGB` 一致。GLSL 的 `mat3` 是列主序，
 * 传给 uniform 或写进着色器常量时必须转置，这里用 toColumnMajor / toGlslMat3 收口，
 * 免得每个调用点自己记这件事。
 */
export type Mat3 = readonly [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
];

/**
 * ProPhoto RGB (D50) 线性 → sRGB (D65) 线性，含 Bradford 色适应。
 *
 * 由原色/白点坐标推导（ProPhoto RGB 的 D50 白点 → Bradford 适配到 sRGB 的 D65），
 * 数值与 Lindbloom 公布的 ProPhoto RGB → sRGB 矩阵一致，M · [1,1,1] 精确落在 [1,1,1]。
 * 这是 Log 模式「解回线性后怎么显示」的那一步：不换回 sRGB 原色，画面的饱和度会明显偏低。
 */
export const PROPHOTO_TO_SRGB: Mat3 = [
  2.034302469793, -0.727509137381, -0.306793332412, -0.228800924351, 1.231714690124,
  -0.002913765774, -0.008562683515, -0.153263786185, 1.1618264697,
];

/** 行列式，只服务于 invertMatrix3 的奇异性判断 */
function determinant3(m: Mat3): number {
  return (
    m[0] * (m[4] * m[8] - m[5] * m[7]) -
    m[1] * (m[3] * m[8] - m[5] * m[6]) +
    m[2] * (m[3] * m[7] - m[4] * m[6])
  );
}

/** 求逆；奇异矩阵直接抛，静默返回垃圾矩阵会让颜色错误一路漂到画面上 */
export function invertMatrix3(m: Mat3): Mat3 {
  const det = determinant3(m);
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error(`矩阵不可逆，行列式 ${det}`);
  }

  const [a, b, c, d, e, f, g, h, i] = m;
  return [
    (e * i - f * h) / det,
    (c * h - b * i) / det,
    (b * f - c * e) / det,
    (f * g - d * i) / det,
    (a * i - c * g) / det,
    (c * d - a * f) / det,
    (d * h - e * g) / det,
    (b * g - a * h) / det,
    (a * e - b * d) / det,
  ];
}

/** 对 RGB 三元组应用矩阵，不做夹紧（超色域的值是有意义的，交给调用方决定） */
export function applyMatrix3(m: Mat3, rgb: Rgb): Rgb {
  return [
    m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2],
    m[3] * rgb[0] + m[4] * rgb[1] + m[5] * rgb[2],
    m[6] * rgb[0] + m[7] * rgb[1] + m[8] * rgb[2],
  ];
}

/** 转成 GLSL uniform 数组要的列主序浮点数组（每 9 个一组） */
export function toColumnMajorArray(matrices: readonly Mat3[]): Float32Array {
  const out = new Float32Array(matrices.length * 9);
  matrices.forEach((m, index) => {
    const base = index * 9;
    for (let column = 0; column < 3; column++) {
      for (let row = 0; row < 3; row++) {
        out[base + column * 3 + row] = m[row * 3 + column];
      }
    }
  });
  return out;
}

/**
 * 写成 GLSL 的 `mat3(...)` 字面量。
 *
 * GLSL 的构造函数按列取值，所以这里显式按列拼，调用点不用再想转置的事；
 * 着色器里的常量与 TS 里的数据因此永远是同一个矩阵。
 */
export function toGlslMat3(m: Mat3, precision = 12): string {
  const columns: string[] = [];
  for (let column = 0; column < 3; column++) {
    const values = [m[column], m[3 + column], m[6 + column]];
    columns.push(values.map((value) => value.toFixed(precision)).join(', '));
  }
  return `mat3(${columns.join(', ')})`;
}
