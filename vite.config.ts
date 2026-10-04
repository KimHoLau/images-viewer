import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

/**
 * GitHub Pages 的项目页部署在 https://<user>.github.io/<repo>/ 下，
 * 资源路径必须带上仓库名前缀，否则 JS/WASM/Worker 全部 404。
 * 本地开发与 CI 之外的构建保持根路径。
 */
const base = process.env.GITHUB_ACTIONS ? '/images-viewer/' : '/';

// https://vite.dev/config/
export default defineConfig({
  base,
  plugins: [react(), wasm(), topLevelAwait()],
  worker: {
    format: 'es',
  },
  optimizeDeps: {
    // 这个包自带 .wasm，交给 vite-plugin-wasm 处理，不要预打包
    exclude: ['@colorhythm/libraw-wasm'],
  },
  build: {
    // 顶层 await（Emscripten 的模块初始化）需要较新的目标
    target: 'esnext',
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: './src/test/setup.ts',
    css: false,
  },
});
