// @ts-nocheck
// 外观面板（UX-AUDIT 阶段 1.1 / audit-9）。
//
// 这组用例证明的是「用户能通过这个面板把主题改掉并让它留下来」，
// 而不是「组件渲染出来了」——后者由 SettingsDialog 的 Tab 接线用例负责。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

import AppearanceSettings from './AppearanceSettings.vue'
import { __resetThemeStateForTest } from '@/composables/useTheme'

async function mountPanel () {
  const w = mount(AppearanceSettings, { global: { plugins: [i18n] } })
  // boot() 里有一次 await 的 IPC 读，挂载后需要冲刷
  await nextTick()
  await new Promise(resolve => setTimeout(resolve, 0))
  await nextTick()
  return w
}

describe('AppearanceSettings 外观面板', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    __resetThemeStateForTest()
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue({ code: 0, data: null }),
      storeSetSetting: vi.fn().mockResolvedValue({ code: 0, data: true }),
    }
    window.matchMedia = vi.fn().mockReturnValue({
      matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
  })

  afterEach(() => {
    __resetThemeStateForTest()
    delete window.electronAPI
    delete window.matchMedia
  })

  it('首次挂载即落定三档选项，默认选中「跟随系统」', async () => {
    const w = await mountPanel()
    expect(w.find('[data-testid="appearance-panel"]').exists()).toBe(true)
    for (const m of ['system', 'light', 'dark']) {
      expect(w.find(`[data-testid="appearance-mode-${m}"]`).exists(), `缺少 ${m} 档`).toBe(true)
    }
    expect(w.get('[data-testid="appearance-mode-system"]').element.checked).toBe(true)
  })

  it('偏好读取完成前整个面板禁用，且给出 role=status 的加载态', async () => {
    let release
    window.electronAPI.storeGetSetting = vi.fn(() => new Promise(resolve => { release = resolve }))
    const w = mount(AppearanceSettings, { global: { plugins: [i18n] } })
    await nextTick()
    expect(w.get('[data-testid="appearance-panel"]').element.disabled).toBe(true)
    expect(w.find('[data-testid="appearance-loading"]').attributes('role')).toBe('status')

    release({ code: 0, data: null })
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(w.get('[data-testid="appearance-panel"]').element.disabled).toBe(false)
    expect(w.find('[data-testid="appearance-loading"]').exists()).toBe(false)
  })

  it('已存 dark ⇒ 挂载后直接是深色（恢复即生效，不需要用户再点一次）', async () => {
    window.electronAPI.storeGetSetting = vi.fn().mockResolvedValue({ code: 0, data: 'dark' })
    const w = await mountPanel()
    expect(w.get('[data-testid="appearance-mode-dark"]').element.checked).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('已存的是非法值 ⇒ 回落跟随系统，绝不把脏值当作用户偏好应用', async () => {
    window.electronAPI.storeGetSetting = vi.fn().mockResolvedValue({ code: 0, data: 'neon' })
    const w = await mountPanel()
    expect(w.get('[data-testid="appearance-mode-system"]').element.checked).toBe(true)
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
    expect(window.electronAPI.storeSetSetting).not.toHaveBeenCalled()
  })

  it('点「深色」：立刻落 DOM、并把模式（不是解析结果）写进持久化真源', async () => {
    const w = await mountPanel()
    await w.get('[data-testid="appearance-mode-dark"]').setValue('dark')
    await nextTick()
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
    expect(window.electronAPI.storeSetSetting).toHaveBeenCalledWith('ui:theme', 'dark')
  })

  it('切回「跟随系统」持久化的也是 system —— 否则用户改系统主题会被自己的历史选择钉死', async () => {
    const w = await mountPanel()
    await w.get('[data-testid="appearance-mode-dark"]').setValue('dark')
    await w.get('[data-testid="appearance-mode-system"]').setValue('system')
    await nextTick()
    expect(window.electronAPI.storeSetSetting).toHaveBeenLastCalledWith('ui:theme', 'system')
  })

  it('系统偏好为深色且模式为 system ⇒ 生效主题显示为深色（否则用户以为设置没生效）', async () => {
    window.matchMedia = vi.fn().mockReturnValue({
      matches: true, addEventListener: vi.fn(), removeEventListener: vi.fn(),
    })
    const w = await mountPanel()
    const current = w.get('[data-testid="appearance-current"]').text()
    expect(current).toContain(i18n.global.t('settings.appearanceDarkValue'))
    expect(document.documentElement.getAttribute('data-theme')).toBe('dark')
  })

  it('存储不可用（IPC 抛错）⇒ 面板仍可用，本地切换照样生效，不白屏也不报错', async () => {
    window.electronAPI.storeGetSetting = vi.fn().mockRejectedValue(new Error('bridge down'))
    const w = await mountPanel()
    expect(w.get('[data-testid="appearance-panel"]').element.disabled).toBe(false)
    await w.get('[data-testid="appearance-mode-light"]').setValue('light')
    await nextTick()
    expect(document.documentElement.getAttribute('data-theme')).toBe('light')
  })
})
