// @ts-check
/**
 * mimo-tts.js — 小米 MiMo TTS Adapter（语音合成）
 *
 * MiMo TTS 兼容 OpenAI Chat Completions 接口，通过 messages 传递文本，
 * audio 字段配置声音和格式。
 *
 * 默认端点 https://api.xiaomimimo.com/v1，需 API Key。
 * 支持模型：mimo-v2.5-tts（预置音色）、mimo-v2.5-tts-voiceclone（音色复刻）。
 * （mimo-v2.5-tts-voicedesign 项目用不到，已从代码中移除。）
 *
 * MiMo API 关键特性：
 * - 认证头 api-key: $MIMO_API_KEY（非标准 Bearer，是自定义 api-key header）
 * - synthesize: POST /chat/completions（OpenAI Chat 兼容格式）
 * - 请求体 { model, messages: [{role:'assistant', content: text}], audio: { voice, format }, stream: false }
 * - 响应中 choices[0].message.audio.data 为 base64 编码音频
 * - speed/pitch 无法直接映射，忽略或放入 user message 自然语言指令
 *
 * 音色复刻（克隆）机制（与 MiniMax 不同）：
 * - MiniMax：上传样本 → 平台生成 voice_id → 后续用 voice_id 合成
 * - MiMo：每次合成时把音频样本 Base64 直接放在 audio.voice 字段
 *   （data:{MIME_TYPE};base64,$BASE64_AUDIO，≤10MB，仅 mp3/wav）
 * - 因此 MiMo 克隆音色的 voice_id 是本地 ID（mimo-clone-<uuid>），
 *   样本由 tts-voice-clone-service 持久化；synthesize 时由调用方
 *   （asset-generator）读取样本注入 cloneSampleData 参数。
 *
 * 实现的方法（capabilities）：
 *   - synthesize()       POST /chat/completions（克隆音色自动切 voiceclone 模型）
 *   - listModels()       静态预定义列表（无 HTTP 请求）
 *   - listVoices()       静态预置音色列表（9 个，官方文档）
 *   - cloneVoice()       本地克隆音色（返回本地 voice_id，不调用远端）
 *   - testConnection()   验证 apiKey 存在
 *   - validateConfig()   apiKey + baseUrl 必填
 *
 * 设计决策：
 * - 不覆盖 LLM/Image/Video 方法（BaseAdapter 默认抛 NotImplementedError → supports() 返回 false）
 * - synthesize 返回 { audio: base64数据, format: 'wav' } 统一格式
 * - listModels/listVoices 静态列表避免不必要的 HTTP 请求
 */

const crypto = require('node:crypto')
const { BaseAdapter } = require('./_base/base')
const { ProviderError, ERROR_CODES, fromHttpStatus } = require('./_base/provider-error')

const DEFAULT_BASE_URL = 'https://api.xiaomimimo.com/v1'
const DEFAULT_TIMEOUT = 60000
const DEFAULT_MODEL = 'mimo-v2.5-tts'
const DEFAULT_VOICE = 'mimo_default'
const DEFAULT_OUTPUT_FORMAT = 'wav'
const VOICE_CLONE_MODEL = 'mimo-v2.5-tts-voiceclone'
const CLONE_VOICE_ID_PREFIX = 'mimo-clone-'
const MAX_CLONE_SAMPLE_BYTES = 10 * 1024 * 1024 // 官方：Base64 后 ≤10MB
const CLONE_SAMPLE_MIME_TYPES = new Set(['audio/mpeg', 'audio/mp3', 'audio/wav'])

// 静态预定义 MiMo TTS 模型列表（voicedesign 已移除：项目用不到）
const MIMO_TTS_MODELS = [
  { id: 'mimo-v2.5-tts',            name: 'MiMo TTS v2.5',          description: '预置音色 TTS 模型' },
  { id: 'mimo-v2.5-tts-voiceclone', name: 'MiMo TTS Voice Clone',   description: '音色复刻模型（基于音频样本）' },
]

