/**
 * 开发用的 WebGL 验证脚本（不是产品代码，没有被任何入口引用）。
 *
 * 在真实 WebGL2 里跑一遍 ImageRenderer，检查：
 *   1. 着色器能否编译链接（jsdom 里验证不了）
 *   2. 默认参数下 GPU 输出是否等于输入（恒等）
 *   3. 各调整参数下 GPU 输出是否与 CPU 实现（renderer/adjustments-math.ts）一致
 *
 * 跑法：
 *   npx vite --port 5211
 *   chrome --headless=new --enable-unsafe-swiftshader --virtual-time-budget=20000 \
 *     --dump-dom http://localhost:5211/webgl-check.html
 * 结果在 dump 出来的 WEBGL-CHECK-BEGIN / END 之间。
 * 改动着色器之后应该重跑一遍。
 */
import { ImageRenderer } from '../renderer/ImageRenderer';
import { applyAdjustments, type Rgb } from '../renderer/adjustments-math';
import { generateLut3D } from '../lut/generate';
import { getPresetLut } from '../lut/presets';
import { encodeImageData } from '../services/export';
import { ImageLoader } from '../services/image-loader';
import { DEFAULT_ADJUSTMENTS, type ImageAdjustments } from '../types/adjustments';

const lines: string[] = [];
const results = document.getElementById('results')!;

