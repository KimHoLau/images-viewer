/**
 * 开发用的官方 LUT 验证脚本（不是产品代码，没有被任何入口引用）。
 *
 * 单测能在 jsdom 里覆盖「gzip 字节」与「明文」两条解析路径，但覆盖不了真实服务器与真实 GPU：
 *
 *   1. `.gz` 静态资源在 Vite dev（实测）与 GitHub Pages 上都会带 `Content-Encoding: gzip`，
 *      浏览器早在 fetch 那一层就替我们解了压；换个服务器又可能把 gzip 字节原样发出来。
 *   2. 清单是构建期 `import.meta.glob` 扫出来的，URL 在 dev 与 build 下都要取得到文件。
 *   3. 65³ 的官方 LUT（823875 个数值）在真实 GPU 上要能上传、要真的改变画面，并且与 CPU
 *      镜像算出来的一致——`ImageCanvas` 会把 `setLut` 的异常吞掉并退回「不套 LUT」，
 *      静默失效在单测里看不出来。
 *
 * 跑法：
 *   npx vite --port 5211
 *   chrome --headless=new --enable-unsafe-swiftshader --virtual-time-budget=60000 \
 *     --dump-dom http://localhost:5211/lut-check.html
 * 结果在 dump 出来的 LUT-CHECK-BEGIN / END 之间。
 */
import { LOG_SPACES, logSpaceIndex } from '../color/log-spaces';
import { loadOfficialLut, officialLutEntries, type OfficialLutEntry } from '../lut/official-luts';
import sourceTable from '../lut/official-lut-sources.json';
import { ImageRenderer } from '../renderer/ImageRenderer';
import { applyAdjustments, type Rgb } from '../renderer/adjustments-math';
import { DEFAULT_ADJUSTMENTS } from '../types/adjustments';

const lines: string[] = [];
const results = document.getElementById('results')!;

