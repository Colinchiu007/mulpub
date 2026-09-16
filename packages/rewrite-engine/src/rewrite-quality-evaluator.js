/**
 * @multi-publish/rewrite-engine
 *
 * 改写质量评估器 — SimHash 64 位指纹 + 海明距离判重 + 三维评分
 *
 * 提供：
 * - SimHash: 64 位指纹类（可独立使用）
 * - RewriteQualityEvaluator: 改写质量评估器（充分度 / 语义保持度 / 原创性）
 * - computeSimHash: 便捷函数（返回 hex 字符串）
 * - hammingDistance: 便捷函数（返回海明距离）
 *
 * 纯 JavaScript 实现，不依赖任何外部包。
 * 算法蓝本：yanyiwu/simhash（64 位）+ 1e0ng/simhash（加权求和），
 * 见 01-docs/DEEP-ANALYSIS-SENSITIVE-DEDUP.md §4。
 */

'use strict'

/** FNV-1a 64 位哈希的偏移基值 */
const FNV_OFFSET_BASIS = 0xcbf29ce484222325n
/** FNV-1a 64 位哈希的质数 */
const FNV_PRIME = 0x100000001b3n
/** 64 位掩码 */
const MASK_64 = 0xffffffffffffffffn
/** SimHash 指纹位数 */
const BITS = 64

/**
 * FNV-1a 64 位哈希
 * @param {string} str 输入字符串
 * @returns {bigint} 64 位无符号哈希值
 */
function fnv1a64(str) {
  let hash = FNV_OFFSET_BASIS
  for (let i = 0; i < str.length; i++) {
    hash ^= BigInt(str.charCodeAt(i))
    hash = (hash * FNV_PRIME) & MASK_64
  }
  return hash
}

/**
 * 字符 n-gram 分词（不依赖 jieba 等外部分词器）
 *
 * 中文按字符 n-gram 滑动窗口切分；空白字符会被过滤，避免产生无意义 token。
 *
 * @param {string} text 输入文本
 * @param {number} gramSize n-gram 大小，默认 2
 * @returns {string[]} token 数组
 */
function tokenize(text, gramSize = 2) {
  if (!text) return []
  const cleaned = text.replace(/\s+/g, '')
  if (cleaned.length === 0) return []
  if (cleaned.length <= gramSize) return [cleaned]

  const tokens = []
  for (let i = 0; i <= cleaned.length - gramSize; i++) {
    tokens.push(cleaned.slice(i, i + gramSize))
  }
  return tokens
}

/**
 * 统计 token 词频（TF 简化加权）
 * @param {string[]} tokens token 数组
 * @returns {Map<string, number>} token -> 词频
 */
function countFrequencies(tokens) {
  const freq = new Map()
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1)
  }
  return freq
}

/**
 * SimHash 64 位指纹类
 *
 * 将文本映射为 64 位指纹：每个 token 哈希后按位加权求和，
 * 权重为正的位取 1，否则取 0。相似文本的指纹海明距离较小。
 */
class SimHash {
  /**
   * @param {object} [options]
   * @param {number} [options.gramSize=4] 字符 n-gram 大小
   * @param {(text: string, gramSize: number) => string[]} [options.tokenizer] 自定义分词器
   */
  constructor(options = {}) {
    this.gramSize = options.gramSize || 4
    this.tokenizer = options.tokenizer || tokenize
  }

  /**
   * 计算文本的 64 位 SimHash 指纹
   * @param {string} text 输入文本
   * @returns {bigint} 64 位指纹（BigInt）
   */
  compute(text) {
    const tokens = this.tokenizer(text, this.gramSize)
    if (tokens.length === 0) return 0n

    const freq = countFrequencies(tokens)
    const weights = new Float64Array(BITS)

    for (const [token, weight] of freq) {
      const hash = fnv1a64(token)
      for (let b = 0; b < BITS; b++) {
        const bit = (hash >> BigInt(b)) & 1n
        weights[b] += bit ? weight : -weight
      }
    }

    let fingerprint = 0n
    for (let b = 0; b < BITS; b++) {
      if (weights[b] > 0) {
        fingerprint |= 1n << BigInt(b)
      }
    }
    return fingerprint
  }

