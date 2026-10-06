/**
 * 把位图像素扩成 ImageData 需要的 RGBA 字节。
 * LibRaw 的嵌入缩略图与解码结果都可能是 RGB / RGBA / 灰度，统一在这里归一化。
 */
export function bitmapToRgba(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  colors: number,
): Uint8ClampedArray {
  const pixels = width * height;
  const rgba = new Uint8ClampedArray(pixels * 4);

  if (colors >= 4) {
    rgba.set(data.subarray(0, rgba.length));
    return rgba;
  }

  if (colors === 3) {
    for (let i = 0, j = 0; i < pixels; i++, j += 3) {
      rgba[i * 4] = data[j];
      rgba[i * 4 + 1] = data[j + 1];
      rgba[i * 4 + 2] = data[j + 2];
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  if (colors === 1) {
    for (let i = 0; i < pixels; i++) {
      const value = data[i];
      rgba[i * 4] = value;
      rgba[i * 4 + 1] = value;
      rgba[i * 4 + 2] = value;
      rgba[i * 4 + 3] = 255;
    }
    return rgba;
  }

  throw new Error(`Unsupported color count for bitmap: ${colors}`);
}

/**
 * 把 16-bit 位图转成归一化到 [0,1] 的浮点 RGB，用于 Log 色彩空间管线。
 *
 * 不能复用 bitmapToRgba：那边把每个字节当成一个通道，16-bit 数据会被读成两倍数量的
 * 假通道。这里按小端把相邻两个字节拼回一个 16-bit 采样（WASM 是 little-endian，
 * LibRaw 的 processed_image_t 也是按本机字节序写出），再除以 65535。
 *
 * 输出恒为 3 通道：ProPhoto linear 的调用方只需要 RGB，多出来的通道就地丢掉。
 */
export function bitmap16ToFloatRgb(
  data: Uint8Array | Uint8ClampedArray,
  width: number,
  height: number,
  colors: number,
): Float32Array {
  const pixels = width * height;
  // 只有单通道与三通道以上能拼：两通道的排布在 LibRaw 的输出里没有定义
  if (colors !== 1 && colors < 3) {
    throw new Error(`Unsupported color count for 16-bit bitmap: ${colors}`);
  }

  const expected = pixels * colors * 2;
  if (data.length < expected) {
    throw new Error(`16-bit 像素缓冲过小：需要 ${expected} 字节，实际 ${data.length}`);
  }

  const rgb = new Float32Array(pixels * 3);
  const sourceChannels = colors >= 4 ? 3 : colors;
  const stride = colors * 2;
  const scale = 1 / 65535;

  for (let i = 0; i < pixels; i++) {
    const base = i * stride;
    if (sourceChannels === 1) {
      const value = ((data[base + 1] << 8) | data[base]) * scale;
      rgb[i * 3] = value;
      rgb[i * 3 + 1] = value;
      rgb[i * 3 + 2] = value;
      continue;
    }

    rgb[i * 3] = ((data[base + 1] << 8) | data[base]) * scale;
    rgb[i * 3 + 1] = ((data[base + 3] << 8) | data[base + 2]) * scale;
    rgb[i * 3 + 2] = ((data[base + 5] << 8) | data[base + 4]) * scale;
  }

  return rgb;
}

/**
 * 原地上下翻转像素行。
 *
 * WebGL 的 readPixels 按左下原点返回，图像数据按左上原点使用，
 * 所以离屏读回的像素必须翻一次。
 */
export function flipVertically(pixels: Uint8ClampedArray, width: number, height: number): void {
  const rowBytes = width * 4;
  const expected = rowBytes * height;
  if (pixels.length < expected) {
    throw new Error(`像素缓冲过小：需要 ${expected} 字节，实际 ${pixels.length}`);
  }

  const scratch = new Uint8ClampedArray(rowBytes);
  for (let row = 0; row < Math.floor(height / 2); row++) {
    const top = row * rowBytes;
    const bottom = (height - 1 - row) * rowBytes;

    scratch.set(pixels.subarray(top, top + rowBytes));
    pixels.copyWithin(top, bottom, bottom + rowBytes);
    pixels.set(scratch, bottom);
  }
}
