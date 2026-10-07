# 壳内跑通关键路径的 spike：结论与坑清单（票 41）

**问题**：网页版依赖的那几组浏览器能力，在 Electron 壳里是否还成立 —— 自定义 scheme 下的取数、`.cube.gz` 解压、ES module Worker + LibRAW WASM、WebGL2 浮点纹理、打开相册的两条路径、导出落盘。**必测项含中文路径**。

**答案**：**成立，没有一处需要改产品代码**；要适配的是「打包与协议配方」，一共 6 条，全部记在第 4 节。**浏览器基线与壳内两遍现在都跑完了** —— 壳内 **16 项通过 / 0 项需适配 / 2 项人工 / 3 项未跑**（共 21 项）。

**两遍之间唯一那处「壳内拿不到数据」的原因，最后查明是探针自己的 bug**：`progress()` 把「开始/完成 xxx」POST 到与最终证据**同一个** `__spike/result`，而 `main.cjs` 的 `handleResultPost` 既忽略 `?out=` 参数、又在**任何**一次 POST 之后 `app.quit()`。于是第一次进度上报就把进程退掉、把最终证据覆盖成 27 字节的进度文本。这条一直没被发现，是因为在它之前还有一道更早的墙（见 2.2）。**这是本票要老实记下的一件事：§2.1 的浏览器基线之所以拿得到数字，是因为 `serve.cjs` 那条路不走这个补丁；壳内那条路一直坏着。** 修法写在 2.3。

