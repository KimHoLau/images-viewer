/**
 * 14 种 Log 曲线（OETF）的 CPU 实现，逐行对应 colour-science 的
 * `colour/models/rgb/transfer_functions/*.py`，也是 GLSL 镜像的蓝本。
 *
 * 移植约定（GLSL ES 3.00 里必须逐字照抄）：
 * 1. colour-science 用 `np.log10`，但 GLSL ES 3.00 没有 `log10`，所以这里统一写成
 *    `Math.log2(x) * LOG10_OF_2`，GLSL 侧写 `log2(x) * LOG10_OF_2`。常数是精确的
 *    `log10(2) = 0.3010299956639812`。
 * 2. 分段点（cut）直接用 colour-science 源码里的数字，不额外夹取：
 *    每个分段在自身定义域内都良态，`x >= 0` 时不会出现 `log`/`pow` 的非法输入；
 *    解码侧同理，`y` 越界时输出可能变成非有限值，由调用方（renderer）负责夹取。
 * 3. 曲线参数（`cut`、`a`、`b`…）在 colour-science 里是运行期算出来的，例如
 *    Canon 的负支分段点、ARRI LogC4 的 `s`/`t`。这里同样用同一批常数现算，
 *    而不是抄一个截断过的十进制近似值——否则正反变换会在分段点上对不上。
 *
 * 关于负数的口径：Raw-Alchemy 在编码前把线性值夹到 `1e-6`（`np.maximum(img, 1e-6)`）。
 * 本模块不做隐式夹取（导出/测试需要在任意输入上保持定义明确），只保证
 * `x >= 0` 时结果和 colour-science 一致；负数的具体行为见各函数注释与测试。
 */

import type { LogSpaceId } from './log-spaces';

/** log10(2)，`log2(x) * LOG10_OF_2` 等价于 colour-science 的 `log10(x)`（GLSL 无 log10） */
export const LOG10_OF_2 = 0.3010299956639812;

/** 自然对数的底在 log2 尺度上的换算：`ln(x) = log2(x) * LN_2` */
export const LN_2 = 0.6931471805599453;

// ---------------------------------------------------------------------------
// Fujifilm F-Log / F-Log2
// colour-science: colour/models/rgb/transfer_functions/fujifilm_f_log.py
//   CONSTANTS_FLOG  / CONSTANTS_FLOG2
// ---------------------------------------------------------------------------

/** F-Log 常数（colour-science `CONSTANTS_FLOG`） */
export const F_LOG_CUT1 = 0.00089;
export const F_LOG_CUT2 = 0.100537775223865;
export const F_LOG_A = 0.555556;
export const F_LOG_B = 0.009468;
export const F_LOG_C = 0.344676;
export const F_LOG_D = 0.790453;
export const F_LOG_E = 8.735631;
export const F_LOG_F = 0.092864;

/** F-Log2 常数（colour-science `CONSTANTS_FLOG2`） */
export const F_LOG2_CUT1 = 0.000889;
export const F_LOG2_CUT2 = 0.100686685370811;
export const F_LOG2_A = 5.555556;
export const F_LOG2_B = 0.064829;
export const F_LOG2_C = 0.245281;
export const F_LOG2_D = 0.384316;
export const F_LOG2_E = 8.799461;
export const F_LOG2_F = 0.092864;

/** 线性值 → 富士 F-Log 编码值（`log_encoding_FLog`） */
export function encodeFLog(linear: number): number {
  return linear < F_LOG_CUT1
    ? F_LOG_E * linear + F_LOG_F
    : F_LOG_C * (Math.log2(F_LOG_A * linear + F_LOG_B) * LOG10_OF_2) + F_LOG_D;
}

/** 富士 F-Log 编码值 → 线性值（`log_decoding_FLog`） */
export function decodeFLog(encoded: number): number {
  return encoded < F_LOG_CUT2
    ? (encoded - F_LOG_F) / F_LOG_E
    : Math.pow(10, (encoded - F_LOG_D) / F_LOG_C) / F_LOG_A - F_LOG_B / F_LOG_A;
}

