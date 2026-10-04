/** 基础调整参数。数值范围见 ADJUSTMENT_DEFINITIONS。 */
export interface ImageAdjustments {
  /** 色温，-1（冷）~ 1（暖），0 为中性 */
  temperature: number;
  /** 色调，-1（绿）~ 1（品红），0 为中性 */
  tint: number;
  /** 曝光，单位 EV，-3 ~ 3，每 +1 亮度翻倍 */
  exposure: number;
  /** 对比度，-1 ~ 1 */
  contrast: number;
  /** 高光，-1 ~ 1 */
  highlights: number;
  /** 阴影，-1 ~ 1 */
  shadows: number;
  /** 饱和度，-1 ~ 1，-1 为黑白 */
  saturation: number;
  /** LUT 强度，0 ~ 1 */
  lutStrength: number;
}

export interface AdjustmentDefinition {
  key: keyof ImageAdjustments;
  label: string;
  min: number;
  max: number;
  step: number;
  /** 双击滑块回到的默认值 */
  defaultValue: number;
  /** 展示用单位后缀 */
  unit?: string;
  /** 分段：右侧面板按分段归类 */
  group: 'whiteBalance' | 'tone' | 'presence';
}

/** 右侧面板的数据源；顺序即显示顺序 */
export const ADJUSTMENT_DEFINITIONS: readonly AdjustmentDefinition[] = [
  {
    key: 'temperature',
    label: '色温',
    min: -1,
    max: 1,
    step: 0.01,
    defaultValue: 0,
    group: 'whiteBalance',
  },
  { key: 'tint', label: '色调', min: -1, max: 1, step: 0.01, defaultValue: 0, group: 'whiteBalance' },
  { key: 'exposure', label: '曝光', min: -3, max: 3, step: 0.01, defaultValue: 0, unit: 'EV', group: 'tone' },
  { key: 'contrast', label: '对比度', min: -1, max: 1, step: 0.01, defaultValue: 0, group: 'tone' },
  { key: 'highlights', label: '高光', min: -1, max: 1, step: 0.01, defaultValue: 0, group: 'tone' },
  { key: 'shadows', label: '阴影', min: -1, max: 1, step: 0.01, defaultValue: 0, group: 'tone' },
  { key: 'saturation', label: '饱和度', min: -1, max: 1, step: 0.01, defaultValue: 0, group: 'presence' },
  { key: 'lutStrength', label: 'LUT 强度', min: 0, max: 1, step: 0.01, defaultValue: 1, group: 'presence' },
] as const;

/** 分组标题，用于右侧面板 */
export const ADJUSTMENT_GROUP_LABELS: Record<AdjustmentDefinition['group'], string> = {
  whiteBalance: '白平衡',
  tone: '色调',
  presence: '质感',
};

export const DEFAULT_ADJUSTMENTS: ImageAdjustments = {
  temperature: 0,
  tint: 0,
  exposure: 0,
  contrast: 0,
  highlights: 0,
  shadows: 0,
  saturation: 0,
  lutStrength: 1,
};

/** 参数是否全为默认值（用于判断"已调整"状态） */
export function isDefaultAdjustments(adjustments: ImageAdjustments): boolean {
  return ADJUSTMENT_DEFINITIONS.every((def) => adjustments[def.key] === def.defaultValue);
}

/** 把数值夹到参数允许的范围内 */
export function clampAdjustment(key: keyof ImageAdjustments, value: number): number {
  const def = ADJUSTMENT_DEFINITIONS.find((item) => item.key === key);
  if (!def) return value;
  if (!Number.isFinite(value)) return def.defaultValue;
  return Math.min(def.max, Math.max(def.min, value));
}
