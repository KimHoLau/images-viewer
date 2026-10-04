# Images Viewer

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
```

## 技术栈

React 19 + Vite 6 + TypeScript（strict）+ Zustand 5 + Vitest 3。
渲染是 WebGL2 单 pass 片元着色器；RAW 解码是 LibRaw 的 WASM 构建，跑在 Web Worker 里。

## 模块结构

```
src/
├── renderer/          WebGL2 渲染与调整运算
│   ├── ImageRenderer.ts      纹理上传、uniform、离屏导出渲染
│   ├── shaders.ts            顶点/片元着色器（GLSL ES 3.00）
│   ├── adjustments-math.ts   调整运算的 CPU 实现（GLSL 的镜像）
│   ├── view-transform.ts     适应窗口/缩放/平移的几何计算
│   └── renderer-registry.ts  当前渲染器登记处，供导出面板复用
├── lut/               3D LUT
│   ├── types.ts / generate.ts        数据结构与采样函数烘焙
│   ├── parse-cube.ts / parse-3dl.ts  .cube / .3dl 解析
│   ├── presets.ts                    七个内置预设
│   └── texture.ts                    RGBA16F 3D 纹理上传
├── services/          浏览器 I/O 与纯逻辑
│   ├── file-browser.ts       文件夹/文件打开（含降级方案）
│   ├── image-loader.ts       统一的图片加载入口
│   ├── raw-decoder.worker.ts RAW 解码 Worker
│   ├── libraw-loader.ts      LibRaw WASM 初始化
│   ├── thumbnail*.ts         缩略图（Worker + IndexedDB + LRU）
│   ├── export.ts             导出（尺寸、编码、下载）
│   └── pixel-utils.ts        位图/像素缓冲工具
├── store/             Zustand：应用状态 + 视图状态
├── components/        UI 组件
├── hooks/             数据加载与交互逻辑
└── dev/webgl-check.ts 真实 WebGL 验证脚本（见下）
```

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

**内置预设不打包资源文件。** 七个预设写成采样函数，选中时现烘成 33³ 的 3D LUT 并缓存，
风格逻辑可读可测，加预设就是加一个纯函数。

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

结果在 dump 出来的 `WEBGL-CHECK-BEGIN` / `WEBGL-CHECK-END` 之间，共 35 项：

- 着色器编译链接、默认参数下管线是恒等变换
- 12 组调整参数下 GPU 输出与 CPU 实现一致（最大偏差 2.9/255，即量化误差量级）
- 3D LUT 轴向正确（用换通道 LUT 验）、预设 GPU 与 CPU 一致、黑白预设输出为灰
- 离屏导出的尺寸、方向（readPixels 是左下原点，少翻一次就上下颠倒）、是否带上调整与 LUT
- 导出编码成 JPEG/WebP/PNG 后能解码回来，尺寸与方向仍正确
- 真实图片文件 → `ImageLoader` 解码 → 位图 → 渲染

**改动着色器或渲染路径之后应该重跑一遍。**

## 已知限制

- **1D LUT 不支持**：解析 `.cube` 时遇到 `LUT_1D_SIZE` 会抛出明确错误，而不是悄悄解析错。
- **视频范围未转换**：`.cube` 的 `LUT_IN_VIDEO_RANGE` / `LUT_OUT_VIDEO_RANGE` 会被解析出来，
  但没有做 64–940 的范围转换。
- **只实现了三线性插值**：调研把 tetrahedral 列为可选的第四阶段，未实现。
- **RAW 解码未在真实 RAW 文件上验证过**：仓库里没有可用的 RAW 样本，
  `raw-decoder.worker` 的调用顺序与错误路径有 mock 测试覆盖（`raw-decoder.worker.test.ts`），
  但真实文件的解码结果没有实测。首次使用时请重点确认。
- **导出走 `<a download>`**：没有用 `showSaveFilePicker` 做「另存为」。

## 部署

推送到 `main` 会触发 `.github/workflows/deploy.yml`：跑类型检查、Lint、测试、构建，
然后发布到 GitHub Pages。构建时 `GITHUB_ACTIONS` 环境变量会让 Vite 把资源路径前缀设成
`/images-viewer/`（项目页路径），本地构建仍是根路径。

首次部署需要在仓库设置里把 Pages 的 Source 选成 **GitHub Actions**。