/** 线性值 → 富士 F-Log2 编码值（`log_encoding_FLog2`，与 F-Log 同式不同常数） */
export function encodeFLog2(linear: number): number {
  return linear < F_LOG2_CUT1
    ? F_LOG2_E * linear + F_LOG2_F
    : F_LOG2_C * (Math.log2(F_LOG2_A * linear + F_LOG2_B) * LOG10_OF_2) + F_LOG2_D;
}

/** 富士 F-Log2 编码值 → 线性值（`log_decoding_FLog2`） */
export function decodeFLog2(encoded: number): number {
  return encoded < F_LOG2_CUT2
    ? (encoded - F_LOG2_F) / F_LOG2_E
    : Math.pow(10, (encoded - F_LOG2_D) / F_LOG2_C) / F_LOG2_A - F_LOG2_B / F_LOG2_A;
}

// ---------------------------------------------------------------------------
// Panasonic V-Log
// colour-science: colour/models/rgb/transfer_functions/panasonic_v_log.py
//   CONSTANTS_VLOG
// ---------------------------------------------------------------------------

/** V-Log 常数（colour-science `CONSTANTS_VLOG`） */
export const V_LOG_CUT1 = 0.01;
export const V_LOG_CUT2 = 0.181;
export const V_LOG_B = 0.00873;
export const V_LOG_C = 0.241514;
export const V_LOG_D = 0.598206;
/** 线性段的斜率/截距（colour-science 源码里的字面量 5.6 与 0.125） */
export const V_LOG_LINEAR_SLOPE = 5.6;
export const V_LOG_LINEAR_OFFSET = 0.125;

/** 线性值 → 松下 V-Log 编码值（`log_encoding_VLog`） */
export function encodeVLog(linear: number): number {
  return linear < V_LOG_CUT1
    ? V_LOG_LINEAR_SLOPE * linear + V_LOG_LINEAR_OFFSET
    : V_LOG_C * (Math.log2(linear + V_LOG_B) * LOG10_OF_2) + V_LOG_D;
}

/** 松下 V-Log 编码值 → 线性值（`log_decoding_VLog`） */
export function decodeVLog(encoded: number): number {
  return encoded < V_LOG_CUT2
    ? (encoded - V_LOG_LINEAR_OFFSET) / V_LOG_LINEAR_SLOPE
    : Math.pow(10, (encoded - V_LOG_D) / V_LOG_C) - V_LOG_B;
}

// ---------------------------------------------------------------------------
// Nikon N-Log
// colour-science: colour/models/rgb/transfer_functions/nikon_n_log.py
//   CONSTANTS_NLOG —— 注意这条曲线用的是自然对数 np.log
// ---------------------------------------------------------------------------

/** N-Log 常数（colour-science `CONSTANTS_NLOG`） */
export const N_LOG_CUT1 = 0.328;
export const N_LOG_CUT2 = 452 / 1023;
export const N_LOG_A = 650 / 1023;
export const N_LOG_B = 0.0075;
export const N_LOG_C = 150 / 1023;
export const N_LOG_D = 619 / 1023;
/** 三次方根的指数（colour-science `spow(y + b, 1/3)`） */
export const N_LOG_ROOT_EXPONENT = 1 / 3;

/** 线性值 → 尼康 N-Log 编码值（`log_encoding_NLog`，暗部是 `a·(y+b)^(1/3)`） */
export function encodeNLog(linear: number): number {
  return linear < N_LOG_CUT1
    ? N_LOG_A * Math.pow(linear + N_LOG_B, N_LOG_ROOT_EXPONENT)
    : N_LOG_C * (Math.log2(linear) * LN_2) + N_LOG_D;
}

/** 尼康 N-Log 编码值 → 线性值（`log_decoding_NLog`） */
export function decodeNLog(encoded: number): number {
  return encoded < N_LOG_CUT2
    ? Math.pow(encoded / N_LOG_A, 3) - N_LOG_B
    : Math.exp((encoded - N_LOG_D) / N_LOG_C);
}

