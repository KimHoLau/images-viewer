import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { makeFileEntry, makeRawMetadata } from '../test/fixtures';
import { ImageLoader, releaseLoadedImage, type LoadedImage } from './image-loader';

const { decode } = vi.hoisted(() => ({ decode: vi.fn() }));

vi.mock('./raw-decoder-service', () => ({
  RawDecoderService: class {
    decode = decode;
    dispose = vi.fn();
  },
}));

const metadata = makeRawMetadata();

/** 造一个可识别的位图替身，用来断言纹理来源 */
function fakeBitmap(width = 6000, height = 4000) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

/** 断言是位图并收窄类型，省得每条用例都写一遍判断 */
function expectBitmap(loaded: LoadedImage): Extract<LoadedImage, { source: 'bitmap' }> {
  if (loaded.source !== 'bitmap') throw new Error(`应当是位图，实际是 ${loaded.source}`);
  return loaded;
}

/** 断言是浮点线性并收窄类型 */
function expectLinear(loaded: LoadedImage): Extract<LoadedImage, { source: 'linear' }> {
  if (loaded.source !== 'linear') throw new Error(`应当是浮点线性，实际是 ${loaded.source}`);
  return loaded;
}

beforeEach(() => {
  decode.mockReset();
  vi.stubGlobal(
    'createImageBitmap',
    vi.fn(async () => fakeBitmap()),
  );
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('ImageLoader', () => {
  it('常规图片走浏览器解码', async () => {
    const loaded = await new ImageLoader().load(makeFileEntry('shot.jpg'));

    expect(decode).not.toHaveBeenCalled();
    expectBitmap(loaded);
    expect(loaded.metadata).toBeNull();
  });

  it('RAW 默认要 sRGB，8 位像素转成位图', async () => {
    decode.mockResolvedValue({
      format: 'rgba8',
      pixels: new Uint8ClampedArray(4),
      width: 2,
      height: 2,
      metadata,
    });

    const loaded = await new ImageLoader().load(makeFileEntry('shot.cr2'), { preview: true });

    expect(decode).toHaveBeenCalledWith(expect.anything(), {
      halfSize: true,
      useCameraWb: true,
      outputColor: 'srgb',
    });
    expectBitmap(loaded);
    expect(loaded.metadata).toEqual(metadata);
  });

  it('要 ProPhoto linear 时保留浮点，不建位图', async () => {
    const pixels = new Float32Array([0.1, 0.2, 0.3]);
    decode.mockResolvedValue({ format: 'rgb32f-linear', pixels, width: 1, height: 1, metadata });

    const loaded = await new ImageLoader().load(makeFileEntry('shot.cr2'), {
      outputColor: 'prophoto-linear',
    });

    expect(decode).toHaveBeenCalledWith(expect.anything(), {
      halfSize: false,
      useCameraWb: true,
      outputColor: 'prophoto-linear',
    });

    // 浮点数据不能塞进 ImageBitmap：8 位量化会毁掉 Log 转换要的动态范围
    const linear = expectLinear(loaded);
    expect(createImageBitmap).not.toHaveBeenCalled();
    expect(linear.linear).toEqual({ data: pixels, width: 1, height: 1 });
    expect(loaded.width).toBe(1);
    expect(loaded.height).toBe(1);
  });

  it('没指定输出色彩空间时显式要 sRGB', async () => {
    decode.mockResolvedValue({
      format: 'rgba8',
      pixels: new Uint8ClampedArray(4),
      width: 2,
      height: 2,
      metadata,
    });

    await new ImageLoader().load(makeFileEntry('shot.cr2'));

    expect(decode).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ outputColor: 'srgb' }),
    );
  });

  it('解码失败时带上文件名', async () => {
    decode.mockRejectedValue(new Error('bad raw'));

    await expect(new ImageLoader().load(makeFileEntry('broken.cr2'))).rejects.toThrow('bad raw');
  });

  it('浏览器解不了常规图片时报错带上文件名', async () => {
    vi.stubGlobal(
      'createImageBitmap',
      vi.fn(async () => {
        throw new Error('unsupported');
      }),
    );

    await expect(new ImageLoader().load(makeFileEntry('weird.heic'))).rejects.toThrow(
      /weird\.heic/,
    );
  });
});

describe('releaseLoadedImage', () => {
  it('关闭位图', async () => {
    const loaded = expectBitmap(await new ImageLoader().load(makeFileEntry('shot.jpg')));

    releaseLoadedImage(loaded);

    expect(loaded.bitmap.close).toHaveBeenCalled();
  });

  it('没有图片时不报错', () => {
    expect(() => releaseLoadedImage(null)).not.toThrow();
  });

  it('浮点数据没有可关闭的资源，不报错', async () => {
    decode.mockResolvedValue({
      format: 'rgb32f-linear',
      pixels: new Float32Array(3),
      width: 1,
      height: 1,
      metadata,
    });

    const loaded = await new ImageLoader().load(makeFileEntry('shot.cr2'), {
      outputColor: 'prophoto-linear',
    });

    expect(() => releaseLoadedImage(loaded)).not.toThrow();
  });
});
