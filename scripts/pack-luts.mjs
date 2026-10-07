#!/usr/bin/env node
/**
 * 把官方 3D LUT 预压缩成 .cube.gz，供随应用发布使用。
 *
 * 为什么要压缩：这 34 个 .cube 是纯文本，原始体积 216 MB（ARRI/富士的 65³ 单个
 * 7–9 MB）。整份进仓库会永久压住 clone 与每次 CI 检出，而浏览器每选中一个 LUT
 * 就要传 7–9 MB。gzip 之后约 48 MB，单次传输约 1.5 MB，而 65³ 的精度一点不丢。
 *
 * 用法：
 *   npm run lut:pack            只打包，已是最新（.gz 不比 .cube 旧）的跳过
 *   npm run lut:pack -- --force 全部重打
 *
 * 真值来自 src/lut/official-lut-sources.json（应用侧读同一份）：
 * - root    原始 .cube 所在的工作区目录
 * - dir     该目录下、相对 root 的子目录
 * - only    可选：文件名必须**全部**包含的子串，用来排掉工程没有对应显示管线的输出
 *           （例如 ARRI 的 P3 / HLG / St2084，只留 Gamma24 Rec.709）
 *
 * 打包完成后，映射目录里不再对应的 .cube.gz 会被删掉，避免改了 only 之后留下孤儿。
 */
import { existsSync, readdirSync, readFileSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { gzipSync } from 'node:zlib';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const configPath = join(repoRoot, 'src/lut/official-lut-sources.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
const force = process.argv.includes('--force');

/** 文件名是否满足 only 的全部子串（only 为空表示不筛） */
function matchesOnly(fileName, only) {
  return !Array.isArray(only) || only.length === 0 || only.every((token) => fileName.includes(token));
}

/** gzip 之后仍然叫 .cube.gz，压缩级别拉满（这是一次性脚本，省下的体积是永久的） */
function pack(filePath) {
  return gzipSync(readFileSync(filePath), { level: 9 });
}

const keep = new Set();
let packed = 0;
let skipped = 0;
let packedBytes = 0;

for (const source of config.sources) {
  const dir = join(repoRoot, config.root, source.dir);
  if (!existsSync(dir)) {
    console.warn(`跳过 ${source.dir}：目录不存在（${dir}）`);
    continue;
  }

  const names = readdirSync(dir)
    .filter((name) => name.toLowerCase().endsWith('.cube'))
    .filter((name) => matchesOnly(name, source.only));
  if (names.length === 0) {
    console.warn(`跳过 ${source.dir}：没有通过筛选的 .cube`);
    continue;
  }

  let dirBytes = 0;
  let dirPacked = 0;
  for (const name of names) {
    const sourcePath = join(dir, name);
    const targetPath = `${sourcePath}.gz`;
    keep.add(targetPath);

    const upToDate =
      !force && existsSync(targetPath) && statSync(targetPath).mtimeMs >= statSync(sourcePath).mtimeMs;
    if (upToDate) {
      skipped += 1;
    } else {
      writeFileSync(targetPath, pack(sourcePath));
      packed += 1;
      dirPacked += 1;
    }
    dirBytes += statSync(targetPath).size;
  }

  packedBytes += dirBytes;
  console.log(
    `${source.dir}：${names.length} 个（新打 ${dirPacked}）→ ${(dirBytes / 1024 / 1024).toFixed(1)} MB`,
  );
}

// 清掉映射目录里不再需要的 .cube.gz（改了 only 或删了源文件之后）
let removed = 0;
for (const source of config.sources) {
  const dir = join(repoRoot, config.root, source.dir);
  if (!existsSync(dir)) continue;
  for (const name of readdirSync(dir).filter((name) => name.toLowerCase().endsWith('.cube.gz'))) {
    const targetPath = join(dir, name);
    if (!keep.has(targetPath)) {
      unlinkSync(targetPath);
      removed += 1;
    }
  }
}

console.log(
  `完成：新打 ${packed} 个、跳过 ${skipped} 个、清理 ${removed} 个，` +
    `.cube.gz 合计 ${(packedBytes / 1024 / 1024).toFixed(1)} MB`,
);
