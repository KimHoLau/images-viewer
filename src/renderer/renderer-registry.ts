import type { ImageRenderer } from './ImageRenderer';

/**
 * 当前活动的渲染器。
 *
 * 导出面板与中央画布是并列的组件，导出又必须复用画布上那个已经配好
 * 图片纹理、调整参数与 LUT 的渲染器，所以在这里做个极薄的登记处，
 * 而不是把渲染器塞进 React 状态（那会引发整棵树重渲染）。
 */
let activeRenderer: ImageRenderer | null = null;

export function setActiveRenderer(renderer: ImageRenderer | null): void {
  activeRenderer = renderer;
}

export function getActiveRenderer(): ImageRenderer | null {
  return activeRenderer;
}
