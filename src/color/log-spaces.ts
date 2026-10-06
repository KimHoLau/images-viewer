/**
 * 14 种 Log 色彩空间的索引对齐数据表。
 *
 * 这个数组的下标就是交给 WebGL uniform 的值，所以顺序本身是接口的一部分：
 * `LOG_SPACES[i]`、`LOG_GAMUT_MATRICES[i]`、`LOG_GAMUT_PRIMARIES[i]` 必须描述同一个空间。
 * 列表顺序照抄参考实现 Raw-Alchemy 的 `src/raw_alchemy/config.py` 里的
 * `LOG_TO_WORKING_SPACE`（见 research/log-color-spaces.md）。
 *
 * 色域矩阵的推导过程
 * ------------------
 * 矩阵由一段仓外脚本（临时 node 脚本，未提交、未加依赖）按 colour-science 的
 * `colour.matrix_RGB_to_RGB(colour.RGB_COLOURSPACES['ProPhoto RGB'], 目标色域)` 抄算，
 * 即：
 *
 *   M = M_目标RGB←XYZ · Bradford(D50 → 目标白点) · M_XYZ←ProPhotoRGB
 *       └─ XYZ_TO_TARGET ─┘   └──── 色适应 ────┘   └── PROPHOTO_TO_XYZ ──┘
 *
 * 每一步都按 colour-science 的定义：
 * - `M_XYZ←ProPhotoRGB = normalised_primary_matrix(ProPhoto primaries, D50)`
 *   （ProPhoto/ROMM 原色 (0.7347,0.2653) (0.1596,0.8404) (0.0366,0.0001)，白点 D50 (0.3457,0.3585)）
 *   数值为
 *   `[[0.797760489672, 0.135185837176, 0.031349349582],
 *     [0.288071128229, 0.711843217810, 0.000085653961],
 *     [0.000000000000, 0.000000000000, 0.825104602510]]`
 * - 色适应用 colour-science 的默认 Bradford 矩阵，D50 与目标白点都先转成 XYZ（Y = 1）再缩放。
 * - `M_目标RGB←XYZ = inv(normalised_primary_matrix(目标原色, 目标白点))`。
 *
 * 被本工程用到的 14 个目标色域的白点恰好都是 D65，但色适应这一步不能省：
 * 不做色适应的“朴素”矩阵会把中性灰 [1,1,1] 映射到偏离 [1,1,1] 的位置
 * （例如 ARRI Wide Gamut 3 会得到 [1.0776, 0.9398, 0.7674]，白平衡直接偏掉）。
 *
 * 校验数字（tests 里同样跑了一遍）：
 * - `M · [1,1,1]` 与 `[1,1,1]` 的最大偏差 6.7e-16；
 * - 14 个矩阵的行列式全部为正，最小 0.641410545805（REDWideGamutRGB）。
 */

/** 14 种 Log 色彩空间的 id 联合 */
export type LogSpaceId =
  | 'f-log'
  | 'f-log2'
  | 'f-log2c'
  | 'v-log'
  | 'n-log'
  | 'l-log'
  | 'canon-log-2'
  | 'canon-log-3'
  | 's-log3'
  | 's-log3-cine'
  | 'arri-logc3'
  | 'arri-logc4'
  | 'log3g10'
  | 'd-log';

export interface LogSpace {
  id: LogSpaceId;
  /** 显示名，与 Raw-Alchemy 的 `--log-space` 取值一致 */
  name: string;
  /** 一句话中文描述（相机/厂商 + 色域） */
  description: string;
  /** 目标色域名，如 'S-Gamut3.Cine' */
  gamut: string;
  /** 白点，如 'D65' / 'D60' */
  whitepoint: string;
}

/** 每个 Log 色域的白点与原色坐标（CIE xy），供测试核对矩阵正确性 */
export interface GamutPrimaries {
  whitepoint: readonly [number, number];
  red: readonly [number, number];
  green: readonly [number, number];
  blue: readonly [number, number];
}

/** D65 白点（CIE 1931 2° 标准观察者，colour-science `CCS_ILLUMINANTS['D65']`） */
const WHITEPOINT_D65: readonly [number, number] = [0.3127, 0.329];

