import { fireEvent, render } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { makeBrowseResult } from '../test/fixtures';
import { useAppStore } from '../store/useAppStore';
import { Filmstrip } from './Filmstrip';

const initialState = useAppStore.getState();

describe('Filmstrip', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
  });

  it('renders nothing when there are no images', () => {
    const { container } = render(<Filmstrip />);
    expect(container.querySelector('.filmstrip')).toBeNull();
  });

  it('renders one thumbnail per image', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg', 'b.png', 'c.cr2']));

    const { container } = render(<Filmstrip />);

    expect(container.querySelectorAll('.thumb')).toHaveLength(3);
  });

  it('marks the current image as active', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg', 'b.jpg']));
    useAppStore.getState().selectImage(1);

    const { container } = render(<Filmstrip />);

    const active = container.querySelectorAll('.thumb--active');
    expect(active).toHaveLength(1);
    expect(active[0].getAttribute('title')).toBe('b.jpg');
  });

  it('selects an image when its thumbnail is clicked', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg', 'b.jpg', 'c.jpg']));

    const { container } = render(<Filmstrip />);
    const thumbs = container.querySelectorAll<HTMLButtonElement>('.thumb');
    fireEvent.click(thumbs[2]);

    expect(useAppStore.getState().currentIndex).toBe(2);
  });

  it('flags RAW files with a badge', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2', 'plain.jpg']));

    const { container } = render(<Filmstrip />);

    const badges = container.querySelectorAll('.thumb__badge');
    expect(badges).toHaveLength(1);
    expect(badges[0].textContent).toBe('RAW');
  });

  it('falls back to a placeholder when the thumbnail is unavailable', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));

    const { container } = render(<Filmstrip />);

    // jsdom 里没有 Worker，缩略图服务不可用，应退化为占位符而不是报错
    expect(container.querySelector('.thumb__placeholder')).not.toBeNull();
  });

  it('renders every image with a stable key even for duplicate names', () => {
    useAppStore.getState().setFolder({
      folderName: 'dup',
      images: [
        { ...makeBrowseResult(['a.jpg']).images[0], path: 'dir1/a.jpg' },
        { ...makeBrowseResult(['a.jpg']).images[0], path: 'dir2/a.jpg' },
      ],
      isFileSystemAccess: false,
    });

    const { container } = render(<Filmstrip />);
    expect(container.querySelectorAll('.thumb')).toHaveLength(2);
  });
});
