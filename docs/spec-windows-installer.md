# Windows 安装包 spec —— raw-images-studio 桌面版（Electron 壳）

> **状态**：已定稿（2026-10-07）。本文件是这张地图的**目的地**：实现者照着它做即可，不需要再做任何决定。
> **范围**：只讲「怎么把现有的纯前端应用装进一个 Windows 安装包」。产品行为与网页版一致，不改 `src/`。
>
> 上游依据：
> [ADR 0001 · Windows 桌面外壳选 Electron](adr/0001-windows-desktop-shell.md) ·
> [研究 · 壳内关键路径 spike](../research/electron-shell-spike.md) ·
> [研究 · electron-builder 发版事实](../research/electron-builder-release-facts.md) ·
> [研究 · 桌面外壳候选事实](../research/desktop-shell-facts.md)

## 0. 一页版：落地清单

| 文件 | 动作 | 要点 |
| --- | --- | --- |
| `electron/main.cjs` | **新增** | 主进程：注册 `app://`（privileges + `protocol.handle`）、单窗口、`contextIsolation: true` + `sandbox: true`、**不写 preload、不引 IPC** |
| `scripts/clean-dist.mjs` | **新增** | 跨 shell 的 `rm -rf dist`，打包前置 |
| `vite.config.ts` | 改 | `base` 增加桌面分支：`--mode desktop` → `'/'`；Pages 行为一个字不动 |
| `package.json` | 改 | 补 `description` / `author` / `productName` / `main`；加 `electron` + `electron-builder` 到 devDependencies；加 `build` 字段与三个 scripts |
| `.github/workflows/release-windows.yml` | **新增** | tag 触发，出 NSIS + 便携 zip，附校验和，建 **draft** Release。`deploy.yml` 不动 |
| `.github/release-notes-template.md` | **新增** | Release 正文模板（第 7 节） |
| `README.md` | 改 | 加「Windows 桌面版」一小节，指向 Releases 并写明「未签名」 |
| `build/icon.ico` | **v1 不建** | v1 用 Electron 默认图标；日后要图标就放这里（≥ 256×256）。同理 v1 不建 `build/installer.nsh` |

不改动：`src/**`、`3DLUT/**`、`index.html`、`.github/workflows/deploy.yml`。

## 1. 交付形态与范围

### 1.1 交付物

- **NSIS 安装版**：`raw-images-studio-<version>-win-x64-setup.exe`，per-user 安装，带向导。
- **便携 zip**：`raw-images-studio-<version>-win-x64-portable.zip`，解压即用。
- 两个产物 + `SHA256SUMS.txt` 挂在 GitHub Releases 上，由 `v*` tag 触发的 CI 产出。

### 1.2 明确不做（out of scope）

- **代码签名**：不做，接受 SmartScreen「未知发布者」。见第 8 节。
- **自动更新**：v1 手动下新版。因此 **不引 electron-updater**，也因此 `nsis.differentialPackage: false`。
- **桌面专属特性**：文件关联、应用菜单、最近打开、系统托盘、自定义下载行为——全部不做。
- **macOS / Linux 产物**：本次只出 Windows，但选型与配置不堵死日后（换 target 即可）。
- **ARM64 与 32 位 Windows**：只出 x64。
- **CSP**：v1 不设，理由见 4.3。
- **自定义应用图标**：v1 用 Electron 默认图标。

### 1.3 已锁定的决定（一览）

| 决定 | 取值 | 出处 |
| --- | --- | --- |
| 外壳 | Electron | ADR 0001 |
| Electron 版本 | **精确锁 `44.6.0`**（不带 `^`） | 本文 2.3 |
| 资源协议 | `app://` + `protocol.registerSchemesAsPrivileged` + **`protocol.handle`** | 本文 4.1 |
| Vite `base` | 桌面 `'/'`；Pages 仍 `'/raw-images-studio/'` | 本文 3.2 |
| 48.2 MB LUT | `.cube.gz` 原样进包，**留在 asar 里，不解包** | 本文 4.2 |
| 安装模式 | NSIS，`oneClick: false` + `perMachine: false`（per-user） | 本文 5.1 |
| 便携形态 | `zip` target（不是 `portable` 单文件 exe） | 本文 5.2 |
| 版本号 | `package.json` 的 `version` 是唯一真相，tag 必须等于 `v<version>` | 本文 5.3 |
| 校验和 | CI 生成 `SHA256SUMS.txt` | 本文 7.3 |
| 发布 | `--publish never` 出包，构建后手动建 **draft** 并上传 | 本文 6.3 |
| 卸载 | 保留用户数据（`deleteAppDataOnUninstall: false`） | 本文 5.4 |

## 2. 外壳与运行时前提

### 2.1 为什么是 Electron

决定性的一条是资源加载：官方 LUT 走 `import.meta.glob('/3DLUT/**/*.cube.gz', { query: '?url' })`（[`official-luts.ts`](../src/lut/official-luts.ts)）在构建期扫成 URL 表，运行时 `fetch(entry.url)` + `DecompressionStream` 解压。Electron 能把这道关变成**确定行为**：官方 privileged scheme + `protocol.handle`，而这套 privileges 同时把 IndexedDB 与 File System Access 从「非 standard scheme 默认禁用」里救回来。Tauri 的两条主打优势（体积、省事的 origin）在「完全离线 + 48 MB 全量随包 + 只做壳」下都不成立。完整取舍见 ADR 0001。

### 2.2 渲染进程的能力边界（不可放宽）

`contextIsolation: true`、`sandbox: true`、**不写 preload、不引 IPC**。自定义协议与一切文件访问都留在主进程。「桌面专属特性」被划到本 effort 之外，正是这条的自然结果。

### 2.3 目标平台与版本策略

- 目标：**Windows x64**，Win10 1809+ / Win11。
- **Electron 钉精确版本 `44.6.0`**（`"electron": "44.6.0"`，不带 `^`）。
- 升级由维护者手动发起，触发条件是「Chromium 安全更新」或「需要新能力」。升级前**必须**重跑第 9.3 节的验收清单与本文 2.4 的 5 项关键能力——本项目吃的全是浏览器边角能力，这件事不能靠 `npm update`。

