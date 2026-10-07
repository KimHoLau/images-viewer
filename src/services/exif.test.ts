import { describe, expect, it } from 'vitest';
import {
  apertureRational,
  attachRawExif,
  collectRawExifSource,
  composeExifTags,
  encodeExifBlock,
  EXIF_TAG,
  EXIF_TYPE,
  exposureRational,
  findAscii,
  focalLengthRational,
  formatExifDateTime,
  injectExifIntoJpeg,
  injectExifIntoPng,
  isTiffContainer,
  longTag,
  readTiffExifTags,
  rationalTag,
  shortTag,
  toExifFallback,
} from './exif';
import { makeRawMetadata } from '../test/fixtures';

// ---------------------------------------------------------------------------
// 测试侧的 TIFF 构造器
//
// 刻意**不复用** exif.ts 的序列化器：拿被测代码造夹具，读写两头一起错也照样通过。
// 这里按 TIFF 规范独立摆一遍字节，才能证明读的那一半认得真实文件的结构。
// ---------------------------------------------------------------------------

interface TagSpec {
  tag: number;
  type: number;
  values?: number[];
  rationals?: Array<[number, number]>;
  text?: string;
  bytes?: Uint8Array;
}

const SPEC_UNIT_SIZES: Record<number, number> = { 1: 1, 2: 1, 3: 2, 4: 4, 5: 8, 7: 1 };

function specCount(spec: TagSpec): number {
  if (spec.text !== undefined) return spec.text.length + 1;
  if (spec.bytes) return spec.bytes.length;
  if (spec.rationals) return spec.rationals.length;
  return spec.values?.length ?? 0;
}

function specBytes(spec: TagSpec, littleEndian: boolean): Uint8Array {
  if (spec.text !== undefined) {
    const bytes = new Uint8Array(spec.text.length + 1);
    for (let index = 0; index < spec.text.length; index++) {
      bytes[index] = spec.text.charCodeAt(index);
    }
    return bytes;
  }
  if (spec.bytes) return spec.bytes;

  const values = spec.values ?? [];
  const unit = SPEC_UNIT_SIZES[spec.type] ?? 1;
  const data = new Uint8Array(values.length * unit);
  const view = new DataView(data.buffer);
  values.forEach((value, index) => {
    if (spec.type === EXIF_TYPE.SHORT) view.setUint16(index * 2, value, littleEndian);
    else if (spec.type === EXIF_TYPE.LONG) view.setUint32(index * 4, value, littleEndian);
    else data[index] = value; // 未知类型码按单字节占位，够读出结构即可
  });
  return data;
}

function specRationalBytes(spec: TagSpec, littleEndian: boolean): Uint8Array {
  const pairs = spec.rationals ?? [];
  const data = new Uint8Array(pairs.length * 8);
  const view = new DataView(data.buffer);
  pairs.forEach(([numerator, denominator], index) => {
    view.setUint32(index * 8, numerator, littleEndian);
    view.setUint32(index * 8 + 4, denominator, littleEndian);
  });
  return data;
}

/** 按 TIFF 规范摆一个容器：头 + IFD0 + ExifIFD + 值区 */
function buildContainer(ifd0: TagSpec[], exif: TagSpec[], littleEndian = true): Uint8Array {
  const ifd0At = 8;
  const exifAt = ifd0At + 2 + (ifd0.length + (exif.length ? 1 : 0)) * 12 + 4;
  const exifSize = exif.length ? 2 + exif.length * 12 + 4 : 0;

  // ExifOffset 由构造器补，值就是 ExifIFD 的偏移
  const entries0 = [
    ...ifd0,
    ...(exif.length ? [{ tag: EXIF_TAG.ExifOffset, type: EXIF_TYPE.LONG, values: [exifAt] }] : []),
  ].sort((a, b) => a.tag - b.tag);
  const entries1 = [...exif].sort((a, b) => a.tag - b.tag);

  let valueAt = exifAt + exifSize;
  if (valueAt % 2 === 1) valueAt += 1;

  const plan = (entries: TagSpec[]) =>
    entries.map((spec) => {
      const data =
        spec.type === EXIF_TYPE.RATIONAL
          ? specRationalBytes(spec, littleEndian)
          : specBytes(spec, littleEndian);
      if (data.length <= 4) return { spec, data, offset: -1 };
      const offset = valueAt;
      valueAt += data.length;
      if (valueAt % 2 === 1) valueAt += 1;
      return { spec, data, offset };
    });

  const plan0 = plan(entries0);
  const plan1 = plan(entries1);
  const out = new Uint8Array(valueAt);
  const view = new DataView(out.buffer);

  if (littleEndian) {
    out[0] = 0x49;
    out[1] = 0x49;
  } else {
    out[0] = 0x4d;
    out[1] = 0x4d;
  }
  view.setUint16(2, 42, littleEndian);
  view.setUint32(4, ifd0At, littleEndian);

  const writeIfd = (plans: ReturnType<typeof plan>, at: number): void => {
    view.setUint16(at, plans.length, littleEndian);
    plans.forEach((entry, index) => {
      const entryAt = at + 2 + index * 12;
      view.setUint16(entryAt, entry.spec.tag, littleEndian);
      view.setUint16(entryAt + 2, entry.spec.type, littleEndian);
      view.setUint32(entryAt + 4, specCount(entry.spec), littleEndian);
      if (entry.offset < 0) {
        out.set(entry.data, entryAt + 8);
      } else {
        view.setUint32(entryAt + 8, entry.offset, littleEndian);
        out.set(entry.data, entry.offset);
      }
    });
    // 没有 IFD1（也就没有内嵌缩略图）
    view.setUint32(at + 2 + plans.length * 12, 0, littleEndian);
  };

  writeIfd(plan0, ifd0At);
  if (exif.length) writeIfd(plan1, exifAt);
  return out;
}

