import { describe, expect, it } from 'vitest';
import {
  C_LOG2_CUT,
  C_LOG2_CUT_ENCODED,
  C_LOG3_CUT_HI,
  C_LOG3_CUT_LO,
  C_LOG3_X_CUT_HI,
  C_LOG3_X_CUT_LO,
  D_LOG_CUT_ENCODED,
  decodeArriLogC3,
  decodeArriLogC4,
  decodeCanonLog2,
  decodeCanonLog3,
  decodeDLog,
  decodeFLog,
  decodeFLog2,
  decodeLLog,
  decodeLog,
  decodeLog3G10,
  decodeNLog,
  decodeSLog3,
  decodeVLog,
  encodeArriLogC3,
  encodeArriLogC4,
  encodeCanonLog2,
  encodeCanonLog3,
  encodeDLog,
  encodeFLog,
  encodeFLog2,
  encodeLLog,
  encodeLog,
  encodeLog3G10,
  encodeNLog,
  encodeSLog3,
  encodeVLog,
  F_LOG2_CUT1,
  F_LOG2_CUT2,
  F_LOG2_E,
  F_LOG2_F,
  F_LOG_CUT1,
  F_LOG_CUT2,
  F_LOG_E,
  F_LOG_F,
  LOG_C3_CUT_ENCODED,
  LOG_C4_T,
  LOG_CURVES,
  S_LOG3_CUT_ENCODED,
} from './log-curves';
import { LOG_SPACES, logSpaceIndex, type LogSpaceId } from './log-spaces';

/** 一共 14 条曲线，id 列表直接取自数据表，避免测试里再抄一遍 */
const ALL_IDS: readonly LogSpaceId[] = LOG_SPACES.map((space) => space.id);

/**
 * 往返测试的容差，取 `|误差| <= 1e-9 + 1e-5 * |参考值|`。
 *
 * 为什么是这个量级：14 条曲线在 `x ∈ [0, 100]` 上密扫，12 条曲线
 * `decode(encode(x))` 的最大误差只有 1.1e-13（double 里 `log2`/`pow` 的正常水平，
 * 误差随 x 线性放大），而 D-Log 会达到 8.389e-6——这不是实现误差，而是
 * colour-science 自己的 `log_decoding_DJIDLog` 用 `10^(3.89616y - 2.27752)`
 * 这组「二次常数」反解 `log10(x*0.9892 + 0.0108)`，两组常数各自只有 6 位有效数字，
 * 反解的相对误差被对数支放大到约 8.4e-8，乘以 x = 100 就是 8.4e-6。
 *
 * 所以绝对项 1e-9 负责锁住「正常曲线必须是精确互逆」，相对项 1e-5 负责容纳
 * 参考实现自身常数精度带来的误差；任何一处常数抄错、分段点错位都会带来
 * 1e-3 以上的相对偏差，仍然挡得住。
 */
const ROUND_TRIP_ABS = 1e-9;
const ROUND_TRIP_REL = 1e-5;

/** 扫过暗部、中灰、高光和超白；这些值也是 renderer 实际会喂进来的量级 */
const LINEAR_SWEEP = [0, 1e-6, 0.001, 0.18, 0.5, 1, 4, 16, 100];

function expectRoundTripClose(actual: number, expected: number, label: string): void {
  const tolerance = ROUND_TRIP_ABS + ROUND_TRIP_REL * Math.abs(expected);
  expect(Math.abs(actual - expected), `${label}: ${actual} vs ${expected}`).toBeLessThan(tolerance);
}

/** 每条曲线的正/反向实现，用来做与空间无关的批量断言 */
interface CurvePair {
  id: LogSpaceId;
  encode: (linear: number) => number;
  decode: (encoded: number) => number;
}

