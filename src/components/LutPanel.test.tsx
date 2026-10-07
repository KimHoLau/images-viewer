import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Lut3D } from '../lut/types';
import { useAppStore } from '../store/useAppStore';
import { LutPanel } from './LutPanel';

/**
 * 官方 LUT 的清单与载入都换成替身。
 *
 * 真清单是构建期 `import.meta.glob` 扫出来的，测试不该依赖 3DLUT/ 目录里
 * 到底打包了哪些文件，所以这里给一份确定的清单。
 */
const { ENTRIES, loadOfficialLutMock } = vi.hoisted(() => ({
  ENTRIES: [
    {
      key: 'F-Log/FLog_to_ETERNA_65grid_V.1.00.cube.gz',
      name: 'FLog_to_ETERNA_65grid_V.1.00',
      url: '/3DLUT/F-Log/FLog_to_ETERNA_65grid_V.1.00.cube.gz',
    },
    {
      key: 'F-Log/FLog_to_WDR-709_65grid_V.1.00.cube.gz',
      name: 'FLog_to_WDR-709_65grid_V.1.00',
      url: '/3DLUT/F-Log/FLog_to_WDR-709_65grid_V.1.00.cube.gz',
    },
  ],
  loadOfficialLutMock: vi.fn(),
}));

vi.mock('../lut/official-luts', () => ({
  officialLutEntries: (logSpaceId: string | null) => (logSpaceId === 'f-log' ? ENTRIES : []),
  loadOfficialLut: loadOfficialLutMock,
}));

const initialState = useAppStore.getState();

/** 2×2×2 的恒等 .cube，用于测试导入 */
const CUBE_FILE = `TITLE "Imported Look"
LUT_3D_SIZE 2
0 0 0
1 0 0
0 1 0
1 1 0
0 0 1
1 0 1
0 1 1
1 1 1
`;

/** 2×2×2 的占位 LUT，直接塞进库里用，省掉一次解析 */
function makeLut(): Lut3D {
  return { size: 2, data: new Float32Array(24), title: '占位' };
}

/** 文件输入；面板里只有这一个 */
function fileInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

/** 官方 LUT 的下拉框 */
function officialSelect(): HTMLSelectElement {
  return screen.getByLabelText('官方 LUT') as HTMLSelectElement;
}

/** 已载入 LUT 的下拉框；库为空时不存在 */
function librarySelect(): HTMLSelectElement | null {
  return screen.queryByRole('combobox', { name: '已载入的 LUT' }) as HTMLSelectElement | null;
}

/** 附上官方 LUT 的选择：与真实流程一样，先选色彩空间，再在下拉里选一项 */
async function selectOfficialLut(key: string): Promise<void> {
  useAppStore.setState({ logSpaceId: 'f-log' });
  render(<LutPanel />);
  fireEvent.change(officialSelect(), { target: { value: key } });
  // 等这一次载入落定：成功与失败都算落定，成功与否由调用方自己断言
  await waitFor(() => {
    expect(useAppStore.getState().officialLutKey).toBe(key);
    expect(useAppStore.getState().officialLutLoading).toBe(false);
  });
}

