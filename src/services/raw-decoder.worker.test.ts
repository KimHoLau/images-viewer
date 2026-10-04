import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, control, fakeSelf } = vi.hoisted(() => ({
  calls: [] as string[],
  control: { readyAfterWait: true },
  fakeSelf: { postMessage: vi.fn(), onmessage: null as unknown },
}));

vi.mock('@colorhythm/libraw-wasm', () => {
  class FakeLibRaw {
    status: 'loading' | 'ready' | 'disposed' = 'loading';

    static async initialize(): Promise<unknown> {
      calls.push('initialize');
      return {};
    }

    async waitUntilReady(): Promise<void> {
      calls.push('waitUntilReady');
      if (control.readyAfterWait) this.status = 'ready';
    }

    open(): void {
      // 把当时的状态记进调用名，任何「没等就绪就 open」都会在断言里现形
      calls.push(`open(status=${this.status})`);
    }
    setOutputBps(): void {
      calls.push('setOutputBps');
    }
    setOutputColor(): void {
      calls.push('setOutputColor');
    }
    setUseCameraWb(): void {
      calls.push('setUseCameraWb');
    }
    setHalfSize(): void {
      calls.push('setHalfSize');
    }
    unpack(): void {
      calls.push('unpack');
    }
    dcrawProcess(): void {
      calls.push('dcrawProcess');
    }
    dcrawMakeMemImage() {
      calls.push('dcrawMakeMemImage');
      return {
        width: 2,
        height: 1,
        colors: 3,
        data: new Uint8Array([255, 0, 0, 0, 255, 0]),
      };
    }
    getIParams() {
      return { make: 'Canon', model: 'EOS R5', normalized_make: 'Canon', normalized_model: 'EOS R5' };
    }
    getImgOther() {
      return { iso_speed: 400, shutter: 0.005, aperture: 2.8, focal_len: 35, timestamp: 0n };
    }
    dispose(): void {
      calls.push('dispose');
      this.status = 'disposed';
    }
  }

  return { LibRaw: FakeLibRaw };
});

vi.stubGlobal('self', fakeSelf);
await import('./raw-decoder.worker');

type Handler = (event: { data: unknown }) => Promise<void>;

function handler(): Handler {
  const onmessage = fakeSelf.onmessage as Handler | null;
  if (!onmessage) throw new Error('worker 没有注册 onmessage');
  return onmessage;
}

describe('raw-decoder.worker', () => {
  beforeEach(() => {
    calls.length = 0;
    control.readyAfterWait = true;
    fakeSelf.postMessage.mockClear();
  });

  it('opens the decoder only after it is ready', async () => {
    await handler()({
      data: { id: 1, buffer: new ArrayBuffer(8), fileName: 'shot.cr2', options: {} },
    });

    const openIndex = calls.findIndex((call) => call.startsWith('open'));
    const readyIndex = calls.indexOf('waitUntilReady');

    expect(readyIndex).toBeGreaterThan(-1);
    expect(openIndex).toBeGreaterThan(readyIndex);
    // 关键断言：open 那一刻解码器必须已经就绪
    expect(calls[openIndex]).toBe('open(status=ready)');
  });

  it('sets the decode parameters before unpacking', async () => {
    await handler()({
      data: { id: 1, buffer: new ArrayBuffer(8), fileName: 'shot.cr2', options: { halfSize: true } },
    });

    const unpackIndex = calls.indexOf('unpack');
    for (const step of ['setOutputBps', 'setOutputColor', 'setUseCameraWb', 'setHalfSize']) {
      expect(calls.indexOf(step), `${step} 应在 unpack 之前`).toBeLessThan(unpackIndex);
    }
    expect(calls.indexOf('dcrawProcess')).toBeGreaterThan(unpackIndex);
  });

  it('returns RGBA pixels and the shooting metadata', async () => {
    await handler()({
      data: { id: 7, buffer: new ArrayBuffer(8), fileName: 'shot.cr2', options: {} },
    });

    expect(fakeSelf.postMessage).toHaveBeenCalledTimes(1);
    const [message] = fakeSelf.postMessage.mock.calls[0];

    expect(message).toMatchObject({ id: 7, ok: true, width: 2, height: 1 });
    // RGB 三元组被补成 RGBA
    expect(Array.from(message.pixels)).toEqual([255, 0, 0, 255, 0, 255, 0, 255]);
    expect(message.metadata).toMatchObject({ make: 'Canon', model: 'EOS R5', iso: 400 });
  });

  it('transfers the pixel buffer instead of copying it', async () => {
    await handler()({
      data: { id: 1, buffer: new ArrayBuffer(8), fileName: 'shot.cr2', options: {} },
    });

    const [, transfer] = fakeSelf.postMessage.mock.calls[0];
    const [message] = fakeSelf.postMessage.mock.calls[0];
    expect(transfer).toEqual([message.pixels.buffer]);
  });

  it('disposes the decoder after a successful decode', async () => {
    await handler()({
      data: { id: 1, buffer: new ArrayBuffer(8), fileName: 'shot.cr2', options: {} },
    });

    expect(calls).toContain('dispose');
  });

  it('reports an error and disposes when the decoder never becomes ready', async () => {
    control.readyAfterWait = false;

    await handler()({
      data: { id: 3, buffer: new ArrayBuffer(8), fileName: 'broken.cr2', options: {} },
    });

    const [message] = fakeSelf.postMessage.mock.calls[0];
    expect(message).toMatchObject({ id: 3, ok: false });
    expect(message.error).toContain('broken.cr2');
    expect(calls).toContain('dispose');
  });

  it('reports an error when the file cannot be decoded', async () => {
    const onmessage = handler();
    // 空 buffer 在真实库里会直接抛
    const { LibRaw } = await import('@colorhythm/libraw-wasm');
    const spy = vi
      .spyOn(LibRaw.prototype, 'open')
      .mockImplementation(() => {
        throw new Error('unsupported format');
      });

    try {
      await onmessage({
        data: { id: 4, buffer: new ArrayBuffer(8), fileName: 'weird.raw', options: {} },
      });

      const [message] = fakeSelf.postMessage.mock.calls[0];
      expect(message).toMatchObject({ id: 4, ok: false });
      expect(message.error).toContain('unsupported format');
    } finally {
      spy.mockRestore();
    }
  });
});
