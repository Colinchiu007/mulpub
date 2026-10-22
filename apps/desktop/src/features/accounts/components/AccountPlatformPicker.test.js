/**
 * AccountPlatformPicker —— 账号页「添加账号」弹窗的平台选择器（自绘浮层）
 *
 * 这个组件存在的理由：原生 <select> 展开后由操作系统绘制，CSS 无法介入，
 * 于是「把下拉调精致」这条路在原生控件上走不通。改成应用内自绘后，
 * 图标 / 搜索 / 分组 / 动效 / 键盘才全部可控。设计见
 * 01-docs/PRD-ACCOUNT-PLATFORM-PICKER-UX-2026-10-21.md。
 *
 * 本文件锁的是**行为契约**（展开收起、过滤、分组、键盘、焦点回收），
 * 视觉规格由 PRD §4 承载，视觉回归由 all-workflows.visual.test.js 承载。
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'
import { nextTick } from 'vue'

// 平台目录 store 走 IPC；本用例只关心"分类分组"这一层，把 IPC 源替换成空结果。
const getPlatformDefinitions = vi.hoisted(() => vi.fn(() => Promise.resolve({ code: -1 })))
vi.mock('@/api/publisher', () => ({ getPlatformDefinitions }))

import AccountPlatformPicker from './AccountPlatformPicker.vue'
import { usePlatformStore } from '@/stores/platforms'

const PLATFORMS = [
  { id: 'wechat_mp', label: '微信公众号' },
  { id: 'douyin', label: '抖音' },
  { id: 'xiaohongshu', label: '小红书' },
  { id: 'youtube', label: 'YouTube' },
  { id: 'twitter', label: 'Twitter/X' },
]

const DOMESTIC = ['wechat_mp', 'douyin', 'xiaohongshu']
const INTERNATIONAL = ['youtube', 'twitter']

const ARIA_LABELS = {
  trigger: '选择平台',
  search: '按平台名称搜索',
  clearSearch: '清空搜索',
  list: '平台列表',
  option: (label) => `选择平台 ${label}`,
}

let wrapper = null

function mountPicker (props = {}) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const store = usePlatformStore()
  store.categories = {
    wechat_mp: '中文',
    douyin: '中文',
    xiaohongshu: '中文',
    youtube: '海外',
    twitter: '海外',
  }
  wrapper = mount(AccountPlatformPicker, {
    props: {
      modelValue: '',
      platforms: PLATFORMS,
      placeholder: '请选择平台',
      searchPlaceholder: '搜索平台',
      emptyText: '未找到匹配的平台',
      noPlatformsText: '暂无可选平台',
      hint: '↑↓ 选择 · Enter 确认 · Esc 关闭',
      groupLabels: { domestic: '国内平台', international: '国际平台' },
      ariaLabels: ARIA_LABELS,
      ...props,
    },
    global: { plugins: [pinia] },
    attachTo: document.body,
  })
  return wrapper
}

/** 等 Vue 把 DOM 变更（渲染 + Transition 离场）落定。 */
async function flush () {
  await nextTick()
  await nextTick()
  await nextTick()
}

const popup = () => document.querySelector('[data-testid="platform-picker-popup"]')
const options = () => Array.from(document.querySelectorAll('[role="option"]'))
const searchInput = () => document.querySelector('[data-testid="platform-picker-search"]')

async function typeIn (el, value) {
  el.value = value
  el.dispatchEvent(new Event('input', { bubbles: true }))
  await flush()
}

async function press (el, key) {
  el.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }))
  await flush()
}

