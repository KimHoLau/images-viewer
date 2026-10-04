import { useEffect, useState } from 'react';
import { ThumbnailService } from '../services/thumbnail-service';
import type { FileEntry } from '../types/image';

let sharedService: ThumbnailService | null = null;
let serviceUnavailable = false;

/** Worker 不可用时返回 null，UI 退化为占位框而不是报错 */
function getService(): ThumbnailService | null {
  if (serviceUnavailable) return null;
  if (!sharedService) {
    try {
      sharedService = new ThumbnailService();
    } catch {
      serviceUnavailable = true;
      return null;
    }
  }
  return sharedService;
}

/** 测试用：重置共享实例 */
export function resetSharedThumbnailService(): void {
  sharedService?.dispose();
  sharedService = null;
  serviceUnavailable = false;
}

export interface ThumbnailUrls {
  /** 图片路径 → 可直接给 <img src> 的 object URL */
  urls: Map<string, string>;
  /** 还在生成的数量 */
  pending: number;
  /** 生成失败的图片路径 */
  failed: Set<string>;
}

/**
 * 为一批图片生成缩略图，逐张完成后增量更新。
 * 每次运行创建的 object URL 由这次运行自己持有，重跑或卸载时全部撤销。
 */
export function useThumbnails(entries: FileEntry[]): ThumbnailUrls {
  const [urls, setUrls] = useState<Map<string, string>>(() => new Map());
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const controller = new AbortController();
    // 本次运行创建的 URL，随本次运行一起回收
    const urlsForRun = new Set<string>();

    setUrls(new Map());
    setFailed(new Set());

    const service = entries.length > 0 ? getService() : null;
    if (!service) {
      setPending(0);
      return () => {
        controller.abort();
      };
    }

    setPending(entries.length);

    void service.getThumbnails(entries, {
      signal: controller.signal,
      onResult: (entry, thumbnail) => {
        if (controller.signal.aborted) return;

        if (thumbnail) {
          const url = URL.createObjectURL(thumbnail.blob);
          urlsForRun.add(url);
          setUrls((prev) => new Map(prev).set(entry.path, url));
        } else {
          setFailed((prev) => new Set(prev).add(entry.path));
        }
        setPending((prev) => Math.max(0, prev - 1));
      },
    });

    return () => {
      controller.abort();
      for (const url of urlsForRun) {
        URL.revokeObjectURL(url);
      }
      urlsForRun.clear();
    };
  }, [entries]);

  return { urls, pending, failed };
}
