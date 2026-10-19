/**
 * usePublishHistoryRowFormat — 发布历史「记录 → 展示值」的纯映射
 *
 * 从 `views/PublishHistory.vue` 抽出。直接动因是行数门禁（该视图被 `check-max-lines.js`
 * 点名还账、零增长容差），但抽出顺带修掉一个真实问题：这些映射原先只能在整页挂载的
 * 测试里被间接覆盖，如今可以逐个函数拿夹具直测。
 *
 * 依赖注入而不是内部 import：`t` 与 `platformStore` 由调用方给。
 * 与 `usePublishRecordActions` / `usePublishHistoryMetrics` 同范式，
 * 目的是让本 composable 在**不挂 i18n** 的夹具里也能测（传一个 `t: (k) => k` 即可）。
 *
 * 口径提示：以下函数只做「取值 + 兜底 + 文案键选择」，**不做**任何持久化写入，
 * 也不得在这里加缓存 —— 每行的缓存属于视图层的 `rowMeta` 查表（阶段 2.2 b）。
 */
import { isAuditAlertStatus, auditStatusLabelKey } from '@multi-publish/shared-utils/src/publish-audit-status'
import { formatDateTime } from '@/utils/datetime'
import { normalizedStatusGroup, statusValue } from '@/utils/publish-record-status'

export function usePublishHistoryRowFormat ({ t, platformStore }) {
  function recordTitle (record) {
    return record?.title || record?.name || t('historyPage.unnamedTask')
  }

  function publisherName (record) {
    return record?.publisher || record?.author || record?.operator || t('historyPage.systemAccount')
  }

  // ── P0-1 审核状态（枚举与映射真源在 shared-utils 双孪生，渲染端走 ESM 版）──
  // 只在记录带**合法**审核结论时渲染徽标；无结论（旧记录/监控无定论）不渲染，
  // 避免用「无徽标」伪装成「已通过」。拒绝/下线/转码失败醒目标红。
  function auditLabel (record) {
    const key = auditStatusLabelKey(record && record.auditStatus)
    return key ? t(key) : ''
  }
  function auditAlert (record) {
    return isAuditAlertStatus(record && record.auditStatus)
  }
  function auditHint (record) {
    return auditAlert(record) ? t('historyPage.auditStatusAlertHint') : ''
  }

  function contentTypeValue (record) {
    const value = String(record?.contentType || record?.type || '').toLowerCase()
    if (['video', 'short_video', 'short-video'].includes(value)) return 'video'
    if (['image', 'gallery'].includes(value)) return 'image'
    if (value) return 'article'
    // 使用 platformStore.getContentCategory 统一判断视频平台
    const category = platformStore.getContentCategory(record?.platform)
    if (category === 'VIDEO' || category === 'MIXED') return 'video'
    return 'article'
  }

  function contentTypeLabel (record) {
    const keys = { article: 'contentTypeArticle', video: 'contentTypeVideo', image: 'contentTypeImage' }
    return t('historyPage.' + keys[contentTypeValue(record)])
  }

  function publishModeValue (record) {
    const value = String(record?.publishMode || record?.mode || '').toLowerCase()
    return ['scheduled', 'schedule', 'timed'].includes(value) || statusValue(record) === 'scheduled'
      ? 'scheduled'
      : 'immediate'
  }

  function publishModeLabel (record) {
    return t(publishModeValue(record) === 'scheduled' ? 'historyPage.modeScheduled' : 'historyPage.modeImmediate')
  }

  function deliveryModeValue (record) {
    const mode = record && record.result && record.result.mode
    return mode === 'api' || mode === 'dom' || mode === 'fallback' ? mode : ''
  }

  function deliveryModeLabel (record) {
    const keys = { api: 'publish.api.modeApi', dom: 'publish.api.modeDom', fallback: 'publish.api.modeFallback' }
    return t(keys[deliveryModeValue(record)] || 'publish.api.modeApi')
  }

  function deliveryModeHint (record) {
    const keys = { api: 'publish.api.modeApiHint', dom: 'publish.api.modeDomHint', fallback: 'publish.api.modeFallbackHint' }
    return t(keys[deliveryModeValue(record)] || 'publish.api.modeApiHint')
  }

  function resultValue (record, key) {
    const v = record && record.result && record.result[key]
    return typeof v === 'string' || typeof v === 'number' ? String(v) : ''
  }

  function failedCount (record) {
    if (record?.failedCount !== undefined && record?.failedCount !== null) return record.failedCount
    return normalizedStatusGroup(record) === 'failed' ? 1 : 0
  }

  function metricValue (value, fallback = '-') {
    if (value === undefined || value === null || value === '') return fallback
    return value
  }

  const formatTime = (value) => formatDateTime(value, { emptyText: t('historyPage.unknownTime'), invalidText: String(value ?? '') })

  function contentPreview (content) {
    const text = String(content).replace(/\s+/g, ' ').trim()
    return text.length > 48 ? text.slice(0, 48) + '...' : text
  }

  return {
    recordTitle,
    publisherName,
    auditLabel,
    auditAlert,
    auditHint,
    contentTypeValue,
    contentTypeLabel,
    publishModeValue,
    publishModeLabel,
    deliveryModeValue,
    deliveryModeLabel,
    deliveryModeHint,
    resultValue,
    failedCount,
    metricValue,
    formatTime,
    contentPreview
  }
}
