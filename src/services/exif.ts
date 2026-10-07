/**
 * 导出时的 EXIF：从 RAW 源取原拍摄信息，按导出图的事实归一化，再写进 JPEG / PNG。
 *
 * 三件事都在这个模块里，因为它们共用同一套标签模型：
 *
 * 1. **读**（`readTiffExifTags`）：TIFF 系 RAW（DNG/NEF/ARW/CR2/PEF/SRW/ORF/RW2）的文件头
 *    本身就是 TIFF 头，IFD0 的 `ExifOffset`(0x8769) 直接挂着 ExifIFD。实测 `samples/IMGP2971.DNG`
 *    就是这么拿到 `DateTimeOriginal` / `ExposureProgram` / `MeteringMode` / `Flash` 的
 *    （见 #36 的实测评论）。**只取标签，不整段搬字节**：容器 IFD0 还指着 `SubIFDs`、
 *    `StripOffsets`、`DNGPrivateData`，整段照搬会带出指向文件末尾原始像素与预览的悬空指针
 *    （`research/exif-export-facts.md` §1.8）。
 * 2. **筛**（`composeExifTags`）：白名单 + 归一化。这里不做「尽量多搬」——无法逐一核实
 *    未知标签的指针语义，不问就搬正是悬空指针的来源。
 * 3. **写**（`encodeExifBlock` + `injectExif`）：序列化成自足的 TIFF 块，塞进容器的对应位置。
 *
 * 为什么不用内嵌预览里的 APP1：实测那份预览是裸 JPEG（`FFD8` 后直接 `FFDB`），
 * `dcrawMakeMemThumb()` 里那条是 LibRaw 用 `tiff_head()` 合成的最小块，`Software` 写着
 * `dcraw v9.26`，没有 MakerNote / LensModel / DateTimeOriginal。
 *
 * 取不到的字段（非 TIFF 容器 CR3/RAF/X3F，或容器没写）由 LibRaw 的标量兜底补，见
 * `toExifFallback`。
 */
import type { RawMetadata } from './raw-decoder.worker';
import type { Size } from '../renderer/view-transform';

// ---------------------------------------------------------------------------
// 标签号与类型码
// ---------------------------------------------------------------------------

/** 用到的 TIFF/EXIF 标签号（名字照 CIPA DC-008 / ExifTool 的通用叫法） */
export const EXIF_TAG = {
  ImageDescription: 0x010e,
  Make: 0x010f,
  Model: 0x0110,
  Orientation: 0x0112,
  XResolution: 0x011a,
  YResolution: 0x011b,
  ResolutionUnit: 0x0128,
  Software: 0x0131,
  DateTime: 0x0132,
  Artist: 0x013b,
  Copyright: 0x8298,
  ExifOffset: 0x8769,
  ExposureTime: 0x829a,
  FNumber: 0x829d,
  ExposureProgram: 0x8822,
  ISO: 0x8827,
  ExifVersion: 0x9000,
  DateTimeOriginal: 0x9003,
  DateTimeDigitized: 0x9004,
  ShutterSpeedValue: 0x9201,
  ApertureValue: 0x9202,
  BrightnessValue: 0x9203,
  ExposureBiasValue: 0x9204,
  MaxApertureValue: 0x9205,
  SubjectDistance: 0x9206,
  MeteringMode: 0x9207,
  LightSource: 0x9208,
  Flash: 0x9209,
  FocalLength: 0x920a,
  SubjectArea: 0x9214,
  UserComment: 0x9286,
  SubSecTime: 0x9290,
  SubSecTimeOriginal: 0x9291,
  SubSecTimeDigitized: 0x9292,
  FlashpixVersion: 0xa000,
  ColorSpace: 0xa001,
  PixelXDimension: 0xa002,
  PixelYDimension: 0xa003,
  FocalPlaneXResolution: 0xa20e,
  FocalPlaneYResolution: 0xa20f,
  FocalPlaneResolutionUnit: 0xa210,
  ExposureIndex: 0xa215,
  SensingMethod: 0xa217,
  FileSource: 0xa300,
  SceneType: 0xa301,
  CustomRendered: 0xa401,
  ExposureMode: 0xa402,
  WhiteBalance: 0xa403,
  DigitalZoomRatio: 0xa404,
  FocalLengthIn35mmFilm: 0xa405,
  SceneCaptureType: 0xa406,
  GainControl: 0xa407,
  Contrast: 0xa408,
  Saturation: 0xa409,
  Sharpness: 0xa40a,
  SubjectDistanceRange: 0xa40c,
  ImageUniqueID: 0xa420,
  CameraOwnerName: 0xa430,
  BodySerialNumber: 0xa431,
  LensSpecification: 0xa432,
  LensMake: 0xa433,
  LensModel: 0xa434,
  LensSerialNumber: 0xa435,
} as const;

/** TIFF 字段类型码 */
export const EXIF_TYPE = {
  BYTE: 1,
  ASCII: 2,
  SHORT: 3,
  LONG: 4,
  RATIONAL: 5,
  UNDEFINED: 7,
  SLONG: 9,
  SRATIONAL: 10,
} as const;

/** 每个类型单个值的字节数；不在这张表里的类型一律跳过（长度不可信，不能猜） */
const TYPE_SIZES: Readonly<Record<number, number>> = {
  1: 1, // BYTE
  2: 1, // ASCII
  3: 2, // SHORT
  4: 4, // LONG
  5: 8, // RATIONAL（两个 LONG）
  6: 1, // SBYTE
  7: 1, // UNDEFINED
  8: 2, // SSHORT
  9: 4, // SLONG
  10: 8, // SRATIONAL（两个 SLONG）
  11: 4, // FLOAT
  12: 8, // DOUBLE
};

/** 一个 IFD 里最多认多少个条目；超了就当文件坏了，别拿脏数据去分配内存 */
const MAX_IFD_ENTRIES = 512;

/** JPEG APP1 的长度字段是 16 位，装得下的最大载荷 */
const MAX_APP1_PAYLOAD = 0xffff - 2;

// ---------------------------------------------------------------------------
// 标签模型
// ---------------------------------------------------------------------------