/**
 * 照 `samples/IMGP2971.DNG` 实测出来的结构做一份夹具（见 #36 的实测评论）：
 * 大端、IFD0 挂着 ExifIFD、还带着一批必须被丢掉的容器专属标签。
 */
function pentaxLikeContainer(): Uint8Array {
  return buildContainer(
    [
      { tag: 0x0100, type: EXIF_TYPE.LONG, values: [160] }, // ImageWidth（DNG 里是小预览尺寸）
      { tag: 0x0101, type: EXIF_TYPE.LONG, values: [120] }, // ImageLength
      { tag: 0x010f, type: EXIF_TYPE.ASCII, text: 'PENTAX             ' },
      { tag: 0x0110, type: EXIF_TYPE.ASCII, text: 'PENTAX K-30        ' },
      { tag: 0x0111, type: EXIF_TYPE.LONG, values: [104480] }, // StripOffsets，指向块外
      { tag: 0x0112, type: EXIF_TYPE.SHORT, values: [1] },
      { tag: 0x011a, type: EXIF_TYPE.RATIONAL, rationals: [[300, 1]] },
      { tag: 0x011b, type: EXIF_TYPE.RATIONAL, rationals: [[300, 1]] },
      { tag: 0x0128, type: EXIF_TYPE.SHORT, values: [2] },
      { tag: 0x0131, type: EXIF_TYPE.ASCII, text: 'K-30 Ver 1.06          ' },
      { tag: 0x0132, type: EXIF_TYPE.ASCII, text: '2026:10:05 13:16:28' },
      { tag: 0x013b, type: EXIF_TYPE.ASCII, text: 'KIMHO' },
      { tag: 0x014a, type: EXIF_TYPE.LONG, values: [103370, 103776] }, // SubIFDs
      { tag: 0x8298, type: EXIF_TYPE.ASCII, text: 'KIMHO' },
      { tag: 0x8825, type: EXIF_TYPE.LONG, values: [104440] }, // GPSInfo
      { tag: 0xc634, type: EXIF_TYPE.UNDEFINED, bytes: new Uint8Array(16).fill(0x50) }, // DNGPrivateData
    ],
    [
      { tag: 0x829a, type: EXIF_TYPE.RATIONAL, rationals: [[1, 250]] },
      { tag: 0x829d, type: EXIF_TYPE.RATIONAL, rationals: [[80, 10]] },
      { tag: 0x8822, type: EXIF_TYPE.SHORT, values: [3] },
      { tag: 0x8827, type: EXIF_TYPE.SHORT, values: [100] },
      { tag: 0x9003, type: EXIF_TYPE.ASCII, text: '2026:10:05 13:16:28' },
      { tag: 0x9207, type: EXIF_TYPE.SHORT, values: [5] },
      { tag: 0x9209, type: EXIF_TYPE.SHORT, values: [16] },
      { tag: 0x920a, type: EXIF_TYPE.RATIONAL, rationals: [[31, 1]] },
      { tag: 0x927c, type: EXIF_TYPE.UNDEFINED, bytes: new Uint8Array(24).fill(0x41) }, // MakerNote
      { tag: 0xa002, type: EXIF_TYPE.LONG, values: [4928] },
      { tag: 0xa003, type: EXIF_TYPE.LONG, values: [3264] },
      { tag: 0xa005, type: EXIF_TYPE.LONG, values: [1] }, // InteropOffset
      { tag: 0xa405, type: EXIF_TYPE.SHORT, values: [46] },
    ],
    false, // 大端，和真实的 IMGP2971.DNG 一样
  );
}

const FACTS = { width: 2048, height: 1365 };

/** 从 JPEG 里取出第一条 Exif APP1 的 TIFF 块（夹具侧的独立实现，不复用被测代码） */
function jpegExifTiff(bytes: Uint8Array): Uint8Array {
  let at = 2;
  while (at + 4 <= bytes.length && bytes[at] === 0xff) {
    const marker = bytes[at + 1];
    if (marker === 0xda) break;
    const length = (bytes[at + 2] << 8) | bytes[at + 3];
    const payloadAt = at + 4;
    if (marker === 0xe1 && bytes[payloadAt] === 0x45 && bytes[payloadAt + 1] === 0x78) {
      return bytes.subarray(payloadAt + 6, at + 2 + length);
    }
    at += 2 + length;
  }
  throw new Error('夹具里找不到 Exif APP1');
}

// ---------------------------------------------------------------------------

