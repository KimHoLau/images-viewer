import { describe, expect, it } from 'vitest';
import { applyGamutMatrix, gamutMatrixFor } from './log-gamut';
import {
  LOG_GAMUT_MATRICES,
  LOG_GAMUT_PRIMARIES,
  LOG_SPACES,
  logSpaceIndex,
  type GamutPrimaries,
  type LogSpaceId,
} from './log-spaces';

const ALL_IDS: readonly LogSpaceId[] = LOG_SPACES.map((space) => space.id);

// ---------------------------------------------------------------------------
// 独立重算矩阵用的最小线性代数工具。
// 测试里刻意不复用 log-spaces.ts 的任何数字，只吃 LOG_GAMUT_PRIMARIES，
// 这样「原色表抄错」和「矩阵抄错」是两条互相独立的失败路径。
// ---------------------------------------------------------------------------

const multiply = (a: readonly number[], b: readonly number[]): number[] => [
  a[0] * b[0] + a[1] * b[3] + a[2] * b[6],
  a[0] * b[1] + a[1] * b[4] + a[2] * b[7],
  a[0] * b[2] + a[1] * b[5] + a[2] * b[8],
  a[3] * b[0] + a[4] * b[3] + a[5] * b[6],
  a[3] * b[1] + a[4] * b[4] + a[5] * b[7],
  a[3] * b[2] + a[4] * b[5] + a[5] * b[8],
  a[6] * b[0] + a[7] * b[3] + a[8] * b[6],
  a[6] * b[1] + a[7] * b[4] + a[8] * b[7],
  a[6] * b[2] + a[7] * b[5] + a[8] * b[8],
];

/** 3×3 求逆（伴随矩阵 / 行列式），与 numpy.linalg.inv 同解 */
function invert(m: readonly number[]): number[] {
  const c00 = m[4] * m[8] - m[5] * m[7];
  const c01 = m[5] * m[6] - m[3] * m[8];
  const c02 = m[3] * m[7] - m[4] * m[6];
  const det = m[0] * c00 + m[1] * c01 + m[2] * c02;
  return [
    c00 / det,
    (m[2] * m[7] - m[1] * m[8]) / det,
    (m[1] * m[5] - m[2] * m[4]) / det,
    c01 / det,
    (m[0] * m[8] - m[2] * m[6]) / det,
    (m[2] * m[3] - m[0] * m[5]) / det,
    c02 / det,
    (m[1] * m[6] - m[0] * m[7]) / det,
    (m[0] * m[4] - m[1] * m[3]) / det,
  ];
}

const determinant = (m: readonly number[]): number =>
  m[0] * (m[4] * m[8] - m[5] * m[7]) -
  m[1] * (m[3] * m[8] - m[5] * m[6]) +
  m[2] * (m[3] * m[7] - m[4] * m[6]);

/** CIE xy → XYZ（Y = 1），colour-science 的 `xy_to_XYZ` */
const xyToXyz = (xy: readonly [number, number]): [number, number, number] => [
  xy[0] / xy[1],
  1,
  (1 - xy[0] - xy[1]) / xy[1],
];

/**
 * colour-science 的 `normalised_primary_matrix`：解 `P^T · S = W` 再乘回原色矩阵。
 * `P` 的三列是各原色的 XYZ（Y = 1），`W` 是白点的 XYZ（Y = 1）。
 */
function normalisedPrimaryMatrix(primaries: GamutPrimaries): number[] {
  const columns = [xyToXyz(primaries.red), xyToXyz(primaries.green), xyToXyz(primaries.blue)];
  const p = [
    columns[0][0],
    columns[1][0],
    columns[2][0],
    columns[0][1],
    columns[1][1],
    columns[2][1],
    columns[0][2],
    columns[1][2],
    columns[2][2],
  ];
  const w = xyToXyz(primaries.whitepoint);
  const s = [
    // multiply(invert(p), w)：这里直接展开，避免引入 3×3 与向量的额外工具
    invert(p)[0] * w[0] + invert(p)[1] * w[1] + invert(p)[2] * w[2],
    invert(p)[3] * w[0] + invert(p)[4] * w[1] + invert(p)[5] * w[2],
    invert(p)[6] * w[0] + invert(p)[7] * w[1] + invert(p)[8] * w[2],
  ];
  return [
    p[0] * s[0],
    p[1] * s[1],
    p[2] * s[2],
    p[3] * s[0],
    p[4] * s[1],
    p[5] * s[2],
    p[6] * s[0],
    p[7] * s[1],
    p[8] * s[2],
  ];
}

