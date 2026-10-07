# Raw Images Studio

一款浏览器里的图片查看器：支持 RAW 解码、LUT 调色、基础调整与导出，Lightroom 风格暗色界面。
全部处理都在客户端完成，图片不上传。

## 快速开始

```bash
npm install
npm run dev          # 开发服务器
npm run build        # 生产构建
npm test             # 单元测试
npm run typecheck    # 类型检查
npm run lint         # 代码检查
npm run lut:pack     # 把 3DLUT/ 里的官方 .cube 预压缩成 .cube.gz
npm run pack:win     # 出 Windows 安装版与便携 zip（见「Windows 桌面版」）
```

`3DLUT/` 下的原始 `.cube` 是厂商素材（34 个文件 216 MB），不随仓库分发，`.gitignore` 已经排除；
仓库里放的是 `npm run lut:pack` 压出来的 `.cube.gz`（约 48 MB）。要在本地补齐原始文件，
按 `src/lut/official-lut-sources.json` 里的目录结构把厂商 LUT 放进去，再跑一次 `npm run lut:pack`。

## 技术栈

React 19 + Vite 6 + TypeScript（strict）+ Zustand 5 + Vitest 3。
渲染是 WebGL2 单 pass 片元着色器；RAW 解码是 LibRaw 的 WASM 构建，跑在 Web Worker 里。

## 模块结构

```
src/
├── color/             色彩空间数学
│   ├── log-spaces.ts         14 种 Log 空间的数据表（顺序 = uniform 取值）
│   ├── log-curves.ts         14 条 Log 编码/解码曲线的 CPU 实现
│   ├── log-gamut.ts          按 id 的色域转换
│   ├── log-index.ts          按下标的视图：曲线、正反矩阵、越界兜底
│   └── matrices.ts           3×3 矩阵工具与 ProPhoto → sRGB 矩阵
├── renderer/          WebGL2 渲染与调整运算
│   ├── ImageRenderer.ts      纹理上传、uniform、离屏导出渲染
│   ├── shaders.ts            顶点/片元着色器（GLSL ES 3.00）
│   ├── log-shader.ts         Log 曲线与色域矩阵的 GLSL（数值从 log-curves.ts 插值）
│   ├── adjustments-math.ts   调整运算的 CPU 实现（GLSL 的镜像）
│   ├── view-transform.ts     适应窗口/缩放/平移的几何计算
│   └── renderer-registry.ts  当前渲染器登记处，供导出面板复用
├── lut/               3D LUT
│   ├── types.ts / generate.ts        数据结构与采样函数烘焙
│   ├── parse-cube.ts / parse-3dl.ts  .cube / .3dl 解析
│   ├── official-lut-sources.json     色彩空间 → 3DLUT/ 目录的映射（打包脚本读同一份）
│   ├── official-luts.ts              官方 LUT 的清单（构建期 glob）与按需载入
│   └── texture.ts                    RGBA16F 3D 纹理上传
├── services/          浏览器 I/O 与纯逻辑
│   ├── file-browser.ts       文件夹/文件打开（含降级方案）
│   ├── image-loader.ts       统一的图片加载入口
│   ├── raw-decoder.worker.ts RAW 解码 Worker（sRGB 8-bit / ProPhoto linear 16-bit）
│   ├── raw-metadata.ts       LibRaw getter → RawMetadata 的映射（worker 与验证脚本共用）
│   ├── libraw-loader.ts      LibRaw WASM 初始化
│   ├── thumbnail*.ts         缩略图（Worker + IndexedDB + LRU）
│   ├── export.ts             导出（尺寸、编码、下载）
│   ├── exif.ts               导出 EXIF：读 RAW 容器的 IFD、筛字段、序列化、注入容器
│   └── pixel-utils.ts        位图/像素缓冲工具
├── store/             Zustand：应用状态 + 视图状态
├── components/        UI 组件（含 LogPanel 色彩空间选择）
├── hooks/             数据加载与交互逻辑
└── dev/               真实浏览器验证脚本：webgl-check.ts / lut-check.ts / exif-check.ts（见下）
```