  /**
   * 计算文本指纹并返回 hex 字符串
   * @param {string} text 输入文本
   * @returns {string} 16 位 hex 字符串
   */
  computeHex(text) {
    return toHex(this.compute(text))
  }
}

/**
 * 将 BigInt 指纹转为 16 位 hex 字符串
 * @param {bigint} fingerprint 64 位指纹
 * @returns {string} 16 位 hex 字符串
 */
function toHex(fingerprint) {
  return fingerprint.toString(16).padStart(16, '0')
}

/**
 * 将 hex 字符串或 BigInt 归一化为 BigInt
 * @param {bigint|string} value 指纹
 * @returns {bigint} BigInt 指纹
 */
function toBigInt(value) {
  if (typeof value === 'bigint') return value
  if (typeof value === 'string') return BigInt('0x' + value)
  throw new TypeError('指纹必须是 bigint 或 hex 字符串')
}

/**
 * 计算两个 64 位指纹的海明距离（二进制位不同的数量）
 * @param {bigint|string} a 指纹 A
 * @param {bigint|string} b 指纹 B
 * @returns {number} 海明距离
 */
function hammingDistance(a, b) {
  let x = toBigInt(a) ^ toBigInt(b)
  let count = 0
  while (x) {
    count++
    x &= x - 1n
  }
  return count
}

/**
 * 计算文本的 SimHash 指纹（便捷函数，返回 hex 字符串）
 * @param {string} text 输入文本
 * @param {object} [options] 透传给 SimHash 的选项
 * @returns {string} 16 位 hex 字符串
 */
function computeSimHash(text, options) {
  return new SimHash(options).computeHex(text)
}

/**
 * 字符集合（按 **Unicode 码点** 拆分）
 *
 * 注意：`new Set(a)`（a 为字符串）按 UTF-16 code unit 迭代，会把 BMP 外字符（emoji、
 * 罕见 CJK 扩展字）的代理对拆成两个独立条目（`😀` → `\uD83D` + `\uDE00`），
 * 使覆盖率/相似度对含 emoji 的文本失真。改用 `Array.from()` 按码点迭代（`[...a]` 等价）。
 * 对纯 BMP 文本结果与旧实现完全一致（零回归）。
 *
 * @param {string} text
 * @returns {Set<string>} 码点集合
 */
function charSet(text) {
  return new Set(Array.from(text))
}

/**
 * 字符级 Jaccard 相似度（基于字符集合）
 * @param {string} a 文本 A
 * @param {string} b 文本 B
 * @returns {number} 0-1 相似度
 */
function charJaccard(a, b) {
  const setA = charSet(a)
  const setB = charSet(b)
  if (setA.size === 0 && setB.size === 0) return 1
  let intersection = 0
  for (const ch of setA) {
    if (setB.has(ch)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 1 : intersection / union
}

/**
 * 提取文本关键词（高频 n-gram token）
 * @param {string} text 输入文本
 * @param {number} topN 关键词数量
 * @param {number} gramSize n-gram 大小
 * @returns {Set<string>} 关键词集合
 */
function extractKeywords(text, topN, gramSize) {
  const tokens = tokenize(text, gramSize)
  const freq = countFrequencies(tokens)
  const sorted = [...freq.entries()].sort((x, y) => y[1] - x[1])
  return new Set(sorted.slice(0, topN).map(([token]) => token))
}

/**
 * 关键词重合度（0-1）
 * @param {string} original 原文
 * @param {string} rewritten 改写文
 * @param {number} [topN=10] 关键词数量
 * @param {number} [gramSize=4] n-gram 大小
 * @returns {number} 重合度
 */
function keywordOverlap(original, rewritten, topN = 10, gramSize = 2) {
  const kwA = extractKeywords(original, topN, gramSize)
  const kwB = extractKeywords(rewritten, topN, gramSize)
  if (kwA.size === 0 && kwB.size === 0) return 1
  let intersection = 0
  for (const token of kwA) {
    if (kwB.has(token)) intersection++
  }
  const maxSize = Math.max(kwA.size, kwB.size)
  return maxSize === 0 ? 1 : intersection / maxSize
}

/**
 * 向量余弦相似度
 * @param {number[]} a 向量 A
 * @param {number[]} b 向量 B
 * @returns {number} 余弦相似度 [-1, 1]
 */
function cosineSimilarity(a, b) {
  if (!a || !b || a.length !== b.length || a.length === 0) return 0
  let dot = 0
  let normA = 0
  let normB = 0
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i]
    normA += a[i] * a[i]
    normB += b[i] * b[i]
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB)
  return denom === 0 ? 0 : dot / denom
}