describe('readTiffExifTags', () => {
  it('读出大端容器的 IFD0 与 ExifIFD', () => {
    const tags = readTiffExifTags(pentaxLikeContainer());

    expect(tags).not.toBeNull();
    expect(findAscii(tags!.ifd0, EXIF_TAG.Make)).toBe('PENTAX');
    expect(findAscii(tags!.exif, EXIF_TAG.DateTimeOriginal)).toBe('2026:10:05 13:16:28');
  });

  it('大端的数值标签被归一化成小端，ExifOffset 才跟得下去', () => {
    // 大端容器若把数值字节原样抄进小端输出，ISO 100 会读成 25600，
    // 而 ExifOffset 自己也会指错——这条断言就是钉这个的
    const tags = readTiffExifTags(pentaxLikeContainer());
    const iso = tags!.exif.find((entry) => entry.tag === EXIF_TAG.ISO);

    expect(iso).toBeDefined();
    expect(new DataView(iso!.data.buffer, iso!.data.byteOffset).getUint16(0, true)).toBe(100);
  });

  it('小端容器同样读得出来', () => {
    const tags = readTiffExifTags(
      buildContainer(
        [{ tag: 0x010f, type: EXIF_TYPE.ASCII, text: 'Canon' }],
        [{ tag: 0x8827, type: EXIF_TYPE.SHORT, values: [400] }],
        true,
      ),
    );

    expect(findAscii(tags!.ifd0, EXIF_TAG.Make)).toBe('Canon');
    const iso = tags!.exif.find((entry) => entry.tag === EXIF_TAG.ISO);
    expect(new DataView(iso!.data.buffer, iso!.data.byteOffset).getUint16(0, true)).toBe(400);
  });

  it('认出 ExifIFD 里的长值（RATIONAL 落在值区）', () => {
    const tags = readTiffExifTags(pentaxLikeContainer());
    const exposure = tags!.exif.find((entry) => entry.tag === EXIF_TAG.ExposureTime);
    const view = new DataView(exposure!.data.buffer, exposure!.data.byteOffset);

    expect(exposure!.type).toBe(EXIF_TYPE.RATIONAL);
    expect(view.getUint32(0, true)).toBe(1);
    expect(view.getUint32(4, true)).toBe(250);
  });

  it('不是 TIFF（CR3 的 ISO-BMFF 头）返回 null', () => {
    const cr3 = new Uint8Array(32);
    cr3.set([0x00, 0x00, 0x00, 0x18], 0);
    cr3.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'

    expect(readTiffExifTags(cr3)).toBeNull();
    expect(isTiffContainer(cr3)).toBe(false);
  });

  it('太短或 magic 不对都不认', () => {
    expect(readTiffExifTags(new Uint8Array([0x49, 0x49]))).toBeNull();
    const wrongMagic = pentaxLikeContainer().slice();
    wrongMagic[3] = 0x00;
    expect(readTiffExifTags(wrongMagic)).toBeNull();
  });

  it('ExifOffset 指向文件外时只丢 ExifIFD，IFD0 照样读出来', () => {
    const bytes = buildContainer(
      [
        { tag: 0x010f, type: EXIF_TYPE.ASCII, text: 'Canon' },
        { tag: 0x8769, type: EXIF_TYPE.LONG, values: [9_999_999] },
      ],
      [],
    );

    const tags = readTiffExifTags(bytes);
    expect(findAscii(tags!.ifd0, EXIF_TAG.Make)).toBe('Canon');
    expect(tags!.exif).toEqual([]);
  });

  it('未知类型码的条目被跳过，不影响同 IFD 的其它条目', () => {
    const bytes = buildContainer(
      [
        { tag: 0x010f, type: EXIF_TYPE.ASCII, text: 'Canon' },
        { tag: 0x0100, type: 99, bytes: new Uint8Array(4) }, // 不存在的类型码
        { tag: 0x0110, type: EXIF_TYPE.ASCII, text: 'EOS R5' },
      ],
      [],
    );

    const tags = readTiffExifTags(bytes);
    expect(findAscii(tags!.ifd0, EXIF_TAG.Make)).toBe('Canon');
    expect(findAscii(tags!.ifd0, EXIF_TAG.Model)).toBe('EOS R5');
    expect(tags!.ifd0.some((entry) => entry.tag === 0x0100)).toBe(false);
  });
});