describe('LutPanel', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
    loadOfficialLutMock.mockReset();
    loadOfficialLutMock.mockResolvedValue(makeLut());
  });

  describe('官方 LUT 下拉', () => {
    it('没选色彩空间时不列条目，并提示先选一个', () => {
      render(<LutPanel />);

      expect(officialSelect()).toBeDisabled();
      expect(Array.from(officialSelect().options).map((option) => option.textContent)).toEqual([
        '不使用',
      ]);
      expect(screen.getByText(/先在上面选一个色彩空间/)).toBeInTheDocument();
    });

    it('列出当前色彩空间的条目并报数', () => {
      useAppStore.setState({ logSpaceId: 'f-log' });

      render(<LutPanel />);

      expect(officialSelect()).toBeEnabled();
      expect(Array.from(officialSelect().options).map((option) => option.textContent)).toEqual([
        '不使用',
        'FLog_to_ETERNA_65grid_V.1.00',
        'FLog_to_WDR-709_65grid_V.1.00',
      ]);
      expect(screen.getByText('已加载 2 个 LUT（F-Log）')).toBeInTheDocument();
    });

    it('没有对应目录的色彩空间：下拉禁用并说明原因', () => {
      useAppStore.setState({ logSpaceId: 'v-log' });

      render(<LutPanel />);

      expect(officialSelect()).toBeDisabled();
      expect(screen.getByText('该色彩空间暂无内置 LUT')).toBeInTheDocument();
    });

    it('选中某一条才去取那个文件，取回来挂进 store', async () => {
      const lut = makeLut();
      loadOfficialLutMock.mockResolvedValue(lut);

      await selectOfficialLut(ENTRIES[1].key);

      expect(loadOfficialLutMock).toHaveBeenCalledTimes(1);
      expect(loadOfficialLutMock).toHaveBeenCalledWith(ENTRIES[1]);
      expect(useAppStore.getState().officialLutKey).toBe(ENTRIES[1].key);
      expect(useAppStore.getState().officialLut).toBe(lut);
      expect(useAppStore.getState().officialLutLoading).toBe(false);
    });

    it('载入失败时就地提示，不把整个界面打成 error', async () => {
      loadOfficialLutMock.mockRejectedValue(new Error('HTTP 404'));

      await selectOfficialLut(ENTRIES[0].key);

      expect(await screen.findByText('无法载入 —— HTTP 404')).toBeInTheDocument();
      expect(useAppStore.getState().officialLutError).toBe('HTTP 404');
      expect(useAppStore.getState().status).not.toBe('error');
    });

    it('换色彩空间就清掉上一个空间选的 LUT', async () => {
      const lut = makeLut();
      loadOfficialLutMock.mockResolvedValue(lut);

      await selectOfficialLut(ENTRIES[0].key);

      act(() => {
        useAppStore.getState().setLogSpace('f-log2');
      });

      expect(useAppStore.getState().officialLutKey).toBeNull();
      expect(useAppStore.getState().officialLut).toBeNull();
    });

    it('选官方 LUT 会让导入的那份让位', async () => {
      useAppStore.getState().addCustomLuts([{ name: 'mine', lut: makeLut() }]);
      expect(useAppStore.getState().customLutKey).not.toBeNull();

      await selectOfficialLut(ENTRIES[0].key);

      expect(useAppStore.getState().customLutKey).toBeNull();
    });
  });

  describe('载入 LUT 文件', () => {
    it('parses a .cube file into the library', async () => {
      render(<LutPanel />);

      fireEvent.change(fileInput(), { target: { files: [new File([CUBE_FILE], 'look.cube')] } });

      await waitFor(() => {
        expect(useAppStore.getState().lutLibrary).toHaveLength(1);
      });

      const entry = useAppStore.getState().lutLibrary[0];
      expect(entry.name).toBe('Imported Look');
      expect(entry.lut.size).toBe(2);
    });

    it('accepts multiple files and keeps every one of them', async () => {
      render(<LutPanel />);

      fireEvent.change(fileInput(), {
        target: {
          files: [
            new File([CUBE_FILE], 'a.cube'),
            new File([CUBE_FILE.replace('Imported Look', 'Second Look')], 'b.cube'),
            new File([CUBE_FILE.replace('Imported Look', 'Third Look')], 'c.cube'),
          ],
        },
      });

      await waitFor(() => {
        expect(useAppStore.getState().lutLibrary).toHaveLength(3);
      });

      expect(useAppStore.getState().lutLibrary.map((entry) => entry.name)).toEqual([
        'Imported Look',
        'Second Look',
        'Third Look',
      ]);
      // 导入后自动选中第一个，画面立刻有变化
      expect(useAppStore.getState().customLutKey).toBe(useAppStore.getState().lutLibrary[0].key);
    });

    it('keeps the good files when one of them is broken', async () => {
      render(<LutPanel />);

      fireEvent.change(fileInput(), {
        target: {
          files: [new File([CUBE_FILE], 'good.cube'), new File(['不是 LUT'], 'broken.cube')],
        },
      });

      await waitFor(() => {
        expect(useAppStore.getState().lutLibrary).toHaveLength(1);
      });

      // 坏文件就地提示，且不把整个界面打成 error 状态
      expect(await screen.findByText(/broken\.cube/)).toBeInTheDocument();
      expect(useAppStore.getState().status).not.toBe('error');
    });

    it('lists every imported LUT in the dropdown and switches between them', async () => {
      render(<LutPanel />);

      fireEvent.change(fileInput(), {
        target: {
          files: [
            new File([CUBE_FILE], 'a.cube'),
            new File([CUBE_FILE.replace('Imported Look', 'Second Look')], 'b.cube'),
          ],
        },
      });

      await waitFor(() => {
        expect(librarySelect()).not.toBeNull();
      });

      const options = Array.from(librarySelect()!.options).map((option) => option.textContent);
      expect(options).toEqual(['不使用', 'Imported Look', 'Second Look']);

      const [first, second] = useAppStore.getState().lutLibrary;
      expect(librarySelect()!.value).toBe(first.key);

      fireEvent.change(librarySelect()!, { target: { value: second.key } });

      expect(useAppStore.getState().customLutKey).toBe(second.key);
      // 名字同时出现在下拉选项与下面的当前项里
      expect(screen.getAllByText('Second Look').length).toBeGreaterThan(0);
    });

    it('removes the selected LUT and falls back to the next one', async () => {
      render(<LutPanel />);

      fireEvent.change(fileInput(), {
        target: {
          files: [
            new File([CUBE_FILE], 'a.cube'),
            new File([CUBE_FILE.replace('Imported Look', 'Second Look')], 'b.cube'),
          ],
        },
      });

      await waitFor(() => {
        expect(useAppStore.getState().lutLibrary).toHaveLength(2);
      });

      fireEvent.click(screen.getByText('移除'));

      await waitFor(() => {
        expect(useAppStore.getState().lutLibrary).toHaveLength(1);
      });
      expect(useAppStore.getState().lutLibrary[0].name).toBe('Second Look');
      expect(useAppStore.getState().customLutKey).toBe(useAppStore.getState().lutLibrary[0].key);
    });

    it('hides the dropdown again once the library is empty', async () => {
      useAppStore.getState().addCustomLuts([{ name: 'only', lut: makeLut() }]);

      render(<LutPanel />);
      fireEvent.click(screen.getByText('移除'));

      await waitFor(() => {
        expect(librarySelect()).toBeNull();
      });
      expect(useAppStore.getState().customLutKey).toBeNull();
    });

    it('falls back to the file name when the LUT has no title', async () => {
      const untitled = CUBE_FILE.replace(/TITLE ".*"\n/, '');
      render(<LutPanel />);

      fireEvent.change(fileInput(), { target: { files: [new File([untitled], 'no-title.cube')] } });

      await waitFor(() => {
        expect(useAppStore.getState().lutLibrary[0]?.name).toBe('no-title.cube');
      });
    });

    it('dispatches .3dl files to the 3dl parser', async () => {
      const entries: string[] = [];
      for (let i = 0; i < 27; i++) entries.push('0 0 0');
      const content = `3DMESH\nMesh 1 1\n3\n${entries.join('\n')}`;

      render(<LutPanel />);
      fireEvent.change(fileInput(), { target: { files: [new File([content], 'look.3dl')] } });

      await waitFor(() => {
        expect(useAppStore.getState().lutLibrary[0]?.lut.size).toBe(3);
      });
    });
  });
});