### 2.4 依赖的浏览器能力与证据等级

下表全部是**壳内实测**（Electron 44.6.0 / Chromium 152 / Windows，`app://bundle`，2026-10-07）。原始证据：抛弃式分支 `spike/issue-41-electron-shell` 上的 `spike/electron-shell/out/selftest.json`（**main 上不含这个文件**）；判定表与坑清单已回填到 [`research/electron-shell-spike.md`](../research/electron-shell-spike.md)。

| 能力 | 判定 | 实测 |
| --- | --- | --- |
| 自定义 scheme 下的安全上下文 | 成立 | `app://bundle/`，`isSecureContext: true` |
| `fetch` 三种路径形态（相对 / 根绝对 / 写死完整） | 全通 | 各取到 2,911,296 B → 解压 9,062,640 字符，`LUT_3D_SIZE 65` |
| 中文路径取数 | 通 | 3,376,735 B → 解压出 `LUT_3D_SIZE 65` |
| `DecompressionStream` | 通 | 压缩→解压往返自测通过 |
| `Content-Encoding` 双重解压陷阱 | 协议层**不**解这一层，`isGzip()` 兜底吃得住 | 声明 2,911,296 / 实收 2,911,296 |
| ES module Worker | 通 | worker 内静态 import 解析成功 |
| LibRaw `.wasm` | 通 | 853,083 B，魔数正确，需 `["a"]` 提供 **43 条 import** |
| RAW 解码（中文目录 + 中文文件名） | 通 | 2468×1636，Pentax K-30，705 ms，`rgba8` |
| WebGL2 | 通 | ANGLE（AMD Radeon / D3D11），`MAX_TEXTURE_SIZE 16384`，`EXT_color_buffer_float` 有 |
| `RGB16F` / `RGBA16F` 纹理 | 通 | 可创建可上传，Log 路径的浮点中间产物成立 |
| IndexedDB | 通 | 开库 / 写 / 读全通（缩略图缓存这条路） |
| 导出下载 | 触发成功 | `<a download="导出测试-中文名-1024x768.jpg">`，1210 B（**落到哪要人看**，见 9.5） |

**证据环境的一条限制**：以上全部在 `--no-sandbox` 下采集——本会话的进程令牌建不出 Chromium 的 OS 级沙箱（不加就以 `0x80000003` 退出）。16 项里只有 `showDirectoryPicker` 一项可能受它影响，而那一项本来就被自动跑跳过（要真人点）。真机正常启动不受此限。

## 3. 单一代码库、两个出口

### 3.1 目录

```
electron/main.cjs        壳（主进程）。只有这一个文件，不写 preload
scripts/clean-dist.mjs   打包前的清理
dist/                    Vite 产物（Web 与桌面共用同一份源码的两个出口）
release/                 electron-builder 产物（安装包 / zip / win-unpacked）
```

`src/` 一个字不改。Web 与桌面共用同一份 `src/`，只是两个打包出口，**不许 fork**。

### 3.2 `base` 与构建脚本

`vite.config.ts` 改成按 mode 分支（用 `--mode` 而不是环境变量，跨 shell 才不用 `cross-env`）：

```ts
export default defineConfig(({ mode }) => {
  // 桌面版走 app:// 自定义协议，必须是根绝对路径；
  // GitHub Pages 的项目页地址带仓库名前缀，两者互斥。
  const base = mode === 'desktop' ? '/' : process.env.GITHUB_ACTIONS ? '/raw-images-studio/' : '/';
  return {
    base,
    plugins: [react(), wasm(), topLevelAwait()],
    // …其余原样不动
  };
});
```

`package.json` 的 scripts：

```json
{
  "clean:dist": "node scripts/clean-dist.mjs",
  "build": "tsc -b && vite build",
  "build:desktop": "npm run clean:dist && tsc -b && vite build --mode desktop",
  "pack:win": "npm run build:desktop && electron-builder --win --x64 --publish never"
}
```

**`npm run lut:pack` 不是桌面打包的前置步骤。** 34 个 `.cube.gz` 是**已提交的构建产物**，CI 与本地都能直接构建。但这条有个必须堵住的洞：[`src/lut/official-luts.ts`](../src/lut/official-luts.ts) 用 `import.meta.glob('/3DLUT/**/*.cube.gz')` 在构建期**静默**扫目录，**缺文件不会报错**，只会安静地少几个 LUT —— 与「34 个全量随包」的承诺直接冲突。所以 `build:desktop` 之后必须断言 `dist/assets/*.gz` **恰好 34 个**（9.1 与 6.1 各有一条）。只有**换了厂商原始 `.cube` 素材**时才手动跑一次 `lut:pack` 并重新提交 `.cube.gz`。

### 3.3 打包前的硬性顺序

1. **必须先 `clean:dist`**。实测撞到过 `dist/` 里同时躺着两轮构建的产物，而只看文件列表看不出哪一份是新的——差一点把陈旧产物误读成新产物。
2. **`directories.output` 必须显式改成 `release`**。它的默认值就是 `dist`，与 Vite 产物目录同名；不改的话打包器会把自己的中间产物扫进包里（自污染）。

### 3.4 完整的 `build` 字段（可直接抄）

```json
"build": {
  "appId": "com.kimholau.raw-images-studio",
  "productName": "raw-images-studio",
  "directories": { "output": "release", "buildResources": "build" },
  "files": ["dist/**", "electron/**", "package.json"],
  "asar": true,
  "compression": "normal",
  "win": {
    "target": ["nsis", "zip"],
    "signExecutable": false,
    "artifactName": "raw-images-studio-${version}-win-x64-portable.${ext}"
  },
  "nsis": {
    "oneClick": false,
    "perMachine": false,
    "allowToChangeInstallationDirectory": true,
    "createDesktopShortcut": false,
    "createStartMenuShortcut": true,
    "deleteAppDataOnUninstall": false,
    "differentialPackage": false,
    "artifactName": "raw-images-studio-${version}-win-x64-setup.${ext}"
  }
}
```