/**
 * ITU-R BT.2020 原色。Fujifilm F-Gamut、Nikon N-Gamut、Leica L-Log 用的都是它，
 * colour-science 里这几个数据集直接 `PRIMARIES_* = PRIMARIES_BT2020`。
 */
const PRIMARIES_BT2020 = {
  whitepoint: WHITEPOINT_D65,
  red: [0.708, 0.292],
  green: [0.17, 0.797],
  blue: [0.131, 0.046],
} as const satisfies GamutPrimaries;

/** Canon Cinema Gamut（C-Log2 / C-Log3 的目标色域） */
const PRIMARIES_CINEMA_GAMUT = {
  whitepoint: WHITEPOINT_D65,
  red: [0.74, 0.27],
  green: [0.17, 1.14],
  blue: [0.08, -0.1],
} as const satisfies GamutPrimaries;

const PRIMARIES_F_GAMUT_C = {
  whitepoint: WHITEPOINT_D65,
  red: [0.7347, 0.2653],
  green: [0.0263, 0.9737],
  blue: [0.1173, -0.0224],
} as const satisfies GamutPrimaries;

const PRIMARIES_V_GAMUT = {
  whitepoint: WHITEPOINT_D65,
  red: [0.73, 0.28],
  green: [0.165, 0.84],
  blue: [0.1, -0.03],
} as const satisfies GamutPrimaries;

const PRIMARIES_S_GAMUT3 = {
  whitepoint: WHITEPOINT_D65,
  red: [0.73, 0.28],
  green: [0.14, 0.855],
  blue: [0.1, -0.05],
} as const satisfies GamutPrimaries;

const PRIMARIES_S_GAMUT3_CINE = {
  whitepoint: WHITEPOINT_D65,
  red: [0.766, 0.275],
  green: [0.225, 0.8],
  blue: [0.089, -0.087],
} as const satisfies GamutPrimaries;

const PRIMARIES_ARRI_WIDE_GAMUT_3 = {
  whitepoint: WHITEPOINT_D65,
  red: [0.684, 0.313],
  green: [0.221, 0.848],
  blue: [0.0861, -0.102],
} as const satisfies GamutPrimaries;

const PRIMARIES_ARRI_WIDE_GAMUT_4 = {
  whitepoint: WHITEPOINT_D65,
  red: [0.7347, 0.2653],
  green: [0.1424, 0.8576],
  blue: [0.0991, -0.0308],
} as const satisfies GamutPrimaries;

const PRIMARIES_RED_WIDE_GAMUT_RGB = {
  whitepoint: WHITEPOINT_D65,
  red: [0.780308, 0.304253],
  green: [0.121595, 1.493994],
  blue: [0.095612, -0.084589],
} as const satisfies GamutPrimaries;

const PRIMARIES_DJI_D_GAMUT = {
  whitepoint: WHITEPOINT_D65,
  red: [0.71, 0.31],
  green: [0.21, 0.88],
  blue: [0.09, -0.08],
} as const satisfies GamutPrimaries;

/**
 * 每个 Log 色域的白点与原色坐标（CIE xy），来源见 research/log-color-spaces.md，
 * 全部取自 colour-science `colour/models/rgb/datasets/*.py`。
 */
export const LOG_GAMUT_PRIMARIES: readonly GamutPrimaries[] = [
  PRIMARIES_BT2020, // 0 F-Log     → F-Gamut
  PRIMARIES_BT2020, // 1 F-Log2    → F-Gamut
  PRIMARIES_F_GAMUT_C, // 2 F-Log2C   → F-Gamut C
  PRIMARIES_V_GAMUT, // 3 V-Log     → V-Gamut
  PRIMARIES_BT2020, // 4 N-Log     → N-Gamut
  PRIMARIES_BT2020, // 5 L-Log     → ITU-R BT.2020
  PRIMARIES_CINEMA_GAMUT, // 6 Canon Log 2 → Cinema Gamut
  PRIMARIES_CINEMA_GAMUT, // 7 Canon Log 3 → Cinema Gamut
  PRIMARIES_S_GAMUT3, // 8 S-Log3    → S-Gamut3
  PRIMARIES_S_GAMUT3_CINE, // 9 S-Log3.Cine → S-Gamut3.Cine
  PRIMARIES_ARRI_WIDE_GAMUT_3, // 10 Arri LogC3 → ARRI Wide Gamut 3
  PRIMARIES_ARRI_WIDE_GAMUT_4, // 11 Arri LogC4 → ARRI Wide Gamut 4
  PRIMARIES_RED_WIDE_GAMUT_RGB, // 12 Log3G10 → REDWideGamutRGB
  PRIMARIES_DJI_D_GAMUT, // 13 D-Log    → DJI D-Gamut
];

