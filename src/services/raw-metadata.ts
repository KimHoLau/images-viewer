/**
 * LibRaw 的拍摄信息 → `RawMetadata`。
 *
 * 单独成一个模块，是为了让**两处**调用共用同一份映射，而不是各写一遍：
 *
 * - `raw-decoder.worker.ts`（产品路径，界面上显示的拍摄信息与导出 EXIF 的兜底都来自它）；
 * - `src/dev/exif-check.ts`（端到端验证脚本，要拿真实样本的**真实**字段去跑兜底那条路）。
 *
 * 各写一遍的坏处很具体：验证脚本一旦和产品路径漂开，它就会继续「通过」，但验的已经不是
 * 上线的那份映射了。这里只做纯数据搬运，不碰 WASM 也不碰 DOM，所以能在 jsdom 里被单测盯住。
 */
import type { RawMetadata } from './raw-decoder.worker';

/**
 * LibRaw 的字符串字段都是定长 char 数组，取出来带尾部填充（`"K-30 Ver 1.06          "`）。
 * 全角之外一律去掉首尾空白再往外给。
 */
function text(value: string | null | undefined): string {
  return (value ?? '').trim();
}

/** 要用到的 LibRaw getter 结果；字段名照 libraw-wasm 的 `index.d.ts` */
export interface RawMetadataSources {
  /** `getIParams()` */
  params: {
    make: string;
    model: string;
    normalized_make: string;
    normalized_model: string;
    software: string;
  };
  /** `getImgOther()` */
  other: {
    iso_speed: number;
    shutter: number;
    aperture: number;
    focal_len: number;
    timestamp: number | bigint;
    artist?: string | null;
    desc?: string | null;
  };
  /** `getLensInfo()` */
  lens: {
    Lens: string;
    LensMake: string;
    LensSerial: string;
    FocalLengthIn35mmFormat: number;
  };
  /** `getShootingInfo()` */
  shooting: {
    BodySerial: string;
  };
  /** `dcrawMakeMemImage()` 的三个尺寸字段 */
  image: {
    width: number;
    height: number;
    colors: number;
  };
}

export function buildRawMetadata(sources: RawMetadataSources): RawMetadata {
  const { params, other, lens, shooting, image } = sources;

  return {
    width: image.width,
    height: image.height,
    // normalized_* 是 LibRaw 归一化过的厂商/机型名，没有才退回原始值
    make: params.normalized_make || params.make || '',
    model: params.normalized_model || params.model || '',
    software: text(params.software),
    artist: text(other.artist),
    description: text(other.desc),
    lensModel: text(lens.Lens),
    lensMake: text(lens.LensMake),
    lensSerial: text(lens.LensSerial),
    bodySerial: text(shooting.BodySerial),
    colors: image.colors,
    iso: Number(other.iso_speed) || 0,
    shutter: Number(other.shutter) || 0,
    aperture: Number(other.aperture) || 0,
    focalLength: Number(other.focal_len) || 0,
    focalLength35mm: Number(lens.FocalLengthIn35mmFormat) || 0,
    // LibRaw 的 timestamp 是 bigint 的**秒**，统一成毫秒，与这个字段的文档一致
    timestamp: Number(other.timestamp) * 1000 || 0,
  };
}
