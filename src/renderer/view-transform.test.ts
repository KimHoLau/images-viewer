import { describe, expect, it } from 'vitest';
import {
  clampZoom,
  computeFitTransform,
  toClipPoint,
  toClipQuad,
  MAX_ZOOM,
  MIN_ZOOM,
} from './view-transform';

describe('computeFitTransform', () => {
  it('centers a landscape image in a wider viewport', () => {
    const result = computeFitTransform({ width: 1000, height: 500 }, { width: 800, height: 800 });

    expect(result.width).toBe(800);
    expect(result.height).toBe(400);
    expect(result.x).toBe(0);
    expect(result.y).toBe(200);
  });

  it('centers a portrait image in a wider viewport', () => {
    const result = computeFitTransform({ width: 500, height: 1000 }, { width: 800, height: 400 });

    expect(result.height).toBe(400);
    expect(result.width).toBe(200);
    expect(result.x).toBe(300);
    expect(result.y).toBe(0);
  });

  it('preserves aspect ratio', () => {
    const result = computeFitTransform({ width: 6000, height: 4000 }, { width: 1000, height: 1000 });
    expect(result.width / result.height).toBeCloseTo(1.5, 5);
  });

  it('applies zoom on top of the fit scale', () => {
    const fit = computeFitTransform({ width: 1000, height: 500 }, { width: 800, height: 800 });
    const zoomed = computeFitTransform({ width: 1000, height: 500 }, { width: 800, height: 800 }, 2);

    expect(zoomed.width).toBe(fit.width * 2);
    expect(zoomed.height).toBe(fit.height * 2);
    // 放大后仍然居中
    expect(zoomed.x).toBe((800 - zoomed.width) / 2);
  });

  it('offsets by pan', () => {
    // 100x50 的图放进 200x200 视口：按宽度撑满，高度 100，垂直居中在 y=50
    const result = computeFitTransform(
      { width: 100, height: 50 },
      { width: 200, height: 200 },
      1,
      { x: 25, y: -10 },
    );

    expect(result.x).toBe(0 + 25);
    expect(result.y).toBe(50 - 10);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeFitTransform({ width: 0, height: 10 }, { width: 10, height: 10 })).toThrow();
    expect(() => computeFitTransform({ width: 10, height: 10 }, { width: 0, height: 10 })).toThrow();
    expect(() => computeFitTransform({ width: 10, height: 10 }, { width: 10, height: 10 }, 0)).toThrow();
  });
});

describe('toClipPoint', () => {
  it('maps the viewport corners to clip space', () => {
    const viewport = { width: 100, height: 50 };

    expect(toClipPoint({ x: 0, y: 0 }, viewport)).toEqual({ x: -1, y: 1 });
    expect(toClipPoint({ x: 100, y: 50 }, viewport)).toEqual({ x: 1, y: -1 });
    expect(toClipPoint({ x: 50, y: 25 }, viewport)).toEqual({ x: 0, y: 0 });
  });
});

describe('toClipQuad', () => {
  it('produces 6 vertices of 4 floats', () => {
    const quad = toClipQuad(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 100, height: 100 },
    );

    expect(quad).toHaveLength(24);
  });

  it('covers the full viewport with correct texture coordinates', () => {
    const quad = toClipQuad(
      { x: 0, y: 0, width: 100, height: 100 },
      { width: 100, height: 100 },
    );

    // 左上顶点：裁剪坐标 (-1, 1)，纹理坐标 (0, 0)
    expect(Array.from(quad.slice(0, 4))).toEqual([-1, 1, 0, 0]);
    // 右下顶点在最后两个三角形里出现
    const vertices = Array.from(quad);
    expect(vertices.slice(16, 20)).toEqual([1, -1, 1, 1]);
  });
});

describe('clampZoom', () => {
  it('clamps to the supported range', () => {
    expect(clampZoom(1000)).toBe(MAX_ZOOM);
    expect(clampZoom(0.0001)).toBe(MIN_ZOOM);
  });

  it('passes through values inside the range', () => {
    expect(clampZoom(2.5)).toBe(2.5);
  });

  it('falls back to 1 for non-finite values', () => {
    expect(clampZoom(Number.NaN)).toBe(1);
    expect(clampZoom(Number.POSITIVE_INFINITY)).toBe(1);
  });
});
