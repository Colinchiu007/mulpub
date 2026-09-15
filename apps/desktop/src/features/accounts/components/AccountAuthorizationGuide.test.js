import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'

import AccountAuthorizationGuide from './AccountAuthorizationGuide.vue'

describe('AccountAuthorizationGuide', () => {
  it('展示参考产品一致的授权说明并发出确认事件', async () => {
    const wrapper = mount(AccountAuthorizationGuide, {
      props: { visible: true, platformName: '微信公众号' },
    })

    expect(wrapper.text()).toContain('如何完成账号授权')
    expect(wrapper.text()).toContain('我已完成登录')
    await wrapper.get('[data-testid="acknowledge-auth-guide"]').trigger('click')
    expect(wrapper.emitted('acknowledge')).toHaveLength(1)
  })

  it('不可见时不渲染内容', () => {
    const wrapper = mount(AccountAuthorizationGuide, { props: { visible: false } })
    expect(wrapper.text()).toBe('')
  })
})
