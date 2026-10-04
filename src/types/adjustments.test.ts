import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_DEFINITIONS,
  DEFAULT_ADJUSTMENTS,
  clampAdjustment,
  isDefaultAdjustments,
} from './adjustments';

describe('ADJUSTMENT_DEFINITIONS', () => {
  it('covers every adjustment key exactly once', () => {
    const keys = ADJUSTMENT_DEFINITIONS.map((definition) => definition.key);
    expect(new Set(keys).size).toBe(keys.length);
    expect(keys.sort()).toEqual(Object.keys(DEFAULT_ADJUSTMENTS).sort());
  });

  it('keeps defaults inside their own range', () => {
    for (const definition of ADJUSTMENT_DEFINITIONS) {
      expect(definition.defaultValue).toBeGreaterThanOrEqual(definition.min);
      expect(definition.defaultValue).toBeLessThanOrEqual(definition.max);
      expect(definition.max).toBeGreaterThan(definition.min);
      expect(definition.step).toBeGreaterThan(0);
    }
  });

  it('matches DEFAULT_ADJUSTMENTS', () => {
    for (const definition of ADJUSTMENT_DEFINITIONS) {
      expect(DEFAULT_ADJUSTMENTS[definition.key]).toBe(definition.defaultValue);
    }
  });
});

describe('clampAdjustment', () => {
  it('clamps above the maximum', () => {
    expect(clampAdjustment('exposure', 99)).toBe(3);
  });

  it('clamps below the minimum', () => {
    expect(clampAdjustment('exposure', -99)).toBe(-3);
    expect(clampAdjustment('lutStrength', -1)).toBe(0);
  });

  it('passes through in-range values', () => {
    expect(clampAdjustment('contrast', 0.42)).toBe(0.42);
  });

  it('falls back to the default for non-finite values', () => {
    expect(clampAdjustment('contrast', Number.NaN)).toBe(0);
    expect(clampAdjustment('contrast', Number.POSITIVE_INFINITY)).toBe(0);
  });
});

describe('isDefaultAdjustments', () => {
  it('is true for the defaults', () => {
    expect(isDefaultAdjustments({ ...DEFAULT_ADJUSTMENTS })).toBe(true);
  });

  it('is false once any value changes', () => {
    expect(isDefaultAdjustments({ ...DEFAULT_ADJUSTMENTS, exposure: 0.5 })).toBe(false);
    expect(isDefaultAdjustments({ ...DEFAULT_ADJUSTMENTS, lutStrength: 0.5 })).toBe(false);
  });
});