同时 `package.json` 顶层要补：`"main": "electron/main.cjs"`、`"description"`、`"author"`，并把 `"electron": "44.6.0"` 与 `"electron-builder": "26.17.0"` 放进 devDependencies（**两个都精确钉版本，不带 `^`**）。

逐条理由：

- **`appId` 一经发布永不更改**：NSIS 的安装 GUID 由它经 UUID v5 派生，改了就等于换了一个应用。
- **`productName` 用 `raw-images-studio`**（无空格）：它同时决定 `%APPDATA%\raw-images-studio` 这个 userData 路径与默认产物名，别靠回落。
- **`directories.output` 必须是 `release`**：默认值就是 `dist`，与 Vite 产物目录同名。
- **`files` 必须显式列**：一旦有非 `!` 的 pattern，默认的 `**/*` 就不补了。`package.json` 与生产依赖无论如何都会进包。
- **不设 `electronVersion`**：它从 devDependencies 里的 `electron` 推断。
- **不写 `publish` 块**：我们走 `--publish never` + 手动上传，不需要它。
- **`win.signExecutable: false` 是「只跳过代码签名、保留图标与版本信息」**。注意别误用 `win.signAndEditExecutable: false`——那会**连资源编辑一起关掉**（实测：exe 版本资源退回 Electron 原版的 `44.6.0 / Electron / GitHub, Inc.`，体积与下载面却省不下任何东西）。本项目本来就没有证书，electron-builder 会自动跳过签名；写这一条是为了让构建在「某台机器恰好装了证书」时也确定。
- **`win.artifactName` 落给 zip**（`nsis.artifactName` 只作用于 NSIS 那一个 target）。
- **`electron-builder` 也精确钉版本**（`"26.17.0"`，不是 `^`）。5.5.1 的实测数字是用 **26.15.3** 跑出来的，两者同属 v26、选项名一致；换 26.17.0 之后若行为有差异，**以重跑 5.5.1 与 9.1 的结果为准**。**不要升到 v27**：`win.signExecutable` 在 v27 改名 `win.sign`、`asarUnpack` 改名 `asar.unpack`、隐式 publish 被删——三处都会让这份 spec 的配置静默失效。
- **把 `electron` 加进 devDependencies 之后要确认 `npm ci` 仍然跑得通**：它的 postinstall 会下约 150 MB 的二进制，本仓库 `package.json` 里还有一个 `allowScripts` 白名单（现在只列了 esbuild 与 @swc/core）。打包本身不依赖这个二进制（electron-builder 自己按版本下载发行包），但 `npm ci` 失败会让 CI 红。



## 4. 资源与离线资产

### 4.1 `app://` 协议配方（钉死）

```js
// electron/main.cjs —— 这就是完整实现（只把 window-all-closed 留到本节末尾单列）
const { app, protocol, BrowserWindow } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

const DIST = path.join(__dirname, '..', 'dist');

// 必须在 app ready 之前注册
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
```

关于这段配方的四条说明：

1. **这段是实测通过的那一段**（探针里逐字如此，只把 `readFileSync` 换成 `await fs.promises.readFile` 以免阻塞主线程——对协议语义没有差别）。**改这一段就要重跑第 9.3 节的验收清单。**
2. **`stream: true` 保留，但别为它编理由**：官方定义里它只关乎 `<video>`/`<audio>`，与「48.2 MB 很大」无关。保留它的唯一原因是「与实测通过的配方逐字一致」。
3. **考虑过但没选：`protocol.registerSource`**。它在 44.6.0 里确实存在（`typeof protocol.registerSource === 'function'`，本机实测），官方也明确推荐给「只服务自家文件的 scheme」（no request touches the main thread）。没选它的理由有三条：它仍标着 **Experimental**；它的 `Content-Type` 由扩展名推断，**没有逐个覆盖的入口**，而我们恰恰需要给 `.gz` 一个确定的类型；最要紧的是**本次没有实测过它**。日后若要换，换之前必须重跑同一份验收清单。
4. **不要用 `loadFile()` + `file://`，也不要 `webSecurity: false`**。官方安全清单第 18 条明确避免 `file://`；`webSecurity: false` 会把「单一代码库、只做壳」的边界一起拆掉。

### 4.2 48.2 MB 的 LUT 怎么进包

**资产留在 `asar` 里**（3.4 里显式写了 `"asar": true`，与默认值一致——写出来只为把意图留在配置里），**不设 `asarUnpack`、不用 `extraResources`。**

依据是官方文档的合取：asar 文档（归档内文件可被 `file:` 协议请求）、`net.fetch` 文档（可发往 `file:`）、以及 `protocol.registerSource` 原文「streamed to the requester the way `file:` URLs are, **including from `asar` archives**」。官方给出「必须解包」的三类理由是：原生 `.node` 模块、需要**随机访问**的大二进制、需要被直接执行的程序文件——本项目一类都不属于（我们是整文件 `fetch` + 顺序 `DecompressionStream`）。

**这条结论的残余风险要如实记住**：asar 内文件经 `file:` 是否支持 **Range / 分段读**没有取到一手依据。因此本 spec 反过来禁掉一类设计：

> **取数路径不得依赖 Range 或分段读。** 现有代码天然满足（整文件 `fetch` + 解压），实现时不要引入。

第 9.3 节把它变成了一条可执行的验收项（装上以后官方 LUT 必须能取到、能解压、能出图）。**退路的触发判据就是那一条失败**（现象通常是 `.gz` 请求 404，或解压阶段报错）：届时改成 `asarUnpack: ['dist/assets/*.gz']`，并**重跑 9.3 的全部六条**——换了取数路径就该把整条关键路径重验一遍，不要只验 LUT。换之前先把失败现象记下来。

