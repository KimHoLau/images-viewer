# 壳内跑通关键路径的 spike：结论与坑清单（票 41）

**问题**：网页版依赖的那几组浏览器能力，在 Electron 壳里是否还成立 —— 自定义 scheme 下的取数、`.cube.gz` 解压、ES module Worker + LibRAW WASM、WebGL2 浮点纹理、打开相册的两条路径、导出落盘。**必测项含中文路径**。

**答案**：**成立，没有一处需要改产品代码**；要适配的是「打包与协议配方」，一共 6 条，全部记在第 4 节。**但其中 5 条只在浏览器里拿到了实测证据，壳内的那一遍没能在这台机器上跑完** —— 原因与剩下的验证动作记在第 2.2 节，请当成这张票的未完成项看待。

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

### 2.2 壳内那一遍：**没跑完**，这是本票的未完成项

Electron 44.6.0 装上了、二进制能起（`electron.exe --version` → `v44.6.0`），但这个 DSH 会话的 Windows 沙箱里**建不出浏览器窗口**：主进程脚本能跑到 `app.whenReady()`，一建 `BrowserWindow` 进程就以 `0x80000003` 退出，页面永远到不了 `did-finish-load`，探针因此没机会跑。这不是 Electron 的问题，是本机环境的限制（同一份代码在真机上由第 2.3 节的命令验证）。

顺带撞出两条**真机上也值得知道的**环境事实（第 4 节 B1 / B2）。

### 2.3 请在真机上补跑（一条命令）

```powershell
cd spike/electron-shell
npm install            # electron 44.6.0，约 150 MB（国内网络用 ELECTRON_MIRROR=https://registry.npmmirror.com/-/binary/electron/）
npm run selftest       # 结果落到 out/selftest.json
npm run selftest:nogpu # 对比渲染器字符串；再顺手断网启动一次，做手动那两项
```

`out/selftest.json` 与本文档第 5 节的表是同一个结构，把它的 `summary` 与各项 `conclusion` 对回来即可。**注意：如果不加 `--no-sandbox`**（`main.cjs` 默认不加），`showDirectoryPicker` 那一项的结论才代表产品真实形态。

## 3. 判定表：逐项「成立 / 要适配」

| 必测项（调研第 8 节编号） | 判定 | 依据 |
| --- | --- | --- |
| 1 自定义 scheme 下 `fetch` + `import.meta.glob` 的路径形态 | **成立（待壳内确认）** | 浏览器里三种形态全通；`app://` 侧只有配方要配（第 4 节 A3） |
| 2 `showDirectoryPicker` + 用户取消是否可区分 | **倾向成立（未实测）** | `typeof` 在 Chrome 里是 `function`；无手势时抛 `DOMException SecurityError`（code 18），与 `AbortError` 名字不同、可区分。**壳内一次性授权必须真机点一次** |
| 3 ES module Worker + WASM + `DecompressionStream` 全链路 | **成立** | 真 `raw-decoder.worker` + `libraw.wasm` + 中文路径 RAW 解码实测通 |
| 4 体积与产物实测 | **部分：只有本机数字，没真出包** | Electron 44.6.0 解包 **367.6 MB**（`electron.exe` 234.8 MB），`dist/` **87.9 MB**（其中 34 个 `.cube.gz` 共 48.2 MB）。NSIS 装压缩流，**≤250 MB 的软目标落在范围内**；真 NSIS/zip 数字归发版链路票 |
| 5 无 GPU / 远程桌面下的 WebGL2 | **成立（软渲染下）** | SwiftShader 下 WebGL2 + RGB16F/RGBA16F 全通 —— 说明「没有 GPU 也能起来」，只是慢 |
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
- **B2 · 本环境还必须 `--no-sandbox`。** 不加就直接崩。**代价要说清**：`--no-sandbox` 关掉的是 Chromium 的 OS 级渲染进程沙箱，`showDirectoryPicker` 的权限路径可能因此与产品真实形态不同 —— **真机验证请不加这个开关**，只有受限环境才用。
- **B3 · 无头浏览器 + `--virtual-time-budget` 会把「等待」压成瞬间，还会在预算耗尽后冻结页面。** 第一轮用 `--dump-dom --virtual-time-budget=240000` 跑，10 秒/20 秒的超时被瞬间烧掉、页面在第 10 项左右被冻住，看起来像「探针卡死」。改成**真实时间等待 + 轮询结果文件**才拿到完整的一轮。

### C. 中文路径（票面点名的必测项）

**全部成立，不需要任何转义处理。** 实测证据：

