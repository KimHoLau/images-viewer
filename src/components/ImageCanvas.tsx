import { useCallback, useEffect, useRef, useState } from 'react';
import type { LoadedImage } from '../services/image-loader';
import { ImageRenderer } from '../renderer/ImageRenderer';
import { setActiveRenderer } from '../renderer/renderer-registry';
import {
  selectActiveLut,
  selectLogSpaceIndex,
  useAppStore,
  type AppState,
} from '../store/useAppStore';
import { useViewerStore } from '../store/useViewerStore';

export interface ImageCanvasProps {
  image: LoadedImage | null;
  loading?: boolean;
}

/**
 * 交互期间的分辨率倍率。24MP 的图按全分辨率每帧重绘会掉帧，
 * 拖动/缩放/拉滑块时先按半分辨率渲染，停下来再补一张全分辨率的。
 */
const INTERACTIVE_RESOLUTION_SCALE = 0.5;
/** 停手多久之后恢复全分辨率 */
const INTERACTION_IDLE_MS = 200;

/**
 * 把 store 里的 Log 选择翻译成渲染器的调用；曲线与色域现在成对取自同一个空间。
 *
 * 额外要求纹理本身是 ProPhoto linear：非 RAW 图片加载出来的是 8 位 sRGB 位图，
 * 把它送进 Log 分支只会得到错误的颜色。下拉框禁用是第一道防线，这里是第二道——
 * 在 RAW 上选了 Log 再切到同一文件夹里的 JPEG 时，store 里的选择还在。
 */
function applyLogMode(renderer: ImageRenderer, state: AppState): void {
  const index = selectLogSpaceIndex(state);
  const enabled = index >= 0 && renderer.isInputLinear();
  renderer.setLogMode(
    enabled,
    enabled ? index : -1,
    enabled ? index : -1,
    state.lutOutputEncoded,
  );
}