describe('composeExifTags', () => {
  const container = () => readTiffExifTags(pentaxLikeContainer())!;

  it('只搬白名单里的标签，容器专属的指针标签一个都不进', () => {
    const tags = composeExifTags(container(), null, FACTS);
    const all = [...tags.ifd0, ...tags.exif].map((entry) => entry.tag);

    for (const dropped of [
      0x0100, // ImageWidth（160×120 的小预览尺寸）
      0x0101, // ImageLength
      0x0111, // StripOffsets
      0x014a, // SubIFDs
      0x8825, // GPSInfo
      0xc634, // DNGPrivateData
      0x927c, // MakerNote
      0xa005, // InteropOffset
      0x8769, // ExifOffset，结构指针由序列化器自己写
    ]) {
      expect(all, `0x${dropped.toString(16)} 不该被搬`).not.toContain(dropped);
    }
  });

  it('拍摄字段照搬过来', () => {
    const tags = composeExifTags(container(), null, FACTS);

    expect(findAscii(tags.ifd0, EXIF_TAG.Make)).toBe('PENTAX');
    expect(findAscii(tags.ifd0, EXIF_TAG.Model)).toBe('PENTAX K-30');
    expect(findAscii(tags.ifd0, EXIF_TAG.DateTime)).toBe('2026:10:05 13:16:28');
    expect(findAscii(tags.exif, EXIF_TAG.DateTimeOriginal)).toBe('2026:10:05 13:16:28');
    expect(tags.exif.some((entry) => entry.tag === EXIF_TAG.MeteringMode)).toBe(true);
    expect(tags.exif.some((entry) => entry.tag === EXIF_TAG.Flash)).toBe(true);
    expect(tags.exif.some((entry) => entry.tag === EXIF_TAG.FocalLengthIn35mmFilm)).toBe(true);
  });

  it('去掉 ASCII 值的定长填充', () => {
    const tags = composeExifTags(container(), null, FACTS);
    const software = tags.ifd0.find((entry) => entry.tag === EXIF_TAG.Software)!;

    expect(findAscii(tags.ifd0, EXIF_TAG.Software)).toBe('K-30 Ver 1.06');
    // 尾部填充去掉后长度就是内容 + NUL
    expect(software.count).toBe('K-30 Ver 1.06'.length + 1);
  });

  it('Orientation 一律写 1，不管容器里写的是几', () => {
    const rotated = buildContainer([{ tag: 0x0112, type: EXIF_TYPE.SHORT, values: [6] }], []);
    const tags = composeExifTags(readTiffExifTags(rotated), null, FACTS);
    const orientation = tags.ifd0.find((entry) => entry.tag === EXIF_TAG.Orientation)!;
    const view = new DataView(
      orientation.data.buffer,
      orientation.data.byteOffset,
      orientation.data.byteLength,
    );

    expect(view.getUint16(0, true)).toBe(1);
  });

  it('像素尺寸按导出尺寸重写，容器里那份被丢掉', () => {
    const tags = composeExifTags(container(), null, FACTS);
    const at = (tag: number) => tags.exif.find((entry) => entry.tag === tag)!;
    const read = (data: Uint8Array) =>
      new DataView(data.buffer, data.byteOffset, data.byteLength).getUint32(0, true);

    expect(read(at(EXIF_TAG.PixelXDimension).data)).toBe(2048);
    expect(read(at(EXIF_TAG.PixelYDimension).data)).toBe(1365);
    // 原值 4928/3264 不该还留着
    expect(read(at(EXIF_TAG.PixelXDimension).data)).not.toBe(4928);
  });

  it('容器没有 Orientation 时也会补上 1', () => {
    const tags = composeExifTags(readTiffExifTags(buildContainer([], [])), null, FACTS);
    const orientation = tags.ifd0.find((entry) => entry.tag === EXIF_TAG.Orientation)!;
    const view = new DataView(
      orientation.data.buffer,
      orientation.data.byteOffset,
      orientation.data.byteLength,
    );

    expect(view.getUint16(0, true)).toBe(1);
  });

  it('容器已有的字段不被兜底源覆盖', () => {
    const tags = composeExifTags(
      container(),
      { make: 'Canon', model: 'EOS R5', iso: 6400, software: 'tool 1.0' },
      FACTS,
    );

    expect(findAscii(tags.ifd0, EXIF_TAG.Make)).toBe('PENTAX');
    expect(findAscii(tags.ifd0, EXIF_TAG.Model)).toBe('PENTAX K-30');
    expect(findAscii(tags.ifd0, EXIF_TAG.Software)).toBe('K-30 Ver 1.06');
    const iso = tags.exif.find((entry) => entry.tag === EXIF_TAG.ISO)!;
    expect(new DataView(iso.data.buffer, iso.data.byteOffset).getUint16(0, true)).toBe(100);
  });

  it('Software 保留原值，不会被写成工具名', () => {
    const tags = composeExifTags(container(), { software: 'raw-images-studio' }, FACTS);
    expect(findAscii(tags.ifd0, EXIF_TAG.Software)).toBe('K-30 Ver 1.06');
  });

  it('容器取不到时，LibRaw 兜底字段全部补上', () => {
    const tags = composeExifTags(
      null,
      {
        make: 'Canon',
        model: 'EOS R5',
        software: 'Firmware 1.2',
        artist: 'KIMHO',
        iso: 400,
        shutter: 1 / 250,
        aperture: 2.8,
        focalLength: 35,
        focalLength35mm: 35,
        lensModel: 'RF35mm F1.8',
        bodySerial: 'SN123',
        timestamp: Date.UTC(2026, 9, 5, 5, 16, 28),
      },
      FACTS,
    );

    expect(findAscii(tags.ifd0, EXIF_TAG.Make)).toBe('Canon');
    expect(findAscii(tags.ifd0, EXIF_TAG.Software)).toBe('Firmware 1.2');
    expect(findAscii(tags.ifd0, EXIF_TAG.Artist)).toBe('KIMHO');
    expect(findAscii(tags.exif, EXIF_TAG.LensModel)).toBe('RF35mm F1.8');
    expect(findAscii(tags.exif, EXIF_TAG.BodySerialNumber)).toBe('SN123');
    expect(tags.exif.some((entry) => entry.tag === EXIF_TAG.DateTimeOriginal)).toBe(true);

    const exposure = tags.exif.find((entry) => entry.tag === EXIF_TAG.ExposureTime)!;
    const view = new DataView(exposure.data.buffer, exposure.data.byteOffset);
    expect(view.getUint32(0, true)).toBe(1);
    expect(view.getUint32(4, true)).toBe(250);
  });

  it('空兜底源只会产出归一化字段', () => {
    const tags = composeExifTags(null, {}, FACTS);

    expect(tags.ifd0.map((entry) => entry.tag)).toEqual([EXIF_TAG.Orientation]);
    expect(tags.exif.map((entry) => entry.tag).sort()).toEqual([
      EXIF_TAG.PixelXDimension,
      EXIF_TAG.PixelYDimension,
    ]);
  });

  it('GPS 不写：容器里的 GPSInfo 不进输出', () => {
    const tags = composeExifTags(container(), { timestamp: 0 }, FACTS);
    expect(tags.ifd0.some((entry) => entry.tag === 0x8825)).toBe(false);
  });
});