仓库根的 `scripts/pack-luts.mjs` 把 `3DLUT/` 里的原始 `.cube` 压成 `.cube.gz`（`npm run lut:pack`）；
`scripts/probe-thumb-exif.mjs` 探一份 RAW 的内嵌预览 APP1 / 容器 IFD / LibRaw 三组字段，
`scripts/verify-export-exif.mjs` 是导出 EXIF 的端到端验证（见「导出 EXIF 验证」）。

**分层原则**：像素运算、几何计算、解析器、尺寸换算这类纯逻辑都从浏览器 I/O 里拆出来，
这样它们能在 jsdom 里被单元测试盯住。

## 几个关键决定

**调整运算写了两遍（GLSL + CPU）。** `renderer/shaders.ts` 是渲染的唯一真相，
`renderer/adjustments-math.ts` 是同一套运算的 CPU 版本。写两遍的代价是可能漂移，
因此 `shaders.test.ts` 会检查：每个参数键都有对应的 uniform 声明、两边的常量逐值相等、
五个步骤的执行顺序一致。收益是这些数学能被单元测试覆盖（GPU 代码在 CI 里跑不了），
导出也能复用同一套运算。

**LUT 放在线性运算之后。** `.cube` 这类 LUT 是按 gamma 编码后的显示值定义的，
喂线性值会明显偏暗。所以管线是「线性空间调整 → 转回 sRGB → 套 LUT」。
这一点与 `research/webgl-rendering.md` 里的示例不同，是有意纠正。

