// @ts-check
/**
 * Viral Engine — 爆款分析引擎 (Electron 主进程模块)
 *
 * 桥接渲染进程 ↔ orchestrator API (port 8000)
 *
 * 功能：
 *   1. viral:analyze   — 爆款因子分析
 *   2. viral:generate  — 爆款文案生成（标题/Hook/改写/结构）
 *   3. viral:trending  — 平台趋势洞察
 *
 * v2.3.43: 当 orchestrator 不可用时（未配置或连接失败），
 *          自动回退到本地启发式分析（_localAnalyze / _localGenerate / _localTrending），
 *          确保 §9.3 爆款分析功能在离线/无 orchestrator 环境下仍可使用。
 *
 * PRD-VIRAL-PAGE-FULL-UTILIZATION-2026-09-21（PR-1）本地算法工程化：
 *   - 模板元数据表化（{tpl, structure, emotion, platforms[]}），按平台分桶采样（T-1/T-5）
 *   - 互异性采样：候选 count×3 轮换 + 编辑距离去重（T-2）
 *   - 分词升级：优先复用 rewrite-engine extractSync，失败降级滑窗（T-3，_extractKeywords）
 *   - 填槽清洗与残句防御：槽位词清洗 + 「这个话题」兜底（T-4）
 *   - 本地预测分：_scoreTitleLocal 确定性启发式打分 + 降序，fail-open（F4）
 *   - _localAnalyze 补齐 rising_keywords / suggested_structures / platform_scores（F2，本地估算口径）
 *   - _localTrending 输出 keywords [{word,count}] 供热门选题速选（F3）
 */
const { ipcMain } = require('electron')
const log = require('./logger')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')

const ORCHESTRATOR_BASE = process.env.ORCHESTRATOR_URL || ''

// 停用词（本地关键词提取用）
const STOP_WORDS = new Set([
  '的', '了', '是', '在', '我', '有', '和', '就', '不', '人', '都', '一', '一个',
  '上', '也', '很', '到', '说', '要', '去', '你', '会', '着', '没有', '看', '好',
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'in', 'on', 'at', 'to', 'for', 'of', 'and', 'or', 'not', 'with', 'by',
  'this', 'that', 'it', 'from', 'as', 'for',
])

// ========== PR-1 本地模板元数据表（PRD §5 T-1/T-5） ==========
// platforms 包含「通用」的模板进入通用桶；平台专属模板（不含「通用」）在对应平台桶内优先采样，
// 保证同 topic 不同平台产出集合可区分（S3）。
const LOCAL_TITLE_TEMPLATES = [
  { tpl: '${year}年必须了解的${kw}，新手也能快速上手', structure: '时效+新手友好', emotion: '紧迫感', platforms: ['通用', '公众号', '小红书'] },
  { tpl: '${kw}终极指南：${count}个你不知道的秘密', structure: '数字盘点', emotion: '好奇', platforms: ['通用', '小红书', '抖音'] },
  { tpl: '为什么大家都在聊${kw}？深度解析背后的逻辑', structure: '悬念式提问', emotion: '好奇', platforms: ['通用', '公众号', '抖音'] },
  { tpl: '${kw}避坑指南：别再犯这些错误了', structure: '避坑警示', emotion: '警示', platforms: ['通用', '小红书', '公众号'] },
  { tpl: '从零开始掌握${kw}，一篇就够了', structure: '入门教程', emotion: '实用', platforms: ['通用', '公众号'] },
  { tpl: '${kw}实战分享：我是如何做到10w+的', structure: '个人经历背书', emotion: '共鸣', platforms: ['通用', '抖音', '小红书'] },
  { tpl: '颠覆认知的${kw}真相，99%的人都不知道', structure: '反差制造好奇', emotion: '反差', platforms: ['通用', '抖音'] },
  { tpl: '${kw}高阶玩法，进阶玩家必看', structure: '进阶玩法', emotion: '紧迫感', platforms: ['通用', '小红书'] },
  { tpl: '${kw} vs 传统方案，到底该选哪个？', structure: '对比评测', emotion: '好奇', platforms: ['通用', '公众号', 'Reddit'] },
  { tpl: '关于${kw}，这是我看过的最好总结', structure: '精选合集', emotion: '实用', platforms: ['通用', '公众号', '小红书'] },
  // 平台专属（桶内置顶）
  { tpl: '亲测有效的${kw}，第${count}个真的绝', structure: '亲测盘点', emotion: '共鸣', platforms: ['小红书', '抖音'] },
  { tpl: '一篇讲透${kw}：普通人也能看懂的完整梳理', structure: '深度长文', emotion: '实用', platforms: ['公众号'] },
]

