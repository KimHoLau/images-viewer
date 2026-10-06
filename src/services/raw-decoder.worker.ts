/// <reference lib="webworker" />
import { LibRaw } from '@colorhythm/libraw-wasm';
import { bitmap16ToFloatRgb, bitmapToRgba } from './pixel-utils';
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

/** 解码输出的色彩空间。默认 sRGB，与既有行为一致 */
export type RawOutputColor = 'srgb' | 'prophoto-linear';

/** 解码输出的像素排布：8 位 RGBA，或归一化到 [0,1] 的 32 位浮点 RGB */
export type RawPixelFormat = 'rgba8' | 'rgb32f-linear';

export interface RawDecodeOptions {
  /** 半尺寸解码，约快 2 倍，预览用 */
  halfSize?: boolean;
  /** 使用相机白平衡，默认 true */
  useCameraWb?: boolean;
  /**
   * 输出色彩空间，默认 'srgb'。
   *
   * 'prophoto-linear' 用 16 位解码出 ProPhoto RGB 线性值，供 Log 色彩空间转换使用：
   * Log 编码需要线性光与足够的动态范围，8 位 sRGB 两条都不满足。
   */
  outputColor?: RawOutputColor;
}

export interface RawDecodeRequest {
  id: number;
  buffer: ArrayBuffer;
  fileName: string;
  options?: RawDecodeOptions;
}

export interface RawMetadataResult {
  id: number;
  ok: true;
  width: number;
  height: number;
  metadata: RawMetadata;
}

export type DecodedRawResult = RawMetadataResult &
  (
    | { format: 'rgba8'; pixels: Uint8ClampedArray }
    | { format: 'rgb32f-linear'; pixels: Float32Array }
  );

export type RawDecodeResponse = DecodedRawResult | { id: number; ok: false; error: string };

const ctx = self as unknown as DedicatedWorkerGlobalScope;

/** LibRaw 的输出色彩空间编号，对应 libraw_types.h 的 LIBRAW_COLORSPACE_* */
const OUTPUT_COLOR_SRGB = 1;
const OUTPUT_COLOR_PROPHOTO = 4;

/** sRGB 路径的位深：8 位，与 RGBA8 纹理一致 */
const OUTPUT_BPS_SRGB = 8;
/** ProPhoto linear 路径的位深：16 位，保住 Log 转换需要的动态范围 */
const OUTPUT_BPS_HI = 16;

/** LibRaw 高光处理方式：0=clip，1=unclip，2=blend */
const HIGHLIGHT_BLEND = 2;

function decode(request: RawDecodeRequest, decoder: LibRaw): DecodedRawResult {
  const { id, buffer, options } = request;
  const linearProPhoto = options?.outputColor === 'prophoto-linear';

  decoder.open(buffer);

  // 这些参数必须在 unpack 之前设置
  decoder.setOutputBps(linearProPhoto ? OUTPUT_BPS_HI : OUTPUT_BPS_SRGB);
  decoder.setOutputColor(linearProPhoto ? OUTPUT_COLOR_PROPHOTO : OUTPUT_COLOR_SRGB);
  decoder.setUseCameraWb(options?.useCameraWb === false ? 0 : 1);

  if (linearProPhoto) {
    // output_color 只决定色域，不决定传递函数：LibRaw 默认仍然套 sRGB 曲线。
    // gamma(1,1) 才是恒等曲线，出来的是线性光；auto_bright 是给显示看的直方图拉伸，
    // 会把线性关系拉歪，所以关掉。高光用 blend，避免先死白再进 Log。
    decoder.setGamma(0, 1);
    decoder.setGamma(1, 1);
    decoder.setNoAutoBright(1);
    decoder.setHighlight(HIGHLIGHT_BLEND);
  }

  if (options?.halfSize) decoder.setHalfSize(1);

  decoder.unpack();
  decoder.dcrawProcess();

  const image = decoder.dcrawMakeMemImage();
  const params = decoder.getIParams();
  const other = decoder.getImgOther();

  const pixelData = linearProPhoto
    ? {
        format: 'rgb32f-linear' as const,
        pixels: bitmap16ToFloatRgb(image.data, image.width, image.height, image.colors),
      }
    : {
        format: 'rgba8' as const,
        pixels: bitmapToRgba(image.data, image.width, image.height, image.colors),
      };

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

  return {
    id,
    ok: true,
    width: image.width,
    height: image.height,
    metadata,
    ...pixelData,
  };
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
