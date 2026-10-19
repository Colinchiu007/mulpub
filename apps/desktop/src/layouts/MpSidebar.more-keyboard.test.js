/**
 * MpSidebar「更多」菜单键盘可达测试（UX 审计 audit-31 / 实施方案阶段 4.5，2026-10-19）
 *
 * 缺陷背景：菜单容器早就写了 `role="menu"`，但没有任何键盘行为——
 * 展开后焦点掉回 body，方向键无效，Esc 不收尾，Tab 走开后菜单还挂着。
 * `role="menu"` 的 ARIA 契约要求的是 **roving tabindex + 方向键**，
 * 而不是「Tab 逐个穿过每一项」。给了角色却不给该角色的操作方式，
 * 比不给角色更坏：读屏软件会 announce「菜单」并据此期待方向键可用。
 *
 * 契约（本文件逐条锁死）：
 * - 可见项中恰好一个 tabindex=0，其余 -1，且 0 落在那个「当前路由命中项」上
 * - 触发器的 aria-controls 必须等于菜单容器的 id（锚点配对，缺一即红）
 * - ArrowDown / ArrowUp 在可见项间**循环**移动焦点，roving 位随 focus 事件迁移
 * - Home / End 直达首项 / 末项
 * - Escape 收起并把焦点归还触发器；Tab 收起但不归还、不劫持走位
 * - 触发器上 ArrowDown 打开菜单并把焦点放到「命中项」（不是第一项）
 * - 焦点离开菜单与触发器 → 自动收起；落在触发器上 → 不收起
 *
 * 夹具口径：项的 key / 顺序 / 路由全部从**渲染结果**读出（不手抄 sidebar-menu 配置），
 * 否则运营中心一改菜单顺序，本文件就会把「测试自己的坐标过期」当成「产品坏了」。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import { mount } from '@vue/test-utils'
import { createPinia } from 'pinia'
import i18n from '@/i18n'

// jsdom 不提供 ResizeObserver。本文件必须 attachTo 到真实 document（否则 focus() 无效，
// 一整类「焦点是否落在该项上」的断言会恒读 body），而 attachTo 之后 onMounted 里的
// `document.querySelector('.mp-sidebar')` 才第一次取得到节点，于是走进 ResizeObserver 分支。
// 其余不 attach 的同组件测试永远碰不到这行，所以这个桩只属于本文件的运行环境，
// 不代表真实浏览器缺这个 API。
class ResizeObserverStub {
  observe () {}

  unobserve () {}

  disconnect () {}
}
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = ResizeObserverStub
}

const routeState = vi.hoisted(() => ({ path: '/accounts' }))
const invokeMock = vi.hoisted(() => vi.fn(async () => ({ code: 0, data: null })))

vi.mock('@/api/electron-bridge', () => ({
  invoke: invokeMock,
  invokePageManager: vi.fn(),
  on: vi.fn(() => () => {}),
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

let wrapper = null

function mountSidebar (path = '/accounts') {
  i18n.global.locale.value = 'zh'
  routeState.path = path
  // 必须挂到真实 document：jsdom 的 focus() 只对已连接元素生效，
  // 不 attachTo 会让「焦点是否落在该项上」这一整类断言恒为 document.body（假红或假绿都可能）。
  wrapper = mount(MpSidebar, {
    attachTo: document.body,
    global: {
      plugins: [i18n, createPinia()],
      stubs: {
        ProfileMenu: { template: '<div data-testid="profile-menu-stub" />' },
        UpgradeModal: { template: '<div data-testid="upgrade-modal-stub" />' },
        SidebarServiceStatus: { template: '<div />' },
        SidebarUpdateButton: { template: '<div />' },
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

function trigger (sidebar) {
  return sidebar.get('[data-testid="mp-primary-more"]')
}

function menu (sidebar) {
  return sidebar.get('[role="menu"]')
}

function moreItems (sidebar) {
  return sidebar.findAll('.mp-more-item')
}

/** 由渲染结果反推「key → 路由」表；本文件唯一的路由来源，禁止手抄配置 */
function itemPaths (sidebar) {
  return moreItems(sidebar).map((w) => ({
    key: w.attributes('data-testid').replace('mp-more-item-', ''),
    path: w.attributes('href'),
  }))
}

async function openByClick (sidebar) {
  await trigger(sidebar).trigger('click')
  await nextTick()
  return sidebar
}

function rovingIndexes (sidebar) {
  return moreItems(sidebar)
    .map((w, i) => (w.attributes('tabindex') === '0' ? i : -1))
    .filter((i) => i >= 0)
}