### 4.3 CSP：v1 不设

与网页版行为一致。页面只从 `app://` 取本地产物、不加载任何远程内容，不设 CSP 只会让 devtools 里多一条安全提示，不影响运行。设 CSP 则要额外验三件事（`'wasm-unsafe-eval'`、blob worker 的 `worker-src` 回退链、`DecompressionStream`），而 spike 一项都没验过——其中 `DecompressionStream` 与 CSP 的关系**连一手依据都没取到**。

> 「加一份严格 CSP」明确记为**后续加固项**，不属于本 effort。真要做时：`script-src` 必须含 `'wasm-unsafe-eval'`（否则 WASM 编译抛 `WebAssembly.CompileError`），worker 生效指令必须放行 `blob:`，**不要**开 `bypassCSP`，并且三件事都要在 `app://` 上重跑一遍。

### 4.4 离线自足性

- 壳自身不做任何更新检查、不引 `autoUpdater`、不向任何远程地址取数。
- 两条旁证（2026-10-07 实测）：把 HTTP(S) 全部导到一个死代理后，壳内判定表**与不导时逐项相同**；Chromium netlog 里 **0 条 `http(s)` URL**。
- **真正的「断网首次启动」仍需人肉点一次**（见 9.5）。这是「完全离线」这个承诺里唯一还没被人眼确认的一环。

## 5. 安装版与便携版

### 5.1 NSIS 安装版

**取值以 3.4 的 `win` / `nsis` 两块为唯一真相**（那里是完整的 `build` 字段）。本节只写每一条的**理由**，同一个配置块不在两处各写一遍。

- **per-user**（`perMachine: false`）：装到 `%LOCALAPPDATA%\Programs\raw-images-studio`，**不需要管理员权限**。不做签名时，少一次 UAC 提权就少一层「这软件为什么跟我要管理员权限」的疑虑。
- `oneClick: false` 是**必须**的：`allowToChangeInstallationDirectory` 在 `oneClick: true` 下会让构建直接**报错**（`InvalidConfigurationError`），而且只有向导模式才有「改安装目录」这一步。
- `perMachine` 必须**显式写死**：在 `oneClick: false` 下它的语义变成「要不要显示安装模式选择页」，不表态就等于把这个选择丢给安装者。
- **不建桌面快捷方式**，建开始菜单快捷方式。
- `differentialPackage: false`：那是给 electron-updater 用的差分路径，本项目不用更新器。
- `win.requestedExecutionLevel` 保持默认 `asInvoker`（应用本身不请求提权）。

### 5.2 便携 zip

`win.target: ["nsis", "zip"]`，产物名 `raw-images-studio-${version}-win-x64-portable.zip`。名字来自 `win.artifactName`：electron-builder 的解析顺序是 **target 专属 > 平台 > 顶层**，`nsis.artifactName` 只作用于 NSIS 那一个 target，zip 落到 `win.artifactName` 上——这是文档化的机制，不是巧合。

**两个 target 共用同一份 `files` 清单**（3.4 里只写了一份），所以便携 zip 里的资源与安装版逐字节相同，34 个 `.cube.gz` 在两边都齐。

**为什么不是 `portable` 单文件 exe**：`portable` 是 NSIS 变体，每次启动都要自解压到 `$TEMP` 下的一个 per-build 目录，退出时再清理——启动慢、吃盘，而且它的 `userData` 与安装版同址（官方机制里没有「绿色版」开关）。`zip` 解压即用，行为与安装版一致。

**一条要如实写进 README 的行为**：便携版的用户数据同样落在 `%APPDATA%\raw-images-studio`，**不是**落在解压目录旁边。要「绿色版」得自己传 `--user-data-dir`，那是新增的产品决策，不在本 spec 内。

### 5.3 版本号与产物命名

- **`package.json` 的 `version` 是唯一真相。** 发版 tag 必须等于 `v<version>`；CI 先校验，不一致**直接失败**，绝不用 `extraMetadata.version` 偷偷改写版本号。（注：electron-builder 的 publisher 不读 git tag，它按 `v` + `version` 反推 tag 名，所以「tag 必须带 v」不是风格问题。）
- 产物名钉死为无空格 ASCII，`artifactName` 显式写死：
  - `raw-images-studio-<version>-win-x64-setup.exe`
  - `raw-images-studio-<version>-win-x64-portable.zip`
  不显式写死的话，默认名带空格（`<productName> Setup <version>.exe`），而 GitHub 侧还会再做一次 safe-name 处理，下载说明与校验脚本就没法引用确定的名字。
- `package.json` 还要补上 `description` 与 `author`（现在两个都没有）。缺 `author` 会让 NSIS 版本信息里的 `CompanyName` 缺省，也让 `menuCategory: true` 之类的选项直接抛错。

### 5.4 用户数据与卸载

- 用户数据 = `%APPDATA%\raw-images-studio`，其中只有一处持久化数据：**缩略图缓存的 IndexedDB**（库名 `images-viewer`，store `thumbnails`，上限 2000 条，LRU 淘汰，见 [`thumbnail-cache.ts`](../src/services/thumbnail-cache.ts)）。导入的 LUT 库**不做持久化**，刷新即空。
- `deleteAppDataOnUninstall: false`：**卸载不删用户数据**，不偷偷删。
- 因此「卸载无残留」在本 spec 里的口径是：
  - 程序目录、开始菜单项、注册表卸载项 → **无残留**；
  - `%APPDATA%\raw-images-studio` → **按文档保留**，README 写明手动清理路径。

### 5.5 体积账

| 项 | 数字 | 性质 |
| --- | --- | --- |
| `dist/`（Vite 产物，40 个文件） | **51,890,398 B（49.49 MiB）** | 实测（`npm run build`，8.7 s 墙钟） |
| └ 其中 34 个 `.cube.gz` | 50,557,094 B（48.22 MiB） | 实测，与 `3DLUT/**/*.cube.gz` 逐字节一致 |
| └ `resources/app.asar` | 51,903,706 B（49.50 MiB） | 实测 |
| `win-unpacked/` 解包目录 | **437,458,399 B（417.19 MiB）** | 实测（Electron 44.6.0 + 应用） |
| **便携 zip** | **204,064,446 B（194.61 MiB）** | **实测**，electron-builder 26.15.3 |
| NSIS 安装包 | **本环境未产出** | 见 5.5.1 —— **不写估算值** |

