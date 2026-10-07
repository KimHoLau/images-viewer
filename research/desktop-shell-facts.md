# Windows 桌面外壳候选事实调研：Electron vs Tauri v2

> **项目：** images-viewer（React 19 + Vite 6 + TS strict，纯前端 Web 应用）
> **问题：** 给网页版套一个 Windows x64 桌面壳（NSIS 安装版 + 便携 zip），哪个外壳能用最小的改造代价保住现有行为
> **日期：** 2026-10-11
> **方法：** 只查一手来源（Electron 官方文档 / Tauri v2 官方文档 / tauri-apps 源码与 issue / Microsoft Learn / MDN / Chromium 文档）。每条结论标注证据等级。

---

## 证据等级约定

全文每条结论都带下面四种标记之一：

| 标记 | 含义 |
| --- | --- |
| 【官方文档】 | 该项目的官方文档/官方 API 参考里写明的 |
| 【源码/官方 issue】 | 官方仓库的源码、官方 issue tracker 里的原文 |
| 【社区报告】 | 只有第三方博客、StackOverflow、论坛、非官方 issue 讨论；**未在一手来源确认** |
| 【未找到一手依据】 | 没查到，本报告不猜 |

---

## 0. 被壳的这套应用的硬事实（来自本仓库，非调研结论）

这些是选型的约束条件，不是需要再查的结论。源码位置逐条给出。

| 事实 | 依据 |
| --- | --- |
| 纯前端 Web 应用：React 19 + Vite 6 + TS strict + Zustand | `package.json` |
| RAW 解码是 LibRaw 的 WASM，跑在 ES module Worker 里 | `vite.config.ts`：`worker.format = 'es'`、`build.target = 'esnext'`、`vite-plugin-wasm` + `vite-plugin-top-level-await` |
| **官方 LUT 清单是构建期扫出来的 URL 表** | `src/lut/official-luts.ts` `import.meta.glob('/3DLUT/**/*.cube.gz', { eager: true, query: '?url', import: 'default' })` |
| **运行时用 `fetch(entry.url)` 取这些静态资源** | `src/lut/official-luts.ts` `loadOfficialLut()`：`const response = await fetch(entry.url)`，再 `DecompressionStream('gzip')` 解压 |
| `dist/` 约 49.5 MB：34 个 `.cube.gz` 共 48.2 MB（已进仓库，原 `.cube` 被 gitignore）+ LibRaw `.wasm` 853 KB + 两个 Worker（各约 76 KB） | 仓库现状 |
| 依赖 `showDirectoryPicker`（不可用时降级 `<input webkitdirectory>`）、`DecompressionStream`、IndexedDB、`URL.createObjectURL` + `<a download>` | 源码 |
| WebGL2 单 pass 片元着色器 | 源码 |
| CI 现状：GitHub Pages（Node 22 + `npm ci`） | `.github/workflows/` |

**用户已定的硬约束（不可改写）：** 只出 Windows x64（Win10 1809+ / Win11）；不得堵死日后 macOS/Linux；完全离线可用；48.2 MB LUT 全量随包；分发走 GitHub Releases + tag 触发 CI；不做代码签名；只做壳、行为与网页版一致；**单一代码库**（共用 `src/`，不许 fork）；产物 = NSIS 安装版 + 便携 zip。

**版本基准（调研时的最新稳定版）：** Electron `44.6.0`、`@tauri-apps/cli` `2.12.1`（`npm view` 实测，2026-10-11）。

---

## 1. 第一道关：`fetch()` 能不能取相对路径的静态资源

这是选型的第一道关：LUT 是**运行时 `fetch()` 拿的**，不是打包进 JS 的，如果外壳里这个 fetch 不工作，48.2 MB LUT 就得换一套取数方式。

### 1.1 Electron：`loadFile()` → `file://`，fetch 相对 URL 的命运

