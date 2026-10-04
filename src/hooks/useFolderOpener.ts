import { useCallback } from 'react';
import { openFolder } from '../services/file-browser';
import { useAppStore } from '../store/useAppStore';

/**
 * 打开文件夹并写进 store，供工具栏与空状态页共用。
 *
 * 用户取消选择不算失败：恢复打开前的状态，不弹错误提示。
 */
export function useFolderOpener(): () => Promise<void> {
  const setFolder = useAppStore((state) => state.setFolder);
  const setError = useAppStore((state) => state.setError);
  const setStatus = useAppStore((state) => state.setStatus);

  return useCallback(async () => {
    const previousStatus = useAppStore.getState().status;
    setStatus('loading');

    try {
      setFolder(await openFolder());
    } catch (error) {
      if (error instanceof DOMException && error.name === 'AbortError') {
        setStatus(previousStatus === 'loading' ? 'empty' : previousStatus);
        return;
      }
      setError((error as Error).message);
    }
  }, [setFolder, setError, setStatus]);
}