// ---------------------------------------------------------------------------
// Leica L-Log
// colour-science: colour/models/rgb/transfer_functions/leica_l_log.py
//   CONSTANTS_LLOG
// ---------------------------------------------------------------------------

/** L-Log 常数（colour-science `CONSTANTS_LLOG`） */
export const L_LOG_CUT1 = 0.006;
export const L_LOG_CUT2 = 0.138;
export const L_LOG_A = 8;
export const L_LOG_B = 0.09;
export const L_LOG_C = 0.27;
export const L_LOG_D = 1.3;
export const L_LOG_E = 0.0115;
export const L_LOG_F = 0.6;

/** 线性值 → 徕卡 L-Log 编码值（`log_encoding_LLog`） */
export function encodeLLog(linear: number): number {
  return L_LOG_CUT1 >= linear
    ? L_LOG_A * linear + L_LOG_B
    : L_LOG_C * (Math.log2(L_LOG_D * linear + L_LOG_E) * LOG10_OF_2) + L_LOG_F;
}

/** 徕卡 L-Log 编码值 → 线性值（`log_decoding_LLog`） */
export function decodeLLog(encoded: number): number {
  return encoded <= L_LOG_CUT2
    ? (encoded - L_LOG_B) / L_LOG_A
    : (Math.pow(10, (encoded - L_LOG_F) / L_LOG_C) - L_LOG_E) / L_LOG_D;
}

// ---------------------------------------------------------------------------
// Canon Log 2 / Canon Log 3
// colour-science: colour/models/rgb/transfer_functions/canon.py
//   log_encoding_CanonLog2_v1_2 / log_encoding_CanonLog3_v1_2
//   （colour-science develop 里 Canon 的默认 method 就是 'v1.2'）
// ---------------------------------------------------------------------------

/** Canon Log 2 v1.2 常数（`log_encoding_CanonLog2_v1_2`） */
export const C_LOG2_CUT = 0.092864125;
export const C_LOG2_C = 0.24136077;
export const C_LOG2_S = 87.09937546;
export const C_LOG2_REFLECTION = 0.9;
/**
 * 编码侧的负支分段点，colour-science 写成
 * `x < log_decoding_CanonLog2_v1_2(0.092864125, 10, True)`。代入它自己的解码公式后
 * 该值为 `-0`，也就是编码实际上永远走对数支（v1.2 的常数本身就是 studio-swing 的，
 * 映射到线性值上恒为正）；这里保留同一表达式，避免抄一个截断值。
 */
export const C_LOG2_X_CUT = -((Math.pow(10, (C_LOG2_CUT - C_LOG2_CUT) / C_LOG2_C) - 1) / C_LOG2_S);
/**
 * 解码侧分段点：编码器两支在 `x = 0` 处交接，交接点的编码值就是 `C_LOG2_CUT`
 * （`C_LOG2_C * log10(0 * S + 1) + C_LOG2_CUT`）。
 *
 * 注意：colour-science 的 `log_decoding_CanonLog2_v1_2` 用的是 v1 曲线的截距
 * `0.035388128`，与 v1.2 的编码器对不上——用那个阈值反解 `x = 100` 会得到 173，
 * 误差 73%。这里改用编码器真正的交接值，让 encode/decode 成为严格互逆。
 */
export const C_LOG2_CUT_ENCODED =
  C_LOG2_C * (Math.log2(C_LOG2_S * 0 + 1) * LOG10_OF_2) + C_LOG2_CUT;

/** Canon Log 3 v1.2 常数（`log_encoding_CanonLog3_v1_2`） */
export const C_LOG3_CUT_LO = 0.097465473;
export const C_LOG3_CUT_HI = 0.15277891;
export const C_LOG3_C = 0.36726845;
export const C_LOG3_LINEAR_SLOPE = 1.9754798;
export const C_LOG3_LINEAR_OFFSET = 0.12512219;
export const C_LOG3_TOE_OFFSET = 0.12783901;
export const C_LOG3_SHOULDER_OFFSET = 0.12240537;
export const C_LOG3_S = 14.98325;
export const C_LOG3_REFLECTION = 0.9;
/** 编码侧的负支/中间段/正支分段点（由解码式反解得到） */
export const C_LOG3_X_CUT_LO =
  -((Math.pow(10, (C_LOG3_TOE_OFFSET - C_LOG3_CUT_LO) / C_LOG3_C) - 1) / C_LOG3_S) *
  C_LOG3_REFLECTION;