/**
 * 一个 EXIF 标签。
 *
 * `data` 是**值的原始字节**，不是解析后的数字：RATIONAL 要保持分子分母的精确比，
 * UNDEFINED（如 `ExifVersion`）本来就是字节串。解析成数字再写回去会引入舍入。
 *
 * **字节序已经归一化成小端**：`samples/IMGP2971.DNG` 的容器是 `MM` 大端，若把它的
 * 数值字节原样抄进我们小端的输出块，每个 SHORT/LONG/RATIONAL 都会被字节反转——
 * 连 `ExifOffset` 自己都会指错。所以 `readIfd` 出口就把数值类型翻成小端，
 * 下游（`readScalar` / `filterWhitelist` / `encodeExifBlock`）才能一致地按小端处理。
 */
export interface ExifTag {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array;
}

/** 一块 EXIF 的两个 IFD：IFD0（图像描述）与 ExifIFD（拍摄参数） */
export interface ExifTagSet {
  ifd0: ExifTag[];
  exif: ExifTag[];
}

// ---------------------------------------------------------------------------
// 标签构造
// ---------------------------------------------------------------------------

/**
 * ASCII 值的定长字节：EXIF 的 ASCII 以 NUL 结尾。
 *
 * `& 0xff` 是按 **Latin-1** 取字节：相机写进来的字符串基本是 ASCII，偶尔带 Latin-1
 * 重音字符（é = U+00E9 → 0xE9）也是对的。代价是 **U+00FF 以上的码位（中文等）无法往返**，
 * 会被截成一个不相干的单字节。EXIF 的 ASCII 类型本身只认 7 位，非 ASCII 文本在规范里该走
 * `UserComment`（UNDEFINED + 字符集前缀），这里不做那套转换，只是不留假象。
 */
function asciiBytes(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length + 1);
  for (let index = 0; index < value.length; index++) {
    bytes[index] = value.charCodeAt(index) & 0xff;
  }
  return bytes;
}

/** 字节 → 字符串（每字节一个码位），读 ASCII 标签用 */
function bytesToAscii(bytes: Uint8Array): string {
  let value = '';
  for (const byte of bytes) value += String.fromCharCode(byte);
  return value;
}

/** 去掉 ASCII 值尾部的 NUL 与空格填充 */
function trimAsciiBytes(data: Uint8Array): Uint8Array {
  let end = data.length;
  while (end > 0 && (data[end - 1] === 0x00 || data[end - 1] === 0x20)) end -= 1;
  return data.subarray(0, end);
}

export function asciiTag(tag: number, value: string): ExifTag {
  const bytes = asciiBytes(value);
  return { tag, type: EXIF_TYPE.ASCII, count: bytes.length, data: bytes };
}

/**
 * `DataView.setUint16/32` 对超范围的值是**静默取模**，不是抛错。所以这里自己夹住：
 * 一个被悄悄改小的 ISO（扩展感光度能到十万以上，SHORT 装不下）比一个缺失的字段更坏
 * ——它看着像真的。缺字段至少是诚实的。
 */
function clampToType(value: number, type: number): number {
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.min(Math.round(value), type === EXIF_TYPE.SHORT ? 0xffff : 0xffffffff);
}

function numberTag(tag: number, type: number, unit: number, values: number[]): ExifTag {
  const data = new Uint8Array(values.length * unit);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => {
    const clamped = clampToType(value, type);
    if (type === EXIF_TYPE.SHORT) view.setUint16(index * unit, clamped, true);
    else view.setUint32(index * unit, clamped, true);
  });
  return { tag, type, count: values.length, data };
}

export function shortTag(tag: number, value: number | number[]): ExifTag {
  return numberTag(tag, EXIF_TYPE.SHORT, 2, Array.isArray(value) ? value : [value]);
}

export function longTag(tag: number, value: number | number[]): ExifTag {
  return numberTag(tag, EXIF_TYPE.LONG, 4, Array.isArray(value) ? value : [value]);
}

/** 无符号有理数：分子/分母对 */
export function rationalTag(
  tag: number,
  value:
    { numerator: number; denominator: number } | Array<{ numerator: number; denominator: number }>,
  signed = false,
): ExifTag {
  const pairs = Array.isArray(value) ? value : [value];
  const data = new Uint8Array(pairs.length * 8);
  const view = new DataView(data.buffer);
  pairs.forEach((pair, index) => {
    const at = index * 8;
    if (signed) {
      // SRATIONAL 本来就允许负数，所以只夹不取模
      view.setInt32(at, Number.isFinite(pair.numerator) ? Math.round(pair.numerator) : 0, true);
      view.setInt32(
        at + 4,
        Number.isFinite(pair.denominator) ? Math.round(pair.denominator) : 0,
        true,
      );
    } else {
      view.setUint32(at, clampToType(pair.numerator, EXIF_TYPE.LONG), true);
      view.setUint32(at + 4, clampToType(pair.denominator, EXIF_TYPE.LONG), true);
    }
  });
  return {
    tag,
    type: signed ? EXIF_TYPE.SRATIONAL : EXIF_TYPE.RATIONAL,
    count: pairs.length,
    data,
  };
}

// ---------------------------------------------------------------------------
// 读：TIFF 系 RAW 容器 / EXIF 块
// ---------------------------------------------------------------------------

interface TiffHeader {
  littleEndian: boolean;
  firstIfdOffset: number;
}

