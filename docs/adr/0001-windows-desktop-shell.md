# Windows 桌面外壳选 Electron

**Status**: accepted

本项目是纯前端 Web 应用（React + Vite + WebGL2，RAW 解码是 LibRaw 的 WASM 跑在 ES module Worker 里），要交付一个 Windows 安装包：完全离线、48.2 MB 官方 LUT 全量随包、NSIS 安装版 + 便携 zip、不做代码签名、只做壳不加桌面特性、单一代码库（Web 与桌面共用 `src/`，不 fork）、只出 Windows x64 但不得堵死 macOS/Linux。

**决定：用 Electron 做壳，并按纸面取证定下来**——spike 的作用是证实与找适配点，不是用来选谁。

决定性的一条是资源加载：官方 LUT 走 `import.meta.glob('/3DLUT/**/*.cube.gz', { query: '?url' })` 在构建期扫成 URL 表，运行时 `fetch(entry.url)` + `DecompressionStream` 解压。Electron 是唯一能把这道关变成**确定行为**的候选——官方正面写法 `protocol.registerSchemesAsPrivileged({ standard: true, secure: true, supportFetchAPI: true })` + `protocol.handle`/`registerSource`，而这套 privileges 同时把 IndexedDB 与 File System Access 从「非 standard scheme 默认禁用」里救回来。

## Considered Options

- **Electron（选中）**：Chromium 随包，用户机器上的浏览器版本无关；`showDirectoryPicker` 有官方文档背书（`session` 文档的 `file-system-access-restricted` 示例代码就在调它）；「完全离线 + 48 MB 资产随包」零改造；electron-builder 原生就有 NSIS 与便携 zip target。代价是体积。
- **Tauri v2 + WebView2（否决）**：`http://tauri.localhost` 这个 origin 看着更省事，但 asset scope / CSP 是否额外挡路拿不到够硬的一手依据，**WebView2 是否支持 `showDirectoryPicker` 完全查不到一手依据**——一旦不支持就得在 `src/` 里加 Tauri 专有分支，直接撞「单一代码库、只做壳」。它要兑现「完全离线」只能用 `offlineInstaller`（+127 MB）或 `fixedRuntime`（+180 MB），体积这块招牌当场作废；便携 zip 还得出 CI 自己压。**否决它不是因为体积小不好，而是因为它的两条主打优势在本项目的硬约束下都不成立。**
- **NW.js / Neutralino / Wails（否决）**：能力与上面两者重叠，而生态与「Vite 多 Worker + WASM」场景的文档更弱；Neutralino 与 Wails 在 Windows 上同样受制于 WebView2 的离线分发。这三条未逐条取证。

## Consequences

- **安装包体积上百 MB 量级**：Electron 44 官方 win32-x64 运行时 zip 150.9 MB，叠加 48.2 MB 已 gzip 的 LUT 后几乎不缩水。**安装包软目标 ≤ 250 MB**；NSIS 实际值由 spike 实测。
- **渲染进程不开 Node 能力**：只做壳 ⇒ `contextIsolation: true`、`sandbox: true`、不写 preload、不引入 IPC，自定义协议与一切文件访问都留在主进程。这也是「桌面专属特性」被划到本 effort 之外的自然结果。
- **CI 要自己拼**：Electron 没有 Tauri 那样的官方 tag-action，`GH_TOKEN`、tag 触发与产物上传都得自己写（归发版链路票）。
- **macOS/Linux 日后仍复用同一份 `src/`**：换 electron-builder 的 target 即可，符合「只出 Windows 但不堵死跨平台」。

## Revisit when

1. spike 证明 Electron 的 protocol + fetch 路径有阻塞性问题（例如自定义 scheme 下 `DecompressionStream` / module worker / `import.meta.glob` 产出的绝对路径这三件事里有一件修不动），**并且** Tauri 侧在真实 WebView2 上一把过；
2. 体积被改成硬指标（那 Tauri 是唯一选项，但它自己的 `offlineInstaller` +127 MB 会让这个目标失去意义——两条约束互相打架，需要重新裁决）；
3. spike 证明 WebView2 里 `showDirectoryPicker` 可用、而 Electron 侧在 Windows 上不可用。

一手取证、11 条 spike 必测项与证据空白清单在 [`research/desktop-shell-facts.md`](../../research/desktop-shell-facts.md)；决策票是 [定下桌面外壳路线](https://github.com/KimHoLau/raw-images-studio/issues/40)。
