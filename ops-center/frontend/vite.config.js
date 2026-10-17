import { defineConfig } from 'vite'
import vue from '@vitejs/plugin-vue'

// P1-15：开发服务器给 index.html 注入 CSP `<meta http-equiv>`。
// 目的不是替代 HTTP 头（`frame-ancestors` / `form-action` 在 meta 通道无效），
// 而是让 dev 阶段就能在 DevTools 里看到「加载了非白名单资源」的违规告警，
// 避免只有生产才第一次暴露 CSP 冲突。生产 CSP 由 nginx / 后端头下发。
// 与生产口径的差异仅一处：vite dev 需要 HMR 的 WebSocket 与直连后端的 XHR。
const DEV_CSP = [
  "default-src 'self'",
  "script-src 'self'",
  // vite dev 用 JS 插入 <style> 做 HMR 样式替换，没有 'unsafe-inline' 会直接白屏
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
  // ws: 仅 dev 的 HMR 通道（vite 走 127.0.0.1:5173）；代理目标 8010 便于绕过代理直连调试
  "connect-src 'self' ws: wss: http://127.0.0.1:8010 http://localhost:8010",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ')

export function opsDevCspMeta() {
  return {
    name: 'ops-dev-csp-meta',
    apply: 'serve',
    transformIndexHtml(html) {
      return {
        html,
        tags: [
          {
            tag: 'meta',
            injectTo: 'head-prepend',
            attrs: { 'http-equiv': 'Content-Security-Policy', content: DEV_CSP },
          },
        ],
      }
    },
  }
}

/**
 * 部署 base 路径（2026-10-17，fix: ops-center-ops-path）
 *
 * 为什么需要它：运营中心经 https://www.iart.work/ops/ 子路径对外服务。vite 未配 base 时
 * 默认 '/'，产物 index.html 里的资源是**根相对路径**：
 *
 *     <script src="/assets/index-xxx.js">
 *
 * nginx 的 `location /ops/` 只能取到 HTML，而 /assets/* 会落到主站 root
 * （/var/www/iart.work/ 下没有 assets 目录）⇒ 404 ⇒ 页面白屏。这是「nginx 配了但页面打不开」
 * 的典型形态：location 判据只看到 200，没验证产物资源路径与挂载路径是否匹配。
 *
 * 为什么按 NODE_ENV 分流而不是统一改：
 *   - 生产：base 必须在**构建时**静态注入产物（运行时改不了），故取 '/ops/'；
 *   - dev：本地 `npm run dev` 跑在 127.0.0.1:5173 根下，若也改成 '/ops/'，
 *     所有本地开发者的入口会变成 http://127.0.0.1:5173/ops/，无谓的破坏面。
 *
 * 判据：ops-center/frontend/tests/vite-base-path.test.js（5 例，含 dev 入口不变这条）。
 */
const isProduction = process.env.NODE_ENV === 'production'

export default defineConfig({
  base: isProduction ? '/ops/' : '/',
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          'element-plus': ['element-plus'],
        },
      },
    },
  },
  plugins: [vue(), opsDevCspMeta()],
  server: {
    // 显式绑定 IPv4：Windows 上默认 'localhost' 可能只解析到 ::1，
    // 导致访问 http://127.0.0.1:5173 连接被拒（白屏）；strictPort 防止端口被占时
    // 静默漂移到 5174 造成"打开的是别人/旧实例"。
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: {
      // 登录由 ops-center 本地提供（自包含管理员登录，不再依赖 platform-orchestrator）
      '/api/auth': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
      // 运营配置 API 由 ops-center 后端提供
      '/api/v1': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
      // 兜底：其余 /api 保持指向 ops-center 后端
      '/api': {
        target: 'http://localhost:8010',
        changeOrigin: true,
      },
    },
  },
})
