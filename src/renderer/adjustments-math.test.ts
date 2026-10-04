import { describe, expect, it } from 'vitest';
import { generateLut3D } from '../lut/generate';
import { DEFAULT_ADJUSTMENTS } from '../types/adjustments';
import {
  applyAdjustments,
  applyContrast,
  applyExposure,
  applyHighlightsShadows,
  applyLut,
  applySaturation,
  applyWhiteBalance,
  linearToSrgb,
  luminance,
  MID_GRAY,
  sampleLut3D,
  srgbToLinear,
  type Rgb,
} from './adjustments-math';

/** 逐通道比较，浮点误差容忍 */
function expectRgb(actual: Rgb, expected: Rgb, precision = 6): void {
  expect(actual[0]).toBeCloseTo(expected[0], precision);
  expect(actual[1]).toBeCloseTo(expected[1], precision);
  expect(actual[2]).toBeCloseTo(expected[2], precision);
}

describe('sRGB 传递函数', () => {
  it('keeps the endpoints', () => {
    expect(srgbToLinear(0)).toBe(0);
    expect(srgbToLinear(1)).toBeCloseTo(1, 10);
    expect(linearToSrgb(0)).toBe(0);
    expect(linearToSrgb(1)).toBeCloseTo(1, 10);
  });

  it('matches the known mid-gray transfer value', () => {
    // sRGB 0.5 → 线性约 0.2140
    expect(srgbToLinear(0.5)).toBeCloseTo(0.2140, 4);
  });

  it('round-trips', () => {
    for (const value of [0, 0.01, 0.05, 0.2, 0.5, 0.8, 1]) {
      expect(linearToSrgb(srgbToLinear(value))).toBeCloseTo(value, 10);
    }
  });
});

describe('luminance', () => {
  it('uses Rec.709 weights and sums to 1', () => {
    expect(luminance([1, 1, 1])).toBeCloseTo(1, 10);
    expect(luminance([1, 0, 0])).toBeCloseTo(0.2126, 10);
  });
});

describe('applyWhiteBalance', () => {
  it('is a no-op at neutral', () => {
    expectRgb(applyWhiteBalance([0.4, 0.4, 0.4], 0, 0), [0.4, 0.4, 0.4]);
  });

  it('warms by raising red and lowering blue', () => {
    const result = applyWhiteBalance([0.5, 0.5, 0.5], 1, 0);
    expect(result[0]).toBeGreaterThan(0.5);
    expect(result[1]).toBeCloseTo(0.5, 10);
    expect(result[2]).toBeLessThan(0.5);
  });

  it('cools by lowering red and raising blue', () => {
    const result = applyWhiteBalance([0.5, 0.5, 0.5], -1, 0);
    expect(result[0]).toBeLessThan(0.5);
    expect(result[2]).toBeGreaterThan(0.5);
  });

  it('pushes tint toward magenta and away from green', () => {
    const result = applyWhiteBalance([0.5, 0.5, 0.5], 0, 1);
    expect(result[0]).toBeGreaterThan(0.5);
    expect(result[1]).toBeLessThan(0.5);
    expect(result[2]).toBeGreaterThan(0.5);
  });
});

describe('applyExposure', () => {
  it('is a no-op at 0 EV', () => {
    expectRgb(applyExposure([0.2, 0.4, 0.6], 0), [0.2, 0.4, 0.6]);
  });

  it('doubles linear brightness per stop', () => {
    expectRgb(applyExposure([0.1, 0.2, 0.3], 1), [0.2, 0.4, 0.6]);
    expectRgb(applyExposure([0.2, 0.4, 0.6], -1), [0.1, 0.2, 0.3]);
  });

  it('applies two stops as 4x', () => {
    expectRgb(applyExposure([0.1, 0.1, 0.1], 2), [0.4, 0.4, 0.4]);
  });
});

describe('applyContrast', () => {
  it('is a no-op at 0', () => {
    expectRgb(applyContrast([0.2, 0.5, 0.8], 0), [0.2, 0.5, 0.8]);
  });

  it('leaves the pivot untouched', () => {
    expectRgb(applyContrast([MID_GRAY, MID_GRAY, MID_GRAY], 1), [MID_GRAY, MID_GRAY, MID_GRAY]);
  });

  it('pushes values away from the pivot when increased', () => {
    const result = applyContrast([0.1, 0.18, 0.9], 0.5);
    expect(result[0]).toBeLessThan(0.1);
    expect(result[1]).toBeCloseTo(MID_GRAY, 10);
    expect(result[2]).toBeGreaterThan(0.9);
  });

  it('pulls values toward the pivot when decreased', () => {
    const result = applyContrast([0.1, 0.5, 0.9], -0.5);
    expect(result[0]).toBeGreaterThan(0.1);
    expect(result[2]).toBeLessThan(0.9);
  });
});

