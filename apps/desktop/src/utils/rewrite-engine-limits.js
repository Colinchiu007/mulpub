/**
 * 改写引擎输入上限与入参预处理（渲染层）。
 *
 * 为什么 6000 要在这里再写一份：引擎的硬上限在主进程包
 * `packages/rewrite-engine/src/rewrite-engine-core.js` 的 `MAX_INPUT_CHARS`，渲染层不能直接
 * import 主进程包（会把 Node 侧依赖带进 bundle）。因此这里按同值声明，并由
 * `rewrite-engine-limits.test.js` 的结构锁保证两处一致：只改一边 ⇒ 测试红，不会让
 * 「渲染层截到 A、引擎拒收于 B」静默发生。
 */

/** 与引擎 `_validate` 的 `MAX_INPUT_CHARS` 必须一致（Unicode 码点计数） */
export const REWRITE_ENGINE_MAX_INPUT_CHARS = 6000

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
 * 把改写入参裁到引擎上限内。
 * @param {string} content
 * @returns {{ text: string, originalLength: number, truncated: boolean }}
 */
export function prepareRewriteInput (content) {
  const text = String(content == null ? '' : content)
  const characters = [...text]
  const originalLength = characters.length
  if (originalLength <= REWRITE_ENGINE_MAX_INPUT_CHARS) {
    return { text, originalLength, truncated: false }
  }
  return {
    text: characters.slice(0, REWRITE_ENGINE_MAX_INPUT_CHARS).join(''),
    originalLength,
    truncated: true,
  }
}