const LOCAL_HOOK_TEMPLATES = [
  { tpl: '${kw}——你真的了解吗？', technique: '悬念提问', platforms: ['通用', '公众号', '抖音'] },
  { tpl: '别划走！关于${kw}的内容可能改变你的看法', technique: '中断口令', platforms: ['通用', '抖音', '小红书'] },
  { tpl: '90%的人在${kw}上都踩过坑，你呢？', technique: '从众+数据', platforms: ['通用', '小红书'] },
  { tpl: '一句话说清${kw}的核心', technique: '承诺简化', platforms: ['通用', '公众号'] },
  { tpl: '${kw}的隐藏玩法，今天全盘托出', technique: '揭秘承诺', platforms: ['通用', '小红书'] },
  { tpl: '刷到这条别急着划，${kw}亲测干货全在这里', technique: '中断口令+承诺', platforms: ['小红书', '抖音'] },
]

// 因子 → 推荐结构映射（_localAnalyze suggested_structures 用，按因子得分取 top 因素的结构）
const STRUCTURE_BY_FACTOR = {
  engagement: ['热点追踪', '案例复盘'],
  interaction: ['悬念式提问', '互动讨论'],
  title_quality: ['数字盘点', '对比评测'],
  keyword_diversity: ['盘点式清单', '深度指南'],
}

// 平台风格系数（platform_scores 本地估算口径，Q2 已决：展示估算值 + UI 标注「本地估算」）
const PLATFORM_SCORE_COEFFICIENTS = {
  小红书: 1.05,
  抖音: 1.0,
  公众号: 0.95,
  Reddit: 0.9,
}

// 本地预测分情绪词（与模板元数据同源，命中 +8/个，封顶 +24）
const TITLE_EMOTION_WORDS = /必看|避坑|终极|颠覆|真相|隐藏|进阶|从零|就够了|秘密|别再|最好|深度|亲测|上手|指南|玩法|真的绝/g

/** 字符级编辑距离（候选互异性去重用，T-2） */
function _levDistance (a, b) {
  const m = a.length; const n = b.length
  if (m === 0) return n
  if (n === 0) return m
  let prev = Array.from({ length: n + 1 }, (_, j) => j)
  for (let i = 1; i <= m; i++) {
    const cur = [i]
    for (let j = 1; j <= n; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1))
    }
    prev = cur
  }
  return prev[n]
}

class ViralEngine {
  constructor () {
    this._axios = null
  }

  _getAxios () {
    if (!this._axios) {
      this._axios = require('axios')
    }
    return this._axios
  }

  async _callApi (method, path, body, timeoutMs) {
    const axios = this._getAxios()
    const url = `${ORCHESTRATOR_BASE}${path}`
    try {
      const response = await axios({ method, url, data: body, timeout: timeoutMs || 120000 })
      return { code: 0, data: response.data, message: 'ok' }
    } catch (err) {
      const status = err.response?.status
      const detail = err.response?.data?.detail
      log.error('ViralEngine', `${method} ${path} failed: ${status} ${detail || err.message}`)
      return {
        code: status || -1,
        data: null,
        message: detail || err.message || '请求失败'
      }
    }
  }

  /**
   * 爆款因子分析
   */
  async analyze (articles, topic) {
    return this._callApi('post', '/api/viral/analyze', {
      articles,
      topic: topic || '',
    })
  }

