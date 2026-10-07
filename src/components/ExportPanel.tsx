import { useCallback, useState } from 'react';
import { getActiveRenderer } from '../renderer/renderer-registry';
import { collectRawExifSource, toExifFallback, type ExifAttachStatus } from '../services/exif';
import type { RawMetadata } from '../services/raw-decoder.worker';
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

/**
 * 导出结果里关于 EXIF 的那一句。
 *
 * `kept` 为 false 是用户自己把「保留拍摄信息」关掉了——那要说「按你的设置没写」，
 * 不能拿「源文件里没有」去糊弄。
 * `unavailable` 则确实是没有可保留的信息，不是静默丢掉。
 * 非 RAW 源压根不参与这件事，调用方不会问到这里来。
 */
function exifNote(status: ExifAttachStatus, kept: boolean): string {
  if (!kept) return ' · 未写入拍摄信息（已关闭保留）';

  switch (status) {
    case 'attached':
      return ' · 已带上原拍摄 EXIF';
    case 'unsupported':
      return ' · 该格式不写入 EXIF';
    case 'failed':
      return ' · EXIF 写入失败，图片本身正常';
    case 'unavailable':
      return ' · 源文件里没有可保留的拍摄信息';
    default: {
      // 多出一种状态时必须在这里补上一句话，否则下面这行编译不过
      const unhandled: never = status;
      return unhandled;
    }
  }
}

export interface ExportPanelProps {
  /** 当前图片的 RAW 拍摄信息，作为导出 EXIF 的兜底来源 */
  metadata?: RawMetadata | null;
}

export function ExportPanel({ metadata = null }: ExportPanelProps) {
  const entry = useAppStore(selectCurrentImage);

  const [format, setFormat] = useState<ExportFormat>('jpeg');
  const [quality, setQuality] = useState(DEFAULT_EXPORT_QUALITY);
  const [maxLongEdge, setMaxLongEdge] = useState<number | null>(null);
  /**
   * 要不要把原拍摄信息写进导出文件。
   *
   * 默认开——需求就是「导出的文件带上拍摄信息」。留这个开关是为了让用户能主动导出
   * 一份干净的图（发到网上不必带上机身序列号这类东西），而不是替他决定。
   */
  const [keepExif, setKeepExif] = useState(true);
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
      // 只有 RAW 源才谈得上「保留原拍摄 EXIF」：常规格式的源不在需求范围内
      const exif =
        entry.isRaw && keepExif
          ? await collectRawExifSource(entry.file, toExifFallback(metadata))
          : null;
      const result = await renderExport(renderer, entry.name, {
        format,
        quality,
        maxLongEdge,
        exif,
      });
      downloadBlob(result.blob, result.fileName);
      setMessage(
        `已导出 ${result.fileName}（${result.width}×${result.height}，${formatBytes(result.blob.size)}）` +
          (entry.isRaw ? exifNote(result.exifStatus, keepExif) : ''),
      );
    } catch (error) {
      setMessage(`导出失败：${(error as Error).message}`);
    } finally {
      setBusy(false);
    }
  }, [entry, format, quality, maxLongEdge, metadata, keepExif]);

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

      {entry?.isRaw ? (
        <label className="field field--check">
          <input
            type="checkbox"
            checked={keepExif}
            disabled={disabled}
            onChange={(event) => setKeepExif(event.target.checked)}
          />
          <span>保留拍摄信息（EXIF）</span>
        </label>
      ) : null}

      {entry?.isRaw && keepExif && !formatInfo.carriesExif ? (
        <p className="panel-hint">
          {formatInfo.label} 不写入 EXIF，需要保留拍摄信息请选 JPEG 或 PNG
        </p>
      ) : null}

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
