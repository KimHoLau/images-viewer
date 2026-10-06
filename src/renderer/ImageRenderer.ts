import { LOG_GAMUT_FORWARD, LOG_GAMUT_INVERSE } from '../color/log-index';
import { toColumnMajorArray } from '../color/matrices';
import { createLutTexture } from '../lut/texture';
import type { Lut3D } from '../lut/types';
import { flipVertically } from '../services/pixel-utils';
import { DEFAULT_ADJUSTMENTS, type ImageAdjustments } from '../types/adjustments';
import {
  FRAGMENT_SHADER_SOURCE,
  INPUT_UNIFORMS,
  LOG_UNIFORMS,
  LUT_UNIFORMS,
  VERTEX_SHADER_SOURCE,
  uniformNameFor,
} from './shaders';
import {
  clampZoom,
  computeFitTransform,
  toClipQuad,
  type Point,
  type Size,
} from './view-transform';

/** 14 组 Log 色域矩阵，预先转成 GLSL uniform 数组要的列主序，避免每帧再算一遍 */
const LOG_GAMUT_FORWARD_UNIFORM = toColumnMajorArray(LOG_GAMUT_FORWARD);
const LOG_GAMUT_INVERSE_UNIFORM = toColumnMajorArray(LOG_GAMUT_INVERSE);

function compileShader(gl: WebGL2RenderingContext, type: number, source: string): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) throw new Error('Failed to create shader');

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) ?? 'unknown error';
    gl.deleteShader(shader);
    throw new Error(`Shader compile failed: ${log}`);
  }
  return shader;
}

function linkProgram(
  gl: WebGL2RenderingContext,
  vertex: WebGLShader,
  fragment: WebGLShader,
): WebGLProgram {
  const program = gl.createProgram();
  if (!program) throw new Error('Failed to create program');

  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program) ?? 'unknown error';
    gl.deleteProgram(program);
    throw new Error(`Program link failed: ${log}`);
  }
  return program;
}

/**
 * WebGL2 图片渲染器：把图片上传成纹理，按当前缩放/平移画出，
 * 并在片元着色器里完成全部基础调整与 3D LUT。
 *
 * 调整参数只改 uniform，不重建程序，所以拖动滑块时每帧只是一次 draw call。
 */
export class ImageRenderer {
  private readonly gl: WebGL2RenderingContext;
  private readonly program: WebGLProgram;
  private readonly vao: WebGLVertexArrayObject;
  private readonly vertexBuffer: WebGLBuffer;
  private readonly uniformLocations = new Map<string, WebGLUniformLocation | null>();

  private texture: WebGLTexture | null = null;
  /** 当前纹理里装的是 ProPhoto linear 浮点，而不是 sRGB 8-bit */
  private inputLinear = false;
  private lutTexture: WebGLTexture | null = null;
  private lutSize = 0;
  private imageSize: Size = { width: 0, height: 0 };
  private viewport: Size = { width: 0, height: 0 };
  private zoom = 1;
  private pan: Point = { x: 0, y: 0 };
  private adjustments: ImageAdjustments = { ...DEFAULT_ADJUSTMENTS };
  /** Log 模式：关闭时着色器完全不进 Log 分支，行为与加这个功能之前一致 */
  private logMode = false;
  private logCurveId = -1;
  private logMatrixId = -1;
  /** LUT 的输出是否仍在 Log 空间；默认 false（已是显示空间） */
  private lutOutputEncoded = false;
  private disposed = false;