function makeView(bytes: Uint8Array): DataView {
  return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** 认 TIFF 头：`II`/`MM` + 42 + 首 IFD 偏移。认不出来就返回 null，不抛 */
function readTiffHeader(bytes: Uint8Array): TiffHeader | null {
  if (bytes.length < 8) return null;

  let littleEndian: boolean;
  if (bytes[0] === 0x49 && bytes[1] === 0x49) littleEndian = true;
  else if (bytes[0] === 0x4d && bytes[1] === 0x4d) littleEndian = false;
  else return null;

  const view = makeView(bytes);
  if (view.getUint16(2, littleEndian) !== 42) return null;
  return { littleEndian, firstIfdOffset: view.getUint32(4, littleEndian) };
}

/** 文件头是不是 TIFF（用来避免为 CR3/RAF 白读一遍整个文件） */
export function isTiffContainer(bytes: Uint8Array): boolean {
  return readTiffHeader(bytes) !== null;
}

/** 把一个数值类型的值字节从大端翻成小端；字节序无关的类型原样返回 */
function toLittleEndian(data: Uint8Array, type: number): Uint8Array {
  const reverse = (copy: Uint8Array, at: number, width: number): void => {
    for (let index = 0; index < width >> 1; index++) {
      const left = at + index;
      const right = at + width - 1 - index;
      const swap = copy[left];
      copy[left] = copy[right];
      copy[right] = swap;
    }
  };

  const copy = data.slice();
  switch (type) {
    case EXIF_TYPE.SHORT:
    case 8: // SSHORT
      for (let at = 0; at + 1 < copy.length; at += 2) reverse(copy, at, 2);
      break;
    case EXIF_TYPE.LONG:
    case EXIF_TYPE.SLONG:
    case 11: // FLOAT
      for (let at = 0; at + 3 < copy.length; at += 4) reverse(copy, at, 4);
      break;
    case EXIF_TYPE.RATIONAL:
    case EXIF_TYPE.SRATIONAL:
      // 一个有理数是两个 4 字节整数，各自翻转，不是整 8 字节倒序
      for (let at = 0; at + 7 < copy.length; at += 8) {
        reverse(copy, at, 4);
        reverse(copy, at + 4, 4);
      }
      break;
    case 12: // DOUBLE
      for (let at = 0; at + 7 < copy.length; at += 8) reverse(copy, at, 8);
      break;
    default:
      // BYTE / ASCII / UNDEFINED / SBYTE：一个字节，没有字节序
      break;
  }
  return copy;
}

/**
 * 读一个 IFD 的全部条目。
 *
 * 读不动就跳过那一条而不是整份作废：真实 RAW 里 IFD0 会带一些我们既不认识、偏移也
 * 可能落在文件外的厂商条目（`SubIFDs`/`DNGPrivateData` 之类），为它们丢掉整份拍摄信息
 * 是划不来的。IFD 自己的偏移或条目表被截断才算这份 IFD 不可信。
 */
function readIfd(
  view: DataView,
  bytes: Uint8Array,
  littleEndian: boolean,
  offset: number,
): ExifTag[] | null {
  if (offset < 0 || offset + 2 > bytes.length) return null;

  const count = view.getUint16(offset, littleEndian);
  if (count > MAX_IFD_ENTRIES) return null;

  const tags: ExifTag[] = [];
  for (let index = 0; index < count; index++) {
    const at = offset + 2 + index * 12;
    if (at + 12 > bytes.length) return null;

    const tag = view.getUint16(at, littleEndian);
    const type = view.getUint16(at + 2, littleEndian);
    const units = view.getUint32(at + 4, littleEndian);
    const unitSize = TYPE_SIZES[type];
    if (unitSize === undefined) continue;

    const size = unitSize * units;
    if (!Number.isSafeInteger(size) || size < 0) continue;

    let data: Uint8Array;
    if (size <= 4) {
      // 值直接内联在那 4 个字节里
      data = bytes.subarray(at + 8, at + 8 + size);
    } else {
      const valueAt = view.getUint32(at + 8, littleEndian);
      if (valueAt + size > bytes.length) continue;
      data = bytes.subarray(valueAt, valueAt + size);
    }

    tags.push({
      tag,
      type,
      count: units,
      data: littleEndian ? data.slice() : toLittleEndian(data, type),
    });
  }

  return tags;
}

/** 取一个 LONG/SHORT 标量标签的值（用于跟随 ExifOffset 这类结构指针） */
function readScalar(tags: readonly ExifTag[], tag: number): number | null {
  const entry = tags.find((item) => item.tag === tag);
  if (!entry || entry.count < 1 || entry.data.length < 1) return null;
  const view = makeView(entry.data);
  if (entry.type === EXIF_TYPE.SHORT) return view.getUint16(0, true);
  if (entry.type === EXIF_TYPE.LONG || entry.type === EXIF_TYPE.SLONG)
    return view.getUint32(0, true);
  return null;
}

/**
 * 从一个 TIFF 结构的字节里读 IFD0 与 ExifIFD。
 *
 * 传进来的可以是整个 RAW 文件（TIFF 系容器的头就在 byte 0），也可以是一段 APP1 的
 * TIFF 块。读不出 TIFF 头就返回 null。
 */
export function readTiffExifTags(bytes: Uint8Array): ExifTagSet | null {
  const header = readTiffHeader(bytes);
  if (!header) return null;

  const view = makeView(bytes);
  const ifd0 = readIfd(view, bytes, header.littleEndian, header.firstIfdOffset);
  if (!ifd0) return null;

  const exifOffset = readScalar(ifd0, EXIF_TAG.ExifOffset);
  const exif =
    exifOffset === null ? [] : (readIfd(view, bytes, header.littleEndian, exifOffset) ?? []);

  return { ifd0, exif };
}

/**
 * 读一个 ASCII 标签的值（去尾部填充）。
 *
 * 顺带说一个**没有**在这里做的判断：LibRaw 在预览不带 APP1 时会自己合成一条最小块，
 * `Software` 写成 `dcraw v<版本>`（`research/exif-export-facts.md` §1.5），看着像原块
 * 其实只有一半字段。那个判别只对「从预览 APP1 取」有意义——容器里不会有 LibRaw 在内存里
 * 合成的东西。留到真的接预览来源时再加；现在放在这里，只会把 dcraw 导出的 RAW 那份
 * 合法的容器 IFD0 误判掉。
 */
export function findAscii(tags: readonly ExifTag[], tag: number): string | null {
  const entry = tags.find((item) => item.tag === tag);
  if (!entry || entry.type !== EXIF_TYPE.ASCII) return null;
  return bytesToAscii(trimAsciiBytes(entry.data));
}

// ---------------------------------------------------------------------------
// 筛：白名单 + 按导出图的事实归一化
// ---------------------------------------------------------------------------

/**
 * IFD0 里允许搬运的标签。
 *
 * 不收 `ImageWidth`/`ImageLength`：DNG 的 IFD0 里那两个是 160×120 的小预览尺寸，
 * 搬进导出文件就是错的，导出尺寸另有 `PixelXDimension`/`PixelYDimension`。
 * 也不收 `ExifOffset`/`GPSInfo`——结构指针由序列化器自己写。
 */
const IFD0_WHITELIST: ReadonlySet<number> = new Set([
  EXIF_TAG.ImageDescription,
  EXIF_TAG.Make,
  EXIF_TAG.Model,
  EXIF_TAG.Orientation,
  EXIF_TAG.XResolution,
  EXIF_TAG.YResolution,
  EXIF_TAG.ResolutionUnit,
  EXIF_TAG.Software,
  EXIF_TAG.DateTime,
  EXIF_TAG.Artist,
  EXIF_TAG.Copyright,
]);

/**
 * ExifIFD 里允许搬运的标签。
 *
 * 这份表 = G1 列的字段 + **同一批语义的相邻字段**。多出来的那几个是有意的，不是漏审：
 * `ShutterSpeedValue`/`ApertureValue`/`BrightnessValue`/`MaxApertureValue` 是曝光三要素的
 * APEX 派生写法（同一件事的另一种记法，相机常只写其中一种），`SubjectDistance` 与
 * `ExposureIndex` 同属「拍摄时的物理量与测光结果」。需求是「保留原拍摄信息」，
 * 它们本来就是原拍摄信息的一部分，丢掉只会让保真度变低。
 *
 * 不收 `MakerNote`(0x927c)：ExifTool 自己都把它当整块处理、还要 `-fixBase` 修内部偏移
 * （`research/exif-export-facts.md` §1.6/§1.8），搬到新块里内偏移多半失效。宁可不带，
 * 也不带一份坏的。
 * 不收 `InteropOffset`(0xa005)：Interop IFD 只有版本号，没有保留价值。
 * 不收 `PixelXDimension`/`PixelYDimension`：它们描述的是导出图，必须按实际输出尺寸重写。
 */
const EXIF_WHITELIST: ReadonlySet<number> = new Set([
  EXIF_TAG.ExposureTime,
  EXIF_TAG.FNumber,
  EXIF_TAG.ExposureProgram,
  EXIF_TAG.ISO,
  EXIF_TAG.ExifVersion,
  EXIF_TAG.DateTimeOriginal,
  EXIF_TAG.DateTimeDigitized,
  EXIF_TAG.ShutterSpeedValue,
  EXIF_TAG.ApertureValue,
  EXIF_TAG.BrightnessValue,
  EXIF_TAG.ExposureBiasValue,
  EXIF_TAG.MaxApertureValue,
  EXIF_TAG.SubjectDistance,
  EXIF_TAG.MeteringMode,
  EXIF_TAG.LightSource,
  EXIF_TAG.Flash,
  EXIF_TAG.FocalLength,
  EXIF_TAG.SubjectArea,
  EXIF_TAG.UserComment,
  EXIF_TAG.SubSecTime,
  EXIF_TAG.SubSecTimeOriginal,
  EXIF_TAG.SubSecTimeDigitized,
  EXIF_TAG.FlashpixVersion,
  EXIF_TAG.ColorSpace,
  EXIF_TAG.FocalPlaneXResolution,
  EXIF_TAG.FocalPlaneYResolution,
  EXIF_TAG.FocalPlaneResolutionUnit,
  EXIF_TAG.ExposureIndex,
  EXIF_TAG.SensingMethod,
  EXIF_TAG.FileSource,
  EXIF_TAG.SceneType,
  EXIF_TAG.CustomRendered,
  EXIF_TAG.ExposureMode,
  EXIF_TAG.WhiteBalance,
  EXIF_TAG.DigitalZoomRatio,
  EXIF_TAG.FocalLengthIn35mmFilm,
  EXIF_TAG.SceneCaptureType,
  EXIF_TAG.GainControl,
  EXIF_TAG.Contrast,
  EXIF_TAG.Saturation,
  EXIF_TAG.Sharpness,
  EXIF_TAG.SubjectDistanceRange,
  EXIF_TAG.ImageUniqueID,
  EXIF_TAG.CameraOwnerName,
  EXIF_TAG.BodySerialNumber,
  EXIF_TAG.LensSpecification,
  EXIF_TAG.LensMake,
  EXIF_TAG.LensModel,
  EXIF_TAG.LensSerialNumber,
]);

/**
 * 容器取不到时用来补字段的标量。
 *
 * 这就是 G1 说的「LibRaw 字段兜底」：CR3/RAF/X3F 没有可解析的 TIFF 头，或者容器里
 * 压根没写某项时，用它顶上。不覆盖容器已经给出的值。
 */
export interface ExifFallback {
  make?: string;
  model?: string;
  software?: string;
  artist?: string;
  description?: string;
  lensModel?: string;
  lensMake?: string;
  lensSerial?: string;
  bodySerial?: string;
  /** ISO 感光度 */
  iso?: number;
  /** 快门时间，秒 */
  shutter?: number;
  /** 光圈 F 值 */
  aperture?: number;
  /** 物理焦距，毫米 */
  focalLength?: number;
  /** 35mm 等效焦距 */
  focalLength35mm?: number;
  /** 拍摄时间（毫秒） */
  timestamp?: number;
}

/** 导出图自身的事实：像素绑定字段要按它写 */
export type ExportExifFacts = Size;

/** 白名单过滤，并把 ASCII 值尾部的 NUL/空格填充去掉 */
function filterWhitelist(tags: readonly ExifTag[], whitelist: ReadonlySet<number>): ExifTag[] {
  const kept: ExifTag[] = [];
  for (const entry of tags) {
    if (!whitelist.has(entry.tag)) continue;
    if (entry.type !== EXIF_TYPE.ASCII) {
      kept.push(entry);
      continue;
    }
    // ASCII 值在文件里常带定长填充（"PENTAX             "），去掉再写
    kept.push(asciiTag(entry.tag, bytesToAscii(trimAsciiBytes(entry.data))));
  }
  return kept;
}

/** 补一项 ASCII 字段：容器没给、兜底源有值才写 */
function fillAscii(target: ExifTag[], tag: number, value: string | undefined): void {
  if (!value) return;
  if (target.some((entry) => entry.tag === tag)) return;
  target.push(asciiTag(tag, value));
}

/** 补一项 SHORT 字段 */
function fillShort(target: ExifTag[], tag: number, value: number | undefined): void {
  if (!value || !Number.isFinite(value) || value <= 0) return;
  if (target.some((entry) => entry.tag === tag)) return;
  target.push(shortTag(tag, Math.round(value)));
}

/** 补一项 RATIONAL 字段 */
function fillRational(
  target: ExifTag[],
  tag: number,
  value: { numerator: number; denominator: number } | undefined,
): void {
  if (!value || value.denominator === 0) return;
  if (target.some((entry) => entry.tag === tag)) return;
  target.push(rationalTag(tag, value));
}

/** 约分 */
function reduce(
  numerator: number,
  denominator: number,
): { numerator: number; denominator: number } {
  const gcd = (a: number, b: number): number => (b === 0 ? a : gcd(b, a % b));
  const divisor = gcd(numerator, denominator) || 1;
  return {
    numerator: Math.round(numerator / divisor),
    denominator: Math.round(denominator / divisor),
  };
}

/**
 * 快门时间（秒）→ EXIF 有理数。
 *
 * 相机写的是 1/250 这种，不是 0.004：`ExposureTime` 的分子习惯取 1。
 * 长曝光（≥1 秒）反过来把分母取 1，也是一样的道理。
 */
export function exposureRational(seconds: number): { numerator: number; denominator: number } {
  if (!Number.isFinite(seconds) || seconds <= 0) return { numerator: 1, denominator: 1 };
  if (seconds < 1) {
    const inverse = Math.round(1 / seconds);
    if (inverse > 1 && Math.abs(1 / inverse - seconds) < seconds * 1e-3) {
      return { numerator: 1, denominator: inverse };
    }
    return reduce(Math.round(seconds * 10_000), 10_000);
  }
  return reduce(Math.round(seconds * 1000), 1000);
}

/** 光圈 F 值 → EXIF 有理数（相机习惯写成 80/10 这种一位小数） */
export function apertureRational(fNumber: number): { numerator: number; denominator: number } {
  if (!Number.isFinite(fNumber) || fNumber <= 0) return { numerator: 1, denominator: 1 };
  return reduce(Math.round(fNumber * 10), 10);
}

/** 焦距（毫米）→ EXIF 有理数 */
export function focalLengthRational(millimetres: number): {
  numerator: number;
  denominator: number;
} {
  if (!Number.isFinite(millimetres) || millimetres <= 0) return { numerator: 1, denominator: 1 };
  return reduce(Math.round(millimetres * 100), 100);
}

/** 时间戳（毫秒）→ EXIF 的 `YYYY:MM:DD HH:MM:SS`，按本地时间 */
export function formatExifDateTime(timestamp: number): string {
  const date = new Date(timestamp);
  const pad = (value: number): string => String(value).padStart(2, '0');
  return (
    `${date.getFullYear()}:${pad(date.getMonth() + 1)}:${pad(date.getDate())} ` +
    `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`
  );
}

/**
 * 把容器读到的标签与 LibRaw 兜底字段合成一份可写的标签集。
 *
 * 归一化（G1 第 3 条）是这里的重点：导出的像素是**重渲染后的新像素**，尺寸可能被长边
 * 档位缩过，方向也已经不是原文件里那个方向了。所以：
 *
 * - `Orientation` 一律写 1；
 * - `PixelXDimension`/`PixelYDimension` 写导出后的实际尺寸：否则报错尺寸；
 * - 不写 IFD1 内嵌缩略图：否则看图软件显示的是原图缩略图；
 * - 不写 GPS：本样本的 GPS 只有版本号，同时避免导出文件默认外泄位置。
 *
 * **为什么 RAW 的像素出来就已经摆正了**（写 1 的前提）：LibRaw 的 `user_flip` 是
 * `dcraw_process` 的参数，文档写的默认值是 `-1`，即「取 RAW 里的对应值」
 * （<https://www.libraw.org/docs/API-datastruct-eng.html>，`libraw_output_params_t.user_flip`）。
 * 解码路径（`raw-decoder.worker.ts`）从头到尾没有设过它，所以 `dcrawProcess()` 会按原文件的
 * 方向把像素转正，我们拿到的 `dcrawMakeMemImage()` 已经是摆正的。
 *
 * 注意别把它和常规格式那条路混了：`image-loader.ts` 的 `imageOrientation: 'from-image'`
 * 只在 `loadStandard`（非 RAW）里，RAW 走 `loadRaw`，压根不经过浏览器解码器。
 *
 * 残留的不确定：本仓库唯一的样本 `samples/IMGP2971.DNG` 的 `getFlip()` 是 0，所以
 * 「需要旋转的 RAW」这一档没有实测覆盖，只有 LibRaw 文档支撑。README 的已知限制里记着。
 */
export function composeExifTags(
  container: ExifTagSet | null,
  fallback: ExifFallback | null,
  facts: ExportExifFacts,
): ExifTagSet {
  const ifd0 = container ? filterWhitelist(container.ifd0, IFD0_WHITELIST) : [];
  const exif = container ? filterWhitelist(container.exif, EXIF_WHITELIST) : [];

  // 容器里那份 Orientation 说的是原图，导出图已经摆正，所以先摘掉再统一写 1
  const withoutOrientation = ifd0.filter((entry) => entry.tag !== EXIF_TAG.Orientation);
  withoutOrientation.push(shortTag(EXIF_TAG.Orientation, 1));

  if (fallback) {
    fillAscii(withoutOrientation, EXIF_TAG.Make, fallback.make);
    fillAscii(withoutOrientation, EXIF_TAG.Model, fallback.model);
    // G1 第 5 条：Software 保留原值，不写成工具名
    fillAscii(withoutOrientation, EXIF_TAG.Software, fallback.software);
    fillAscii(withoutOrientation, EXIF_TAG.Artist, fallback.artist);
    fillAscii(withoutOrientation, EXIF_TAG.ImageDescription, fallback.description);
    if (fallback.timestamp) {
      fillAscii(withoutOrientation, EXIF_TAG.DateTime, formatExifDateTime(fallback.timestamp));
      fillAscii(exif, EXIF_TAG.DateTimeOriginal, formatExifDateTime(fallback.timestamp));
      fillAscii(exif, EXIF_TAG.DateTimeDigitized, formatExifDateTime(fallback.timestamp));
    }
    fillShort(exif, EXIF_TAG.ISO, fallback.iso);
    fillRational(
      exif,
      EXIF_TAG.ExposureTime,
      fallback.shutter ? exposureRational(fallback.shutter) : undefined,
    );
    fillRational(
      exif,
      EXIF_TAG.FNumber,
      fallback.aperture ? apertureRational(fallback.aperture) : undefined,
    );
    fillRational(
      exif,
      EXIF_TAG.FocalLength,
      fallback.focalLength ? focalLengthRational(fallback.focalLength) : undefined,
    );
    fillShort(exif, EXIF_TAG.FocalLengthIn35mmFilm, fallback.focalLength35mm);
    fillAscii(exif, EXIF_TAG.LensModel, fallback.lensModel);
    fillAscii(exif, EXIF_TAG.LensMake, fallback.lensMake);
    fillAscii(exif, EXIF_TAG.LensSerialNumber, fallback.lensSerial);
    fillAscii(exif, EXIF_TAG.BodySerialNumber, fallback.bodySerial);
  }

  // 像素绑定字段按导出图重写：容器里那份说的是原图
  const withoutPixelSize = exif.filter(
    (entry) => entry.tag !== EXIF_TAG.PixelXDimension && entry.tag !== EXIF_TAG.PixelYDimension,
  );
  withoutPixelSize.push(longTag(EXIF_TAG.PixelXDimension, Math.round(facts.width)));
  withoutPixelSize.push(longTag(EXIF_TAG.PixelYDimension, Math.round(facts.height)));

  return { ifd0: withoutOrientation, exif: withoutPixelSize };
}

// ---------------------------------------------------------------------------
// 写：序列化成自足的 TIFF 块
// ---------------------------------------------------------------------------

interface Layout {
  ifd0At: number;
  ifd0Size: number;
  exifAt: number;
  exifSize: number;
  valuesAt: number;
  total: number;
}

function align2(value: number): number {
  return value % 2 === 0 ? value : value + 1;
}

function ifdSize(entryCount: number): number {
  return entryCount === 0 ? 0 : 2 + entryCount * 12 + 4;
}

/**
 * 排布：TIFF 头（8 字节）→ IFD0 → 可选的 ExifIFD → 值区。
 *
 * IFD0 里要多放一条 `ExifOffset` 结构指针，所以条目数是标签数 +1（有 ExifIFD 时）。
 * 值区从偶数偏移开始：EXIF 里 SHORT/RATIONAL 的对齐虽然不强制，偶数是通行做法。
 */
function layoutIfds(ifd0Count: number, exifCount: number): Layout {
  const ifd0At = 8;
  const hasExifIfd = exifCount > 0;
  const ifd0Size = ifdSize(ifd0Count + (hasExifIfd ? 1 : 0));
  const exifAt = hasExifIfd ? align2(ifd0At + ifd0Size) : 0;
  const exifSize = hasExifIfd ? ifdSize(exifCount) : 0;
  const valuesAt = align2(ifd0At + ifd0Size + exifSize);
  return { ifd0At, ifd0Size, exifAt, exifSize, valuesAt, total: valuesAt };
}

/** 一个待写入 IFD 的条目：`data` 为 null 时用 `inline` 直接填那 4 个字节（结构指针） */
interface IfdWriteEntry {
  tag: number;
  type: number;
  count: number;
  data: Uint8Array | null;
  inline: number;
}

/** 写一个 IFD：条目按标签号升序（EXIF 规范要求），值超过 4 字节就落到值区 */
function writeIfd(
  view: DataView,
  out: Uint8Array,
  tags: readonly ExifTag[],
  ifdAt: number,
  extra: readonly IfdWriteEntry[],
  cursor: { at: number },
): void {
  const entries: IfdWriteEntry[] = [
    ...tags.map((entry) => ({
      tag: entry.tag,
      type: entry.type,
      count: entry.count,
      data: entry.data,
      inline: 0,
    })),
    ...extra,
  ].sort((a, b) => a.tag - b.tag);

  view.setUint16(ifdAt, entries.length, true);

  entries.forEach((entry, index) => {
    const at = ifdAt + 2 + index * 12;
    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, entry.count, true);

    if (entry.data === null) {
      view.setUint32(at + 8, entry.inline, true);
      return;
    }
    if (entry.data.length <= 4) {
      out.set(entry.data, at + 8);
      return;
    }

    cursor.at = align2(cursor.at);
    view.setUint32(at + 8, cursor.at, true);
    out.set(entry.data, cursor.at);
    cursor.at += entry.data.length;
  });

  // 下一个 IFD 偏移：写 0，明确表示没有 IFD1（也就没有内嵌缩略图）
  view.setUint32(ifdAt + 2 + entries.length * 12, 0, true);
}

