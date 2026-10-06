import { describe, expect, it } from 'vitest';
import { DEFAULT_ADJUSTMENTS } from '../types/adjustments';
import {
  LUMA_WEIGHTS,
  MID_GRAY,
  TINT_GREEN_STRENGTH,
  TINT_STRENGTH,
  TONE_STRENGTH,
  WARMTH_STRENGTH,
} from './adjustments-math';
import {
  BASE_ADJUSTMENT_UNIFORMS,
  FRAGMENT_SHADER_SOURCE,
  INPUT_UNIFORMS,
  LOG_UNIFORMS,
  LUT_UNIFORMS,
  uniformNameFor,
  VERTEX_SHADER_SOURCE,
} from './shaders';

// 直接读源码，用来盯住 GLSL 与 CPU 实现的步骤顺序是否还一致
import mathSource from './adjustments-math.ts?raw';

describe('着色器源码基本形状', () => {
  it('uses GLSL ES 3.00', () => {
    expect(VERTEX_SHADER_SOURCE.startsWith('#version 300 es')).toBe(true);
    expect(FRAGMENT_SHADER_SOURCE.startsWith('#version 300 es')).toBe(true);
  });

  it('declares high precision floats, RAW 数据需要', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('precision highp float;');
  });

  it('passes texture coordinates from the vertex shader', () => {
    expect(VERTEX_SHADER_SOURCE).toContain('out vec2 v_texCoord;');
    expect(FRAGMENT_SHADER_SOURCE).toContain('in vec2 v_texCoord;');
  });
});

describe('uniform 与参数键一一对应', () => {
  it('declares every base adjustment uniform', () => {
    for (const name of BASE_ADJUSTMENT_UNIFORMS) {
      expect(FRAGMENT_SHADER_SOURCE).toContain(`uniform float ${name};`);
    }
  });

  it('binds each adjustment key to a declared uniform', () => {
    for (const key of Object.keys(DEFAULT_ADJUSTMENTS)) {
      const name = uniformNameFor(key as keyof typeof DEFAULT_ADJUSTMENTS);
      expect(name).toBe(`u_${key}`);
    }
  });

  it('has a uniform for every base adjustment key', () => {
    const keysWithoutLut = (
      Object.keys(DEFAULT_ADJUSTMENTS) as Array<keyof typeof DEFAULT_ADJUSTMENTS>
    ).filter((key) => key !== 'lutStrength');

    expect(keysWithoutLut.map(uniformNameFor).sort()).toEqual([...BASE_ADJUSTMENT_UNIFORMS].sort());
  });

  it('declares the image sampler', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('uniform sampler2D u_image;');
  });
});

describe('常量在 GLSL 与 CPU 实现之间一致', () => {
  it('shares the contrast pivot', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain(`const float MID_GRAY = ${MID_GRAY};`);
  });

  it('shares the Rec.709 luminance weights', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      `const vec3 LUMA_WEIGHTS = vec3(${LUMA_WEIGHTS.join(', ')});`,
    );
  });

  it('shares the strength coefficients', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain(`const float WARMTH_STRENGTH = ${WARMTH_STRENGTH};`);
    expect(FRAGMENT_SHADER_SOURCE).toContain(`const float TINT_STRENGTH = ${TINT_STRENGTH};`);
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      `const float TINT_GREEN_STRENGTH = ${TINT_GREEN_STRENGTH};`,
    );
    expect(FRAGMENT_SHADER_SOURCE).toContain(`const float TONE_STRENGTH = ${TONE_STRENGTH};`);
  });
});

