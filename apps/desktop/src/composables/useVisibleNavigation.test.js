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

  it('非法输入不动作，但必须出声（静默丢弃就是本单元要消灭的形态）', async () => {
    for (const bad of ['', null, undefined, 42, {}]) {
      const { nav, router, tabStore, warn } = setup()
      await nav.navigateVisibly(bad)
      expect(router.push, String(bad)).not.toHaveBeenCalled()
      expect(tabStore.switchToTab, String(bad)).not.toHaveBeenCalled()
      expect(warn, `${String(bad)} 被丢弃时必须留一条日志，否则排障者无从知道快捷键被按过`).toHaveBeenCalledTimes(1)
      expect(String(warn.mock.calls[0][0])).toContain('not a route string')
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

  it('找不到 home 标签时不抛错，仍完成主窗口跳转，并如实登记"这次跳转可能看不见"', async () => {
    const { nav, router, warn } = setup({
      isHomeTab: false,
      activeTabId: 'tab-web',
      tabs: [WEB_TAB],
    })
    await nav.navigateVisibly('/accounts')
    expect(router.push).toHaveBeenCalledWith('/accounts')
    // 这条分支的可见结果与"覆盖层背后跳转"这一缺陷 1:1 同形；静默走完等于把缺陷
    // 变成无日志的沉默（评审 i4）。正向上必须有一条告警，反向（有 home 标签）必须没有。
    expect(warn).toHaveBeenCalledTimes(1)
    expect(String(warn.mock.calls[0][0])).toContain('no home tab')
  })

  it('有 home 标签且需要切时，不得误报"找不到 home 标签"', async () => {
    const { nav, warn } = setup({ isHomeTab: false, activeTabId: 'tab-web' })
    await nav.navigateVisibly('/accounts')
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

// 评审 i5 / i6 的处置：把「只有一个发送方」「只有一份判断」从散文断言升级为**集合断言**。
// 集合断言的价值在于它防的是"下一个"，而不是复述"这一次没写错"——任何新增的
// app:navigate 发送方都会被迫面对"它想要的语义是不是可见导航"这个问题。
describe('通道集合锁：发送方 / 渲染层订阅方 / 定向 IPC 消费方都必须唯一', () => {
  const code = (src) => src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n')

  function scan (root, predicate) {
    const out = []
    const seen = { files: 0 }
    const walk = (dir) => {
      for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name)
        if (entry.isDirectory()) {
          if (entry.name === 'node_modules' || entry.name === 'dist') continue
          walk(full)
          continue
        }
        if (!/\.(vue|js)$/.test(entry.name) || /\.test\.js$/.test(entry.name)) continue
        // index.bundle.js 是打包产物（本仓不受 git 管理）：把它算进来会让集合随
        // "本机有没有跑过打包"漂移，那正是集合锁最坏的失效方式。
        if (entry.name === 'index.bundle.js') continue
        seen.files += 1
        if (predicate(code(fs.readFileSync(full, 'utf8')))) out.push(path.relative(process.cwd(), full).split(String.fromCharCode(92)).join('/'))
      }
    }
    walk(root)
    return { hits: out.sort(), scanned: seen.files }
  }

  const SRC = path.resolve(process.cwd(), 'src')
  const ELECTRON = path.resolve(process.cwd(), 'electron')

  it('主进程发送 app:navigate 的位置集合恒等于 {services/hotkeys.js}', () => {
    const { hits, scanned } = scan(ELECTRON, (s) => /webContents\.send\(\s*['"]app:navigate['"]/.test(s))
    expect(scanned, '扫描域为空 = 探针失明').toBeGreaterThan(20)
    expect(hits, '新增发送方必须先回答"它要的语义是不是可见导航"（本单元统一按可见导航处理）')
      .toEqual(['electron/services/hotkeys.js'])
  })

  it('渲染层订阅 app:navigate 的位置集合恒等于 {App.vue}', () => {
    const { hits, scanned } = scan(SRC, (s) => /\bonNavigate\s*\(/.test(s))
    expect(scanned, '扫描域为空 = 探针失明').toBeGreaterThan(50)
    expect(hits, '第二个订阅方 = 第二份导航真相，正是本单元消灭的东西').toEqual(['src/App.vue'])
  })

  it('定向 IPC navigateActiveHomeShell 在渲染层的消费方恒等于共享实现', () => {
    // 复制三段判断的入口必然要调这个 IPC —— 所以"消费方集合"就是"第二份判断"的探测器，
    // 它比"是否调用 useVisibleNavigation(" 强：抄逻辑而不调组合式的文件也会在这里红。
    const { hits, scanned } = scan(SRC, (s) => /navigateActiveHomeShell/.test(s))
    expect(scanned, '扫描域为空 = 探针失明').toBeGreaterThan(50)
    expect(hits).toEqual(['src/composables/useVisibleNavigation.js'])
  })
})
