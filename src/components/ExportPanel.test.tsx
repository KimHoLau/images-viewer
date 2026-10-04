import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageRenderer } from '../renderer/ImageRenderer';
import { makeBrowseResult } from '../test/fixtures';
import { useAppStore } from '../store/useAppStore';

const { registry, exportMocks } = vi.hoisted(() => ({
  registry: { renderer: null as unknown },
  exportMocks: { renderExport: vi.fn(), downloadBlob: vi.fn() },
}));

vi.mock('../renderer/renderer-registry', () => ({
  getActiveRenderer: () => registry.renderer,
  setActiveRenderer: (renderer: unknown) => {
    registry.renderer = renderer;
  },
}));

vi.mock('../services/export', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../services/export')>();
  return {
    ...actual,
    renderExport: exportMocks.renderExport,
    downloadBlob: exportMocks.downloadBlob,
  };
});

const { ExportPanel } = await import('./ExportPanel');

const initialAppState = useAppStore.getState();

function makeFakeRenderer(width = 6000, height = 4000) {
  return {
    hasImage: () => true,
    getImageSize: () => ({ width, height }),
  } as unknown as ImageRenderer;
}

describe('ExportPanel', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppState, true);
    vi.clearAllMocks();
    registry.renderer = makeFakeRenderer();
  });

  it('summarises the output size using the full image by default', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));

    render(<ExportPanel />);
    expect(screen.getByText('输出 6000 × 4000')).toBeInTheDocument();
  });

  it('recalculates the output size when a resolution is chosen', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));

    render(<ExportPanel />);
    fireEvent.change(screen.getByLabelText('分辨率'), { target: { value: '2048' } });

    expect(screen.getByText('输出 2048 × 1365')).toBeInTheDocument();
  });

  it('prompts when no image is open', () => {
    registry.renderer = null;
    render(<ExportPanel />);

    expect(screen.getByText('打开图片后可导出')).toBeInTheDocument();
    expect(screen.getByText('导出图片')).toBeDisabled();
  });

  it('disables export when there is no current image', () => {
    useAppStore.getState().setFolder(makeBrowseResult([]));
    render(<ExportPanel />);
    expect(screen.getByText('导出图片')).toBeDisabled();
  });

  it('offers the three formats', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
    render(<ExportPanel />);

    const select = screen.getByLabelText('格式');
    expect(select).toHaveValue('jpeg');
    expect(screen.getByRole('option', { name: /WebP/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /PNG/ })).toBeInTheDocument();
  });

  it('hides the quality slider for PNG', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
    render(<ExportPanel />);

    expect(screen.getByLabelText('质量')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('格式'), { target: { value: 'png' } });

    expect(screen.queryByLabelText('质量')).not.toBeInTheDocument();
  });

  it('exports with the chosen settings and reports the result', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
    exportMocks.renderExport.mockResolvedValueOnce({
      blob: new Blob(['x']),
      width: 2048,
      height: 1365,
      fileName: 'shot-2048x1365.png',
    });

    render(<ExportPanel />);
    fireEvent.change(screen.getByLabelText('格式'), { target: { value: 'png' } });
    fireEvent.change(screen.getByLabelText('分辨率'), { target: { value: '2048' } });
    fireEvent.click(screen.getByText('导出图片'));

    await waitFor(() => {
      expect(exportMocks.renderExport).toHaveBeenCalledWith(
        registry.renderer,
        'shot.jpg',
        expect.objectContaining({ format: 'png', maxLongEdge: 2048 }),
      );
    });
    expect(exportMocks.downloadBlob).toHaveBeenCalledWith(expect.any(Blob), 'shot-2048x1365.png');
    expect(await screen.findByText(/已导出 shot-2048x1365\.png/)).toBeInTheDocument();
  });

  it('passes the current quality through', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
    exportMocks.renderExport.mockResolvedValueOnce({
      blob: new Blob(['x']),
      width: 6000,
      height: 4000,
      fileName: 'shot-6000x4000.jpg',
    });

    render(<ExportPanel />);
    fireEvent.change(screen.getByLabelText('质量'), { target: { value: '0.5' } });
    fireEvent.click(screen.getByText('导出图片'));

    await waitFor(() => {
      expect(exportMocks.renderExport).toHaveBeenCalledWith(
        registry.renderer,
        'shot.jpg',
        expect.objectContaining({ quality: 0.5 }),
      );
    });
  });

  it('surfaces an export failure', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
    exportMocks.renderExport.mockRejectedValueOnce(new Error('显存不足'));

    render(<ExportPanel />);
    fireEvent.click(screen.getByText('导出图片'));

    expect(await screen.findByText(/导出失败：显存不足/)).toBeInTheDocument();
    expect(exportMocks.downloadBlob).not.toHaveBeenCalled();
  });

  it('reports a missing renderer instead of throwing', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
    registry.renderer = null;

    render(<ExportPanel />);
    fireEvent.click(screen.getByText('导出图片'));

    expect(await screen.findByText('没有可导出的图片')).toBeInTheDocument();
  });
});