describe('AccountPlatformPicker', () => {
  beforeEach(() => {
    // 清空挂载残留用 replaceChildren() 而不是 innerHTML = ''：
    // CCG 安全扫描把直接 innerHTML 赋值判为高危 XSS（新文件整份都算本次改动，
    // 存量过滤救不了）。同仓先例见 RewriteView.output-truncated.test.js。
    document.body.replaceChildren()
  })

  afterEach(() => {
    if (wrapper) {
      wrapper.unmount()
      wrapper = null
    }
    document.body.replaceChildren()
  })

  it('未选中时触发器显示占位文案且不渲染平台图标', () => {
    const w = mountPicker()
    const trigger = w.get('[data-testid="platform-picker-trigger"]')
    expect(trigger.text()).toContain('请选择平台')
    expect(trigger.find('.pi').exists()).toBe(false)
    expect(trigger.attributes('aria-expanded')).toBe('false')
  })

  it('已选中时触发器同时显示平台图标与平台名', () => {
    const w = mountPicker({ modelValue: 'douyin' })
    const trigger = w.get('[data-testid="platform-picker-trigger"]')
    expect(trigger.text()).toContain('抖音')
    expect(trigger.find('.pi').exists()).toBe(true)
  })

  it('点击触发器展开浮层，按国内/海外分组列出全部平台', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    expect(popup()).not.toBeNull()
    expect(w.get('[data-testid="platform-picker-trigger"]').attributes('aria-expanded')).toBe('true')
    expect(options().map((el) => el.dataset.testid)).toEqual([
      'platform-picker-option-wechat_mp',
      'platform-picker-option-douyin',
      'platform-picker-option-xiaohongshu',
      'platform-picker-option-youtube',
      'platform-picker-option-twitter',
    ])
    expect(document.querySelector('[data-testid="platform-picker-group-domestic"]')).not.toBeNull()
    expect(document.querySelector('[data-testid="platform-picker-group-international"]')).not.toBeNull()
  })

  it('过滤后为空的一组整组不渲染（不留空标题）', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()
    await typeIn(searchInput(), 'youtube')

    expect(document.querySelector('[data-testid="platform-picker-group-domestic"]')).toBeNull()
    expect(document.querySelector('[data-testid="platform-picker-group-international"]')).not.toBeNull()
    expect(options().length).toBe(1)
  })

  it('搜索按平台显示名过滤', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()
    await typeIn(searchInput(), '抖')

    expect(options().length).toBe(1)
    expect(options()[0].textContent).toContain('抖音')
  })

  it('搜索按平台 id 过滤且大小写不敏感', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()
    // 混合大小写的 id 子串：小红书的显示名里没有这段字母，命中即证明走的是 id 匹配
    await typeIn(searchInput(), 'XiaoHongShu')

    expect(options().length).toBe(1)
    expect(options()[0].textContent).toContain('小红书')
  })

  it('纯空格输入等价于空输入（不过滤掉任何平台）', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()
    await typeIn(searchInput(), '   ')

    expect(options().length).toBe(PLATFORMS.length)
  })

  it('搜索无结果时显示空态文案', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()
    await typeIn(searchInput(), 'zzz-not-a-platform')

    const empty = document.querySelector('[data-testid="platform-picker-empty"]')
    expect(empty).not.toBeNull()
    expect(empty.textContent).toContain('未找到匹配的平台')
    expect(options().length).toBe(0)
  })

  it('平台目录为空时显示「暂无可选平台」空态', async () => {
    const w = mountPicker({ platforms: [] })
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    const empty = document.querySelector('[data-testid="platform-picker-empty"]')
    expect(empty).not.toBeNull()
    expect(empty.textContent).toContain('暂无可选平台')
  })

  it('点击选项发出 update:modelValue 并收起浮层', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    document.querySelector('[data-testid="platform-picker-option-douyin"]').click()
    await flush()

    expect(w.emitted('update:modelValue')?.[0]).toEqual(['douyin'])
    expect(w.get('[data-testid="platform-picker-trigger"]').attributes('aria-expanded')).toBe('false')
  })

  it('已选项在列表中带勾选态', async () => {
    mountPicker({ modelValue: 'douyin' })
    await wrapper.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    const selected = document.querySelector('[data-testid="platform-picker-option-douyin"]')
    expect(selected.getAttribute('aria-selected')).toBe('true')
    expect(selected.className).toContain('is-selected')
    expect(selected.querySelector('.mp-platform-picker-option-check')).not.toBeNull()
  })

  it('触发器 ArrowDown 打开浮层并激活第一项，Enter 选中该项', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('keydown', { key: 'ArrowDown' })
    await flush()

    expect(options()[0].className).toContain('is-active')
    await press(searchInput(), 'Enter')
    expect(w.emitted('update:modelValue')?.[0]).toEqual(['wechat_mp'])
  })

  it('触发器 ArrowUp 打开浮层并激活最后一项', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('keydown', { key: 'ArrowUp' })
    await flush()

    expect(options()[options().length - 1].className).toContain('is-active')
  })

  it('搜索框内上下键在选项之间移动激活项且到边界不循环', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    // 鼠标点开时没有预置激活项（避免"鼠标并不在那儿却像被悬停"的幽灵高亮），
    // 所以第一次 ArrowDown 落到首项，第二次才前进一位。
    await press(searchInput(), 'ArrowDown')
    expect(options()[0].className).toContain('is-active')
    await press(searchInput(), 'ArrowDown')
    expect(options()[1].className).toContain('is-active')
    await press(searchInput(), 'ArrowUp')
    expect(options()[0].className).toContain('is-active')
    // 已在首项，再按 ArrowUp 不应回绕到末项
    await press(searchInput(), 'ArrowUp')
    expect(options()[0].className).toContain('is-active')
  })

  it('浮层打开后搜索框自动获得焦点（键盘用户的第一意图是"找平台"）', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    expect(document.activeElement).toBe(searchInput())
  })

  it('鼠标点开浮层时不预置激活项（无幽灵高亮）', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    expect(options().filter((el) => el.className.includes('is-active')).length).toBe(0)
  })

  it('鼠标点开浮层时激活项落在当前已选平台上（让用户看到"我现在在哪个平台"）', async () => {
    const w = mountPicker({ modelValue: 'douyin' })
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    const active = options().find((el) => el.className.includes('is-active'))
    expect(active?.dataset.testid).toBe('platform-picker-option-douyin')
  })

  it('Esc 关闭浮层', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()
    expect(popup()).not.toBeNull()

    await press(searchInput(), 'Escape')
    expect(w.get('[data-testid="platform-picker-trigger"]').attributes('aria-expanded')).toBe('false')
  })

  it('点击浮层外部关闭浮层', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    document.body.dispatchEvent(new Event('pointerdown', { bubbles: true }))
    await flush()
    expect(w.get('[data-testid="platform-picker-trigger"]').attributes('aria-expanded')).toBe('false')
  })

  it('关闭浮层后焦点回到触发器', async () => {
    const w = mountPicker()
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()
    await press(searchInput(), 'Escape')

    expect(document.activeElement).toBe(w.get('[data-testid="platform-picker-trigger"]').element)
  })

  it('重复平台 id 只渲染一次', async () => {
    const w = mountPicker({
      platforms: [
        { id: 'douyin', label: '抖音' },
        { id: 'douyin', label: '抖音（重复）' },
      ],
    })
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    expect(options().length).toBe(1)
    expect(options()[0].textContent).toContain('抖音')
    expect(options()[0].textContent).not.toContain('重复')
  })

  it('平台缺少显示名时回退为平台 id', async () => {
    const w = mountPicker({ platforms: [{ id: 'mystery_platform' }] })
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    expect(options().length).toBe(1)
    expect(options()[0].textContent).toContain('mystery_platform')
  })

  it('平台 id 含 CSS 选择器非法字符时，键盘移动仍能定位到该项（不被选择器解析卡住）', async () => {
    // 平台 id 来自平台目录，理论上可以含 `:` / `.` 这类在 CSS 选择器里非法或语义不同的字符。
    // 旧实现把 id 拼进 querySelector('#'+id) ⇒ 遇到 `:` 直接抛 SyntaxError（QM-6 第二轮 i4）。
    const w = mountPicker({ platforms: [{ id: 'weird:id', label: '带冒号平台' }] })
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    const el = document.querySelector('[data-testid="platform-picker-option-weird:id"]')
    expect(el).not.toBeNull()
    el.scrollIntoView = vi.fn()

    await press(searchInput(), 'ArrowDown')

    expect(options()[0].className).toContain('is-active')
    expect(el.scrollIntoView).toHaveBeenCalled()
  })

  it('禁用态下点击不展开浮层', async () => {
    const w = mountPicker({ disabled: true })
    await w.get('[data-testid="platform-picker-trigger"]').trigger('click')
    await flush()

    expect(popup()).toBeNull()
    expect(w.get('[data-testid="platform-picker-trigger"]').attributes('disabled')).toBe('')
  })
})
