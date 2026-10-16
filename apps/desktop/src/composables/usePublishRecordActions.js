/**
 * usePublishRecordActions — 发布记录卡片的动作与状态展示
 * （PRD-PUBLISH-RECORD-REPUBLISH-2026-10-15）
 *
 * 为什么独立成 composable：`PublishHistory.vue` 是逐文件行数门禁点名的超大文件，
 * 逻辑不再往视图里堆；视图只保留一行调用与极简标记。
 *
 * 两条语义（改动前先读）：
 *   ① `hasRepublishSnapshot` 由主进程现算下发（不落库），**严格 `=== true` 才算有**
 *      —— 字符串 "true" 不算，避免后端把布尔写成字符串时静默放开一个必然失败的按钮。
 *   ② 同批徽标只在**同批 ≥2 条**时出现：记录刻意是平台级独立行（状态/审核/链接/指标
 *      /重试/删除都是平台级动作），徽标只把「这几条属于同一次发布」这层关联补回来。
 */
import { computed } from 'vue'

/**
 * @param {object} deps
 * @param {{value: Array<object>}} deps.records 当前页记录
 * @param {object} deps.router
 * @param {(key: string, named?: object) => string} deps.t
 * @param {(platform: string) => string} deps.platformName
 */
export function usePublishRecordActions (deps) {
  const { records, router, t, platformName } = deps

  const canRepublish = (record) => Boolean(record && record.hasRepublishSnapshot === true)

  const republishHint = (record) => (canRepublish(record)
    ? t('historyPage.republishHint')
    : t('historyPage.republishUnavailable'))

  /** 与 `?draft=` 同一条发布页入口，只是快照来源不同（记录 ID 而非草稿 ID） */
  const republishRecord = (record) => {
    if (!canRepublish(record)) return
    router.push('/publish?republish=' + encodeURIComponent(String(record.id)))
  }

  /** batchId → 该批全部记录（仅 ≥2 条时展示） */
  const batchBadgeMap = computed(() => {
    const groups = new Map()
    for (const record of records.value) {
      const batchId = record && typeof record.batchId === 'string' ? record.batchId.trim() : ''
      if (!batchId) continue
      if (!groups.has(batchId)) groups.set(batchId, [])
      groups.get(batchId).push(record)
    }
    const map = new Map()
    for (const group of groups.values()) {
      if (group.length < 2) continue
      const platforms = [...new Set(group.map(item => platformName(item.platform)))]
      const label = t('historyPage.batchBadge', { count: group.length })
      const tooltip = t('historyPage.batchTooltip', { platforms: platforms.join(' / ') })
      for (const record of group) map.set(record.id, { label, tooltip })
    }
    return map
  })

  // ── 状态判定与展示（语义未改，仅为视图瘦身而搬出）──
  // `record.success === false` 优先于 `status`（历史行有两条成功通道，老行只有 success）
  const statusValue = (record) => {
    if (record?.success === false) return 'failed'
    return String(record?.status || 'success').toLowerCase()
  }

  const normalizedStatusGroup = (record) => {
    const value = statusValue(record)
    if (['success', 'completed', 'published'].includes(value)) return 'success'
    if (['failed', 'error'].includes(value)) return 'failed'
    return 'pending'
  }

  /**
   * 列表卡片失败原因文本：仅失败组渲染；error 非字符串或空白时返回空串（卡片不渲染该行，
   * 详情弹窗侧由 errorUnknown 占位兜底）。截断展示由 CSS 负责，全文经 title 悬停可见。
   */
  const recordErrorText = (record) => {
    if (normalizedStatusGroup(record) !== 'failed') return ''
    const error = record?.error
    return typeof error === 'string' && error.trim() ? error.trim() : ''
  }

  const STATUS_LABEL_KEYS = {
    success: 'statusAllSuccess',
    completed: 'statusAllSuccess',
    published: 'statusAllSuccess',
    failed: 'statusFailed',
    error: 'statusFailed',
    running: 'statusRunning',
    pending: 'statusWaiting',
    scheduled: 'statusScheduled',
  }

  const statusLabel = (record) => t('historyPage.' + (STATUS_LABEL_KEYS[statusValue(record)] || 'statusPending'))

  const statusClass = (record) => normalizedStatusGroup(record)

  return {
    canRepublish, republishHint, republishRecord, batchBadgeMap,
    statusValue, normalizedStatusGroup, recordErrorText, statusLabel, statusClass,
  }
}
