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
 *          自动回退到本地启发式分析，确保 §9.3 爆款分析功能在离线/无 orchestrator 环境下仍可使用。
 *
 * PRD-VIRAL-PAGE-FULL-UTILIZATION-2026-09-21（PR-1）本地算法工程化：
 *   - 模板元数据表化、按平台分桶采样、互异性去重、填槽清洗、本地预测分、
 *     _localAnalyze 补齐 rising_keywords/suggested_structures/platform_scores、
 *     _localTrending 输出 keywords 供热门选题速选。
 *   - 本地实现拆分至 ./viral-engine-local.js（控制单文件规模）；本模块仅保留
 *     orchestrator 调用、IPC 注册与可桩测的实例委托方法。
 */
const log = require('./logger')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')
const local = require('./viral-engine-local')

const ORCHESTRATOR_BASE = process.env.ORCHESTRATOR_URL || ''

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
    const localResult = this._localAnalyze([article], '')
    return { score: localResult.overall_score, mode: 'local-fallback' }
  }

  // ========== 本地启发式 fallback（实现见 ./viral-engine-local.js） ==========
  // 以下实例方法是测试桩缝：外部分词失败/打分失败等均通过 engine 方法回调，保持可桩。

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

  /** 本地关键词提取（降级路径），委托 ./viral-engine-local.js */
  _extractKeywordsLocal (text, maxKeywords) {
    return local.extractKeywordsLocal(text, maxKeywords)
  }

  /** 平台分桶（T-1），委托 ./viral-engine-local.js */
  _pickTemplatePool (templates, platform) {
    return local.pickTemplatePool(templates, platform)
  }

  /** 槽位词清洗（T-4），委托 ./viral-engine-local.js */
  _cleanSlotWord (w) {
    return local.cleanSlotWord(w)
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

  /** 本地标题预测分（F4），委托 ./viral-engine-local.js；独立实例方法供 fail-open 桩测（UT-4） */
  _scoreTitleLocal (title) {
    return local.scoreTitleLocal(title)
  }

  /** 本地爆款因子分析（orchestrator 不可用时），委托 ./viral-engine-local.js */
  _localAnalyze (articles, topic) {
    return local.localAnalyze(this, articles, topic)
  }

  /** 本地文案生成（orchestrator 不可用时），委托 ./viral-engine-local.js */
  _localGenerate (opts) {
    return local.localGenerate(this, opts)
  }

  /** 本地趋势洞察（orchestrator 不可用时），委托 ./viral-engine-local.js */
  _localTrending (articles) {
    return local.localTrending(this, articles)
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
