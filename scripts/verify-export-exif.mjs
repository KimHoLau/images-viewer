#!/usr/bin/env node
/**
 * 导出 EXIF 的端到端验证（#35）：真实样本 → 真实浏览器编码 → 独立读者核对。
 *
 * 这条链子分三段，缺一段结论就不硬：
 *
 * 1. **产出**在真浏览器里做（`src/dev/exif-check.ts` + `exif-check.html`）：canvas 编码器
 *    真正吐出来的 JPEG / PNG 长什么样，只有在浏览器里跑才知道。
 * 2. **判定**交给 Pillow（`scripts/verify-export-exif.py`）：用我们自己的解析器验自己写的
 *    字节是循环论证，换一份实现读得到才算数。
 * 3. **串起来**是这个脚本：起 vite、起一个收结果的本地服务、让 headless chrome 打开检查页，
 *    等页面把产物 POST 回来，再叫 Python。
 *
 * 为什么不 dump DOM：`--dump-dom` 靠 `--virtual-time-budget` 在异步活儿干完前别烧完，
 * 而 vite 的模块图是一串真实网络请求，虚拟时间提前跑光就会拿到一个还写着「running」的
 * 页面（第一次就是这么失败的）。页面主动 POST 才有明确的等待信号。
 *
 * 用法：
 *   node scripts/verify-export-exif.mjs
 *   node scripts/verify-export-exif.mjs --keep   # 保留产物，方便自己用看图软件打开
 *
 * 产物默认落在 samples/exif-export-check/（已被 .gitignore 排除）。
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(repoRoot, 'samples/exif-export-check');
const vitePort = 5213;
const reportPort = 5214;
const reportUrl = `http://localhost:${reportPort}/result`;
const checkUrl = `http://localhost:${vitePort}/exif-check.html?report=${encodeURIComponent(reportUrl)}`;
const keep = process.argv.includes('--keep');
const overallTimeoutMs = 5 * 60_000;

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
].filter(Boolean);

function findBrowser() {
  const found = CHROME_CANDIDATES.find((candidate) => existsSync(candidate));
  if (!found) {
    throw new Error(
      `找不到 Chrome/Edge，可用 CHROME_PATH 指定。找过：${CHROME_CANDIDATES.join(', ')}`,
    );
  }
  return found;
}

function run(command, args, options = {}) {
  return new Promise((resolvePromise, rejectPromise) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'], ...options });
    let stdout = '';
    let stderr = '';
    child.stdout?.on('data', (chunk) => (stdout += chunk));
    child.stderr?.on('data', (chunk) => (stderr += chunk));
    child.on('error', rejectPromise);
    child.on('close', (code) => resolvePromise({ code, stdout, stderr }));
  });
}

/** 等 vite 起来；轮询到 HTTP 有响应为止 */
async function waitForServer(url, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {
      // 还没起来
    }
    await new Promise((done) => setTimeout(done, 400));
  }
  throw new Error(`vite 没能在 ${timeoutMs} ms 内起来：${url}`);
}

/** 收页面 POST 回来的结果 */
function startReportServer() {
  let settle;
  const received = new Promise((resolvePromise) => {
    settle = resolvePromise;
  });

  const server = createServer((request, response) => {
    const headers = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
    };
    if (request.method === 'OPTIONS') {
      response.writeHead(204, headers).end();
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(404, headers).end();
      return;
    }

    let body = '';
    request.on('data', (chunk) => (body += chunk));
    request.on('end', () => {
      response.writeHead(200, { ...headers, 'Content-Type': 'text/plain' }).end('ok');
      try {
        settle({ payload: JSON.parse(body) });
      } catch (error) {
        settle({ error: `页面交回来的不是 JSON：${error.message}` });
      }
    });
  });

  return new Promise((resolvePromise) => {
    server.listen(reportPort, () => resolvePromise({ server, received }));
  });
}

async function main() {
  const browser = findBrowser();
  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(outDir, { recursive: true });

  console.log('起 vite…');
  // 直接跑 vite 的入口而不是 npx：npx 是 .cmd，Windows 上得开 shell，而带参数的 shell
  // 会触发 Node 的 DEP0190（PowerShell 又把 stderr 当成错误，退出码看着像失败）
  const vite = spawn(
    process.execPath,
    [join(repoRoot, 'node_modules/vite/bin/vite.js'), '--port', String(vitePort), '--strictPort'],
    { cwd: repoRoot, stdio: ['ignore', 'pipe', 'pipe'] },
  );

  const { server, received } = await startReportServer();
  const profileDir = mkdtempSync(join(tmpdir(), 'exif-check-profile-'));
  // headless=new 没有 dump/screenshot 这类「干完就退」的任务时，靠远程调试端口把自己留住
  const chrome = spawn(
    browser,
    [
      '--headless=new',
      '--disable-gpu',
      '--no-sandbox',
      '--no-first-run',
      '--no-default-browser-check',
      `--user-data-dir=${profileDir}`,
      '--remote-debugging-port=0',
      checkUrl,
    ],
    { stdio: ['ignore', 'pipe', 'pipe'] },
  );

  try {
    await waitForServer(`http://localhost:${vitePort}/exif-check.html`);
    console.log(`已打开检查页，等它把产物交回来…\n${checkUrl}\n`);

    const outcome = await Promise.race([
      received,
      new Promise((resolvePromise) =>
        setTimeout(
          () => resolvePromise({ error: `等了 ${overallTimeoutMs} ms 页面还没交回结果` }),
          overallTimeoutMs,
        ),
      ),
    ]);

    if (outcome.error) {
      console.error(outcome.error);
      return 1;
    }

    const { lines, files, sizes } = outcome.payload;
    for (const [name, base64] of Object.entries(files)) {
      writeFileSync(join(outDir, name), Buffer.from(base64, 'base64'));
    }
    writeFileSync(
      join(outDir, 'produced.json'),
      JSON.stringify({ files: Object.keys(files), sizes }, null, 2),
      'utf8',
    );
    console.log(`产物落在 ${outDir}：${Object.keys(files).join(', ')}\n`);

    console.log('--- 页面自查（真浏览器里的编码与注入）---');
    for (const line of lines) console.log(line);

    console.log('\n--- Pillow 独立核对（另一份 EXIF 实现）---');
    const python = await run('python', [join(repoRoot, 'scripts/verify-export-exif.py'), outDir], {
      cwd: repoRoot,
      // Windows 上 Python 默认按 ANSI 码页写 stdout，中文会变成乱码
      env: { ...process.env, PYTHONIOENCODING: 'utf-8' },
    });
    process.stdout.write(python.stdout);
    process.stderr.write(python.stderr);

    const pageFailed = lines.some((line) => line.startsWith('FAIL'));
    return pageFailed || python.code !== 0 ? 1 : 0;
  } finally {
    chrome.kill();
    vite.kill();
    server.close();
    // Chrome 释放 profile 目录要一会儿，清不掉也不算失败
    try {
      rmSync(profileDir, { recursive: true, force: true });
    } catch {
      // 留给系统的临时目录清理
    }
    if (!keep) rmSync(outDir, { recursive: true, force: true });
  }
}

const code = await main();
if (code !== 0) console.error('\n端到端验证失败');
process.exit(code);
