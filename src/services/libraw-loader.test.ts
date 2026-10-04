import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls, control } = vi.hoisted(() => ({
  calls: [] as string[],
  control: { readyAfterWait: true },
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
      // 真实的 setup() 还差一个微任务才把 lr 设好，这里用开关模拟两种结果
      if (control.readyAfterWait) this.status = 'ready';
    }

    dispose(): void {
      this.status = 'disposed';
    }
  }

  return { LibRaw: FakeLibRaw };
});

const loader = await import('./libraw-loader');
const { createLibRawDecoder, ensureLibRaw } = loader;

describe('ensureLibRaw', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('initializes the WASM module only once', async () => {
    await Promise.all([ensureLibRaw(), ensureLibRaw(), ensureLibRaw()]);
    await ensureLibRaw();

    expect(calls.filter((call) => call === 'initialize')).toHaveLength(1);
  });
});

describe('createLibRawDecoder', () => {
  beforeEach(() => {
    calls.length = 0;
    control.readyAfterWait = true;
  });

  it('initializes the module, then waits for readiness, before handing the decoder over', async () => {
    // 用一份全新的模块实例，避开上面 ensureLibRaw 测试留下的初始化缓存
    vi.resetModules();
    calls.length = 0;
    const fresh = await import('./libraw-loader');

    const decoder = await fresh.createLibRawDecoder();

    // 这就是那个 bug 的护栏：构造函数里的 setup() 是异步且没被 await 的，
    // 少等一步就会拿到 status 还是 loading 的解码器。
    expect(decoder.status).toBe('ready');
    expect(calls).toEqual(['initialize', 'waitUntilReady']);
  });

  it('throws instead of handing over a decoder that never became ready', async () => {
    control.readyAfterWait = false;

    await expect(createLibRawDecoder()).rejects.toThrow(/初始化未完成/);
  });
});
