import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { LUT_PRESETS } from '../lut/presets';
import { useAppStore } from '../store/useAppStore';
import { LutPanel } from './LutPanel';

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
function makeLut() {
  return { size: 2, data: new Float32Array(24), title: '占位' };
}

/** 文件输入；面板里只有这一个 */
function fileInput(): HTMLInputElement {
  return document.querySelector<HTMLInputElement>('input[type="file"]')!;
}

/** 已载入 LUT 的下拉框；库为空时不存在 */
function librarySelect(): HTMLSelectElement | null {
  return screen.queryByRole('combobox', { name: '已载入的 LUT' }) as HTMLSelectElement | null;
}

describe('LutPanel', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
  });

  it('lists a neutral option plus every built-in preset', () => {
    render(<LutPanel />);

    expect(screen.getByText('原图')).toBeInTheDocument();
    for (const preset of LUT_PRESETS) {
      expect(screen.getByText(preset.name)).toBeInTheDocument();
    }
  });

  it('starts on the neutral option', () => {
    const { container } = render(<LutPanel />);
    const active = container.querySelectorAll('.lut-item--active');

    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('原图');
  });

  it('selects a preset on click', () => {
    render(<LutPanel />);
    fireEvent.click(screen.getByText('黑白'));

    expect(useAppStore.getState().lutPresetId).toBe('mono');
  });

  it('marks the selected preset as active', () => {
    useAppStore.getState().setLutPreset('vivid');

    const { container } = render(<LutPanel />);
    const active = container.querySelectorAll('.lut-item--active');

    expect(active).toHaveLength(1);
    expect(active[0].textContent).toContain('鲜艳');
  });

  it('returns to neutral', () => {
    useAppStore.getState().setLutPreset('vivid');

    render(<LutPanel />);
    fireEvent.click(screen.getByText('原图'));

    expect(useAppStore.getState().lutPresetId).toBeNull();
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
      expect(useAppStore.getState().customLutKey).toBe(
        useAppStore.getState().lutLibrary[0].key,
      );
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
