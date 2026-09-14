import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import NavBar from './NavBar.vue'
import i18n from '@/i18n'

function mountNavBar (props = {}) {
  return mount(NavBar, { props, global: { plugins: [i18n] } })
}

beforeEach(() => {
  i18n.global.locale.value = 'zh'
})

describe('NavBar 登录标签态（参考产品对标）', () => {
  it('默认不显示保存账号按钮', () => {
    const w = mountNavBar()
    expect(w.find('[data-testid="nav-save-account"]').exists()).toBe(false)
  })

  it('isLoginTab 为 true 时显示蓝色「保存账号」按钮', () => {
    const w = mountNavBar({ isLoginTab: true })
    const button = w.get('[data-testid="nav-save-account"]')
    expect(button.text()).toBe('保存账号')
    expect(button.attributes('disabled')).toBeUndefined()
  })

  it('点击保存账号按钮触发 save-account 事件', async () => {
    const w = mountNavBar({ isLoginTab: true })
    await w.get('[data-testid="nav-save-account"]').trigger('click')
    expect(w.emitted('save-account')).toHaveLength(1)
  })

  it('saving 为 true 时按钮禁用并显示「保存中...」', () => {
    const w = mountNavBar({ isLoginTab: true, saving: true })
    const button = w.get('[data-testid="nav-save-account"]')
    expect(button.text()).toBe('保存中...')
    expect(button.attributes('disabled')).toBeDefined()
  })

  it('导航栏保留后退/前进/刷新/首页与地址栏', () => {
    const w = mountNavBar({ isLoginTab: true, isHome: false, currentUrl: 'https://creator.douyin.com/' })
    expect(w.get('[data-testid="nav-back"]').exists()).toBe(true)
    expect(w.get('[data-testid="nav-forward"]').exists()).toBe(true)
    expect(w.get('[data-testid="nav-reload"]').exists()).toBe(true)
    expect(w.get('[data-testid="nav-home"]').exists()).toBe(true)
    expect(w.get('[data-testid="nav-url-input"]').element.value).toBe('https://creator.douyin.com/')
  })
})
