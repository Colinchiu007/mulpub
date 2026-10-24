// @ts-check
/**
 * hifly.js — 飞影 HiFly 数字人 Adapter（change: digital-human-multiprovider）
 *
 * 与 heygen.js 的关系：**同名同参**。digital-human-stages.js 已按
 * `{character, voice, script}` 调用数字人 provider，本 adapter 在内部把
 * 三要素映射成飞影的扁平字段，上层（流水线 / IPC / UI）零改动。
 *
 * 飞影 API 关键特性（与 HeyGen 的差异全在这里）：
 *  - 认证：`Authorization: Bearer ${token}`（HeyGen 是 X-Api-Key）
 *  - 视频生成：`POST /video/create_by_tts`，body **扁平** `{avatar, voice, text, title?}`
 *    （HeyGen 是 video_inputs 对象嵌套）
 *  - 状态查询：`GET /video/task?task_id=`（HeyGen 是 /v1/video_status.get）
 *  - 形象/音色列表：**带 page/size/kind 分页**（HeyGen 全量返回），本 adapter
 *    内部翻页消化，对上层仍返回全量数组
 *  - 错误模型：token 失败返回 401；**其他业务异常返回 200 + body code**，
 *    与 HeyGen 同型但 code 语义不同（飞影 0 为成功）
 *
 * ⚠ 端点与字段来自官方文档摘录 + 官方 skill 源码常量
 *   （BASE_URL = https://hfw-api.hifly.cc/api/v2/hifly）+ Apifox 镜像的
 *   OpenAPI 导出，**未经真实 Token 核对**（见 openspec/changes/
 *   digital-human-multiprovider/tasks.md T10）。首跑核对后如需修正，
 *   改本文件与 hifly.test.js，不要把测试改成迁就实现。
 */

const { BaseAdapter } = require('./_base/base')
const { ProviderError, ERROR_CODES, fromHttpStatus } = require('./_base/provider-error')

const DEFAULT_BASE_URL = 'https://hfw-api.hifly.cc/api/v2/hifly'
const DEFAULT_TIMEOUT = 60000
/**
 * 列表 kind 参数（官方文档「查询数字人列表」）：
 *   0: 全部（自己的数字人排在前面）
 *   1: 自己的数字人
 *   2: 公共数字人（不传时的默认值）
 *
 * 数字人配置区要的是「用户自己克隆的形象优先，公共形象兜底」，故取 **1**；
 * 若取默认值 2 会把用户刚克隆的形象整批漏掉（最坏故障形态：克隆成功但下拉里看不见）。
 */
/**
 * 列表 kind 参数（官方文档 + **真实 Token 核对 2026-10-24**）：
 *
 * avatar/list：
 *   0: 全部（自己的排在前面）
 *   1: 自己的数字人
 *   2: 公共数字人（不传时的默认值）
 *
 * voice/list（实测三种取值）：
 *   0: 返回 0 条
 *   1: 自己的克隆音色（未克隆时为 0 条）
 *   2: 公共音色（20 条）
 *
 * 数字人配置区要的是「用户自己克隆的优先，公共兜底」，故：
 *   - 形象取 **1**（自己的）。取默认值 2 会把用户刚克隆的形象整批漏掉——
 *     最坏故障形态是「克隆成功但下拉里看不见」。
 *   - 音色取 **2**（公共）。取 1 在没克隆过音色时会拿到 0 条，
 *     用户连一个音色都选不了。
 */
const AVATAR_KIND = '1'
const VOICE_KIND = '2'
/** 列表分页大小（飞影 size 上限 200，取 100 留余量） */
const LIST_PAGE_SIZE = 100
/** 翻页上限：防止服务端 total 异常时无限翻 */
const MAX_LIST_PAGES = 20

/**
 * 字幕字段映射与校验（change: hifly-voice-subtitle-parity）。
 *
 * 官方 `create_by_tts` 的 9 个 st_* 字段（见官方文档「视频创作（文本驱动）」）：
 *   st_show / st_font_name / st_font_size / st_primary_color / st_outline_color /
 *   st_width / st_height / st_pos_x / st_pos_y
 *
 * 设计要点：
 *  - **全部可选**：subtitle 缺省时返回 `{}`，让飞影用它自己的「默认不显示」语义；
 *  - **给了就校验**：颜色必须是 `#rrggbb`、数值必须是有限整数。非法值抛错并把
 *    字段名点出来——静默丢弃会让用户以为字幕生效了，结果成片没有；
 *  - 纯函数抽出来是为了能脱离 adapter 单测（字段多、边界多）。
 *
 * @param {unknown} subtitle 上层传入的字幕配置
 * @returns {Record<string, number|string>} 可直接 Object.assign 进请求体的 st_* 字段
 */
