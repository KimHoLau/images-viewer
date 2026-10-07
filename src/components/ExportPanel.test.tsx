import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { ImageRenderer } from '../renderer/ImageRenderer';
import { makeBrowseResult, makeRawMetadata } from '../test/fixtures';
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

describe('ExportPanel 的 EXIF 保留', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppState, true);
    vi.clearAllMocks();
    registry.renderer = makeFakeRenderer();
  });

  function mockExport(exifStatus: string): void {
    exportMocks.renderExport.mockResolvedValueOnce({
      blob: new Blob(['x']),
      width: 6000,
      height: 4000,
      fileName: 'shot-6000x4000.jpg',
      exifStatus,
    });
  }

  it('RAW 源导出时把拍摄信息作为 EXIF 来源传下去', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));
    mockExport('attached');

    render(<ExportPanel metadata={makeRawMetadata({ make: 'Pentax', model: 'K-30' })} />);
    fireEvent.click(screen.getByText('导出图片'));

    await waitFor(() => expect(exportMocks.renderExport).toHaveBeenCalled());
    const options = exportMocks.renderExport.mock.calls[0][2] as {
      exif: { fallback: { make: string; model: string } };
    };
    expect(options.exif.fallback).toMatchObject({ make: 'Pentax', model: 'K-30' });
    expect(await screen.findByText(/已带上原拍摄 EXIF/)).toBeInTheDocument();
  });

  it('常规格式的源不带 EXIF 来源', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));
    mockExport('unavailable');

    render(<ExportPanel />);
    fireEvent.click(screen.getByText('导出图片'));

    await waitFor(() => expect(exportMocks.renderExport).toHaveBeenCalled());
    const options = exportMocks.renderExport.mock.calls[0][2] as { exif: unknown };
    expect(options.exif).toBeNull();
    // 非 RAW 源不谈这件事，不打扰用户
    expect(screen.queryByText(/EXIF/)).not.toBeInTheDocument();
  });

  it('WebP 选中的时候就标注不带 EXIF', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));

    render(<ExportPanel metadata={makeRawMetadata()} />);
    fireEvent.change(screen.getByLabelText('格式'), { target: { value: 'webp' } });

    expect(screen.getByText(/WebP 不写入 EXIF/)).toBeInTheDocument();
  });

  it('常规格式的源不显示 WebP 的那条标注', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));

    render(<ExportPanel />);
    fireEvent.change(screen.getByLabelText('格式'), { target: { value: 'webp' } });

    expect(screen.queryByText(/不写入 EXIF/)).not.toBeInTheDocument();
  });

  it('WebP 导出结果如实说明该格式不写 EXIF', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));
    mockExport('unsupported');

    render(<ExportPanel metadata={makeRawMetadata()} />);
    fireEvent.change(screen.getByLabelText('格式'), { target: { value: 'webp' } });
    fireEvent.click(screen.getByText('导出图片'));

    expect(await screen.findByText(/该格式不写入 EXIF/)).toBeInTheDocument();
  });

  it('写入失败时说明图片本身正常', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));
    mockExport('failed');

    render(<ExportPanel metadata={makeRawMetadata()} />);
    fireEvent.click(screen.getByText('导出图片'));

    expect(await screen.findByText(/EXIF 写入失败，图片本身正常/)).toBeInTheDocument();
  });

  it('来源里没有拍摄信息时如实说明，不静默丢掉', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));
    mockExport('unavailable');

    render(<ExportPanel />);
    fireEvent.click(screen.getByText('导出图片'));

    expect(await screen.findByText(/源文件里没有可保留的拍摄信息/)).toBeInTheDocument();
  });

  it('RAW 源给一个「保留拍摄信息」开关，默认开着', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));

    render(<ExportPanel metadata={makeRawMetadata()} />);

    expect(screen.getByLabelText('保留拍摄信息（EXIF）')).toBeChecked();
  });

  it('常规格式的源没有这个开关（本来就没有可保留的东西）', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));

    render(<ExportPanel />);

    expect(screen.queryByLabelText('保留拍摄信息（EXIF）')).not.toBeInTheDocument();
  });

  it('关掉开关就不收集来源，并说明是「按你的设置没写」', async () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));
    mockExport('unavailable');

    render(<ExportPanel metadata={makeRawMetadata()} />);
    fireEvent.click(screen.getByLabelText('保留拍摄信息（EXIF）'));
    fireEvent.click(screen.getByText('导出图片'));

    await waitFor(() => expect(exportMocks.renderExport).toHaveBeenCalled());
    const options = exportMocks.renderExport.mock.calls[0][2] as { exif: unknown };
    expect(options.exif).toBeNull();
    expect(await screen.findByText(/未写入拍摄信息（已关闭保留）/)).toBeInTheDocument();
  });

  it('开关关掉之后不再显示 WebP 的那条标注', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));

    render(<ExportPanel metadata={makeRawMetadata()} />);
    fireEvent.change(screen.getByLabelText('格式'), { target: { value: 'webp' } });
    expect(screen.getByText(/WebP 不写入 EXIF/)).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('保留拍摄信息（EXIF）'));
    expect(screen.queryByText(/不写入 EXIF/)).not.toBeInTheDocument();
  });
});