describe('encodeExifBlock', () => {
  it('写出来的块能被自己读回来（往返一致）', () => {
    const composed = composeExifTags(readTiffExifTags(pentaxLikeContainer()), null, FACTS);
    const decoded = readTiffExifTags(encodeExifBlock(composed))!;

    expect(findAscii(decoded.ifd0, EXIF_TAG.Make)).toBe('PENTAX');
    expect(findAscii(decoded.ifd0, EXIF_TAG.Software)).toBe('K-30 Ver 1.06');
    expect(findAscii(decoded.exif, EXIF_TAG.DateTimeOriginal)).toBe('2026:10:05 13:16:28');
    // 编码时会补一条 ExifOffset 结构指针，比对时把它摘掉
    const decodedIfd0 = decoded.ifd0.filter((entry) => entry.tag !== EXIF_TAG.ExifOffset);
    expect(new Set(decodedIfd0.map((e) => e.tag))).toEqual(
      new Set(composed.ifd0.map((e) => e.tag)),
    );
    expect(new Set(decoded.exif.map((e) => e.tag))).toEqual(
      new Set(composed.exif.map((e) => e.tag)),
    );
  });

  it('所有值都落在块内，没有指向外部的引用', () => {
    const composed = composeExifTags(readTiffExifTags(pentaxLikeContainer()), null, FACTS);
    const block = encodeExifBlock(composed);

    // 每一个长值都要能在块内按偏移取到完整字节，否则就是悬空指针
    const view = new DataView(block.buffer);
    const firstIfd = view.getUint32(4, true);
    const entries = view.getUint16(firstIfd, true);

    const walk = (ifdAt: number, count: number): void => {
      for (let index = 0; index < count; index++) {
        const at = ifdAt + 2 + index * 12;
        const type = view.getUint16(at + 2, true);
        const units = view.getUint32(at + 4, true);
        const unit = SPEC_UNIT_SIZES[type] ?? 1;
        const size = unit * units;
        if (size <= 4) continue;
        const offset = view.getUint32(at + 8, true);
        expect(offset + size).toBeLessThanOrEqual(block.length);
      }
    };

    walk(firstIfd, entries);
    const exifOffsetEntry = (() => {
      for (let index = 0; index < entries; index++) {
        const at = firstIfd + 2 + index * 12;
        if (view.getUint16(at, true) === EXIF_TAG.ExifOffset) return view.getUint32(at + 8, true);
      }
      return 0;
    })();
    expect(exifOffsetEntry).toBeGreaterThan(0);
    walk(exifOffsetEntry, view.getUint16(exifOffsetEntry, true));
  });

  it('条目按标签号升序（规范要求）', () => {
    const composed = composeExifTags(readTiffExifTags(pentaxLikeContainer()), null, FACTS);
    const block = encodeExifBlock(composed);
    const decoded = readTiffExifTags(block)!;

    for (const list of [decoded.ifd0, decoded.exif]) {
      const tags = list.map((entry) => entry.tag);
      expect(tags).toEqual([...tags].sort((a, b) => a - b));
    }
  });

  it('没有 ExifIFD 时不写 ExifOffset，也不留 IFD1 指针', () => {
    // composeExifTags 总会产出像素尺寸，所以这里直接构造一份没有 ExifIFD 的标签集
    const block = encodeExifBlock({
      ifd0: [shortTag(EXIF_TAG.Orientation, 1)],
      exif: [],
    });
    const view = new DataView(block.buffer);
    const firstIfd = view.getUint32(4, true);
    const count = view.getUint16(firstIfd, true);
    const tags: number[] = [];

    for (let index = 0; index < count; index++) {
      tags.push(view.getUint16(firstIfd + 2 + index * 12, true));
    }

    expect(tags).not.toContain(EXIF_TAG.ExifOffset);
    // IFD0 之后的下一个 IFD 偏移必须是 0
    expect(view.getUint32(firstIfd + 2 + count * 12, true)).toBe(0);
  });
});

describe('数值转换', () => {
  it('快门时间写成 1/N 而不是小数', () => {
    expect(exposureRational(1 / 250)).toEqual({ numerator: 1, denominator: 250 });
    expect(exposureRational(0.004)).toEqual({ numerator: 1, denominator: 250 });
    expect(exposureRational(2)).toEqual({ numerator: 2, denominator: 1 });
  });

  it('光圈写成一位小数并约分', () => {
    expect(apertureRational(8)).toEqual({ numerator: 8, denominator: 1 });
    expect(apertureRational(2.8)).toEqual({ numerator: 14, denominator: 5 });
    expect(apertureRational(1.4)).toEqual({ numerator: 7, denominator: 5 });
  });

  it('焦距写成毫米', () => {
    expect(focalLengthRational(31)).toEqual({ numerator: 31, denominator: 1 });
  });

  it('非法值都退化成 1/1，不产出分母为 0 的有理数', () => {
    for (const bad of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(exposureRational(bad)).toEqual({ numerator: 1, denominator: 1 });
      expect(apertureRational(bad)).toEqual({ numerator: 1, denominator: 1 });
      expect(focalLengthRational(bad)).toEqual({ numerator: 1, denominator: 1 });
    }
  });

  it('时间戳格式化成 EXIF 的写法', () => {
    expect(formatExifDateTime(new Date(2026, 9, 5, 13, 16, 28).getTime())).toBe(
      '2026:10:05 13:16:28',
    );
  });

  it('toExifFallback 把空字段转成 undefined', () => {
    const fallback = toExifFallback(makeRawMetadata({ make: 'Canon', artist: '' }));

    expect(fallback!.make).toBe('Canon');
    expect(fallback!.artist).toBeUndefined();
    expect(fallback!.lensModel).toBeUndefined();
  });

  /**
   * `description` 曾经只被读进 RawMetadata 却没人往下传，`ImageDescription` 因此在
   * 最需要它的那条路（CR3/RAF/X3F，容器 IFD0 不存在）上永远补不上。
   */
  it('toExifFallback 把 description 传下去，ImageDescription 才会被写出来', () => {
    const fallback = toExifFallback(makeRawMetadata({ description: 'cat on the balcony' }));
    expect(fallback!.description).toBe('cat on the balcony');

    const tags = composeExifTags(null, fallback, FACTS);
    expect(findAscii(tags.ifd0, EXIF_TAG.ImageDescription)).toBe('cat on the balcony');
  });

  it('ASCII 标签按 Latin-1 取字节，U+00FF 以上的码位不假装能往返', () => {
    const latin1 = composeExifTags(null, { artist: 'Ren\u00e9' }, FACTS);
    expect(findAscii(latin1.ifd0, EXIF_TAG.Artist)).toBe('Ren\u00e9');
  });
});

