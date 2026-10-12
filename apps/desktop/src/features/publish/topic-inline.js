/**
 * topic-inline.js — 话题内联描述管道（publish-topic-inline-description）
 *
 * 描述文本是话题的唯一真源（参考产品 4.13.19 模型对齐，PRD §3.1）：
 * 标签/话题输入框降级为「快速添加入口」，添加后以 `#话题名` 文本形态
 * 追加到描述尾部（所见即所得），发布时从描述文本解析话题。
 *
 * 三个纯函数由视频/图文/批量三分支共用，禁止各抄一份（design §2.1）。
 * 话题名字符集：非空白、非井号（`#[^\s#]+`，与各平台话题输入口径一致——
 * 话题名内不允许空白，井号会破坏嵌套）。
 */

/** 话题内联片段的正则源（单井号形态；双井号 `#名#` 的尾 # 不属于名字）。
 *  前置边界 `(^|\s)`：井号前必须是文本开头或空白——URL 片段（`https://x.com#tag`）
 *  里的井号不是话题，不得误判（CCG claude 路评审修复，2026-10-09）。 */
const TOPIC_TOKEN = /(^|\s)#[^\s#]+/g

/**
 * 规范化话题名：剥离井号与全部空白字符（含首尾）。
 * 剥完为空的名字视为非法，调用方应忽略。
 * @param {string} name 原始话题名
 * @returns {string}
 */
function normalizeTopicName (name) {
  return String(name == null ? '' : name).replace(/[#\s]+/g, '')
}

/** 转义正则特殊字符（用于把话题名拼进动态正则） */
function escapeRegExp (value) {
  return String(value).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * 解析描述文本中的全部内联话题名。
 * 单井号 `#话题` 与双井号 `#话题#`（微博式）都识别，名字不含井号。
 * @param {string} content 描述文本
 * @returns {string[]} 话题名数组（按出现顺序，不去重）
 */
export function extractInlineTopics (content) {
  const text = String(content == null ? '' : content)
  const matches = text.match(TOPIC_TOKEN) || []
  // match 含前导空白（^|\s 捕获），trim 后剥井号取名字
  return matches.map(token => token.trim().slice(1))
}

/**
 * 把话题追加到描述尾部（词边界去重、空格分隔）。
 * - 描述已有同话题（名字完整匹配且后随空白/井号/结尾）则跳过
 * - 描述为空时话题成为唯一内容；非空且尾部无空白时先补一个分隔空格
 * - 追加形态 `#话题1 #话题2`，不构成 Markdown ATX 标题（# 后无空格）
 * @param {string} content 描述文本
 * @param {string[]|Iterable<string>} names 待追加话题名
 * @returns {string} 新描述文本（无可追加时原样返回）
 */
export function appendTopicsToContent (content, names) {
  const text = String(content == null ? '' : content)
  const existing = new Set(extractInlineTopics(text))
  const fresh = []
  const list = Array.isArray(names) ? names : Array.from(names || [])
  for (const raw of list) {
    const name = normalizeTopicName(raw)
    if (!name || existing.has(name) || fresh.includes(name)) continue
    fresh.push(name)
  }
  if (fresh.length === 0) return text
  const separator = text && !/\s$/.test(text) ? ' ' : ''
  return text + separator + fresh.map(name => '#' + name).join(' ')
}

/**
 * 从描述文本移除指定话题片段（含双井号尾标）。
 * 移除后收拢分隔空白：两侧都有空白保留一侧，仅一侧有则连同删除；
 * 话题不存在（用户可能已手动删除）时原样返回。
 * @param {string} content 描述文本
 * @param {string} name 话题名
 * @returns {string} 新描述文本
 */
export function removeTopicFromContent (content, name) {
  const text = String(content == null ? '' : content)
  const clean = normalizeTopicName(name)
  if (!clean) return text
  // 前置边界 (^|\s)：井号前须为开头或空白，URL 片段里的 #tag 不受影响
  const pattern = '(^|\\s)#' + escapeRegExp(clean) + '#?(?=\\s|$)(\\s?)'
  return text.replace(new RegExp(pattern, 'g'), (full, before, after) => {
    if (before && after) return before
    return ''
  })
}

/**
 * 「#添加话题」按钮（topic-tag-unify，PRD §4.2）：仅在描述末尾追加一个 `#`
 * 字符并返回新文本，话题名由用户自己接着输入（发布时 extractInlineTopics 收口）。
 * - 末尾已是孤立 `#`（或只有 `#`）时不重复追加，避免产生 `##`
 * - 非空且尾部无空白时先补一个分隔空格（`正文 #`）
 * - 末尾是完整话题（`#话题名`）时正常追加，支持连续添加多个话题
 * @param {string} content 描述文本
 * @returns {string} 新描述文本
 */
export function appendHashToContent (content) {
  const text = String(content == null ? '' : content)
  if (/(^|\s)#$/.test(text)) return text
  const separator = text && !/\s$/.test(text) ? ' ' : ''
  return text + separator + '#'
}
