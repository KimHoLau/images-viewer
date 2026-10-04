import { create } from 'zustand';
import { clampZoom, type Point } from '../renderer/view-transform';

/** 缩放档位，1 表示"适应窗口" */
export const ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 6, 8, 12, 16] as const;

export interface ViewerState {
  /** 缩放倍率，1 = 适应窗口 */
  zoom: number;
  /** 相对居中位置的平移量（像素） */
  pan: Point;
  /** 是否处于拖拽平移状态 */
  isPanning: boolean;

  setZoom: (zoom: number) => void;
  zoomIn: () => void;
  zoomOut: () => void;
  resetView: () => void;
  setPan: (pan: Point) => void;
  panBy: (delta: Point) => void;
  setPanning: (isPanning: boolean) => void;
}

/** 找到比当前档位大的下一档；已在最大档则保持 */
export function nextZoomStep(current: number): number {
  return ZOOM_STEPS.find((step) => step > current + 1e-6) ?? ZOOM_STEPS[ZOOM_STEPS.length - 1];
}

/** 找到比当前档位小的上一档；已在最小档则保持 */
export function previousZoomStep(current: number): number {
  const candidates = ZOOM_STEPS.filter((step) => step < current - 1e-6);
  return candidates.length > 0 ? candidates[candidates.length - 1] : ZOOM_STEPS[0];
}

export const useViewerStore = create<ViewerState>((set, get) => ({
  zoom: 1,
  pan: { x: 0, y: 0 },
  isPanning: false,

  setZoom: (zoom) => set({ zoom: clampZoom(zoom) }),

  zoomIn: () => set({ zoom: clampZoom(nextZoomStep(get().zoom)) }),

  zoomOut: () => set({ zoom: clampZoom(previousZoomStep(get().zoom)) }),

  resetView: () => set({ zoom: 1, pan: { x: 0, y: 0 } }),

  setPan: (pan) => set({ pan }),

  panBy: (delta) =>
    set((state) => ({ pan: { x: state.pan.x + delta.x, y: state.pan.y + delta.y } })),

  setPanning: (isPanning) => set({ isPanning }),
}));