function report(label: string, ok: boolean, detail = ''): void {
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` :: ${detail}` : ''}`);
  results.textContent = `LUT-CHECK-BEGIN\n${lines.join('\n')}\nLUT-CHECK-END`;
}

const mapped = new Set(sourceTable.sources.map((source) => source.logSpaceId));

/** 测试像素：暗部、中灰、饱和色、纯白 */
const TEST_PIXELS: Rgb[] = [
  [0, 0, 0],
  [0.18, 0.18, 0.18],
  [0.5, 0.5, 0.5],
  [0.9, 0.3, 0.1],
  [0.1, 0.6, 0.85],
  [1, 1, 1],
];

/** 逐个色彩空间列清单、各取第一个真解出来 */
async function checkListing(): Promise<Map<string, OfficialLutEntry>> {
  const firstEntry = new Map<string, OfficialLutEntry>();

  for (const space of LOG_SPACES) {
    const entries = officialLutEntries(space.id);
    const shouldHaveEntries = mapped.has(space.id);

    report(
      `清单：${space.name}`,
      (entries.length > 0) === shouldHaveEntries,
      `${entries.length} 个${shouldHaveEntries ? '（应有）' : '（应为空）'}`,
    );

    if (entries.length === 0) continue;
    firstEntry.set(space.id, entries[0]);

    try {
      const entry = entries[0];
      const lut = await loadOfficialLut(entry);
      report(
        `载入：${space.name} / ${entry.name}`,
        lut.size >= 2 && lut.data.length === lut.size ** 3 * 3,
        `size=${lut.size} 数据=${lut.data.length}`,
      );
    } catch (error) {
      report(`载入：${space.name}`, false, (error as Error).message);
    }
  }

  // 换一个色彩空间就该换一份清单：F-Log 与 F-Log2 的文件名不是同一批
  const flog = officialLutEntries('f-log').map((entry) => entry.name);
  const flog2 = officialLutEntries('f-log2').map((entry) => entry.name);
  report(
    '换色彩空间换一份清单',
    flog.length > 0 && flog2.length > 0 && flog.every((name) => !flog2.includes(name)),
    `F-Log ${flog.length} 个 / F-Log2 ${flog2.length} 个`,
  );

  return firstEntry;
}

/**
 * 把每个色彩空间的第一个官方 LUT 真的套到画面上去。
 *
 * 判据是「GPU 输出 == CPU 镜像」加上「套与不套确实不同」：前者抓采样/上传出错，
 * 后者抓 `setLut` 被静默吞掉（那时 GPU 输出会等于不套 LUT 的结果，但仍然是"对得上 CPU"的）。
 */
async function checkGpu(firstEntry: Map<string, OfficialLutEntry>): Promise<void> {
  const W = TEST_PIXELS.length;
  const H = 1;

  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;

  let renderer: ImageRenderer;
  try {
    renderer = new ImageRenderer(canvas);
  } catch (error) {
    report('GPU：着色器编译与链接', false, (error as Error).message);
    return;
  }

  const gl = renderer.context;
  const read = (): Uint8ClampedArray => {
    const pixels = new Uint8ClampedArray(W * H * 4);
    gl.readPixels(0, 0, W, H, gl.RGBA, gl.UNSIGNED_BYTE, pixels);
    return pixels;
  };
  const channelDiff = (a: Uint8ClampedArray, b: Uint8ClampedArray): number => {
    let worst = 0;
    for (let index = 0; index < a.length; index++) {
      worst = Math.max(worst, Math.abs(a[index] - b[index]));
    }
    return worst;
  };

  // Log 模式的 RAW 解码输出是浮点线性：这里直接喂 RGB16F 纹理
  const linear = new Float32Array(W * H * 3);
  TEST_PIXELS.forEach((rgb, index) => {
    linear[index * 3] = rgb[0];
    linear[index * 3 + 1] = rgb[1];
    linear[index * 3 + 2] = rgb[2];
  });

  renderer.setViewport(W, H);
  renderer.setLinearImage(linear, W, H);
  renderer.setAdjustments({ ...DEFAULT_ADJUSTMENTS });
  report('GPU：ProPhoto linear 浮点纹理能上传', renderer.isInputLinear(), 'RGB16F');

  for (const [logSpaceId, entry] of firstEntry) {
    const index = logSpaceIndex(logSpaceId);
    const space = LOG_SPACES[index];

    try {
      const lut = await loadOfficialLut(entry);

      renderer.setLogMode(true, index, index, false);
      renderer.setLut(lut);
      renderer.render();
      const withLut = read();

      let worst = 0;
      TEST_PIXELS.forEach((source, at) => {
        const expected = applyAdjustments(source, { ...DEFAULT_ADJUSTMENTS }, lut, {
          inputLinear: true,
          logMode: true,
          logCurveId: index,
          logMatrixId: index,
          lutOutputEncoded: false,
        });
        for (let channel = 0; channel < 3; channel++) {
          worst = Math.max(worst, Math.abs(withLut[at * 4 + channel] / 255 - expected[channel]));
        }
      });
      report(
        `GPU：官方 LUT 与 CPU 一致（${space.name} / ${entry.name}）`,
        worst <= 6 / 255,
        `最大偏差 ${(worst * 255).toFixed(1)}/255`,
      );

      renderer.setLut(null);
      renderer.render();
      const withoutLut = read();
      const changed = channelDiff(withLut, withoutLut);
      report(
        `GPU：套上官方 LUT 后画面确实变了（${space.name}）`,
        changed > 8,
        `最大通道差 ${changed}/255`,
      );
    } catch (error) {
      report(`GPU：官方 LUT 生效（${space.name}）`, false, (error as Error).message);
    }
  }

  const error = gl.getError();
  report(
    'GPU：取官方 LUT 与上传 65³ 纹理都没有 GL 错误',
    error === gl.NO_ERROR,
    error === gl.NO_ERROR ? 'NO_ERROR' : `0x${error.toString(16)}`,
  );

  renderer.dispose();
}

async function run(): Promise<void> {
  const firstEntry = await checkListing();
  await checkGpu(firstEntry);
}

void run();
