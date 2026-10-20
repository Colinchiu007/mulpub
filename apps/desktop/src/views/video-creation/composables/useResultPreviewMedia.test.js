import { describe, it, expect } from 'vitest'

import zh from '@/locales/zh'
import en from '@/locales/en'

import {
  PREVIEW_LOADING_STATES,
  PREVIEW_PLACEHOLDER_KEYS,
  buildPreviewPlaceholder,
  resolveFirstPaintSegments,
  resolveSegmentMediaPlan,
  resolveSegmentRenderWindow,
  shouldRequestSegmentMedia,
  splitSegmentBatches,
} from './useResultPreviewMedia'

const segment = (overrides = {}) => ({
  id: 'seg-0',
  index: 0,
  status: 'completed',
  imagePath: null,
  audioPath: null,
  videoPath: null,
  videoMeta: null,
  alternateImages: [],
  ...overrides,
})

// 用真实 locale 树解析键：占位文案必须走 i18n 单一真源，composable 不得自带文案副本。
const translateWith = (tree) => (key) => {
  const path = key.split('.')
  let node = tree
  for (const seg of path) {
    node = node?.[seg]
    if (node == null) return key
  }
  return typeof node === 'string' ? node : key
}

describe('视频预览区「未生成成品」的快速判定（useResultPreviewMedia）', () => {
  it('无 videoPath 时预览区不进加载态：直接给占位区块，不申请任何媒体 URL', () => {
    // 用户现场：失败任务进入编辑页，视频预览区「一直加载」，最后空白。
    // 根因：loadProject 无条件 resolveLocalUrl(videoPath)，而 videoPath 为 null 时
    // 整个 await 链仍要等 169 段的素材 URL 全部解析完，loading 才置 false。
    const plan = resolveSegmentMediaPlan({
      project: { projectId: 'p1', videoPath: null },
      segments: [segment()],
    })

    expect(plan.previewState).toBe(PREVIEW_LOADING_STATES.EMPTY)
    expect(plan.shouldLoadPreview).toBe(false)
    expect(plan.shouldLoadNarration).toBe(false)
  })

  it('有 videoPath 时才进入预览加载态，且首屏只申请成片一个 URL', () => {
    const plan = resolveSegmentMediaPlan({
      project: { projectId: 'p1', videoPath: 'C:/p/video.mp4' },
      segments: [segment()],
    })

    expect(plan.previewState).toBe(PREVIEW_LOADING_STATES.LOADING)
    expect(plan.shouldLoadPreview).toBe(true)
    expect(plan.shouldLoadNarration).toBe(false)
    expect(plan.firstPaintMediaPaths).toEqual(['C:/p/video.mp4'])
  })

  it('占位区块的结构固定（标题/说明/行动位），与最终态同构，避免加载后布局跳变', () => {
    const placeholder = buildPreviewPlaceholder({
      translate: translateWith(zh),
      projectId: 'p1',
      hasEditableContent: true,
    })

    expect(placeholder.testId).toBe('result-preview-placeholder')
    expect(placeholder.title).toBe('尚未生成成品视频')
    expect(placeholder.description).toBe('当前任务没有可播放的成片，可先编辑分段内容，再重新合成。')
    expect(placeholder.actionLabel).toBe('重新合成')
    // 说明文字必须存在且非空：空白区块会让用户以为页面坏了
    expect(placeholder.description.length).toBeGreaterThan(0)
    expect(placeholder.actionEnabled).toBe(true)
  })

  it('无 projectId 时占位区块不带行动位（不可编辑也就无法重新合成）', () => {
    const placeholder = buildPreviewPlaceholder({
      translate: translateWith(zh),
      projectId: null,
      hasEditableContent: false,
    })

    expect(placeholder.actionEnabled).toBe(false)
  })

  it('en 文案与 zh 成对且不回落 key（Gate 7 成对锁）', () => {
    const zhPlaceholder = buildPreviewPlaceholder({
      translate: translateWith(zh),
      projectId: 'p1',
      hasEditableContent: true,
    })
    const enPlaceholder = buildPreviewPlaceholder({
      translate: translateWith(en),
      projectId: 'p1',
      hasEditableContent: true,
    })

    expect(zhPlaceholder.title).not.toBe(enPlaceholder.title)
    expect(enPlaceholder.title).toBe('Final video has not been generated yet')
    expect(enPlaceholder.description).toBe('This task has no playable video yet. Edit the segments first, then recompose.')
    expect(enPlaceholder.actionLabel).toBe('Recompose')
    // 两侧都不允许把 i18n key 当文案渲染出来
    for (const value of [zhPlaceholder.title, zhPlaceholder.description, enPlaceholder.title, enPlaceholder.description]) {
      expect(value).not.toMatch(/^story2video\./)
    }
  })

  it('占位文案键在 zh/en 两侧都是非空字符串（漏登记任一侧即红）', () => {
    for (const [name, tree] of [['zh', zh], ['en', en]]) {
      for (const [field, key] of Object.entries(PREVIEW_PLACEHOLDER_KEYS)) {
        const resolved = translateWith(tree)(key)
        expect(resolved, `${name}.${field} (${key})`).not.toBe(key)
        expect(String(resolved).length).toBeGreaterThan(0)
      }
    }
  })

  it('分段加载更多/加载中的文案在 zh/en 两侧成对', () => {
    const keys = [
      'story2video.sceneMaterial.loadMoreSegments',
      'story2video.sceneMaterial.loading',
    ]
    for (const key of keys) {
      expect(translateWith(zh)(key), `zh ${key}`).not.toBe(key)
      expect(translateWith(en)(key), `en ${key}`).not.toBe(key)
    }
  })
})

