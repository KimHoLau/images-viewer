import { describe, expect, it } from 'vitest';
import {
  createLimiter,
  defaultThumbnailConcurrency,
  fitWithin,
  thumbnailCacheKey,
} from './thumbnail-core';

describe('fitWithin', () => {
  it('keeps images smaller than maxSize untouched', () => {
    expect(fitWithin(100, 80, 256)).toEqual({ width: 100, height: 80 });
  });

  it('scales down the longest side to maxSize', () => {
    expect(fitWithin(4000, 2000, 256)).toEqual({ width: 256, height: 128 });
    expect(fitWithin(2000, 4000, 256)).toEqual({ width: 128, height: 256 });
  });

  it('preserves aspect ratio', () => {
    const result = fitWithin(6000, 4000, 256);
    expect(result.width / result.height).toBeCloseTo(1.5, 2);
  });

  it('never produces a zero dimension', () => {
    const result = fitWithin(10000, 2, 256);
    expect(result.width).toBe(256);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid dimensions', () => {
    expect(() => fitWithin(0, 100, 256)).toThrow();
    expect(() => fitWithin(100, -1, 256)).toThrow();
    expect(() => fitWithin(100, 100, 0)).toThrow();
  });
});

describe('thumbnailCacheKey', () => {
  it('combines path, size and mtime', () => {
    expect(thumbnailCacheKey({ path: 'a/b.jpg', size: 10, lastModified: 5 })).toBe('a/b.jpg::10::5');
  });

  it('changes when the file content changes', () => {
    const base = { path: 'a.jpg', size: 10, lastModified: 5 };
    expect(thumbnailCacheKey(base)).not.toBe(thumbnailCacheKey({ ...base, size: 11 }));
    expect(thumbnailCacheKey(base)).not.toBe(thumbnailCacheKey({ ...base, lastModified: 6 }));
    expect(thumbnailCacheKey(base)).not.toBe(thumbnailCacheKey({ ...base, path: 'b.jpg' }));
  });
});

describe('createLimiter', () => {
  it('runs at most `limit` tasks at once', async () => {
    const limiter = createLimiter(2);
    let running = 0;
    let peak = 0;
    const releases: Array<() => void> = [];

    const task = () =>
      limiter(async () => {
        running++;
        peak = Math.max(peak, running);
        await new Promise<void>((resolve) => releases.push(resolve));
        running--;
      });

    const all = [task(), task(), task(), task()];
    await Promise.resolve();

    expect(peak).toBe(2);
    expect(limiter.active).toBe(2);
    expect(limiter.pending).toBe(2);

    while (releases.length > 0) {
      releases.shift()!();
      await new Promise((resolve) => setTimeout(resolve, 0));
    }
    await Promise.all(all);

    expect(peak).toBe(2);
    expect(limiter.pending).toBe(0);
  });

  it('propagates task results and errors', async () => {
    const limiter = createLimiter(1);
    await expect(limiter(async () => 42)).resolves.toBe(42);
    await expect(
      limiter(async () => {
        throw new Error('boom');
      }),
    ).rejects.toThrow('boom');
  });

  it('rejects an invalid limit', () => {
    expect(() => createLimiter(0)).toThrow();
  });
});

describe('defaultThumbnailConcurrency', () => {
  it('caps concurrency at 4', () => {
    expect(defaultThumbnailConcurrency(64)).toBe(4);
  });

  it('keeps at least 1', () => {
    expect(defaultThumbnailConcurrency(1)).toBe(1);
    expect(defaultThumbnailConcurrency(0)).toBe(1);
  });

  it('uses half the cores when below the cap', () => {
    expect(defaultThumbnailConcurrency(6)).toBe(3);
  });
});
