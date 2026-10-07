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
- **【官方文档】`app.windows[].useHttpsScheme` 决定用 `https` 还是 `http` scheme，默认 `false`。** 源码级证据：`WindowConfig::use_https_scheme: bool`，serde 别名为 `use-https-scheme`，`WindowConfig::default()` 里 `use_https_scheme: false`。并且官方注释给了一条对本项目**很关键**的警告：「Changing this value between releases will change the IndexedDB, cookies and localstorage location and your app will not be able to access the old data.」来源：[tauri-apps/tauri `crates/tauri-utils/src/config.rs` · `WindowConfig`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs)。**对本项目的含义：本项目用 IndexedDB（`useHttpsScheme` 一改，老数据就读不到了），所以这个开关一旦定下就不能再翻。**
  - **仍未核实：** 官方配置参考页对 `useHttpsScheme` 的表述、以及 v1 的 `dangerousUseHttpScheme` 到 v2 的迁移对照（本报告只从源码确认了 v2 的字段名与默认值）。
- **推论（**需 spike 确认**）：origin 是 `http://tauri.localhost` 这种真正的 http scheme，那么 `fetch('./assets/x.cube.gz')` 属于同源相对路径请求，不符合「被 CORS 拦掉」的条件；48 MB 文件的取数在协议层应当直接可用。**但** Tauri v2 的 CSP 与 asset 协议 scope 是否额外限制，见第 5 节。**本报告未找到「Tauri 前端资源在 `http://tauri.localhost` 下 fetch 相对路径」的官方正面表述**，只有 issue #13262 对 origin 的旁证，因此这条仍属待验证。

---

### 1.5 Electron 的 Chromium 版本基准

