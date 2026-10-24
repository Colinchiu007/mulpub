// @ts-check
/**
 * agnes-multimodal.js — Agnes-AI 多模态 Adapter（中国站，2026-09-16）
 *
 * 将 Agnes 现有三类模型合并为一个多模态预设（同一 API Key，统一 Base URL）：
 *   - 文字推理：agnes-3.0-flash        POST /chat/completions（OpenAI 兼容）
 *   - 图片生成：agnes-image-2.5-flash  POST /images/generations（OpenAI 兼容）
 *   - 视频生成：agnes-video-2.5-flash  POST /videos（OpenAI Videos 兼容，异步任务）
 *
 * Base URL（中国站）：https://api.agnes-ai.cn/v1
 * 官方文档：
 *   - https://www.agnes-ai.cn/zh-Hans/docs/agnes-30-flash
 *   - https://www.agnes-ai.cn/zh-Hans/docs/agnes-image-25-flash
 *   - https://www.agnes-ai.cn/zh-Hans/docs/agnes-video-25-flash
 *
 * 实现策略（对齐 minimax-multimodal.js）：
 *   - LLM / Image 复用既有 agnes-llm / agnes-image 适配器（协议不变，仅换 Base URL 与模型 ID）
 *   - Video 2.5 Flash 为全新协议（与 agnes-video-v2.0 的 width/num_frames 协议不兼容），本类内实现：
 *     提交 { model, prompt, mode, seconds, size: '720P', aspect_ratio, seed }
 *     查询 GET {apiRoot}/agnesapi?video_id=<ID>&model_name=<模型ID>（model_name 必带，
 *     否则 keyframe/reference 模式任务无法查询）
 *
 * 实现的方法（capabilities）：
 *   - chatCompletion() / streamChat()   文字推理（委托 AgnesLlmAdapter）
 *   - generateImage()                   图片生成（委托 AgnesImageAdapter，默认模型 2.5 Flash）
 *   - generateVideo()                   提交视频任务（v2.5 协议，含 503/429 有界重试）
 *   - getVideoStatus()                  查询任务状态（/agnesapi + model_name）
 *   - listModels() / testConnection() / validateConfig()
 */

const { BaseAdapter } = require('./_base/base')
const { ProviderError, ERROR_CODES, fromHttpStatus } = require('./_base/provider-error')
const { AgnesLlmAdapter } = require('./agnes-llm')
const { AgnesImageAdapter } = require('./agnes-image')
const { fetchWithTimeout } = require('./_base/fetch-utils')
const { buildAgnesVideoRequest, pickAspectRatio, pickSeconds } = require('./agnes-video-request')

const DEFAULT_BASE_URL = 'https://api.agnes-ai.cn/v1'
const DEFAULT_TIMEOUT = 120000

const DEFAULT_LLM_MODEL = 'agnes-3.0-flash'
const DEFAULT_IMAGE_MODEL = 'agnes-image-2.5-flash'
const DEFAULT_VIDEO_MODEL = 'agnes-video-2.5-flash'

// 静态预定义 Agnes-AI 多模态模型列表
// 注意：这里列的是**产品暴露面**（模型设置页能选到的模型），与 agnes-video-models.js 的
// 「API 能力真相」是两层。后者已包含非 Flash 的 agnes-video-2.5，但把它接进本列表与
// 模型种子是 agnes-video-nonflash-reference-video change 的职责（届时两处同步）。
const AGNES_MULTIMODAL_MODELS = [
  { id: 'agnes-3.0-flash', name: 'Agnes 3.0 Flash', description: '文字推理（OpenAI 兼容 chat/completions，512K 上下文）' },
  { id: 'agnes-image-2.5-flash', name: 'Agnes Image 2.5 Flash', description: '图片生成（/images/generations，1K-4K 档位）' },
  { id: 'agnes-video-2.5-flash', name: 'Agnes Video 2.5 Flash', description: '视频生成（OpenAI Videos 兼容 /videos，720P 异步任务）' },
  { id: 'agnes-video-2.5', name: 'Agnes Video 2.5', description: '视频生成（720P/1080P/1K/2K；支持参考视频；按秒计费）' },
]

