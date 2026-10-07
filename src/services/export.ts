import type { ImageRenderer } from '../renderer/ImageRenderer';
import type { Size } from '../renderer/view-transform';
import {
  attachRawExif,
  type ExifAttachStatus,
  type ExifContainerFormat,
  type RawExifSource,
} from './exif';
import { fitWithin } from './thumbnail-core';

/** 可导出的格式。与「能承载 EXIF 的容器」是同一组，定义在 exif.ts，这里只是沿用 */
export type ExportFormat = ExifContainerFormat;

export interface ExportFormatInfo {
  id: ExportFormat;
  label: string;
  mimeType: string;
  extension: string;
  /** 有损格式才有质量参数 */
  lossy: boolean;
  /**
   * 这个格式会不会写入原拍摄 EXIF。
   *
   * WebP 为 false：它的 `EXIF` chunk 载荷框架规范里没写、读者支持也找不到一手依据，
   * 两处不确定叠在一起，G1 决定不做。导出面板会拿它如实标注。
   * 真正决定写不写的是 `attachRawExif`，这里只是给 UI 用的声明，两者由测试钉在一起。
   */
  carriesExif: boolean;
  description: string;
}

export const EXPORT_FORMATS: readonly ExportFormatInfo[] = [
  {
    id: 'jpeg',
    label: 'JPEG',
    mimeType: 'image/jpeg',
    extension: 'jpg',
    lossy: true,
    carriesExif: true,
    description: '体积最小，兼容性最好',
  },
  {
    id: 'webp',
    label: 'WebP',
    mimeType: 'image/webp',
    extension: 'webp',
    lossy: true,
    carriesExif: false,
    description: '同画质下比 JPEG 更小',
  },
  {
    id: 'png',
    label: 'PNG',
    mimeType: 'image/png',
    extension: 'png',
    lossy: false,
    carriesExif: true,
    description: '无损，适合再编辑',
  },
] as const;

export const DEFAULT_EXPORT_QUALITY = 0.92;

/** 分辨率档位：null 表示不缩放 */
export const EXPORT_LONG_EDGE_OPTIONS: readonly (number | null)[] = [null, 4096, 2048, 1024];

export function getFormatInfo(format: ExportFormat): ExportFormatInfo {
  const info = EXPORT_FORMATS.find((item) => item.id === format);
  if (!info) throw new Error(`未知的导出格式: ${format}`);
  return info;
}

export function formatMimeType(format: ExportFormat): string {
  return getFormatInfo(format).mimeType;
}

export function formatExtension(format: ExportFormat): string {
  return getFormatInfo(format).extension;
}

/**
 * 目标尺寸：按长边上限等比缩小，不放大。
 * 与缩略图共用同一套「放进方框」的等比缩放逻辑。
 */
export function computeExportSize(image: Size, maxLongEdge: number | null): Size {
  if (
    !Number.isFinite(image.width) ||
    !Number.isFinite(image.height) ||
    image.width < 1 ||
    image.height < 1
  ) {
    throw new Error(`图片尺寸非法: ${image.width}×${image.height}`);
  }
  if (maxLongEdge === null) {
    return { width: Math.round(image.width), height: Math.round(image.height) };
  }
  if (!Number.isFinite(maxLongEdge) || maxLongEdge < 1) {
    throw new Error(`长边上限非法: ${maxLongEdge}`);
  }
  return fitWithin(image.width, image.height, maxLongEdge);
}

/** 去掉旧扩展名，拼上尺寸与新的扩展名 */
export function suggestFileName(originalName: string, format: ExportFormat, size: Size): string {
  const base = originalName.replace(/\.[^./\\]+$/, '') || 'export';
  return `${base}-${size.width}x${size.height}.${formatExtension(format)}`;
}

