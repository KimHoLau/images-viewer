import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  computeExportSize,
  downloadBlob,
  EXPORT_FORMATS,
  formatBytes,
  formatExtension,
  formatMimeType,
  getFormatInfo,
  suggestFileName,
} from './export';

describe('EXPORT_FORMATS', () => {
  it('has unique ids', () => {
    const ids = EXPORT_FORMATS.map((item) => item.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('covers jpeg, webp and png', () => {
    expect(EXPORT_FORMATS.map((item) => item.id).sort()).toEqual(['jpeg', 'png', 'webp']);
  });

  it('marks only the lossy formats as lossy', () => {
    expect(getFormatInfo('jpeg').lossy).toBe(true);
    expect(getFormatInfo('webp').lossy).toBe(true);
    expect(getFormatInfo('png').lossy).toBe(false);
  });

  it('gives every format a mime type, extension and description', () => {
    for (const item of EXPORT_FORMATS) {
      expect(item.mimeType).toMatch(/^image\//);
      expect(item.extension.length).toBeGreaterThan(0);
      expect(item.description.length).toBeGreaterThan(0);
    }
  });

  it('maps formats to the right mime type and extension', () => {
    expect(formatMimeType('jpeg')).toBe('image/jpeg');
    expect(formatExtension('jpeg')).toBe('jpg');
    expect(formatMimeType('webp')).toBe('image/webp');
    expect(formatMimeType('png')).toBe('image/png');
  });

  it('rejects an unknown format', () => {
    // @ts-expect-error 故意传非法值
    expect(() => getFormatInfo('tiff')).toThrow(/未知的导出格式/);
  });
});

describe('computeExportSize', () => {
  const image = { width: 6000, height: 4000 };

  it('keeps the original size when no limit is set', () => {
    expect(computeExportSize(image, null)).toEqual({ width: 6000, height: 4000 });
  });

  it('scales down to the long edge', () => {
    expect(computeExportSize(image, 3000)).toEqual({ width: 3000, height: 2000 });
  });

  it('preserves the aspect ratio', () => {
    const result = computeExportSize(image, 1000);
    expect(result.width / result.height).toBeCloseTo(1.5, 2);
  });

  it('handles portrait images', () => {
    expect(computeExportSize({ width: 4000, height: 6000 }, 3000)).toEqual({
      width: 2000,
      height: 3000,
    });
  });

  it('never upscales', () => {
    expect(computeExportSize(image, 10000)).toEqual({ width: 6000, height: 4000 });
  });

  it('never produces a zero dimension', () => {
    const result = computeExportSize({ width: 10000, height: 3 }, 1000);
    expect(result.width).toBe(1000);
    expect(result.height).toBeGreaterThanOrEqual(1);
  });

  it('rejects invalid inputs', () => {
    expect(() => computeExportSize({ width: 0, height: 10 }, null)).toThrow();
    expect(() => computeExportSize(image, 0)).toThrow();
  });
});

describe('suggestFileName', () => {
  it('replaces the original extension and records the size', () => {
    expect(suggestFileName('DSC_1234.NEF', 'jpeg', { width: 3000, height: 2000 })).toBe(
      'DSC_1234-3000x2000.jpg',
    );
  });

  it('uses the extension of the chosen format', () => {
    expect(suggestFileName('photo.png', 'webp', { width: 100, height: 100 })).toBe(
      'photo-100x100.webp',
    );
  });

  it('handles a name without an extension', () => {
    expect(suggestFileName('photo', 'png', { width: 10, height: 20 })).toBe('photo-10x20.png');
  });

  it('only strips the last extension', () => {
    expect(suggestFileName('my.photo.v2.jpeg', 'jpeg', { width: 5, height: 5 })).toBe(
      'my.photo.v2-5x5.jpg',
    );
  });

  it('falls back to a default base for an empty name', () => {
    expect(suggestFileName('.jpg', 'png', { width: 1, height: 1 })).toBe('export-1x1.png');
  });
});

describe('formatBytes', () => {
  it('formats bytes, kilobytes and megabytes', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2 KB');
    expect(formatBytes(3 * 1024 * 1024)).toBe('3.0 MB');
  });

  it('returns a dash for invalid input', () => {
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(-1)).toBe('—');
  });
});

describe('downloadBlob', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('clicks a hidden anchor carrying the file name', () => {
    const createObjectURL = vi.fn(() => 'blob:mock');
    const revokeObjectURL = vi.fn();
    vi.stubGlobal('URL', { ...URL, createObjectURL, revokeObjectURL });

    const clicked: HTMLAnchorElement[] = [];
    const originalClick = HTMLAnchorElement.prototype.click;
    HTMLAnchorElement.prototype.click = function click(this: HTMLAnchorElement) {
      clicked.push(this);
    };

    try {
      downloadBlob(new Blob(['x']), 'out.jpg');

      expect(createObjectURL).toHaveBeenCalled();
      expect(clicked).toHaveLength(1);
      expect(clicked[0].download).toBe('out.jpg');
      expect(clicked[0].href).toContain('blob:mock');
      // 触发后不应把锚点留在 DOM 里
      expect(document.querySelector('a[download]')).toBeNull();
    } finally {
      HTMLAnchorElement.prototype.click = originalClick;
    }
  });
});