const CURVE_PAIRS: readonly CurvePair[] = [
  { id: 'f-log', encode: encodeFLog, decode: decodeFLog },
  { id: 'f-log2', encode: encodeFLog2, decode: decodeFLog2 },
  // F-Log2C 与 F-Log2 共用曲线，只有色域不同
  { id: 'f-log2c', encode: encodeFLog2, decode: decodeFLog2 },
  { id: 'v-log', encode: encodeVLog, decode: decodeVLog },
  { id: 'n-log', encode: encodeNLog, decode: decodeNLog },
  { id: 'l-log', encode: encodeLLog, decode: decodeLLog },
  { id: 'canon-log-2', encode: encodeCanonLog2, decode: decodeCanonLog2 },
  { id: 'canon-log-3', encode: encodeCanonLog3, decode: decodeCanonLog3 },
  // S-Log3.Cine 与 S-Log3 共用曲线
  { id: 's-log3', encode: encodeSLog3, decode: decodeSLog3 },
  { id: 's-log3-cine', encode: encodeSLog3, decode: decodeSLog3 },
  { id: 'arri-logc3', encode: encodeArriLogC3, decode: decodeArriLogC3 },
  { id: 'arri-logc4', encode: encodeArriLogC4, decode: decodeArriLogC4 },
  { id: 'log3g10', encode: encodeLog3G10, decode: decodeLog3G10 },
  { id: 'd-log', encode: encodeDLog, decode: decodeDLog },
];

/**
 * 反向（编码值 → 线性 → 编码值）断言。
 *
 * 跳过落在分段接缝上的点：F-Log 的线性趾部与对数支在膝部相差 1.0094e-4
 * （见「两支在分段点处的缝隙」用例），`decode(y)` 落在膝上时编码方向会选到
 * 另一支。这是参考实现的常数问题，不是数学错误，也无法在「照抄 colour-science」
 * 的前提下消除。
 *
 * 判断方式：看 `decode(y)` ± 1e-12 处编码值是否发生了远超容差的跳变；
 * 跳变说明该点正好压在接缝上，跳过。
 */
function expectEncodeRoundTripClose(pair: CurvePair, encoded: number, label: string): void {
  const linear = pair.decode(encoded);
  const left = pair.encode(linear - 1e-12);
  const right = pair.encode(linear + 1e-12);
  if (Math.abs(right - left) > 1e-6) return; // 接缝点，跳过
  expectRoundTripClose(pair.encode(linear), encoded, label);
}

describe('LOG_SPACES 与曲线的一一对应', () => {
  it('恰好 14 个空间，id 唯一', () => {
    expect(LOG_SPACES.length).toBe(14);
    expect(new Set(ALL_IDS).size).toBe(14);
  });

  it('CURVE_PAIRS 覆盖全部 14 个空间', () => {
    // 漏一条曲线的表现是渲染时某个下拉项输出错色，所以在这里挡住
    expect(CURVE_PAIRS.map((pair) => pair.id).sort()).toEqual([...ALL_IDS].sort());
  });
});

describe('encodeLog / decodeLog 分发', () => {
  it('对每个空间都与具名函数一致', () => {
    for (const { id, encode, decode } of CURVE_PAIRS) {
      for (const x of LINEAR_SWEEP) {
        expect(encodeLog(x, id), `${id} encode@${x}`).toBe(encode(x));
        const encoded = encode(x);
        expect(decodeLog(encoded, id), `${id} decode@${encoded}`).toBe(decode(encoded));
      }
    }
  });
});

describe('14 条曲线的往返一致性', () => {
  for (const pair of CURVE_PAIRS) {
    const { id, encode, decode } = pair;

    it(`${id}: decode(encode(x)) ≈ x`, () => {
      for (const x of LINEAR_SWEEP) {
        expectRoundTripClose(decode(encode(x)), x, `${id} @${x}`);
      }
    });

    it(`${id}: encode(decode(y)) ≈ y（编码值域 0…1.2）`, () => {
      // 为什么扫到 1.2：Log 曲线在 1.0 以上就是超白区，但 renderer 会喂进
      // 高光溢出的值，所以正反两个方向都要在超白区成立
      for (let i = 0; i <= 200; i++) {
        const y = (i / 200) * 1.2;
        expectEncodeRoundTripClose(pair, y, `${id} @y=${y}`);
      }
    });

    it(`${id}: 密扫 [0, 100] 仍然互逆`, () => {
      for (let i = 0; i <= 2000; i++) {
        const x = (i / 2000) * 100;
        expectRoundTripClose(decode(encode(x)), x, `${id} @${x}`);
      }
    });
  }
});