function buildSubtitleFields (subtitle) {
  if (subtitle === undefined || subtitle === null) return {}
  if (typeof subtitle !== 'object' || Array.isArray(subtitle)) {
    throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.subtitle must be an object')
  }

  const out = {}
  // st_show：只有显式给了布尔值才发。0/1 之外的值不接受（官方是 int 枚举）
  if (subtitle.show !== undefined) {
    if (typeof subtitle.show !== 'boolean') {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'subtitle.show must be a boolean')
    }
    out.st_show = subtitle.show ? 1 : 0
  }

  if (subtitle.fontName !== undefined) {
    if (typeof subtitle.fontName !== 'string' || !subtitle.fontName.trim() || subtitle.fontName.length > 100) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'st_font_name must be a non-empty string (<=100 chars)')
    }
    out.st_font_name = subtitle.fontName.trim()
  }

  // 数值字段：有限整数，且不允许负数（坐标/宽高/字号都没有负值语义）
  const numericFields = [
    ['fontSize', 'st_font_size'],
    ['width', 'st_width'],
    ['height', 'st_height'],
    ['posX', 'st_pos_x'],
    ['posY', 'st_pos_y'],
  ]
  for (const [inputKey, apiKey] of numericFields) {
    const value = subtitle[inputKey]
    if (value === undefined) continue
    if (!Number.isInteger(value) || value < 0) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, `${apiKey} must be a non-negative integer`)
    }
    out[apiKey] = value
  }

  // 颜色字段：#rrggbb（官方文档示例即此格式；不接受颜色名或 #rgb）
  const colorFields = [
    ['primaryColor', 'st_primary_color'],
    ['outlineColor', 'st_outline_color'],
  ]
  for (const [inputKey, apiKey] of colorFields) {
    const value = subtitle[inputKey]
    if (value === undefined) continue
    if (typeof value !== 'string' || !/^#[0-9a-fA-F]{6}$/.test(value)) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, `${apiKey} must be in #rrggbb form`)
    }
    out[apiKey] = value
  }

  return out
}

const HIFLY_MODELS = [
  { id: 'hifly', name: '飞影 HiFly', description: '飞影数字人视频生成' },
]

/**
 * 飞影任务状态（官方文档「查询创作任务状态」）：
 *   1: 等待中  2: 处理中  3: 完成  4: 失败
 * 归一为本仓三态（与 digital-human-stages.js 的 TERMINAL_STATES 对齐）。
 * 未知值兜底 processing —— **不谎称完成**，宁可让轮询继续也别把失败读成成功。
 *
 * 注：克隆侧（hifly-clone.js）另有一份同形映射，两者数值相同但服务不同端点
 * （/video/task vs /avatar/task、/voice/task），刻意不合并——合并会让
 * 「改一个端点的语义」意外影响另一个。
 */
const STATUS_MAP = Object.freeze({
  1: 'processing',
  2: 'processing',
  3: 'completed',
  4: 'failed',
})

class HiFlyAdapter extends BaseAdapter {
  /**
   * @param {object} credentials
   * @param {string} credentials.apiKey - 飞影 API Token（必填）
   * @param {string} [credentials.baseUrl] - 自定义端点
   * @param {object} [options]
   */
  constructor (credentials, options = {}) {
    super(credentials, options)
    this.credentials.baseUrl = this.credentials.baseUrl || DEFAULT_BASE_URL
    this.options.timeout = this.options.timeout || DEFAULT_TIMEOUT
    this.options.maxRetries = this.options.maxRetries || 2
  }

  /** 验证配置：apiKey 必填 */
  validateConfig () {
    const errors = []
    if (!this.credentials.apiKey) errors.push('apiKey is required')
    if (!this.credentials.baseUrl) errors.push('baseUrl is required')
    return errors.length === 0 ? { valid: true } : { valid: false, errors }
  }

  /**
   * 构造请求头 — 飞影文档的唯一认证头是 Authorization: Bearer。
   * （HeyGen 用 X-Api-Key；两家不同，刻意不做双头发送。）
   */
  _headers () {
    return {
      'Authorization': `Bearer ${this.credentials.apiKey}`,
      'Content-Type': 'application/json',
    }
  }

