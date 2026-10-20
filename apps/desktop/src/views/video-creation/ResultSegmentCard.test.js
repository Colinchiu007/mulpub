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
const mountCard = (segment, props = {}) => mount(ResultSegmentCard, {
  props: { segment, absoluteIndex: 0, totalCount: 3, ...props },
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