describe('分段素材 URL 分批解析（useResultPreviewMedia）', () => {
  it('首屏只解析前 N 段，其余分段延迟到下一帧，避免 700+ IPC 阻塞 loading', () => {
    const segments = Array.from({ length: 169 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

    const plan = resolveSegmentMediaPlan({ project: { projectId: 'p1' }, segments })

    // 169 段 × 5 个媒体位 = 845 次 IPC；首批必须远小于全量
    expect(plan.firstBatch.length).toBeGreaterThan(0)
    expect(plan.firstBatch.length).toBeLessThan(segments.length)
    expect(plan.deferred.length).toBe(segments.length - plan.firstBatch.length)
    // 每一段都必须在某一批里，不能丢段
    expect(plan.firstBatch.length + plan.deferred.length).toBe(segments.length)
  })

  it('分批后的并集覆盖全部分段且顺序稳定（不得重排，分段编辑依赖 index 与 DOM 顺序）', () => {
    const segments = Array.from({ length: 12 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

    const plan = resolveSegmentMediaPlan({ project: { projectId: 'p1' }, segments })

    expect([...plan.firstBatch, ...plan.deferred].map(s => s.id))
      .toEqual(segments.map(s => s.id))
  })

  it('分段数少于一批时不分批（全部首屏解析）', () => {
    const segments = [segment({ id: 'a' }), segment({ id: 'b', index: 1 })]

    const plan = resolveSegmentMediaPlan({ project: { projectId: 'p1' }, segments })

    expect(plan.firstBatch).toHaveLength(2)
    expect(plan.deferred).toHaveLength(0)
  })

  it('分段为空数组时不分批也不抛错', () => {
    const plan = resolveSegmentMediaPlan({ project: { projectId: 'p1' }, segments: [] })

    expect(plan.firstBatch).toEqual([])
    expect(plan.deferred).toEqual([])
  })
})

describe('渲染窗口（追加式展开，不是滑窗替换）', () => {
  it('窗口始终从 0 开始，长度为 renderedCount + step（已渲染段不得从 DOM 消失）', () => {
    const total = 169
    const batch = 20

    const first = resolveSegmentRenderWindow({ total, batch, renderedCount: 0 })
    expect(first.from).toBe(0)
    expect(first.to).toBe(batch)

    // 推进一次：窗口必须仍含前 20 段，否则滚动高亮/refs/政策徽标全部错位
    const second = resolveSegmentRenderWindow({ total, batch, renderedCount: 20 })
    expect(second.from).toBe(0)
    expect(second.to).toBe(40)
  })

  it('窗口上界永不超出总分段数（越界 renderedCount 安全）', () => {
    const window = resolveSegmentRenderWindow({ total: 10, batch: 20, renderedCount: 999 })
    expect(window.from).toBe(0)
    expect(window.to).toBe(10)
  })

  it('total 为 0 时窗口为空', () => {
    expect(resolveSegmentRenderWindow({ total: 0, batch: 20, renderedCount: 0 })).toEqual({ from: 0, to: 0 })
  })

  it('负数 renderedCount 视为 0（不产生负长度窗口）', () => {
    expect(resolveSegmentRenderWindow({ total: 10, batch: 5, renderedCount: -3 })).toEqual({ from: 0, to: 5 })
  })
})

describe('focusScenes 点名段强制并入首屏（内容政策失败任务的定位不得被分批破坏）', () => {
  it('点名段落在窗口外时仍进首屏，且不重复', () => {
    const segments = Array.from({ length: 80 }, (_, i) => segment({ id: 'seg-' + i, index: i }))
    const policySceneNumbers = new Set([49, 73, 74, 999])

    const { firstBatch, deferred } = resolveFirstPaintSegments(segments, { policySceneNumbers, batchSize: 20 })

    const ids = firstBatch.map(s => s.id)
    // 49/73/74 → 下标 48/72/73；999 越界忽略
    expect(ids).toContain('seg-48')
    expect(ids).toContain('seg-72')
    expect(ids).toContain('seg-73')
    expect(ids).not.toContain('seg-998')
    expect(new Set(ids).size).toBe(ids.length)
    // 被点名的段不得同时出现在 deferred（否则会渲染两份）
    expect(deferred.map(s => s.id)).not.toContain('seg-48')
  })

  it('无点名集时行为与 splitSegmentBatches 完全一致', () => {
    const segments = Array.from({ length: 30 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

    const plain = splitSegmentBatches(segments, 20)
    const withoutPolicy = resolveFirstPaintSegments(segments, { policySceneNumbers: null, batchSize: 20 })

    expect(withoutPolicy.firstBatch.map(s => s.id)).toEqual(plain.firstBatch.map(s => s.id))
    expect(withoutPolicy.deferred.map(s => s.id)).toEqual(plain.deferred.map(s => s.id))
  })

  it('点名集为空 Set 时不扩容首屏', () => {
    const segments = Array.from({ length: 30 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

    const { firstBatch } = resolveFirstPaintSegments(segments, { policySceneNumbers: new Set(), batchSize: 20 })

    expect(firstBatch).toHaveLength(20)
  })
})

describe('单个分段是否需要申请媒体 URL', () => {
  it('没有任何媒体路径时不申请（未生成素材的段落不发起 IPC）', () => {
    expect(shouldRequestSegmentMedia(segment())).toBe(false)
  })

  it('有图片路径时申请', () => {
    expect(shouldRequestSegmentMedia(segment({ imagePath: 'C:/a.png' }))).toBe(true)
  })

  it('有备选图/场景视频/音频路径时申请', () => {
    expect(shouldRequestSegmentMedia(segment({ alternateImages: [{ path: 'C:/b.png' }] }))).toBe(true)
    expect(shouldRequestSegmentMedia(segment({ videoMeta: { sceneVideoPath: 'C:/c.mp4' } }))).toBe(true)
    expect(shouldRequestSegmentMedia(segment({ audioPath: 'C:/d.mp3' }))).toBe(true)
  })
})