> 早期在票 41 里记的「`dist/` 87.9 MB」是**探针产物**的口径：那时候的 `dist/` 里被 Vite 原样拷进了 `public/samples/相册-中文/` 下两份 18 MB 的 DNG 夹具（探针为验中文路径加的，**不在 main 上**）。main 上的真实 `dist/` 是 **49.49 MiB**。

**软目标 ≤ 250 MB。** Electron 官方 win32-x64 运行时 zip 就是 150.9 MB，叠加 48.2 MB 已 gzip 的 LUT 后几乎不缩水，所以「两百多 MB」是结构性的，不是配置没调好。

`compression` 保持默认 `normal`：官方原文是 `maximum` **doesn't lead to noticeable size difference**（只增加构建时间），而 48.2 MB 已经是 gzip 过的高熵数据，本来就压不动。

#### 5.5.1 实测数字

实测环境：electron-builder **26.15.3**（spec 钉的是 26.17.0，见 3.4）+ Electron **44.6.0**（`electronDist` 指向本地解包发行包，未重复下载），`ELECTRON_BUILDER_CACHE` 指向工作区内。构建耗时：冷缓存 **212.8 s** / 暖缓存 **97.9 s**。

| 产物 | 字节数 | MiB | 说明 |
| --- | --- | --- | --- |
| `dist/` | 51,890,398 | 49.49 | 40 个文件 |
| `dist/assets/*.gz` | 50,557,094 | 48.22 | 34 个，与源目录逐字节一致 |
| `resources/app.asar` | 51,903,706 | 49.50 | asar 内就是 `dist/` |
| `win-unpacked/` 总计 | 437,458,399 | 417.19 | 最大单文件是 `raw-images-studio.exe` 246,239,232 B |
| **`...-portable.zip`** | **204,064,446** | **194.61** | **实测** |
| `...-setup.exe`（NSIS） | — | — | **本环境未产出，见下** |

**对软目标的结论**：便携 zip **194.61 MiB，距 250 MB 软目标留出约 55 MiB 余量**。NSIS 安装包走同一份载荷的压缩流、量级只会更小 —— 但**这一点没有实测数字，所以本 spec 不写任何估算值**。

**为什么 NSIS 安装包在这里没产出（环境限制，不是配置问题）**：electron-builder 生成 NSIS 安装包时**必须运行自己刚编出的一个 stub**（`NsisTarget.computeScriptAndSignUninstaller` → `WineVm.exec(installerPath, [])`），靠它 `WriteUninstaller` 产出真正要嵌进安装包的卸载器。而本环境里**任何 NSIS 安装器都执行不了**：用手写的极小 `.nsi` 隔离复现 —— section 里 `SetErrorLevel 42; Quit` 的裸安装器返回 **2 而不是 42**，`.onInit` 里 `SetErrorLevel 43; Quit` 返回的也是 **2**，即**用户的 NSIS 代码一行都没跑到**，进程死在 NSIS 启动阶段。`makensis` 编译本身正常（rc=0）。已排除 Defender、Smart App Control、提权、窗口站、WOW64。中间载荷 `*.nsis.7z`（161,602,225 B）已产出，最终 `.exe` 由它加 stub 组成，但**没有实测**。

> 这条要变成第一次发版的检查项：CI（`windows-latest`）上必须确认 `setup.exe` **真的产出了**，见 9.1。

**不签名时的下载面（实测，并推翻了一条早期推断）**：`.eb-cache` 从空开始，两次构建只下了 `7zip@1.0.0`（491,982 B）、`nsis-3.0.4.1`（1,287,512 B）、`nsis-resources-3.4.1`（730,800 B），合计 2.5 MB。**`winCodeSign` 没有被下载** —— 无证书时 `windowsSignToolManager` 的 `if (cscInfo)` 守卫会跳过整条签名链；而 v26 改 exe 图标/版本信息用的是纯 JS 的 `resEdit.js`，也不再需要它。实测 exe 的版本资源正确写成了 `0.0.1 / raw-images-studio / <author>`。（本机 `%LOCALAPPDATA%` 下另有一份 2026-09-13 的旧 `winCodeSign`，与本次构建无关。）

**一条 `signAndEditExecutable` 的反面证据**（说明为什么 3.4 选的是 `signExecutable`）：把它设成 `false` 后，体积与下载面**零差别**（zip 差 54 B、`app.asar` 逐字节相同），但 exe 版本资源退回 Electron 原版，白白丢掉 FileVersion / ProductName / CompanyName / FileDescription，而且**并不能**解开上面那个 NSIS 故障。

## 6. 发版链路

### 6.1 workflow

新增 `.github/workflows/release-windows.yml`（`deploy.yml` 一个字不动）：