/**
 * 序列化成一块**自足的 TIFF 块**（字节序 `II` 小端）。
 *
 * 返回的是裸 TIFF 块：JPEG 要在外面套 `FFE1` + 长度 + `"Exif\0\0"`，PNG 的 `eXIf`
 * 载荷则正好就是它（`research/exif-export-facts.md` §4）。
 *
 * 所有值都被重新排布并重算偏移，所以不会留下指向原文件任何位置的引用——这正是
 * 「挑标签重新序列化」相对「整段照搬」的意义。
 */
export function encodeExifBlock(tags: ExifTagSet): Uint8Array {
  const ifd0 = [...tags.ifd0].sort((a, b) => a.tag - b.tag);
  const exif = [...tags.exif].sort((a, b) => a.tag - b.tag);
  const hasExifIfd = exif.length > 0;

  const layout = layoutIfds(ifd0.length, exif.length);
  const valueBytes = [...ifd0, ...exif].reduce(
    (total, entry) => total + (entry.data.length > 4 ? align2(entry.data.length) : 0),
    0,
  );

  const out = new Uint8Array(layout.total + valueBytes);
  const view = makeView(out);

  // TIFF 头：字节序 + 42 + 首 IFD 偏移
  out[0] = 0x49;
  out[1] = 0x49;
  view.setUint16(2, 42, true);
  view.setUint32(4, layout.ifd0At, true);

  const cursor = { at: layout.valuesAt };
  writeIfd(
    view,
    out,
    ifd0,
    layout.ifd0At,
    hasExifIfd
      ? [
          {
            tag: EXIF_TAG.ExifOffset,
            type: EXIF_TYPE.LONG,
            count: 1,
            data: null,
            inline: layout.exifAt,
          },
        ]
      : [],
    cursor,
  );
  if (hasExifIfd) writeIfd(view, out, exif, layout.exifAt, [], cursor);

  return out;
}

