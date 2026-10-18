// @ts-check
/**
 * title-limits — 发布标题长度的**单一真源**（2026-10-18 用户要求：最多 20 字）。
 *
 * 为什么单独成模块：改前长度上限散在三处且互相对不上 ——
 *   `publish-from-project.js` 的 `DEFAULT_TITLE_MAX = 100`（注释说是百家号上限）、
 *   `gen-video-title.js` 的 `GEN_VIDEO_TITLE_MAX = 100`（注释说「改一处必须同步另一处」）、
 *   以及主进程 prompt 里另写的一个数字。
 * 「注释里互相提醒同步」不是机制，改一次就漂一次 —— 所以收敛成这一个导出。
 *
 * 取值依据（不拍脑袋）：各平台 `titleMax` 里最小的是小红书 **20**，
 * 故 20 是全平台安全上限；取它意味着标题在任何平台都不会被二次截断。
 *
 * 计数口径：按 **Unicode 码点**（`[...text].length`），不是 `String.length`。
 * 理由：emoji / 生僻字是代理对，`String.length` 会把 1 个字算成 2，
 * 用户看到「19/20」却被拦下会当成 bug。截断与显示必须同口径。
 */

/** 发布标题硬上限（全平台安全值，取各平台 titleMax 的最小者：小红书 20）。 */
export const PUBLISH_TITLE_MAX = 20

/** AI 标题的理想长度（写进主进程 prompt 的软约束；硬截断仍走 `PUBLISH_TITLE_MAX`）。 */
export const PUBLISH_TITLE_IDEAL = 14

/**
 * 按码点数截断（不切断代理对）。
 * @param {unknown} text
 * @param {number} [max]
 * @returns {string}
 */
export function truncateTitleByCodePoints (text, max = PUBLISH_TITLE_MAX) {
  const value = typeof text === 'string' ? text : ''
  const limitRaw = Number(max)
  const limit = Number.isFinite(limitRaw) && limitRaw > 0 ? Math.floor(limitRaw) : PUBLISH_TITLE_MAX
  const chars = [...value]
  return chars.length <= limit ? value : chars.slice(0, limit).join('')
}

/**
 * 按码点数计长（与截断同口径）。
 * @param {unknown} text
 * @returns {number}
 */
export function countTitleCodePoints (text) {
  return typeof text === 'string' ? [...text].length : 0
}