  /** 构造完整 URL */
  _url (path, queryParams = {}) {
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
   * 统一 fetch 包装 — 处理超时和错误转换。
   *
   * 与 HeyGen 版的差异：飞影的业务错误常以 **HTTP 200 + body code != 0** 返回，
   * 因此这里不能只看 response.ok，由各方法解出 body 后再判 code。
   */
  async _request (path, opts = {}) {
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
   * 解出响应体并按飞影语义判业务 code。
   *
   * @returns {Promise<{ok: boolean, data: any, message: string}>}
   *   ok=false 时 message 已带可读原因（供上层透出）
   */
  async _decode (response) {
    let body
    try { body = await response.json() } catch (_) { body = null }
    if (!body || typeof body !== 'object') {
      return { ok: false, data: null, message: '飞影返回了无法解析的响应体' }
    }
    // 飞影：code === 0 为成功；非 0 时 message 说明原因
    if (typeof body.code === 'number' && body.code !== 0) {
      return { ok: false, data: null, message: body.message || `飞影业务错误 code=${body.code}` }
    }
    return { ok: true, data: body.data === undefined ? body : body.data, message: '' }
  }

  /**
   * 提交数字人视频生成任务。
   *
   * 上层传 {character, voice, script}（与 HeyGen adapter 同参），
   * 这里映射成飞影扁平字段 {avatar, voice, text}。
   *
   * @returns {Promise<{taskId: string, model: string}>}
   */
  async generateVideo (params) {
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
      avatar: params.character,
      voice: params.voice,
      text: params.script,
    }
    // title 可选：飞影侧用于任务命名，缺省不发（避免无意义字段）
    if (typeof params.title === 'string' && params.title.trim()) {
      body.title = params.title.trim()
    }
    // 字幕参数（change: hifly-voice-subtitle-parity）：官方 9 个 st_* 字段。
    // 全部为可选——缺省整个不发，让飞影用它自己的「默认不显示」语义；
    // 一旦给了 subtitle 就逐字段校验，非法值直接拒（不猜、不静默丢弃）。
    Object.assign(body, buildSubtitleFields(params.subtitle))

    const resp = await this._request('/video/create_by_tts', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data || {}
    const taskId = data.task_id || data.taskId || data.id || data.video_id
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '飞影未返回 task_id', { providerId: this.id })
    }
    return { taskId: String(taskId), model: 'hifly' }
  }

