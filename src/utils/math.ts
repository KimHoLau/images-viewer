/** 通用数值工具，供调整运算与 LUT 相关模块共用 */

/**
 * 三分量颜色值。
 *
 * 定义在这里而不是 renderer/：它是色彩空间数学与渲染共同的最小语言单位，
 * 放在最底层才不会让 color/ 反过来依赖 renderer/。renderer/adjustments-math.ts
 * 仍然把它转出去，老的引用点不用改。
 */
export type Rgb = readonly [number, number, number];

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
