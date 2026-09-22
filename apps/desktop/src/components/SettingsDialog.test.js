import { describe, expect, it, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import SettingsDialog from './SettingsDialog.vue'

function mountDialog (locale = 'zh') {
  i18n.global.locale.value = locale
  return mount(SettingsDialog, {
    props: { visible: true },
    global: { plugins: [i18n], stubs: { teleport: true } },
  })
}

describe('SettingsDialog', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
  })

  it('渲染五个 Tab（含禁用徽标），默认选中模型设置', () => {
    const wrapper = mountDialog()
    const tabs = wrapper.findAll('.settings-tab')
    expect(tabs).toHaveLength(5)
    expect(tabs[0].text()).toContain('模型设置')
    expect(tabs[1].text()).toContain('通用设置')
    expect(tabs[2].text()).toContain('飞书 API')
    expect(tabs[3].text()).toContain('发布设置')
    expect(tabs[3].text()).toContain('敬请期待')
    expect(tabs[3].attributes('disabled')).toBeDefined()
    expect(wrapper.get('.settings-tab.active').text()).toContain('模型设置')
  })

  it('点击禁用 Tab 不切换激活态', async () => {
    const wrapper = mountDialog()
    await wrapper.findAll('.settings-tab')[3].trigger('click')
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('模型设置')
  })

  it('切换到通用设置渲染日志设置面板（i18n 文案）', async () => {
    const wrapper = mountDialog()
    await wrapper.findAll('.settings-tab')[1].trigger('click')
    await nextTick()
    await new Promise(resolve => setTimeout(resolve, 0))
    await nextTick()
    expect(wrapper.get('.settings-tab.active').text()).toContain('通用设置')
    expect(wrapper.text()).toContain('应用日志')
    expect(wrapper.text()).toContain('语言')
  })

  it('每个 Tab 渲染图标位（.tab-icon）', () => {
    const wrapper = mountDialog()
    const icons = wrapper.findAll('.settings-tab .tab-icon')
    expect(icons).toHaveLength(5)
  })

  it('en 语言下 Tab 与占位文案为英文', () => {
    const wrapper = mountDialog('en')
    const tabs = wrapper.findAll('.settings-tab')
    expect(tabs[0].text()).toContain('Model Settings')
    expect(tabs[3].text()).toContain('Coming Soon')
  })
})
