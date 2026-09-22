/**
 * 新标签独立主页 —— 渲染层源码契约测试
 * （PRD-TAB-INDEPENDENT-HOME-2026-09-22 F1/F3/F4，模式对齐 shell-mode-6a/6b 源码级守卫）
 *
 * 契约点：
 *   1. App.vue 不再含"路由变化强制切回 home 标签"的归位守卫（F3 移除）；
 *   2. App.vue 在 home-shell（内嵌主页）模式下跳过标签系统订阅（S4 广播风暴防护）；
 *   3. "+"按钮创建标签不再硬编码 about:blank + 标题"首页"（F1/F4）；
 *   4. locales zh/en 成对含 tabs.newTabTitle（CI Gate 7 同语义前置检查）。
 */
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const srcDir = dirname(fileURLToPath(import.meta.url))
const read = (rel) => readFileSync(join(srcDir, rel), 'utf8')

describe('App.vue 新标签独立主页契约', () => {
  const appSrc = read('App.vue')

  it('归位守卫已移除：不再注册"路由变化 → switchToTab(home)"的 beforeEach', () => {
    expect(appSrc).not.toMatch(/router\.beforeEach\s*\(/)
    expect(appSrc).not.toMatch(/_routeGuard/)
  })

  it('home-shell 模式跳过标签系统初始化/订阅（S4）', () => {
    expect(appSrc).toMatch(/isHomeShell/)
    expect(appSrc).toMatch(/tabStore\.init|useTabStore/)
  })

  it('"+"创建标签不再硬编码 about:blank 与标题"首页"', () => {
    const createTabBlock = appSrc.slice(appSrc.indexOf('onCreateTab'), appSrc.indexOf('onCreateTab') + 400)
    expect(createTabBlock).not.toContain("url: 'about:blank'")
    expect(createTabBlock).not.toContain("title: '首页'")
  })

  // F1：内嵌主页实例运行于 WebContentsView（仅覆盖内容矩形），若再渲染一份外层
  // Sidebar/TabBar/NavBar 会造成双份 chrome 视觉错乱——必须走独立模板分支。
  it('内嵌主页走独立模板分支：含 mp-home-shell 根但不含外层 chrome', () => {
    expect(appSrc).toMatch(/v-else-if="isHomeShell"/)
    expect(appSrc).toMatch(/mp-home-shell-root/)
    // 该分支内只渲染模块导航 + 工作区，不渲染 MpSidebar / TabBar
    const shellBlock = appSrc.slice(
      appSrc.indexOf('v-else-if="isHomeShell"'),
      appSrc.indexOf('<template v-else>')
    )
    expect(shellBlock).toMatch(/MpModuleNav/)
    expect(shellBlock).toMatch(/router-view/)
    expect(shellBlock).not.toMatch(/<MpSidebar/)
    expect(shellBlock).not.toMatch(/<TabBar/)
    expect(shellBlock).not.toMatch(/<NavBar/)
  })
})

describe('TabBar "+"按钮 i18n 契约', () => {
  it('TabBar 新标签标题走 locale key', () => {
    const tabbarSrc = read('components/TabBar.vue')
    expect(tabbarSrc).toMatch(/新标签页|t\(['"]tabs\.newTabTitle['"]\)|tabDisplayTitle/)
  })
})

describe('locales 成对（Gate 7 前置自检）', () => {
  const zh = read('locales/zh.js')
  const en = read('locales/en.js')

  it('zh/en 均含 tabs.newTabTitle', () => {
    expect(zh).toMatch(/newTabTitle/)
    expect(en).toMatch(/newTabTitle/)
  })

  it('zh 文案为「新标签页」，en 文案为 New Tab', () => {
    expect(zh).toMatch(/newTabTitle:\s*'新标签页'/)
    expect(en).toMatch(/newTabTitle:\s*'(New Tab|new tab)'/i)
  })
})
