import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick, reactive } from 'vue'

import zh from '@/locales/zh'
import ResultSegmentCard from './ResultSegmentCard.vue'

// 宿主侧行为锁（QM-6 审查项 A1/A3/A6）：
//   A1 —— 宿主 refreshSegmentImageUrls() 原地刷新 URL 后，卡片必须显示新值；
//   A3 —— 全量下标（absoluteIndex）驱动上移/下移/删除/导出命名，分批后不指错段；
//   A6 —— 素材 URL 失效时清本地 URL 并 emit 不可用标记，保留来源路径。
//
// 注意：宿主的 segments 是 Vue **reactive** 数组，元素是响应式对象；测试必须用
// reactive() 包裹才复现真实场景（普通对象上改属性不触发子组件重渲染）。
//
// 2026-10-19 起卡片编辑主体默认折叠，而本文件既有用例断言的都是主体内的控件
// （textarea / 下载按钮 / 字幕输入等）。为了让这些「主体行为」用例保持只测行为、
// 不被折叠开关干扰，helper 默认按展开态挂载；折叠态本身由末尾专门的一组用例断言。
const mountCard = (segment, props = {}) => mount(ResultSegmentCard, {
  props: { segment, absoluteIndex: 0, totalCount: 3, expanded: true, ...props },
  global: {
    mocks: {
      $t: (key, params) => {
        if (key.startsWith('story2video.sceneMaterial.')) {
          const localized = zh.story2video.sceneMaterial[key.slice('story2video.sceneMaterial.'.length)]
          if (typeof localized === 'string') return localized.replace(/\{label\}/g, params?.label || '')
        }
        if (key.startsWith('story2video.segmentStatus.')) {
          return zh.story2video.segmentStatus[key.slice('story2video.segmentStatus.'.length)] || key
        }
        return key
      },
    },
  },
})

describe('ResultSegmentCard：宿主刷新同步与全量下标（QM-6 审查项 A1/A3/A6）', () => {
  beforeEach(() => { vi.clearAllMocks() })

  it('A1：宿主原地刷新 imageUrl 后卡片显示新 URL', async () => {
    const segment = reactive({ id: 's1', imagePath: 'C:/a.png', imageUrl: 'media://old', status: 'completed' })
    const w = mountCard(segment)
    expect(w.find('img').attributes('src')).toBe('media://old')

    // 宿主 refreshSegmentImageUrls 的写法：原地改属性（保存/重试/重新合成后）
    segment.imageUrl = 'media://new'
    await nextTick()
    await nextTick()

    expect(w.find('img').attributes('src')).toBe('media://new')
    w.unmount()
  })

  it('A1b：宿主整体替换 segment 对象后卡片跟上新内容', async () => {
    const segment = { id: 's1', text: '旧文案', status: 'completed' }
    const w = mountCard(segment)
    expect(w.find('textarea').element.value).toBe('旧文案')

    await w.setProps({ segment: { id: 's1', text: '新文案', status: 'completed' } })
    await nextTick()

    expect(w.find('textarea').element.value).toBe('新文案')
    w.unmount()
  })

  it('A1c：编辑文案 emit dirty，且写入宿主传入的同一对象（供 update-segments 落盘）', async () => {
    const segment = reactive({ id: 's1', text: '原文', status: 'completed' })
    const w = mountCard(segment)

    await w.find('textarea').setValue('改过的文案')
    await nextTick()

    expect(w.emitted('dirty')).toBeTruthy()
    // 卡片把编辑写回宿主对象：宿主随后经 story2video:update-segments 落盘
    expect(segment.text).toBe('改过的文案')
    w.unmount()
  })

  it('A1d：编辑后宿主刷新媒体 URL，未保存的编辑值不得被冲掉', async () => {
    // 浅拷贝方案的第二个缺陷（QM-6 审查项 A1 指出）：宿主任意 URL 刷新都会用 {...next}
    // 把用户未保存的编辑值冲掉。getter 直接返回 prop 的方案天然规避，此处锁住该契约。
    const segment = reactive({ id: 's1', text: '原文', imageUrl: 'media://old', status: 'completed' })
    const w = mountCard(segment)

    await w.find('textarea').setValue('用户正在改的文案')
    await nextTick()
    expect(segment.text).toBe('用户正在改的文案')

    // 宿主刷新媒体 URL（保存/重试/重新合成后的 refreshSegmentImageUrls 行为）
    segment.imageUrl = 'media://new'
    await nextTick()
    await nextTick()

    // 编辑值保留、URL 更新——两者互不覆盖
    expect(segment.text).toBe('用户正在改的文案')
    expect(w.find('textarea').element.value).toBe('用户正在改的文案')
    expect(w.find('img').attributes('src')).toBe('media://new')
    w.unmount()
  })

  it('A3：absoluteIndex 驱动导出命名与上移禁用（分批后不指错段）', async () => {
    const segment = { id: 's149', imagePath: 'C:/x.png', audioPath: 'C:/x.mp3', videoPath: 'C:/x.mp4', status: 'completed' }
    const w = mountCard(segment, { absoluteIndex: 148, totalCount: 169 })

    await w.findAll('.segment-actions button')[0].trigger('click')
    const emitted = w.emitted('download-artifact')
    expect(emitted).toBeTruthy()
    // segment-149-image.png（1-based、三位补零）
    expect(emitted[0][1]).toBe('segment-149-image.png')

    // 非首段：上移可用
    expect(w.find('.segment-order button').attributes('disabled')).toBeUndefined()
    await w.setProps({ absoluteIndex: 0 })
    await nextTick()
    expect(w.find('.segment-order button').attributes('disabled')).toBeDefined()
    w.unmount()
  })

  it('A6：素材 URL 失效时清本地 URL 并 emit 不可用标记（保留来源路径）', async () => {
    const segment = reactive({ id: 's1', imagePath: 'C:/a.png', imageUrl: 'media://broken', status: 'completed' })
    const w = mountCard(segment)

    w.vm.clearSegmentImageUrl(segment)
    await nextTick()

    const emitted = w.emitted('mark-material-unavailable')
    expect(emitted).toBeTruthy()
    expect(emitted[0][0].imagePath).toBe('C:/a.png')
    expect(emitted[0][0].imageUrl).toBeNull()
    expect(emitted[0][1]).toBe('image1')
    // 来源路径保留：重新生成/后续刷新可恢复
    expect(w.vm.segment.imagePath).toBe('C:/a.png')
    w.unmount()
  })

  it('空素材显示未生成占位且不渲染 img', async () => {
    const segment = { id: 's1', status: 'completed' }
    const w = mountCard(segment)

    expect(w.find('[data-testid="segment-image-preview"]').text()).toContain('未生成')
    expect(w.find('img').exists()).toBe(false)
    w.unmount()
  })
})

