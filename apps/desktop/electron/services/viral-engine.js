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
   * 本地关键词提取（中英文分词 + 停用词过滤）
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
      for (const kw of this._extractKeywordsLocal(title + ' ' + topicText, 10)) {
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
    const topKeywords = this._extractKeywordsLocal(topicText + ' ' + list.map(a => a.title || '').join(' '), 6)
    const suggestedAngles = topKeywords.length > 0
      ? topKeywords.map(k => '关于「' + k + '」的深度解析')
      : ['热点追踪', '实用教程', '案例分享', '观点对比']

    return {
      success: true,
      mode: 'local-fallback',
      overall_score: overallScore,
      trend_direction: trendDirection,
      suggested_angles: suggestedAngles,
      factors: [
        { name: 'engagement', label: '互动热度', score: Math.round(engagementScore * 100) / 100 },
        { name: 'interaction', label: '评论活跃', score: Math.round(interactionScore * 100) / 100 },
        { name: 'title_quality', label: '标题质量', score: Math.round(titleScore * 100) / 100 },
        { name: 'keyword_diversity', label: '关键词多样性', score: Math.round(keywordScore * 100) / 100 },
      ],
      summary: '本地启发式分析（orchestrator 不可用），基于输入文章的互动数据和标题特征计算',
      sample_size: totalTitles,
    }
  }

  /**
   * 本地文案生成（orchestrator 不可用时使用）
   * 基于模板 + 关键词提取生成标题建议
   */
  _localGenerate (opts) {
    const topic = (opts && opts.topic) || ''
    const platform = (opts && opts.platform) || '通用'
    const task = (opts && opts.task) || 'titles'
    const count = Math.min((opts && opts.count) || 5, 10)

    const keywords = this._extractKeywordsLocal(topic, 5)
    const mainKw = keywords[0] || topic || '这个话题'

    if (task === 'titles') {
      const templates = [
        '${year}年必须了解的${kw}，新手也能快速上手',
        '${kw}终极指南：${count}个你不知道的秘密',
        '为什么大家都在聊${kw}？深度解析背后的逻辑',
        '${kw}避坑指南：别再犯这些错误了',
        '从零开始掌握${kw}，一篇就够了',
        '${kw}实战分享：我是如何做到10w+的',
        '颠覆认知的${kw}真相，99%的人都不知道',
        '${kw}高阶玩法，进阶玩家必看',
        '${kw} vs 传统方案，到底该选哪个？',
        '关于${kw}，这是我看过的最好总结',
      ]
      // 与模板逐一对应的标题结构标签（渲染层 viral-title-meta 展示用）
      const structures = [
        '时效+新手友好', '指南+数字盘点', '悬念式提问', '避坑警示', '入门教程',
        '个人经历背书', '反差制造好奇', '进阶玩法', '对比评测', '精选合集',
      ]
      const titles = []
      for (let i = 0; i < Math.min(count, templates.length); i++) {
        titles.push({
          title: templates[i].replace(/\$\{kw\}/g, mainKw).replace(/\$\{year\}/g, String(new Date().getFullYear())).replace(/\$\{count\}/g, String(5 + i * 3)),
          structure: structures[i],
        })
      }
      // 契约与渲染层对齐：genResult.data.titles（对象数组），与 orchestrator 响应同构。
      return {
        success: true,
        mode: 'local-fallback',
        task: 'titles',
        platform: platform,
        data: { titles },
        summary: '本地模板生成（orchestrator 不可用）',
      }
    }

    if (task === 'hooks') {
      const hookTemplates = [
        { hook: mainKw + '——你真的了解吗？', technique: '悬念提问' },
        { hook: '别划走！关于' + mainKw + '的内容可能改变你的看法', technique: '中断口令' },
        { hook: '90%的人在' + mainKw + '上都踩过坑，你呢？', technique: '从众+数据' },
        { hook: '一句话说清' + mainKw + '的核心', technique: '承诺简化' },
        { hook: mainKw + '的隐藏玩法，今天全盘托出', technique: '揭秘承诺' },
      ].slice(0, count)
      // 契约与渲染层对齐：genResult.data.hooks（对象数组 {hook, technique}）
      return {
        success: true,
        mode: 'local-fallback',
        task: 'hooks',
        platform: platform,
        data: { hooks: hookTemplates },
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

    return {
      success: true,
      mode: 'local-fallback',
      total_articles: list.length,
      total_likes: totalLikes,
      total_comments: totalComments,
      by_platform: byPlatform,
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