// 视频支持的 aspect_ratio 与对应宽高比数值（官方文档「视频尺寸与画幅」）
const VIDEO_ASPECT_RATIOS = [
  { ratio: '21:9', value: 21 / 9 },
  { ratio: '16:9', value: 16 / 9 },
  { ratio: '4:3', value: 4 / 3 },
  { ratio: '1:1', value: 1 },
  { ratio: '3:4', value: 3 / 4 },
  { ratio: '9:16', value: 9 / 16 },
]

class AgnesMultimodalAdapter extends BaseAdapter {
  /**
   * @param {object} credentials
   * @param {string} credentials.apiKey - Agnes API Key（必填，sk- 开头）
   * @param {string} [credentials.baseUrl] - 自定义端点（默认中国站 https://api.agnes-ai.cn/v1）
   * @param {object} [options]
   * @param {number} [options.timeout=120000] - 请求超时（ms）
   * @param {number} [options.maxRetries=2] - 最大重试次数（BaseAdapter 通用请求重试）
   * @param {number} [options.maxVideoAttempts=6] - 视频提交的最大尝试次数（含首次；503/429 退避重试窗口）
   */
  constructor(credentials, options = {}) {
    super(credentials, options)
    this.credentials.baseUrl = this.credentials.baseUrl || DEFAULT_BASE_URL
    this.options.timeout = this.options.timeout || DEFAULT_TIMEOUT
    this.options.maxRetries = this.options.maxRetries || 2
    // 提交重试退避（ms）：沿用 agnes-video.js 经验（503 队列满载 / 429 限流可持续数分钟）
    this.options.retryBackoffMs = Array.isArray(options.retryBackoffMs) && options.retryBackoffMs.length
      ? options.retryBackoffMs
      : [20000, 30000, 45000, 60000, 60000]
    this._llm = new AgnesLlmAdapter(this.credentials, options)
    this._image = new AgnesImageAdapter(this.credentials, options)
    // video 任务 ID → 提交时的模型 ID（查询接口 /agnesapi 必须回传 model_name）
    this._videoTaskModels = new Map()
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
   * 统一 fetch 包装 — 处理超时和错误转换（与 agnes-video.js 同模式）
   */
  async _request(path, opts = {}) {
    const url = this._url(path)
    const headers = { ...this._headers(), ...(opts.headers || {}) }

    try {
      const timeoutMs = Number.isFinite(Number(this.options.timeout)) && Number(this.options.timeout) > 0
        ? Number(this.options.timeout)
        : DEFAULT_TIMEOUT
      const response = await fetchWithTimeout(url, { ...opts, headers }, timeoutMs)

      if (!response.ok) {
        let errorBody
        try { errorBody = await response.json() } catch (_) {
          try { errorBody = await response.text() } catch (__) { errorBody = {} }
        }
        const message = (errorBody && errorBody.error && (errorBody.error.message || errorBody.error))
          || (errorBody && errorBody.message)
          || (errorBody && errorBody.detail)
          || (typeof errorBody === 'string' ? errorBody : `HTTP ${response.status}`)
        const err = fromHttpStatus(response.status, message, { providerId: this.id, url })
        // 沿用 agnes-video.js：503 队列满载 / 429 限流 / 500 为可重试瞬时条件
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

  // ─── 文字推理（LLM）──────────────────────────
  /** OpenAI 兼容 POST /chat/completions；未指定模型时默认 agnes-3.0-flash */
  chatCompletion(params) {
    const merged = { model: DEFAULT_LLM_MODEL, ...(params || {}) }
    return this._llm.chatCompletion(merged)
  }

  /** 流式 chat/completions（stream=true） */
  streamChat(params, onChunk) {
    const merged = { model: DEFAULT_LLM_MODEL, ...(params || {}) }
    return this._llm.streamChat(merged, onChunk)
  }

  // ─── 生图 ───────────────────────────────────
  /**
   * POST /images/generations；未指定模型时默认 agnes-image-2.5-flash。
   * 协议约束（官方文档）：顶层 response_format 会被拒绝，输出格式必须放
   * extra_body.response_format（AgnesImageAdapter 已实现该约定）。
   */
  generateImage(params) {
    const merged = { model: DEFAULT_IMAGE_MODEL, ...(params || {}) }
    return this._image.generateImage(merged)
  }

  // ─── 视频（v2.5 全新协议）─────────────────────
  /**
   * 提交视频生成任务（OpenAI Videos 兼容）
   *
   * 能力边界（2026-10-23 起）由 `agnes-video-models.js` 的**能力描述**驱动，不再在本文件
   * 里散落模型判定 —— 尺寸档位、参考图/音频/视频上限、是否支持参考视频，全部读 `spec`：
   *   - Flash：size 固定 "720P"；images ≤ 5、audios ≤ 3；**不支持 videos**（服务端 400 `videos is not supported`）
   *   - 标准 2.5：size 支持 "720P"/"1080P"/"1K"/"2K"；images ≤ 8、audios ≤ 3、videos ≤ 1
   * 客户端预校验的目的是**不浪费一次必然 400 的请求**，判据与服务端规则同源。
   *
   * @param {object} params
   * @param {string} params.prompt - 生成提示词（必填）
   * @param {string} [params.model='agnes-video-2.5-flash'] - 模型 ID
   * @param {string} [params.mode] - 生成模式 text/keyframe/reference；缺省时按媒体参数推导
   * @param {string} [params.image] - 图生视频首帧图 URL（推导为 keyframe 模式）
   * @param {string[]} [params.images] - reference 模式参考图片 URL 列表
   * @param {string[]} [params.audios] - reference 模式参考音频 URL 列表
   * @param {Array} [params.videos] - reference 模式参考视频对象列表（仅标准 2.5 支持）
   * @param {string} [params.first_frame] / [params.last_frame] - keyframe 首尾帧 URL
   * @param {number} [params.width] / [params.height] - 像素尺寸，用于推导最近 aspect_ratio
   * @param {number} [params.numFrames] / [params.frameRate] - 用于推导 seconds（4–12）
   * @param {string} [params.aspect_ratio] - 显式画幅（16:9 等），优先于宽高推导
   * @param {string} [params.size] - 显式分辨率档位；不被模型支持时本地拒收
   * @param {number|string} [params.seconds] - 显式时长（4–12）
   * @param {number} [params.seed] - 随机种子
   * @returns {Promise<{taskId: string, model: string}>}
   */
  async generateVideo(params) {
    if (!params || !params.prompt) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.prompt is required')
    }

    const model = params.model || DEFAULT_VIDEO_MODEL
    // 请求体构造与本地预校验抽在 agnes-video-request.js（纯函数，便于独立测试；
    // 适配器只留「发请求 + 重试」的职责，避免自身撞 500 行门禁）。
    const built = buildAgnesVideoRequest({ params, model })
    if (built.error) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, built.error, { providerId: this.id })
    }
    const body = built.body

    // 真实运行经验（agnes-video-v2.0，2026-08-11 W7）：Agnes 提交偶发 503 队列满载 /
    // 429 限流，均为瞬时条件。有界重试 + 递增退避；非重试错误（401/403/402/400）立即抛出。
    // 提交重试次数经 maxVideoAttempts 配置（默认 6 次尝试；options.maxRetries 是
    // BaseAdapter 通用请求重试，与视频提交的重试窗口不同，不混用）。
    const maxAttempts = Number.isFinite(Number(this.options.maxVideoAttempts)) && Number(this.options.maxVideoAttempts) > 0
      ? Number(this.options.maxVideoAttempts)
      : 6
    const backoffMs = this.options.retryBackoffMs
    let lastError = null
    for (let attempt = 1; attempt <= maxAttempts; attempt++) {
      try {
        const resp = await this._request('/videos', {
          method: 'POST',
          body: JSON.stringify(body),
        })
        const data = await resp.json()

        // 官方文档：id 和 task_id 是任务 ID，video_id 用于查询任务；三种命名都兼容
        const taskId = data.video_id || data.id || data.task_id
        if (!taskId) {
          throw new ProviderError(
            ERROR_CODES.PROVIDER_ERROR,
            'Missing task id in response',
            { providerId: this.id }
          )
        }
        // 记录提交时的模型 ID：查询接口必须回传 model_name（keyframe/reference 必需）
        this._rememberVideoTaskModel(String(taskId), model)

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

  /** 记录任务 ID → 模型 ID 映射（有界：超过 200 条时淘汰最早条目） */
  _rememberVideoTaskModel(taskId, model) {
    if (this._videoTaskModels.size >= 200) {
      const oldest = this._videoTaskModels.keys().next().value
      if (oldest !== undefined) this._videoTaskModels.delete(oldest)
    }
    this._videoTaskModels.set(taskId, model)
  }

  /**
   * 查询视频任务状态
   *
   * model_name 必须与提交时的模型一致（keyframe / reference 模式必需）。
   * 取值优先级：① 适配器实例内记录的「任务 ID → 提交时模型」映射
   *             ② 调用方随 params 传入的 model
   *             ③ 默认模型（agnes-video-2.5-flash）
   * ①的映射是**进程内**的（上限 200 条，适配器重启即失效）⇒ 跨重启续查必须靠 ②。
   *
   * @param {string|object} taskIdOrParams - 任务 ID 字符串，或 callAdapter 统一参数对象 { videoId, taskId, model }
   * @returns {Promise<{status: string, videoUrl: string, progress: number}>}
   */
  async getVideoStatus(taskIdOrParams) {
    const rawTaskId = (taskIdOrParams && typeof taskIdOrParams === 'object')
      ? (taskIdOrParams.videoId || taskIdOrParams.taskId || taskIdOrParams.id)
      : taskIdOrParams
    if (!rawTaskId || !String(rawTaskId).trim()) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'taskId is required')
    }

    // 官方文档（agnes-video-2.5-flash）：推荐查询方式
    // GET /agnesapi?video_id=<VIDEO_ID>&model_name=agnes-video-2.5-flash
    // （/agnesapi 位于域名根，base_url 之外，必须用绝对 URL）；
    // 不带 model_name 的查询仅适用于 mode: "text" 任务。
    const apiRoot = this.credentials.baseUrl.replace(/\/$/, '').replace(/\/v1$/, '')
    const callerModel = (taskIdOrParams && typeof taskIdOrParams === 'object' && typeof taskIdOrParams.model === 'string')
      ? taskIdOrParams.model.trim()
      : ''
    const modelName = this._videoTaskModels.get(String(rawTaskId)) || callerModel || DEFAULT_VIDEO_MODEL
    let data = null
    let lastError = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        const resp = await this._request(
          `${apiRoot}/agnesapi?video_id=${encodeURIComponent(String(rawTaskId))}&model_name=${encodeURIComponent(modelName)}`
        )
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

    // Agnes 状态映射（与 agnes-video.js 一致）
    const statusMap = {
      'queued': 'processing',
      'in_progress': 'processing',
      'completed': 'completed',
      'failed': 'failed',
    }
    const status = statusMap[data.status] || 'processing'
    // 完成时下载 URL 位于 metadata.url（官方响应结构）；兼容旧版顶层 url
    const videoUrl = (status === 'completed' && ((data.metadata && data.metadata.url) || data.url || '')) || ''
    // progress 兜底：非有限数值（如 "80%" / null）回退到状态隐含值，避免 NaN 透传
    const parsedProgress = Number(data.progress)
    const progress = Number.isFinite(parsedProgress)
      ? parsedProgress
      : (status === 'completed' ? 100 : 0)

    // providerStatus：保留服务端**原始状态**（queued / in_progress / completed / failed）。
    // 上面的 status 是归一化后的（queued 与 in_progress 都映射成 processing），
    // 渲染层要区分「排队中 / 生成中」需要原始值。
    return { status, videoUrl, progress, providerStatus: data.status }
  }

  /** 返回静态预定义 Agnes-AI 多模态模型列表（副本） */
  async listModels() {
    return AGNES_MULTIMODAL_MODELS.map(m => ({ ...m }))
  }

  /** 测试连接 — 验证 apiKey 存在（与 minimax-multimodal 同模式，不做网络调用） */
  async testConnection() {
    return this._image.testConnection()
  }
}

module.exports = {
  AgnesMultimodalAdapter,
  AGNES_MULTIMODAL_MODELS,
  DEFAULT_BASE_URL,
  pickAspectRatio,
  pickSeconds,
}