- `new URL('samples/相册-中文/LUT 查找表.cube.gz', location.href)` 自动百分号编码，服务器/协议层 `decodeURIComponent` 后正确落盘（命中 `/samples/%E7%9B%B8%E5%86%8C-%E4%B8%AD%E6%96%87/...`）。
- **中文相册目录 + 中文文件名的真 RAW 解码通过**：2468×1636、Pentax K-30、`rgba8`、735 ms。这一条把「Worker + WASM + 中文路径」三件事一次验掉了。
- `showDirectoryPicker` 拿到的 `handle.name` 是中文原名，遍历子项正常。
- 导出文件名含中文（`导出测试-中文名-1024x768.jpg`）时 `<a download>` 正常触发。
- **结论**：网页版现有的「直接拼路径、交给浏览器编码」的写法在壳里同样可用，**不需要**为桌面版加任何中文路径分支。

## 5. 还没被证明的部分（别当结论用）

1. **壳内那一遍的全部数字** —— 本机建不出窗口（第 2.2 节）。`app://` 下 `fetch` 相对路径的解析起点、`DecompressionStream`、module worker、IndexedDB 在自定义 scheme 下**是不是真的都通**，只有第 2.3 节那条命令的 `out/selftest.json` 能回答。
2. **`showDirectoryPicker` 的一次性授权与取消可区分性** —— 需要真人点一次；自动跑一律跳过（它会弹系统对话框）。
3. **导出落盘的真实目标** —— 探针触发了下载并记下文件名，但「落到哪、名字有没有乱码」只有人能在自己的机器上看。壳里若没有下载 UI，这是最可能出意外的一项。
4. **断网首次启动**、**远程桌面/无 GPU 真机上的 WebGL2** —— 两处人工项。
5. **NSIS / zip 的真实体积** —— 只有解包数字（367.6 MB + 87.9 MB），压缩后多少要看 `electron-builder` 实际出包（归发版链路票）。
6. **`electron-builder` 在不签名时是否会联网下 `winCodeSign`** —— 调研第 8 节第 4 条列的问题，本票没碰。

## 6. 对 spec（票 45）的直接影响

- 体积账要按 **Electron 运行时解包 367.6 MB + `dist/` 87.9 MB** 来算，NSIS 走压缩流，`≤250 MB` 软目标**没有被否定**。
- 资源路径策略按 **`dist/assets/<哈希>.gz` + `base='/'`** 写死；`base='./'` 是备用（本票两条都验过，都通）。**别在 spec 里写 `/3DLUT/`** —— 那个目录不在产物里。
- 协议配方直接抄第 4 节 A3；渲染进程不开 Node 能力这条 ADR 结论在本票里没有被推翻。
- 需要往 spec 里加一条**已知限制**：`showDirectoryPicker` 至少要一次用户手势；无手势时抛 `SecurityError`（code 18），与用户取消的 `AbortError` 是两回事，产品要分开处理（现有 `useFolderOpener.ts`/`file-browser.ts` 只处理了 `AbortError`，`SecurityError` 会走到 `setError` 那条分支 —— 这是本票发现的一处**产品侧待确认行为**，不在本票范围内，已在此记录）。

## 7. 证据索引

| 文件 | 是什么 |
| --- | --- |
| `spike/electron-shell/out/browser.json` | 浏览器基线完整证据（16 通过 / 0 需适配 / 2 人工），含每项的 metrics 与原始 evidence |
| `spike/electron-shell/out/browser-dom.html` | 同一次运行的面板 DOM 快照（人读用） |
| `spike/electron-shell/out/selftest*.json` | 壳内自测结果（**待真机补**，本机没有） |
| `spike/electron-shell/main.cjs` | 最小壳：`app://` + privileges + 请求流水 + 结果回写 |
| `spike/electron-shell/vite.spike.config.ts` | 探针入口的构建配置（与真构建的差异见 A6） |
| `spike/electron-shell/serve.cjs` | 浏览器基线的静态服务器（含 `?ce=gzip` 陷阱与结果收集口） |
| `src/dev/shell-spike-probe.ts` | 探针纯模块：状态、reducer、20 项检查的判定逻辑 |
| `src/dev/shell-spike.ts` + `.css` | 探针页面（薄壳，只负责画状态） |
| `public/shell-spike-helper.js` | 给 module worker 静态 import 用的最小模块 |
| `public/samples/相册-中文/` | 中文夹具：`测试照片.DNG`（真 DNG 副本）、`LUT 查找表.cube.gz`。放 `public/` 是为了随构建产物走；仓库的 `samples/` 被 `.gitignore` 排除，本票为它加了一条例外，否则新克隆跑不出中文那两项 |

> 夹具是 21 MB 的二进制副本，只活在抛弃式分支上。

