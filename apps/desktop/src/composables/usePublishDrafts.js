// @ts-check
import { ref } from 'vue'
import { draftDelete, draftList, draftSave } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'
import { normalizeRewriteLineage } from '@/utils/rewrite-lineage'
// 「快照 → 表单」的唯一实现（草稿箱与本 PR 的「再次发布」共用，禁止各写一份）
import { applyPublishSnapshot } from '@/features/publish/publish-snapshot'
import i18n from '@/i18n'
import { useNotify } from './useNotify'

const t = (key) => i18n.global.t(key)

const ARTICLE_FIELDS = [
  'title',
  'content',
  'author',
  'cover_url',
  'cover_path',
  'cover_file',
  'video_path',
  'images',
  'image_files',
  'tags',
  'topics',
  'mentions',
  'publishTime',
  // 归因链：改写关联必须与内容一起被存/取，否则「从草稿去发布」这条主路径永远接不上
  // （buildDraftSnapshot / applyDraft 共用本白名单，加一次两侧同时生效）。
  // 它不是内容字段：不参与 computeDraftFingerprint（见 services/draft-fingerprint.js）。
  'rewriteHistoryId',
]

// 数组型字段：草稿缺失时必须回退为 [] 而非 ''。
// 回退为 '' 会触发 publish-contract 的「images 文件引用无效」（E2E 2026-09-11 发现，
// 热门选题等纯文字草稿被阻断一键发布）。
const ARRAY_FIELDS = new Set(['images', 'image_files', 'tags', 'topics', 'mentions'])

function toPlainJson (value) {
  return JSON.parse(JSON.stringify(value))
}

function errorMessage (error, fallback) {
  return formatUserError(error, { fallback }).message
}

/**
 * 发布草稿用例。页面只负责打开面板和转发用户操作。
 * @param {object} options
 * @param {Record<string, unknown>} options.article
 * @param {{ value: string[] }} options.selectedPlatforms
 * @param {{ value: Record<string, unknown> }} options.selectedAccounts
 * @param {Record<string, unknown>} options.platformOverrides
 */
