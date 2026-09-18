// @ts-check
/**
 * agnes-video.js — Agnes Video V2.0 Adapter（视频生成）
 *
 * Agnes Video API 关键特性：
 * - 认证头 Authorization: Bearer {key}（sk- 开头密钥）
 * - generateVideo: POST /videos（OpenAI 兼容协议）
 * - 请求体 { model: 'agnes-video-v2.0', prompt, image, width, height, num_frames, frame_rate, negative_prompt, seed }
 * - getVideoStatus: GET /videos/{video_id}（推荐按 video_id 查询）
 * - 异步任务模式：generateVideo 返回 taskId，通过 getVideoStatus 轮询
 *
 * 默认端点 https://apihub.agnes-ai.com/v1，需 API Key。
 * 单模型：agnes-video-v2.0。
 *
 * num_frames 约束：必须满足 8n+1 规则（如 121 = 8*15+1），最大 441。
 *
 * 实现的方法（capabilities）：
 *   - generateVideo()    提交视频生成任务
 *   - getVideoStatus()   查询任务状态
 *   - listModels()       静态预定义列表
 *   - testConnection()   验证 apiKey 存在
 *   - validateConfig()   apiKey + baseUrl 必填
 *
 * 设计决策：
 * - 不覆盖 LLM/TTS/Image 方法（BaseAdapter 默认抛 NotImplementedError）
 * - generateVideo 返回 { taskId, model } 统一格式
 * - listModels 静态列表避免不必要的 HTTP 请求
 */

const { BaseAdapter } = require('./_base/base')
const { ProviderError, ERROR_CODES, fromHttpStatus } = require('./_base/provider-error')

const DEFAULT_BASE_URL = 'https://apihub.agnes-ai.com/v1'
const { fetchWithTimeout } = require('./_base/fetch-utils')
const DEFAULT_TIMEOUT = 120000

const DEFAULT_MODEL = 'agnes-video-v2.0'

// 默认参数（121 帧 @ 24fps ≈ 5s）
const DEFAULT_WIDTH = 1152
const DEFAULT_HEIGHT = 768
const DEFAULT_NUM_FRAMES = 121
const DEFAULT_FRAME_RATE = 24

// 静态预定义 Agnes Video 模型列表
const AGNES_VIDEO_MODELS = [
  { id: 'agnes-video-v2.0', name: 'Agnes Video V2.0', description: 'Agnes 视频生成模型' },
]

class AgnesVideoAdapter extends BaseAdapter {
  /**
   * @param {object} credentials
   * @param {string} credentials.apiKey - Agnes API Key（必填，sk- 开头）
   * @param {string} [credentials.baseUrl] - 自定义端点
   * @param {object} [options]
   * @param {number} [options.timeout=120000] - 请求超时（ms），视频生成较慢
   * @param {number} [options.maxRetries=2] - 最大重试次数
   */
  constructor(credentials, options = {}) {
    super(credentials, options)
    this.credentials.baseUrl = this.credentials.baseUrl || DEFAULT_BASE_URL
    this.options.timeout = this.options.timeout || DEFAULT_TIMEOUT
    this.options.maxRetries = this.options.maxRetries || 2
    // 提交/查询重试退避（ms）：503 队列满载 / 429 限流时递增等待；测试可注入短退避。
    // 真实运行（2026-08-11 W7）：Agnes 队列满载可持续 15+ 分钟，退避窗口须覆盖更长拥堵期。
    this.options.retryBackoffMs = Array.isArray(options.retryBackoffMs) && options.retryBackoffMs.length
      ? options.retryBackoffMs
      : [20000, 30000, 45000, 60000, 60000]
  }

  /** 验证配置：apiKey + baseUrl 必填 */
  validateConfig() {
    const errors = []
    if (!this.credentials.apiKey) errors.push('apiKey is required')
    if (!this.credentials.baseUrl) errors.push('baseUrl is required')
    return errors.length === 0 ? { valid: true } : { valid: false, errors }
  }