describe('injectExifIntoJpeg', () => {
  /** 最小 JPEG：SOI + [APP0 JFIF] + SOS + 一点数据 */
  function makeJpeg(withApp0 = true): Uint8Array {
    const pieces: number[] = [0xff, 0xd8];
    if (withApp0) {
      pieces.push(0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00);
      pieces.push(0x00, 0x01, 0x00, 0x01, 0x00, 0x00); // 补到 length=16
    }
    pieces.push(0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6);
    return new Uint8Array(pieces);
  }

  const block = encodeExifBlock(composeExifTags(null, { make: 'Canon' }, FACTS));

  /** 找出所有 APP1 段 */
  function app1Segments(bytes: Uint8Array): Array<{ at: number; payload: Uint8Array }> {
    const found: Array<{ at: number; payload: Uint8Array }> = [];
    let at = 2;
    while (at + 4 <= bytes.length && bytes[at] === 0xff) {
      const marker = bytes[at + 1];
      if (marker === 0xda) break;
      const length = (bytes[at + 2] << 8) | bytes[at + 3];
      if (marker === 0xe1) {
        found.push({ at, payload: bytes.subarray(at + 4, at + 2 + length) });
      }
      at += 2 + length;
    }
    return found;
  }

  it('插进 APP1，载荷是 "Exif\\0\\0" + TIFF 块', () => {
    const out = injectExifIntoJpeg(makeJpeg(), block);
    const segments = app1Segments(out);

    expect(segments).toHaveLength(1);
    expect(Array.from(segments[0].payload.subarray(0, 6))).toEqual([0x45, 0x78, 0x69, 0x66, 0, 0]);
    expect(findAscii(readTiffExifTags(segments[0].payload.subarray(6))!.ifd0, EXIF_TAG.Make)).toBe(
      'Canon',
    );
  });

  it('长度字段把自身算进去', () => {
    const out = injectExifIntoJpeg(makeJpeg(), block);
    const at = app1Segments(out)[0].at;
    const length = (out[at + 2] << 8) | out[at + 3];

    expect(length).toBe(2 + 6 + block.length);
  });

  it('JFIF APP0 还在，且 EXIF 排在它后面', () => {
    const out = injectExifIntoJpeg(makeJpeg(true), block);

    expect(out[2]).toBe(0xff);
    expect(out[3]).toBe(0xe0);
    const segments = app1Segments(out);
    expect(segments[0].at).toBeGreaterThan(2);
  });

  it('没有 APP0 时紧跟 SOI', () => {
    const out = injectExifIntoJpeg(makeJpeg(false), block);
    expect(app1Segments(out)[0].at).toBe(2);
  });

  it('已有的 Exif APP1 被换掉，不会留下两条', () => {
    const once = injectExifIntoJpeg(makeJpeg(), block);
    const twice = injectExifIntoJpeg(
      once,
      encodeExifBlock(composeExifTags(null, { make: 'Nikon' }, FACTS)),
    );
    const segments = app1Segments(twice);

    expect(segments).toHaveLength(1);
    expect(findAscii(readTiffExifTags(segments[0].payload.subarray(6))!.ifd0, EXIF_TAG.Make)).toBe(
      'Nikon',
    );
  });

  it('扫描数据之后的内容原样保留', () => {
    const source = makeJpeg();
    const out = injectExifIntoJpeg(source, block);

    expect(Array.from(out.subarray(out.length - 6))).toEqual([1, 2, 3, 4, 5, 6]);
  });

  it('不是 JPEG 就抛错', () => {
    expect(() => injectExifIntoJpeg(new Uint8Array([0x89, 0x50]), block)).toThrow(/不是 JPEG/);
  });

  it('块大到装不进 APP1 时抛错', () => {
    expect(() => injectExifIntoJpeg(makeJpeg(), new Uint8Array(0x10000))).toThrow(/装不进 APP1/);
  });
});