/**
 * 将数值限制在 [0, 100] 区间
 * @param {number} value 原始值
 * @returns {number} 限制后的值
 */
function clamp100(value) {
  return Math.max(0, Math.min(100, value))
}

/**
 * 根据海明距离计算改写充分度评分（0-100）
 *
 * 映射规则：
 * - 距离 0-3:  0-20 分（改写不充分，接近抄袭）
 * - 距离 3-6:  20-60 分（改写一般）
 * - 距离 6-10: 60-85 分（改写充分）
 * - 距离 >10:  85-100 分（高度原创）
 *
 * @param {number} distance 海明距离
 * @returns {number} 充分度评分
 */
function scoreSufficiency(distance) {
  if (distance <= 3) {
    return (distance / 3) * 20
  }
  if (distance <= 6) {
    return 20 + ((distance - 3) / 3) * 40
  }
  if (distance <= 10) {
    return 60 + ((distance - 6) / 4) * 25
  }
  return Math.min(100, 85 + ((distance - 10) / 10) * 15)
}

/**
 * 字符级**覆盖率**（非对称，对长度增长鲁棒）
 *
 * 语义保持度若用对称 Jaccard（`|A∩B| / |A∪B|`），在「短输入 → 长输出」场景下会被输出侧
 * 新增的字符稀释，产生"偏离原意"的假象：输入 4 字、输出 700 字时，即使输入的 4 个字
 * 全部出现在输出中，对称 Jaccard 也只有 `4 / 700 ≈ 0.006`（≈0.6 分）。
 *
 * 覆盖率改用 `|A∩B| / |A|`，度量的是「**原文内容有多少被结果保留**」，
 * 与输出长度无关——这才是"是否偏离原意"应有的语义。
 *
 * @param {string} a 原文
 * @param {string} b 结果
 * @returns {number} 0-1 覆盖率（原文为空时返回 1，视为无信息可丢失）
 */
function charCoverage(a, b) {
  const setA = charSet(a)
  if (setA.size === 0) return 1
  const setB = charSet(b)
  let hit = 0
  for (const ch of setA) {
    if (setB.has(ch)) hit++
  }
  return hit / setA.size
}

/**
 * 关键词**覆盖率**（非对称）
 *
 * `keywordOverlap` 的分母用 `max(|kwA|, |kwB|)`，当结果远长于原文时（长文高频 2-gram 数量多）
 * 会被放大分母，导致覆盖率被系统性低估。本函数改以原文关键词集合为分母，
 * 度量「原文的关键词组有多少在结果中出现」。
 *
 * @param {string} original 原文
 * @param {string} rewritten 改写文
 * @param {number} [topN=10] 关键词数量
 * @param {number} [gramSize=2] n-gram 大小
 * @returns {number} 0-1 覆盖率（原文关键词为空时返回 1）
 */
function keywordCoverage(original, rewritten, topN = 10, gramSize = 2) {
  const kwA = extractKeywords(original, topN, gramSize)
  if (kwA.size === 0) return 1
  const kwB = extractKeywords(rewritten, topN, gramSize)
  let hit = 0
  for (const token of kwA) {
    if (kwB.has(token)) hit++
  }
  return hit / kwA.size
}

/** 改写模式白名单（非法值一律回退 imitate，保持历史行为） */
const REWRITE_MODES = ['imitate', 'expand', 'create']

/**
 * 归一化改写模式。
 * @param {string} [mode] 'imitate' | 'expand' | 'create'
 * @returns {'imitate'|'expand'|'create'} 合法模式，非法/缺省回退 'imitate'
 */