  constructor(canvas: HTMLCanvasElement) {
    const gl = canvas.getContext('webgl2', {
      alpha: false,
      antialias: false,
      premultipliedAlpha: false,
      preserveDrawingBuffer: false,
    });

    if (!gl) {
      throw new Error('当前浏览器不支持 WebGL2');
    }
    this.gl = gl;

    const vertexShader = compileShader(gl, gl.VERTEX_SHADER, VERTEX_SHADER_SOURCE);
    const fragmentShader = compileShader(gl, gl.FRAGMENT_SHADER, FRAGMENT_SHADER_SOURCE);
    this.program = linkProgram(gl, vertexShader, fragmentShader);
    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    // uniform 位置查一次就够，之后每帧复用
    for (const key of Object.keys(DEFAULT_ADJUSTMENTS) as Array<keyof ImageAdjustments>) {
      const name = uniformNameFor(key);
      this.uniformLocations.set(name, gl.getUniformLocation(this.program, name));
    }
    this.uniformLocations.set('u_image', gl.getUniformLocation(this.program, 'u_image'));
    for (const name of LUT_UNIFORMS) {
      this.uniformLocations.set(name, gl.getUniformLocation(this.program, name));
    }
    for (const name of INPUT_UNIFORMS) {
      this.uniformLocations.set(name, gl.getUniformLocation(this.program, name));
    }
    for (const name of LOG_UNIFORMS) {
      this.uniformLocations.set(name, gl.getUniformLocation(this.program, name));
    }

    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    if (!vao || !buffer) throw new Error('Failed to allocate WebGL buffers');
    this.vao = vao;
    this.vertexBuffer = buffer;

    const positionLocation = gl.getAttribLocation(this.program, 'a_position');
    const texCoordLocation = gl.getAttribLocation(this.program, 'a_texCoord');

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    const stride = 4 * Float32Array.BYTES_PER_ELEMENT;
    gl.enableVertexAttribArray(positionLocation);
    gl.vertexAttribPointer(positionLocation, 2, gl.FLOAT, false, stride, 0);
    gl.enableVertexAttribArray(texCoordLocation);
    gl.vertexAttribPointer(
      texCoordLocation,
      2,
      gl.FLOAT,
      false,
      stride,
      2 * Float32Array.BYTES_PER_ELEMENT,
    );
    gl.bindVertexArray(null);

    gl.clearColor(0.1, 0.1, 0.1, 1);
  }

  get context(): WebGL2RenderingContext {
    return this.gl;
  }

