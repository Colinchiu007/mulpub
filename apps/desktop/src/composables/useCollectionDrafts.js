// @ts-check
import { computed, ref } from 'vue'
import { draftDelete, draftList, draftSave } from '@/api/publisher'
import { formatUserError } from '@/utils/user-facing-error'
import { normalizeRewriteLineage } from '@/utils/rewrite-lineage'
import { useNotify } from './useNotify'
import i18n from '@/i18n'

const t = (key, params) => i18n.global.t(key, params || {})

/**
 * 采集页草稿箱用例。
 *
 * ## 为什么要有这个 composable（统一草稿真源，2026-10-12）
 *
 * 此前应用里存在两套草稿写入方言，而它们**物理落在同一行存储**：
 *   · 发布页：`draftSave` / `draftList` → `store.getUserSetting('drafts', owner)`
 *   · 采集页：`storeGetSetting('drafts')` → `store:get-setting` → **同一个**
 *     `scopedSettingKey('drafts', owner)`，即 `user:<ns>:drafts`
 * 后果是两侧互相污染：发布页草稿出现在采集页列表里却读不到 `created_at`
 * （它写的是 ISO `createdAt`）而显示空白时间；采集页草稿没有 `platforms`，
 * 在发布页列表里显示 0 平台；且 `computeDraftFingerprint` 只算标题正文，
 * 同内容的两份草稿会互相合并覆盖。
 *
 * 统一方案：**写入一律走 `draftSave`**（享受指纹幂等 + `createdAt`/`updatedAt`），
 * 读取走 `draftList`，并按 `resolveCreatedAt` 兼容历史 `created_at` 字段。
 */
