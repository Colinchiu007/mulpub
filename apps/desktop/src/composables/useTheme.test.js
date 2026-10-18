// @ts-check
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { defineComponent, nextTick } from 'vue'
import { flushPromises, mount } from '@vue/test-utils'

import {
  __resetThemeStateForTest,
  resolveTheme,
  setThemeMode,
  THEME_MODES,
  toggleTheme,
  useTheme,
} from './useTheme'

const THEME_KEY = 'ui:theme'

function deferred () {
  let resolve
  const promise = new Promise((resolvePromise) => { resolve = resolvePromise })
  return { promise, resolve }
}

function createMatchMedia (initialMatches) {
  let matches = initialMatches
  const listeners = new Set()
  const mediaQuery = {
    media: '(prefers-color-scheme: dark)',
    get matches () { return matches },
    addEventListener: vi.fn((type, listener) => { if (type === 'change') listeners.add(listener) }),
    removeEventListener: vi.fn((type, listener) => { if (type === 'change') listeners.delete(listener) }),
    dispatch (matchesNext) {
      matches = matchesNext
      const event = { matches, media: this.media }
      for (const listener of listeners) listener(event)
    },
    listenerCount: () => listeners.size,
  }
  return { matchMedia: vi.fn(() => mediaQuery), mediaQuery }
}

let media = null

/** 挂载一个真实调用 useTheme() 的组件（证明它可在组件里用），返回 api。 */
function mountTheme () {
  let api
  const wrapper = mount(defineComponent({
    setup () {
      api = useTheme()
      return () => null
    },
  }))
  return { wrapper, api }
}

function storeReturning (value) {
  window.electronAPI = { storeGetSetting: vi.fn().mockResolvedValue(value) }
}

