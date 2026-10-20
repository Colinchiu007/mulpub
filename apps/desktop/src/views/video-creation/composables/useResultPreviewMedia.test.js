import { describe, it, expect } from 'vitest'

import zh from '@/locales/zh'
import en from '@/locales/en'

import {
  PREVIEW_PLACEHOLDER_KEYS,
  SEGMENT_FILTER_MODES,
  SEGMENT_URL_BATCH_SIZE,
  buildFailureSummary,
  buildPreviewPlaceholder,
  buildSegmentCountLabel,
  filterSegments,
  resolveFirstPaintSegments,
  resolveResultPreviewLayout,
  resolveSceneMaterialSlots,
  resolveSegmentJumpPlan,
  resolveSegmentMediaPlan,
  resolveSegmentRenderWindow,
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
  it('无 videoPath 时不申请预览 URL（修复「一直加载」的核心）', () => {
    const plan = resolveSegmentMediaPlan({ project: { projectId: 'p1', videoPath: null } })

    expect(plan.shouldLoadPreview).toBe(false)
    expect(plan.shouldLoadNarration).toBe(false)
  })

  it('有 videoPath 时才申请预览 URL', () => {
    const plan = resolveSegmentMediaPlan({ project: { projectId: 'p1', videoPath: 'C:/p/video.mp4' } })

    expect(plan.shouldLoadPreview).toBe(true)
    expect(plan.shouldLoadNarration).toBe(false)
  })

  it('audioPath 独立门控旁白 URL（无旁白时不申请）', () => {
    expect(resolveSegmentMediaPlan({ project: { audioPath: 'C:/p/n.m4a' } }).shouldLoadNarration).toBe(true)
    expect(resolveSegmentMediaPlan({ project: { audioPath: null } }).shouldLoadNarration).toBe(false)
    // project 为空对象/非对象时不得抛错
    expect(resolveSegmentMediaPlan({ project: null }).shouldLoadPreview).toBe(false)
    expect(resolveSegmentMediaPlan({}).shouldLoadPreview).toBe(false)
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
  it('首屏只解析前 N 段，其余分段延迟（避免全量 IPC 阻塞 loading）', () => {
    const segments = Array.from({ length: 169 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

    const { firstBatch, deferred } = resolveFirstPaintSegments(segments)

    // 每段最多 4 个媒体位会发 IPC（无路径的位不发）；全量 ≈ 676 次，首批必须远小于全量
    expect(firstBatch.length).toBe(SEGMENT_URL_BATCH_SIZE)
    expect(firstBatch.length).toBeLessThan(segments.length)
    expect(deferred.length).toBe(segments.length - firstBatch.length)
    // 每一段都必须在某一批里，不能丢段
    expect(firstBatch.length + deferred.length).toBe(segments.length)
  })

  it('分批后的并集覆盖全部分段且顺序稳定（不得重排，分段编辑依赖 index 与 DOM 顺序）', () => {
    const segments = Array.from({ length: 12 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

    const { firstBatch, deferred } = resolveFirstPaintSegments(segments)

    expect([...firstBatch, ...deferred].map(s => s.id)).toEqual(segments.map(s => s.id))
  })

  it('分段数少于一批时不分批（全部首屏解析）', () => {
    const segments = [segment({ id: 'a' }), segment({ id: 'b', index: 1 })]

    const { firstBatch, deferred } = resolveFirstPaintSegments(segments)

    expect(firstBatch).toHaveLength(2)
    expect(deferred).toHaveLength(0)
  })

  it('分段为空数组时不分批也不抛错', () => {
    const { firstBatch, deferred } = resolveFirstPaintSegments([])

    expect(firstBatch).toEqual([])
    expect(deferred).toEqual([])
  })

  it('分段含非对象项时安全过滤（脏数据不抛错）', () => {
    const segments = [segment({ id: 'a' }), null, 'oops', segment({ id: 'b', index: 1 })]

    const { firstBatch, deferred } = resolveFirstPaintSegments(segments)

    expect(firstBatch.map(s => s.id)).toEqual(['a', 'b'])
    expect(deferred).toEqual([])
  })
})

describe('渲染窗口（追加式展开，不是滑窗替换）', () => {
  it('窗口始终从 0 开始；renderedCount 是「已渲染段数」，0 表示先给一批', () => {
    const total = 169
    const batch = 20

    // 尚未展开：先渲染一批
    const first = resolveSegmentRenderWindow({ total, batch, renderedCount: 0 })
    expect(first.from).toBe(0)
    expect(first.to).toBe(batch)

    // 已渲染 20 段：上界就是 20（不是 20+20）——这样 to 同时是「已渲染上界」与「下次追加起点」
    const second = resolveSegmentRenderWindow({ total, batch, renderedCount: 20 })
    expect(second.from).toBe(0)
    expect(second.to).toBe(20)

    // 已渲染 40 段：窗口仍从 0 开始，绝不让已渲染段从 DOM 消失
    const third = resolveSegmentRenderWindow({ total, batch, renderedCount: 40 })
    expect(third.from).toBe(0)
    expect(third.to).toBe(40)
  })

  it('窗口上界永不超出总分段数（越界 renderedCount 安全）', () => {
    const window = resolveSegmentRenderWindow({ total: 10, batch: 20, renderedCount: 999 })
    expect(window.from).toBe(0)
    expect(window.to).toBe(10)
  })

  it('total 为 0 时窗口为空', () => {
    expect(resolveSegmentRenderWindow({ total: 0, batch: 20, renderedCount: 0 })).toEqual({ from: 0, to: 0 })
  })

  it('负数 renderedCount 视为未展开（给一批，不产生负长度窗口）', () => {
    expect(resolveSegmentRenderWindow({ total: 10, batch: 5, renderedCount: -3 })).toEqual({ from: 0, to: 5 })
  })

  it('total 小于一批时窗口收敛到 total', () => {
    expect(resolveSegmentRenderWindow({ total: 3, batch: 20, renderedCount: 0 })).toEqual({ from: 0, to: 3 })
  })
})

describe('focusScenes 点名段强制并入首屏（内容政策失败任务的定位不得被分批破坏）', () => {
  it('点名段落在窗口外时仍进首屏，且不重复', () => {
    const segments = Array.from({ length: 80 }, (_, i) => segment({ id: 'seg-' + i, index: i }))
    const policySceneNumbers = new Set([49, 73, 74, 999])

    const { firstBatch, deferred } = resolveFirstPaintSegments(segments, { policySceneNumbers })

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

  it('无点名集时行为与纯分批完全一致', () => {
    const segments = Array.from({ length: 30 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

    const plain = resolveFirstPaintSegments(segments, { policySceneNumbers: null })
    const withoutPolicy = resolveFirstPaintSegments(segments)

    expect(withoutPolicy.firstBatch.map(s => s.id)).toEqual(plain.firstBatch.map(s => s.id))
    expect(withoutPolicy.deferred.map(s => s.id)).toEqual(plain.deferred.map(s => s.id))
  })

  it('点名集为空 Set 时不扩容首屏', () => {
    const segments = Array.from({ length: 30 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

    const { firstBatch } = resolveFirstPaintSegments(segments, { policySceneNumbers: new Set() })

    expect(firstBatch).toHaveLength(SEGMENT_URL_BATCH_SIZE)
  })
})

describe('resolveResultPreviewLayout（渲染层统一入口）', () => {
  const segments = Array.from({ length: 169 }, (_, i) => segment({ id: 'seg-' + i, index: i }))

  it('visibleSegments 每项携带全量 absoluteIndex（上移/删除/导出命名靠它寻址）', () => {
    const layout = resolveResultPreviewLayout({ segments, renderedCount: 0 })

    expect(layout.visibleSegments).toHaveLength(SEGMENT_URL_BATCH_SIZE)
    layout.visibleSegments.forEach((item, i) => {
      expect(item.absoluteIndex).toBe(i)
      expect(item.segment.id).toBe('seg-' + i)
    })
  })

  it('窗口推进后 visibleSegments 是追加式增长（不丢已渲染段）', () => {
    const first = resolveResultPreviewLayout({ segments, renderedCount: 0 })
    const second = resolveResultPreviewLayout({ segments, renderedCount: SEGMENT_URL_BATCH_SIZE * 2 })

    expect(first.visibleSegments).toHaveLength(SEGMENT_URL_BATCH_SIZE)
    expect(second.visibleSegments).toHaveLength(SEGMENT_URL_BATCH_SIZE * 2)
    // 前 20 项必须原样保留
    expect(second.visibleSegments.slice(0, SEGMENT_URL_BATCH_SIZE).map(i => i.absoluteIndex))
      .toEqual(first.visibleSegments.map(i => i.absoluteIndex))
  })

  it('hasFinalVideo 取 project.videoPath 与 ownVideoPath 的并集（两条入口）', () => {
    expect(resolveResultPreviewLayout({ segments, project: { videoPath: 'C:/v.mp4' } }).hasFinalVideo).toBe(true)
    expect(resolveResultPreviewLayout({ segments, ownVideoPath: 'C:/file.mp4' }).hasFinalVideo).toBe(true)
    expect(resolveResultPreviewLayout({ segments, project: { videoPath: null } }).hasFinalVideo).toBe(false)
    // 空白串不算有成片
    expect(resolveResultPreviewLayout({ segments, ownVideoPath: '   ' }).hasFinalVideo).toBe(false)
  })

  it('pendingBatch 首屏等于 firstBatch；推进后含首屏+新增段（去重保序）', () => {
    // 语义：pendingBatch = firstBatch ∪ [firstBatch.length, renderedCount)。
    // 宿主 loadProject 只在挂载时（renderedCount=0）消费它做首屏解析。
    const first = resolveResultPreviewLayout({ segments, renderedCount: 0 })
    expect(first.pendingBatch.map(s => s.id)).toEqual(first.firstBatch.map(s => s.id))

    const second = resolveResultPreviewLayout({ segments, renderedCount: SEGMENT_URL_BATCH_SIZE * 2 })
    expect(second.pendingBatch).toHaveLength(SEGMENT_URL_BATCH_SIZE * 2)
    expect(second.pendingBatch.slice(0, SEGMENT_URL_BATCH_SIZE).map(s => s.id)).toEqual(first.firstBatch.map(s => s.id))
    expect(second.pendingBatch.slice(SEGMENT_URL_BATCH_SIZE).map(s => s.id))
      .toEqual(segments.slice(SEGMENT_URL_BATCH_SIZE, SEGMENT_URL_BATCH_SIZE * 2).map(s => s.id))
  })

  it('renderWindow.to 同时是「已渲染上界」与「下次追加起点」（不得重复解析首批）', () => {
    const first = resolveResultPreviewLayout({ segments, renderedCount: 0 })
    expect(first.renderWindow.to).toBe(SEGMENT_URL_BATCH_SIZE)

    // 宿主追加后把 segmentRenderCount 设为 nextCount
    const second = resolveResultPreviewLayout({ segments, renderedCount: SEGMENT_URL_BATCH_SIZE * 2 })
    expect(second.renderWindow.to).toBe(SEGMENT_URL_BATCH_SIZE * 2)
    // 下次追加的起点必须是 40（第二批的终点），不是 0
    expect(second.renderWindow.to).toBeGreaterThan(first.renderWindow.to)
  })

  it('点名段并入首屏后 pendingBatch 不重复包含它', () => {
    const policySceneNumbers = new Set([49])
    const layout = resolveResultPreviewLayout({ segments, renderedCount: 0, policySceneNumbers })

    const ids = layout.pendingBatch.map(s => s.id)
    expect(ids).toContain('seg-48')
    expect(new Set(ids).size).toBe(ids.length)
  })
})

describe('场景素材槽位解析（宿主与 ResultSegmentCard 共用同一真源）', () => {
  const label = (key) => key

  it('四槽位齐全且按 image1/image2/video1/video2 排序', () => {
    const slots = resolveSceneMaterialSlots(segment({ imagePath: 'C:/a.png' }), { label })

    expect(slots.map(s => s.kind)).toEqual(['image1', 'image2', 'video1', 'video2'])
  })

  it('无路径的槽位不可选、URL 为 null', () => {
    const slots = resolveSceneMaterialSlots(segment(), { label })

    expect(slots.every(s => s.selectable === false)).toBe(true)
    expect(slots.every(s => s.url === null)).toBe(true)
  })

  it('被标记不可用的素材位即使有路径也不可选（保留来源路径由调用方负责）', () => {
    const seg = segment({ id: 's1', imagePath: 'C:/a.png', videoPath: 'C:/v.mp4', videoMeta: { sceneVideoPath: 'C:/v.mp4' } })
    const slots = resolveSceneMaterialSlots(seg, {
      label,
      unavailable: { 's1:image1': true, 's1:video1': true },
    })

    expect(slots.find(s => s.kind === 'image1').path).toBeNull()
    expect(slots.find(s => s.kind === 'image1').selectable).toBe(false)
    expect(slots.find(s => s.kind === 'video1').path).toBeNull()
    // 来源路径本身不被 composable 篡改
    expect(seg.imagePath).toBe('C:/a.png')
  })

  it('video1 的 selectable 要求 videoPath 与 sceneVideoPath 同时存在（防伪造 video 选择）', () => {
    const withBoth = resolveSceneMaterialSlots(
      segment({ videoPath: 'C:/v.mp4', videoMeta: { sceneVideoPath: 'C:/v.mp4' } }),
      { label },
    )
    const metaOnly = resolveSceneMaterialSlots(
      segment({ videoMeta: { sceneVideoPath: 'C:/v.mp4' } }),
      { label },
    )

    expect(withBoth.find(s => s.kind === 'video1').selectable).toBe(true)
    expect(metaOnly.find(s => s.kind === 'video1').selectable).toBe(false)
  })

  it('video2 永远不重复「当前使用」徽标（canonical video 只有一份）', () => {
    const slots = resolveSceneMaterialSlots(
      segment({ videoPath: 'C:/v.mp4', videoMeta: { sceneVideoPath: 'C:/v.mp4', altSceneVideoPath: 'C:/v2.mp4' }, selectedMaterial: 'video' }),
      { label },
    )

    expect(slots.find(s => s.kind === 'video1').selected).toBe(true)
    expect(slots.find(s => s.kind === 'video2').selected).toBe(false)
  })

  it('分段为非对象时返回空数组（脏数据不抛错）', () => {
    expect(resolveSceneMaterialSlots(null, { label })).toEqual([])
    expect(resolveSceneMaterialSlots('oops', { label })).toEqual([])
  })
})

// ── 2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.2–§3.6 ──
// 这一批函数解决「169 段任务页面上关键信息缺席」：为什么失败、失败在哪、还有多少段没显示。

describe('失败摘要（占位区块要能回答「为什么没成片」）', () => {
  const withStatus = (statuses, extra = () => ({})) => statuses.map((status, i) =>
    segment({ id: 'seg-' + i, index: i, status, ...extra(i) }))

  it('统计总数 / 失败数 / 政策标记数，并给出首个失败段的全量下标', () => {
    const segments = withStatus(
      ['completed', 'completed', 'failed', 'pending', 'failed'],
      (i) => (i === 4 ? { policyFlagged: true } : {}),
    )

    const summary = buildFailureSummary({ segments })

    expect(summary.total).toBe(5)
    expect(summary.failedCount).toBe(2)
    expect(summary.completedCount).toBe(2)
    expect(summary.pendingCount).toBe(1)
    expect(summary.firstFailedIndex).toBe(2)
    // 失败段的下标列表供「只看失败段」筛选复用
    expect(summary.failedIndexes).toEqual([2, 4])
  })

  it('首个失败段取最小下标（与 DOM 顺序一致，不是随机命中）', () => {
    const segments = withStatus(['failed', 'completed', 'failed'])
    expect(buildFailureSummary({ segments }).firstFailedIndex).toBe(0)
  })

  it('无失败段时 firstFailedIndex 为 -1（调用方据此不渲染「定位到失败段」按钮）', () => {
    const segments = withStatus(['completed', 'completed'])
    const summary = buildFailureSummary({ segments })

    expect(summary.failedCount).toBe(0)
    expect(summary.firstFailedIndex).toBe(-1)
    expect(summary.hasFailure).toBe(false)
  })

  it('把 failureCode / failureReason 聚合成可读原因并计数（同因合并，按次数降序）', () => {
    const segments = withStatus(['failed', 'failed', 'failed', 'completed'], (i) => ({
      failureCode: i === 2 ? 'quota' : 'policy',
    }))

    const summary = buildFailureSummary({ segments })

    expect(summary.reasons.map(r => r.code)).toEqual(['policy', 'quota'])
    expect(summary.reasons[0].count).toBe(2)
    expect(summary.reasons[1].count).toBe(1)
  })

  it('无任何失败原因时 reasons 为空数组（不编造文案）', () => {
    const segments = withStatus(['failed', 'failed'])
    expect(buildFailureSummary({ segments }).reasons).toEqual([])
  })

  it('空输入 / 脏输入不抛错', () => {
    expect(buildFailureSummary({})).toMatchObject({ total: 0, failedCount: 0, firstFailedIndex: -1, hasFailure: false })
    expect(buildFailureSummary({ segments: null })).toMatchObject({ total: 0, failedCount: 0 })
    expect(buildFailureSummary({ segments: [null, 'oops', segment({ id: 'ok', status: 'completed' })] }))
      .toMatchObject({ total: 1, failedCount: 0 })
  })
})

describe('分段筛选与搜索（169 段里找目标段）', () => {
  const seg = (i, over = {}) => segment({ id: 'seg-' + i, index: i, text: '文案' + i, prompt: '提示词' + i, ...over })

  it('all 模式原样返回并保留全量下标', () => {
    const segments = [seg(0), seg(1), seg(2)]
    const result = filterSegments(segments, { mode: SEGMENT_FILTER_MODES.ALL })

    expect(result.map(r => r.absoluteIndex)).toEqual([0, 1, 2])
    expect(result.map(r => r.segment.id)).toEqual(['seg-0', 'seg-1', 'seg-2'])
  })

  it('failed 模式只留失败段，且 absoluteIndex 仍是全量下标（不是筛选后的序号）', () => {
    const segments = [seg(0), seg(1, { status: 'failed' }), seg(2), seg(3, { status: 'failed' })]
    const result = filterSegments(segments, { mode: SEGMENT_FILTER_MODES.FAILED })

    expect(result.map(r => r.segment.id)).toEqual(['seg-1', 'seg-3'])
    // 关键：必须是 1 和 3，不能变成 0 和 1（否则上移/删除/导出命名全指错段）
    expect(result.map(r => r.absoluteIndex)).toEqual([1, 3])
  })

  it('policy 模式只留被 focusScenes 点名的段', () => {
    const segments = [seg(0), seg(1), seg(2)]
    const result = filterSegments(segments, {
      mode: SEGMENT_FILTER_MODES.POLICY,
      policySceneNumbers: new Set([2, 3]),
    })

    // 场景号 1-based ⇒ 场景 2/3 对应下标 1/2
    expect(result.map(r => r.absoluteIndex)).toEqual([1, 2])
  })

  it('关键词搜索大小写不敏感，命中 text / prompt / videoPrompt / 字幕任一即保留', () => {
    const segments = [
      seg(0, { text: 'iPhone 发布会' }),
      seg(1, { prompt: 'nothing here' }),
      seg(2, { videoPrompt: '关于 IPHONE 的镜头' }),
      seg(3, { subtitleBlocks: ['用 iphone 拍'] }),
    ]
    const result = filterSegments(segments, { query: 'iphone' })

    expect(result.map(r => r.absoluteIndex)).toEqual([0, 2, 3])
  })

  it('关键词首尾空白被忽略；空关键词等于不筛选', () => {
    const segments = [seg(0, { text: 'alpha' }), seg(1, { text: 'beta' })]

    expect(filterSegments(segments, { query: '   ' }).map(r => r.absoluteIndex)).toEqual([0, 1])
    expect(filterSegments(segments, { query: '  alpha  ' }).map(r => r.absoluteIndex)).toEqual([0])
  })

  it('筛选与搜索可叠加（只看失败段 + 关键词）', () => {
    const segments = [
      seg(0, { status: 'failed', text: '含关键词' }),
      seg(1, { status: 'failed', text: '不含' }),
      seg(2, { status: 'completed', text: '含关键词' }),
    ]
    const result = filterSegments(segments, { mode: SEGMENT_FILTER_MODES.FAILED, query: '关键词' })

    expect(result.map(r => r.absoluteIndex)).toEqual([0])
  })

  it('无命中时返回空数组（调用方据此渲染「没有匹配的分段」而不是空白列表）', () => {
    const segments = [seg(0)]
    expect(filterSegments(segments, { query: 'zzz-不存在' })).toEqual([])
  })
})

describe('分段计数文案（169 段要告诉用户还有多少没显示）', () => {
  it('已显示少于总数时给出「已显示 N / 共 M」', () => {
    const label = buildSegmentCountLabel({ shown: 20, total: 169, translate: (k, p) => `${k}:${p.shown}/${p.total}` })
    expect(label).toBe('story2video.sceneMaterial.segmentCountPartial:20/169')
  })

  it('全部显示时只给总数（不再重复「已显示」）', () => {
    const label = buildSegmentCountLabel({ shown: 169, total: 169, translate: (k, p) => `${k}:${p.total}` })
    expect(label).toBe('story2video.sceneMaterial.segmentCountAll:169')
  })

  it('筛选命中数为 0 时给「没有匹配的分段」', () => {
    const label = buildSegmentCountLabel({ shown: 0, total: 169, filtered: true, translate: (k) => k })
    expect(label).toBe('story2video.sceneMaterial.segmentCountNoMatch')
  })
})

describe('分段跳转计划（大跨度跳转要给反馈，不能静默无响应）', () => {
  it('目标已在窗口内：只需要滚动，不需要扩窗也不要再解析 URL', () => {
    const plan = resolveSegmentJumpPlan({ index: 5, total: 169, renderedTo: 40 })
    expect(plan).toMatchObject({ needsScroll: true, needsExpand: false, expandTo: 40, batch: { from: 40, to: 40 } })
  })

  it('目标在窗口外：扩窗到覆盖目标，且只解析新增区间', () => {
    const plan = resolveSegmentJumpPlan({ index: 149, total: 169, renderedTo: 40 })
    expect(plan.needsExpand).toBe(true)
    expect(plan.expandTo).toBe(150)
    // 只请求 [40,150)，不重解析已渲染的 0..39
    expect(plan.batch).toEqual({ from: 40, to: 150 })
  })

  it('越界或非法下标：不做任何动作（不抛错、不产生负区间）', () => {
    expect(resolveSegmentJumpPlan({ index: 169, total: 169, renderedTo: 40 }).needsScroll).toBe(false)
    expect(resolveSegmentJumpPlan({ index: -1, total: 169, renderedTo: 40 }).needsScroll).toBe(false)
    expect(resolveSegmentJumpPlan({ index: 1.5, total: 169, renderedTo: 40 }).needsScroll).toBe(false)
  })

  it('扩窗超过总段数时收敛到 total', () => {
    const plan = resolveSegmentJumpPlan({ index: 168, total: 169, renderedTo: 20 })
    expect(plan.expandTo).toBe(169)
    expect(plan.batch).toEqual({ from: 20, to: 169 })
  })
})
