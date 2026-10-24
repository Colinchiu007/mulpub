// @ts-check
/**
 * heygen.js — HeyGen 数字人 Adapter
 *
 * HeyGen API 关键特性：
 * - 认证: X-Api-Key（官方文档头；不再发 Authorization，避免双认证头歧义）
 * - generateVideo: POST /v2/video/generate，请求体按官方契约
 *   { video_inputs: [{ character: { type:'avatar', avatar_id, avatar_style },
 *                      voice: { type:'text', input_text, voice_id } }], dimension }
 * - getVideoStatus: GET /v1/video_status.get?video_id={taskId}（注意状态查询在 v1 根，
 *   与 /v2 提交不同 API 根；2026-10-21 修正，见 openspec/changes/heygen-adapter-contract）
 * - 异步任务模式：generateVideo 返回 video_id，通过 getVideoStatus 轮询
 * - 数字人专用：需指定 character、voice、script
 *
 * 实现的方法（capabilities）：
 *   - generateVideo()    提交数字人视频生成任务
 *   - getVideoStatus()   查询任务状态
 *   - listAvatars()      列出可用数字人形象（GET /v2/avatars）
 *   - listVoices()       列出可用音色（GET /v2/voices）
 *   - listModels()       静态预定义列表
 *   - testConnection()   通过最小请求验证
 */

const { BaseAdapter } = require('./_base/base')
const { ProviderError, ERROR_CODES, fromHttpStatus } = require('./_base/provider-error')

const DEFAULT_BASE_URL = 'https://api.heygen.com/v2'
const DEFAULT_TIMEOUT = 60000

// 静态预定义模型列表
const HEYGEN_MODELS = [
  { id: 'heygen', name: 'HeyGen', description: 'HeyGen 数字人视频生成' },
]

class HeyGenAdapter extends BaseAdapter {
  /**
   * @param {object} credentials
   * @param {string} credentials.apiKey - HeyGen API Key（必填）
   * @param {string} [credentials.baseUrl] - 自定义端点
   * @param {object} [options]
   */
  constructor(credentials, options = {}) {
    super(credentials, options)
    this.credentials.baseUrl = this.credentials.baseUrl || DEFAULT_BASE_URL
    this.options.timeout = this.options.timeout || DEFAULT_TIMEOUT
    this.options.maxRetries = this.options.maxRetries || 2
  }

  /** 验证配置：apiKey 必填 */
  validateConfig() {
    const errors = []
    if (!this.credentials.apiKey) errors.push('apiKey is required')
    if (!this.credentials.baseUrl) errors.push('baseUrl is required')
    return errors.length === 0 ? { valid: true } : { valid: false, errors }
  }

  /** 构造请求头 — HeyGen 文档的唯一认证头是 X-Api-Key（不做双头发送） */
  _headers() {
    return {
      'X-Api-Key': this.credentials.apiKey,
      'Content-Type': 'application/json',
    }
  }

  /** 构造完整 URL */
  _url(path, queryParams = {}) {
    const base = this.credentials.baseUrl.replace(/\/$/, '')
    let url = `${base}${path}`
    const entries = Object.entries(queryParams).filter(([_, v]) => v !== undefined && v !== null)
    if (entries.length > 0) {
      const qs = entries.map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&')
      url += `?${qs}`
    }
    return url
  }

  /**
   * API 根（去掉版本段）。
   *
   * 为什么需要：提交走 `/v2/video/generate`，而状态查询在 `/v1/video_status.get`
   * ——两者不是同一个版本前缀。credentials.baseUrl 默认是 `https://api.heygen.com/v2`，
   * 直接拼 `/v1` 会变成 `/v2/v1/...`。
   *
   * 用 URL 解析而不是正则截字符串：baseUrl 可能带端口、子路径或查询串；
   * 只剥掉**路径末尾**的版本段，查询/哈希一并丢弃（API 根不应带它们）。
   */
  _apiRoot() {
    const raw = String(this.credentials.baseUrl || DEFAULT_BASE_URL)
    try {
      const parsed = new URL(raw)
      parsed.pathname = parsed.pathname.replace(/\/v\d+\/?$/i, '') || '/'
      parsed.search = ''
      parsed.hash = ''
      return parsed.toString().replace(/\/$/, '')
    } catch (_) {
      // 非法 URL 交给调用方在网络层报错；这里只做保守去尾
      return raw.replace(/\/+$/, '').replace(/\/v\d+$/i, '')
    }
  }