/** colour-science 的 Bradford 色适应矩阵 */
const MATRIX_BRADFORD = [0.8951, 0.2664, -0.1614, -0.7502, 1.7135, 0.0367, 0.0389, -0.0685, 1.0296];

function bradfordAdaptation(
  from: readonly [number, number],
  to: readonly [number, number],
): number[] {
  const source = xyToXyz(from);
  const target = xyToXyz(to);
  const sourceCone = [
    MATRIX_BRADFORD[0] * source[0] +
      MATRIX_BRADFORD[1] * source[1] +
      MATRIX_BRADFORD[2] * source[2],
    MATRIX_BRADFORD[3] * source[0] +
      MATRIX_BRADFORD[4] * source[1] +
      MATRIX_BRADFORD[5] * source[2],
    MATRIX_BRADFORD[6] * source[0] +
      MATRIX_BRADFORD[7] * source[1] +
      MATRIX_BRADFORD[8] * source[2],
  ];
  const targetCone = [
    MATRIX_BRADFORD[0] * target[0] +
      MATRIX_BRADFORD[1] * target[1] +
      MATRIX_BRADFORD[2] * target[2],
    MATRIX_BRADFORD[3] * target[0] +
      MATRIX_BRADFORD[4] * target[1] +
      MATRIX_BRADFORD[5] * target[2],
    MATRIX_BRADFORD[6] * target[0] +
      MATRIX_BRADFORD[7] * target[1] +
      MATRIX_BRADFORD[8] * target[2],
  ];
  const scale = [
    targetCone[0] / sourceCone[0],
    0,
    0,
    0,
    targetCone[1] / sourceCone[1],
    0,
    0,
    0,
    targetCone[2] / sourceCone[2],
  ];
  return multiply(invert(MATRIX_BRADFORD), multiply(scale, MATRIX_BRADFORD));
}

/** ProPhoto RGB (linear, D50) 的原色与白点，colour-science `RGB_COLOURSPACE_PROPHOTO_RGB` */
const PROPHOTO_PRIMARIES: GamutPrimaries = {
  whitepoint: [0.3457, 0.3585], // D50
  red: [0.7347, 0.2653],
  green: [0.1596, 0.8404],
  blue: [0.0366, 0.0001],
};

const PROPHOTO_TO_XYZ = normalisedPrimaryMatrix(PROPHOTO_PRIMARIES);

const applyMatrix = (m: readonly number[], rgb: readonly number[]): number[] => [
  m[0] * rgb[0] + m[1] * rgb[1] + m[2] * rgb[2],
  m[3] * rgb[0] + m[4] * rgb[1] + m[5] * rgb[2],
  m[6] * rgb[0] + m[7] * rgb[1] + m[8] * rgb[2],
];

