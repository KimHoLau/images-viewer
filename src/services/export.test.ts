import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageRenderer } from '../renderer/ImageRenderer';
import {
  computeExportSize,
  downloadBlob,
  EXPORT_FORMATS,
  formatBytes,
  formatExtension,
  formatMimeType,
  getFormatInfo,
  renderExport,
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

describe('renderExport', () => {
  /** jsdom 没有 OffscreenCanvas，用一个只会回一块 Blob 的替身顶上 */
  class FakeOffscreenCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}

    getContext(): { putImageData: () => void } {
      return { putImageData: () => {} };
    }

    async convertToBlob(options: { type: string }): Promise<Blob> {
      return new Blob(['pixels'], { type: options.type });
    }
  }

  interface FakeRenderer {
    getImageSize: () => { width: number; height: number };
    renderToImageData: ReturnType<typeof vi.fn>;
    setLogMode: ReturnType<typeof vi.fn>;
  }

  /** 渲染器持有 Log 模式等显示状态；导出只是让它离屏再画一遍 */
  function makeRenderer(): FakeRenderer {
    return {
      getImageSize: () => ({ width: 6000, height: 4000 }),
      renderToImageData: vi.fn(
        () =>
          ({ width: 3000, height: 2000, data: new Uint8ClampedArray(0) }) as unknown as ImageData,
      ),
      setLogMode: vi.fn(),
    };
  }

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('按目标尺寸调用渲染器的离屏渲染', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const renderer = makeRenderer();

    await renderExport(renderer as unknown as ImageRenderer, 'shot.cr2', {
      format: 'jpeg',
      quality: 0.9,
      maxLongEdge: 3000,
    });

    expect(renderer.renderToImageData).toHaveBeenCalledWith(3000, 2000);
  });

  it('导出的就是渲染器画出来的那份像素', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const renderer = makeRenderer();

    const result = await renderExport(renderer as unknown as ImageRenderer, 'shot.cr2', {
      format: 'png',
      quality: 1,
      maxLongEdge: null,
    });

    // 屏幕与导出共用 renderToImageData，所以只要导出走的是它，
    // Log 模式的曲线、色域矩阵与 LUT 设置就必然和屏幕一致
    expect(renderer.renderToImageData).toHaveBeenCalledTimes(1);
    expect(renderer.renderToImageData).toHaveBeenCalledWith(6000, 4000);
    expect(result.width).toBe(6000);
    expect(result.height).toBe(4000);
    expect(result.fileName).toBe('shot-6000x4000.png');
    expect(result.blob.type).toBe('image/png');
  });

  it('不改动渲染器的 Log 设置', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const renderer = makeRenderer();

    await renderExport(renderer as unknown as ImageRenderer, 'shot.cr2', {
      format: 'jpeg',
      quality: 0.9,
      maxLongEdge: 1024,
    });

    expect(renderer.setLogMode).not.toHaveBeenCalled();
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
