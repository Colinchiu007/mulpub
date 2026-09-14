import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const routeState = vi.hoisted(() => ({ path: '/accounts', query: {} }))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
}))

import YixiaoerModuleNav from './YixiaoerModuleNav.vue'

let wrapper

function mountNav (path, query = {}) {
  routeState.path = path
  routeState.query = query
  wrapper = mount(YixiaoerModuleNav, {
    global: {
      stubs: {
        RouterLink: {
          props: { to: { type: [String, Object], default: '' } },
          computed: {
            href () {
              if (typeof this.to === 'string') return this.to
              const params = new URLSearchParams(this.to.query || {}).toString()
              return `${this.to.path}${params ? `?${params}` : ''}`
            },
          },
          template: '<a :href="href" v-bind="$attrs"><slot /></a>',
        },
      },
    },
  })
  return wrapper
}

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('YixiaoerModuleNav', () => {
  it('renders account tabs and marks the current account route active', () => {
    const nav = mountNav('/accounts')

    expect(nav.findAll('[role="tab"]')).toHaveLength(4)
    expect(nav.text()).toContain('账号管理')
    expect(nav.text()).toContain('分组管理')
    expect(nav.text()).toContain('分享链接')
    expect(nav.text()).toContain('收藏分组')
    expect(nav.get('[data-testid="yixiaoer-tab-accounts"]').classes()).toContain('active')
    expect(nav.get('[data-testid="yixiaoer-tab-accounts"]').attributes('aria-current')).toBe('page')
    expect(nav.get('[data-testid="yixiaoer-tab-groups"]').attributes('href')).toBe('/accounts?tab=groups')
  })

  it('uses the account query tab for secondary account navigation', () => {
    const nav = mountNav('/accounts', { tab: 'favorites' })

    expect(nav.get('[data-testid="yixiaoer-tab-favorites"]').classes()).toContain('active')
    expect(nav.get('[data-testid="yixiaoer-tab-accounts"]').classes()).not.toContain('active')
  })

  it('renders publish tabs with route-aware active state', () => {
    const nav = mountNav('/publish/history')

    expect(nav.findAll('[role="tab"]')).toHaveLength(3)
    expect(nav.text()).toContain('新建发布')
    expect(nav.text()).toContain('发布记录')
    expect(nav.text()).toContain('草稿箱')
    expect(nav.get('[data-testid="yixiaoer-tab-publish-history"]').classes()).toContain('active')
    expect(nav.get('[data-testid="yixiaoer-tab-drafts"]').classes()).not.toContain('active')

    nav.unmount()
    wrapper = mountNav('/publish', { tab: 'drafts' })
    expect(wrapper.get('[data-testid="yixiaoer-tab-drafts"]').classes()).toContain('active')

    wrapper.unmount()
    wrapper = mountNav('/publish')
    expect(wrapper.get('[data-testid="yixiaoer-tab-new-publish"]').classes()).toContain('active')
    expect(wrapper.get('[data-testid="yixiaoer-tab-publish-history"]').classes()).not.toContain('active')
  })

  it('renders home tab when on the root route', () => {
    const nav = mountNav('/')

    expect(nav.findAll('[role="tab"]')).toHaveLength(1)
    expect(nav.text()).toContain('主页')
    expect(nav.get('[data-testid="yixiaoer-tab-home"]').classes()).toContain('active')
  })

  // 右上角 4 个占位工具入口（移动端预览/客服支持/使用指南/通知）已按产品要求整体移除，
  // 这里做回归保护：模块导航区只保留标签页，不再渲染任何工具按钮或工具面板。
  it('no longer renders module tool entries or the tool panel', () => {
    const nav = mountNav('/accounts')

    expect(nav.find('[data-testid="yixiaoer-module-tools"]').exists()).toBe(false)
    expect(nav.findAll('.yixiaoer-tool-button')).toHaveLength(0)
    expect(nav.find('[data-testid="yixiaoer-tool-preview"]').exists()).toBe(false)
    expect(nav.find('[data-testid="yixiaoer-tool-support"]').exists()).toBe(false)
    expect(nav.find('[data-testid="yixiaoer-tool-guide"]').exists()).toBe(false)
    expect(nav.find('[data-testid="yixiaoer-tool-notifications"]').exists()).toBe(false)
    expect(nav.find('[data-testid="yixiaoer-tool-panel"]').exists()).toBe(false)
  })
})