/**
 * ProPhoto RGB (linear, D50) → 各 Log 色域 (linear) 的 3×3 矩阵，行主序，长度 9。
 *
 * 数值由仓外脚本按文件头的公式算出，`%.12f` 硬编码；`LOG_GAMUT_PRIMARIES` 是这些
 * 数字的唯一真值来源，log-gamut.test.ts 会用原色重算一遍矩阵与这里逐项比对。
 */
export const LOG_GAMUT_MATRICES: readonly (readonly number[])[] = [
  // 0 F-Log → F-Gamut (D65)
  [
    1.200650647574, -0.057563718838, -0.143086928735, -0.069943445122, 1.080627953098,
    -0.010684507976, 0.005541523587, -0.04078256067, 1.035241037083,
  ],
  // 1 F-Log2 → F-Gamut (D65)
  [
    1.200650647574, -0.057563718838, -0.143086928735, -0.069943445122, 1.080627953098,
    -0.010684507976, 0.005541523587, -0.04078256067, 1.035241037083,
  ],
  // 2 F-Log2C → F-Gamut C (D65)
  [
    0.956818862719, 0.121668234424, -0.078487097144, -0.005775201418, 0.916680029976,
    0.089095171442, 0.003595743986, -0.011875908921, 1.008280164936,
  ],
  // 3 V-Log → V-Gamut (D65)
  [
    1.115886234136, -0.042519515702, -0.073366718435, -0.028545730849, 0.936794431662,
    0.091751299188, 0.012850118131, -0.008167400077, 0.995317281946,
  ],
  // 4 N-Log → N-Gamut (D65)
  [
    1.200650647574, -0.057563718838, -0.143086928735, -0.069943445122, 1.080627953098,
    -0.010684507976, 0.005541523587, -0.04078256067, 1.035241037083,
  ],
  // 5 L-Log → ITU-R BT.2020 (D65)
  [
    1.200650647574, -0.057563718838, -0.143086928735, -0.069943445122, 1.080627953098,
    -0.010684507976, 0.005541523587, -0.04078256067, 1.035241037083,
  ],
  // 6 Canon Log 2 → Cinema Gamut (D65)
  [
    1.055123383446, -0.016792360422, -0.038331023025, -0.007040887371, 0.848508418987,
    0.158532468385, 0.00933232849, 0.140472146284, 0.850195525226,
  ],
  // 7 Canon Log 3 → Cinema Gamut (D65)
  [
    1.055123383446, -0.016792360422, -0.038331023025, -0.007040887371, 0.848508418987,
    0.158532468385, 0.00933232849, 0.140472146284, 0.850195525226,
  ],
  // 8 S-Log3 → S-Gamut3 (D65)
  [
    1.072338072337, -0.003653422976, -0.068684649361, -0.027338460272, 0.909235518285,
    0.118102941987, 0.013179036867, -0.015675777338, 1.00249674047,
  ],
  // 9 S-Log3.Cine → S-Gamut3.Cine (D65)
  [
    1.253442207447, -0.16524547271, -0.088196734737, 0.002921081021, 0.848657825139, 0.148421093841,
    0.038466353791, 0.004561546575, 0.956972099633,
  ],
  // 10 Arri LogC3 → ARRI Wide Gamut 3 (D65)
  [
    1.221534850785, -0.140812848329, -0.080722002456, -0.108018988473, 0.923956995792,
    0.184061992681, -0.005846899876, 0.042831443272, 0.963015456604,
  ],
  // 11 Arri LogC4 → ARRI Wide Gamut 4 (D65)
  [
    1.07243958208, -0.006899842767, -0.065539739313, -0.005776322105, 0.916791077533,
    0.088985244573, 0.003595743986, -0.011875908921, 1.008280164936,
  ],
  // 12 Log3G10 → REDWideGamutRGB (D65)
  [
    1.019268258924, 0.034269168321, -0.053537427245, -0.020434054414, 0.866164422645,
    0.154269631769, 0.051471173688, 0.191713519893, 0.756815306419,
  ],
  // 13 D-Log → DJI D-Gamut (D65)
  [
    1.187455086484, -0.111519191216, -0.075935895268, -0.08142666421, 0.924360424551,
    0.157066239658, 0.01581280262, 0.052001790641, 0.932185406738,
  ],
];

