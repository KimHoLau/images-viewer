import type { LogSpaceId } from '../color/log-spaces';
import { parseCubeLut } from './parse-cube';
import type { Lut3D } from './types';
import sourceTableJson from './official-lut-sources.json';

/**
 * 官方 LUT：按色彩空间取工作区里 `3DLUT/` 下某个目录的内容。
 *
 * 厂商的官方 LUT 是 65³ 的纯文本 `.cube`，单个 7–9 MB，整份 216 MB——直接进仓库
 * 会永久压住 clone 与每次 CI 检出，浏览器每选一个也要传 7–9 MB。所以仓库里放的是
 * `npm run lut:pack` 压出来的 `.cube.gz`（约 48 MB），选中某一个时才 fetch + 解压 + 解析。
 *
 * 清单不走运行时请求：`import.meta.glob` 在构建期把目录扫成 URL 表，dev 与 build
 * 用同一份静态清单，"清单里列了但文件不在"这种状态不存在。
 */
interface OfficialLutSourceConfig {
  logSpaceId: string;
  /** 相对 `root` 的子目录 */
  dir: string;
  /** 文件名必须全部包含的子串；排掉工程没有对应显示管线的输出 */
  only?: string[];
}

const sourceTable = sourceTableJson as {
  root: string;
  sources: OfficialLutSourceConfig[];
};

/**
 * 构建期的目录快照。这个字面量里的 `3DLUT` 必须与 JSON 的 `root` 一致
 * （glob 的模式只能是字面量）——`official-luts.test.ts` 会核对这两处。
 */
const LUT_URLS: Record<string, string> = import.meta.glob('/3DLUT/**/*.cube.gz', {
  eager: true,
  query: '?url',
  import: 'default',
});

export interface OfficialLutEntry {
  /** 稳定键：相对 `3DLUT/` 的路径（含 `.cube.gz`） */
  key: string;
  /** 展示名：文件名去掉 `.cube.gz` */
  name: string;
  /** 静态资源 URL，构建期已带上 base 前缀与内容哈希 */
  url: string;
}

/** 路径里的文件名 */
function baseName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1);
}

/** 文件名是否满足 `only` 的全部子串；`only` 为空表示不筛 */
export function matchesOfficialFilter(fileName: string, only?: readonly string[]): boolean {
  return !only || only.length === 0 || only.every((token) => fileName.includes(token));
}

/**
 * 从「路径 → URL」表里挑出某个色彩空间的条目，按展示名排序。
 *
 * 拆成纯函数是为了能在测试里塞一张假的 URL 表，不必依赖 3DLUT/ 目录的真实内容。
 */
export function selectOfficialLutEntries(
  urls: Record<string, string>,
  logSpaceId: LogSpaceId | null,
): OfficialLutEntry[] {
  if (!logSpaceId) return [];
  const source = sourceTable.sources.find((item) => item.logSpaceId === logSpaceId);
  if (!source) return [];

  const prefix = `/${sourceTable.root}/${source.dir}/`;
  const rootPrefix = `/${sourceTable.root}/`;
  return Object.entries(urls)
    .filter(([path]) => path.startsWith(prefix))
    // 筛选用的是 `xxx.cube`，与打包脚本看到的是同一个名字
    .map(([path, url]) => ({ path, fileName: baseName(path).replace(/\.gz$/i, ''), url }))
    .filter(({ fileName }) => matchesOfficialFilter(fileName, source.only))
    .map(({ path, fileName, url }) => ({
      key: path.slice(rootPrefix.length),
      name: fileName.replace(/\.cube$/i, ''),
      url,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

/** 当前色彩空间对应的官方 LUT 条目；没有映射或目录为空时是空数组 */
export function officialLutEntries(logSpaceId: LogSpaceId | null): OfficialLutEntry[] {
  return selectOfficialLutEntries(LUT_URLS, logSpaceId);
}

const lutCache = new Map<string, Lut3D>();

/**
 * gzip 魔数。
 *
 * `.cube.gz` 直接当成静态资源取时，服务器有可能认为它是"预压缩版本"而顺手解掉
 * （`Content-Encoding: gzip`），此时 fetch 拿到的已经是明文。两种都吃下去，
 * 加载器就不必猜服务器的心情。
 */
function isGzip(bytes: Uint8Array): boolean {
  return bytes.length >= 2 && bytes[0] === 0x1f && bytes[1] === 0x8b;
}

/** 把一段 gzip 字节解成文本；只依赖 DecompressionStream，不经过 Blob / Response */
async function gunzip(bytes: Uint8Array): Promise<string> {
  if (typeof DecompressionStream === 'undefined') {
    throw new Error('这个浏览器不支持 DecompressionStream，无法解压 .cube.gz');
  }

  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  // 边写边读：7 MB 的文件写不进管道缓冲，等着 write 完成会和读端互相等死
  const written = writer.write(bytes).then(() => writer.close());

  const reader = stream.readable.getReader();
  const decoder = new TextDecoder();
  let text = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    text += decoder.decode(value, { stream: true });
  }
  await written;
  return text + decoder.decode();
}

async function responseText(response: Response): Promise<string> {
  const bytes = new Uint8Array(await response.arrayBuffer());
  return isGzip(bytes) ? gunzip(bytes) : new TextDecoder().decode(bytes);
}

/** 载入一个官方 LUT：fetch →（必要时）解压 → 解析。结果按 key 缓存，来回切不会重解析 */
export async function loadOfficialLut(entry: OfficialLutEntry): Promise<Lut3D> {
  const cached = lutCache.get(entry.key);
  if (cached) return cached;

  const response = await fetch(entry.url);
  if (!response.ok) throw new Error(`HTTP ${response.status}`);

  const parsed = parseCubeLut(await responseText(response));
  const lut: Lut3D = { size: parsed.size, data: parsed.data, title: parsed.title };
  lutCache.set(entry.key, lut);
  return lut;
}

/** 测试用：清掉官方 LUT 的解析缓存 */
export function clearOfficialLutCache(): void {
  lutCache.clear();
}