describe('已知参考值（来源：colour-science doctest）', () => {
  // 每个期望值都抄自 colour-science 源码 docstring 里的 doctest 数字。
  // 这些是「常数没抄错」的最后一道防线：单靠往返一致抓不到「正反两支一起抄错」。

  it('F-Log: log_encoding_FLog(0.18) == 0.4593184…（fujifilm_f_log.py）', () => {
    expect(encodeFLog(0.18)).toBeCloseTo(0.45931845866162124, 9);
  });

  it('F-Log2: log_encoding_FLog2(0.18) == 0.3910072…（fujifilm_f_log.py）', () => {
    expect(encodeFLog2(0.18)).toBeCloseTo(0.39100724189123004, 9);
  });

  it('V-Log: log_encoding_VLog(0.18) == 0.4233114…（panasonic_v_log.py）', () => {
    expect(encodeVLog(0.18)).toBeCloseTo(0.42331144876013616, 9);
  });

  it('N-Log: log_encoding_NLog(0.18) == 0.3636677…（nikon_n_log.py）', () => {
    // N-Log 的暗部走 (y+b)^(1/3)，这条同时验证了指数是 1/3 而不是别的
    expect(encodeNLog(0.18)).toBeCloseTo(0.3636677701171387, 9);
  });

  it('L-Log: log_encoding_LLog(0.18) == 0.4353139…（leica_l_log.py）', () => {
    expect(encodeLLog(0.18)).toBeCloseTo(0.4353139040439265, 9);
  });

  it('Canon Log 2: log_encoding_CanonLog2(0.18) == 0.39825469…（canon.py, 默认 v1.2）', () => {
    expect(encodeCanonLog2(0.18)).toBeCloseTo(0.3982546925614935, 9);
  });

  it('Canon Log 3: log_encoding_CanonLog3(0.18) == 0.34338937…（canon.py, 默认 v1.2）', () => {
    // doctest 写的是 0.34338937037393549，但 17 位写法在 double 里会丢精度
    // （eslint 的 no-loss-of-precision 会报错），这里用等价的 0.34338937037393547
    expect(encodeCanonLog3(0.18)).toBeCloseTo(0.34338937037393547, 9);
  });

  it('S-Log3: log_encoding_SLog3(0.18) == 0.4105571…（sony.py）', () => {
    expect(encodeSLog3(0.18)).toBeCloseTo(0.41055718475073316, 9);
  });

  it('ARRI LogC3: log_encoding_ARRILogC3(0.18) == 0.3910068…（arri.py, EI800）', () => {
    expect(encodeArriLogC3(0.18)).toBeCloseTo(0.391006832034084, 9);
  });

  it('ARRI LogC4: log_encoding_ARRILogC4(0.18) == 0.2783958…（arri.py）', () => {
    expect(encodeArriLogC4(0.18)).toBeCloseTo(0.2783958365482653, 9);
  });

  it('Log3G10: log_encoding_Log3G10(0.0) == 0.0915514…（red.py, 默认 v3）', () => {
    // v3 在 x = 0 处不是 0 而是 0.0915（因为它先加上 c = 0.01），这一条专门盯住这个偏移
    expect(encodeLog3G10(0)).toBeCloseTo(0.09155148771474521, 9);
  });

  it('Log3G10: log_decoding_Log3G10(1.0) == 184.3223476…（red.py）', () => {
    expect(decodeLog3G10(1)).toBeCloseTo(184.32234764032498, 9);
  });

  it('D-Log: log_encoding_DJIDLog(0.18) == 0.3987645…（dji_d_log.py）', () => {
    expect(encodeDLog(0.18)).toBeCloseTo(0.3987645561893306, 9);
  });

  it('解码侧的 doctest 参考值逐条对齐', () => {
    // 这些是 colour-science docstring 里给出的解码方向输入，全部应还原到 0.18
    expect(decodeFLog(0.45931845866162124)).toBeCloseTo(0.18, 9);
    expect(decodeFLog2(0.39100724189123004)).toBeCloseTo(0.18, 9);
    expect(decodeVLog(0.423311448760136)).toBeCloseTo(0.18, 9);
    expect(decodeNLog(0.36366777011713869)).toBeCloseTo(0.18, 9);
    expect(decodeLLog(0.43531390404392656)).toBeCloseTo(0.18, 9);
    expect(decodeCanonLog2(0.3982546925614935)).toBeCloseTo(0.18, 9);
    expect(decodeCanonLog3(0.34338937037393547)).toBeCloseTo(0.18, 9);
    expect(decodeSLog3(0.410557184750733)).toBeCloseTo(0.18, 9);
    expect(decodeArriLogC3(0.391006832034084)).toBeCloseTo(0.18, 9);
    expect(decodeArriLogC4(0.27839583654826527)).toBeCloseTo(0.18, 9);
    // D-Log 只能到 6 位：colour-science 的反解用 10^(3.89616y - 2.27752) 这组
    // 6 位有效数字的常数，反解 0.18 时的相对误差约 6.7e-7，这是参考实现自身的精度上限
    expect(decodeDLog(0.3987645561893306)).toBeCloseTo(0.18, 6);
  });

  it('10bit 码值表与厂商规范一致', () => {
    // colour-science doctest 里给出的相机码值表（x = [0, 18, 90] / 100）。
    // 用码值而不是归一化值，是因为码值恰好能暴露 10bit 量化后的偏移
    const codeValues = (encode: (x: number) => number): number[] =>
      [0, 0.18, 0.9].map((x) => Math.round(encode(x) * 1023));

    expect(codeValues(encodeSLog3)).toEqual([95, 420, 598]);
    expect(codeValues(encodeVLog)).toEqual([128, 433, 602]);
    expect(codeValues(encodeFLog2)).toEqual([95, 400, 570]);
    expect(codeValues(encodeFLog)).toEqual([95, 470, 705]);
  });
});