describe('applyHighlightsShadows', () => {
  it('is a no-op at 0/0', () => {
    expectRgb(applyHighlightsShadows([0.1, 0.5, 0.9], 0, 0), [0.1, 0.5, 0.9]);
  });

  it('affects bright pixels more than dark ones when lifting highlights', () => {
    const bright = applyHighlightsShadows([0.9, 0.9, 0.9], 1, 0);
    const dark = applyHighlightsShadows([0.05, 0.05, 0.05], 1, 0);

    const brightGain = bright[0] / 0.9;
    const darkGain = dark[0] / 0.05;
    expect(brightGain).toBeGreaterThan(darkGain);
  });

  it('affects dark pixels more than bright ones when lifting shadows', () => {
    const dark = applyHighlightsShadows([0.05, 0.05, 0.05], 0, 1);
    const bright = applyHighlightsShadows([0.9, 0.9, 0.9], 0, 1);

    const darkGain = dark[0] / 0.05;
    const brightGain = bright[0] / 0.9;
    expect(darkGain).toBeGreaterThan(brightGain);
  });

  it('leaves pure mid-gray roughly neutral for highlights', () => {
    const result = applyHighlightsShadows([0.18, 0.18, 0.18], 1, 0);
    expect(result[0]).toBeCloseTo(0.18, 6);
  });
});

describe('applySaturation', () => {
  it('is a no-op at 0', () => {
    expectRgb(applySaturation([0.2, 0.5, 0.8], 0), [0.2, 0.5, 0.8]);
  });

  it('fully desaturates at -1', () => {
    const result = applySaturation([0.2, 0.5, 0.8], -1);
    const luma = luminance([0.2, 0.5, 0.8]);

    expectRgb(result, [luma, luma, luma], 10);
  });

  it('increases channel spread when boosted', () => {
    const original: Rgb = [0.2, 0.5, 0.8];
    const result = applySaturation(original, 0.5);

    expect(result[2] - result[0]).toBeGreaterThan(original[2] - original[0]);
  });
});

describe('sampleLut3D', () => {
  it('reproduces the input for an identity LUT', () => {
    const identity = generateLut3D(33, (rgb) => rgb);

    for (const sample of [
      [0, 0, 0],
      [1, 1, 1],
      [0.2, 0.5, 0.8],
      [0.37, 0.11, 0.93],
    ] as Rgb[]) {
      // 恒等是线性函数，三线性插值可以精确复现
      expectRgb(sampleLut3D(identity, sample), sample, 5);
    }
  });

  it('hits grid points exactly', () => {
    const lut = generateLut3D(3, (rgb) => [rgb[2], rgb[0], rgb[1]]);

    expectRgb(sampleLut3D(lut, [1, 0, 0.5]), [0.5, 1, 0], 6);
  });

  it('weights the eight corners by trilinear interpolation', () => {
    // 只有 (1,1,1) 这个格点是 1，其余为 0
    const lut = generateLut3D(2, (rgb) =>
      rgb[0] === 1 && rgb[1] === 1 && rgb[2] === 1 ? [1, 1, 1] : [0, 0, 0],
    );

    // 立方体中心：三线性权重为 0.5³ = 0.125
    expectRgb(sampleLut3D(lut, [0.5, 0.5, 0.5]), [0.125, 0.125, 0.125], 6);
  });

  it('clamps input outside [0, 1]', () => {
    const identity = generateLut3D(5, (rgb) => rgb);

    expectRgb(sampleLut3D(identity, [-1, 2, 0.5]), [0, 1, 0.5], 6);
  });
});

