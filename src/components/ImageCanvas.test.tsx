import { act, fireEvent, render } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LOG_SPACES, logSpaceIndex } from '../color/log-spaces';
import { PRESET_LUT_SIZE } from '../lut/types';
import { DEFAULT_ADJUSTMENTS } from '../types/adjustments';
import { useAppStore } from '../store/useAppStore';
import { useViewerStore } from '../store/useViewerStore';

/** jsdom 没有 ResizeObserver，这里用一个可手动触发的替身 */
class FakeResizeObserver {
  static instances: FakeResizeObserver[] = [];

  constructor(private readonly callback: ResizeObserverCallback) {
    FakeResizeObserver.instances.push(this);
  }

  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}

  trigger(width: number, height: number): void {
    this.callback(
      [{ contentRect: { width, height } } as ResizeObserverEntry],
      this as unknown as ResizeObserver,
    );
  }
}

/** 记录每次构造出来的假渲染器，用来断言调用 */
const { rendererInstances } = vi.hoisted(() => ({
  rendererInstances: [] as Array<Record<string, ReturnType<typeof vi.fn>>>,
}));

vi.mock('../renderer/ImageRenderer', () => ({
  ImageRenderer: class {
    constructor() {
      // 替身要像真渲染器一样记住纹理是不是线性的：Log 模式能不能开取决于它
      let inputLinear = false;
      const instance = {
        setImage: vi.fn(() => {
          inputLinear = false;
        }),
        setLinearImage: vi.fn(() => {
          inputLinear = true;
        }),
        isInputLinear: vi.fn(() => inputLinear),
        setAdjustments: vi.fn(),
        setLut: vi.fn(),
        setLogMode: vi.fn(),
        setZoom: vi.fn(),
        setPan: vi.fn(),
        setViewport: vi.fn(),
        render: vi.fn(),
        dispose: vi.fn(),
      };
      rendererInstances.push(instance);
      Object.assign(this, instance);
    }
  },
}));

const { ImageCanvas } = await import('./ImageCanvas');

const initialAppState = useAppStore.getState();
const initialViewerState = useViewerStore.getState();

function lastRenderer() {
  return rendererInstances[rendererInstances.length - 1];
}

