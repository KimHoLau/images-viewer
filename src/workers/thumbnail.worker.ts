/// <reference lib="webworker" />
import { bitmapToRgba } from '../services/pixel-utils';
import { createLibRawDecoder } from '../services/libraw-loader';
import { fitWithin } from '../services/thumbnail-core';

export interface ThumbnailJobMessage {
  id: number;
  file: File;
  isRaw: boolean;
  maxSize: number;
}

export type ThumbnailResultMessage =
  | { id: number; ok: true; blob: Blob; width: number; height: number }
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** 缩略图编码格式；WebP 体积更小，现代浏览器均支持 */
const THUMBNAIL_MIME = 'image/webp';
const THUMBNAIL_QUALITY = 0.82;

/** 缩放到目标尺寸并编码成 WebP */
async function encodeFromBitmap(
  bitmap: ImageBitmap,
  maxSize: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const target = fitWithin(bitmap.width, bitmap.height, maxSize);
  const canvas = new OffscreenCanvas(target.width, target.height);
  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('OffscreenCanvas 2D context is unavailable');
  }

  context.drawImage(bitmap, 0, 0, target.width, target.height);
  const blob = await canvas.convertToBlob({ type: THUMBNAIL_MIME, quality: THUMBNAIL_QUALITY });
  return { blob, width: target.width, height: target.height };
}

/** 常规图片：直接解码后缩放 */
async function generateImageThumbnail(
  file: File,
  maxSize: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch (error) {
    throw new Error(`无法解码图片 ${file.name}: ${(error as Error).message}`);
  }

  try {
    return await encodeFromBitmap(bitmap, maxSize);
  } finally {
    bitmap.close();
  }
}

/** RAW：优先取内嵌缩略图（比完整解码快约 50 倍） */
async function generateRawThumbnail(
  file: File,
  maxSize: number,
): Promise<{ blob: Blob; width: number; height: number }> {
  const buffer = await file.arrayBuffer();
  const decoder = await createLibRawDecoder();

  try {
    decoder.open(buffer);
    decoder.unpackThumb();
    const thumb = decoder.dcrawMakeMemThumb();

    if (thumb.type_ === 'LIBRAW_IMAGE_JPEG' || thumb.type_ === 'LIBRAW_IMAGE_JPEGXL') {
      const source = new Blob([thumb.data as BlobPart], { type: 'image/jpeg' });
      const bitmap = await createImageBitmap(source);
      try {
        return await encodeFromBitmap(bitmap, maxSize);
      } finally {
        bitmap.close();
      }
    }

    if (thumb.type_ !== 'LIBRAW_IMAGE_BITMAP') {
      throw new Error(`RAW 文件 ${file.name} 的内嵌缩略图格式不支持: ${thumb.type_}`);
    }

    const rgba = bitmapToRgba(thumb.data, thumb.width, thumb.height, thumb.colors);
    const imageData = new ImageData(rgba, thumb.width, thumb.height);
    const target = fitWithin(thumb.width, thumb.height, maxSize);
    const bitmap = await createImageBitmap(imageData, {
      resizeWidth: target.width,
      resizeHeight: target.height,
      resizeQuality: 'high',
    });

    try {
      return await encodeFromBitmap(bitmap, maxSize);
    } finally {
      bitmap.close();
    }
  } catch (error) {
    throw new Error(`无法解析 RAW 文件 ${file.name}: ${(error as Error).message}`);
  } finally {
    decoder.dispose();
  }
}

ctx.onmessage = async (event: MessageEvent<ThumbnailJobMessage>) => {
  const { id, file, isRaw, maxSize } = event.data;

  try {
    const result = isRaw
      ? await generateRawThumbnail(file, maxSize)
      : await generateImageThumbnail(file, maxSize);

    const message: ThumbnailResultMessage = { id, ok: true, ...result };
    ctx.postMessage(message);
  } catch (error) {
    const message: ThumbnailResultMessage = {
      id,
      ok: false,
      error: error instanceof Error ? error.message : String(error),
    };
    ctx.postMessage(message);
  }
};
