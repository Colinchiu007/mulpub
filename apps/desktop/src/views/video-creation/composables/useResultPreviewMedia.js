/**
 * 视频任务编辑页（ResultView）预览区与分段素材的加载策略 —— 纯函数，无 Vue / DOM 依赖。
 *
 * 合同锚点：01-docs/PRD-S2V-RESULT-VIEW-PERF-2026-10-20.md §3 / §4
 * 主 PRD：01-docs/PRD.md §7.1.40
 *
 * 为什么抽成独立模块：ResultView.vue 是 max-lines 点名还账对象（targets 容差 0，
 * 一行都不能涨），而「未生成成品视频时不该走加载链路」这件事本身是可独立测的策略面。
 *
 * 修复的三个现场（用户 2026-10-19 截图 + 描述，项目 mvfbqtio_3wwu，169 段失败任务）：
 *   ① 视频预览区「一直加载」最后空白 —— loadProject 无条件解析 videoPath，
 *      而 loading 要等全部 169 段素材 URL 解析完才置 false；
 *   ② 未生成的图片区先显示「错误链接样式」，几秒后才变成「未生成」——
 *      <img> 无懒加载、无错误兜底，169 张同时发起请求；
 *   ③ 页面进入非常慢（169 段），且加载完成后布局变化（无占位区块）。
 */

/**
 * 单批解析的分段数。
 *
 * 分母口径（QM-6 审查项 B5 校正）：每段**最多 4 个**媒体位会发起 IPC
 * （image1 / audio / video1 / image2 或 video2），无路径的位直接置 null 不发。
 * 169 段全量 ≈ 676 次；首屏一批 20 段 ⇒ 最坏 80 次（降幅约 88%）。
 */
export const SEGMENT_URL_BATCH_SIZE = 20

/** 滚动窗口的追加步长：与首批同量，保证一次追加的 DOM 增量可预期。 */
export const SEGMENT_RENDER_STEP = SEGMENT_URL_BATCH_SIZE

const isPlainObject = (value) => Boolean(value) && typeof value === 'object' && !Array.isArray(value)

const cleanText = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '')

/**
 * 首屏 / 延后两批分段。
 *
 * 顺序稳定（不得重排）：分段编辑区依赖 segments 的 index 与 DOM 顺序，
 * 重排会让「上移/下移」与滚动高亮指向错位。
 */
function splitSegmentBatches (segments, batchSize = SEGMENT_URL_BATCH_SIZE) {
  const list = Array.isArray(segments) ? segments.filter(isPlainObject) : []
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : SEGMENT_URL_BATCH_SIZE
  return {
    firstBatch: list.slice(0, size),
    deferred: list.slice(size),
  }
}

/**
 * 渲染窗口：[from, to)。`renderedCount` 为**已渲染的段数**（不是滚动锚点）：
 * 窗口始终从 0 开始，长度为 renderedCount + step —— 分段是「追加式」展开，
 * 不是「滑窗式」替换，否则已渲染段会从 DOM 消失（滚动高亮、refs、政策徽标全部错位）。
 *
 * 越界的 renderedCount 收敛到 total。
 */
export function resolveSegmentRenderWindow ({ total, batch = SEGMENT_RENDER_STEP, renderedCount = 0 }) {
  const count = Number.isFinite(Number(total)) && Number(total) > 0 ? Math.floor(Number(total)) : 0
  if (count === 0) return { from: 0, to: 0 }
  const step = Number.isInteger(batch) && batch > 0 ? batch : SEGMENT_RENDER_STEP
  const rendered = Number.isFinite(Number(renderedCount)) && Number(renderedCount) > 0
    ? Math.min(count, Math.floor(Number(renderedCount)))
    : 0
  // renderedCount = 已渲染的段数；0 表示「尚未展开」，先渲染一批（不是渲染 0 段）。
  // 这样 `to` 同时是「当前已渲染上界」和「下一次追加的起点」，宿主与编辑器都不必再自己加减步长
  // （旧口径 to = rendered + step 会让首批在第一次追加时被重复解析一次）。
  const to = Math.min(count, rendered > 0 ? rendered : step)
  return { from: 0, to }
}