```yaml
name: Release Windows

on:
  push:
    tags: ['v*']
  workflow_dispatch:
    inputs:
      tag:
        description: '要重新出包的已存在 tag（例如 v0.1.0）'
        required: true

permissions:
  contents: write

concurrency:
  group: release-windows-${{ github.ref_name }}
  cancel-in-progress: false

jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
        with:
          ref: ${{ inputs.tag || github.ref }}
          fetch-depth: 0

      - uses: actions/setup-node@v4
        with:
          node-version: 22
          cache: npm

      # 必须在 npm ci 之前：electron 的 postinstall 与 electron-builder 的 @electron/get
      # 都会往这两个目录落发行包，缓存恢复晚一步就等于没有缓存。
      - name: 缓存 Electron 发行包与 electron-builder 工具链
        uses: actions/cache@v4
        with:
          path: |
            ${{ runner.temp }}/eb-cache
            ${{ env.LOCALAPPDATA }}/electron/Cache
          key: eb-win-${{ hashFiles('package-lock.json') }}

      - run: npm ci

      - name: 校验 tag 与 package.json 一致
        shell: pwsh
        run: |
          $tag = if ('${{ inputs.tag }}') { '${{ inputs.tag }}' } else { '${{ github.ref_name }}' }
          $pkg = (Get-Content package.json -Raw | ConvertFrom-Json).version
          if ($tag -ne "v$pkg") { Write-Error "tag $tag 与 package.json version $pkg 不一致（要求 v$pkg）"; exit 1 }
          Write-Output "tag=$tag version=$pkg OK"

      - run: npm run typecheck
      - run: npm run lint
      - run: npm test

      - run: npm run build:desktop

      # 直接调 electron-builder，不走 pack:win：build:desktop 上面已经跑过，
      # pack:win 会把 clean + vite build 再来一遍（electron-builder 自己不会构建前端）。
      - name: 出 NSIS 安装包 + 便携 zip
        run: npx electron-builder --win --x64 --publish never
        env:
          ELECTRON_BUILDER_CACHE: ${{ runner.temp }}/eb-cache

      # 「NSIS 只出了 zip」必须在这里红掉，而不是绿着建出一个缺安装包的 draft。
      - name: 断言两个产物都在
        shell: pwsh
        run: |
          $missing = @()
          if (-not (Get-ChildItem release -Filter '*-setup.exe')) { $missing += 'setup.exe' }
          if (-not (Get-ChildItem release -Filter '*-portable.zip')) { $missing += 'portable.zip' }
          Get-ChildItem release -File | Select-Object Name, Length
          if ($missing.Count) { Write-Error "产物缺失：$($missing -join ', ')"; exit 1 }
          $gz = @(Get-ChildItem dist\assets -Filter '*.gz').Count
          if ($gz -ne 34) { Write-Error "dist/assets 下的 .gz 是 $gz 个，应为 34 个（见 3.2）"; exit 1 }

      - name: 生成校验和
        shell: pwsh
        run: |
          Get-ChildItem release -File |
            Where-Object { $_.Extension -in '.exe', '.zip' } |
            ForEach-Object { "$((Get-FileHash $_.FullName -Algorithm SHA256).Hash.ToLower())  $($_.Name)" } |
            Set-Content release/SHA256SUMS.txt -Encoding ascii
          Get-Content release/SHA256SUMS.txt

      - name: 建 draft Release 并上传
        shell: pwsh
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
        run: |
          $tag = if ('${{ inputs.tag }}') { '${{ inputs.tag }}' } else { '${{ github.ref_name }}' }
          $assets = @(Get-ChildItem release -File | Where-Object { $_.Extension -in '.exe', '.zip' } | ForEach-Object { $_.FullName })
          $assets += 'release/SHA256SUMS.txt'
          # 模板里的 <version> 在这里替换掉（tag 去掉前导 v），不留给人工
          $version = $tag -replace '^v', ''
          (Get-Content .github/release-notes-template.md -Raw) -replace '<version>', $version |
            Set-Content release/release-notes.md -Encoding utf8
          gh release view $tag --json isDraft 2>$null | Out-Null
          if ($LASTEXITCODE -ne 0) {
            gh release create $tag --draft --title $tag --notes-file release/release-notes.md --verify-tag
          }
          gh release upload $tag @assets --clobber
```

要点：

- **`--publish never`，不由打包器发布。** 我们要在同一个 Release 里放两个产物 + 校验和 + 自己写的说明模板，还要一个 draft 人工闸门；把「出包 / 校验 / 发布」拆成三步比让打包器顺带发布好排查。顺序钉死为：**先算 `SHA256SUMS.txt` → 再传资产 → 最后挂说明**。
- **`gh release upload --clobber` 的先删后传要知情**：官方原文警告「existing assets are deleted before new assets are uploaded. **If the upload fails, the original assets will be lost.**」所以校验和在**上传之前**就算完，且上传失败要重跑整个 job，而不是补一条命令。
- 若改用 `softprops/action-gh-release`：它的 `overwrite_files` 默认 `true`，但**复用一个已存在的 draft 时必须显式写 `draft: true`**，否则它会在上传后把 draft 直接发布出去。
- `--publish always` 之所以不用，还有一条：它有两类「workflow 绿了但没上传」的静默情况（Release 已发布超过 2 小时；已存在非 draft 而本次要建 draft）。用 `--publish never` + 显式上传就没有这个盲区。
- **上传前必须跑 `typecheck` + `lint` + `test`**，任一失败就不出包。tag 推出去 Release 就是公开的。
- **缓存的价值主要在 Electron 发行包上**（约 150 MB）：electron-builder 那三个工具包实测合计只有 2.5 MB，而 `winCodeSign` 在不签名时根本不会被下载，所以不必为它留缓存。**缓存步骤因此放在 `npm ci` 之前**（见上面 YAML 的位置）。另注意 5.5.1 的实测是本机用 `electronDist` 指向已解包的发行包跑出来的，**CI 里没有 `electronDist`**，会真的下载一次——这正是缓存存在的理由。

### 6.2 触发与重跑

- `on.push.tags: ['v*']` + `workflow_dispatch`（输入一个已存在的 tag 名，checkout 该 tag 重出包）。
- `concurrency` 防重入，`cancel-in-progress: false`（出包跑到一半被取消只会留下半套资产）。
- 重跑安全：Release 已存在时跳过创建、直接 `--clobber` 覆盖上传。**发布前人工核对 `SHA256SUMS.txt` 的内容与 Release 上两个产物一致**——时间戳只能说明「传过」，内容一致才说明真对上了；而且 `--clobber` 是先删后传，中途失败会留下一个缺资产的 Release，那种情况要**重跑整个 job**，不要手工补传。

### 6.3 与 `deploy.yml` 的关系

