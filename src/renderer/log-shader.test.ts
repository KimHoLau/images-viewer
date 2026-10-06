import { describe, expect, it } from 'vitest';
import {
  C_LOG2_C,
  C_LOG2_CUT,
  C_LOG2_CUT_ENCODED,
  C_LOG2_REFLECTION,
  C_LOG2_S,
  C_LOG2_X_CUT,
  C_LOG3_C,
  C_LOG3_CUT_HI,
  C_LOG3_CUT_LO,
  C_LOG3_LINEAR_OFFSET,
  C_LOG3_LINEAR_SLOPE,
  C_LOG3_REFLECTION,
  C_LOG3_S,
  C_LOG3_SHOULDER_OFFSET,
  C_LOG3_TOE_OFFSET,
  C_LOG3_X_CUT_HI,
  C_LOG3_X_CUT_LO,
  D_LOG_A,
  D_LOG_B,
  D_LOG_CUT_ENCODED,
  D_LOG_CUT_LINEAR,
  D_LOG_DECODE_OFFSET,
  D_LOG_DECODE_SLOPE,
  D_LOG_LINEAR_OFFSET,
  D_LOG_LINEAR_SLOPE,
  D_LOG_LOG_OFFSET,
  D_LOG_LOG_SCALE,
  F_LOG2_A,
  F_LOG2_B,
  F_LOG2_C,
  F_LOG2_CUT1,
  F_LOG2_CUT2,
  F_LOG2_D,
  F_LOG2_E,
  F_LOG2_F,
  F_LOG_A,
  F_LOG_B,
  F_LOG_C,
  F_LOG_CUT1,
  F_LOG_CUT2,
  F_LOG_D,
  F_LOG_E,
  F_LOG_F,
  L_LOG_A,
  L_LOG_B,
  L_LOG_C,
  L_LOG_CUT1,
  L_LOG_CUT2,
  L_LOG_D,
  L_LOG_E,
  L_LOG_F,
  LN_2,
  LOG10_OF_2,
  LOG3G10_A,
  LOG3G10_B,
  LOG3G10_C,
  LOG3G10_G,
  LOG_C3_A,
  LOG_C3_B,
  LOG_C3_C,
  LOG_C3_CUT,
  LOG_C3_CUT_ENCODED,
  LOG_C3_D,
  LOG_C3_E,
  LOG_C3_F,
  LOG_C4_A,
  LOG_C4_B,
  LOG_C4_C,
  LOG_C4_LOG_DENOM,
  LOG_C4_LOG_OFFSET,
  LOG_C4_LOG_SHIFT,
  LOG_C4_S,
  LOG_C4_T,
  N_LOG_A,
  N_LOG_B,
  N_LOG_C,
  N_LOG_CUT1,
  N_LOG_CUT2,
  N_LOG_D,
  N_LOG_ROOT_EXPONENT,
  S_LOG3_BLACK_OFFSET,
  S_LOG3_CODE_MAX,
  S_LOG3_CUT,
  S_LOG3_CUT_ENCODED,
  S_LOG3_LINEAR_OFFSET,
  S_LOG3_LINEAR_SLOPE,
  S_LOG3_LOG_OFFSET,
  S_LOG3_LOG_SCALE,
  S_LOG3_MID_GRAY,
  V_LOG_B,
  V_LOG_C,
  V_LOG_CUT1,
  V_LOG_CUT2,
  V_LOG_D,
  V_LOG_LINEAR_OFFSET,
  V_LOG_LINEAR_SLOPE,
} from '../color/log-curves';
import { LOG_INPUT_FLOOR } from '../color/log-index';
import { LOG_SPACES } from '../color/log-spaces';
import { PROPHOTO_TO_SRGB } from '../color/matrices';
import {
  LOG_CURVE_SHADER_SOURCE,
  LOG_GAMUT_SHADER_SOURCE,
  LOG_SHADER_SOURCE,
  LOG_UNIFORMS,
} from './log-shader';

/**
 * GLSL 与 CPU 两份 Log 实现的守卫。
 *
 * 着色器里的数字全部由 log-shader.ts 从 color/log-curves.ts 插值生成，
 * 但「生成」这件事本身没有类型保护：手改一个字面量、漏掉一条曲线、
 * 加个来路不明的常数，编译器都不会吭声。这里把两件事钉死：
 * 1. GLSL 里出现的每一个小数，都必须来自 log-curves.ts 导出的常数；
 * 2. 编码/解码分发器必须覆盖全部 14 个下标，且调用的函数都有定义。
 */

