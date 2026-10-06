import type {
  RawDecodeOptions,
  RawDecodeRequest,
  RawDecodeResponse,
  RawMetadata,
} from './raw-decoder.worker';

/**
 * 解码结果：像素格式由 format 区分，调用方按同一个判别字段分流。
 * 与 Worker 返回的 DecodedRawResult 相比少了 id/ok，多了尺寸的便捷访问。
 */
export type DecodedRawImage = {
  width: number;
  height: number;
  metadata: RawMetadata;
} & (
  { format: 'rgba8'; pixels: Uint8ClampedArray } | { format: 'rgb32f-linear'; pixels: Float32Array }
);

interface PendingDecode {
  resolve: (value: DecodedRawImage) => void;
  reject: (error: Error) => void;
}

/**
 * RAW 解码服务：把解码丢给 Web Worker，避免阻塞主线程。
 * 一个实例复用一个 Worker；LibRaw 的 WASM 模块在 Worker 内只初始化一次。
 */
export class RawDecoderService {
  private worker: Worker | null = null;
  private readonly pending = new Map<number, PendingDecode>();
  private nextId = 1;
  private disposed = false;

  /** 解码一个 RAW 文件为 RGBA 像素 */
  async decode(file: File, options?: RawDecodeOptions): Promise<DecodedRawImage> {
    this.assertUsable();

    const worker = this.ensureWorker();
    const id = this.nextId++;
    const buffer = await file.arrayBuffer();

    return new Promise<DecodedRawImage>((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      const request: RawDecodeRequest = { id, buffer, fileName: file.name, options };
      // 转移 ArrayBuffer，避免大文件被复制一份
      worker.postMessage(request, [buffer]);
    });
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const [, job] of this.pending) {
      job.reject(new Error('RawDecoderService has been disposed'));
    }
    this.pending.clear();

    this.worker?.terminate();
    this.worker = null;
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('RawDecoderService has been disposed');
  }

  private ensureWorker(): Worker {
    if (this.worker) return this.worker;
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not available in this environment');
    }

    const worker = new Worker(new URL('./raw-decoder.worker.ts', import.meta.url), {
      type: 'module',
    });

    worker.onmessage = (event: MessageEvent<RawDecodeResponse>) => {
      this.handleMessage(event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      this.failAll(new Error(event.message || 'RAW 解码 Worker 运行出错'));
    };

    this.worker = worker;
    return worker;
  }

  private handleMessage(message: RawDecodeResponse): void {
    const job = this.pending.get(message.id);
    if (!job) return;
    this.pending.delete(message.id);

    if (message.ok) {
      // 分支展开而不是 spread + 断言：判别联合在编译期就保持完整
      const { width, height, metadata } = message;
      job.resolve(
        message.format === 'rgba8'
          ? { width, height, metadata, format: 'rgba8', pixels: message.pixels }
          : { width, height, metadata, format: 'rgb32f-linear', pixels: message.pixels },
      );
    } else {
      job.reject(new Error(message.error));
    }
  }

  private failAll(error: Error): void {
    for (const [, job] of this.pending) {
      job.reject(error);
    }
    this.pending.clear();

    this.worker?.terminate();
    this.worker = null;
  }
}
