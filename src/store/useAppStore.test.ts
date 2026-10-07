import { beforeEach, describe, expect, it, vi } from 'vitest';
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

/** 官方 LUT 的清单与载入换成替身：单测不该依赖 3DLUT/ 目录里到底打包了哪些文件 */
const { ENTRIES, loadOfficialLutMock } = vi.hoisted(() => ({
  ENTRIES: [
    { key: 'F-Log/FLog_A.cube.gz', name: 'FLog_A', url: '/3DLUT/F-Log/FLog_A.cube.gz' },
    { key: 'F-Log/FLog_B.cube.gz', name: 'FLog_B', url: '/3DLUT/F-Log/FLog_B.cube.gz' },
  ],
  loadOfficialLutMock: vi.fn(),
}));

vi.mock('../lut/official-luts', () => ({
  officialLutEntries: (logSpaceId: string | null) => (logSpaceId === 'f-log' ? ENTRIES : []),
  loadOfficialLut: loadOfficialLutMock,
}));

const initialState = useAppStore.getState();

function makeLut(): Lut3D {
  return { size: 2, data: new Float32Array(24), title: '测试 LUT' };
}

/**
 * 选中一个官方 LUT 并等它落地。
 * 真实流程是「先选色彩空间 → 清单出来 → 在下拉里选一项」，这里按同一个顺序走一遍。
 */
async function pickOfficialLut(key: string = ENTRIES[0].key): Promise<void> {
  useAppStore.getState().setLogSpace('f-log');
  useAppStore.getState().setOfficialLut(key);
  await vi.waitFor(() => {
    expect(useAppStore.getState().officialLut).not.toBeNull();
  });
}

