/**
 * structure-headings.js — 改写结果里的结构标题行剥离（collect-rewrite-wordcount 拆分）
 *
 * 为什么独立成模块：`rewrite-engine-core.js` 的行数挂账（`check-max-lines.js` 的 LEDGER_GREW，
 * 登记值 578 + 容差 200 = 778 行天花板）在本次改动前只剩 4 行余量。同族先例：
 * `segment-rewriter.js` 与 `word-count-instruction.js` 都是从核心文件里拆出来的独立能力。
 *
 * 纯函数、零依赖；与核心里的 `_stripStructureHeadings` 行为逐字一致（调用点改为直接调本模块）。
 */

/**
 * 结构标题关键词：仅在「标题位」（行首）命中才剥离，避免误删正文中出现的普通句子
 * （如「故事的结尾不需要太多解释。」「引发共鸣，才有传播。」——关键词不在行首，不剥离）。
 * 匹配模式（去 Markdown 标记后）：
 *   1. 行首即关键词，且关键词后紧跟结构标记（（ ： ( : 「或行尾）
 *   2. 关键词带装饰（**开头**、## 开头、- 开头 等）由前面的标记剥离处理
 */
const STRUCTURE_HEADING_RE = /^(开头|中间|结尾|悬念|钩子|情感转折|共鸣|号召|正文|结尾段)(?=[（(:「:]|$|\s)/u

/**
 * 剥离改写结果中的结构标题行（纯文案输出契约兜底）。
 *
 * 识别规则（按行）：
 * - 行首可选 Markdown 标记（#、##、**、-、数字序号等）
 * - 行内含结构关键词：开头 / 中间 / 结尾 / 悬念 / 钩子 / 情感转折 / 共鸣 / 号召 / 正文 / 结尾段
 * - 行长度 ≤ 30 字符（结构标题短，正文长句不误伤）
 *
 * 仅移除标题行本身；标题行后的正文内容原样保留。
 * @param {string} text
 * @returns {string}
 */
function stripStructureHeadings (text) {
  if (typeof text !== 'string' || !text) return text
  const lines = text.split('\n')
  const kept = lines.filter((line) => {
    const trimmed = line.trim()
    if (!trimmed) return true
    // 剥离 Markdown 标记后判断（# ## ** - 1. 等）
    const stripped = trimmed.replace(/^[#*\-\d.\s]+/, '').replace(/[*#]+$/, '').trim()
    if (!stripped) return false
    // 仅当剥离后的行以结构关键词开头（标题位）且行长短（≤30 字）才判定为结构标题行
    if (stripped.length > 30) return true
    return !STRUCTURE_HEADING_RE.test(stripped)
  })
  return kept.join('\n')
}

module.exports = { stripStructureHeadings, STRUCTURE_HEADING_RE }
