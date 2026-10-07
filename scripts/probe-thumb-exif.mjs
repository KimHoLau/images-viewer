#!/usr/bin/env node
/**
 * 开发用的实测脚本（不是产品代码，没有被任何入口引用）：看一个 RAW 的内嵌预览里
 * 到底有没有**原始的 EXIF APP1 段**。
 *
 * 为什么需要实测：LibRaw 的 `dcraw_make_mem_thumb()` 用 `memcmp(T.thumb + 6, "Exif\0", 5)`
 * 判断预览是否自带 APP1——命中就把原段原样透传，未命中就只合成一个很瘦的最小块。
 * 这条 if/else 只证明两种情况都存在，不证明**当前这份样本**是哪种，而「原样提取」这条路
 * 成立与否全看它（见 research/exif-export-facts.md §1.4/§1.5）。
 *
 * 跑法：
 *   node scripts/probe-thumb-exif.mjs samples/IMGP2971.DNG
 *   node scripts/probe-thumb-exif.mjs samples/IMGP2971.DNG --json   # 只打一行 JSON
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LibRaw } from '@colorhythm/libraw-wasm';

const args = process.argv.slice(2);
const jsonOnly = args.includes('--json');
const fileArg = args.find((arg) => !arg.startsWith('--')) ?? 'samples/IMGP2971.DNG';
const filePath = resolve(process.cwd(), fileArg);

/** EXIF/TIFF 标签名，只收本次要判读的那些（够回答「覆盖了哪些字段」） */
const TAG_NAMES = {
  0x0100: 'ImageWidth',
  0x0101: 'ImageLength',
  0x010e: 'ImageDescription',
  0x010f: 'Make',
  0x0110: 'Model',
  0x0112: 'Orientation',
  0x011a: 'XResolution',
  0x011b: 'YResolution',
  0x0128: 'ResolutionUnit',
  0x0131: 'Software',
  0x0132: 'DateTime',
  0x013b: 'Artist',
  0x0111: 'StripOffsets',
  0x0115: 'SamplesPerPixel',
  0x0116: 'RowsPerStrip',
  0x0117: 'StripByteCounts',
  0x011c: 'PlanarConfiguration',
  0x014a: 'SubIFDs',
  0x8298: 'Copyright',
  0x83bb: 'IPTC',
  0x8649: 'Photoshop',
  0x8773: 'ICCProfile',
  0xc612: 'DNGVersion',
  0xc613: 'DNGBackwardVersion',
  0xc614: 'UniqueCameraModel',
  0xc615: 'LocalizedCameraModel',
  0xc62f: 'CameraSerialNumber',
  0xc634: 'DNGPrivateData',
  0xc65a: 'CalibrationIlluminant1',
  0xc65b: 'CalibrationIlluminant2',
  0xc68b: 'OriginalRawFileName',
  0xc68d: 'ActiveArea',
  0x0201: 'ThumbnailOffset',
  0x0202: 'ThumbnailLength',
  0x0213: 'YCbCrPositioning',
  0x829a: 'ExposureTime',
  0x829d: 'FNumber',
  0x8769: 'ExifOffset',
  0x8822: 'ExposureProgram',
  0x8825: 'GPSInfo',
  0x8827: 'ISOSpeedRatings',
  0x9000: 'ExifVersion',
  0x9003: 'DateTimeOriginal',
  0x9004: 'DateTimeDigitized',
  0x9101: 'ComponentsConfiguration',
  0x9201: 'ShutterSpeedValue',
  0x9202: 'ApertureValue',
  0x9203: 'BrightnessValue',
  0x9204: 'ExposureBiasValue',
  0x9205: 'MaxApertureValue',
  0x9207: 'MeteringMode',
  0x9209: 'Flash',
  0x920a: 'FocalLength',
  0x927c: 'MakerNote',
  0x9286: 'UserComment',
  0x9290: 'SubSecTime',
  0x9291: 'SubSecTimeOriginal',
  0x9292: 'SubSecTimeDigitized',
  0xa000: 'FlashpixVersion',
  0xa001: 'ColorSpace',
  0xa002: 'PixelXDimension',
  0xa003: 'PixelYDimension',
  0xa005: 'InteropOffset',
  0xa20e: 'FocalPlaneXResolution',
  0xa20f: 'FocalPlaneYResolution',
  0xa210: 'FocalPlaneResolutionUnit',
  0xa217: 'SensingMethod',
  0xa300: 'FileSource',
  0xa301: 'SceneType',
  0xa401: 'CustomRendered',
  0xa402: 'ExposureMode',
  0xa403: 'WhiteBalance',
  0xa405: 'FocalLengthIn35mmFilm',
  0xa406: 'SceneCaptureType',
  0xa420: 'ImageUniqueID',
  0xa431: 'BodySerialNumber',
  0xa432: 'LensSpecification',
  0xa433: 'LensMake',
  0xa434: 'LensModel',
  0xa435: 'LensSerialNumber',
};

