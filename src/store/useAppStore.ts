import { create } from 'zustand';
import { resolveActiveLut } from '../lut/presets';
import type { Lut3D } from '../lut/types';
import type { FileEntry, FolderBrowseResult } from '../types/image';
import {
  DEFAULT_ADJUSTMENTS,
  clampAdjustment,
  type ImageAdjustments,
} from '../types/adjustments';

export type AppStatus = 'empty' | 'loading' | 'ready' | 'error';

/** 用户从文件载入的 LUT */
export interface CustomLut {
  name: string;
  lut: Lut3D;
}

export interface AppState {
  /** 当前文件夹名 */
  folderName: string | null;
  /** 当前文件夹内的图片 */
  images: FileEntry[];
  /** 当前查看的图片下标，-1 表示没有选中 */
  currentIndex: number;
  status: AppStatus;
  error: string | null;

  /** 调整参数，作用于当前图片 */
  adjustments: ImageAdjustments;
  /** 当前选中的内置预设 id，null 为不使用 */
  lutPresetId: string | null;
  /** 从文件载入的 LUT，优先于预设 */
  customLut: CustomLut | null;

  // ---- actions ----
  setFolder: (result: FolderBrowseResult) => void;
  clearFolder: () => void;
  selectImage: (index: number) => void;
  nextImage: () => void;
  previousImage: () => void;
  setAdjustment: <K extends keyof ImageAdjustments>(key: K, value: number) => void;
  resetAdjustments: () => void;
  setLutPreset: (presetId: string | null) => void;
  setCustomLut: (entry: CustomLut | null) => void;
  setStatus: (status: AppStatus) => void;
  setError: (message: string | null) => void;
}

/** 选中下标是否有效 */
function isValidIndex(index: number): boolean {
  return Number.isInteger(index) && index >= 0;
}

/** 编辑态复位：换文件夹时把调整参数与 LUT 选择一起清掉 */
function clearedEditState() {
  return {
    adjustments: { ...DEFAULT_ADJUSTMENTS },
    lutPresetId: null,
    customLut: null,
  };
}

export const useAppStore = create<AppState>((set, get) => ({
  folderName: null,
  images: [],
  currentIndex: -1,
  status: 'empty',
  error: null,
  adjustments: { ...DEFAULT_ADJUSTMENTS },
  lutPresetId: null,
  customLut: null,

  setFolder: (result) => {
    const hasImages = result.images.length > 0;
    set({
      folderName: result.folderName,
      images: result.images,
      currentIndex: hasImages ? 0 : -1,
      status: hasImages ? 'ready' : 'empty',
      error: hasImages ? null : '该文件夹里没有支持的图片',
      ...clearedEditState(),
    });
  },

  clearFolder: () =>
    set({
      folderName: null,
      images: [],
      currentIndex: -1,
      status: 'empty',
      error: null,
      ...clearedEditState(),
    }),

  selectImage: (index) => {
    const { images } = get();
    if (!isValidIndex(index) || index >= images.length) return;
    set({ currentIndex: index });
  },

  nextImage: () => {
    const { images, currentIndex } = get();
    if (currentIndex < images.length - 1) {
      set({ currentIndex: currentIndex + 1 });
    }
  },

  previousImage: () => {
    const { currentIndex } = get();
    if (currentIndex > 0) {
      set({ currentIndex: currentIndex - 1 });
    }
  },

  setAdjustment: (key, value) =>
    set((state) => ({
      adjustments: { ...state.adjustments, [key]: clampAdjustment(key, value) },
    })),

  resetAdjustments: () => set({ adjustments: { ...DEFAULT_ADJUSTMENTS } }),

  setLutPreset: (presetId) => set({ lutPresetId: presetId, customLut: null }),

  setCustomLut: (entry) => set({ customLut: entry, lutPresetId: null }),

  setStatus: (status) => set({ status }),

  setError: (message) => set({ error: message, status: message ? 'error' : get().status }),
}));

/** 当前图片；没有选中时为 null */
export function selectCurrentImage(state: AppState): FileEntry | null {
  const { images, currentIndex } = state;
  if (!isValidIndex(currentIndex) || currentIndex >= images.length) return null;
  return images[currentIndex];
}

/** 当前生效的 LUT：载入的 LUT 优先，其次内置预设，都没有则为 null */
export function selectActiveLut(state: AppState): Lut3D | null {
  return resolveActiveLut(state.customLut?.lut ?? null, state.lutPresetId);
}
