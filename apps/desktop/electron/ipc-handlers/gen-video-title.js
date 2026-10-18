// @ts-check
/**
 * ai:generate-gen-video-title — 热门选题「生成视频 → 去发布」的爆款标题生成 IPC
 * （fix-hot-topics-genvideo-title，2026-10-17）。
 *
 * 契约（PRD §9.1）：
 *   - 成功 → { code:0, data:{ success:true, title } }
 *   - 无默认文字推理模型（未配置 / 无可用模型 / 无 API Key）→ { code:0, data:{ success:false, reason:'no-model' } }
 *   - LLM 调用失败或返回空 → { code:0, data:{ success:false, reason:'failed', message } }
 *   - 参数非法 → { code: EC.VALIDATION_ERROR, message }
 *
 * 设计要点：
 *   1. 「无模型」不是 error：渲染层据此走降级（用原始选题），不该弹错误对话框。
 *   2. 模型解析与 API Key 读取全部留在主进程边界（modelProviderManager），
 *      不出渲染层、不落日志 —— 与 prompt-bridge.resolveLlmBind 同契约。
 *   3. 复用 videogen-stages 的推理模型预算放大（isReasoningLlmModel）与
 *      resolveProviderDefaultModel 双默认语义，不新写模型解析。
 *   4. LLM 输出清洗复用渲染层同源纯函数（apps/desktop/src/features/publish/gen-video-title.js），
 *      通过共享 normalize 模块保持两册一致 —— 本文件 require 的是共享副本。
 */
const { withSenderCheck } = require('./helpers')

/** 默认输出预算：与 videogen-stages 的 DEFAULT_LLM_MAX_TOKENS 一致（改一处必须同步另一处）。 */
const DEFAULT_LLM_MAX_TOKENS = 1600
const REASONING_LLM_MAX_TOKENS = 5000

/** 推理型模型特征：与 videogen-stages.REASONING_MODEL_PATTERNS 同表。 */
const REASONING_MODEL_PATTERNS = [
  'reasoner',
  'deepseek-v4',
  'minimax-m3', 'minimax-m2.7', 'minimax-m2', 'm3',
  'kimi-k2.8', 'kimi-k2.7', 'kimi-k2.6', 'kimi-r1',
  'o1', 'o3', 'o4', 'o5',
  'r1', 'r2',
  'think',
]

function isReasoningLlmModel (modelId) {
  const id = String(modelId || '').trim().toLowerCase()
  if (!id) return false
  return REASONING_MODEL_PATTERNS.some(pattern => id.includes(pattern))
}

/** 双默认语义（2026-08-27）：用户默认 > 运营默认 > capability_models[type] > models[0]。 */
function resolveProviderDefaultModel (provider, type) {
  if (!provider || typeof provider !== 'object') return ''
  const own = (obj, key) => (obj && typeof obj === 'object' && Object.prototype.hasOwnProperty.call(obj, key) ? obj[key] : undefined)
  const firstString = (value) => (typeof value === 'string' && value.trim() ? value.trim() : '')
  const fromModels = () => (Array.isArray(provider.models) ? firstString(provider.models[0]) : '')
  const capability = firstString(own(provider, `default_${type}_model`))
    || firstString(own(provider, `default_${type}`))
  const capabilityModels = provider.capability_models && typeof provider.capability_models === 'object'
    ? firstString(provider.capability_models[type])
    : ''
  return capability || capabilityModels || fromModels()
}

/**
 * 从 modelProviderManager 解析默认 LLM 绑定（id + model）。
 * 任一环节缺失都返回 null —— 调用方据此返回 reason:'no-model'（不调 LLM）。
 */
function resolveDefaultLlm (aiGenerator) {
  const manager = aiGenerator && aiGenerator._modelProviderManager
  if (!manager || typeof manager.getDefault !== 'function') return null
  const provider = manager.getDefault('llm')
  if (!provider || typeof provider.id !== 'string' || !provider.id.trim()) return null
  if (provider.enabled !== undefined && provider.enabled !== true) return null
  if (provider.is_configured !== undefined && provider.is_configured !== true) return null
  const model = resolveProviderDefaultModel(provider, 'llm')
  if (!model) return null
  return { providerId: provider.id.trim(), model }
}

/** 进 prompt 的正文摘要长度（避免把整篇改写文案灌进 prompt）。 */
const GEN_VIDEO_TITLE_PROMPT_MAX = 200

/** AI 标题的理想长度约束（写进 system prompt；硬截断仍走调用方传入的 max）。 */
const GEN_VIDEO_TITLE_IDEAL = 30

/**
 * 构造爆款标题生成的 system / user prompt（纯函数）。
 *
 * 设计约束（PRD §4.4）：
 *  - system 明确「只输出标题本身」，并要求至少命中 2 类爆款元素 —— 降低推理模型
 *    把要素名写成结构标题的风险（改写引擎 2026-09-18 的同类教训：create 模式注入
 *    爆款要素诱导模型把要素名写成小节标题）；
 *  - user 只带选题 + 正文前 200 字摘要，不灌整篇。
 *
 * @param {{topicText?: unknown, bodyText?: unknown}} [input]
 * @returns {{system: string, user: string}}
 */
