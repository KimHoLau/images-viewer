import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { makeBrowseResult } from '../test/fixtures';
import { useAppStore } from '../store/useAppStore';
import { useViewerStore } from '../store/useViewerStore';
import { Toolbar } from './Toolbar';

vi.mock('../services/file-browser', () => ({
  openFolder: vi.fn(),
  openFiles: vi.fn(),
}));

const { openFolder } = await import('../services/file-browser');
const mockedOpenFolder = vi.mocked(openFolder);

const initialAppState = useAppStore.getState();
const initialViewerState = useViewerStore.getState();

describe('Toolbar', () => {
  beforeEach(() => {
    useAppStore.setState(initialAppState, true);
    useViewerStore.setState(initialViewerState, true);
    vi.clearAllMocks();
  });

  it('shows a placeholder when no folder is open', () => {
    render(<Toolbar />);
    expect(screen.getByText('未选择文件夹')).toBeInTheDocument();
  });

  it('shows the folder name and position counter', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg', 'b.jpg', 'c.jpg'], 'Shots'));
    useAppStore.getState().selectImage(1);

    render(<Toolbar />);

    expect(screen.getByText('Shots')).toBeInTheDocument();
    expect(screen.getByText('2 / 3')).toBeInTheDocument();
  });

  it('opens a folder and stores the result', async () => {
    mockedOpenFolder.mockResolvedValueOnce(makeBrowseResult(['x.jpg'], 'Opened'));

    render(<Toolbar />);
    fireEvent.click(screen.getByText('打开文件夹'));

    await waitFor(() => {
      expect(useAppStore.getState().folderName).toBe('Opened');
    });
    expect(useAppStore.getState().images).toHaveLength(1);
  });

  it('restores the previous status when the user cancels', async () => {
    mockedOpenFolder.mockRejectedValueOnce(new DOMException('cancelled', 'AbortError'));

    render(<Toolbar />);
    fireEvent.click(screen.getByText('打开文件夹'));

    await waitFor(() => {
      expect(useAppStore.getState().status).toBe('empty');
    });
    expect(useAppStore.getState().error).toBeNull();
  });

  it('shows an error when opening fails', async () => {
    mockedOpenFolder.mockRejectedValueOnce(new Error('打不开'));

    render(<Toolbar />);
    fireEvent.click(screen.getByText('打开文件夹'));

    await waitFor(() => {
      expect(useAppStore.getState().error).toBe('打不开');
    });
  });

  it('drives zoom through the viewer store', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));

    render(<Toolbar />);
    expect(screen.getByText('100%')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('放大'));
    expect(useViewerStore.getState().zoom).toBe(1.5);
    expect(screen.getByText('150%')).toBeInTheDocument();

    fireEvent.click(screen.getByLabelText('缩小'));
    expect(useViewerStore.getState().zoom).toBe(1);
  });

  it('resets the view when the zoom label is clicked', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));
    useViewerStore.getState().setZoom(4);

    render(<Toolbar />);
    fireEvent.click(screen.getByText('400%'));

    expect(useViewerStore.getState().zoom).toBe(1);
  });

  it('disables the zoom controls when there is no image', () => {
    render(<Toolbar />);

    expect(screen.getByLabelText('放大')).toBeDisabled();
    expect(screen.getByLabelText('缩小')).toBeDisabled();
  });
});
