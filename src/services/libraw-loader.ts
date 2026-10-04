import { LibRaw } from '@colorhythm/libraw-wasm';

/**
 * LibRaw 的 WASM 模块初始化。
 *
 * 两个 Worker（缩略图、RAW 解码）都需要它。每个 Worker 是独立的 JS 运行环境，
 * 各自会实例化一份模块状态——这是必须的，不能跨 Worker 共享实例；
 * 这里共享的只是初始化代码。
 */
let ready: Promise<void> | null = null;

export function ensureLibRaw(): Promise<void> {
  if (!ready) {
    ready = LibRaw.initialize().then(() => undefined);
  }
  return ready;
}

/**
 * 造一个已经就绪、可以立刻 open() 的解码器。
 *
 * 必须走这里，不要自己 `new LibRaw()`：构造函数里那次 `setup()` 是异步且没有被 await 的，
 * 而 `open()` 会直接用内部的 `lr` 指针。构造之后直接 open 会带着 `lr === undefined` 进去。
 * `waitUntilReady()` 等的是 WASM 模块，比 `setup()` 少一跳，因此这里再补一轮宏任务兜底，
 * 并用 status 断言把结果钉死——库将来改了行为也会立刻炸出来，而不是悄悄解出一张坏图。
 */
export async function createLibRawDecoder(): Promise<LibRaw> {
  await ensureLibRaw();

  const decoder = new LibRaw();
  await decoder.waitUntilReady();

  if (decoder.status !== 'ready') {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
  if (decoder.status !== 'ready') {
    decoder.dispose();
    throw new Error(`LibRaw 初始化未完成，当前状态: ${decoder.status}`);
  }

  return decoder;
}
