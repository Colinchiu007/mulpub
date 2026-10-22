import { beforeEach, describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import AccountLoginDialog from './AccountLoginDialog.vue'

describe('AccountLoginDialog', () => {
  // ⚠️ 这里**不**给 AccountPlatformPicker 打桩。
  //   初版用「一个只会硬编码 emit 'wechat_mp' 的假按钮」当桩件，于是弹窗与选择器之间
  //   的 prop 契约（`:platforms` 有没有真的传下去）根本不在断言面内：把整条 `:platforms`
  //   绑定删掉，用例照样全绿 —— 集成回归等于没测（QM-6 外部评审 i1）。
  //   现在直接挂**真组件**跑真实交互：平台选项能出现，本身就说明 prop 契约是通的。
  const global = {
    plugins: [i18n],
    stubs: {
      UiModal: { template: '<div><slot/><slot name="footer"/></div>', props: ['visible'] },
      UiButton: { template: '<button :disabled="disabled" @click="$emit(\'click\')"><slot/></button>', props: ['disabled'], emits: ['click'] },
    },
  }

  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    setActivePinia(createPinia())
    document.body.replaceChildren()
  })

  it('平台选择由自绘选择器承接：真实浮层里选中的平台 id 透传到弹窗外', async () => {
    const wrapper = mount(AccountLoginDialog, {
      props: {
        visible: true,
        platforms: [{ id: 'wechat_mp', label: '微信' }, { id: 'douyin', label: '抖音' }],
        modelValue: '',
        mode: 'browser',
      },
      global,
      attachTo: document.body,
    })

    await wrapper.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await nextTick()
    await nextTick()

    // 选项存在 ⇔ 弹窗确实把 platforms 传给了选择器
    const option = document.querySelector('[data-testid="platform-picker-option-douyin"]')
    expect(option).not.toBeNull()
    expect(option.textContent).toContain('抖音')

    option.click()
    await nextTick()

    expect(wrapper.emitted('update:modelValue')?.[0]).toEqual(['douyin'])
    wrapper.unmount()
  })

  it('登录方式使用分段控制并提交当前模式', async () => {
    const wrapper = mount(AccountLoginDialog, {
      props: {
        visible: true,
        platforms: [{ id: 'wechat_mp', label: '微信' }],
        modelValue: 'wechat_mp',
        mode: 'browser',
      },
      global,
    })

    await wrapper.get('[data-testid="mode-qrcode"]').trigger('click')
    await wrapper.get('[data-testid="submit-login"]').trigger('click')

    expect(wrapper.emitted('update:mode')?.[0]).toEqual(['qrcode'])
    expect(wrapper.emitted('submit')?.[0]).toEqual([])
  })

  it('快手即使没有平台能力回退值也允许扫码入口和提交', async () => {
    const wrapper = mount(AccountLoginDialog, {
      props: {
        visible: true,
        platforms: [{ id: 'kuaishou', label: '快手' }],
        modelValue: 'kuaishou',
        mode: 'qrcode',
        qrAvailable: false,
      },
      global,
    })

    expect(wrapper.get('[data-testid="mode-qrcode"]').attributes('disabled')).toBeUndefined()
    expect(wrapper.get('[data-testid="submit-login"]').attributes('disabled')).toBeUndefined()

    await wrapper.get('[data-testid="submit-login"]').trigger('click')

    expect(wrapper.emitted('submit')?.[0]).toEqual([])
    expect(wrapper.find('.mode-notice').exists()).toBe(false)
  })

  it('非扫码平台在能力不可用时仍禁用二维码入口和提交', () => {
    const wrapper = mount(AccountLoginDialog, {
      props: {
        visible: true,
        platforms: [{ id: 'wechat_mp', label: '微信' }],
        modelValue: 'wechat_mp',
        mode: 'qrcode',
        qrAvailable: false,
      },
      global,
    })

    expect(wrapper.get('[data-testid="mode-qrcode"]').attributes('disabled')).toBe('')
    expect(wrapper.get('[data-testid="submit-login"]').attributes('disabled')).toBe('')
  })

  it('登录文案跟随当前语言切换', () => {
    i18n.global.locale.value = 'en'
    const wrapper = mount(AccountLoginDialog, {
      props: {
        visible: true,
        platforms: [{ id: 'wechat_mp', label: 'WeChat' }],
        modelValue: 'wechat_mp',
        mode: 'browser',
      },
      global,
    })

    expect(wrapper.text()).toContain('Login method')
    expect(wrapper.get('[data-testid="mode-browser"]').text()).toContain('Browser login')
    expect(wrapper.get('[data-testid="submit-login"]').text()).toContain('Open login page')
  })
})