/** 人类可读的体积，用于导出结果提示 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export interface ExportOptions {
  format: ExportFormat;
  /** 0~1，仅对 JPEG / WebP 有效 */
  quality: number;
  /** 长边上限，null 表示原尺寸 */
  maxLongEdge: number | null;
  /**
   * 原拍摄 EXIF 的来源。null / 缺省表示这次导出不带 EXIF——非 RAW 源就是这种情况，
   * 按需求范围只保留 RAW 源的拍摄信息。
   */
  exif?: RawExifSource | null;
}

export interface ExportResult {
  blob: Blob;
  width: number;
  height: number;
  fileName: string;
  /** EXIF 到底带上了没有，调用方据此如实告知用户 */
  exifStatus: ExifAttachStatus;
}

function clampQuality(quality: number): number {
  if (!Number.isFinite(quality)) return DEFAULT_EXPORT_QUALITY;
  return Math.min(1, Math.max(0, quality));
}

/** 把像素编码成图片；优先用 OffscreenCanvas，不可用时退回普通 canvas */
export async function encodeImageData(
  imageData: ImageData,
  format: ExportFormat,
  quality: number,
): Promise<Blob> {
  const mimeType = formatMimeType(format);
  const effectiveQuality = clampQuality(quality);

  if (typeof OffscreenCanvas !== 'undefined') {
    const canvas = new OffscreenCanvas(imageData.width, imageData.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建导出画布');
    context.putImageData(imageData, 0, 0);
    const blob = await canvas.convertToBlob({
      type: mimeType,
      quality: format === 'png' ? undefined : effectiveQuality,
    });
    if (!blob) throw new Error('导出编码失败');
    return blob;
  }

  const canvas = document.createElement('canvas');
  canvas.width = imageData.width;
  canvas.height = imageData.height;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法创建导出画布');
  context.putImageData(imageData, 0, 0);

  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error('导出编码失败'));
      },
      mimeType,
      format === 'png' ? undefined : effectiveQuality,
    );
  });
}

/**
 * 把原拍摄 EXIF 注进编码结果。
 *
 * 只有真的写进去了才重建 Blob：没来源、格式不支持或写入出错时原样返回，
 * 省掉一次整图拷贝，也保证「没带上」时导出的字节与编码器产出的一模一样。
 */
async function attachExif(
  blob: Blob,
  format: ExportFormat,
  source: RawExifSource | null | undefined,
  size: Size,
): Promise<{ blob: Blob; status: ExifAttachStatus }> {
  if (!source) return { blob, status: 'unavailable' };

  const bytes = new Uint8Array(await blob.arrayBuffer());
  const result = attachRawExif(bytes, format, source, size);
  if (result.status !== 'attached') return { blob, status: result.status };

  return { blob: new Blob([result.bytes], { type: blob.type }), status: 'attached' };
}

/**
 * 导出：复用画布上的渲染器（图片、调整、LUT 都已经在里面），
 * 按目标尺寸离屏渲染一遍再编码，最后把原拍摄 EXIF 注进编码结果。
 *
 * 这里刻意不去读 store 里的 logSpaceId：Log 模式、输入像素空间、曲线与色域矩阵
 * 都是渲染器自己的状态，离屏渲染走的又是同一个 render()，所以导出结果与屏幕
 * 天然一致。再从别处读一遍 Log 设置，只会多出一份可能对不上的真相。
 */
export async function renderExport(
  renderer: ImageRenderer,
  originalName: string,
  options: ExportOptions,
): Promise<ExportResult> {
  const size = computeExportSize(renderer.getImageSize(), options.maxLongEdge);
  const imageData = renderer.renderToImageData(size.width, size.height);
  const encoded = await encodeImageData(imageData, options.format, options.quality);
  const { blob, status } = await attachExif(encoded, options.format, options.exif, size);

  return {
    blob,
    width: size.width,
    height: size.height,
    fileName: suggestFileName(originalName, options.format, size),
    exifStatus: status,
  };
}

/** 触发浏览器下载 */
export function downloadBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  anchor.rel = 'noopener';
  anchor.style.display = 'none';

  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // 立刻回收会让部分浏览器拿不到数据，留一点时间
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
