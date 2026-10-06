import { useCallback, useRef, useState } from 'react';
import { useLutImport } from '../hooks/useLutImport';
import { LUT_PRESETS } from '../lut/presets';
import { selectCustomLut, useAppStore } from '../store/useAppStore';

/** LUT 预设选择区：内置预设 + 从 .cube / .3dl 文件载入（可一次选多个） */
export function LutPanel() {
  const lutPresetId = useAppStore((state) => state.lutPresetId);
  const lutLibrary = useAppStore((state) => state.lutLibrary);
  const selectedCustom = useAppStore(selectCustomLut);
  const setLutPreset = useAppStore((state) => state.setLutPreset);
  const setActiveCustomLut = useAppStore((state) => state.setActiveCustomLut);
  const removeCustomLut = useAppStore((state) => state.removeCustomLut);
  const { importLutFiles } = useLutImport();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const [importErrors, setImportErrors] = useState<string[]>([]);
  const isNeutral = lutPresetId === null && selectedCustom === null;

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
      <div className="lut-list">
        <button
          type="button"
          className={`lut-item${isNeutral ? ' lut-item--active' : ''}`}
          onClick={() => setLutPreset(null)}
        >
          <span className="lut-item__name">原图</span>
          <span className="lut-item__desc">不套用 LUT</span>
        </button>

        {LUT_PRESETS.map((preset) => (
          <button
            key={preset.id}
            type="button"
            className={`lut-item${lutPresetId === preset.id ? ' lut-item--active' : ''}`}
            onClick={() => setLutPreset(preset.id)}
          >
            <span className="lut-item__name">{preset.name}</span>
            <span className="lut-item__desc">{preset.description}</span>
          </button>
        ))}
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
        选中项为空时下拉框停在「不使用」，与上面「原图」按钮表达同一件事。
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
