// @ts-check
/**
 * readable-text — HTML 可读纯文本提取（保留原文换行与段落结构）
 *
 * 背景（回归：采集页正文换行全丢）：正文提取曾用
 * `.text().trim().replace(/\s+/g, ' ')`，把包括换行在内的所有连续空白压成单个半角
 * 空格，正文被压成一整行 —— 用户侧表现为「采集到的文字没有分行和分段，一整篇看着
 * 非常乱」，送进 AI 改写的正文也同时失去段落结构。
 *
 * 本模块把「HTML 块级结构 → 纯文本换行」的映射规则集中到一处，供采集通道复用：
 *   - <br> 强制换行 → 换行符
 *   - 段落级标签 → 段落之间空一行（视觉上体现「分段」）
 *   - 行级标签 → 相邻分行但不空行（列表项、表格行）
 *   - <pre> 代码块 → 内部换行与缩进原样保留
 *   - 行内连续空白（缩进/制表符/全角空格/NBSP）→ 压缩为单个半角空格
 *
 * 文件位置: apps/desktop/electron/services/readable-text.js
 */

/**
 * 正文提取时可整体丢弃的噪声节点。
 * 导航/页脚/侧栏的文字不是文章正文，混进正文会在段落之间制造大量伪换行。
 */
const CONTENT_NOISE_TAGS = new Set([
  'script', 'style', 'noscript', 'template', 'iframe', 'svg', 'canvas',
  'form', 'button', 'nav', 'footer', 'header', 'aside',
])

/**
 * 段落级标签：前面补「空行」。
 * 让段落在纯文本里也呈现为「分段」（空行 = 视觉段落间隔），而不只是分行。
 */
const PARAGRAPH_TAGS = new Set([
  'p', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'blockquote', 'figcaption',
])

/**
 * 行级标签：前面补单个换行。
 * 同一列表/表格内的相邻条目「分行但不空行」，避免把列表项之间也撑成段落。
 */
const LINE_TAGS = new Set([
  'address', 'article', 'dd', 'details', 'div', 'dl', 'dt', 'fieldset', 'figure',
  'li', 'main', 'ol', 'section', 'summary', 'table', 'tbody', 'tfoot', 'thead', 'tr', 'ul',
])

/** 表格单元格：同行内以制表符分隔，避免相邻单元格文字直接粘连。 */
const CELL_TAGS = new Set(['td', 'th'])

/** 预格式化标签：内部换行与缩进都是原文语义，必须整体原样保留。 */
const PREFORMATTED_TAGS = new Set(['pre'])

/**
 * <pre> 占位符边界。用 U+0000（NUL）包裹：
 * HTML 解析阶段即剔除 NUL，因此它不会出现在 cheerio 产出的文本节点里，
 * 与真实正文零碰撞；且非空白字符，可安全穿过空白归一化。
 */
const PRE_MARKER_PREFIX = '\u0000PRE'
const PRE_MARKER_SUFFIX = '\u0000'

/**
 * 收集子树内的原始文本，不做任何空白归一化。
 * 仅用于 <pre> 代码块：内部换行与缩进均为语义，必须原样保留。
 * @param {object} node - htmlparser2 节点
 * @returns {string}
 */
function collectRawText (node) {
  if (!node) return ''
  if (node.type === 'text') return node.data || ''
  if (node.type !== 'tag') return ''
  let out = ''
  for (const child of node.children || []) out += collectRawText(child)
  return out
}

/**
 * 深度优先遍历节点，按 HTML 块级结构产出「带换行的纯文本片段」。
 *
 * 产出规则：
 *   - 噪声节点（script/style/nav/footer/...）整体跳过（其 type 非 tag/text 时天然跳过）
 *   - <br> → 单个换行（强制换行是原文语义）
 *   - <pre> → 占位符 + 原文登记表，绕开空白归一化后再还原（见 extractReadableText）
 *   - 块级标签在**元素之前**补分隔符（而不是闭合后补）：
 *       相邻两个同级块级元素之间恰好得到 1 组分隔符，不会因为「前补 + 后补」叠成双份
 *       段落级（p/h1-h6/blockquote）→ 空行（\n\n，视觉上体现「分段」）
 *       行级（div/li/tr/...）→ 单个换行（同一列表内相邻条目「分行但不空行」）
 *       单元格（td/th）→ 制表符（相邻单元格不粘连，同一行内呈现）
 *     元素开头的多余换行由 normalizeExtractedText 收口（去首尾换行、3 连换行压 1 空行）
 *   - 其余（span/a/strong 等行内标签）原样透传：源码无空白即无间距，与浏览器渲染一致
 *
 * @param {object} node - htmlparser2 节点
 * @param {string[]} chunks - 输出片段累加器
 * @param {string[]} preformatted - <pre> 原文登记表（index 即占位符序号）
 */
