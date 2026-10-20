/**
 * keyword-extractor — 关键词提取（规则为主 + LLM 兜底）
 *
 * extractSync: Intl.Segmenter 词级切分（Node 22 / Electron 内置，零依赖）+
 *   连续单字合并（小红书/自媒体类跨界词）+ bigram 高频补充 + 停用词过滤 + 词频排序。
 *   纯同步。为什么不用正则贪婪切分：/[\u4e00-\u9fa5]{2,4}/g 会把「自媒体运营」切成
 *   「自媒体运/营的核心」，词边界完全错位（viral-engine.js 的已知缺陷，此处不复用）。
 *
 * extractWithLLM: 异步兜底，严格 JSON 输出，任何失败返回空数组（fail-open）。
 *   chat 返回值经 normalizeChatResult 归一化（string / {text,finishReason} 双形态）。
 */

const { normalizeChatResult } = require('./llm-result')

// 中文停用词：虚词/代词/副词/连词/介词/助词/常见否定组合
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '你', '他', '她', '它', '和', '与', '或', '就', '不',
  '都', '人', '什么', '怎么', '如何', '为什么', '才', '后', '过', '没', '有', '让',
  '个', '这', '那', '把', '被', '从', '到', '为', '以', '及', '做', '用', '里', '中',
  '上', '下', '前', '先', '再', '又', '也', '还', '很', '太', '最', '更', '要', '想',
  '会', '能', '可', '得', '地', '着', '呢', '吧', '吗', '啊', '哦', '呀', '嘛', '么',
  '几', '每', '各', '某', '此', '该', '本', '其', '之', '等',
  '没有', '不是', '而是', '还是', '究竟', '究竟是什么', '到底', '真的', '确实', '其实',
])

// 英文停用词（toLowerCase 后匹配）
const EN_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with',
  'by', 'from', 'is', 'are', 'was', 'were', 'be', 'been', 'have', 'has', 'had', 'do',
  'does', 'did', 'will', 'would', 'could', 'should', 'this', 'that', 'these', 'those',
  'it', 'its', 'they', 'them', 'we', 'you', 'he', 'she', 'his', 'her', 'our', 'their',
  'what', 'which', 'who', 'when', 'where', 'why', 'how', 'all', 'each', 'not', 'only',
  'own', 'same', 'so', 'than', 'too', 'very', 'just', 'also', 'then', 'there', 'here',
  'if', 'as', 'my', 'your',
])

// 组合词中不允许出现的停用词子串（ICU 词典怪切分防线，如「究竟是」整 token）
const STOP_SUBSTRINGS = ['没有', '不是', '而是', '还是', '究竟', '到底', '真的', '确实', '其实', '什么', '怎么', '为什么']

// 惰性初始化 Segmenter（Node < 16 环境回退正则切分）
let _segmenter = null
function getSegmenter() {
  if (_segmenter === null) {
    try {
      _segmenter = (typeof Intl !== 'undefined' && Intl.Segmenter)
        ? new Intl.Segmenter('zh', { granularity: 'word' })
        : false
    } catch {
      _segmenter = false
    }
  }
  return _segmenter
}

function containsStopword(word) {
  if (!word) return true
  if (STOP_WORDS.has(word) || EN_STOP_WORDS.has(word)) return true
  if (word.length >= 3) {
    for (const s of STOP_SUBSTRINGS) {
      if (word.includes(s)) return true
    }
  }
  return false
}

function isCjk(word) {
  return /^[\u4e00-\u9fa5]+$/.test(word)
}

/**
 * 词级切分 + 单字合并
 * @param {string} text
 * @returns {string[]} 语义词数组
 */
function tokenize(text) {
  const normalized = String(text || '').toLowerCase()
  const segmenter = getSegmenter()
  let segs
  if (segmenter) {
    segs = Array.from(segmenter.segment(normalized))
      .filter(s => s.isWordLike === true)
      .map(s => s.segment)
  } else {
    // 兼容回退：无 Intl.Segmenter 时退化为正则切分（质量降级但可用；中英文拼接，不丢英文）
    const cjk = normalized.match(/[\u4e00-\u9fa5]{2,4}/g) || []
    const eng = normalized.match(/[a-z0-9]+/g) || []
    segs = cjk.concat(eng)
  }

  const words = []
  let i = 0
  while (i < segs.length) {
    const w = segs[i]
    if (w.length === 1 && isCjk(w) && !STOP_WORDS.has(w)) {
      // 连续单字合并（小红书 = 小+红+书），上限 4 字
      let merged = w
      let j = i + 1
      while (j < segs.length && merged.length < 4 && segs[j].length === 1 && isCjk(segs[j]) && !STOP_WORDS.has(segs[j])) {
        merged += segs[j]
        j++
      }
      // 孤立单字吸收紧邻多字词（自媒体 = 自+媒体），组合 ≤ 4 字且不含停用词
      if (merged.length === 1 && j < segs.length && segs[j].length >= 2 && segs[j].length <= 3
        && isCjk(segs[j]) && !containsStopword(segs[j]) && merged.length + segs[j].length <= 4) {
        merged += segs[j]
        j++
      }
      if (merged.length >= 2 && !containsStopword(merged)) {
        words.push(merged)
        i = j
        continue
      }
      // 合并失败：孤立单字丢弃
    } else if (w.length >= 2 && !containsStopword(w)) {
      words.push(w)
    }
    i++
  }
  return words
}

