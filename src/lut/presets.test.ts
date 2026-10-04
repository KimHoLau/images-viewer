import { beforeEach, describe, expect, it } from 'vitest';
import { generateLut3D } from './generate';
import {
  clearPresetLutCache,
  getPresetById,
  getPresetLut,
  LUT_PRESETS,
  resolveActiveLut,
} from './presets';
import { PRESET_LUT_SIZE } from './types';

describe('LUT_PRESETS', () => {
  it('has unique ids', () => {
    const ids = LUT_PRESETS.map((preset) => preset.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('gives every preset a name and a description', () => {
    for (const preset of LUT_PRESETS) {
      expect(preset.name.length).toBeGreaterThan(0);
      expect(preset.description.length).toBeGreaterThan(0);
    }
  });

  it('ships a useful number of presets', () => {
    expect(LUT_PRESETS.length).toBeGreaterThanOrEqual(5);
  });

  it('produces in-range LUT data for every preset', () => {
    for (const preset of LUT_PRESETS) {
      const lut = generateLut3D(5, preset.sampler);
      for (const value of lut.data) {
        expect(value, `${preset.id} 有越界值`).toBeGreaterThanOrEqual(0);
        expect(value).toBeLessThanOrEqual(1);
      }
    }
  });

  it('leaves black and white roughly at the ends of the range', () => {
    for (const preset of LUT_PRESETS) {
      const black = preset.sampler([0, 0, 0]);
      const white = preset.sampler([1, 1, 1]);

      for (const channel of black) expect(channel).toBeLessThan(0.2);
      for (const channel of white) expect(channel).toBeGreaterThan(0.8);
    }
  });

  describe('风格特征', () => {
    it('黑白预设让三个通道相等', () => {
      const mono = getPresetById('mono')!;
      for (const sample of [
        [0, 0, 0],
        [0.9, 0.3, 0.1],
        [0.1, 0.6, 0.85],
        [1, 1, 1],
      ] as const) {
        const [r, g, b] = mono.sampler(sample);
        expect(r).toBeCloseTo(g, 6);
        expect(g).toBeCloseTo(b, 6);
      }
    });

    it('暖调预设抬高红、压低蓝', () => {
      const warm = getPresetById('warm-film')!;
      const [r, , b] = warm.sampler([0.5, 0.5, 0.5]);
      expect(r).toBeGreaterThan(b);
    });

    it('冷调预设的暗部偏青、亮部偏橙', () => {
      const cool = getPresetById('cool-cinema')!;
      const shadow = cool.sampler([0.05, 0.05, 0.05]);
      const highlight = cool.sampler([0.9, 0.9, 0.9]);

      // 暗部蓝多于红，亮部红多于蓝
      expect(shadow[2]).toBeGreaterThan(shadow[0]);
      expect(highlight[0]).toBeGreaterThan(highlight[2]);
    });

    it('高对比预设拉开通道差', () => {
      const contrast = getPresetById('high-contrast')!;
      const source = [0.35, 0.5, 0.65] as const;
      const result = contrast.sampler(source);
      expect(result[2] - result[0]).toBeGreaterThan(source[2] - source[0]);
    });

    it('鲜艳预设比原图更饱和', () => {
      const vivid = getPresetById('vivid')!;
      const source = [0.4, 0.5, 0.6] as const;
      const result = vivid.sampler(source);
      expect(result[2] - result[0]).toBeGreaterThan(source[2] - source[0]);
    });

    it('褪色预设抬起黑场', () => {
      const faded = getPresetById('faded')!;
      const result = faded.sampler([0, 0, 0]);
      for (const channel of result) expect(channel).toBeGreaterThan(0.02);
    });
  });
});

describe('getPresetLut', () => {
  beforeEach(() => {
    clearPresetLutCache();
  });

  it('returns null for null or an unknown id', () => {
    expect(getPresetLut(null)).toBeNull();
    expect(getPresetLut('不存在的预设')).toBeNull();
  });

  it('builds a preset-sized LUT', () => {
    const lut = getPresetLut('mono')!;
    expect(lut.size).toBe(PRESET_LUT_SIZE);
    expect(lut.data).toHaveLength(PRESET_LUT_SIZE ** 3 * 3);
  });

  it('caches by preset id', () => {
    const first = getPresetLut('vivid');
    const second = getPresetLut('vivid');
    expect(second).toBe(first);
  });

  it('carries the preset name', () => {
    expect(getPresetLut('faded')!.title).toBe('褪色');
  });
});

describe('resolveActiveLut', () => {
  it('prefers an imported LUT over the preset', () => {
    const custom = generateLut3D(2, (rgb) => rgb, 'custom');
    expect(resolveActiveLut(custom, 'mono')).toBe(custom);
  });

  it('falls back to the preset', () => {
    expect(resolveActiveLut(null, 'mono')!.title).toBe('黑白');
  });

  it('returns null when neither is set', () => {
    expect(resolveActiveLut(null, null)).toBeNull();
  });
});