/** 14 种 Log 色彩空间，顺序 = uniform 取值 */
export const LOG_SPACES: readonly LogSpace[] = [
  {
    id: 'f-log',
    name: 'F-Log',
    description: '富士 F-Log 曲线，F-Gamut 色域（与 BT.2020 原色相同）',
    gamut: 'F-Gamut',
    whitepoint: 'D65',
  },
  {
    id: 'f-log2',
    name: 'F-Log2',
    description: '富士 F-Log2 曲线，F-Gamut 色域',
    gamut: 'F-Gamut',
    whitepoint: 'D65',
  },
  {
    id: 'f-log2c',
    name: 'F-Log2C',
    description: '富士 F-Log2C：与 F-Log2 同曲线，改用更窄的 F-Gamut C 色域',
    gamut: 'F-Gamut C',
    whitepoint: 'D65',
  },
  {
    id: 'v-log',
    name: 'V-Log',
    description: '松下 V-Log 曲线，V-Gamut 色域',
    gamut: 'V-Gamut',
    whitepoint: 'D65',
  },
  {
    id: 'n-log',
    name: 'N-Log',
    description: '尼康 N-Log 曲线，N-Gamut 色域（与 BT.2020 原色相同）',
    gamut: 'N-Gamut',
    whitepoint: 'D65',
  },
  {
    id: 'l-log',
    name: 'L-Log',
    description: '徕卡 L-Log 曲线，ITU-R BT.2020 色域',
    gamut: 'ITU-R BT.2020',
    whitepoint: 'D65',
  },
  {
    id: 'canon-log-2',
    name: 'Canon Log 2',
    description: '佳能 Canon Log 2（v1.2）曲线，Cinema Gamut 色域',
    gamut: 'Cinema Gamut',
    whitepoint: 'D65',
  },
  {
    id: 'canon-log-3',
    name: 'Canon Log 3',
    description: '佳能 Canon Log 3（v1.2）曲线，Cinema Gamut 色域',
    gamut: 'Cinema Gamut',
    whitepoint: 'D65',
  },
  {
    id: 's-log3',
    name: 'S-Log3',
    description: '索尼 S-Log3 曲线，S-Gamut3 色域',
    gamut: 'S-Gamut3',
    whitepoint: 'D65',
  },
  {
    id: 's-log3-cine',
    name: 'S-Log3.Cine',
    description: '索尼 S-Log3.Cine：与 S-Log3 同曲线，改用更窄的 S-Gamut3.Cine 色域',
    gamut: 'S-Gamut3.Cine',
    whitepoint: 'D65',
  },
  {
    id: 'arri-logc3',
    name: 'Arri LogC3',
    description: 'ARRI LogC3（EI 800，Linear Scene Exposure Factor），ARRI Wide Gamut 3 色域',
    gamut: 'ARRI Wide Gamut 3',
    whitepoint: 'D65',
  },
  {
    id: 'arri-logc4',
    name: 'Arri LogC4',
    description: 'ARRI LogC4 曲线，ARRI Wide Gamut 4 色域',
    gamut: 'ARRI Wide Gamut 4',
    whitepoint: 'D65',
  },
  {
    id: 'log3g10',
    name: 'Log3G10',
    description: 'RED Log3G10（v3 白皮书曲线），REDWideGamutRGB 色域',
    gamut: 'REDWideGamutRGB',
    whitepoint: 'D65',
  },
  {
    id: 'd-log',
    name: 'D-Log',
    description: '大疆 D-Log 曲线，DJI D-Gamut 色域',
    gamut: 'DJI D-Gamut',
    whitepoint: 'D65',
  },
];

export function findLogSpace(id: string): LogSpace | undefined {
  return LOG_SPACES.find((space) => space.id === id);
}

/** Log 空间在数组里的下标；找不到返回 -1（-1 表示关闭 Log 模式） */
export function logSpaceIndex(id: string | null | undefined): number {
  if (id === null || id === undefined) return -1;
  return LOG_SPACES.findIndex((space) => space.id === id);
}