// ==================== 提示词区（2026-10-19）：图片/视频提示词 + 中文翻译成对展示 ====================
describe('ResultSegmentCard：提示词与翻译成对 + 编辑主体折叠', () => {
  beforeEach(() => { vi.clearAllMocks() })

  const promptSegment = (overrides = {}) => ({
    id: 's1',
    text: '旁白一',
    status: 'completed',
    prompt: 'A red apple',
    promptTranslation: '一个红苹果',
    videoPrompt: 'Cinematic shot of a red apple',
    videoPromptTranslation: '红苹果的电影镜头',
    ...overrides,
  })

  it('图片翻译块紧跟图片提示词、视频翻译块紧跟视频提示词（DOM 顺序成对）', async () => {
    const w = mountCard(promptSegment())

    const imageBlock = w.find('[data-testid="segment-prompt-translation"]')
    const videoBlock = w.find('[data-testid="segment-video-prompt-translation"]')
    expect(imageBlock.exists()).toBe(true)
    expect(videoBlock.exists()).toBe(true)
    expect(imageBlock.text()).toContain('一个红苹果')
    expect(videoBlock.text()).toContain('红苹果的电影镜头')

    // 两个 textarea 与各自翻译块的相对顺序：提示词在前、翻译紧随其后
    const textareas = w.findAll('textarea')
    const imageTextarea = textareas[0]
    const videoTextarea = w.find('[data-testid="segment-video-prompt-textarea"]')
    expect(videoTextarea.element.compareDocumentPosition(imageTextarea.element) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    expect(videoBlock.element.compareDocumentPosition(videoTextarea.element) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    // 视频翻译块必须在图片翻译块之后（先图片后视频，与提示词顺序一致）
    expect(videoBlock.element.compareDocumentPosition(imageBlock.element) & Node.DOCUMENT_POSITION_PRECEDING).toBeTruthy()
    w.unmount()
  })

  it('无译文时两个翻译块都走占位文案而非空块', async () => {
    const w = mountCard(promptSegment({ promptTranslation: null, videoPromptTranslation: null }))

    expect(w.find('[data-testid="segment-prompt-translation"]').text()).toContain('未生成')
    expect(w.find('[data-testid="segment-video-prompt-translation"]').text()).toContain('未生成')
    w.unmount()
  })

  it('en 界面不展示视频提示词翻译（与图片侧同一判据）', async () => {
    const i18n = (await import('@/i18n')).default
    const previous = i18n.global.locale.value
    const w = mountCard(promptSegment())
    i18n.global.locale.value = 'en'
    try {
      await nextTick()
      expect(w.vm.showVideoPromptTranslation).toBe(false)
      expect(w.vm.showPromptTranslation).toBe(false)
    } finally {
      i18n.global.locale.value = previous || 'zh'
    }
    w.unmount()
  })

  it('默认折叠：不渲染编辑主体，只留头部与素材区', () => {
    const w = mountCard(promptSegment(), { expanded: false })

    expect(w.find('[data-testid="segment-prompt-editor"]').exists()).toBe(false)
    // 素材区属于扫读信息，折叠态仍可见
    expect(w.find('[data-testid="scene-material-section"]').exists()).toBe(true)
    expect(w.find('[data-testid="segment-image-preview"]').exists()).toBe(true)
    const toggle = w.find('[data-testid="segment-editor-toggle"]')
    expect(toggle.exists()).toBe(true)
    expect(toggle.attributes('aria-expanded')).toBe('false')
    w.unmount()
  })

  it('展开态渲染编辑主体，aria-expanded=true，点击上抛 toggle-editor', async () => {
    const w = mountCard(promptSegment(), { expanded: true })

    expect(w.find('[data-testid="segment-prompt-editor"]').exists()).toBe(true)
    const toggle = w.find('[data-testid="segment-editor-toggle"]')
    expect(toggle.attributes('aria-expanded')).toBe('true')
    await toggle.trigger('click')
    expect(w.emitted('toggle-editor')[0]).toEqual(['s1'])
    w.unmount()
  })
})
