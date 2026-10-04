import { useCallback, useRef } from 'react';
import { useFolderOpener } from '../hooks/useFolderOpener';
import { openFiles } from '../services/file-browser';
import { useAppStore } from '../store/useAppStore';
import { useViewerStore } from '../store/useViewerStore';
import { IMAGE_EXTENSIONS } from '../types/image';

/** 缩放百分比显示；1 表示适应窗口 */
function formatZoom(zoom: number): string {
  return `${Math.round(zoom * 100)}%`;
}

export function Toolbar() {
  const folderName = useAppStore((state) => state.folderName);
  const images = useAppStore((state) => state.images);
  const currentIndex = useAppStore((state) => state.currentIndex);
  const status = useAppStore((state) => state.status);
  const setFolder = useAppStore((state) => state.setFolder);

  const zoom = useViewerStore((state) => state.zoom);
  const zoomIn = useViewerStore((state) => state.zoomIn);
  const zoomOut = useViewerStore((state) => state.zoomOut);
  const resetView = useViewerStore((state) => state.resetView);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isBusy = status === 'loading';

  const handleOpenFolder = useFolderOpener();

  const handleFileInput = useCallback(
    (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = event.target.files;
      if (files && files.length > 0) {
        setFolder(openFiles(files));
      }
      // 允许再次选择同一个文件
      event.target.value = '';
    },
    [setFolder],
  );

  const hasImages = images.length > 0;

  return (
    <header className="toolbar">
      <div className="toolbar__group">
        <button
          type="button"
          className="button button--primary"
          onClick={handleOpenFolder}
          disabled={isBusy}
        >
          打开文件夹
        </button>
        <button
          type="button"
          className="button"
          onClick={() => fileInputRef.current?.click()}
          disabled={isBusy}
        >
          打开文件
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept={IMAGE_EXTENSIONS.map((ext) => `.${ext}`).join(',')}
          multiple
          onChange={handleFileInput}
          tabIndex={-1}
        />
        <span className="toolbar__folder" title={folderName ?? undefined}>
          {folderName ?? '未选择文件夹'}
        </span>
      </div>

      <div className="toolbar__group toolbar__group--center">
        {hasImages ? (
          <span className="toolbar__counter">
            {currentIndex + 1} / {images.length}
          </span>
        ) : null}
      </div>

      <div className="toolbar__group">
        <button
          type="button"
          className="button button--icon"
          onClick={zoomOut}
          disabled={!hasImages}
          title="缩小"
          aria-label="缩小"
        >
          −
        </button>
        <button
          type="button"
          className="button button--zoom"
          onClick={resetView}
          disabled={!hasImages}
          title="适应窗口"
        >
          {formatZoom(zoom)}
        </button>
        <button
          type="button"
          className="button button--icon"
          onClick={zoomIn}
          disabled={!hasImages}
          title="放大"
          aria-label="放大"
        >
          +
        </button>
      </div>
    </header>
  );
}
