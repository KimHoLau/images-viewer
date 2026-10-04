import type { ParsedLut } from './parse-cube';

/**
 * 解析 Autodesk Lustre 的 .3dl 文件。
 *
 * 结构：`3DMESH` / `Mesh <输入位深> <输出位深>` / `<格点数>` / 数据。
 * 格点数应为 2^输入位深 + 1；数据是整数，按输出位深归一化到 [0, 1]。
 * 数据按空白切分（不依赖每行三个），对紧凑排布的导出文件更宽容。
 */
export function parse3dlLut(content: string): ParsedLut {
  const tokens = content
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0 && !token.startsWith('#'));

  if (tokens.length === 0) {
    throw new Error('.3dl 文件为空');
  }

  if (tokens[0].toUpperCase() !== '3DMESH') {
    throw new Error('.3dl 文件缺少 3DMESH 头');
  }

  // 头部之后可能还有注释行，跳过非 Mesh 的记号直到找到 Mesh
  let cursor = 1;
  while (cursor < tokens.length && tokens[cursor].toLowerCase() !== 'mesh') {
    cursor++;
  }
  if (cursor + 2 >= tokens.length) {
    throw new Error('.3dl 文件缺少 Mesh 定义');
  }

  const inputBitDepth = Number(tokens[cursor + 1]);
  const outputBitDepth = Number(tokens[cursor + 2]);
  if (!Number.isInteger(inputBitDepth) || !Number.isInteger(outputBitDepth)) {
    throw new Error('.3dl 文件的 Mesh 位深不是整数');
  }
  cursor += 3;

  const size = Number(tokens[cursor]);
  if (!Number.isInteger(size) || size < 2) {
    throw new Error('.3dl 文件的格点数非法');
  }
  cursor++;

  const expectedSize = 2 ** inputBitDepth + 1;
  if (size !== expectedSize) {
    throw new Error(
      `.3dl 文件的格点数 ${size} 与 ${inputBitDepth} 位输入不符（应为 ${expectedSize}）`,
    );
  }

  const entryCount = size * size * size;
  const remaining = tokens.length - cursor;
  if (remaining < entryCount * 3) {
    throw new Error(
      `.3dl 文件数据量不足：需要 ${entryCount * 3} 个整数，实际只有 ${remaining} 个`,
    );
  }

  const outputMax = 2 ** outputBitDepth - 1;
  const data = new Float32Array(entryCount * 3);

  for (let i = 0; i < entryCount * 3; i++) {
    // 用 Number 而不是 parseInt：parseInt("0.5") 会静默变成 0，把坏数据当合法读进来
    const raw = tokens[cursor + i];
    const value = Number(raw);
    if (!Number.isInteger(value)) {
      throw new Error(`.3dl 文件包含非整数值: "${raw}"`);
    }
    data[i] = Math.min(1, Math.max(0, value / outputMax));
  }

  return {
    size,
    data,
    title: `${inputBitDepth}bit → ${outputBitDepth}bit`,
    inputRange: [0, 1],
    inVideoRange: false,
    outVideoRange: false,
  };
}
