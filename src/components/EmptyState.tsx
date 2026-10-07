import { useFolderOpener } from '../hooks/useFolderOpener';
import { useAppStore } from '../store/useAppStore';

/** 没有打开任何图片时的引导页 */
export function EmptyState() {
  const handleOpen = useFolderOpener();
  const error = useAppStore((state) => state.error);

  return (
    <div className="empty-state">
      <div className="empty-state__card">
        <h1 className="empty-state__title">Raw Images Studio</h1>
        <p className="empty-state__subtitle">
          打开一个文件夹或选择图片，开始浏览。支持 JPEG / PNG / WebP 与 CR2、CR3、NEF、ARW、RAF、DNG
          等 RAW 格式。
        </p>
        <button type="button" className="button button--primary" onClick={handleOpen}>
          打开文件夹
        </button>
        {error ? <p className="message message--error">{error}</p> : null}
      </div>
    </div>
  );
}