describe('分段点连续性与分段阈值', () => {
  /**
   * 检查一条曲线在分段点上「两支给同一个值」。
   *
   * 判据：`decode(cut)` 与「编码器在该点用另一支」的差值。这一条能抓到分段常数抄错——
   * 错一位就会差出 1e-3 以上；而参考实现自身在膝部留下的缝隙会如实反映成较大的数值，
   * 由调用方按实测值给出容差。
   */
  const bothBranchesAgree = (
    encode: (x: number) => number,
    decode: (y: number) => number,
    cut: number,
  ): number => {
    const x = decode(cut);
    const anchor = encode(x);
    let other = anchor;
    for (const step of [1e-9, 1e-8, 1e-7, 1e-6, -1e-9, -1e-8, -1e-7, -1e-6]) {
      const candidate = encode(x + step);
      if (candidate !== anchor) {
        other = candidate;
        break;
      }
    }
    return Math.min(Math.abs(anchor - cut), Math.abs(other - cut));
  };

  it('各曲线的解码分段常数与编码器交接点一致', () => {
    // 容差按曲线分成两类，都是实测值，不是随手放宽：
    //
    // A. 两支在分段点严格相接（差值 < 1e-6）：V-Log、S-Log3、ARRI LogC3、
    //    ARRI LogC4、Log3G10、Canon Log 2/3。这些曲线的解码常数就是编码器
    //    交接点的精确值。
    // B. colour-science 的常数对不上、膝部有真实缝隙的曲线（实测值见下一条用例）：
    //    F-Log 1.0094e-4、L-Log 8.995e-4、N-Log 1.266e-4。
    expect(bothBranchesAgree(encodeFLog, decodeFLog, F_LOG_CUT2)).toBeLessThan(2e-4);
    expect(bothBranchesAgree(encodeFLog2, decodeFLog2, F_LOG2_CUT2)).toBeLessThan(1e-6);
    expect(bothBranchesAgree(encodeVLog, decodeVLog, 0.181)).toBeLessThan(1e-6);
    expect(bothBranchesAgree(encodeLLog, decodeLLog, 0.138)).toBeLessThan(1e-3);
    expect(bothBranchesAgree(encodeNLog, decodeNLog, 452 / 1023)).toBeLessThan(2e-4);
    expect(bothBranchesAgree(encodeSLog3, decodeSLog3, S_LOG3_CUT_ENCODED)).toBeLessThan(1e-9);
    expect(bothBranchesAgree(encodeArriLogC3, decodeArriLogC3, LOG_C3_CUT_ENCODED)).toBeLessThan(
      1e-9,
    );
    expect(bothBranchesAgree(encodeDLog, decodeDLog, D_LOG_CUT_ENCODED)).toBeLessThan(1e-6);
    // Canon Log 2 v1.2 两支在 x = 0 处交接，交接值就是自己的截距
    expect(bothBranchesAgree(encodeCanonLog2, decodeCanonLog2, C_LOG2_CUT_ENCODED)).toBeLessThan(
      1e-9,
    );
  });

  it('两支在分段点处的缝隙（实测值，pin 住参考实现的常数问题）', () => {
    // 这条把「编码器线性支 / 编码器对数支 / 解码器分段常数」三个数字钉死，
    // 而不是靠放宽容差把问题盖过去。
    //
    // 背景（实测，不是推算）：Fujifilm 给出的 F-Log 常数里，
    //   线性支在 x = 0.00089 处 = e·cut1 + f = 8.735631·0.00089 + 0.092864 = 0.100638711590
    //   对数支在 x = 0.00089 处 = c·log10(a·cut1 + b) + d                  = 0.100537775224
    // 两者相差 1.0094e-4，也就是说 colour-science 公布的这组 F-Log 常数在膝部
    // **本身就不是连续的**（对数支比线性支低 1.0094e-4）。解码器的分段常数
    // cut2 = 0.100537775223865 正是「对数支」那一侧的值，所以在
    // decode(cut2) = 0.000889999999999995 处编码器仍走线性支，反解回来的
    // encode(...) = 0.100638711590 与 cut2 差了整个缝隙。这是参考实现的常数问题，
    // 不是本模块抄错——log_encoding_FLog(0.18) = 0.45931845866162124 与
    // colour-science doctest 逐位一致，就是最直接的证据。
    const fLogToeAtKnee = F_LOG_E * F_LOG_CUT1 + F_LOG_F;
    expect(fLogToeAtKnee).toBeCloseTo(0.10063871159, 12);
    expect(F_LOG_CUT2).toBeCloseTo(0.100537775223865, 15);
    expect(fLogToeAtKnee - F_LOG_CUT2).toBeCloseTo(1.009364e-4, 8);
    // 缝隙全在编码器一侧：对数支确实落在 cut2 上
    expect(encodeFLog(F_LOG_CUT1)).toBeCloseTo(F_LOG_CUT2, 12);

    // F-Log2 是同一族的常数，缝隙小得多（3.545819e-8），一并钉住
    const fLog2ToeAtKnee = F_LOG2_E * F_LOG2_CUT1 + F_LOG2_F;
    expect(F_LOG2_CUT2).toBeCloseTo(0.100686685370811, 15);
    expect(fLog2ToeAtKnee - F_LOG2_CUT2).toBeCloseTo(3.545819e-8, 13);
    expect(encodeFLog2(F_LOG2_CUT1)).toBeCloseTo(F_LOG2_CUT2, 12);

    // 缝隙还可以从「解码值域」看到：解码器永远到不了 0.0008784454407317567 以下
    // （那是 enc(x) = cut2 的解），而编码器在 [0.0008784454407317567, 0.00089) 上
    // 明明会产生编码值——这段 x 区间就是参考实现留下的空洞
    const unreachable = 0.0008784454407317567;
    expect(encodeFLog(unreachable)).toBeCloseTo(F_LOG_CUT2, 12);
    expect(F_LOG_CUT1 - unreachable).toBeCloseTo(1.1554559268e-5, 10);

    // 其余曲线的两支在分段点处严格相接（差值只到浮点噪声）
    expect(encodeVLog(0.01 - 1e-9) - encodeVLog(0.01 + 1e-9)).toBeCloseTo(3.00035e-7, 10);
    expect(encodeArriLogC3(0.010591 - 1e-9) - encodeArriLogC3(0.010591 + 1e-9)).toBeCloseTo(
      2.394368e-7,
      10,
    );
    // S-Log3 的编码器在 x = 0.01125 处正好给出解码器的分段常数
    expect(encodeSLog3(0.01125)).toBeCloseTo(S_LOG3_CUT_ENCODED, 12);
    expect(decodeSLog3(S_LOG3_CUT_ENCODED)).toBeCloseTo(0.01125, 12);
    expect(encodeArriLogC4(LOG_C4_T)).toBeCloseTo(0, 12);
    expect(decodeArriLogC4(0)).toBeCloseTo(LOG_C4_T, 12);
  });

  it('Canon Log 3 v1.2 的三段交接点自洽', () => {
    // 编码器的分段点是从解码式反解出来的；把解码器的切分常数代回编码器，
    // 应当正好落回该常数
    const toeCut = decodeCanonLog3(C_LOG3_CUT_LO);
    expect(toeCut).toBeCloseTo(C_LOG3_X_CUT_LO, 8);
    expect(encodeCanonLog3(toeCut)).toBeCloseTo(C_LOG3_CUT_LO, 8);

    const shoulderCut = decodeCanonLog3(C_LOG3_CUT_HI);
    expect(shoulderCut).toBeCloseTo(C_LOG3_X_CUT_HI, 8);
    expect(encodeCanonLog3(shoulderCut)).toBeCloseTo(C_LOG3_CUT_HI, 8);
  });

  it('Canon Log 2 v1.2 的分段常数自身是自洽的', () => {
    // v1.2 的常数都在 studio swing 里，编码器两支正好在 x = 0 交接，
    // 所以交接点的编码值就是 0.092864125。colour-science 的解码函数沿用了
    // v1 的 0.035388128，用它反解 x = 100 会得到 173（不是互逆），
    // 因此本实现改用 C_LOG2_CUT_ENCODED。
    expect(C_LOG2_CUT_ENCODED).toBeCloseTo(C_LOG2_CUT, 12);
    expect(decodeCanonLog2(encodeCanonLog2(100))).toBeCloseTo(100, 6);
    for (let i = 0; i <= 200; i++) {
      const x = (i / 200) * 100;
      expectRoundTripClose(decodeCanonLog2(encodeCanonLog2(x)), x, `canon-log-2 @${x}`);
    }
  });
});