function walkReadableText (node, chunks, preformatted) {
  if (!node) return
  if (node.type === 'text') {
    chunks.push(node.data || '')
    return
  }
  if (node.type !== 'tag') return
  const name = String(node.name || '').toLowerCase()
  if (CONTENT_NOISE_TAGS.has(name)) return
  if (name === 'br') {
    chunks.push('\n')
    return
  }
  if (PREFORMATTED_TAGS.has(name)) {
    // 代码块：内部换行与缩进都是语义。先登记原文、只留占位符，
    // 待空白归一化完成后再原样还原，避免缩进被行内空白压缩抹掉。
    // 前后补空行（与段落同级别）：占位符只有一行，而还原后的代码块是多行，
    // 若只补单个换行，还原后代码块与上下文之间会挤在一起。
    const raw = collectRawText(node)
      .replace(/\r\n?|[\u2028\u2029]/g, '\n')
      .replace(/^\n+|\n+$/g, '')
    preformatted.push(raw)
    chunks.push('\n\n' + PRE_MARKER_PREFIX + (preformatted.length - 1) + PRE_MARKER_SUFFIX + '\n\n')
    return
  }
  if (PARAGRAPH_TAGS.has(name)) chunks.push('\n\n')
  else if (LINE_TAGS.has(name)) chunks.push('\n')
  else if (CELL_TAGS.has(name)) chunks.push('\t')
  for (const child of node.children || []) walkReadableText(child, chunks, preformatted)
}

/**
 * 归一化正文空白：**保留有意义的换行**，只消除 HTML 源码排版噪声。
 *
 * 归一化规则（可被单测直接锁定，与 cheerio 解耦）：
 *   1. 统一行尾：CRLF / CR / U+2028 / U+2029 → LF
 *   2. 去 BOM（零宽字符会污染首行首字符）
 *   3. 行内连续空白（缩进、制表符、全角空格、NBSP）→ 单个半角空格；**换行不受影响**
 *   4. 逐行去首尾空白（含全角空格）
 *   5. 连续 3 个以上换行 → 压成 1 个空行（保留段落间隔，去掉源码缩进产生的多余空行）
 *   6. 去首尾换行
 *
 * @param {string} text - 待归一化文本
 * @returns {string}
 */
function normalizeExtractedText (text) {
  return String(text === null || text === undefined ? '' : text)
    .replace(/\r\n?|[\u2028\u2029]/g, '\n')
    .replace(/\ufeff/g, '')
    .replace(/[^\S\n]+/g, ' ')
    .split('\n')
    .map((line) => line.trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/^\n+|\n+$/g, '')
}

/**
 * 从正文容器提取「保留块级结构」的可读纯文本。
 *
 * 与 `contentEl.text()` 的区别：按块级元素边界补换行、`<br>` 转换行、`<pre>` 原样保留
 * （缩进不被压缩），再由 normalizeExtractedText 统一收口。输入为空容器时返回空串（不抛错）。
 *
 * @param {object} contentEl - cheerio 选择结果（正文容器）
 * @returns {string}
 */
function extractReadableText (contentEl) {
  if (!contentEl || !contentEl.length) return ''
  const chunks = []
  const preformatted = []
  for (const el of contentEl.get()) walkReadableText(el, chunks, preformatted)
  let text = normalizeExtractedText(chunks.join(''))
  // 还原代码块原文：占位符用 NUL 包裹，与真实正文零碰撞且能穿过空白归一化（见常量注释）
  for (let i = 0; i < preformatted.length; i += 1) {
    text = text.split(PRE_MARKER_PREFIX + i + PRE_MARKER_SUFFIX).join(preformatted[i])
  }
  return text
}

module.exports = { extractReadableText, normalizeExtractedText }
