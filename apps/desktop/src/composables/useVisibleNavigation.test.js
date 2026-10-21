// @ts-check
/**
 * useVisibleNavigation —— 三段式可见导航的契约锁（UX 审计 1.5）
 *
 * 这段判断原先只存在于 `layouts/MpSidebar.vue`，全局快捷键走的是裸 `router.push`，
 * 于是"同一个动作，鼠标看得见、键盘看不见"。本文件把三段各自钉住：
 *   A 内嵌主页实例 → 只让它自己跳，主窗口路由**不动**（推了也看不见，还会让两侧漂移）
 *   B 普通网页标签 → 必须先切回首页标签再推（否则跳转发生在原生覆盖层背后）
 *   C 首页标签     → 维持主窗口 push
 * 另加两条降级纪律：IPC 无回执/抛错都不得当作"已处理"；切标签失败仍继续 push。
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { useVisibleNavigation } from './useVisibleNavigation.js'

const HOME_TAB = { tabId: 'tab-home', isHome: true }
const WEB_TAB = { tabId: 'tab-web', isHome: false }

function makeTabStore (overrides = {}) {
  return {
    activeTabIsHomeShell: false,
    isHomeTab: true,
    tabs: [HOME_TAB, WEB_TAB],
    activeTabId: 'tab-home',
    switchToTab: vi.fn(async () => {}),
    ...overrides,
  }
}

function setup (tabStoreOverrides = {}, api = null) {
  const tabStore = makeTabStore(tabStoreOverrides)
  const router = { push: vi.fn(async () => {}) }
  const warn = vi.fn()
  const nav = useVisibleNavigation({
    tabStore,
    router,
    apiGetter: () => api,
    warn,
  })
  return { tabStore, router, warn, nav }
}

describe('C 聚焦首页标签：维持主窗口路由跳转', () => {
  it('push 目标路由，不切标签、不调 IPC', async () => {
    const { nav, router, tabStore } = setup()
    await nav.navigateVisibly('/publish')
    expect(router.push).toHaveBeenCalledWith('/publish')
    expect(tabStore.switchToTab).not.toHaveBeenCalled()
  })

  it('非法输入一律不动作（空串 / 非字符串 / undefined）', async () => {
    for (const bad of ['', null, undefined, 42, {}]) {
      const { nav, router, tabStore } = setup()
      await nav.navigateVisibly(bad)
      expect(router.push, String(bad)).not.toHaveBeenCalled()
      expect(tabStore.switchToTab, String(bad)).not.toHaveBeenCalled()
    }
  })

  // 反向一格：'/' 是合法目标。写成 `if (!to) return` 之外的任何"真值判空"都会
  // 让"回首页"这一格静默失效（快捷键 Ctrl+Alt+H 一类）。
  it('根路径 "/" 必须被当作合法目标照常跳转', async () => {
    const { nav, router } = setup()
    await nav.navigateVisibly('/')
    expect(router.push).toHaveBeenCalledWith('/')
  })
})

describe('B 聚焦普通网页标签：先切回首页再跳（否则跳转发生在看不见的背后）', () => {
  it('切到 home 标签后才 push，顺序不可反', async () => {
    const calls = []
    const tabStore = makeTabStore({
      isHomeTab: false,
      activeTabId: 'tab-web',
      switchToTab: vi.fn(async () => { calls.push('switch') }),
    })
    const router = { push: async () => { calls.push('push') } }
    const nav = useVisibleNavigation({ tabStore, router, apiGetter: () => null, warn: vi.fn() })
    await nav.navigateVisibly('/dashboard')
    expect(calls).toEqual(['switch', 'push'])
    expect(tabStore.switchToTab).toHaveBeenCalledWith('tab-home')
  })

  it('已经是首页标签（activeTabId===home.tabId）时不重复切', async () => {
    const tabStore = makeTabStore({ isHomeTab: false })
    const { nav, router } = setup({ ...tabStore, activeTabId: 'tab-home', isHomeTab: false })
    await nav.navigateVisibly('/collection')
    expect(tabStore.switchToTab).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith('/collection')
  })

  it('找不到 home 标签时不抛错，仍完成主窗口跳转', async () => {
    const { nav, router, warn } = setup({
      isHomeTab: false,
      activeTabId: 'tab-web',
      tabs: [WEB_TAB],
    })
    await nav.navigateVisibly('/accounts')
    expect(router.push).toHaveBeenCalledWith('/accounts')
    expect(warn).not.toHaveBeenCalled()
  })

  it('切标签失败仍然继续 push（至少主窗口路由对了），并留下一条告警', async () => {
    const err = new Error('switch boom')
    const { nav, router, warn } = setup({
      isHomeTab: false,
      activeTabId: 'tab-web',
      switchToTab: vi.fn(async () => { throw err }),
    })
    await nav.navigateVisibly('/home-topics')
    expect(router.push).toHaveBeenCalledWith('/home-topics')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('switch home failed')
  })
})

describe('A 聚焦内嵌主页实例：定向让它自己跳，主窗口隐藏路由不动', () => {
  function apiWith (navigate) {
    return { pageManager: { navigateActiveHomeShell: navigate } }
  }

  it('IPC 回执 handled:true ⇒ 主窗口不 push、也不切标签', async () => {
    const spy = vi.fn(async () => ({ code: 0, data: { handled: true } }))
    const { nav, router, tabStore } = setup(
      { activeTabIsHomeShell: true, isHomeTab: false, activeTabId: 'tab-web' },
      apiWith(spy),
    )
    await nav.navigateVisibly('/publish')
    expect(spy).toHaveBeenCalledWith('/publish')
    expect(router.push).not.toHaveBeenCalled()
    expect(tabStore.switchToTab).not.toHaveBeenCalled()
  })

  // 「没拿到回执」不等于「已处理」——把它读成已处理会让键盘导航静默失效
  it.each([
    ['回执为 null', null],
    ['code 非 0', { code: -3 }],
    ['data 缺席', { code: 0 }],
    ['handled 为 false', { code: 0, data: { handled: false } }],
    ['handled 缺席', { code: 0, data: {} }],
  ])('%s ⇒ 回落到主窗口路径（继续切标签 + push）', async (_label, res) => {
    const { nav, router, tabStore } = setup(
      { activeTabIsHomeShell: true, isHomeTab: false, activeTabId: 'tab-web' },
      apiWith(async () => res),
    )
    await nav.navigateVisibly('/accounts')
    expect(tabStore.switchToTab).toHaveBeenCalledWith('tab-home')
    expect(router.push).toHaveBeenCalledWith('/accounts')
  })

  it('IPC 抛错 ⇒ 出声告警并回落到主窗口路径（不把异常当已处理）', async () => {
    const { nav, router, warn } = setup(
      { activeTabIsHomeShell: true },
      apiWith(async () => { throw new Error('ipc down') }),
    )
    await nav.navigateVisibly('/intelligence')
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('navigate home-shell failed')
    expect(router.push).toHaveBeenCalledWith('/intelligence')
  })

  it('宿主没有该 API（浏览器 dev / 老 preload）⇒ 不抛错，按主窗口路径走', async () => {
    const { nav, router } = setup({ activeTabIsHomeShell: true }, { pageManager: {} })
    await nav.navigateVisibly('/video-clone')
    expect(router.push).toHaveBeenCalledWith('/video-clone')
  })

  it('非 home-shell 时不得误调定向导航 IPC', async () => {
    const spy = vi.fn(async () => ({ code: 0, data: { handled: true } }))
    const { nav, router } = setup({ activeTabIsHomeShell: false }, apiWith(spy))
    await nav.navigateVisibly('/settings')
    expect(spy).not.toHaveBeenCalled()
    expect(router.push).toHaveBeenCalledWith('/settings')
  })
})

describe('主窗口 push 自身失败：出声且不抛到调用方', () => {
  it('router.push 抛错 ⇒ 记一条告警，异常不外泄（点击/快捷键回调不该炸掉壳层）', async () => {
    const err = new Error('chunk load failed')
    const tabStore = makeTabStore()
    const warn = vi.fn()
    const nav = useVisibleNavigation({
      tabStore,
      router: { push: async () => { throw err } },
      apiGetter: () => null,
      warn,
    })
    await expect(nav.navigateVisibly('/home-topics')).resolves.toBeUndefined()
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('navigate failed')
  })
})

// 装配锁：本组合式刻意不 import electron-bridge（桥由调用方注入），于是"调用点漏传
// apiGetter"不会编译失败，只会让 home-shell 分支永远 return false —— 定向导航在真实
// 应用里一次都不发生，而本文件所有用例照绿（它们都显式注入了 apiGetter）。
// 因此逐个生产调用点检查参数面，并断言调用点数量本身（锚点找不到 ≠ 合规）。
describe('调用点装配锁：每个生产入口都必须传 apiGetter', () => {
  /** 去掉行注释，避免解释性散文里的字样被当成代码 */
  const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')
  const read = (rel) => code(fs.readFileSync(path.resolve(process.cwd(), rel), 'utf8'))
  const CALL_SITES = ['src/App.vue', 'src/layouts/MpSidebar.vue']

  for (const rel of CALL_SITES) {
    it(`${rel} 的 useVisibleNavigation 调用必须注入 apiGetter`, () => {
      const src = read(rel)
      const anchor = src.indexOf('useVisibleNavigation({')
      expect(anchor, '必须调用共享实现（锚点失效）').toBeGreaterThanOrEqual(0)
      const argObj = src.slice(anchor, src.indexOf('})', anchor) + 2)
      expect(argObj, '漏传 apiGetter ⇒ 定向导航静默失效').toContain('apiGetter')
      expect(argObj).toContain('getApi')
    })
  }

  // 全仓清点：新增入口若没登记到上面清单就会在这里红，而不是静默带着一个漏传参数的调用点上线。
  it('useVisibleNavigation 的生产调用点必须逐个登记（清单只能与现场一致）', () => {
    const found = []
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue
          walk(full)
        } else if (/\.(vue|js)$/.test(entry.name) && !/\.test\.js$/.test(entry.name)) {
          const src = code(fs.readFileSync(full, 'utf8'))
          if (/useVisibleNavigation\(/.test(src) && !full.endsWith('useVisibleNavigation.js')) {
            found.push(path.relative(process.cwd(), full).replace(/\\/g, '/'))
          }
        }
      }
    }
    walk(path.resolve(process.cwd(), 'src'))
    expect(found.sort(), '调用点集合变了：新增入口必须同时登记进上面的参数面锁').toEqual(CALL_SITES.slice().sort())
  })

  it('apiGetter 缺席时不抛错，回落到主窗口路径（降级而非崩溃）', () => {
    const tabStore = makeTabStore({ activeTabIsHomeShell: true, isHomeTab: false, activeTabId: 'tab-web' })
    const router = { push: vi.fn(async () => {}) }
    const warn = vi.fn()
    const nav = useVisibleNavigation({ tabStore, router, warn })
    return nav.navigateVisibly('/accounts').then(() => {
      expect(router.push).toHaveBeenCalledWith('/accounts')
      expect(warn, '回落本身不是错误，不得制造噪声日志').not.toHaveBeenCalled()
    })
  })
})
