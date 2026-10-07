import { defineConfig, configDefaults } from 'vitest/config';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // 桌面版走 app:// 自定义协议，必须是根绝对路径；
  // GitHub Pages 的项目页部署在 https://<user>.github.io/<repo>/ 下，
  // 资源路径必须带上仓库名前缀，否则 JS/WASM/Worker 全部 404。两者互斥。
  const base = mode === 'desktop' ? '/' : process.env.GITHUB_ACTIONS ? '/raw-images-studio/' : '/';

  return {
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
      // spike/ 是票 41 的一次性探针工作区（未进仓库），它的测试不属于产品代码。
      exclude: [...configDefaults.exclude, 'spike/**'],
    },
  };
});
