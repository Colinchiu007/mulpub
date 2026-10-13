'use strict'
/**
 * PRD 需求条目的状态标注判据（2026-10-12，Gate 9 第 3 层修复）。
 *
 * 为什么要有这个文件：审计器（ai-autonomous-tester）把 PRD 里所有可解析条目
 * 都当成「应实现的需求」。实测 01-docs/PRD.md 抽出 **357 项**，其中大量是
 * 规划中/不做/历史记录类，覆盖率被规划项稀释成存量欠账 —— 任何 feat PR 都可能
 * 因此被判 COVERAGE_FAIL（#3413 实测 score 0.31，#3409 连挂 4 次）。
 *
 * 口径（写死、可测）：
 *   - implemented / unknown → 进审计（unknown 保持既有行为，不擅自排除）
 *   - planned / wont-do / historical → 不进审计（分层报告，不计入覆盖率分母）
 *
 * 判据与常量表同源：判据由 STATUS_TAGS 驱动，改判据必改表，防两处漂移。
 *
 * ⛔ 匹配形态（2026-10-13，change: gate9-annot-bracket）：
 * **标注必须是一个独立的方括号单元**（`【已实现】` 或 `[implemented]`），
 * 括号内文本与标注词**完全相等**（英文大小写不敏感）。裸词一律**不**构成标注。
 *
 * 为什么不能用裸子串匹配（原实现的缺陷）：`text.includes('历史')` 会把
 * 「浏览历史记录」「历史提示词翻译」「消费历史」「历史上把 X 注入成字面量」
 * 全部判成「已废弃」；`includes('不做')` 会把「不做长度限制」「不做泛化兜底」
 * 判成「明确不做」。这些条目是**真实且已实现**的需求，被判为排除项就是从
 * 覆盖率分母里静默消失 —— 覆盖率虚高，正是本机制要防的失效形态。
 * 2026-10-13 在真实 PRD 上实测：11 个被判非 unknown 的条目至少 6 个是假阳性，
 * 而当时 PRD 里**一条合规标注都没有**（那 11 个全部来自裸词误判）。
 *
 * 偏保守的取舍：括号内做完全相等比较（不放宽前后缀）。放宽的代价是假阴性
 * （真实功能被排除、覆盖率虚高），收紧的代价只是标注没生效、条目照旧进审计
 * （安全方向）。故一律选收紧。
 */

const STATUS_TAGS = {
  implemented: ['已实现', 'implemented', '已上线', 'done', 'shipped'],
  planned: ['规划中', 'planned', '待实现', 'todo', 'future'],
  'wont-do': ['不做', "won't do", 'wont-do', 'wontdo', 'rejected'],
  historical: ['历史', 'historical', 'legacy', 'deprecated', '已废弃'],
}

// 检索顺序即优先级：一条同时带多个标注时取先命中者（implemented 优先，
// 避免「【已实现】…【历史】」这类复合描述被误判为历史）
const STATUS_ORDER = ['implemented', 'historical', 'planned', 'wont-do']

// 标注单元：CJK 方括号 或 ASCII 方括号
const CJK_ANNOTATION_RE = /【([^】]*)】/g
const ASCII_ANNOTATION_RE = /\[([^[\]]*)\]/g

/**
 * 抽取条目文本里的**方括号标注单元**内容（已 trim）。
 *
 * ASCII 方括号要排除 markdown 链接/图片语法：`[历史](url)` 是链接标签、
 * `![planned](img)` 是图片、`[text][ref]` 是引用式链接 —— 它们都不是标注。
 * 判据是「收尾方括号后紧跟 `(` 或 `[`」，成本极低且可测。
 *
 * @param {string} text
 * @returns {string[]} 标注单元内容（原样，未归一化）
 */
function extractAnnotations(text) {
  const s = String(text || '')
  const out = []
  for (const m of s.matchAll(CJK_ANNOTATION_RE)) {
    out.push(m[1].trim())
  }
  for (const m of s.matchAll(ASCII_ANNOTATION_RE)) {
    const after = s.slice(m.index + m[0].length)
    if (after.startsWith('(') || after.startsWith('[')) continue // markdown 链接/图片/引用式链接
    out.push(m[1].trim())
  }
  return out
}

/**
 * 解析条目文本中的状态标注。
 *
 * 只有**独立的方括号标注单元**且括号内与标注词完全相等时才命中；
 * 裸词、括号内带前后缀（如 `【不做长度限制】`）一律不认 → unknown。
 *
 * @param {string} text PRD 条目文本（可含标注）
 * @returns {{status: 'implemented'|'planned'|'wont-do'|'historical'|'unknown', tag: string|null}}
 */
function parseItemStatus(text) {
  const annotations = extractAnnotations(text).map((a) => a.toLowerCase())
  if (annotations.length === 0) {
    return { status: 'unknown', tag: null }
  }
  for (const status of STATUS_ORDER) {
    for (const tag of STATUS_TAGS[status]) {
      if (annotations.includes(tag.toLowerCase())) {
        return { status, tag }
      }
    }
  }
  return { status: 'unknown', tag: null }
}

/**
 * 该状态是否应进入覆盖审计。
 * @param {string} status parseItemStatus 返回的 status
 */
function shouldAudit(status) {
  return status === 'implemented' || status === 'unknown'
}

module.exports = {
  parseItemStatus,
  shouldAudit,
  extractAnnotations,
  STATUS_TAGS,
  STATUS_ORDER,
}
