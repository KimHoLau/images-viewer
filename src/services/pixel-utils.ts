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
 * 原地上下翻转像素行。
 *
 * WebGL 的 readPixels 按左下原点返回，图像数据按左上原点使用，
 * 所以离屏读回的像素必须翻一次。
 */
export function flipVertically(
  pixels: Uint8ClampedArray,
  width: number,
  height: number,
): void {
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
