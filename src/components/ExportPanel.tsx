import { useCallback, useState } from 'react';
import { getActiveRenderer } from '../renderer/renderer-registry';
import {
  DEFAULT_EXPORT_QUALITY,
  EXPORT_FORMATS,
  EXPORT_LONG_EDGE_OPTIONS,
  computeExportSize,
  downloadBlob,
  formatBytes,
  getFormatInfo,
  renderExport,
  type ExportFormat,
} from '../services/export';
import { selectCurrentImage, useAppStore } from '../store/useAppStore';
import { Slider } from './Slider';

/** 分辨率档位的显示文案 */
function longEdgeLabel(longEdge: number | null): string {
  return longEdge === null ? '原始尺寸' : `长边 ${longEdge}`;
}

export function ExportPanel() {
  const entry = useAppStore(selectCurrentImage);

  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [quality, setQuality] = useState(DEFAULT_EXPORT_QUALITY);
  const [maxLongEdge, setMaxLongEdge] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const formatInfo = getFormatInfo(format);

  /**
   * 预估导出尺寸。
   *
   * 这里每次渲染现读渲染器，不用 useMemo：渲染器是模块级的非响应式状态，
   * React 看不到它的变化，把它写进依赖数组只会掩盖问题。切换图片时本组件
   * 会因为订阅了当前图片而重渲染，届时自然读到新的尺寸。
   */
  const estimatedSize = (() => {
    const renderer = getActiveRenderer();
    if (!renderer || !renderer.hasImage()) return null;
    try {
      return computeExportSize(renderer.getImageSize(), maxLongEdge);
    } catch {
      return null;
    }
  })();

  const handleExport = useCallback(async () => {
    const renderer = getActiveRenderer();
    if (!renderer || !entry) {
      setMessage('没有可导出的图片');
      return;
    }

    setBusy(true);
    setMessage(null);
    try {
      const result = await renderExport(renderer, entry.name, { format, quality, maxLongEdge });
      downloadBlob(result.blob, result.fileName);
      setMessage(
        `已导出 ${result.fileName}（${result.width}×${result.height}，${formatBytes(result.blob.size)}）`,
      );
    } catch (error) {
      setMessage(`导出失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [entry, format, quality, maxLongEdge]);

  const disabled = !entry || busy;

  return (
    <div className="export-panel">
      <label className="field">
        <span className="field__label">格式</span>
        <select
          className="field__control"
          value={format}
          disabled={disabled}
          onChange={(event) => setFormat(event.target.value as ExportFormat)}
        >
          {EXPORT_FORMATS.map((item) => (
            <option key={item.id} value={item.id}>
              {item.label} — {item.description}
            </option>
          ))}
        </select>
      </label>

      <label className="field">
        <span className="field__label">分辨率</span>
        <select
          className="field__control"
          value={maxLongEdge === null ? 'original' : String(maxLongEdge)}
          disabled={disabled}
          onChange={(event) =>
            setMaxLongEdge(event.target.value === 'original' ? null : Number(event.target.value))
          }
        >
          {EXPORT_LONG_EDGE_OPTIONS.map((option) => (
            <option key={String(option)} value={option === null ? 'original' : String(option)}>
              {longEdgeLabel(option)}
            </option>
          ))}
        </select>
      </label>

      {formatInfo.lossy ? (
        <Slider
          label="质量"
          value={quality}
          min={0.1}
          max={1}
          step={0.01}
          defaultValue={DEFAULT_EXPORT_QUALITY}
          disabled={disabled}
          onChange={setQuality}
        />
      ) : null}

      <div className="export-panel__summary">
        {estimatedSize
          ? `输出 ${estimatedSize.width} × ${estimatedSize.height}`
          : '打开图片后可导出'}
      </div>

      <button
        type="button"
        className="button button--primary export-panel__action"
        onClick={handleExport}
        disabled={disabled}
      >
        {busy ? '导出中…' : '导出图片'}
      </button>

      {message ? <p className="export-panel__message">{message}</p> : null}
    </div>
  );
}
