// @ts-check
/**
 * 「快捷键」Tab 接线锁（UX 审计 1.6）—— 面板存在但没挂进设置弹窗，等于没有面板。
 *
 * 这一档缺陷本仓已反复踩过（组件存在、零消费方 ⇒ 用户永远看不到）。
 * 所以这里不测面板本身（那在 HotkeysSettings.test.js），只测"入口在、点得动、渲染的是它"。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import SettingsDialog from './SettingsDialog.vue'

async function flush (times = 8) {
  for (let i = 0; i < times; i += 1) await Promise.resolve()
  await nextTick()
}

function mountDialog () {
  i18n.global.locale.value = 'zh'
  return mount(SettingsDialog, {
    props: { visible: true },
    global: { plugins: [i18n], stubs: { teleport: true, ModelProviders: true, LogsSettings: true, FeishuSettingsTab: true, ZhihuSettingsTab: true, PublishFrequencySettings: true } },
  })
}

afterEach(() => {
  delete window.electronAPI
})

describe('设置弹窗的「快捷键」入口', () => {
  it('导航里有「快捷键」，且不是 disabled 占位项（此前只有 account 是占位）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: [] })) }
    const w = mountDialog()
    await flush()
    const tab = w.get('button.settings-tab[aria-current], button.settings-tab:not([disabled])')
    expect(tab.exists()).toBe(true)
    const labels = w.findAll('.settings-tab').map((b) => b.text())
    expect(labels.some((l) => l.includes('快捷键')), '实际：' + labels.join(' / ')).toBe(true)
    const disabledLabels = w.findAll('.settings-tab[disabled]').map((b) => b.text())
    expect(disabledLabels.join(' ')).not.toContain('快捷键')
    w.unmount()
  })

  it('点击该 Tab 渲染的是快捷键面板本体（不是占位提示）', async () => {
    window.electronAPI = {
      hotkeysList: vi.fn(async () => ({ code: 0, data: [{ accelerator: 'CmdOrCtrl+Alt+P', route: '/publish', label: '发布' }] })),
    }
    const w = mountDialog()
    await flush()
    const btn = w.findAll('.settings-tab').find((b) => b.text().includes('快捷键'))
    expect(btn, '找不到入口按钮').toBeTruthy()
    await btn.trigger('click')
    await flush()
    expect(w.find('[data-testid="hotkeys-settings"]').exists()).toBe(true)
    expect(w.findAll('[data-testid="hotkeys-row"]')).toHaveLength(1)
    expect(w.find('.placeholder-panel').exists(), '切到可用 Tab 后不得还挂着占位面板').toBe(false)
    w.unmount()
  })

  it('initialTab="hotkeys" 可在打开那一刻直接定位（供「就地去查快捷键」类入口使用）', async () => {
    window.electronAPI = { hotkeysList: vi.fn(async () => ({ code: 0, data: [] })) }
    i18n.global.locale.value = 'zh'
    // 必须走 false→true 的**打开沿**：契约是「只在打开那一刻生效」，挂载即 visible:true
    // 没有打开沿，测的就不是生产形态（App.vue 里弹窗常驻、由 showSettingsDialog 翻转驱动）。
    const w = mount(SettingsDialog, {
      props: { visible: false, initialTab: 'hotkeys' },
      global: { plugins: [i18n], stubs: { teleport: true, ModelProviders: true, LogsSettings: true, FeishuSettingsTab: true, ZhihuSettingsTab: true, PublishFrequencySettings: true } },
    })
    await w.setProps({ visible: true })
    await flush()
    expect(w.find('[data-testid="hotkeys-settings"]').exists()).toBe(true)
    w.unmount()
  })
})