describe('调整步骤的顺序', () => {
  /** GLSL 里各步骤的定位标记，顺序即执行顺序 */
  const glslMarkers = [
    'warmFilter',
    'exp2(u_exposure)',
    '1.0 + u_contrast',
    'highlightWeight',
    '1.0 + u_saturation',
  ];

  it('runs the steps in the documented order in GLSL', () => {
    const positions = glslMarkers.map((marker) => FRAGMENT_SHADER_SOURCE.indexOf(marker));

    for (const [index, position] of positions.entries()) {
      expect(position, `缺少标记 ${glslMarkers[index]}`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('runs the same steps in the same order on the CPU', () => {
    const cpuMarkers = [
      'applyWhiteBalance(',
      'applyExposure(',
      'applyContrast(',
      'applyHighlightsShadows(',
      'applySaturation(',
    ];

    // 只看 applyAdjustments 的函数体，避免被函数定义本身的顺序带偏
    const body = mathSource.slice(mathSource.indexOf('export function applyAdjustments'));
    const positions = cpuMarkers.map((marker) => body.indexOf(marker));

    for (const [index, position] of positions.entries()) {
      expect(position, `缺少调用 ${cpuMarkers[index]}`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('clamps before converting back to sRGB in both implementations', () => {
    const glslClamp = FRAGMENT_SHADER_SOURCE.indexOf('linearToSrgb(clamp(color');
    expect(glslClamp).toBeGreaterThan(-1);

    const cpuClamp = mathSource.indexOf('linearToSrgbRgb(clampRgb(color))');
    expect(cpuClamp).toBeGreaterThan(-1);
  });
});

describe('输入像素空间', () => {
  it('declares the input-space uniform', () => {
    for (const name of INPUT_UNIFORMS) {
      expect(FRAGMENT_SHADER_SOURCE).toContain(`uniform float ${name};`);
    }
  });

  it('只给 ProPhoto linear 输入夹负值，sRGB 输入保持原来的两步', () => {
    // ProPhoto linear 是浮点纹理，上夹会白白丢掉高光余量
    expect(FRAGMENT_SHADER_SOURCE).toContain(
      'u_inputLinear > 0.5 ? max(texel, 0.0) : srgbToLinear(clamp(texel, 0.0, 1.0))',
    );
    expect(mathSource).toContain(
      'inputLinear ? clampMinRgb(srgb, 0) : srgbToLinearRgb(clampRgb(srgb))',
    );
  });
});

describe('Log 模式的接入', () => {
  it('declares every Log uniform', () => {
    for (const name of LOG_UNIFORMS) {
      expect(FRAGMENT_SHADER_SOURCE, `缺少声明 ${name}`).toContain(name);
    }
  });

  it('Log 分支在饱和度之后、显示转换之前', () => {
    const saturation = FRAGMENT_SHADER_SOURCE.indexOf('1.0 + u_saturation');
    const branch = FRAGMENT_SHADER_SOURCE.indexOf('if (u_logMode == 1)');
    const display = FRAGMENT_SHADER_SOURCE.indexOf('display = linearToSrgb(clamp(color');

    expect(saturation).toBeGreaterThan(-1);
    expect(branch).toBeGreaterThan(saturation);
    expect(display).toBeGreaterThan(branch);
  });

  it('开关声明成 int，避免 float/int 的 uniform 类型错配', () => {
    // 声明成 int 就必须配 uniform1i；两边不一致时 WebGL 只置位错误标志、不抛异常
    expect(FRAGMENT_SHADER_SOURCE).toContain('uniform int u_logMode;');
    expect(mathSource).toContain('if (logMode) {');
  });

  it('按 色域 → 编码 → LUT → 解码 → 逆矩阵 的顺序走 Log 管线', () => {
    const markers = [
      'applyGamutMatrix(color, u_logMatrixId)',
      'encodeLogRgb(gamut, u_logCurveId)',
      'applyLut(logColor)',
      'decodeLogRgb(',
      'applyInverseGamutMatrix(decoded, u_logMatrixId)',
      'PROPHOTO_TO_SRGB * prophoto',
    ];

    const body = FRAGMENT_SHADER_SOURCE.slice(FRAGMENT_SHADER_SOURCE.indexOf('void main()'));
    const positions = markers.map((marker) => body.indexOf(marker));

    for (const [index, position] of positions.entries()) {
      expect(position, `缺少标记 ${markers[index]}`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('CPU 镜像走同样的顺序', () => {
    const markers = [
      'applyGamutAt(color, logMatrixId)',
      'clampMinRgb(gamut, LOG_INPUT_FLOOR)',
      'encodeLogAt(',
      'applyLut(logColor, lut, adjustments.lutStrength)',
      'decodeLogAt(',
      'applyInverseGamutAt(decoded, logMatrixId)',
      'applyMatrix3(PROPHOTO_TO_SRGB, prophoto)',
    ];

    const body = mathSource.slice(mathSource.indexOf('function applyLogPipeline'));
    expect(body.length).toBeGreaterThan(0);
    const positions = markers.map((marker) => body.indexOf(marker));

    for (const [index, position] of positions.entries()) {
      expect(position, `缺少标记 ${markers[index]}`).toBeGreaterThan(-1);
    }
    for (let i = 1; i < positions.length; i++) {
      expect(positions[i]).toBeGreaterThan(positions[i - 1]);
    }
  });

  it('关闭 Log 模式时走的还是原来那条路', () => {
    // 两条分支都在，说明关掉时不会误进 Log 管线
    expect(FRAGMENT_SHADER_SOURCE).toContain('} else {');
    expect(FRAGMENT_SHADER_SOURCE).toContain('display = applyLut(display);');
    expect(mathSource).toContain('if (logMode) {');
  });
});

describe('3D LUT 的接入', () => {
  it('declares high precision for the 3D sampler', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('precision highp sampler3D;');
  });

  it('declares every LUT uniform', () => {
    for (const name of LUT_UNIFORMS) {
      const declaration =
        name === 'u_lut' ? `uniform sampler3D ${name};` : `uniform float ${name};`;
      expect(FRAGMENT_SHADER_SOURCE, `缺少声明 ${declaration}`).toContain(declaration);
    }
  });

  it('names the strength uniform after the adjustment key', () => {
    expect(uniformNameFor('lutStrength')).toBe('u_lutStrength');
    expect(FRAGMENT_SHADER_SOURCE).toContain('uniform float u_lutStrength;');
  });

  it('skips LUT sampling when no LUT is bound', () => {
    expect(FRAGMENT_SHADER_SOURCE).toContain('if (u_lutEnabled < 0.5) return display;');
  });

  it('maps input to texel centers the same way the CPU sampler does', () => {
    // 格点 i 的纹素中心是 (i + 0.5) / size
    expect(FRAGMENT_SHADER_SOURCE).toContain('+ 0.5) / u_lutSize');
    expect(mathSource).toContain('clamp01(rgb[0]) * (n - 1)');
    expect(mathSource).toContain('const x0 = Math.min(Math.floor(x), n - 2);');
  });

  it('interpolates with tetrahedral in both, never with hardware trilinear', () => {
    // GLSL 侧：必须是手写的四面体（六条分支），并且取格点要用 NEAREST 语义
    expect(FRAGMENT_SHADER_SOURCE).toContain('vec3 sampleLutTetrahedral(vec3 rgb)');
    expect(FRAGMENT_SHADER_SOURCE).toContain('floor(coord) + 0.5');
    for (const branch of [
      'if (fr >= fg && fg >= fb)',
      'if (fr >= fb && fb >= fg)',
      'if (fb >= fr && fr >= fg)',
      'if (fg >= fr && fr >= fb)',
      'if (fg >= fb && fb >= fr)',
    ]) {
      expect(FRAGMENT_SHADER_SOURCE, `缺少分支 ${branch}`).toContain(branch);
    }
    // 不能再出现直接把插值交给硬件的那一行
    expect(FRAGMENT_SHADER_SOURCE).not.toContain(
      'texture(u_lut, (clamp(display, 0.0, 1.0) * (u_lutSize - 1.0) + 0.5) / u_lutSize)',
    );

    // CPU 侧：同一条 if/else 链（条件与 GLSL 的分支逐条对应）
    expect(mathSource).toContain('if (fx >= fy && fy >= fz) {');
    expect(mathSource).toContain('} else if (fx >= fz && fz >= fy) {');
    expect(mathSource).toContain('} else if (fz >= fx && fx >= fy) {');
    expect(mathSource).toContain('} else if (fy >= fx && fx >= fz) {');
    expect(mathSource).toContain('} else if (fy >= fz && fz >= fx) {');
  });

  it('两个开关两条路，GPU 与 CPU 的分支条件逐条对应', () => {
    // 显示空间输出走 Rec.709 γ2.4 → sRGB；Log 空间输出走解码 → 逆矩阵 → sRGB
    expect(FRAGMENT_SHADER_SOURCE).toContain('u_lutOutputEncoded > 0.5 || !hasLut');
    expect(FRAGMENT_SHADER_SOURCE).toContain('vec3 rec709ToLinear(vec3 encoded)');
    expect(mathSource).toContain('export function rec709ToLinear(channel: number): number');
    expect(mathSource).toContain('if (!lutOutputEncoded) {');
    expect(mathSource).toContain('if (!hasLut) {');
    // 没挂 LUT 时两条路必须等价（开关不生效）
    expect(FRAGMENT_SHADER_SOURCE).toContain('bool hasLut = u_lutEnabled > 0.5 && u_lutStrength > 0.0;');
    expect(mathSource).toContain('const hasLut = lut !== null && adjustments.lutStrength > 0;');
  });

  it('applies the LUT after converting back to display space in both', () => {
    const glslConvert = FRAGMENT_SHADER_SOURCE.indexOf('display = linearToSrgb(clamp(color');
    const glslLut = FRAGMENT_SHADER_SOURCE.indexOf('display = applyLut(display)');
    expect(glslConvert).toBeGreaterThan(-1);
    expect(glslLut).toBeGreaterThan(glslConvert);

    const cpuConvert = mathSource.indexOf('const display = linearToSrgbRgb(');
    const cpuLut = mathSource.indexOf('applyLut(display, lut, adjustments.lutStrength)');
    expect(cpuConvert).toBeGreaterThan(-1);
    expect(cpuLut).toBeGreaterThan(cpuConvert);
  });
});