describe('useTheme（模块级单例）', () => {
  beforeEach(() => {
    __resetThemeStateForTest()
    media = createMatchMedia(false)
    window.matchMedia = media.matchMedia
    window.electronAPI = undefined
  })

  afterEach(() => {
    __resetThemeStateForTest()
    delete window.electronAPI
  })

  it('存储读取完成前保持明确的 Loading 状态', async () => {
    const pending = deferred()
    window.electronAPI = { storeGetSetting: vi.fn(() => pending.promise) }

    const { api } = mountTheme()

    expect(api.theme.value).toBe('light')
    expect(api.isDark.value).toBe(false)
    expect(api.loaded.value).toBe(false)
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false)

    pending.resolve({ code: 0, data: 'dark' })
    await flushPromises()
    expect(api.theme.value).toBe('dark')
  })

  it('持久化暗色偏好优先于系统亮色并同步 DOM', async () => {
    const storeGetSetting = vi.fn().mockResolvedValue({ code: 0, data: 'dark' })
    window.electronAPI = { storeGetSetting }

    const { api } = mountTheme()
    await flushPromises()

    expect(storeGetSetting).toHaveBeenCalledWith(THEME_KEY)
    expect(api.loaded.value).toBe(true)
    expect(api.mode.value).toBe('dark')
    expect(api.theme.value).toBe('dark')
    expect(api.isDark.value).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('持久化亮色偏好优先于系统暗色', async () => {
    media = createMatchMedia(true)
    window.matchMedia = media.matchMedia
    storeReturning({ code: 0, data: 'light' })

    const { api } = mountTheme()
    await flushPromises()

    expect(api.theme.value).toBe('light')
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })

  it.each([
    ['Electron API 缺失', undefined],
    ['读取方法缺失', {}],
  ])('%s 时按系统暗色偏好初始化', async (_label, electronAPI) => {
    media = createMatchMedia(true)
    window.matchMedia = media.matchMedia
    window.electronAPI = electronAPI

    const { api } = mountTheme()
    await flushPromises()

    expect(api.loaded.value).toBe(true)
    expect(api.theme.value).toBe('dark')
    expect(api.mode.value).toBe('system')
  })

  it.each([
    ['非成功响应', { code: 1, data: 'dark' }],
    ['空偏好', { code: 0, data: '' }],
    ['空响应', null],
    // 存了个认识不了的值：必须退回「跟随系统」，不得把脏值当偏好渲染出去
    ['无法识别的存储值', { code: 0, data: 'sepia' }],
  ])('存储返回%s时回退到系统亮色', async (_label, response) => {
    storeReturning(response)

    const { api } = mountTheme()
    await flushPromises()

    expect(api.loaded.value).toBe(true)
    expect(api.mode.value).toBe('system')
    expect(api.theme.value).toBe('light')
  })

  it('读取持久化偏好失败时静默回退到系统主题', async () => {
    media = createMatchMedia(true)
    window.matchMedia = media.matchMedia
    window.electronAPI = { storeGetSetting: vi.fn().mockRejectedValue(new Error('存储不可用')) }

    const { api } = mountTheme()
    await flushPromises()

    expect(api.loaded.value).toBe(true)
    expect(api.theme.value).toBe('dark')
  })

  it('无用户偏好时跟随系统主题变化', async () => {
    const { api } = mountTheme()
    await flushPromises()

    media.mediaQuery.dispatch(true)
    await nextTick()
    expect(api.theme.value).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')

    media.mediaQuery.dispatch(false)
    await nextTick()
    expect(api.theme.value).toBe('light')
  })

  it('有用户偏好时忽略后续系统主题变化', async () => {
    storeReturning({ code: 0, data: 'light' })
    const { api } = mountTheme()
    await flushPromises()

    media.mediaQuery.dispatch(true)
    await nextTick()

    expect(api.theme.value).toBe('light')
  })

  it('setMode 切暗色并持久化模式本身', async () => {
    const storeSetSetting = vi.fn().mockResolvedValue(undefined)
    window.electronAPI = { storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: '' }), storeSetSetting }

    const { api } = mountTheme()
    await flushPromises()
    expect(setThemeMode('dark')).toBe(true)
    await flushPromises()

    expect(api.theme.value).toBe('dark')
    expect(api.mode.value).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(storeSetSetting).toHaveBeenCalledWith(THEME_KEY, 'dark')
  })

  it('setMode("system") 把"跟随系统"这件事本身记住', async () => {
    media = createMatchMedia(true)
    window.matchMedia = media.matchMedia
    const storeSetSetting = vi.fn().mockResolvedValue(undefined)
    window.electronAPI = { storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'light' }), storeSetSetting }

    const { api } = mountTheme()
    await flushPromises()
    setThemeMode('system')
    await flushPromises()

    expect(storeSetSetting).toHaveBeenLastCalledWith(THEME_KEY, 'system')
    expect(api.theme.value).toBe('dark', '退回系统偏好而不是停在最后一次手工值')
  })

  it.each([['非法模式', 'neo-brutalism'], ['空值', ''], ['非字符串', 42]])(
    '%s 一律拒绝：不改主题、不写存储、返回 false',
    async (bad) => {
      const storeSetSetting = vi.fn().mockResolvedValue(undefined)
      window.electronAPI = { storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'light' }), storeSetSetting }

      const { api } = mountTheme()
      await flushPromises()

      expect(setThemeMode(bad)).toBe(false)
      expect(api.theme.value).toBe('light')
      expect(storeSetSetting).not.toHaveBeenCalled()
    },
  )

  it('桥接缺席时 setMode 仍完成本地切换', async () => {
    const { api } = mountTheme()
    await flushPromises()

    expect(setThemeMode('dark')).toBe(true)
    expect(api.theme.value).toBe('dark')
  })

  it('持久化失败不回滚已生效的本地主题', async () => {
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: '' }),
      storeSetSetting: vi.fn().mockRejectedValue(new Error('写入失败')),
    }
    const { api } = mountTheme()
    await flushPromises()

    setThemeMode('dark')
    await flushPromises()

    expect(api.theme.value).toBe('dark')
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('手动切换后不再被系统主题变化覆盖', async () => {
    window.electronAPI = { storeSetSetting: vi.fn().mockResolvedValue(undefined) }
    const { api } = mountTheme()
    await flushPromises()

    setThemeMode('dark')
    media.mediaQuery.dispatch(false)
    await nextTick()

    expect(api.theme.value).toBe('dark')
  })

  // ─── 本次重构的存在理由：状态必须共享，且初始化只做一次 ───
  it('两个消费者共享同一份状态（各调一次 useTheme 曾各自持有独立 ref）', async () => {
    const first = mountTheme()
    const second = mountTheme()
    await flushPromises()

    expect(first.api.theme).toBe(second.api.theme, 'theme 必须是同一个 ref')
    expect(first.api.loaded).toBe(second.api.loaded)

    setThemeMode('dark')
    await nextTick()
    expect(second.api.theme.value).toBe('dark', '未参与切换的消费者必须立刻看到同一结果')
  })

  it('boot 幂等：多次 useTheme 只读一次偏好、只注册一次系统监听', async () => {
    const storeGetSetting = vi.fn().mockResolvedValue({ code: 0, data: 'dark' })
    window.electronAPI = { storeGetSetting }

    mountTheme()
    mountTheme()
    mountTheme()
    await flushPromises()

    expect(storeGetSetting).toHaveBeenCalledTimes(1)
    expect(media.mediaQuery.listenerCount()).toBe(1)
    expect(media.mediaQuery.addEventListener).toHaveBeenCalledTimes(1, '系统监听器只挂一次')
  })

  it('卸载消费者不移除系统监听（模块生命周期 == 应用生命周期）', async () => {
    const { wrapper } = mountTheme()
    await flushPromises()
    const listener = media.mediaQuery.addEventListener.mock.calls[0][1]

    wrapper.unmount()
    media.mediaQuery.dispatch(true)
    await nextTick()

    expect(media.mediaQuery.removeEventListener).not.toHaveBeenCalled()
    expect(useTheme().theme.value).toBe('dark', '组件卸载后主题状态仍随系统偏好更新')
    expect(listener).toEqual(expect.any(Function))
  })

  it('toggle 在 light/dark 间取反，且不把 system 选择丢掉判断依据', async () => {
    const storeSetSetting = vi.fn().mockResolvedValue(undefined)
    window.electronAPI = { storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: 'system' }), storeSetSetting }
    const { api } = mountTheme()
    await flushPromises()

    expect(api.mode.value).toBe('system')
    expect(toggleTheme()).toBe(true)
    expect(api.mode.value).toBe('dark', '系统当前是亮色 ⇒ 取反应得到暗色')
    expect(storeSetSetting).toHaveBeenLastCalledWith(THEME_KEY, 'dark')

    toggleTheme()
    expect(api.mode.value).toBe('light')
  })

  it('模式清单是闭集，且 resolveTheme 只对 system 走系统值', () => {
    expect(THEME_MODES).toEqual(['system', 'light', 'dark'])
    expect(resolveTheme('dark', 'light')).toBe('dark')
    expect(resolveTheme('light', 'dark')).toBe('light')
    expect(resolveTheme('system', 'dark')).toBe('dark')
    expect(resolveTheme('system', 'light')).toBe('light')
  })
})
