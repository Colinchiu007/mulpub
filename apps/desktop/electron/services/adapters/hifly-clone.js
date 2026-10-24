// @ts-check
/**
 * hifly-clone.js — 飞影形象/声音克隆方法（prototype mixin）
 *
 * 从 hifly.js 拆出（max-lines 门禁：新代码不得引入超大文件），
 * 与 heygen-clone.js 同型的拆分方式：
 *   Object.assign(HiFlyAdapter.prototype, require('./hifly-clone').cloneMethods)
 *
 * 与 HeyGen 侧的契约差异（本 mixin 存在的全部理由）：
 *  - 素材必须两步走：tool/create_upload_url 换 file_id → PUT 上传二进制。
 *    飞影的克隆接口只接受 *_url / file_id，**不接受二进制**；把本地文件读成
 *    Blob 直接发会被拒。HeyGen 是直接发 Blob，所以两家不能共用一段代码。
 *  - 声音克隆：POST /voice/create，voice_type 必填且目前只支持 8。
 *  - 克隆任务状态：GET /avatar/task（形象）/ GET /voice/task（声音），
 *    与视频任务的 /video/task 是三个不同端点，status 同为整数枚举。
 */
'use strict'

const { ProviderError, ERROR_CODES, fromHttpStatus } = require('./_base/provider-error')

/** 形象克隆任务状态（官方「查询任务状态」）：1等待 2处理中 3完成 4失败 */
const STATUS_MAP = Object.freeze({ 1: 'processing', 2: 'processing', 3: 'completed', 4: 'failed' })

/**
 * 声音克隆类型：官方文档「创建声音」标注 voice_type 必填且**目前只支持 8**
 * （声音克隆基础版 v2）。上游放开其它档位时只改这一行。
 */
const VOICE_CLONE_TYPE = 8

/**
 * 声音可调参数及其取值范围（change: hifly-voice-edit，官方 POST /voice/edit）。
 *
 * 官方契约要点：
 *  - 三个字段都是 **string** 类型（示例 "1.2"），不是 number；
 *  - `rate` 语速 0.5~2.0，`volume` 音量 0.1~2.0，`pitch` 语调 0.1~2.0，默认均 1.0；
 *  - `voice` 必填。
 *
 * 为什么在 adapter 本地校验而不是交给服务端：越界请求会消耗一次往返，
 * 且服务端只回通用「参数格式不正确」，用户不知道该改哪个值；本地拦下能给即时、
 * 可操作的反馈。真实 Token 侧证：rate 传数字 1.2 会被服务端以该理由拒绝。
 */
const VOICE_PARAM_RANGES = Object.freeze({
  rate: Object.freeze({ min: 0.5, max: 2.0, label: '语速' }),
  volume: Object.freeze({ min: 0.1, max: 2.0, label: '音量' }),
  pitch: Object.freeze({ min: 0.1, max: 2.0, label: '语调' }),
})

/**
 * MIME 子类型 → 扩展名 别名表。
 *
 * 为什么需要：飞影 `create_upload_url` 要的是**扩展名**（`file_extension`），
 * 而 Blob.type 给的是 MIME，两者不总相等。直接拿子类型当扩展名会传出
 * `mpeg` / `quicktime` 这类飞影未必认的值。
 */
const HIFLY_MIME_EXT_ALIASES = Object.freeze({
  mpeg: 'mp3',
  mp3: 'mp3',
  quicktime: 'mov',
  'x-msvideo': 'avi',
  jpeg: 'jpg',
})