/** 与 log-shader.ts 里的 g() 同一套写法：整数必须带小数点，否则 GLSL 当成 int */
function glslFloat(value: number): string {
  const text = value.toString();
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/** 抽出源码里所有小数（含指数写法），按数值比较，负号单独处理 */
function literalValues(source: string): Set<number> {
  // 注释里也有数字（比如「Canon Log 2 v1.2」），不能算进常数表
  const code = source.replace(/\/\/[^\n]*/g, '');
  const matches = code.match(/\d+\.\d+(?:[eE][-+]?\d+)?/g) ?? [];
  return new Set(matches.map((text) => Number(text)));
}

/** 每条曲线的全部常数，用来核对 GLSL 里的数字没有第二份来源 */
const CURVE_CONSTANTS: ReadonlyArray<readonly [string, readonly number[]]> = [
  ['F-Log', [F_LOG_CUT1, F_LOG_CUT2, F_LOG_A, F_LOG_B, F_LOG_C, F_LOG_D, F_LOG_E, F_LOG_F]],
  [
    'F-Log2',
    [F_LOG2_CUT1, F_LOG2_CUT2, F_LOG2_A, F_LOG2_B, F_LOG2_C, F_LOG2_D, F_LOG2_E, F_LOG2_F],
  ],
  [
    'V-Log',
    [V_LOG_CUT1, V_LOG_CUT2, V_LOG_B, V_LOG_C, V_LOG_D, V_LOG_LINEAR_SLOPE, V_LOG_LINEAR_OFFSET],
  ],
  ['N-Log', [N_LOG_CUT1, N_LOG_CUT2, N_LOG_A, N_LOG_B, N_LOG_C, N_LOG_D, N_LOG_ROOT_EXPONENT]],
  ['L-Log', [L_LOG_CUT1, L_LOG_CUT2, L_LOG_A, L_LOG_B, L_LOG_C, L_LOG_D, L_LOG_E, L_LOG_F]],
  [
    'Canon Log 2',
    [C_LOG2_CUT, C_LOG2_CUT_ENCODED, C_LOG2_C, C_LOG2_S, C_LOG2_REFLECTION, C_LOG2_X_CUT],
  ],
  [
    'Canon Log 3',
    [
      C_LOG3_CUT_LO,
      C_LOG3_CUT_HI,
      C_LOG3_C,
      C_LOG3_LINEAR_SLOPE,
      C_LOG3_LINEAR_OFFSET,
      C_LOG3_TOE_OFFSET,
      C_LOG3_SHOULDER_OFFSET,
      C_LOG3_S,
      C_LOG3_REFLECTION,
      C_LOG3_X_CUT_LO,
      C_LOG3_X_CUT_HI,
    ],
  ],
  [
    'S-Log3',
    [
      S_LOG3_CUT,
      S_LOG3_CUT_ENCODED,
      S_LOG3_CODE_MAX,
      S_LOG3_LOG_OFFSET,
      S_LOG3_LOG_SCALE,
      S_LOG3_BLACK_OFFSET,
      S_LOG3_LINEAR_OFFSET,
      S_LOG3_MID_GRAY,
      S_LOG3_LINEAR_SLOPE,
    ],
  ],
  [
    'Arri LogC3',
    [LOG_C3_CUT, LOG_C3_A, LOG_C3_B, LOG_C3_C, LOG_C3_D, LOG_C3_E, LOG_C3_F, LOG_C3_CUT_ENCODED],
  ],
  [
    'Arri LogC4',
    [
      LOG_C4_A,
      LOG_C4_B,
      LOG_C4_C,
      LOG_C4_S,
      LOG_C4_T,
      LOG_C4_LOG_OFFSET,
      LOG_C4_LOG_SHIFT,
      LOG_C4_LOG_DENOM,
    ],
  ],
  ['Log3G10', [LOG3G10_A, LOG3G10_B, LOG3G10_C, LOG3G10_G]],
  [
    'D-Log',
    [
      D_LOG_CUT_LINEAR,
      D_LOG_CUT_ENCODED,
      D_LOG_LINEAR_SLOPE,
      D_LOG_LINEAR_OFFSET,
      D_LOG_LOG_SCALE,
      D_LOG_LOG_OFFSET,
      D_LOG_A,
      D_LOG_B,
      D_LOG_DECODE_SLOPE,
      D_LOG_DECODE_OFFSET,
    ],
  ],
];

/** 公式里的结构性常数：幂的底、指数、`>= 0` 这类，不是曲线参数 */
const STRUCTURAL_LITERALS = [0, 1, 2, 3, 10];

/** log-shader.ts 里现算的派生量，同样必须与 CPU 侧对得上 */
const DERIVED_LITERALS = [
  LOG10_OF_2,
  LN_2,
  LOG_INPUT_FLOOR,
  // S-Log3 解码暗部线性段的分母
  171.2102946929 - 95,
];

/** 取出某个 GLSL 函数的函数体 */
function functionBody(source: string, signature: string): string {
  const start = source.indexOf(signature);
  expect(start, `缺少 GLSL 函数 ${signature}`).toBeGreaterThan(-1);
  return source.slice(start, source.indexOf('}', start));
}

describe('Log 曲线的 GLSL 来源', () => {
  it('GLSL 里每个小数都来自 log-curves.ts 的常数', () => {
    const expected = new Set<number>(STRUCTURAL_LITERALS);
    for (const value of DERIVED_LITERALS) expected.add(Math.abs(value));
    for (const [, values] of CURVE_CONSTANTS) {
      for (const value of values) expected.add(Math.abs(value));
    }

    const actual = literalValues(LOG_CURVE_SHADER_SOURCE);
    const unauthorised = [...actual].filter((value) => !expected.has(value));

    expect(
      unauthorised,
      `GLSL 里出现了 log-curves.ts 之外的常数：${unauthorised.join(', ')}`,
    ).toEqual([]);
  });

  it('每条曲线的常数都真的进了 GLSL', () => {
    const literals = literalValues(LOG_CURVE_SHADER_SOURCE);

    for (const [name, values] of CURVE_CONSTANTS) {
      for (const value of values) {
        expect(literals.has(Math.abs(value)), `${name} 的常数 ${value} 没进 GLSL`).toBe(true);
      }
    }
  });

  it('LOG10_OF_2 与 LN_2 是曲线里唯一允许的对数换算常数', () => {
    expect(LOG_CURVE_SHADER_SOURCE).toContain(`const float LOG10_OF_2 = ${glslFloat(LOG10_OF_2)};`);
    expect(LOG_CURVE_SHADER_SOURCE).toContain(`const float LN_2 = ${glslFloat(LN_2)};`);
    // GLSL ES 3.00 没有 log10：写了它编译不过，这里提前拦下来
    expect(LOG_CURVE_SHADER_SOURCE).not.toMatch(/\blog10\s*\(/);
  });

  it('编码前把负值抬到 LOG_INPUT_FLOOR', () => {
    expect(LOG_CURVE_SHADER_SOURCE).toContain(glslFloat(LOG_INPUT_FLOOR));
    const body = functionBody(LOG_CURVE_SHADER_SOURCE, 'vec3 encodeLogRgb(');
    // 三个通道各抬一次，漏掉任何一个都会让该通道变 NaN
    expect(body.match(/max\(/g) ?? []).toHaveLength(3);
  });
});

describe('Log 曲线的 GLSL 分发器', () => {
  /** 每个曲线函数都有编码与解码两份 */
  const expectedFunctions = [
    ['F-Log', 'FLog'],
    ['F-Log2', 'FLog2'],
    ['V-Log', 'VLog'],
    ['N-Log', 'NLog'],
    ['L-Log', 'LLog'],
    ['Canon Log 2', 'CanonLog2'],
    ['Canon Log 3', 'CanonLog3'],
    ['S-Log3', 'SLog3'],
    ['Arri LogC3', 'ArriLogC3'],
    ['Arri LogC4', 'ArriLogC4'],
    ['Log3G10', 'Log3G10'],
    ['D-Log', 'DLog'],
  ] as const;

  it('每条曲线都有编码与解码两个 GLSL 函数', () => {
    for (const [name, suffix] of expectedFunctions) {
      expect(LOG_CURVE_SHADER_SOURCE, `${name} 缺少编码函数`).toContain(`float encode${suffix}(`);
      expect(LOG_CURVE_SHADER_SOURCE, `${name} 缺少解码函数`).toContain(`float decode${suffix}(`);
    }
  });

  it('分发器覆盖 0..13 全部下标，且调用的函数都有定义', () => {
    for (const [dispatcher, prefix] of [
      ['encodeLogCurve', 'encode'],
      ['decodeLogCurve', 'decode'],
    ] as const) {
      const body = functionBody(LOG_CURVE_SHADER_SOURCE, `float ${dispatcher}(`);

      const indices = [...body.matchAll(/curveId == (\d+)/g)].map((match) => Number(match[1]));
      expect(new Set(indices), `${dispatcher} 的下标覆盖不全`).toEqual(
        new Set(LOG_SPACES.map((_, index) => index)),
      );

      const called = [...body.matchAll(/return (\w+)\(/g)].map((match) => match[1]);
      expect(called.length).toBeGreaterThan(0);
      for (const name of called) {
        expect(name.startsWith(prefix), `${dispatcher} 调用了 ${name}`).toBe(true);
        expect(LOG_CURVE_SHADER_SOURCE).toContain(`float ${name}(`);
      }
    }
  });

  it('共享曲线的下标指向同一个函数', () => {
    // F-Log2C 与 F-Log2、S-Log3.Cine 与 S-Log3 只有色域不同
    const body = functionBody(LOG_CURVE_SHADER_SOURCE, 'float encodeLogCurve(');
    expect(body).toContain('curveId == 1 || curveId == 2');
    expect(body).toContain('curveId == 8 || curveId == 9');
  });

  it('未知下标原样返回，与 CPU 侧的越界兜底一致', () => {
    expect(functionBody(LOG_CURVE_SHADER_SOURCE, 'float encodeLogCurve(')).toContain(
      'return linear;',
    );
    expect(functionBody(LOG_CURVE_SHADER_SOURCE, 'float decodeLogCurve(')).toContain(
      'return encoded;',
    );
  });
});

describe('Log 色域矩阵的 GLSL', () => {
  it('矩阵 uniform 数组的长度与 LOG_SPACES 对齐', () => {
    expect(LOG_GAMUT_SHADER_SOURCE).toContain(
      `uniform mat3 u_logGamutForward[${LOG_SPACES.length}];`,
    );
    expect(LOG_GAMUT_SHADER_SOURCE).toContain(
      `uniform mat3 u_logGamutInverse[${LOG_SPACES.length}];`,
    );
    expect(LOG_GAMUT_SHADER_SOURCE).toContain(`const int LOG_MATRIX_COUNT = ${LOG_SPACES.length};`);
  });

  it('14 个空间每个都有正反两个矩阵', () => {
    expect(LOG_SPACES).toHaveLength(14);
    // 下标即空间位置，越界兜底成单位矩阵
    expect(LOG_GAMUT_SHADER_SOURCE).toContain(
      'if (matrixId < 0 || matrixId >= LOG_MATRIX_COUNT) return rgb;',
    );
  });

  it('PROPHOTO_TO_SRGB 常量与 color/matrices.ts 逐项一致', () => {
    const line = /const mat3 PROPHOTO_TO_SRGB = ([^;]+);/.exec(LOG_GAMUT_SHADER_SOURCE);
    expect(line, '缺少 PROPHOTO_TO_SRGB 常量').not.toBeNull();

    const values = [...line![1].matchAll(/-?\d+\.\d+/g)].map((match) => Number(match[0]));
    expect(values).toHaveLength(9);

    // GLSL 的 mat3 按列取值，写入顺序是转置过的，比较时按列还原
    const restored: number[] = [];
    for (let column = 0; column < 3; column++) {
      for (let row = 0; row < 3; row++) {
        restored.push(PROPHOTO_TO_SRGB[row * 3 + column]);
      }
    }

    restored.forEach((value, index) => {
      expect(values[index]).toBeCloseTo(value, 9);
    });
  });
});

describe('Log uniform 名', () => {
  it('列出的每个 uniform 都能在着色器里找到声明', () => {
    for (const name of LOG_UNIFORMS) {
      expect(LOG_SHADER_SOURCE).toContain(name);
    }
  });
});