  /**
   * 爆款文案生成
   */
  async generate (opts) {
    return this._callApi('post', '/api/viral/generate', {
      topic: opts.topic || '',
      content: opts.content || '',
      platform: opts.platform || '通用',
      task: opts.task || 'titles',
      style: opts.style || '自动适配',
      count: opts.count || 5,
    })
  }

  /**
   * 趋势洞察
   */
  async trending (articles) {
    return this._callApi('post', '/api/viral/trending', {
      articles: articles || [],
    })
  }

  /**
   * 文本爆款潜力评分（viral-rewrite-integration：供改写引擎第 4 评估维度注入）
   * 优先 orchestrator（文本因子驱动：标题结构/情感/长度），不可用时回退本地启发式。
   * 纯评分语义：互动维度置零，original/rewritten 两侧同口径，delta 才有可比性。
   * 走独立 8s 短超时：被动评分维度不得拖慢改写主流程（双模型评审 W-1）。
   * @param {string} text - 待评分文本
   * @returns {Promise<{score: number, mode: string}|null>} score 0-100；空文本返回 null
   */
  async scoreText (text) {
    const trimmed = typeof text === 'string' ? text.trim() : ''
    if (!trimmed) return null
    const article = { title: trimmed.slice(0, 120), content_text: trimmed, like_count: 0, comment_count: 0, platform_code: 'general' }
    try {
      const res = await this._callApi('post', '/api/viral/analyze', { articles: [article], topic: '' }, 8000)
      const raw = res && res.code === 0 && res.data ? res.data.overall_score : null
      if (typeof raw === 'number' && Number.isFinite(raw)) {
        return { score: Math.min(Math.max(raw, 0), 100), mode: (res.data && res.data.mode) || 'orchestrator' }
      }
      log.warn('ViralEngine', 'scoreText orchestrator response invalid, fallback to local: ' + ((res && res.message) || 'unknown'))
    } catch (e) {
      log.warn('ViralEngine', 'scoreText orchestrator call failed, fallback to local: ' + (e && e.message))
    }
    const local = this._localAnalyze([article], '')
    return { score: local.overall_score, mode: 'local-fallback' }
  }

  // ========== v2.3.43 本地启发式 fallback ==========

  /**
   * 外部词级分词（rewrite-engine extractSync，生产依赖闭包内已有引用先例：knowledge-library-store）
   * 独立成实例方法供测试桩换/降级（UT-6）。
   * @param {string} text
   * @param {number} max
   * @returns {string[]}
   */
  _extractKeywordsExternal (text, max) {
    const { extractSync } = require('@multi-publish/rewrite-engine')
    const words = extractSync(text, max || 8)
    if (!Array.isArray(words)) return []
    return words.filter(w => typeof w === 'string' && w.trim()).slice(0, max || 8)
  }

  /**
   * 统一关键词入口：优先外部词级分词（T-3），失败/空结果降级本地滑窗，不崩溃。
   * @param {string} text
   * @param {number} max
   * @returns {string[]}
   */
  _extractKeywords (text, max) {
    try {
      const ext = this._extractKeywordsExternal(text, max)
      if (ext.length) return ext
    } catch (e) {
      log.warn('ViralEngine', '_extractKeywords external failed, fallback to local: ' + (e && e.message))
    }
    return this._extractKeywordsLocal(text, max)
  }

  /**
   * 本地关键词提取（中英文分词 + 停用词过滤；仅作降级路径，主路径见 _extractKeywords）
   * @param {string} text
   * @param {number} maxKeywords
   * @returns {string[]}
   */
  _extractKeywordsLocal (text, maxKeywords) {
    if (!text || typeof text !== 'string') return []
    const max = maxKeywords || 8
    // 中文按字符提取 2-4 字组合，英文按空格分词
    const cjkMatches = text.match(/[\u4e00-\u9fa5]{2,4}/g) || []
    const enMatches = text.match(/[a-zA-Z]{2,}/g) || []
    const freq = new Map()
    for (const w of [...cjkMatches, ...enMatches]) {
      const lw = w.toLowerCase()
      if (STOP_WORDS.has(lw)) continue
      freq.set(lw, (freq.get(lw) || 0) + 1)
    }
    return Array.from(freq.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, max)
      .map(e => e[0])
  }