function activeElementKey () {
  const el = document.activeElement
  if (!el || !el.getAttribute) return null
  const tid = el.getAttribute('data-testid')
  return tid ? tid.replace('mp-more-item-', '') : null
}

/**
 * 展开一次菜单、读出「key + path」清单后立即卸载。
 * 本文件的夹具路由一律由此产生（而不是手抄 sidebar-menu 配置）：
 * 运营中心或 route-registry 改了菜单顺序时，写死的 key 会让判据变成「测试自己的坐标过期」，
 * 而这里读到的永远是当前渲染真值。用完必须自己 unmount —— 否则残留的 .mp-sidebar 节点
 * 会污染下一次 onMounted 的 document.querySelector。
 */
async function discoverMoreItems () {
  const probe = await openByClick(mountSidebar('/accounts'))
  const items = itemPaths(probe)
  probe.unmount()
  wrapper = null
  document.body.innerHTML = ''
  return items
}

beforeEach(() => {
  invokeMock.mockClear()
})

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  document.body.innerHTML = ''
})

describe('MpSidebar 更多菜单键盘可达（roving tabindex）', () => {
  it('夹具自证：more 组至少 3 项，且存在索引 >0 的项（否则回绕/起点两条判据失去判别力）', async () => {
    const items = await discoverMoreItems()
    expect(items.length).toBeGreaterThanOrEqual(3)
    expect(items[items.length - 1].path).not.toBe(items[0].path)
  })

  it('展开后恰好一个 tabindex=0，其余全部 -1', async () => {
    const sidebar = await openByClick(mountSidebar('/accounts'))
    const zeros = rovingIndexes(sidebar)
    expect(zeros).toHaveLength(1)
    for (const [i, w] of moreItems(sidebar).entries()) {
      expect(w.attributes('tabindex')).toBe(i === zeros[0] ? '0' : '-1')
    }
  })

  it('触发器 aria-controls 与菜单 id 配对（缺一即断链）', async () => {
    const sidebar = await openByClick(mountSidebar('/accounts'))
    const controls = trigger(sidebar).attributes('aria-controls')
    expect(controls).toBeTruthy()
    expect(menu(sidebar).attributes('id')).toBe(controls)
    expect(menu(sidebar).attributes('role')).toBe('menu')
    for (const w of moreItems(sidebar)) expect(w.attributes('role')).toBe('menuitem')
  })

  it('ArrowDown / ArrowUp 在可见项间循环移动焦点，且 roving 位随焦点迁移', async () => {
    const sidebar = await openByClick(mountSidebar('/accounts'))
    const total = moreItems(sidebar).length
    const start = rovingIndexes(sidebar)[0]

    await menu(sidebar).trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([(start + 1) % total])

    // 末位再按一次必须回到第 0 项（循环，不是停在末位）
    await menu(sidebar).trigger('keydown', { key: 'End' })
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([total - 1])
    await menu(sidebar).trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([0])

    // 首位再按一次必须回到末位
    await menu(sidebar).trigger('keydown', { key: 'ArrowUp' })
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([total - 1])
  })

  it('方向键真的把 DOM 焦点挪到目标项（不是只改内部索引）', async () => {
    const sidebar = await openByClick(mountSidebar('/accounts'))
    const start = rovingIndexes(sidebar)[0]
    const expectKey = itemPaths(sidebar)[(start + 1) % moreItems(sidebar).length].key

    await menu(sidebar).trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(document.activeElement.getAttribute('data-testid')).toBe(`mp-more-item-${expectKey}`)
    expect(activeElementKey()).toBe(expectKey)
  })

  it('Home / End 直达首项与末项', async () => {
    const sidebar = await openByClick(mountSidebar('/accounts'))
    const total = moreItems(sidebar).length

    await menu(sidebar).trigger('keydown', { key: 'End' })
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([total - 1])

    await menu(sidebar).trigger('keydown', { key: 'Home' })
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([0])
  })

  it('Escape 收起菜单并把焦点归还触发器', async () => {
    const sidebar = await openByClick(mountSidebar('/accounts'))
    // 先把焦点丢进菜单内部，模拟用户已在菜单里
    await menu(sidebar).trigger('keydown', { key: 'End' })
    await nextTick()
    expect(document.activeElement).not.toBe(trigger(sidebar).element)

    await menu(sidebar).trigger('keydown', { key: 'Escape' })
    await nextTick()
    expect(sidebar.find('[role="menu"]').exists()).toBe(false)
    expect(document.activeElement).toBe(trigger(sidebar).element)
    expect(trigger(sidebar).attributes('aria-expanded')).toBe('false')
  })

  it('Tab 收起菜单但不归还焦点（不劫持用户的自然走位）', async () => {
    const sidebar = await openByClick(mountSidebar('/accounts'))
    const before = document.activeElement

    await menu(sidebar).trigger('keydown', { key: 'Tab' })
    await nextTick()
    expect(sidebar.find('[role="menu"]').exists()).toBe(false)
    // Tab 语义是「继续往前走」：实现若把焦点抢回触发器，用户按一次 Tab 会退回原地
    expect(document.activeElement).toBe(before)
  })

  it('触发器上按 ArrowDown：打开菜单并把焦点放到当前命中项（非第一项）', async () => {
    // 取「最后一项」的路由当夹具：只要实现把起点写死成第 0 项，本用例必须红
    const items = await discoverMoreItems()
    const target = items[items.length - 1]
    const targetIndex = items.length - 1
    expect(targetIndex).toBeGreaterThan(0)

    const sidebar = mountSidebar(target.path)
    await nextTick()
    await trigger(sidebar).trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(menu(sidebar).exists()).toBe(true)
    expect(rovingIndexes(sidebar)).toEqual([targetIndex])
    expect(activeElementKey()).toBe(target.key)
  })

  it('路由不在 more 组时，起点回落到第一项', async () => {
    const sidebar = mountSidebar('/accounts')
    await trigger(sidebar).trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([0])
  })

  it('焦点移出菜单（非触发器）时自动收起；移到触发器时不收', async () => {
    const sidebar = await openByClick(mountSidebar('/accounts'))
    const menuEl = menu(sidebar).element

    // 移到触发器 → 必须还开着（否则键盘用户从菜单回到触发器就丢面板）
    dispatchFocusOut(menuEl, trigger(sidebar).element)
    await nextTick()
    expect(sidebar.find('[role="menu"]').exists()).toBe(true)

    // 移到菜单与触发器之外 → 收起
    const outside = document.createElement('button')
    document.body.appendChild(outside)
    dispatchFocusOut(menuEl, outside)
    await nextTick()
    expect(sidebar.find('[role="menu"]').exists()).toBe(false)
  })

  it('鼠标点/聚焦到别的项后，roving 位必须跟着焦点走（方向键不得从旧位跳走）', async () => {
    // 这条是变异 MK-2（摘掉 @focus 里的 roving 迁移）逼出来的：
    // 方向键路径上 focusMoreItem 自己会改索引，所以只测方向键**测不到**那条事件监听，
    // 而真实用户会先用鼠标点一项 —— 之后按方向键必须从「他刚点的那项」继续。
    const sidebar = await openByClick(mountSidebar('/accounts'))
    const total = moreItems(sidebar).length
    expect(total).toBeGreaterThanOrEqual(3)
    const targetIndex = 2

    moreItems(sidebar)[targetIndex].element.focus()
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([targetIndex])

    await menu(sidebar).trigger('keydown', { key: 'ArrowDown' })
    await nextTick()
    expect(rovingIndexes(sidebar)).toEqual([(targetIndex + 1) % total])
    expect(activeElementKey()).toBe(itemPaths(sidebar)[(targetIndex + 1) % total].key)
  })

  it('反复展开/收起后 roving tabindex 仍唯一（元素表不得残留已卸载项）', async () => {
    const sidebar = mountSidebar('/accounts')
    for (let round = 0; round < 3; round++) {
      await openByClick(sidebar)
      expect(rovingIndexes(sidebar)).toHaveLength(1)
      await menu(sidebar).trigger('keydown', { key: 'End' })
      await nextTick()
      await trigger(sidebar).trigger('click')
      await nextTick()
      expect(sidebar.find('[role="menu"]').exists()).toBe(false)
    }
    await openByClick(sidebar)
    // 上一轮停在末项；重新展开必须按「起点规则」重置，而不是沿用上次的残值
    expect(rovingIndexes(sidebar)).toEqual([0])
  })
})

/**
 * jsdom 的 VTU trigger 不能给 focusout 赋 relatedTarget（该属性在事件原型上是只读访问器），
 * 所以这里手工构造真 FocusEvent——否则「移到触发器不该收起」这一半判据根本无法表达。
 */
function dispatchFocusOut (target, relatedTarget) {
  const event = new FocusEvent('focusout', { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'relatedTarget', { value: relatedTarget })
  target.dispatchEvent(event)
}
