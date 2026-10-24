// @ts-check
/**
 * heygen-clone.js — HeyGen 形象/声音克隆方法（prototype mixin）
 *
 * 从 heygen.js 拆出（max-lines 门禁：新代码不得引入超大文件）。
 * 挂载方式：Object.assign(HeyGenAdapter.prototype, cloneMethods)。
 *
 * 关键事实：**形象克隆与声音克隆是两条独立端点族，都不在视频生成时一起做。**
 * 视频生成只传 avatar_id / voice_id 引用（developers.heygen.com：
 * "When voice_id is omitted, the look's default voice is used"）。
 *
 * 版本段分裂：克隆 /v3、视频生成 /v2（#4194）、状态查询 /v1。
 * 故用 _v3Url() 按端点取版本段，不硬拼前缀。
 *
 * 警告：/v3/avatars 的字段名未经真实响应核对（本机 DNS 解析不到
 * developers.heygen.com）。三个形象方法未登记 KNOWN_METHODS，
 * callAdapter 的 supports() 闸门会拦下它们，本轮是预期内的 fail-closed；
 * 首跑核对字段后才登记（提案「KNOWN_METHODS 分期登记」）。
 */

const { ProviderError, ERROR_CODES } = require('./_base/provider-error')

const cloneMethods = {
  /**
   * 克隆声音 — POST /v3/voices/clone
   *
   * 声音克隆是独立端点，不在视频生成时一起做。视频生成只传 voice_id 引用，
   * 所以必须先在这里拿到 voice_id，再由流水线引用。
   *
   * 官方形态（reference/clone-a-voice）：
   *   - 返回 voice_clone_id，轮询 GET /v3/voices/ 至 status=complete
   *   - mode: instant（单条录音，秒级）/ professional（多录音高保真）
   *
   * @param {object} params
   * @param {string} params.name - 克隆声音名称
   * @param {Array<{blob: Blob, fileName: string, contentType: string}>} params.samples - 主进程转换后的样本
   * @returns {Promise<{id: string, name: string}>}
   */
  async cloneVoice (params) {
    const name = typeof params === 'object' && params !== null && typeof params.name === 'string' ? params.name.trim() : ''
    if (!name) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.name is required')
    }
    const samples = Array.isArray(params && params.samples) ? params.samples : []
    if (samples.length === 0) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'cloneVoice requires at least one audio sample')
    }
    // 只接受主进程转换后的 Blob；renderer 字节/base64/路径一律拒绝
    // （与 elevenlabs/minimax-tts 的同一条边界：样本必须经过主进程）
    for (const sample of samples) {
      if (!sample || typeof sample !== 'object' || !(sample.blob instanceof Blob)) {
        throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'cloneVoice samples must be main-process Blobs')
      }
    }

    // 官方请求体是 JSON；音频以 base64 data URL 进字段（非 multipart）
    const encoded = []
    for (const sample of samples) {
      const buffer = Buffer.from(await sample.blob.arrayBuffer())
      encoded.push(`data:${sample.contentType || 'application/octet-stream'};base64,${buffer.toString('base64')}`)
    }

    const body = {
      name,
      mode: samples.length > 1 ? 'professional' : 'instant',
      audio: encoded[0],
    }
    if (encoded.length > 1) body.audios = encoded

    const resp = await this._request(this._v3Url('/voices/clone'), {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    // 官方返回 voice_clone_id；兼容 data 直接给出 / id 混用
    const id = String(
      (data && data.data && (data.data.voice_clone_id || data.data.voice_id || data.data.id)) || '',
    ).trim()
    if (!id) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'HeyGen voice clone returned no id', { providerId: this.id })
    }
    return { id, name }
  },

  /**
   * 删除克隆声音 — DELETE /v3/voices/{voice_id}
   */
  async deleteVoice (voiceId) {
    const id = typeof voiceId === 'string' ? voiceId.trim() : ''
    if (!id) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'voiceId is required')
    }
    await this._request(this._v3Url(`/voices/${encodeURIComponent(id)}`), { method: 'DELETE' })
  },

  /**
   * 创建数字人形象 — POST /v3/avatars
   *
   * 官方形态（reference/create-avatar）："Creates a new avatar from an image,
   * video footage, or a text prompt. Supports photo, digital_twin, and prompt
   * types. Avatar training is asynchronous."
   *
   * 需求只覆盖 photo（单张照片，最快，官方明言 no consent step）与
   * digital_twin（视频素材训练）两种；prompt 类型不在范围内。
   *
   * @returns {Promise<{id: string}>}
   */
  async createAvatar (params) {
    const name = typeof params === 'object' && params !== null && typeof params.name === 'string' ? params.name.trim() : ''
    if (!name) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.name is required')
    }
    const type = typeof params === 'object' && params !== null && typeof params.type === 'string' ? params.type.trim() : ''
    if (type !== 'photo' && type !== 'digital_twin') {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'params.type must be "photo" or "digital_twin"')
    }

    const media = type === 'photo' ? params.image : params.video
    if (!media || !(media.blob instanceof Blob)) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, `params.${type === 'photo' ? 'image' : 'video'} (Blob) is required`)
    }

    const buffer = Buffer.from(await media.blob.arrayBuffer())
    const mediaKey = type === 'photo' ? 'image' : 'video'
    const body = {
      name,
      type,
      [mediaKey]: `data:${media.contentType || 'application/octet-stream'};base64,${buffer.toString('base64')}`,
    }

    const resp = await this._request(this._v3Url('/avatars'), {
      method: 'POST',
      body: JSON.stringify(body),
    })
    const data = await resp.json()
    const id = String(
      (data && data.data && (data.data.avatar_id || data.data.look_id || data.data.id)) || '',
    ).trim()
    if (!id) {
      throw new ProviderError(ERROR_CODES.PROVIDER_ERROR, 'HeyGen create avatar returned no id', { providerId: this.id })
    }
    return { id }
  },

  /**
   * 查询形象训练状态 — GET /v3/avatars/looks/{look_id}
   *
   * 官方（reference/get-avatar-look）："...including supported engines,
   * preferred orientation, preview URLs, and training status."
   *
   * @returns {Promise<{status: string, progress: number}>}
   */
  async getAvatarStatus (avatarId) {
    const id = typeof avatarId === 'string' ? avatarId.trim() : ''
    if (!id) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'avatarId is required')
    }
    const resp = await this._request(this._v3Url(`/avatars/looks/${encodeURIComponent(id)}`), { method: 'GET' })
    const data = await resp.json()
    const statusData = (data && data.data) || {}
    const raw = String(statusData.training_status || statusData.status || '').toLowerCase()
    const statusMap = {
      training: 'training',
      in_progress: 'training',
      processing: 'training',
      pending: 'training',
      ready: 'completed',
      completed: 'completed',
      success: 'completed',
      active: 'completed',
      failed: 'failed',
      error: 'failed',
    }
    const status = statusMap[raw] || 'training'
    const progress = statusData.progress !== undefined ? Number(statusData.progress) : (status === 'completed' ? 100 : 0)
    return { status, progress }
  },

  /**
   * 删除克隆形象 — DELETE /v3/avatars/looks/{look_id}
   */
  async deleteAvatar (avatarId) {
    const id = typeof avatarId === 'string' ? avatarId.trim() : ''
    if (!id) {
      throw new ProviderError(ERROR_CODES.INVALID_CONFIG, 'avatarId is required')
    }
    await this._request(this._v3Url(`/avatars/looks/${encodeURIComponent(id)}`), { method: 'DELETE' })
  },

  /**
   * v3 API 绝对 URL。
   *
   * 为什么需要：本仓的 API 版本段是分裂的——克隆在 /v3、视频生成在 /v2
   * （#4194）、状态查询在 /v1。credentials.baseUrl 默认是 /v2，硬拼会错。
   * 与 _apiRoot() 同一思路：从 baseUrl 解析出 host，再按端点取版本段。
   */
  _v3Url (path) {
    const root = this._apiRoot()
    return `${root}/v3${path}`
  },
}

module.exports = { cloneMethods }