const TYPE_SIZES = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 6: 1, 7: 1, 8: 2, 9: 4, 10: 8, 11: 4, 12: 8 };

const hex = (bytes, from, to) =>
  Array.from(bytes.slice(from, to), (b) => b.toString(16).padStart(2, '0')).join(' ');

const ascii = (bytes, from, to) =>
  Array.from(bytes.slice(from, to), (b) =>
    b >= 32 && b < 127 ? String.fromCharCode(b) : '.',
  ).join('');

/** 一个 IFD 的标签清单：名字、类型、条数、原始值摘要 */
function readIfd(view, bytes, tiffStart, ifdOffset, limit = 256) {
  const tags = [];
  let at = tiffStart + ifdOffset;
  if (at + 2 > bytes.length) return { tags, nextOffset: 0 };

  const count = view.getUint16(at, view.littleEndian);
  at += 2;
  for (let i = 0; i < Math.min(count, limit); i++) {
    if (at + 12 > bytes.length) break;
    const tag = view.getUint16(at, view.littleEndian);
    const type = view.getUint16(at + 2, view.littleEndian);
    const num = view.getUint32(at + 4, view.littleEndian);
    const size = (TYPE_SIZES[type] ?? 1) * num;
    const inline = size <= 4;
    const valueAt = inline ? at + 8 : tiffStart + view.getUint32(at + 8, view.littleEndian);

    const entry = {
      tag: `0x${tag.toString(16).padStart(4, '0')}`,
      name: TAG_NAMES[tag] ?? '?',
      type,
      count: num,
    };

    if (type === 2 && valueAt + num <= bytes.length) {
      entry.value = ascii(bytes, valueAt, valueAt + Math.max(0, num - 1));
    } else if ((type === 3 || type === 4) && num <= 4 && valueAt + 4 <= bytes.length) {
      const values = [];
      for (let n = 0; n < num; n++) {
        values.push(
          type === 3
            ? view.getUint16(valueAt + n * 2, view.littleEndian)
            : view.getUint32(valueAt + n * 4, view.littleEndian),
        );
      }
      entry.value = values.length === 1 ? values[0] : values;
    } else {
      entry.value = `bytes[${size}] @${valueAt} ${hex(bytes, valueAt, Math.min(valueAt + 8, bytes.length))}`;
    }
    tags.push(entry);
    at += 12;
  }

  const nextOffset = at + 4 <= bytes.length ? view.getUint32(at, view.littleEndian) : 0;
  return { tags, nextOffset };
}