function buildGenVideoTitlePrompt (input = {}) {
  const topic = typeof input?.topicText === 'string' ? input.topicText.trim() : ''
  const body = (typeof input?.bodyText === 'string' ? input.bodyText : '')
    .slice(0, GEN_VIDEO_TITLE_PROMPT_MAX)
    .trim()
  const system = [
    '你是短视频爆款标题编剧。基于给定选题与文案，写 1 个发布用标题。',
    '硬性要求：',
    '1. 只输出标题本身，不要引号、编号、解释、前后缀、markdown；',
    `2. 不超过 ${GEN_VIDEO_TITLE_IDEAL} 字；`,
    '3. 必须包含以下爆款元素中的至少 2 种：悬念钩子、具体数字、情绪共鸣词、身份标签（如"打工人""新手妈妈"）、反常识结论；',
    '4. 不使用"震撼""绝了""必看"等空洞夸张词作为唯一卖点；',
    '5. 与选题主题一致，不改变事实，不添加原文没有的承诺。',
  ].join('\n')
  const user = `选题：${topic}\n文案摘要：${body}`
  return { system, user }
}

/** LLM 输出清洗（与渲染层 gen-video-title.js 的 resolveGenVideoTitle 配套；此处为 CommonJS 副本，行为必须逐条一致）。 */
function normalizeGeneratedTitle (raw, max) {
  const limit = Number.isFinite(max) && max > 0 ? Math.floor(max) : 100
  let text = typeof raw === 'string' ? raw : ''
  if (!text.trim()) return ''
  text = text.replace(/<\s*think(?:ing)?\s*>[\s\S]*?(?:<\s*\/\s*think(?:ing)?\s*>|$)/gi, '')
  const fence = text.match(/^\s*```[a-zA-Z0-9_-]*\s*\n?([\s\S]*?)\n?```\s*$/i)
  if (fence) text = fence[1]
  const firstLine = text.split('\n').map(l => l.trim()).find(l => l.length > 0)
  if (!firstLine) return ''
  // 4. 控制字符（用字符类构造，避免 no-control-regex 报错；范围 \u0000-\u001F 与 \u007F）
  text = firstLine
    .replace(/[^\P{Cc}\t\n]/gu, '')
    .replace(/^\s*(?:标题|题目|title)\s*[:：]\s*/i, '')
    .replace(/^\s*(?:\d+\s*[.、)]\s*|[-*+]\s+)/, '')
  const stripPair = (open, close) => {
    if (text.length >= 2 && text.startsWith(open) && text.endsWith(close)) text = text.slice(1, -1).trim()
  }
  stripPair('"', '"')
  stripPair("'", "'")
  stripPair('「', '」')
  stripPair('《', '》')
  text = text.replace(/[。！？…；;，,、.!?\s]+$/u, '').trim()
  if (!text) return ''
  const chars = [...text]
  return chars.length <= limit ? text : chars.slice(0, limit).join('')
}

function registerHandlers (ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { aiGenerator, log } = deps

  ipcMain.handle('ai:generate-gen-video-title', withSenderCheck(async (_event, payload) => {
    try {
      if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const topicText = typeof payload.topicText === 'string' ? payload.topicText.trim() : ''
      if (!topicText) {
        return { code: EC.VALIDATION_ERROR, message: 'topicText 不能为空' }
      }
      const bodyText = typeof payload.bodyText === 'string' ? payload.bodyText : ''
      const maxRaw = Number(payload.max)
      const max = Number.isFinite(maxRaw) && maxRaw > 0 ? Math.floor(maxRaw) : 100

      // ① 模型就绪性前置：无默认 LLM 直接返回 no-model，不发起网络调用
      const llm = resolveDefaultLlm(aiGenerator)
      if (!llm) {
        return { code: 0, data: { success: false, reason: 'no-model' } }
      }

      // ② 构造 prompt（纯函数，便于无 LLM 环境穷举测试）
      const { system, user } = buildGenVideoTitlePrompt({ topicText, bodyText })

      // ③ 调用默认 LLM（与 videogen-stages.callDefaultLlm 同一通道）
      const effectiveMaxTokens = isReasoningLlmModel(llm.model) ? REASONING_LLM_MAX_TOKENS : DEFAULT_LLM_MAX_TOKENS
      let raw
      try {
        raw = await aiGenerator.generateWithDefault('llm', {
          temperature: 0.7,
          max_tokens: effectiveMaxTokens,
          messages: [
            { role: 'system', content: system },
            { role: 'user', content: user },
          ],
        })
      } catch (e) {
        const message = (e && e.message) || String(e)
        if (log && typeof log.warn === 'function') {
          log.warn('[ipc:gen-video-title]', message)
        }
        return { code: 0, data: { success: false, reason: 'failed', message } }
      }

      const content = raw && typeof raw.content === 'string' ? raw.content : ''
      const title = normalizeGeneratedTitle(content, max)
      if (!title) {
        return { code: 0, data: { success: false, reason: 'failed', message: '标题生成为空' } }
      }
      return { code: 0, data: { success: true, title } }
    } catch (e) {
      if (log && typeof log.warn === 'function') {
        log.warn('[ipc:gen-video-title]', ((e && e.message) || String(e)))
      }
      return { code: EC.REQUEST_ERROR, message: (e && e.message) || String(e) }
    }
  }))
}

module.exports = registerHandlers
module.exports.buildGenVideoTitlePrompt = buildGenVideoTitlePrompt
module.exports.normalizeGeneratedTitle = normalizeGeneratedTitle
module.exports.resolveDefaultLlm = resolveDefaultLlm
module.exports.isReasoningLlmModel = isReasoningLlmModel