describe('单调性', () => {
  for (const { id, encode } of CURVE_PAIRS) {
    it(`${id}: encode 在 [0, 100] 上非递减`, () => {
      // 单调性保证 Log 编码不会把亮部压回暗部；分段点选错时最先崩的就是这条
      let previous = encode(0);
      for (let i = 1; i <= 2000; i++) {
        const current = encode((i / 2000) * 100);
        expect(current, `${id} 在 x=${(i / 2000) * 100} 处回退`).toBeGreaterThanOrEqual(previous);
        previous = current;
      }
    });
  }
});

describe('边界值行为', () => {
  it('x = 0 有定义且有限（暗部端点就是曲线的黑位）', () => {
    for (const { id, encode } of CURVE_PAIRS) {
      const encoded = encode(0);
      expect(Number.isFinite(encoded), `${id} encode(0)`).toBe(true);
      // 黑位应落在 0…0.13 之间：14 条曲线的暗部端点都在这个范围
      expect(encoded, `${id} encode(0)=${encoded}`).toBeGreaterThanOrEqual(0);
      expect(encoded, `${id} encode(0)=${encoded}`).toBeLessThan(0.13);
    }
  });

  it('-1e-6 附近的微小负值不会返回 NaN', () => {
    // Raw-Alchemy 在编码前把线性值夹到 1e-6；我们不做隐式夹取，但要求
    // 传进来的「几乎为零的负数」仍然是有限值，不能把 NaN 泄进渲染管线
    for (const { id, encode } of CURVE_PAIRS) {
      for (const x of [-1e-9, -1e-6, -0.0]) {
        expect(Number.isNaN(encode(x)), `${id} encode(${x})`).toBe(false);
        expect(Number.isFinite(encode(x)), `${id} encode(${x})`).toBe(true);
      }
    }
  });

  it('明显为负的线性值：算术延伸支有限，幂/根支与 colour-science 一样是 NaN', () => {
    // colour-science 对负输入并不做保护：落在 log 支上就是 NaN。
    // 这里把这个行为写死，避免以后有人「顺手」加 clamp 而改变与参考实现的一致性。
    expect(Number.isNaN(encodeFLog(-0.5))).toBe(false);
    expect(Number.isNaN(encodeVLog(-0.5))).toBe(false);
    expect(Number.isNaN(encodeLLog(-0.5))).toBe(false);
    expect(Number.isNaN(encodeSLog3(-0.5))).toBe(false);
    expect(Number.isNaN(encodeArriLogC3(-0.5))).toBe(false);
    expect(Number.isNaN(encodeArriLogC4(-0.5))).toBe(false);
    expect(Number.isNaN(encodeDLog(-0.5))).toBe(false);
    // Log3G10 在 x + 0.01 < 0 时走线性延伸支
    expect(Number.isNaN(encodeLog3G10(-0.5))).toBe(false);
    expect(Number.isNaN(encodeLog3G10(-0.005))).toBe(false);
    // N-Log 只有 x < -0.0075 才会掉进负数的立方根，colour-science 同样返回 NaN
    expect(Number.isNaN(encodeNLog(-0.5))).toBe(true);
    // 两个 Canon 曲线的负支被 -x·S + 1 的定义域限制在很窄的一段
    expect(Number.isNaN(encodeCanonLog2(-0.5))).toBe(false);
    expect(Number.isNaN(encodeCanonLog3(-0.5))).toBe(false);
  });

  it('大于 1 的值继续单调抬升（超白区不能截断）', () => {
    for (const { id, encode } of CURVE_PAIRS) {
      expect(encode(100), `${id}`).toBeGreaterThan(encode(1));
    }
  });

  it('Infinity 顺着各支算术延伸，不出现 NaN', () => {
    // +∞ 应得到 +∞（或 log 支的 +∞），-∞ 在线性支得到 -∞；
    // 关键是两种情况都不能是 NaN，否则 shader 里会出现黑块
    for (const { id, encode } of CURVE_PAIRS) {
      expect(Number.isNaN(encode(Number.POSITIVE_INFINITY)), `${id} enc(+∞)`).toBe(false);
      expect(Number.isNaN(encode(Number.NEGATIVE_INFINITY)), `${id} enc(-∞)`).toBe(false);
    }
  });

  it('解码方向对 ±Infinity 也不返回 NaN', () => {
    for (const { id, decode } of CURVE_PAIRS) {
      expect(Number.isNaN(decode(Number.POSITIVE_INFINITY)), `${id} dec(+∞)`).toBe(false);
      expect(Number.isNaN(decode(Number.NEGATIVE_INFINITY)), `${id} dec(-∞)`).toBe(false);
    }
  });
});