/** 解析一个自带的 TIFF 块（从它自己的 byte 0 数偏移） */
function parseTiff(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const order = view.getUint16(0, false);
  if (order !== 0x4949 && order !== 0x4d4d) throw new Error('不是 TIFF 块：字节序标记无效');
  view.littleEndian = order === 0x4949;
  const magic = view.getUint16(2, view.littleEndian);
  const firstIfd = view.getUint32(4, view.littleEndian);

  const result = {
    byteOrder: order === 0x4949 ? 'II (little-endian)' : 'MM (big-endian)',
    magic,
    firstIfd,
    ifd0: [],
    subIfds: [],
    exifIfd: [],
    gpsIfd: [],
    ifd1: [],
  };

  const ifd0 = readIfd(view, bytes, 0, firstIfd);
  result.ifd0 = ifd0.tags;

  const find = (tags, tag) => tags.find((entry) => entry.tag === tag);
  const exifOffset = find(ifd0.tags, '0x8769')?.value;
  const gpsOffset = find(ifd0.tags, '0x8825')?.value;
  if (typeof exifOffset === 'number') result.exifIfd = readIfd(view, bytes, 0, exifOffset).tags;
  if (typeof gpsOffset === 'number') result.gpsIfd = readIfd(view, bytes, 0, gpsOffset).tags;
  if (ifd0.nextOffset) result.ifd1 = readIfd(view, bytes, 0, ifd0.nextOffset).tags;

  // SubIFD（DNG 的原始像素与第二预览常挂在这里）
  const subIfdEntry = find(ifd0.tags, '0x014a');
  const subOffsets = Array.isArray(subIfdEntry?.value) ? subIfdEntry.value : [];
  for (const subOffset of subOffsets.slice(0, 6)) {
    const sub = readIfd(view, bytes, 0, subOffset);
    result.subIfds.push({ offset: subOffset, tags: sub.tags });
  }

  return result;
}

const hasExifId = (bytes, at) =>
  bytes[at] === 0x45 &&
  bytes[at + 1] === 0x78 &&
  bytes[at + 2] === 0x69 &&
  bytes[at + 3] === 0x66 &&
  bytes[at + 4] === 0x00 &&
  bytes[at + 5] === 0x00;

/** 在 JPEG 字节流里顺着 marker 找 APP1（FFE1），返回每一段的载荷 */
function findApp1Segments(bytes) {
  const found = [];
  if (bytes[0] !== 0xff || bytes[1] !== 0xd8) return found;
  let at = 2;
  while (at + 4 <= bytes.length) {
    if (bytes[at] !== 0xff) break;
    const marker = bytes[at + 1];
    if (marker === 0xd8 || marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) {
      at += 2;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) break; // 到了扫描数据就停
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const payloadAt = at + 4;
    const payloadEnd = at + 2 + length;
    found.push({
      marker: `0xFF${marker.toString(16).padStart(2, '0').toUpperCase()}`,
      at,
      length,
      payloadAt,
      payload: bytes.slice(payloadAt, payloadEnd),
    });
    at = payloadEnd;
  }
  return found;
}

function section(tags) {
  return tags.map((entry) => ({
    tag: entry.tag,
    name: entry.name,
    value: entry.value,
  }));
}

