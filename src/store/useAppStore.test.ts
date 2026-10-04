import { beforeEach, describe, expect, it } from 'vitest';
import type { Lut3D } from '../lut/types';
import { makeBrowseResult, makeFileEntry } from '../test/fixtures';
import { DEFAULT_ADJUSTMENTS } from '../types/adjustments';
import { selectActiveLut, selectCurrentImage, useAppStore } from './useAppStore';

const initialState = useAppStore.getState();

function makeLut(): Lut3D {
  return { size: 2, data: new Float32Array(24), title: '测试 LUT' };
}

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
  });

  describe('setFolder', () => {
    it('stores the folder and selects the first image', () => {
      useAppStore.getState().setFolder(makeBrowseResult(['a.jpg', 'b.jpg']));

      const state = useAppStore.getState();
      expect(state.folderName).toBe('Test Folder');
      expect(state.images).toHaveLength(2);
      expect(state.currentIndex).toBe(0);
      expect(state.status).toBe('ready');
      expect(state.error).toBeNull();
    });

    it('reports an empty folder', () => {
      useAppStore.getState().setFolder(makeBrowseResult([], 'Empty'));

      const state = useAppStore.getState();
      expect(state.currentIndex).toBe(-1);
      expect(state.status).toBe('empty');
      expect(state.error).toContain('没有支持的图片');
    });

    it('resets adjustments when a new folder is opened', () => {
      useAppStore.getState().setAdjustment('exposure', 1.5);
      useAppStore.getState().setLutPreset('vintage');

      useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));

      expect(useAppStore.getState().adjustments).toEqual(DEFAULT_ADJUSTMENTS);
      expect(useAppStore.getState().lutPresetId).toBeNull();
    });
  });

  describe('selectImage', () => {
    beforeEach(() => {
      useAppStore.getState().setFolder(makeBrowseResult(['a.jpg', 'b.jpg', 'c.jpg']));
    });

    it('selects a valid index', () => {
      useAppStore.getState().selectImage(2);
      expect(useAppStore.getState().currentIndex).toBe(2);
    });

    it('ignores out-of-range and non-integer indices', () => {
      useAppStore.getState().selectImage(1);
      useAppStore.getState().selectImage(99);
      expect(useAppStore.getState().currentIndex).toBe(1);
      useAppStore.getState().selectImage(-1);
      expect(useAppStore.getState().currentIndex).toBe(1);
      useAppStore.getState().selectImage(1.5);
      expect(useAppStore.getState().currentIndex).toBe(1);
    });
  });

  describe('navigation', () => {
    beforeEach(() => {
      useAppStore.getState().setFolder(makeBrowseResult(['a.jpg', 'b.jpg', 'c.jpg']));
    });

    it('moves forward and stops at the last image', () => {
      useAppStore.getState().nextImage();
      expect(useAppStore.getState().currentIndex).toBe(1);
      useAppStore.getState().nextImage();
      useAppStore.getState().nextImage();
      expect(useAppStore.getState().currentIndex).toBe(2);
    });

    it('moves backward and stops at the first image', () => {
      useAppStore.getState().selectImage(2);
      useAppStore.getState().previousImage();
      expect(useAppStore.getState().currentIndex).toBe(1);
      useAppStore.getState().previousImage();
      useAppStore.getState().previousImage();
      expect(useAppStore.getState().currentIndex).toBe(0);
    });
  });

  describe('adjustments', () => {
    it('updates a single key', () => {
      useAppStore.getState().setAdjustment('contrast', 0.4);
      expect(useAppStore.getState().adjustments.contrast).toBe(0.4);
      expect(useAppStore.getState().adjustments.exposure).toBe(0);
    });

    it('clamps out-of-range values', () => {
      useAppStore.getState().setAdjustment('exposure', 50);
      expect(useAppStore.getState().adjustments.exposure).toBe(3);
    });

    it('resets to defaults', () => {
      useAppStore.getState().setAdjustment('saturation', -0.8);
      useAppStore.getState().resetAdjustments();
      expect(useAppStore.getState().adjustments).toEqual(DEFAULT_ADJUSTMENTS);
    });
  });

  describe('status and errors', () => {
    it('sets an error status', () => {
      useAppStore.getState().setError('出问题了');
      expect(useAppStore.getState().error).toBe('出问题了');
      expect(useAppStore.getState().status).toBe('error');
    });

    it('clears the folder', () => {
      useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));
      useAppStore.getState().clearFolder();

      const state = useAppStore.getState();
      expect(state.folderName).toBeNull();
      expect(state.images).toEqual([]);
      expect(state.currentIndex).toBe(-1);
    });
  });

  describe('selectCurrentImage', () => {
    it('returns null when nothing is selected', () => {
      expect(selectCurrentImage(useAppStore.getState())).toBeNull();
    });

    it('returns the entry at currentIndex', () => {
      useAppStore.getState().setFolder(makeBrowseResult(['a.jpg', 'b.jpg']));
      useAppStore.getState().selectImage(1);
      expect(selectCurrentImage(useAppStore.getState())).toEqual(
        expect.objectContaining({ name: 'b.jpg' }),
      );
    });

    it('returns null when the index is stale', () => {
      useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));
      useAppStore.setState({ currentIndex: 5 });
      expect(selectCurrentImage(useAppStore.getState())).toBeNull();
    });
  });

  describe('setLutPreset', () => {
    it('stores and clears the preset id', () => {
      useAppStore.getState().setLutPreset('warm');
      expect(useAppStore.getState().lutPresetId).toBe('warm');
      useAppStore.getState().setLutPreset(null);
      expect(useAppStore.getState().lutPresetId).toBeNull();
    });

    it('drops an imported LUT when a preset is chosen', () => {
      useAppStore.getState().setCustomLut({ name: 'x', lut: makeLut() });
      useAppStore.getState().setLutPreset('mono');

      expect(useAppStore.getState().customLut).toBeNull();
      expect(useAppStore.getState().lutPresetId).toBe('mono');
    });
  });

  describe('setCustomLut', () => {
    it('stores the imported LUT and clears the preset', () => {
      useAppStore.getState().setLutPreset('mono');
      useAppStore.getState().setCustomLut({ name: 'look.cube', lut: makeLut() });

      expect(useAppStore.getState().customLut?.name).toBe('look.cube');
      expect(useAppStore.getState().lutPresetId).toBeNull();
    });

    it('can be cleared', () => {
      useAppStore.getState().setCustomLut({ name: 'look.cube', lut: makeLut() });
      useAppStore.getState().setCustomLut(null);
      expect(useAppStore.getState().customLut).toBeNull();
    });
  });

  describe('selectActiveLut', () => {
    it('is null by default', () => {
      expect(selectActiveLut(useAppStore.getState())).toBeNull();
    });

    it('resolves the selected preset', () => {
      useAppStore.getState().setLutPreset('mono');
      expect(selectActiveLut(useAppStore.getState())?.title).toBe('黑白');
    });

    it('prefers the imported LUT', () => {
      const custom = makeLut();
      useAppStore.getState().setCustomLut({ name: 'custom', lut: custom });
      expect(selectActiveLut(useAppStore.getState())).toBe(custom);
    });
  });

  it('resets only the numeric adjustments, leaving the LUT choice alone', () => {
    useAppStore.getState().setLutPreset('vivid');
    useAppStore.getState().setAdjustment('exposure', 2);

    useAppStore.getState().resetAdjustments();

    expect(useAppStore.getState().adjustments).toEqual(DEFAULT_ADJUSTMENTS);
    expect(useAppStore.getState().lutPresetId).toBe('vivid');
  });

  it('keeps isRaw in sync with the extension', () => {
    useAppStore.getState().setFolder({
      folderName: 'mixed',
      images: [makeFileEntry('a.cr2'), makeFileEntry('b.jpg')],
      isFileSystemAccess: false,
    });

    const [raw, plain] = useAppStore.getState().images;
    expect(raw.isRaw).toBe(true);
    expect(plain.isRaw).toBe(false);
  });
});
