// @ts-check
/**
 * PatternExtractionService — 爆款模式卡片 LLM 提取服务
 *
 * 队列驱动：从 store.listPendingPatternCards 取待提取卡片，
 * 用 AIGenerator.generateWithDefault('llm') 提取结构化模式，
 * 解析容错（剥围栏/枚举校验/金句截断/公式回退），失败记 attempts。
 *
 * 触发时机（由 bootstrap 调度）：启动后延迟 30s + 入库后异步 + 每小时巡检。
 * 任何失败不阻塞入库/改写主流程（fail-open）。
 */
const log = require('./logger')

const HOOK_TYPES = new Set(['suspense', 'conflict', 'counterintuitive', 'question', 'story', 'data', 'empathy', 'other'])
const EMOTION_CURVES = new Set(['rise', 'fall', 'rise_fall', 'fall_rise', 'wave', 'flat'])
const NARRATIVE_STRUCTURES = new Set(['total_subtotal', 'problem_solution', 'chronological', 'contrast', 'list', 'story_lesson'])
const CTA_STYLES = new Set(['question', 'challenge', 'resource', 'follow', 'comment', 'none'])

const SYSTEM_PROMPT = `你是爆款内容模式分析专家。分析给定的爆款内容，提取结构化表达模式。
只输出严格 JSON，不要任何其他文字。格式：
{
  "hook_type": "suspense|conflict|counterintuitive|question|story|data|empathy|other 之一",
  "hook_analysis": "开头钩子为何有效（50字内）",
  "emotion_curve": "rise|fall|rise_fall|fall_rise|wave|flat 之一",
  "narrative_structure": "total_subtotal|problem_solution|chronological|contrast|list|story_lesson 之一",
  "cta_style": "question|challenge|resource|follow|comment|none 之一",
  "golden_quotes": ["最有传播力的原文金句，最多3句"],
  "title_formula": "标题抽象公式，用{占位符}表示变量，如 {年龄}{事件}后我才明白{道理}"
}`

class PatternExtractionService {
  constructor(opts) {
    opts = opts || {}
    this._aiGenerator = opts.aiGenerator || null
    this._store = opts.store || null
    this._running = false
    this._pendingTrigger = false
    this._hourlyTimer = null
  }

  setAiGenerator(gen) { this._aiGenerator = gen }
  setStore(store) { this._store = store }

  /**
   * 处理待提取队列（有界：每轮最多 10 条，避免长时间占用）
   */
  async processQueue() {
    if (!this._store || !this._aiGenerator) return
    if (this._running) {
      // 防重入：运行中的触发不丢弃——标记待处理，本轮结束后立即补跑（审查 W-4）
      this._pendingTrigger = true
      return
    }
    this._running = true
    try {
      const cards = this._store.listPendingPatternCards(10)
      for (const card of cards) {
        try {
          await this._extractOne(card)
        } catch (e) {
          // 单条失败记录 attempt，不中断整轮
          try { this._store.recordPatternAttempt(card.viral_item_id, (e && e.message) || 'unknown') } catch { /* ignore */ }
        }
      }
    } finally {
      this._running = false
      if (this._pendingTrigger) {
        this._pendingTrigger = false
        setImmediate(() => {
          this.processQueue().catch(e => log.warn('PatternExtraction', 'pending trigger run failed: ' + e.message))
        })
      }
    }
  }

