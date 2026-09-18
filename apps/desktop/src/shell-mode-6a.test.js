import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// T0-6a 壳态收敛（渲染层）守卫测试（源码级断言，参照 Home.todo-guard 先例）：
// 1) 工作台壳态（首页虚拟标签）不渲染 NavBar——地址栏/刷新在 SPA 页语义失效；
// 2) 以等高占位行保持主进程 WebContentsView TOP=76px 定位不变（TabBar 36px + 占位 40px）；
// 3) 浏览器/登录标签仍渲染完整 NavBar（保存账号入口不丢）。

const srcDir = join(dirname(fileURLToPath(import.meta.url)))
const appSrc = readFileSync(join(srcDir, 'App.vue'), 'utf8')
const navBarSrc = readFileSync(join(srcDir, 'components/NavBar.vue'), 'utf8')

describe('App.vue T0-6a 壳态收敛（源码级守卫）', () => {
  it('NavBar 仅在非工作台壳态渲染（v-if="!isHomeTab"）', () => {
    expect(appSrc).toContain('v-if="!isHomeTab"')
    // NavBar 与占位行互斥渲染：v-else 占位存在
    expect(appSrc).toContain('v-else')
  })

  it('工作台壳态渲染等高占位行，且高度与 .nav-bar 一致（40px）', () => {
    expect(appSrc).toContain('data-testid="mp-nav-placeholder"')
    expect(appSrc).toContain('mp-shell-nav-placeholder')
    // NavBar 根元素高度
    expect(navBarSrc).toMatch(/\.nav-bar\s*\{[^}]*height:\s*40px/s)
    // 占位行高度与之相等
    expect(appSrc).toMatch(/\.mp-shell-nav-placeholder\s*\{[^}]*height:\s*40px/s)
  })

  it('占位行对辅助技术隐藏（aria-hidden），不产生可聚焦控件', () => {
    const placeholderBlock = appSrc.slice(
      appSrc.indexOf('mp-shell-nav-placeholder') - 200,
      appSrc.indexOf('mp-shell-nav-placeholder') + 200,
    )
    expect(placeholderBlock).toContain('aria-hidden="true"')
  })

  it('浏览器/登录标签的「保存账号」入口仍由 NavBar 承担（未移除 save-account 事件绑定）', () => {
    expect(appSrc).toContain('@save-account="onSaveAccount"')
    expect(navBarSrc).toContain('save-account')
  })
})