describe('injectExifIntoPng', () => {
  const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];

  function chunk(type: string, data: Uint8Array): Uint8Array {
    const out = new Uint8Array(12 + data.length);
    const view = new DataView(out.buffer);
    view.setUint32(0, data.length, false);
    for (let index = 0; index < 4; index++) out[4 + index] = type.charCodeAt(index);
    out.set(data, 8);
    view.setUint32(8 + data.length, 0, false); // 夹具不校验 CRC
    return out;
  }

  function makePng(extra: Uint8Array[] = []): Uint8Array {
    const pieces = [
      new Uint8Array(PNG_SIGNATURE),
      chunk('IHDR', new Uint8Array(13)),
      ...extra,
      chunk('IDAT', new Uint8Array(8)),
      chunk('IEND', new Uint8Array(0)),
    ];
    const total = pieces.reduce((sum, piece) => sum + piece.length, 0);
    const out = new Uint8Array(total);
    let cursor = 0;
    for (const piece of pieces) {
      out.set(piece, cursor);
      cursor += piece.length;
    }
    return out;
  }

  function chunkTypes(bytes: Uint8Array): string[] {
    const types: string[] = [];
    let at = 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at, false);
      types.push(String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]));
      at += 12 + length;
    }
    return types;
  }

  /** 定位 eXIf chunk 的数据区，别拿固定偏移去猜 */
  function exifChunk(bytes: Uint8Array): { at: number; length: number; dataAt: number } {
    let at = 8;
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    while (at + 12 <= bytes.length) {
      const length = view.getUint32(at, false);
      const type = String.fromCharCode(bytes[at + 4], bytes[at + 5], bytes[at + 6], bytes[at + 7]);
      if (type === 'eXIf') return { at, length, dataAt: at + 8 };
      at += 12 + length;
    }
    throw new Error('夹具里找不到 eXIf chunk');
  }

  const block = encodeExifBlock(composeExifTags(null, { make: 'Canon' }, FACTS));

  it('eXIf 紧跟 IHDR，排在 IDAT 之前', () => {
    const out = injectExifIntoPng(makePng(), block);
    const types = chunkTypes(out);

    expect(types).toEqual(['IHDR', 'eXIf', 'IDAT', 'IEND']);
  });

  it('载荷就是裸 TIFF 块，不带 APP1 标记与 "Exif\\0\\0"', () => {
    const out = injectExifIntoPng(makePng(), block);
    const info = exifChunk(out);
    const payload = out.subarray(info.dataAt, info.dataAt + info.length);

    expect(info.length).toBe(block.length);
    // 头四字节就是 TIFF 的 II*\0
    expect(Array.from(payload.subarray(0, 4))).toEqual([0x49, 0x49, 0x2a, 0x00]);
    expect(findAscii(readTiffExifTags(payload)!.ifd0, EXIF_TAG.Make)).toBe('Canon');
  });

  it('CRC 按 type + data 算，与 crc32 对得上', () => {
    const out = injectExifIntoPng(makePng(), block);
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    const info = exifChunk(out);
    const stored = view.getUint32(info.dataAt + info.length, false);

    // 用同一张 CRC 表的独立实现核对：手算 0xedb88320 逐位版本
    let crc = 0xffffffff;
    for (const byte of out.subarray(info.at + 4, info.dataAt + info.length)) {
      crc ^= byte;
      for (let bit = 0; bit < 8; bit++) {
        crc = crc & 1 ? 0xedb88320 ^ (crc >>> 1) : crc >>> 1;
      }
    }
    expect(stored).toBe((crc ^ 0xffffffff) >>> 0);
  });

  it('已有的 eXIf 被换掉，规范只允许一条', () => {
    const once = injectExifIntoPng(makePng(), block);
    const twice = injectExifIntoPng(
      once,
      encodeExifBlock(composeExifTags(null, { make: 'Nikon' }, FACTS)),
    );

    expect(chunkTypes(twice).filter((type) => type === 'eXIf')).toHaveLength(1);
    const info = exifChunk(twice);
    expect(
      findAscii(
        readTiffExifTags(twice.subarray(info.dataAt, info.dataAt + info.length))!.ifd0,
        EXIF_TAG.Make,
      ),
    ).toBe('Nikon');
  });

  it('IHDR 之前的其它块保持原位，IHDR 与 IDAT 之间的块顺序不乱', () => {
    const out = injectExifIntoPng(makePng([chunk('sRGB', new Uint8Array(1))]), block);

    expect(chunkTypes(out)).toEqual(['IHDR', 'eXIf', 'sRGB', 'IDAT', 'IEND']);
  });

  it('不是 PNG 就抛错', () => {
    expect(() => injectExifIntoPng(new Uint8Array([0xff, 0xd8]), block)).toThrow(/不是 PNG/);
  });
});

