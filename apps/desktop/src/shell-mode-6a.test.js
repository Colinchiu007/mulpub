import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

// T0-6a 壳态收敛（渲染层）守卫测试 —— 2026-09-23 修订（源码级断言）：
//
// 原契约：工作台壳态（首页虚拟标签）整行不渲染 NavBar，改用空白占位行，
//         理由是地址栏/刷新/前进后退在 SPA 页语义失效且误导。
// 修订背景：用户反馈「首页固定标签没有地址栏与翻页条、新标签有」造成视觉割裂。
//         经核实前进/后退已由 useSpaNavHistory 驱动 vue-router 历史（2026-09-15 修复），
//         刷新按钮 NavBar 在 isHome 下已隐藏，地址栏在 isHome 下已禁用——
//         因此首页不再用空白占位行，改为渲染 NavBar 的「只读态」，消除割裂。
//
// 新契约点：
//   1) 首页标签不再用空白占位行（移除 mp-nav-placeholder）；
//   2) NavBar 无条件渲染并以 :is-home="isHomeTab" 驱动只读态；
//   3) 核心不变量：TabBar 36px + 导航行 40px = 主进程 WebContentsView TOP=76px 不变；
//   4) NavBar 只读态：isHome 时刷新隐藏、地址栏禁用；
//   5) 浏览器/登录标签的「保存账号」入口仍由 NavBar 承担。
//
// 注：isHomeShell（+ 新标签的独立 SPA 实例）分支不含 NavBar，由 tab-independent-home.test.js 守卫。

const srcDir = join(dirname(fileURLToPath(import.meta.url)))
const appSrc = readFileSync(join(srcDir, 'App.vue'), 'utf8')
const navBarSrc = readFileSync(join(srcDir, 'components/NavBar.vue'), 'utf8')
const tabBarSrc = readFileSync(join(srcDir, 'components/TabBar.vue'), 'utf8')

describe('App.vue 壳态收敛 6a 修订（源码级守卫）', () => {
  it('首页标签不再用空白占位行渲染（移除 mp-nav-placeholder）', () => {
    expect(appSrc).not.toContain('mp-shell-nav-placeholder')
    expect(appSrc).not.toContain('data-testid="mp-nav-placeholder"')
  })

  it('NavBar 主窗口分支不再被 v-if="!isHomeTab" 隐藏，且绑定 :is-home 驱动只读态', () => {
    expect(appSrc).not.toMatch(/<NavBar[^>]*v-if="!isHomeTab"/)
    expect(appSrc).toMatch(/:is-home="isHomeTab"/)
  })

  it('核心不变量：TabBar 36px + 导航行 40px = WebContentsView TOP 76px', () => {
    expect(tabBarSrc).toMatch(/\.tab-bar\s*\{[^}]*height:\s*36px/s)
    expect(navBarSrc).toMatch(/\.nav-bar\s*\{[^}]*height:\s*40px/s)
  })

  it('NavBar 只读态：isHome 时刷新按钮隐藏、地址栏禁用', () => {
    expect(navBarSrc).toMatch(/v-if="!isHome"/)
    expect(navBarSrc).toMatch(/:disabled="isHome"/)
  })

  it('浏览器/登录标签的「保存账号」入口仍由 NavBar 承担（未移除 save-account 事件绑定）', () => {
    expect(appSrc).toContain('@save-account="onSaveAccount"')
    expect(navBarSrc).toContain('save-account')
  })
})