  /**
   * 本地爆款因子分析（orchestrator 不可用时使用）
   * 基于输入文章的标题长度、互动数据、关键词多样性计算启发式分数
   */
  _localAnalyze (articles, topic) {
    const list = Array.isArray(articles) ? articles : []
    const topicText = topic || ''

    // 互动数据聚合
    let totalLikes = 0
    let totalComments = 0
    let totalTitles = list.length
    let titleLens = []
    let allKeywords = new Set()

    for (const a of list) {
      const likes = Number(a.like_count) || 0
      const comments = Number(a.comment_count) || 0
      totalLikes += likes
      totalComments += comments
      const title = a.title || ''
      titleLens.push(title.length)
      for (const kw of this._extractKeywords(title + ' ' + topicText, 10)) {
        allKeywords.add(kw)
      }
    }

    const avgLikes = totalTitles > 0 ? totalLikes / totalTitles : 0
    const avgComments = totalTitles > 0 ? totalComments / totalTitles : 0
    const avgTitleLen = titleLens.length > 0 ? titleLens.reduce((s, n) => s + n, 0) / titleLens.length : 0

    // 启发式分数计算（0-1）
    const engagementScore = Math.min(avgLikes / 5000, 1)            // 5000 赞 = 满分
    const interactionScore = Math.min(avgComments / 500, 1)         // 500 评论 = 满分
    const titleScore = avgTitleLen >= 8 && avgTitleLen <= 30 ? 0.8 : 0.4  // 标题长度 8-30 为佳
    const keywordScore = Math.min(allKeywords.size / 15, 1)         // 15 个不同关键词 = 满分

    // 综合分（0-100）
    const overallScore = Math.round(
      (engagementScore * 0.35 + interactionScore * 0.25 + titleScore * 0.15 + keywordScore * 0.25) * 100
    )

    // 趋势方向
    let trendDirection = 'stable'
    if (avgLikes > 1000) trendDirection = 'rising'
    else if (avgLikes > 0 && avgComments / Math.max(avgLikes, 1) > 0.1) trendDirection = 'rising'

    // 推荐写作角度
    const topKeywords = this._extractKeywords(topicText + ' ' + list.map(a => a.title || '').join(' '), 6)
    const suggestedAngles = topKeywords.length > 0
      ? topKeywords.map(k => '关于「' + k + '」的深度解析')
      : ['热点追踪', '实用教程', '案例分享', '观点对比']

    // F2 本地估算字段补齐：上升关键词（词频降序）、推荐结构（按因子得分映射）、平台分（风格系数微调）
    const kwFreq = new Map()
    for (const a of list) {
      for (const k of this._extractKeywords(String(a.title || '') + ' ' + topicText, 10)) {
        kwFreq.set(k, (kwFreq.get(k) || 0) + 1)
      }
    }
    const risingKeywords = Array.from(kwFreq.entries())
      .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
      .slice(0, 10)
      .map(([word]) => ({ word }))

    const factorList = [
      { name: 'engagement', label: '互动热度', score: Math.round(engagementScore * 100) / 100 },
      { name: 'interaction', label: '评论活跃', score: Math.round(interactionScore * 100) / 100 },
      { name: 'title_quality', label: '标题质量', score: Math.round(titleScore * 100) / 100 },
      { name: 'keyword_diversity', label: '关键词多样性', score: Math.round(keywordScore * 100) / 100 },
    ]
    const suggestedStructures = []
    for (const f of [...factorList].sort((a, b) => b.score - a.score)) {
      for (const s of (STRUCTURE_BY_FACTOR[f.name] || [])) {
        if (!suggestedStructures.some(x => x.structure === s)) {
          suggestedStructures.push({ structure: s, expected_lift: Math.round(f.score * 20) + 5 })
        }
      }
      if (suggestedStructures.length >= 3) break
    }

    const platformScores = {}
    for (const [p, coef] of Object.entries(PLATFORM_SCORE_COEFFICIENTS)) {
      platformScores[p] = Math.max(0, Math.min(100, Math.round(overallScore * coef * 10) / 10))
    }

    return {
      success: true,
      mode: 'local-fallback',
      overall_score: overallScore,
      trend_direction: trendDirection,
      suggested_angles: suggestedAngles,
      rising_keywords: risingKeywords,
      suggested_structures: suggestedStructures,
      platform_scores: platformScores,
      factors: factorList,
      summary: '本地启发式分析（orchestrator 不可用），基于输入文章的互动数据和标题特征计算；平台分/推荐结构为本地估算口径',
      sample_size: totalTitles,
    }
  }

