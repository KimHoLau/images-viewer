export interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** 图片在 canvas 像素坐标系里的绘制区域 */
export interface ViewTransform extends Size, Point {}

/**
 * 计算"适应窗口"的绘制区域：保持宽高比把图片放进视口（contain），居中后叠加平移。
 * zoom > 1 放大，zoom < 1 缩小。
 */
export function computeFitTransform(
  image: Size,
  viewport: Size,
  zoom = 1,
  pan: Point = { x: 0, y: 0 },
): ViewTransform {
  if (!Number.isFinite(image.width) || !Number.isFinite(image.height) || image.width <= 0 || image.height <= 0) {
    throw new Error(`Invalid image size: ${image.width}x${image.height}`);
  }
  if (!Number.isFinite(viewport.width) || !Number.isFinite(viewport.height) || viewport.width <= 0 || viewport.height <= 0) {
    throw new Error(`Invalid viewport size: ${viewport.width}x${viewport.height}`);
  }
  if (!Number.isFinite(zoom) || zoom <= 0) {
    throw new Error(`Invalid zoom: ${zoom}`);
  }

  const fitScale = Math.min(viewport.width / image.width, viewport.height / image.height);
  const scale = fitScale * zoom;
  const width = image.width * scale;
  const height = image.height * scale;

  return {
    x: (viewport.width - width) / 2 + pan.x,
    y: (viewport.height - height) / 2 + pan.y,
    width,
    height,
  };
}

/** 像素坐标（左上原点、y 向下）转 WebGL 裁剪坐标（中心原点、y 向上） */
export function toClipPoint(point: Point, viewport: Size): Point {
  return {
    x: (point.x / viewport.width) * 2 - 1,
    y: 1 - (point.y / viewport.height) * 2,
  };
}

/**
 * 把绘制区域转成 6 个顶点（两个三角形）的交错缓冲：[x, y, u, v] × 6。
 * 顶点顺序为左上、右上、左下、右上、右下、左下。
 */
export function toClipQuad(rect: ViewTransform, viewport: Size): Float32Array {
  const left = toClipPoint({ x: rect.x, y: rect.y }, viewport);
  const right = toClipPoint({ x: rect.x + rect.width, y: rect.y }, viewport);
  const bottomLeft = toClipPoint({ x: rect.x, y: rect.y + rect.height }, viewport);
  const bottomRight = toClipPoint(
    { x: rect.x + rect.width, y: rect.y + rect.height },
    viewport,
  );

  return new Float32Array([
    // 左上
    left.x,
    left.y,
    0,
    0,
    // 右上
    right.x,
    right.y,
    1,
    0,
    // 左下
    bottomLeft.x,
    bottomLeft.y,
    0,
    1,
    // 右上
    right.x,
    right.y,
    1,
    0,
    // 右下
    bottomRight.x,
    bottomRight.y,
    1,
    1,
    // 左下
    bottomLeft.x,
    bottomLeft.y,
    0,
    1,
  ]);
}

/** 缩放范围限制 */
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 16;

export function clampZoom(zoom: number): number {
  if (!Number.isFinite(zoom)) return 1;
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
}