/**
 * 首屏分段集合 = 首批 + **被 focusScenes 点名的段**。
 *
 * 为什么必须把点名段并入首屏：内容政策失败的任务从历史跳转时携带 focusScenes，
 * 用户进页面就是要改那几段。若这些段落在渲染窗口外，徽标与定位能力等于失效
 * （本轮被既有用例 focusScenes 49/73/74 当场抓到，见 ResultView.test.js）。
 * 点名集通常极小（几条），并入首屏不破坏分批的成本模型。
 */
export function resolveFirstPaintSegments (segments, { policySceneNumbers = null, batchSize = SEGMENT_URL_BATCH_SIZE } = {}) {
  const list = Array.isArray(segments) ? segments.filter(isPlainObject) : []
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : SEGMENT_URL_BATCH_SIZE
  const first = list.slice(0, size)
  if (!policySceneNumbers || typeof policySceneNumbers.has !== 'function' || policySceneNumbers.size === 0) {
    return { firstBatch: first, deferred: list.slice(first.length) }
  }
  const selected = []
  const seen = new Set(first.map(segment => segment.id))
  list.forEach((segment, index) => {
    // 场景号 = 下标 + 1（与 isPolicyFlagScene 同口径）
    if (!policySceneNumbers.has(index + 1) || seen.has(segment.id)) return
    seen.add(segment.id)
    selected.push(segment)
  })
  return { firstBatch: [...first, ...selected], deferred: list.filter(segment => !seen.has(segment.id)) }
}

/**
 * 场景素材四槽位解析（2026-10-20 从 ResultView 抽出，宿主与 ResultSegmentEditor 共用）。
 *
 * 单一真源的必要性：宿主用 selectable 判定「该槽位没有可用路径就不发 IPC」，
 * 编辑器用它渲染四张卡。两份实现的代价是「宿主放行、编辑器禁用」这类不对称缺陷
 * （本轮既有用例「素材预览加载失败时让渲染槽位不可选」正是守这条）。
 *
 * @param {object} segment 分段对象
 * @param {function} label (key) => string，槽位标签解析（宿主/编辑器各自的 $t）
 * @param {object} unavailable 已标记不可用的素材位（'segmentId:kind' -> true）
 */
export function resolveSceneMaterialSlots (segment, { label, unavailable = {} }) {
  if (!segment || typeof segment !== 'object') return []
  const key = (kind) => String(segment.id || '') + ':' + String(kind || '')
  const isUnavailable = (kind) => Boolean(unavailable && unavailable[key(kind)])
  const selected = effectiveSelectedMaterial(segment)
  const alternate = Array.isArray(segment.alternateImages) ? segment.alternateImages[0] : null
  const image1Path = isUnavailable('image1') ? null : (cleanText(segment.imagePath) || null)
  const image2Path = isUnavailable('image2') ? null : ((alternate && cleanText(alternate.path)) || null)
  const sceneVideoPath = isUnavailable('video1')
    ? null
    : (cleanText(segment.videoMeta?.sceneVideoPath) || cleanText(segment.videoPath) || null)
  const altSceneVideoPath = isUnavailable('video2')
    ? null
    : (cleanText(segment.videoMeta?.altSceneVideoPath) || cleanText(segment.altVideoPath) || null)
  const videoSelected = selected === 'video'
  const t = (slotKey) => (typeof label === 'function' ? label(slotKey) : slotKey)
  return [
    {
      kind: 'image1',
      label: t('image1Label'),
      path: image1Path,
      url: image1Path ? (segment.imageUrl || null) : null,
      selectable: Boolean(image1Path),
      selected: selected === 'image1' && Boolean(image1Path),
    },
    {
      kind: 'image2',
      label: t('image2Label'),
      path: image2Path,
      url: image2Path ? ((Array.isArray(segment.alternateImageUrls) && segment.alternateImageUrls[0]) || null) : null,
      selectable: Boolean(image2Path),
      selected: selected === 'image2' && Boolean(image2Path),
    },
    {
      kind: 'video1',
      label: t('video1Label'),
      path: sceneVideoPath,
      url: sceneVideoPath ? (segment.videoUrl || null) : null,
      selectable: Boolean(cleanText(segment.videoPath) && sceneVideoPath),
      selected: videoSelected && Boolean(cleanText(segment.videoPath) && sceneVideoPath),
    },
    // The service persists one canonical video identity. video2 is a visual alias
    // for an optional alternate display path and must not duplicate the badge.
    {
      kind: 'video2',
      label: t('video2Label'),
      path: altSceneVideoPath,
      url: altSceneVideoPath ? (segment.altVideoUrl || null) : null,
      selectable: Boolean(cleanText(segment.videoPath) && altSceneVideoPath),
      selected: false,
    },
  ]
}

