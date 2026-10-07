import { describe, expect, it } from 'vitest';
import { buildRawMetadata, type RawMetadataSources } from './raw-metadata';

/** 一份「什么都齐」的 getter 结果，各用例只覆盖它关心的那几项 */
function makeSources(overrides: Partial<RawMetadataSources> = {}): RawMetadataSources {
  return {
    params: {
      make: 'Canon',
      model: 'EOS R5',
      normalized_make: 'Canon',
      normalized_model: 'EOS R5',
      software: 'Firmware 1.9.0',
    },
    other: {
      iso_speed: 400,
      shutter: 0.005,
      aperture: 2.8,
      focal_len: 35,
      timestamp: 1791177388n,
      artist: 'KIMHO',
      desc: 'balcony',
    },
    lens: {
      Lens: 'RF24-70mm F2.8 L IS USM',
      LensMake: 'Canon',
      LensSerial: 'LS0001',
      FocalLengthIn35mmFormat: 35,
    },
    shooting: { BodySerial: 'SN123456' },
    image: { width: 6000, height: 4000, colors: 3 },
    ...overrides,
  };
}

describe('buildRawMetadata', () => {
  it('把四个 getter 的字段搬到 RawMetadata 上', () => {
    const metadata = buildRawMetadata(makeSources());

    expect(metadata).toMatchObject({
      width: 6000,
      height: 4000,
      colors: 3,
      make: 'Canon',
      model: 'EOS R5',
      software: 'Firmware 1.9.0',
      artist: 'KIMHO',
      description: 'balcony',
      lensModel: 'RF24-70mm F2.8 L IS USM',
      lensMake: 'Canon',
      lensSerial: 'LS0001',
      bodySerial: 'SN123456',
      iso: 400,
      shutter: 0.005,
      aperture: 2.8,
      focalLength: 35,
      focalLength35mm: 35,
    });
  });

  it('机型优先用归一化过的名字，没有才退回原始值', () => {
    const normalized = buildRawMetadata(
      makeSources({
        params: {
          make: 'PENTAX',
          model: 'PENTAX K-30',
          normalized_make: 'Pentax',
          normalized_model: 'K-30',
          software: '',
        },
      }),
    );
    expect(normalized.make).toBe('Pentax');
    expect(normalized.model).toBe('K-30');

    const raw = buildRawMetadata(
      makeSources({
        params: {
          make: 'PENTAX',
          model: 'PENTAX K-30',
          normalized_make: '',
          normalized_model: '',
          software: '',
        },
      }),
    );
    expect(raw.make).toBe('PENTAX');
    expect(raw.model).toBe('PENTAX K-30');
  });

  it('去掉 LibRaw 定长字段的尾部填充，缺字段的空串也安全', () => {
    const metadata = buildRawMetadata(
      makeSources({
        params: {
          make: 'Canon',
          model: 'EOS R5',
          normalized_make: 'Canon',
          normalized_model: 'EOS R5',
          software: 'K-30 Ver 1.06          ',
        },
        other: {
          iso_speed: 100,
          shutter: 0.004,
          aperture: 8,
          focal_len: 31,
          timestamp: 0n,
          artist: null,
          desc: undefined,
        },
        lens: { Lens: '', LensMake: '', LensSerial: '', FocalLengthIn35mmFormat: 0 },
        shooting: { BodySerial: '' },
      }),
    );

    expect(metadata.software).toBe('K-30 Ver 1.06');
    expect(metadata.artist).toBe('');
    expect(metadata.description).toBe('');
    expect(metadata.bodySerial).toBe('');
  });

  it('timestamp 从 LibRaw 的秒统一成毫秒', () => {
    expect(buildRawMetadata(makeSources()).timestamp).toBe(1791177388000);
  });

  it('缺值时落到 0 而不是 NaN', () => {
    const metadata = buildRawMetadata(
      makeSources({
        other: {
          iso_speed: Number.NaN,
          shutter: Number.NaN,
          aperture: Number.NaN,
          focal_len: Number.NaN,
          timestamp: 0n,
        },
      }),
    );

    expect(metadata.iso).toBe(0);
    expect(metadata.shutter).toBe(0);
    expect(metadata.aperture).toBe(0);
    expect(metadata.focalLength).toBe(0);
    expect(metadata.timestamp).toBe(0);
  });
});