/**
 * 同步规则关键词提取
 * @param {string} text - 输入文本
 * @param {number} topN - 返回关键词上限
 * @returns {string[]} 关键词数组（按词频降序，同频字典序）
 */
function extractSync(text, topN = 8) {
  if (!text || typeof text !== 'string' || !text.trim()) return []
  const words = tokenize(text)
  if (words.length === 0) return []

  // 词频统计
  const freq = {}
  for (const w of words) freq[w] = (freq[w] || 0) + 1

  // bigram 高频补充：相邻词拼接 ≤4 字，仅当组合重复出现 ≥2 次（捕捉「内容+质量→内容质量」）
  const bigramFreq = {}
  for (let k = 0; k < words.length - 1; k++) {
    const combo = words[k] + words[k + 1]
    if (isCjk(combo) && combo.length <= 4 && !containsStopword(combo)) {
      bigramFreq[combo] = (bigramFreq[combo] || 0) + 1
    }
  }
  for (const [bg, count] of Object.entries(bigramFreq)) {
    if (count >= 2) freq[bg] = (freq[bg] || 0) + count
  }

  const entries = Object.entries(freq)
  if (entries.length === 0) return []
  entries.sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
  return entries.slice(0, Math.max(1, topN)).map(([k]) => k)
}

/**
 * 异步 LLM 关键词提取（兜底）
 * @param {string} text - 输入文本
 * @param {number} topN - 关键词上限
 * @param {object} llmClient - 提供 chat(systemPrompt, userPrompt): Promise<string|{text,finishReason}>
 *   （rewrite-segment-and-finish-reason：chat 契约扩展为可返回 object；本函数经
 *    normalizeChatResult 归一化，两形态都可用——不归一化会让「chat 返回 object」
 *    静默杀死关键词兜底且无任何报错）
 * @returns {Promise<string[]>} 关键词数组；任何失败返回 []（fail-open）
 */
async function extractWithLLM(text, topN = 8, llmClient) {
  if (!text || typeof text !== 'string' || !text.trim()) return []
  if (!llmClient || typeof llmClient.chat !== 'function') return []

  const systemPrompt = '你是关键词提取助手。从用户文本中提取主题关键词。' +
    '只输出严格 JSON，格式：{"keywords": ["关键词1", "关键词2"]}，不要任何其他文字。'
  const userPrompt = '从以下文本提取不超过 ' + topN + ' 个主题关键词（中文优先，保留专有名词）：\n\n' +
    text.slice(0, 2000)

  let raw
  try {
    raw = await llmClient.chat(systemPrompt, userPrompt)
  } catch {
    return [] // fail-open：LLM 不可用不阻塞主流程
  }
  // 归一化（C2/第四轴 C2）：string 与 {text,finishReason} 两形态统一取 .text；
  // 归一化后为空串同样走 fail-open，与旧「非 string 返回 []」行为等价。
  const { text: rawText } = normalizeChatResult(raw)
  if (!rawText) return []

  // 剥代码围栏（贪婪匹配到最后一个围栏，防多围栏输出时截断 JSON）
  let cleaned = rawText.trim()
  const fenceMatches = cleaned.matchAll(/```(?:json)?\s*([\s\S]*?)\s*```/g)
  let lastFence = null
  for (const m of fenceMatches) lastFence = m[1]
  if (lastFence !== null) cleaned = lastFence.trim()

  let parsed
  try {
    parsed = JSON.parse(cleaned)
  } catch {
    return [] // fail-open
  }
  if (!parsed || !Array.isArray(parsed.keywords)) return []
  return parsed.keywords
    .filter(k => typeof k === 'string' && k.trim() && !containsStopword(k.trim().toLowerCase()))
    .map(k => k.trim())
    .slice(0, Math.max(1, topN))
}

module.exports = { extractSync, extractWithLLM, tokenize, STOP_WORDS, EN_STOP_WORDS }