describe('LOG_CURVES 注册表', () => {
  it('顺序与 LOG_SPACES 对齐——下标就是 WebGL uniform 的取值', () => {
    expect(LOG_CURVES).toHaveLength(LOG_SPACES.length);
    LOG_CURVES.forEach((curve, index) => {
      expect(curve.id).toBe(LOG_SPACES[index].id);
    });
  });

  it('每条表项与同名的具名实现一致', () => {
    for (const { id } of CURVE_PAIRS) {
      const curve = LOG_CURVES[logSpaceIndex(id)];
      for (const x of [0, 0.18, 1]) {
        expect(curve.encode(x), `${id} encode(${x})`).toBe(encodeLog(x, id));
        expect(curve.decode(x), `${id} decode(${x})`).toBe(decodeLog(x, id));
      }
    }
  });

  it('共享曲线的两个空间指向同一个实现', () => {
    // F-Log2C 与 F-Log2、S-Log3.Cine 与 S-Log3 只差色域，曲线是同一个
    expect(LOG_CURVES[logSpaceIndex('f-log2c')].encode).toBe(
      LOG_CURVES[logSpaceIndex('f-log2')].encode,
    );
    expect(LOG_CURVES[logSpaceIndex('s-log3-cine')].decode).toBe(
      LOG_CURVES[logSpaceIndex('s-log3')].decode,
    );
  });

  it('表里没有的 id 抛错，而不是返回 undefined 的调用结果', () => {
    expect(() => encodeLog(0.18, 'not-a-space' as LogSpaceId)).toThrow(/未知的 Log 空间/);
    expect(() => decodeLog(0.5, 'not-a-space' as LogSpaceId)).toThrow(/未知的 Log 空间/);
  });
});
