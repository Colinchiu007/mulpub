// @ts-nocheck
// 运营公告横幅（阶段 1.2 / audit-6）。
// 两条主线：① 文案全部走 locales（zh/en 成对，Gate 7）；② 把自己的高度上报出去，
// 因为内嵌 WebContentsView 是原生图层，不下移就会把横幅整块盖住。
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, ref } from 'vue'
import i18n from '@/i18n'

var announcements = ref([])

vi.mock('@/composables/useOpsCenterRuntime', () => ({
  useOpsCenterRuntime: () => ({
    announcements,
    loadRuntime: vi.fn().mockResolvedValue({ code: 0, data: {} }),
  }),
}))

import AnnouncementBanner from './AnnouncementBanner.vue'

const BANNER_HEIGHT = 56

function mountBanner () {
  return mount(AnnouncementBanner, { global: { plugins: [i18n] } })
}

describe('AnnouncementBanner', () => {
  beforeEach(() => {
    i18n.global.locale.value = 'zh'
    localStorage.clear()
    announcements.value = []
    // jsdom 的 offsetHeight 恒为 0，会让"上报高度"这条主线在测试里永远报 0（假绿/假红都可能）。
    // 这里给原型装一个固定读数，使断言量的是"上报动作与其值来自测量"，而不是量 jsdom 的沉默。
    Object.defineProperty(HTMLElement.prototype, 'offsetHeight', {
      configurable: true,
      get () { return this.classList && this.classList.contains('announcement-banners') ? BANNER_HEIGHT : 0 },
    })
  })

  it('无公告时整块不渲染，也不占用顶部下移', async () => {
    const w = mountBanner()
    await nextTick()
    expect(w.find('[data-testid="announcement-banners"]').exists()).toBe(false)
    expect(w.emitted('inset').at(-1)).toEqual([0])
  })

  it('有公告时渲染 region 语义并上报实测高度', async () => {
    announcements.value = [{ id: 'a1', title: '维护通知', content: '今晚 22:00 停机', severity: 'maintenance' }]
    const w = mountBanner()
    await nextTick()
    const root = w.get('[data-testid="announcement-banners"]')
    expect(root.attributes('role')).toBe('region')
    expect(root.text()).toContain('维护通知')
    expect(root.text()).toContain('今晚 22:00 停机')
    expect(w.emitted('inset').at(-1)).toEqual([BANNER_HEIGHT])
  })

  it('徽标文案取 locales，不是组件里的中文字面量（切 en 必须跟着变）', async () => {
    announcements.value = [{ id: 'a2', title: 't', severity: 'warning' }]
    const w = mountBanner()
    expect(w.get('.ann-badge').text()).toBe(i18n.global.t('announcement.severityWarning'))
    i18n.global.locale.value = 'en'
    await nextTick()
    expect(w.get('.ann-badge').text()).toBe('Important')
  })

  it('未知 severity 如实回落「提示」档，不硬凑成维护/重要', async () => {
    announcements.value = [{ id: 'a3', title: 't', severity: 'alien' }]
    const w = mountBanner()
    expect(w.get('.ann-badge').text()).toBe(i18n.global.t('announcement.severityInfo'))
  })

  it('维护类公告不给关闭按钮（系统维护不是可忽略的打扰）', async () => {
    announcements.value = [{ id: 'a4', title: 't', severity: 'maintenance' }]
    const w = mountBanner()
    expect(w.find('.ann-close').exists()).toBe(false)
  })

  it('关闭后该条不再出现，并再次上报高度 0；压制记录落 localStorage', async () => {
    announcements.value = [{ id: 'a5', title: 't', severity: 'info' }]
    const w = mountBanner()
    await nextTick()
    expect(w.find('.ann-close').exists()).toBe(true)
    await w.get('.ann-close').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="announcement-banners"]').exists()).toBe(false)
    expect(w.emitted('inset').at(-1)).toEqual([0])
    expect(localStorage.getItem('announcement-banner-dismissed')).toContain('id:a5')
  })

  it('无 id 的旧数据按内容摘要去重，不得因缺 id 而关不掉', async () => {
    announcements.value = [{ title: '老公告', content: '正文', severity: 'info' }]
    const w = mountBanner()
    await w.get('.ann-close').trigger('click')
    await nextTick()
    expect(w.find('[data-testid="announcement-banners"]').exists()).toBe(false)
  })

  it('卸载必须把下移还回 0（残留挂起计数＝内容区永久错位）', async () => {
    announcements.value = [{ id: 'a6', title: 't', severity: 'info' }]
    const w = mountBanner()
    await nextTick()
    w.unmount()
    const events = w.emitted('inset')
    expect(events.at(-1)).toEqual([0])
  })

  it('读压制记录失败不得让横幅整块不渲染', async () => {
    const spy = vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('quota') })
    announcements.value = [{ id: 'a7', title: 't', severity: 'info' }]
    const w = mountBanner()
    await nextTick()
    expect(w.find('[data-testid="announcement-banners"]').exists()).toBe(true)
    spy.mockRestore()
  })
})