describe('applyLut', () => {
  const inverted = generateLut3D(9, (rgb) => [1 - rgb[0], 1 - rgb[1], 1 - rgb[2]]);
  const source: Rgb = [0.2, 0.5, 0.8];

  it('passes through when there is no LUT', () => {
    expectRgb(applyLut(source, null, 1), source);
  });

  it('passes through at zero strength', () => {
    expectRgb(applyLut(source, inverted, 0), source);
  });

  it('applies fully at strength 1', () => {
    expectRgb(applyLut(source, inverted, 1), [0.8, 0.5, 0.2], 5);
  });

  it('blends at intermediate strength', () => {
    expectRgb(applyLut(source, inverted, 0.5), [0.5, 0.5, 0.5], 5);
  });

  it('clamps the strength above 1', () => {
    expectRgb(applyLut(source, inverted, 5), [0.8, 0.5, 0.2], 5);
  });
});

describe('applyAdjustments', () => {
  const samples: Rgb[] = [
    [0, 0, 0],
    [1, 1, 1],
    [0.18, 0.18, 0.18],
    [0.2, 0.5, 0.8],
    [0.9, 0.1, 0.4],
    [0.5, 0.5, 0.5],
  ];

  it('leaves the image untouched at default settings', () => {
    for (const sample of samples) {
      expectRgb(applyAdjustments(sample, DEFAULT_ADJUSTMENTS), sample, 5);
    }
  });

  it('brightens the whole image with positive exposure', () => {
    const darker: Rgb = [0.2, 0.3, 0.4];
    const brighter = applyAdjustments(darker, { ...DEFAULT_ADJUSTMENTS, exposure: 1 });

    expect(luminance(brighter)).toBeGreaterThan(luminance(darker));
  });

  it('produces grayscale at saturation -1', () => {
    const result = applyAdjustments([0.2, 0.5, 0.8], {
      ...DEFAULT_ADJUSTMENTS,
      saturation: -1,
    });

    expect(result[0]).toBeCloseTo(result[1], 6);
    expect(result[1]).toBeCloseTo(result[2], 6);
  });

  it('always returns values inside [0, 1]', () => {
    const extreme: Rgb[] = [
      [1, 1, 1],
      [0, 0, 0],
      [0.99, 0.5, 0.01],
    ];
    const settings = {
      ...DEFAULT_ADJUSTMENTS,
      exposure: 3,
      contrast: 1,
      highlights: 1,
      shadows: 1,
      saturation: 1,
      temperature: 1,
      tint: 1,
    };

    for (const sample of extreme) {
      for (const channel of applyAdjustments(sample, settings)) {
        expect(channel).toBeGreaterThanOrEqual(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });

  it('handles out-of-range input by clamping first', () => {
    expectRgb(
      applyAdjustments([-0.5, 1.5, 0.5], DEFAULT_ADJUSTMENTS),
      applyAdjustments([0, 1, 0.5], DEFAULT_ADJUSTMENTS),
    );
  });

  describe('配合 3D LUT', () => {
    const identityLut = generateLut3D(33, (rgb) => rgb);

    it('leaves the image untouched with an identity LUT', () => {
      for (const sample of samples) {
        expectRgb(applyAdjustments(sample, DEFAULT_ADJUSTMENTS, identityLut), sample, 5);
      }
    });

    it('does not apply the LUT when the strength is 0', () => {
      const inverted = generateLut3D(9, (rgb) => [1 - rgb[0], 1 - rgb[1], 1 - rgb[2]]);
      const settings = { ...DEFAULT_ADJUSTMENTS, lutStrength: 0 };

      for (const sample of samples) {
        expectRgb(applyAdjustments(sample, settings, inverted), sample, 5);
      }
    });

    it('fully applies the LUT at strength 1', () => {
      const inverted = generateLut3D(33, (rgb) => [1 - rgb[0], 1 - rgb[1], 1 - rgb[2]]);
      const source: Rgb = [0.2, 0.5, 0.8];
      const result = applyAdjustments(source, DEFAULT_ADJUSTMENTS, inverted);

      // LUT 作用在显示空间，所以结果就是 sRGB 意义的取反
      expectRgb(result, [0.8, 0.5, 0.2], 4);
    });

    it('blends toward the LUT result at intermediate strength', () => {
      const inverted = generateLut3D(33, (rgb) => [1 - rgb[0], 1 - rgb[1], 1 - rgb[2]]);
      const source: Rgb = [0.2, 0.5, 0.8];
      const half = applyAdjustments(source, { ...DEFAULT_ADJUSTMENTS, lutStrength: 0.5 }, inverted);

      expectRgb(half, [0.5, 0.5, 0.5], 4);
    });
  });
});
