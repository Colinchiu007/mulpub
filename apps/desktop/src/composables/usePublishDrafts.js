// @ts-check
import { ref } from 'vue'
import { draftDelete, draftList, draftSave } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'
import { normalizeRewriteLineage } from '@/utils/rewrite-lineage'
import { normalizePublishStringList } from '@/features/publish/publish-contract'
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

function replaceRecord (target, source) {
  for (const key of Object.keys(target)) delete target[key]
  Object.assign(target, toPlainJson(source || {}))
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
  // 恢复时直接清除并提示。
  function clearStaleDraftSchedule (draft) {
    const time = String((draft && draft.publishTime) || '').trim()
    if (!time) return
    const ts = Date.parse(time)
    if (Number.isNaN(ts) || ts > Date.now()) return
    article.publishTime = ''
    notifyWarning('publishDrafts.staleScheduleCleared', { message: t('publishDrafts.staleScheduleCleared', { time }) })
  }

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
    if (!draft || typeof draft !== 'object') return false
    for (const field of ARTICLE_FIELDS) {
      // 同上：归因关联必须落到 null（含"这份草稿没有关联"时清掉 article 上的旧值），
      // 不得沿用 `|| ''`，也不得在键缺席时保持现状——否则跨草稿会串关联。
      if (field === 'rewriteHistoryId') {
        article[field] = normalizeRewriteLineage(draft[field])
        continue
      }
      article[field] = ARRAY_FIELDS.has(field)
        ? (Array.isArray(draft[field]) ? toPlainJson(draft[field]) : [])
        : (draft[field] || '')
    }
    // 话题标签统一（topic-tag-unify）：UI 只剩「话题标签」一个入口（tags），
    // 历史草稿的 topics 一次性并入 tags，topics 字段清空防双份——引擎侧
    // mergeUniqueStrings 本就合并两者，这里提前合并让 UI 显示不缺话题。
    // 归一口径与引擎侧一致（normalizePublishStringList：拆分逗号/顿号、
    // 剥 # 前缀由发布链处理、Set 去重），禁止第二份归一实现。
    const mergedTags = normalizePublishStringList([
      ...(Array.isArray(article.tags) ? article.tags : []),
      ...(Array.isArray(draft.topics) ? draft.topics : []),
    ])
    article.tags = mergedTags
    article.topics = []
    // 定时×草稿互斥（P1-4）：恢复后清除已过期的定时时间（见 clearStaleDraftSchedule）
    clearStaleDraftSchedule(draft)
    selectedPlatforms.value = Array.isArray(draft.platforms)
      ? toPlainJson(draft.platforms)
      : []
    selectedAccounts.value = draft.accounts && typeof draft.accounts === 'object'
      ? toPlainJson(draft.accounts)
      : {}
    replaceRecord(platformOverrides, draft.platformOverrides)
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