  /**
   * 平台分桶：专属模板（platforms 不含「通用」且命中当前平台）置前，共有模板在后；
   * 桶内为空时回落通用桶（T-1）。
   * @param {Array<{platforms: string[]}>} templates
   * @param {string} platform
   * @returns {Array} 分桶后的模板序列
   */
  _pickTemplatePool (templates, platform) {
    const all = Array.isArray(templates) ? templates : []
    const p = platform || '通用'
    const isGeneric = (t) => (t.platforms || []).includes('通用')
    const matches = (t) => (t.platforms || []).includes(p)
    const exclusive = all.filter(t => !isGeneric(t) && matches(t))
    const shared = all.filter(t => isGeneric(t) && (p === '通用' || matches(t)))
    const pool = [...exclusive, ...shared]
    if (pool.length) return pool
    return all.filter(isGeneric)
  }

  /**
   * 槽位词清洗：去空白/标点残留，长度须在 2-16 之间，否则视为无效（T-4 残句防御）
   * @param {string} w
   * @returns {string} 清洗后的槽位词，无效时返回 ''
   */
  _cleanSlotWord (w) {
    if (typeof w !== 'string') return ''
    const s = w.replace(/[\s\p{P}\p{S}]/gu, '').trim()
    if (s.length < 2 || s.length > 16) return ''
    if (!/[\u4e00-\u9fa5a-zA-Z0-9]/.test(s)) return ''
    return s
  }

  /**
   * 填槽词池：分词清洗后的关键词 + 清洗后的完整 topic，全空时兜底「这个话题」（T-4）
   * @param {string} topic
   * @returns {string[]}
   */
  _slotWords (topic) {
    const words = this._extractKeywords(topic || '', 5)
      .map(w => this._cleanSlotWord(w))
      .filter(Boolean)
    const whole = this._cleanSlotWord(topic || '')
    if (whole && !words.includes(whole)) words.unshift(whole)
    if (!words.length) words.push('这个话题')
    return words
  }

  /**
   * 本地标题预测分（F4，确定性启发式，0-100 整数）：
   * 基础 40 + 长度（12-30 得 20，8-11/31-40 得 10）+ 含数字 15 + 含疑问/感叹 10
   * + 情绪词命中每个 8（封顶 24）+ 含「年」5。无随机源，同输入同分。
   * 独立成实例方法供测试桩置错验证 fail-open（UT-4）。
   * @param {string} title
   * @returns {number}
   */
  _scoreTitleLocal (title) {
    const t = typeof title === 'string' ? title : ''
    let score = 40
    const len = t.length
    if (len >= 12 && len <= 30) score += 20
    else if (len >= 8 && len <= 40) score += 10
    if (/\d/.test(t)) score += 15
    if (/[？?！!]/.test(t)) score += 10
    const emotionHits = (t.match(TITLE_EMOTION_WORDS) || []).length
    score += Math.min(emotionHits * 8, 24)
    if (t.includes('年')) score += 5
    return Math.max(0, Math.min(100, Math.round(score)))
  }