// ---------------------------------------------------------------------------
// 写：注入容器
// ---------------------------------------------------------------------------

/** 从 SOI 之后开始枚举 JPEG 的标记段（不进入扫描数据） */
function jpegSegments(bytes: Uint8Array): Array<{ marker: number; start: number; end: number }> {
  const segments: Array<{ marker: number; start: number; end: number }> = [];
  let at = 2;

  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    // 无载荷的标记：填充、TEM、RSTn
    if (marker === 0xff || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    // SOS 之后是熵编码数据，标记扫描到此为止
    if (marker === 0xda || marker === 0xd9) break;

    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    if (length < 2) break;
    const end = at + 2 + length;
    if (end > bytes.length) break;
    segments.push({ marker, start: at, end });
    at = end;
  }

  return segments;
}

function hasExifIdentifier(bytes: Uint8Array, at: number): boolean {
  return (
    bytes[at] === 0x45 &&
    bytes[at + 1] === 0x78 &&
    bytes[at + 2] === 0x69 &&
    bytes[at + 3] === 0x66 &&
    bytes[at + 4] === 0x00 &&
    bytes[at + 5] === 0x00
  );
}

/**
 * 把 TIFF 块包成 APP1 段后插进 JPEG。
 *
 * 位置：`APP0`(JFIF) 在的时候插在它**后面**，否则紧跟 `SOI`。
 * 两份规范在这里是冲突的——JFIF 要求 APP0 紧跟 SOI，CIPA DC-008 要求 APP1 紧跟 SOI。
 * canvas 编码出来的 JPEG 带 JFIF APP0，所以让 APP0 保持第一位、EXIF 做第一条 APP1：
 * 两边各让一步，而 EXIF 读者本来就是在标记序列里找 APP1，不看它排第几。
 *
 * 已经存在的 Exif APP1 会被换掉，不会留下两条。
 */
