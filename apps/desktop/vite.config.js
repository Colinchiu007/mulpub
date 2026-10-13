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
      // 发布能力注册表（publish-capability-registry）：渲染进程消费 ESM 孪生版，
      // 数据单一来源 publish-capabilities.json（CJS/ESM 双版本 parity 测试锁定）。
      '@multi-publish/shared-utils/src/publish-capabilities':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/publish-capabilities.browser.js'),
      // href 协议校验（PRD-HREF-SCHEME-GUARD）：渲染进程消费 ESM 孪生版，
      // CJS/ESM 判据由 shared-utils 的 parity 回归锁同源。
      '@multi-publish/shared-utils/src/safe-http-url':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/safe-http-url.browser.js'),
      // 审核状态机（PRD-PUBLISH-PAGE-OPTIMIZATION §四 P0-1）：渲染进程消费 ESM 孪生版，
      // 枚举与监控状态映射由 shared-utils 的 parity 回归锁与主进程同源。
      '@multi-publish/shared-utils/src/publish-audit-status':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/publish-audit-status.browser.js'),
      // 作品公开内容页解析（PRD-PUBLISH-HISTORY-PUBLIC-LINK-2026-10-07）：渲染进程消费
      // ESM 孪生版，「平台公开内容页白名单 + 作品 ID 派生模板 + 六重闸门」判据由 shared-utils
      // 的 parity 回归（source + flags）锁与主进程同源。未登记此 alias 时渲染层会拉到 CJS
      // 主进程版而跨边界（由 scripts/check-renderer-cjs-boundary 拦截）。
      '@multi-publish/shared-utils/src/published-content-url':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/published-content-url.browser.js'),
      // 平台侧定时能力注册表（2026-10-07 架构变更）：渲染进程消费 ESM 孪生版，
      // 数据单一来源 platform-schedule-capability.json（与 publish-capabilities 同形）。
      // 未登记此 alias 时 /create 与 /publish 会整页渲染失败（详见孪生文件头注释）。
      // 平台侧定时能力注册表（2026-10-07 架构变更）：渲染进程消费 ESM 孪生版，
      // 数据单一来源 platform-schedule-capability.json（与 publish-capabilities 同形）。
      // 未登记此 alias 时 /create 与 /publish 会整页渲染失败（详见孪生文件头注释）。
      '@multi-publish/shared-utils/src/platform-schedule-capability':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/platform-schedule-capability.browser.js'),
      // 播客分发端目录（ADR-0008 / podcast-rss-channel）：渲染进程消费 ESM 孪生版，
      // 数据单一来源 podcast-endpoints.json（CJS/ESM 双版本 parity 测试锁定）。
      '@multi-publish/shared-utils/src/podcast-endpoints':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/podcast-endpoints.browser.js'),
      // Podcast RSS 引擎的窄面孪生（只承载分类/枚举目录与时长格式化；feed 构建与校验留在主进程）。
      // 未登记此 alias 时渲染层会拉到 CJS 主进程版而跨边界（由 scripts/check-renderer-cjs-boundary 拦截）。
      '@multi-publish/shared-utils/src/podcast-rss':
        path.resolve(__dirname, '..', '..', 'packages/shared-utils/src/podcast-rss.browser.js'),
    }
  },
  // workspace 包不在 node_modules 下，开发服务器不会默认预构建其 CommonJS 入口。
  optimizeDeps: {
    include: ['@multi-publish/shared-utils/src/platform-definitions'],
  },
})