const cloneMethods = {
  /**
   * 获取素材上传地址（官方「上传文件」第一步）。
   *
   * 为什么必须两步：飞影的克隆接口**不接受二进制**，只接受 `*_url` 或
   * `file_id`；file_id 只能由这里换取。
   *
   * @param {string} fileExtension 后缀名（不含点），如 mp4 / mp3 / jpg
   * @returns {Promise<{uploadUrl: string, contentType: string, fileId: string}>}
   */
  async createUploadUrl (fileExtension) {
    const ext = String(fileExtension || '').replace(/^\./, '').toLowerCase()
    if (!ext) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'fileExtension is required')
    }
    const resp = await this._request('/tool/create_upload_url', {
      method: 'POST',
      body: JSON.stringify({ file_extension: ext }),
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data || {}
    if (!data.file_id || !data.upload_url) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '飞影未返回 file_id / upload_url', { providerId: this.id })
    }
    return {
      uploadUrl: String(data.upload_url),
      contentType: String(data.content_type || 'application/octet-stream'),
      fileId: String(data.file_id),
    }
  },

  /**
   * 上传文件到预签名地址（官方「上传文件」第二步）。
   *
   * 要点（官方文档）：PUT 方法、binary body、必须带该文件的 Content-Type；
   * 预签名 URL 自带凭证，**不得**再发 Authorization（发了反而可能被拒）。
   *
   * @param {{uploadUrl: string, contentType: string, buffer: Buffer}} params
   */
  async uploadFile ({ uploadUrl, contentType, buffer }) {
    if (!uploadUrl) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'uploadUrl is required')
    }
    if (!buffer) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'buffer is required')
    }
    const response = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      body: buffer,
    })
    if (!response.ok) {
      throw fromHttpStatus(response.status, `素材上传失败 HTTP ${response.status}`, { providerId: this.id })
    }
    return true
  },

  /**
   * 创建克隆形象（照片或视频）。
   *
   * 上层传 `{type, name, fileId|imageUrl|videoUrl}`（与 HeyGen adapter 同参），
   * 这里按飞影契约分流到 create_by_image / create_by_video：
   *   type: 'photo'         → create_by_image（image_url / file_id）
   *   type: 'digital_twin'  → create_by_video（video_url / file_id）
   *
   * @returns {Promise<{taskId: string}>}
   */
  /**
   * 从素材推后缀名。
   *
   * 优先级：显式 fileName > Blob 的 MIME 反查 > 调用方给的 type 兜底。
   * 为什么需要后两级：avatar-clone-service 按 HeyGen 契约传 `{ image: Blob }`，
   * Blob 没有文件名；而飞影的 create_upload_url **必须**要 `file_extension`。
   *
   * @param {Blob|Buffer|Uint8Array} blob
   * @param {string} [fileNameHint]
   * @param {'photo'|'digital_twin'|'audio'} [kind] 兜底类型
   * @returns {string} 不带点的后缀名
   */
  _resolveFileExtension (blob, fileNameHint, kind) {
    const fromName = typeof fileNameHint === 'string' ? fileNameHint.toLowerCase().match(/\.[a-z0-9]+$/) : null
    if (fromName) return fromName[0].slice(1)

    // Blob 带 MIME（service 会传 contentType）。
    // MIME 子类型不总等于扩展名（audio/mpeg → mp3、video/quicktime → mov、
    // image/jpeg → jpg），用别名表归一——飞影 create_upload_url 要的是扩展名。
    const mime = blob && typeof blob.type === 'string' ? blob.type.toLowerCase() : ''
    const fromMime = mime.match(/^(?:image|video|audio)\/([a-z0-9.+-]+)$/)
    if (fromMime) {
      const sub = fromMime[1]
      const aliased = HIFLY_MIME_EXT_ALIASES[sub]
      if (aliased) return aliased
      if (/^[a-z0-9]+$/.test(sub)) return sub
    }

    // type 兜底：飞影官方明确支持的格式
    if (kind === 'photo') return 'png'
    if (kind === 'digital_twin') return 'mp4'
    if (kind === 'audio') return 'mp3'
    return ''
  },

  /**
   * 把素材规整成飞影认的 `file_id`。
   *
   * 为什么需要它：飞影的克隆接口（create_by_image / create_by_video / voice/create）
   * **只接受 `*_url` 或 `file_id`，不接受二进制**。而 avatar-clone-service 按
   * HeyGen 契约传 Blob（`{ image|video: Blob }`）。两种契约的差异在这里消化，
   * 上层（service / IPC / UI）就不需要长 provider 分支。
   *
   * 三步：create_upload_url 换上传地址 → PUT 传二进制 → 拿 file_id。
   *
   * @param {Blob|Buffer|Uint8Array} blob 素材二进制
   * @param {string} [fileNameHint] 文件名提示，用于推后缀；缺省按 MIME/type 推
   * @param {'photo'|'digital_twin'|'audio'} [kind] 兜底类型
   * @returns {Promise<string>} file_id
   */
  async ensureFileId (blob, fileNameHint, kind) {
    if (!blob) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, '素材为空')
    }
    const fileExtension = this._resolveFileExtension(blob, fileNameHint, kind)
    if (!fileExtension) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, '无法推断素材后缀名（create_upload_url 需要 file_extension）')
    }

    // ① 换上传地址
    const urlResp = await this._request('/tool/create_upload_url', {
      method: 'POST',
      body: JSON.stringify({ file_extension: fileExtension }),
    })
    const urlDecoded = await this._decode(urlResp)
    if (!urlDecoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, urlDecoded.message, { providerId: this.id })
    }
    const { upload_url: uploadUrl, file_id: fileId, content_type: contentType } = urlDecoded.data || {}
    if (!uploadUrl || !fileId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '飞影未返回 upload_url / file_id', { providerId: this.id })
    }

    // ② PUT 传二进制。预签名 URL 自带凭证，**不得**再发 Authorization
    //    （官方文档明确：只设置 Content-Type）。
    const buffer = Buffer.isBuffer(blob)
      ? blob
      : Buffer.from(blob instanceof Uint8Array ? blob : await blob.arrayBuffer())
    const putResp = await fetch(uploadUrl, {
      method: 'PUT',
      headers: { 'Content-Type': contentType || 'application/octet-stream' },
      body: buffer,
    })
    if (!putResp.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, `素材上传失败 HTTP ${putResp.status}`, { providerId: this.id })
    }

    return String(fileId)
  },

  async createAvatar (params) {
    const type = params && params.type
    const name = params && params.name ? String(params.name).trim() : ''
    const fileId = params && params.fileId ? String(params.fileId).trim() : ''
    const imageUrl = params && params.imageUrl ? String(params.imageUrl).trim() : ''
    const videoUrl = params && params.videoUrl ? String(params.videoUrl).trim() : ''
    // 上层按 HeyGen 契约传的 Blob（image / video 二选一）
    const blob = (params && (params.image || params.video)) || null

    if (type !== 'photo' && type !== 'digital_twin') {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, "params.type must be 'photo' or 'digital_twin'")
    }
    if (!fileId && !imageUrl && !videoUrl && !blob) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'createAvatar requires fileId, imageUrl, videoUrl or a media blob')
    }

    const isVideo = type === 'digital_twin'
    const path = isVideo ? '/avatar/create_by_video' : '/avatar/create_by_image'
    const sourceKey = isVideo ? 'video_url' : 'image_url'
    const body = {}
    // title 不传时飞影默认「未命名」；给了就传
    if (name) body.title = name
    // 给了 Blob 就先换成 file_id（飞影不收二进制）
    const resolvedFileId = fileId
      || (blob ? await this.ensureFileId(blob, params && params.fileName, type) : '')
    if (resolvedFileId) body.file_id = resolvedFileId
    if (isVideo && videoUrl) body[sourceKey] = videoUrl
    if (!isVideo && imageUrl) body[sourceKey] = imageUrl

    const resp = await this._request(path, {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data || {}
    const taskId = data.task_id || data.taskId
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '飞影未返回 task_id', { providerId: this.id })
    }
    return { taskId: String(taskId) }
  },

  /**
   * 查询克隆形象任务状态（GET /avatar/task）。
   *
   * @returns {Promise<{status: string, avatarId: string}>}
   */
  async getAvatarStatus (taskId) {
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'taskId is required')
    }
    const resp = await this._request('/avatar/task', {
      method: 'GET',
      query: { task_id: taskId },
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data || {}
    const raw = Number(data.status)
    return {
      status: STATUS_MAP[raw] || 'processing',
      avatarId: String(data.avatar || '').trim(),
    }
  },

  /**
   * 删除克隆形象（DELETE /avatar?avatar=）。
   *
   * 只认 code===0 判成功：删除类响应体通常没有 data，
   * 拿 data 真值判会把成功读成失败（#4194 踩过）。
   *
   * @returns {Promise<boolean>}
   */
  async deleteAvatar (avatarId) {
    const id = avatarId ? String(avatarId).trim() : ''
    if (!id) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'avatarId is required')
    }
    const resp = await this._request('/avatar', {
      method: 'DELETE',
      query: { avatar: id },
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    return true
  },

  /**
   * 克隆声音（POST /voice/create）。
   *
   * 官方约束：`voice_type` 必填且**目前只支持 8**（声音克隆基础版 v2）；
   * `title` 必填 ≤20 字；音频来源 mp3/m4a/wav、≤20MB、5 秒～3 分钟；
   * 同一账号经 API 创建的声音上限 200 个。
   *
   * @param {{name: string, fileId?: string, audioUrl?: string, language?: string}} params
   * @returns {Promise<{taskId: string}>}
   */
  async cloneVoice (params) {
    const name = params && params.name ? String(params.name).trim() : ''
    const fileId = params && params.fileId ? String(params.fileId).trim() : ''
    const audioUrl = params && params.audioUrl ? String(params.audioUrl).trim() : ''
    const language = params && params.language ? String(params.language).trim() : ''
    // 上层可能按 HeyGen 契约直接传录音 Blob
    const blob = (params && params.audio) || null

    if (!name) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.name is required')
    }
    if (!fileId && !audioUrl && !blob) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'cloneVoice requires fileId, audioUrl or an audio blob')
    }

    const body = {
      title: name,
      voice_type: VOICE_CLONE_TYPE,
    }
    const resolvedFileId = fileId
      || (blob ? await this.ensureFileId(blob, params && params.fileName, 'audio') : '')
    if (resolvedFileId) body.file_id = resolvedFileId
    if (audioUrl) body.audio_url = audioUrl
    // languages 不填时飞影默认普通话；显式给了才传（避免把默认值写死成 zh）
    if (language) body.languages = language

    const resp = await this._request('/voice/create', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data || {}
    const taskId = data.task_id || data.taskId
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, '飞影未返回 task_id', { providerId: this.id })
    }
    return { taskId: String(taskId) }
  },

  /**
   * 查询声音克隆任务状态（GET /voice/task）。
   *
   * @returns {Promise<{status: string, voiceId: string}>}
   */
  /**
   * 修改已克隆声音的参数（POST /voice/edit）。
   *
   * change: hifly-voice-edit —— 补齐官方能力。此前只实现了增/查，
   * 用户克隆完声音后无法调语速/音量/语调，而「克隆后可反复使用」的体验
   * 恰恰依赖这三个参数（同一段录音，不同节目需要不同语速）。
   *
   * 官方约束：`voice` 必填；`rate`/`volume`/`pitch` 必填且为**字符串**，
   * 范围分别 0.5~2.0 / 0.1~2.0 / 0.1~2.0，默认 1.0。
   * 响应只有 code/message/request_id——**提交即完成，无 task 概念**。
   *
   * 真实 Token 侧证（2026-10-24）：`rate` 传数字 1.2 会被服务端以
   * 「参数格式不正确」拒绝 ⇒ 「官方要字符串」是硬约束，不是文档笔误；
   * 对真实克隆音色传 1.2/1.0/1.0 等三组参数均返回 { ok: true }，0 积分消耗。
   *
   * @param {{voice: string, rate?: string, volume?: string, pitch?: string}} params
   * @returns {Promise<{ok: true}>}
   */
  async editVoice (params) {
    const voice = params && typeof params.voice === 'string' ? params.voice.trim() : ''
    if (!voice) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.voice is required')
    }

    const body = { voice }
    for (const [key, range] of Object.entries(VOICE_PARAM_RANGES)) {
      const value = params ? params[key] : undefined
      if (value === undefined) continue
      // 官方要字符串形态（示例 "1.2"）；数字一律拒，避免 1 / 1.0 / "1" 的歧义
      if (typeof value !== 'string' || !value.trim()) {
        throw new ProviderError(ERROR_CODES.INVALID_CONFIG, `${key} must be a non-empty string`)
      }
      const trimmed = value.trim()
      const num = Number(trimmed)
      if (!Number.isFinite(num) || num < range.min || num > range.max) {
        throw new ProviderError(
          ERROR_CODES.INVALID_CONFIG,
          `${key} must be between ${range.min} and ${range.max} (got ${trimmed})`,
        )
      }
      body[key] = trimmed
    }

    const resp = await this._request('/voice/edit', {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    return { ok: true }
  },

  async getVoiceCloneStatus (taskId) {
    if (!taskId) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'taskId is required')
    }
    const resp = await this._request('/voice/task', {
      method: 'GET',
      query: { task_id: taskId },
    })
    const decoded = await this._decode(resp)
    if (!decoded.ok) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, decoded.message, { providerId: this.id })
    }
    const data = decoded.data || {}
    const raw = Number(data.status)
    return {
      status: STATUS_MAP[raw] || 'processing',
      voiceId: String(data.voice || data.voice_id || '').trim(),
    }
  },
}

module.exports = { cloneMethods }