  /**
   * 本地文案生成（orchestrator 不可用时使用）
   * 模板元数据表 + 平台分桶 + 槽位轮换 + 编辑距离去重 + 预测分降序（PR-1）
   */
  _localGenerate (opts) {
    const topic = (opts && opts.topic) || ''
    const platform = (opts && opts.platform) || '通用'
    const task = (opts && opts.task) || 'titles'
    const count = Math.min((opts && opts.count) || 5, 10)

    const slots = this._slotWords(topic)
    const year = String(new Date().getFullYear())
    const fill = (tplStr, kw, i) => tplStr
      .replace(/\$\{kw\}/g, kw)
      .replace(/\$\{year\}/g, year)
      .replace(/\$\{count\}/g, String(5 + (i % 4) * 3))

    if (task === 'titles') {
      const pool = this._pickTemplatePool(LOCAL_TITLE_TEMPLATES, platform)
      // 候选 count×3 轮换（模板 i%pool × 槽位 i%slots），编辑距离≥5 去重（T-2）
      const picked = []
      for (let i = 0; i < count * 3 && picked.length < count; i++) {
        const tmpl = pool[i % pool.length]
        const kw = slots[i % slots.length]
        const text = fill(tmpl.tpl, kw, i)
        if (!text || text.length < 6) continue
        if (/^[，。、？！：]/.test(text)) continue
        if (picked.every(p => _levDistance(p.title, text) >= 5)) picked.push({ title: text, structure: tmpl.structure, emotion: tmpl.emotion })
      }
      // 兜底：极端 topic 下去重导致不足 count 时，放宽去重补齐（模板轮换保证仍互异）
      for (let i = 0; picked.length < count && i < pool.length * slots.length; i++) {
        const tmpl = pool[i % pool.length]
        const kw = slots[(i + pool.length) % slots.length]
        const text = fill(tmpl.tpl, kw, i)
        if (text && text.length >= 6 && picked.every(p => p.title !== text)) {
          picked.push({ title: text, structure: tmpl.structure, emotion: tmpl.emotion })
        }
      }
      // 预测分：fail-open——打分抛错时缺分但条目/顺序不变（UT-4）；稳定降序（AC4.2）
      const scored = picked.map((item, idx) => {
        try {
          return { ...item, predicted_score: this._scoreTitleLocal(item.title), _idx: idx }
        } catch (e) {
          log.warn('ViralEngine', '_scoreTitleLocal failed (fail-open): ' + (e && e.message))
          return { ...item, _idx: idx }
        }
      }).sort((a, b) => (b.predicted_score ?? -1) - (a.predicted_score ?? -1) || a._idx - b._idx)
        .map(({ _idx, ...rest }) => rest)
      // 契约与渲染层对齐：genResult.data.titles（对象数组），与 orchestrator 响应同构。
      return {
        success: true,
        mode: 'local-fallback',
        task: 'titles',
        platform: platform,
        data: { titles: scored },
        summary: '本地模板生成（orchestrator 不可用）',
      }
    }

    if (task === 'hooks') {
      const pool = this._pickTemplatePool(LOCAL_HOOK_TEMPLATES, platform)
      const hooks = []
      for (let i = 0; i < count * 3 && hooks.length < count; i++) {
        const tmpl = pool[i % pool.length]
        const kw = slots[i % slots.length]
        const text = fill(tmpl.tpl, kw, i)
        if (!text || !/[\u4e00-\u9fa5a-zA-Z0-9]/.test(text)) continue
        if (hooks.every(h => h.hook !== text)) hooks.push({ hook: text, technique: tmpl.technique })
      }
      // 契约与渲染层对齐：genResult.data.hooks（对象数组 {hook, technique}）
      return {
        success: true,
        mode: 'local-fallback',
        task: 'hooks',
        platform: platform,
        data: { hooks },
      }
    }

    // 其他 task 类型
    return {
      success: true,
      mode: 'local-fallback',
      task: task,
      platform: platform,
      message: '本地 fallback 仅支持 titles / hooks 任务，其他任务需 orchestrator',
    }
  }

