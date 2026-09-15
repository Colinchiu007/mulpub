import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'

const routeState = vi.hoisted(() => ({ path: '/accounts', query: {} }))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
}))

import MpModuleNav from './MpModuleNav.vue'

let wrapper

function mountNav (path, query = {}) {
  routeState.path = path
  routeState.query = query
  wrapper = mount(MpModuleNav, {
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

describe('MpModuleNav', () => {
  it('renders account tabs and marks the current account route active', () => {
    const nav = mountNav('/accounts')

    expect(nav.findAll('[role="tab"]')).toHaveLength(4)
    expect(nav.text()).toContain('账号管理')
    expect(nav.text()).toContain('分组管理')
    expect(nav.text()).toContain('分享链接')
    expect(nav.text()).toContain('收藏分组')
    expect(nav.get('[data-testid="mp-tab-accounts"]').classes()).toContain('active')
    expect(nav.get('[data-testid="mp-tab-accounts"]').attributes('aria-current')).toBe('page')
    expect(nav.get('[data-testid="mp-tab-groups"]').attributes('href')).toBe('/accounts?tab=groups')
  })

  it('uses the account query tab for secondary account navigation', () => {
    const nav = mountNav('/accounts', { tab: 'favorites' })

    expect(nav.get('[data-testid="mp-tab-favorites"]').classes()).toContain('active')
    expect(nav.get('[data-testid="mp-tab-accounts"]').classes()).not.toContain('active')
  })

  // 发布域快捷标签行（新建发布/发布记录/草稿箱）已按产品要求整体移除，
  // 发布域导航职责由左侧边栏承担；这里做回归保护：发布域路由不再渲染模块导航。
  it('renders no module navigation on publish-domain routes', () => {
    for (const [path, query] of [
      ['/publish', {}],
      ['/publish/history', {}],
      ['/publish', { tab: 'drafts' }],
      ['/collection', {}],
    ]) {
      const nav = mountNav(path, query)

      expect(nav.find('[data-testid="mp-module-nav"]').exists()).toBe(false)
      expect(nav.findAll('[role="tab"]')).toHaveLength(0)
      expect(nav.text()).not.toContain('新建发布')
      expect(nav.text()).not.toContain('发布记录')
      expect(nav.text()).not.toContain('草稿箱')

      nav.unmount()
      wrapper = null
    }
  })

  it('renders home tab when on the root route', () => {
    const nav = mountNav('/')

    expect(nav.findAll('[role="tab"]')).toHaveLength(1)
    expect(nav.text()).toContain('主页')
    expect(nav.get('[data-testid="mp-tab-home"]').classes()).toContain('active')
  })

  // 右上角 4 个占位工具入口（移动端预览/客服支持/使用指南/通知）已按产品要求整体移除，
  // 这里做回归保护：模块导航区只保留标签页，不再渲染任何工具按钮或工具面板。
  it('no longer renders module tool entries or the tool panel', () => {
    const nav = mountNav('/accounts')

    expect(nav.find('[data-testid="mp-module-tools"]').exists()).toBe(false)
    expect(nav.findAll('.mp-tool-button')).toHaveLength(0)
    expect(nav.find('[data-testid="mp-tool-preview"]').exists()).toBe(false)
    expect(nav.find('[data-testid="mp-tool-support"]').exists()).toBe(false)
    expect(nav.find('[data-testid="mp-tool-guide"]').exists()).toBe(false)
    expect(nav.find('[data-testid="mp-tool-notifications"]').exists()).toBe(false)
    expect(nav.find('[data-testid="mp-tool-panel"]').exists()).toBe(false)
  })
})