**各跑一遍，`deploy.yml` 一个字不动。** 触发条件本来就不同（push → Pages，tag → Release），省一次 build 的收益抵不上改既有 CI 的风险。代价是同一个 commit 可能被构建两次，接受。

## 7. 不签名的分发体验

### 7.1 下载者会看到什么（微软官方口径）

- 未签名的 exe：用户看到 **「Windows protected your PC」**，必须自己点 **「更多信息 → 仍要运行」**；**企业策略可以完全禁止继续**（官方原文：Enterprise policy can prevent continuation entirely）。
- **每一个新版本都要从零重建 SmartScreen 声誉**（官方原文：Unsigned files must build reputation anew with every update）；阈值官方只给了模糊量级：several weeks and hundreds of clean installs。
- **Win11 的 Smart App Control 对未签名可执行文件的检查不限于「从网上下载来的文件」**（官方原文：apply to all executable files, not just those downloaded from the Internet）⇒ **离线分发不能免掉签名检查**。
- EV 证书从 2024 起也不再「秒过」SmartScreen。本 effort 不做签名，这些是**如实告知**，不是要绕过的障碍。

### 7.2 Release 正文模板

`.github/release-notes-template.md` 用固定结构（实现时逐字照抄）。里面的 `<version>` 由 CI 用「tag 去掉前导 `v`」替换（见 6.1 的 `gh release` 那一步），**不要留给人手改**；其余内容在 draft 上人工看一眼。

```markdown
## raw-images-studio <version>（Windows x64）

### 下载哪个

| 文件 | 说明 |
| --- | --- |
| `raw-images-studio-<version>-win-x64-setup.exe` | 安装版（装到当前用户，不需要管理员权限） |
| `raw-images-studio-<version>-win-x64-portable.zip` | 便携版（解压即用） |

SHA256 见 `SHA256SUMS.txt`。自证完整性的方法（PowerShell）：

    Get-FileHash .\raw-images-studio-<version>-win-x64-setup.exe -Algorithm SHA256

### 这个包没有代码签名

你会看到蓝色的 **「Windows protected your PC」**。点 **「更多信息」→「仍要运行」** 即可安装。
这不是文件损坏，是本项目没有购买代码签名证书；为什么不做、代价是什么，见 README 的「Windows 桌面版」一节。

### 其他

- 只支持 64 位 Windows（Win10 1809+ / Win11）。
- 完全离线可用：34 个官方 LUT 全部随包。
- 用户数据在 `%APPDATA%\raw-images-studio`；卸载不会删它。
```

### 7.3 `SHA256SUMS.txt`

`sha256sum` 格式（小写十六进制 + 两个空格 + 文件名），由 CI 在上传前生成，与两个产物一起挂在 Release 上。它不是防篡改的强证明（能改包的人也能改这一行），但能让下载者自己确认「文件在传输中没坏」，比什么都没有强。

### 7.4 README 怎么讲

README 只加**一小节**（不塞长教程），放在 `## 部署` 之前：

- 一句话说明 Windows 桌面版走 GitHub Releases、只 x64；
- 下载链接指向 <https://github.com/KimHoLau/raw-images-studio/releases>；
- **写明未签名**，以及用户会看到 SmartScreen 提示、该点哪里；
- 写明用户数据位置与卸载保留；
- 链接到本文档与两份调研。

## 8. 已知限制

1. **未签名**：SmartScreen 每个版本从零攒声誉，用户必须自己点「仍要运行」；企业策略可能完全禁止。见 7.1。
2. **只出 x64**：ARM64 与 32 位 Windows 不做（Electron 44 起 Windows ia32 已不可用）。
3. **没有自动更新**：v1 手动下新版；也没有差分更新（`differentialPackage: false`）。
4. **没有桌面专属特性**：文件关联、应用菜单、最近打开、系统托盘、自定义下载行为都没有。导出走渲染进程的 `<a download>`，落盘位置交给 Chromium 默认行为。
5. **安装包两百多 MB 量级**：Electron 运行时是大头，见 5.5。
6. **卸载保留用户数据**：`%APPDATA%\raw-images-studio` 不会被删，口径见 5.4。
7. **便携版不是「绿色版」**：它的用户数据与安装版同址，官方机制里没有改这一点的开关。
8. **`showDirectoryPicker` 至少要一次用户手势**；无手势时抛 `SecurityError`（code 18），与用户取消的 `AbortError` 是两回事。现有 `file-browser.ts` 与 `useFolderOpener.ts` **只处理了 `AbortError`**，`SecurityError` 会走到错误分支——这是本 effort 之外的一处**产品侧待确认行为**，如实记在这里，不在本 spec 内解决。
9. **取数路径不得依赖 Range 或分段读**（asar 内 Range 无一手依据），见 4.2。
10. **v1 不设 CSP**：只从 `app://` 取本地产物，不加载远程内容；加固项与注意事项见 4.3。
11. **`app://` 的协议处理器在主进程里读文件**：48 MB 的取数会占用主线程（实测 2.9 MB 的文件无感）。若日后出现卡顿，第一顺位是评估 `protocol.registerSource`（Experimental），换之前必须重跑验收清单。
12. **本 spec 的壳内证据在 `--no-sandbox` 下采集**（本会话进程令牌建不出 Chromium 的 OS 级沙箱）。16 项里只有 `showDirectoryPicker` 可能受影响，而那一项本来就要人点。真机正常启动不受此限。
13. **发版 tag 必须等于 `v<package.json version>`**，否则 CI 直接失败（这是有意的）。
14. **`package.json` 目前缺 `author` 与 `description`**：实现时补上，否则 NSIS 版本信息里的 `CompanyName` 缺省。
15. **v1 用 Electron 默认应用图标**：要换就放 `build/icon.ico`（≥ 256×256），不需要改代码。

## 9. 验收清单

### 9.1 构建产物（CI，或任何能执行 NSIS 安装器的 Windows 机器）

