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
    it('parses a .cube file into the store', async () => {
      render(<LutPanel />);

      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      const file = new File([CUBE_FILE], 'look.cube');
      fireEvent.change(input, { target: { files: [file] } });

      await waitFor(() => {
        expect(useAppStore.getState().customLut).not.toBeNull();
      });

      const custom = useAppStore.getState().customLut!;
      expect(custom.name).toBe('Imported Look');
      expect(custom.lut.size).toBe(2);
    });

    it('shows the imported LUT name', async () => {
      useAppStore.getState().setCustomLut({
        name: '我的预设',
        lut: { size: 2, data: new Float32Array(24) },
      });

      render(<LutPanel />);
      expect(screen.getByText('我的预设')).toBeInTheDocument();
    });

    it('falls back to the file name when the LUT has no title', async () => {
      const untitled = CUBE_FILE.replace(/TITLE ".*"\n/, '');
      render(<LutPanel />);

      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      fireEvent.change(input, { target: { files: [new File([untitled], 'no-title.cube')] } });

      await waitFor(() => {
        expect(useAppStore.getState().customLut?.name).toBe('no-title.cube');
      });
    });

    it('reports a parse error without changing the LUT', async () => {
      render(<LutPanel />);

      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      fireEvent.change(input, { target: { files: [new File(['不是 LUT'], 'broken.cube')] } });

      await waitFor(() => {
        expect(useAppStore.getState().error).toContain('无法载入 LUT');
      });
      expect(useAppStore.getState().customLut).toBeNull();
    });

    it('dispatches .3dl files to the 3dl parser', async () => {
      const entries: string[] = [];
      for (let i = 0; i < 27; i++) entries.push('0 0 0');
      const content = `3DMESH\nMesh 1 1\n3\n${entries.join('\n')}`;

      render(<LutPanel />);
      const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
      fireEvent.change(input, { target: { files: [new File([content], 'look.3dl')] } });

      await waitFor(() => {
        expect(useAppStore.getState().customLut?.lut.size).toBe(3);
      });
    });
  });
});
