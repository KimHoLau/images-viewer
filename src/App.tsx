import { useEffect } from 'react';
import { EmptyState } from './components/EmptyState';
import { Filmstrip } from './components/Filmstrip';
import { ImageCanvas } from './components/ImageCanvas';
import { RightPanel } from './components/RightPanel';
import { Toolbar } from './components/Toolbar';
import { useCurrentImage } from './hooks/useCurrentImage';
import { useAppStore } from './store/useAppStore';

export default function App() {
  const hasImages = useAppStore((state) => state.images.length > 0);
  const nextImage = useAppStore((state) => state.nextImage);
  const previousImage = useAppStore((state) => state.previousImage);
  const { image, loading, error } = useCurrentImage();

  // 左右方向键切换图片
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return;

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        nextImage();
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault();
        previousImage();
      }
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [nextImage, previousImage]);

  return (
    <div className="app-shell">
      <Toolbar />

      <main className="app-shell__main">
        {hasImages ? (
          <>
            <ImageCanvas image={image} loading={loading} />
            {error ? <div className="app-shell__error message message--error">{error}</div> : null}
          </>
        ) : (
          <EmptyState />
        )}
      </main>

      <aside className="app-shell__panel">
        <RightPanel image={image} loading={loading} />
      </aside>

      <Filmstrip />
    </div>
  );
}
