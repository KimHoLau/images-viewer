# electron-builder 发版事实调研：NSIS / 便携 zip / 无签名 / tag 触发 CI

> **项目：** raw-images-studio（React 19 + Vite 6 + TS strict，Electron 壳，完全离线，Windows x64，NSIS 安装版 + 便携 zip，**完全不做代码签名**，分发走 GitHub Releases、`v*` tag 触发 CI）
> **问题：** 把「打包成 Windows 安装包」这条链路里**还没有一手依据**的 8 组问题查清，供 `docs/spec-windows-installer.md` 直接引用
> **日期：** 2026-10-11
> **方法：** 只查一手来源（electron-builder 官方源码与官方文档站、Electron 官方文档与 API 结构定义、W3C CSP3 规范及其官方 PR、Microsoft Learn、GitHub Actions/CLI 官方文档与 action 官方仓库 README）。每条结论标注证据等级。
> **本文档与既有调研的关系：** `research/electron-shell-spike.md`（票 41）与 `research/desktop-shell-facts.md`（选型调研）已经覆盖的东西**本文不重复**，只补它们点名留白的缺口。两处需要修正的旧结论见第 1 节。

---

## 证据等级约定

沿用 `research/desktop-shell-facts.md` 的四种标记：

| 标记 | 含义 |
| --- | --- |
| 【官方文档】 | 该项目的官方文档站里的原文 |
| 【官方源码】 | 官方仓库源码 / 官方 API 结构定义 / 官方模板脚本里的原文 |
| 【官方 issue/PR】 | 官方仓库的 issue / PR / release notes 原文（含规范仓库的 PR） |
| 【未取到一手依据】 | 没查到，本报告不猜 |

