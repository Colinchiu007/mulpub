// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

import { useTheme, applyKnownThemeBeforeMount, normalizeThemePreference, THEME_KEY, MIRROR_KEY, THEME_PREFERENCES } from './useTheme'

function deferred() {
  let resolve
  const promise = new Promise((resolvePromise) => {
    resolve = resolvePromise
  })
  return { promise, resolve }
}

function createMatchMedia(initialMatches) {
  let matches = initialMatches
  const listeners = new Set()
  const mediaQuery = {
    media: '(prefers-color-scheme: dark)',
    get matches() { return matches },
    addEventListener: vi.fn((type, listener) => {
      if (type === 'change') listeners.add(listener)
    }),
    removeEventListener: vi.fn((type, listener) => {
      if (type === 'change') listeners.delete(listener)
    }),
    dispatch(matchesNext) {
      matches = matchesNext
      const event = { matches, media: this.media }
      for (const listener of listeners) listener(event)
    },
  }

  const matchMedia = vi.fn(() => mediaQuery)
  return { matchMedia, mediaQuery }
}

function mountTheme() {
  let themeApi
  const wrapper = mount(defineComponent({
    setup() {
      themeApi = useTheme()
      return function () { return null }
    },
  }))
  return { wrapper, themeApi }
}

describe('useTheme', () => {
  let originalElectronAPI
  let originalMatchMedia
  let media
  const wrappers = []

  beforeEach(() => {
    originalElectronAPI = window.electronAPI
    originalMatchMedia = window.matchMedia
    media = createMatchMedia(false)
    window.matchMedia = media.matchMedia
    window.electronAPI = undefined
    document.documentElement.removeAttribute('data-theme')
    // ⚠ 单例状态跨用例存活（这正是本批要的行为）。所以每个用例必须自己把**首帧缓存**清干净，
    //   而不是指望模块 refs 回到初始值 —— 指望后者等于把"应用级唯一"这条契约偷偷否证掉。
    window.localStorage.removeItem(MIRROR_KEY)
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop().unmount()
    window.electronAPI = originalElectronAPI
    window.matchMedia = originalMatchMedia
    document.documentElement.removeAttribute('data-theme')
  })

  function createTheme() {
    const mounted = mountTheme()
    wrappers.push(mounted.wrapper)
    return mounted
  }

  it('存储读取完成前 loaded 为 false，且界面停留在首帧缓存色而不是等 IPC', async () => {
    const pending = deferred()
    window.electronAPI = {
      storeGetSetting: vi.fn(() => pending.promise),
    }
    // 首帧缓存里写着暗色：冷启动必须先落暗色，异步读回只负责校准（不得先闪一帧浅色）
    window.localStorage.setItem(MIRROR_KEY, 'dark')
    expect(applyKnownThemeBeforeMount()).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    const { themeApi } = createTheme()

    expect(themeApi).toEqual({
      theme: expect.any(Object),
      isDark: expect.any(Object),
      loaded: expect.any(Object),
      preference: expect.any(Object),
      setPreference: expect.any(Function),
      resetToSystem: expect.any(Function),
      toggle: expect.any(Function),
    })
    // ⚠ 单例下 `theme.value` 在读取期间保持"上次已知值"，这是**规格要求**而不是竞态。
    //   因此这里断 loaded（真正的加载信号），不去断 theme 的具体色值。
    expect(themeApi.loaded.value).toBe(false)

    pending.resolve({ code: 0, data: 'dark' })
    await flushPromises()
    expect(themeApi.loaded.value).toBe(true)
    expect(themeApi.theme.value).toBe('dark')
  })

  it('持久化暗色偏好优先于系统亮色并同步 DOM', async () => {
    const storeGetSetting = vi.fn().mockResolvedValue({ code: 0, data: 'dark' })
    window.electronAPI = { storeGetSetting }

    const { themeApi } = createTheme()
    await flushPromises()

    expect(storeGetSetting).toHaveBeenCalledWith(THEME_KEY)
    expect(themeApi.loaded.value).toBe(true)
    expect(themeApi.theme.value).toBe('dark')
    expect(themeApi.isDark.value).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('持久化亮色偏好优先于系统暗色', async () => {
    media = createMatchMedia(true)
    window.matchMedia = media.matchMedia
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'light' }),
    }

    const { themeApi } = createTheme()
    await flushPromises()

    expect(themeApi.theme.value).toBe('light')
    expect(themeApi.isDark.value).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it.each([
    ['Electron API 缺失', undefined],
    ['读取方法缺失', {}],
  ])('%s 时按系统暗色偏好初始化', async (_label, electronAPI) => {
    media = createMatchMedia(true)
    window.matchMedia = media.matchMedia
    window.electronAPI = electronAPI

    const { themeApi } = createTheme()
    await flushPromises()

    expect(themeApi.loaded.value).toBe(true)
    expect(themeApi.theme.value).toBe('dark')
    expect(themeApi.isDark.value).toBe(true)
  })

  it.each([
    ['非成功响应', { code: 1, data: 'dark' }],
    ['空偏好', { code: 0, data: '' }],
    ['空响应', null],
  ])('存储返回%s时回退到系统亮色', async (_label, response) => {
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue(response),
    }

    const { themeApi } = createTheme()
    await flushPromises()

    expect(themeApi.loaded.value).toBe(true)
    expect(themeApi.theme.value).toBe('light')
    expect(themeApi.isDark.value).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('读取持久化偏好失败时静默回退到系统主题', async () => {
    media = createMatchMedia(true)
    window.matchMedia = media.matchMedia
    window.electronAPI = {
      storeGetSetting: vi.fn().mockRejectedValue(new Error('存储不可用')),
    }

    const { themeApi } = createTheme()
    await flushPromises()

    expect(themeApi.loaded.value).toBe(true)
    expect(themeApi.theme.value).toBe('dark')
  })

  it('无用户偏好时跟随系统主题变化', async () => {
    const { themeApi } = createTheme()
    await flushPromises()

    media.mediaQuery.dispatch(true)
    await nextTick()
    expect(themeApi.theme.value).toBe('dark')
    expect(themeApi.isDark.value).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    media.mediaQuery.dispatch(false)
    await nextTick()
    expect(themeApi.theme.value).toBe('light')
    expect(themeApi.isDark.value).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('有用户偏好时忽略后续系统主题变化', async () => {
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'light' }),
    }
    const { themeApi } = createTheme()
    await flushPromises()

    media.mediaQuery.dispatch(true)
    await nextTick()

    expect(themeApi.theme.value).toBe('light')
    expect(themeApi.isDark.value).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it('toggle 从亮色切到暗色并持久化', async () => {
    const storeSetSetting = vi.fn().mockResolvedValue(undefined)
    window.electronAPI = { storeSetSetting }
    const { themeApi } = createTheme()
    await flushPromises()

    themeApi.toggle()
    await flushPromises()

    expect(themeApi.theme.value).toBe('dark')
    expect(themeApi.isDark.value).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(storeSetSetting).toHaveBeenCalledWith(THEME_KEY, 'dark')
  })

  it('toggle 从暗色切到亮色并持久化', async () => {
    const storeSetSetting = vi.fn().mockResolvedValue(undefined)
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'dark' }),
      storeSetSetting,
    }
    const { themeApi } = createTheme()
    await flushPromises()

    themeApi.toggle()
    await flushPromises()

    expect(themeApi.theme.value).toBe('light')
    expect(themeApi.isDark.value).toBe(false)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(storeSetSetting).toHaveBeenCalledWith(THEME_KEY, 'light')
  })

  it.each([
    ['Electron API 缺失', undefined],
    ['写入方法缺失', {}],
  ])('toggle 在%s时仍完成本地切换', async (_label, electronAPI) => {
    window.electronAPI = electronAPI
    const { themeApi } = createTheme()
    await flushPromises()

    themeApi.toggle()
    await flushPromises()

    expect(themeApi.theme.value).toBe('dark')
    expect(themeApi.isDark.value).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('持久化失败时不回滚已生效的本地主题', async () => {
    const storeSetSetting = vi.fn().mockRejectedValue(new Error('写入失败'))
    window.electronAPI = { storeSetSetting }
    const { themeApi } = createTheme()
    await flushPromises()

    themeApi.toggle()
    await flushPromises()

    expect(themeApi.theme.value).toBe('dark')
    expect(themeApi.isDark.value).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('手动切换后不再被系统主题变化覆盖', async () => {
    window.electronAPI = { storeSetSetting: vi.fn().mockResolvedValue(undefined) }
    const { themeApi } = createTheme()
    await flushPromises()

    themeApi.toggle()
    await flushPromises()
    media.mediaQuery.dispatch(false)
    await nextTick()

    expect(themeApi.theme.value).toBe('dark')
    expect(themeApi.isDark.value).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('组件卸载后移除系统主题 change 监听器', async () => {
    const { wrapper } = createTheme()
    await flushPromises()
    const listener = media.mediaQuery.addEventListener.mock.calls[0][1]

    wrapper.unmount()

    expect(media.mediaQuery.removeEventListener).toHaveBeenCalledWith('change', listener)
  })

  it('过期回包不得覆盖更新后的状态；卸载按引用计数收回监听', async () => {
    const stale = deferred()
    window.electronAPI = { storeGetSetting: vi.fn(() => stale.promise) }
    const { wrapper } = createTheme()
    wrapper.unmount()

    // 卸载后监听必须被收回（引用计数归零）
    expect(media.mediaQuery.addEventListener).toHaveBeenCalledTimes(1)
    expect(media.mediaQuery.removeEventListener, '监听没收回 = 组件早已不存在但仍在驱动全局界面状态')
      .toHaveBeenCalledTimes(1)

    // 再来一个消费者，读到的是另一个值
    window.electronAPI = { storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'light' }) }
    const fresh = createTheme()
    await flushPromises()
    expect(fresh.themeApi.preference.value).toBe('light')

    // 陈旧回包此刻才落地 —— 必须被 initToken 挡掉，不得把界面改回 dark
    stale.resolve({ code: 0, data: 'dark' })
    await flushPromises()
    expect(fresh.themeApi.preference.value, '过期回包覆盖了新状态 = 谁后到谁赢，而不是谁新谁赢').toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    fresh.wrapper.unmount()
    wrappers.pop()
  })
})

describe('useTheme 单例与偏好词表（阶段 1.1 接线批）', () => {
  let originalElectronAPI
  let originalMatchMedia
  let media
  const wrappers = []

  beforeEach(() => {
    originalElectronAPI = window.electronAPI
    originalMatchMedia = window.matchMedia
    media = createMatchMedia(false)
    window.matchMedia = media.matchMedia
    window.electronAPI = undefined
    document.documentElement.removeAttribute('data-theme')
    window.localStorage.removeItem(MIRROR_KEY)
  })

  afterEach(() => {
    while (wrappers.length > 0) wrappers.pop().unmount()
    window.electronAPI = originalElectronAPI
    window.matchMedia = originalMatchMedia
    document.documentElement.removeAttribute('data-theme')
    window.localStorage.removeItem(MIRROR_KEY)
  })

  function createTheme () {
    const mounted = mountTheme()
    wrappers.push(mounted.wrapper)
    return mounted
  }

  it('两个消费者读到**同一份**状态：一处切色，另一处立即一致', async () => {
    const a = createTheme()
    const b = createTheme()
    await flushPromises()

    a.themeApi.setPreference('dark')
    await flushPromises()

    expect(a.themeApi.theme.value).toBe('dark')
    expect(b.themeApi.theme.value, '单例失效的形态就是"A 切了 B 不跟着变" ⇒ 两处入口互相打脸').toBe('dark')
    expect(b.themeApi.isDark.value).toBe(true)
    expect(a.themeApi.theme, '必须是同一个 ref，不是两份同值 ref').toBe(b.themeApi.theme)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('消费者增减不放大宿主监听：第二个挂载不新增注册，全部卸载才收回', async () => {
    const a = createTheme()
    await flushPromises()
    expect(media.mediaQuery.addEventListener, '首个消费者注册一次').toHaveBeenCalledTimes(1)

    const b = createTheme()
    await flushPromises()
    expect(media.mediaQuery.addEventListener, '第二个消费者又注册一次 = 监听随入口数量增长').toHaveBeenCalledTimes(1)

    b.wrapper.unmount()
    expect(media.mediaQuery.removeEventListener, '还有消费者在场时不得提前收回')
      .not.toHaveBeenCalled()

    a.wrapper.unmount()
    expect(media.mediaQuery.removeEventListener, '最后一个消费者离场必须收回，否则监听永久泄漏').toHaveBeenCalledTimes(1)
    // 收回后再挂一个，应当重新注册（引用计数归零后允许再次建立）
    wrappers.length = 0
  })

  it('一次系统变化事件只让界面更新一次（两个消费者共享同一个监听）', async () => {
    const a = createTheme()
    const b = createTheme()
    await flushPromises()

    const before = b.themeApi.theme.value
    media.mediaQuery.dispatch(true)
    await flushPromises()

    expect(a.themeApi.theme.value).toBe('dark')
    expect(b.themeApi.theme.value).toBe('dark')
    expect(before, '夹具前提：初始必须是浅色，否则"变成 dark"这条断言没有意义').not.toBe('dark')
  })

  it('偏好词表闭合：light/dark/system 原样接受，其余归一为 system 并出声', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    expect(THEME_PREFERENCES).toEqual(['light', 'dark', 'system'])
    for (const ok of THEME_PREFERENCES) expect(normalizeThemePreference(ok), ok).toBe(ok)
    // 缺失类：与 system 等价（零迁移的关键）
    for (const missing of [null, undefined, '']) expect(normalizeThemePreference(missing)).toBe('system')
    warn.mockRestore()

    const badWarn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    for (const bad of ['auto', 'DARK', 42, {}, 'night']) {
      expect(normalizeThemePreference(bad), String(bad) + ' 不得被当成合法偏好').toBe('system')
    }
    expect(badWarn, '"没读到"与"读到坏值"必须出声区分，否则存储被写坏时日志零痕迹')
      .toHaveBeenCalledTimes(THEME_PREFERENCES.length > 0 ? 5 : 0)
    badWarn.mockRestore()
  })

  it('真源读失败按 system 处理并出声，不得静默当成"偏好是浅色"', async () => {
    media = createMatchMedia(true)
    window.matchMedia = media.matchMedia
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    window.electronAPI = { storeGetSetting: vi.fn().mockRejectedValue(new Error('storage down')) }

    const { themeApi } = createTheme()
    await flushPromises()

    expect(themeApi.preference.value).toBe('system')
    expect(themeApi.theme.value, '系统当前是暗色 ⇒ 无偏好时应为暗色，而不是硬回落 light').toBe('dark')
    expect(warn, '读失败必须留痕').toHaveBeenCalled()
    warn.mockRestore()
  })

  it('resetToSystem 是**可写的值**：从固定偏好退回跟随系统后，系统变化重新生效', async () => {
    const storeSetSetting = vi.fn().mockResolvedValue(undefined)
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'light' }),
      storeSetSetting,
    }
    const { themeApi } = createTheme()
    await flushPromises()

    themeApi.resetToSystem()
    await flushPromises()
    expect(storeSetSetting).toHaveBeenLastCalledWith(THEME_KEY, 'system')
    expect(themeApi.preference.value).toBe('system')

    media.mediaQuery.dispatch(true)
    await flushPromises()
    expect(themeApi.theme.value, '陈旧固定值不得挡住民态').toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('镜像只服务首帧：真源与镜像不一致时终值必须是真源，并同步镜像', async () => {
    // 首帧缓存过期写着 dark，真源其实是 light —— 这是"缓存赢了真源"的真实成因
    window.localStorage.setItem(MIRROR_KEY, 'dark')
    applyKnownThemeBeforeMount()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'light' }),
      storeSetSetting: vi.fn().mockResolvedValue(undefined),
    }
    const { themeApi } = createTheme()
    await flushPromises()

    expect(themeApi.theme.value).toBe('light')
    expect(document.documentElement.getAttribute('data-theme'), '真源必须改写界面').toBe('light')
    expect(window.localStorage.getItem(MIRROR_KEY), '镜像必须跟进真源，否则下次冷启动又闪一次旧色')
      .toBe('light')
  })

  it('preference 未变化时也要 commit：否则过期镜像色会永久留在界面上', async () => {
    // 这条测的是 watch 的**盲区**：watch 只在值变化时触发，而"镜像写着 dark、真源是 system"
    // 恰好是一次**无变化**的赋值 ⇒ 若只依赖 watch，界面会永久停在过期的 dark 上。
    // ⚠ 必须先把 preference 构造成 'system' 再谈"无变化"：单例状态跨用例存活，
    //   直接假设它还是初值会让这条断言随用例顺序漂移（第一版就是这样，反证 M7 当时
    //   红了**另外三条**而不是这一条 —— 那是我的测试在依赖顺序，不是锁有牙）。
    window.electronAPI = { storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'system' }) }
    const first = createTheme()
    await flushPromises()
    expect(first.themeApi.preference.value, '夹具前提：真源必须先确立为 system').toBe('system')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')

    // 镜像被写成过期的 dark（模拟上次退出时系统还是暗色）
    window.localStorage.setItem(MIRROR_KEY, 'dark')
    applyKnownThemeBeforeMount()
    expect(document.documentElement.getAttribute('data-theme'), '夹具前提：首帧确实落到了过期镜像色').toBe('dark')

    const second = createTheme()
    await flushPromises()

    expect(second.themeApi.preference.value).toBe('system')
    expect(document.documentElement.getAttribute('data-theme'), '系统当前浅色 + 偏好 system ⇒ 终值必须是 light，不得残留镜像的 dark').toBe('light')
  })

  it('接线锁：生产代码必须真的在 mount 之前调用首帧落色（实现正确但没人调用 = 零价值）', async () => {
    const { readFileSync } = await import('node:fs')
    const { join } = await import('node:path')
    const src = readFileSync(join(process.cwd(), 'src/main.js'), 'utf8')
    const callAt = src.indexOf('applyKnownThemeBeforeMount(')
    expect(callAt, 'main.js 里没有调用 applyKnownThemeBeforeMount ⇒ 首帧不闪这条要求从未落地').toBeGreaterThan(-1)
    const importAt = src.indexOf('applyKnownThemeBeforeMount')
    expect(importAt).toBeLessThan(callAt)
    const mountAt = src.search(/\.\s*mount\s*\(/)
    expect(mountAt, '取不到 mount 调用点 ⇒ 判据无从比较顺序').toBeGreaterThan(-1)
    expect(callAt, '必须在 mount() 之前，否则首帧仍由异步 IPC 决定').toBeLessThan(mountAt)
    expect(src.slice(callAt, callAt + 60)).toMatch(/\)/)
  })
})