function normalizeMode(mode) {
  return REWRITE_MODES.includes(mode) ? mode : 'imitate'
}

/** 评估方法白名单（非法值一律回退 simhash，与报告字段归一化规则一致） */
const EVAL_METHODS = ['simhash', 'embedding']

/**
 * 归一化评估方法。
 * @param {string} [method] 'simhash' | 'embedding'
 * @returns {'simhash'|'embedding'} 合法方法，非法/缺省回退 'simhash'
 */
function normalizeMethod(method) {
  return EVAL_METHODS.includes(method) ? method : 'simhash'
}

/**
 * 语义分阈值组——**按语义分标度分组**（2026-09-16 CCG 评审 W-1 修复）
 *
 * `semanticPreservation` 在两条路径上的标度不同，不能共用一组阈值：
 * - `simhash`（覆盖率口径）：0 = 原文内容完全丢失 / 100 = 完全保留；
 * - `embedding`（余弦映射 `((cos+1)/2)×100`）：**余弦 0（完全无关）→ 50**、-1 → 0、1 → 100。
 *
 * 若 embedding 路径套用覆盖率阈值（<15 / <30 / <50），"完全无关"的 50 分会越过全部 fail
 * 阈值，导致 embedding 路径几乎恒定 pass。故 embedding 组整体上移：
 * 以余弦 -0.1（≈45）作为"内容大量丢失"的分界、余弦 0（50）作为"需注意"的起点。
 *
 * 三档语义：
 * - `offTopic`：选题创作模式的提示下限（低于此值才提示"确认是否切题"）
 * - `weak`    ：内容大量丢失 → fail 分界
 * - `moderate`：语义偏弱 → warn 分界
 */
const SEMANTIC_BANDS = Object.freeze({
  simhash: Object.freeze({ offTopic: 15, weak: 30, moderate: 50 }),
  embedding: Object.freeze({ offTopic: 30, weak: 45, moderate: 60 }),
})

/**
 * 计算语义保持度（0-100）
 *
 * 2026-09-16 修正（BUGFIX-REWRITE-QUALITY-UX）：由对称 Jaccard 改为**覆盖率**。
 * 综合「原文字符覆盖率 × 0.7 + 原文关键词覆盖率 × 0.3」，语义含义是
 * 「原文的内容有多少被结果保留」，对输出长度增长鲁棒。
 *
 * 判读（仍是双边指标）：
 * - 过高（>90）= 内容几乎原样保留 → 对"智能仿写"意味着没改够
 * - 过低（<30）= 原文内容大量丢失 → 可能偏离原意（**是否算问题取决于改写模式**，
 *   见 determineVerdict：选题创作模式下不构成失败）
 *
 * @param {string} original 原文
 * @param {string} rewritten 改写文
 * @returns {number} 语义保持度
 */
function scoreSemanticPreservation(original, rewritten) {
  const coverage = charCoverage(original, rewritten)
  const keyword = keywordCoverage(original, rewritten)
  // 字符级覆盖率占 70%，关键词覆盖率占 30%（权重与修正前保持一致，便于对比）
  return clamp100(coverage * 100 * 0.7 + keyword * 100 * 0.3)
}

/**
 * 计算原创性评分（0-100）
 *
 * 原创性 = 改写充分度 × 0.5 + (1 - Jaccard 相似度) × 100 × 0.5
 *
 * @param {number} sufficiency 改写充分度
 * @param {string} original 原文
 * @param {string} rewritten 改写文
 * @returns {number} 原创性评分
 */
function scoreOriginality(sufficiency, original, rewritten) {
  const jaccard = charJaccard(original, rewritten)
  return clamp100(sufficiency * 0.5 + (1 - jaccard) * 100 * 0.5)
}

