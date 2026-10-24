// @ts-check
/**
 * useRewriteResultInvalidation — 改写结果变化时的「已存草稿 / 归因链」作废契约
 * （fix-collection-rewrite-publish-flow，2026-10-20）。
 *
 * ## 它守的不变量
 *
 * ① **改写结果一变 ⇒ 已存草稿立即作废。**
 *    事故：采集页「一键改写」后再「AI 改写」，然后「去发布 → 视频创作」，带进去的是
 *    **第一次**改写的文案。根因不是取错字段，而是 `genreDraftId`（已存草稿 id）
 *    在改写结果变化时**从不被作废** ⇒ `goPublishAfterRewrite` 见到它非空就跳过重存。
 *    改写页（RewriteView）早就有 `invalidateSavedDraft()` 这道防护，采集页漏了同一条。
 *
 * ② **归因链 id 只在「用户手改正文」时作废。**
 *    程序赋值（新一轮改写）时，归因 id 刚由引擎信封写入，与新正文是一对，**自清反而制造
 *    假归因**（界面上那份正文已经不是 rewrite_history 行里存的那条了）。
 *
 * ## 为什么抽成 composable
 *
 * 这两条原本是 `Collection.vue` 里的两个裸 `let` + 一个内联 `watch`——判定口径埋在
 * 2000+ 行视图里，既难单测，也没法为「手改」与「程序赋值」**分别**写用例。
 * 抽出来后：判据只有一份实现，两条路径各有独立的行为级用例（见同名 `.test.js`）。
 *
 * ## 为什么 `flush: 'sync'`
 *
 * 改写完成 → 用户点「去发布」之间不留竞态窗口：`sync` 让作废发生在赋值的**同一刻**，
 * 而不是下一个微任务。
 */
import { watch } from 'vue'

/**
 * @param {object} input
 * @param {import('vue').Ref<string>} input.rewriteResult 当前改写结果（ref）
 * @param {() => void} input.invalidateDraftId 已存草稿 id 作废（置空）
 * @param {() => void} input.invalidateLineageId 归因链 id 作废（置空）
 * @returns {{markProgrammaticAssignment: (content: string) => void}}
 */
export function useRewriteResultInvalidation ({ rewriteResult, invalidateDraftId, invalidateLineageId }) {
  /** 最近一次**程序赋值**的正文（用于区分「程序改写」与「用户手改」） */
  let lastProgrammatic = ''

  /**
   * 标记「本次是程序赋值」（必须在 `rewriteResult.value = content` **之前**调用）。
   * @param {string} content
   */
  function markProgrammaticAssignment (content) {
    lastProgrammatic = content
  }

  watch(rewriteResult, (next, prev) => {
    if (next === prev) return
    // ① 内容一变，旧草稿即刻作废（两种来源都作废）
    invalidateDraftId()
    // ② 只有用户手改正文才作废归因链（程序赋值的那一对是配好的）
    if (next !== lastProgrammatic) invalidateLineageId()
  }, { flush: 'sync' })

  return { markProgrammaticAssignment }
}
