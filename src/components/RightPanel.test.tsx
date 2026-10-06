import { act, fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoadedImage } from '../services/image-loader';
import type { RawMetadata } from '../services/raw-decoder.worker';
import { makeBrowseResult } from '../test/fixtures';
import { useAppStore } from '../store/useAppStore';
import { RightPanel } from './RightPanel';

const initialState = useAppStore.getState();

function makeImage(
  overrides: Partial<LoadedImage> & { metadata?: RawMetadata | null } = {},
): LoadedImage {
  const { metadata = null, ...rest } = overrides;
  return {
    source: 'bitmap',
    bitmap: { close: vi.fn() } as unknown as ImageBitmap,
    width: 6000,
    height: 4000,
    metadata,
    ...rest,
  } as LoadedImage;
}

describe('RightPanel', () => {
  beforeEach(() => {
    useAppStore.setState(initialState, true);
  });

  it('prompts when no image is selected', () => {
    render(<RightPanel image={null} />);
    expect(screen.getByText('未选择图片')).toBeInTheDocument();
  });

  it('shows the file name, dimensions and format', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.jpg']));

    render(<RightPanel image={makeImage()} />);

    expect(screen.getByText('shot.jpg')).toBeInTheDocument();
    expect(screen.getByText('6000 × 4000')).toBeInTheDocument();
    expect(screen.getByText('JPG')).toBeInTheDocument();
  });

  it('shows RAW shooting metadata', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['shot.cr2']));

    render(
      <RightPanel
        image={makeImage({
          metadata: {
            width: 6000,
            height: 4000,
            make: 'Canon',
            model: 'EOS R5',
            colors: 3,
            iso: 400,
            shutter: 1 / 200,
            aperture: 2.8,
            focalLength: 35,
            timestamp: 0,
          },
        })}
      />,
    );

    expect(screen.getByText('Canon EOS R5')).toBeInTheDocument();
    expect(screen.getByText('ISO 400')).toBeInTheDocument();
    expect(screen.getByText('1/200')).toBeInTheDocument();
    expect(screen.getByText('f/2.8')).toBeInTheDocument();
    expect(screen.getByText('35mm')).toBeInTheDocument();
  });

  it('renders a slider for every adjustment definition', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));

    render(<RightPanel image={makeImage()} />);

    for (const label of ['色温', '色调', '曝光', '对比度', '高光', '阴影', '饱和度', 'LUT 强度']) {
      expect(screen.getByLabelText(label)).toBeInTheDocument();
    }
  });

  it('writes slider changes into the store', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));

    render(<RightPanel image={makeImage()} />);
    fireEvent.change(screen.getByLabelText('对比度'), { target: { value: '0.6' } });

    expect(useAppStore.getState().adjustments.contrast).toBeCloseTo(0.6);
  });

  it('enables the reset button only when something changed', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));

    const { rerender } = render(<RightPanel image={makeImage()} />);
    expect(screen.getByText('重置')).toBeDisabled();

    act(() => {
      useAppStore.getState().setAdjustment('exposure', 1);
    });
    rerender(<RightPanel image={makeImage()} />);
    expect(screen.getByText('重置')).toBeEnabled();
  });

  it('resets all adjustments', () => {
    useAppStore.getState().setFolder(makeBrowseResult(['a.jpg']));
    useAppStore.getState().setAdjustment('exposure', 1.5);

    render(<RightPanel image={makeImage()} />);
    fireEvent.click(screen.getByText('重置'));

    expect(useAppStore.getState().adjustments.exposure).toBe(0);
  });

  it('disables the sliders when no image is loaded', () => {
    render(<RightPanel image={null} loading />);
    expect(screen.getByLabelText('曝光')).toBeDisabled();
  });
});
