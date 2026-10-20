/**
 * 改写引擎输入/输出上限与入参预处理（渲染层）。
 *
 * 为什么上限要在这里再写一份：引擎的真源在主进程包
 * `packages/rewrite-engine/src/rewrite-engine-core.js` 的 `MAX_INPUT_CHARS` / `MAX_OUTPUT_CHARS`，
 * 渲染层不能直接 import 主进程包（会把 Node 侧依赖带进 bundle）。因此这里按同值声明，并由
 * `rewrite-engine-limits.test.js` 的结构锁保证两处一致：只改一边 ⇒ 测试红，不会让
 * 「渲染层截到 A、引擎拒收于 B」静默发生。
 */

/** 与引擎长文分流阈值一致（> 此值走分段改写，不再 TOO_LONG；Unicode 码点计数） */
export const REWRITE_ENGINE_MAX_INPUT_CHARS = 50000

/** 与引擎 `_getWordCountInstruction` 的 wordCountRange 合法域上界一致（码点） */
export const REWRITE_ENGINE_MAX_OUTPUT_CHARS = 50000

/**
 * 按 Unicode 码点计数（与引擎 `[...content].length` 同口径）。
 * 不能用 String.length：emoji 等代理对会被算成 2，截断时还可能从中间劈开。
 * @param {string} content
 * @returns {number}
 */
export function countRewriteChars (content) {
  return [...String(content == null ? '' : content)].length
}

/**
 * 改写入参预处理：**只做空内容归一，不再截断**（rewrite-segment-and-finish-reason 第二刀）。
 *
 * 历史：`prepareRewriteInput` 曾把 >上限的正文截到 50000 码点再发引擎
 * （fix-collect-rewrite-too-long，#3979）。分段改写落地后引擎自己能处理超长输入，
 * 渲染层预截断会让 >50000 的正文**永远到不了引擎的分段路径**（第三轴评审 M1：
 * 该预截断使分段在采集页主链路成为死代码）。因此现在**透传全文**，长文由引擎分段。
 *
 * 保留 `truncated` 字段是为了不破坏既有消费方的解构（恒为 false）；
 * 调用方不应再据此弹「已截断」提示——分段提示见 `shouldSegmentRewrite`。
 *
 * @param {string} content
 * @returns {{ text: string, originalLength: number, truncated: boolean }}
 */
export function prepareRewriteInput (content) {
  const text = String(content == null ? '' : content)
  return { text, originalLength: countRewriteChars(text), truncated: false }
}

/** 是否需要分段提示（> 引擎分段阈值时由调用方弹「将分段改写」） */
export function shouldSegmentRewrite (content) {
  return countRewriteChars(content) > REWRITE_ENGINE_MAX_INPUT_CHARS
}
