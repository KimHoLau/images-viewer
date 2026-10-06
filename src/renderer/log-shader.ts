import {
  C_LOG2_C,
  C_LOG2_CUT,
  C_LOG2_CUT_ENCODED,
  C_LOG2_REFLECTION,
  C_LOG2_S,
  C_LOG2_X_CUT,
  C_LOG3_C,
  C_LOG3_CUT_LO,
  C_LOG3_CUT_HI,
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
  S_LOG3_LINEAR_DENOM,
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
import { PROPHOTO_TO_SRGB, toGlslMat3 } from '../color/matrices';

/**
 * Log 色彩空间的 GLSL 片段，插进 renderer/shaders.ts 的主着色器。
 *
 * 单独一个模块的理由：14 条曲线在这里逐条与 color/log-curves.ts 对应，
 * 放在主着色器里会把「基础管线」和「色彩科学」搅在一起。数值全部从
 * log-curves.ts 插值进来，不在 GLSL 里重抄一遍——两边的常数因此不可能对不上，
 * log-shader.test.ts 也会逐条核对。
 *
 * 与 CPU 实现的两条约定（改动时必须两边同时改）：
 * 1. colour-science 用 `log10`，GLSL ES 3.00 没有，统一写成 `log2(x) * LOG10_OF_2`；
 * 2. 分段与分支条件照抄 CPU 版本，包括 `<` / `<=` 的方向。
 */

/** 把 TS 侧的数值写成 GLSL 的 float 字面量（整数要补小数点，否则会被当成 int） */
function g(value: number): string {
  if (!Number.isFinite(value)) {
    throw new Error(`GLSL 常量必须是有限数，收到 ${value}`);
  }
  const text = value.toString();
  return /[.eE]/.test(text) ? text : `${text}.0`;
}

/** 与 Raw-Alchemy 的 `np.maximum(img, 1e-6)` 对齐：Log 曲线没有负半轴 */
const LOG_FLOOR_LITERAL = g(LOG_INPUT_FLOOR);

/** Log 色彩空间曲线的 GLSL：14 组编码/解码函数 + 两个按 id 的分发器 */
export const LOG_CURVE_SHADER_SOURCE = `
const float LOG10_OF_2 = ${g(LOG10_OF_2)};
const float LN_2 = ${g(LN_2)};

// Fujifilm F-Log
float encodeFLog(float linear) {
  return linear < ${g(F_LOG_CUT1)}
    ? ${g(F_LOG_E)} * linear + ${g(F_LOG_F)}
    : ${g(F_LOG_C)} * (log2(${g(F_LOG_A)} * linear + ${g(F_LOG_B)}) * LOG10_OF_2) + ${g(F_LOG_D)};
}
float decodeFLog(float encoded) {
  return encoded < ${g(F_LOG_CUT2)}
    ? (encoded - ${g(F_LOG_F)}) / ${g(F_LOG_E)}
    : pow(10.0, (encoded - ${g(F_LOG_D)}) / ${g(F_LOG_C)}) / ${g(F_LOG_A)} - ${g(F_LOG_B)} / ${g(F_LOG_A)};
}

// Fujifilm F-Log2（F-Log2C 共用同一条曲线，只有色域不同）
float encodeFLog2(float linear) {
  return linear < ${g(F_LOG2_CUT1)}
    ? ${g(F_LOG2_E)} * linear + ${g(F_LOG2_F)}
    : ${g(F_LOG2_C)} * (log2(${g(F_LOG2_A)} * linear + ${g(F_LOG2_B)}) * LOG10_OF_2) + ${g(F_LOG2_D)};
}
float decodeFLog2(float encoded) {
  return encoded < ${g(F_LOG2_CUT2)}
    ? (encoded - ${g(F_LOG2_F)}) / ${g(F_LOG2_E)}
    : pow(10.0, (encoded - ${g(F_LOG2_D)}) / ${g(F_LOG2_C)}) / ${g(F_LOG2_A)} - ${g(F_LOG2_B)} / ${g(F_LOG2_A)};
}

// Panasonic V-Log
float encodeVLog(float linear) {
  return linear < ${g(V_LOG_CUT1)}
    ? ${g(V_LOG_LINEAR_SLOPE)} * linear + ${g(V_LOG_LINEAR_OFFSET)}
    : ${g(V_LOG_C)} * (log2(linear + ${g(V_LOG_B)}) * LOG10_OF_2) + ${g(V_LOG_D)};
}
float decodeVLog(float encoded) {
  return encoded < ${g(V_LOG_CUT2)}
    ? (encoded - ${g(V_LOG_LINEAR_OFFSET)}) / ${g(V_LOG_LINEAR_SLOPE)}
    : pow(10.0, (encoded - ${g(V_LOG_D)}) / ${g(V_LOG_C)}) - ${g(V_LOG_B)};
}

// Nikon N-Log：亮部用自然对数，暗部是三次方根
float encodeNLog(float linear) {
  return linear < ${g(N_LOG_CUT1)}
    ? ${g(N_LOG_A)} * pow(linear + ${g(N_LOG_B)}, ${g(N_LOG_ROOT_EXPONENT)})
    : ${g(N_LOG_C)} * (log2(linear) * LN_2) + ${g(N_LOG_D)};
}
float decodeNLog(float encoded) {
  return encoded < ${g(N_LOG_CUT2)}
    ? pow(encoded / ${g(N_LOG_A)}, 3.0) - ${g(N_LOG_B)}
    : exp((encoded - ${g(N_LOG_D)}) / ${g(N_LOG_C)});
}

// Leica L-Log
float encodeLLog(float linear) {
  return ${g(L_LOG_CUT1)} >= linear
    ? ${g(L_LOG_A)} * linear + ${g(L_LOG_B)}
    : ${g(L_LOG_C)} * (log2(${g(L_LOG_D)} * linear + ${g(L_LOG_E)}) * LOG10_OF_2) + ${g(L_LOG_F)};
}
float decodeLLog(float encoded) {
  return encoded <= ${g(L_LOG_CUT2)}
    ? (encoded - ${g(L_LOG_B)}) / ${g(L_LOG_A)}
    : (pow(10.0, (encoded - ${g(L_LOG_F)}) / ${g(L_LOG_C)}) - ${g(L_LOG_E)}) / ${g(L_LOG_D)};
}

// Canon Log 2 v1.2
float encodeCanonLog2(float linear) {
  float reflection = linear / ${g(C_LOG2_REFLECTION)};
  return reflection < ${g(C_LOG2_X_CUT)}
    ? -(${g(C_LOG2_C)} * (log2(-reflection * ${g(C_LOG2_S)} + 1.0) * LOG10_OF_2) - ${g(C_LOG2_CUT)})
    : ${g(C_LOG2_C)} * (log2(reflection * ${g(C_LOG2_S)} + 1.0) * LOG10_OF_2) + ${g(C_LOG2_CUT)};
}
float decodeCanonLog2(float encoded) {
  return (encoded < ${g(C_LOG2_CUT_ENCODED)}
    ? -(pow(10.0, (${g(C_LOG2_CUT_ENCODED)} - encoded) / ${g(C_LOG2_C)}) - 1.0) / ${g(C_LOG2_S)}
    : (pow(10.0, (encoded - ${g(C_LOG2_CUT_ENCODED)}) / ${g(C_LOG2_C)}) - 1.0) / ${g(C_LOG2_S)}) * ${g(C_LOG2_REFLECTION)};
}

// Canon Log 3 v1.2：趾部 / 线性 / 肩部三段
float encodeCanonLog3(float linear) {
  float reflection = linear / ${g(C_LOG3_REFLECTION)};
  if (reflection < ${g(C_LOG3_X_CUT_LO)}) {
    return -${g(C_LOG3_C)} * (log2(-reflection * ${g(C_LOG3_S)} + 1.0) * LOG10_OF_2) + ${g(C_LOG3_TOE_OFFSET)};
  }
  if (reflection <= ${g(C_LOG3_X_CUT_HI)}) {
    return ${g(C_LOG3_LINEAR_SLOPE)} * reflection + ${g(C_LOG3_LINEAR_OFFSET)};
  }
  return ${g(C_LOG3_C)} * (log2(reflection * ${g(C_LOG3_S)} + 1.0) * LOG10_OF_2) + ${g(C_LOG3_SHOULDER_OFFSET)};
}
float decodeCanonLog3(float encoded) {
  if (encoded < ${g(C_LOG3_CUT_LO)}) {
    return (-(pow(10.0, (${g(C_LOG3_TOE_OFFSET)} - encoded) / ${g(C_LOG3_C)}) - 1.0) / ${g(C_LOG3_S)}) * ${g(C_LOG3_REFLECTION)};
  }
  if (encoded <= ${g(C_LOG3_CUT_HI)}) {
    return ((encoded - ${g(C_LOG3_LINEAR_OFFSET)}) / ${g(C_LOG3_LINEAR_SLOPE)}) * ${g(C_LOG3_REFLECTION)};
  }
  return ((pow(10.0, (encoded - ${g(C_LOG3_SHOULDER_OFFSET)}) / ${g(C_LOG3_C)}) - 1.0) / ${g(C_LOG3_S)}) * ${g(C_LOG3_REFLECTION)};
}

// Sony S-Log3（S-Log3.Cine 共用同一条曲线）
float encodeSLog3(float linear) {
  return linear >= ${g(S_LOG3_CUT)}
    ? (${g(S_LOG3_LOG_OFFSET)} + log2((linear + ${g(S_LOG3_BLACK_OFFSET)}) / (${g(S_LOG3_MID_GRAY)} + ${g(S_LOG3_BLACK_OFFSET)})) * ${g(S_LOG3_LOG_SCALE)} * LOG10_OF_2) / ${g(S_LOG3_CODE_MAX)}
    : (linear * ${g(S_LOG3_LINEAR_SLOPE)} + ${g(S_LOG3_LINEAR_OFFSET)}) / ${g(S_LOG3_CODE_MAX)};
}
float decodeSLog3(float encoded) {
  return encoded >= ${g(S_LOG3_CUT_ENCODED)}
    ? pow(10.0, (encoded * ${g(S_LOG3_CODE_MAX)} - ${g(S_LOG3_LOG_OFFSET)}) / ${g(S_LOG3_LOG_SCALE)}) * (${g(S_LOG3_MID_GRAY)} + ${g(S_LOG3_BLACK_OFFSET)}) - ${g(S_LOG3_BLACK_OFFSET)}
    : ((encoded * ${g(S_LOG3_CODE_MAX)} - ${g(S_LOG3_LINEAR_OFFSET)}) * ${g(S_LOG3_CUT)}) / ${g(S_LOG3_LINEAR_DENOM)};
}

// ARRI LogC3（EI 800）
float encodeArriLogC3(float linear) {
  return linear > ${g(LOG_C3_CUT)}
    ? ${g(LOG_C3_C)} * (log2(${g(LOG_C3_A)} * linear + ${g(LOG_C3_B)}) * LOG10_OF_2) + ${g(LOG_C3_D)}
    : ${g(LOG_C3_E)} * linear + ${g(LOG_C3_F)};
}
float decodeArriLogC3(float encoded) {
  return encoded > ${g(LOG_C3_CUT_ENCODED)}
    ? (pow(10.0, (encoded - ${g(LOG_C3_D)}) / ${g(LOG_C3_C)}) - ${g(LOG_C3_B)}) / ${g(LOG_C3_A)}
    : (encoded - ${g(LOG_C3_F)}) / ${g(LOG_C3_E)};
}

// ARRI LogC4
float encodeArriLogC4(float linear) {
  return linear >= ${g(LOG_C4_T)}
    ? ((log2(${g(LOG_C4_A)} * linear + ${g(LOG_C4_LOG_OFFSET)}) - ${g(LOG_C4_LOG_SHIFT)}) / ${g(LOG_C4_LOG_DENOM)}) * ${g(LOG_C4_B)} + ${g(LOG_C4_C)}
    : (linear - ${g(LOG_C4_T)}) / ${g(LOG_C4_S)};
}
float decodeArriLogC4(float encoded) {
  return encoded >= 0.0
    ? (pow(2.0, ${g(LOG_C4_LOG_DENOM)} * ((encoded - ${g(LOG_C4_C)}) / ${g(LOG_C4_B)}) + ${g(LOG_C4_LOG_SHIFT)}) - ${g(LOG_C4_LOG_OFFSET)}) / ${g(LOG_C4_A)}
    : encoded * ${g(LOG_C4_S)} + ${g(LOG_C4_T)};
}

// RED Log3G10 v3
float encodeLog3G10(float linear) {
  float shifted = linear + ${g(LOG3G10_C)};
  return shifted < 0.0
    ? shifted * ${g(LOG3G10_G)}
    : sign(shifted) * ${g(LOG3G10_A)} * (log2(abs(shifted) * ${g(LOG3G10_B)} + 1.0) * LOG10_OF_2);
}
float decodeLog3G10(float encoded) {
  return encoded < 0.0
    ? encoded / ${g(LOG3G10_G)} - ${g(LOG3G10_C)}
    : (sign(encoded) * (pow(10.0, abs(encoded) / ${g(LOG3G10_A)}) - 1.0)) / ${g(LOG3G10_B)} - ${g(LOG3G10_C)};
}

// DJI D-Log
float encodeDLog(float linear) {
  return linear <= ${g(D_LOG_CUT_LINEAR)}
    ? ${g(D_LOG_LINEAR_SLOPE)} * linear + ${g(D_LOG_LINEAR_OFFSET)}
    : log2(linear * ${g(D_LOG_A)} + ${g(D_LOG_B)}) * LOG10_OF_2 * ${g(D_LOG_LOG_SCALE)} + ${g(D_LOG_LOG_OFFSET)};
}
float decodeDLog(float encoded) {
  return encoded <= ${g(D_LOG_CUT_ENCODED)}
    ? (encoded - ${g(D_LOG_LINEAR_OFFSET)}) / ${g(D_LOG_LINEAR_SLOPE)}
    : (pow(10.0, ${g(D_LOG_DECODE_SLOPE)} * encoded - ${g(D_LOG_DECODE_OFFSET)}) - ${g(D_LOG_B)}) / ${g(D_LOG_A)};
}

// 按下标分发；下标是 LOG_SPACES 里的位置，-1 表示关闭（原样返回）
float encodeLogCurve(float linear, int curveId) {
  if (curveId == 0) return encodeFLog(linear);
  if (curveId == 1 || curveId == 2) return encodeFLog2(linear);
  if (curveId == 3) return encodeVLog(linear);
  if (curveId == 4) return encodeNLog(linear);
  if (curveId == 5) return encodeLLog(linear);
  if (curveId == 6) return encodeCanonLog2(linear);
  if (curveId == 7) return encodeCanonLog3(linear);
  if (curveId == 8 || curveId == 9) return encodeSLog3(linear);
  if (curveId == 10) return encodeArriLogC3(linear);
  if (curveId == 11) return encodeArriLogC4(linear);
  if (curveId == 12) return encodeLog3G10(linear);
  if (curveId == 13) return encodeDLog(linear);
  return linear;
}

float decodeLogCurve(float encoded, int curveId) {
  if (curveId == 0) return decodeFLog(encoded);
  if (curveId == 1 || curveId == 2) return decodeFLog2(encoded);
  if (curveId == 3) return decodeVLog(encoded);
  if (curveId == 4) return decodeNLog(encoded);
  if (curveId == 5) return decodeLLog(encoded);
  if (curveId == 6) return decodeCanonLog2(encoded);
  if (curveId == 7) return decodeCanonLog3(encoded);
  if (curveId == 8 || curveId == 9) return decodeSLog3(encoded);
  if (curveId == 10) return decodeArriLogC3(encoded);
  if (curveId == 11) return decodeArriLogC4(encoded);
  if (curveId == 12) return decodeLog3G10(encoded);
  if (curveId == 13) return decodeDLog(encoded);
  return encoded;
}

vec3 encodeLogRgb(vec3 linear, int curveId) {
  return vec3(
    encodeLogCurve(max(linear.r, ${LOG_FLOOR_LITERAL}), curveId),
    encodeLogCurve(max(linear.g, ${LOG_FLOOR_LITERAL}), curveId),
    encodeLogCurve(max(linear.b, ${LOG_FLOOR_LITERAL}), curveId)
  );
}

vec3 decodeLogRgb(vec3 encoded, int curveId) {
  return vec3(
    decodeLogCurve(encoded.r, curveId),
    decodeLogCurve(encoded.g, curveId),
    decodeLogCurve(encoded.b, curveId)
  );
}
`;

/** Log 色域矩阵与显示转换的 GLSL；矩阵由 uniform 传入，长度与 LOG_SPACES 对齐 */
export const LOG_GAMUT_SHADER_SOURCE = `
const int LOG_MATRIX_COUNT = ${LOG_SPACES.length};
const mat3 PROPHOTO_TO_SRGB = ${toGlslMat3(PROPHOTO_TO_SRGB)};

uniform mat3 u_logGamutForward[${LOG_SPACES.length}];
uniform mat3 u_logGamutInverse[${LOG_SPACES.length}];

// output = M * input（列向量），与 color/matrices.ts 的 applyMatrix3 一致
vec3 applyGamutMatrix(vec3 rgb, int matrixId) {
  if (matrixId < 0 || matrixId >= LOG_MATRIX_COUNT) return rgb;
  return u_logGamutForward[matrixId] * rgb;
}

vec3 applyInverseGamutMatrix(vec3 rgb, int matrixId) {
  if (matrixId < 0 || matrixId >= LOG_MATRIX_COUNT) return rgb;
  return u_logGamutInverse[matrixId] * rgb;
}
`;

/** Log 模式在片元着色器里用到的 uniform 声明 */
export const LOG_UNIFORM_SHADER_SOURCE = `
uniform int u_logMode;
uniform int u_logCurveId;
uniform int u_logMatrixId;
`;

/** 由 Log 模式驱动的 uniform 名，ImageRenderer 按这个名字表查位置 */
export const LOG_UNIFORMS = [
  'u_logMode',
  'u_logCurveId',
  'u_logMatrixId',
  'u_logGamutForward',
  'u_logGamutInverse',
] as const;

/** 整段 Log 支持：曲线 + 色域矩阵 + uniform 声明 */
export const LOG_SHADER_SOURCE = `${LOG_UNIFORM_SHADER_SOURCE}${LOG_GAMUT_SHADER_SOURCE}${LOG_CURVE_SHADER_SOURCE}`;
