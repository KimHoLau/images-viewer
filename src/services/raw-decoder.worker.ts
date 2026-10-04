/// <reference lib="webworker" />
import { LibRaw } from '@colorhythm/libraw-wasm';
import { bitmapToRgba } from './pixel-utils';
import { createLibRawDecoder } from './libraw-loader';

/** RAW 文件的拍摄信息，显示在右侧信息面板 */
export interface RawMetadata {
  width: number;
  height: number;
  make: string;
  model: string;
  colors: number;
  iso: number;
  /** 快门速度，单位秒 */
  shutter: number;
  aperture: number;
  focalLength: number;
  /** 拍摄时间戳（毫秒），无法解析时为 0 */
  timestamp: number;
}

export interface RawDecodeOptions {
  /** 半尺寸解码，约快 2 倍，预览用 */
  halfSize?: boolean;
  /** 使用相机白平衡，默认 true */
  useCameraWb?: boolean;
}

export interface RawDecodeRequest {
  id: number;
  buffer: ArrayBuffer;
  fileName: string;
  options?: RawDecodeOptions;
}

export interface DecodedRawResult {
  id: number;
  ok: true;
  width: number;
  height: number;
  /** RGBA 像素 */
  pixels: Uint8ClampedArray;
  metadata: RawMetadata;
}

export type RawDecodeResponse =
  | DecodedRawResult
  | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** 输出色彩空间：sRGB */
const OUTPUT_COLOR_SRGB = 1;
/** 输出位深：8 位，与 RGBA8 纹理一致 */
const OUTPUT_BPS = 8;

function decode(request: RawDecodeRequest, decoder: LibRaw): DecodedRawResult {
  const { id, buffer, options } = request;

  decoder.open(buffer);

  // 这些参数必须在 unpack 之前设置
  decoder.setOutputBps(OUTPUT_BPS);
  decoder.setOutputColor(OUTPUT_COLOR_SRGB);
  decoder.setUseCameraWb(options?.useCameraWb === false ? 0 : 1);
  if (options?.halfSize) decoder.setHalfSize(1);

  decoder.unpack();
  decoder.dcrawProcess();

  const image = decoder.dcrawMakeMemImage();
  const params = decoder.getIParams();
  const other = decoder.getImgOther();

  const pixels = bitmapToRgba(image.data, image.width, image.height, image.colors);

  const metadata: RawMetadata = {
    width: image.width,
    height: image.height,
    make: params.normalized_make || params.make || '',
    model: params.normalized_model || params.model || '',
    colors: image.colors,
    iso: Number(other.iso_speed) || 0,
    shutter: Number(other.shutter) || 0,
    aperture: Number(other.aperture) || 0,
    focalLength: Number(other.focal_len) || 0,
    // LibRaw 的 timestamp 是 bigint，转成毫秒数字
    timestamp: Number(other.timestamp) || 0,
  };

  return { id, ok: true, width: image.width, height: image.height, pixels, metadata };
}

ctx.onmessage = async (event: MessageEvent<RawDecodeRequest>) => {
  const request = event.data;

  try {
    const decoder = await createLibRawDecoder();
    try {
      const result = decode(request, decoder);
      // 像素数据零拷贝转移给主线程
      ctx.postMessage(result, [result.pixels.buffer]);
    } finally {
      decoder.dispose();
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const response: RawDecodeResponse = {
      id: request.id,
      ok: false,
      error: `无法解码 ${request.fileName}: ${message}`,
    };
    ctx.postMessage(response);
  }
};
