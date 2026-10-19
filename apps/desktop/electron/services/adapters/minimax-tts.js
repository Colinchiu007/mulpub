// @ts-check
/**
 * minimax-tts.js — MiniMax TTS Adapter（语音合成）
 *
 * MiniMax TTS API 关键特性：
 * - 认证头 Authorization: Bearer {key}
 * - synthesize: POST /t2a_v2，请求体 { model, text, voice_setting, audio_setting }
 * - 响应中 data.audio 为 hex 编码字符串，需转换为 Buffer
 * - 支持 speed（0.5-2，默认 1.0）和 pitch（默认 0）
 * - 支持 mp3/wav/flac 格式，采样率 32000
 *
 * 默认端点 https://api.minimaxi.com/v1，需 API Key。
 * 支持模型：speech-2.8-hd、speech-2.8-turbo、speech-2.6-hd、speech-2.6-turbo。
 *
 * 实现的方法（capabilities）：
 *   - synthesize()       POST /t2a_v2
 *   - listModels()      静态预定义列表
 *   - testConnection()  验证 apiKey 存在
 *   - validateConfig()  apiKey + baseUrl 必填
 *
 * 设计决策：
 * - 不覆盖 LLM/Image/Video 方法（BaseAdapter 默认抛 NotImplementedError）
 * - synthesize 返回 { audio: Buffer, format } 统一格式（hex → Buffer 转换）
 * - listModels 静态列表避免不必要的 HTTP 请求
 */

const { BaseAdapter } = require('./_base/base')
const { ProviderError, ERROR_CODES, fromHttpStatus, hasStrictContentPolicySignal } = require('./_base/provider-error')
const { MINIMAX_SYSTEM_VOICES } = require('./minimax-tts-voices')

const DEFAULT_BASE_URL = 'https://api.minimaxi.com/v1'
const DEFAULT_TIMEOUT = 60000
// 需求：MiniMax TTS 默认使用 speech-2.8-turbo（异步长文本语音合成 T2A Async 模型）
const DEFAULT_MODEL = 'speech-2.8-turbo'
const DEFAULT_VOICE = 'male-qn-qingse'
const DEFAULT_SPEED = 1.0
const DEFAULT_PITCH = 0
const DEFAULT_VOL = 10
const DEFAULT_BITRATE = 128000
const DEFAULT_CHANNEL = 2
const DEFAULT_OUTPUT_FORMAT = 'mp3'
const DEFAULT_SAMPLE_RATE = 32000
// 异步 T2A：创建任务 → 轮询查询 → 下载音频。2.8/02 系列为 T2A Async 模型
// （官方「异步语音合成」支持模型表），同步端点 /t2a_v2 对异步模型不返回
// data.audio（200 但缺音频 → “Missing audio data”）。
const DEFAULT_ASYNC_POLL_TIMEOUT_MS = 90 * 1000
const DEFAULT_ASYNC_POLL_INTERVAL_MS = 1000

// 字幕服务（subtitle_enable/subtitle_type）仅对以下模型生效：
// speech-2.8-hd/turbo、speech-2.6-hd/turbo、speech-02-hd/turbo、speech-01-hd/turbo。
// 官方文档：subtitle_type 支持 sentence（句）/ word（词）/ word_streaming（仅流式）。
const SUBTITLE_TYPES = new Set(['sentence', 'word', 'word_streaming'])
const SUBTITLE_MODEL_RE = /^speech-(2\.8|2\.6|02|01)-(hd|turbo)$/i

/**
 * 解析调用方是否请求字幕时间戳：
 * - 显式 subtitleType/subtitle_type（sentence|word|word_streaming）→ 原样启用
 * - withTimestamps/with_timestamps=true → 默认启用词级（word）
 * - 否则 → null（不开启，保持历史行为）
 * @param {object} [params]
 * @returns {string|null}
 */
function resolveSubtitleType (params) {
  const requested = params?.subtitleType ?? params?.subtitle_type ?? null
  if (typeof requested === 'string' && SUBTITLE_TYPES.has(requested)) return requested
  if (params?.withTimestamps === true || params?.with_timestamps === true) return 'word'
  return null
}