async function main() {
  const buffer = readFileSync(filePath);
  await LibRaw.initialize();
  const decoder = new LibRaw();
  await decoder.waitUntilReady();

  const report = { file: fileArg, bytes: buffer.byteLength };

  try {
    decoder.open(buffer);
    report.flip = decoder.getFlip();
    const info = decoder.getThumbnail();
    report.thumbnail = {
      tformat: info.tformat,
      twidth: info.twidth,
      theight: info.theight,
      tlength: info.tlength,
      tcolors: info.tcolors,
    };

    decoder.unpackThumb();
    const thumb = decoder.dcrawMakeMemThumb();
    report.memThumb = {
      type_: thumb.type_,
      width: thumb.width,
      height: thumb.height,
      colors: thumb.colors,
      bits: thumb.bits,
      data_size: thumb.data_size,
    };

    const bytes = thumb.data;
    report.firstBytes = hex(bytes, 0, 24);
    report.asciiAt6 = ascii(bytes, 6, 16);
    report.hasExifApp1At6 = hasExifId(bytes, 6);

    const app1s = findApp1Segments(bytes);
    report.jpegMarkers = app1s.map((segment) => ({
      marker: segment.marker,
      at: segment.at,
      length: segment.length,
      ascii: ascii(segment.payload, 0, 12),
    }));

    const exifSegment = app1s.find((segment) => hasExifId(segment.payload, 0));
    if (exifSegment) {
      report.app1 = {
        at: exifSegment.at,
        length: exifSegment.length,
        payloadBytes: exifSegment.payload.length,
      };
      const tiff = exifSegment.payload.slice(6);
      report.tiffBytes = tiff.length;
      const parsed = parseTiff(tiff);
      report.byteOrder = parsed.byteOrder;
      report.ifd0 = section(parsed.ifd0);
      report.exifIfd = section(parsed.exifIfd);
      report.gpsIfd = section(parsed.gpsIfd);
      report.ifd1 = section(parsed.ifd1);
    }

    report.iparams = (({ make, model, normalized_make, normalized_model, software, xmplen }) => ({
      make,
      model,
      normalized_make,
      normalized_model,
      software,
      xmplen,
    }))(decoder.getIParams());

    const lens = decoder.getLensInfo();
    report.lensInfo = (({
      Lens,
      LensMake,
      LensSerial,
      FocalLengthIn35mmFormat,
      CurFocal,
      CurAp,
    }) => ({
      Lens,
      LensMake,
      LensSerial,
      FocalLengthIn35mmFormat,
      CurFocal,
      CurAp,
    }))(lens);

    report.shootingInfo = (({
      MeteringMode,
      ExposureMode,
      ExposureProgram,
      BodySerial,
      FocusMode,
    }) => ({
      MeteringMode,
      ExposureMode,
      ExposureProgram,
      BodySerial,
      FocusMode,
    }))(decoder.getShootingInfo());

    const other = decoder.getImgOther();
    report.imgOther = (({ iso_speed, shutter, aperture, focal_len, timestamp, desc, artist }) => ({
      iso_speed,
      shutter,
      aperture,
      focal_len,
      timestamp: String(timestamp),
      desc,
      artist,
    }))(other);
    report.gps = other.parsed_gps;
  } finally {
    decoder.dispose();
  }

  // 容器自身的 IFD：TIFF 系 RAW（DNG/NEF/ARW/CR2/PEF/SRW/ORF/RW2）的表头就在文件 byte 0。
  // 这条路的结论决定「原样提取」还能不能从容器里走通，而不是只从预览里。
  if (!args.includes('--no-container')) {
    try {
      const parsed = parseTiff(buffer);
      report.container = {
        byteOrder: parsed.byteOrder,
        magic: parsed.magic,
        firstIfd: parsed.firstIfd,
        ifd0: section(parsed.ifd0),
        exifIfd: section(parsed.exifIfd),
        gpsIfd: section(parsed.gpsIfd),
        ifd1: section(parsed.ifd1),
        subIfds: parsed.subIfds.map((sub) => ({ offset: sub.offset, tags: section(sub.tags) })),
      };

      // 容器里那份预览（SubIFD 的 StripOffsets/StripByteCounts）的真实字节：
      // 这是「预览自带 APP1 与否」的最终判据，比 LibRaw 的合成标记更直接。
      for (const sub of parsed.subIfds) {
        const offsets = sub.tags.find((entry) => entry.tag === '0x0111')?.value;
        const counts = sub.tags.find((entry) => entry.tag === '0x0117')?.value;
        if (typeof offsets !== 'number' || typeof counts !== 'number') continue;
        const head = buffer.subarray(offsets, offsets + 32);
        if (head[0] !== 0xff || head[1] !== 0xd8) continue;
        const segment = findApp1Segments(buffer.subarray(offsets, offsets + counts))[0];
        report.containerPreview = {
          fileOffset: offsets,
          byteCount: counts,
          head: hex(head, 0, 24),
          exifIdAt6: hasExifId(buffer, offsets + 6),
          firstSegment: segment
            ? {
                marker: segment.marker,
                length: segment.length,
                ascii: ascii(segment.payload, 0, 12),
              }
            : null,
        };
      }
    } catch (error) {
      report.container = { error: error.message };
    }
  }

  if (jsonOnly) {
    console.log(JSON.stringify(report));
    return;
  }
  console.log(JSON.stringify(report, null, 2));
}

await main();
