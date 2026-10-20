/**
 * segment-splitter.js — >50000 长文分段切分（rewrite-segment-and-finish-reason 第二刀）
 *
 * 三级切分链（proposal §第二刀-2，第五轴 M3 响应）：
 *   ① 段落边界（\n\s*\n）贪心合并到 SEGMENT_SIZE；
 *   ② 单段仍超长 ⇒ 句子边界二次切（中文 。！？；…」 + 英文 .!?）；
 *   ③ 仍超长（无段落无标点长文本：英文/URL/代码/转写）⇒ 码点硬切兜底，
 *      保证 segment 永不超 SEGMENT_SIZE（emoji 代理对不劈）。
 *
 * 正确性根基 = 无损性：每段都是原文的连续子串且顺序覆盖（无丢段/重复段/编造段），
 * 由 segment-splitter.test.js 的「段必须是原文连续子串且顺序不重复」用例锁定。
 *
 * 纯函数、零依赖；端到端的空内容拒绝在 rewrite() 的 _validate（EMPTY_CONTENT）。
 */

/** 默认目标段长（码点）：max_tokens 64000 ÷ 2 的安全线（proposal §第二刀-11） */
const SEGMENT_SIZE = 12000

// 句子边界：中文句末/省略/下引号 + 英文句末/问号/感叹号。
// 引号内不切（标点必须出现在位置 i 才算边界，由下面的扫描实现保证）。
const SENTENCE_END_RE = /[。！？；…」\.\!\?]/

/**
 * 按段落边界贪心合并切分。
 * @param {string} text
 * @param {number} size - 目标段长（码点）
 * @returns {string[]} 段文本数组（每段 <= size，除非单段本身超 size——交由句子/硬切处理）
 */
function splitByParagraphs (text, size) {
  const paragraphs = text.split(/\n\s*\n/)
  const segments = []
  let current = ''
  for (const para of paragraphs) {
    if (!current) {
      current = para
      continue
    }
    // 合并后不超上限才并段；否则封段另起（保持原文段落顺序）
    if ([...current].length + 2 + [...para].length <= size) {
      current += '\n\n' + para
    } else {
      segments.push(current)
      current = para
    }
  }
  if (current) segments.push(current)
  return segments
}

/**
 * 单段超长时按句子边界二次切（找不到足够标点则返回 null，交由硬切）。
 * @param {string} text
 * @param {number} size
 * @returns {string[]|null}
 */
function splitBySentences (text, size) {
  const chars = [...text]
  if (chars.length <= size) return [text]
  const segments = []
  let start = 0
  let lastEnd = 0
  for (let i = 0; i < chars.length; i++) {
    if (!SENTENCE_END_RE.test(chars[i])) continue
    lastEnd = i + 1
    // 已累积长度达到上限 ⇒ 在最后一个句边界封段
    if (lastEnd - start >= size) {
      segments.push(chars.slice(start, lastEnd).join(''))
      start = lastEnd
    }
  }
  if (start < chars.length) {
    const rest = chars.slice(start).join('')
    if ([...rest].length > size) return null // 剩余仍超长（尾部无标点）⇒ 硬切
    segments.push(rest)
  }
  return segments.length > 1 ? segments : null
}

/**
 * 码点硬切兜底（代理对安全：按码点切片后 join，天然不劈 emoji）。
 * @param {string} text
 * @param {number} size
 * @returns {string[]}
 */
function hardSplit (text, size) {
  const chars = [...text]
  const segments = []
  for (let i = 0; i < chars.length; i += size) {
    segments.push(chars.slice(i, i + size).join(''))
  }
  return segments
}

/**
 * 分段切分主入口。
 * @param {string} text - 原文
 * @param {number} [size=SEGMENT_SIZE] - 目标段长（码点）
 * @returns {{segments: Array<{index:number,text:string,chars:number}>, totalChars:number, segmentCount:number}}
 */
function splitSegments (text, size = SEGMENT_SIZE) {
  const raw = typeof text === 'string' ? text : ''
  const totalChars = [...raw].length
  if (!raw.trim()) {
    return { segments: [], totalChars, segmentCount: 0 }
  }

  // ① 段落贪心合并
  let pieces = splitByParagraphs(raw, size)
  // ②+③ 对超长段逐段降级：句子切 → 硬切；结果按原顺序摊平
  const finalPieces = []
  for (const piece of pieces) {
    if ([...piece].length <= size) {
      finalPieces.push(piece)
      continue
    }
    const bySentences = splitBySentences(piece, size)
    if (bySentences) {
      finalPieces.push(...bySentences)
    } else {
      finalPieces.push(...hardSplit(piece, size))
    }
  }

  return {
    segments: finalPieces.map((t, i) => ({ index: i, text: t, chars: [...t].length })),
    totalChars,
    segmentCount: finalPieces.length,
  }
}

module.exports = { splitSegments, SEGMENT_SIZE }