  /**
   * 本地趋势洞察（orchestrator 不可用时使用）
   * 基于输入文章数据聚合
   */
  _localTrending (articles) {
    const list = Array.isArray(articles) ? articles : []
    const platformMap = new Map()
    let totalLikes = 0
    let totalComments = 0

    for (const a of list) {
      const p = a.platform_code || a.platform || 'unknown'
      const likes = Number(a.like_count) || 0
      const comments = Number(a.comment_count) || 0
      totalLikes += likes
      totalComments += comments
      if (!platformMap.has(p)) platformMap.set(p, { count: 0, likes: 0, comments: 0 })
      const entry = platformMap.get(p)
      entry.count++
      entry.likes += likes
      entry.comments += comments
    }

    const byPlatform = Array.from(platformMap.entries()).map(([p, v]) => ({
      platform: p,
      count: v.count,
      avg_likes: v.count > 0 ? Math.round(v.likes / v.count) : 0,
      avg_comments: v.count > 0 ? Math.round(v.comments / v.count) : 0,
    })).sort((a, b) => b.avg_likes - a.avg_likes)

    // F3 数据面：关键词热度榜（词频降序 top10），供热门选题速选
    const kwFreq = new Map()
    for (const a of list) {
      for (const k of this._extractKeywords(String(a.title || ''), 10)) {
        const ck = this._cleanSlotWord(k) || k
        kwFreq.set(ck, (kwFreq.get(ck) || 0) + 1)
      }
    }
    const keywords = Array.from(kwFreq.entries())
      .sort((x, y) => y[1] - x[1] || (x[0] < y[0] ? -1 : 1))
      .slice(0, 10)
      .map(([word, n]) => ({ word, count: n }))

    return {
      success: true,
      mode: 'local-fallback',
      total_articles: list.length,
      total_likes: totalLikes,
      total_comments: totalComments,
      by_platform: byPlatform,
      keywords,
      summary: '本地趋势聚合（orchestrator 不可用），基于输入文章数据',
    }
  }

  registerIpcHandlers (injectedIpcMain) {
    const ipcMain = injectedIpcMain || require("electron").ipcMain;
    ipcMain.handle('viral:analyze', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { articles, topic } = arg
      try {
        const result = await this.analyze(articles, topic)
        // M-9 修复：统一为标准 { code, data, message } 格式
        if (result.code === 0 && result.data) {
          return { code: 0, data: result.data }
        }
        // v2.3.43: orchestrator 不可用时回退到本地启发式分析
        log.warn('ViralEngine', 'analyze 回退到本地 fallback: ' + result.message)
        return { code: 0, data: this._localAnalyze(articles, topic) }
      } catch (e) {
        log.error('ViralEngine', 'analyze handler error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    })

    ipcMain.handle('viral:generate', withSenderCheck(async (event, opts) => {
      try {
        const result = await this.generate(opts)
        if (result.code === 0 && result.data) {
          return { code: 0, data: result.data }
        }
        // v2.3.43: orchestrator 不可用时回退到本地模板生成
        log.warn('ViralEngine', 'generate 回退到本地 fallback: ' + result.message)
        return { code: 0, data: this._localGenerate(opts) }
      } catch (e) {
        log.error('ViralEngine', 'generate handler error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('viral:trending', async (event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { articles } = arg
      try {
        const result = await this.trending(articles)
        if (result.code === 0 && result.data) {
          return { code: 0, data: result.data }
        }
        // v2.3.43: orchestrator 不可用时回退到本地趋势聚合
        log.warn('ViralEngine', 'trending 回退到本地 fallback: ' + result.message)
        return { code: 0, data: this._localTrending(articles) }
      } catch (e) {
        log.error('ViralEngine', 'trending handler error: ' + e.message)
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    })
  }
}

module.exports = ViralEngine
