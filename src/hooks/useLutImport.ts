import { useCallback } from 'react';
import { parse3dlLut } from '../lut/parse-3dl';
import { parseCubeLut } from '../lut/parse-cube';
import { useAppStore } from '../store/useAppStore';

/** 按扩展名挑解析器并载入 LUT */
export function useLutImport() {
  const setCustomLut = useAppStore((state) => state.setCustomLut);
  const setError = useAppStore((state) => state.setError);

  const importLutFile = useCallback(
    async (file: File): Promise<boolean> => {
      try {
        const content = await file.text();
        const parsed = /\.3dl$/i.test(file.name) ? parse3dlLut(content) : parseCubeLut(content);

        setCustomLut({
          name: parsed.title?.trim() || file.name,
          lut: { size: parsed.size, data: parsed.data, title: parsed.title },
        });
        return true;
      } catch (error) {
        setError(`无法载入 LUT「${file.name}」：${(error as Error).message}`);
        return false;
      }
    },
    [setCustomLut, setError],
  );

  return { importLutFile };
}