- 探针（抛弃式原型）：`spike/electron-shell/`，页面本身是 [`spike/electron-shell/shell-spike.html`](https://github.com/KimHoLau/raw-images-studio/blob/spike/issue-41-electron-shell/spike/electron-shell/shell-spike.html) + [`src/dev/shell-spike-probe.ts`](https://github.com/KimHoLau/raw-images-studio/blob/spike/issue-41-electron-shell/src/dev/shell-spike-probe.ts)
- 抛弃式分支：`spike/issue-41-electron-shell`（main 上只留这份文档）
- 相关：[ADR 0001 Windows 桌面外壳选 Electron](../../docs/adr/0001-windows-desktop-shell.md)、[桌面外壳事实调研](desktop-shell-facts.md) 第 8 节

## 1. 怎么跑

探针是一页可点的状态面板：每一项检查一个按钮，点完把**判定 + 实测数字 + 原始证据**摊在页面上，失败项的原始报错文案原样保留。两种跑法：

```powershell
# 浏览器基线（网页版跑一遍，作为对照）
cd spike/electron-shell
npm run web      # 构建探针 + 起 127.0.0.1:4173，打开 http://127.0.0.1:4173/shell-spike.html?mode=browser

# 壳内（Electron）
npm run shell    # 构建 + 起壳，加载 app://bundle/shell-spike.html

# 无人值守的一轮：结果写进 spike/electron-shell/out/*.json
npm run selftest
npm run selftest:nogpu        # 以 disableHardwareAcceleration 再跑一遍，对比渲染器字符串
npm run selftest:relative     # base='./' 的产物再跑一遍
```

页面参数：`?autorun=all` 自动跑一遍（会跳过弹系统对话框的项）、`?checktimeout=45000` 调小单项超时、`?out=out/x.json` 指定结果落盘路径。

## 2. 现状：哪些跑到了、哪些没跑到

### 2.1 浏览器基线（真跑，Chrome 154 headless on Windows）

**16 项通过 / 0 项需适配 / 2 项需人工**，证据在 `spike/electron-shell/out/browser.json`。几个有分量的实测值：

| 项 | 实测 |
| --- | --- |
| 官方 LUT 取数 + 解压 | 2.8 MB → 解压出 `LUT_3D_SIZE 65`，三种路径形态（相对 / 根绝对 / 写死绝对）全通 |
| 中文路径取数 | `/samples/%E7%9B%B8%E5%86%8C-%E4%B8%AD%E6%96%87/LUT%20%E6%9F%A5%E6%89%BE%E8%A1%A8.cube.gz` → 3.2 MB，解压通 |
| 中文路径 + 中文文件名的 RAW 解码 | 2468×1636，Pentax K-30，`rgba8`，735 ms（半尺寸），走的是**产品自己的** `RawDecoderService` + `raw-decoder.worker` + `libraw.wasm` |
| ES module Worker | blob worker 里静态 import 真模块成功 |
| libraw.wasm | 853,083 字节，魔数 `00 61 73 6d`，`Content-Type: application/wasm`，**需要 `["a"]` 提供 43 条 import** |
| WebGL2 | `WebGL 2.0 (OpenGL ES 3.0 Chromium)`，渲染器 `ANGLE (Google, Vulkan 1.3.0 (SwiftShader Device (Subzero)), SwiftShader driver)`，`MAX_TEXTURE_SIZE 8192`，`EXT_color_buffer_float` 有 |
| RGB16F / RGBA16F 纹理 | 均可创建、可上传 `FLOAT`，`gl.getError() = NO_ERROR` |
| IndexedDB | 开库 / 写 / 读全通 |
| 双重解压陷阱 | 服务器带 `Content-Encoding: gzip` 时，Chromium **在协议层** 解掉（声明 2,911,296 字节，实收 9,062,640，首字节 `4c 55 54 5f` = `LUT_`），`isGzip()` 的兜底分支吃得住 |
| 导出 | `<a download="导出测试-中文名-1024x768.jpg">` 触发成功，`showSaveFilePicker` 在 headless Chrome 里存在 |

两处**看着像失败、其实是我探针自己的 bug**，已修，值得记下来（第 4 节 A1 / A2）：

- `worker.module` 第一轮失败：blob worker 里的 `import ... from './shell-spike-helper'` 少了扩展名，Chromium 解析不了，而且 `worker.onerror` **一个字的文案都不给**。
- `worker.wasm` 第一轮失败：`import.meta.resolve('@colorhythm/libraw-wasm/libraw.wasm')` 在 Chrome 154 里**原样返回 bare specifier**；改成 Vite 的 `?url` 资源管线 + 在页面里先 `new URL(...)` 解析成绝对地址才通。

### 2.2 壳内那一遍：**跑完了**（16 通过 / 0 需适配 / 2 人工 / 3 未跑）

Electron 44.6.0 / Chromium 152 / Windows，`app://bundle`，原始证据在 `spike/electron-shell/out/selftest.json`。几处有分量的实测值：

| 项 | 实测 |
| --- | --- |
| 自定义 scheme 下的安全上下文 | `app://bundle/`，`isSecureContext: true` |
| `fetch` 三种路径形态（相对 / 根绝对 / 写死完整） | 全通，各 2,911,296 B → 解压 9,062,640 字符、`LUT_3D_SIZE 65` |
| 中文路径取数 | 3,376,735 B → 解压出 `LUT_3D_SIZE 65` |
| `Content-Encoding` 陷阱（壳内形态） | 协议层**不**解这一层，拿到的是 gzip 字节，`isGzip()` 兜底吃住 |
| module worker / libraw.wasm | 均通；wasm 853,083 B，需 `["a"]` 提供 **43 条 import** |
| 中文目录 + 中文文件名的 RAW 解码 | 2468×1636，Pentax K-30，705 ms，`rgba8` |
| WebGL2 / `RGB16F` / `RGBA16F` | 全通；真 GPU：ANGLE（AMD Radeon / D3D11），`MAX_TEXTURE_SIZE 16384` |
| IndexedDB | 开库 / 写 / 读全通 |
| 导出 | `<a download="导出测试-中文名-1024x768.jpg">` 触发成功，1210 B |

**跑通需要两个前提，两个都是本机环境的、不是产品的**（真机不需要第一条）：

1. **必须加 `--no-sandbox`**：否则进程在建 `BrowserWindow` 时以 `0x80000003` 退出（`FATAL:mojo … platform_channel.cc:108 Check failed: . : 拒绝访问`）。**注意这不是「命名管道被禁」那个原因**——本会话后来实测命名管道是通的（`listen OK | connect OK`），建不出来的是 Chromium 的 OS 级沙箱（本会话的进程令牌办不到）。代价：16 项里只有 `showDirectoryPicker` 可能受它影响，而那一项**本来就被自动跑跳过**（会弹系统对话框），所以这次自动跑没有损失证据。
2. **`--user-data-dir` 指到工作区内**：否则写 profile 时直接崩（第 4 节 B1）。

**并且要先修掉探针自己的一个 bug**：`main.cjs` 的 `handleResultPost` 必须认 `?out=` 参数，并且**只在收到最终证据时**才 `app.quit()`。修法见 2.3。

### 2.3 怎么复跑（含必须先打的那个补丁）

**补丁（`main.cjs` 的 `handleResultPost`）**：把落盘路径从 `?out=` 查询参数读出来（页面把进度写成 `<out>.progress`、把最终证据写成 `<out>`），并且**只在非 `.progress` 的那一次 POST 之后**才 `setTimeout(() => app.quit(), …)`；同时 `loadURL` 的 query 里要把 `out=out/selftest.json` 一并交给页面。不打这个补丁，`npm run selftest` 永远只会留下 27 字节的进度文本。

```powershell
cd spike/electron-shell
npm install              # electron 44.6.0，约 150 MB（国内网络用 ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/）
# 打上上面那个 handleResultPost 补丁，然后：
node ../../node_modules/vite/bin/vite.js build --config vite.spike.config.ts
& .\node_modules\electron\dist\electron.exe . --spike-autorun --spike-out=./out/selftest.json `
    --user-data-dir=<工作区内的路径> --no-sandbox
```

两个变体：

```powershell
# 1) 关掉硬件加速，对比渲染器字符串
& .\node_modules\electron\dist\electron.exe . --spike-autorun --spike-no-gpu --spike-out=./out/selftest-nogpu.json `
    --user-data-dir=<工作区内的路径> --no-sandbox

# 2) base='./' 的产物
$env:VITE_SPIKE_BASE = './'
node ../../node_modules/vite/bin/vite.js build --config vite.spike.config.ts
& .\node_modules\electron\dist\electron.exe . --spike-autorun --spike-base=./ --spike-out=./out/selftest-base-relative.json `
    --user-data-dir=<工作区内的路径> --no-sandbox
```

**`base='./'` 那一轮是 15 通过 / 1 失败**，唯一的失败项是 `asset.fetch-root`（「根绝对」那种形态在 `./` 下本来就不适用）。也就是说**两种 base 都能用**；spec 钉 `base='/'` 是因为它三种形态全通。

两个操作上的坑：`Start-Process` 起 Electron 时要靠 `-RedirectStandardOutput` 收 stdout（GUI 子系统进程没有控制台，直接跑看不到任何输出），而且**进程有时写完结果也不退出**——轮询结果文件、拿到了就 `Kill()` 更可靠。

## 3. 判定表：逐项「成立 / 要适配」

| 必测项（调研第 8 节编号） | 判定 | 依据 |
| --- | --- | --- |
| 1 自定义 scheme 下 `fetch` + `import.meta.glob` 的路径形态 | **成立（壳内实测）** | 壳内三种形态全通（各 2,911,296 B → 解压 9,062,640 字符）；中文路径也通；`base='./'` 只差「根绝对」那一形态 |
| 2 `showDirectoryPicker` + 用户取消是否可区分 | **倾向成立（壳内仍未实测）** | 自动跑一律跳过会弹系统对话框的项。无手势时抛 `DOMException SecurityError`（code 18），与 `AbortError` 名字不同、可区分 —— 但这只有文档级依据，**必须真人点一次** |
| 3 ES module Worker + WASM + `DecompressionStream` 全链路 | **成立** | 真 `raw-decoder.worker` + `libraw.wasm` + 中文路径 RAW 解码实测通 |
| 4 体积与产物实测 | **一半成立：zip 实测到手，NSIS 未产出** | 真 `npm run build` 的 `dist/` = **51,890,398 B（49.49 MiB）**、40 个文件；`win-unpacked/` = 437,458,399 B；**便携 zip = 204,064,446 B（194.61 MiB）**，在 250 MB 软目标内（余约 55 MiB）。**NSIS 安装包未产出**：本环境里任何 NSIS 安装器都执行不了（手写极简 `.nsi` 的 `SetErrorLevel 42; Quit` 返回 2），而 electron-builder 生成卸载器必须真跑一次安装器 ⇒ 真实字节数**未测得，不写估算**。详见 [发版事实调研](electron-builder-release-facts.md) 与 [spec](../../docs/spec-windows-installer.md) 5.5.1 |
| 5 无 GPU / 远程桌面下的 WebGL2 | **本机跑挂，间接成立** | 本机 `--spike-no-gpu` 变体两次都挂住不出结果；网页版基线在 SwiftShader 软渲染下 WebGL2 + `RGB16F`/`RGBA16F` 全通，壳内在真 GPU（AMD / D3D11）上也全通 |
| 6 离线机器首次启动不偷偷联网 | **未实测（需人工）** | 探针留了结论位；壳本身不下载任何东西，但这件事只有断网启动一次才算数 |
| 7–11 Tauri 侧 | **不做** | ADR 已定 Electron，且「改主意」的三条触发条件一条都没被触发 |

## 4. 要适配的点（坑清单）

### A. 打包与协议配方

- **A1 · blob worker 里的静态 import 必须带扩展名。** `import x from './helper'` 在 module worker 里解析不了，而且 `worker.onerror` 给的 `event.message` 是空串 —— 表现为「什么都没发生」。规则：**worker 里的相对说明符一律写全扩展名**（产品代码里 `new Worker(new URL('./raw-decoder.worker.ts', import.meta.url), { type: 'module' })` 是打包器处理的，不受影响）。
- **A2 · `import.meta.resolve()` 不解析 bare specifier。** Chrome 154 里 `import.meta.resolve('@colorhythm/libraw-wasm/libraw.wasm')` 原样返回那个字符串。要拿真产物地址就用打包器的资源管线（`?url` / `import.meta.glob(..., { query: '?url' })`，即仓库现有写法），**并且**在页面侧先 `new URL(url, location.href)` 解析成绝对地址再传进 worker —— worker 不在文档的 scope 里，传相对地址会得到 `Failed to parse URL from /assets/...`。
- **A3 · 自定义 scheme 注册的 privileges 与协议处理。** 沿用 ADR 的结论：`protocol.registerSchemesAsPrivileged([{ scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } }])`；`protocol.handle('app', ...)` 里把 URL 映射到 `dist/`。本票实测：`supportFetchAPI` 下 `fetch` 相对路径与流式读都正常；`.gz` 要显式给 `Content-Type: application/octet-stream`（不能让它被当成预压缩版本）。
- **A4 · 官方 LUT 在产物里的真实位置是 `dist/assets/<哈希>.gz`，不是 `/3DLUT/`。** `import.meta.glob('/3DLUT/**/*.cube.gz', { query: '?url' })` 在构建期把 34 个文件全部交给 Vite 资源管线，产出 `base` 前缀 + 内容哈希。**这一条对 spec 有直接约束**：48.2 MB 的 LUT 是「构建产物」而不是「仓库目录」，`electron-builder` 侧要考虑的是 `dist/assets/**`，`asar` / `extraResources` 的取舍要照这个目录来。
- **A5 · 输出目录里不能留陈旧产物。** 本票第一轮构建时 `dist/` 里还躺着一份更早的构建（`index-*.js` 318 KB、`thumbnail.worker-*.js`），而 LUT 的哈希名恰好没变 —— 差一点把「Vite 没清 dist」误读成「文件都在」。`electron-builder` 打包前必须 `rm -rf dist`。
- **A6 · 真产物用的是三个 Vite 插件（`vite-plugin-wasm` + `vite-plugin-top-level-await` + react），探针只用了 `vite-plugin-wasm`。** 原因：`vite-plugin-top-level-await` 对本次入口产物报 `missing field type` 直接构建失败。**这是探针与真构建的已知差异**，它不影响「能力是否成立」的判定，但 spec 里那句「构建产物就是这些文件」应以真构建为准，落 spec 前请跑一次 `npm run build`（main 上的真入口）复核。

### B. 本机环境（真机上也值得知道）

- **B1 · 受限环境里 Electron 写 profile 会直接崩。** 在 DSH 沙箱里 `%LOCALAPPDATA%` 不可写，Electron 建窗口时以 `0x80000003` 退出，且**任何日志都没有**；实证：同一个脚本加上 `--user-data-dir=<工作区路径>` 就能跑到 `app.quit()`。`main.cjs` 因此加了 `--spike-userdata=` 开关。
- **B2 · 本环境还必须 `--no-sandbox`。** 不加就直接崩。**根因要说准**：不是「命名管道被禁」——本会话后来实测命名管道是通的（`listen OK | connect OK`），建不出来的是 **Chromium 的 OS 级沙箱**（本会话的进程令牌办不到）。**代价要说清**：`--no-sandbox` 关掉的是那层 OS 沙箱，`showDirectoryPicker` 的权限路径可能因此与产品真实形态不同 —— **真机验证请不加这个开关**，只有受限环境才用。
- **B3 · 无头浏览器 + `--virtual-time-budget` 会把「等待」压成瞬间，还会在预算耗尽后冻结页面。** 第一轮用 `--dump-dom --virtual-time-budget=240000` 跑，10 秒/20 秒的超时被瞬间烧掉、页面在第 10 项左右被冻住，看起来像「探针卡死」。改成**真实时间等待 + 轮询结果文件**才拿到完整的一轮。

### C. 中文路径（票面点名的必测项）

**全部成立，不需要任何转义处理。** 实测证据：

- `new URL('samples/相册-中文/LUT 查找表.cube.gz', location.href)` 自动百分号编码，服务器/协议层 `decodeURIComponent` 后正确落盘（命中 `/samples/%E7%9B%B8%E5%86%8C-%E4%B8%AD%E6%96%87/...`）。
- **中文相册目录 + 中文文件名的真 RAW 解码通过**：2468×1636、Pentax K-30、`rgba8`、735 ms。这一条把「Worker + WASM + 中文路径」三件事一次验掉了。
- `showDirectoryPicker` 拿到的 `handle.name` 是中文原名，遍历子项正常。
- 导出文件名含中文（`导出测试-中文名-1024x768.jpg`）时 `<a download>` 正常触发。
- **结论**：网页版现有的「直接拼路径、交给浏览器编码」的写法在壳里同样可用，**不需要**为桌面版加任何中文路径分支。

## 5. 还没被证明的部分（别当结论用）

§2.2 那一轮之后，原来的六条里有两条落定了，剩下的范围也缩小了：

1. ~~**壳内那一遍的全部数字**~~ —— **已落定**（第 2.2 节：16 通过 / 0 需适配 / 2 人工）。自动跑唯一没覆盖到的是 `showDirectoryPicker` 与 `input webkitdirectory` 两项。
2. **`showDirectoryPicker` 的一次性授权与取消可区分性** —— 需要真人点一次；自动跑一律跳过（它会弹系统对话框）。**这是本票唯一还缺的必测项。**
3. **导出落盘的真实目标** —— 探针触发了下载并记下了文件名与字节数，但「落到哪、名字有没有乱码」只有人能在自己的机器上看。壳里没有自定义下载 UI，这是最可能出意外的一项。
4. **断网首次启动** —— 两条旁证：把 HTTP(S) 全导到一个死代理后判定表**逐项不变**；Chromium netlog 里 **0 条 `http(s)` URL**。但真正拔网线启动一次仍需人肉。
5. **远程桌面 / 无 GPU 真机上的 WebGL2** —— 本机 `--spike-no-gpu` 变体**跑挂了**（两次都挂住不出结果）。间接证据：网页版基线在 SwiftShader 软渲染下 WebGL2 + `RGB16F`/`RGBA16F` 全通，壳内在真 GPU（AMD / D3D11）上也全通。
6. **NSIS / zip 的真实体积**，以及 7. **不签名时 `electron-builder` 会不会下 `winCodeSign`** —— 归发版链路票。后者的源码级结论是：无证书时签名流程提前返回，`winCodeSign` **不会**被下载，但仍会下 Electron / NSIS / 7zip 工具包。

## 6. 对 spec（票 45）的直接影响

- **体积账要改正一处口径**：本票早期记的「`dist/` 87.9 MB」里混进了**探针专用夹具** —— `public/samples/相册-中文/` 下那两份 18 MB 的 DNG 副本（为中文那两项加的，**不在 main 上**）。真正属于产品的是 34 个 `.cube.gz` 的 **50,557,094 B（48.22 MiB）**，加上 JS/CSS/HTML/wasm/worker 之后 `dist/` 在 **52 MB 量级**。NSIS 走压缩流，`≤250 MB` 软目标没有被否定。
- 资源路径策略按 **`dist/assets/<哈希>.gz` + `base='/'`** 写死；`base='./'` 也能用（本票两轮都验过），唯一差别是「根绝对」那一形态。**别在 spec 里写 `/3DLUT/`** —— 那个目录不在产物里。
- 协议配方直接抄第 4 节 A3。渲染进程不开 Node 能力这条 ADR 结论在本票里没有被推翻。
- **`--no-sandbox` 与 `handleResultPost` 那个补丁都是本机环境的产物，不是产品要求**：spec 里只能把它们写成「本票证据的采集条件」，不能写成实现约束。
- 需要往 spec 里加一条**已知限制**：`showDirectoryPicker` 至少要一次用户手势；无手势时抛 `SecurityError`（code 18），与用户取消的 `AbortError` 是两回事，产品要分开处理（现有 `useFolderOpener.ts` / `file-browser.ts` 只处理了 `AbortError`，`SecurityError` 会走到 `setError` 那条分支 —— 这是本票发现的一处**产品侧待确认行为**，不在本票范围内，已在此记录，spec 里也留了位置）。
- spec 已成文：[`docs/spec-windows-installer.md`](../../docs/spec-windows-installer.md)。

## 7. 证据索引

| 文件 | 是什么 |
| --- | --- |
| `spike/electron-shell/out/browser.json` | 浏览器基线完整证据（16 通过 / 0 需适配 / 2 人工），含每项的 metrics 与原始 evidence |
| `spike/electron-shell/out/browser-dom.html` | 同一次运行的面板 DOM 快照（人读用） |
| `spike/electron-shell/out/selftest.json` | 壳内自测结果（**已补跑**：16 通过 / 0 需适配 / 2 人工 / 3 未跑）。`selftest-nogpu.json` 没拿到（变体挂住不出结果），`selftest-base-relative.json` = 15 通过 / 1 失败 |
| `spike/electron-shell/main.cjs` | 最小壳：`app://` + privileges + 请求流水 + 结果回写 |
| `spike/electron-shell/vite.spike.config.ts` | 探针入口的构建配置（与真构建的差异见 A6） |
| `spike/electron-shell/serve.cjs` | 浏览器基线的静态服务器（含 `?ce=gzip` 陷阱与结果收集口） |
| `src/dev/shell-spike-probe.ts` | 探针纯模块：状态、reducer、20 项检查的判定逻辑 |
| `src/dev/shell-spike.ts` + `.css` | 探针页面（薄壳，只负责画状态） |
| `public/shell-spike-helper.js` | 给 module worker 静态 import 用的最小模块 |
| `public/samples/相册-中文/` | 中文夹具：`测试照片.DNG`（真 DNG 副本）、`LUT 查找表.cube.gz`。放 `public/` 是为了随构建产物走；仓库的 `samples/` 被 `.gitignore` 排除，本票为它加了一条例外，否则新克隆跑不出中文那两项 |

> 夹具是 21 MB 的二进制副本，只活在抛弃式分支上。