> 「本地」不够：这台机器执行不了 NSIS 安装器，`setup.exe` 在这里**必然**产不出来（见 5.5.1）。所以下面涉及 `pack:win` 与 `setup.exe` 的两条，要在 CI 或普通 Windows 主机上过。

- [ ] `npm run build:desktop` 成功，且 `dist/` 里**只有本次**的产物（`clean:dist` 生效）。
- [ ] `dist/assets/*.gz` 恰好 **34 个**。`lut:pack` 不是打包前置（见 3.2），而清单是构建期静默扫出来的——**少一个文件不会报错，只会安静地少几个 LUT**，所以这条必须当成检查项。
- [ ] `npm run pack:win` 产出 `release/` 下的 `...-setup.exe` 与 `...-portable.zip`，文件名与 5.3 逐字一致（无空格、纯 ASCII）。
- [ ] **`...-setup.exe` 真的产出了。** 本环境里 NSIS 安装器执行不了，这一步**没有在这里验过**（见 5.5.1）——第一次 CI/真机跑必须确认它出来。CI 里已有一条断言专门盯这件事（6.1）。
- [ ] 两个产物的体积记录在案（5.5.1），与软目标 250 MB 的差距有解释。
- [ ] `release/` 里没有把打包器自己的中间产物扫进包里（`directories.output` 不是 `dist`）。

### 9.2 干净 Win10/11 机器上安装

- [ ] 双击 `...-setup.exe`：出现 SmartScreen「Windows protected your PC」→「更多信息」→「仍要运行」→ 进入安装向导。
- [ ] **全程没有 UAC 提权提示**（per-user 安装）。
- [ ] 向导里可以改安装目录；装完**有**开始菜单项、**没有**桌面快捷方式。
- [ ] 从开始菜单启动，程序窗口正常出现，界面语言与网页版一致。
- [ ] 安装目录里能看到 `resources/app.asar`，其体积与（解包后的应用 + 48.2 MB LUT）量级相符。

### 9.3 断网关键路径（**这是本 spec 的核心验收项**）

断网（拔网线或禁网卡），重跑一遍下列路径：

- [ ] 启动 → 打开相册目录（含**中文目录名**）→ 缩略图出现。
- [ ] 打开一张 RAW（**含中文文件名**），解码出图，尺寸与方向正确。
- [ ] 拉动调整滑块（曝光/对比等），画面实时变化。
- [ ] 选一个 Log 色彩空间 → 选官方 LUT → **LUT 生效**（这一步同时验掉「asar 里的 48.2 MB 取得到 + 解压得了」这条 4.2 的残余风险）。
- [ ] 导出 JPEG：落盘成功、文件名含中文不乱码、用别的看图软件打开正常。
- [ ] 全程没有联网行为（可对照 4.4 的 netlog 方法复核）。

### 9.4 卸载

- [ ] **先确认 `deleteAppDataOnUninstall: false` 在向导模式（`oneClick: false`）下真的生效**：这个选项的语义在 electron-builder 的文档与源码之间有过不一致（见 [`research/electron-builder-release-facts.md`](../research/electron-builder-release-facts.md) 的空白清单），别只信配置。
- [ ] 控制面板卸载：程序目录、开始菜单项、注册表卸载项**全部消失**。
- [ ] `%APPDATA%\raw-images-studio` **仍在**（这是有意的）。
- [ ] 按 README 写的手动清理路径删掉它之后，重新安装能正常启动。

### 9.5 待验证（证据缺口）

以下几条本 spec 拿不到结论，实现者/发布者第一次跑的时候必须人眼确认，**不要当成已通过**：

| 项 | 为什么要人 | 现状 |
| --- | --- | --- |
| `showDirectoryPicker` 一次性授权，以及「用户取消」与「无手势」抛的异常是否可区分 | 会弹系统对话框，自动跑一律跳过 | 未实测（`SecurityError` code 18 与 `AbortError` 的区分只有文档级依据） |
| 导出落盘的真实位置与中文文件名有没有乱码 | 探针只证明了「下载被触发、文件名正确」 | 触发已验，落盘未验 |
| 无 GPU / 远程桌面的真机表现 | 本机 `--spike-no-gpu` 变体跑挂；网页版基线在 SwiftShader 下 WebGL2 + 浮点纹理全通 | 间接证据成立，真机未验 |
| 真机断网首次启动 | 两条旁证见 4.4 | 旁证成立，人眼未验 |
| 便携 zip 解压后启动、它的用户数据确实落在 `%APPDATA%`、以及它的 `app.asar` 里 34 个 `.cube.gz` 齐全 | 需要真机跑 | 未验（只按官方机制与「两 target 共用一份 `files` 清单」推断，见 5.2） |
| **NSIS 安装包的产出与安装** | electron-builder 生成卸载器那一步要**真跑一次安装器**，本环境跑不起来（退出码 2，已用手写 `.nsi` 隔离复现） | `setup.exe` 未产出；CI/真机第一轮必须确认（见 9.1） |

## 10. 证据索引

| 文件 | 是什么 |
| --- | --- |
| [`docs/adr/0001-windows-desktop-shell.md`](adr/0001-windows-desktop-shell.md) | 外壳选型与取舍、体积软目标、改主意的触发条件 |
| [`research/electron-shell-spike.md`](../research/electron-shell-spike.md) | 壳内关键路径的判定表、要适配的配方、坑清单（含本文 2.4 的原始数字） |
| [`research/electron-builder-release-facts.md`](../research/electron-builder-release-facts.md) | NSIS/asar/便携/版本号/不签名/CI 的一手取证，含本文 4.1 与第 6 节的配置出处 |
| [`research/desktop-shell-facts.md`](../research/desktop-shell-facts.md) | Electron vs Tauri 的候选事实（选型阶段的证据） |
| 分支 `spike/issue-41-electron-shell` 上的 `spike/electron-shell/out/selftest.json` | 壳内 21 项自测的原始证据。**main 上不含它**（探针整体活在抛弃式分支上）；要看得用 `git show origin/spike/issue-41-electron-shell:spike/electron-shell/out/selftest.json` |