/** 选中态归一：只认三种持久化值，其余（含 undefined/未知串）一律视为未选。 */
export function effectiveSelectedMaterial (segment) {
  const selected = segment && segment.selectedMaterial
  return ['image1', 'image2', 'video'].includes(selected) ? selected : null
}

/**
 * 字幕编辑框文本（2026-10-20 从 ResultView 抽出，宿主与 ResultSegmentEditor 共用）。
 *
 * blocks 显式存在（含空数组 = 用户清空）时直接展示，**不得回退旧 timeline**：
 * 清空后回退会让用户以为「没删掉」，是审查 I1 钉住的缺陷形态。
 */
export function resolveSubtitleBlocksText (segment) {
  if (!segment || typeof segment !== 'object') return ''
  if (Array.isArray(segment.subtitleBlocks)) return segment.subtitleBlocks.join('\n')
  if (Array.isArray(segment.subtitleTimeline) && segment.subtitleTimeline.length) {
    return segment.subtitleTimeline
      .map(item => (item && typeof item === 'object' ? item.text : item))
      .filter(Boolean)
      .join('\n')
  }
  return ''
}

/**
 * 手动编辑字幕：blocks 覆盖、时间轴置空（时间轴是上一版切分的派生数据）。
 * 返回新的 blocks 数组；调用方负责写回 segment 并标记 dirty。
 */
export function parseSubtitleBlocksInput (value) {
  return String(value || '')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
}

/**
 * failed 分段的内联可读原因（2026-10-20 从 ResultView 抽出）。
 *
 * 复用通知归一化：命中失败类别返回可读原因，未命中回退通用失败文案
 * （不暴露内部错误文本）。completed 分段即使残留 error 也返回空串。
 */
export function resolveSegmentStatusReason (segment, { resolveNotification, truncate }) {
  if (!segment || segment.status !== 'failed') return ''
  const raw = String(segment.error || '').trim()
  if (!raw) return ''
  const resolved = typeof resolveNotification === 'function' ? resolveNotification({ error: raw }) : { message: raw }
  const message = String((resolved && resolved.message) || '')
  if (typeof truncate !== 'function') return message
  return truncate(message, 120)
}

/**
 * 渲染层接线：把「首屏批次 / 渲染窗口 / 预览三态」三件事合成一个纯函数入口，
 * 让 ResultView.vue（max-lines 点名还账对象，零增长容差）只保留薄接线。
 *
 * @param {object} input
 * @param {Array<object>} input.segments 全量分段
 * @param {object|null} input.project 项目对象（story2video:get-project 返回值）
 * @param {string} input.ownVideoPath 组件自身的 videoPath（纯文件预览模式 ?path= 入口）
 * @param {number} input.renderedCount 已展开的窗口下界
 * @param {Set<number>|null} input.policySceneNumbers focusScenes 解析出的场景号集合
 */