describe('ImageCanvas', () => {
  beforeEach(() => {
    rendererInstances.length = 0;
    useAppStore.setState(initialAppState, true);
    useViewerStore.setState(initialViewerState, true);
  });

  it('creates a renderer and disposes it on unmount', () => {
    const { unmount } = render(<ImageCanvas image={null} />);

    expect(rendererInstances).toHaveLength(1);
    unmount();
    expect(lastRenderer().dispose).toHaveBeenCalled();
  });

  it('pushes the current adjustments into the renderer on mount', () => {
    act(() => {
      useAppStore.getState().setAdjustment('exposure', 1.25);
    });

    render(<ImageCanvas image={null} />);

    expect(lastRenderer().setAdjustments).toHaveBeenCalledWith(
      expect.objectContaining({ exposure: 1.25 }),
    );
  });

  it('re-applies adjustments when the store changes, without re-rendering React', () => {
    render(<ImageCanvas image={null} />);
    lastRenderer().setAdjustments.mockClear();
    lastRenderer().render.mockClear();

    act(() => {
      useAppStore.getState().setAdjustment('contrast', 0.5);
    });

    expect(lastRenderer().setAdjustments).toHaveBeenCalledWith(
      expect.objectContaining({ contrast: 0.5 }),
    );
    expect(lastRenderer().render).toHaveBeenCalled();
    // 调整参数走命令式订阅，不应该重建渲染器
    expect(rendererInstances).toHaveLength(1);
  });

  it('ignores store changes that do not touch adjustments', () => {
    render(<ImageCanvas image={null} />);
    lastRenderer().setAdjustments.mockClear();

    act(() => {
      useAppStore.getState().setStatus('loading');
    });

    expect(lastRenderer().setAdjustments).not.toHaveBeenCalled();
  });

  it('applies zoom and pan to the renderer', () => {
    render(<ImageCanvas image={null} />);
    lastRenderer().setZoom.mockClear();
    lastRenderer().setPan.mockClear();

    act(() => {
      useViewerStore.getState().setZoom(2);
      useViewerStore.getState().setPan({ x: 10, y: 20 });
    });

    expect(lastRenderer().setZoom).toHaveBeenCalledWith(2);
    expect(lastRenderer().setPan).toHaveBeenCalledWith({ x: 10, y: 20 });
  });

  it('shows a loading overlay while decoding', () => {
    const { container } = render(<ImageCanvas image={null} loading />);
    expect(container.querySelector('.image-area__overlay')).not.toBeNull();
  });

  it('uploads the image texture with its real dimensions', () => {
    const image = {
      bitmap: { close: vi.fn() } as unknown as ImageBitmap,
      linear: null,
      width: 4000,
      height: 3000,
      metadata: null,
    };

    render(<ImageCanvas image={image} />);

    expect(lastRenderer().setImage).toHaveBeenCalledWith(image.bitmap, 4000, 3000);
  });

  it('starts from the default adjustments', () => {
    render(<ImageCanvas image={null} />);
    expect(lastRenderer().setAdjustments).toHaveBeenCalledWith(DEFAULT_ADJUSTMENTS);
  });

  describe('Log 色彩空间模式', () => {
    /** Log 模式的 RAW 输入：ProPhoto linear 浮点，没有位图 */
    function linearImage(width = 4, height = 2) {
      return {
        bitmap: null,
        linear: { data: new Float32Array(width * height * 3), width, height },
        width,
        height,
        metadata: null,
      };
    }

    function bitmapImage() {
      return {
        bitmap: { close: vi.fn() } as unknown as ImageBitmap,
        linear: null,
        width: 100,
        height: 100,
        metadata: null,
      };
    }

    it('没选空间时关闭', () => {
      render(<ImageCanvas image={linearImage()} />);
      expect(lastRenderer().setLogMode).toHaveBeenCalledWith(false, -1, -1);
    });

    it('线性输入加选中空间才开启，下标取自 LOG_SPACES', () => {
      act(() => {
        useAppStore.getState().setLogSpace('s-log3');
      });

      render(<ImageCanvas image={linearImage()} />);

      const index = logSpaceIndex('s-log3');
      expect(index).toBe(LOG_SPACES.findIndex((space) => space.id === 's-log3'));
      expect(lastRenderer().setLogMode).toHaveBeenCalledWith(true, index, index);
    });

    it('位图输入时即使选了空间也不开', () => {
      act(() => {
        useAppStore.getState().setLogSpace('s-log3');
      });

      render(<ImageCanvas image={bitmapImage()} />);

      // 把 8 位 sRGB 位图送进 Log 分支只会得到错误的颜色
      expect(lastRenderer().setLogMode).toHaveBeenLastCalledWith(false, -1, -1);
    });

    it('store 里换空间会立刻通知渲染器', () => {
      render(<ImageCanvas image={linearImage()} />);

      act(() => {
        useAppStore.getState().setLogSpace('v-log');
      });

      const index = logSpaceIndex('v-log');
      expect(lastRenderer().setLogMode).toHaveBeenLastCalledWith(true, index, index);
    });

    it('清掉选择后回到关闭', () => {
      act(() => {
        useAppStore.getState().setLogSpace('v-log');
      });
      render(<ImageCanvas image={linearImage()} />);

      act(() => {
        useAppStore.getState().setLogSpace(null);
      });

      expect(lastRenderer().setLogMode).toHaveBeenLastCalledWith(false, -1, -1);
    });

    it('换图时按新纹理重新决定', () => {
      const view = render(<ImageCanvas image={linearImage()} />);

      act(() => {
        useAppStore.getState().setLogSpace('d-log');
      });
      const index = logSpaceIndex('d-log');
      expect(lastRenderer().setLogMode).toHaveBeenLastCalledWith(true, index, index);

      // 换成 JPEG：纹理不再是线性的，Log 模式必须跟着关掉
      view.rerender(<ImageCanvas image={bitmapImage()} />);
      expect(lastRenderer().setLogMode).toHaveBeenLastCalledWith(false, -1, -1);
    });
  });

  describe('LUT', () => {
    it('starts without a LUT', () => {
      render(<ImageCanvas image={null} />);
      expect(lastRenderer().setLut).toHaveBeenCalledWith(null);
    });

    it('loads the built-in preset LUT when one is selected', () => {
      act(() => {
        useAppStore.getState().setLutPreset('mono');
      });

      render(<ImageCanvas image={null} />);

      const passed = lastRenderer().setLut.mock.calls[0][0];
      expect(passed).not.toBeNull();
      expect(passed.size).toBe(PRESET_LUT_SIZE);
    });

    it('swaps the LUT when the preset changes', () => {
      render(<ImageCanvas image={null} />);
      lastRenderer().setLut.mockClear();

      act(() => {
        useAppStore.getState().setLutPreset('vivid');
      });

      expect(lastRenderer().setLut).toHaveBeenCalledTimes(1);
      expect(lastRenderer().setLut.mock.calls[0][0].size).toBe(PRESET_LUT_SIZE);
      expect(lastRenderer().render).toHaveBeenCalled();
    });

    it('clears the LUT when the preset is removed', () => {
      act(() => {
        useAppStore.getState().setLutPreset('mono');
      });

      render(<ImageCanvas image={null} />);
      lastRenderer().setLut.mockClear();

      act(() => {
        useAppStore.getState().setLutPreset(null);
      });

      expect(lastRenderer().setLut).toHaveBeenCalledWith(null);
    });

    it('falls back to no LUT when the upload throws', () => {
      render(<ImageCanvas image={null} />);
      lastRenderer().setLut.mockClear();
      lastRenderer().setLut.mockImplementationOnce(() => {
        throw new Error('LUT 尺寸超过设备上限');
      });

      act(() => {
        useAppStore.getState().setLutPreset('high-contrast');
      });

      // 第一次调用抛错后应再调一次 setLut(null) 兜底
      expect(lastRenderer().setLut).toHaveBeenCalledTimes(2);
      expect(lastRenderer().setLut.mock.calls[1][0]).toBeNull();
    });

    it('does not touch the LUT for unrelated store changes', () => {
      render(<ImageCanvas image={null} />);
      lastRenderer().setLut.mockClear();

      act(() => {
        useAppStore.getState().setStatus('loading');
      });

      expect(lastRenderer().setLut).not.toHaveBeenCalled();
    });
  });

  describe('动态分辨率缩放', () => {
    beforeEach(() => {
      FakeResizeObserver.instances.length = 0;
      vi.stubGlobal('ResizeObserver', FakeResizeObserver);
    });

    afterEach(() => {
      vi.unstubAllGlobals();
      vi.useRealTimers();
    });

    /** 渲染一张假图片并把容器尺寸喂给 ResizeObserver */
    function renderSized(width = 400, height = 300) {
      const view = render(
        <ImageCanvas
          image={{
            bitmap: { close: vi.fn() } as unknown as ImageBitmap,
            linear: null,
            width: 4000,
            height: 3000,
            metadata: null,
          }}
        />,
      );
      const canvas = view.container.querySelector('canvas')!;
      const observer = FakeResizeObserver.instances[FakeResizeObserver.instances.length - 1];

      act(() => observer.trigger(width, height));
      return { view, canvas, observer };
    }

    it('renders at full resolution when idle', () => {
      const { canvas } = renderSized(400, 300);
      expect(canvas.width).toBe(400);
      expect(canvas.height).toBe(300);
    });

    it('drops to half resolution while interacting and restores when idle', () => {
      vi.useFakeTimers();
      const { canvas } = renderSized(400, 300);

      act(() => {
        fireEvent.wheel(canvas, { deltaY: -1 });
      });
      expect(canvas.width).toBe(200);

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(canvas.width).toBe(400);
    });

    it('keeps the reduced resolution while interactions keep coming', () => {
      vi.useFakeTimers();
      const { canvas } = renderSized(400, 300);

      act(() => {
        fireEvent.wheel(canvas, { deltaY: -1 });
      });
      act(() => {
        vi.advanceTimersByTime(150);
      });
      act(() => {
        fireEvent.wheel(canvas, { deltaY: -1 });
      });
      act(() => {
        vi.advanceTimersByTime(150);
      });

      // 第二次交互把恢复时间往后推了，此时仍应是半分辨率
      expect(canvas.width).toBe(200);

      act(() => {
        vi.advanceTimersByTime(100);
      });
      expect(canvas.width).toBe(400);
    });

    it('reduces resolution while dragging adjustments', () => {
      vi.useFakeTimers();
      const { canvas } = renderSized(400, 300);

      act(() => {
        useAppStore.getState().setAdjustment('exposure', 0.5);
      });
      expect(canvas.width).toBe(200);

      act(() => {
        vi.advanceTimersByTime(200);
      });
      expect(canvas.width).toBe(400);
    });

    it('converts the pan from CSS pixels to backing-store pixels', () => {
      vi.useFakeTimers();
      const { canvas } = renderSized(400, 300);

      act(() => {
        useViewerStore.getState().setPan({ x: 10, y: 20 });
      });
      // 全分辨率、dpr 为 1 时原样传入
      expect(lastRenderer().setPan).toHaveBeenLastCalledWith({ x: 10, y: 20 });

      act(() => {
        fireEvent.wheel(canvas, { deltaY: -1 });
      });
      act(() => {
        useViewerStore.getState().setPan({ x: 10, y: 20 });
      });
      // 降到半分辨率后平移量要按比例缩小，画面才不会跳
      expect(lastRenderer().setPan).toHaveBeenLastCalledWith({ x: 5, y: 10 });
    });

    it('clears the pending restore timer on unmount', () => {
      vi.useFakeTimers();
      const { canvas, view } = renderSized(400, 300);

      act(() => {
        fireEvent.wheel(canvas, { deltaY: -1 });
      });

      const clearSpy = vi.spyOn(globalThis, 'clearTimeout');
      act(() => {
        view.unmount();
      });

      expect(clearSpy).toHaveBeenCalled();
      clearSpy.mockRestore();
    });
  });
});
