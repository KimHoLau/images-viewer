import type { Lut3D } from './types';

/**
 * 把 3D LUT 上传成 WebGL2 的 3D 纹理。
 *
 * 内部格式用 RGBA16F：半浮点在 WebGL2 里默认就支持线性过滤，
 * 比 RGBA8 少一层量化误差，体积也只有 RGBA32F 的一半。
 * LUT 数据本身就是「x 最快、其次 y、最后 z」的排布，与 .cube 的 R 最快一致，
 * 所以这里只做 RGB→RGBA 的补齐，不做任何搬移。
 *
 * 过滤必须是 NEAREST：插值由着色器手写的四面体完成（见 renderer/shaders.ts）。
 * 交给硬件做 LINEAR 就是三线性，而三线性会把离轴格点的色度方向在**中性输入**上
 * 加权出来——实测官方 ARRI LogC4→Rec.709 LUT 能因此偏出 4.6/255，再被 LogC4
 * 解码放大成 10–22/255。
 */
export function createLutTexture(gl: WebGL2RenderingContext, lut: Lut3D): WebGLTexture {
  const maxSize = gl.getParameter(gl.MAX_3D_TEXTURE_SIZE) as number;
  if (lut.size > maxSize) {
    throw new Error(`LUT 尺寸 ${lut.size} 超过设备上限 ${maxSize}`);
  }

  const texture = gl.createTexture();
  if (!texture) throw new Error('无法创建 LUT 纹理');

  const entryCount = lut.size ** 3;
  const rgba = new Float32Array(entryCount * 4);
  for (let i = 0; i < entryCount; i++) {
    rgba[i * 4] = lut.data[i * 3];
    rgba[i * 4 + 1] = lut.data[i * 3 + 1];
    rgba[i * 4 + 2] = lut.data[i * 3 + 2];
    rgba[i * 4 + 3] = 1;
  }

  gl.bindTexture(gl.TEXTURE_3D, texture);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_3D, gl.TEXTURE_WRAP_R, gl.CLAMP_TO_EDGE);
  gl.texImage3D(
    gl.TEXTURE_3D,
    0,
    gl.RGBA16F,
    lut.size,
    lut.size,
    lut.size,
    0,
    gl.RGBA,
    gl.FLOAT,
    rgba,
  );
  gl.bindTexture(gl.TEXTURE_3D, null);

  return texture;
}