export function usePublishDrafts ({
  article,
  selectedPlatforms,
  selectedAccounts,
  platformOverrides,
}) {
  // 统一通知通道（D1 决策）：toast 走 useNotify（带 notify:log 上报）
  const { notifyError, notifySuccess, notifyWarning, notifyConfirm } = useNotify()
  const showDraftList = ref(false)
  const drafts = ref([])
  const loadingDrafts = ref(false)

  // 定时×草稿互斥守卫（P1-4，2026-10-08 发布页优化 roadmap 第一项）：
  // 本地草稿是静态快照，不会在定时时间自动触发发布——定时只在点击「一键发布」时
  // 进入调度队列。参考产品在引擎层硬拒绝「定时发布不能存草稿」（pubType 互斥）；
  // 本地草稿语义更宽（WIP 快照），改为保存前确认 + 加载时清除过期定时，消灭
  // 「存了带定时的草稿就以为到点自动发」的误解路径。
  async function confirmScheduleDraftConflict () {
    const time = String(article.publishTime || '').trim()
    if (!time) return false
    // 确认 = 清除定时并保存；取消/关闭 = 保留定时保存（两种选择都保存，仅定时字段不同）
    const clearSchedule = await notifyConfirm('publishDrafts.scheduleConflictMessage', {
      params: { time },
      title: t('publishDrafts.scheduleConflictTitle'),
      confirmButtonText: t('publishDrafts.scheduleConflictClear'),
      cancelButtonText: t('publishDrafts.scheduleConflictKeep'),
      type: 'warning',
    })
    return clearSchedule
  }

  // 加载侧守卫：草稿里的定时时间若已过期，静默恢复会让下一次发布被
  // validateScheduleEntries 拒绝（「定时时间已过去」）且用户不知情——
  // 过期判定与清空已下沉到 `applyPublishSnapshot`（唯一实现，与「再次发布」共用），
  // 这里只负责把被清掉的时刻提示给用户。

  function buildDraftSnapshot () {
    const snapshot = {
      id: 'draft_' + Date.now(),
      platforms: toPlainJson(selectedPlatforms.value || []),
      accounts: toPlainJson(selectedAccounts.value || {}),
      platformOverrides: toPlainJson(platformOverrides || {}),
    }
    // 与 applyDraft 对称：数组字段缺失/异常时保存 [] 而非 ''，防止未来新增数组字段漏配 ARRAY_FIELDS 时写回脏值
    for (const field of ARTICLE_FIELDS) {
      // 归因关联例外（QM-6 前端轴 F3）：它是 string|null 语义，不能套通用的 `|| ''` 默认值。
      // 折成空串会让"没关联"与"关联被抹"不可区分，而未来任何 `!= null` 的读法都会把 '' 当成有值。
      if (field === 'rewriteHistoryId') {
        snapshot[field] = normalizeRewriteLineage(article[field])
        continue
      }
      snapshot[field] = ARRAY_FIELDS.has(field)
        ? (Array.isArray(article[field]) ? toPlainJson(article[field]) : [])
        : toPlainJson(article[field] || '')
    }
    return snapshot
  }

  function applyDraft (draft) {
    // 字段映射的唯一实现见 features/publish/publish-snapshot.js（与「再次发布」共用）。
    // 这里只保留草稿箱特有的两件事：过期定时的用户提示 + 关面板。
    const outcome = applyPublishSnapshot(draft, {
      article, selectedPlatforms, selectedAccounts, platformOverrides,
    })
    if (!outcome.applied) return false
    if (outcome.staleScheduleTime) {
      notifyWarning('publishDrafts.staleScheduleCleared', {
        message: t('publishDrafts.staleScheduleCleared', { time: outcome.staleScheduleTime }),
      })
    }
    showDraftList.value = false
    return true
  }

  async function loadDrafts () {
    loadingDrafts.value = true
    try {
      const result = await draftList()
      if (!result || result.code !== 0) {
        throw new Error((result && result.message) || '草稿读取失败')
      }
      drafts.value = Array.isArray(result.data) ? result.data : []
      return drafts.value
    } catch (error) {
      drafts.value = []
      notifyError('publishDrafts.loadFailed', { message: errorMessage(error, t('publishDrafts.loadFailed')) })
      return []
    } finally {
      loadingDrafts.value = false
    }
  }

  async function saveDraft () {
    if (!String(article.title || '').trim() && !String(article.content || '').trim()) {
      notifyWarning('publishDrafts.emptyTitleContent', { message: t('publishDrafts.emptyTitleContent') })
      return { ok: false, draftId: null }
    }
    // 定时×草稿互斥（P1-4）：带定时时间保存 → 用户选择「清除定时并保存」或「保留定时保存」
    if (await confirmScheduleDraftConflict()) {
      article.publishTime = ''
    }
    try {
      const result = await draftSave(buildDraftSnapshot())
      if (!result || result.code !== 0) {
        throw new Error((result && result.message) || t('publishDrafts.saveFailed'))
      }
      notifySuccess('publishDrafts.saved', { message: t('publishDrafts.saved') })
      await loadDrafts()
      // copy-library-detail-entry：返回落库草稿 id（draftSave 指纹幂等 data.draftId），
      // 供发布页【创作视频】跳转 /create?draft=<id> 使用。对象恒 truthy，
      // 注意：返回恒为对象（truthy），消费方必须判 saved.ok——旧布尔消费方不存在（全仓核实）。
      const draftId = result && result.data && result.data.draftId ? String(result.data.draftId) : null
      return { ok: true, draftId }
    } catch (error) {
      notifyError('publishDrafts.saveFailed', { message: errorMessage(error, t('publishDrafts.saveFailed')) })
      return { ok: false, draftId: null }
    }
  }

  async function loadDraft (draftId) {
    const draft = drafts.value.find(item => item && item.id === draftId)
    if (!draft) {
      notifyError('publishDrafts.notFound', { message: t('publishDrafts.notFound') })
      return false
    }
    applyDraft(draft)
    notifySuccess('publishDrafts.loaded', { message: t('publishDrafts.loaded') })
    return true
  }

  async function removeDraft (draftId) {
    try {
      const result = await draftDelete(draftId)
      if (!result || result.code !== 0) {
        throw new Error((result && result.message) || t('publishDrafts.deleteFailed'))
      }
      await loadDrafts()
      notifySuccess('publishDrafts.deleted', { message: t('publishDrafts.deleted') })
      return true
    } catch (error) {
      notifyError('publishDrafts.deleteFailed', { message: errorMessage(error, t('publishDrafts.deleteFailed')) })
      return false
    }
  }

  return {
    showDraftList,
    drafts,
    loadingDrafts,
    buildDraftSnapshot,
    applyDraft,
    loadDrafts,
    saveDraft,
    loadDraft,
    removeDraft,
  }
}
