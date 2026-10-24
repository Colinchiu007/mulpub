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
 * 可操作的反馈。
 */
const VOICE_PARAM_RANGES = Object.freeze({
  rate: Object.freeze({ min: 0.5, max: 2.0, label: '语速' }),
  volume: Object.freeze({ min: 0.1, max: 2.0, label: '音量' }),
  pitch: Object.freeze({ min: 0.1, max: 2.0, label: '语调' }),
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
  async createAvatar (params) {
    const type = params && params.type
    const name = params && params.name ? String(params.name).trim() : ''
    const fileId = params && params.fileId ? String(params.fileId).trim() : ''
    const imageUrl = params && params.imageUrl ? String(params.imageUrl).trim() : ''
    const videoUrl = params && params.videoUrl ? String(params.videoUrl).trim() : ''

    if (type !== 'photo' && type !== 'digital_twin') {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, "params.type must be 'photo' or 'digital_twin'")
    }
    if (!fileId && !imageUrl && !videoUrl) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'createAvatar requires fileId, imageUrl or videoUrl')
    }

    const isVideo = type === 'digital_twin'
    const path = isVideo ? '/avatar/create_by_video' : '/avatar/create_by_image'
    const sourceKey = isVideo ? 'video_url' : 'image_url'
    const body = {}
    // title 不传时飞影默认「未命名」；给了就传
    if (name) body.title = name
    if (fileId) body.file_id = fileId
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

    if (!name) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.name is required')
    }
    if (!fileId && !audioUrl) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'cloneVoice requires fileId or audioUrl')
    }

    const body = {
      title: name,
      voice_type: VOICE_CLONE_TYPE,
    }
    if (fileId) body.file_id = fileId
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
   * 「参数格式不正确」拒绝 ⇒ 「官方要字符串」是硬约束，不是文档笔误。
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

  /**
   * 查询声音克隆任务状态（GET /voice/task）。
   *
   * @returns {Promise<{status: string, voiceId: string}>}
   */
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