// MiMo 官方预置音色列表（https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5）
const MIMO_PRESET_VOICES = Object.freeze([
  { id: 'mimo_default', name: 'MiMo-默认', language: '多语言', gender: '因集群而异' },
  { id: '冰糖', name: '冰糖', language: '中文', gender: '女性' },
  { id: '茉莉', name: '茉莉', language: '中文', gender: '女性' },
  { id: '苏打', name: '苏打', language: '中文', gender: '男性' },
  { id: '白桦', name: '白桦', language: '中文', gender: '男性' },
  { id: 'Mia', name: 'Mia', language: '英文', gender: '女性' },
  { id: 'Chloe', name: 'Chloe', language: '英文', gender: '女性' },
  { id: 'Milo', name: 'Milo', language: '英文', gender: '男性' },
  { id: 'Dean', name: 'Dean', language: '英文', gender: '男性' },
])

function isMimoCloneVoiceId (voiceId) {
  return typeof voiceId === 'string' && voiceId.startsWith(CLONE_VOICE_ID_PREFIX)
}

/**
 * 生成 MiMo 本地克隆音色 voice_id（mimo-clone-<uuid>）。
 * 与 MiniMax 不同，MiMo 无远端 voice_id——样本在合成时注入，
 * 此 ID 仅作为本地 registry 的稳定标识。
 */
function buildMimoCloneVoiceId (randomUUID = crypto.randomUUID) {
  return CLONE_VOICE_ID_PREFIX + randomUUID()
}

class MimoTtsAdapter extends BaseAdapter {
  /**
   * @param {object} credentials
   * @param {string} credentials.apiKey - MiMo API Key（必填）
   * @param {string} [credentials.baseUrl] - 自定义端点
   * @param {object} [options]
   * @param {number} [options.timeout=60000] - 请求超时（ms）
   * @param {number} [options.maxRetries=2] - 最大重试次数
   * @param {function} [options.randomUUID] - 克隆音色 ID 生成器（测试注入）
   */
  constructor(credentials, options = {}) {
    super(credentials, options)
    this.credentials.baseUrl = this.credentials.baseUrl || DEFAULT_BASE_URL
    this.options.timeout = this.options.timeout || DEFAULT_TIMEOUT
    this.options.maxRetries = this.options.maxRetries || 2
    this._randomUUID = typeof options.randomUUID === 'function' ? options.randomUUID : crypto.randomUUID
  }

  /** 验证配置：apiKey + baseUrl 必填 */
  validateConfig() {
    const errors = []
    if (!this.credentials.apiKey) errors.push('apiKey is required')
    if (!this.credentials.baseUrl) errors.push('baseUrl is required')
    return errors.length === 0 ? { valid: true } : { valid: false, errors }
  }

