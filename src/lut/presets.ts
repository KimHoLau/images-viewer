import { luminance, type Rgb } from '../renderer/adjustments-math';
import { clamp01, smoothstep } from '../utils/math';
import { generateLut3D } from './generate';
import { PRESET_LUT_SIZE, type Lut3D, type LutSampler } from './types';

export interface LutPreset {
  id: string;
  name: string;
  /** 一句话说明风格，显示在预设列表里 */
  description: string;
  /** 输入输出都是 sRGB [0,1] */
  sampler: LutSampler;
}

function mapChannels(rgb: Rgb, fn: (channel: number) => number): Rgb {
  return [fn(rgb[0]), fn(rgb[1]), fn(rgb[2])];
}

function mixRgb(a: Rgb, b: Rgb, t: number): Rgb {
  const amount = clamp01(t);
  return [
    a[0] + (b[0] - a[0]) * amount,
    a[1] + (b[1] - a[1]) * amount,
    a[2] + (b[2] - a[2]) * amount,
  ];
}

/** strength 为 0 时原样返回，为 1 时完全走 S 曲线 */
function contrastCurve(channel: number, strength: number): number {
  return channel + (smoothstep(0, 1, channel) - channel) * strength;
}

/** 抬高黑场，模拟老胶片的灰雾 */
function lift(rgb: Rgb, amount: Rgb | number): Rgb {
  const [r, g, b] = typeof amount === 'number' ? [amount, amount, amount] : amount;
  return [rgb[0] + r, rgb[1] + g, rgb[2] + b];
}

/** 按通道增益（数字越大越亮） */
function gain(rgb: Rgb, factors: Rgb): Rgb {
  return [rgb[0] * factors[0], rgb[1] * factors[1], rgb[2] * factors[2]];
}

/** amount 为 1 保持原样，0 完全去色，大于 1 增艳 */
function desaturate(rgb: Rgb, amount: number): Rgb {
  const grey = luminance(rgb);
  return [
    grey + (rgb[0] - grey) * amount,
    grey + (rgb[1] - grey) * amount,
    grey + (rgb[2] - grey) * amount,
  ];
}

/** 按亮度分别给暗部与亮部染色（青橙调的基础） */
function splitTone(rgb: Rgb, shadowTint: Rgb, highlightTint: Rgb, strength: number): Rgb {
  const brightness = luminance(rgb);
  const shadowWeight = 1 - smoothstep(0, 0.5, brightness);
  const highlightWeight = smoothstep(0.5, 1, brightness);

  const shadowed = mixRgb(rgb, gain(rgb, shadowTint), shadowWeight * strength);
  return mixRgb(shadowed, gain(shadowed, highlightTint), highlightWeight * strength);
}

/**
 * 内置预设。
 *
 * 预设不打包 .cube 资源文件，而是用采样函数现烘成 33³ 的 3D LUT：
 * 体积为零、可读可测，改风格就是改一个纯函数。
 * 运算都发生在显示空间（sRGB）——.cube 这类 LUT 本来就是这么定义的。
 */
export const LUT_PRESETS: readonly LutPreset[] = [
  {
    id: 'warm-film',
    name: '暖调胶片',
    description: '偏暖、高光柔和',
    sampler: (rgb) =>
      desaturate(
        mapChannels(gain(lift(rgb, [0.02, 0.012, 0]), [1.06, 1.01, 0.93]), (channel) =>
          contrastCurve(channel, 0.28),
        ),
        0.94,
      ),
  },
  {
    id: 'cool-cinema',
    name: '冷调电影',
    description: '青调暗部 + 橙调高光',
    sampler: (rgb) =>
      desaturate(
        mapChannels(splitTone(rgb, [0.9, 1.02, 1.14], [1.12, 0.99, 0.86], 0.7), (channel) =>
          contrastCurve(channel, 0.2),
        ),
        1.05,
      ),
  },
  {
    id: 'faded',
    name: '褪色',
    description: '抬起黑场、低反差',
    sampler: (rgb) =>
      desaturate(mapChannels(lift(rgb, 0.07), (channel) => channel * 0.86 + 0.05), 0.82),
  },
  {
    id: 'mono',
    name: '黑白',
    description: 'Rec.709 去色、轻微提反差',
    sampler: (rgb) => {
      const grey = contrastCurve(luminance(rgb), 0.18);
      return [grey, grey, grey];
    },
  },
  {
    id: 'high-contrast',
    name: '高对比',
    description: '强 S 曲线',
    sampler: (rgb) => mapChannels(rgb, (channel) => contrastCurve(channel, 0.7)),
  },
  {
    id: 'vintage',
    name: '复古',
    description: '棕调、灰雾',
    sampler: (rgb) => {
      const sepia: Rgb = [
        rgb[0] * 0.393 + rgb[1] * 0.769 + rgb[2] * 0.189,
        rgb[0] * 0.349 + rgb[1] * 0.686 + rgb[2] * 0.168,
        rgb[0] * 0.272 + rgb[1] * 0.534 + rgb[2] * 0.131,
      ];
      const mixed = mixRgb(rgb, sepia, 0.78);
      return mapChannels(lift(mixed, 0.04), (channel) => contrastCurve(channel, 0.15));
    },
  },
  {
    id: 'vivid',
    name: '鲜艳',
    description: '增艳 + 提反差',
    sampler: (rgb) =>
      mapChannels(desaturate(rgb, 1.35), (channel) => contrastCurve(channel, 0.35)),
  },
] as const;

export function getPresetById(id: string): LutPreset | undefined {
  return LUT_PRESETS.find((preset) => preset.id === id);
}

const presetLutCache = new Map<string, Lut3D>();

/**
 * 取预设对应的 3D LUT，首次调用时现烘并缓存。
 * 传入未知 id 或 null 时返回 null（表示不使用 LUT）。
 */
export function getPresetLut(id: string | null): Lut3D | null {
  if (!id) return null;
  const preset = getPresetById(id);
  if (!preset) return null;

  let lut = presetLutCache.get(id);
  if (!lut) {
    lut = generateLut3D(PRESET_LUT_SIZE, preset.sampler, preset.name);
    presetLutCache.set(id, lut);
  }
  return lut;
}

/** 测试用：清掉预设缓存 */
export function clearPresetLutCache(): void {
  presetLutCache.clear();
}

/** 当前生效的 LUT：导入的 LUT 优先，否则查预设 */
export function resolveActiveLut(
  customLut: Lut3D | null,
  presetId: string | null,
): Lut3D | null {
  if (customLut) return customLut;
  return getPresetLut(presetId);
}
