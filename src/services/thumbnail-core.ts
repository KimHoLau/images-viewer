/** 缩略图目标尺寸 */
export interface ThumbnailSize {
  width: number;
  height: number;
}

/**
 * 在保持宽高比的前提下，把图片缩放到最长边不超过 maxSize。
 * 图片本身比 maxSize 小时不做放大。
 *
 * 导出（services/export.ts）也复用这个「放进方框」的算法。
 */
export function fitWithin(width: number, height: number, maxSize: number): ThumbnailSize {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error(`Invalid image dimensions: ${width}x${height}`);
  }
  if (!Number.isFinite(maxSize) || maxSize < 1) {
    throw new Error(`Invalid maxSize: ${maxSize}`);
  }

  const longest = Math.max(width, height);
  if (longest <= maxSize) {
    return { width: Math.round(width), height: Math.round(height) };
  }

  const scale = maxSize / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

/** 生成缩略图缓存键；文件内容变了（大小或修改时间变化）键就变，旧缓存自然失效 */
export function thumbnailCacheKey(source: {
  path: string;
  size: number;
  lastModified: number;
}): string {
  return `${source.path}::${source.size}::${source.lastModified}`;
}

/** 限制并发数的任务池 */
export interface Limiter {
  <T>(task: () => Promise<T>): Promise<T>;
  readonly active: number;
  readonly pending: number;
}

/** 创建一个并发上限为 limit 的任务池，超出的任务排队等待 */
export function createLimiter(limit: number): Limiter {
  if (!Number.isFinite(limit) || limit < 1) {
    throw new Error(`Limiter limit must be >= 1, got ${limit}`);
  }

  let active = 0;
  const queue: Array<() => void> = [];

  const scheduleNext = () => {
    while (active < limit && queue.length > 0) {
      active++;
      queue.shift()!();
    }
  };

  const limiter = <T>(task: () => Promise<T>): Promise<T> =>
    new Promise<T>((resolve, reject) => {
      queue.push(() => {
        task()
          .then(resolve, reject)
          .finally(() => {
            active--;
            scheduleNext();
          });
      });
      scheduleNext();
    });

  Object.defineProperties(limiter, {
    active: { get: () => active },
    pending: { get: () => queue.length },
  });

  return limiter as Limiter;
}

/** 根据 CPU 核心数推算合适的缩略图并发数 */
export function defaultThumbnailConcurrency(
  hardwareConcurrency = typeof navigator === 'undefined' ? 4 : (navigator.hardwareConcurrency ?? 4),
): number {
  return Math.min(4, Math.max(1, Math.floor(hardwareConcurrency / 2)));
}
