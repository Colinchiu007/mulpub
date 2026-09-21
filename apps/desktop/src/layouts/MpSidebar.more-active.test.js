/**
 * MpSidebar「更多」菜单选中态测试（2026-09-21）
 *
 * 缺陷背景：点击「更多」中的菜单项（如效果洞察）打开对应页面后，
 * 侧边栏菜单项没有任何选中态，用户无法感知当前所在页面。
 *
 * 契约：
 * - 路由命中 more 组菜单项 → 该项渲染 .active 类 + aria-current="page"
 * - more 组存在激活项 → 「更多」触发器常驻激活态（即使菜单收起）
 * - 直接以 more 组路由进入 → 菜单自动展开且当前项高亮
 * - 路由离开 more 组 → 触发器恢复为仅 moreOpen 驱动
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import i18n from '@/i18n'

const routeState = vi.hoisted(() => ({ path: '/accounts' }))

const invokeMock = vi.hoisted(() => vi.fn(async () => ({ code: 0, data: null })))

vi.mock('@/api/electron-bridge', () => ({
  invoke: invokeMock,
  invokePageManager: vi.fn(),
}))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/composables/useAppVersion', async () => {
  const { ref } = await import('vue')
  return { useAppVersion: () => ({ version: ref(''), loadVersion: vi.fn() }) }
})

import MpSidebar from './MpSidebar.vue'

let wrapper

function mountSidebar (path = '/accounts') {
  i18n.global.locale.value = 'zh'
  routeState.path = path
  wrapper = mount(MpSidebar, {
    global: {
      plugins: [i18n, createPinia()],
      stubs: {
        ProfileMenu: { template: '<div data-testid="profile-menu-stub" />' },
        UpgradeModal: { template: '<div data-testid="upgrade-modal-stub" />' },
        ElPopover: {
          template: '<div class="el-popover-stub"><slot name="reference" /><slot /></div>',
        },
        RouterLink: {
          props: { to: { type: [String, Object], default: '' } },
          computed: {
            href () {
              return typeof this.to === 'string' ? this.to : this.to.path
            },
          },
          template: '<a :href="href" v-bind="$attrs"><slot /></a>',
        },
      },
    },
  })
  return wrapper
}

beforeEach(() => {
  invokeMock.mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

describe('MpSidebar 更多菜单选中态', () => {
  it('路由命中 more 组菜单项 → 该项带 active 与 aria-current', async () => {
    const sidebar = mountSidebar('/performance-insights')
    // onMounted 命中 more 路由自动展开（ref 已置位，需 nextTick 让 DOM 重渲染）
    await nextTick()

    const item = sidebar.get('[data-testid="mp-more-item-performance-insights"]')
    expect(item.classes()).toContain('active')
    expect(item.attributes('aria-current')).toBe('page')
  })

  it('more 组存在激活项 → 「更多」触发器常驻激活态（菜单收起时同样可见）', async () => {
    const sidebar = mountSidebar('/performance-insights')

    // 未点击展开（自动展开逻辑只作用于初始路由，触发器激活不依赖 moreOpen）
    const trigger = sidebar.get('[data-testid="mp-primary-more"]')
    expect(trigger.classes()).toContain('active')

    // 收起菜单后触发器仍保持激活
    await trigger.trigger('click')
    expect(sidebar.find('[role="menu"]').exists()).toBe(false)
    expect(sidebar.get('[data-testid="mp-primary-more"]').classes()).toContain('active')
  })

  it('直接以 more 组路由进入 → 菜单自动展开且当前项高亮', async () => {
    const sidebar = mountSidebar('/hot-topics')
    await nextTick()

    expect(sidebar.get('[data-testid="mp-primary-more"]').attributes('aria-expanded')).toBe('true')
    const menu = sidebar.get('[role="menu"]')
    expect(menu.find('[data-testid="mp-more-item-hot-topics"]').classes()).toContain('active')
  })

  it('路由不在 more 组 → 触发器无 active；展开后各菜单项亦无 active', async () => {
    const sidebar = mountSidebar('/accounts')
    await nextTick()

    // 收起态且不在 more 组 → 触发器无 active（不依赖 moreOpen）
    expect(sidebar.get('[data-testid="mp-primary-more"]').classes()).not.toContain('active')

    // 手动展开菜单，逐项确认无 active（当前路由不在 more 组）
    await sidebar.get('[data-testid="mp-primary-more"]').trigger('click')
    for (const item of sidebar.findAll('.mp-more-item')) {
      expect(item.classes()).not.toContain('active')
    }
  })

  it('一级导航激活不受影响（回归保护）', async () => {
    const sidebar = mountSidebar('/accounts')

    expect(sidebar.get('[data-testid="mp-primary-accounts"]').classes()).toContain('active')
    expect(sidebar.get('[data-testid="mp-primary-accounts"]').attributes('aria-current')).toBe('page')
  })
})
