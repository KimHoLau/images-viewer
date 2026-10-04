import { useEffect, useRef } from 'react';
import { useThumbnails } from '../hooks/useThumbnails';
import { useAppStore } from '../store/useAppStore';

/** 底部缩略图条：点击切换当前图片，当前项自动滚入视野 */
export function Filmstrip() {
  const images = useAppStore((state) => state.images);
  const currentIndex = useAppStore((state) => state.currentIndex);
  const selectImage = useAppStore((state) => state.selectImage);

  const { urls, pending, failed } = useThumbnails(images);
  const trackRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef.current;
    if (!track) return;
    const active = track.querySelector<HTMLElement>('[data-active="true"]');
    active?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [currentIndex, urls]);

  if (images.length === 0) return null;

  return (
    <footer className="filmstrip">
      <div className="filmstrip__track" ref={trackRef}>
        {images.map((entry, index) => {
          const url = urls.get(entry.path);
          const isActive = index === currentIndex;
          const hasFailed = failed.has(entry.path);

          return (
            <button
              key={`${entry.path}-${index}`}
              type="button"
              data-active={isActive}
              className={`thumb${isActive ? ' thumb--active' : ''}`}
              onClick={() => selectImage(index)}
              title={entry.name}
            >
              {url ? (
                <img className="thumb__image" src={url} alt={entry.name} draggable={false} />
              ) : (
                <span className={`thumb__placeholder${hasFailed ? ' is-failed' : ''}`}>
                  {hasFailed ? '!' : '…'}
                </span>
              )}
              {entry.isRaw ? <span className="thumb__badge">RAW</span> : null}
            </button>
          );
        })}
      </div>
      {pending > 0 ? (
        <div className="filmstrip__status">生成缩略图… 剩余 {pending}</div>
      ) : null}
    </footer>
  );
}