  /**
   * 查询视频任务状态。
   *
   * 官方契约：`status` 是**整数枚举**（1等待/2处理中/3完成/4失败），
   * 视频地址字段名是 `video_Url`（大写 U——文档原样，不是笔误），
   * 另返回 `duration`（秒）。三者都挂在**响应体顶层**而非 data 内。
   *
   * @returns {Promise<{status: string, videoUrl: string, duration: number}>}
   */
  async getVideoStatus (taskId) {
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'taskId is required')
    }
    const resp = await this._request('/video/task', {
      method: 'GET',
      query: { task_id: taskId },
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const statusData = decoded.data || {}
    // _decode 在无 data 字段时回退整个 body，故 status/video_Url/duration 取得到
    const raw = Number(statusData.status)
    const status = STATUS_MAP[raw] || 'processing'
    // video_Url 是文档字段名（大写 U）；兼容小写与驼峰拼写防上游改动
    const videoUrl = statusData.video_Url || statusData.videoUrl || statusData.video_url || statusData.url || ''
    const duration = statusData.duration !== undefined ? Number(statusData.duration) : 0
    return { status, videoUrl, duration }
  }

  /**
   * 列出可用数字人形象（GET /avatar/list，分页在内部消化）。
   *
   * @returns {Promise<Array<{id: string, name: string, previewUrl: string, gender: string}>>}
   */
  async listAvatars () {
    // 真实字段（Token 核对）：avatar（标识）/ title（名称）/ cover_url（封面图）/ kind（1自己的 / 2公共）/ tags / description
    return this._listCatalog('/avatar/list', AVATAR_KIND, ['avatar', 'avatar_id', 'id'], ['title', 'avatar_name', 'name'], 'cover_url')
  }

  /**
   * 列出可用音色（GET /voice/list，分页在内部消化）。
   *
   * @returns {Promise<Array<{id: string, name: string, language: string, gender: string}>>}
   */
  async listVoices () {
    const out = []
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const resp = await this._request('/voice/list', {
        method: 'GET',
        query: { page: String(page), size: String(LIST_PAGE_SIZE), kind: VOICE_KIND },
      })
      const decoded = await this._decode(resp)
      if (!decoded.ok) return []
      const items = this._listPageItems(decoded.data)
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        // 真实字段（Token 核对）：voice（标识）/ title（名称）/ preview_url / type / rate / pitch / volume / tags
        const id = String(item.voice || item.voice_id || item.id || '').trim()
        if (!id) continue
        out.push({
          id,
          name: String(item.title || item.name || item.display_name || id).trim() || id,
          language: String(item.language || '').trim(),
          gender: String(item.gender || '').trim(),
        })
      }
      if (!this._listPageHasMore(decoded.data, out.length, items.length)) break
    }
    return out
  }

  /**
   * 形象列表的通用翻页实现（音色另有一份，因为字段名不同）。
   * @private
   */
  async _listCatalog (path, kind, idKeys, nameKeys, previewKey) {
    const out = []
    for (let page = 1; page <= MAX_LIST_PAGES; page++) {
      const resp = await this._request(path, {
        method: 'GET',
        query: { page: String(page), size: String(LIST_PAGE_SIZE), kind },
      })
      const decoded = await this._decode(resp)
      if (!decoded.ok) return []
      const items = this._listPageItems(decoded.data)
      for (const item of items) {
        if (!item || typeof item !== 'object') continue
        const id = idKeys.map((k) => String(item[k] || '').trim()).find(Boolean)
        if (!id) continue
        const name = nameKeys.map((k) => String(item[k] || '').trim()).find(Boolean)
        out.push({
          id,
          name: name || id,
          previewUrl: previewKey ? String(item[previewKey] || '').trim() : '',
          gender: String(item.gender || '').trim(),
        })
      }
      if (!this._listPageHasMore(decoded.data, out.length, items.length)) break
    }
    return out
  }

  /**
   * 取一页的条目数组：兼容 `{list:[...]}` / `{items:[...]}` / 「data 直接是数组」三种形态。
   * @private
   */
  _listPageItems (data) {
    if (Array.isArray(data)) return data
    if (Array.isArray(data && data.list)) return data.list
    if (Array.isArray(data && data.items)) return data.items
    return []
  }

  /**
   * 判断还有没有下一页。
   *
   * @param {object} data 本页原始响应体
   * @param {number} fetchedSoFar **已累计取到的条数**（不是页码×请求 size——
   *   服务端可能少返，用请求 size 算会把「还有货」误判成到底）
   * @param {number} pageSize 本页实际返回条数（无 total 时的兜底判据）
   * @private
   */
  _listPageHasMore (data, fetchedSoFar, pageSize) {
    // 真实响应（Token 核对）**没有 total 字段**——data 直接是数组。
    // 所以翻页判据只能是「本页是否翻满」：翻满说明可能还有下一页，
    // 没翻满说明已经是最后一页。靠 total 判会在没有该字段时提前终止，
    // 表现是「永远只拿到第一页」。
    return pageSize >= LIST_PAGE_SIZE
  }

  /** 测试连接 — 通过 GET /avatar/list 验证认证（真实目录、免费） */
  async testConnection () {
    const validation = this.validateConfig()
    if (!validation.valid) {
      return { success: false, error: new ProviderError(ERROR_CODES.INVALID_CONFIG, validation.errors.join(', ')) }
    }
    try {
      const resp = await this._request('/avatar/list', {
        method: 'GET',
        query: { page: '1', size: '1', kind: AVATAR_KIND },
      })
      await this._decode(resp)
      return { success: true }
    } catch (e) {
      return { success: false, error: e }
    }
  }
}

// 形象/声音克隆方法在 hifly-clone.js（max-lines 拆分，与 heygen-clone 同型）
Object.assign(HiFlyAdapter.prototype, require('./hifly-clone').cloneMethods)
// 辅助与作品管理端点（积分/模板/封面/删除作品）在 hifly-extra.js
Object.assign(HiFlyAdapter.prototype, require('./hifly-extra').extraMethods)
// 6 个收费创作模式（声音驱动/网感模板/翻译/唱歌/图片驱动/音频）在 hifly-create-modes.js
Object.assign(HiFlyAdapter.prototype, require('./hifly-create-modes').createModeMethods)

module.exports = { HiFlyAdapter, HIFLY_MODELS }
