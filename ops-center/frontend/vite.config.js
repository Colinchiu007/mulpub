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

export default defineConfig({
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
