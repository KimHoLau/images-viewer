/** 通用数值工具，供调整运算与 LUT 相关模块共用 */

export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

/** GLSL 的 smoothstep：把 x 映射到 [edge0, edge1] 上并做 S 形平滑 */
export function smoothstep(edge0: number, edge1: number, x: number): number {
  if (edge0 === edge1) return x < edge0 ? 0 : 1;
  const t = clamp01((x - edge0) / (edge1 - edge0));
  return t * t * (3 - 2 * t);
}
