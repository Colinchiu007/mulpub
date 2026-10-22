// @ts-check
/**
 * batch-check-summary.js — 「一键检测」结果提示的装配器（2026-10-22 fix-batch-check-toast-unify）
 *
 * 为什么单独成模块（而不是继续躺在 Accounts.vue 里）：
 * ① Accounts.vue 在 check-max-lines 点名还账清单上（登记值 1578 行、**零增长容差**），
 *    本次修复要在其中新增「提示统一」逻辑，就地写必然超限；
 * ② 这段逻辑是**纯字符串装配**（三态计数 + 下一步 + 固化失败 → 一句文案），
 *    抽成纯函数后可以在 node 环境下直接单测，不必 mount 整个 Vue 视图 ——
 *    而"一次点击只能有一条 toast"这条契约最容易被无意破坏，值得有独立锁；
 * ③ 段序、分隔符、空段处理是本模块唯一的正确性所在，集中一处才说得清。
 *
 * ⚠️ 三条不可破：
 * 1. **一次操作一条提示**：本模块只返回 { level, message } 一个对象，调用方据此弹一条 toast。
 *    不得返回数组让调用方循环弹 —— 那正是用户报"弹了 4 条还互相矛盾"的根因。
 * 2. **空段不留下悬空分隔符**：任一段为空即从数组中消失，用 filter(Boolean) 保证；
 *    绝不允许出现「检测完成：…；；」或「…；另有 0 个…」这种形状。
 * 3. **级别只由三态结论决定，固化失败不参与定级**：固化失败是尾段，跟着它所在那句走。
 *    原实现为它单独弹红色 error，把「部分账号结论没落库」渲染成「整个检测失败」。
 *
 * 文案来源：调用方传入 `t`（vue-i18n 的 t），本模块不 import locales ——
 * 保持纯函数、可在 node 环境下测（zh/en 成对由 locales 自身与 CI Gate 7 保证）。
 *
 * 导出形态：**ESM**（`export function` / `export const`）。本文件被渲染层 Accounts.vue import，
 * 走 vite/rollup 的 ESM 链 —— 早期写成 CommonJS `module.exports` 时 vite build 直接
 * "buildBatchCheckSummary is not exported by src/views/batch-check-summary.js"。
 * 单测同样用 ESM import，两侧同一形态，不存在双轨导出。
 */

/**
 * @typedef {Object} BatchCheckSummaryInput
 * @property {number} [validCount] 检测有效（valid===true）的账号数
 * @property {number} [invalidCount] 检测失效（valid===false）的账号数
 * @property {number} [unconfirmedCount] 本轮未取到定论（valid===undefined）的账号数
 * @property {number} [reloginCount] hint.action==='relogin' 的账号数（建议重新登录）
 * @property {number} [retryCount] hint.action==='retry' 的账号数（建议稍后重试）
 * @property {number} [persistFailedCount] 主进程固化失败（persisted.ok===false）的账号数
 * @property {(key: string, params?: object) => string} [t] i18n 翻译函数；缺省时返回 null
 */

/** 段间分隔符：中文全角分号。与汇总句内部的「，」分层，让用户看出这是补充段而非又一个计数。 */
export const SEGMENT_SEPARATOR = '；'

/**
 * 装配一键检测的结果提示。
 *
 * 段序固定：**计数 → 下一步 → 固化失败**。
 *  - 全部有定论时走短句（`batchCheckAllAllValid`），不带计数细节，也不带下一步段；
 *  - 有失效或未定论时走汇总句（`batchCheckAllDone`），三段按序拼接；
 *  - 没有任何账号时返回 null（调用方不弹 toast）。
 *
 * @param {BatchCheckSummaryInput} input
 * @returns {{level: 'success'|'warning', message: string}|null}
 */
export function buildBatchCheckSummary (input) {
  const {
    validCount = 0, invalidCount = 0, unconfirmedCount = 0,
    reloginCount = 0, retryCount = 0, persistFailedCount = 0,
    t,
  } = input || {}

  if (typeof t !== 'function') return null
  // 一个账号都没有（results 为空）：调用方已在更早的分支处理「暂无可检测的账号」，
  // 这里只兜底「结果集为空」的形状，不弹一条空洞的「检测完成」。
  const total = validCount + invalidCount + unconfirmedCount
  if (total === 0 && persistFailedCount === 0) return null

  const persistSegment = persistFailedCount > 0
    ? t('accountsPage.checkHintsPersistFailedInline', { count: persistFailedCount })
    : ''

  // 全部有定论 → success。固化失败仍要拼上（此时它是唯一需要用户知道的信息）。
  if (invalidCount === 0 && unconfirmedCount === 0) {
    const head = validCount > 0 ? t('accountsPage.batchCheckAllAllValid', { count: validCount }) : ''
    const message = [head, persistSegment].filter(Boolean).join(SEGMENT_SEPARATOR)
    return message ? { level: 'success', message } : null
  }

  const countSegment = t('accountsPage.batchCheckAllDone', {
    valid: validCount,
    invalid: invalidCount,
    unconfirmed: unconfirmedCount,
  })
  const hintSegment = t('accountsPage.checkHintsSummaryInline', {
    relogin: reloginCount,
    retry: retryCount,
  })
  const message = [countSegment, hintSegment, persistSegment].filter(Boolean).join(SEGMENT_SEPARATOR)
  return message ? { level: 'warning', message } : null
}
