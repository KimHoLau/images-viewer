// 桌面外壳的主进程。只有一个文件，不写 preload、不引 IPC：
// 自定义协议与一切文件访问都留在这一层，渲染进程拿不到任何 Node 能力。
//
// 配方来自 docs/spec-windows-installer.md 第 4.1 节（壳内实测通过的那一段）。
// 改这个文件就要重跑 spec 第 9.3 节的验收清单。
const { app, protocol, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');

// 必须在 app ready 之前注册。
// standard: 让 app://bundle/ 成为有 origin 的安全上下文（IndexedDB / File System Access 都靠它）
// secure: isSecureContext = true
// supportFetchAPI: 渲染进程的 fetch(entry.url) 才走得通
// stream: 与实测通过的配方逐字一致（官方定义里它只关乎 <video>/<audio>）
protocol.registerSchemesAsPrivileged([
  {
    scheme: 'app',
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true },
  },
]);

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.wasm': 'application/wasm',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  // .gz 必须显式当二进制给：不能让协议层把它当成「预压缩的那一层」
  '.gz': 'application/octet-stream',
  '.cube': 'application/octet-stream',
};

async function handleAppRequest(request) {
  const { pathname } = new URL(request.url);
  let decoded;
  try {
    decoded = decodeURIComponent(pathname); // 中文路径在这一层还原
  } catch {
    return new Response('bad path', { status: 400 });
  }
  const rel = decoded.replace(/^\/+/, '') || 'index.html';
  const full = path.resolve(DIST, rel);
  // 目录穿越防护：解析后的绝对路径必须仍在 DIST 内
  if (full !== DIST && !full.startsWith(DIST + path.sep)) {
    return new Response('forbidden', { status: 403 });
  }
  let bytes;
  try {
    bytes = await fs.promises.readFile(full);
  } catch {
    return new Response('not found', { status: 404 });
  }
  return new Response(bytes, {
    status: 200,
    headers: {
      'content-type': MIME[path.extname(full).toLowerCase()] ?? 'application/octet-stream',
      'content-length': String(bytes.byteLength),
      'cache-control': 'no-store',
    },
  });
}

app.whenReady().then(() => {
  protocol.handle('app', handleAppRequest);
  const win = new BrowserWindow({
    width: 1280,
    height: 900,
    show: false,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  win.once('ready-to-show', () => win.show());
  win.loadURL('app://bundle/index.html');
});

app.on('window-all-closed', () => app.quit());