export function injectExifIntoJpeg(bytes: Uint8Array, block: Uint8Array): Uint8Array {
  if (bytes.length < 2 || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw new Error('不是 JPEG：缺少 SOI');
  }
  if (block.length + 6 > MAX_APP1_PAYLOAD) {
    throw new Error(`EXIF 块太大，装不进 APP1: ${block.length} 字节`);
  }

  const segments = jpegSegments(bytes);
  const kept = segments.filter(
    (segment) => !(segment.marker === 0xe1 && hasExifIdentifier(bytes, segment.start + 4)),
  );

  const app1 = new Uint8Array(4 + 6 + block.length);
  app1[0] = 0xff;
  app1[1] = 0xe1;
  const app1Length = 2 + 6 + block.length;
  app1[2] = (app1Length >> 8) & 0xff;
  app1[3] = app1Length & 0xff;
  app1.set([0x45, 0x78, 0x69, 0x66, 0x00, 0x00], 4);
  app1.set(block, 10);

  const leadingApp0 = kept[0]?.marker === 0xe0 ? kept[0] : null;

  const pieces: Uint8Array[] = [bytes.subarray(0, 2)];
  if (leadingApp0) pieces.push(bytes.subarray(leadingApp0.start, leadingApp0.end));
  pieces.push(app1);

  for (const segment of kept) {
    if (segment === leadingApp0) continue;
    pieces.push(bytes.subarray(segment.start, segment.end));
  }

  // 标记扫描停住之后的字节（SOS 的熵编码数据、EOI）原样接回，不静默丢数据
  const scannedTo = segments.length ? segments[segments.length - 1].end : 2;
  if (scannedTo < bytes.length) pieces.push(bytes.subarray(scannedTo));

  return concatBytes(pieces);
}

