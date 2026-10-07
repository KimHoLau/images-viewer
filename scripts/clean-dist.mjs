// 打包前的清理：跨 shell 的 rm -rf dist。
//
// 必须在新一轮构建之前跑：实测撞到过 dist/ 里同时躺着两轮构建的产物，
// 而只看文件列表看不出哪一份是新的（见 docs/spec-windows-installer.md 3.3）。
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const target = path.join(root, 'dist');

await rm(target, { recursive: true, force: true });
console.log(`cleaned ${target}`);