// 音色复刻（克隆）使用模型（MiniMax 官方文档 speech-voice-clone）：
// 快速复刻接口示例 model=speech-2.8-hd；官方「异步语音合成」模型表中
// speech-02-hd 是唯一标注「复刻相似度」的模型——克隆音色的正式语音合成
// 必须用 speech-02-hd，不能用 speech-2.8-turbo 等（否则报 voice id wrong）。
const VOICE_CLONE_MODEL = 'speech-2.8-hd'
const CLONED_VOICE_SYNTHESIS_MODEL = 'speech-02-hd'

function isAsyncT2aModel (model) {
  return /^speech-(2\.8|02)-(turbo|hd)$/i.test(String(model || ''))
}

function isSystemVoiceId (voiceId) {
  return MINIMAX_SYSTEM_VOICES.some((item) => item.id === voiceId)
}

/**
 * 音色/参数类错误归类为 INVALID_CONFIG（非瞬时、不可重试），
 * 让流水线快速失败并透传具体原因（如「voice id wrong」），而不是反复重试后弹笼统提示。
 */
function voiceInvalidOrConfigError (message, providerId) {
  const normalized = String(message || '').trim()
  const voiceInvalid = /voice id wrong|invalid params.*voice|voice_id.*(?:invalid|wrong|not found|not exist|unsupported)|音色.*(?:无效|不存在|失效)/i.test(normalized)
  const code = voiceInvalid ? ERROR_CODES.INVALID_CONFIG : ERROR_CODES.PROVIDER_ERROR
  return new ProviderError(code, normalized || 'MiniMax 语音合成失败', { providerId })
}

/**
 * MiniMax base_resp 业务错误分类（与 minimax-image.js 保持一致）：
 * HTTP 200 + base_resp.status_code != 0 时，按 status_msg 文本区分
 * auth/quota/content_policy/voice/其他，避免笼统归为 PROVIDER_ERROR。
 */
function classifyBaseRespError (message, providerId, statusCode) {
  const msg = String(message || '').trim()
  const isContentPolicy = hasStrictContentPolicySignal(msg)
  // 认证判定收紧：裸 "api key" 不得直接判 AUTH；必须邻近 invalid/expired 等失效信号
  const isAuth = /api[ _-]?key[^\n]{0,24}(?:invalid|expired|\u5931\u6548|\u8fc7\u671f|\u65e0\u6548|\u9519\u8bef|\u4e0d\u6b63\u786e)|(?:invalid|expired)\s+api[ _-]?key|invalid\s+api\s*key|(?:key|\u5bc6\u94a5).{0,16}(?:invalid|expired|\u5931\u6548|\u8fc7\u671f|\u65e0\u6548|\u9519\u8bef|\u4e0d\u6b63\u786e)|authenticat|credential|unauthorized|access\s+denied|(?:token|\u51ed\u8bc1).{0,16}(?:invalid|expired|\u65e0\u6548|\u5931\u6548)/i.test(msg)
  // 套餐/认证不含该能力（2026-10-19 事故：MiniMax 返回 "your current token plan not
  // support model, voice_clone"）。必须先于 isQuota 判定——isQuota 的 token\s*plan 分支
  // 会把「套餐不支持」误吃成「额度不足」，两者对用户的动作指引完全不同（升级认证 vs 等待额度）。
  // 命中 2038（用户语音克隆功能被禁用，官方文档：需完成个人/企业认证）或计划不支持类原文。
  const isPlanUnsupported = (
    Number(statusCode) === 2038
    || /token\s*plan[^.\n]{0,80}not\s+support|not\s+support[^.\n]{0,80}voice[_\s-]?clone|voice[_\s-]?clone[^.\n]{0,40}(?:forbidden|disabled|not\s*(?:supported|available)|user\s*forbidden)|\u8bed\u97f3\u514b\u9686\u529f\u80fd\u88ab\u7981\u7528|(?:\u5957\u9910|\u8ba2\u9605)[^.\n]{0,40}\u4e0d(?:\u652f\u6301|\u542b)/i.test(msg)
  )
  const isQuota = /\u4f59\u989d|\u989d\u5ea6|\u7528\u91cf|quota|balance|exhausted|insufficient|billing|payment\s*required|(?:token\s*plan|\u989d\u5ea6).{0,24}(?:\u4e0a\u9650|\u8d85|\u8017\u5c3d|\u7528\u5c3d|\u7528\u5b8c)|\u5347\u7ea7|upgrade/i.test(msg)
    const isVoiceInvalid = /voice\s+(?:id\s+)?(?:wrong|invalid|not\s+found|does\s+not\s+exist|unavailable|missing)|(?:invalid|unsupported)\s+voice|voice_id.*(?:invalid|wrong|not\s+found|not\s+exist|unsupported)|cloned?\s+voice.*(?:not\s+found|not\s+available|unavailable)|don'?t\s+have\s+access.*voice_id|access.*(?:to\s+)?(?:this\s+)?voice|(?:\\u97f3\\u8272|\\u58f0\\u97f3).*(?:\\u65e0\\u6548|\\u4e0d\\u5b58\\u5728|\\u5931\\u6548|\\u9519\\u8bef|\\u4e0d\\u5b58\\u5728)|\\u5f53\\u524d\\u8d26\\u53f7.*\\u97f3\\u8272|\\u8d26\\u53f7.*\\u97f3\\u8272|\\u5c5e\\u4e8e.*\\u5176\\u4ed6.*\\u8d26\\u53f7/i.test(msg)
  const code = isContentPolicy ? ERROR_CODES.CONTENT_POLICY
    : isAuth ? ERROR_CODES.AUTH_FAILED
      : isPlanUnsupported ? ERROR_CODES.PLAN_UNSUPPORTED
        : isQuota ? ERROR_CODES.QUOTA_EXCEEDED
          : isVoiceInvalid ? ERROR_CODES.INVALID_CONFIG
            : ERROR_CODES.PROVIDER_ERROR
  return new ProviderError(code, msg || 'MiniMax \u8bed\u97f3\u5408\u6210\u5931\u8d25', {
    providerId,
    ...(statusCode != null ? { statusCode: Number(statusCode) } : {}),
  })
}

