/**
 * 开发用的导出 EXIF 端到端验证脚本（不是产品代码，没有被任何入口引用）。
 *
 * 单测覆盖了读写两半，但覆盖不到这件事的关键一环：**浏览器编码器真正吐出来的字节**
 * 长什么样。canvas 的 JPEG 带不带 JFIF APP0、PNG 的 chunk 怎么排、我们插进去的段会不会
 * 顶掉它——只有在真浏览器里跑一遍才知道。而「导出的文件真的带上了原 EXIF」这句结论，
 * 最好也不要用自己写的解析器去证（读写两头一起错照样自洽）。
 *
 * 所以这里只负责**产出文件**，判定交给独立读者（Pillow，见
 * `scripts/verify-export-exif.mjs` 调用的那个 Python 脚本）。
 *
 * 跑法：
 *   node scripts/verify-export-exif.mjs
 * 它会起 vite、用 headless chrome 打开本页、把下面这些 base64 落盘，再交给 Pillow 判。
 * 结果在 dump 出来的 EXIF-CHECK-BEGIN / END 之间。
 */
import {
  collectRawExifSource,
  toExifFallback,
  type ExifFallback,
  type RawExifSource,
} from '../services/exif';
import { renderExport } from '../services/export';
import { createLibRawDecoder } from '../services/libraw-loader';
import { buildRawMetadata } from '../services/raw-metadata';
import type { RawMetadata } from '../services/raw-decoder.worker';
import type { ImageRenderer } from '../renderer/ImageRenderer';

const lines: string[] = [];
const files: Record<string, string> = {};
const sizes: Record<string, [number, number]> = {};
const results = document.getElementById('results')!;

function report(label: string, ok: boolean, detail = ''): void {
  lines.push(`${ok ? 'PASS' : 'FAIL'} ${label}${detail ? ` :: ${detail}` : ''}`);
}

async function toBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * 一个只提供像素的渲染器替身。
 *
 * 本次要验的是 EXIF 的读写与容器注入，不是 WebGL 渲染（那由 lut-check 与 ImageCanvas 的
 * 测试覆盖）。按目标尺寸现造一张平滑渐变：像素内容无所谓，但必须是**真的 ImageData**，
 * 否则 `encodeImageData` 里的 `putImageData` 会拒收；平滑渐变也让 PNG 压得小，
 * base64 不至于把回传的 JSON 撑爆。
 */
function makeRenderer(width: number, height: number): ImageRenderer {
  return {
    hasImage: () => true,
    getImageSize: () => ({ width, height }),
    renderToImageData: (targetWidth: number, targetHeight: number) => {
      const pixels = new Uint8ClampedArray(targetWidth * targetHeight * 4);
      const lastX = Math.max(1, targetWidth - 1);
      const lastY = Math.max(1, targetHeight - 1);
      for (let y = 0; y < targetHeight; y++) {
        for (let x = 0; x < targetWidth; x++) {
          const at = (y * targetWidth + x) * 4;
          pixels[at] = Math.round((x / lastX) * 255);
          pixels[at + 1] = Math.round((y / lastY) * 255);
          pixels[at + 2] = 128;
          pixels[at + 3] = 255;
        }
      }
      return new ImageData(pixels, targetWidth, targetHeight);
    },
  } as unknown as ImageRenderer;
}

/** 非 TIFF 容器（CR3 那类）走 LibRaw 字段兜底时用的字段 */
const FALLBACK_ONLY: ExifFallback = {
  make: 'Canon',
  model: 'EOS R5',
  software: 'Firmware 1.9.0',
  lensModel: 'RF24-70mm F2.8 L IS USM',
  lensMake: 'Canon',
  bodySerial: 'SN123456',
  iso: 400,
  shutter: 1 / 250,
  aperture: 2.8,
  focalLength: 35,
  focalLength35mm: 35,
  timestamp: new Date(2026, 9, 5, 13, 16, 28).getTime(),
};

/** 造一份「头不是 TIFF」的假 RAW，专门验兜底那条路 */
function makeNonTiffRaw(): Blob {
  const bytes = new Uint8Array(4096);
  bytes.set([0x00, 0x00, 0x00, 0x18], 0);
  bytes.set([0x66, 0x74, 0x79, 0x70], 4); // 'ftyp'，ISO-BMFF 的样子
  return new Blob([bytes], { type: 'image/x-canon-cr3' });
}

/**
 * 用真的 LibRaw 解一次样本的拍摄信息。
 *
 * 兜底那条路如果只喂手写的字面量，验的就只是「字面量能写进文件」，而不是「LibRaw 解出来的
 * 东西能写进文件」。这里走 `buildRawMetadata`——与产品路径**同一个**映射函数，所以它不会
 * 悄悄和 worker 漂开（这正是把映射抽出去的理由）。只 `unpack()`，不做 `dcrawProcess()`：
 * 要的是元数据，不是像素，省掉最慢的那一步。
 */
async function readRealMetadata(file: Blob): Promise<RawMetadata> {
  const decoder = await createLibRawDecoder();
  try {
    decoder.open(await file.arrayBuffer());
    decoder.unpack();

    return buildRawMetadata({
      params: decoder.getIParams(),
      other: decoder.getImgOther(),
      lens: decoder.getLensInfo(),
      shooting: decoder.getShootingInfo(),
      image: { width: 0, height: 0, colors: 0 },
    });
  } finally {
    decoder.dispose();
  }
}