/**
 * 判定综合结论（模式感知）
 *
 * @internal 仅供 evaluate / evaluateAsync 内部调用（虽经 module.exports 导出以便单测，
 *   但**不属于稳定公共 API**，签名可能随口径调整而变化；外部请使用 RewriteQualityEvaluator）。
 *
 * 2026-09-16 修正（BUGFIX-REWRITE-QUALITY-UX）：原实现有两个叠加缺陷。
 *
 * 缺陷 1（口径错配）：语义保持度用对称 Jaccard，在「短输入 → 长输出」场景被输出侧新增
 * 字符稀释。真实事故：输入「秋天来了」(4 字) → 输出 831 字成文，charJaccard 仅 0.0127，
 * semantic 算出 9.89 → 命中「< 30 → 偏离原意」被判 fail，而事实是种子内容 100% 保留。
 *
 * 缺陷 2（模式无关）：选题创作(create) 的输入是**主题种子**，输出是据此新写的成文，
 * 语义保持度天然偏低——这是预期且正确的结果，不应判为问题。
 *
 * 修正后引入两个正交指标，各司其职：
 * - `semantic`（语义保持度 = 覆盖率）：度量"原文内容有多少被结果保留"，对长度增长鲁棒。
 *   用于判断"内容是否丢失/是否切题"。
 * - `similarity`（文本相似度 = 对称 Jaccard）：度量"结果与原文有多像"。
 *   用于判断"是否没改够"。**注意**：覆盖率语义下不能用高覆盖率判定"没改够"——
 *   任何足够长的输出都会包含原文全部字符，覆盖率必为 100（实测 4 字→831 字即 semantic=100）。
 *   这正是本次必须把「没改够」判据独立出来的原因。
 *
 * 判定表：
 * | 模式             | fail 条件                                  | warn 条件                      |
 * |------------------|--------------------------------------------|--------------------------------|
 * | 任意             | 海明距离 < 3 或 相似度 > 0.9（没改够/近似重复） | —                              |
 * | create 选题创作  | 无（除"没改够"）                            | 语义分 < band.offTopic         |
 * | expand 扩写      | 语义分 < band.weak（原文信息丢失）           | 海明距离 ≤ 6（扩写幅度不足）   |
 * | imitate 智能仿写 | 语义分 < band.weak                          | 海明距离 ≤ 6 或语义分 < band.moderate |
 *
 * ⚠️ **语义分标度不唯一**（2026-09-16 CCG 评审 W-1 修复）：
 * `semanticPreservation` 字段在两条评估路径上的标度不同——
 * - simhash 路径（覆盖率口径）：0 = 原文内容完全丢失，100 = 完全保留；
 * - embedding 路径（余弦映射）：`((cos + 1) / 2) × 100`，**余弦 0（完全无关）→ 50**。
 * 若两条路径共用同一组阈值，embedding 路径下"完全无关"（50 分）会越过所有 fail 阈值，
 * 使 embedding 路径几乎恒定 pass（尤其 create 模式下）。因此阈值按标度分组选取。
 *
 * @param {object} metrics
 * @param {number} metrics.distance 海明距离
 * @param {number} metrics.semantic 语义保持度（0-100，标度随 method 变化，见 SEMANTIC_BANDS）
 * @param {number} metrics.similarity 文本相似度（对称 Jaccard，0-1）
 * @param {string} [metrics.method] 评估方法（'simhash' | 'embedding'），决定语义分标度
 * @param {string} [metrics.mode] 改写模式 'imitate' | 'expand' | 'create'
 * @returns {'pass'|'warn'|'fail'} 结论
 */
function determineVerdict(metrics) {
  const distance = metrics.distance
  const semantic = metrics.semantic
  const similarity = typeof metrics.similarity === 'number' ? metrics.similarity : 0
  const resolvedMode = normalizeMode(metrics.mode)
  const band = SEMANTIC_BANDS[normalizeMethod(metrics.method)]

  // 近似重复 / 没改够：任何模式下都不合格（引擎未产生实质改动）
  if (distance < 3 || similarity > 0.9) return 'fail'

  if (resolvedMode === 'create') {
    // 选题创作：输入是主题而非待保留原文，"语义保持度低"不构成偏离原意。
    // 仅在语义分极低（结果几乎没用到主题）时给提示级结论。
    return semantic < band.offTopic ? 'warn' : 'pass'
  }

  if (resolvedMode === 'expand') {
    // 扩写：原文内容应被保留并扩展 → 语义分低才是真问题；高属预期，不判 fail
    if (semantic < band.weak) return 'fail'
    return distance <= 6 ? 'warn' : 'pass'
  }

  // 智能仿写（默认，保持历史判据的严格度）
  if (semantic < band.weak) return 'fail'
  if (distance <= 6 || semantic < band.moderate) return 'warn'
  return 'pass'
}