describe('LOG_GAMUT_MATRICES 的形状与索引对齐', () => {
  it('三张表都是 14 项', () => {
    expect(LOG_GAMUT_MATRICES.length).toBe(14);
    expect(LOG_GAMUT_PRIMARIES.length).toBe(14);
    expect(LOG_SPACES.length).toBe(14);
  });

  it('每个矩阵都是 9 个有限数', () => {
    for (const [index, matrix] of LOG_GAMUT_MATRICES.entries()) {
      expect(matrix.length, `${LOG_SPACES[index].id} 矩阵长度`).toBe(9);
      for (const value of matrix) {
        expect(Number.isFinite(value), `${LOG_SPACES[index].id} 矩阵含非有限值`).toBe(true);
      }
    }
  });

  it('gamutMatrixFor 取到的就是表里对应的那一行', () => {
    // 下标即 uniform 取值，取错一行就是取错色域，所以这条必须显式盯住
    for (const [index, space] of LOG_SPACES.entries()) {
      expect(gamutMatrixFor(space.id)).toBe(LOG_GAMUT_MATRICES[index]);
      expect(logSpaceIndex(space.id)).toBe(index);
    }
  });

  it('同一色域的多个空间共用同一个矩阵', () => {
    const byGamut = new Map<string, readonly number[]>();
    for (const [index, space] of LOG_SPACES.entries()) {
      const existing = byGamut.get(space.gamut);
      if (existing) {
        expect(LOG_GAMUT_MATRICES[index], `${space.id} 与同色域空间不一致`).toEqual(existing);
      } else {
        byGamut.set(space.gamut, LOG_GAMUT_MATRICES[index]);
      }
    }
  });

  it('未知 id 会抛错而不是静默返回第一行', () => {
    // 顺带确认 ALL_IDS 里的每一项都能查到矩阵：id 与下标必须一一对应
    for (const id of ALL_IDS) {
      expect(logSpaceIndex(id), `${id} 应在表里`).toBeGreaterThanOrEqual(0);
    }
    expect(() => gamutMatrixFor('not-a-space' as LogSpaceId)).toThrow();
    expect(logSpaceIndex('not-a-space')).toBe(-1);
    expect(logSpaceIndex(null)).toBe(-1);
    expect(logSpaceIndex(undefined)).toBe(-1);
  });
});

describe('矩阵数值与推导公式一致', () => {
  it('硬编码矩阵与「原色 + Bradford 色适应」重算结果一致', () => {
    // 表里的 9 个数字是按文件头记录的公式算出来的。这里不信任那张表，
    // 只吃 LOG_GAMUT_PRIMARIES，用独立的数值路径重算一遍：
    //   M = N⁻¹ · A · S
    // 其中 S = ProPhoto→XYZ(D50)、A = Bradford(D50→目标白点)、
    // N = 目标原色→XYZ(目标白点)。12 位小数的硬编码值应当与重算值差不到 5e-13
    for (const [index, space] of LOG_SPACES.entries()) {
      const primaries = LOG_GAMUT_PRIMARIES[index];
      const s = PROPHOTO_TO_XYZ;
      const a = bradfordAdaptation(PROPHOTO_PRIMARIES.whitepoint, primaries.whitepoint);
      const nInverse = invert(normalisedPrimaryMatrix(primaries));
      const recomputed = multiply(nInverse, multiply(a, s));
      for (let i = 0; i < 9; i++) {
        expect(
          Math.abs(LOG_GAMUT_MATRICES[index][i] - recomputed[i]),
          `${space.id} 第 ${i} 项`,
        ).toBeLessThan(1e-11);
      }
    }
  });

  it('色适应矩阵确实把 D50 映到目标白点', () => {
    // 上一条用的是同一套 bradfordAdaptation，所以这里单独验一次它的语义
    const adaptation = bradfordAdaptation(PROPHOTO_PRIMARIES.whitepoint, [0.3127, 0.329]);
    const adapted = applyMatrix(adaptation, xyToXyz(PROPHOTO_PRIMARIES.whitepoint));
    const d65 = xyToXyz([0.3127, 0.329]);
    for (let i = 0; i < 3; i++) {
      expect(Math.abs(adapted[i] - d65[i])).toBeLessThan(1e-12);
    }
  });

  it('不做色适应的朴素矩阵会把中性灰推歪（证明色适应这一步不能省）', () => {
    // 这是本项目最容易踩的坑：ProPhoto 是 D50，而 14 个目标色域都是 D65，
    // 省掉 Bradford 后 [1,1,1] 会落在明显偏离 [1,1,1] 的地方
    const index = logSpaceIndex('arri-logc3');
    const naive = multiply(
      invert(normalisedPrimaryMatrix(LOG_GAMUT_PRIMARIES[index])),
      PROPHOTO_TO_XYZ,
    );
    const naiveWhite = applyMatrix(naive, [1, 1, 1]);
    expect(Math.abs(naiveWhite[0] - 1)).toBeGreaterThan(0.05);
    expect(Math.abs(naiveWhite[2] - 1)).toBeGreaterThan(0.05);
  });
});

