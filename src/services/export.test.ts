import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ImageRenderer } from '../renderer/ImageRenderer';
import { attachRawExif, EXIF_TAG, readTiffExifTags } from './exif';
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
  /** 最小 JPEG：SOI + SOS + 一点数据 */
  const JPEG_BYTES = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6]);

  /** 最小 PNG：签名 + IHDR + IDAT + IEND */
  function pngBytes(): Uint8Array {
    const signature = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
    const pieces: number[][] = [signature];
    for (const [type, length] of [
      ['IHDR', 13],
      ['IDAT', 8],
      ['IEND', 0],
    ] as Array<[string, number]>) {
      pieces.push([
        (length >> 24) & 0xff,
        (length >> 16) & 0xff,
        (length >> 8) & 0xff,
        length & 0xff,
        ...[...type].map((char) => char.charCodeAt(0)),
        ...new Array<number>(length).fill(0),
        0,
        0,
        0,
        0,
      ]);
    }
    return new Uint8Array(pieces.flat());
  }

  /** jsdom 没有 OffscreenCanvas，用一个会按 MIME 类型回真实字节的替身顶上 */
  class FakeOffscreenCanvas {
    constructor(
      readonly width: number,
      readonly height: number,
    ) {}

    getContext(): { putImageData: () => void } {
      return { putImageData: () => {} };
    }

    async convertToBlob(options: { type: string }): Promise<Blob> {
      const bytes = options.type === 'image/png' ? pngBytes() : JPEG_BYTES;
      return new Blob([bytes], { type: options.type });
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

  /** 一份照着 IMGP2971.DNG 实测结构造的最小 TIFF 容器 */
  function makeContainer(): Uint8Array {
    const ifd0At = 8;
    // IFD0 两条：Make + ExifOffset
    const ifd0Size = 2 + 2 * 12 + 4;
    const exifAt = ifd0At + ifd0Size;
    const exifSize = 2 + 1 * 12 + 4;
    let valueAt = exifAt + exifSize;
    if (valueAt % 2 === 1) valueAt += 1;

    const make = new Uint8Array([0x50, 0x45, 0x4e, 0x54, 0x41, 0x58, 0x00]); // "PENTAX\0"
    const makeAt = valueAt;
    valueAt += make.length;
    if (valueAt % 2 === 1) valueAt += 1;

    const out = new Uint8Array(valueAt);
    const view = new DataView(out.buffer);
    out[0] = 0x49;
    out[1] = 0x49;
    view.setUint16(2, 42, true);
    view.setUint32(4, ifd0At, true);

    view.setUint16(ifd0At, 2, true);
    view.setUint16(ifd0At + 2, 0x010f, true); // Make
    view.setUint16(ifd0At + 4, 2, true); // ASCII
    view.setUint32(ifd0At + 6, make.length, true);
    view.setUint32(ifd0At + 10, makeAt, true);
    view.setUint16(ifd0At + 14, 0x8769, true); // ExifOffset
    view.setUint16(ifd0At + 16, 4, true); // LONG
    view.setUint32(ifd0At + 18, 1, true);
    view.setUint32(ifd0At + 22, exifAt, true);
    view.setUint32(ifd0At + 26, 0, true); // 没有 IFD1

    view.setUint16(exifAt, 1, true);
    view.setUint16(exifAt + 2, 0x8827, true); // ISO
    view.setUint16(exifAt + 4, 3, true); // SHORT
    view.setUint32(exifAt + 6, 1, true);
    view.setUint16(exifAt + 10, 100, true);
    view.setUint32(exifAt + 14, 0, true);

    out.set(make, makeAt);
    return out;
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

  it('给了来源就把原拍摄 EXIF 注进去', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const renderer = makeRenderer();

    const result = await renderExport(renderer as unknown as ImageRenderer, 'shot.cr2', {
      format: 'jpeg',
      quality: 0.9,
      maxLongEdge: 3000,
      exif: { containerBytes: makeContainer(), fallback: null },
    });

    expect(result.exifStatus).toBe('attached');
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    // SOI 之后就是 APP1，长度字段非 0
    expect(Array.from(bytes.subarray(0, 4))).toEqual([0xff, 0xd8, 0xff, 0xe1]);
    expect((bytes[4] << 8) | bytes[5]).toBeGreaterThan(8);
    // "Exif\0\0"
    expect(Array.from(bytes.subarray(6, 12))).toEqual([0x45, 0x78, 0x69, 0x66, 0, 0]);
    expect(bytes.length).toBeGreaterThan(JPEG_BYTES.length);
  });

  it('EXIF 的像素尺寸按导出尺寸写，不是原图尺寸', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const renderer = makeRenderer();

    const result = await renderExport(renderer as unknown as ImageRenderer, 'shot.cr2', {
      format: 'jpeg',
      quality: 0.9,
      maxLongEdge: 3000,
      exif: { containerBytes: makeContainer(), fallback: null },
    });

    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    // APP1 载荷：FFE1 + 长度 + "Exif\0\0" + TIFF 块
    const tags = readTiffExifTags(bytes.subarray(12))!;
    const width = tags.exif.find((entry) => entry.tag === EXIF_TAG.PixelXDimension)!;
    const height = tags.exif.find((entry) => entry.tag === EXIF_TAG.PixelYDimension)!;
    const read = (data: Uint8Array) =>
      new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);

    expect(read(width.data)).toBe(3000);
    expect(read(height.data)).toBe(2000);
  });

  it('没有来源时报 unavailable，字节与编码结果一模一样', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const renderer = makeRenderer();

    const result = await renderExport(renderer as unknown as ImageRenderer, 'shot.cr2', {
      format: 'jpeg',
      quality: 0.9,
      maxLongEdge: null,
    });

    expect(result.exifStatus).toBe('unavailable');
    const bytes = new Uint8Array(await result.blob.arrayBuffer());
    expect(Array.from(bytes)).toEqual(Array.from(JPEG_BYTES));
  });

  it('WebP 报 unsupported，落盘的还是编码器那份字节', async () => {
    vi.stubGlobal('OffscreenCanvas', FakeOffscreenCanvas);
    const renderer = makeRenderer();

    const result = await renderExport(renderer as unknown as ImageRenderer, 'shot.cr2', {
      format: 'webp',
      quality: 0.9,
      maxLongEdge: null,
      exif: { containerBytes: makeContainer(), fallback: { make: 'Canon' } },
    });

    expect(result.exifStatus).toBe('unsupported');
    expect(new Uint8Array(await result.blob.arrayBuffer()).length).toBe(JPEG_BYTES.length);
  });
});

describe('EXPORT_FORMATS 的 carriesExif', () => {
  /**
   * 面板的标注（`carriesExif`）与真正写不写（`attachRawExif`）是两处声明，
   * 一旦说岔了用户就会看到「会带 EXIF」而文件里没有。这里把它们钉在一起。
   */
  it('与 attachRawExif 的实际行为一致', () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6]);
    const source = { fallback: { make: 'Canon' } };

    for (const info of EXPORT_FORMATS) {
      const { status } = attachRawExif(bytes, info.id, source, { width: 10, height: 10 });
      expect(status === 'unsupported', `${info.id} 的 carriesExif 与实际行为不一致`).toBe(
        !info.carriesExif,
      );
    }
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
