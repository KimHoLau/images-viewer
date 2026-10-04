import { describe, expect, it } from 'vitest';
import { formatAperture, formatFocalLength, formatIso, formatShutter } from './raw-format';

describe('formatShutter', () => {
  it('formats fast exposures as fractions', () => {
    expect(formatShutter(1 / 200)).toBe('1/200');
    expect(formatShutter(1 / 60)).toBe('1/60');
    expect(formatShutter(0.005)).toBe('1/200');
  });

  it('formats one second and above as seconds', () => {
    expect(formatShutter(1)).toBe('1s');
    expect(formatShutter(2)).toBe('2s');
    expect(formatShutter(2.5)).toBe('2.5s');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatShutter(0)).toBe('');
    expect(formatShutter(-1)).toBe('');
    expect(formatShutter(Number.NaN)).toBe('');
  });
});

describe('formatAperture', () => {
  it('prefixes with f/ and drops a trailing .0', () => {
    expect(formatAperture(2.8)).toBe('f/2.8');
    expect(formatAperture(11)).toBe('f/11');
    expect(formatAperture(1.4)).toBe('f/1.4');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatAperture(0)).toBe('');
    expect(formatAperture(Number.NaN)).toBe('');
  });
});

describe('formatFocalLength', () => {
  it('appends mm', () => {
    expect(formatFocalLength(35)).toBe('35mm');
    expect(formatFocalLength(34.6)).toBe('35mm');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatFocalLength(0)).toBe('');
  });
});

describe('formatIso', () => {
  it('prefixes with ISO', () => {
    expect(formatIso(400)).toBe('ISO 400');
  });

  it('returns an empty string for invalid input', () => {
    expect(formatIso(0)).toBe('');
  });
});