/**
 * 生成改进建议（模式感知）
 *
 * @internal 仅供 evaluate / evaluateAsync 内部调用（同 determineVerdict 的说明）。
 *
 * 措辞约束：结论与建议必须中性、可行动，避免"偏离原意/不合格"等使用户
 * 怀疑引擎可用性的表述（BUGFIX-REWRITE-QUALITY-UX）。
 *
 * @param {object} metrics
 * @param {number} metrics.distance 海明距离
 * @param {number} metrics.sufficiency 改写充分度
 * @param {number} metrics.semantic 语义保持度（0-100，标度随 method 变化，见 SEMANTIC_BANDS）
 * @param {number} metrics.similarity 文本相似度（对称 Jaccard，0-1）
 * @param {string} [metrics.method] 评估方法（simhash / embedding），决定语义分标度
 * @param {string} [metrics.mode] 改写模式
 * @returns {string[]} 建议数组
 */
function buildSuggestions(metrics) {
  const distance = metrics.distance
  const sufficiency = metrics.sufficiency
  const semantic = metrics.semantic
  const similarity = typeof metrics.similarity === 'number' ? metrics.similarity : 0
  const method = normalizeMethod(metrics.method)
  const resolvedMode = normalizeMode(metrics.mode)
  const band = SEMANTIC_BANDS[method]
  const suggestions = []

  if (distance < 3 || similarity > 0.9) {
    suggestions.push('改写与原文过于接近（近似重复），需要大幅调整句式与措辞')
  } else if (distance <= 6 && resolvedMode !== 'create') {
    suggestions.push('改写充分度不足，建议进一步调整语序、替换同义词并重组句子结构')
  }

  if (resolvedMode === 'create') {
    // 选题创作：语义分不是质量判据，仅在主题关联过弱时提示
    if (semantic < band.offTopic) {
      suggestions.push('结果与输入主题的用词重合较少，建议确认内容是否切题')
    }
  } else if (resolvedMode === 'expand') {
    if (semantic < band.weak) {
      suggestions.push('扩写结果对原文内容的保留较少，建议核对核心信息是否完整')
    }
  } else {
    if (semantic < band.weak) {
      suggestions.push('语义保持度偏低，建议核对原文核心信息是否完整保留')
    }
  }

  if (sufficiency >= 85 && semantic >= band.moderate) {
    suggestions.push(resolvedMode === 'create'
      ? '改写充分度良好，内容已围绕主题充分展开'
      : '改写质量良好，充分度与语义保持度均达标')
  }
  if (suggestions.length === 0) {
    suggestions.push('改写基本合格，可结合上下文微调以进一步提升自然度')
  }
  if (method === 'embedding') {
    suggestions.push('（语义保持度基于 embedding 余弦相似度计算）')
  }
  return suggestions
}

/**
 * 改写质量评估器
 *
 * v3 升级：
 * - 构造函数接受可选 embeddingClient { getEmbedding(text): Promise<number[]> }
 * - evaluate() 保持纯同步，使用 SimHash + 覆盖率（向后兼容）
 * - evaluateAsync() 首次尝试 embedding（余弦相似度），失败回退 evaluate() 方案
 *
 * v4 升级（2026-09-16，BUGFIX-REWRITE-QUALITY-UX）：
 * - evaluate / evaluateAsync 新增第三参数 `{ mode }`（'imitate'|'expand'|'create'），
 *   verdict 判据按模式分档；缺省 imitate，向后兼容
 * - 语义保持度由对称 Jaccard 改为**覆盖率**（charCoverage + keywordCoverage），
 *   修复「短输入 → 长输出」被长度稀释导致的"偏离原意"误判
 * - 新增 `textSimilarity`（对称 Jaccard，0-100）独立承担"是否没改够"判据
 * - 报告新增 `mode` 字段
 */
