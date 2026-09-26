/**
 * MpSidebar 运营中心「应用菜单」配置生效测试（2026-09-15）
 *
 * 覆盖：
 * - 未下发 / 下发失败 → fail-open 回退本地默认菜单
 * - 下发隐藏 → 对应项不渲染
 * - 下发排序 → DOM 顺序随之变化
 * - 强制项（发布/账号/视频创作/采集）被下发 false 时仍渲染（防御纵深）
 * - 「更多」组全部隐藏 → 触发器按钮消失
 * - payload 超限 → 整体降级为默认菜单
 *
 * 注：本文件与 main 的品牌改造（旧品牌前缀 → mp-*）对齐，选择器使用 mp-* 前缀。
 */
import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import i18n from '@/i18n'
import { SIDEBAR_MENU_DEFINITION } from '@/config/sidebar-menu'

const routeState = vi.hoisted(() => ({ path: '/' }))
const appMenuResult = vi.hoisted(() => ({ value: { code: 0, data: null } }))
// 运营配置变更订阅桩：记录当前回调，用于模拟主进程广播
const appMenuListener = vi.hoisted(() => ({ cb: null }))

vi.mock('vue-router', () => ({
  useRoute: () => routeState,
  useRouter: () => ({ push: vi.fn() }),
}))

vi.mock('@/api/electron-bridge', () => ({
  invoke: vi.fn(async () => ({ code: 0, data: null })),
  invokePageManager: vi.fn(),
}))

// 版本号是装饰性信息：桩掉以隔离主进程调用
vi.mock('@/composables/useAppVersion', async () => {
  const { ref } = await import('vue')
  return { useAppVersion: () => ({ version: ref(null), loadVersion: vi.fn() }) }
})

vi.mock('@/api/ops-center-sync', () => ({
  opsCenterSyncAppMenu: () => Promise.resolve(appMenuResult.value),
  onOpsCenterRuntimeUpdated: (cb) => {
    appMenuListener.cb = cb
    return () => { appMenuListener.cb = null }
  },
}))

import MpSidebar from './MpSidebar.vue'

let wrapper

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
})

/** 一级导航（router-link）的 key 顺序 */
function primaryKeys (w) {
  return w.findAll('a.mp-primary-item').map((el) =>
    el.attributes('data-testid').replace('mp-primary-', ''),
  )
}

/** 「更多」折叠菜单项的 href（= 路由路径），用于校验排序 */
function moreHrefs (w) {
  return w.findAll('a.mp-more-item').map((el) => el.attributes('href'))
}

async function mountSidebar () {
  i18n.global.locale.value = 'zh'
  wrapper = mount(MpSidebar, {
    global: {
      plugins: [i18n, createPinia()],
      stubs: {
        ProfileMenu: { template: '<div data-testid="profile-menu-stub" />' },
        SidebarUpdateButton: { template: '<div />' },
        ElPopover: { template: '<div><slot name="reference" /><slot /></div>' },
        RouterLink: {
          props: { to: { type: [String, Object], default: '' } },
          computed: {
            href () { return typeof this.to === 'string' ? this.to : this.to.path },
          },
          template: '<a :href="href" v-bind="$attrs"><slot /></a>',
        },
      },
    },
  })
  await flushPromises()
  await flushPromises()
  return wrapper
}

const DEFAULT_PRIMARY = SIDEBAR_MENU_DEFINITION
  .filter((i) => i.group === 'primary')
  .map((i) => i.key)

