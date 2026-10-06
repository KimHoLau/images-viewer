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
 * 像素来源只有一种，所以用判别联合而不是两个可空字段：位图走浏览器解码
 * （常规图片，或 Log 关闭时的 RAW），浮点走 LibRaw 的 16 位 ProPhoto linear
 * （Log 打开的 RAW）——8 位 sRGB 位图既不是线性的，动态范围也不够。
 */
export type LoadedImage = {
  width: number;
  height: number;
  /** 仅 RAW 文件有拍摄信息 */
  metadata: RawMetadata | null;
} & ({ source: 'bitmap'; bitmap: ImageBitmap } | { source: 'linear'; linear: LinearImageData });

/** 释放图片占用的资源；ImageBitmap 必须显式关闭 */
export function releaseLoadedImage(image: LoadedImage | null): void {
  if (image?.source === 'bitmap') image.bitmap.close();
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
      source: 'bitmap',
      bitmap,
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
        source: 'linear',
        linear: { data: decoded.pixels, width: decoded.width, height: decoded.height },
        width: decoded.width,
        height: decoded.height,
        metadata: decoded.metadata,
      };
    }

    const imageData = new ImageData(decoded.pixels, decoded.width, decoded.height);
    const bitmap = await createImageBitmap(imageData);

    return {
      source: 'bitmap',
      bitmap,
      width: decoded.width,
      height: decoded.height,
      metadata: decoded.metadata,
    };
  }
}
