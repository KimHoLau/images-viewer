/**
 * 把快门速度（秒）格式化成摄影习惯的写法：
 * 1/200 这类短曝光用分数，1 秒以上用小数。
 */
export function formatShutter(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return '';

  if (seconds >= 1) {
    // 去掉多余的 0，例如 2.0s → 2s
    return `${Number(seconds.toFixed(1))}s`;
  }

  const denominator = Math.round(1 / seconds);
  return `1/${denominator}`;
}

/** 光圈值格式化，例如 2.8 → f/2.8 */
export function formatAperture(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return `f/${Number(value.toFixed(1))}`;
}

/** 焦距格式化，例如 35 → 35mm */
export function formatFocalLength(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.round(value)}mm`;
}

/** ISO 格式化，例如 400 → ISO 400 */
export function formatIso(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '';
  return `ISO ${Math.round(value)}`;
}
