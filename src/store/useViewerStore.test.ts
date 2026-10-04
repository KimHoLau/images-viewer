import { beforeEach, describe, expect, it } from 'vitest';
import {
  nextZoomStep,
  previousZoomStep,
  useViewerStore,
  ZOOM_STEPS,
} from './useViewerStore';

const initialState = useViewerStore.getState();

describe('nextZoomStep', () => {
  it('returns the next larger step', () => {
    expect(nextZoomStep(1)).toBe(1.5);
    expect(nextZoomStep(0.3)).toBe(0.5);
  });

  it('stays at the maximum', () => {
    expect(nextZoomStep(ZOOM_STEPS[ZOOM_STEPS.length - 1])).toBe(
      ZOOM_STEPS[ZOOM_STEPS.length - 1],
    );
  });

  it('uses the exact step when already on one', () => {
    expect(nextZoomStep(2)).toBe(3);
  });
});

describe('previousZoomStep', () => {
  it('returns the next smaller step', () => {
    expect(previousZoomStep(1)).toBe(0.75);
    expect(previousZoomStep(0.3)).toBe(0.25);
  });

  it('stays at the minimum', () => {
    expect(previousZoomStep(ZOOM_STEPS[0])).toBe(ZOOM_STEPS[0]);
  });
});

describe('useViewerStore', () => {
  beforeEach(() => {
    useViewerStore.setState(initialState, true);
  });

  it('starts fitted', () => {
    const state = useViewerStore.getState();
    expect(state.zoom).toBe(1);
    expect(state.pan).toEqual({ x: 0, y: 0 });
  });

  it('zooms in and out through the steps', () => {
    useViewerStore.getState().zoomIn();
    expect(useViewerStore.getState().zoom).toBe(1.5);

    useViewerStore.getState().zoomOut();
    expect(useViewerStore.getState().zoom).toBe(1);
  });

  it('clamps arbitrary zoom values', () => {
    useViewerStore.getState().setZoom(9999);
    expect(useViewerStore.getState().zoom).toBe(16);
  });

  it('resets zoom and pan together', () => {
    useViewerStore.getState().setZoom(4);
    useViewerStore.getState().setPan({ x: 50, y: 60 });

    useViewerStore.getState().resetView();

    expect(useViewerStore.getState().zoom).toBe(1);
    expect(useViewerStore.getState().pan).toEqual({ x: 0, y: 0 });
  });

  it('accumulates pan deltas', () => {
    useViewerStore.getState().panBy({ x: 10, y: 5 });
    useViewerStore.getState().panBy({ x: -4, y: 5 });
    expect(useViewerStore.getState().pan).toEqual({ x: 6, y: 10 });
  });

  it('tracks panning state', () => {
    useViewerStore.getState().setPanning(true);
    expect(useViewerStore.getState().isPanning).toBe(true);
    useViewerStore.getState().setPanning(false);
    expect(useViewerStore.getState().isPanning).toBe(false);
  });
});
