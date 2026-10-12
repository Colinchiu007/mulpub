import { beforeEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'
import TopicTagManagerDialog from './TopicTagManagerDialog.vue'
import { STORAGE_KEY } from '@/features/publish/topic-tag-presets'

// 常用话题标签管理弹窗（topic-tag-unify，PRD §4.3）：
// 分组 / 搜索 / 全选本组 / 勾选计数 / 确定应用 / 持久化容错 / 浮层互斥 owner。

const suspend = vi.fn(async () => true)
const release = vi.fn(async () => true)

vi.mock('@/composables/useEmbeddedViewSuspension', () => ({
  suspendEmbeddedViewsForOverlay: (...args) => suspend(...args),
  releaseEmbeddedViewsForOverlay: (...args) => release(...args),
}))

function mountDialog (props = {}) {
  return mount(TopicTagManagerDialog, {
    props: { visible: true, ...props },
    global: { plugins: [i18n], stubs: { teleport: true } },
    attachTo: document.body,
  })
}

function seedStorage (groups) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, groups }))
}

describe('TopicTagManagerDialog', () => {
  beforeEach(() => {
    localStorage.clear()
    suspend.mockClear()
    release.mockClear()
  })

  it('打开时挂起内嵌视图，关闭（visible=false）与卸载时释放（浮层互斥合同）', async () => {
    const w = mountDialog()
    await w.vm.$nextTick()
    expect(suspend).toHaveBeenCalledWith('topic-tag-manager-dialog')

    await w.setProps({ visible: false })
    expect(release).toHaveBeenCalledWith('topic-tag-manager-dialog')

    // 卸载兜底：不再重复释放（owner 已释放则 release 幂等 no-op，但必须被调用过）
    w.unmount()
    expect(release.mock.calls.filter(c => c[0] === 'topic-tag-manager-dialog').length).toBeGreaterThanOrEqual(1)
  })

  it('渲染分组、话题 chips 与每组的全选本组复选框', async () => {
    seedStorage([
      { id: 'g1', name: '科技', topics: ['AI', '人工智能'] },
      { id: 'g2', name: '历史', topics: ['历史'] },
    ])
    const w = mountDialog()
    await w.vm.$nextTick()
    const text = w.text()
    expect(text).toContain('话题标签管理')
    expect(text).toContain('科技')
    expect(text).toContain('历史')
    expect(text).toContain('AI')
    expect(w.findAll('[data-testid="topic-tag-group"]').length).toBe(2)
    expect(w.findAll('[data-testid="topic-tag-group-select-all"]').length).toBe(2)
  })

  it('搜索按话题关键字过滤分组；无命中显示空态', async () => {
    seedStorage([
      { id: 'g1', name: '科技', topics: ['AI', '人工智能'] },
      { id: 'g2', name: '历史', topics: ['历史'] },
    ])
    const w = mountDialog()
    await w.vm.$nextTick()

    await w.get('[data-testid="topic-tag-search"]').setValue('AI')
    const names = w.findAll('[data-testid="topic-tag-group"]').map(g => g.text())
    expect(names.some(t => t.includes('科技'))).toBe(true)
    expect(names.some(t => t.includes('历史'))).toBe(false)

    await w.get('[data-testid="topic-tag-search"]').setValue('不存在的词')
    expect(w.text()).toContain('没有匹配的话题标签')
  })

  it('搜索按分组名过滤：命中组名显示该组全部话题', async () => {
    seedStorage([{ id: 'g1', name: '科技', topics: ['AI', '人工智能'] }])
    const w = mountDialog()
    await w.vm.$nextTick()

    await w.get('[data-testid="topic-tag-search"]').setValue('科技')
    // 组内两个话题 chip 都还在
    expect(w.findAll('[data-testid="topic-tag-chip"]').length).toBe(2)
  })

  it('勾选话题更新底部计数；确定应用发出选中的话题名并关闭', async () => {
    seedStorage([{ id: 'g1', name: '科技', topics: ['AI', '人工智能'] }])
    const w = mountDialog()
    await w.vm.$nextTick()

    const chips = w.findAll('[data-testid="topic-tag-chip"]')
    await chips[0].trigger('click')
    await chips[1].trigger('click')
    expect(w.text()).toContain('已选 2 个')

    await w.get('[data-testid="topic-tag-apply"]').trigger('click')
    const emitted = w.emitted('apply')
    expect(emitted).toBeTruthy()
    expect(emitted.at(-1)[0]).toEqual(['AI', '人工智能'])
    expect(w.emitted('close')).toBeTruthy()
  })

  it('全选本组一次选中整组；再次点击取消', async () => {
    seedStorage([{ id: 'g1', name: '科技', topics: ['AI', '人工智能'] }])
    const w = mountDialog()
    await w.vm.$nextTick()

    await w.get('[data-testid="topic-tag-group-select-all"]').trigger('click')
    expect(w.text()).toContain('已选 2 个')

    await w.get('[data-testid="topic-tag-group-select-all"]').trigger('click')
    expect(w.text()).toContain('已选 0 个')
  })

  it('选中的话题名经归一（剥 # 空白）再交给父层', async () => {
    seedStorage([{ id: 'g1', name: '科技', topics: [' #AI '] }])
    const w = mountDialog()
    await w.vm.$nextTick()

    await w.findAll('[data-testid="topic-tag-chip"]')[0].trigger('click')
    await w.get('[data-testid="topic-tag-apply"]').trigger('click')
    expect(w.emitted('apply').at(-1)[0]).toEqual(['AI'])
  })

  it('空存储显示引导空态；可新建分组并持久化', async () => {
    const w = mountDialog()
    await w.vm.$nextTick()
    expect(w.text()).toContain('还没有分组')

    await w.get('[data-testid="topic-tag-new-group"]').trigger('click')
    await w.get('[data-testid="topic-tag-new-group-input"]').setValue('我的分组')
    await w.get('[data-testid="topic-tag-new-group-confirm"]').trigger('click')

    const stored = JSON.parse(localStorage.getItem(STORAGE_KEY))
    expect(stored.groups).toHaveLength(1)
    expect(stored.groups[0].name).toBe('我的分组')
    expect(w.text()).toContain('我的分组')
  })

  it('新建同名分组被拒并提示', async () => {
    seedStorage([{ id: 'g1', name: '科技', topics: ['AI'] }])
    const w = mountDialog()
    await w.vm.$nextTick()

    await w.get('[data-testid="topic-tag-new-group"]').trigger('click')
    await w.get('[data-testid="topic-tag-new-group-input"]').setValue('科技')
    await w.get('[data-testid="topic-tag-new-group-confirm"]').trigger('click')

    expect(w.text()).toContain('已存在同名分组')
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)).groups).toHaveLength(1)
  })

  it('损坏存储不崩：按空数据处理并显示引导空态', async () => {
    localStorage.setItem(STORAGE_KEY, '{broken')
    const w = mountDialog()
    await w.vm.$nextTick()
    expect(w.text()).toContain('还没有分组')
  })
})