export const C_LOG3_X_CUT_HI =
  ((Math.pow(10, (C_LOG3_CUT_HI - C_LOG3_SHOULDER_OFFSET) / C_LOG3_C) - 1) / C_LOG3_S) *
  C_LOG3_REFLECTION;

/** 线性值 → 佳能 Canon Log 2 编码值（v1.2） */
export function encodeCanonLog2(linear: number): number {
  const reflection = linear / C_LOG2_REFLECTION;
  return reflection < C_LOG2_X_CUT
    ? -(C_LOG2_C * (Math.log2(-reflection * C_LOG2_S + 1) * LOG10_OF_2) - C_LOG2_CUT)
    : C_LOG2_C * (Math.log2(reflection * C_LOG2_S + 1) * LOG10_OF_2) + C_LOG2_CUT;
}

/** 佳能 Canon Log 2 编码值 → 线性值（v1.2） */
export function decodeCanonLog2(encoded: number): number {
  return (
    (encoded < C_LOG2_CUT_ENCODED
      ? -(Math.pow(10, (C_LOG2_CUT_ENCODED - encoded) / C_LOG2_C) - 1) / C_LOG2_S
      : (Math.pow(10, (encoded - C_LOG2_CUT_ENCODED) / C_LOG2_C) - 1) / C_LOG2_S) *
    C_LOG2_REFLECTION
  );
}

/** 线性值 → 佳能 Canon Log 3 编码值（v1.2，三段：趾部 / 线性 / 肩部） */
export function encodeCanonLog3(linear: number): number {
  const reflection = linear / C_LOG3_REFLECTION;
  if (reflection < C_LOG3_X_CUT_LO) {
    return -C_LOG3_C * (Math.log2(-reflection * C_LOG3_S + 1) * LOG10_OF_2) + C_LOG3_TOE_OFFSET;
  }
  if (reflection <= C_LOG3_X_CUT_HI) {
    return C_LOG3_LINEAR_SLOPE * reflection + C_LOG3_LINEAR_OFFSET;
  }
  return C_LOG3_C * (Math.log2(reflection * C_LOG3_S + 1) * LOG10_OF_2) + C_LOG3_SHOULDER_OFFSET;
}

/** 佳能 Canon Log 3 编码值 → 线性值（v1.2） */
export function decodeCanonLog3(encoded: number): number {
  if (encoded < C_LOG3_CUT_LO) {
    return (
      (-(Math.pow(10, (C_LOG3_TOE_OFFSET - encoded) / C_LOG3_C) - 1) / C_LOG3_S) * C_LOG3_REFLECTION
    );
  }
  if (encoded <= C_LOG3_CUT_HI) {
    return ((encoded - C_LOG3_LINEAR_OFFSET) / C_LOG3_LINEAR_SLOPE) * C_LOG3_REFLECTION;
  }
  return (
    ((Math.pow(10, (encoded - C_LOG3_SHOULDER_OFFSET) / C_LOG3_C) - 1) / C_LOG3_S) *
    C_LOG3_REFLECTION
  );
}

// ---------------------------------------------------------------------------
// Sony S-Log3（S-Log3 与 S-Log3.Cine 共用同一条曲线）
// colour-science: colour/models/rgb/transfer_functions/sony.py  log_encoding_SLog3
// ---------------------------------------------------------------------------

/** S-Log3 常数（`log_encoding_SLog3`） */
export const S_LOG3_CUT = 0.01125;
/** 分段点在编码值域上的位置：`171.2102946929 / 1023` */
export const S_LOG3_CUT_ENCODED = 171.2102946929 / 1023;
export const S_LOG3_CODE_MAX = 1023;
export const S_LOG3_LOG_OFFSET = 420;
export const S_LOG3_LOG_SCALE = 261.5;
export const S_LOG3_MID_GRAY = 0.18;
export const S_LOG3_BLACK_OFFSET = 0.01;
export const S_LOG3_LINEAR_SLOPE = (171.2102946929 - 95) / 0.01125;
export const S_LOG3_LINEAR_OFFSET = 95;

