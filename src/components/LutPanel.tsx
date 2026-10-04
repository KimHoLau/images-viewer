import { useCallback, useRef } from 'react';
import { useLutImport } from '../hooks/useLutImport';
import { LUT_PRESETS } from '../lut/presets';
import { useAppStore } from '../store/useAppStore';

/** LUT 预设选择区：内置预设 + 从 .cube / .3dl 文件载入 */
export function LutPanel() {
  const lutPresetId = useAppStore((state) => state.lutPresetId);
  const customLut = useAppStore((state) => state.customLut);
  const setLutPreset = useAppStore((state) => state.setLutPreset);
  const { importLutFile } = useLutImport();

  const fileInputRef = useRef<HTMLInputElement>(null);
  const isNeutral = lutPresetId === null && customLut === null;

  const handleFileInput = useCallback(
    async (event: React.ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0];
      if (file) await importLutFile(file);
      // 允许再次选择同一个文件
      event.target.value = '';
    },
    [importLutFile],
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
          onChange={handleFileInput}
          tabIndex={-1}
        />
        {customLut ? <span className="lut-import__name">{customLut.name}</span> : null}
      </div>
    </div>
  );
}
