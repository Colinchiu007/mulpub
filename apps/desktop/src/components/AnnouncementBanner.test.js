/**
 * AnnouncementBanner 行为合同（UX 审计阶段 1 · 单元 1.2）
 *
 * 背景：该组件此前**全仓零引用**（连一条测试都没有），运营中心下发的公告在界面上永远不可见。
 * 本文件做两件事：① 把"下发型 UI 必须有生产渲染方"变成机械可验（末尾的接线锁）；
 * ② 把组件既有的显示/交互语义钉住，防止接线时被顺手改写。
 *
 * 断言口径（AGENTS.md「渲染端测试断言 i18n 键而不是 locale 字面量」）：
 * `useI18n` 被 mock 成 `t(key) => key`，所以这里比的是**键名**；
 * 键是否真的存在、zh/en 是否成对，由 `announcement-locale-pair.test.js` 单独锁。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { ref, nextTick } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (key) => key }),
}))

const runtime = vi.hoisted(() => ({
  announcements: null,
  loadRuntime: vi.fn(async () => ({ code: 0, data: { announcements: [] } })),
}))

vi.mock('@/composables/useOpsCenterRuntime', async (importOriginal) => {
  // SEVERITIES 必须原样保留：它是分档闭合词表，被组件真实消费。
  // 只在 mock 里造一个副本的话，"改了真源词表"这件事对本测试结构性隐形。
  const actual = await importOriginal()
  return {
    ...actual,
    useOpsCenterRuntime: () => ({
      announcements: runtime.announcements,
      loadRuntime: runtime.loadRuntime,
    }),
  }
})

import AnnouncementBanner from '@/components/AnnouncementBanner.vue'

const STORAGE_KEY = 'announcement-banner-dismissed'

function setAnnouncements (list) {
  runtime.announcements = ref(list)
}

function mountBanner () {
  return mount(AnnouncementBanner)
}

describe('AnnouncementBanner 显示合同', () => {
  beforeEach(() => {
    localStorage.clear()
    runtime.loadRuntime.mockClear()
    setAnnouncements([])
  })

  it('没有公告时不得渲染任何容器（含 landmark）', () => {
    const wrapper = mountBanner()
    expect(wrapper.find('.announcement-banners').exists()).toBe(false)
    expect(wrapper.find('[role="region"]').exists()).toBe(false)
    expect(wrapper.find('.ann-close').exists()).toBe(false)
    // 反向自证：这条判据不是恒真——有公告时必须渲染出 region
    setAnnouncements([{ id: 1, severity: 'info', title: 'A' }])
    const second = mountBanner()
    expect(second.find('[role="region"]').exists()).toBe(true)
  })

  it('挂载时向运营中心运行时拉取一次，不在组件里另起第二份拉取', () => {
    mountBanner()
    expect(runtime.loadRuntime).toHaveBeenCalledTimes(1)
  })

  it('三档 severity 各自落对应的样式类与标签键', () => {
    setAnnouncements([
      { id: 1, severity: 'info', title: 'I' },
      { id: 2, severity: 'warning', title: 'W' },
      { id: 3, severity: 'maintenance', title: 'M' },
    ])
    const wrapper = mountBanner()
    const badges = wrapper.findAll('.ann-badge').map((b) => b.text())
    expect(badges).toEqual([
      'announcement.severity.info',
      'announcement.severity.warning',
      'announcement.severity.maintenance',
    ])
    const classes = wrapper.findAll('.announcement-banner').map((n) => n.classes().join(' '))
    expect(classes).toEqual([
      'announcement-banner severity-info',
      'announcement-banner severity-warning',
      'announcement-banner severity-maintenance',
    ])
  })

  it('未知 severity 落 info 档且整条不得被丢弃', () => {
    setAnnouncements([{ id: 1, severity: 'critical', title: '严重故障' }])
    const wrapper = mountBanner()
    expect(wrapper.findAll('.announcement-banner')).toHaveLength(1)
    expect(wrapper.find('.severity-info').exists()).toBe(true)
    expect(wrapper.find('.ann-badge').text()).toBe('announcement.severity.info')
  })

  it('severity 缺失同样落 info 档', () => {
    setAnnouncements([{ id: 1, title: '无档' }])
    const wrapper = mountBanner()
    expect(wrapper.find('.severity-info').exists()).toBe(true)
  })

  it('content 缺席时不得渲染空容器', () => {
    setAnnouncements([
      { id: 1, severity: 'info', title: '只有标题' },
      { id: 2, severity: 'info', title: '有正文', content: '正文' },
    ])
    const wrapper = mountBanner()
    expect(wrapper.findAll('.ann-content')).toHaveLength(1)
    expect(wrapper.findAll('.ann-content')[0].text()).toBe('正文')
  })

  it('维护公告不得提供关闭按钮，info/warning 可以关', () => {
    setAnnouncements([
      { id: 1, severity: 'info', title: 'I' },
      { id: 2, severity: 'maintenance', title: 'M' },
    ])
    const wrapper = mountBanner()
    expect(wrapper.findAll('.ann-close')).toHaveLength(1)
    expect(wrapper.find('.severity-maintenance .ann-close').exists()).toBe(false)
  })

  it('关闭按钮与区域必须有可访问名，且来自 locale 键', () => {
    setAnnouncements([{ id: 1, severity: 'info', title: 'I' }])
    const wrapper = mountBanner()
    expect(wrapper.find('[role="region"]').attributes('aria-label')).toBe('announcement.regionLabel')
    expect(wrapper.find('.ann-close').attributes('aria-label')).toBe('announcement.closeLabel')
  })
})

describe('AnnouncementBanner 关闭记忆', () => {
  beforeEach(() => {
    localStorage.clear()
    runtime.loadRuntime.mockClear()
    setAnnouncements([])
  })

  it('关闭后写入 localStorage，重挂载仍然只隐藏那一条', async () => {
    setAnnouncements([
      { id: 7, severity: 'info', title: 'A' },
      { id: 8, severity: 'warning', title: 'B' },
    ])
    const wrapper = mountBanner()
    await wrapper.findAll('.ann-close')[0].trigger('click')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(['id:7'])
    await nextTick()
    expect(wrapper.findAll('.ann-title').map((n) => n.text())).toEqual(['B'])

    setAnnouncements([
      { id: 7, severity: 'info', title: 'A' },
      { id: 8, severity: 'warning', title: 'B' },
    ])
    const second = mountBanner()
    expect(second.findAll('.ann-title').map((n) => n.text())).toEqual(['B'])
  })

  it('运营新增公告不得让已关闭项复活、也不得让新项消失（判据不得按下标）', async () => {
    setAnnouncements([
      { id: 7, severity: 'info', title: 'A' },
      { id: 8, severity: 'info', title: 'B' },
    ])
    const wrapper = mountBanner()
    await wrapper.findAll('.ann-close')[0].trigger('click')

    // 新公告排在最前 ⇒ 若记忆用的是下标，"关掉的第 0 项"现在指向 id:9，
    // 症状是 A 复活、B 消失——两个方向同时错。
    setAnnouncements([
      { id: 9, severity: 'info', title: 'NEW' },
      { id: 7, severity: 'info', title: 'A' },
      { id: 8, severity: 'info', title: 'B' },
    ])
    const second = mountBanner()
    expect(second.findAll('.ann-title').map((n) => n.text())).toEqual(['NEW', 'B'])
  })

  it('无 id 的旧数据按 severity+title+content 记忆，重启后命中同一键', async () => {
    setAnnouncements([{ severity: 'warning', title: '旧', content: '文' }])
    const wrapper = mountBanner()
    await wrapper.find('.ann-close').trigger('click')
    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(stored).toEqual(['warning:旧:文'])
    expect(wrapper.find('.announcement-banner').exists()).toBe(false)

    setAnnouncements([{ severity: 'warning', title: '旧', content: '文' }])
    const second = mountBanner()
    expect(second.find('.announcement-banner').exists()).toBe(false)
  })

  it('id=0 是合法 id，不得被"假值"判成缺失', async () => {
    setAnnouncements([{ id: 0, severity: 'info', title: '零号' }])
    const wrapper = mountBanner()
    await wrapper.find('.ann-close').trigger('click')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY))).toEqual(['id:0'])
  })

  it('localStorage 里是坏 JSON 时不得整块横幅消失（读失败按未关闭处理）', () => {
    localStorage.setItem(STORAGE_KEY, '{ not json')
    setAnnouncements([{ id: 1, severity: 'info', title: 'A' }])
    const wrapper = mountBanner()
    expect(wrapper.findAll('.announcement-banner')).toHaveLength(1)
  })
})