/** 中央大图：WebGL2 纹理显示，支持滚轮缩放与拖拽平移 */
export function ImageCanvas({ image, loading = false }: ImageCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<ImageRenderer | null>(null);
  const dragRef = useRef<{ x: number; y: number } | null>(null);
  /** 容器的 CSS 像素尺寸，由 ResizeObserver 维护 */
  const containerSizeRef = useRef<{ width: number; height: number }>({ width: 0, height: 0 });
  /** 当前分辨率倍率与恢复到全分辨率的定时器 */
  const resolutionRef = useRef<{ scale: number; idleTimer: number | null }>({
    scale: 1,
    idleTimer: null,
  });

  const [contextError, setContextError] = useState<string | null>(null);

  const zoom = useViewerStore((state) => state.zoom);
  const pan = useViewerStore((state) => state.pan);
  const setZoom = useViewerStore((state) => state.setZoom);
  const panBy = useViewerStore((state) => state.panBy);
  const setPanning = useViewerStore((state) => state.setPanning);

  /**
   * 按当前分辨率倍率设置画布后备缓冲，并把视口告诉渲染器。
   *
   * 平移量在 store 里以 CSS 像素记，这里换算成后备缓冲像素，
   * 这样切换分辨率倍率时画面不会跳。
   */
  const applyResolution = useCallback((scale: number) => {
    const canvas = canvasRef.current;
    const renderer = rendererRef.current;
    const container = containerSizeRef.current;
    if (!canvas || !renderer || container.width <= 0 || container.height <= 0) return;

    const dpr = window.devicePixelRatio || 1;
    const backing = dpr * scale;

    canvas.width = Math.max(1, Math.round(container.width * backing));
    canvas.height = Math.max(1, Math.round(container.height * backing));
    renderer.setViewport(canvas.width, canvas.height);

    const { pan: currentPan } = useViewerStore.getState();
    renderer.setPan({ x: currentPan.x * backing, y: currentPan.y * backing });
    renderer.render();
  }, []);

  /** 通知一次交互：立即降分辨率，停手后恢复 */
  const notifyInteraction = useCallback(() => {
    const state = resolutionRef.current;

    if (state.scale !== INTERACTIVE_RESOLUTION_SCALE) {
      state.scale = INTERACTIVE_RESOLUTION_SCALE;
      applyResolution(state.scale);
    }

    if (state.idleTimer !== null) clearTimeout(state.idleTimer);
    state.idleTimer = window.setTimeout(() => {
      state.idleTimer = null;
      state.scale = 1;
      applyResolution(1);
    }, INTERACTION_IDLE_MS);
  }, [applyResolution]);

  // 创建渲染器
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    let renderer: ImageRenderer;
    try {
      renderer = new ImageRenderer(canvas);
    } catch (error) {
      setContextError((error as Error).message);
      return;
    }

    rendererRef.current = renderer;
    // 导出面板要复用这个渲染器（图片、调整、LUT 都在里面）
    setActiveRenderer(renderer);

    return () => {
      setActiveRenderer(null);
      renderer.dispose();
      rendererRef.current = null;
    };
  }, []);

  // 卸载时清掉待恢复的定时器
  useEffect(
    () => () => {
      const { idleTimer } = resolutionRef.current;
      if (idleTimer !== null) clearTimeout(idleTimer);
    },
    [],
  );

  // 跟随容器尺寸变化调整画布分辨率
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || typeof ResizeObserver === 'undefined') return;

    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect;
      if (!rect || rect.width <= 0 || rect.height <= 0) return;

      containerSizeRef.current = { width: rect.width, height: rect.height };
      applyResolution(resolutionRef.current.scale);
    });

    observer.observe(canvas);
    return () => observer.disconnect();
  }, [applyResolution]);

  // 换图时重新上传纹理：Log 模式的 RAW 是浮点线性数据，其余是 sRGB 位图。
  // 上传之后还要重算一次 Log 模式——能不能开取决于刚换上的纹理是不是线性的。
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    if (image?.source === 'linear') {
      renderer.setLinearImage(image.linear.data, image.linear.width, image.linear.height);
    } else if (image?.source === 'bitmap') {
      renderer.setImage(image.bitmap, image.width, image.height);
    }

    applyLogMode(renderer, useAppStore.getState());
    renderer.render();
  }, [image]);

  // 调整参数与 LUT 直接订阅 store，绕开 React 渲染：
  // 换预设或拖滑块时每帧只更新 uniform/纹理 + 一次 draw call，不触发组件重渲染。
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const initialState = useAppStore.getState();
    renderer.setAdjustments(initialState.adjustments);
    renderer.setLut(selectActiveLut(initialState));
    applyLogMode(renderer, initialState);
    renderer.render();

    return useAppStore.subscribe((state, previous) => {
      let needsRender = false;

      if (state.adjustments !== previous.adjustments) {
        renderer.setAdjustments(state.adjustments);
        needsRender = true;
        // 拖滑块也是交互，先降分辨率
        notifyInteraction();
      }
      if (
        state.officialLutKey !== previous.officialLutKey ||
        state.officialLut !== previous.officialLut ||
        state.customLutKey !== previous.customLutKey ||
        state.lutLibrary !== previous.lutLibrary
      ) {
        try {
          renderer.setLut(selectActiveLut(state));
        } catch {
          // LUT 超出设备能力等情况：退回不使用 LUT，不让整幅图挂掉
          renderer.setLut(null);
        }
        needsRender = true;
      }
      if (
        state.logSpaceId !== previous.logSpaceId ||
        state.lutOutputEncoded !== previous.lutOutputEncoded
      ) {
        applyLogMode(renderer, state);
        needsRender = true;
      }

      if (needsRender) renderer.render();
    });
  }, [notifyInteraction]);

  // 缩放与平移
  useEffect(() => {
    const renderer = rendererRef.current;
    if (!renderer) return;

    const dpr = window.devicePixelRatio || 1;
    const backing = dpr * resolutionRef.current.scale;

    renderer.setZoom(zoom);
    renderer.setPan({ x: pan.x * backing, y: pan.y * backing });
    renderer.render();
  }, [zoom, pan]);

  const handleWheel = useCallback(
    (event: React.WheelEvent<HTMLCanvasElement>) => {
      if (!image) return;
      event.preventDefault();
      notifyInteraction();
      const factor = event.deltaY < 0 ? 1.1 : 1 / 1.1;
      setZoom(useViewerStore.getState().zoom * factor);
    },
    [image, setZoom, notifyInteraction],
  );

  const handlePointerDown = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!image || zoom <= 1) return;
      dragRef.current = { x: event.clientX, y: event.clientY };
      setPanning(true);
      notifyInteraction();
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [image, zoom, setPanning, notifyInteraction],
  );

  const handlePointerMove = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      const drag = dragRef.current;
      if (!drag) return;

      // store 里的平移量以 CSS 像素为单位，缩放倍率变化时不用换算
      panBy({ x: event.clientX - drag.x, y: event.clientY - drag.y });
      dragRef.current = { x: event.clientX, y: event.clientY };
      notifyInteraction();
    },
    [panBy, notifyInteraction],
  );

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLCanvasElement>) => {
      if (!dragRef.current) return;
      dragRef.current = null;
      setPanning(false);
      if (event.currentTarget.hasPointerCapture(event.pointerId)) {
        event.currentTarget.releasePointerCapture(event.pointerId);
      }
    },
    [setPanning],
  );

  if (contextError) {
    return (
      <div className="image-area image-area--message">
        <p className="message message--error">{contextError}</p>
      </div>
    );
  }

  return (
    <div className="image-area">
      <canvas
        ref={canvasRef}
        className={`image-canvas${zoom > 1 ? ' image-canvas--grabbable' : ''}`}
        onWheel={handleWheel}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
      />
      {loading ? <div className="image-area__overlay">解码中…</div> : null}
    </div>
  );
}