**Log 色彩空间：把视频 LUT 用在 RAW 上。** 创意 LUT 是按 Log 编码值定义的，
直接喂 sRGB 显示值得到的是另一回事。选中一个 Log 空间（共 14 种，与
[Raw-Alchemy](https://github.com/shenmintao/Raw-Alchemy) 一致）之后，管线变成：

```
ProPhoto linear（RAW 16-bit 解码）→ 基础调整 → 目标 Log 色域 → Log 编码
  → LUT（在 Log 空间）→ Log 解码 → 回 ProPhoto → ProPhoto→sRGB 原色 → 显示
```

几个要点：

- **RAW 解码要跟着换。** Log 编码需要线性光与足够动态范围，8 位 sRGB 两条都不满足，
  所以 Log 模式启用时 Worker 用 `output_bps=16 + output_color=ProPhoto + gamma(1,1)` 重新解码，
  像素以 `Float32Array` 交给渲染器，上传成 `RGB16F` 纹理（`u_inputLinear = 1`）。
- **只对 RAW 开放。** 非 RAW 图片拿不到线性数据，下拉框禁用而不是给出错误结果。
- **LUT 夹在编解码之间**，强度滑块照旧在原值与 LUT 结果之间插值。
- **显示前要换回 sRGB 原色**（`PROPHOTO_TO_SRGB`），只套 gamma 的话画面会明显发灰。
- **关闭时逐位等同旧行为**：`u_logMode = 0` 时着色器完全不进 Log 分支。
- Log 相关的数学是 GLSL 与 CPU 双份，数值上**只写一遍**：`log-shader.ts` 把
  `log-curves.ts` 导出的常数插值进 GLSL，`log-shader.test.ts` 再反向核对
  「GLSL 里出现的每个小数都必须来自那些常数」。

色域矩阵与曲线参数取自 colour-science（`colour.matrix_RGB_to_RGB` 与 `cctf_encoding`），
推导过程与出处记在 `research/log-color-spaces.md`。

**官方 LUT 按色彩空间自动出清单，且只有选中才去取文件。** 厂商的官方 LUT 是 65³ 的纯文本
`.cube`，单个 7–9 MB：整份进仓库是 216 MB，全列出来再逐个下载是 90 MB。所以仓库里放的是
`npm run lut:pack` 压出来的 `.cube.gz`（约 48 MB，客户端 `DecompressionStream` 解压，
65³ 精度不变、单个传输约 1.5 MB），清单则在构建期用 `import.meta.glob` 扫出来——没有运行时
清单请求，也不存在「清单里列了但文件不在」。`.gz` 被服务器当成预压缩资源顺手解掉时
（`Content-Encoding: gzip`，Vite dev 与 GitHub Pages 都这么干），fetch 拿到的已经是明文；
加载器按 gzip 魔数分流，两种都吃。

**官方 LUT 与导入的 LUT 是两个选择。** 前者跟着色彩空间走（换空间就作废），后者是用户自己
准备的素材（换文件夹都留着），所以各占一个下拉。两者互斥——选一个会清掉另一个，因为同一个
画面上只该有一个 LUT 生效。换色彩空间只换清单，不会自动套用第一个：富士一个目录里 13 个
LUT 风格差得很远（ACROS / ASTIA / ETERNA / Velvia…），自动选一个会让人以为「选了色彩空间
画面就该变成那样」。

**导入的 LUT 是「库 + 当前选中」两件事。** 文件输入支持一次多选，全部进 `lutLibrary`，
再用下拉框切换当前生效的那一个；每个都能单独移除，删掉选中项会回退到库里剩下的第一个。

- **逐个解析，坏文件不连坐**：一个 `.cube` 解析失败时，同批其他文件照常入列，失败原因按
  文件名就地列在面板上。这条**故意不走 `setError`**——那会把 `status` 打成 `error` 并盖掉
  整个界面，而一两个坏文件不该让用户看不到正在看的图。
- **同名视为替换**：同名 LUT 再导入不产生重复项，键保持不变，所以选择与顺序都不会跳。
- **库不随换文件夹清空**：导入的 LUT 是用户准备的素材，换文件夹只把它从「选中」变成「没选中」。
- **不做持久化**：刷新页面后库就空了（把 LUT 存进 IndexedDB 是另一个特性）。


**拖滑块不走 React 渲染。** 调整参数与 LUT 变化通过 `useAppStore.subscribe` 直接喂给渲染器，
每帧只更新 uniform 与一次 draw call，不触发组件重渲染。

**动态分辨率缩放。** 缩放、拖拽、拖滑块时按半分辨率渲染，停手 200ms 后补一张全分辨率的，
给 24MP 级别的图留出帧预算。平移量在 store 里以 CSS 像素记录，切换倍率时按比例换算，画面不会跳。

## 真实 WebGL 验证

jsdom 没有 WebGL，着色器能否编译、GPU 输出对不对，单元测试都验证不了。
`src/dev/webgl-check.ts` 是为此准备的一次性验证脚本（不被任何入口引用）：

```bash
npx vite --port 5211
chrome --headless=new --enable-unsafe-swiftshader --virtual-time-budget=60000 \
  --dump-dom http://localhost:5211/webgl-check.html
```

结果在 dump 出来的 `WEBGL-CHECK-BEGIN` / `WEBGL-CHECK-END` 之间，共 62 项：

- 着色器编译链接、默认参数下管线是恒等变换
- 12 组调整参数下 GPU 输出与 CPU 实现一致（最大偏差 2.9/255，即量化误差量级）
- 3D LUT 轴向正确（用换通道 LUT 验）、夹具 LUT 的 GPU 与 CPU 一致、黑白夹具输出为灰
- **Log 模式：14 个空间逐个比对 GPU 与 CPU 输出（偏差 ≤ 0.6/255）、与全部 3 个夹具 LUT
  逐一组合、LUT 强度 0 等于不套 LUT、屏幕读回的像素与离屏导出逐像素一致（0/255）、
  关闭后退回原路径；另外读两次 GL 错误标志，因为 uniform 类型不匹配只会静默置位、不抛异常**
- 离屏导出的尺寸、方向（readPixels 是左下原点，少翻一次就上下颠倒）、是否带上调整与 LUT
- 导出编码成 JPEG/WebP/PNG 后能解码回来，尺寸与方向仍正确
- 真实图片文件 → `ImageLoader` 解码 → 位图 → 渲染

**改动着色器或渲染路径之后应该重跑一遍。** 这条规矩不是形式：Log 模式的色域矩阵最初用
`gl.uniform3fv` 上传（mat3 不是 vec3 数组），WebGL 只置了一个 `INVALID_OPERATION`，
矩阵全零、画面全黑，而所有单元测试都是绿的——只有这里跑一遍才现形。

同一条规矩后来在一次改动里又救了两次，都是单元测试看不见的：手写四面体插值进 GLSL 时，
（1）角下标先 `floor` 再逐轴 +1，在格点位置贴着上界时会越界，于是先夹 `base`，结果四个角
退化成一个、**白点被插成黑**；（2）`clamp(rgb, 0, 1) * (size - 1)` 在 float32 里会把边界值
舍成比 `size - 1` 略大，`floor` 直接得到 `size`，同样让四个角塌到同一个。两次都是
jsdom 里 522 项全绿、只有这里跑才现形。最终写法是「`near = min(floor(pos), size - 2)`，
上界再留 1e-4 个格点的余量」，`webgl-check` 的 `3D LUT 轴向正确（换通道 LUT）`
（把纯白点当作探针）就是盯这一条的。


### 官方 LUT 加载验证

`.cube.gz` 是预压缩资源，服务器对它的处理并不一致：Vite dev（实测）与 GitHub Pages 会给它加
`Content-Encoding: gzip`，浏览器早在 fetch 那一层就替我们解了压；换个服务器又可能把 gzip 字节
原样发出来。再加上 `ImageCanvas` 会把 `setLut` 的异常吞掉并退回「不套 LUT」——静态 LUT 静默
失效在单测里看不出来。`src/dev/lut-check.ts` 就是为此准备的：

```bash
npx vite --port 5211
chrome --headless=new --enable-unsafe-swiftshader --virtual-time-budget=90000 \
  --dump-dom http://localhost:5211/lut-check.html
```

结果在 dump 出来的 `LUT-CHECK-BEGIN` / `LUT-CHECK-END` 之间，共 31 项：

- 14 个色彩空间逐个列清单：5 个有映射的必须有条目、其余 9 个必须为空
- 每个映射目录取第一个 LUT 真解出来（ARRI / 富士是 65³ = 823875 个数值，尼康是 33³）
- 把这 5 个官方 LUT 逐个套到真实 GPU 上：与 CPU 镜像的偏差 ≤ 0.5/255（实测），
  且「套上」与「不套」的画面确实不同——后一条专门盯静默失效，只看前者会漏掉它
- 取文件与上传 65³ 纹理之后读一次 GL 错误标志

**改 `official-lut-sources.json`、换 LUT 素材、动 `scripts/pack-luts.mjs` 之后应该重跑一遍。**

### 导出 EXIF 验证

导出的图片要带上原 RAW 的拍摄信息（相机、镜头、曝光三要素、拍摄时间）。这件事有两处
单测看不见的风险：canvas 编码器真正吐出来的字节长什么样（有没有 JFIF APP0、PNG 的 chunk
怎么排、插进去的段会不会顶掉它），以及**用自己写的解析器验自己写的字节是循环论证**——
读写两头一起错也照样自洽。

```bash
node scripts/verify-export-exif.mjs          # --keep 保留产物，自己拿看图软件打开
```

它起 vite、起一个收结果的本地服务、驱动 headless chrome 跑 `exif-check.html`，把产物落盘后
交给 **Pillow**（另一份 EXIF 实现）逐项判定。结果分两段打印：页面自查（真浏览器里的编码与
注入）与 Pillow 核对，共 90 项。

在 `samples/IMGP2971.DNG`（宾得 K-30，容器是 `MM` 大端）上实测：

- 容器 IFD 那条路取到 `Make=PENTAX`、`Model=PENTAX K-30`、`Software=K-30 Ver 1.06`、
  `DateTime`/`DateTimeOriginal=2026:10:05 13:16:28`、`Artist=KIMHO`、`ISO=100`、35mm 等效 46
- 像素绑定字段被归一化：`Orientation=1`、像素尺寸跟着导出尺寸走（缩到长边 640 时是 640×427）
- 非 TIFF 容器走 LibRaw 字段兜底那条路验了**两遍**：一遍喂手写字面量（覆盖镜头/机身序列号
  种类），一遍喂**真 LibRaw 从样本解出来的**元数据（证明这条链在真实数据上走得通）。
  两遍都经由产品路径同一个 `buildRawMetadata`，所以验证脚本不会和 worker 悄悄漂开
- 每份产物都确认**没有**写进去的东西：`GPSInfo`、`MakerNote`、容器专属的 `CFARepeatPatternDim`
- 每份产物都用 Pillow **完整解一遍像素**——注入要是破坏了熵编码数据，只看文件头发现不了
- WebP 带来源与不带来源的字节数完全相同——`unsupported` 没有偷偷改字节

**动 `src/services/exif.ts`、`raw-metadata.ts` 或导出管线之后应该重跑一遍。**

## 已知限制

- **1D LUT 不支持**：解析 `.cube` 时遇到 `LUT_1D_SIZE` 会抛出明确错误，而不是悄悄解析错。
- **视频范围未转换**：`.cube` 的 `LUT_IN_VIDEO_RANGE` / `LUT_OUT_VIDEO_RANGE` 会被解析出来，
  但没有做 64–940 的范围转换。
- **只实现了三线性插值**：调研把 tetrahedral 列为可选的第四阶段，未实现。
- **官方 LUT 只覆盖 5 个色彩空间，且只列 SDR 显示空间的输出**：`Arri LogC4`、`F-Log`、
  `F-Log2`、`F-Log2C`、`N-Log` 有对应目录（映射在 `src/lut/official-lut-sources.json`），
  其余 9 个色彩空间的下拉是空的。ARRI 目录里的 P3 / HLG / St2084 输出**没有列出来**：
  工程把 LUT 输出直接当 sRGB 显示值用，这些输出需要另外的显示管线，列出来只会得到偏色或
  「HDR 当 SDR 看」的结果。
- **65³ 的官方 LUT 要下载再解析**：单个约 1.5 MB、解压后 274625 行，首次选中会有可感知的
  停顿；解析结果按文件缓存，来回切不会重解析。
- **原始 `.cube` 不在仓库里**：仓库只放 `npm run lut:pack` 压出来的 `.cube.gz`（见「快速开始」），
  换了厂商 LUT 要重新跑一次打包，否则清单与文件对不上。
- **RAW 解码只在 `samples/IMGP2971.DNG`（宾得 K-30）上实测过**：其他厂商与格式未验。
  `raw-decoder.worker` 的调用顺序与错误路径有 mock 测试覆盖（`raw-decoder.worker.test.ts`）。
  用别的机器拍的文件时请重点确认。
  Log 模式走的 ProPhoto linear 16-bit 路径同样只有 mock 覆盖（GPU 侧的数学已在
  `webgl-check` 里逐空间比对过，缺的是真实 RAW 那一段）。
- **导出走 `<a download>`**：没有用 `showSaveFilePicker` 做「另存为」。
- **导出 EXIF 只保留拍摄信息，且只有 JPEG 与 PNG 写**：
  - **WebP 不写**：它的 `EXIF` chunk 载荷在容器规范里没写清楚、读者支持也找不到一手依据，
    两处不确定叠在一起，所以不做。导出面板在选中 WebP 时会如实标注。
  - **只保留，不编辑**：写进去的是从 RAW 源读到的原值，没有手填作者/版权/关键词的入口；
    也**不写** GPS（避免导出文件默认外泄位置）。面板给了一个「保留拍摄信息（EXIF）」开关
    （默认开），关掉就导出一份干净的图。
  - **MakerNote 与容器专属标签不搬**：MakerNote 的内部偏移搬到新块里多半失效（ExifTool
    自己也要 `-fixBase` 去修），宁可不带也不带一份坏的；`StripOffsets`/`SubIFDs`/`DNGPrivateData`
    这类指向原文件其他位置的标签更不能带。
  - **只认 TIFF 系容器的 IFD**（DNG/NEF/ARW/CR2/PEF/SRW/ORF/RW2）：CR3/RAF/X3F 这类非 TIFF
    封装走 LibRaw 解析出的字段兜底，字段比容器 IFD 少（拿不到 `ExposureProgram`/`MeteringMode`/
    `Flash` 等）。内嵌预览里的 APP1 **没有**作为第三条来源——实测仓库里唯一那份样本的预览是
    裸 JPEG，`dcrawMakeMemThumb()` 给的那条 APP1 是 LibRaw 合成的最小块（`Software` 写着
    `dcraw v9.26`），没有 MakerNote 与拍摄时间。
  - **源范围只含 RAW**：常规格式（JPEG/PNG/WebP/TIFF）源文件的 EXIF 不参与保留。
  - **`Orientation` 一律写 1**，前提是「解码出来的像素已经摆正」。撑住这条的是 LibRaw 的
    `user_flip` 默认值 `-1`（取 RAW 里的方向），解码路径从没设过它，所以 `dcrawProcess()`
    会按原文件的方向把像素转正。**但仓库唯一的样本 `getFlip()` 是 0，需要旋转的 RAW 没有实测
    覆盖**，只有 LibRaw 文档支撑；第一次拿竖拍 RAW 导出时请重点确认方向。
  - **ASCII 标签按 Latin-1 取字节**（`& 0xff`）：相机写进来的字符串基本是 ASCII，偶尔带
    Latin-1 重音字符（é）也对；但 `U+00FF` 以上的码位（中文等）无法往返。EXIF 的 ASCII 类型
    本身只认 7 位，这类文本在规范里该走 `UserComment`，本项目不做那套转换。
- **Log 模式下的基础调整仍在 ProPhoto linear 上做**，亮度权重还是 Rec.709 那一组
  （`0.2126/0.7152/0.0722`）。它和 ProPhoto 原色不是一套，影响的是高光/阴影与饱和度
  对色相的加权方式。这里有意保持与调整功能引入时一致——本功能只做色彩空间转换，

- **LUT 在哪个空间里生效，取决于你有没有选 Log 空间**。不选（「关闭」）时 LUT 直接套在
  sRGB 显示值上，这对显示空间的 LUT 是对的；但按 Log 编码值定义的 LUT（ARRI
  `LogC4 → Rec.709` 这类技术转换、各家的 Log 转换 LUT）这样用会得到错的结果：实测把
  sRGB 中灰 `0.46` 喂给官方 `ARRI_LogC4-to-Gamma24_Rec709-D65_v1-33.cube` 会输出
  `201/255`（本该 ~118），暗部 `0.10` 被砸到 `5/255`，亮部 `0.80` 直接撞到 `254/255`。
  这类 LUT 必须先在「Log 色彩空间」里选一个空间，像素才会被送进 Log 定义域再采样。
- **LUT 的输出在哪个空间也必须显式选**（选中 Log 空间并挂上 LUT 后面板里会出现「LUT 输出空间」）：
  - **显示空间（默认）**：LUT 的输出已经是给屏幕看的显示值——ARRI 的 `LogC4 → Rec.709`
    这类**完整技术转换**都是这种，工程按 Rec.709 γ2.4 → 线性 → sRGB 显示。判据：喂 18% 灰时
    它输出 `0.396`，而 γ2.4 下 `0.396` 正是 18% 灰的标准显示值。
  - **Log 空间**：LUT 输出仍是 Log 编码值（串联多个 Log LUT 时用），工程解码回工作空间再显示。

  把显示空间的 LUT 误选成「Log 空间」会得到**纯青的天空**：多出来的那次 LogC4 解码把蓝通道
  从 `0.50` 放大到 `2.26`，夹紧后就是 `(0, 255, 255)`。实测真实 DNG 的天空区域里有大量像素
  G、B 同时撞顶；选对之后是 `(114, 127, 140)`，零个撞顶。
- **没有相机匹配提升**：非 ARRI 素材选 `Arri LogC4` 用 ARRI 的 LUT 时，中性轴仍然准确
  （灰还是灰），但高饱和区会有预期内的色相/饱和度偏差——因为素材的实际色域并不是
  ARRI Wide Gamut 4。要用准，就选与素材匹配的空间（索尼 S-Gamut3.Cine 素材选
  `S-Log3.Cine`，佳能选 `Canon Log 3`），再配对应厂商的 LUT。
- **相机专用 LUT 用在别的机身上，曝光基准是错位的**：ARRI 的技术 LUT 按 ARRI 的基准曝光校准，
  套在别的机身拍的 RAW 上，中间灰虽然落在正确位置（实测 18% 灰 → LUT 输出 `0.396`），
  但高光滚降比照片渲染器（相机 JPEG、Lightroom）强得多——同一片天空实测暗约 1.5 档。
  这不是 bug，是技术转换的设计；想要更亮就用曝光滑块补偿。
  不顺手改已有调整的行为。
- **没有镜头校正与相机匹配提升**：Raw-Alchemy 在 Log 转换前还会做镜头校正与
  饱和度/对比度补偿，这两项不在范围内。
- **Log 模式更吃显存与内存**：ProPhoto linear 走 `Float32Array` + `RGB16F` 纹理，
  24MP 一张大约 288MB 主线程缓冲、144MB 显存。从「关闭」切到某个 Log 空间会重新解码
  一次 RAW，大文件上能感觉到停顿；在几个 Log 空间之间来回切则不会——解码参数只取决于
  「是不是 RAW + Log 开没开」，这一点由 `useCurrentImage` 的依赖项保证。
- **没有做帧率对比**：票 #21 要求测 Log 模式开/关的渲染帧率。Log 分支只多了几次
  `log2`/`pow` 与两次 3×3 矩阵乘，理论上开销在噪声量级，但仓库里没有稳定的无头计时基准，
  量出来的数字不可复现，所以宁可不写。真实 WebGL 那套检查覆盖的是正确性，不是性能。

## Windows 桌面版

同一份 `src/` 有两个出口：网页版（GitHub Pages）与 Windows 桌面版（Electron 壳）。桌面版完全离线可用，
34 个官方 LUT 全部随包；只出 64 位 Windows（Win10 1809+ / Win11），行为与网页版一致。

下载在 [Releases](https://github.com/KimHoLau/raw-images-studio/releases)：

- `raw-images-studio-<version>-win-x64-setup.exe` —— 安装版，装到当前用户，**不需要管理员权限**（0.1.0 实测 153 MiB）
- `raw-images-studio-<version>-win-x64-portable.zip` —— 便携版，解压即用（0.1.0 实测 196 MiB）

**这个包没有代码签名**：第一次运行会看到 SmartScreen 的「Windows protected your PC」，
点「更多信息」→「仍要运行」即可。每个新版本都要重新攒一次声誉 —— 这是不做签名的代价，不是文件损坏。

用户数据在 `%APPDATA%\raw-images-studio`（目前只有缩略图缓存）。**卸载不会删它**；要清干净就手动删这个目录。
便携版的用户数据也落在同一个位置，所以它不是「绿色版」。

本地出包：

```bash
npm run pack:win     # = npm run build:desktop && electron-builder --win --x64 --publish never
```

> **NSIS 安装包要求 `%TEMP%` 可写。** `makensis` 生成安装向导的「安装模式选择页」时要在临时目录里建文件，
> 建不出来就报 `!tempfile: Unable to create temporary file!`，而且**只在 NSIS 那一步失败，zip 照常产出**。
> 撞到这个错就把 `TEMP`/`TMP`/`TMPDIR` 指到一个可写目录再跑一次（CI 上不存在这个问题）。
> 详见 [`docs/spec-windows-installer.md`](docs/spec-windows-installer.md) 的 5.5.2。

发版：推一个等于 `v<package.json version>` 的 tag，`.github/workflows/release-windows.yml` 会出两个产物
加一份 `SHA256SUMS.txt`，并建一个 **draft** Release 等你确认后再发布。

每一处决定的取值与理由在 [`docs/spec-windows-installer.md`](docs/spec-windows-installer.md)；
外壳选型在 [`docs/adr/0001-windows-desktop-shell.md`](docs/adr/0001-windows-desktop-shell.md)；
一手取证在 [`research/electron-shell-spike.md`](research/electron-shell-spike.md) 与
[`research/electron-builder-release-facts.md`](research/electron-builder-release-facts.md)。

## 部署

推送到 `main` 会触发 `.github/workflows/deploy.yml`：跑类型检查、Lint、测试、构建，
然后发布到 GitHub Pages。构建时 `GITHUB_ACTIONS` 环境变量会让 Vite 把资源路径前缀设成
`/raw-images-studio/`（项目页路径），本地构建仍是根路径。

Pages 已启用（Source = **GitHub Actions**，`build_type: workflow`），推 `main` 即发布到
<https://kimholau.github.io/raw-images-studio/>。

> 仓库在 2026-10-07 由 `images-viewer` 改名为 `raw-images-studio`。GitHub **不会**重定向
> Pages 的项目页地址（[改名文档](https://docs.github.com/en/repositories/creating-and-managing-repositories/renaming-a-repository)
> 把 project site URLs 列为自动重定向的唯一例外），所以旧地址
> <https://kimholau.github.io/images-viewer/> 已失效；issue、git 远端与 API 仍由 GitHub 自动重定向。

改名对 Pages 的完整取证见 [`research/pages-rename.md`](research/pages-rename.md)。