/** 线性值 → 索尼 S-Log3 编码值（`log_encoding_SLog3`） */
export function encodeSLog3(linear: number): number {
  return linear >= S_LOG3_CUT
    ? (S_LOG3_LOG_OFFSET +
        Math.log2((linear + S_LOG3_BLACK_OFFSET) / (S_LOG3_MID_GRAY + S_LOG3_BLACK_OFFSET)) *
          S_LOG3_LOG_SCALE *
          LOG10_OF_2) /
        S_LOG3_CODE_MAX
    : (linear * S_LOG3_LINEAR_SLOPE + S_LOG3_LINEAR_OFFSET) / S_LOG3_CODE_MAX;
}

/** 索尼 S-Log3 编码值 → 线性值（`log_decoding_SLog3`） */
export function decodeSLog3(encoded: number): number {
  return encoded >= S_LOG3_CUT_ENCODED
    ? Math.pow(10, (encoded * S_LOG3_CODE_MAX - S_LOG3_LOG_OFFSET) / S_LOG3_LOG_SCALE) *
        (S_LOG3_MID_GRAY + S_LOG3_BLACK_OFFSET) -
        S_LOG3_BLACK_OFFSET
    : ((encoded * S_LOG3_CODE_MAX - S_LOG3_LINEAR_OFFSET) * S_LOG3_CUT) /
        (171.2102946929 - S_LOG3_LINEAR_OFFSET);
}

// ---------------------------------------------------------------------------
// ARRI LogC3（EI 800，SUP 3.x，Linear Scene Exposure Factor）
// colour-science: colour/models/rgb/transfer_functions/arri.py
//   DATA_ALEXA_LOG_C_CURVE_CONVERSION['SUP 3.x']['Linear Scene Exposure Factor'][800]
// ---------------------------------------------------------------------------

/** LogC3 EI800 常数（顺序同 colour-science 的 `(cut, a, b, c, d, e, f, e_cut_f)`） */
export const LOG_C3_CUT = 0.010591;
export const LOG_C3_A = 5.555556;
export const LOG_C3_B = 0.052272;
export const LOG_C3_C = 0.24719;
export const LOG_C3_D = 0.385537;
export const LOG_C3_E = 5.367655;
export const LOG_C3_F = 0.092809;
/** 解码分段点 `e * cut + f`，colour-science 里现算，这里同样保留乘法 */
export const LOG_C3_CUT_ENCODED = LOG_C3_E * LOG_C3_CUT + LOG_C3_F;

/** 线性值 → ARRI LogC3 编码值（EI 800） */
export function encodeArriLogC3(linear: number): number {
  return linear > LOG_C3_CUT
    ? LOG_C3_C * (Math.log2(LOG_C3_A * linear + LOG_C3_B) * LOG10_OF_2) + LOG_C3_D
    : LOG_C3_E * linear + LOG_C3_F;
}

/** ARRI LogC3 编码值 → 线性值（EI 800） */
export function decodeArriLogC3(encoded: number): number {
  return encoded > LOG_C3_CUT_ENCODED
    ? (Math.pow(10, (encoded - LOG_C3_D) / LOG_C3_C) - LOG_C3_B) / LOG_C3_A
    : (encoded - LOG_C3_F) / LOG_C3_E;
}

// ---------------------------------------------------------------------------
// ARRI LogC4
// colour-science: colour/models/rgb/transfer_functions/arri.py
//   CONSTANTS_ARRILOGC4（a/b/c 是定义值，s/t 由 a/b/c 算出）
// ---------------------------------------------------------------------------