  /**
   * 统一 fetch 包装 — 处理超时和错误转换
   */
  async _request(path, opts = {}) {
    const url = (typeof path === 'string' && path.startsWith('http')) ? path : this._url(path, opts.query)
    const headers = { ...this._headers(), ...(opts.headers || {}) }
    const fetchOpts = { ...opts }
    delete fetchOpts.query

    try {
      const response = await fetch(url, { ...fetchOpts, headers })

      if (!response.ok) {
        let errorBody
        try { errorBody = await response.json() } catch (_) {
          try { errorBody = await response.text() } catch (__) { errorBody = {} }
        }
        const message = (errorBody && errorBody.message)
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
   * 提交数字人视频生成任务
   * @param {object} params
   * @param {string} params.character - 数字人 ID（必填）
   * @param {string} params.voice - 语音 ID（必填）
   * @param {string} params.script - 脚本文本（必填）
   * @returns {Promise<{taskId: string, model: string}>}
   */
  async generateVideo(params) {
    if (!params || !params.character) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.character is required')
    }
    if (!params.voice) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.voice is required')
    }
    if (!params.script) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.script is required')
    }

    // 官方 v2 契约（https://docs.heygen.com/reference/create-an-avatar-video-v2）：
    // character / voice 都是对象，脚本文本在 voice.input_text，不在 video_inputs[0].script。
    // 2026-10-21 修正前这里是扁平字符串 + 顶层 script，单测照着自家形状断言所以全绿，
    // 但真实调用会 400——回归锁见 heygen.test.js「官方契约锁」。
    const width = Number(params.width)
    const height = Number(params.height)
    // avatar_style 官方枚举只有 normal / circle；未知值回落 normal，
    // 不把上游拼错的样式原样发给 HeyGen（会变成 400 且难定位）。
    const avatarStyle = params.avatarStyle === 'circle' ? 'circle' : 'normal'
    const body = {
      video_inputs: [{
        character: {
          type: 'avatar',
          avatar_id: params.character,
          avatar_style: avatarStyle,
        },
        voice: {
          type: 'text',
          input_text: params.script,
          voice_id: params.voice,
        },
      }],
      dimension: {
        width: Number.isFinite(width) && width > 0 ? Math.round(width) : 1280,
        height: Number.isFinite(height) && height > 0 ? Math.round(height) : 720,
      },
    }

    const resp = await this._request('/video/generate', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const data = await resp.json()

    const taskId = data.data && data.data.video_id
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'Missing video_id in response', { providerId: this.id })
    }

