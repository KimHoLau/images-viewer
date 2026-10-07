import { useCallback, useMemo, useRef, useState } from 'react';
import { findLogSpace } from '../color/log-spaces';
import { useLutImport } from '../hooks/useLutImport';
import { officialLutEntries } from '../lut/official-luts';
import { selectCustomLut, useAppStore } from '../store/useAppStore';

/**
 * LUT 面板：官方预设（随色彩空间自动列出）+ 从 .cube / .3dl 文件载入（可一次选多个）。
 *
 * 官方 LUT 不是写死在代码里的采样函数，而是按色彩空间从工作区的 `3DLUT/` 目录取：
 * 换一个色彩空间就换一份清单；只有在下拉里选中某一条，才去取并解析那个文件——
 * 65³ 的 `.cube` 解压后单个就有 274625 行，一次把 13 个全拉下来是 90 MB。
 *
 * 官方 LUT 与导入的 LUT 各占一个下拉：生命周期不一样（前者换色彩空间就作废，
 * 后者换文件夹都留着），放进同一个控件会让"选中的为什么被清掉"变得难解释。
 */
export function LutPanel() {
  const logSpaceId = useAppStore((state) => state.logSpaceId);
  const officialLutKey = useAppStore((state) => state.officialLutKey);
  const officialLutLoading = useAppStore((state) => state.officialLutLoading);
  const officialLutError = useAppStore((state) => state.officialLutError);
  const setOfficialLut = useAppStore((state) => state.setOfficialLut);
  const lutLibrary = useAppStore((state) => state.lutLibrary);
  const selectedCustom = useAppStore(selectCustomLut);
  const setActiveCustomLut = useAppStore((state) => state.setActiveCustomLut);
  const removeCustomLut = useAppStore((state) => state.removeCustomLut);
  const { importLutFiles } = useLutImport();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);

  // 清单只取决于色彩空间。useMemo 不是为了省算力，而是让引用在重渲染之间稳定。
  const entries = useMemo(() => officialLutEntries(logSpaceId), [logSpaceId]);
  const spaceName = logSpaceId ? (findLogSpace(logSpaceId)?.name ?? null) : null;

  const officialHint = !logSpaceId
    ? '先在上面选一个色彩空间，这里会出现它对应的官方 LUT'
    : officialLutLoading
      ? '正在载入…'
      : officialLutError
        ? `无法载入 —— ${officialLutError}`
        : entries.length === 0
          ? '该色彩空间暂无内置 LUT'
          : `已加载 ${entries.length} 个 LUT${spaceName ? `（${spaceName}）` : ''}`;

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const files = Array.from(event.target.files ?? []);
      // 允许再次选择同一批文件
      event.target.value = '';
      if (files.length === 0) return;

      const { failures } = await importLutFiles(files);
      setImportErrors(failures.map((failure) => `${failure.fileName}：${failure.message}`));
    },
    [importLutFiles],
  );

  return (
    <div className="lut-panel">
      <div className="lut-presets">
        <label className="field">
          <span className="field__label">官方 LUT</span>
          <select
            className="field__control"
            aria-label="官方 LUT"
            value={officialLutKey ?? ''}
            disabled={!logSpaceId || entries.length === 0}
            onChange={(event) =>
              setOfficialLut(event.target.value === '' ? null : event.target.value)
            }
          >
            <option value="">不使用</option>
            {entries.map((entry) => (
              <option key={entry.key} value={entry.key}>
                {entry.name}
              </option>
            ))}
          </select>
        </label>
        <p className={`panel-hint${officialLutError ? ' lut-presets__error' : ''}`}>{officialHint}</p>
      </div>

      <div className="lut-import">
        <button
          type="button"
          className="button button--tiny"
          onClick={() => fileInputRef.current?.click()}
        >
          载入 LUT 文件
        </button>
        <input
          ref={fileInputRef}
          className="visually-hidden"
          type="file"
          accept=".cube,.3dl"
          multiple
          onChange={handleFileInput}
          tabIndex={-1}
        />
        <span className="lut-import__hint">可一次选多个，载入后在下面切换</span>
      </div>

      {/*
        已载入的 LUT 用下拉框切换：库里可能有一堆，平铺会把面板撑得很长。
        选中项为空时下拉框停在「不使用」，与上面官方下拉的「不使用」表达同一件事。
      */}
      {lutLibrary.length > 0 ? (
        <div className="lut-library">
          <label className="field">
            <span className="field__label">已载入的 LUT（{lutLibrary.length}）</span>
            <select
              className="field__control"
              aria-label="已载入的 LUT"
              value={selectedCustom?.key ?? ''}
              onChange={(event) =>
                setActiveCustomLut(event.target.value === '' ? null : event.target.value)
              }
            >
              <option value="">不使用</option>
              {lutLibrary.map((entry) => (
                <option key={entry.key} value={entry.key}>
                  {entry.name}
                </option>
              ))}
            </select>
          </label>

          {selectedCustom ? (
            <div className="lut-library__actions">
              <span className="lut-library__name">{selectedCustom.name}</span>
              <button
                type="button"
                className="button button--tiny"
                onClick={() => removeCustomLut(selectedCustom.key)}
              >
                移除
              </button>
            </div>
          ) : null}
        </div>
      ) : null}

      {importErrors.length > 0 ? (
        <ul className="lut-import__errors">
          {importErrors.map((message) => (
            <li key={message}>无法载入 LUT —— {message}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
