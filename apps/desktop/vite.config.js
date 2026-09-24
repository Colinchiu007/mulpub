import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [vue()],
  root: path.resolve(__dirname, 'src'),
  base: './',
  // postcss.config.js 由 PostCSS 自动加载，无需在 Vite 中显式指定
  server: {
    host: '127.0.0.1',
    port: 5174,
    strictPort: true,
    fs: {
      allow: [
        path.resolve(__dirname, 'src'),
        path.resolve(__dirname, '..', '..')
      ]
    }
  },
  build: {
    outDir: path.resolve(__dirname, 'dist'),
    emptyOutDir: true,
    // 共享包通过 workspace junction 解析到 packages/，默认只转换 node_modules
    // 会把 platform-definitions.js 的 module.exports 原样送进浏览器。
    commonjsOptions: {
      include: [/node_modules[\\/]*/, /packages[\\/]shared-utils[\\/]/],
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // 浏览器不能执行共享包中的 CommonJS module.exports。
      '@multi-publish/shared-utils/src/platform-definitions':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/platform-definitions.browser.js'),
      '@multi-publish/shared-utils/src/account-name-guard':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/account-name-guard.browser.js'),
    }
  },
  // workspace 包不在 node_modules 下，开发服务器不会默认预构建其 CommonJS 入口。
  optimizeDeps: {
    include: ['@multi-publish/shared-utils/src/platform-definitions'],
  },
})
