import type { FileEntry } from '../types/image';
import { putThumbnail, getThumbnail as readCachedThumbnail, pruneThumbnails } from './thumbnail-cache';
import {
  createLimiter,
  defaultThumbnailConcurrency,
  thumbnailCacheKey,
  type Limiter,
} from './thumbnail-core';
import type { ThumbnailJobMessage, ThumbnailResultMessage } from '../workers/thumbnail.worker';

/** 缩略图默认最长边（像素） */
export const DEFAULT_THUMBNAIL_SIZE = 256;

export interface Thumbnail {
  key: string;
  blob: Blob;
  width: number;
  height: number;
  /** 是否来自 IndexedDB 缓存 */
  fromCache: boolean;
}

export interface ThumbnailServiceOptions {
  /** 并发生成数，默认按 CPU 核心数推算 */
  concurrency?: number;
  /** 缩略图最长边，默认 256 */
  maxSize?: number;
  /** 每生成多少张后做一次 LRU 淘汰，默认 128 */
  pruneInterval?: number;
}

interface GeneratedThumbnail {
  blob: Blob;
  width: number;
  height: number;
}

interface PendingJob {
  resolve: (value: GeneratedThumbnail) => void;
  reject: (error: Error) => void;
  worker: Worker;
}

/**
 * 缩略图服务：先查 IndexedDB 缓存，未命中则派给 Web Worker 生成。
 * Worker 池按需创建，并发生成数受 limiter 限制，避免打满 CPU。
 */
export class ThumbnailService {
  readonly maxSize: number;
  readonly concurrency: number;

  private readonly workers: Worker[] = [];
  private readonly workerJobs = new Map<Worker, Set<number>>();
  private readonly pending = new Map<number, PendingJob>();
  private readonly limiter: Limiter;
  private readonly pruneInterval: number;

  private cursor = 0;
  private nextJobId = 1;
  private generatedSincePrune = 0;
  private disposed = false;

  constructor(options: ThumbnailServiceOptions = {}) {
    if (typeof Worker === 'undefined') {
      throw new Error('Web Workers are not available in this environment');
    }

    this.concurrency = options.concurrency ?? defaultThumbnailConcurrency();
    this.maxSize = options.maxSize ?? DEFAULT_THUMBNAIL_SIZE;
    this.pruneInterval = options.pruneInterval ?? 128;
    this.limiter = createLimiter(this.concurrency);
  }

  /** 取缩略图：命中缓存直接返回，否则生成并写回缓存 */
  async getThumbnail(entry: FileEntry): Promise<Thumbnail> {
    this.assertUsable();

    const key = thumbnailCacheKey({
      path: entry.path,
      size: entry.file.size,
      lastModified: entry.file.lastModified,
    });

    const cached = await readCachedThumbnail(key);
    if (cached) {
      return {
        key,
        blob: cached.blob,
        width: cached.width,
        height: cached.height,
        fromCache: true,
      };
    }

    const generated = await this.limiter(() => this.generate(entry));
    await putThumbnail({ key, blob: generated.blob, width: generated.width, height: generated.height });
    void this.maybePrune();

    return { key, ...generated, fromCache: false };
  }

  /**
   * 批量生成缩略图。每张生成完立即通过 onResult 回调出去，方便 UI 增量渲染，
   * 而不是等全部完成一次性出现。
   * signal 中止后不再派发新任务，已在途的任务结果被丢弃。
   */
  async getThumbnails(
    entries: FileEntry[],
    options: {
      onResult?: (entry: FileEntry, thumbnail: Thumbnail | null, index: number) => void;
      signal?: AbortSignal;
    } = {},
  ): Promise<Array<Thumbnail | null>> {
    const { onResult, signal } = options;
    const results = new Array<Thumbnail | null>(entries.length).fill(null);

    await Promise.all(
      entries.map(async (entry, index) => {
        if (signal?.aborted) return;

        try {
          const thumbnail = await this.getThumbnail(entry);
          if (signal?.aborted) return;
          results[index] = thumbnail;
        } catch {
          results[index] = null;
        }

        onResult?.(entry, results[index], index);
      }),
    );

    return results;
  }

  /** 关闭所有 Worker */
  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    for (const [, job] of this.pending) {
      job.reject(new Error('ThumbnailService disposed'));
    }
    this.pending.clear();
    this.workerJobs.clear();

    for (const worker of this.workers) {
      worker.terminate();
    }
    this.workers.length = 0;
  }

  private assertUsable(): void {
    if (this.disposed) {
      throw new Error('ThumbnailService has been disposed');
    }
  }

  private createWorker(): Worker {
    const worker = new Worker(new URL('../workers/thumbnail.worker.ts', import.meta.url), {
      type: 'module',
    });
    worker.onmessage = (event: MessageEvent<ThumbnailResultMessage>) => {
      this.handleResult(worker, event.data);
    };
    worker.onerror = (event: ErrorEvent) => {
      this.failWorker(worker, new Error(event.message || '缩略图 Worker 运行出错'));
    };
    this.workerJobs.set(worker, new Set());
    return worker;
  }

  private acquireWorker(): Worker {
    if (this.workers.length < this.concurrency) {
      const worker = this.createWorker();
      this.workers.push(worker);
      return worker;
    }
    const worker = this.workers[this.cursor % this.workers.length];
    this.cursor++;
    return worker;
  }

  private generate(entry: FileEntry): Promise<GeneratedThumbnail> {
    this.assertUsable();

    const worker = this.acquireWorker();
    const id = this.nextJobId++;
    const message: ThumbnailJobMessage = {
      id,
      file: entry.file,
      isRaw: entry.isRaw,
      maxSize: this.maxSize,
    };

    return new Promise<GeneratedThumbnail>((resolve, reject) => {
      this.pending.set(id, { resolve, reject, worker });
      this.workerJobs.get(worker)?.add(id);
      worker.postMessage(message);
    });
  }

  private handleResult(worker: Worker, message: ThumbnailResultMessage): void {
    const job = this.pending.get(message.id);
    if (!job) return;

    this.pending.delete(message.id);
    this.workerJobs.get(worker)?.delete(message.id);

    if (message.ok) {
      job.resolve({ blob: message.blob, width: message.width, height: message.height });
    } else {
      job.reject(new Error(message.error));
    }
  }

  private failWorker(worker: Worker, error: Error): void {
    const ids = this.workerJobs.get(worker);
    if (ids) {
      for (const id of ids) {
        this.pending.get(id)?.reject(error);
        this.pending.delete(id);
      }
      ids.clear();
    }

    // 出错的 Worker 不再复用
    const index = this.workers.indexOf(worker);
    if (index >= 0) this.workers.splice(index, 1);
    this.workerJobs.delete(worker);
    worker.terminate();
  }

  private async maybePrune(): Promise<void> {
    this.generatedSincePrune++;
    if (this.generatedSincePrune < this.pruneInterval) return;
    this.generatedSincePrune = 0;
    try {
      await pruneThumbnails();
    } catch {
      // 淘汰失败不影响已生成的缩略图
    }
  }
}
