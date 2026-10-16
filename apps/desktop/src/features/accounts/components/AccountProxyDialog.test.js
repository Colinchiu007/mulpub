import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import i18n from '@/i18n'
import AccountProxyDialog from './AccountProxyDialog.vue'

const mountOptions = {
  global: {
    // 本组件为「正在读取当前代理配置」等新增文案引入了 i18n（CI 拦截
    // 渲染端非 locales 文件新增中文字面量），测试必须装上同一个 i18n 实例。
    plugins: [i18n],
    stubs: {
      Teleport: { template: '<div><slot /></div>' },
      Transition: { template: '<div><slot /></div>' },
    },
  },
}

describe('AccountProxyDialog', () => {
  const account = {
    id: 'account-1',
    platform: 'wechat_mp',
    name: '公众号账号',
    proxy: { configured: true, type: 'http', hostMasked: '10.0.*.*', port: 8080 },
  }

  it('只展示脱敏状态，并将完整代理配置作为保存事件上抛', async () => {
    const wrapper = mount(AccountProxyDialog, {
      props: { visible: true, account },
      ...mountOptions,
    })

    expect(wrapper.text()).toContain('10.0.*.*:8080')
    expect(wrapper.text()).not.toContain('secret')
    await wrapper.get('[data-testid="proxy-host"] input').setValue('127.0.0.1')
    await wrapper.get('[data-testid="proxy-port"] input').setValue('1080')
    await wrapper.get('[data-testid="proxy-username"] input').setValue('account')
    await wrapper.get('[data-testid="proxy-password"] input').setValue('secret')
    await wrapper.get('[data-testid="proxy-save"]').trigger('click')

    expect(wrapper.emitted('save')?.[0]).toEqual([{
      host: '127.0.0.1',
      port: 1080,
      type: 'http',
      username: 'account',
      password: 'secret',
    }])
  })

  it('重新打开已配置代理时保留类型和端口，但不回显主机与认证凭据', () => {
    const wrapper = mount(AccountProxyDialog, {
      props: { visible: true, account },
      ...mountOptions,
    })

    expect(wrapper.get('[data-testid="proxy-port"] input').element.value).toBe('8080')
    expect(wrapper.get('[data-testid="proxy-host"] input').element.value).toBe('')
    expect(wrapper.get('[data-testid="proxy-username"] input').element.value).toBe('')
    expect(wrapper.get('[data-testid="proxy-password"] input').element.value).toBe('')
    expect(wrapper.get('[data-testid="proxy-host"] input').attributes('placeholder')).toContain('10.0.*.*')
  })

  it('为已绑定账号提供清除代理命令', async () => {
    const wrapper = mount(AccountProxyDialog, {
      props: { visible: true, account },
      ...mountOptions,
    })

    await wrapper.get('[data-testid="proxy-clear"]').trigger('click')
    expect(wrapper.emitted('clear')?.[0]).toEqual([])
  })

  // ── 惰性读取三态（nav-perf-ux，2026-10-15）────────────────────────────────
  // 列表接口不再返回 proxy，代理状态改由 account:get-proxy 在弹窗打开时按需拉取。
  // 这三条锁住"读取代价被搬到弹窗"之后**必须**存在的交互态：少了它们，用户会先
  // 看到「当前未配置代理」的假象，再被异步到达的数据填上。
  it('读取中显示加载态并禁用保存（此时 account 还只是占位值）', () => {
    const wrapper = mount(AccountProxyDialog, {
      props: {
        visible: true,
        account: { id: 'account-1', platform: 'wechat_mp', proxy: { configured: false } },
        loading: true,
      },
      ...mountOptions,
    })

    expect(wrapper.find('[data-testid="proxy-loading"]').exists()).toBe(true)
    expect(wrapper.get('[data-testid="proxy-save"]').attributes('disabled')).toBeDefined()
    // 读取中不得出现「清除」：还没有可信的"当前已配置"结论
    expect(wrapper.find('[data-testid="proxy-clear"]').exists()).toBe(false)
  })

  it('读取失败显示错误并给出重试，且**不**禁用保存（用户仍可填一份新代理）', async () => {
    const wrapper = mount(AccountProxyDialog, {
      props: {
        visible: true,
        account: { id: 'account-1', platform: 'wechat_mp', proxy: { configured: false } },
        loadError: '读取当前代理配置失败',
      },
      ...mountOptions,
    })

    expect(wrapper.get('[data-testid="proxy-load-error"]').text()).toContain('读取当前代理配置失败')
    await wrapper.get('[data-testid="proxy-retry"]').trigger('click')
    expect(wrapper.emitted('retry')).toHaveLength(1)
    expect(wrapper.get('[data-testid="proxy-save"]').attributes('disabled')).toBeUndefined()
  })

  it('惰性读到的当前代理只预填一次，不覆盖用户已输入的内容', async () => {
    const wrapper = mount(AccountProxyDialog, {
      props: {
        visible: true,
        account: { id: 'account-1', platform: 'wechat_mp', proxy: { configured: false } },
      },
      ...mountOptions,
    })

    await wrapper.get('[data-testid="proxy-host"] input').setValue('127.0.0.1')
    // 模拟异步读取到达：父组件换上一个带 proxy 的新 account 对象（id 不变）
    await wrapper.setProps({
      account: {
        id: 'account-1',
        platform: 'wechat_mp',
        proxy: { configured: true, type: 'https', hostMasked: '10.0.*.*', port: 8080 },
      },
    })

    expect(wrapper.get('[data-testid="proxy-port"] input').element.value).toBe('8080')
    expect(wrapper.get('[data-testid="proxy-host"] input').element.value).toBe('127.0.0.1')
  })
})