    return { taskId, model: 'heygen' }
  }

  /**
   * 查询视频任务状态
   * @param {string} taskId - 任务 ID（video_id）
   * @returns {Promise<{status: string, videoUrl: string, progress: number}>}
   */
  async getVideoStatus(taskId) {
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'taskId is required')
    }

    // 官网状态查询：GET {apiRoot}/v1/video_status.get?video_id=...
    // 不是 /v2/video/status——旧实现把提交路径的版本前缀直接套到状态查询上，
    // 真实调用会 404 并把数字人流水线拖到 10 分钟轮询超时。
    const url = `${this._apiRoot()}/v1/video_status.get?video_id=${encodeURIComponent(taskId)}`
    const resp = await this._request(url, { method: 'GET' })
    const data = await resp.json()

    // HeyGen 习惯用 HTTP 200 + 业务 code 表达错误。官方 video_status.get 的成功码是 100；
    // 0 只作为「网关把 code 归一为 0」的兼容形态接受，两种都写在这里，不静默扩大成功面。
    if (data && typeof data.code === 'number' && data.code !== 100 && data.code !== 0) {
      throw new ProviderError(
        ERROR_CODES.PROVIDER_ERROR,
        data.message || `HeyGen video_status error code ${data.code}`,
        { providerId: this.id, url },
      )
    }

    const statusData = (data && data.data) || {}
    // HeyGen 状态映射：waiting/pending 也是排队中
    const statusMap = {
      'waiting': 'processing',
      'pending': 'processing',
      'processing': 'processing',
      'completed': 'completed',
      'success': 'completed',
      'failed': 'failed',
      'error': 'failed',
      'cancelled': 'failed',
    }
    const status = statusMap[String(statusData.status || '').toLowerCase()] || 'processing'
    const videoUrl = statusData.video_url || statusData.videoUrl || statusData.url || ''
    const progress = statusData.progress !== undefined ? Number(statusData.progress) : (status === 'completed' ? 100 : 0)

    return { status, videoUrl, progress }
  }

  /** 返回静态预定义模型列表 */
  async listModels() {
    return HEYGEN_MODELS.map(m => ({ ...m }))
  }

  /**
   * 列出账号可用的数字人形象（GET /v2/avatars）。
   *
   * 为什么要做归一化：HeyGen 的 avatars 响应在不同版本/形态下字段不一致
   * （data.avatars / data 直接是数组，字段 avatar_id / id 混用），调用方
   * （avatar-catalog-service → UI 下拉）需要稳定的 { id, name } 形状。
   * 拿不到 id 的条目直接丢弃，不产出「id 为空的形象」——那会让下游
   * generateVideo 收到空 character 并抛 INVALID_CONFIG。
   *
   * @returns {Promise<Array<{id: string, name: string, previewUrl: string, gender: string}>>}
   */
  async listAvatars() {
    const resp = await this._request('/avatars', { method: 'GET' })
    const data = await resp.json()
    const raw = Array.isArray(data && data.data)
      ? data.data
      : (Array.isArray(data && data.data && data.data.avatars) ? data.data.avatars : [])
    const out = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const id = String(item.avatar_id || item.id || '').trim()
      if (!id) continue
      out.push({
        id,
        name: String(item.avatar_name || item.name || id).trim() || id,
        previewUrl: String(item.preview_url || item.avatar_image_url || '').trim(),
        gender: String(item.gender || '').trim(),
      })
    }
    return out
  }

  /**
   * 列出账号可用音色（GET /v2/voices）。
   *
   * 归一化同 listAvatars：字段 voice_id / id 混用，附带 language/gender 供 UI 分组展示。
   *
   * @returns {Promise<Array<{id: string, name: string, language: string, gender: string}>>}
   */
  async listVoices() {
    const resp = await this._request('/voices', { method: 'GET' })
    const data = await resp.json()
    const raw = Array.isArray(data && data.data)
      ? data.data
      : (Array.isArray(data && data.data && data.data.voices) ? data.data.voices : [])
    const out = []
    for (const item of raw) {
      if (!item || typeof item !== 'object') continue
      const id = String(item.voice_id || item.id || '').trim()
      if (!id) continue
      out.push({
        id,
        name: String(item.name || item.display_name || id).trim() || id,
        language: String(item.language || '').trim(),
        gender: String(item.gender || '').trim(),
      })
    }
    return out
  }

  /** 测试连接 — 通过 GET /v2/avatars 验证认证与数字人读取权限 */
  async testConnection() {
    const validation = this.validateConfig()
    if (!validation.valid) {
      return { success: false, error: new ProviderError(ERROR_CODES.INVALID_CONFIG, validation.errors.join(', ')) }
    }
    try {
      // 用真实目录接口而不是伪造 taskId：既验证 Key，也验证 scope 能读数字人目录。
      // 旧实现打 /video/status?id=connection-test 并把 404/500 当成功，实际上连认证
      // 有没有过都说不清（2026-10-21 修正）。
      await this._request('/avatars', { method: 'GET' })
      return { success: true }
    } catch (e) {
      return { success: false, error: e }
    }
  }
}

Object.assign(HeyGenAdapter.prototype, require('./heygen-clone').cloneMethods)

module.exports = { HeyGenAdapter, HEYGEN_MODELS }
