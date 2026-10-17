/**
 * ops-center 前端构建产物 base 路径测试（2026-10-17）
 *
 * 背景（实测复盘）
 * ----------------
 * 运营中心部署在 https://www.iart.work/ops/ 子路径下，但 vite.config.js 未配 base
 * （默认 '/'），产物 index.html 里的资源是**根相对路径**：
 *
 *     <script src="/assets/index-xxx.js">
 *
 * 于是 nginx 的 `location /ops/` 只能拿到 HTML，/assets/* 全部落到主站 root
 * （/var/www/iart.work/ 下没有 assets 目录）⇒ 404 ⇒ 页面白屏。
 * 这是「nginx 配了但页面打不开」的典型形态：判据只看 location 返回 200，
 * 没验证「产物资源路径」与「挂载路径」是否匹配。
 *
 * 契约
 ----
 * - 生产构建：base = '/ops/' —— 产物资源形如 /ops/assets/*，与 nginx location 自洽
 * - dev server：base = '/'    —— 本地 npm run dev 仍访问 http://127.0.0.1:5173/，
 *   对所有本地开发者零影响（改 base 会让 dev 入口变成 /ops/）
 *
 * 为什么 base 必须是**字符串字面量**可判：vite 的 base 在 build 时静态注入产物，
 * 运行时改不了。所以这里直接断言配置对象的 base 字段，而不是跑一次 build。
 */
import { describe, it, expect, vi } from 'vitest'

vi.mock('vite', () => ({ defineConfig: (c) => c }))
vi.mock('@vitejs/plugin-vue', () => ({ default: () => ({ name: 'vue' }) }))

/** 以生产环境导入配置对象 */
async function loadProdConfig () {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'production'
  vi.resetModules()
  const mod = await import('../vite.config.js')
  process.env.NODE_ENV = prev
  return mod.default
}

/** 以开发环境导入配置对象 */
async function loadDevConfig () {
  const prev = process.env.NODE_ENV
  process.env.NODE_ENV = 'development'
  vi.resetModules()
  const mod = await import('../vite.config.js')
  process.env.NODE_ENV = prev
  return mod.default
}

describe('ops-center vite base 路径（子路径部署契约）', () => {
  it('生产构建 base = "/ops/"（与 nginx location /ops/ 自洽）', async () => {
    const cfg = await loadProdConfig()
    expect(cfg.base).toBe('/ops/')
  })

  it('base 以斜杠开头并以斜杠结尾（vite 要求，缺一个都会拼出 /opsassets）', async () => {
    const cfg = await loadProdConfig()
    expect(cfg.base.startsWith('/')).toBe(true)
    expect(cfg.base.endsWith('/')).toBe(true)
  })

  it('dev server base = "/"（本地入口不变，对本地开发者零影响）', async () => {
    const cfg = await loadDevConfig()
    expect(cfg.base).toBe('/')
  })

  it('dev 代理规则不被 base 影响（/api/v1 仍指向 8010）', async () => {
    const cfg = await loadDevConfig()
    expect(cfg.server.proxy['/api/v1'].target).toBe('http://localhost:8010')
  })

  it('dev CSP 插件仍在（生产 CSP 由 nginx 下发，dev 靠 meta 通道）', async () => {
    const cfg = await loadDevConfig()
    const names = cfg.plugins.map((p) => p && p.name).filter(Boolean)
    expect(names).toContain('ops-dev-csp-meta')
  })
})