/** LogC4 基本常数（`CONSTANTS_ARRILOGC4`：`a=(2**18-16)/117.45`、`b=(1023-95)/1023`、`c=95/1023`） */
export const LOG_C4_A = (Math.pow(2, 18) - 16) / 117.45;
export const LOG_C4_B = (1023 - 95) / 1023;
export const LOG_C4_C = 95 / 1023;
/** 派生常数：`s = 7·ln2·2^(7-14c/b)/(a·b)`，`t = (2^(14·(-c/b)+6)-64)/a` */
export const LOG_C4_S =
  (7 * LN_2 * Math.pow(2, 7 - (14 * LOG_C4_C) / LOG_C4_B)) / (LOG_C4_A * LOG_C4_B);
export const LOG_C4_T = (Math.pow(2, (14 * -LOG_C4_C) / LOG_C4_B + 6) - 64) / LOG_C4_A;
/** 对数段里 `log2(a·E + 64) - 6` 的常数 6 与分母 14 */
export const LOG_C4_LOG_OFFSET = 64;
export const LOG_C4_LOG_SHIFT = 6;
export const LOG_C4_LOG_DENOM = 14;

/** 线性值 → ARRI LogC4 编码值 */
export function encodeArriLogC4(linear: number): number {
  return linear >= LOG_C4_T
    ? ((Math.log2(LOG_C4_A * linear + LOG_C4_LOG_OFFSET) - LOG_C4_LOG_SHIFT) / LOG_C4_LOG_DENOM) *
        LOG_C4_B +
        LOG_C4_C
    : (linear - LOG_C4_T) / LOG_C4_S;
}

/** ARRI LogC4 编码值 → 线性值 */
export function decodeArriLogC4(encoded: number): number {
  return encoded >= 0
    ? (Math.pow(2, 14 * ((encoded - LOG_C4_C) / LOG_C4_B) + 6) - LOG_C4_LOG_OFFSET) / LOG_C4_A
    : encoded * LOG_C4_S + LOG_C4_T;
}

// ---------------------------------------------------------------------------
// RED Log3G10（v3，REDLog3G10 白皮书；colour-science 默认 method='v3'）
// colour-science: colour/models/rgb/transfer_functions/red.py  log_encoding_Log3G10_v3
// ---------------------------------------------------------------------------

/** Log3G10 v3 常数（`log_encoding_Log3G10_v3` 内的局部量） */
export const LOG3G10_A = 0.224282;
export const LOG3G10_B = 155.975327;
export const LOG3G10_C = 0.01;
export const LOG3G10_G = 15.1927;

/** 线性值 → RED Log3G10 编码值（v3：`x + c < 0` 时走线性延伸段） */
export function encodeLog3G10(linear: number): number {
  const shifted = linear + LOG3G10_C;
  return shifted < 0
    ? shifted * LOG3G10_G
    : Math.sign(shifted) * LOG3G10_A * (Math.log2(Math.abs(shifted) * LOG3G10_B + 1) * LOG10_OF_2);
}

/** RED Log3G10 编码值 → 线性值（v3） */
export function decodeLog3G10(encoded: number): number {
  return encoded < 0
    ? encoded / LOG3G10_G - LOG3G10_C
    : (Math.sign(encoded) * (Math.pow(10, Math.abs(encoded) / LOG3G10_A) - 1)) / LOG3G10_B -
        LOG3G10_C;
}

// ---------------------------------------------------------------------------
// DJI D-Log
// colour-science: colour/models/rgb/transfer_functions/dji_d_log.py
// ---------------------------------------------------------------------------

/** D-Log 常数（`log_encoding_DJIDLog` / `log_decoding_DJIDLog` 里的字面量） */
export const D_LOG_CUT_LINEAR = 0.0078;
/**
 * 解码侧分段点，取自 colour-science `log_decoding_DJIDLog` 的硬编码值 `0.14`。
 *
 * 注意 0.14 与编码器的交接点并不完全重合：编码器在 `x = 0.0078` 处交接，
 * 交接值是 `0.139895`（不是 0.14）。用 0.14 反解 `x = 0.0078` 会落到线性支上、
 * 得到精确值，所以这里保留参考实现的常数；残留误差来自参考实现自身
 * `10^(3.89616y - 2.27752)` 那组 6 位常数，见 log-curves.test.ts 的容差说明。
 */
