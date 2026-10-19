// @ts-check
/**
 * useRouteHandoff — 发布页交接参数的**单一入口**（PRD-UI-FLOW-CLARITY §5-S3）
 *
 * ## 要解决的问题（PRD §4.2 规则 4 + §5-S3 警告项）
 * 发布页的交接参数此前分散在 4 处接线：`watch(route.query.draft)`（L1344）、
 * `onMounted`（L1388-1416）、`onActivated`（L1423-1435）、`useHotTopicsDraftHandoff`
 * 与 `usePublishRepublish` 各自的 query watcher。后果：
 *  - 互斥判断只写在 onMounted 一处；`onActivated` 对 `?republish=` **无守卫**直接调用
 *    ⇒ URL 同时带 `?draft=X&republish=Y` 时后到者静默覆盖先到者已写入的表单；
 *  - 每加一个交接参数要在 3-4 处各接一次线，漏一处即静默失效。
 *
 * ## 职责边界（与 PRD 措辞的两处校准，以代码事实为准）
 * 1. 本入口**只消费** `?draft=` / `?drafts=`（批量）/ `?republish=` 的**裁定**，
 *    并把 `?video_path=` 一族预填**叠加**在裁定结果之前（现状语义：视频路径预填与
 *    草稿装载不互斥）。`?mode=` 在当前代码库中**不存在**（模式真源是 `?type=`），
 *    故不实现 PRD 设想的 `?mode=`——避免造一个无人写入的参数。
 * 2. 本入口**不做 URL normalize/rewrite**（PRD 的「白名单透传 republish」针对的是
 *    rewrite 方案；现状各 composable 自行清理地址栏——republish 载入成功后
 *    `usePublishRepublish.js` 主动 replace 掉，draft 不清理），因此不存在透传问题。
 *    互斥裁定的产出是「本次激活消费哪一路」，不是 URL 改写。
 *
 * ## 幂等契约（分层保留）
 *  - 批量：`useHotTopicsDraftHandoff.handoffAppliedKey`（键=本批 id 串）——真源在彼处；
 *  - republish：`usePublishRepublish.appliedIds`（键=记录 id）——真源在彼处；
 *  - 本入口只维护「单篇 draft」的键（现状 watch/onMounted 无幂等，双触发会重复
 *    弹「载入成功」toast），以及 republish 的**透传挡板**（同一 query 串只透传一次，
 *    避免入口被 onMounted+onActivated 双调用时把同一记录交给 appliedIds 两次）。
 *    video_path 预填**不设键**：`usePublishHistoryPrefill` 自带无 query 早退 + 写同值幂等，
 *    且每次激活重跑是现状行为。
 */
import { ref } from 'vue'
import { useHotTopicsDraftHandoff } from './useHotTopicsDraftHandoff'
import { usePublishRepublish } from './usePublishRepublish'
import { usePublishHistoryPrefill } from './usePublishHistoryPrefill'

/**
 * @param {object} deps
 * @param {object} deps.route vue-router route（ref/computed 均可，需 .query）
 * @param {Function} deps.loadDrafts 拉取草稿列表（usePublishDrafts）
 * @param {Function} deps.loadDraft 装载单篇草稿（返回 false = 草稿不存在）
 * @param {Function} deps.applyCopyDetailHandoff 文案库详情态消费（与交接无冲突，置顶执行）
 * @param {Record<string, unknown>} deps.[...rest] 透传给批量/republish/视频预填的依赖
 *   （route/router/article/activeMode/...，签名见各 composable）
 * @param {Function} deps.notifyDraftMissing 单篇草稿缺失提示（key 或 (id)=>void 均可由视图决定）
 */
export function useRouteHandoff (deps) {
  const { route, loadDrafts, loadDraft, notifyDraftMissing } = deps

  const batch = useHotTopicsDraftHandoff(deps)
  const republish = usePublishRepublish(deps)
  const videoPrefill = usePublishHistoryPrefill(deps)

  /** 单篇 draft 已消费的 id（幂等键：同一 id 只装载一次） */
  const appliedDraftIds = new Set()
  /** republish 已透传的 query 串（挡板；真正的幂等键在 appliedIds） */
  let lastRepublishQuery = ''

  /**
   * 按 query 裁定并执行本次激活的交接。
   * 优先级（PRD §5-S3）：批量 ?drafts= > 单篇 ?draft= > ?republish=；
   * `?video_path=` 预填与三者**叠加**（先执行，不参与互斥）。
   * @returns {Promise<{kind: 'batch'|'draft'|'draft-missing'|'republish'|'none', id?: string, count?: number, applied?: boolean}>}
   */
  async function applyRouteHandoff () {
    // 文案库详情态与交接参数无冲突，保持现状「置顶、不依赖前置异步步骤」
    if (typeof deps.applyCopyDetailHandoff === 'function') deps.applyCopyDetailHandoff()

    // 叠加层：历史视频预填（无 video_path 时内部早退，不覆盖既有草稿）
    videoPrefill.applyHistoryVideoQuery()

    const query = (route.value || route).query || {}

    // 1) 批量优先：这批 id 是「刚改写完的 N 条」，必须整体进批量区
    const batchIds = batch.handoffIdsFromQuery()
    if (batchIds.length > 0) {
      const count = await batch.applyDraftHandoff(batchIds)
      return { kind: 'batch', count }
    }

    // 2) 单篇：用户当下的手工选择优先于「再次发布」
    const draftId = query.draft ? String(query.draft) : ''
    if (draftId) {
      if (appliedDraftIds.has(draftId)) return { kind: 'draft', id: draftId }
      await loadDrafts()
      const ok = await loadDraft(draftId)
      if (!ok) {
        // 缺失是**终态**：不回落 republish（另一条数据源，静默回落正是规则 1 反对的隐式副作用）
        appliedDraftIds.add(draftId)
        if (typeof notifyDraftMissing === 'function') notifyDraftMissing(draftId)
        return { kind: 'draft-missing', id: draftId }
      }
      appliedDraftIds.add(draftId)
      return { kind: 'draft', id: draftId }
    }

    // 3) 再次发布：只在 1/2 都不存在的**本次激活**消费（互斥在此一次性裁定，
    //    不允许两个 watcher 各自判断）。同 query 串只透传一次。
    if (query.republish) {
      const key = String(query.republish)
      if (key !== lastRepublishQuery) {
        lastRepublishQuery = key
        const applied = await republish.applyRepublishFromQuery()
        return { kind: 'republish', applied }
      }
      return { kind: 'republish', applied: false }
    }

    return { kind: 'none' }
  }

  return {
    applyRouteHandoff,
    /** 透传给视图的既有能力（批量区工具条仍需） */
    handoffAppliedKey: batch.handoffAppliedKey,
    batchTargetPlatforms: batch.batchTargetPlatforms,
    handoffPlatformOptions: batch.handoffPlatformOptions,
    buildDefaultTargets: batch.buildDefaultTargets,
    applyBatchTargetsToAll: batch.applyBatchTargetsToAll,
    applyDraftHandoff: batch.applyDraftHandoff,
    handoffIdsFromQuery: batch.handoffIdsFromQuery,
    parseHandoffDraftIds: batch.parseHandoffDraftIds,
  }
}