  /** 构造请求头 — Agnes 使用 Bearer 认证 */
  _headers() {
    return {
      'Authorization': `Bearer ${this.credentials.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  /** 构造完整 URL（path 为绝对 URL 时原样返回，支持 base 之外的端点） */
  _url(path) {
    if (/^https?:\/\//i.test(String(path))) return path
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
      const timeoutMs = Number.isFinite(Number(this.options.timeout)) && Number(this.options.timeout) > 0 ? Number(this.options.timeout) : DEFAULT_TIMEOUT
      const response = await fetchWithTimeout(url, { ...opts, headers }, timeoutMs)

      if (!response.ok) {
        let errorBody
        try { errorBody = await response.json() } catch (_) {
          try { errorBody = await response.text() } catch (__) { errorBody = {} }
        }
        const message = (errorBody && errorBody.error && (errorBody.error.message || errorBody.error))
          || (errorBody && errorBody.message)
          || (typeof errorBody === 'string' ? errorBody : `HTTP ${response.status}`)
        const err = fromHttpStatus(response.status, message, { providerId: this.id, url })
        // 真实运行（2026-08-11 W7）：Agnes 提交偶发 503 video_queue_full / 429 rate_limit_exceeded
        // （限流约 2 次/分钟），二者均为可重试瞬时条件。用专用标记 retryableHttp 区分
        // 「HTTP 层可重试」与 ERROR_META 默认 retryable 的 PROVIDER_ERROR（后者不可重试）。
        if (response.status === 503 || response.status === 429 || response.status === 500) {
          err.retryableHttp = true
        }
        throw err
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
   * 提交视频生成任务
   *
   * @param {object} params
   * @param {string} params.prompt - 生成提示词（必填）
   * @param {string} [params.model='agnes-video-v2.0'] - 模型 ID
   * @param {string} [params.image] - 图生视频的图片 URL
   * @param {number} [params.width=1152] - 视频宽度
   * @param {number} [params.height=768] - 视频高度
   * @param {number} [params.numFrames=121] - 帧数（需满足 8n+1 规则，最大 441）
   * @param {number} [params.frameRate=24] - 帧率
   * @param {string} [params.negativePrompt] - 负向提示词
   * @param {number} [params.seed] - 随机种子
   * @returns {Promise<{taskId: string, model: string}>}
   */
  async generateVideo(params) {
    if (!params || !params.prompt) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.prompt is required')
    }

    const model = params.model || DEFAULT_MODEL
    const body = {
      model,
      prompt: params.prompt,
      image: params.image || undefined,
      width: params.width || DEFAULT_WIDTH,
      height: params.height || DEFAULT_HEIGHT,
      num_frames: params.numFrames || params.num_frames || DEFAULT_NUM_FRAMES,
      frame_rate: params.frameRate || params.frame_rate || DEFAULT_FRAME_RATE,
      negative_prompt: params.negativePrompt || undefined,
      seed: params.seed || undefined,
    }

    // 真实运行（2026-08-11 W7）：Agnes 视频提交偶发 503 video_queue_full（队列满载）或
    // 429 rate_limit_exceeded（约 2 次/分钟），均为瞬时条件。有界重试 + 递增退避，
    // 避免单次瞬时失败即回退图片轮播；非重试错误（401/403/402 等）立即抛出。
    const maxAttempts = 6
    const backoffMs = this.options.retryBackoffMs
    let lastError = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await this._request('/videos', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        const data = await resp.json()

        // 兼容 OpenAI 协议字段命名。Agnes 网关实际返回 { video_id, id }：
        // video_id 是任务 ID（用于 /agnesapi?video_id= 查询），id 是请求 ID（不能用于查询）。
        // 若漏取 video_id 而用 id 去查询，会得到 task not found（2026-09-18 修复，与 agnes-multimodal 同源）。
        const taskId = data.video_id || data.id || data.task_id
        if (!taskId) {
          throw new ProviderError(
            ERROR_CODES.PROVIDER_ERROR,
            'Missing task id in response',
            { providerId: this.id }
          )
        }

        return { taskId, model }
      } catch (error) {
        lastError = error
        const retryable = (error instanceof ProviderError) &&
          (error.retryableHttp === true || error.code === ERROR_CODES.RATE_LIMITED ||
            error.code === ERROR_CODES.TIMEOUT || error.code === ERROR_CODES.NETWORK_ERROR)
        if (!retryable || attempt >= maxAttempts) break
        const delay = backoffMs[Math.min(attempt - 1, backoffMs.length - 1)] || 45000
        await new Promise(resolve => setTimeout(resolve, delay))
      }
    }
    throw lastError
  }

  /**
   * 查询视频任务状态
   *
   * @param {string|object} taskIdOrParams - 任务 ID 字符串，或 callAdapter 统一参数对象 { videoId, taskId }
   * @returns {Promise<{status: string, videoUrl: string, progress: number}>}
   */
  async getVideoStatus(taskIdOrParams) {
    // callAdapter 统一以 params 对象调用（{ videoId, taskId }）；直接调用时传字符串，两种都兼容
    const rawTaskId = (taskIdOrParams && typeof taskIdOrParams === 'object')
      ? (taskIdOrParams.videoId || taskIdOrParams.taskId || taskIdOrParams.id)
      : taskIdOrParams
    if (!rawTaskId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'taskId is required')
    }

    // 官方文档（agnes-video-v2.0）：推荐查询方式 GET /agnesapi?video_id=<VIDEO_ID>
    // （GET /v1/videos/<TASK_ID> 为兼容旧版方式，部分网关返回 task_not_exist）
    // /agnesapi 位于域名根（base_url 之外），必须用绝对 URL，否则拼成 /v1/agnesapi 会 task not found
    const apiRoot = this.credentials.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '')
    let data = null
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await this._request(`${apiRoot}/agnesapi?video_id=${encodeURIComponent(String(rawTaskId))}&model_name=${encodeURIComponent(DEFAULT_MODEL)}`)
        data = await resp.json()
        break
      } catch (error) {
        lastError = error
        const retryable = (error instanceof ProviderError) &&
          (error.retryableHttp === true || error.code === ERROR_CODES.RATE_LIMITED ||
            error.code === ERROR_CODES.TIMEOUT || error.code === ERROR_CODES.NETWORK_ERROR)
        if (!retryable || attempt >= 3) break
        await new Promise(resolve => setTimeout(resolve, 5000 * attempt))
      }
    }
    if (!data) throw lastError

    // Agnes 状态映射
    const statusMap = {
      'queued': 'processing',
      'in_progress': 'processing',
      'completed': 'completed',
      'failed': 'failed',
    }
    const status = statusMap[data.status] || 'processing'
    // 完成时下载 URL 位于 metadata.url（官方响应结构）；兼容旧版顶层 url
    const videoUrl = (status === 'completed' && ((data.metadata && data.metadata.url) || data.url || '')) || ''
    const progress = data.progress !== undefined ? Number(data.progress) : (status === 'completed' ? 100 : 0)

    return { status, videoUrl, progress }
  }

  /** 返回静态预定义 Agnes Video 模型列表（副本） */
  async listModels() {
    return AGNES_VIDEO_MODELS.map(m => ({ ...m }))
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

module.exports = { AgnesVideoAdapter, AGNES_VIDEO_MODELS }
