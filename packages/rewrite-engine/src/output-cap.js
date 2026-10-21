/**
 * output-cap.js —— 改写输出的**长度上限**判定（collection-ux-step-flow，2026-10-20）
 *
 * 为什么独立成一个文件：`packages/rewrite-engine/src/rewrite-engine-core.js` 的登记值
 * 已接近 max-lines 容差上限（登记 578 / limit 500 / 容差 200），而「上限取谁」这条规则
 * 有三种输入形态（用户显式区间 / 统一上限 / 策略形态上限），写在核心里会把它顶过容差
 * （实测 CI 红：LEDGER_GREW）。由本模块承载，核心只留一次调用。
 *
 * 三种形态的优先级（与 PRD §5 一致）：
 *   ① 用户显式区间 wordCountRange.max —— 最高优先，覆盖策略级上限；
 *   ② freeformOutput=true（用户明确「不设字数限制」）—— 统一上限（unifiedMax），
 *      且**跳过策略级平台形态上限**：用户没给字数意图时，平台形态上限不该替他决定篇幅
 *      （否则「自由发挥」名不副实：用户会拿到被 800-3000 悄悄砍尾的稿子）；
 *   ③ 策略级 postProcess.maxLength —— 平台形态语义（抖音口播 800 等）；
 *   ④ 兜底 3000 —— 「无任何字数意图」时的保守值（沿用引擎既有常量）。
 *
 * `freeformOutput` 只认严格布尔 `true`（不是 truthy）：这是**共享引擎**上的新分支，
 * 一旦被非布尔真值（'yes' / 1）激活就会静默改变输出上限策略，而「用户明确不设限」
 * 只能由渲染层显式下发 `true` 表达（外部评审 i3 指出该守卫必须存在，已按此实现）。
 */

/**
 * 解析本次改写生效的输出上限（码点）。
 *
 * @param {{min:number,max:number}|undefined|null} wordCountRange - 用户显式字数区间（可缺省）
 * @param {number|undefined} strategyMaxLength - 策略级 postProcess.maxLength（平台形态上限）
 * @param {boolean|undefined} freeformOutput - 用户是否明确「不设字数限制」（**只认 true**）
 * @param {number} unifiedMax - 统一上限（引擎 MAX_OUTPUT_CHARS，50000）
 * @param {number} fallbackMax - 无任何字数意图时的保守兜底（引擎既有常量 3000）
 * @returns {number} 生效上限（码点）
 */
function resolveOutputCap (wordCountRange, strategyMaxLength, freeformOutput, unifiedMax, fallbackMax) {
  if (wordCountRange && typeof wordCountRange.max === 'number' && wordCountRange.max > 0) {
    return wordCountRange.max
  }
  if (freeformOutput === true) {
    return unifiedMax
  }
  return strategyMaxLength || fallbackMax
}

module.exports = { resolveOutputCap }