class RewriteQualityEvaluator {
  /**
   * @param {object} [options]
   * @param {number} [options.gramSize=4] SimHash 字符 n-gram 大小
   *   （2026-09-16 修正文档漂移：此前 JSDoc 写 `=2` 与实现 `options.gramSize || 4` 不符，
   *    实际生效值为 **4**；注意与关键词提取的默认 `gramSize = 2` 不同——
   *    指纹要求更长 n-gram 以提升区分度，关键词要求更短 n-gram 以适配短文本，
   *    两者刻意不同，勿统一）
   * @param {number} [options.keywordTopN=10] 关键词重合度检测数量
   * @param {object} [options.embeddingClient] 可选的 embedding 客户端
   *   - { getEmbedding(text: string): Promise<number[]> }
   *   注：桌面端实测 `AIGenerator.getEmbedding()` 在未配置 embedding 模型时抛错，
   *   `evaluateAsync` 会静默回退 SimHash → 用户侧「评估方式」常显示「SimHash 指纹」。
   *   如需语义向量口径，须先在模型设置中配置支持 embedding 的模型账号。
   */
  constructor(options = {}) {
    this.gramSize = options.gramSize || 4
    this.keywordTopN = options.keywordTopN || 10
    this.simhash = new SimHash({ gramSize: this.gramSize })
    this._embeddingClient = options.embeddingClient || null
  }

  /**
   * 评估单条改写结果（同步，simhash 覆盖率口径）
   *
   * @param {string} original 原文（create 模式下为主题种子）
   * @param {string} rewritten 改写文
   * @param {object} [options]
   * @param {string} [options.mode='imitate'] 改写模式 'imitate'|'expand'|'create'，
   *   决定 verdict 判据（见 determineVerdict）。缺省 imitate，保持向后兼容。
   * @returns {{
   *   sufficiency: number,
   *   semanticPreservation: number,
   *   textSimilarity: number,
   *   originality: number,
   *   simhashDistance: number,
   *   mode: string,
   *   verdict: 'pass'|'warn'|'fail',
   *   suggestions: string[],
   *   method: string
   * }} 综合评估报告
   */
  evaluate(original, rewritten, options = {}) {
    const mode = normalizeMode(options && options.mode)
    const originalFp = this.simhash.compute(original)
    const rewrittenFp = this.simhash.compute(rewritten)
    const distance = hammingDistance(originalFp, rewrittenFp)

    const sufficiency = scoreSufficiency(distance)
    const semanticPreservation = scoreSemanticPreservation(original, rewritten)
    const similarity = charJaccard(original, rewritten)
    const originality = scoreOriginality(sufficiency, original, rewritten)
    // method 显式传入 simhash，与 evaluateAsync 保持对称（阈值按标度分组选取）
    const verdict = determineVerdict({ distance, semantic: semanticPreservation, similarity, method: 'simhash', mode })
    const suggestions = buildSuggestions({ distance, sufficiency, semantic: semanticPreservation, similarity, method: 'simhash', mode })

    return {
      sufficiency: Math.round(sufficiency * 100) / 100,
      semanticPreservation: Math.round(semanticPreservation * 100) / 100,
      // textSimilarity 保留 4 位小数（其余指标 2 位）：低值域场景（如 4 字→831 字 = 1.27）
      // 需要更高精度才能区分"确实没改"与"轻微修改"，2 位精度在该区间已无分辨力
      textSimilarity: Math.round(similarity * 10000) / 100,
      originality: Math.round(originality * 100) / 100,
      simhashDistance: distance,
      mode,
      verdict,
      suggestions,
      method: 'simhash'
    }
  }

