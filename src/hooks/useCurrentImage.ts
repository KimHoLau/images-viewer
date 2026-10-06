import { useEffect, useRef, useState } from 'react';
import { ImageLoader, releaseLoadedImage, type LoadedImage } from '../services/image-loader';
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
  const logSpaceId = useAppStore((state) => state.logSpaceId);
  const [state, setState] = useState<CurrentImageState>({
    image: null,
    loading: false,
    error: null,
  });
  const latest = useRef<LoadedImage | null>(null);

  useEffect(
    () => () => {
      releaseLoadedImage(latest.current);
      latest.current = null;
    },
    [],
  );

  useEffect(() => {
    // 换图前先放掉上一张
    releaseLoadedImage(latest.current);
    latest.current = null;

    if (!current) {
      setState({ image: null, loading: false, error: null });
      return;
    }

    let cancelled = false;
    setState({ image: null, loading: true, error: null });

    // Log 模式必须重新解码：Log 编码要的是线性光与足够的动态范围，
    // 8 位 sRGB 位图两条都不满足，所以这时候向 Worker 要 ProPhoto linear 浮点。
    const wantsLinear = current.isRaw && logSpaceId !== null;

    void getLoader()
      .load(current, {
        preview: true,
        outputColor: wantsLinear ? 'prophoto-linear' : 'srgb',
      })
      .then((loaded) => {
        if (cancelled) {
          releaseLoadedImage(loaded);
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
  }, [current, logSpaceId]);

  return state;
}

/** 只加载元信息，不做解码；用于信息面板 */
export function describeEntry(entry: FileEntry | null): string {
  if (!entry) return '';
  return entry.isRaw ? `${entry.name}（RAW）` : entry.name;
}
