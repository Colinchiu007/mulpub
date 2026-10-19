/**
 * route-registry-entry-hosts.test.js — 内部路由「进入宿主」机械锁
 *
 * 背景（PRD-UI-FLOW-CLARITY S1d / 评审第二轮 Critical）：
 * `route-registry.js` 的 `entryFrom` 只能填**单值**（`check-route-registry.js:340`
 * 的 `registryByPath.has` 判定），而 `/publish/history` 实际有**两个页面宿主**：
 *   - `Publish.vue` —— 编辑器内「发布记录」按钮
 *   - `Home.vue` —— 首页快捷入口 / 操作卡（三处点击）
 * 登记成 `entryFrom: '/publish'` 只能表达其中之一，另一条事实若只写在注释里，
 * **没有任何判据会读它** —— 与本文档根因 R1「结论只写在散文里」同型。
 *
 * 本锁用源码扫描把「谁跳 /publish/history」变成机械事实：
 * 任何新增宿主都会当场变红，必须在此显式登记后才允许合入。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join, dirname, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const SRC = dirname(fileURLToPath(import.meta.url))
const SRC_ROOT = dirname(SRC) // apps/desktop/src

/**
 * 允许跳转 `/publish/history` 的宿主文件白名单。
 * 新增入口时必须在这里登记，并同步 `route-registry.js` 的注释。
 */
const ALLOWED_HOSTS = Object.freeze([
  // 发布编辑器内「发布记录」按钮
  'views/Publish.vue',
  // 首页快捷入口 / 操作卡（三处点击共用同一跳转）
  'views/Home.vue',
])

/** 递归收集 src 下所有 .vue / .js（跳过测试文件与 node_modules） */
function collectSourceFiles (dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
      out.push(...collectSourceFiles(full))
      continue
    }
    if (!/\.(vue|js)$/.test(entry.name)) continue
    // 测试文件自身会包含目标字符串字面量，排除以免自指误报
    if (/\.test\.js$/.test(entry.name)) continue
    out.push(full)
  }
  return out
}

/** 去掉注释，避免把「注释里引用的路径说明」误判成实际导航 */
function stripComments (text) {
  return text
    .replace(/<!--[\s\S]*?-->/g, '') // Vue 模板注释
    .replace(/\/\*[\s\S]*?\*\//g, '') // 块注释
    .replace(/^\s*\/\/.*$/gm, '') // 整行行注释
}

describe('内部路由进入宿主锁（/publish/history）', () => {
  it('跳转 /publish/history 的源文件必须全部在登记白名单内', () => {
    const offenders = []
    for (const file of collectSourceFiles(SRC_ROOT)) {
      const rel = relative(SRC_ROOT, file).split(sep).join('/')
      // 登记表自身是「数据」不是「宿主」，其注释会引用路径，排除以免自指误报
      if (rel === 'config/route-registry.js') continue
      const text = stripComments(readFileSync(file, 'utf8'))
      // 只认「导航」形态：router.push/replace 或 go(<字符串>)
      const navigates = /(?:router\s*\.\s*(?:push|replace)|(?:^|[^A-Za-z0-9_$])go)\s*\(\s*['"`]\/publish\/history/.test(text)
      if (!navigates) continue
      if (!ALLOWED_HOSTS.includes(rel)) offenders.push(rel)
    }
    expect(
      offenders,
      '发现未登记的新宿主在跳 /publish/history —— 请同步 route-registry.js 注释与 ALLOWED_HOSTS',
    ).toEqual([])
  })

  it('白名单里的每个宿主都真实存在且确实在跳转（防白名单僵化）', () => {
    for (const rel of ALLOWED_HOSTS) {
      const full = join(SRC_ROOT, rel)
      const text = readFileSync(full, 'utf8') // 文件不存在会直接抛错
      expect(
        /(?:\/publish\/history)/.test(text),
        `${rel} 已不再跳转 /publish/history，请从 ALLOWED_HOSTS 移除该行`,
      ).toBe(true)
    }
  })

  it('/publish/history 必须是内部路由，且 navEntry 为 null（与菜单「发布」落点分离）', async () => {
    const { ROUTE_REGISTRY } = await import('./route-registry.js')
    const entry = ROUTE_REGISTRY.find(r => r.path === '/publish/history')
    expect(entry, '/publish/history 未在 route-registry 登记').toBeTruthy()
    expect(entry.internal).toBe(true)
    expect(entry.navEntry).toBeNull()
  })

  it('菜单「发布」落点必须是 /publish 而非 /publish/history（S1d 语义修正）', async () => {
    const { ROUTE_REGISTRY, SIDEBAR_MENU_KEY_ORDER } = await import('./route-registry.js')
    expect(SIDEBAR_MENU_KEY_ORDER).toContain('publish')
    const entry = ROUTE_REGISTRY.find(r => r.path === '/publish')
    expect(entry, '/publish 未在 route-registry 登记').toBeTruthy()
    expect(entry.navEntry).toBeTruthy()
    expect(entry.navEntry.key).toBe('publish')
    expect(entry.navEntry.to).toBe('/publish')
  })
})
