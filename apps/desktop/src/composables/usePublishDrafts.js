// @ts-check
import { computed, ref } from 'vue'
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
  // S1c：showDraftList 已删除 —— 草稿箱收敛为唯一整页视图（/publish?tab=drafts），
  // 不再有页内浮层需要开关状态。原 ref 仅供浮层 v-if 使用，随浮层一并下线。
  const drafts = ref([])
  const loadingDrafts = ref(false)
  // 批量删除（draft-batch-delete）：勾选集与删除中状态。
  // 选中值统一存字符串（id 的历史形态有数字/字符串两种，混存会让 includes 假阴性）。
  const selectedDraftIds = ref([])
  const deletingDrafts = ref(false)

  function draftKey (draft) {
    if (!draft || draft.id === null || draft.id === undefined) return ''
    return String(draft.id).trim()
  }

  const selectedDraftCount = computed(() => selectedDraftIds.value.length)
  const allDraftsSelected = computed(() =>
    drafts.value.length > 0 && drafts.value.every(draft => selectedDraftIds.value.includes(draftKey(draft))))

  function isDraftSelected (draft) {
    return selectedDraftIds.value.includes(draftKey(draft))
  }

  function toggleDraftSelection (draft) {
    const key = draftKey(draft)
    if (!key) return
    selectedDraftIds.value = selectedDraftIds.value.includes(key)
      ? selectedDraftIds.value.filter(id => id !== key)
      : [...selectedDraftIds.value, key]
  }

  /** 全选 / 清空：当前已全选则清空，否则选中当前列表全部。 */
  function toggleAllDrafts () {
    selectedDraftIds.value = allDraftsSelected.value
      ? []
      : drafts.value.map(draftKey).filter(Boolean)
  }

  function clearDraftSelection () {
    selectedDraftIds.value = []
  }

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
      // 列表刷新后同步选中集：已不存在的草稿不能继续留在勾选里，
      // 否则「删除选中」会带着幽灵 id 去请求，提示条数也对不上。
      const existing = new Set(drafts.value.map(draftKey).filter(Boolean))
      selectedDraftIds.value = selectedDraftIds.value.filter(id => existing.has(id))
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
    // id 一律按字符串比：历史数据里有数字 id，`7 !== "7"` 会让「继续编辑」误报草稿不存在。
    const wanted = draftId === null || draftId === undefined ? '' : String(draftId).trim()
    const draft = drafts.value.find(item => item && draftKey(item) === wanted)
    if (!draft) {
      notifyError('publishDrafts.notFound', { message: t('publishDrafts.notFound') })
      return false
    }
    applyDraft(draft)
    notifySuccess('publishDrafts.loaded', { message: t('publishDrafts.loaded') })
    return true
  }

  /**
   * 删除一份或多份草稿（draft-batch-delete）。
   *
   * 单条与批量共用本函数、共用一次 IPC：批量删除若退化成循环单删，N 条就是
   * N 次落盘 + N 次列表刷新，中途失败会留下半删状态，用户也看不懂到底删了几条。
   * @param {string|string[]} draftIds
   * @returns {Promise<{ ok: boolean, deleted: number, requested: number }>}
   */
  async function removeDrafts (draftIds) {
    const ids = [...new Set((Array.isArray(draftIds) ? draftIds : [draftIds])
      .map(id => (id === null || id === undefined ? '' : String(id).trim()))
      .filter(Boolean))]
    if (ids.length === 0) return { ok: false, deleted: 0, requested: 0 }
    deletingDrafts.value = true
    try {
      const result = await draftDelete(ids)
      if (!result || result.code !== 0) {
        throw new Error((result && result.message) || t('publishDrafts.deleteFailed'))
      }
      const deleted = typeof result.data?.deleted === 'number' ? result.data.deleted : ids.length
      // 先摘掉已删的勾选，再刷新列表：即使刷新失败，选中集也不会留下幽灵 id。
      selectedDraftIds.value = selectedDraftIds.value.filter(id => !ids.includes(id))
      await loadDrafts()
      if (ids.length === 1) {
        notifySuccess('publishDrafts.deleted', { message: t('publishDrafts.deleted') })
      } else if (deleted < ids.length) {
        // 部分成功必须如实说（并发窗口里被别处删掉的条目会落到这里）
        notifyWarning('publishDrafts.batchDeletePartial', {
          message: t('publishDrafts.batchDeletePartial', { deleted, requested: ids.length }),
        })
      } else {
        notifySuccess('publishDrafts.batchDeleted', {
          message: t('publishDrafts.batchDeleted', { count: deleted }),
        })
      }
      return { ok: true, deleted, requested: ids.length }
    } catch (error) {
      notifyError('publishDrafts.deleteFailed', { message: errorMessage(error, t('publishDrafts.deleteFailed')) })
      return { ok: false, deleted: 0, requested: ids.length }
    } finally {
      deletingDrafts.value = false
    }
  }

  async function removeDraft (draftId) {
    const result = await removeDrafts([draftId])
    return result.ok
  }

  /**
   * 删除当前勾选的草稿。二次确认是本操作唯一的「撤销位」——草稿删除不可恢复，
   * 批量入口一次能删掉整屏，误点的代价远高于多一次确认。
   */
  async function removeSelectedDrafts () {
    const ids = [...selectedDraftIds.value]
    if (ids.length === 0) return { ok: false, deleted: 0, requested: 0 }
    const confirmed = await notifyConfirm('publishDrafts.batchDeleteConfirmMessage', {
      params: { count: ids.length },
      title: t('publishDrafts.batchDeleteConfirmTitle'),
      confirmButtonText: t('publishDrafts.batchDeleteConfirm'),
      cancelButtonText: t('publishDrafts.batchDeleteCancel'),
      type: 'warning',
    })
    if (!confirmed) return { ok: false, deleted: 0, requested: ids.length }
    return removeDrafts(ids)
  }

  return {
    drafts,
    loadingDrafts,
    selectedDraftIds,
    selectedDraftCount,
    allDraftsSelected,
    deletingDrafts,
    isDraftSelected,
    toggleDraftSelection,
    toggleAllDrafts,
    clearDraftSelection,
    buildDraftSnapshot,
    applyDraft,
    loadDrafts,
    saveDraft,
    loadDraft,
    removeDraft,
    removeDrafts,
    removeSelectedDrafts,
  }
}