export const D_LOG_CUT_ENCODED = 0.14;
export const D_LOG_LINEAR_SLOPE = 6.025;
export const D_LOG_LINEAR_OFFSET = 0.0929;
export const D_LOG_LOG_SCALE = 0.256663;
export const D_LOG_LOG_OFFSET = 0.584555;
export const D_LOG_A = 0.9892;
export const D_LOG_B = 0.0108;
export const D_LOG_DECODE_SLOPE = 3.89616;
export const D_LOG_DECODE_OFFSET = 2.27752;

/** 线性值 → 大疆 D-Log 编码值 */
export function encodeDLog(linear: number): number {
  return linear <= D_LOG_CUT_LINEAR
    ? D_LOG_LINEAR_SLOPE * linear + D_LOG_LINEAR_OFFSET
    : Math.log2(linear * D_LOG_A + D_LOG_B) * LOG10_OF_2 * D_LOG_LOG_SCALE + D_LOG_LOG_OFFSET;
}

/** 大疆 D-Log 编码值 → 线性值 */
export function decodeDLog(encoded: number): number {
  return encoded <= D_LOG_CUT_ENCODED
    ? (encoded - D_LOG_LINEAR_OFFSET) / D_LOG_LINEAR_SLOPE
    : (Math.pow(10, D_LOG_DECODE_SLOPE * encoded - D_LOG_DECODE_OFFSET) - D_LOG_B) / D_LOG_A;
}

// ---------------------------------------------------------------------------
// 分发：switch 覆盖全部 14 个 id，default 用 never 兜住漏写
// ---------------------------------------------------------------------------

/** 线性值 → Log 编码值 */
export function encodeLog(linear: number, spaceId: LogSpaceId): number {
  switch (spaceId) {
    case 'f-log':
      return encodeFLog(linear);
    case 'f-log2':
    case 'f-log2c':
      // F-Log2C 与 F-Log2 是同一个传输函数，只有色域不同（colour-science 的
      // RGB_COLOURSPACE_F_GAMUT_C 也直接复用 log_encoding_FLog2）
      return encodeFLog2(linear);
    case 'v-log':
      return encodeVLog(linear);
    case 'n-log':
      return encodeNLog(linear);
    case 'l-log':
      return encodeLLog(linear);
    case 'canon-log-2':
      return encodeCanonLog2(linear);
    case 'canon-log-3':
      return encodeCanonLog3(linear);
    case 's-log3':
    case 's-log3-cine':
      return encodeSLog3(linear);
    case 'arri-logc3':
      return encodeArriLogC3(linear);
    case 'arri-logc4':
      return encodeArriLogC4(linear);
    case 'log3g10':
      return encodeLog3G10(linear);
    case 'd-log':
      return encodeDLog(linear);
    default: {
      const exhaustive: never = spaceId;
      throw new Error(`未知的 Log 空间: ${String(exhaustive)}`);
    }
  }
}

/** Log 编码值 → 线性值 */
export function decodeLog(encoded: number, spaceId: LogSpaceId): number {
  switch (spaceId) {
    case 'f-log':
      return decodeFLog(encoded);
    case 'f-log2':
    case 'f-log2c':
      return decodeFLog2(encoded);
    case 'v-log':
      return decodeVLog(encoded);
    case 'n-log':
      return decodeNLog(encoded);
    case 'l-log':
      return decodeLLog(encoded);
    case 'canon-log-2':
      return decodeCanonLog2(encoded);
    case 'canon-log-3':
      return decodeCanonLog3(encoded);
    case 's-log3':
    case 's-log3-cine':
      return decodeSLog3(encoded);
    case 'arri-logc3':
      return decodeArriLogC3(encoded);
    case 'arri-logc4':
      return decodeArriLogC4(encoded);
    case 'log3g10':
      return decodeLog3G10(encoded);
    case 'd-log':
      return decodeDLog(encoded);
    default: {
      const exhaustive: never = spaceId;
      throw new Error(`未知的 Log 空间: ${String(exhaustive)}`);
    }
  }
}
