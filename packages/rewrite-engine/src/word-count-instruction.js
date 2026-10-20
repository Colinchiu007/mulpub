/**
 * word-count-instruction.js — 字数区间指令的生成（collect-rewrite-wordcount，2026-10-20）
 *
 * 为什么独立成模块：`rewrite-engine-core.js` 的行数挂账（`check-max-lines.js` 的 LEDGER_GREW，
 * 登记值 578 + 容差 200 = 778 行天花板）在本次改动前只剩 4 行余量，任何「再往核心里加东西」
 * 都会顶破天花板并把**别人**的 PR 一起卡红。同族先例：`segment-rewriter.js` 也是从核心文件里
 * 拆出来的独立能力（核心文件头注释里记着同一条理由）。
 *
 * 契约：
 *   - 输入 = **已通过合法性校验**的 `{min, max}` 区间 + 原文码点数；
 *   - 输出 = 注入 systemPrompt 的一句字数要求（区间语义缺失时返回空串）。
 *
 * ⚠️ 区间**合法性校验留在核心文件**（`rewrite-engine-core.js::_getWordCountInstruction`）：
 * 渲染层的结构锁（`apps/desktop/src/utils/rewrite-engine-limits.test.js`）要求
 * `range.max <= MAX_OUTPUT_CHARS` 这条判据**逐字留在** rewrite-engine-core.js 里，
 * 且两个上限常量也必须定义在该文件。拆模块时不要把校验一并搬走。
 */

/**
 * 推导「与原文篇幅相当」的目标字数。
 *
 * target = min(原文码点数, 上限)：
 *   - 原文短于上限 ⇒ target = 原文长度（改写不该凭空缩水）；
 *   - 上限低于原文 ⇒ target = 上限（压缩是用户自己设的），此时「不超过上限」与
 *     「目标约 N 字」两句话不会自相矛盾（若 target 取原文长度，就会出现
 *     「目标 3000 字」却「不得超过 2000 字」的自冲突指令）。
 *
 * @param {{min:number,max:number}} range - 已校验合法的区间
 * @param {number} [originalLength] - 原文码点数
 * @returns {number}
 */
function computeWordCountTarget (range, originalLength) {
  const original = Number.isFinite(originalLength) && originalLength > 0 ? originalLength : 0
  if (original <= 0) return range.max
  return Math.min(original, range.max)
}

/**
 * 构建字数区间指令。
 *
 * `min > 0`（有下限）：「改写后的文本长度必须控制在 {min} 到 {max} 字之间。」
 *
 * `min = 0`（**无下限**，合法值，collect-rewrite-wordcount）：不能渲染成「0 到 {max} 字之间」——
 * 那句话把「不设下限」说成了「可以任意短」，模型会照着下限写，把改写做成摘要
 * （实测：3515 字原文 + 区间 0-6000 ⇒ 输出 1229 字摘要，且用户看不出异常）。
 * 因此 min=0 走另一条形态：给硬上限 + 给一个「与原文篇幅相当」的目标篇幅 + 反摘要约束。
 *
 * @param {{min:number,max:number}} range - 已校验合法的区间
 * @param {number} [originalLength] - 原文码点数
 * @returns {string}
 */
function buildWordCountInstruction (range, originalLength) {
  if (range.min > 0) {
    return `【字数要求】改写后的文本长度必须控制在 ${range.min} 到 ${range.max} 字之间。`
  }
  const target = computeWordCountTarget(range, originalLength)
  return `【字数要求】改写后的文本长度不得超过 ${range.max} 字。目标篇幅约 ${target} 字（与原文篇幅相当）；不要把原文压缩成摘要，不得省略原文的信息点。`
}

module.exports = { buildWordCountInstruction, computeWordCountTarget }