export function useCollectionDrafts () {
  const { notifyError, notifySuccess, notifyWarning, notifyConfirm } = useNotify()

  const drafts = ref([])
  const loading = ref(false)
  const loadError = ref('')

  /**
   * 时间戳归一：历史采集页草稿写的是 `created_at`（toLocaleString('zh-CN') 的
   * 本地化字符串），发布页草稿写的是 ISO `createdAt`。两者都要能显示，
   * 缺任一侧就退化成「另一套草稿时间全空白」。
   */
  function resolveCreatedAt (draft) {
    if (!draft || typeof draft !== 'object') return ''
    return String(draft.createdAt || draft.created_at || draft.updatedAt || draft.updated_at || '')
  }

  /** 正文摘要（卡片副标题用）；图片/视频类草稿正文可能为空，此时如实回落。 */
  function resolveSummary (draft, max = 60) {
    const text = String((draft && draft.content) || '').replace(/\s+/g, ' ').trim()
    if (!text) return ''
    return text.length > max ? text.slice(0, max) + '…' : text
  }

  function resolveWordCount (draft) {
    return String((draft && draft.content) || '').length
  }

  /** 平台数：发布页草稿带 platforms；采集页产生的草稿为 0，卡片据此隐藏该标签。 */
  function resolvePlatformCount (draft) {
    return Array.isArray(draft && draft.platforms) ? draft.platforms.length : 0
  }

  const sortedDrafts = computed(() => {
    const list = Array.isArray(drafts.value) ? drafts.value.slice() : []
    return list.sort((a, b) => {
      const ta = Date.parse(resolveCreatedAt(a)) || 0
      const tb = Date.parse(resolveCreatedAt(b)) || 0
      return tb - ta
    })
  })

  const draftCount = computed(() => sortedDrafts.value.length)

  async function loadDrafts () {
    loading.value = true
    loadError.value = ''
    try {
      const result = await draftList()
      if (!result || result.code !== 0) {
        throw new Error((result && result.message) || t('collection.draftsLoadFailed'))
      }
      drafts.value = Array.isArray(result.data) ? result.data : []
      return drafts.value
    } catch (error) {
      drafts.value = []
      loadError.value = formatUserError(error, { fallback: t('collection.draftsLoadFailed') }).message
      notifyError('collection.draftsLoadFailed', { message: loadError.value })
      return []
    } finally {
      loading.value = false
    }
  }

  /**
   * 保存草稿：走 draftSave，由主进程指纹幂等去重（同内容不追加第二条）。
   *
   * @param {object} payload 至少含 title/content；source/sourceUrl/coverImage 为采集溯源
   * @param {object} [options]
   * @param {boolean} [options.allowEmpty=false] 允许「标题正文全空」保存。
   *   只有「新建空白草稿 → 跳发布页继续写」这一条路径需要它：主进程指纹把全空
   *   内容算成同一个 EMPTY_FINGERPRINT，若不开这个口子，用户连点「新建草稿」
   *   永远跳不出第二份空白草稿。其余路径（采集/剪贴板/改写产物）一律不得开，
   *   否则空内容草稿会互相合并且无法分辨。
   * @returns {Promise<{ok: boolean, draftId: string|null}>}
   */
  async function saveDraft (payload, options) {
    const opts = options && typeof options === 'object' ? options : {}
    const input = payload && typeof payload === 'object' ? payload : {}
    const title = String(input.title || '').trim()
    const content = String(input.content || '').trim()
    if (!title && !content && !opts.allowEmpty) {
      notifyWarning('collection.draftsEmptyContent')
      return { ok: false, draftId: null }
    }
    try {
      const snapshot = {
        id: 'draft_' + Date.now(),
        title,
        content,
        // 与 usePublishDrafts.buildDraftSnapshot 保持同构：数组字段一律 []，
        // 否则发布侧 publish-contract 的「images 文件引用无效」会阻断纯文字草稿。
        images: Array.isArray(input.images) ? input.images : [],
        image_files: Array.isArray(input.image_files) ? input.image_files : [],
        tags: Array.isArray(input.tags) ? input.tags : [],
        topics: Array.isArray(input.topics) ? input.topics : [],
        mentions: Array.isArray(input.mentions) ? input.mentions : [],
        author: String(input.author || ''),
        cover_url: String(input.cover_url || input.coverImage || ''),
        cover_path: String(input.cover_path || ''),
        cover_file: String(input.cover_file || ''),
        video_path: String(input.video_path || ''),
        platforms: Array.isArray(input.platforms) ? input.platforms : [],
        accounts: input.accounts && typeof input.accounts === 'object' ? input.accounts : {},
        platformOverrides: input.platformOverrides && typeof input.platformOverrides === 'object'
          ? input.platformOverrides
          : {},
      }
      // 归因链：改写产物必须把 rewriteHistoryId 一起存，否则「从草稿去发布」
      // 这条主路径接不上（与 usePublishDrafts 同一白名单语义）。
      snapshot.rewriteHistoryId = normalizeRewriteLineage(input.rewriteHistoryId)
      // 采集溯源：发布页草稿没有这两个字段，写入不影响发布侧读取（读端白名单不含）。
      snapshot.source = String(input.source || '')
      snapshot.sourceUrl = String(input.sourceUrl || '')

      const result = await draftSave(snapshot)
      if (!result || result.code !== 0) {
        throw new Error((result && result.message) || t('collection.draftsSaveFailed'))
      }
      const draftId = result && result.data && result.data.draftId
        ? String(result.data.draftId)
        : null
      await loadDrafts()
      return { ok: true, draftId }
    } catch (error) {
      const message = formatUserError(error, { fallback: t('collection.draftsSaveFailed') }).message
      notifyError('collection.draftsSaveFailed', { message })
      return { ok: false, draftId: null }
    }
  }

  async function removeDraft (draftId) {
    if (!draftId) return false
    const confirmed = await notifyConfirm('collection.confirmDeleteDraft', {
      title: t('collection.confirmTitle'),
    })
    if (!confirmed) return false
    try {
      const result = await draftDelete(draftId)
      if (!result || result.code !== 0) {
        throw new Error((result && result.message) || t('collection.deleted'))
      }
      await loadDrafts()
      notifySuccess('collection.deleted')
      return true
    } catch (error) {
      const message = formatUserError(error, { fallback: t('collection.draftsDeleteFailed') }).message
      notifyError('collection.draftsDeleteFailed', { message })
      return false
    }
  }

  return {
    drafts,
    sortedDrafts,
    draftCount,
    loading,
    loadError,
    loadDrafts,
    saveDraft,
    removeDraft,
    resolveCreatedAt,
    resolveSummary,
    resolveWordCount,
    resolvePlatformCount,
  }
}