  async _extractOne(card) {
    const item = this._store.getViralItem(card.viral_item_id)
    if (!item || !item.content) {
      // 源内容已删除：直接标 failed 终止重试
      this._store.updatePatternCard(card.viral_item_id, { status: 'failed', last_error: 'source content missing' })
      return
    }

    const userPrompt = this._buildUserPrompt(item)
    const result = await this._aiGenerator.generateWithDefault('llm', {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userPrompt },
      ],
    })
    const raw = result && typeof result.content === 'string' ? result.content : ''
    const parsed = this._parseResponse(raw, item)

    this._store.updatePatternCard(card.viral_item_id, {
      status: 'done',
      hook_type: parsed.hook_type,
      hook_analysis: parsed.hook_analysis,
      emotion_curve: parsed.emotion_curve,
      narrative_structure: parsed.narrative_structure,
      cta_style: parsed.cta_style,
      golden_quotes: parsed.golden_quotes,
      title_formula: parsed.title_formula,
      extracted_at: new Date().toISOString(),
      last_error: '',
    })
  }

  _buildUserPrompt(item) {
    let parts = []
    if (item.title) parts.push('标题：' + item.title)
    if (item.platform) parts.push('平台：' + item.platform)
    parts.push('正文：' + String(item.content || '').slice(0, 3000))
    return '分析以下爆款内容：\n\n' + parts.join('\n')
  }

  /**
   * 解析容错：剥代码围栏 → JSON.parse → 逐字段校验
   * （参考 Python 侧 _call_with_structured_output 三层容错模式）
   */
  _parseResponse(raw, item) {
    let cleaned = String(raw || '').trim()
    const fence = cleaned.match(/```(?:json)?\s*([\s\S]*?)\s*```/)
    if (fence) cleaned = fence[1].trim()

    let parsed
    try {
      parsed = JSON.parse(cleaned)
    } catch (e) {
      throw new Error('pattern JSON parse failed: ' + (e && e.message), { cause: e })
    }
    if (!parsed || typeof parsed !== 'object') throw new Error('pattern response not an object')

    const hookType = String(parsed.hook_type || '')
    const emotionCurve = String(parsed.emotion_curve || '')
    const narrative = String(parsed.narrative_structure || '')
    const cta = String(parsed.cta_style || '')

    // 金句：过滤非字符串 + 截断至 3 条
    let quotes = Array.isArray(parsed.golden_quotes) ? parsed.golden_quotes : []
    quotes = quotes.filter(q => typeof q === 'string' && q.trim()).slice(0, 3)

    // 公式：无 {占位符} 回退原标题
    let formula = String(parsed.title_formula || '').trim()
    if (!/\{[^}]+\}/.test(formula)) formula = String((item && item.title) || '').slice(0, 500)

    return {
      hook_type: HOOK_TYPES.has(hookType) ? hookType : (hookType ? 'other' : ''),
      hook_analysis: String(parsed.hook_analysis || '').slice(0, 2000),
      emotion_curve: EMOTION_CURVES.has(emotionCurve) ? emotionCurve : '',
      narrative_structure: NARRATIVE_STRUCTURES.has(narrative) ? narrative : '',
      cta_style: CTA_STYLES.has(cta) ? cta : '',
      golden_quotes: quotes,
      title_formula: formula,
    }
  }

  /**
   * 启动调度（bootstrap runWhenReady 调用）：启动后延迟 30s + 每小时巡检
   */
  start() {
    if (this._hourlyTimer) return
    setTimeout(() => {
      this.processQueue().catch(e => log.warn('PatternExtraction', 'initial run failed: ' + e.message))
    }, 30 * 1000).unref?.()
    this._hourlyTimer = setInterval(() => {
      this.processQueue().catch(e => log.warn('PatternExtraction', 'hourly run failed: ' + e.message))
    }, 60 * 60 * 1000)
    if (this._hourlyTimer.unref) this._hourlyTimer.unref()
    log.info('PatternExtraction', 'scheduler started (30s delay + hourly)')
  }

  stop() {
    if (this._hourlyTimer) {
      clearInterval(this._hourlyTimer)
      this._hourlyTimer = null
    }
  }

  /**
   * 入库后异步触发（addViralItem 后置钩子调用）
   */
  triggerExtraction() {
    setImmediate(() => {
      this.processQueue().catch(e => log.warn('PatternExtraction', 'triggered run failed: ' + e.message))
    })
  }
}

module.exports = PatternExtractionService
