// @ts-check
/**
 * 发布结果「查看文章」改为应用内标签打开 —— 行为契约（TDD 红灯先行）。
 *
 * 背景：发布成功后结果区的「查看文章 →」是原生 <a target="_blank">；点击由主进程
 * webContents.setWindowOpenHandler 接管并 shell.openExternal() 跳到**系统浏览器**
 * （apps/desktop/electron/window.js:265）。用户希望留在应用内。
 *
 * 本文件锁四类不变量：
 *   C1 isPlainLeftClick 只认「左键 + 无修饰键」——修饰键/中右键必须保留浏览器默认语义
 *   C2 openInAppTab 成功路径：createTab → switchToTab，返回 true
 *   C3 openInAppTab 失败路径一律返回 false 且**不抛**（失败要能被调用方降级，不得静默也不得炸）
 *   C4 handleLinkClick：普通左键 → 阻止默认 + 应用内打开；降级只在应用内失败时发生；
 *      非 http(s) 一律不拦截（安全边界沿用 safeHttpUrl）
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const h = vi.hoisted(() => ({
  tabs: { createTab: vi.fn(), switchToTab: vi.fn() },
}))

vi.mock('@/stores/tab', () => ({ useTabStore: () => h.tabs }))

import { isPlainLeftClick, useInAppLink } from './useInAppLink'

const URL_OK = 'https://weibo.com/detail/1'

beforeEach(() => {
  h.tabs.createTab.mockReset()
  h.tabs.switchToTab.mockReset()
})

describe('C1 isPlainLeftClick —— 只认「最普通的那一次点击」', () => {
  it('左键且无修饰键 → true', () => {
    expect(isPlainLeftClick({ button: 0 })).toBe(true)
  })

  it('任一修饰键 → false（保留浏览器默认，交由主进程外开）', () => {
    for (const key of ['ctrlKey', 'metaKey', 'shiftKey', 'altKey']) {
      expect(isPlainLeftClick({ button: 0, [key]: true })).toBe(false)
    }
  })

  it('非左键 / 缺 button / 空事件 → false', () => {
    expect(isPlainLeftClick({ button: 1 })).toBe(false)
    expect(isPlainLeftClick({ button: 2 })).toBe(false)
    expect(isPlainLeftClick({})).toBe(false)
    expect(isPlainLeftClick(null)).toBe(false)
    expect(isPlainLeftClick(undefined)).toBe(false)
  })
})

describe('C2/C3 openInAppTab —— 建标签并切换，失败一律返回 false', () => {
  it('成功：createTab(url) → switchToTab(tabId)，返回 true', async () => {
    h.tabs.createTab.mockResolvedValue('btab-7')
    h.tabs.switchToTab.mockResolvedValue(undefined)
    const { openInAppTab } = useInAppLink()

    await expect(openInAppTab(URL_OK)).resolves.toBe(true)
    expect(h.tabs.createTab).toHaveBeenCalledWith({ url: URL_OK })
    expect(h.tabs.switchToTab).toHaveBeenCalledWith('btab-7')
  })

  it('createTab 返回 null（桥不可用）→ false，且不 switch', async () => {
    h.tabs.createTab.mockResolvedValue(null)
    const { openInAppTab } = useInAppLink()

    await expect(openInAppTab(URL_OK)).resolves.toBe(false)
    expect(h.tabs.switchToTab).not.toHaveBeenCalled()
  })

  it('createTab 抛异常 → false，且不向调用方抛', async () => {
    h.tabs.createTab.mockRejectedValue(new Error('bridge down'))
    const { openInAppTab } = useInAppLink()

    await expect(openInAppTab(URL_OK)).resolves.toBe(false)
  })

  it('switchToTab 抛异常 → 标签已建，仍返回 true（成功切换失败不算没打开）', async () => {
    h.tabs.createTab.mockResolvedValue('btab-8')
    h.tabs.switchToTab.mockRejectedValue(new Error('switch failed'))
    const { openInAppTab } = useInAppLink()

    await expect(openInAppTab(URL_OK)).resolves.toBe(true)
  })

  it('非 http(s) URL → 既不建标签也不切换，返回 false', async () => {
    const { openInAppTab } = useInAppLink()
    for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://x/y', '', '   ', 'not-a-url']) {
      await expect(openInAppTab(bad)).resolves.toBe(false)
    }
    expect(h.tabs.createTab).not.toHaveBeenCalled()
    expect(h.tabs.switchToTab).not.toHaveBeenCalled()
  })
})

// CCG r1-i2/i4：失败不变式——「调用它就必须被打开」。
// openInAppTab 公开导出，若它自己只返回 false 而不兜底，将来直接调用它的代码
// 会静默死点击（PRD §3.4 承诺的第四类失败点：未预期抛错）。
describe('C5 失败不变式 —— 任何失败都必须降级外开，绝不静默', () => {
  let openExternal
  beforeEach(() => { openExternal = vi.fn() })

  it('openInAppTab：createTab 返回 null → 自己降级外开，仍返回 false', async () => {
    h.tabs.createTab.mockResolvedValue(null)
    const { openInAppTab } = useInAppLink({ openExternal })
    await expect(openInAppTab(URL_OK)).resolves.toBe(false)
    expect(openExternal).toHaveBeenCalledWith(URL_OK)
  })

  it('openInAppTab：createTab 抛异常 → 自己降级外开，不向调用方抛', async () => {
    h.tabs.createTab.mockRejectedValue(new Error('boom'))
    const { openInAppTab } = useInAppLink({ openExternal })
    await expect(openInAppTab(URL_OK)).resolves.toBe(false)
    expect(openExternal).toHaveBeenCalledWith(URL_OK)
  })

  it('openInAppTab：成功时绝不降级（不许双开）', async () => {
    h.tabs.createTab.mockResolvedValue('btab-11')
    h.tabs.switchToTab.mockResolvedValue(undefined)
    const { openInAppTab } = useInAppLink({ openExternal })
    await expect(openInAppTab(URL_OK)).resolves.toBe(true)
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('handleLinkClick：tabStore.createTab 本身同步抛错（store 未装）也走降级', async () => {
    h.tabs.createTab.mockImplementation(() => { throw new Error('store not installed') })
    const { handleLinkClick } = useInAppLink({ openExternal })
    const event = { button: 0, preventDefault: vi.fn() }
    await expect(handleLinkClick(event, URL_OK)).resolves.toBe(false)
    expect(openExternal).toHaveBeenCalledWith(URL_OK)
  })

  it('非 http(s) 不降级（不把危险协议交给系统浏览器）', async () => {
    const { handleLinkClick } = useInAppLink({ openExternal })
    await expect(handleLinkClick({ button: 0, preventDefault: vi.fn() }, 'javascript:alert(1)')).resolves.toBe(false)
    expect(openExternal).not.toHaveBeenCalled()
  })
})

describe('C4 handleLinkClick —— 拦截语义与降级', () => {
  let openExternal

  beforeEach(() => {
    openExternal = vi.fn()
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  function makeEvent (overrides = {}) {
    return { button: 0, preventDefault: vi.fn(), ...overrides }
  }

  it('普通左键 + http：阻止默认 + 应用内打开，且**不**调用外开降级', async () => {
    h.tabs.createTab.mockResolvedValue('btab-9')
    h.tabs.switchToTab.mockResolvedValue(undefined)
    const { handleLinkClick } = useInAppLink({ openExternal })
    const event = makeEvent()

    await expect(handleLinkClick(event, URL_OK)).resolves.toBe(true)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(h.tabs.createTab).toHaveBeenCalledWith({ url: URL_OK })
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('Ctrl 点击：不阻止默认、不建标签、不降级（交给浏览器默认与主进程）', async () => {
    const { handleLinkClick } = useInAppLink({ openExternal })
    const event = makeEvent({ ctrlKey: true })

    await expect(handleLinkClick(event, URL_OK)).resolves.toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.tabs.createTab).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('应用内打开失败：仍阻止默认（避免「外开 + 应用内」双开），并降级为外开', async () => {
    h.tabs.createTab.mockRejectedValue(new Error('boom'))
    const { handleLinkClick } = useInAppLink({ openExternal })
    const event = makeEvent()

    await expect(handleLinkClick(event, URL_OK)).resolves.toBe(false)
    expect(event.preventDefault).toHaveBeenCalledTimes(1)
    expect(openExternal).toHaveBeenCalledWith(URL_OK)
  })

  it('非 http(s)：不拦截、不建标签、不降级（沿用纯文本分支的安全边界）', async () => {
    const { handleLinkClick } = useInAppLink({ openExternal })
    const event = makeEvent()

    await expect(handleLinkClick(event, 'javascript:alert(1)')).resolves.toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
    expect(h.tabs.createTab).not.toHaveBeenCalled()
    expect(openExternal).not.toHaveBeenCalled()
  })

  it('事件缺少 preventDefault 时不得抛异常（防御性）', async () => {
    h.tabs.createTab.mockResolvedValue('btab-10')
    h.tabs.switchToTab.mockResolvedValue(undefined)
    const { handleLinkClick } = useInAppLink({ openExternal })

    await expect(handleLinkClick({ button: 0 }, URL_OK)).resolves.toBe(true)
  })

  it('默认 openExternal 走 window.open（主进程 setWindowOpenHandler 会接住并开系统浏览器）', async () => {
    const openSpy = vi.fn()
    vi.stubGlobal('open', openSpy)
    h.tabs.createTab.mockResolvedValue(null)
    const { handleLinkClick } = useInAppLink()

    await expect(handleLinkClick(makeEvent(), URL_OK)).resolves.toBe(false)
    expect(openSpy).toHaveBeenCalledWith(URL_OK, '_blank', 'noopener')
    vi.unstubAllGlobals()
  })
})