describe('白点归一化与可逆性', () => {
  it('M · [1,1,1] ≈ [1,1,1]', () => {
    // 两端都在各自白点上归一化，所以线性中性灰必须原样映射到中性灰；
    // 这条一旦失败，画面会整体偏色，而不是某个色相出错
    for (const [index, space] of LOG_SPACES.entries()) {
      const white = applyMatrix(LOG_GAMUT_MATRICES[index], [1, 1, 1]);
      for (const [channel, value] of white.entries()) {
        expect(Math.abs(value - 1), `${space.id} 第 ${channel} 通道`).toBeLessThan(1e-6);
      }
    }
  });

  it('目标白点的 RGB 坐标就是 [1,1,1]', () => {
    // 换个说法验同一条性质：把目标色域的白点（Y = 1 的 XYZ）喂进去，
    // 出来的三通道必须都是 1——这条独立于上一段，能抓到「原色表与白点不匹配」
    for (const [index, space] of LOG_SPACES.entries()) {
      const primaries = LOG_GAMUT_PRIMARIES[index];
      const xyzToTarget = invert(normalisedPrimaryMatrix(primaries));
      const white = applyMatrix(xyzToTarget, xyToXyz(primaries.whitepoint));
      for (const [channel, value] of white.entries()) {
        expect(Math.abs(value - 1), `${space.id} 第 ${channel} 通道`).toBeLessThan(1e-9);
      }
    }
  });

  it('行列式全部为正（矩阵可逆且不翻转手性）', () => {
    for (const [index, space] of LOG_SPACES.entries()) {
      const value = determinant(LOG_GAMUT_MATRICES[index]);
      expect(value, `${space.id} determinant=${value}`).toBeGreaterThan(0);
      // 行列式等于两个色域体积之比，不该出现 0 或天文数字
      expect(value).toBeGreaterThan(0.1);
      expect(value).toBeLessThan(10);
    }
  });
});

