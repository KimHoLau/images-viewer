import type { FileEntry } from '../types/image';
import { RawDecoderService } from './raw-decoder-service';
import type { RawMetadata } from './raw-decoder.worker';

export interface LoadedImage {
  /** 可直接上传给 WebGL 纹理的位图 */
  bitmap: ImageBitmap;
  width: number;
  height: number;
  /** 仅 RAW 文件有拍摄信息 */
  metadata: RawMetadata | null;
}

export interface ImageLoadOptions {
  /**
   * 预览模式：RAW 用半尺寸解码，约快 2 倍。
   * 浏览大图时先出预览，需要细节再全尺寸解码。
   */
  preview?: boolean;
}

/**
 * 统一的图片加载入口：RAW 走 LibRaw Worker 解码，常规格式走 createImageBitmap。
 */
export class ImageLoader {
  private readonly rawDecoder = new RawDecoderService();

  async load(entry: FileEntry, options: ImageLoadOptions = {}): Promise<LoadedImage> {
    if (entry.isRaw) {
      return this.loadRaw(entry, options);
    }
    return this.loadStandard(entry);
  }

  dispose(): void {
    this.rawDecoder.dispose();
  }

  /** 常规格式：浏览器自己解码，按 EXIF 方向摆正 */
  private async loadStandard(entry: FileEntry): Promise<LoadedImage> {
    let bitmap: ImageBitmap;
    try {
      bitmap = await createImageBitmap(entry.file, { imageOrientation: 'from-image' });
    } catch (error) {
      throw new Error(`无法解码图片 ${entry.name}: ${(error as Error).message}`);
    }

    return {
      bitmap,
      width: bitmap.width,
      height: bitmap.height,
      metadata: null,
    };
  }

  /** RAW：Worker 内 LibRaw 解码成 RGBA，再转成位图 */
  private async loadRaw(entry: FileEntry, options: ImageLoadOptions): Promise<LoadedImage> {
    const decoded = await this.rawDecoder.decode(entry.file, {
      halfSize: options.preview === true,
      useCameraWb: true,
    });

    const imageData = new ImageData(decoded.pixels, decoded.width, decoded.height);
    const bitmap = await createImageBitmap(imageData);

    return {
      bitmap,
      width: decoded.width,
      height: decoded.height,
      metadata: decoded.metadata,
    };
  }
}