export function resolveResultPreviewLayout ({
  segments,
  project = null,
  ownVideoPath = '',
  renderedCount = 0,
  policySceneNumbers = null,
  batchSize = SEGMENT_URL_BATCH_SIZE,
}) {
  const all = Array.isArray(segments) ? segments : []
  const { firstBatch } = resolveFirstPaintSegments(all, { policySceneNumbers, batchSize })
  const renderWindow = resolveSegmentRenderWindow({ total: all.length, batch: batchSize, renderedCount })
  const inWindow = all.slice(renderWindow.from, renderWindow.to)
  const firstIds = new Set(firstBatch.map(segment => segment.id))
  const extra = inWindow.filter(segment => !firstIds.has(segment.id))
  const indexById = new Map(all.map((segment, index) => [segment.id, index]))

  const plan = resolveSegmentMediaPlan({ project, segments: all })
  const ownPath = typeof ownVideoPath === 'string' && ownVideoPath.trim() ? ownVideoPath.trim() : ''

  // 待解析 URL 的段集合：首屏批次 + 追加展开的新增段（去重、保序）。
  // renderedCount 语义是「已展开到的窗口下界」，所以新增区间是
  // [firstBatch.length, renderedCount)；renderedCount <= firstBatch.length 时就是纯首屏。
  const renderedUpTo = Number.isFinite(Number(renderedCount)) ? Math.max(0, Math.floor(Number(renderedCount))) : 0
  const appended = renderedUpTo > firstBatch.length ? all.slice(firstBatch.length, renderedUpTo) : []
  const seenIds = new Set(firstBatch.map(item => item.id))
  const pendingBatch = [...firstBatch, ...appended.filter(item => !seenIds.has(item.id))]

  return {
    visibleSegments: [...firstBatch, ...extra].map(segment => ({
      segment,
      absoluteIndex: indexById.has(segment.id) ? indexById.get(segment.id) : -1,
    })),
    firstBatch,
    pendingBatch,
    // 两条入口的并集：project.videoPath（持久化项目）+ ownVideoPath（纯文件预览 ?path=）
    hasFinalVideo: Boolean(ownPath) || plan.shouldLoadPreview,
    shouldLoadPreview: plan.shouldLoadPreview,
    shouldLoadNarration: plan.shouldLoadNarration,
    // 渲染窗口：[0, to)。`to` 同时是「已渲染上界」与「下一次追加起点」，
    // 宿主 loadNextSegmentBatch / scrollToSegment 与编辑器 hasMore 都以它为准，
    // 不各自再加减步长（旧实现三处各算一次，首批因此被重复解析）。
    renderWindow,
  }
}

/**
 * 项目的媒体加载判据（QM-6 审查项 D10 精简：只保留有消费者的字段）。
 *
 * `shouldLoadPreview` / `shouldLoadNarration` 是「要不要发起该类 IPC」的唯一判据：
 *   - videoPath 为空 ⇒ 不申请成片 URL（这是本次修复的核心：没有成片就不该让用户
 *     等一个永远不会出现的视频）；
 *   - audioPath 为空 ⇒ 不申请旁白 URL。
 */
export function resolveSegmentMediaPlan ({ project }) {
  const videoPath = cleanText(isPlainObject(project) ? project.videoPath : '')
  const audioPath = cleanText(isPlainObject(project) ? project.audioPath : '')
  return {
    shouldLoadPreview: Boolean(videoPath),
    shouldLoadNarration: Boolean(audioPath),
  }
}

/** 预览占位区块的文案键（渲染端经 $t 解析；此处只声明键名，保证 zh/en 成对可查）。 */
export const PREVIEW_PLACEHOLDER_KEYS = Object.freeze({
  title: 'story2video.sceneMaterial.previewPlaceholderTitle',
  description: 'story2video.sceneMaterial.previewPlaceholderDescription',
  actionLabel: 'story2video.sceneMaterial.recompose',
})

/**
 * 占位区块与最终态（<video>）同构：固定高度 + 标题 + 说明 + 行动位，
 * 因此「加载完成」不会引起布局跳变（用户第 3 个诉求）。
 *
 * @param {object} options
 * @param {function} options.translate (key) => string，宿主传入 this.$t
 * @param {string|null} options.projectId
 * @param {boolean} options.hasEditableContent
 */
export function buildPreviewPlaceholder ({ translate, projectId = null, hasEditableContent = false }) {
  const t = typeof translate === 'function' ? translate : (key) => key
  const editable = Boolean(cleanText(projectId)) && Boolean(hasEditableContent)
  return {
    testId: 'result-preview-placeholder',
    title: t(PREVIEW_PLACEHOLDER_KEYS.title),
    description: t(PREVIEW_PLACEHOLDER_KEYS.description),
    actionLabel: t(PREVIEW_PLACEHOLDER_KEYS.actionLabel),
    actionEnabled: editable,
  }
}
