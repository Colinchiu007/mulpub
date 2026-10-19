// @ts-check
/**
 * heygen.js — HeyGen 数字人 Adapter
 *
 * HeyGen API 关键特性：
 * - 认证: Bearer token
 * - generateVideo: POST /video/generate，请求体 { video_inputs: [{ character, voice, script }] }
 * - getVideoStatus: GET /video/status?id={taskId}
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

  /** 构造请求头 — Bearer 认证 */
  _headers() {
    return {
      'Authorization': `Bearer ${this.credentials.apiKey}`,
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

    const body = {
      video_inputs: [{
        character: params.character,
        voice: params.voice,
        script: params.script,
      }],
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

    const resp = await this._request('/video/status', {
      method: 'GET',
      query: { id: taskId },
    })
    const data = await resp.json()
    const statusData = data.data || {}

    // HeyGen 状态映射
    const statusMap = {
      'processing': 'processing',
      'completed': 'completed',
      'failed': 'failed',
      'success': 'completed',
    }
    const status = statusMap[statusData.status] || 'processing'
    const videoUrl = statusData.video_url || ''
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

  /** 测试连接 — 通过 GET /video/status 验证认证 */
  async testConnection() {
    const validation = this.validateConfig()
    if (!validation.valid) {
      return { success: false, error: new ProviderError(ERROR_CODES.INVALID_CONFIG, validation.errors.join(', ')) }
    }
    try {
      // 用一个虚拟 id 测试，认证通过返回 404 或 success:false 表示连接正常
      await this._request('/video/status', {
        method: 'GET',
        query: { id: 'connection-test' },
      })
      return { success: true }
    } catch (e) {
      if (e instanceof ProviderError && e.code === ERROR_CODES.AUTH_FAILED) {
        return { success: false, error: e }
      }
      // 404 / PROVIDER_ERROR 表示认证通过
      if (e instanceof ProviderError && (e.code === ERROR_CODES.PROVIDER_ERROR)) {
        return { success: true }
      }
      return { success: false, error: e }
    }
  }
}

module.exports = { HeyGenAdapter, HEYGEN_MODELS }
