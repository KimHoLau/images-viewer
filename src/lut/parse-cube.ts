import type { Lut3D } from './types';

export interface ParsedLut extends Lut3D {
  /** LUT 声明的输入范围；本项目的采样把 [0,1] 线性映射到该范围，因此与 [0,1] 等价 */
  inputRange: readonly [number, number];
  /** 文件声明了视频范围（64–940）。已解析但未做范围转换，见 README 的已知限制 */
  inVideoRange: boolean;
  outVideoRange: boolean;
}

/** 去掉 `#` 之后的注释并 trim */
function stripComment(line: string): string {
  const hashIndex = line.indexOf('#');
  return (hashIndex >= 0 ? line.slice(0, hashIndex) : line).trim();
}

/**
 * 解析 .cube 文件（Blackmagic / Resolve 规范）。
 *
 * 支持 3D LUT 与 shaper 前置的写法；1D LUT 暂不支持（着色器只处理 3D 纹理），
 * 遇到 LUT_1D_SIZE 会抛出明确错误而不是悄悄解析错。
 */
export function parseCubeLut(content: string): ParsedLut {
  const lines = content.split(/\r?\n/);

  let title: string | undefined;
  let size = 0;
  let is1D = false;
  let inputRange: [number, number] = [0, 1];
  let inVideoRange = false;
  let outVideoRange = false;

  const values: number[] = [];

  for (const rawLine of lines) {
    const line = stripComment(rawLine);
    if (line.length === 0) continue;

    if (line.startsWith('TITLE')) {
      const match = line.match(/TITLE\s+"([^"]*)"/);
      if (match) title = match[1];
      continue;
    }

    if (line === 'LUT_IN_VIDEO_RANGE') {
      inVideoRange = true;
      continue;
    }
    if (line === 'LUT_OUT_VIDEO_RANGE') {
      outVideoRange = true;
      continue;
    }

    const size3D = line.match(/^LUT_3D_SIZE\s+(\d+)/);
    if (size3D) {
      size = Number.parseInt(size3D[1], 10);
      continue;
    }

    const size1D = line.match(/^LUT_1D_SIZE\s+(\d+)/);
    if (size1D) {
      is1D = true;
      continue;
    }

    const range = line.match(/^LUT_(?:1D|3D)_INPUT_RANGE\s+(\S+)\s+(\S+)/);
    if (range) {
      const min = Number(range[1]);
      const max = Number(range[2]);
      if (Number.isFinite(min) && Number.isFinite(max)) {
        inputRange = [min, max];
      }
      continue;
    }

    // 其余按数据行处理：一行三个浮点数
    const parts = line.split(/\s+/);
    if (parts.length < 3) {
      throw new Error(`.cube 文件格式错误，无法解析这一行: "${line}"`);
    }
    for (let i = 0; i < 3; i++) {
      // 用 Number 而不是 parseFloat：parseFloat("1abc") 会静默变成 1
      const value = Number(parts[i]);
      if (!Number.isFinite(value)) {
        throw new Error(`.cube 文件包含非法数值: "${parts[i]}"`);
      }
      values.push(value);
    }
  }

  if (is1D) {
    throw new Error('暂不支持 1D LUT；请使用 3D LUT（LUT_3D_SIZE）');
  }
  if (size <= 0) {
    throw new Error('.cube 文件缺少 LUT_3D_SIZE 声明');
  }

  const expected = size * size * size * 3;
  if (values.length !== expected) {
    throw new Error(`.cube 文件数据量不符：期望 ${expected / 3} 组，实际 ${values.length / 3} 组`);
  }

  return {
    size,
    data: Float32Array.from(values),
    title,
    inputRange,
    inVideoRange,
    outVideoRange,
  };
}
