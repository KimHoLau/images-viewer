import { useEffect, useRef, useState } from 'react';
import { ImageLoader, type LoadedImage } from '../services/image-loader';
import { selectCurrentImage, useAppStore } from '../store/useAppStore';
import type { FileEntry } from '../types/image';

let sharedLoader: ImageLoader | null = null;

/** 复用一个 ImageLoader，Worker 与 WASM 模块只初始化一次 */
function getLoader(): ImageLoader {
  if (!sharedLoader) sharedLoader = new ImageLoader();
  return sharedLoader;
}

/** 测试用：重置共享实例 */
export function resetSharedImageLoader(): void {
  sharedLoader?.dispose();
  sharedLoader = null;
}

export interface CurrentImageState {
  image: LoadedImage | null;
  loading: boolean;
  error: string | null;
}

/**
 * 加载当前选中的图片。
 * 切换图片时释放上一张位图，卸载时释放最后一张。
 */
export function useCurrentImage(): CurrentImageState {
  const current = useAppStore(selectCurrentImage);
  const [state, setState] = useState<CurrentImageState>({
    image: null,
    loading: false,
    error: null,
  });
  const latest = useRef<LoadedImage | null>(null);

  useEffect(
    () => () => {
      latest.current?.bitmap.close();
      latest.current = null;
    },
    [],
  );

  useEffect(() => {
    // 换图前先放掉上一张
    latest.current?.bitmap.close();
    latest.current = null;

    if (!current) {
      setState({ image: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ image: null, loading: true, error: null });

    void getLoader()
      .load(current, { preview: true })
      .then((loaded) => {
        if (cancelled) {
          loaded.bitmap.close();
          return;
        }
        latest.current = loaded;
        setState({ image: loaded, loading: false, error: null });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        setState({ image: null, loading: false, error: (error as Error).message });
      });

    return () => {
      cancelled = true;
    };
  }, [current]);

  return state;
}

/** 只加载元信息，不做解码；用于信息面板 */
export function describeEntry(entry: FileEntry | null): string {
  if (!entry) return '';
  return entry.isRaw ? `${entry.name}（RAW）` : entry.name;
}