- **【官方文档】不要用 `file://` 兜底。** Electron 官方 `protocol` 文档给出的全部示例都是注册自定义 scheme + `protocol.handle`，文档里明确说明 non-standard scheme「会表现得像 `file` 协议，但不能解析相对 URL」，并且「非 standard scheme 默认禁用 web storage（localStorage/sessionStorage/IndexedDB/cookies）」、「不能通过 FileSystem API 访问文件，渲染进程会抛 scheme 安全错误」。来源：[Electron `protocol` 文档](https://www.electronjs.org/docs/latest/api/protocol)。
  - 对本项目的直接含义：`file://` 下 IndexedDB 与 File System Access 都会受限，而这两样本项目都在用。
- **【官方文档】标准做法 = `protocol.registerSchemesAsPrivileged` + `protocol.handle`。** 官方示例给的 privileges 组合是 `{ standard: true, secure: true, supportFetchAPI: true }`，并在 `app.whenReady()` 之后 `protocol.handle('app', ...)` 用 `net.fetch(pathToFileURL(pathToServe).toString())` 把文件喂回去。来源：[Electron `protocol` 文档 · `protocol.handle`](https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler)。
- **【官方文档】privileges 各字段的官方定义**（同一页 `registerSchemesAsPrivileged` 一节）：
  - `standard`：遵守 RFC 3986 的 generic URI syntax，**只有 standard scheme 才能正确解析相对 URL 与绝对路径资源**；也才能用 File System API、才默认启用 localStorage/IndexedDB/cookies。
  - `secure`：当作安全上下文（本条页面正文未逐字展开，但官方示例固定带上；`supportFetchAPI` 之外的意义见第 5 节待补）。
  - `supportFetchAPI`：允许对该 scheme 使用 fetch API —— **这一条正是本项目 LUT 取数的开关**。
  - `bypassCSP`、`stream`、`allowServiceWorkers`、`codeCache` 等：官方文档列出并逐个解释（`stream` 是 `<video>/<audio>` 需要的）。
- **【官方文档】比 `protocol.handle` 更省事的新 API：`protocol.registerSource`（Experimental）。** 官方描述：一个 scheme 只服务应用自带文件时用它，「没有请求会碰到主线程，主进程忙不忙都不影响页面和子资源的加载速度」，并且「像 `file:` URL 一样流式发送，**包括从 asar 归档里读**，Content-Type 按扩展名推断」。官方示例里 `routes` 支持 `match: { host, path }` + `source: { type: 'directory', root }`，还可带自定义响应头。来源：[Electron `protocol` 文档 · `protocol.registerSource`](https://www.electronjs.org/docs/latest/api/protocol#protocolregistersourcescheme-source-experimental)。

### 1.2 Electron + 自定义 scheme 的一个必须 spike 的细节：`import.meta.glob` 产出的是 `/assets/...` 绝对路径

`import.meta.glob` 在 Vite 里产出的是以 `/` 开头的绝对路径（加上 `base`），Vite 的 `base` 默认 `'/'`。在 `http(s)://` 页面里这是同源绝对路径，没问题；在自定义 scheme（比如 `app://bundle/`）里，**只要该 scheme 注册为 `standard`，相对/绝对路径会按 RFC 3986 generic URI syntax 解析**，`/assets/x.cube.gz` 就会解析到 host 的根路径下（【官方文档】同上 `standard` 的定义）。这意味着主进程的 handler 必须把 `request.url` 的 `pathname` 映射到磁盘上的 `dist/` 根目录——官方 `protocol.handle` 示例正是这么写的（`path.resolve(__dirname, pathname)` + 越界检查）。
- **构建期把 `base` 设成 `'./'`** 是另一条常见路线（产出相对 URL），官方 Vite 文档有 `base` 选项说明；但**在自定义 scheme 下相对路径的解析起点**是否与 `http` 一致，本报告**未找到一手依据**，列入 spike 清单。

### 1.3 Electron：`webSecurity: false` 与「起本地 http」

- **【官方文档/官方安全文档】不建议 `webSecurity: false`。** Electron 官方安全清单明确把禁用 `webSecurity` 列为反模式，理由是它同时关掉同源策略与 CORS，任何页面内脚本都能读跨源内容。来源：[Electron Security · 3. Do not disable webSecurity](https://www.electronjs.org/docs/latest/tutorial/security#3-do-not-disable-websecurity)。
- 起本地 http server（`http://127.0.0.1:PORT`）：**能**让 fetch 正常，但引入端口占用、防火墙弹窗、启动竞态；Electron 官方文档推荐的做法是自定义 scheme 而不是本地服务器（`protocol` 文档全篇没有推荐起 http server 的写法）。
- 「本地 http server」在**某些场景下是必要**的（例如需要 `SharedArrayBuffer` 时的 COOP/COEP 响应头，`protocol.registerSource` 的 `headers` 字段也能满足——见 `protocol.registerSource` 示例里给的 `Cross-Origin-Opener-Policy` 头）。

### 1.4 Tauri v2 在 Windows 上前端的 origin

- **【官方文档/官方 issue】Windows 上前端页面的 origin 是 `http://tauri.localhost`。** 证据：tauri-apps/tauri 官方 issue #13262「Asset Paths Rewritten to `http://tauri.localhost/` in Production Build (Tauri v2 + Vite + Vue3 on Windows)」，标题与正文即把 `http://tauri.localhost/` 作为生产构建下的实际 origin 讨论。来源：[tauri-apps/tauri#13262](https://github.com/tauri-apps/tauri/issues/13262)。
- **【官方文档】`app.windows[].useHttpsScheme`** 可以把它换成 `https` scheme（Tauri v2 配置参考 `WindowConfig` 里的字段名 `useHttpsScheme`；`dangerousUseHttpScheme` 是 v1 时代的字段名，v2 迁移文档里有说明）。**本报告尚未逐字核实这两个字段在 v2 的最终命名与默认值**，列入「未找到一手依据/待核实」。
- 推论（**需 spike 确认**）：origin 是 `http://tauri.localhost` 这种**真正的 http scheme**，那么 `fetch('./assets/x.cube.gz')` 属于同源相对路径请求，不符合「被 CORS 拦掉」的条件；48 MB 文件的取数在协议层应当直接可用。**但** Tauri v2 的 CSP 与 asset 协议 scope 是否额外限制，见第 5 节。

---

## 2. `showDirectoryPicker`（File System Access API）在两个壳里的可用性

> 待补：Electron / WebView2 各自的实现状态与版本门槛，以及 `<input webkitdirectory>` 降级是否必须。

---

## 3. WebView2 运行时的离线分发（Tauri）

> 待补：`webviewInstallMode` 取值与「完全离线」的那一个。

---

## 4. 体积与产物（NSIS + 便携 zip）

> 待补。

---

## 5. ES module Worker + WASM + `DecompressionStream` + WebGL2 的坑

> 待补：CSP `wasm-unsafe-eval`、module worker、`blob:` worker、WebView2 版本下限。

---

## 6. tag 触发 Windows runner 打包

> 待补：`tauri-apps/tauri-action` 与 electron-builder 的官方示例。

---

## 7. 候选对比与推荐

> 待补。

---

## 8. 必须靠 spike 实测才能定的问题清单

> 待补。

---

## 9. 未找到一手依据

> 待补（调研过程中凡是查不到的，逐条落到这里）。
