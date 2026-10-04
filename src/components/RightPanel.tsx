import {
  ADJUSTMENT_DEFINITIONS,
  ADJUSTMENT_GROUP_LABELS,
  isDefaultAdjustments,
  type AdjustmentDefinition,
} from '../types/adjustments';
import type { LoadedImage } from '../services/image-loader';
import {
  formatAperture,
  formatFocalLength,
  formatIso,
  formatShutter,
} from '../services/raw-format';
import { selectCurrentImage, useAppStore } from '../store/useAppStore';
import { ExportPanel } from './ExportPanel';
import { LutPanel } from './LutPanel';
import { PanelSection } from './PanelSection';
import { Slider } from './Slider';

export interface RightPanelProps {
  image: LoadedImage | null;
  loading?: boolean;
}

/** 把定义按分组聚合，保持定义里的顺序 */
function groupDefinitions(): Array<[AdjustmentDefinition['group'], AdjustmentDefinition[]]> {
  const groups = new Map<AdjustmentDefinition['group'], AdjustmentDefinition[]>();
  for (const definition of ADJUSTMENT_DEFINITIONS) {
    const list = groups.get(definition.group) ?? [];
    list.push(definition);
    groups.set(definition.group, list);
  }
  return Array.from(groups.entries());
}

function InfoRow({ label, value }: { label: string; value: string }) {
  if (!value) return null;
  return (
    <div className="info-row">
      <span className="info-row__label">{label}</span>
      <span className="info-row__value">{value}</span>
    </div>
  );
}

export function RightPanel({ image, loading = false }: RightPanelProps) {
  const entry = useAppStore(selectCurrentImage);
  const adjustments = useAppStore((state) => state.adjustments);
  const setAdjustment = useAppStore((state) => state.setAdjustment);
  const resetAdjustments = useAppStore((state) => state.resetAdjustments);
  const lutPresetId = useAppStore((state) => state.lutPresetId);
  const customLut = useAppStore((state) => state.customLut);
  const setLutPreset = useAppStore((state) => state.setLutPreset);

  const hasImage = entry !== null;
  const modified = !isDefaultAdjustments(adjustments);
  const metadata = image?.metadata ?? null;

  return (
    <div className="right-panel">
      <PanelSection title="信息">
        {hasImage ? (
          <>
            <InfoRow label="文件名" value={entry.name} />
            <InfoRow
              label="尺寸"
              value={image ? `${image.width} × ${image.height}` : loading ? '解码中…' : '—'}
            />
            <InfoRow label="格式" value={entry.isRaw ? 'RAW' : entry.extension.toUpperCase()} />
            {metadata ? (
              <>
                <InfoRow label="相机" value={`${metadata.make} ${metadata.model}`.trim()} />
                <InfoRow label="ISO" value={formatIso(metadata.iso)} />
                <InfoRow label="快门" value={formatShutter(metadata.shutter)} />
                <InfoRow label="光圈" value={formatAperture(metadata.aperture)} />
                <InfoRow label="焦距" value={formatFocalLength(metadata.focalLength)} />
              </>
            ) : null}
          </>
        ) : (
          <p className="panel-hint">未选择图片</p>
        )}
      </PanelSection>

      <PanelSection
        title="LUT 预设"
        action={
          <button
            type="button"
            className="button button--tiny"
            onClick={() => setLutPreset(null)}
            disabled={!lutPresetId && !customLut}
          >
            移除
          </button>
        }
      >
        <LutPanel />
      </PanelSection>

      <PanelSection
        title="基础调整"
        action={
          <button
            type="button"
            className="button button--tiny"
            onClick={resetAdjustments}
            disabled={!modified}
          >
            重置
          </button>
        }
      >
        {groupDefinitions().map(([group, definitions]) => (
          <div className="adjust-group" key={group}>
            <h3 className="adjust-group__title">{ADJUSTMENT_GROUP_LABELS[group]}</h3>
            {definitions.map((definition) => (
              <Slider
                key={definition.key}
                label={definition.label}
                value={adjustments[definition.key]}
                min={definition.min}
                max={definition.max}
                step={definition.step}
                defaultValue={definition.defaultValue}
                unit={definition.unit}
                disabled={!hasImage}
                onChange={(value) => setAdjustment(definition.key, value)}
              />
            ))}
          </div>
        ))}
      </PanelSection>

      <PanelSection title="导出">
        <ExportPanel />
      </PanelSection>
    </div>
  );
}
