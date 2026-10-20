import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

import zh from '@/locales/zh'
import ResultSegmentEditor from './ResultSegmentEditor.vue'

// 分段编辑主体折叠（2026-10-19）
//
// 为什么放在编辑器层测：展开态是「同一时刻只展开一个」的**跨卡片约束**，状态必须由
// 编辑器统一持有；卡片只负责按 expanded 渲染 + 上抛 toggle-editor。若把状态放进卡片，
// 「互斥」就只能靠各卡片自觉，删除分段时也无法在同一处清掉指向已删 id 的残留。
const mountEditor = (segments, props = {}) => mount(ResultSegmentEditor, {
  props: {
    segments,
    renderedCount: segments.length,
    ...props,
  },
  global: {
    mocks: {
      $t: (key, params) => {
        if (key.startsWith('story2video.sceneMaterial.')) {
          const localized = zh.story2video.sceneMaterial[key.slice('story2video.sceneMaterial.'.length)]
          if (typeof localized === 'string') return localized.replace(/\{n\}/g, params?.n ?? '').replace(/\{label\}/g, params?.label || '')
        }
        if (key.startsWith('story2video.segmentStatus.')) {
          return zh.story2video.segmentStatus[key.slice('story2video.segmentStatus.'.length)] || key
        }
        return key
      },
    },
  },
})

const twoSegments = () => ([
  { id: 's1', text: '旁白一', prompt: 'A', promptTranslation: '甲', videoPrompt: 'VA', videoPromptTranslation: '视频甲', status: 'completed' },
  { id: 's2', text: '旁白二', prompt: 'B', promptTranslation: '乙', videoPrompt: 'VB', videoPromptTranslation: '视频乙', status: 'completed' },
])

describe('ResultSegmentEditor：分段编辑主体折叠（默认收起 + 展开互斥）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('默认全部折叠：每段都渲染开关，但没有任何编辑主体', () => {
    const w = mountEditor(twoSegments())

    const toggles = w.findAll('[data-testid="segment-editor-toggle"]')
    expect(toggles).toHaveLength(2)
    toggles.forEach(t => expect(t.attributes('aria-expanded')).toBe('false'))
    expect(w.findAll('[data-testid="segment-prompt-editor"]')).toHaveLength(0)
    // 折叠态仍保留素材区与缩略图（扫读信息不能被折叠吃掉）
    expect(w.findAll('[data-testid="scene-material-section"]')).toHaveLength(2)
    expect(w.findAll('[data-testid="segment-image-preview"]')).toHaveLength(2)
    w.unmount()
  })

  it('点开某段只展开该段', async () => {
    const w = mountEditor(twoSegments())

    await w.findAll('[data-testid="segment-editor-toggle"]')[0].trigger('click')
    await nextTick()

    expect(w.vm.expandedSegmentId).toBe('s1')
    expect(w.findAll('[data-testid="segment-prompt-editor"]')).toHaveLength(1)
    expect(w.findAll('[data-testid="segment-editor-toggle"]')[0].attributes('aria-expanded')).toBe('true')
    expect(w.findAll('[data-testid="segment-editor-toggle"]')[1].attributes('aria-expanded')).toBe('false')
    w.unmount()
  })

  it('展开态互斥：点开另一段会收起前一段（同一时刻只有一份表单）', async () => {
    const w = mountEditor(twoSegments())

    await w.findAll('[data-testid="segment-editor-toggle"]')[0].trigger('click')
    await nextTick()
    await w.findAll('[data-testid="segment-editor-toggle"]')[1].trigger('click')
    await nextTick()

    expect(w.vm.expandedSegmentId).toBe('s2')
    expect(w.findAll('[data-testid="segment-prompt-editor"]')).toHaveLength(1)
    w.unmount()
  })

  it('再次点开同一段即收起（开关幂等）', async () => {
    const w = mountEditor(twoSegments())

    await w.findAll('[data-testid="segment-editor-toggle"]')[0].trigger('click')
    await nextTick()
    expect(w.findAll('[data-testid="segment-prompt-editor"]')).toHaveLength(1)
    await w.findAll('[data-testid="segment-editor-toggle"]')[0].trigger('click')
    await nextTick()

    expect(w.vm.expandedSegmentId).toBe('')
    expect(w.findAll('[data-testid="segment-prompt-editor"]')).toHaveLength(0)
    w.unmount()
  })

  it('删除正在展开的分段会清空展开态（不残留指向已删 id 的状态）', async () => {
    const w = mountEditor(twoSegments())

    await w.findAll('[data-testid="segment-editor-toggle"]')[0].trigger('click')
    await nextTick()
    expect(w.vm.expandedSegmentId).toBe('s1')

    // 卡片头部的删除按钮：第一个卡片的第 3 个排序按钮
    await w.findAll('.segment-order button')[2].trigger('click')
    await nextTick()

    expect(w.vm.expandedSegmentId).toBe('')
    expect(w.emitted('remove-segment')[0]).toEqual([0])
    w.unmount()
  })
})