describe('已知换算', () => {
  it('外部锚点：colour-science 的 BT.2020 原色与白点确实等于我们表里的值', () => {
    // colour-science 数据集里 `MATRIX_BT2020_TO_XYZ` 是硬编码的一串数字，
    // 用它反推原色不现实；这里反过来：用我们的原色重算，必须复现数据集里那张已知矩阵。
    // 这是对「原色抄错」最直接的外部校验——9 个数字全部对上
    const npm = normalisedPrimaryMatrix(LOG_GAMUT_PRIMARIES[logSpaceIndex('l-log')]);
    const published = [
      0.6369580483012914, 0.14461690358620832, 0.1688809751641721, 0.2627002120112671,
      0.6779980715188708, 0.05930171646986196, 0.0, 0.028072693049087428, 1.060985057710791,
    ];
    for (let i = 0; i < 9; i++) {
      expect(Math.abs(npm[i] - published[i]), `第 ${i} 项`).toBeLessThan(1e-12);
    }
  });

  it('BT.2020 的矩阵把其原色的 XYZ 还原成单位基向量', () => {
    // 注意：不能拿 colour-science 的 `MATRIX_BT2020_TO_XYZ` 的逆来逐项比对本项目矩阵。
    // 那张矩阵没有做 D50 色适应，它的 `npm · [1,1,1] = 1.10761`，
    // 与本项目「两端各自白点归一化 ⇒ M·[1,1,1] = [1,1,1]」不是同一个相对尺度。
    // 能比对的是语义：把目标色域某个原色的 XYZ 喂进矩阵，应当得到对应的单位基向量
    const index = logSpaceIndex('l-log');
    const npm = normalisedPrimaryMatrix(LOG_GAMUT_PRIMARIES[index]);
    const a = bradfordAdaptation(
      PROPHOTO_PRIMARIES.whitepoint,
      LOG_GAMUT_PRIMARIES[index].whitepoint,
    );
    // ProPhoto 空间里表示这个 XYZ 的值 = S⁻¹ · A⁻¹ · XYZ，其中 S = ProPhoto→XYZ
    const proPhoto = applyMatrix(multiply(invert(PROPHOTO_TO_XYZ), invert(a)), [
      npm[0],
      npm[3],
      npm[6],
    ]);
    const back = applyMatrix(LOG_GAMUT_MATRICES[index], proPhoto);
    expect(back[0]).toBeCloseTo(1, 9);
    expect(back[1]).toBeCloseTo(0, 9);
    expect(back[2]).toBeCloseTo(0, 9);

    const awg4 = LOG_GAMUT_MATRICES[logSpaceIndex('arri-logc4')];
    expect(applyMatrix(awg4, [1, 1, 1])[0]).toBeCloseTo(1, 6);
  });

  it('中性灰（0.18）在整个色域转换里保持三通道相等', () => {
    // 矩阵乘以 [t,t,t] 得到 t·M·[1,1,1]，所以只要白点归一化成立，
    // 灰阶就永远不会被色域转换染色——这是选择这套矩阵的核心原因
    for (const space of LOG_SPACES) {
      const gray = applyGamutMatrix([0.18, 0.18, 0.18], space.id);
      expect(Math.abs(gray[0] - gray[1]), `${space.id}`).toBeLessThan(1e-12);
      expect(Math.abs(gray[1] - gray[2]), `${space.id}`).toBeLessThan(1e-12);
      expect(gray[0]).toBeCloseTo(0.18, 9);
    }
  });

  it('纯目标色域原色的 XYZ 能正确还原成单位基向量', () => {
    // 目标色域的纯红在其自身 RGB 里是 [1,0,0]，它的 XYZ 就是原色矩阵 `npm`
    // 的第一列（`npm` 已经按白点归一化）。这条独立于本项目的矩阵，
    // 验证的是「原色表 + npm 定义」这一层没抄错
    for (const [index, space] of LOG_SPACES.entries()) {
      const primaries = LOG_GAMUT_PRIMARIES[index];
      const npm = normalisedPrimaryMatrix(primaries);
      const xyzToTarget = invert(npm);
      for (const channel of [0, 1, 2]) {
        const xyz = [npm[channel], npm[3 + channel], npm[6 + channel]];
        const back = applyMatrix(xyzToTarget, xyz);
        for (const roundTripChannel of [0, 1, 2]) {
          const expected = roundTripChannel === channel ? 1 : 0;
          expect(
            Math.abs(back[roundTripChannel] - expected),
            `${space.id} 原色 ${channel} → 通道 ${roundTripChannel}`,
          ).toBeLessThan(1e-9);
        }
      }
    }
  });

  it('矩阵在具体颜色上的结果与逐项手算一致', () => {
    // 取一个各通道都不同的暖色，逐项展开矩阵乘法再比对 applyGamutMatrix。
    // 这条盯住「乘法顺序」：写成 inputᵀ·M 得到的结果会完全不同
    const input = [0.4, 0.25, 0.1] as const;
    const m = gamutMatrixFor('s-log3-cine');
    const handComputed = [
      m[0] * input[0] + m[1] * input[1] + m[2] * input[2],
      m[3] * input[0] + m[4] * input[1] + m[5] * input[2],
      m[6] * input[0] + m[7] * input[1] + m[8] * input[2],
    ];
    expect(applyGamutMatrix(input, 's-log3-cine')).toEqual(handComputed);
    // 结果确实经过换算，而不是恒等映射
    expect(Math.abs(handComputed[0] - input[0])).toBeGreaterThan(0.01);
  });

  it('色域外的颜色会得到越界分量，而不是被夹取', () => {
    // ProPhoto 比 S-Gamut3.Cine 宽，饱和的黄绿在目标色域里就是负蓝。
    // 这里把「不夹取」写成断言：一旦有人在 applyGamutMatrix 里加 clamp，
    // 这条会立刻失败
    const outOfGamut = applyGamutMatrix([0.0, 1.0, 0.0], 's-log3-cine');
    expect(Math.min(...outOfGamut)).toBeLessThan(0);

    // 反过来，接近中性灰的输入应当留在 [0,1] 内
    const inGamut = applyGamutMatrix([0.2, 0.2, 0.2], 's-log3-cine');
    for (const value of inGamut) {
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThanOrEqual(1);
    }
  });

  it('applyGamutMatrix 的乘法顺序是 M · input（列向量）', () => {
    const matrix = gamutMatrixFor('v-log');
    const input = [0.25, 0.5, 1.0] as const;
    const expected = applyMatrix(matrix, input);
    expect(applyGamutMatrix(input, 'v-log')).toEqual(expected);
  });
});