describe('MpSidebar — 应用菜单配置生效', () => {
  it('未下发配置（data=null）→ fail-open，渲染完整默认菜单与默认顺序', async () => {
    appMenuResult.value = { code: 0, data: null }
    const sidebar = await mountSidebar()

    expect(primaryKeys(sidebar)).toEqual([...DEFAULT_PRIMARY])
    expect(sidebar.find('[data-testid="mp-primary-more"]').exists()).toBe(true)
  })

  it('IPC 报错（code=-1）→ 同样回退默认菜单', async () => {
    appMenuResult.value = { code: -1, message: '运行时策略服务未就绪', data: null }
    const sidebar = await mountSidebar()

    expect(primaryKeys(sidebar)).toEqual([...DEFAULT_PRIMARY])
  })

  it('下发隐藏「主页」与「数据」→ 两项不渲染，强制项仍在', async () => {
    appMenuResult.value = {
      code: 0,
      data: {
        items: [
          { key: 'home', visible: false, sort_order: 0 },
          { key: 'dashboard', visible: false, sort_order: 1 },
        ],
      },
    }
    const sidebar = await mountSidebar()

    const keys = primaryKeys(sidebar)
    expect(keys).not.toContain('home')
    expect(keys).not.toContain('dashboard')
    expect(keys).toContain('publish')
    expect(keys).toContain('accounts')
    expect(keys).toContain('create')
    expect(keys).toContain('collection')
  })

  it('下发排序 → 一级导航 DOM 顺序随之变化', async () => {
    appMenuResult.value = {
      code: 0,
      data: {
        items: [
          { key: 'collection', visible: true, sort_order: 0 },
          { key: 'create', visible: true, sort_order: 1 },
          { key: 'accounts', visible: true, sort_order: 2 },
          { key: 'publish', visible: true, sort_order: 3 },
          { key: 'dashboard', visible: true, sort_order: 4 },
          { key: 'home', visible: true, sort_order: 5 },
        ],
      },
    }
    const sidebar = await mountSidebar()

    expect(primaryKeys(sidebar)).toEqual([
      // 6 项按下发 sort_order 重排；rewrite 未下发（无 sort_order）→ 排在其后
      'collection', 'create', 'accounts', 'publish', 'dashboard', 'home', 'copy-library', 'rewrite',
    ])
  })

  it('强制项被下发 visible=false → 仍渲染（防御纵深，不依赖运营中心 UI 的灰显）', async () => {
    appMenuResult.value = {
      code: 0,
      data: {
        items: SIDEBAR_MENU_DEFINITION.map((i) => ({ key: i.key, visible: false, sort_order: 0 })),
      },
    }
    const sidebar = await mountSidebar()

    const keys = primaryKeys(sidebar)
    expect(keys).toContain('publish')
    expect(keys).toContain('accounts')
    expect(keys).toContain('create')
    expect(keys).toContain('collection')
    // 非强制项应被隐藏
    expect(keys).not.toContain('home')
    expect(keys).not.toContain('dashboard')
  })

  it('「更多」组全部隐藏 → 触发器按钮与折叠菜单都不渲染', async () => {
    appMenuResult.value = {
      code: 0,
      data: {
        items: SIDEBAR_MENU_DEFINITION
          .filter((i) => i.group === 'more')
          .map((i) => ({ key: i.key, visible: false, sort_order: 0 })),
      },
    }
    const sidebar = await mountSidebar()

    expect(sidebar.find('[data-testid="mp-primary-more"]').exists()).toBe(false)
    expect(sidebar.find('[role="menu"]').exists()).toBe(false)
  })

  it('「更多」组排序生效', async () => {
    appMenuResult.value = {
      code: 0,
      data: {
        items: [
          { key: 'member-center', visible: true, sort_order: 0 },
          { key: 'keywords', visible: true, sort_order: 1 },
        ],
      },
    }
    const sidebar = await mountSidebar()
    await sidebar.get('[data-testid="mp-primary-more"]').trigger('click')

    expect(moreHrefs(sidebar).slice(0, 2)).toEqual(['/member-center', '/keywords'])
  })

  it('payload 项数超限（>200）→ 整体拒绝，降级为默认菜单', async () => {
    const items = Array.from({ length: 201 }, (_, i) => ({ key: `k${i}`, visible: false, sort_order: i }))
    appMenuResult.value = { code: 0, data: { items } }
    const sidebar = await mountSidebar()

    expect(primaryKeys(sidebar)).toEqual([...DEFAULT_PRIMARY])
  })

  it('data 结构非法（items 非数组）→ 降级为默认菜单', async () => {
    appMenuResult.value = { code: 0, data: { items: 'nope' } }
    const sidebar = await mountSidebar()

    expect(primaryKeys(sidebar)).toEqual([...DEFAULT_PRIMARY])
  })

  // 回归 2026-09-25：菜单此前只在 onMounted 拉取一次，运营中心改完必须重启应用才可见。
  it('运营配置变更事件到达 → 免重启重拉并更新一级导航', async () => {
    appMenuResult.value = { code: 0, data: null }
    const sidebar = await mountSidebar()

    expect(appMenuListener.cb).toBeTypeOf('function')
    expect(primaryKeys(sidebar)).toEqual([...DEFAULT_PRIMARY])

    appMenuResult.value = {
      code: 0,
      data: {
        items: [
          { key: 'home', visible: false, sort_order: 0 },
          { key: 'dashboard', visible: false, sort_order: 1 },
        ],
      },
    }
    await appMenuListener.cb({ syncedAt: 'server-t' })
    await flushPromises()
    await flushPromises()

    const keys = primaryKeys(sidebar)
    expect(keys).not.toContain('home')
    expect(keys).not.toContain('dashboard')
    // 未涉及的项不受影响（重拉是整体替换，不是增量 patch）
    expect(keys).toContain('copy-library')
    expect(keys).toContain('rewrite')
  })

  it('重拉失败（IPC 报错）→ 保留上一次可用配置，不清空菜单', async () => {
    appMenuResult.value = {
      code: 0,
      data: { items: [{ key: 'dashboard', visible: false, sort_order: 1 }] },
    }
    const sidebar = await mountSidebar()
    expect(primaryKeys(sidebar)).not.toContain('dashboard')

    appMenuResult.value = { code: -1, message: '无法连接 Ops Center', data: null }
    await appMenuListener.cb({})
    await flushPromises()
    await flushPromises()

    expect(primaryKeys(sidebar)).not.toContain('dashboard')
  })

  it('卸载时取消订阅，不残留重复监听', async () => {
    await mountSidebar()
    expect(appMenuListener.cb).toBeTypeOf('function')

    wrapper.unmount()
    wrapper = null
    expect(appMenuListener.cb).toBeNull()
  })
})