/** PNG 的 CRC32（多项式 0xedb88320），chunk 的 type + data 都要算 */
let crcTable: Uint32Array | null = null;

function crc32(bytes: Uint8Array): number {
  if (!crcTable) {
    crcTable = new Uint32Array(256);
    for (let index = 0; index < 256; index++) {
      let value = index;
      for (let bit = 0; bit < 8; bit++) {
        value = value & 1 ? 0xedb88320 ^ (value >>> 1) : value >>> 1;
      }
      crcTable[index] = value >>> 0;
    }
  }

  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc = crcTable[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

const PNG_SIGNATURE = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

/** 把若干片段接成一个新数组；JPEG 与 PNG 两条注入路径都要做这一步 */
function concatBytes(pieces: readonly Uint8Array[]): Uint8Array {
  const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const piece of pieces) {
    out.set(piece, cursor);
    cursor += piece.length;
  }
  return out;
}

/** 造一条完整的 PNG chunk：长度 + 类型 + 数据 + CRC */
function pngChunk(type: string, data: Uint8Array): Uint8Array {
  const out = new Uint8Array(12 + data.length);
  const view = makeView(out);
  view.setUint32(0, data.length, false);

  const typeBytes = new Uint8Array(4);
  for (let index = 0; index < 4; index++) typeBytes[index] = type.charCodeAt(index);
  out.set(typeBytes, 4);
  out.set(data, 8);

  const crcInput = new Uint8Array(4 + data.length);
  crcInput.set(typeBytes, 0);
  crcInput.set(data, 4);
  view.setUint32(8 + data.length, crc32(crcInput), false);
  return out;
}

/**
 * 把裸 TIFF 块写成 `eXIf` chunk 插进 PNG。
 *
 * 两条约束来自规范（`research/exif-export-facts.md` §4）：`eXIf` 的载荷就是裸 Exif
 * profile，**不含** APP1 标记、长度与 `"Exif\0\0"`；且只能有一条。PNG 第三版还要求
 * 影响方向的 Exif 排在图像数据**之前**，所以固定在 `IHDR` 之后插入。
 */
export function injectExifIntoPng(bytes: Uint8Array, block: Uint8Array): Uint8Array {
  for (let index = 0; index < PNG_SIGNATURE.length; index++) {
    if (bytes[index] !== PNG_SIGNATURE[index]) throw new Error('不是 PNG：签名不匹配');
  }

  const chunks: Array<{ type: string; start: number; end: number }> = [];
  let at = PNG_SIGNATURE.length;
  const view = makeView(bytes);

  while (at + 12 <= bytes.length) {
    const length = view.getUint32(at, false);
    const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
    const end = at + 12 + length;
    if (end > bytes.length) break;
    chunks.push({ type, start: at, end });
    at = end;
    if (type === 'IEND') break;
  }

  const ihdr = chunks.find((chunk) => chunk.type === 'IHDR');
  if (!ihdr) throw new Error('不是 PNG：找不到 IHDR');

  // 规范只允许一条 eXIf，所以先把旧的摘掉再插新的
  const exifChunk = pngChunk('eXIf', block);
  const pieces: Uint8Array[] = [PNG_SIGNATURE];

  for (const chunk of chunks) {
    if (chunk.type === 'eXIf') continue;
    pieces.push(bytes.subarray(chunk.start, chunk.end));
    // PNG 第三版要求影响方向的 Exif 排在图像数据之前，所以固定紧跟 IHDR
    if (chunk.type === 'IHDR') pieces.push(exifChunk);
  }

  // 扫描提前中断时剩下的字节原样接回去，不静默丢数据
  if (at < bytes.length) pieces.push(bytes.subarray(at));

  return concatBytes(pieces);
}

// ---------------------------------------------------------------------------
// 对外的一步到位接口
// ---------------------------------------------------------------------------

/**
 * 能承载 EXIF 的导出容器。
 *
 * 这是「可导出格式」的**唯一定义处**：`export.ts` 的 `ExportFormat` 直接 alias 到这里，
 * 免得同一组字符串写两遍。WebP 在集合里但按 G1 不写（见 `attachRawExif`）。
 */
export type ExifContainerFormat = 'jpeg' | 'png' | 'webp';

export type ExifAttachStatus =
  /** 已经写进去了 */
  | 'attached'
  /** 这份来源里没有可写的拍摄信息 */
  | 'unavailable'
  /** 这个容器格式按当前决定不写 EXIF */
  | 'unsupported'
  /** 写的过程中出错，已降级成不带 EXIF 的原图 */
  | 'failed';

/** 原拍摄 EXIF 的来源 */
export interface RawExifSource {
  /** RAW 文件自身的字节；只有 TIFF 系容器用得上，其他情况为 null */
  containerBytes?: Uint8Array | null;
  /** 容器取不到时用来补字段的标量 */
  fallback?: ExifFallback | null;
}

/**
 * 除了归一化必然写进去的那几项（`Orientation` 与两个像素尺寸）之外，还有没有真正的拍摄信息。
 *
 * 直接数条目数会得到 `ifd0.length <= 1 && exif.length <= 2` 这种魔数，读的人得回去
 * 数 composeExifTags 到底必写几项才知道它在问什么；按标签问就一目了然。
 */
function hasShootingInfo(tags: ExifTagSet): boolean {
  return (
    tags.ifd0.some((entry) => entry.tag !== EXIF_TAG.Orientation) ||
    tags.exif.some(
      (entry) => entry.tag !== EXIF_TAG.PixelXDimension && entry.tag !== EXIF_TAG.PixelYDimension,
    )
  );
}

/**
 * 把原拍摄 EXIF 写进编码好的图片字节。
 *
 * 失败**不抛**：导出照常出图，状态如实回报，让面板能说出「这次没带上 EXIF」。
 * 一张没有元数据的图总好过导不出来。
 */
export function attachRawExif(
  bytes: Uint8Array,
  format: ExifContainerFormat,
  source: RawExifSource | null | undefined,
  facts: ExportExifFacts,
): { bytes: Uint8Array; status: ExifAttachStatus } {
  if (format === 'webp') return { bytes, status: 'unsupported' };

  try {
    const container = source?.containerBytes ? readTiffExifTags(source.containerBytes) : null;
    const fallback = source?.fallback ?? null;

    if (!container && !fallback) return { bytes, status: 'unavailable' };

    const tags = composeExifTags(container, fallback, facts);
    // 一个拍摄字段都没有：写出去只会多一条空壳，不如不写
    if (!hasShootingInfo(tags)) return { bytes, status: 'unavailable' };

    const block = encodeExifBlock(tags);
    const injected =
      format === 'jpeg' ? injectExifIntoJpeg(bytes, block) : injectExifIntoPng(bytes, block);
    return { bytes: injected, status: 'attached' };
  } catch {
    return { bytes, status: 'failed' };
  }
}

/** 从 LibRaw 解码出的拍摄信息里取 EXIF 兜底字段 */
export function toExifFallback(metadata: RawMetadata | null): ExifFallback | null {
  if (!metadata) return null;
  return {
    make: metadata.make || undefined,
    model: metadata.model || undefined,
    software: metadata.software || undefined,
    artist: metadata.artist || undefined,
    description: metadata.description || undefined,
    lensModel: metadata.lensModel || undefined,
    lensMake: metadata.lensMake || undefined,
    lensSerial: metadata.lensSerial || undefined,
    bodySerial: metadata.bodySerial || undefined,
    iso: metadata.iso || undefined,
    shutter: metadata.shutter || undefined,
    aperture: metadata.aperture || undefined,
    focalLength: metadata.focalLength || undefined,
    focalLength35mm: metadata.focalLength35mm || undefined,
    timestamp: metadata.timestamp || undefined,
  };
}

/**
 * 收集一次导出的 EXIF 来源。
 *
 * TIFF 系容器要整份文件才能跟随 IFD 偏移（`samples/IMGP2971.DNG` 的 ExifIFD 在 104 KB 处，
 * 值又散在它后面），所以先探 16 个字节的头：不是 TIFF 就完全不去读文件，
 * CR3/RAF 这类容器不该为一条注定为 null 的路径把几十兆读一遍。
 */
export async function collectRawExifSource(
  file: Blob,
  fallback: ExifFallback | null,
): Promise<RawExifSource> {
  let containerBytes: Uint8Array | null = null;

  try {
    const head = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (isTiffContainer(head)) {
      containerBytes = new Uint8Array(await file.arrayBuffer());
    }
  } catch {
    // 读不到文件不该让导出失败：退化成只用 LibRaw 字段
    containerBytes = null;
  }

  return { containerBytes, fallback };
}
