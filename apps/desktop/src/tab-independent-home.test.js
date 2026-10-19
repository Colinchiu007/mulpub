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
import { readFileSync, existsSync, readdirSync } from 'node:fs'
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
  //
  // PRD-UI-FLOW-CLARITY S1b：该分支原有的「模块导航层」已删除。
  // 组件（MpModuleNav）零 props、tabs 只由 route.path 计算，对本实例仅提供
  // 「指向当前路由的自指 tab」或账号域 tab；账号域 tab 现由 Accounts.vue 页内
  // tablist 承担（Accounts.vue 渲染在本分支的 router-view 内，同样生效）。
  // 故断言方向由「必须含 MpModuleNav」反转为「不得含任何导航 chrome」。
  it('内嵌主页走独立模板分支：含 mp-home-shell 根但不含任何导航 chrome', () => {
    expect(appSrc).toMatch(/v-else-if="isHomeShell"/)
    expect(appSrc).toMatch(/mp-home-shell-root/)
    const shellBlock = appSrc.slice(
      appSrc.indexOf('v-else-if="isHomeShell"'),
      appSrc.indexOf('<template v-else>')
    )
    expect(shellBlock).toMatch(/router-view/)
    // 外层 chrome：一律不得出现
    expect(shellBlock).not.toMatch(/<MpSidebar/)
    expect(shellBlock).not.toMatch(/<TabBar/)
    expect(shellBlock).not.toMatch(/<NavBar/)
    // S1b 起：模块导航层也不得出现（该实例的导航由页内 tab + 主进程 IPC 承担）
    expect(shellBlock).not.toMatch(/MpModuleNav/)
    expect(shellBlock).not.toMatch(/mp-module-nav/)
  })

  // S1b 结构锁：MpModuleNav 组件整体下线后不得复活。
  // 复活途径有两种（重新创建组件文件 / 在别处 import），两条都要拦。
  it('MpModuleNav 不得复活：组件文件不存在，且全仓无任何 import', () => {
    expect(existsSync(join(srcDir, 'layouts/MpModuleNav.vue'))).toBe(false)
    const offenders = []
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue
          walk(full)
          continue
        }
        if (!/\.(vue|js|ts)$/.test(entry.name)) continue
        const text = readFileSync(full, 'utf8')
        if (/MpModuleNav\s+from|from\s+['"]@\/layouts\/MpModuleNav/.test(text)) {
          offenders.push(full.slice(srcDir.length + 1))
        }
      }
    }
    walk(srcDir)
    expect(offenders).toEqual([])
  })
})

describe('TabBar "+"按钮 i18n 契约', () => {
  it('TabBar 新标签标题走 locale key', () => {
    const tabbarSrc = read('components/TabBar.vue')
    expect(tabbarSrc).toMatch(/新标签页|t\(['"]tabs\.newTabTitle['"]\)|tabDisplayTitle/)
  })
})

describe('locales 成对（Gate 7 前置自检）', () => {
  // locales 结构拆分后改为模块导入断言（替代 readFileSync 文本扫描，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3 §3.2-6）
  it('zh/en 均含 tabs.newTabTitle 且文案正确', async () => {
    const zh = (await import('./locales/zh.js')).default
    const en = (await import('./locales/en.js')).default
    expect(zh.tabs.newTabTitle).toBe('新标签页')
    expect(en.tabs.newTabTitle).toMatch(/new tab/i)
  })
})
