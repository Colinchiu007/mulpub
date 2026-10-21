/**
 * 采集结果有效性判定（2026-10-20，change: collection-page-visual-polish）
 *
 * 为什么单独成文件：判定规则有分支（标题空 / 字数为 0 / 两者都满足），
 * 上一轮的教训是「把行为逻辑写死在组件里，测试只能断言字符串存在」——
 * 那样的断言在变异后仍然全绿（本次变异反证 M8 实测：把判定改成恒 false，
 * 只查函数名的契约测试毫无反应）。抽成纯函数后才能做真行为断言。
 *
 * 规则（PRD §6.1）：
 *   · 标题为空（含纯空白）⇒ 无效；
 *   · 或字数为 0 ⇒ 无效；
 *   · 两者任一满足即无效。
 *
 * 边界（每条都有理由，不是防御性编程）：
 *   · `wordCount` 用 `!= null` 而非真值判断：`0` 是**有效读数**（0 字就该判无效），
 *     写成 `if (item.wordCount)` 会把 0 当缺失、回退到 content.length，
 *     于是一条 0 字但有正文的记录会被误判为有效。
 *   · 标题 `String(item.title || '').trim()`：采集回落的 placeholder 常是空白串，
 *     只判 `!title` 会漏掉 `'   '`。
 *   · `Number(item.wordCount)`：wordCount 可能以字符串形式从旧存储里出来（'0' / '12'），
 *     不归一会让 `'0'` 变成 truthy ⇒ 漏判。
 *   · `NaN > 0` 为 false ⇒ wordCount 是脏值（NaN）时判无效，与「读数不可信」的
 *     fail-closed 方向一致。
 */

/**
 * @param {{ title?: unknown, wordCount?: unknown, content?: unknown }} item
 * @returns {boolean} true = 无效（无标题且/或 0 字）
 */
export function isInvalidResult (item) {
  if (!item) return false
  if (String(item.title ?? '').trim() === '') return true
  const words = item.wordCount != null ? Number(item.wordCount) : String(item.content ?? '').length
  return !(words > 0)
}
