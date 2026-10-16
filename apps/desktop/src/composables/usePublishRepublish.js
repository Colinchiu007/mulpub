/**
 * usePublishRepublish — 发布页的「再次发布」入口（PRD-PUBLISH-RECORD-REPUBLISH-2026-10-15）
 *
 * 为什么独立成 composable：`Publish.vue` 是本仓逐文件行数门禁（`check-max-lines.js`）
 * 点名的超大文件，功能的**逻辑**不该继续堆在视图里；视图只保留「一行接线」。
 *
 * 三件事在这里收口，视图不再各写一份：
 *   ① 按记录 ID 惰性拉快照（列表只下发 `hasRepublishSnapshot` 布尔，正文不随列表走）
 *   ② 覆盖前确认（载入会丢掉用户正在编辑的内容，属不可逆操作）
 *   ③ 原账号已不可用时降级并提示（而不是静默发布到错误账号）
 *
 * 字段映射**不在这里**：它属于 `features/publish/publish-snapshot.js`（与草稿箱共用），
 * 这里只负责「取、问、写回、提示」四步编排。
 */
import { watch } from 'vue'
import { historyGetRepublishSnapshot } from '@/api/publisher'
import { applyPublishSnapshot } from '@/features/publish/publish-snapshot'

/**
 * @param {object} deps
 * @param {object} deps.route vue-router route
 * @param {object} deps.router vue-router router
 * @param {Record<string, unknown>} deps.article 发布表单（就地修改）
 * @param {{value: string[]}} deps.selectedPlatforms
 * @param {{value: Record<string, unknown>}} deps.selectedAccounts
 * @param {Record<string, unknown>} deps.platformOverrides 分平台覆盖（视图里叫 diffEdits）
 * @param {(platform: string) => Array<{id: unknown}>} deps.getAccounts
 * @param {(extra?: object) => object} deps.editorQuery 回到「发布」标签的 query 构造函数
 * @param {(key: string, named?: object) => string} deps.t
 * @param {(key: string, opts?: object) => void} deps.notifyError
 * @param {(key: string, opts?: object) => void} deps.notifyWarning
 * @param {(key: string, opts?: object) => void} deps.notifySuccess
 * @param {(key: string, opts?: object) => Promise<boolean>} deps.notifyConfirm
 */
export function usePublishRepublish (deps) {
  const {
    route, router, article, selectedPlatforms, selectedAccounts, platformOverrides,
    getAccounts, editorQuery, t, notifyError, notifyWarning, notifySuccess, notifyConfirm,
  } = deps

  // 幂等键：同一条记录只应用一次（keep-alive 下 onActivated 与 query watcher 会都触发）
  const appliedIds = new Set()

  /**
   * 把 selectedAccounts 里指向已删除账号的条目清掉；返回被清掉的平台名列表。
   * 账号列表尚未加载（或该平台没有账号数据）时**不误清** —— 宁可让发布时的账号校验拦住，
   * 也不要把用户可用的账号静默删掉。
   */
  function pruneMissingAccounts () {
    const cleared = []
    const map = selectedAccounts.value && typeof selectedAccounts.value === 'object' ? selectedAccounts.value : {}
    for (const platform of Object.keys(map)) {
      const wanted = Array.isArray(map[platform]) ? map[platform].map(String).filter(Boolean) : []
      if (wanted.length === 0) continue
      const available = (typeof getAccounts === 'function' ? (getAccounts(platform) || []) : [])
        .map(account => String((account && account.id) || ''))
        .filter(Boolean)
      if (available.length === 0) continue
      const kept = wanted.filter(id => available.includes(id))
      if (kept.length === wanted.length) continue
      map[platform] = kept
      cleared.push(platform)
    }
    return cleared
  }

  /** @param {string} recordId @returns {Promise<boolean>} 是否真的写回了表单 */
  async function applyRepublishSnapshot (recordId) {
    const id = String(recordId || '').trim()
    if (!id || appliedIds.has(id)) return false
    appliedIds.add(id)
    const abort = () => { appliedIds.delete(id); return false }

    let snapshot
    try {
      const res = await historyGetRepublishSnapshot(id)
      if (!res || res.code !== 0) {
        notifyError('publishPage.republishLoadFailed', { message: t('publishPage.republishLoadFailed') })
        return abort()
      }
      snapshot = res.data && res.data.snapshot
    } catch {
      notifyError('publishPage.republishLoadFailed', { message: t('publishPage.republishLoadFailed') })
      return abort()
    }
    // 「没有快照」是正常业务态（早期记录 / 已按上限淘汰），不是错误：措辞必须区分
    if (!snapshot) {
      notifyWarning('publishPage.republishMissing', { message: t('publishPage.republishMissing') })
      return abort()
    }

    // 「有没有未保存输入」只判正文会漏掉「用户只改了封面/视频/话题/图片/已选账号」这一整类
    // ——那些同样是不可逆的覆盖面（CCG 深度审查 i4）。平台预选不算用户输入，故判已选账号
    // 而不是 selectedPlatforms。
    const hasUnsavedInput = Boolean(
      String(article.title || '').trim() ||
      String(article.content || '').trim() ||
      article.cover_url || article.cover_path || article.cover_file || article.video_path ||
      (Array.isArray(article.images) && article.images.length > 0) ||
      (Array.isArray(article.tags) && article.tags.length > 0) ||
      (Array.isArray(article.topics) && article.topics.length > 0) ||
      Object.values(selectedAccounts.value || {}).some(list => Array.isArray(list) && list.length > 0)
    )
    if (hasUnsavedInput) {
      const confirmed = await notifyConfirm('publishPage.republishDiscardConfirmMessage', {
        title: t('publishPage.republishDiscardConfirmTitle'),
        confirmButtonText: t('publishPage.republishDiscardConfirmButton'),
        type: 'warning',
      })
      if (!confirmed) return abort()
    }

    const outcome = applyPublishSnapshot(snapshot, {
      article, selectedPlatforms, selectedAccounts, platformOverrides,
    })
    if (!outcome.applied) {
      notifyError('publishPage.republishLoadFailed', { message: t('publishPage.republishLoadFailed') })
      return abort()
    }

    if (pruneMissingAccounts().length > 0) {
      notifyWarning('publishPage.republishAccountUnavailable', { message: t('publishPage.republishAccountUnavailable') })
    }
    // 地址栏去掉参数：刷新不重复载入，也避免用户把这条 URL 当成「永久指向某次发布」
    router.replace({ path: '/publish', query: editorQuery() })
    notifySuccess('publishPage.republishLoaded', { message: t('publishPage.republishLoaded') })
    return true
  }

  /**
   * 从 `?republish=<recordId>` 载入。onMounted / onActivated 两处共用同一入口
   * （keep-alive 下 onMounted 不会再跑，只有 query 变化与激活事件）。
   */
  async function applyRepublishFromQuery () {
    const id = route.query && route.query.republish
    if (!id) return false
    return applyRepublishSnapshot(String(id))
  }

  /** query 变化即载入（同一记录不重复应用，见 appliedIds） */
  function watchRepublishQuery () {
    watch(() => route.query.republish, async (id, prev) => {
      if (!id || id === prev) return
      await applyRepublishSnapshot(String(id))
    })
  }

  return { applyRepublishFromQuery, applyRepublishSnapshot, pruneMissingAccounts, watchRepublishQuery }
}