  /** 上传 sRGB 位图纹理，替换旧纹理 */
  setImage(source: TexImageSource, width: number, height: number): void {
    this.assertUsable();
    this.assertImageSize(width, height);

    const gl = this.gl;
    const texture = this.createImageTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, gl.RGBA, gl.UNSIGNED_BYTE, source);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.inputLinear = false;
    this.imageSize = { width, height };
  }

  /**
   * 上传 ProPhoto linear 浮点纹理，用于 Log 色彩空间转换。
   *
   * 用 RGB16F 而不是 RGBA8：线性光的暗部在 8 位里只剩几个码值，再经 Log 编码
   * 会放大成明显的色带。RGB16F 在 WebGL2 里默认可线性过滤，显存也只占 RGBA16F 的 3/4。
   */
  setLinearImage(data: Float32Array, width: number, height: number): void {
    this.assertUsable();
    this.assertImageSize(width, height);

    const gl = this.gl;
    const texture = this.createImageTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB16F, width, height, 0, gl.RGB, gl.FLOAT, data);
    gl.bindTexture(gl.TEXTURE_2D, null);

    this.inputLinear = true;
    this.imageSize = { width, height };
  }

  /** 当前纹理是不是 ProPhoto linear 浮点 */
  isInputLinear(): boolean {
    return this.inputLinear;
  }

  /** 建一张新的图片纹理并替换旧的；采样参数两条上传路径共用 */
  private createImageTexture(): WebGLTexture {
    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);

    const texture = gl.createTexture();
    if (!texture) throw new Error('Failed to create texture');

    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);

    this.texture = texture;
    return texture;
  }

  private assertImageSize(width: number, height: number): void {
    if (width <= 0 || height <= 0) {
      throw new Error(`Invalid image size: ${width}x${height}`);
    }
  }

  hasImage(): boolean {
    return this.texture !== null;
  }

  /**
   * 设置或清除 3D LUT。传 null 表示不使用 LUT（着色器跳过采样）。
   * 纹理在这里重建一次，之后每帧只切换绑定。
   */
  setLut(lut: Lut3D | null): void {
    this.assertUsable();
    const gl = this.gl;

    if (this.lutTexture) {
      gl.deleteTexture(this.lutTexture);
      this.lutTexture = null;
    }
    this.lutSize = 0;

    if (lut) {
      this.lutTexture = createLutTexture(gl, lut);
      this.lutSize = lut.size;
    }
  }

  hasLut(): boolean {
    return this.lutTexture !== null;
  }

  /** 设置基础调整参数；只记下来，下次 render 时写进 uniform */
  setAdjustments(adjustments: ImageAdjustments): void {
    this.adjustments = { ...adjustments };
  }

  getAdjustments(): ImageAdjustments {
    return { ...this.adjustments };
  }

  /**
   * 设置 Log 色彩空间模式。
   *
   * curveId / matrixId 是 LOG_SPACES 里的下标（-1 或越界表示不转换）。
   * 两个下标分开传是照着色器的接口来的：曲线与色域本来就可以独立更换，
   * 现在 UI 只会成对地选同一个空间。
   *
   * `lutOutputEncoded` 决定 LUT 采样之后那一步：默认 `false` 表示 LUT 的输出
   * 已经是显示空间（ARRI 的 LogC4 → Rec.709 就是），直接按 Rec.709 γ2.4 转 sRGB；
   * `true` 表示输出仍是 Log，需要解码回工作空间再显示。
   */
  setLogMode(
    enabled: boolean,
    curveId: number,
    matrixId: number,
    lutOutputEncoded = false,
  ): void {
    this.logMode = enabled;
    this.logCurveId = curveId;
    this.logMatrixId = matrixId;
    this.lutOutputEncoded = lutOutputEncoded;
  }

  getLogMode(): {
    enabled: boolean;
    curveId: number;
    matrixId: number;
    lutOutputEncoded: boolean;
  } {
    return {
      enabled: this.logMode,
      curveId: this.logCurveId,
      matrixId: this.logMatrixId,
      lutOutputEncoded: this.lutOutputEncoded,
    };
  }

  setViewport(width: number, height: number): void {
    if (width <= 0 || height <= 0) return;
    this.viewport = { width, height };
  }

  getViewport(): Size {
    return { ...this.viewport };
  }

  /** 已上传图片的像素尺寸 */
  getImageSize(): Size {
    return { ...this.imageSize };
  }

  setZoom(zoom: number): void {
    this.zoom = clampZoom(zoom);
  }

  getZoom(): number {
    return this.zoom;
  }

  setPan(pan: Point): void {
    this.pan = pan;
  }

  /** 当前绘制区域，供命中测试与坐标换算使用 */
  getTransform() {
    return computeFitTransform(this.imageSize, this.viewport, this.zoom, this.pan);
  }

  render(): void {
    this.assertUsable();
    const gl = this.gl;
    if (this.viewport.width <= 0 || this.viewport.height <= 0) return;

    gl.viewport(0, 0, this.viewport.width, this.viewport.height);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (!this.texture) return;

    const quad = toClipQuad(this.getTransform(), this.viewport);
    gl.bindVertexArray(this.vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.vertexBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, quad, gl.DYNAMIC_DRAW);

    gl.useProgram(this.program);

    for (const [key, value] of Object.entries(this.adjustments)) {
      const location = this.uniformLocations.get(uniformNameFor(key as keyof ImageAdjustments));
      if (location) gl.uniform1f(location, value);
    }

    const lutSizeLocation = this.uniformLocations.get('u_lutSize');
    if (lutSizeLocation) gl.uniform1f(lutSizeLocation, this.lutSize);
    const lutEnabledLocation = this.uniformLocations.get('u_lutEnabled');
    if (lutEnabledLocation) gl.uniform1f(lutEnabledLocation, this.lutTexture ? 1 : 0);
    const lutOutputEncodedLocation = this.uniformLocations.get('u_lutOutputEncoded');
    if (lutOutputEncodedLocation) {
      gl.uniform1f(lutOutputEncodedLocation, this.lutOutputEncoded ? 1 : 0);
    }

    const inputLinearLocation = this.uniformLocations.get('u_inputLinear');
    if (inputLinearLocation) gl.uniform1f(inputLinearLocation, this.inputLinear ? 1 : 0);

    // int 类型的 uniform 必须用 uniform1i：用 uniform1f 会因类型不匹配报
    // INVALID_OPERATION，而且只是静默置位——画面看起来「没坏」，模式却切不动
    const logModeLocation = this.uniformLocations.get('u_logMode');
    if (logModeLocation) gl.uniform1i(logModeLocation, this.logMode ? 1 : 0);

    if (this.logMode) {
      const curveLocation = this.uniformLocations.get('u_logCurveId');
      if (curveLocation) gl.uniform1i(curveLocation, this.logCurveId);
      const matrixLocation = this.uniformLocations.get('u_logMatrixId');
      if (matrixLocation) gl.uniform1i(matrixLocation, this.logMatrixId);

      // 一次上传 14 组矩阵，之后换空间只改 int 下标。
      // 必须用 uniformMatrix3fv：mat3 不是 vec3 数组，uniform3fv 在 WebGL 里
      // 会因类型不匹配报 INVALID_OPERATION，矩阵会静默地留在全零。
      // transpose 固定 false——WebGL 不接受 true，而这里给的本来就是列主序。
      const forwardLocation = this.uniformLocations.get('u_logGamutForward');
      if (forwardLocation) gl.uniformMatrix3fv(forwardLocation, false, LOG_GAMUT_FORWARD_UNIFORM);
      const inverseLocation = this.uniformLocations.get('u_logGamutInverse');
      if (inverseLocation) gl.uniformMatrix3fv(inverseLocation, false, LOG_GAMUT_INVERSE_UNIFORM);
    }

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.texture);
    gl.uniform1i(this.uniformLocations.get('u_image') ?? null, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_3D, this.lutTexture);
    gl.uniform1i(this.uniformLocations.get('u_lut') ?? null, 1);

    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.bindVertexArray(null);
  }

  /**
   * 按指定尺寸把当前图片（含调整与 LUT）渲染到离屏帧缓冲并读回像素。
   *
   * 导出必须走这条路，而不是读屏幕画布：屏幕画布只有视口那么大，
   * 而且带着当前的缩放与平移。这里把视口临时设成目标尺寸、缩放归零，
   * 图片正好铺满，画完再恢复原状。
   *
   * readPixels 按左下原点返回，读回后翻成正立图像。
   */
  renderToImageData(width: number, height: number): ImageData {
    this.assertUsable();
    const gl = this.gl;

    if (!this.texture) {
      throw new Error('尚未载入图片，无法导出');
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) {
      throw new Error(`导出尺寸非法: ${width}×${height}`);
    }

    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    if (width > maxTextureSize || height > maxTextureSize) {
      throw new Error(`导出尺寸 ${width}×${height} 超过设备上限 ${maxTextureSize}`);
    }

    const targetTexture = gl.createTexture();
    const framebuffer = gl.createFramebuffer();
    if (!targetTexture || !framebuffer) {
      throw new Error('无法创建离屏渲染目标');
    }

    const previousViewport = { ...this.viewport };
    const previousZoom = this.zoom;
    const previousPan = this.pan;
    const previousFramebuffer = gl.getParameter(gl.FRAMEBUFFER_BINDING) as WebGLFramebuffer | null;

    try {
      gl.bindTexture(gl.TEXTURE_2D, targetTexture);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, width, height, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

      gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
      gl.framebufferTexture2D(
        gl.FRAMEBUFFER,
        gl.COLOR_ATTACHMENT0,
        gl.TEXTURE_2D,
        targetTexture,
        0,
      );
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) {
        throw new Error('离屏帧缓冲不完整，无法导出');
      }

      // 目标尺寸与图片同比例，此时 fit 缩放正好为 1、无需平移，图片铺满整个目标
      this.viewport = { width, height };
      this.zoom = 1;
      this.pan = { x: 0, y: 0 };
      this.render();

      const pixels = new Uint8ClampedArray(width * height * 4);
      gl.readPixels(0, 0, width, height, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
      flipVertically(pixels, width, height);

      return new ImageData(pixels, width, height);
    } finally {
      this.viewport = previousViewport;
      this.zoom = previousZoom;
      this.pan = previousPan;
      gl.bindFramebuffer(gl.FRAMEBUFFER, previousFramebuffer);
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(targetTexture);
    }
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;

    const gl = this.gl;
    if (this.texture) gl.deleteTexture(this.texture);
    if (this.lutTexture) gl.deleteTexture(this.lutTexture);
    gl.deleteBuffer(this.vertexBuffer);
    gl.deleteVertexArray(this.vao);
    gl.deleteProgram(this.program);
    this.texture = null;
    this.lutTexture = null;
  }

  private assertUsable(): void {
    if (this.disposed) throw new Error('ImageRenderer has been disposed');
  }
}