- **【官方文档】Electron 44.6.0 = Chromium `152.0.7977.54` + Node `v24.18.1` + V8 15.2。** 来源：[Electron 44 发布公告](https://www.electronjs.org/blog/electron-44-0)。这意味着 Electron 路线里的 Web 平台能力下限**不是**「Win10 1809 上装了什么」，而是**我们自己随包发的 Chromium 152**：`DecompressionStream`、module worker、WebGL2、`showDirectoryPicker` 全都不受用户系统浏览器版本影响。这是 Electron 相对 Tauri 的结构性优势（Tauri 用的是系统 WebView2，见第 3 节）。
- **【官方文档】Electron 44 起不再发布 Windows 32 位（`win32-ia32`）与 Linux armv7l 预编译二进制**，只发 x64 与 arm64。来源：[Electron 44 · Breaking Changes · Removed: Windows 32-bit and Linux 32-bit ARM support](https://www.electronjs.org/blog/electron-44-0)。与「只出 Windows x64」的硬约束一致，无影响。

---

## 2. `showDirectoryPicker`（File System Access API）在两个壳里的可用性

**结论先行：Electron 侧「已实现，但有一串已知坑，坑都在权限/持久化而非 API 本身」；WebView2 侧本报告未找到一手依据。** 这一节直接影响是否需要退回 `<input webkitdirectory>`。

### 2.1 Electron：API 存在，官方文档里就有 `showDirectoryPicker()` 的示例

- **【官方文档】Electron 官方 `session` 文档在 `file-system-access-restricted` 事件的示例代码里直接调用了 `window.showDirectoryPicker({ id, mode, startIn })`。** 官方文档把「被 Electron 列入黑名单的路径」的处理写成了主进程事件 + `callback('allow' | 'deny' | 'tryAgain')`。来源：[Electron `session` · Event: `file-system-access-restricted`](https://www.electronjs.org/docs/latest/api/session#event-file-system-access-restricted)。
  - 该事件的 History 表给出引入版本：`^44.3.0` / `^43.7.0` / `^42.11.3` 起「Added `details.frame` and `details.webContents`; emitted once per requesting document instead of once per path」（[PR #53666](https://github.com/electron/electron/pull/53666)）。也就是说这个事件本身更早就有了，最近才改成按 document 触发。
  - `action` 的三个取值是官方定义的：`allow` 放行、`deny` 直接触发 [`AbortError`](https://developer.mozilla.org/en-US/docs/Web/API/AbortController/abort)、`tryAgain` 重新弹一次文件选择器。**对本项目的含义：`showDirectoryPicker` 在用户选到系统受限目录时抛的 `AbortError` 与「用户点了取消」无法区分，这个坑官方给的解法就是在主进程监听这个事件。**

- **【源码/官方 issue】Electron 30.0.0 起接入了 File System Access 权限 broker；30.x 的持久权限行为是一次回归，2025-09 才修好。** 官方 issue [#41957](https://github.com/electron/electron/issues/41957)（2025-09-15 关闭）原文：
  - 「Although there is a new broker for handling File System Access permissions (see #28422 and its resolution in [PR #41419]), using this function does not grant persistent permissions」——即 Electron 30 起有了 broker，但**持久权限不生效**，只有带用户手势（点击）时才能拿到权限，否则报 `DOMException: Failed to execute 'requestPermission' on 'FileSystemHandle': User activation is required to request permissions.`。
  - Electron ≤29 可以用 `app.commandLine.appendSwitch('enable-experimental-web-platform-features')` 绕过手势要求（该开关会**直接放行所有权限请求**）；30+ 不行。
  - 收尾：官方维护者开 [PR #48170](https://github.com/electron/electron/pull/48170)（`feat: add fileSystem to ses.setPermissionCheckHandler`，2025-09-15 merged，release note「Allowed for persisting File System API grant status within a given session」），issue 里报告者在 v37.1.0 上确认 `requestPermission()` 这条路能用了。
  - **对本项目的含义：** 本项目是「用户点一下 → `showDirectoryPicker` 立刻拿目录句柄 → 本次会话内读图」，**没有**跨会话持久化句柄的需求，因此 [#41957](https://github.com/electron/electron/issues/41957) 里那个「无手势就不给权限」的问题**理论上打不到我们**；但它同时说明**若日后要「记住上次打开的目录」，就必须配主进程的权限 handler**（`ses.setPermissionCheckHandler` 的 `fileSystem` 权限）。
- **【源码/官方 issue】Electron 的 FSA 实现一直在修，说明它不是「not implemented」而是「实现中」：** 官方 PR [#53666](https://github.com/electron/electron/pull/53666)/[#53690](https://github.com/electron/electron/pull/53690)（2026-09）「scope File System Access grants to the requesting document」、[#49620](https://github.com/electron/electron/pull/49620)/[#49746](https://github.com/electron/electron/pull/49746)（2026-02）「revoke Read access after removing file via FileSystemAccess API」、[#49578](https://github.com/electron/electron/pull/49578) 等「possible crash in FileSystem API」、[#54676](https://github.com/electron/electron/pull/54676)（2026-10，WSL UNC 路径）/ [#54679](https://github.com/electron/electron/pull/54679)（macOS firmlink 别名）都在 File System Access 上。
- **【源码/官方 issue】历史案底：早期确实不行。** [electron/electron#28422](https://github.com/electron/electron/issues/28422)「[Bug]: Missing permissions dialog for FileSystem API」2024-04-10 关闭，是 FSA 权限对话框缺失的原始 issue（[#41957](https://github.com/electron/electron/issues/41957) 引用它说明后续由 [PR #41419](https://github.com/electron/electron/pull/41419) 解决）。**结论：Electron 29 之前只有靠实验开关，30 起是「实现了一半、权限模型逐步补齐」。**
- **【社区报告】`showDirectoryPicker` 在 Electron 里出过「用户取消后永久坏掉」的问题**：[StackOverflow「Fileystem API showDirectoryPicker() permanently broken if user doesn't choose a directory in Electron」](https://stackoverflow.com/questions/79269877/fileystem-api-showdirectorypicker-permanently-broken-if-user-doesnt-choose-a)。仅社区报告，**未在官方 issue/文档里确认**（本报告未查到对应官方 issue）。
- **不能声称的事：** 本报告**没有**找到「Electron 官方文档明说 `showDirectoryPicker` 在 Windows 上完全可用/不可用」的表述。上面的证据只支撑到「API 存在、官方文档在示例里用它、权限模型有已知坑」。**因此「Windows 上 `showDirectoryPicker` 是否能稳定拿到目录」必须 spike 实测。**

### 2.2 `<input webkitdirectory>` 降级路径在 Electron 里

- **【源码/官方 issue】有历史坑但都已关闭：** [electron/electron#31663](https://github.com/electron/electron/issues/31663)「[Bug]: HTMLInputElement.webkitdirectory is broken on Windows and Linux」（closed）、[#28147](https://github.com/electron/electron/issues/28147)「electron stuck there when using webkitDirectory to choose folder」（closed）、[#18343](https://github.com/electron/electron/pull/18343)「fix: correctly support the webkitdirectory input attr」（closed）、以及配套文档 PR [#21209](https://github.com/electron/electron/pull/21209)/[#20934](https://github.com/electron/electron/pull/20934)「docs: document webkitdirectory breaking change」。
- **对本项目的含义：** 降级路径存在过 bug 但当前均已关闭，**大概率可用**；但 `webkitdirectory` 的已知行为差异（选目录时递归拿到全部文件、`File` 对象上的路径信息）与「Electron 对 webkitdirectory 的 breaking change」具体内容本报告**未逐条核实**，列入 spike 清单。

### 2.3 WebView2 / Tauri 侧

- **【未找到一手依据】** 本报告未找到「WebView2 是否支持 `window.showDirectoryPicker`」的一手来源（Microsoft Learn 或 Chromium/Edge 官方文档里没有查到明确的可用性声明或版本门槛）。社区侧的间接线索是 Tauri 生态里 `showDirectoryPicker` 的讨论很少、主流做法是走 `@tauri-apps/plugin-dialog` 的目录选择器（这是 Tauri 官方插件，用原生对话框而非 FSA），但这**只说明生态习惯，不构成 WebView2 不支持 FSA 的证据**。**这条必须 spike 实测。**
- **【官方文档】Tauri 官方对「目录选择」给的答案是插件而不是 FSA：** Tauri v2 有官方的 `@tauri-apps/plugin-dialog`（文档列在 Plugins → Dialog），配 `@tauri-apps/plugin-fs`。若 WebView2 的 FSA 不可用，Tauri 路线的替代方案是走插件 + 自己实现文件读取，**这与「只做壳、行为与网页版一致、单一代码库」的硬约束冲突**（要在 `src/` 里加 Tauri 专有分支或适配层）。

---

## 3. WebView2 运行时的离线分发（Tauri）

这一节只关心一件事：**用户要求「完全离线可用」，而 Tauri 的默认安装器会联网下载 WebView2。**

- **【官方文档】`bundle.windows.webviewInstallMode` 的全部取值、是否需要联网、体积代价（官方对比表原文）：**

| 取值 | 需要联网？ | 安装包增大 | 官方备注 |
| --- | --- | --- | --- |
| `downloadBootstrapper` | **Yes** | 0 MB | **`Default`**；安装包更小，但不推荐 Win7 走 `.msi` |
| `embedBootstrapper` | **Yes** | ~1.8 MB | Win7 + `.msi` 支持更好 |
| `offlineInstaller` | **No** | **~127 MB** | **「Embeds WebView2 installer. Recommended for offline environments.」** |
| `fixedRuntime` | **No** | ~180 MB | 嵌入固定版本 WebView2 运行时 |
| `skip` | No | 0 MB | ⚠️ 不推荐；不随安装包安装 WebView2 |

来源：[Tauri v2 · Windows Installer · WebView2 Installation Options](https://v2.tauri.app/distribute/windows-installer/#webview2-installation-options)。

- **【源码】上表与 Tauri 源码逐字一致，并且官方源码补了 `silent` 字段与默认值。** `crates/tauri-utils/src/config.rs` 的 `enum WebviewInstallMode`：`Skip` / `DownloadBootstrapper { silent: bool = true }` / `EmbedBootstrapper { silent: bool = true }` / `OfflineInstaller { silent: bool = true }` / `FixedRuntime { path: PathBuf }`；`impl Default` 是 `DownloadBootstrapper { silent: true }`；文档注释写明 `OfflineInstaller`「Does not require an internet connection. Increases the installer size by around 127MB.」、`FixedRuntime`「Increases the installer size by around 180MB.」。来源：[tauri-apps/tauri `crates/tauri-utils/src/config.rs`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs)（`WebviewInstallMode`）。
- **【源码】一个容易漏掉的离线细节：updater bundle 永远用 `DownloadBootstrapper`。** 同一处源码在 `WebviewInstallMode` 上有文档注释：「Note that for the updater bundle [`Self::DownloadBootstrapper`] is used.」。**对本项目的含义：我们不做自动更新（走 GitHub Releases + tag 手动分发），所以这条不影响；但如果日后加 Tauri updater，updater 产物的 WebView2 分发模式不受 `webviewInstallMode` 控制。**

- **【官方文档】「装不上的机器怎么办」的官方答案：Win10 1809+/Win11 上 WebView2 随系统分发。** Tauri 官方 Windows 页的 note 原文：「On Windows 10 (April 2018 release or later) and Windows 11, the WebView2 runtime is distributed as part of the operating system.」（Win10 2018 年 4 月版 = 1803；而硬约束是 1809+，落在该范围内）。**这条把「默认要联网」的风险大幅降低，但注意它的措辞是「随系统分发」而不是「必然预装」。** 另有官方 `minimumWebview2Version` 配置：「If your app requires features only available in newer Webview2 versions (such as custom URI schemes), you can instruct the Windows installer to verify the current Webview2 version and run the Webview2 bootstrapper if it does not match the target version.」——**注意后半句：版本不达标时它会去跑 bootstrapper，也就是又要联网。**
- **【官方文档】Microsoft 自己的说法比 Tauri 更保守，而且给了一手数字。** Microsoft Edge 开发者文档（`webview2/concepts/distribution.md`）原文要点：
  - 「The Evergreen WebView2 Runtime will be included as part of the **Windows 11** operating system. Various WebView2 apps have installed the Evergreen Runtime on devices with an operating system **prior to Windows 11**. However, **some devices might not have the Runtime pre-installed**, so it's a good practice to check whether the Runtime is present on the client.」——**即：Windows 11 是随 OS 带的，Windows 10（含 1809）不在这一句的保证范围内。**
  - 「The **vast majority** of Windows 10 devices have the WebView2 Runtime installed already ... **A small number of Windows 10 devices don't have** the WebView2 Runtime installed. We recommend that you handle this edge case」。
  - 分发工具的两条路：**在线**用「WebView2 Runtime Bootstrapper」——原文给了体积「a tiny (**approximately 2 MB**) installer」，它要从 Microsoft 服务器下载 Evergreen Runtime（这正对应 Tauri 的 `embedBootstrapper` 那个 +1.8 MB）；**离线**用「WebView2 Runtime **Standalone Installer**」——原文「a full installer that installs the Evergreen WebView2 Runtime in **offline environments**」（这对应 Tauri 的 `offlineInstaller` 那 +127 MB）。
  - 来源：[Microsoft Learn · Distribute your app and the WebView2 Runtime - Evergreen](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution)，原文 markdown：[MicrosoftDocs/edge-developer · distribution.md](https://github.com/MicrosoftDocs/edge-developer/blob/main/microsoft-edge/webview2/concepts/distribution.md)。
  - **对本项目的判断：** 「绝大多数 Win10 机器都有 WebView2」+「Windows 11 随 OS 带」这两条合起来，让 Tauri 的默认 `downloadBootstrapper` 在**绝大多数**机器上确实不会触发下载；但它一旦触发就要联网，与「完全离线可用」的硬约束正面冲突。**结论不变：要兑现「完全离线」，只能选 `offlineInstaller`（+~127 MB）或 `fixedRuntime`（+~180 MB）；用默认值属于「赌概率」。** 这条取舍应当由用户拍板，而不是由调研结论替用户决定。
- **【未找到一手依据】Win10 1809 上 WebView2 的**实际**预装/可升级覆盖率**：Microsoft 官方只给了「vast majority / a small number」的定性说法，没有量化数据。列入风险评估。
- **【源码】`minimumWebview2Version` 的位置在版本间搬过家：** 源码里 `WindowsConfig::minimum_webview2_version` 是现行字段，NSIS 配置里的同名字段标了 `#[deprecated(since = "2.10.0", note = "Use WindowsConfig::minimum_webview2_version instead.")]`。来源：[config.rs](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs)。
- **【未找到一手依据】Win10 1809 上 WebView2 的**实际**预装/可升级覆盖率**：Microsoft 官方文档给出了支持矩阵与「随 OS 分发」的表述，但本报告没找到「哪些机器上确实没有、比例多少」的一手数据。列入 spike / 风险评估。

### 3.1 结论

- **「完全离线」在 Tauri 里只有两个合格取值：`offlineInstaller`（+约 127 MB）或 `fixedRuntime`（+约 180 MB）。默认值 `downloadBootstrapper` 不合格。** 「+127 MB」相对我们本来就要随包的 48.2 MB LUT 量级相当，但**这 127 MB 是每个用户都要背的系统组件**，而 Win10 1809+/Win11 本来就分发 WebView2——为少数缺运行时的机器付全量体积，是本项目要做的一个明确取舍。
- `skip` 的官方警告是「Your application WILL NOT work if the user does not have the runtime installed and won't attempt to install it.」——离线安装包 + `skip` 组合等于「赌用户机器上有 WebView2」。

---

## 4. 体积与产物（NSIS + 便携 zip）

### 4.1 体积量级

- **【官方文档/官方数据】Electron 44.6.0 的 win32-x64 官方发行 zip 是 150.9 MB**（`electron-v44.6.0-win32-x64.zip`，GitHub Releases API 实测 asset size = 158,234,xxx 字节，`[math]::Round(size/1MB,1)` = 150.9；同一 release 里 `electron-v44.6.0-win32-x64-symbols.zip` 57.2 MB、`mksnapshot` 103.1 MB）。来源：[electron/electron Releases · v44.6.0 assets](https://github.com/electron/electron/releases/tag/v44.6.0)（经 GitHub Releases API 查询）。
  - **这是「未压缩运行时」的口径，不是安装包体积。** 压缩后（NSIS 用 LZMA）一般会显著变小；本报告**没有**拿到 Electron + electron-builder 空载 NSIS 安装包的一手实测数字，见第 9 节。
- **【官方文档/官方数据】+50 MB 前端资源的量级**：`dist/` 49.5 MB 里 48.2 MB 是已经 gzip 过的 `.cube.gz`，**再压几乎不缩水**。所以无论哪个壳，最终产物体积 ≈（壳的基线体积）+ 48 MB 左右（Electron 的 asar 会把这些文件一起打包；`.cube.gz` 是熵很高的已压缩数据，LZMA 收效甚微）。
- **【官方文档】Tauri 的官方定位就是「体积小」**：Tauri 官方有专门的 [App Size](https://v2.tauri.app/concept/size/) 章节讲体积优化（这也是它相对 Electron 的主要卖点）。**但本报告没有找到 Tauri 官方给出的 Windows NSIS 空载安装包的具体 MB 数**，见第 9 节。

### 4.2 静态资源是「嵌进二进制」还是「放旁边」

- **【源码】Tauri：`frontendDist` 的三种形态在源码里写得很清楚**——`FrontendDist::Url(Url)`「No assets are embedded in the app in this case」、`FrontendDist::Directory(PathBuf)`（前端 dist 目录）、`FrontendDist::Files(Vec<PathBuf>)`。来源：[tauri-apps/tauri `crates/tauri-utils/src/config.rs` · `enum FrontendDist`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs)。
  - **【社区报告/需 spike】「目录形态的前端资源最终是被嵌进 exe 还是作为旁挂文件」本报告未找到 Tauri 官方一句话说清。** Tauri 的资源嵌入走 `tauri-build` 的代码生成（`include_dir` 风格），社区普遍说法是**编译期嵌进二进制**；48 MB 已压缩数据嵌进 exe 会直接推高二进制体积、且每次构建都要重走一遍这段（**构建时间成本的量级未找到一手依据**）。另有 `bundle.resources`（`BundleResources`）用于把额外文件作为**旁挂资源**随包安装——`dist/` 里除了 `frontendDist` 之外的大文件走 `resources` 可以避免嵌 exe，**这条路线是否适用于 LUT 需要 spike**。
- **【官方文档】Electron：`asar` 归档 + `extraResources`。** Electron 打包的工具链细节（`files` glob、`asar`、`asarUnpack`、`extraResources`）都在 electron-builder 侧；本报告**未逐条核实** electron-builder 最新文档里这几个字段的当前语义（其官方文档站已迁到 Mintlify 托管版，详见第 9 节）。**实践含义（需 spike 确认）：48 MB 的 `.cube.gz` 放进 asar 还是 `extraResources`，影响的是「首次启动解压/读取路径」与便携版的自包含性。**

### 4.3 便携 zip 怎么出 —— 两个壳差别很大

- **Electron（electron-builder）：有专门的 `portable` target，也有通用 archive target。** 官方文档站「Building for Windows」页把 Windows target 分为 **NSIS / Portable / MSI** 三类，Portable 的描述是「Standalone executable without installation」，且有独立的「Portable App / Portable Environment Variables」小节（例如 `PORTABLE_EXECUTABLE_DIR`）。来源：[electron-builder · Building for Windows](https://mintlify.wiki/electron-userland/electron-builder/packaging/windows)。
  - **【源码】`portable` 是 NSIS target 的一个变体（同一套安装器代码，走不同分支），有独立的 `PortableOptions`。** 证据：`packages/app-builder-lib/src/targets/win/nsis/NsisTarget.ts` 里有 `import { NsisOptions, PortableOptions } from "./nsisOptions.js"`、`targetName === "portable"`、`private get isPortable(): boolean { return this.name === "portable" }`，以及 `const { unpackDirName, requestExecutionLevel, splashImage } = options as PortableOptions` 这样的分支。**即：`portable` = 免安装的单文件 exe（自解压到临时目录再跑），不是「目录 + zip」。** 来源：[electron-builder `NsisTarget.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/win/nsis/NsisTarget.ts)。
  - **【源码】`zip` / `7z` / `tar.*` 是跨平台的 archive target，Windows 上也能用。** 证据：`packages/app-builder-lib/src/targets/targetFactory.ts` 里有 `const archiveTargets = new Set(["zip", "7z", "tar.xz", "tar.lz", "tar.gz", "tar.bz2"])` 与 `packages/app-builder-lib/src/targets/ArchiveTarget.ts`。来源：[electron-builder `targetFactory.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/targetFactory.ts)、[`ArchiveTarget.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/targets/ArchiveTarget.ts)。
  - **【官方文档】多 target 的写法**：`win.target` 接受「一个字符串 / 一个 `TargetConfiguration` 对象 / 二者的数组」（`PlatformSpecificBuildOptions.target` 的官方 JSDoc：「The build target(s) for this platform. Can be a target name string, a `TargetConfiguration` object, or an array of either. Available targets depend on the platform — see platform-specific options (e.g. `WindowsConfiguration.target`)」）。来源：[electron-builder `PlatformSpecificBuildOptions.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts)。所以「NSIS + 便携」在 Electron 侧是**一个配置字段里列两个 target**，无需自己写脚本压包。
  - `portable` 与 `zip` 的区别（对本项目是实质性的）：`portable` 产出**单个自解压 exe**（免安装、双击即用，运行时解压到临时目录），`zip` 产出**压缩归档目录**（解压后得到完整的 `win-unpacked` 目录）。用户要的是「便携 zip」，**`zip` target 是字面匹配的答案**；`portable` exe 是另一种常见「便携版」形态，**要不要两个都出，留给下一张票决定**。
- **Tauri（`tauri-bundler`）：Windows 上只有 `msi` 与 `nsis` 两个安装器 target，源码里没有 portable/zip target。** 证据（源码级）：
  - `BundleType` 的字符串反序列化只认 `deb` / `rpm` / `appimage` / `msi` / `nsis` / `app` / `dmg`，其它一律报 `unknown bundle target '{s}'`。来源：[tauri `crates/tauri-utils/src/config.rs` · `impl Deserialize for BundleType`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs)。
  - `BundleTarget` 只有 `All` / `List(Vec<BundleType>)` / `One(BundleType)` 三种形态（同上）。
  - 官方 Windows 页也把 Windows 产物写成两类：「Tauri applications for Windows are either distributed as Microsoft Installers (`.msi` files) using WiX Toolset v3 or as setup executables (`-setup.exe` files) using NSIS」。来源：[Tauri v2 · Windows Installer](https://v2.tauri.app/distribute/windows-installer/)。
  - **结论：Tauri 侧「便携 zip」必须自己造**——`tauri build` 产出 `target/release/<app>.exe` 之后，把它（连同任何 `resources`）压成 zip，再作为一个 CI 步骤上传到 Release。**本报告未找到 Tauri 官方关于「便携版」的文档**（官方只讲 `.msi` / `-setup.exe`），所以这条属于「源码可证 + 官方无文档」，做法本身是社区惯例。**另一个必须 spike 的点：`-setup.exe`（NSIS）本身能不能当便携包用（它带安装逻辑，不是免安装 exe）。**
- **【官方文档】Tauri NSIS 侧的可用定制项**（都在 `bundle.windows.nsis` 下）：`installMode`（默认 per-user；`perMachine` 要管理员、装到 `Program Files`；`both` 让用户选）、`languages`（NSIS 多语言，单个安装器内含全部所选语言）、`displayLanguageSelector`、`template`（换成自定义 `.nsi`）、`installerHooks`（`NSIS_HOOK_PREINSTALL/POSTINSTALL/PREUNINSTALL/POSTUNINSTALL`）。来源：[Tauri v2 · Windows Installer · Customizing the NSIS Installer](https://v2.tauri.app/distribute/windows-installer/#customizing-the-nsis-installer)。
  - **注意 `installMode` 默认是 per-user**：装到 `%LOCALAPPDATA%`、不需要管理员。这与「不做代码签名、便携分发」的氛围一致。

---

## 5. ES module Worker + WASM + `DecompressionStream` + WebGL2 的坑

- **【官方文档】`DecompressionStream` 是 Baseline widely available，「available across browsers since May 2023」，并且明确「available in Web Workers」。** 来源：[MDN · DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream)。**推论：Electron 44（Chromium 152）与任何 Win10 1809+ 上「随系统分发」的 WebView2（Chromium 110+）都在这个 baseline 之后，gzip 解压这一环在两边都不构成门槛。**（Chrome 的具体起始版本号来自 caniuse 的 MDN 数据页，[caniuse · DecompressionStream](https://caniuse.com/mdn-api_decompressionstream)，属二级来源，仅作旁证。）
- **【官方文档】CSP 与 WASM**：Chromium 需要 `script-src` 里带 `'wasm-unsafe-eval'`（或放宽到 `'unsafe-eval'`）才允许编译 WebAssembly。Electron 官方安全文档的第 7 条要求「Define a Content-Security-Policy」并给了 `script-src 'self' https://apis.example.com` 的示例；**但本报告没有在 Electron 官方文档里找到「打包应用默认注入 CSP」的说明**——Electron 本身在没有 meta/header 时不会替你加 CSP（安全清单第 7 条把它列为**建议**）。来源：[Electron · Security · 7. Define a Content-Security-Policy](https://www.electronjs.org/docs/latest/tutorial/security#7-define-a-content-security-policy)。
  - **对本项目的含义**：`vite-plugin-wasm` 生成的加载代码会用 `WebAssembly.instantiate`，**如果我们自己加 CSP，就必须带上 `'wasm-unsafe-eval'`**；如果我们不加 CSP，就没有这道门槛。`file://` 下 CSP 只能靠 `<meta>`（官方原文：「it is not possible to use this method when loading a resource using the `file://` protocol」），自定义 scheme 下可以走响应头。
- **【官方文档】Tauri v2 的 CSP 默认是 `null`**（官方配置示例 `"app": { "security": { "csp": null } }`，`AppConfig` 的默认值块里 `security` 也不带 `csp`）。来源：[Tauri v2 · Configuration](https://v2.tauri.app/reference/config/)。Tauri 有专门的 CSP 安全文档页（[Content Security Policy (CSP)](https://v2.tauri.app/security/csp/)），并且有 `dangerousDisableAssetCspModification` 这类「Tauri 会改写 CSP」的开关——**Tauri 会往你声明的 CSP 里注入自己的 nonce/hash**，这套机制与 WASM 的 `'wasm-unsafe-eval'` 如何共存，本报告**未核实**，列入 spike。
- **【未找到一手依据】module worker（`new Worker(url, { type: 'module' }）`、`blob:` worker）在两个壳里的具体行为**：本报告未找到 Electron 官方或 Tauri 官方关于「ES module worker 在打包后的壳里能否加载、`blob:` worker 是否被 CSP 限制」的明确声明。已知的**结构性事实**（非一手来源）：Electron 自带完整 Chromium 152，module worker 与 `blob:` worker 都是 Chromium 早已支持的能力；Tauri 用系统 WebView2，能力取决于其 Chromium 版本。**这条必须 spike**（尤其 Tauri：`vite-plugin-wasm` 的 worker 产物在新旧 WebView2 上是否都能跑）。
- **【官方文档/官方数据】WebView2 的版本下限**：Tauri 官方有 [Webview Versions](https://v2.tauri.app/reference/webview-versions/) 参考页，并且安装器侧有 `minimumWebview2Version` 配置（见第 3 节）。**本报告没有逐个核实该页给出的最低版本号**，也未把「该最低版本是否 ≥ 支持 module worker / DecompressionStream 的 Chromium 版本」对上，列入 spike。
- **【官方文档】WebGL2**：本报告未找到任何一方官方文档说壳里 WebGL2 不可用；但「无 GPU / 驱动异常的机器上软件渲染能否跑起 WebGL2」只有 Chromium 的通用行为，**未找到壳专有的一手依据**。

---

## 6. tag 触发 Windows runner 打包

### 6.1 Tauri：`tauri-apps/tauri-action`

- **【官方文档】官方 GitHub 流水线页给了完整 workflow，并且明确写了「tag 触发」怎么写。** 原文（How to Trigger 一节）：默认示例是 `on: push: branches: [release]`（推 release 分支 → action 用应用版本自动建 tag 与 release 标题），并接着给另一种写法：

```yaml
name: 'publish'
on:
  push:
    tags:
      - 'app-v*'
```

来源：[Tauri v2 · Distribute · Pipelines · GitHub](https://v2.tauri.app/distribute/pipelines/github/)。
- **【官方文档】官方示例 workflow 的关键点**（同一页的 Example Workflow，与官方 examples 仓库 `publish-to-auto-release.yml` 一致）：
  - `permissions: contents: write`（上传 Release 资产需要）；
  - `runs-on: ${{ matrix.platform }}` + matrix 里 `windows-latest`；
  - `actions/checkout` → `actions/setup-node`（`node-version: lts/*`，可带 `cache: 'npm'`）→ `dtolnay/rust-toolchain@stable` → **`swatinem/rust-cache@v2`（官方示例显式带 `workspaces: './src-tauri -> target'`）** → `npm install` → `tauri-apps/tauri-action@v1`；
  - `tauri-action` 的输入：`tagName: app-v__VERSION__`（action 自动把 `__VERSION__` 替换成应用版本）、`releaseName`、`releaseBody`、`releaseDraft`、`prerelease`、`args`；环境变量 `GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}`。
  - **Windows runner 上不需要手动装 NSIS**：官方 workflow 里只有 ubuntu 分支装了系统依赖（`libwebkit2gtk-4.1-dev` 等），Windows 分支没有任何安装步骤。来源同上（Example Workflow 的步骤列表里「Install Linux system dependencies」明确标了 ubuntu only）。
  - 来源链接：[Tauri v2 GitHub 流水线](https://v2.tauri.app/distribute/pipelines/github/)、[tauri-action `examples/publish-to-auto-release.yml`](https://github.com/tauri-apps/tauri-action/blob/dev/examples/publish-to-auto-release.yml)、[tauri-action README（inputs）](https://github.com/tauri-apps/tauri-action#inputs)。
- **【官方文档】tauri-action README 里几条容易踩的规则**（原文要点）：`releaseId` 与 `tagName` 二选一；给了 `tagName` 但 Release 是 draft 时 `releaseDraft` 必须也是 `true`；**「If you only want to build the app without having the action upload any assets ... simply omit `tagName`, `releaseName` and `releaseId`」**（只想构建产物、走 `actions/upload-artifact` 就省略这三个）；README 里还有 Troubleshooting「GitHub Environment Token」一节（对应 workflows 里 `permissions: contents: write` 的坑）。来源：[tauri-action README](https://github.com/tauri-apps/tauri-action/blob/dev/README.md)。

### 6.2 Electron：electron-builder

- **【未找到一手依据（本次核实范围内）】** electron-builder 的官方文档站已从 `electron.build`（Docusaurus）迁到 Mintlify 托管版本：`https://www.electron.build/win/` 现在返回**空内容**，可读版本在 `https://mintlify.wiki/electron-userland/electron-builder/packaging/windows`（页面标注「Generated Mar 4, 2026 ... Powered by Mintlify」，属于**第三方托管的镜像/生成站**，不是 `electron.build` 自己的域名）。**因此本报告对 electron-builder 的一切结论都按「源码/生成文档」等级标注，不敢标成一手官方文档。**
- **【源码】`publish` 与多 target 的配置面在源码里存在**（`PlatformSpecificBuildOptions.target` 的 JSDoc 见 4.3），但**「tag 触发 + `--publish always`」的官方示例本报告未在官方域名的文档里找到**，见第 9 节。

---

## 7. 候选对比与推荐

### 7.1 对比表

| 维度 | Electron（44.x） | Tauri v2（2.x + WebView2） |
| --- | --- | --- |
| 前端 origin / `fetch` 相对 URL | `loadFile` 是 `file://`，官方明确**不推荐**（非 standard scheme：不解析相对 URL、禁 web storage/FSA）；标准做法是 `protocol.registerSchemesAsPrivileged({standard,secure,supportFetchAPI})` + `protocol.handle`/`registerSource` | `http://tauri.localhost`（官方 issue #13262 证实），是真 http scheme，相对路径 fetch 应在协议层直接可用 |
| Web 平台能力来源 | **随包的 Chromium 152**，用户机器无关 | **用户机器上的 WebView2**（Win10 1809+/Win11 随系统分发），版本不可控 |
| `showDirectoryPicker` | 已实现（官方文档示例就在调它）；权限模型有历史坑（≤29 靠实验开关、30–37 持久权限回归、2025-09 修复）；受限目录要配 `file-system-access-restricted` | **未找到一手依据**；生态惯例是走官方 dialog 插件（= 要改 `src/`，违反「单一代码库只做壳」的约束） |
| 完全离线 | 天然离线（Chromium 随包，无需任何运行时下载） | **必须选 `offlineInstaller`（+127 MB）或 `fixedRuntime`（+180 MB）**；默认 `downloadBootstrapper` 要联网（Microsoft 官方：Evergreen Runtime 随 Windows 11 分发，Win10 是「绝大多数已有、少数没有」） |
| 安装包体积基线 | 大（官方 win32-x64 运行时 zip 150.9 MB；NSIS 实测数字未取得） | 小（官方主打卖点；**NSIS 空载具体 MB 未取得**） |
| 48 MB LUT 随包 | asar / `extraResources`，前端零改造 | 若走 `frontendDist` 则**编译期嵌入二进制**（体积与构建时间代价未量化）；或走 `resources` 旁挂 |
| 便携 zip | electron-builder 原生 target（`portable` / `zip`），一个配置字段搞定 | **bundler 只有 `msi`/`nsis`**；便携 zip 得自己在 CI 里压 exe |
| CI | 需自行拼 GitHub Actions（`GH_TOKEN`、tag 触发） | 官方 `tauri-apps/tauri-action@v1` 有 tag 触发 + Release 上传的官方示例 |
| 日后 macOS/Linux | 同一份 `src/`，换 target 即可；Electron 跨平台成熟 | 同一份 `src/`，`tauri build` 换 platform；macOS 需 Apple 签名（不做签名会被 Gatekeeper 拦，官方有 ad-hoc 签名指引） |

### 7.2 三个「一句话」候选（按要求不展开）

- **NW.js**：能力与 Electron 高度重叠（同样自带 Chromium + Node），但生态与打包工具链（nw-builder 等）的维护活跃度、现代 Vite/ESM/WASM 场景的文档都明显弱于 Electron，放在同一份 `src/` 上不会带来任何 Electron 没有的能力——**不选**。
- **Neutralino**：极轻（用系统 WebView），但**同样受制于系统 WebView 版本、且没有 Tauri 那样的官方 CI action/Bundler 生态**，还要自己解决「前端资源怎么随包」；在「完全离线 + 48 MB 全量随包」的要求下比 Tauri 更没保障——**不选**。
- **Wails**：Go 后端 + 系统 WebView，Windows 上同样依赖 WebView2 的离线分发问题，且它的前端资源嵌入/打包约定与 Vite 多 Worker + WASM 的场景没有现成官方指引——**不选**。
  - （以上三句均为**基于「能力重叠 + 生态/文档成熟度」的判断**，**未做逐条一手取证**；按用户要求只给一句结论。）

### 7.3 推荐

**推荐 Electron，但推荐的理由是「风险最低」而不是「最优」。**

- 决定性理由只有一条：**本项目的 `fetch()` 取相对路径静态资源是第一道关，而 Electron 是唯一能把这道关变成「确定行为」的候选**——`protocol.registerSchemesAsPrivileged({standard: true, secure: true, supportFetchAPI: true})` + `protocol.handle`（或 `registerSource`）是官方文档的正面写法，且这套 privileges 组合同时把 IndexedDB 与 File System Access 从「非 standard scheme 默认禁用」里救回来（官方 `protocol` 文档原文）。Tauri 侧虽然 `http://tauri.localhost` 看着更省事，但**「它到底是不是真 http scheme、asset scope/CSP 有没有额外限制」本报告没有拿到足够硬的一手依据**，且 WebView2 的 FSA 可用性完全查不到。
- 第二条理由：**48.2 MB LUT 与「完全离线」这两条硬约束，在 Electron 里是零改造**（Chromium 随包、asar 随包）；在 Tauri 里则各自要额外决策（嵌 exe vs `resources`、`offlineInstaller` +127 MB），决策点越多，下一张票越容易翻车。
- 第三条理由：**`showDirectoryPicker` 在 Electron 里有官方文档背书（示例代码在用）+ 一套可配的权限/受限目录机制**；Tauri/WebView2 侧完全查不到，一旦不支持就得在 `src/` 里加 Tauri 专有分支，直接撞「单一代码库只做壳」的硬约束。
- 代价（要如实接受）：**安装包体积远大于 Tauri**（官方 win32-x64 运行时 zip 150.9 MB，加 48 MB 资源后 NSIS 预计在百 MB 量级——**具体数字必须 spike 实测**）。

**什么情况下改主意（改选 Tauri）：**
1. spike 证明 Electron 的 `protocol` + `fetch` 路径有阻塞性问题（例如自定义 scheme 下 `DecompressionStream`/module worker/`import.meta.glob` 的绝对路径三件事里有一件修不动），**并且** Tauri 侧 `http://tauri.localhost` 的 `fetch('./assets/*.cube.gz')` 在真实 WebView2 上一把过；
2. 或者用户把「安装包必须 < 50 MB」变成硬指标（那 Tauri 是唯一选项，代价是 `offlineInstaller` +127 MB 让这个目标本身变得没意义——**两条约束会互相打架，需要用户裁决**）；
3. 或者 spike 证明 WebView2 里 `showDirectoryPicker` 可用、而 Electron 侧在 Windows 上不可用（当前证据强烈指向相反方向）。

---

## 8. 必须靠 spike 实测才能定的问题清单（给下一张票）

按优先级排，每条都写清「怎么算过 / 怎么算不过」。

**Electron 侧（推荐路线，先做）**
1. **自定义 scheme 下的 `fetch` + `import.meta.glob` 绝对路径**：用 `app://bundle/`（`standard+secure+supportFetchAPI`）+ `protocol.handle` 起一个最小工程，`loadURL('app://bundle/index.html')`，验证 `fetch(entry.url)` 能拿到 `/assets/xxx.cube.gz`（Vite `base='/'`）与 `./assets/...`（`base='./'`）两种情形。**过 = 至少一种能拿到 48 MB 文件；不过 = 改走 `registerSource` 或调整 `base`。**
2. **`showDirectoryPicker` 在 Windows x64 Electron 44 上的一次性授权可用性**：点击 → 选目录 → 读到文件列表 → 本次会话完成任务；**并测「用户取消」与「选到受限目录」两种 AbortError 是否可区分**（决定要不要挂 `file-system-access-restricted`）。**这是「要不要保留 `<input webkitdirectory>` 降级」的判据。**
3. **ES module Worker + WASM + `DecompressionStream` 全链路**：`new Worker(..., { type: 'module' })` 在 `app://` 下能否加载（`vite-plugin-wasm` + top-level-await 产物是否兼容）、`blob:` worker 有没有被 CSP 影响、`WebAssembly.instantiate` 是否需要在 `<meta>` CSP 里加 `'wasm-unsafe-eval'`。
4. **体积与产物实测**：`electron-builder --win nsis zip`（或 `portable`）打出真实数字——NSIS 安装包 MB、zip MB、解包后目录 MB；确认 48.2 MB `.cube.gz` 走 asar 还是 `extraResources`；确认**不做签名**时 electron-builder 是否会因为要下载 winCodeSign 之类而联网（离线 CI 能否跑通）。**这条也直接回答「便携 zip」是否就用 `zip` target。**
5. **WebGL2 在无 GPU/远程桌面/软件渲染场景**下能否起来，以及 `app.disableHardwareAcceleration()` 时是否降级成功。
6. **离线机器上首次启动**：确认没有任何运行时会偷偷联网（Electron 本身不下载，但 `net.fetch`/更新检查要有意识地不开）。

**Tauri 侧（只在 Electron spike 失败时才需要查）**
7. `fetch('./assets/x.cube.gz')` 在真实 WebView2（Win10 1809 上那颗 + 最新 Evergreen 各一台）上是否直接可用；asset protocol / CSP 是否额外挡路。
8. `window.showDirectoryPicker` 在 WebView2 里是否存在；不存在时改走 dialog 插件对 `src/` 的侵入面有多大（**这可能直接否掉 Tauri**）。
9. `frontendDist` 的 48 MB 是嵌 exe 还是旁挂（看 `target/release/*.exe` 体积与构建耗时）；`bundle.resources` 能否替代。
10. 便携 zip 的自造流程（`tauri build` 产物 + `resources` 一起压包）能否在 CI 上稳定跑通；`-setup.exe` 是否可当便携包。
11. `webviewInstallMode: offlineInstaller` 后安装包真实体积（官方说 +127 MB）。

---

## 9. 未找到一手依据（本次调研的空白）

1. **Electron + electron-builder 空载 NSIS 安装包/便携 zip 的一手体积数字**：没拿到官方或可靠一手来源的实测值（Electron 官方 release 只给运行时 zip = 150.9 MB，不等于安装包）。
2. **Tauri 空载 NSIS 安装包的具体 MB 数**：官方只有 [App Size](https://v2.tauri.app/concept/size/) 这类概念页，没有给出 Windows NSIS 的具体基线数字。
3. **WebView2 是否实现 `window.showDirectoryPicker`**：Microsoft Learn / Chromium/Edge 官方文档里没查到可用性或版本门槛的明确说法；连「社区报告」都很少（Tauri 生态惯例是走官方 dialog 插件）。
4. **Electron 在 `file://` 下 `fetch('./x')` 的确切失败形式与错误文案**：官方文档只给了「非 standard scheme 不解析相对 URL + 禁用 web storage/FSA」以及安全清单第 18 条「Avoid usage of the `file://` protocol and prefer usage of custom protocols」，**没有一句话直说「`fetch` 会被以 scheme 为由拒绝」**。本报告因此只写「官方明确不推荐 `file://`」，没有把「Chromium 以 scheme 不是 http/https 为由拦掉」写成结论。
5. **Tauri `app.windows[].useHttpsScheme` / `dangerousUseHttpScheme` 在 v2 的最终字段名与默认值**：只确认了 `http://tauri.localhost` 这个实际 origin（官方 issue #13262），没逐字核实字段定义。
6. **Tauri `frontendDist` 资源是「编译期嵌进 exe」还是「旁挂」的官方表述**：只从源码确认了 `FrontendDist` 有三种形态，没有官方文档一句话说明嵌入方式与 48 MB 的代价。
7. **electron-builder 的官方文档站**：`https://www.electron.build/win/` 现在返回空内容，可读内容在第三方托管/生成站（`mintlify.wiki`，页面标注由 Mintlify Atlas 生成）。**因此 electron-builder 相关结论都按「源码/生成文档」等级标注，未按一手官方文档采信。**「electron-builder tag 触发 + `--publish always` 的官方示例」同样没在官方域名下找到。
8. **`wasm-unsafe-eval` 在两个壳里的实际必要性**：Electron 官方安全文档给了 CSP 建议但没谈 WASM；Tauri 有 CSP 页但「Tauri 注入 nonce 后 WASM 会不会被挡」本报告未核实。MDN/Chromium 侧对 `'wasm-unsafe-eval'` 的说明属 Web 平台通用知识，不是壳专有结论。
9. **module worker 与 `blob:` worker 在打包壳里的行为**：两边官方文档都没写；只能靠 spike。
10. **NW.js / Neutralino / Wails 的逐条取证**：按用户要求只给一句结论，**没有做一手核实**（第 7.2 节已标注）。

---

## 10. 参考链接汇总

- [Electron `protocol` API](https://www.electronjs.org/docs/latest/api/protocol)（`registerSchemesAsPrivileged` / `protocol.handle` / `registerSource`）
- [Electron Security 教程](https://www.electronjs.org/docs/latest/tutorial/security)（第 6 条 webSecurity、第 7 条 CSP、第 18 条避免 `file://`）
- [Electron `session` API](https://www.electronjs.org/docs/latest/api/session)（`file-system-access-restricted` 事件 + `showDirectoryPicker` 示例）
- [Electron 44 发布公告](https://www.electronjs.org/blog/electron-44-0)（Chromium 152 / Node 24.18.1；取消 32 位）
- [electron/electron#41957](https://github.com/electron/electron/issues/41957)（FSA 持久权限回归与修复）
- [electron/electron#42459](https://github.com/electron/electron/issues/42459)（blocklisted 目录的 AbortError）
- [electron/electron#28422](https://github.com/electron/electron/issues/28422)（FSA 权限对话框缺失，原始 issue）
- [electron/electron#48170](https://github.com/electron/electron/pull/48170)（`fileSystem` 权限持久化）
- [electron/electron Releases v44.6.0](https://github.com/electron/electron/releases/tag/v44.6.0)（win32-x64 运行时 zip 150.9 MB）
- [electron-builder · Building for Windows](https://mintlify.wiki/electron-userland/electron-builder/packaging/windows)（第三方托管生成站）
- [electron-builder `PlatformSpecificBuildOptions.ts`](https://github.com/electron-userland/electron-builder/blob/master/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts)
- [Tauri v2 · Windows Installer](https://v2.tauri.app/distribute/windows-installer/)（WebView2 安装模式对比表、NSIS 定制）
- [Tauri v2 · Configuration 参考](https://v2.tauri.app/reference/config/)
- [Tauri v2 · GitHub 流水线](https://v2.tauri.app/distribute/pipelines/github/)
- [Tauri v2 · App Size](https://v2.tauri.app/concept/size/)
- [tauri-apps/tauri `crates/tauri-utils/src/config.rs`](https://github.com/tauri-apps/tauri/blob/dev/crates/tauri-utils/src/config.rs)（`WebviewInstallMode` / `BundleType` / `FrontendDist`）
- [tauri-apps/tauri#13262](https://github.com/tauri-apps/tauri/issues/13262)（`http://tauri.localhost`）
- [tauri-action `examples/publish-to-auto-release.yml`](https://github.com/tauri-apps/tauri-action/blob/dev/examples/publish-to-auto-release.yml)
- [tauri-action README](https://github.com/tauri-apps/tauri-action/blob/dev/README.md)
- [MDN · DecompressionStream](https://developer.mozilla.org/en-US/docs/Web/API/DecompressionStream)