  /**
   * 异步评估：优先使用 embedding（余弦相似度），失败回退 SimHash 覆盖率方案
   *
   * ⚠️ 两条路径产出的 `semanticPreservation` **标度不同**（覆盖率 vs 余弦映射），
   * 阈值由 `SEMANTIC_BANDS` 按 `method` 分组选取，详见 determineVerdict 的说明。
   *
   * @param {string} original 原文（create 模式下为主题种子）
   * @param {string} rewritten 改写文
   * @param {object} [options]
   * @param {string} [options.mode='imitate'] 改写模式 'imitate'|'expand'|'create'
   * @returns {Promise<{
   *   sufficiency: number,
   *   semanticPreservation: number,
   *   textSimilarity: number,
   *   originality: number,
   *   simhashDistance: number,
   *   mode: string,
   *   verdict: 'pass'|'warn'|'fail',
   *   suggestions: string[],
   *   method: string
   * }>} 综合评估报告
   */
  async evaluateAsync(original, rewritten, options = {}) {
    const mode = normalizeMode(options && options.mode)
    const distance = hammingDistance(
      this.simhash.compute(original),
      this.simhash.compute(rewritten)
    )
    const sufficiency = scoreSufficiency(distance)

    let semanticPreservation
    let method = 'simhash'

    if (this._embeddingClient && typeof this._embeddingClient.getEmbedding === 'function') {
      try {
        const vecA = await this._embeddingClient.getEmbedding(original)
        const vecB = await this._embeddingClient.getEmbedding(rewritten)
        const sim = cosineSimilarity(vecA, vecB)
        semanticPreservation = clamp100(((sim + 1) / 2) * 100)
        method = 'embedding'
      } catch (_) {
        semanticPreservation = scoreSemanticPreservation(original, rewritten)
      }
    } else {
      semanticPreservation = scoreSemanticPreservation(original, rewritten)
    }

    const originality = scoreOriginality(sufficiency, original, rewritten)
    const similarity = charJaccard(original, rewritten)
    // method 决定语义分标度 → 阈值按 SEMANTIC_BANDS 分组选取
    const verdict = determineVerdict({ distance, semantic: semanticPreservation, similarity, method, mode })
    const suggestions = buildSuggestions({ distance, sufficiency, semantic: semanticPreservation, similarity, method, mode })

    return {
      sufficiency: Math.round(sufficiency * 100) / 100,
      semanticPreservation: Math.round(semanticPreservation * 100) / 100,
      // textSimilarity 保留 4 位小数（其余指标 2 位）：低值域场景（如 4 字→831 字 = 1.27）
      // 需要更高精度才能区分"确实没改"与"轻微修改"，2 位精度在该区间已无分辨力
      textSimilarity: Math.round(similarity * 10000) / 100,
      originality: Math.round(originality * 100) / 100,
      simhashDistance: distance,
      mode,
      verdict,
      suggestions,
      method
    }
  }

  /**
   * 批量异步评估
   * @param {Array<{original: string, rewritten: string, mode?: string}>} items
   * @returns {Promise<Array<object>>}
   */
  async evaluateBatchAsync(items) {
    const results = []
    for (const item of items) {
      results.push(await this.evaluateAsync(item.original, item.rewritten, { mode: item.mode }))
    }
    return results
  }

  /**
   * 批量评估多条改写结果（同步 simhash 路径）
   * @param {Array<{original: string, rewritten: string, mode?: string}>} items 待评估项
   * @returns {Array<{
   *   sufficiency: number,
   *   semanticPreservation: number,
   *   textSimilarity: number,
   *   originality: number,
   *   simhashDistance: number,
   *   mode: string,
   *   verdict: 'pass'|'warn'|'fail',
   *   suggestions: string[]
   * }>} 评估报告数组
   */
  evaluateBatch(items) {
    return items.map((item) => this.evaluate(item.original, item.rewritten, { mode: item.mode }))
  }
}

module.exports = {
  SimHash,
  RewriteQualityEvaluator,
  computeSimHash,
  hammingDistance,
  cosineSimilarity,
  tokenize,
  fnv1a64,
  charJaccard,
  keywordOverlap,
  // 2026-09-16 新增（BUGFIX-REWRITE-QUALITY-UX）
  charCoverage,
  keywordCoverage,
  normalizeMode,
  // 2026-09-16 新增（CCG 评审 W-1：语义分标度分组阈值）
  normalizeMethod,
  SEMANTIC_BANDS
}
