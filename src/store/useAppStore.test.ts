import { beforeEach, describe, expect, it } from 'vitest';
import { LOG_SPACES } from '../color/log-spaces';
import type { Lut3D } from '../lut/types';
import { makeBrowseResult, makeFileEntry } from '../test/fixtures';
import { DEFAULT_ADJUSTMENTS } from '../types/adjustments';
import {
  selectActiveLut,
  selectCurrentImage,
  selectCustomLut,
  selectHasLut,
  selectLogSpaceIndex,
  useAppStore,
} from './useAppStore';

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

    it('drops the imported-LUT selection when a preset is chosen', () => {
      useAppStore.getState().addCustomLuts([{ name: 'x', lut: makeLut() }]);
      useAppStore.getState().setLutPreset('mono');

      expect(useAppStore.getState().customLutKey).toBeNull();
      expect(useAppStore.getState().lutPresetId).toBe('mono');
    });

    it('keeps the imported library around', () => {
      useAppStore.getState().addCustomLuts([{ name: 'x', lut: makeLut() }]);
      useAppStore.getState().setLutPreset('mono');

      // 只是不再选中它，素材本身不该丢
      expect(useAppStore.getState().lutLibrary).toHaveLength(1);
    });
  });

  describe('addCustomLuts', () => {
    it('stores every imported LUT and clears the preset', () => {
      useAppStore.getState().setLutPreset('mono');
      useAppStore.getState().addCustomLuts([
        { name: 'a.cube', lut: makeLut() },
        { name: 'b.cube', lut: makeLut() },
        { name: 'c.cube', lut: makeLut() },
      ]);

      expect(useAppStore.getState().lutLibrary.map((entry) => entry.name)).toEqual([
        'a.cube',
        'b.cube',
        'c.cube',
      ]);
      expect(useAppStore.getState().lutPresetId).toBeNull();
    });

    it('selects the first one when nothing is selected yet', () => {
      useAppStore.getState().addCustomLuts([
        { name: 'a.cube', lut: makeLut() },
        { name: 'b.cube', lut: makeLut() },
      ]);

      expect(selectCustomLut(useAppStore.getState())?.name).toBe('a.cube');
    });

    it('replaces a same-named LUT instead of adding a duplicate', () => {
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);
      const key = useAppStore.getState().customLutKey;

      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);

      expect(useAppStore.getState().lutLibrary).toHaveLength(1);
      // 同一个名字复用的是同一个键，选择不会跳
      expect(useAppStore.getState().customLutKey).toBe(key);
    });

    it('appends a later batch without disturbing the current selection', () => {
      useAppStore.getState().addCustomLuts([
        { name: 'a.cube', lut: makeLut() },
        { name: 'b.cube', lut: makeLut() },
      ]);
      const [, second] = useAppStore.getState().lutLibrary;
      useAppStore.getState().setActiveCustomLut(second.key);

      useAppStore.getState().addCustomLuts([{ name: 'c.cube', lut: makeLut() }]);

      expect(useAppStore.getState().lutLibrary).toHaveLength(3);
      expect(selectCustomLut(useAppStore.getState())?.name).toBe('b.cube');
    });
  });

  describe('setActiveCustomLut', () => {
    it('switches the active LUT and clears the preset', () => {
      useAppStore.getState().addCustomLuts([
        { name: 'a.cube', lut: makeLut() },
        { name: 'b.cube', lut: makeLut() },
      ]);
      const [first, second] = useAppStore.getState().lutLibrary;
      useAppStore.getState().setLutPreset('mono');

      useAppStore.getState().setActiveCustomLut(second.key);

      expect(selectCustomLut(useAppStore.getState())?.name).toBe('b.cube');
      expect(useAppStore.getState().lutPresetId).toBeNull();

      useAppStore.getState().setActiveCustomLut(first.key);
      expect(selectCustomLut(useAppStore.getState())?.name).toBe('a.cube');
    });

    it('can be set back to none', () => {
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);
      useAppStore.getState().setActiveCustomLut(null);

      expect(useAppStore.getState().customLutKey).toBeNull();
      expect(selectActiveLut(useAppStore.getState())).toBeNull();
    });

    it('ignores a key that is not in the library', () => {
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);
      const key = useAppStore.getState().customLutKey;

      useAppStore.getState().setActiveCustomLut('nope');

      expect(useAppStore.getState().customLutKey).toBe(key);
    });
  });

  describe('removeCustomLut', () => {
    it('falls back to the first remaining LUT when the selected one is removed', () => {
      useAppStore.getState().addCustomLuts([
        { name: 'a.cube', lut: makeLut() },
        { name: 'b.cube', lut: makeLut() },
      ]);
      const [first, second] = useAppStore.getState().lutLibrary;
      useAppStore.getState().setActiveCustomLut(second.key);

      useAppStore.getState().removeCustomLut(second.key);

      expect(useAppStore.getState().lutLibrary.map((entry) => entry.name)).toEqual(['a.cube']);
      expect(useAppStore.getState().customLutKey).toBe(first.key);
    });

    it('falls back to no custom LUT when the library empties', () => {
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);
      const key = useAppStore.getState().lutLibrary[0].key;

      useAppStore.getState().removeCustomLut(key);

      expect(useAppStore.getState().lutLibrary).toHaveLength(0);
      expect(useAppStore.getState().customLutKey).toBeNull();
      // 库里空了且没有预设 → 回到原图
      expect(selectActiveLut(useAppStore.getState())).toBeNull();
      expect(selectHasLut(useAppStore.getState())).toBe(false);
    });

    it('does not resurrect the preset that the custom LUT had displaced', () => {
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);
      const key = useAppStore.getState().lutLibrary[0].key;
      useAppStore.getState().setLutPreset('mono');
      useAppStore.getState().setActiveCustomLut(key);

      useAppStore.getState().removeCustomLut(key);

      // 选自定义 LUT 时预设就清了；这是两个互斥的选择，不该在删除后自己回来
      expect(useAppStore.getState().lutPresetId).toBeNull();
      expect(selectActiveLut(useAppStore.getState())).toBeNull();
    });

    it('keeps the current selection when another one is removed', () => {
      useAppStore.getState().addCustomLuts([
        { name: 'a.cube', lut: makeLut() },
        { name: 'b.cube', lut: makeLut() },
      ]);
      const [first, second] = useAppStore.getState().lutLibrary;
      useAppStore.getState().setActiveCustomLut(second.key);

      useAppStore.getState().removeCustomLut(first.key);

      expect(useAppStore.getState().customLutKey).toBe(second.key);
    });

    it('ignores an unknown key', () => {
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);

      useAppStore.getState().removeCustomLut('nope');

      expect(useAppStore.getState().lutLibrary).toHaveLength(1);
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

    it('prefers the selected imported LUT', () => {
      const custom = makeLut();
      useAppStore.getState().addCustomLuts([{ name: 'custom', lut: custom }]);
      expect(selectActiveLut(useAppStore.getState())).toBe(custom);
    });

    it('falls back to the preset when the selected key is gone from the library', () => {
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);
      const key = useAppStore.getState().lutLibrary[0].key;
      // 手工造出「选了自定义 LUT，同时预设也没被清」的异常状态：
      // 正常流程里 setActiveCustomLut 会清掉预设，这里只验选择器本身的兜底
      useAppStore.setState({ customLutKey: key, lutPresetId: 'mono' });

      // 直接改库、不经过 remove
      useAppStore.setState({ lutLibrary: [] });

      expect(selectActiveLut(useAppStore.getState())?.title).toBe('黑白');
    });
  });

  describe('Log 色彩空间', () => {
    it('默认关闭', () => {
      expect(useAppStore.getState().logSpaceId).toBeNull();
      expect(selectLogSpaceIndex(useAppStore.getState())).toBe(-1);
    });

    it('接受表里有的 id', () => {
      useAppStore.getState().setLogSpace('s-log3');

      expect(useAppStore.getState().logSpaceId).toBe('s-log3');
      // 下标就是着色器 uniform 的取值
      expect(selectLogSpaceIndex(useAppStore.getState())).toBe(
        LOG_SPACES.findIndex((space) => space.id === 's-log3'),
      );
    });

    it('拒绝表里没有的 id，退回关闭', () => {
      useAppStore.getState().setLogSpace('s-log3');
      useAppStore.getState().setLogSpace('not-a-log-space');

      expect(useAppStore.getState().logSpaceId).toBeNull();
      expect(selectLogSpaceIndex(useAppStore.getState())).toBe(-1);
    });

    it('传 null 关闭', () => {
      useAppStore.getState().setLogSpace('v-log');
      useAppStore.getState().setLogSpace(null);
      expect(useAppStore.getState().logSpaceId).toBeNull();
    });

    it('换文件夹时跟着复位', () => {
      useAppStore.getState().setLogSpace('arri-logc3');
      useAppStore.getState().setFolder(makeBrowseResult(['a.cr2']));

      expect(useAppStore.getState().logSpaceId).toBeNull();
    });

    it('clearFolder 时跟着复位', () => {
      useAppStore.getState().setLogSpace('f-log');
      useAppStore.getState().clearFolder();
      expect(useAppStore.getState().logSpaceId).toBeNull();
    });

    it('每个空间都能取到连续的下标', () => {
      LOG_SPACES.forEach((space, index) => {
        useAppStore.getState().setLogSpace(space.id);
        expect(selectLogSpaceIndex(useAppStore.getState())).toBe(index);
      });
    });
  });

  describe('selectHasLut', () => {
    it('预设与选中的载入 LUT 都算有', () => {
      expect(selectHasLut(useAppStore.getState())).toBe(false);

      useAppStore.getState().setLutPreset('mono');
      expect(selectHasLut(useAppStore.getState())).toBe(true);

      useAppStore.getState().setLutPreset(null);
      useAppStore.getState().addCustomLuts([{ name: 'look.cube', lut: makeLut() }]);
      expect(selectHasLut(useAppStore.getState())).toBe(true);
    });

    it('库里导入了但没选中时不算有', () => {
      useAppStore.getState().addCustomLuts([{ name: 'look.cube', lut: makeLut() }]);
      useAppStore.getState().setActiveCustomLut(null);

      expect(useAppStore.getState().lutLibrary).toHaveLength(1);
      expect(selectHasLut(useAppStore.getState())).toBe(false);
    });
  });

  it('换文件夹时清掉 LUT 选择，但保留已导入的库', () => {
    useAppStore.getState().addCustomLuts([
      { name: 'a.cube', lut: makeLut() },
      { name: 'b.cube', lut: makeLut() },
    ]);

    useAppStore.getState().setFolder(makeBrowseResult(['a.cr2']));

    expect(useAppStore.getState().customLutKey).toBeNull();
    expect(useAppStore.getState().lutPresetId).toBeNull();
    expect(useAppStore.getState().lutLibrary).toHaveLength(2);
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