async function exportOne(
  label: string,
  renderer: ImageRenderer,
  format: 'jpeg' | 'png',
  exif: RawExifSource | null,
  maxLongEdge: number | null,
): Promise<void> {
  const result = await renderExport(renderer, 'IMGP2971.DNG', {
    format,
    quality: 0.92,
    maxLongEdge,
    exif,
  });

  report(
    `${label} / ${format}：注入成功`,
    result.exifStatus === 'attached',
    `${result.exifStatus}，${result.width}×${result.height}`,
  );

  files[`${label}-${format}.${format === 'jpeg' ? 'jpg' : 'png'}`] = await toBase64(result.blob);
  sizes[label] = [result.width, result.height];
}

/**
 * 把结果交回给验证脚本。
 *
 * 为什么不靠 `--dump-dom`：那个依赖 `--virtual-time-budget` 在异步活儿干完之前别烧完，
 * 而 vite 的模块图是一串真实网络请求，虚拟时间提前跑光就会 dump 到一个还写着
 * 「running」的页面。改成页面主动 POST 回去，验证脚本有明确的可等待信号。
 *
 * 手动打开页面（没有 report 参数）时跳过，结果照样在 `<pre>` 里。
 */
async function deliver(payload: unknown): Promise<void> {
  const target = new URLSearchParams(location.search).get('report');
  if (!target) return;
  try {
    await fetch(target, {
      method: 'POST',
      // 简单请求：不触发预检，也就不必等对方回 CORS 头才能发出去
      mode: 'no-cors',
      headers: { 'Content-Type': 'text/plain' },
      body: JSON.stringify(payload),
    });
  } catch {
    // 交不回去也不要紧，DOM 里那份还在
  }
}

/** 页面只负责产出；判定交给 Pillow */
function finish(): void {
  const produced = { files: Object.keys(files), sizes };
  results.textContent = [
    'EXIF-CHECK-BEGIN',
    ...lines,
    `PRODUCED ${JSON.stringify(produced)}`,
    `FILES ${JSON.stringify(files)}`,
    'EXIF-CHECK-END',
  ].join('\n');

  void deliver({ lines, files, sizes });
}

async function run(): Promise<void> {
  const renderer = makeRenderer(1024, 683);

  // 1. 真实样本走容器 IFD 这条路
  const response = await fetch('samples/IMGP2971.DNG');
  const dng = await response.blob();
  report('取到样本 samples/IMGP2971.DNG', dng.size > 1_000_000, `${dng.size} 字节`);

  const fromContainer = await collectRawExifSource(dng, null);
  report(
    '容器头被认成 TIFF，整份读了进来',
    fromContainer.containerBytes instanceof Uint8Array,
    `${fromContainer.containerBytes?.length ?? 0} 字节`,
  );

  await exportOne('container', renderer, 'jpeg', fromContainer, null);
  await exportOne('container', renderer, 'png', fromContainer, null);
  // 缩过尺寸时像素绑定字段要跟着变，这一份专门给 Pillow 核对
  await exportOne('scaled', renderer, 'jpeg', fromContainer, 640);

  // 2. 非 TIFF 容器走 LibRaw 字段兜底。两份：手写字面量覆盖字段种类，
  //    真解出来的元数据证明这条链在真实数据上也走得通
  const cr3 = makeNonTiffRaw();
  const fromFallback = await collectRawExifSource(cr3, FALLBACK_ONLY);
  report('非 TIFF 容器不去读整份文件', fromFallback.containerBytes === null);
  await exportOne('fallback', renderer, 'jpeg', fromFallback, null);
  await exportOne('fallback', renderer, 'png', fromFallback, null);

  const realMetadata = await readRealMetadata(dng);
  report(
    '真 LibRaw 解出拍摄信息',
    realMetadata.make !== '' && realMetadata.iso > 0,
    `${realMetadata.make} ${realMetadata.model} / ISO ${realMetadata.iso} / ${realMetadata.software}`,
  );
  const fromRealMetadata = await collectRawExifSource(cr3, toExifFallback(realMetadata));
  await exportOne('realmeta', renderer, 'jpeg', fromRealMetadata, null);

  // 3. WebP 按 G1 不写 EXIF：字节数应当与不带 EXIF 时一模一样
  const webpWith = await renderExport(renderer, 'IMGP2971.DNG', {
    format: 'webp',
    quality: 0.92,
    maxLongEdge: null,
    exif: fromContainer,
  });
  const webpWithout = await renderExport(renderer, 'IMGP2971.DNG', {
    format: 'webp',
    quality: 0.92,
    maxLongEdge: null,
  });
  report(
    'WebP 不写 EXIF：与不带来源的字节数一致',
    webpWith.exifStatus === 'unsupported' && webpWith.blob.size === webpWithout.blob.size,
    `${webpWith.exifStatus}，${webpWith.blob.size} / ${webpWithout.blob.size} 字节`,
  );

  finish();
}

run().catch((error: unknown) => {
  lines.push(`FAIL 检查脚本自身出错 :: ${(error as Error).message}`);
  finish();
});