**版本基准（本报告写死，请与 spec 对齐）：** electron-builder **26.17.0**（当前 stable，release 日期 2026-09-26，[releases/latest](https://api.github.com/repos/electron-userland/electron-builder/releases/latest) 实测）；其官方文档站同时提供 **next (v27，未发布)** 与 **v26** 两个版本树。本报告**凡涉及 v26 与 v27 行为不同处，都会分别标注**；配置项默认以 **v26.17.0 的选项名**为准（因为 v27 未发布）。

---

## 1. 结论先行

**8 个问题的答案，一句话版：**

| # | 问题 | 答案 | 等级 |
| --- | --- | --- | --- |
| 1 | NSIS 选项语义与默认值 | `oneClick` **默认 `true`**（默认就是无向导的 one-click）；**只有 `allowToChangeInstallationDirectory` 是硬性的「`oneClick: false` 专属」——`oneClick: true` 时设它会直接抛错**；`deleteAppDataOnUninstall` 官方 JSDoc 自称 one-click only | 【官方源码】+【官方文档】 |
| 2 | **asar 里的文件能不能被 `protocol.handle` + `net.fetch('file://…')` 读到** | **能。** 三条官方文档合起来构成确定依据（asar 是 `file:` 协议的虚拟目录 + `net.fetch` 支持 `file:` + 官方示例就是 `net.fetch(pathToFileURL(...))`）。**48.2 MB 不需要解包出 asar** | 【官方文档】（合取，无单句直述） |
| 3 | `zip` vs `portable` | `portable` = **NSIS 变体的单文件 exe**，运行时自解压到 `$PLUGINSDIR\app`（或 `$TEMP\<unpackDirName>`）、退出时 `RMDir /r` 自清；**没有传 `--user-data-dir`，所以 userData 与安装版同址**；默认产物名 `raw-images-studio 0.1.0.exe` vs zip 的 `raw-images-studio-0.1.0-win.zip` | 【官方源码】 |
| 4 | 版本号与 git tag | `version` 来自 `package.json`；`-c.extraMetadata.version=…` **确实能**改变 version 全链路（源码里 `extraMetadata` 在 `AppInfo` 构造**之前**深合并）；publish 路径的 tag 是 **`"v" + version` 反推**的，**不读 git tag** | 【官方源码】+【官方文档】 |
| 5 | 不签名 | 无证书时 v26 **不会**为签名去下 `winCodeSign`（源码在取 signer 路径**之前**就 return 了）；但**仍会下载 Electron / NSIS / 7zip 三个工具包**；`win.signAndEditExecutable: false` **是本项目不该用的选项**（会连图标和版本信息一起关掉），正确选项是 **`signExecutable: false`**；`CSC_IDENTITY_AUTO_DISCOVERY` **只管 macOS** | 【官方源码】 |
| 6 | SmartScreen 对未签名 exe | 微软官方原文：未签名 = 「Windows protected your PC」，**用户必须选 "Run anyway"**；未签名文件**每个新版本都从零重建声誉**；企业策略可以**完全禁止继续**；Win11 的 Smart App Control 对**所有可执行文件**（不限于下载来的）拦截未签名文件 | 【官方文档】Microsoft Learn |
| 7 | tag 触发发版链路 | 官方推荐 = `on.push.tags: ['v*']` + `permissions: contents: write` + `GH_TOKEN`；**`--publish always` 重跑安全**（422 already_exists 会被捕获→删除同名资产→重传）；**`gh release upload` 不加 `--clobber` 会失败，加了有「删了旧的但新的没传上去」的窗口**；softprops 的 `overwrite_files` **默认 true** 但**会把你已有的 draft 发布出去**除非显式 `draft: true` | 【官方文档】+【官方源码】 |
| 8 | 自定义协议与 CSP | 四个 privilege 里 **`stream` 只关乎 `<video>`/`<audio>`**（不是「大文件才要开」）；`secure` 与 `supportFetchAPI` 官方只有一句话；`registerSource` 官方明说**支持从 asar 读**且**推荐**给「只服务自家文件」的 scheme；`'wasm-unsafe-eval'` 管的是 5 个 WASM 编译入口（有规范原文清单）；**CSP 里 blob worker 走 `worker-src` → `child-src` → `script-src` → `default-src` 的回退链**；**`DecompressionStream` 与 CSP 的关系：未取到一手依据** | 【官方文档】+【官方 PR/规范】 |

### 1.1 对既有两份调研的修正（重要，spec 请按本节）

| 旧结论（出处） | 现在的事实 | 依据 |
| --- | --- | --- |
| 「electron-builder 的官方文档站已从 `electron.build` 迁到 Mintlify；`https://www.electron.build/win/` 返回空内容，可读内容在第三方托管站 `mintlify.wiki`」（`desktop-shell-facts.md` §6.2 / §9.7） | **官方域名现在完全可用**，且是 Docusaurus 站：`/docs/` 是 **next (v27)**，`/v26/` 是当前 stable。页面里的文档链接也写作 `https://www.electron.build/docs/...`。**不要再引用 `mintlify.wiki`** | 实测 [`https://www.electron.build/docs/nsis/`](https://www.electron.build/docs/nsis/) 返回 200 且正文完整 |
| 「`win.signAndEditExecutable: false` 是跳过签名的开关」 | v26.17.0 的官方 JSDoc 写得很明确：它管的是 **resedit 资源编辑**（图标 / 版本信息 / 执行级别 / publisher），**默认 `true`**；「To skip only code signing while keeping resource editing, use `signExecutable: false` instead」。**本项目要的是 `signExecutable: false`（v26）或 `win.sign: false`（v27）** | [v26.17.0 `winOptions.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/options/winOptions.ts) |
| 「`CSC_IDENTITY_AUTO_DISCOVERY=false` 是不签名构建的常用开关」（社区普遍说法） | 源码里它只被 **macOS 的签名模块**读取，`isAutoDiscoveryCodeSignIdentity()` 的调用点全在 `codeSign/mac/`。**对 Windows 构建零作用** | [`util/flags.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/util/flags.ts) + [`codeSign/mac/macCodeSign.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/codeSign/mac/macCodeSign.ts) |
| 「48.2 MB 很大，所以协议要开 `stream: true`」（一种直觉读法） | 官方对 `stream` 的定义**只讲 `<video>`/`<audio>`**："Protocols that use streams (http and stream protocols) should set `stream: true`. The `<video>` and `<audio>` HTML elements expect protocols to buffer their responses by default." —— **和 `fetch()` 大文件无关** | [Electron `protocol` 文档](https://www.electronjs.org/docs/latest/api/protocol) |
| 未提及 | **`directories.output` 的默认值是 `dist`，而本仓库 Vite 的产物目录也是 `dist/`。** 这是一处**必须显式改掉**的默认值冲突 | [`configuration.ts` · `MetadataDirectories.output`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/configuration.ts) |

---

## 2. Q1 · NSIS 选项的语义与默认值

**结论先行：** 13 个选项里，**只有 `allowToChangeInstallationDirectory` 是「`oneClick: false` 专属」的硬约束**（在 `oneClick: true` 下设它会 `throw new InvalidConfigurationError`）；`deleteAppDataOnUninstall` 官方 JSDoc 自称「one-click installer only」，但源码里 define 是无条件设的（见 2.3）；其余选项在两种模式下都生效，只是**含义随 `oneClick` 变**（最典型是 `perMachine`）。

### 2.1 总表（默认值全部取自 v26.17.0 的 JSDoc 与 v27 官方文档站）

| 选项 | 类型 | 默认值 | 语义 | 与 `oneClick` 的关系 |
| --- | --- | --- | --- | --- |
| `oneClick` | boolean | **`true`** | "Whether to create one-click installer or assisted." | 它是**总开关**：`true` = 一键安装（无向导）；`false` = assisted（有向导） |
| `perMachine` | boolean | **`false`** | 见 2.2 的官方三段原文 | **两种模式都生效，但含义不同**：`oneClick:true` 时决定「是否装给所有用户」；`oneClick:false` 时决定「要不要显示安装模式选择页」 |
| `allowToChangeInstallationDirectory` | boolean | **`false`** | "*assisted installer only.* Whether to allow user to change installation directory." | **硬性 `oneClick:false` 专属**：`oneClick:true` 时设它 → 构建失败 |
| `createDesktopShortcut` | boolean \| `"always"` | **`true`** | "Whether to create desktop shortcut. Set to `always` if to recreate also on reinstall (even if removed by user)." | 两种模式都有意义（assisted 下对应复选框、one-click 下直接建） |
| `createStartMenuShortcut` | boolean | **`true`** | "Whether to create start menu shortcut." | 两种模式都有意义 |
| `shortcutName` | string \| null | **应用名**（`sanitizedProductName`，为空/全空格时回落到它） | "The name that will be used for all shortcuts. Defaults to the application name." | 两种模式都有意义 |
| `menuCategory` | boolean \| string | **`false`**（v26 JSDoc）/ 文档站写 `false` | 为开始菜单快捷方式与程序目录建子菜单；`true` = 用公司名 | 两种模式都有意义；**`true` 时若 `package.json` 没有 `author` 会抛错**（本仓库没有 `author`） |
| `deleteAppDataOnUninstall` | boolean | **`false`** | "*one-click installer only.* Whether to delete app data on uninstall." | 官方 JSDoc 说 one-click only，但源码无条件设 define（见 2.3） |
| `artifactName` | string \| null | NSIS：`${productName} Setup ${version}.${ext}`；portable：`${productName} ${version}.${ext}` | artifact 文件名模板，支持宏 | 与 `oneClick` 无关，但与 target 有关 |
| `compression` | `CompressionLevel` | **`normal`** | "The compression level. If you want to rapidly test build, `store` can reduce build time significantly. `maximum` doesn't lead to noticeable size difference, but increase build time." | 与 `oneClick` 无关 |
| `include` | string \| string[] \| null | **`build/installer.nsh`** | 追加自定义 NSIS include 脚本（不改主脚本） | portable **不回落**到 `build/installer.nsh`（见 2.4） |
| `script` | string \| null | **`build/installer.nsi`** | 整份替换 NSIS 主脚本 | 官方有明确警告，见 2.4 |
| `differentialPackage` | boolean \| `"compressed"` \| `"store-asar"` | **`true`** | 给差分下载用（blockmap / 打包方式） | portable 不参与（`isBuildDifferentialAware` 里 `!this.isPortable`） |
| `uninstallDisplayName` | string \| null | **`${productName} ${version}`** | 控制面板里的卸载项显示名，走 `expandMacro` | 与 `oneClick` 无关 |

### 2.2 `perMachine` 的官方三段原文（【官方源码】，v26 JSDoc）

> Whether to show install mode installer page (choice per-machine or per-user) for assisted installer. Or whether installation always per all users (per-machine).
>
> If `oneClick` is `true` (default): Whether to install per all users (per-machine).
>
> If `oneClick` is `false` and `perMachine` is `true`: no install mode installer page, always install per-machine.
>
> If `oneClick` is `false` and `perMachine` is `false` (default): install mode installer page.
>
> `@default false`

来源：[v26.17.0 `nsisOptions.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts)（v27 的 [`/docs/nsis/`](https://www.electron.build/docs/nsis/) 逐字相同）。

### 2.3 `allowToChangeInstallationDirectory` 是唯一会在 `oneClick: true` 下**报错**的选项（【官方源码】）

`NsisTarget.configureDefines()` 里的原文：

```ts
if (options.allowToChangeInstallationDirectory) {
  if (oneClick) {
    throw new InvalidConfigurationError("allowToChangeInstallationDirectory makes sense only for assisted installer (please set oneClick to false)")
  }
  defines.allowToChangeInstallationDirectory = null
}
```

来源：[v26.17.0 `NsisTarget.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts)。

官方文档的常见问题一节也给了正面答案（【官方文档】）：

> **Is it possible to make a single installer that will allow configuring user/machine installation?**
> Yes, you need to switch to assisted installer (not default one-click).
>
> ```json
> "build": { "nsis": { "oneClick": false } }
> ```

来源：[electron-builder · NSIS · Common Questions](https://www.electron.build/docs/nsis#common-questions)。

**`deleteAppDataOnUninstall` 的不一致（半取到）：** JSDoc 写 "*one-click installer only.*"，但 `configureDefines()` 里是**无条件** `if (options.deleteAppDataOnUninstall) { defines.DELETE_APP_DATA_ON_UNINSTALL = null }`，没有包在 `if (oneClick)` 分支里。**我没有逐行读 NSIS 模板去确认 `DELETE_APP_DATA_ON_UNINSTALL` 在 assisted 模式下是否真的不生效** —— 见第 10 节第 6 条。

### 2.4 `include` / `script` 能改什么

**官方对 `script` 的警告（【官方文档】，原文照抄）：**

> warning
> **Custom `script` disables built-in safeguards**
> When you provide a custom `script`, electron-builder no longer generates (and signs) the uninstaller for you and skips installer size verification. Prefer `include` unless you really need to replace the whole script.

**`include` 能碰到的钩子（官方文档列出的完整宏清单）：** `customHeader`、`preInit`、`customInit`、`customUnInit`、`customInstall`、`customUnInstall`、`customRemoveFiles`、`customInstallMode`、`customWelcomePage`、`customUnWelcomePage`、`customUnInstallSection`。

官方同时保证的可用符号：

- `BUILD_RESOURCES_DIR` 与 `PROJECT_DIR` 已定义；
- `build` 已加入 `addincludedir`（所以 `!include` 兄弟文件不用写 `BUILD_RESOURCES_DIR`）；
- `build/x86-unicode` 与 `build/x86-ansi` 已加入 `addplugindir`（目录存在时各自生效，与 `unicode` 选项无关）；
- 文件关联宏 `registerFileAssociations` / `unregisterFileAssociations` 仍然定义；
- **「All other electron-builder specific flags (e.g. `ONE_CLICK`) are still defined.」**
- `${isUpdated}` 可用于区分「安装/更新」；`${UNINSTALL_REGISTRY_KEY}` / `${UNINSTALL_APP_KEY}` 是卸载注册表键的正确写法（官方明确警告**不要硬编码** `Software\Microsoft\Windows\CurrentVersion\Uninstall\<appId>`，因为实际键名是 GUID 且 `\` 被替换为 `" - "`）。
- `customInstallMode` 里可设 `$isForceMachineInstall` / `$isForceCurrentInstall`。

**两个容易踩的官方 note：**

- **卸载器生命周期滞后一版**：「The uninstaller that runs during an uninstall **or during an update** is the `Uninstall <app>.exe` that was written to disk by the **previously installed** version」→ 改了 `customUnInstall` 要等**下一次**安装才生效。
- **portable 不自动 include `build/installer.nsh`**：`PortableOptions.include` 的 JSDoc 原文「Unlike the installer targets, the portable target does **not** fall back to `build/installer.nsh` — a custom script is only included when this option is explicitly set.」

来源：[electron-builder · NSIS · Custom NSIS script](https://www.electron.build/docs/nsis#custom-nsis-script)、[v26.17.0 `nsisOptions.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts)。

### 2.5 `differentialPackage` 的语义（【官方源码】JSDoc 原文要点）

它在 v26 的 release notes 里以 `"store-asar"` 新模式被 backport（[26.17.0 release](https://github.com/electron-userland/electron-builder/releases/tag/electron-builder%4026.17.0)：`feat(nsis): "store-asar" mode for proportional differential updates (v26 backport)`）。语义：

- `false` — 不支持差分下载；
- `"store-asar"` — 差分感知，且把 `resources/app.asar` **不压缩**（7-Zip `Copy`）存进包里，让未变区域逐字节一致；
- 其它（`true` / `"compressed"` / 未设）— 差分感知，整包压缩。

**对本项目的直接含义：** 默认 `true` ⇒ 即使我们**不用** electron-updater，NSIS 目标默认仍会生成 blockmap / update info（`isBuildDifferentialAware` 为真时 `createBlockmap` 会被调用，且 `isWriteUpdateInfo: !this.isPortable`）。**要出「干净的两件产物」，spec 里应显式 `differentialPackage: false`**（依据：`differentialPackage !== false` 才走差分路径）。

来源：[v27 `NsisTarget`/`nsisOptions` JSDoc](https://www.electron.build/docs/nsis#differentialpackage)、[v26.17.0 `NsisTarget.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts)。

---

## 3. Q2 · `files` / `asar` / `asarUnpack` / `extraResources`，以及**最关键的一条**

### 3.1 核心裁决：打进 asar 的文件，主进程能不能用 `protocol.handle` + `net.fetch('file://…')` 读到？

**结论：能读到。48.2 MB 的 `.cube.gz` 不需要为了「读得到」而解包出 asar。** 依据是**三条官方文档的合取**（Electron 官方文档级，但**没有一句话把这三件事串起来直说**——这一点我如实标注）：

**依据 1 — asar 对 `file:` 协议就是虚拟目录（【官方文档】）：**

> In a web page, files in an archive can be requested with the `file:` protocol. Like the Node API, ASAR archives are treated as directories.

**依据 2 — `net.fetch` 支持 `file:`（【官方文档】）：**

> By default, requests made with `net.fetch` can be made to [custom protocols](…) as well as `file:`, and will trigger [webRequest](…) handlers if present.

**依据 3 — 官方 `protocol.handle` 示例本身就是 `net.fetch(pathToFileURL(...))`（【官方文档】）：**

```js
app.whenReady().then(() => {
  protocol.handle('app', (req) => {
    const { host, pathname } = new URL(req.url)
    if (host === 'bundle') {
      …
      return net.fetch(pathToFileURL(pathToServe).toString())
    }
  })
})
```

**依据 4（最强的一条）— `registerSource` 官方明写「including from `asar` archives」（【官方文档】）：**

> Serves `scheme` from directories on disk without a JavaScript handler. … the file is streamed to the requester the way `file:` URLs are, **including from `asar` archives**, with `Content-Type` taken from the file extension. A path that resolves outside `root`, a missing file, a request that matches no route, or a method other than `GET`/`HEAD` fails with `net::ERR_FILE_NOT_FOUND`. A URL whose path ends in `/` serves the route's `index` file.
>
> **Use this instead of `protocol.handle` when a scheme only serves an app's own bundled files: no request touches the main thread, so pages and their subresources load at the same speed whether or not the main process is busy.**

来源：[Electron · ASAR Archives · Web API](https://www.electronjs.org/docs/latest/tutorial/asar-archives)、[Electron · `net.fetch`](https://www.electronjs.org/docs/latest/api/net#netfetchinput-init)、[Electron · `protocol.handle`](https://www.electronjs.org/docs/latest/api/protocol#protocolhandlescheme-handler)、[Electron · `protocol.registerSource`](https://www.electronjs.org/docs/latest/api/protocol#protocolregistersourcescheme-source-experimental)。

**等级如实说明：** 这是**官方文档级的三段合取**，不是「官方有一句话直说 `protocol.handle` + `net.fetch('file://…/app.asar/…')` 可行」。我**没有**去 Electron 源码里翻 `file:` URL loader 的 asar 分支（属于「源码级依据」的更进一步，本报告没做到）。**上机验证仍然建议做一次**（一次 `fetch` 一个 asar 内文件即可），列进第 11 节的验收清单。

**这条对 48.2 MB 的裁决：** 资产**留在 asar 里**（用 `asar` 默认值即可），**不需要 `asarUnpack`**。官方文档给「必须解包」的理由是三类：「Native modules (`.node` files)」「Large binary assets that need **random-access reads**」「Files that need to be executed directly」（[App Contents · Unpacking Files from ASAR](https://www.electron.build/docs/contents#unpacking-files-from-asar)）。本项目是 `fetch` 整文件后 `DecompressionStream` 顺序读，**不属于**这三类。**唯一残余风险是 Range / 分段读**（spike 与本源都没涉及），见第 10 节第 4 条与第 11 节的已知限制。

### 3.2 `files` / `extraResources` / `extraFiles` 的语义与默认值

| 字段 | `from` 起点 | `to` 终点 | 关键默认与行为 |
| --- | --- | --- | --- |
| `files` | app 目录（本项目 = 项目根，因为不是 two-package 结构） | **asar 归档根** | 默认 `["**/*", …一长串 `!` 排除项]`；「Development dependencies are never copied in any case」 |
| `extraResources` | **项目目录** | `resources/`（Windows 下即 `process.resourcesPath`） | 与 `files` 同套 glob / FileSet 语法 |
| `extraFiles` | 项目目录 | app 内容目录（Windows 下 = 安装目录根） | 同上 |

`files` 的三条**会咬人**的官方原文（【官方源码】JSDoc）：

> Default pattern `**/*` **is not added to your custom** if some of your patterns is not ignore (i.e. not starts with `!`). `package.json` and `**/node_modules/**/*` (only production dependencies will be copied) is added to your custom in any case. All default ignores are added in any case — you don't need to repeat it if you configure own patterns.

> Hidden files are not ignored by default, but all files that should be ignored, are ignored by default.

**对本项目的直接含义：** 一旦为了「只打 `dist/`」而写了 `files: ["dist/**", "package.json"]`，**`**/*` 就不会自动补上**——这是好事（否则会把 `src/`、`spike/` 一起打进包），但也意味着**必须显式列全**你要的东西。`package.json` 与生产依赖的 `node_modules/**` 无论如何都会进包。

`FileSet` 形态（`{ from, to, filter }`）的字段语义与 `from`/`to` 的默认起点，见 [App Contents · FileSet Objects](https://www.electron.build/docs/contents#fileset-objects)（官方同一张表，逐字一致）。

### 3.3 `asar` / `asarUnpack` 的语义与默认值，以及 v26 → v27 的改名

| 项 | v26.17.0 | v27（next） | 默认 |
| --- | --- | --- | --- |
| 是否打 asar | `asar?: AsarOptions \| boolean \| null` | 同左，但 **`asar: true` 被删除（缺省即开启）** | **`true`** |
| 解包 glob | **顶层 `asarUnpack`** | **`asar.unpack`** | 无 |
| 智能解包 | `asar.smartUnpack` | 同左 | **`true`**（"Whether to automatically unpack executables files."） |
| asar 完整性 | `asar.disableIntegrity` / `asar.disableSanityCheck` | 同左（旧顶层名被迁移进去） | 均为 `false` |

v27 的自动迁移表原文（【官方文档】）：

> | Legacy asar keys | `"asar-unpack": "**/*.node"` | `"asar": { "unpack": ["**/*.node"] }` |
> | `asarUnpack` consolidated | `"asarUnpack": ["**/*.node"]` | `"asar": { "unpack": ["**/*.node"] }` |
> | `asar: true` removed | `"asar": true` | _(deleted — absence means enabled)_ |
> | Platform `asarUnpack` moved | … | `"asar": { "unpack": [...] }, "mac": { "asar": { "unpack": [...] } }` _(root options merged in — a platform `asar` replaces the root one)_ |
> | Keys with no effect under `asar: false` | `"asar": false, "asarUnpack": "x"` | `"asar": false` |

**语义（【官方文档】）：** 解包后的文件进 `app.asar.unpacked/`；「Files in `app.asar.unpacked/` are accessible via the same paths as if they were in the ASAR — Electron transparently redirects reads.」**注意这条「透明重定向」是 Electron 的 asar 补丁行为，不是文件系统行为**——它同时意味着：即使未来把 LUT 解包，主进程代码路径**不需要改**。

Electron 侧 asar 的官方限制（【官方文档】，供 spec 判断有没有别的坑）：归档只读；不能把工作目录设成归档内目录；`child_process.execFile` / `fs.open` / `fs.openSync` / `process.dlopen` 会把文件**解到临时文件**再调用（有开销、可能触发杀软）；`fs.stat` 返回的 `Stats` 是**猜的**，除大小与类型外不可信。

来源：[electron-builder · App Contents](https://www.electron.build/docs/contents)、[`PlatformSpecificBuildOptions.ts`（v26.17.0）](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts)、[v26 → v27 迁移表](https://www.electron.build/docs/migration/v26-to-v27/)、[Electron · ASAR Archives](https://www.electronjs.org/docs/latest/tutorial/asar-archives)。

---

## 4. Q3 · 便携形态：`zip` vs `portable`

**结论先行：** `portable` **是** NSIS target 的一个变体，产出**单个自解压 exe**（不是「目录 + zip」）；`zip` 是跨平台 archive target，产出**压缩归档**。用户要的「便携 zip」= **`zip` target**。两者在 CI 上的默认产物名分别是 `raw-images-studio-0.1.0-win.zip` 与 `raw-images-studio 0.1.0.exe`。

### 4.1 `portable` 是 NSIS 变体（【官方源码】）

`NsisTarget` 里：

```ts
private get isPortable(): boolean {
  return this.name === "portable"
}
…
const { unpackDirName, requestExecutionLevel, splashImage } = options as PortableOptions
```

也就是说 `portable` 复用同一套 `NsisTarget`，只是 `name === "portable"` 走 `templates/nsis/portable.nsi` 这条分支。它没有独立的 target 实现，`PortableOptions` 也没有 `oneClick` / `perMachine` 这些安装器专属项。

来源：[v26.17.0 `NsisTarget.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts)、[`nsisOptions.ts` · `PortableOptions`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts)。

### 4.2 运行时解到哪、退出时清不清（【官方源码】`portable.nsi` 原文）

```nsis
Section
  …
  StrCpy $INSTDIR "$PLUGINSDIR\app"
  !ifdef UNPACK_DIR_NAME
    StrCpy $INSTDIR "$TEMP\${UNPACK_DIR_NAME}"
  !endif

  RMDir /r $INSTDIR
  SetOutPath $INSTDIR
  …
      !insertmacro extractEmbeddedAppPackage
  …

  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_DIR", "$EXEDIR").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_FILE", "$EXEPATH").r0'
  System::Call 'Kernel32::SetEnvironmentVariable(t, t)i ("PORTABLE_EXECUTABLE_APP_FILENAME", "${APP_FILENAME}").r0'
  ${StdUtils.GetAllParameters} $R0 0
  …
	ExecWait "$INSTDIR\${APP_EXECUTABLE_FILENAME} $R0" $0
  SetErrorLevel $0

  SetOutPath $EXEDIR
	RMDir /r $INSTDIR
SectionEnd
```

再对上 `PortableOptions.unpackDirName` 的 JSDoc（【官方源码】）：

> The unpack directory for the portable app resources.
> If set to a string, it will be the name in TEMP directory
> If set explicitly to `false`, it will use the Windows temp directory ($PLUGINSDIR) that is unique to each launch of the portable application.
> Defaults to uuid of build (changed on each build of portable executable).

`NsisTarget` 侧的落地代码：`if (typeof unpackDirName === "string" || !unpackDirName) { defines.UNPACK_DIR_NAME = unpackDirName || generateKsuid() }` —— **默认情况下会定义 `UNPACK_DIR_NAME`（一个 per-build 的 KSUID），所以默认落点是 `$TEMP\<build-uuid>\`**；只有显式 `unpackDirName: false` 才落到 per-launch 唯一的 `$PLUGINSDIR`。

**结论表：**

| 问题 | 答案 | 依据 |
| --- | --- | --- |
| 是不是 NSIS 变体的单文件 exe | **是** | 【官方源码】 |
| 解到哪 | `$TEMP\<build 级 KSUID>\`（默认）／显式 `unpackDirName: false` 时是 `$PLUGINSDIR\app`（每次启动唯一）／字符串时是 `$TEMP\<该字符串>` | 【官方源码】 |
| 退出时清不清 | **清**：`RMDir /r $INSTDIR` 在 `ExecWait` 之后执行；进入时也先 `RMDir /r` 一次 | 【官方源码】 |
| 启动开销 | **官方只给了存在性证据，没有数字**：`PortableOptions.splashImage` 的 JSDoc 是 "The image to show while the portable executable is extracting"，说明**解压是启动期可见成本**；`PortableOptions` 也无 `oneClick`/安装逻辑。**具体秒数未取到一手依据** | 【官方源码】+【未取到一手依据】 |
| 暴露给应用的环境变量 | `PORTABLE_EXECUTABLE_DIR`、`PORTABLE_EXECUTABLE_FILE`、`PORTABLE_EXECUTABLE_APP_FILENAME` | 【官方源码】+[官方 NSIS · Portable](https://www.electron.build/docs/nsis#portable) |
| 请求的执行级别 | `PortableOptions.requestExecutionLevel`，**默认 `"user"`** | 【官方源码】 |

### 4.3 `userData` 落在哪 —— **与安装版同址**（这是最容易被误解的一条）

`portable.nsi` 里**只设了三个 `PORTABLE_*` 环境变量**，**没有**给应用传 `--user-data-dir`，**也没有**改写 `$APPDATA`。因此 portable 版本启动的应用，其 `app.getPath('userData')` 与安装版走的是**同一个默认位置**（`%APPDATA%\<productName>`）。

**等级如实说明：** 「`portable.nsi` 没传 `--user-data-dir`」是**官方源码直读**；「没被 `common.nsh` 或其他 include 改写」这一层**我没有逐行核实**（只读了 `portable.nsi`）——见第 10 节第 7 条。**这条对 spec 很重要**：如果 spec 想承诺「便携版不污染系统」，那需要**显式**做点什么（portable 版的官方机制里**没有**这个开关），不能指望默认行为。

### 4.4 CI 上的默认产物名（【官方源码】）

**NSIS / portable 走 `NsisTarget.installerFilenamePattern()`：**

```ts
protected installerFilenamePattern(primaryArch?: Arch | null, defaultArch?: string): string {
  const setupText = this.isPortable ? "" : "Setup "
  const archSuffix = !this.shouldBuildUniversalInstaller && primaryArch != null ? getArchSuffix(primaryArch, defaultArch) : ""

  return "${productName} " + setupText + "${version}" + archSuffix + ".${ext}"
}
```

**单 arch（`buildUniversalInstaller` 默认 `true`）时 `archSuffix` 为空**，于是：

| target | 默认产物名（本项目 `productName` 会回落成 `raw-images-studio`，`version` 0.1.0） |
| --- | --- |
| `nsis` | `raw-images-studio Setup 0.1.0.exe` |
| `portable` | `raw-images-studio 0.1.0.exe` |
| `nsis-web` | `raw-images-studio Web Setup 0.1.0.exe` |

**`zip` / `7z` / `tar.*` 走 `ArchiveTarget`：**

```ts
if (packager.platform === Platform.LINUX) {
  defaultPattern = "${name}-${version}" + (arch === defaultArch ? "" : "-${arch}") + ".${ext}"
} else {
  defaultPattern = "${productName}-${version}" + (arch === defaultArch ? "" : "-${arch}") + "-${os}.${ext}"
}
```

Windows x64 单 arch ⇒ **`raw-images-studio-0.1.0-win.zip`**。

**⚠️ 一条会让 Release 上的文件名与本地文件名不一致的机制：** `NsisTarget` 在 `emitArtifactBuildCompleted` 时算 `safeArtifactName = computeSafeArtifactNameIfNeeded(installerFilename, () => this.generateGitHubInstallerName(primaryArch, defaultArch))`，而 `generateGitHubInstallerName()` 的规则是：

```ts
const classifier = appInfo.name.toLowerCase() === appInfo.name ? "setup-" : "Setup-"
return `${appInfo.name}-${this.isPortable ? "" : classifier}${appInfo.version}${archSuffix}.exe`
```

本仓库的 `name` 是**全小写** `raw-images-studio` ⇒ classifier 取 `"setup-"` ⇒ **上传到 GitHub 的名字会是 `raw-images-studio-setup-0.1.0.exe`**（无空格、无大写）。**等级：** `NsisTarget` 侧的函数与规则是【官方源码】直读；但 `computeSafeArtifactNameIfNeeded` **在什么条件下才启用**这个 safe name，我**没有逐字核实**（见第 10 节第 11 条）。**spec 不要假设本地文件名 = Release 资产名**，要么显式设 `artifactName`，要么在 CI 里按 glob 上传而不是写死文件名。

来源：[v26.17.0 `NsisTarget.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts)、[`ArchiveTarget.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/targets/ArchiveTarget.ts)、[`nsisOptions.ts` · `NsisWebOptions.artifactName`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts)。

**`zip` 在 Windows runner 上是否需要额外工具：未取到一手依据**（`ArchiveTarget` 调的是 `./archive.ts` 的 `archive()`，我没有逐行读它的实现；`toolsets.sevenZip` 的 JSDoc 明说 7-Zip 工具包用于**解压 `.7z`/`.tar.xz`**，没有说用于**创建 zip**）。见第 10 节第 5 条。

---

## 5. Q4 · 版本号与 git tag 的关系

**结论先行：** `version` **来自 `package.json`**；`buildVersion` 默认等于 `version`（有 `buildNumber` 时是 `${version}.${buildNumber}`）；**`-c.extraMetadata.version=<tag 去掉 v>` 是官方支持的「以 tag 为准且不动 `package.json`」的写法，且源码证明它真的会改变 version 全链路**。**但必须知道：electron-builder 的 GitHub publish 不读 git tag，它用 `tagNamePrefix + version` 反推 tag** —— 所以 version 与 tag 必须一致（`v0.1.0` ↔ `0.1.0`）。

### 5.1 `version` 与 `buildVersion` 从哪来（【官方源码】）

`AppInfo` 构造函数：

```ts
this.version = info.metadata.version!
…
if (buildVersion == null) { buildVersion = info.config.buildVersion }
const buildNumberEnvs = process.env.BUILD_NUMBER || process.env.TRAVIS_BUILD_NUMBER || …
this.buildNumber = info.config.buildNumber || buildNumberEnvs
if (buildVersion == null) {
  buildVersion = this.version
  if (!isEmptyOrSpaces(this.buildNumber)) { buildVersion += `.${this.buildNumber}` }
}
this.buildVersion = buildVersion
```

`buildVersion` 的官方 JSDoc（【官方源码】）：

> The full build version string.
> Maps to `CFBundleVersion` on macOS and the `FileVersion` metadata field on Windows. Defaults to the `version` field from `package.json`.
> If `buildVersion` is not set but `buildNumber` is defined (or resolved from an environment variable), the effective build version becomes `${version}.${buildNumber}`.

`buildNumber` 的另一半：官方 JSDoc 明写「If not set, falls back to the first defined environment variable among: `BUILD_NUMBER`, `TRAVIS_BUILD_NUMBER`, `APPVEYOR_BUILD_NUMBER`, `CIRCLE_BUILD_NUM`, `BUILD_BUILDNUMBER`, `CI_PIPELINE_IID`」——**注意这七个里没有 `GITHUB_RUN_NUMBER`**，所以在 GitHub Actions 上 `buildNumber` **不会**被自动填上（`GITHUB_RUN_NUMBER` 不在名单里）。

### 5.2 `extraMetadata` 的语义与**求值顺序**（这条决定了「以 tag 为准」能不能成立）

官方 JSDoc（【官方源码】）：

> Additional properties to deep-merge into the app's `package.json` at build time.
> Useful for injecting build-time metadata (e.g., a git commit hash or CI build URL) that should be readable at runtime via `require('./package.json')` or `import.meta.url`.

**求值顺序（关键证据）** —— `Packager.validateConfig()` 里：

```ts
this._metadata = this.devMetadata            // ← 读 package.json
this._originalMetadata = deepAssign({}, this._metadata)
deepAssign(this._metadata, configuration.extraMetadata)   // ← 深合并 extraMetadata
```

而 `AppInfo` 是在**之后**的 `Packager.build()` 里才构造的：

```ts
async build(repositoryInfo?) {
  await this.validateConfig()
  …
  this._appInfo = new AppInfo(this, null)
```

`AppInfo` 读的正是 `this.info.metadata.version`。**⇒ `extraMetadata.version` 会被 AppInfo 采纳 ⇒ 影响 artifact 名、`VIProductVersion`、`ProductVersion`/`FileVersion` 等信息。**

**CLI 语法（【官方文档】）：** 官方 CLI 页的 examples 里逐字给了两条同形写法：

> ```
> electron-builder -c.extraMetadata.foo=bar     set package.json property `foo` to `bar`
> electron-builder --config.nsis.unicode=false  configure unicode options for NSIS
> ```

⇒ `npx electron-builder --win --publish always -c.extraMetadata.version=0.2.0` 是**官方语法内的写法**，且**不会修改仓库里的 `package.json`**（`_originalMetadata` 保留了合并前的副本，`nodePackageName` 取的就是它）。

来源：[`appInfo.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/appInfo.ts)、[`packager.ts`（v26.17.0）](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/packager.ts)、[`configuration.ts` · `extraMetadata` / `buildVersion` / `buildNumber`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/configuration.ts)、[electron-builder · CLI](https://www.electron.build/docs/cli)。

### 5.3 tag 与 version 的绑定关系：**publisher 反推 tag，不读 git tag**（【官方源码】）

`GitHubPublisher` 构造与 `GithubOptions`：

```ts
assertVersionHasNoVPrefix(version)
this.tag = githubTagPrefix(info) + version
```

```ts
export function githubTagPrefix(options: GithubOptions) {
  return options.tagNamePrefix ?? "v"
}
```

`GithubOptions.tagNamePrefix` 的官方 JSDoc（v27 名）：「If defined, sets the prefix of the tag name that comes before the semver number. e.g. "v" in "v1.2.3" or "test" of "test1.2.3". **@default "v"**」。**v26 的对应选项名是 `vPrefixedTagName`（默认 `true`）**，v27 迁移表逐字写了 `GithubOptions.vPrefixedTagName` → `tagNamePrefix`。

**⇒ 三条硬约束（对 CI 直接可操作）：**

1. **version 里不能带 `v`**（`assertVersionHasNoVPrefix`），否则 publisher 抛错；
2. publish 找的 tag 是 **`v${package.json version}`**（默认前缀）——**所以 CI 必须让 version 等于 tag 去掉 `v` 的部分**，否则 publisher 会去建/找一个**错误的 tag 的 release**；
3. `--publish always` 与 `getCiTag() != null` 二者之一成立时，publisher 在找不到 release 时会**创建** release（默认创建成 **draft**，见 §8.2）。

**同源的一个宽容行为：** `getOrCreateRelease()` 匹配时接受 `release.tag_name === this.tag || release.tag_name === this.version` —— 也就是说 `0.1.0`（不带 v）这种 tag 也能被认出来。

来源：[`gitHubPublisher.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/electron-publish/src/gitHubPublisher.ts)、[`publishOptions.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/builder-util-runtime/src/publishOptions.ts)、[v26 → v27 迁移表](https://www.electron.build/docs/migration/v26-to-v27/)。

### 5.4 semver 校验

- `version` 必须是 semver 形态：`AppInfo.getVersionInWeirdWindowsForm()` 会把 version 拆成 major/minor/patch 并要求是整数，否则 `throw new Error("Invalid major number in: …")` / `Invalid minor or patch number in: …`（**允许缺 minor/patch，默认补 0；不允许非整数**）。
- `prerelease` 分量会被用来推断 channel：`get channel()` 走 `semver.prerelease(this.version)`。**若 version 带 `-alpha.1` 这类后缀，会得到一个非 null 的 channel**（对只发正式版的项目无影响，但 spec 应写明 version 不带预发布后缀）。
- `GithubOptions.releaseType` 的 JSDoc 里也提到 channel 默认 `latest`。

来源：[`appInfo.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/appInfo.ts)、[`publishOptions.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/builder-util-runtime/src/publishOptions.ts)。

---

## 6. Q5 · 完全不签名时会发生什么

**结论先行：** 无证书时 v26 **不会**为了签名去下载 `winCodeSign`（源码里取 signer 路径发生在「有证书」分支之后）；但**「不签名」≠「不下载东西」**——Electron 发行包、NSIS 工具包、7zip 工具包照样要下。`win.signAndEditExecutable: false` 是**用错**的选项（会连带关掉图标与版本信息），本项目应写 **`signExecutable: false`**（v26）或 **`win.sign: false`**（v27）。`CSC_IDENTITY_AUTO_DISCOVERY=false` 对 Windows **没有作用**。

### 6.1 无证书时不会去下 `winCodeSign`（【官方源码】）

v26 的 `WindowsSignToolManager.signFile()` 顺序（节选，保留判断分支）：

```ts
const cscInfo = await this.cscInfo.value
if (cscInfo) {
  …
  log.info(logInfo, "signing")
} else if (!customSign) {
  log.info({ path: log.filePath(options.path) }, "no code signing certificate configured, signing is skipped")
  return false            // ← 在这里就返回了
}

const executor = customSign || ((config, packager) => this.doSign(config, packager))
…
```

而**真正会触发工具包解析（也就是下载）的 `getSignToolPath(...)`，只出现在 `doSign()` 内部**：

```ts
async doSign(configuration, packager) {
  …
  const toolInfo = await getSignToolPath(this.packager.config.toolsets?.winCodeSign, isWin)
```

⇒ **没有证书、也没有自定义 `sign` 钩子时，执行流在 `return false` 处结束，`getSignToolPath` 不会被调用。** 另有一条独立佐证：`WindowsSignToolManager` 的 `initialize()` 就是 `return Promise.resolve()`，构造它不触发任何下载；`cscInfo` 在无证书时返回 `null`（源码里 `cscLink == null || cscLink === ""` 分支）。

**范围如实说明（这条很容易被过度解读）：** 以上只证明**签名路径**不需要 `winCodeSign`。**不签名的构建仍然必须联网下载工具**：`configuration.ts` 的 `ToolsetConfig` 列举了 electron-builder 会下载并缓存的工具包（`winCodeSign`、`appimage`、`nsis`、`wine`、`fpm`、`linuxToolsMac`、`sevenZip`、`icons`、`squirrel`），而 `NsisTarget` 明确调用了 `getMakeNsisPath(...)` / `getNsisPluginsPath(...)`，`ElectronFramework` 会下 Electron 发行包。**所以「不签名」省掉的是 winCodeSign 这一个包，不是「离线可构建」。** 另外，**我没有真机实测「干净缓存 + 无证书」一次 `--win nsis` 的网络流量**（见第 10 节第 1 条）——**源码级结论成立，实测仍建议做一次**。

v27 侧更强的一条（【官方源码】JSDoc）：`toolsets.winCodeSign` 的说明里写 `rcedit` 是「legacy usage, **migrated to npm `resedit` package**」，且官方 code-signing 页把 `win.sign: false` 描述为「Disable signing (**resedit resource editing still runs**)」——即 v27 里资源编辑完全不依赖该工具包。

### 6.2 `win.signAndEditExecutable` vs `win.signExecutable`（v26.17.0 官方 JSDoc 逐字）

```ts
/**
 * Whether to sign and add metadata to executable via [`resedit`](https://www.npmjs.com/package/resedit).
 * Metadata includes information about the app name/description/version, publisher, copyright, etc.
 * This property also is responsible for adding the app icon and setting execution level.
 * Set to `false` only if you need to fully disable resedit-based resource editing.
 * To skip only code signing while keeping resource editing, use `signExecutable: false` instead.
 * @default true
 */
readonly signAndEditExecutable?: boolean
```

```ts
/**
 * Whether to sign Windows executables and any additional files matched by `signExts`.
 * Set to `false` to skip Windows code signing while still editing executable resources
 * (icon, metadata, etc. via [`resedit`](https://www.npmjs.com/package/resedit)).
 * This option is not limited to the main executable edit/sign flow and can also affect
 * signing of Windows installers or other artifacts that use the standard signing path.
 * @default true
 */
readonly signExecutable?: boolean
```

**⇒ spec 要钉的取值：`win.signExecutable: false`（保留图标/版本信息/`asInvoker`），而不是 `signAndEditExecutable: false`。**

**v27 的对应形状（【官方文档】）：**

| `win.sign` 取值 | 行为 |
| --- | --- |
| unset | 用环境变量发现的凭据（`WIN_CSC_LINK`/`CSC_LINK` + 密码）签名 |
| `false` 或 `null` | **Disable signing (resedit resource editing still runs)** |

并且：「Combining `win.sign: false` with `forceCodeSigning: true` is a configuration error and fails the build.」迁移表里 `win.signAndEditExecutable: false` → `win.sign: false`「_(resource editing now always runs; warns)_」。

来源：[v26.17.0 `winOptions.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/options/winOptions.ts)、[v26.17.0 `codeSign/windowsSignToolManager.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/codeSign/windowsSignToolManager.ts)、[v27 Code Signing for Windows](https://www.electron.build/docs/features/code-signing/code-signing-win/)、[v26 → v27 迁移表](https://www.electron.build/docs/migration/v26-to-v27/)。

### 6.3 `CSC_IDENTITY_AUTO_DISCOVERY=false` 的真实作用域（【官方源码】）

```ts
export function isAutoDiscoveryCodeSignIdentity() {
  return process.env.CSC_IDENTITY_AUTO_DISCOVERY !== "false"
}
```

调用点全在 macOS 侧：`codeSign/mac/macCodeSign.ts` 的 `findIdentity()`（无 `CSC_NAME` 时决定要不要去 `security find-identity` 自动找证书）与 `reportError()`（只在未开启自动发现时把 `CSC_IDENTITY_AUTO_DISCOVERY: false` 记进日志字段）。同一文件里 `isSignAllowed()` 的第一句就是 `if (process.platform !== "darwin") { log.warn(..., "skipped macOS application code signing"); return false }`。

**⇒ 对 Windows 构建零作用。** 另外与它成对的 `CSC_LINK` / `WIN_CSC_LINK`（+ `CSC_KEY_PASSWORD` / `WIN_CSC_KEY_PASSWORD`）是不签名构建里**不需要设**的变量；`win.sign` 的 JSDoc 明写 `WIN_CSC_LINK` 接受「a file path, an `https://` URL, or a base64-encoded certificate」。

### 6.4 不签名产物的可预期行为

| 时机 | 现象 | 依据 |
| --- | --- | --- |
| 构建期 | 每个待签文件打一条 `no code signing certificate configured, signing is skipped`；不报错（除非 `forceCodeSigning: true`） | 【官方源码】 |
| 安装时的 UAC | `win.requestedExecutionLevel` **默认 `asInvoker`** ⇒ **应用本身不请求提权**；但 `nsis.perMachine: true` 时**安装器**要提权，此时会看到发布者信息缺失的提权提示。**UAC「未知发布者」的官方逐字文案本报告未取到** | 【官方源码】（`asInvoker` 默认）+【未取到一手依据】（UAC 文案） |
| 安装时的 SmartScreen | 见 §7 | 【官方文档】Microsoft |
| 首次运行时 | 同上；另外 Win11 上 Smart App Control **对所有可执行文件**做签名/声誉检查 | 【官方文档】Microsoft |
| 更新校验 | `win.verifyUpdateCodeSignature` **默认 `true`**，但它只在**用 electron-updater** 时才有意义（把 publisherName 写进 `app-update.yml`）。本项目不用 auto-update ⇒ 无影响；官方注明了「Disable this only if your updates are not Authenticode-signed」 | 【官方源码】JSDoc |

---

## 7. Q6 · SmartScreen 对未签名 exe 的实际行为（以 Microsoft 官方文档为准）

**本节的唯一来源是 Microsoft Learn。本节不提供任何绕过安全机制的建议，只如实描述官方记载的用户可见行为与代价。**

### 7.1 未签名 = 用户必须自己点 "Run anyway"（【官方文档】原文表格）

| Certificate type | First-download SmartScreen behavior |
| --- | --- |
| Microsoft Store | ✅ No warning — covered by Microsoft's certificate |
| Valid Certificate (OV/EV) | ⚠️ Warning — app flagged as unrecognized until reputation accumulates; verified publisher name is displayed |
| **No signature** | ⚠️ **Warning — "Windows protected your PC"; User must choose "Run anyway" before the app can run. Enterprise policy can prevent continuation entirely.** |
| Self-signed Certificate | ⚠️ Warning — Same behavior as no signature |

来源：[Microsoft Learn · SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)（该页 "Last updated on 2026-05-06"）。

> **等级说明：** 表格里的用户可见文案原文是 `"Windows protected your PC"` 与 `"Run anyway"`。**「更多信息」这一步的官方逐字文案我没有取到**（见第 10 节第 9 条）。本报告不描述任何绕过流程。

### 7.2 声誉怎么攒、代价是什么（【官方文档】原文）

> SmartScreen evaluates two signals when a user downloads and runs a file:
> 1. **Publisher reputation** — Is the file signed? Is the signing certificate from a known, trusted publisher?
> 2. **File hash reputation** — Has this specific file been downloaded by users without indications of malicious behavior?
>
> … **When a file is not signed, SmartScreen reputation must build for each new version of your files, starting with zero reputation. Reputation cannot transfer from previous versions unless both were signed using the same publisher identity.**

> 2. **As downloads accumulate:** SmartScreen reputation builds up automatically. The prompt will stop appearing once the file hash has sufficient download history. **There is no exact threshold, but it can take several weeks and hundreds of clean installs from a wide audience.**
> 3. **New version:** … **Unsigned files must build reputation anew with every update.**

> There is no need (or mechanism) to manually submit a file for SmartScreen reputation review for consumer endpoints. Reputation builds organically through download volume.

### 7.3 EV 证书已不再「秒过」（【官方文档】）

> **SmartScreen reputation: EV certificates no longer grant instant bypass**
> **Status: Behavior changed in 2024**
> … SmartScreen reputation now **accumulates over time** rather than being granted instantly by certificate type. … **A consistent signing identity can carry publisher reputation across releases, but no certificate type (OV or EV) grants an immediate bypass.**
> **Impact:** Developers who purchased EV certificates specifically to bypass SmartScreen warnings for new releases will find that EV certificates no longer provide this benefit.
> **Current behavior:** All non-Store, non-Microsoft-signed binaries can show a SmartScreen prompt on first download until sufficient reputation is established. … **Unsigned files must rebuild reputation for every new hash.**

同一页还有：「Note: EV certificates no longer bypass SmartScreen. … **Paying a premium for EV solely to avoid SmartScreen warnings is no longer justified.**」

### 7.4 微软自己给的「代价」与替代路径（【官方文档】）

> ### Artifact Signing (formerly Trusted Signing)
> Artifact Signing (formerly Trusted Signing) is Microsoft's recommended code signing service for non-Store distribution:
> - **Cost** — Starts at $9.99/month. See [Artifact Signing pricing](https://azure.microsoft.com/pricing/details/artifact-signing/).
> - **No hardware token required** — integrates directly with CI/CD pipelines (GitHub Actions, Azure DevOps)
> - **Identity validation required** — Microsoft validates your identity before issuing certificates
> - **SmartScreen behavior** — reputation accumulates over time based on download volume and behavior

> Tip
> **The simplest way to avoid SmartScreen warnings is to publish through the Microsoft Store.** Store-distributed apps are signed by a Microsoft certificate and are never subject to SmartScreen download warnings.

**⇒ 对本项目的结论（不带建议，只陈述代价）：** 「完全不做代码签名」的代价是**每一个新版本的每一个新 hash 都要从零攒声誉**，而攒到不弹窗「can take several weeks and hundreds of clean installs from a wide audience」。**唯一的零警告路径是 Microsoft Store；微软推荐的零 Store 路径是 Artifact Signing（$9.99/月起 + 身份验证），且签了也仍然是「随时间累积」。**

### 7.5 一条对「完全离线」特别重要的官方提醒（【官方文档】）

> Tip
> On Windows 11 devices, the **Smart App Control** feature may supersede SmartScreen Application Reputation. **Smart App Control will block execution of unsigned files unless the file has a positive reputation. Smart App Control signature checks apply to all executable files, not just those downloaded from the Internet.**

**⇒ 这条直接打在「完全离线」的前提上**：Smart App Control 的签名检查**不限于「从网上下载的文件」——离线拷进来的 exe 同样在检查范围内。**未签名 + Win11 Smart App Control = 可能连启动都被挡。**

来源：[SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)、[Current status of Windows app distribution features](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/distribution-feature-status)。

---

## 8. Q7 · GitHub Actions 上 tag 触发的 Windows 发版链路

**结论先行：** 官方推荐写法在 electron-builder 官方文档里有完整示例（tag 触发 + `permissions: contents: write` + `GH_TOKEN` + npm 缓存）。**两条上传路径在「重跑」上的行为差别很大**：`--publish always` **会**自动删同名资产再传（重跑安全）；`gh release upload` **不加 `--clobber` 会失败**、**加了有丢资产的窗口**；softprops 的 `overwrite_files` **默认 true**，但它**会未经同意地把已有 draft 发布出去**，除非显式 `draft: true`。

### 8.1 官方推荐写法（【官方文档】，与我们的形状逐条对应）

```yaml
name: Release
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build-windows:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with:
          node-version: 20
          cache: npm
      - uses: actions/cache@v4
        with:
          path: ~\AppData\Local\electron
          key: win-electron-${{ hashFiles('**/package-lock.json') }}
      - run: npm ci
      - run: npx electron-builder --win --publish always
        env:
          WIN_CSC_LINK: ${{ secrets.WIN_CSC_LINK }}
          WIN_CSC_KEY_PASSWORD: ${{ secrets.WIN_CSC_KEY_PASSWORD }}
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

同一页的其它相关原文：

- 基本概念：「**`GH_TOKEN`** — the GitHub token electron-builder uses to upload release assets. Use `GITHUB_TOKEN` (provided automatically) or a PAT with `repo` scope」
- 缓存建议：「Cache npm packages and Electron binaries…」示例同时给 `~/.cache/electron`（unix）与 `~\AppData\Local\electron`（windows），以及文档开头提到的 `~/.cache/electron-builder`
- 官方对 `--publish always` 的一句话：「The `--publish always` flag uploads artifacts to the GitHub release **for the pushed tag**. If no release exists, electron-builder creates a draft release.」（**注意这句话与源码有出入，见 8.2 第一条**）
- Draft 写法：「A common pattern is to publish a **draft** release on every tagged push, then manually promote it」+ `publish: { provider: github, releaseType: draft }`

来源：[electron-builder · GitHub Actions CI/CD](https://www.electron.build/docs/features/github-actions)。

**macOS 专属的变量对本项目无意义**（`CSC_LINK`/`CSC_KEY_PASSWORD`/`APPLE_ID`/…）；上面示例我保留了 `WIN_CSC_*` 只为忠实呈现官方原文——**本项目不设它们**（参见 §6.3）。

### 8.2 路径 A：`electron-builder --publish always`（【官方源码】`GitHubPublisher`）

**release 类型解析顺序（构造函数的原文逻辑）：**

```ts
if (isEnvTrue(process.env.EP_DRAFT))            this.releaseType = "draft"
else if (isEnvTrue(process.env.EP_PRE_RELEASE) || isEnvTrue(process.env.EP_PRELEASE)) this.releaseType = "prerelease"
else if (info.releaseType != null)              this.releaseType = info.releaseType
else if ((options as any).prerelease)           this.releaseType = "prerelease"
else                                            this.releaseType = (options as any).draft === false ? "release" : "draft"
```

⇒ **默认是 `draft`**（`GithubOptions.releaseType` 的 JSDoc 也写「The type of release. By default `draft` release will be created. @default draft」）。

**「找不到就建」的条件（原文）：**

```ts
if (this.options.publish === "always" || getCiTag() != null) {
  log.info({ reason: "release doesn't exist", ... }, `creating GitHub release`)
  return this.createRelease()
}
this.releaseLogFields = { reason: 'release doesn\'t exist and not created because "publish" is not "always" and build is not on tag', ... }
return null
```

**两类会「静默跳过上传」的情况（重跑时最需要知道）：**

1. **已存在一个非 draft 的 release，而本次要建 draft** → 原文 `reason: "existing type not compatible with publishing type"` + `log.warn(..., "GitHub release not created")` + 返回 `null` ⇒ 后续 `doUpload` 里 `log.warn(..., "skipped publishing")`。
2. **已存在的 release 发布时间超过 2 小时**（且未设 `EP_GH_IGNORE_TIME`）→ 原文 `reason: "existing release published more than 2 hours ago"` + `"GitHub release not created"`。

**同名资产重传：自动覆盖（这就是「重跑安全」的证据，原文）：**

```ts
private async overwriteArtifact(fileName: string, release: Release) {
  // delete old artifact and re-upload
  log.warn({ file: fileName, reason: "already exists on GitHub" }, "overwrite published file")
  const assets = await this.githubRequest<Array<Asset>>(`/repos/…/releases/${release.id}/assets`, this.token, null)
  for (const asset of assets) {
    if (asset.name === fileName) {
      await this.githubRequest<void>(`/repos/…/releases/assets/${asset.id}`, this.token, null, "DELETE")
      return
    }
  }
  log.debug({ file: fileName, reason: "not found on GitHub" }, "trying to upload again")
}
```

触发条件是 `doesErrorMeanAlreadyExists(e)`：`e.statusCode === 422` 且描述里含 `already_exists`。上传重试上限是 `attemptNumber > 3` 才 reject。

**⇒ 对本项目的判断：** 重跑同一个 `v*` tag 的 workflow，**只要不踩上面那两类「release 不创建」**，资产会被 `DELETE` + 重传，**不会因为同名而失败**。但要注意**发布超过 2 小时后再重跑会静默跳过上传**（表现为 workflow 成功、Release 没变）——这一点**必须写进 spec 的运行手册**。

来源：[`gitHubPublisher.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/electron-publish/src/gitHubPublisher.ts)、[`publishOptions.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/builder-util-runtime/src/publishOptions.ts)。

### 8.3 路径 B：`softprops/action-gh-release`（【官方文档】= action 自己的 README）

**它自己声明的 re-upload 行为：**

> `overwrite_files` | Boolean | **Indicator of whether files should be overwritten when they already exist. Defaults to true**

以及：

> If a tag already has a GitHub release, the existing release will be updated with the release assets.

**⚠️ draft 的坑（原文，这条最容易翻车）：**

> `draft` | Boolean | Keep the release as a draft. **Defaults to false. When reusing an existing draft release, set this to true to keep it draft; omit it to publish after upload.**
>
> 💡 Draft status is handled separately during finalization. **If the action reuses an existing draft release, set `draft: true` to keep it draft; if `draft` is omitted, the action will publish that draft after uploading assets.**

**其它相关原文：**

- `tag_name` 「defaults to `github.ref_name`. `refs/tags/<name>` values are normalized to `<name>`」；
- 权限：「This Action requires the following permissions on the GitHub integration token: `permissions: contents: write`」；
- Windows 路径：「Both `\` and `/` path separators are accepted in `files` globs」；
- 未匹配文件：`fail_on_unmatched_files`（默认未设 ⇒ 不因空 glob 失败）；
- 版本提示：`v2.6.2` 是最后一个 v2（Node 20 runtime 已弃用），建议用 `v3`（Node 24）。

来源：[softprops/action-gh-release README](https://github.com/softprops/action-gh-release/blob/master/README.md)（官方仓库 README，属该 action 的一手文档）。

### 8.4 路径 C：`gh release upload`（【官方文档】GitHub CLI manual 逐字）

> ```
> gh release upload <tag> <files>... [flags]
> ```
> Upload asset files to a GitHub Release.
> To define a display label for an asset, append text starting with `#` after the file name.
> **When using `--clobber`, existing assets are deleted before new assets are uploaded. If the upload fails, the original assets will be lost.**
>
> ## Options
> `--clobber`
> Delete and re-upload existing assets of the same name

**⇒ 语义非常明确：** 不加 `--clobber` ⇒ 同名资产存在时上传失败（rerun 会红）；加 `--clobber` ⇒ **先删后传，中途失败就把原来的资产也丢了**。**这条是三条路径里重跑风险最高的一条。**

来源：[GitHub CLI manual · `gh release upload`](https://cli.github.com/manual/gh_release_upload)。

### 8.5 三条路径对照（重跑视角）

| 维度 | `--publish always` | softprops/action-gh-release | `gh release upload` |
| --- | --- | --- | --- |
| tag 从哪来 | **`tagNamePrefix + version`（不读 git tag）** | `github.ref_name`（= 触发用的 tag） | 命令行显式给 |
| 同名资产重跑 | **自动 DELETE 后重传**（422 already_exists 触发）【官方源码】 | `overwrite_files` **默认 true**【官方文档】 | 不加 `--clobber` **失败**；加了**先删后传、失败即丢**【官方文档】 |
| 找不到 release 时 | `--publish always` 或 `getCiTag() != null` ⇒ **创建**（默认 **draft**）【官方源码】 | 创建/复用（`draft` 默认 **false**）【官方文档】 | `gh release upload` 只上传，需要 release 已存在（用 `gh release create`/`view` 配套） |
| 已有 draft 时 | 复用（`if (release.draft) return release`）【官方源码】 | **不传 `draft: true` 就会把它发布出去**【官方文档】 | 取决于 tag 指向的 release 状态 |
| 静默跳过风险 | **非 draft 已存在 & 要建 draft**、**已发布 > 2 小时** ⇒ 跳过上传但 workflow 绿【官方源码】 | — | — |
| 需要的 token | `GH_TOKEN`（或 `GITHUB_TOKEN`、`GITHUB_RELEASE_TOKEN`）【官方源码】 | `github.token`（默认）【官方文档】 | `gh auth` 的 token |

**`GITHUB_TOKEN` 的官方定义（【官方文档】）：**

> At the start of each workflow job, GitHub automatically creates a unique `GITHUB_TOKEN` secret to use in your workflow. … The `GITHUB_TOKEN` secret is a GitHub App installation access token. … **The token's permissions are limited to the repository that contains your workflow.**

来源：[github/docs · `content/actions/concepts/security/github_token.md`](https://raw.githubusercontent.com/github/docs/main/content/actions/concepts/security/github_token.md)（GitHub 官方文档仓库源文件）。

> **未取到一手依据的部分：** GitHub 官方对「新建仓库的 `GITHUB_TOKEN` 默认只读」这条**本报告没有取到逐字原文**（我只取到了「权限受限于所在仓库」这一句，以及 electron-builder 官方页与 softprops README 里各自的 `permissions: contents: write` 要求）。见第 10 节第 12 条。**spec 里照写 `permissions: contents: write` 是有依据的（两处一手来源都这么要求），但不要在本报告之外声称「默认是 read-only」这个细节。**

### 8.6 两条与 v27 相关的「现在就该写进 spec」的预警（【官方文档】）

1. **隐式 publish 被删除**：v27 起必须在命令行显式给 `--publish`（官方 CLI 页原文：「Implicit publishing was also removed: pass [`--publish`](…) explicitly.」）。**如果 CI 脚本依赖「不写 `--publish` 也会自动上传」，升级到 v27 会静默变成不上传。**
2. **`CI_BUILD_TAG` 被移除**，换成 `CI_COMMIT_TAG`（v27 迁移清单原文：「Replace `CI_BUILD_TAG` … with `CI_COMMIT_TAG`」；`util/flags.ts` 里还有一条更狠的说明：「`CI_BUILD_TAG` is worse still — combined with the removal of implicit publishing, **a tagged release simply stops uploading**」）。
3. Node 版本：**v27 要求 Node.js >= 22.12.0**（v22.12.0 是 `require(esm)` 稳定化的版本）。**v26 的最低 Node 版本我没有逐字取证**——现有 CI 用 Node 22，落在 v27 的要求之上，所以两个版本都安全。

来源：[electron-builder · CLI](https://www.electron.build/docs/cli)、[v26 → v27 迁移](https://www.electron.build/docs/migration/v26-to-v27/)、[`util/flags.ts`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/util/flags.ts)。

---

## 9. Q8 · Electron 自定义协议与 CSP

### 9.1 `registerSchemesAsPrivileged` 的四个 privilege（【官方文档】）

官方汇总句原文：「Registers the `scheme` as **standard, secure, bypasses content security policy for resources, allows registering ServiceWorker, supports fetch API, streaming video/audio, and V8 code cache**. Specify a privilege with the value of `true` to enable the capability.」

字段清单以官方类型定义 [`docs/api/structures/custom-scheme.md`](https://www.electronjs.org/docs/latest/api/structures/custom-scheme) 为准，**全部默认 `false`**：

| privilege | 官方定义原文 | 本项目要不要 | 说明 |
| --- | --- | --- | --- |
| `standard` | 「A standard scheme adheres to what RFC 3986 calls generic URI syntax… **Registering a scheme as standard allows relative and absolute resources to be resolved correctly when served.** Otherwise the scheme will behave like the `file` protocol, **but without the ability to resolve relative URLs**.」+「Registering a scheme as standard will allow access to files through the FileSystem API. Otherwise the renderer will throw a security error for the scheme.」+「By default web storage apis (localStorage, sessionStorage, webSQL, indexedDB, cookies) are disabled for non standard schemes.」 | **必开** | 不开就连 IndexedDB 与 FSA 都没有，且相对 URL 解析不了 |
| `secure` | **类型定义里只有一句「Default false」**；协议页正文没有一句展开 | 建议开（官方示例就开） | **具体语义未取到一手依据**（与 `desktop-shell-facts.md` §1.1 的结论一致，本报告未能推进） |
| `supportFetchAPI` | 汇总句里的「supports fetch API」 | **必开** | 这是 LUT `fetch()` 的开关；官方只有这一句，**精确行为边界（相对路径 / 流式 / 大文件）归 spike 实测** |
| `stream` | 「Protocols that use streams (http and stream protocols) should set `stream: true`. **The `<video>` and `<audio>` HTML elements expect protocols to buffer their responses by default.** The `stream` flag configures those elements to correctly expect streaming responses.」 | **不需要**（本项目没有音视频元素） | **这是一处该纠正的常见误解：`stream` 不是「大文件必须开」** |
| `bypassCSP` | 「Default false」；汇总句里的「bypasses content security policy for resources」 | **绝对不要开** | 开了等于自己把 CSP 关掉 |
| `corsEnabled` / `allowServiceWorkers` / `allowExtensions` | 各只有「Default false」 | 不需要 | 官方无展开 |
| `codeCache` | 「Enable V8 code cache for the scheme, **only works when `standard` is also set to true**. Default false.」 | 可选 | 与 `standard` 联动 |

来源：[Electron · `protocol` · `registerSchemesAsPrivileged`](https://www.electronjs.org/docs/latest/api/protocol#protocolregisterschemesasprivilegedcustomschemes)、[Electron · CustomScheme Object](https://www.electronjs.org/docs/latest/api/structures/custom-scheme)。

### 9.2 `protocol.handle` 的推荐实现形态（【官方文档】）

官方示例的要点（逐字见 §3.1 依据 3）：

1. **必须在 `app.whenReady()` 之后**（文档顶部 note：「All methods unless specified can only be used after the `ready` event of the `app` module gets emitted.」）；而 `registerSchemesAsPrivileged` 相反：「This method can only be used **before** the `ready` event … and can be called **only once**」。
2. 返回文件用 `net.fetch(pathToFileURL(pathToServe).toString())`。
3. **官方示例里带路径穿越防护**，注释原文：`// NB, this checks for paths that escape the bundle, e.g. // app://bundle/../../secret_file.txt`，判定是 `relativePath && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)`，不通过就返回 400。
4. **一条安全相关的 `request` 字段**（原文）：「In addition to the standard `Request` fields, `request.initiatorOrigin` is set to the origin that issued the request … **Unlike `request.referrer` it is not controlled by the requesting page, so prefer it when deciding whether to serve a request.**」
5. 自定义 partition/session 时必须显式注册到那个 session（否则默认 session 的协议在该窗口里不生效）。
6. **协议名**必须符合 RFC 3986 的 scheme 语法（字母开头，后接字母/数字/`+`/`.`/`-`）。

**更推荐的替代（官方原文强烈暗示）：** `protocol.registerSource`（**Experimental**）——「Use this instead of `protocol.handle` when a scheme only serves an app's own bundled files: **no request touches the main thread**」，且**明写支持从 asar 读**（§3.1 依据 4）。代价是它标着 **Experimental**，且 route 语义（host 优先、最长 path 前缀优先、`GET`/`HEAD` 之外一律 `net::ERR_FILE_NOT_FOUND`、路径结尾 `/` 服务 `index`）与自定义响应头（示例里给了 `Cross-Origin-Opener-Policy`）都在那一页里。

来源：[Electron · `protocol`](https://www.electronjs.org/docs/latest/api/protocol)。

### 9.3 Electron 官方安全文档对 CSP 的说法（【官方文档】）

官方安全清单第 7 条「Define a `Content-Security-Policy` and use restrictive rules (i.e. `script-src 'self'`)」的正文要点：

- 正反例：「`// Bad  Content-Security-Policy: '*'`」「`// Good  Content-Security-Policy: script-src 'self' https://apis.example.com`」；
- 头部投递：「Electron respects the `Content-Security-Policy` HTTP header which can be set using Electron's `webRequest.onHeadersReceived` handler」，示例给的是 `'Content-Security-Policy': ["default-src 'none'"]`；
- meta 投递：「CSP's preferred delivery mechanism is an HTTP header. **However, it is not possible to use this method when loading a resource using the `file://` protocol.** It can be useful in some cases to set a policy on a page directly in the markup using a `<meta>` tag」；
- **Electron 不会替你注入 CSP**：文档把它列为**建议**（"We recommend that they be enabled by any website you load inside Electron."），全篇没有「打包应用默认注入 CSP」的说明。

**⇒ 本项目是 `app://` 而不是 `file://`，所以「响应头」这条路可用**（这也与 ADR 的「协议与文件访问都在主进程」一致）。第 6 条「Do not disable `webSecurity`」与第 18 条「Avoid usage of the `file://` protocol and prefer usage of custom protocols」也一并适用。

**⚠️ 一条必须写进 spec 的空白：Electron 官方安全文档从头到尾没有提 WebAssembly、`'wasm-unsafe-eval'`、worker、或 `DecompressionStream`。** 所以「自加 CSP 会不会挡住 WASM / blob worker」这件事，**在 Electron 文档里查不到答案**，只能回到 CSP 规范本身（下两节）。

来源：[Electron · Security](https://www.electronjs.org/docs/latest/tutorial/security)。

### 9.4 `'wasm-unsafe-eval'` 到底管什么（【官方 PR/规范】——规范仓库自己的 PR 原文）

CSP3 规范把 `'wasm-unsafe-eval'` 加进 `keyword-source` 语法，并新增 §4.5「Integration with WebAssembly」。**规范原文（来自 w3c/webappsec-csp 官方 PR #293 的 diff，已合并）：**

> The `script-src` directive governs **six** things:
> …
> 5. The following WebAssembly execution sinks are gated on the "`wasm-unsafe-eval`" or the "`unsafe-eval`" source expressions:
>     * `new WebAssembly.Module()`
>     * `WebAssembly.compile()`
>     * `WebAssembly.compileStreaming()`
>     * `WebAssembly.instantiate()`
>     * `WebAssembly.instantiateStreaming()`
>
>     **Note:** the "`wasm-unsafe-eval`" source expression is the more specific source expression. In particular, "`unsafe-eval`" permits both compilation (and instantiation) of WebAssembly and, for example, the use of the "`eval`" operation in JavaScript. **The "`wasm-unsafe-eval`" source expression only permits WebAssembly and does not affect JavaScript.**

以及违规上报的 resource 取值被扩为 `"wasm-eval"`：

> Each violation has a resource, which is either `null`, "`inline`", "`eval`", **"`wasm-eval`"**, or a URL.

判定算法 `EnsureCSPDoesNotBlockWasmByteCompilation` 取 `script-src`（回落到 `default-src`），若该 source list 既不含 `'unsafe-eval'` 也不含 `'wasm-unsafe-eval'`，则视 disposition 记违规并**抛 `WebAssembly.CompileError`**。

**⇒ 对本项目的直接含义（可操作）：** 本项目用 `vite-plugin-wasm` + LibRAW `.wasm`，加载路径走 `WebAssembly.instantiate`。**只要我们在 `app://` 上加了 CSP 且 CSP 含 `script-src`（或回落 `default-src`），就必须把 `'wasm-unsafe-eval'` 放进那条 source list**，否则 WASM 编译被挡并抛 `WebAssembly.CompileError`。反过来，**如果完全不加 CSP，这道门槛不存在**（官方文档也确认 Electron 不替你加）。

来源（【官方 PR/规范】）：[w3c/webappsec-csp PR #293 的官方 diff](https://patch-diff.githubusercontent.com/raw/w3c/webappsec-csp/pull/293.diff)、[CSP Level 3 Editor's Draft（§4.5 Integration with WebAssembly、§6.1.10 `script-src`）](https://w3c.github.io/webappsec-csp/#directive-script-src)。

### 9.5 blob worker 与 CSP（【官方文档】MDN + 【官方 PR/规范】CSP3）

**回退链（CSP3 §1.3 原文）：**

> A `worker-src` directive has been added, deferring to `child-src` if not present (**which likewise defers to `script-src` and eventually `default-src`**).

**MDN `worker-src` 页面对回退链的表述（一字不差地一致）：**

> The HTTP `Content-Security-Policy` (CSP) **`worker-src`** directive specifies valid sources for `Worker`, `SharedWorker`, or `ServiceWorker` scripts.
> … Fallback: If this directive is absent, the user agent will first look for the `child-src` directive, then the `script-src` directive, then finally for the `default-src` directive, when governing worker execution.

**⇒ 对本项目的直接含义：** spike 里验证过的 `blob:` module worker（`spike/electron-shell` 的 A1 项）**是在「没有 CSP」的前提下通过的**。**一旦自加 CSP**：

- 若只写 `script-src 'self'`，worker 会回退到 `script-src`，而 `blob:` 不在 `'self'` 里 ⇒ **blob worker 会被挡**；
- 要做成「能让 blob worker 跑」，必须在**生效的那条指令**上放行 `blob:` —— 写成 `worker-src 'self' blob:` 最直接（`worker-src` 是 CSP3 的指令，Baseline widely available since May 2022）。

**等级说明：** 回退链是【官方文档】+【官方 PR/规范】双证；「`blob:` 是放行 blob worker 需要的 source expression」这一点，MDN 的 `worker-src` 页在 `<source-expression-list>` 里列的是 `<host-source>`/`<scheme-source>`/`'self'`，**并没有单独点名 `blob:`**，我是按 `<scheme-source>` 的语义给出的（**未取到「`worker-src blob:` 可放行 `new Worker(blobURL)`」的逐字官方例句**）。**所以这条必须进 spike 复测**：在 `app://` + 我们真正的 CSP 下跑一次 blob worker。

来源：[MDN · `worker-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src)、[CSP Level 3 §1.3 / §6.2.2 `worker-src`](https://w3c.github.io/webappsec-csp/#directive-worker-src)。

### 9.6 `DecompressionStream` 与 CSP 的关系：**未取到一手依据**

我查了这些地方，**没有任何一手来源把 `DecompressionStream` 与 CSP 关联起来**：

1. **Electron 官方安全文档**（`tutorial/security`）的 CSP 一节：只讲 `script-src`，全文不出现 WebAssembly / worker / `DecompressionStream`。
2. **CSP3 规范的指令全集**（§6.1 Fetch Directives：`child-src`/`connect-src`/`default-src`/`font-src`/`frame-src`/`img-src`/`manifest-src`/`media-src`/`object-src`/`script-src`/`script-src-elem`/`script-src-attr`/`style-src`/`style-src-elem`/`style-src-attr`；§6.2 Other：`webrtc`/`worker-src`；§6.3 Document：`base-uri`/`sandbox`；§6.4 Navigation：`form-action`/`frame-ancestors`；§6.5 Reporting：`report-uri`/`report-to`）：**不存在任何覆盖「压缩/解压 API」的指令。**
3. **MDN 的 `script-src` 与 `worker-src` 页面**：没有提到 `DecompressionStream`。

**因此本报告不写成结论，只写两条可核查的判断：**

- **不能声称 `DecompressionStream` 需要 `'unsafe-eval'` 或 `'wasm-unsafe-eval'`** —— 没有一手来源支持，而且 CSP 的机制是「拦截资源的加载/执行」与「拦截字符串编译」，`DecompressionStream` 既不是资源加载也不是字符串编译。
- **也不建议据此把 `'unsafe-eval'` 加进 CSP** —— 那是规范里明确等价于放开 `eval()` 的东西。

**⇒ spec 里的正确写法：** 把 `'wasm-unsafe-eval'` 归因到 **WASM 编译**（有规范原文），把 `blob:` 归因到 **worker**（有规范原文），**不要把 `DecompressionStream` 归到 CSP 名下**。如果 spike 在加了 CSP 之后发现 `.cube.gz` 解压失败，**要先怀疑协议层的 `Content-Type` / `Content-Encoding`（spike A3/双重解压陷阱已经踩过一次），而不是 CSP**。

---

## 10. 未取到一手依据（本文档的空白清单）

按对 spec 的影响排序。

1. **「无证书 ⇒ 不下载 `winCodeSign`」没有真机实测。** 源码级结论很强（执行流在 `return false` 处结束，`getSignToolPath` 不被调用），但我**没有**在干净缓存下跑一次 `--win nsis` 观察网络请求。**而且必须同时记住：Electron 发行包、NSIS 工具包、7zip 工具包仍会被下载**（`ToolsetConfig` 列表 + `NsisTarget` 调 `getMakeNsisPath`/`getNsisPluginsPath`）。**「不签名」缩小的是下载面，不是把构建变成离线。**
2. **`secure` privilege 的完整语义。** 官方只有「Default false」加汇总句里的一个词，正文没有一句展开（与 `desktop-shell-facts.md` §1.1 结论一致，未推进）。
3. **`supportFetchAPI` 的精确行为边界。** 官方只有「supports fetch API」一句。相对路径解析、流式读、48.2 MB 单次 fetch 的实测归 `electron-shell-spike.md` §2.3 的补跑。
4. **asar 内的文件经 `file:` 协议是否支持 Range / 分段读。** 官方 asar 文档没有提 Range；`registerSource` 的说明里也没提。**spike 用的是整文件 `fetch`，没有触及这条。** ⇒ 若产品将来做「按需取 LUT 片段」或 `fetch` 带 `Range` 头，必须重新验证。
5. **`zip` target 在 Windows runner 上是否依赖 electron-builder 自带的 7za。** `ArchiveTarget` 调 `./archive.ts` 的 `archive()`，**该实现我没有逐行读**；`toolsets.sevenZip` 的 JSDoc 只说它用于**解压** `.7z`/`.tar.xz`。⇒ 若 CI 上 zip 步骤出错，先怀疑 7za 工具包。
6. **`deleteAppDataOnUninstall` 在 assisted（`oneClick: false`）下是否真的不生效。** JSDoc 自称 one-click only，但 `configureDefines()` 里 define 是无条件设的。**我没有读 NSIS 模板去确认 `DELETE_APP_DATA_ON_UNINSTALL` 的 guard 位置。**
7. **`portable.nsi` 之外是否还有 include 会改写 userData 位置。** 我只逐行读了 `templates/nsis/portable.nsi`；它 include 了 `common.nsh` 与 `extractAppPackage.nsh`，**这两个文件我没有读**。⇒ 「便携版 userData 与安装版同址」是**基于没看到 `--user-data-dir` 的推断**，建议在真机上确认一次 `app.getPath('userData')`。
8. **SmartScreen 在无网络时的行为。** 我们要求「完全离线」，而 Microsoft 的两页文档**都没有写**「声誉查询无法完成时会怎样」（是否放行、是否一律拦截、是否只依赖本地缓存）。⇒ 这是「完全离线 + 无签名」组合里**最大的未知**，必须实测（断网机器上首次运行安装器）。
9. **UAC「未知发布者」提示的官方逐字文案。** Microsoft 的 SmartScreen 页只写了未签名时那句 `"Windows protected your PC"` / `"Run anyway"`；**UAC 提权对话框的文案、以及「更多信息」那一步的措辞，本报告未取到官方原文。**
10. **`electron-builder` v26 的最低 Node.js 版本。** v27 的要求（>= 22.12.0）有官方原文；v26 的**没有逐字取证**（现有 CI 用 Node 22，两个版本都安全，所以影响不大）。
11. **`computeSafeArtifactNameIfNeeded` 的触发条件。** 我读到了 `NsisTarget` 侧传进去的 `generateGitHubInstallerName()`（本仓库会得到 `raw-images-studio-setup-0.1.0.exe`），**但没读那个函数的函数体**，所以「什么情况下会改名」不确定。⇒ spec 不要假设本地文件名 = Release 资产名。
12. **GitHub 对「新建仓库 `GITHUB_TOKEN` 默认只读」的官方逐字表述。** docs.github.com 的对应页面是客户端渲染的，我只从 `github/docs` 仓库源文件取到了「权限受限于所在仓库」这一句。`permissions: contents: write` 本身有两处一手依据（electron-builder 官方 GH Actions 页 + softprops README），可以照写。
13. **`worker-src blob:` 能否放行 `new Worker(blobURL)` 的逐字官方例句。** 回退链有双证；放行 `blob:` 的具体写法只有 `<scheme-source>` 的语义支撑，没有官方例句。
14. **`'wasm-unsafe-eval'` 在 Electron 44（Chromium 152）上的实际生效范围。** 规范是规范；Chromium 的实现细节本报告未核。
15. **`uninstallDisplayName` / `shortcutName` 等字符串的 NSIS 转义与长度边界**（NSIS 官方是 8192 字节上限，electron-builder 文档提到「Large strings are supported (maximum string length of 8192 bytes instead of the default of 1024 bytes)」），**逐字校验规则未取**。中文产品名（如果将来改）可能踩这条。

---

## 11. 对 `docs/spec-windows-installer.md` 的直接约束

### 11.1 能直接钉死的配置项（选项名 + 取值 + 出处）

**A. electron-builder 顶层 / 目录（【官方源码】`configuration.ts`）**

| 配置项 | 钉死的取值 | 理由与出处 |
| --- | --- | --- |
| `directories.output` | **必须显式改成非 `dist` 的值**（例如 `release`） | 默认值是 `"dist"`，**与 Vite 的产物目录同名**。electron-builder 会把安装器、便携 zip、`win-unpacked/`、`__nsis-x64/` 暂存目录全都写进这个目录；若它同时又是 `files` 的取材目录（Vite 产物就在那里），就会出现「打包器把自己的中间产物也扫进去」的自污染。出处：[`MetadataDirectories.output` `@default "dist"`](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/configuration.ts)；时序风险与 `electron-shell-spike.md` §4-A5 的「构建前必须 `rm -rf dist`」同源 |
| `directories.buildResources` | `build`（默认值即可，但**目录需要新建**） | NSIS 自定义脚本的默认位置就是 `build/installer.nsh` / `build/installer.nsi`；`@default "build"`，且「**Build resources are not copied into the packaged app**」 |
| `appId` | **显式设一个反 DNS 值，并且此后永不更改** | 默认 `com.electron.${name}` ⇒ `com.electron.raw-images-studio`；NSIS 的 GUID 由 appId 经 UUID v5 派生（`UUID.v5(appInfo.id, ELECTRON_BUILDER_NS_UUID)`），官方原文：「**you should not change appId once your application in use** (or name if `appId` was not set)」 |
| `productName` | `raw-images-studio`（显式写上，别靠回落） | 解析顺序：`build.productName` → `package.json` 顶层 `productName` → `name`。本仓库没有顶层 `productName`，所以现在回落成 `name`。产物名、快捷方式名、userData 目录名都与它相关 |
| `electronVersion` | 不必设（默认取 `package.json` 里 `electron` 依赖的版本） | 【官方源码】：「Defaults to the version of the `electron` (or `electron-prebuilt`) dependency declared in `package.json`」⇒ **spec 要先把 `electron` 加进 devDependencies** |
| `files` | **必须显式列**（例如只列 `dist/**` 与 `package.json`） | 一旦有非 `!` 的 pattern，默认 `**/*` **不会**补上；`package.json` 与生产 `node_modules/**` 无论如何会进包。出处：[`files` JSDoc](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts) |
| `asar` | **用默认（`true`），不设 `asarUnpack`（v27 是 `asar.unpack`）** | 48.2 MB 不需要解包：官方给的三类「必须解包」理由里没有「大文件顺序读」。见 §3.1 |
| `compression` | 默认 `normal`（**不要**为了体积升到 `maximum`） | 官方原文：「`maximum` **doesn't lead to noticeable size difference**, but increase build time」；而且 48.2 MB 是已 gzip 的高熵数据，压不动 |
| `extraMetadata.version` | CI 里用 `-c.extraMetadata.version=<tag 去掉 v>` | 官方 CLI 语法 + 源码证明求值顺序在 `AppInfo` 之前。见 §5.2 |
| `writeEffectiveConfig` | CI 里设 `true`（可选，排障用） | 默认「only for local interactive builds: not on CI and not when stdout is piped」；设 `true` 就把 `builder-effective-config.yaml` 落到输出目录 |
| `publish` | `{ provider: "github", owner: "<按仓库实际值>", repo: "raw-images-studio" }` | GitHub publisher 的 owner/repo「Detected automatically」，但显式写更稳；`GH_TOKEN` 是它要的凭据 |

**B. `win`（【官方源码】v26.17.0 `winOptions.ts`）**

| 配置项 | 钉死的取值 | 理由与出处 |
| --- | --- | --- |
| `win.target` | `["nsis", "zip"]`（**`zip` 就是用户要的「便携 zip」**） | 官方默认 target 是 `nsis`；`target` 接受字符串/对象/数组。`zip` 是跨平台 archive target，产物是压缩归档而非单文件 exe。见 §4 |
| `win.signExecutable` | **`false`** | 保留图标与版本信息、只跳过签名。官方 JSDoc 明写「To skip only code signing while keeping resource editing, use `signExecutable: false` instead」 |
| `win.signAndEditExecutable` | **不要设**（保持默认 `true`） | 设成 `false` 会**同时**关掉 resedit 资源编辑（图标 / 元数据 / 执行级别） |
| `win.requestedExecutionLevel` | `asInvoker`（默认值即可） | 默认就是 `asInvoker` ⇒ **应用本身不请求提权** |
| `win.icon` | 可选（默认找 `build/icon.ico`） | 不设则用 Electron 默认图标；官方 `@default build/icon.ico` |

> **v27 的等价写法（现在不要用，将来必读）：** `win.signExecutable: false` → `win.sign: false`；而 `win.sign: false` 与 `forceCodeSigning: true` **不能同用**（官方原文：那是 configuration error，构建失败）。

**C. `nsis`（【官方源码】`nsisOptions.ts` + 【官方文档】`/docs/nsis`）**

| 配置项 | 建议钉死的取值 | 理由 |
| --- | --- | --- |
| `nsis.oneClick` | **`false`**（assisted） | 只有 assisted 才能让用户选安装目录、才能出现 per-machine/per-user 选择页。官方原文：「Yes, you need to switch to assisted installer (not default one-click)」 |
| `nsis.perMachine` | **显式写死**（`false` = 默认每用户；`true` = 一律机器级、要管理员） | 默认 `false`；但在 `oneClick: false` 下它的含义是「是否显示安装模式选择页」，**必须明确表态**，否则页面行为由用户点 |
| `nsis.allowToChangeInstallationDirectory` | 若 `oneClick: false` 则**可以**设 `true`；**若 `oneClick: true` 设它会导致构建失败** | 【官方源码】抛出 `InvalidConfigurationError("allowToChangeInstallationDirectory makes sense only for assisted installer (please set oneClick to false)")` |
| `nsis.createDesktopShortcut` / `createStartMenuShortcut` | 按产品决定（默认都是 `true`） | 默认值原文见 §2.1 |
| `nsis.shortcutName` | 可选（默认 = 应用名） | 同上 |
| `nsis.deleteAppDataOnUninstall` | **建议 `false`**（默认值），并在 spec 写明「卸载不删用户数据」 | 默认 `false`；语义有 JSDoc 与源码的不一致（§10 第 6 条），**所以更要用默认值 + 显式写出来** |
| `nsis.uninstallDisplayName` | 默认 `${productName} ${version}`；如需固定可显式设 | 走 `expandMacro`，支持宏 |
| `nsis.differentialPackage` | **`false`** | 本项目**不用 electron-updater**；默认 `true` 会走差分路径并生成 blockmap / update info |
| `nsis.artifactName` | **建议显式设一个不含空格的模板**（例如 `${productName}-setup-${version}.${ext}`） | 默认是 `${productName} Setup ${version}.${ext}`（含空格，大写 `Setup`），会让 GitHub 侧改用 safe name `raw-images-studio-setup-0.1.0.exe`。**显式写死可以消掉这个不确定性** |
| `nsis.include` / `nsis.script` | **优先 `include`（默认 `build/installer.nsh`）；不要用 `script`** | 官方原文：「Custom `script` disables built-in safeguards — … electron-builder no longer generates (and signs) the uninstaller for you and skips installer size verification. **Prefer `include`** unless you really need to replace the whole script.」 |
| `nsis.useZip` | **不要设** | 官方 JSDoc：只对 portable 与 `differentialPackage: false` 的安装器生效，且 `nsis-web` 会忽略它并告警 |

**D. `portable`（若确实要出）**

| 配置项 | 取值 | 理由 |
| --- | --- | --- |
| `portable.unpackDirName` | 默认即可（per-build KSUID，落 `$TEMP`）；**若产品要求「不残留」则必须显式 `false`** | `false` 才是 per-launch 唯一的 `$PLUGINSDIR`。见 §4.2 |
| `portable.include` | **必须显式设**（不回落 `build/installer.nsh`） | 【官方源码】JSDoc 原文 |
| `portable.requestExecutionLevel` | 默认 `"user"` | 【官方源码】`@default user` |
| **「便携版不写注册表 / 不污染系统」** | **不能靠 portable 的默认行为承诺** | portable 只是「解压到临时目录再跑 + 退出清理」；userData 位置与安装版相同（§4.3），且注册表/快捷方式层面没有官方保证 |

**E. GitHub Actions workflow（【官方文档】electron-builder GH Actions 页 + GitHub 官方文档）**

```yaml
on:
  push:
    tags: ['v*']
permissions:
  contents: write
jobs:
  build:
    runs-on: windows-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
      - name: Build installer + portable zip
        run: npx electron-builder --win --x64 --publish always -c.extraMetadata.version="${GITHUB_REF_NAME#v}"
        env:
          GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}
```

| 约束 | 取值 | 出处 |
| --- | --- | --- |
| 触发 | `on.push.tags: ['v*']` | electron-builder 官方 GH Actions 页 |
| 权限 | `permissions: contents: write` | electron-builder 官方页 + softprops README |
| token | `GH_TOKEN: ${{ secrets.GITHUB_TOKEN }}` | electron-builder 官方页；源码里还可读 `GITHUB_RELEASE_TOKEN`，并 `validateResolvedToken(token, "GitHub", "GH_TOKEN")` |
| runner | `windows-latest` | 官方页；另：**构建 macOS 目标在 Windows 上会直接抛错**，反向不受限 |
| npm 缓存 | `cache: npm` | 官方页 |
| Electron 二进制缓存 | `~\AppData\Local\electron` | 官方页 |
| 版本 | **`-c.extraMetadata.version="${GITHUB_REF_NAME#v}"`**（tag 去掉 `v`） | 官方 CLI 语法 + §5.2 的求值顺序 |
| 显式 `--publish` | **必须写**（v27 起隐式 publish 被删除） | 官方 CLI 页 |
| 显式 `--win --x64` | 建议写死（不被 runner 架构影响；Electron 44 起 ia32 已不可用） | `desktop-shell-facts.md` §1.5 + 官方 NSIS 页「Electron 44 removed Windows ia32 builds」 |
| tag 与 version 一致性 | **tag 必须是 `v<package.json 或 extraMetadata 的 version>`** | `assertVersionHasNoVPrefix(version)` + `this.tag = githubTagPrefix(info) + version`（默认前缀 `"v"`） |
| 重跑 | `--publish always` 会 DELETE 同名资产再传；**但「已发布 > 2 小时」或「已存在非 draft 而本次要建 draft」会静默跳过上传** | §8.2 |

### 11.2 必须写进「已知限制」的内容

1. **未签名 ⇒ 每一个新版本从零重建 SmartScreen 声誉。** 官方原文：「Unsigned files must build reputation anew with every update」；且「There is no exact threshold, but it can take several weeks and hundreds of clean installs from a wide audience」。用户第一次运行会看到 `"Windows protected your PC"`，**必须自己选 "Run anyway"**；**企业策略可以完全禁止继续**（官方原文：「Enterprise policy can prevent continuation entirely」）。
2. **Win11 的 Smart App Control 对未签名可执行文件的检查不限于「下载来的文件」**（官方原文明确「apply to all executable files, not just those downloaded from the Internet」）⇒ **离线分发不能免掉签名检查**。
3. **EV 证书不再「秒过」SmartScreen**（2024 起，官方原文）；微软推荐的替代是 Artifact Signing（$9.99/月起 + 身份验证）且**也要累积声誉**；零警告的唯一路径是 Microsoft Store。
4. **「不签名」不等于「构建不需要联网」**：仍会下载 Electron 发行包、NSIS 工具包、7zip 工具包（甚至 `icons` 工具包，如果要转图标）。CI 需要网络 + 缓存；只有签名用的 `winCodeSign` 这一个包被省掉。
5. **便携 zip 的 `userData` 与安装版同址**（`%APPDATA%\<productName>`），官方机制里**没有**「便携版改用本地目录」的开关（§4.3、§10 第 7 条）。若产品要「绿色版」，需要显式传 `--user-data-dir`，**那是一条新增的产品决策，不在本报告的结论里**。
6. **`portable` 形态的启动开销没有一手数字**，只能从「官方提供 `splashImage`（解压期间显示）」推断解压是启动期可见成本。
7. **asar 内文件经 `file:` 协议是否支持 Range / 分段读，未取到一手依据** ⇒ 禁止在 spec 里设计依赖 Range 的取数方式。
8. **`DecompressionStream` 与 CSP 的关系未取到一手依据** ⇒ spec 里**不要**为它加任何 CSP 关键字；解压失败优先排查协议层 `Content-Type` / `Content-Encoding`（spike 的「双重解压陷阱」已踩过一次）。
9. **若自加 CSP，三件事必须同时满足**：(a) `script-src` 含 `'wasm-unsafe-eval'`（否则 WASM 编译抛 `WebAssembly.CompileError`，规范原文）；(b) worker 生效指令放行 `blob:`（否则 spike 已验证的 blob worker 会被挡，(a) 之外的另一半）；(c) **不要**开 `bypassCSP` privilege。**这三条都要在 `app://` 上实测一次**（§10 第 13/14 条）。
10. **`stream: true` 不是大文件必需项**，它只关乎 `<video>`/`<audio>`（官方原文）。spec 不要用「48.2 MB 很大」当作开它的理由。
11. **`Release` 上的资产名可能不是你本地构建的文件名**（`computeSafeArtifactNameIfNeeded` + `generateGitHubInstallerName`）⇒ 下载说明 / 校验脚本不要写死文件名，或显式设 `nsis.artifactName` 把它钉住。
12. **`--publish always` 有两类「workflow 绿但没上传」的情况**（已发布 > 2 小时；已存在非 draft 而本次要建 draft）⇒ 发版手册要写「先确认 Release 上资产时间戳」。
13. **`gh release upload` 不要在没有想清楚的情况下用 `--clobber`**（官方原文：「existing assets are deleted before new assets are uploaded. **If the upload fails, the original assets will be lost.**」）。
14. **softprops/action-gh-release 复用已有 draft 时必须显式 `draft: true`**，否则它会在上传后把 draft 发布出去（官方 README 原文）。
15. **`package.json` 目前没有 `author`** ⇒ `menuCategory: true` 会抛错；NSIS 版本信息里的 `CompanyName` 会缺省。若要发布者信息，得先补 `author`（或显式设 `win.legalTrademarks` / `copyright`）。
16. **`buildNumber` 不会在 GitHub Actions 上自动填**（官方名单里没有 `GITHUB_RUN_NUMBER`）⇒ `buildVersion` 默认就等于 `version`，`FileVersion` 与 `ProductVersion` 会是同一个值。

---

## 12. 参考链接汇总

**electron-builder（官方文档站，现已可用）**

- [`/docs/nsis/`（v27 next，NSIS 全部选项 + 自定义脚本 + portable）](https://www.electron.build/docs/nsis/)
- [`/docs/contents/`（files / asar / asarUnpack / extraResources）](https://www.electron.build/docs/contents/)
- [`/docs/cli/`（`-c.extraMetadata.foo=bar` 等 dotted 覆盖语法）](https://www.electron.build/docs/cli/)
- [`/docs/features/github-actions/`（tag 触发 + GH_TOKEN + draft + 缓存）](https://www.electron.build/docs/features/github-actions/)
- [`/docs/features/code-signing/code-signing-win/`（v27 `win.sign` 语义）](https://www.electron.build/docs/features/code-signing/code-signing-win/)
- [`/docs/migration/v26-to-v27/`（asarUnpack→asar.unpack、signAndEditExecutable→win.sign、隐式 publish 移除、CI_BUILD_TAG 移除）](https://www.electron.build/docs/migration/v26-to-v27/)

**electron-builder（官方源码，v26.17.0 = 当前 stable；master = v27 next）**

- [`nsisOptions.ts` @ v26.17.0](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts) ｜ [master](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/targets/win/nsis/nsisOptions.ts)
- [`NsisTarget.ts` @ v26.17.0](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/targets/nsis/NsisTarget.ts) ｜ 模板 [`templates/nsis/portable.nsi` @ v26.17.0](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/templates/nsis/portable.nsi)
- [`winOptions.ts` @ v26.17.0](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/options/winOptions.ts) ｜ [master](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/options/winOptions.ts)
- [`codeSign/windowsSignToolManager.ts` @ v26.17.0](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/codeSign/windowsSignToolManager.ts)
- [`codeSign/mac/macCodeSign.ts`（`CSC_IDENTITY_AUTO_DISCOVERY` 的唯一使用方）](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/codeSign/mac/macCodeSign.ts)
- [`util/flags.ts`（`isAutoDiscoveryCodeSignIdentity` + v27 移除的环境变量清单）](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/util/flags.ts)
- [`configuration.ts`（`directories` / `compression` / `buildVersion` / `extraMetadata` / `ToolsetConfig`）](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/configuration.ts)
- [`PlatformSpecificBuildOptions.ts` @ v26.17.0（`files` / `extraResources` / `asar` / `artifactName`）](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/options/PlatformSpecificBuildOptions.ts)
- [`CommonWindowsInstallerConfiguration.ts` @ v26.17.0（快捷方式 / `menuCategory` 的落地规则）](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/options/CommonWindowsInstallerConfiguration.ts)
- [`ArchiveTarget.ts`（zip/7z 默认产物名）](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/targets/ArchiveTarget.ts)
- [`packager.ts` @ v26.17.0（`extraMetadata` 的求值顺序）](https://raw.githubusercontent.com/electron-userland/electron-builder/electron-builder@26.17.0/packages/app-builder-lib/src/packager.ts)
- [`appInfo.ts`（`version` / `buildVersion` / `appId` / `productName`）](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/app-builder-lib/src/appInfo.ts)
- [`electron-publish/src/gitHubPublisher.ts`（tag 反推、draft 默认、同名资产覆盖、2 小时规则）](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/electron-publish/src/gitHubPublisher.ts)
- [`builder-util-runtime/src/publishOptions.ts`（`GithubOptions.tagNamePrefix` / `releaseType`）](https://raw.githubusercontent.com/electron-userland/electron-builder/master/packages/builder-util-runtime/src/publishOptions.ts)
- [electron-builder releases/latest（实测 stable = 26.17.0）](https://api.github.com/repos/electron-userland/electron-builder/releases/latest)

**Electron 官方文档**

- [`protocol`（privileges 全文、`protocol.handle` 示例、`registerSource`）](https://www.electronjs.org/docs/latest/api/protocol)
- [`CustomScheme` 结构定义（9 个字段，全默认 false）](https://www.electronjs.org/docs/latest/api/structures/custom-scheme)
- [`net.fetch`（支持 `file:` 与自定义协议；不支持 `data:`/`blob:`）](https://www.electronjs.org/docs/latest/api/net)
- [ASAR Archives（`file:` 协议把 asar 当目录；Node API 的限制清单）](https://www.electronjs.org/docs/latest/tutorial/asar-archives)
- [Security 教程（第 6 条 webSecurity、第 7 条 CSP、第 18 条避免 `file://`）](https://www.electronjs.org/docs/latest/tutorial/security)

**CSP（规范 / MDN）**

- [w3c/webappsec-csp PR #293 官方 diff（`'wasm-unsafe-eval'` 的规范原文与 5 个受控 sink）](https://patch-diff.githubusercontent.com/raw/w3c/webappsec-csp/pull/293.diff)
- [CSP Level 3 Editor's Draft（§4.5 Integration with WebAssembly、§6.1.10 `script-src`、§6.2.2 `worker-src`、§1.3 回退链）](https://w3c.github.io/webappsec-csp/)
- [MDN · `worker-src`（回退链原文）](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/worker-src)
- [MDN · `script-src`](https://developer.mozilla.org/en-US/docs/Web/HTTP/Reference/Headers/Content-Security-Policy/script-src)

**Microsoft（SmartScreen）**

- [SmartScreen reputation for Windows app developers](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation)
- [Current status of Windows app distribution features（EV 规则变更）](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/distribution-feature-status)

**GitHub**

- [softprops/action-gh-release README（`overwrite_files` 默认 true、draft 陷阱、`contents: write`）](https://github.com/softprops/action-gh-release/blob/master/README.md)
- [GitHub CLI manual · `gh release upload`（`--clobber` 的丢资产风险）](https://cli.github.com/manual/gh_release_upload)
- [github/docs · `content/actions/concepts/security/github_token.md`（`GITHUB_TOKEN` 定义）](https://raw.githubusercontent.com/github/docs/main/content/actions/concepts/security/github_token.md)

**本仓库内**

- [`research/desktop-shell-facts.md`](desktop-shell-facts.md)（选型调研；§9.7 关于「官方文档站不可用」的结论已被本文档 §1.1 修正）
- [`research/electron-shell-spike.md`](electron-shell-spike.md)（§5 第 6 条「不签名时是否下 winCodeSign」由本文档 §6.1 回答；§4-A 的 asar 取舍由本文档 §3.1 回答）
- [`docs/adr/0001-windows-desktop-shell.md`](../docs/adr/0001-windows-desktop-shell.md)（Electron + 自定义协议 + 渲染进程不开 Node 能力的既定决策）