describe('attachRawExif', () => {
  const jpeg = () => {
    const pieces = [0xff, 0xd8, 0xff, 0xda, 0x00, 0x08, 1, 2, 3, 4, 5, 6];
    return new Uint8Array(pieces);
  };
  const png = () => {
    const signature = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const out = new Uint8Array(signature.length + 12);
    out.set(signature, 0);
    const view = new DataView(out.buffer);
    view.setUint32(8, 0, false);
    out.set([0x49, 0x48, 0x44, 0x52], 12);
    return out;
  };

  it('JPEG + TIFF 容器：写进去并报 attached', () => {
    const result = attachRawExif(jpeg(), 'jpeg', { containerBytes: pentaxLikeContainer() }, FACTS);

    expect(result.status).toBe('attached');
    expect(result.bytes.length).toBeGreaterThan(jpeg().length);
    expect(findAscii(readTiffExifTags(jpegExifTiff(result.bytes))!.ifd0, EXIF_TAG.Make)).toBe(
      'PENTAX',
    );
  });

  it('PNG + TIFF 容器：写进去并报 attached', () => {
    const result = attachRawExif(png(), 'png', { containerBytes: pentaxLikeContainer() }, FACTS);
    expect(result.status).toBe('attached');
  });

  it('WebP 按 G1 不写，字节原样返回', () => {
    const source = jpeg();
    const result = attachRawExif(source, 'webp', { containerBytes: pentaxLikeContainer() }, FACTS);

    expect(result.status).toBe('unsupported');
    expect(result.bytes).toBe(source);
  });

  it('容器里的 Software 照搬，不做「是不是 LibRaw 合成块」的判断', () => {
    // 那个判别只对「从预览 APP1 取」有意义；用在容器上只会把 dcraw 导出的 RAW
    // 那份合法 IFD0 误判掉，所以这里刻意断言原值被保留
    const dcrawWritten = buildContainer(
      [
        { tag: 0x010f, type: EXIF_TYPE.ASCII, text: 'Pentax' },
        { tag: 0x0110, type: EXIF_TYPE.ASCII, text: 'K-30' },
        { tag: 0x0131, type: EXIF_TYPE.ASCII, text: 'dcraw v9.26' },
      ],
      [{ tag: 0x8827, type: EXIF_TYPE.SHORT, values: [100] }],
      true,
    );

    const result = attachRawExif(
      jpeg(),
      'jpeg',
      { containerBytes: dcrawWritten, fallback: { make: 'Canon', model: 'EOS R5' } },
      FACTS,
    );

    expect(result.status).toBe('attached');
    const tags = readTiffExifTags(jpegExifTiff(result.bytes))!;
    expect(findAscii(tags.ifd0, EXIF_TAG.Make)).toBe('Pentax');
    expect(findAscii(tags.ifd0, EXIF_TAG.Software)).toBe('dcraw v9.26');
  });

  it('没有可用来源时报 unavailable，字节不动', () => {
    const source = jpeg();
    const result = attachRawExif(source, 'jpeg', { containerBytes: null, fallback: {} }, FACTS);

    expect(result.status).toBe('unavailable');
    expect(result.bytes).toBe(source);
  });

  it('连来源都没有时报 unavailable', () => {
    expect(attachRawExif(jpeg(), 'jpeg', null, FACTS).status).toBe('unavailable');
    expect(attachRawExif(jpeg(), 'jpeg', undefined, FACTS).status).toBe('unavailable');
  });

  it('注入过程出错就降级：报 failed，导出照常出图', () => {
    const broken = new Uint8Array([1, 2, 3, 4]);
    const result = attachRawExif(broken, 'jpeg', { containerBytes: pentaxLikeContainer() }, FACTS);

    expect(result.status).toBe('failed');
    expect(result.bytes).toBe(broken);
  });
});

describe('collectRawExifSource', () => {
  it('TIFF 容器整份读进来，供跟随 IFD 偏移', async () => {
    const container = pentaxLikeContainer();
    const result = await collectRawExifSource(new Blob([container]), null);

    expect(result.containerBytes).not.toBeNull();
    expect(findAscii(readTiffExifTags(result.containerBytes!)!.ifd0, EXIF_TAG.Make)).toBe('PENTAX');
  });

  it('非 TIFF（CR3）不去读整份文件', async () => {
    const cr3 = new Uint8Array(4096);
    cr3.set([0x00, 0x00, 0x00, 0x18], 0);
    cr3.set([0x66, 0x74, 0x79, 0x70], 4);
    const file = new Blob([cr3]);

    const result = await collectRawExifSource(file, { make: 'Canon' });

    expect(result.containerBytes).toBeNull();
    expect(result.fallback).toEqual({ make: 'Canon' });
  });
});

describe('标签构造的取值夹紧', () => {
  it('多个值按小端排布', () => {
    const tag = longTag(EXIF_TAG.SubjectArea, [1, 2]);

    expect(tag.count).toBe(2);
    expect(Array.from(tag.data)).toEqual([1, 0, 0, 0, 2, 0, 0, 0]);
    expect(shortTag(EXIF_TAG.ISO, 400).data.length).toBe(2);
  });

  /**
   * `DataView.setUint16/32` 超范围是**静默取模**，不是抛错。ISO 102400 若被取模成 36864，
   * 文件里就躺着一个看着像真的假数字——比缺字段坏得多。
   */
  it('超出 SHORT 的 ISO 被夹到上限，而不是取模成另一个数', () => {
    const tag = shortTag(EXIF_TAG.ISO, 102400);
    const value = new DataView(tag.data.buffer, tag.data.byteOffset).getUint16(0, true);

    expect(value).toBe(0xffff);
    expect(value).not.toBe(102400 % 65536);
  });

  it('负数与非法值落到 0，不绕成巨大的无符号数', () => {
    const view = (tag: { data: Uint8Array }) => new DataView(tag.data.buffer, tag.data.byteOffset);

    expect(view(shortTag(EXIF_TAG.ISO, -5)).getUint16(0, true)).toBe(0);
    expect(view(longTag(EXIF_TAG.PixelXDimension, Number.NaN)).getUint32(0, true)).toBe(0);
    expect(view(longTag(EXIF_TAG.PixelXDimension, 1e12)).getUint32(0, true)).toBe(0xffffffff);
  });

  it('SRATIONAL 保留负数（曝光补偿本来就是负的）', () => {
    const tag = rationalTag(EXIF_TAG.ExposureBiasValue, { numerator: -1, denominator: 3 }, true);
    const view = new DataView(tag.data.buffer, tag.data.byteOffset);

    expect(view.getInt32(0, true)).toBe(-1);
    expect(view.getInt32(4, true)).toBe(3);
  });
});