// \u9759\u6001\u9884\u5b9a\u4e49 MiniMax TTS \u6a21\u578b\u5217\u8868（speech-2.8-turbo 为首选默认）
const MINIMAX_TTS_MODELS = [
  { id: 'speech-2.8-turbo',  name: 'Speech 2.8 Turbo',  description: '异步长文本语音合成（T2A Async），极致生成速度' },
  { id: 'speech-2.8-hd',     name: 'Speech 2.8 HD',     description: '高质量语音合成 v2.8' },
  { id: 'speech-2.6-hd',     name: 'Speech 2.6 HD',     description: '高质量语音合成 v2.6' },
  { id: 'speech-2.6-turbo',  name: 'Speech 2.6 Turbo',  description: '快速语音合成 v2.6' },
]

/**
 * 校验 MiniMax 克隆音色自定义 voice_id 是否符合官方约束：
 * 长度 [8,256]、首字符必须为英文字母、仅允许数字/字母/-/_、末位字符不可为 -/_。
 * （官方文档：api-reference/voice-cloning-clone）
 * @param {unknown} value
 * @returns {boolean}
 */
function isValidMiniMaxCloneVoiceId (value) {
  if (typeof value !== 'string' || value.length === 0) return false
  if (value.length < 8 || value.length > 256) return false
  if (!/^[a-zA-Z]/.test(value)) return false
  if (!/^[a-zA-Z0-9_-]+$/.test(value)) return false
  if (/[-_]$/.test(value)) return false
  return true
}

/**
 * 生成符合官方约束的克隆音色 voice_id：
 * - 以 "MiniMax" 前缀保证首字符为英文字母
 * - 名称清洗后仅保留 [A-Za-z0-9_-]，末位非 -/_
 * - 追加短随机后缀避免与平台已有 id 重复，长度落在 [8,256]
 * @param {string} [name]
 * @returns {string}
 */
