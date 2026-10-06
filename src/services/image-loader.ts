import type { FileEntry } from '../types/image';
import { RawDecoderService } from './raw-decoder-service';
import type { RawMetadata, RawOutputColor } from './raw-decoder.worker';

/** ProPhoto RGB 线性像素，归一化到 [0,1]，供 Log 色彩空间转换使用 */
export interface LinearImageData {
  data: Float32Array;
  width: number;
  height: number;
}

/**
 * 载入完成的图片。
 *
 * bitmap 与 linear 二选一：常规图片走浏览器解码出的位图，需要 Log 色彩空间转换的
 * RAW 走 16 位 ProPhoto linear 浮点数据——8 位 sRGB 位图既不是线性的，动态范围也不够。
 */
export interface LoadedImage {
  bitmap: ImageBitmap | null;
  linear: LinearImageData | null;
  width: number;
  height: number;
  /** 仅 RAW 文件有拍摄信息 */
  metadata: RawMetadata | null;
}

/** 释放图片占用的资源；ImageBitmap 必须显式关闭 */
export function releaseLoadedImage(image: LoadedImage | null): void {
  image?.bitmap?.close();
}

export interface ImageLoadOptions {
  /**
   * 预览模式：RAW 用半尺寸解码，约快 2 倍。
   * 浏览大图时先出预览，需要细节再全尺寸解码。
   */
  preview?: boolean;
  /** RAW 解码的输出色彩空间，默认 sRGB */
  outputColor?: RawOutputColor;
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
      linear: null,
      width: bitmap.width,
      height: bitmap.height,
      metadata: null,
    };
  }

  /**
   * RAW：Worker 内 LibRaw 解码，再按输出色彩空间分流。
   * sRGB 走 8 位 RGBA → ImageBitmap；ProPhoto linear 直接保留浮点，交给 WebGL 上传。
   */
  private async loadRaw(entry: FileEntry, options: ImageLoadOptions): Promise<LoadedImage> {
    const decoded = await this.rawDecoder.decode(entry.file, {
      halfSize: options.preview === true,
      useCameraWb: true,
      // 显式给默认值，调用点一眼能看出这次要的是哪个色彩空间
      outputColor: options.outputColor ?? 'srgb',
    });

    if (decoded.format === 'rgb32f-linear') {
      return {
        bitmap: null,
        linear: { data: decoded.pixels, width: decoded.width, height: decoded.height },
        width: decoded.width,
        height: decoded.height,
        metadata: decoded.metadata,
      };
    }

    const imageData = new ImageData(decoded.pixels, decoded.width, decoded.height);
    const bitmap = await createImageBitmap(imageData);

    return {
      bitmap,
      linear: null,
      width: decoded.width,
      height: decoded.height,
      metadata: decoded.metadata,
    };
  }
}