  /** 构造请求头 — MiMo 使用自定义 api-key header（非 Bearer） */
  _headers() {
    return {
      'api-key': this.credentials.apiKey,
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

    try {
      const response = await fetch(url, { ...opts, headers })

      if (!response.ok) {
        let errorBody
        try { errorBody = await response.json() } catch (_) {
          try { errorBody = await response.text() } catch (__) { errorBody = {} }
        }
        const message = (errorBody && errorBody.error && (errorBody.error.message || errorBody.error))
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
   * POST /chat/completions — 语音合成（OpenAI Chat 兼容格式）
   *
   * @param {object} params
   * @param {string} params.text - 要合成的文本（必填）
   * @param {string} [params.model] - TTS 模型 ID（克隆音色时忽略，自动切 voiceclone 模型）
   * @param {string} [params.voice='mimo_default'] - 声音 ID（预置音色 ID 或 mimo-clone-<uuid>）
   * @param {string} [params.cloneSampleData] - 克隆音色样本 data URI（data:{mime};base64,...），
   *   仅克隆音色需要；由调用方从本地样本读取注入
   * @param {string} [params.outputFormat='wav'] - 输出格式（wav/mp3/flac）
   * @param {number} [params.speed] - 速度（无法直接映射，忽略）
   * @param {number} [params.pitch] - 音调（无法直接映射，忽略）
   * @returns {Promise<{audio: string, format: string}>} audio 为 base64 编码字符串
   */
  async synthesize(params) {
    if (!params || !params.text) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.text is required')
    }

    const voice = params.voice || DEFAULT_VOICE
    const outputFormat = params.outputFormat || DEFAULT_OUTPUT_FORMAT
    // 克隆音色（mimo-clone-<uuid>）→ 自动切 voiceclone 模型 + 注入样本；
    // 预置音色 → mimo-v2.5-tts 模型。用户无需手动选择「语音模型」。
    const isClone = isMimoCloneVoiceId(voice)
    const model = isClone ? VOICE_CLONE_MODEL : (params.model || DEFAULT_MODEL)
    let audioVoice = voice
    if (isClone) {
      if (!params.cloneSampleData) {
        throw new ProviderError(
          ERROR_CODES.INVALID_CONFIG,
          'MiMo cloned voice requires cloneSampleData (local sample audio)',
          { providerId: this.id }
        )
      }
      audioVoice = params.cloneSampleData
    }

    const body = {
      model,
      messages: [{ role: 'assistant', content: params.text }],
      audio: {
        voice: audioVoice,
        format: outputFormat,
      },
      stream: false,
    }

    const resp = await this._request('/chat/completions', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const data = await resp.json()

    // 提取 base64 音频数据
    const audioData = data?.choices?.[0]?.message?.audio?.data
    if (!audioData) {
      throw new ProviderError(
        ERROR_CODES.PROVIDER_ERROR,
        'Missing audio data in response',
        { providerId: this.id }
      )
    }

    return {
      audio: audioData,
      format: outputFormat,
    }
  }

  /** 返回静态预定义 MiMo TTS 模型列表（副本，防止污染） */
  async listModels() {
    return MIMO_TTS_MODELS.map(m => ({ ...m }))
  }

  /**
   * 列出 MiMo 官方预置音色（9 个）。
   * 官方文档：https://mimo.mi.com/docs/zh-CN/quick-start/usage-guide/audio/speech-synthesis-v2.5
   * @returns {Promise<{id: string, name: string}[]>}
   */
  async listVoices() {
    return MIMO_PRESET_VOICES.map(voice => ({ id: voice.id, name: voice.name }))
  }

  /**
   * 本地克隆音色（MiMo 无远端克隆 API）。
   *
   * 与 MiniMax 不同，MiMo 的「音色复刻」是每次合成时把音频样本 Base64
   * 直接放在 audio.voice 字段（data:{mime};base64,...，≤10MB，仅 mp3/wav）。
   * 因此这里不调用任何远端接口，只生成一个本地 voice_id 供 registry 绑定；
   * 样本文件由 tts-voice-clone-service 持久化，合成时由 asset-generator
   * 读取样本并注入 cloneSampleData。
   *
   * @param {{name?: string, samples?: Array<{blob?: Blob, fileName?: string, contentType?: string}>}} params
   * @returns {Promise<{id: string, name: string}>}
   */
  async cloneVoice(params = {}) {
    const sample = Array.isArray(params.samples) ? params.samples[0] : null
    if (!sample || !sample.blob) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'MiMo 音色复刻需要一个待克隆音频样本')
    }
    const contentType = String(sample.contentType || '').toLowerCase()
    if (!CLONE_SAMPLE_MIME_TYPES.has(contentType)) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        'MiMo 音色复刻仅支持 mp3/wav 格式音频样本',
        { providerId: this.id }
      )
    }
    const size = Number(sample.blob.size)
    if (Number.isFinite(size) && size > MAX_CLONE_SAMPLE_BYTES) {
      throw new ProviderError(
        ERROR_CODES.INVALID_CONFIG,
        'MiMo 音色复刻样本 Base64 后不能超过 10MB',
        { providerId: this.id }
      )
    }
    const requestedName = String(params.name || 'clone_voice').trim()
    const id = buildMimoCloneVoiceId(this._randomUUID)
    return { id, name: requestedName }
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
  MimoTtsAdapter,
  MIMO_TTS_MODELS,
  MIMO_PRESET_VOICES,
  isMimoCloneVoiceId,
  buildMimoCloneVoiceId,
}