function buildMiniMaxCloneVoiceId (name) {
  let base = String(name || '')
    .replace(/[^a-zA-Z0-9_-]/g, '')
    .replace(/[-_]+$/g, '')
    .replace(/^[^a-zA-Z]+/, '')
  if (!base) base = 'CloneVoice'
  const suffix = Math.random().toString(36).replace(/[^a-z0-9]/g, '').slice(0, 6)
  let id = 'MiniMax' + base.slice(0, 240) + '_' + suffix
  while (id.length < 8) id += '0'
  return id.slice(0, 256)
}

class MinimaxTtsAdapter extends BaseAdapter {
  /**
   * @param {object} credentials
   * @param {string} credentials.apiKey - MiniMax API Key（必填）
   * @param {string} [credentials.baseUrl] - 自定义端点
   * @param {object} [options]
   * @param {number} [options.timeout=60000] - 请求超时（ms）
   * @param {number} [options.maxRetries=2] - 最大重试次数
   */
  constructor(credentials, options = {}) {
    super(credentials, options)
    this.credentials.baseUrl = this.credentials.baseUrl || DEFAULT_BASE_URL
    this.options.timeout = this.options.timeout || DEFAULT_TIMEOUT
    this.options.maxRetries = this.options.maxRetries || 2
  }

  /** 验证配置：apiKey + baseUrl 必填 */
  validateConfig() {
    const errors = []
    if (!this.credentials.apiKey) errors.push('apiKey is required')
    if (!this.credentials.baseUrl) errors.push('baseUrl is required')
    return errors.length === 0 ? { valid: true } : { valid: false, errors }
  }