describe('useAppStore', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    loadOfficialLutMock.mockReset();
    loadOfficialLutMock.mockResolvedValue(makeLut());
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

    it('resets adjustments when a new folder is opened', async () => {
      useAppStore.getState().setAdjustment('exposure', 1.5);
      await pickOfficialLut();

      useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));

      expect(useAppStore.getState().adjustments).toEqual(DEFAULT_ADJUSTMENTS);
      expect(useAppStore.getState().officialLutKey).toBeNull();
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

  describe('setOfficialLut', () => {
    it('stores the selected entry and loads it', async () => {
      await pickOfficialLut(ENTRIES[1].key);

      expect(useAppStore.getState().officialLutKey).toBe(ENTRIES[1].key);
      expect(useAppStore.getState().officialLut?.title).toBe('测试 LUT');
      expect(loadOfficialLutMock).toHaveBeenCalledWith(ENTRIES[1]);
    });

    it('clears selection and data when passed null', async () => {
      await pickOfficialLut();

      useAppStore.getState().setOfficialLut(null);

      expect(useAppStore.getState().officialLutKey).toBeNull();
      expect(useAppStore.getState().officialLut).toBeNull();
    });

    it('treats a key outside the current list as no LUT', async () => {
      await pickOfficialLut();

      useAppStore.getState().setOfficialLut('V-Log/不存在.cube.gz');

      expect(useAppStore.getState().officialLutKey).toBeNull();
    });

    it('drops the imported-LUT selection when an official LUT is chosen', async () => {
      useAppStore.getState().addCustomLuts([{ name: 'x', lut: makeLut() }]);

      await pickOfficialLut();

      expect(useAppStore.getState().customLutKey).toBeNull();
      expect(useAppStore.getState().officialLutKey).toBe(ENTRIES[0].key);
    });

    it('keeps the imported library around', async () => {
      useAppStore.getState().addCustomLuts([{ name: 'x', lut: makeLut() }]);

      await pickOfficialLut();

      // 只是不再选中它，素材本身不该丢
      expect(useAppStore.getState().lutLibrary).toHaveLength(1);
    });

    it('载入失败写成 officialLutError，而不是整个界面的 error', async () => {
      loadOfficialLutMock.mockRejectedValueOnce(new Error('HTTP 404'));

      useAppStore.getState().setLogSpace('f-log');
      useAppStore.getState().setOfficialLut(ENTRIES[0].key);

      await vi.waitFor(() => {
        expect(useAppStore.getState().officialLutError).toBe('HTTP 404');
      });
      expect(useAppStore.getState().officialLut).toBeNull();
      expect(useAppStore.getState().officialLutLoading).toBe(false);
      expect(useAppStore.getState().status).not.toBe('error');
      expect(useAppStore.getState().error).toBeNull();
    });

    it('清掉选择之后，迟到的载入结果不再落地', async () => {
      let resolveLoad: (lut: Lut3D) => void = () => {};
      loadOfficialLutMock.mockImplementationOnce(
        () =>
          new Promise<Lut3D>((resolve) => {
            resolveLoad = resolve;
          }),
      );

      useAppStore.getState().setLogSpace('f-log');
      useAppStore.getState().setOfficialLut(ENTRIES[0].key);
      expect(useAppStore.getState().officialLutLoading).toBe(true);

      useAppStore.getState().clearActiveLut();
      resolveLoad(makeLut());
      await Promise.resolve();
      await Promise.resolve();

      expect(useAppStore.getState().officialLut).toBeNull();
      expect(useAppStore.getState().officialLutLoading).toBe(false);
    });
  });

  describe('addCustomLuts', () => {
    it('stores every imported LUT and displaces the official one', async () => {
      await pickOfficialLut();

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
      expect(useAppStore.getState().officialLutKey).toBeNull();
      expect(useAppStore.getState().customLutKey).toBe(useAppStore.getState().lutLibrary[0].key);
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
    it('switches the active LUT and displaces the official one', async () => {
      useAppStore.getState().addCustomLuts([
        { name: 'a.cube', lut: makeLut() },
        { name: 'b.cube', lut: makeLut() },
      ]);
      const [first, second] = useAppStore.getState().lutLibrary;
      await pickOfficialLut();

      useAppStore.getState().setActiveCustomLut(second.key);

      expect(selectCustomLut(useAppStore.getState())?.name).toBe('b.cube');
      expect(useAppStore.getState().officialLutKey).toBeNull();

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
      // 库里空了且没有官方 LUT → 回到原图
      expect(selectActiveLut(useAppStore.getState())).toBeNull();
      expect(selectHasLut(useAppStore.getState())).toBe(false);
    });

    it('does not resurrect the official LUT that the custom one displaced', async () => {
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);
      const key = useAppStore.getState().lutLibrary[0].key;
      await pickOfficialLut();
      useAppStore.getState().setActiveCustomLut(key);

      useAppStore.getState().removeCustomLut(key);

      // 选自定义 LUT 时官方那份就清了；两个互斥的选择，不该在删除后自己回来
      expect(useAppStore.getState().officialLutKey).toBeNull();
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

    it('returns the loaded official LUT', async () => {
      await pickOfficialLut();
      expect(selectActiveLut(useAppStore.getState())).toBe(useAppStore.getState().officialLut);
    });

    it('prefers the selected imported LUT', () => {
      const custom = makeLut();
      useAppStore.getState().addCustomLuts([{ name: 'custom', lut: custom }]);
      expect(selectActiveLut(useAppStore.getState())).toBe(custom);
    });

    it('falls back to the official LUT when the selected key is gone from the library', async () => {
      await pickOfficialLut();
      const official = useAppStore.getState().officialLut;
      useAppStore.getState().addCustomLuts([{ name: 'a.cube', lut: makeLut() }]);
      const key = useAppStore.getState().lutLibrary[0].key;
      // 手工造出「选了自定义 LUT，同时官方那份也没被清」的异常状态：
      // 正常流程里 setActiveCustomLut 会清掉官方选择，这里只验选择器本身的兜底
      useAppStore.setState({ customLutKey: key, officialLutKey: ENTRIES[0].key, officialLut: official });

      // 直接改库、不经过 remove
      useAppStore.setState({ lutLibrary: [] });

      expect(selectActiveLut(useAppStore.getState())).toBe(official);
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

    it('换色彩空间清掉官方 LUT 的选择与数据', async () => {
      await pickOfficialLut();

      useAppStore.getState().setLogSpace('f-log2');

      expect(useAppStore.getState().officialLutKey).toBeNull();
      expect(useAppStore.getState().officialLut).toBeNull();
    });

    it('每个空间都能取到连续的下标', () => {
      LOG_SPACES.forEach((space, index) => {
        useAppStore.getState().setLogSpace(space.id);
        expect(selectLogSpaceIndex(useAppStore.getState())).toBe(index);
      });
    });
  });

  describe('selectHasLut', () => {
    it('官方 LUT 与选中的载入 LUT 都算有', async () => {
      expect(selectHasLut(useAppStore.getState())).toBe(false);

      await pickOfficialLut();
      expect(selectHasLut(useAppStore.getState())).toBe(true);

      useAppStore.getState().setOfficialLut(null);
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

  it('换文件夹时清掉 LUT 选择，但保留已导入的库', async () => {
    await pickOfficialLut();
    useAppStore.getState().addCustomLuts([
      { name: 'a.cube', lut: makeLut() },
      { name: 'b.cube', lut: makeLut() },
    ]);
    // 导入会把官方那份挤掉，这里手工挂回去，专测 setFolder 这一条
    useAppStore.setState({ officialLutKey: ENTRIES[0].key, officialLut: makeLut() });

    useAppStore.getState().setFolder(makeBrowseResult(['a.cr2']));

    expect(useAppStore.getState().customLutKey).toBeNull();
    expect(useAppStore.getState().officialLutKey).toBeNull();
    expect(useAppStore.getState().lutLibrary).toHaveLength(2);
  });

  it('resets only the numeric adjustments, leaving the LUT choice alone', async () => {
    await pickOfficialLut(ENTRIES[1].key);
    useAppStore.getState().setAdjustment('exposure', 2);

    useAppStore.getState().resetAdjustments();

    expect(useAppStore.getState().adjustments).toEqual(DEFAULT_ADJUSTMENTS);
    expect(useAppStore.getState().officialLutKey).toBe(ENTRIES[1].key);
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