function report(label: string, ok: boolean, detail = ''): void {
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` :: ${detail}` : ''}`);
}

/** 从 RGBA 缓冲里取某个像素的 sRGB 颜色 */
function pixelAt(data: Uint8ClampedArray, index: number): Rgb {
  return [data[index * 4] / 255, data[index * 4 + 1] / 255, data[index * 4 + 2] / 255];
}

function maxChannelDiff(a: Rgb, b: Rgb): number {
  return Math.max(Math.abs(a[0] - b[0]), Math.abs(a[1] - b[1]), Math.abs(a[2] - b[2]));
}

/** 测试像素，覆盖暗部、中灰、饱和色、纯白 */
const TEST_PIXELS: Rgb[] = [
  [0, 0, 0],
  [0.18, 0.18, 0.18],
  [0.5, 0.5, 0.5],
  [0.9, 0.3, 0.1],
  [0.1, 0.6, 0.85],
  [1, 1, 1],
];

const WIDTH = TEST_PIXELS.length;
const HEIGHT = 1;

function buildImageData(): ImageData {
  const data = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  TEST_PIXELS.forEach((rgb, index) => {
    data[index * 4] = Math.round(rgb[0] * 255);
    data[index * 4 + 1] = Math.round(rgb[1] * 255);
    data[index * 4 + 2] = Math.round(rgb[2] * 255);
    data[index * 4 + 3] = 255;
  });
  return new ImageData(data, WIDTH, HEIGHT);
}

function renderAndRead(renderer: ImageRenderer, adjustments: ImageAdjustments): Uint8ClampedArray {
  renderer.setAdjustments(adjustments);
  renderer.render();
  const gl = renderer.context;
  const pixels = new Uint8ClampedArray(WIDTH * HEIGHT * 4);
  gl.readPixels(0, 0, WIDTH, HEIGHT, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
  return pixels;
}

async function run(): Promise<void> {
  const canvas = document.createElement('canvas');
  canvas.width = WIDTH;
  canvas.height = HEIGHT;

  let renderer: ImageRenderer;
  try {
    renderer = new ImageRenderer(canvas);
  } catch (error) {
    report('着色器编译与程序链接', false, (error as Error).message);
    finish();
    return;
  }
  report('着色器编译与程序链接', true);

  try {
    renderer.setViewport(WIDTH, HEIGHT);
    renderer.setImage(buildImageData(), WIDTH, HEIGHT);
    renderer.setLut(null);

    // 1. 默认参数应当是恒等变换（允许 8 位量化误差）
    const identity = renderAndRead(renderer, { ...DEFAULT_ADJUSTMENTS });
    let worstIdentity = 0;
    TEST_PIXELS.forEach((expected, index) => {
      worstIdentity = Math.max(worstIdentity, maxChannelDiff(pixelAt(identity, index), expected));
    });
    report(
      '默认参数下 GPU 输出等于输入',
      worstIdentity <= 3 / 255,
      `最大偏差 ${(worstIdentity * 255).toFixed(1)}/255`,
    );

    // 2. 各参数组合下 GPU 与 CPU 实现一致
    const settingsList: Array<[string, ImageAdjustments]> = [
      ['曝光 +1', { ...DEFAULT_ADJUSTMENTS, exposure: 1 }],
      ['曝光 -1.5', { ...DEFAULT_ADJUSTMENTS, exposure: -1.5 }],
      ['对比度 +0.6', { ...DEFAULT_ADJUSTMENTS, contrast: 0.6 }],
      ['对比度 -0.6', { ...DEFAULT_ADJUSTMENTS, contrast: -0.6 }],
      ['色温 +0.8', { ...DEFAULT_ADJUSTMENTS, temperature: 0.8 }],
      ['色温 -0.8', { ...DEFAULT_ADJUSTMENTS, temperature: -0.8 }],
      ['色调 +0.7', { ...DEFAULT_ADJUSTMENTS, tint: 0.7 }],
      ['高光 -0.9', { ...DEFAULT_ADJUSTMENTS, highlights: -0.9 }],
      ['阴影 +0.9', { ...DEFAULT_ADJUSTMENTS, shadows: 0.9 }],
      ['饱和度 -1', { ...DEFAULT_ADJUSTMENTS, saturation: -1 }],
      ['饱和度 +0.8', { ...DEFAULT_ADJUSTMENTS, saturation: 0.8 }],
      [
        '全部叠加',
        {
          temperature: 0.4,
          tint: -0.3,
          exposure: 0.7,
          contrast: 0.5,
          highlights: -0.4,
          shadows: 0.6,
          saturation: 0.3,
          lutStrength: 1,
        },
      ],
    ];

    for (const [label, settings] of settingsList) {
      const gpu = renderAndRead(renderer, settings);
      let worst = 0;
      TEST_PIXELS.forEach((source, index) => {
        const expected = applyAdjustments(source, settings);
        worst = Math.max(worst, maxChannelDiff(pixelAt(gpu, index), expected));
      });
      report(`GPU 与 CPU 一致（${label}）`, worst <= 3 / 255, `最大偏差 ${(worst * 255).toFixed(1)}/255`);
    }

    // 3. 曝光 +1 应当让线性亮度翻倍
    const base = applyAdjustments([0.3, 0.3, 0.3], { ...DEFAULT_ADJUSTMENTS });
    const lifted = applyAdjustments([0.3, 0.3, 0.3], { ...DEFAULT_ADJUSTMENTS, exposure: 1 });
    report('曝光 +1 提亮画面', lifted[0] > base[0], `${base[0].toFixed(3)} → ${lifted[0].toFixed(3)}`);

    // 4. 3D LUT：轴向是否正确
    //    换通道 LUT（R←B、G←R、B←G）能一次性验出采样坐标有没有搞错轴序。
    const swapLut = generateLut3D(2, (rgb) => [rgb[2], rgb[0], rgb[1]]);
    renderer.setLut(swapLut);
    const swapped = renderAndRead(renderer, { ...DEFAULT_ADJUSTMENTS });
    let worstSwap = 0;
    TEST_PIXELS.forEach((source, index) => {
      const expected: Rgb = [source[2], source[0], source[1]];
      worstSwap = Math.max(worstSwap, maxChannelDiff(pixelAt(swapped, index), expected));
    });
    report(
      '3D LUT 轴向正确（换通道 LUT）',
      worstSwap <= 3 / 255,
      `最大偏差 ${(worstSwap * 255).toFixed(1)}/255`,
    );

    // 5. LUT 与基础调整叠加时，GPU 与 CPU 仍需一致
    const monoLut = getPresetLut('mono')!;
    const coolLut = getPresetLut('cool-cinema')!;
    const lutCases: Array<[string, ImageAdjustments, typeof monoLut]> = [
      ['黑白预设', { ...DEFAULT_ADJUSTMENTS }, monoLut],
      ['冷调预设 + 曝光 0.5', { ...DEFAULT_ADJUSTMENTS, exposure: 0.5 }, coolLut],
      ['暖调预设 + 强度 0.4', { ...DEFAULT_ADJUSTMENTS, lutStrength: 0.4 }, getPresetLut('warm-film')!],
      ['预设 + 全部调整', {
        temperature: 0.3,
        tint: -0.2,
        exposure: 0.4,
        contrast: 0.3,
        highlights: -0.2,
        shadows: 0.4,
        saturation: 0.2,
        lutStrength: 0.8,
      }, coolLut],
    ];

    for (const [label, settings, lut] of lutCases) {
      renderer.setLut(lut);
      const gpu = renderAndRead(renderer, settings);
      let worst = 0;
      TEST_PIXELS.forEach((source, index) => {
        const expected = applyAdjustments(source, settings, lut);
        worst = Math.max(worst, maxChannelDiff(pixelAt(gpu, index), expected));
      });
      report(
        `GPU 与 CPU 一致（LUT：${label}）`,
        worst <= 4 / 255,
        `最大偏差 ${(worst * 255).toFixed(1)}/255`,
      );
    }

    // 6. 黑白预设应当让输出三个通道相等
    renderer.setLut(monoLut);
    const greyed = renderAndRead(renderer, { ...DEFAULT_ADJUSTMENTS });
    let worstGrey = 0;
    for (let index = 0; index < WIDTH; index++) {
      const [r, g, b] = pixelAt(greyed, index);
      worstGrey = Math.max(worstGrey, Math.abs(r - g), Math.abs(g - b));
    }
    report('黑白预设输出为灰', worstGrey <= 3 / 255, `最大通道差 ${(worstGrey * 255).toFixed(1)}/255`);

    // 7. 强度 0 时即使绑着 LUT 也应等于原图
    renderer.setLut(monoLut);
    const strengthZero = renderAndRead(renderer, { ...DEFAULT_ADJUSTMENTS, lutStrength: 0 });
    let worstZero = 0;
    TEST_PIXELS.forEach((source, index) => {
      worstZero = Math.max(worstZero, maxChannelDiff(pixelAt(strengthZero, index), source));
    });
    report('LUT 强度 0 等于原图', worstZero <= 3 / 255, `最大偏差 ${(worstZero * 255).toFixed(1)}/255`);

    // 8. 清除 LUT 后回到原图
    renderer.setLut(null);
    const cleared = renderAndRead(renderer, { ...DEFAULT_ADJUSTMENTS });
    let worstCleared = 0;
    TEST_PIXELS.forEach((source, index) => {
      worstCleared = Math.max(worstCleared, maxChannelDiff(pixelAt(cleared, index), source));
    });
    report('清除 LUT 后回到原图', worstCleared <= 3 / 255, `最大偏差 ${(worstCleared * 255).toFixed(1)}/255`);

    // 9. 离屏导出：尺寸、方向、是否带上调整与 LUT
    await checkExport(renderer, monoLut);

    // 10. 文件 → 解码 → 显示 的主路径
    await checkImageLoading(renderer);
  } catch (error) {
    report('渲染流程', false, (error as Error).message);
  } finally {
    renderer.dispose();
  }

  finish();
}

function finish(): void {
  results.textContent = `WEBGL-CHECK-BEGIN\n${lines.join('\n')}\nWEBGL-CHECK-END`;
}

/** 从 ImageData 里取某个像素的 sRGB 颜色 */
function imageDataPixel(image: ImageData, index: number): Rgb {
  return pixelAt(image.data, index);
}

/**
 * 离屏导出（票 10）的验证。
 *
 * 用一张上红下蓝的图专门验方向：readPixels 是左下原点，
 * 少翻一次就会上下颠倒，而这类错误在单一纯色图上根本看不出来。
 */
function checkExport(
  renderer: ImageRenderer,
  monoLut: ReturnType<typeof getPresetLut>,
): Promise<void> {
  const W = 3;
  const H = 2;
  // 第一行红、第二行蓝
  const colors: Rgb[] = [
    [1, 0, 0],
    [1, 0, 0],
    [1, 0, 0],
    [0, 0, 1],
    [0, 0, 1],
    [0, 0, 1],
  ];

  const data = new Uint8ClampedArray(W * H * 4);
  colors.forEach((rgb, index) => {
    data[index * 4] = Math.round(rgb[0] * 255);
    data[index * 4 + 1] = Math.round(rgb[1] * 255);
    data[index * 4 + 2] = Math.round(rgb[2] * 255);
    data[index * 4 + 3] = 255;
  });

  renderer.setViewport(W, H);
  renderer.setLut(null);
  renderer.setImage(new ImageData(data, W, H), W, H);
  renderer.setAdjustments({ ...DEFAULT_ADJUSTMENTS });

  const exported = renderer.renderToImageData(W, H);
  report(
    '导出尺寸等于目标尺寸',
    exported.width === W && exported.height === H,
    `${exported.width}×${exported.height}`,
  );

  const topRow = imageDataPixel(exported, 0);
  const bottomRow = imageDataPixel(exported, W);
  report(
    '导出方向正确（第一行来自源图第一行）',
    maxChannelDiff(topRow, [1, 0, 0]) <= 3 / 255 && maxChannelDiff(bottomRow, [0, 0, 1]) <= 3 / 255,
    `上行 ${topRow.map((c) => c.toFixed(2)).join(',')} / 下行 ${bottomRow.map((c) => c.toFixed(2)).join(',')}`,
  );

  // 导出不应改动屏幕上的视口与缩放状态
  report(
    '导出不干扰屏幕视图状态',
    renderer.getViewport().width === W &&
      renderer.getZoom() === 1 &&
      renderer.getImageSize().width === W,
    `viewport=${renderer.getViewport().width}×${renderer.getViewport().height}`,
  );

  // 调整随导出走
  renderer.setAdjustments({ ...DEFAULT_ADJUSTMENTS, exposure: 1 });
  const brightened = imageDataPixel(renderer.renderToImageData(W, H), 0);
  report(
    '导出带上基础调整',
    brightened[0] > 0.99 && brightened[2] < 0.02,
    `曝光 +1 后红色通道 ${brightened[0].toFixed(3)}`,
  );

  // LUT 随导出走
  renderer.setAdjustments({ ...DEFAULT_ADJUSTMENTS });
  renderer.setLut(monoLut);
  const greyed = imageDataPixel(renderer.renderToImageData(W, H), 0);
  report(
    '导出带上 LUT',
    Math.abs(greyed[0] - greyed[1]) <= 3 / 255 && Math.abs(greyed[1] - greyed[2]) <= 3 / 255,
    `通道 ${greyed.map((c) => c.toFixed(3)).join(',')}`,
  );

  renderer.setLut(null);
  renderer.setAdjustments({ ...DEFAULT_ADJUSTMENTS });

  return checkEncoding(renderer, W, H);
}

/** 编码成真实文件再解码回来，验证导出产物是可用、方向正确的图片 */
async function checkEncoding(renderer: ImageRenderer, W: number, H: number): Promise<void> {
  const source = renderer.renderToImageData(W, H);

  for (const [format, expectedType] of [
    ['jpeg', 'image/jpeg'],
    ['webp', 'image/webp'],
    ['png', 'image/png'],
  ] as const) {
    try {
      const blob = await encodeImageData(source, format, 0.92);
      report(
        `导出编码为 ${format.toUpperCase()}`,
        blob.type === expectedType && blob.size > 0,
        `${blob.type} / ${blob.size} 字节`,
      );
    } catch (error) {
      report(`导出编码为 ${format.toUpperCase()}`, false, (error as Error).message);
    }
  }

  // PNG 无损，可以逐像素验方向
  try {
    const png = await encodeImageData(source, 'png', 1);
    const bitmap = await createImageBitmap(png);
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('无法创建解码画布');

    context.drawImage(bitmap, 0, 0);
    const decoded = context.getImageData(0, 0, bitmap.width, bitmap.height);

    report(
      '导出的 PNG 解码回原尺寸',
      bitmap.width === W && bitmap.height === H,
      `${bitmap.width}×${bitmap.height}`,
    );

    const top = imageDataPixel(decoded, 0);
    const bottom = imageDataPixel(decoded, W);
    report(
      '导出文件的方向正确（第一行仍是源图第一行）',
      maxChannelDiff(top, [1, 0, 0]) <= 2 / 255 && maxChannelDiff(bottom, [0, 0, 1]) <= 2 / 255,
      `上行 ${top.map((c) => c.toFixed(2)).join(',')} / 下行 ${bottom.map((c) => c.toFixed(2)).join(',')}`,
    );

    bitmap.close();
  } catch (error) {
    report('导出 PNG 往返', false, (error as Error).message);
  }
}

/** 造一张真实图片文件，走一遍「文件 → 解码 → 位图」的主路径 */
async function checkImageLoading(renderer: ImageRenderer): Promise<void> {
  const width = 8;
  const height = 4;

  const canvas = new OffscreenCanvas(width, height);
  const context = canvas.getContext('2d');
  if (!context) {
    report('ImageLoader 能解码真实图片文件', false, '无法创建画布');
    return;
  }
  context.fillStyle = '#ff0000';
  context.fillRect(0, 0, width, height);
  const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality: 0.95 });
  const file = new File([blob], 'sample.jpg', { type: 'image/jpeg' });

  const loader = new ImageLoader();
  try {
    const loaded = await loader.load({
      name: 'sample.jpg',
      path: 'sample.jpg',
      extension: 'jpg',
      isRaw: false,
      file,
    });

    report(
      'ImageLoader 能解码真实图片文件',
      loaded.width === width && loaded.height === height,
      `${loaded.width}×${loaded.height}`,
    );

    // 解出来的位图要能真的传进渲染器并画出来
    renderer.setLut(null);
    renderer.setAdjustments({ ...DEFAULT_ADJUSTMENTS });
    renderer.setViewport(width, height);
    renderer.setImage(loaded.bitmap, loaded.width, loaded.height);

    const rendered = renderer.renderToImageData(width, height);
    const corner = imageDataPixel(rendered, 0);
    report(
      'ImageLoader 的位图能正常渲染',
      maxChannelDiff(corner, [1, 0, 0]) <= 6 / 255,
      `左上角 ${corner.map((c) => c.toFixed(2)).join(',')}`,
    );

    loaded.bitmap.close();
  } catch (error) {
    report('ImageLoader 能解码真实图片文件', false, (error as Error).message);
  } finally {
    loader.dispose();
  }
}

void run();