  /** 构造请求头 — MiniMax 使用 Bearer 认证 */
  _headers() {
    return {
      'Authorization': `Bearer ${this.credentials.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  /** 构造完整 URL */
  _url(path) {
    const base = this.credentials.baseUrl.replace(/\/$/, '')
    return `${base}${path}`
  }

  /**
   * 统一 fetch 包装 — 处理超时和错误转换
   */
  async _request(path, opts = {}) {
    const url = this._url(path)
    const headers = { ...this._headers(), ...(opts.headers || {}) }

    // 有界超时（2026-08-11 E2E 复盘）：DEFAULT_TIMEOUT 之前从未接入 fetch，
    // 网络/上游卡住时请求永久挂起（explainer/documentary assets 阶段偶发卡死根因之一）。
    const controller = new AbortController()
    const timeoutMs = Number.isFinite(Number(this.options.timeout)) && Number(this.options.timeout) > 0
      ? Number(this.options.timeout)
      : DEFAULT_TIMEOUT
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    let response
    try {
      try {
        response = await fetch(url, { ...opts, headers, signal: controller.signal })
      } finally {
        clearTimeout(timer)
      }

      if (!response.ok) {
        let errorBody
        try { errorBody = await response.json() } catch (_) {
          try { errorBody = await response.text() } catch (__) { errorBody = {} }
        }
        const message = (errorBody && errorBody.base_resp && errorBody.base_resp.status_msg)
          || (errorBody && errorBody.message)
          || (typeof errorBody === 'string' ? errorBody : `HTTP ${response.status}`)
        throw fromHttpStatus(response.status, message, { providerId: this.id, url })
      }

      return response
    } catch (e) {
      if (e instanceof ProviderError) throw e
      const msg = e.message || String(e)
      if (msg.includes('ETIMEDOUT') || msg.includes('timeout') || msg.includes('aborted')) {
        throw new ProviderError(ERROR_CODES.TIMEOUT, msg, { providerId: this.id })
      }
      if (msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('network')) {
        throw new ProviderError(ERROR_CODES.NETWORK_ERROR, msg, { providerId: this.id })
      }
      throw new ProviderError(ERROR_CODES.NETWORK_ERROR, msg, { providerId: this.id })
    }
  }
  /**
   * POST /t2a_v2 — 语音合成
   *
   * @param {object} params
   * @param {string} params.text - 要合成的文本（必填）
   * @param {string} [params.model='speech-2.8-hd'] - TTS 模型 ID
   * @param {string} [params.voice] - 声音 ID（voice_id）
   * @param {number} [params.speed=1.0] - 速度（0.5-2）
   * @param {number} [params.pitch=0] - 音调
   * @param {string} [params.outputFormat='mp3'] - 输出格式（mp3/wav/flac）
   * @returns {Promise<{audio: Buffer, format: string}>}
   */
  async synthesize(params) {
    if (!params || !params.text) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.text is required')
    }

    const model = params.model || DEFAULT_MODEL
    const voice = params.voice || DEFAULT_VOICE
    const speed = params.speed !== undefined ? params.speed : DEFAULT_SPEED
    const pitch = params.pitch !== undefined ? params.pitch : DEFAULT_PITCH
    const outputFormat = params.outputFormat || DEFAULT_OUTPUT_FORMAT

    // 官方音色 vs 克隆音色使用不同模型（MiniMax 官方文档）：
    // - 官方音色 → 使用用户配置的模型（如 speech-2.8-turbo）
    // - 克隆（复刻）音色 → 必须使用 speech-02-hd（官方「异步语音合成」模型表中
    //   唯一标注「复刻相似度」的模型），否则服务商报「invalid params, voice id wrong」。
    // 系统音色列表之外的 voice_id 视为克隆音色。
    const effectiveModel = isSystemVoiceId(voice) ? model : CLONED_VOICE_SYNTHESIS_MODEL
    // 字幕服务仅对官方列出的 8 个模型生效：模型不在白名单时静默不请求（避免参数错误）。
    // 克隆音色走 speech-02-hd（在白名单内）→ 音色复刻同样支持词级时间戳。
    const subtitleType = SUBTITLE_MODEL_RE.test(effectiveModel) ? resolveSubtitleType(params) : null

    // 异步 T2A 模型（speech-2.8-*/speech-02-*）必须走 t2a_async_v2 创建任务 → 查询 → 下载，
    // 同步端点 /t2a_v2 对异步模型返回 200 但不含 data.audio。
        if (isAsyncT2aModel(effectiveModel)) {
      return this._synthesizeAsync({ text: params.text, model: effectiveModel, voice, speed, pitch, outputFormat, subtitleType })
    }

    const body = {
      model,
      text: params.text,
      voice_setting: {
        voice_id: voice,
        speed,
        pitch,
      },
      audio_setting: {
        format: outputFormat,
        sample_rate: DEFAULT_SAMPLE_RATE,
      },
    }
    // 字幕时间戳（官方 speech-t2a-http）：subtitle_enable + subtitle_type=word 时
    // 响应携带 data.subtitle_file 下载链接（JSON，词级/句级，毫秒）
    if (subtitleType) {
      body.subtitle_enable = true
      body.subtitle_type = subtitleType
    }

    const resp = await this._request('/t2a_v2', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const data = await resp.json()

    // MiniMax 响应中 data.audio 为 hex 编码字符串
    // MiniMax 业务错误：HTTP 200 + base_resp.status_code != 0
    const baseResp = data?.base_resp
    if (baseResp && Number.isFinite(Number(baseResp.status_code)) && Number(baseResp.status_code) !== 0) {
      const statusMsg = baseResp.status_msg || ('MiniMax 语音合成失败（status_code=' + baseResp.status_code + ')')
      throw classifyBaseRespError(statusMsg, this.id, baseResp.status_code)
    }

    const hexAudio = data?.data?.audio || data?.audio
    if (!hexAudio) {
      throw new ProviderError(
        ERROR_CODES.PROVIDER_ERROR,
        'Missing audio data in response',
        { providerId: this.id }
      )
    }

    // hex 字符串 → Buffer
    const audio = Buffer.from(hexAudio, 'hex')

    const result = { audio, format: outputFormat }
    const rawSubtitleFile = data?.data?.subtitle_file || data?.subtitle_file
    if (typeof rawSubtitleFile === 'string' && rawSubtitleFile.trim()) {
      result.subtitleFile = rawSubtitleFile.trim()
    }
    const audioLengthMs = Number(data?.data?.extra_info?.audio_length || data?.extra_info?.audio_length)
    if (Number.isFinite(audioLengthMs) && audioLengthMs > 0) {
      result.duration = audioLengthMs / 1000
    }
    return result
  }

  /**
   * 异步 T2A 语音合成（T2A Async）：
   * 1. POST /t2a_async_v2 创建任务，返回 data.task_id
   * 2. 轮询 GET /query/t2a_async_query_v2?task_id=... 直至返回 data.file_id（或直接返回 data.audio）
   * 3. GET /files/retrieve_content?file_id=... 下载音频二进制
   * 官方文档：https://platform.minimaxi.com/docs/guides/speech-t2a-async
   */
  async _synthesizeAsync ({ text, model, voice, speed, pitch, outputFormat, subtitleType }) {
    const buildCreateBody = (withSubtitle) => {
      const body = {
        model,
        text,
        language_boost: 'auto',
        voice_setting: {
          voice_id: voice,
          speed,
          vol: DEFAULT_VOL,
          pitch,
        },
        audio_setting: {
          format: outputFormat,
          audio_sample_rate: DEFAULT_SAMPLE_RATE,
          bitrate: DEFAULT_BITRATE,
          channel: DEFAULT_CHANNEL,
        },
      }
      // 异步 T2A 同样支持字幕输出（官方「返回文件信息」：音频 + 字幕 + 额外信息 JSON 三类文件）。
      // 注意：异步创建接口请求 schema 未文档化字幕字段——若服务端拒绝参数，走下方降级重试。
      if (withSubtitle) {
        body.subtitle_enable = true
        body.subtitle_type = subtitleType
      }
      return body
    }

    let usedSubtitle = Boolean(subtitleType)
    let createData = null
    let createError = null
    try {
      const createResp = await this._request('/t2a_async_v2', {
        method: 'POST',
        body: JSON.stringify(buildCreateBody(usedSubtitle)),
      })
      createData = await createResp.json()
    } catch (error) {
      createError = error
    }

    // 字幕参数在异步创建接口属未文档化字段：服务端可能以非 2xx 抛错，也可能以
    // 200 + base_resp 业务错误码（2013/invalid params）拒绝——两种情况都去掉字幕
    // 参数重试一次，保证默认异步模型（speech-2.8-turbo）不因字幕请求而整体失败；
    // 非参数类错误（网络/超时/鉴权）原样抛出，保持错误分类。
    const isParamError = (e) => e instanceof ProviderError &&
      /invalid|param|argument|2013|unknown field|unexpected/i.test(String(e?.message || ''))
    let taskId = createData?.data?.task_id || createData?.task_id
    const respStatus = Number(createData?.base_resp?.status_code ?? NaN)
    const respMessage = String(createData?.base_resp?.status_msg || '')
    const paramErrorInBody = respStatus === 2013 || /invalid|param|argument|unknown field|unexpected/i.test(respMessage)
    if (usedSubtitle && !taskId && (isParamError(createError) || paramErrorInBody)) {
      const retryResp = await this._request('/t2a_async_v2', {
        method: 'POST',
        body: JSON.stringify(buildCreateBody(false)),
      })
      createData = await retryResp.json()
      taskId = createData?.data?.task_id || createData?.task_id
    } else if (createError) {
      throw createError
    }
    if (!taskId) {
      const message = createData?.base_resp?.status_msg
        || createData?.message
        || 'MiniMax 异步语音合成未返回 task_id'
      // 音色无效/参数错误属于配置问题：非瞬时、不重试，快速失败并透传具体原因
      throw classifyBaseRespError(message, this.id, createData?.base_resp?.status_code)
    }

    const pollTimeoutMs = Number.isFinite(Number(this.options.asyncPollTimeoutMs))
      ? Number(this.options.asyncPollTimeoutMs)
      : DEFAULT_ASYNC_POLL_TIMEOUT_MS
    const deadline = Date.now() + pollTimeoutMs
    for (;;) {
      const queryResp = await this._request('/query/t2a_async_query_v2?task_id=' + encodeURIComponent(taskId))
      const queryData = await queryResp.json()
      // 官方查询接口把 status/file_id/task_id 放在响应顶层（{ task_id, status, file_id, base_resp }），
      // 历史实现曾只读 data.*（queryData.data）导致任务永远显示 pending 直到超时。
      // 这里顶层与 data.* 双层兼容解析。
      const nested = queryData?.data && typeof queryData.data === 'object' ? queryData.data : {}
      const data = queryData && typeof queryData === 'object' ? queryData : {}
      const baseResp = data?.base_resp || nested?.base_resp || {}
      const statusCode = baseResp.status_code
      const taskStatus = String(data?.status || nested?.status || '').toLowerCase()

      // 字幕下载链接 + 音频时长（毫秒）：官方查询响应 schema 未列出，防御性透传，
      // 上游返回即用、未返回则缺省（调用方回退 ASR）
      const rawSubtitleFile = data?.subtitle_file ?? nested?.subtitle_file ?? null
      const subtitleFile = (typeof rawSubtitleFile === 'string' && rawSubtitleFile.trim()) ? rawSubtitleFile.trim() : null
      const audioLengthMs = Number(data?.extra_info?.audio_length ?? nested?.extra_info?.audio_length ?? NaN)

      // 完成：查询响应直接带音频（hex），或返回 file_id 后下载
      const inlineAudio = (typeof data.audio === 'string' && data.audio.length > 0) ? data.audio
        : ((typeof nested.audio === 'string' && nested.audio.length > 0) ? nested.audio : null)
      const buildResult = (audio) => {
        const result = { audio, format: outputFormat }
        if (subtitleFile) result.subtitleFile = subtitleFile
        if (Number.isFinite(audioLengthMs) && audioLengthMs > 0) result.duration = audioLengthMs / 1000
        return result
      }
      if (inlineAudio) {
        const audio = Buffer.from(inlineAudio, 'hex')
        if (audio.length > 0) return buildResult(audio)
      }
      const rawFileId = data?.file_id ?? nested?.file_id ?? null
      const fileId = rawFileId !== null && rawFileId !== undefined ? String(rawFileId).trim() : ''
      if (fileId && taskStatus !== 'processing') {
        const audioResp = await this._request('/files/retrieve_content?file_id=' + encodeURIComponent(fileId))
        const audioBuffer = Buffer.from(await audioResp.arrayBuffer())
        if (!audioBuffer || audioBuffer.length === 0) {
          throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'MiniMax 异步语音合成返回空音频', { providerId: this.id })
        }
        return buildResult(audioBuffer)
      }

      // 明确失败
      const errorValue = data?.error || nested?.error
      const hasError = errorValue && (typeof errorValue === 'string'
        ? String(errorValue).trim()
        : (errorValue.message || errorValue.code))
      if (hasError || taskStatus === 'failed' || taskStatus === 'expired') {
        const message = typeof errorValue === 'string'
          ? errorValue
          : (errorValue && errorValue.message) || String(data?.status || nested?.status || '') || 'MiniMax 异步语音合成失败'
        throw classifyBaseRespError(message, this.id)

      }
      if (statusCode !== undefined && Number(statusCode) !== 0) {
        throw classifyBaseRespError(
          String(baseResp.status_msg || ('MiniMax 异步语音合成失败（status_code=' + statusCode + '）')),
          this.id,
          statusCode,
        )
      }

      if (Date.now() >= deadline) {
        throw new ProviderError(ERROR_CODES.TIMEOUT, 'MiniMax 异步语音合成查询超时', { providerId: this.id })
      }
      await new Promise((resolve) => setTimeout(resolve, DEFAULT_ASYNC_POLL_INTERVAL_MS))
    }
  }
  /** 返回静态预定义 MiniMax TTS 模型列表（副本） */
  async listModels() {
    return MINIMAX_TTS_MODELS.map(m => ({ ...m }))
  }

  /**
   * 列出可用音色（系统音色 + 用户已复刻音色）。
   * 官方文档：https://platform.minimaxi.com/docs/faq/system-voice-id.md
   * @returns {Promise<{id: string, name: string}[]>}
   */
  async listVoices() {
    return MINIMAX_SYSTEM_VOICES.map(voice => ({ id: voice.id, name: voice.name }))
  }

  /**
   * 上传复刻音频 → 创建音色复刻任务。
   * 官方文档：https://platform.minimaxi.com/docs/guides/speech-voice-clone.md
   * 上传：POST /v1/files/upload（purpose=voice_clone）→ file_id
   * 复刻：POST /v1/voice_clone（file_id + voice_id）
   * 要求：mp3/m4a/wav、时长 10s-5min、大小 ≤20MB（由 tts-voice-clone-service 前置校验）
   * 自定义 voice_id 约束（官方 API 文档）：长度 [8,256]、首字符必须为英文字母、
   * 允许数字/字母/-/_、末位字符不可为 -/_、不可与已有 id 重复。
   * @param {{name?: string, samples?: Array<{blob?: Blob, fileName?: string, contentType?: string}>}} params
   * @returns {Promise<{id: string, name: string}>}
   */
  async cloneVoice(params = {}) {
    const sample = Array.isArray(params.samples) ? params.samples[0] : null
    if (!sample || !sample.blob) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'MiniMax 音色复刻需要一个待克隆音频样本')
    }
    const form = new FormData()
    form.append('purpose', 'voice_clone')
    form.append('file', sample.blob, sample.fileName || 'clone_input.mp3')

    let uploadResp
    try {
      uploadResp = await fetch(this._url('/files/upload'), {
        method: 'POST',
        headers: { Authorization: 'Bearer ' + this.credentials.apiKey },
        body: form,
      })
    } catch (e) {
      throw new ProviderError(ERROR_CODES.NETWORK_ERROR, '上传复刻音频失败: ' + (e.message || String(e)), { providerId: this.id })
    }
    if (!uploadResp.ok) {
      const body = await uploadResp.text().catch(() => '')
      throw fromHttpStatus(uploadResp.status, body.slice(0, 300), { providerId: this.id })
    }
    const uploadJson = await uploadResp.json()
    const fileId = uploadJson?.file?.file_id
    if (!fileId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '上传复刻音频未返回 file_id', { providerId: this.id })
    }

    // 生成符合官方约束的克隆音色 voice_id（长度 [8,256]、首字母、仅 [A-Za-z0-9_-]、末位非 -_）
    const requestedName = String(params.name || 'clone_voice').trim()
    const voiceId = buildMiniMaxCloneVoiceId(requestedName)

    // 官方文档示例：快速复刻接口需传 model（speech-2.8-hd）
    const cloneResp = await this._request('/voice_clone', {
      method: 'POST',
      body: JSON.stringify({ file_id: fileId, voice_id: voiceId, model: VOICE_CLONE_MODEL }),
    })
    const cloneJson = await cloneResp.json()
    // 音色复刻失败必须 fail closed：MiniMax 业务错误常以 HTTP 200 + base_resp.status_code != 0
    // 返回（如 2038 voice clone user forbidden）。若忽略 base_resp 并把本地生成的
    // voice_id 当作成功回显，会持久化一个不存在的幻影克隆音色，后续 TTS 必然报
    // voice id wrong，流水线还会误判为“克隆音色不可用”而回退默认官方音色。
    const cloneBaseResp = cloneJson?.base_resp
    if (cloneBaseResp && Number.isFinite(Number(cloneBaseResp.status_code)) && Number(cloneBaseResp.status_code) !== 0) {
      const statusMsg = cloneBaseResp.status_msg || ('MiniMax 音色复刻失败（status_code=' + cloneBaseResp.status_code + '）')
      throw classifyBaseRespError(statusMsg, this.id, cloneBaseResp.status_code)
    }
    const finalId = cloneJson?.voice_id || cloneJson?.data?.voice_id || voiceId
    if (!finalId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '音色复刻未返回 voice_id', { providerId: this.id })
    }
    // 平台回显的 voice_id 若不合规（旧服务端/异常），回退到本次生成的合规 id
    const validatedId = isValidMiniMaxCloneVoiceId(finalId) ? String(finalId) : voiceId
    return { id: validatedId, name: requestedName }
  }

  /** 测试连接 — 验证 apiKey 存在 */
  async testConnection() {
    const validation = this.validateConfig()
    if (!validation.valid) {
      return {
        success: false,
        error: new ProviderError(ERROR_CODES.INVALID_CONFIG, validation.errors.join(', ')),
      }
    }
    return { success: true }
  }
}

module.exports = {
  MinimaxTtsAdapter,
  MINIMAX_TTS_MODELS,
  MINIMAX_SYSTEM_VOICES,
  buildMiniMaxCloneVoiceId,
  isValidMiniMaxCloneVoiceId,
}
