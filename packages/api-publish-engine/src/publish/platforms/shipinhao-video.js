'use strict'
/**
 * shipinhao-video.js — 视频号（微信 channels）视频发布链（W1 §4.1）
 *
 * 逐字对齐参考产品逆向链（证据 01-docs/rpa-api-publish/evidence/yx-slices-v2.txt）：
 *   1. getUploadAuthKey   POST {api}/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params
 *   2. applyUpload        PUT  {cdn}/applyuploaddfs          {BlockSum, BlockPartLength} + X-Arguments(scene=2)/Authorization
 *   3. uploadPart(×N)     PUT  {cdn}/uploadpartdfs?PartNumber&UploadID  二进制分片 + Content-MD5=md5(chunk) + X-Arguments(scene=0)
 *   4. completeUpload     POST {cdn}/completepartuploaddfs?UploadID     {TransFlag:"0_0", PartInfo:[{PartNumber,ETag}]}
 *   5. publish            POST {api}/cgi-bin/mmfinderassistant-bin/post/post_{create|draft}
 *
 * 分片器复用 publish/core/chunker（8MiB=8388608）；重试/风控复用 requestWithRetry。
 * 两个 axios 客户端（api / cdn）均可注入 → 测试全部指向本机假 HTTP 服务器，杜绝外发。
 * 合规红线：无第三方签名通道；进程内自足。数据校验 fail-closed：缺 cookie / 文件不存在零请求。
 */
const fs = require('fs')
const crypto = require('crypto')
const { createHttpClient, requestWithRetry } = require('../core/http-base')
const { chunkTotal, DEFAULT_CHUNK_SIZE } = require('../core/chunker')
const { errorCode } = require('../../error-codes')

const DEFAULT_API_BASE = 'https://channels.weixin.qq.com'
const DEFAULT_CDN_BASE = 'https://finderassistancea.video.qq.com'
const API_REFERER = 'https://channels.weixin.qq.com'
const POST_REFERER = 'https://channels.weixin.qq.com/platform/post/create'
const UPLOAD_REFERER = 'https://channels.weixin.qq.com/'

class ShipinhaoVideoError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'ShipinhaoVideoError'
    this.code = code === undefined ? errorCode.data_error : code
  }
}

function getTimeStamp (len) {
  const s = Date.now().toString()
  return len ? s.substring(0, len) : s
}

function md5Hex (buffer) {
  return crypto.createHash('md5').update(buffer).digest('hex')
}

function buildXArguments (o) {
  // apptype 固定 251；scene: 0=分片, 2=申请/完成
  return 'apptype=251&filetype=' + (o.filetype || '') +
    '&weixinnum=' + (o.weixinnum || '') +
    '&filekey=' + encodeURIComponent(o.filekey || '') +
    '&filesize=' + o.filesize +
    '&taskid=' + (o.taskid || '') +
    '&scene=' + o.scene
}

class ShipinhaoVideoChain {
  /**
   * @param {{cookie, userAgent, finderId, finderUin, api?, cdn?, apiBase?, cdnBase?,
   *   timeout?, agents?, logger?}} opts
   */
  constructor (opts = {}) {
    this.cookie = opts.cookie
    this.userAgent = opts.userAgent
    this.finderId = opts.finderId // _log_finder_id
    this.finderUin = opts.finderUin != null ? opts.finderUin : (opts.finderId || '') // weixinnum
    this.logger = opts.logger || console
    const headers = { 'User-Agent': this.userAgent }
    this.api = opts.api || createHttpClient({ baseURL: opts.apiBase || DEFAULT_API_BASE, timeout: opts.timeout, agents: opts.agents, headers })
    this.cdn = opts.cdn || createHttpClient({ baseURL: opts.cdnBase || DEFAULT_CDN_BASE, timeout: opts.timeout, agents: opts.agents, headers })
  }

  /** 发起前校验：缺 cookie → fail-closed 零请求 */
  _assertPreconditions () {
    if (!this.cookie) {
      throw new ShipinhaoVideoError('shipinhao-video: missing cookie (fail-closed, refusing to publish)', errorCode.data_error)
    }
    if (!this.userAgent) {
      throw new ShipinhaoVideoError('shipinhao-video: missing User-Agent (fail-closed, refusing to publish)', errorCode.request_error)
    }
  }

  _apiHeaders (referer) {
    return { cookie: this.cookie, referer: referer || API_REFERER, Accept: 'application/json, text/plain, */*' }
  }

  /** Step 1：获取上传鉴权（返回的 authKey 作为后续 CDN 请求的 Authorization） */
  async getUploadAuthKey () {
    const res = await requestWithRetry(this.api, {
      method: 'post',
      url: '/cgi-bin/mmfinderassistant-bin/helper/helper_upload_params',
      data: { timestamp: getTimeStamp(13), _log_finder_id: this.finderId, rawKeyBuff: null },
      headers: this._apiHeaders(),
    })
    const d = res.data || {}
    const authKey = d.authKey || (d.data && d.data.authKey) || ''
    if (!authKey) {
      throw new ShipinhaoVideoError('shipinhao-video: upload authKey missing (cookie may be expired)', errorCode.data_error)
    }
    return String(authKey)
  }

  /** Step 2：申请上传（applyuploaddfs），返回 UploadID */
  async applyUpload (meta) {
    const parts = chunkTotal(meta.filesize)
    const payload = {
      BlockSum: parts.length,
      BlockPartLength: parts.map((p) => p.size),
    }
    const headers = {
      'X-Arguments': buildXArguments({ filetype: meta.filetype, weixinnum: this.finderUin, filekey: meta.filekey, filesize: meta.filesize, taskid: meta.taskid, scene: 2 }),
      Authorization: meta.authKey,
      Accept: 'application/json, text/plain, */*',
      'Content-MD5': 'null',
      Referer: UPLOAD_REFERER,
      Origin: DEFAULT_API_BASE + '/',
    }
    const res = await requestWithRetry(this.cdn, { method: 'put', url: '/applyuploaddfs', data: payload, headers })
    const d = res.data || {}
    const uploadId = d.UploadID || (d.data && d.data.UploadID) || ''
    if (!uploadId) {
      throw new ShipinhaoVideoError('shipinhao-video: applyuploaddfs returned no UploadID', errorCode.data_error)
    }
    return { uploadId, parts }
  }

  /** Step 3：上传单个分片（uploadpartdfs），返回 ETag */
  async uploadPart (buf, partNumber, uploadId, meta) {
    const headers = {
      'Content-MD5': md5Hex(buf),
      'X-Arguments': buildXArguments({ filetype: meta.filetype, weixinnum: this.finderUin, filekey: meta.filekey, filesize: meta.filesize, taskid: meta.taskid, scene: 0 }),
      Authorization: meta.authKey,
      'Content-Type': 'application/octet-stream',
      Referer: POST_REFERER,
      Origin: DEFAULT_API_BASE,
      'User-Agent': this.userAgent,
    }
    const url = '/uploadpartdfs?PartNumber=' + partNumber + '&UploadID=' + encodeURIComponent(uploadId)
    const res = await requestWithRetry(this.cdn, { method: 'put', url, data: buf, headers })
    const d = res.data || {}
    return { etag: d.ETag, partNumber, raw: d }
  }

  /** Step 4：完成分片上传（completepartuploaddfs），返回视频信息 */
  async completeUpload (uploadId, partInfos, meta) {
    const headers = {
      'Content-MD5': 'null',
      'X-Arguments': buildXArguments({ filetype: meta.filetype, weixinnum: this.finderUin, filekey: meta.filekey, filesize: meta.filesize, taskid: meta.taskid, scene: 2 }),
      Authorization: meta.authKey,
      Referer: POST_REFERER,
      Origin: DEFAULT_API_BASE,
      'User-Agent': this.userAgent,
    }
    const url = '/completepartuploaddfs?UploadID=' + encodeURIComponent(uploadId)
    const res = await requestWithRetry(this.cdn, { method: 'post', url, data: { TransFlag: '0_0', PartInfo: partInfos }, headers })
    return res.data || {}
  }

  /** 读文件 → 分片计划 → 逐片上传 → 完成，返回 {uploadId, videoInfo} */
  async uploadVideo (filePath, meta, onProgress) {
    const st = fs.statSync(filePath)
    const filesize = st.size
    const applied = await this.applyUpload(Object.assign({}, meta, { filesize }))
    const fd = fs.openSync(filePath, 'r')
    const partInfos = []
    try {
      for (const part of applied.parts) {
        const buf = Buffer.alloc(part.size)
        fs.readSync(fd, buf, 0, part.size, part.start)
        const r = await this.uploadPart(buf, part.index + 1, applied.uploadId, Object.assign({}, meta, { filesize }))
        if (!r.etag) throw new ShipinhaoVideoError('shipinhao-video: part ' + (part.index + 1) + ' missing ETag', errorCode.data_error)
        partInfos.push({ PartNumber: part.index + 1, ETag: r.etag })
        if (onProgress) onProgress(Math.round(((part.index + 1) / applied.parts.length) * 100), '视频上传中')
      }
    } finally {
      fs.closeSync(fd)
    }
    const videoInfo = await this.completeUpload(applied.uploadId, partInfos, Object.assign({}, meta, { filesize }))
    return { uploadId: applied.uploadId, videoInfo }
  }

  /** Step 5：发布（私密优先 → post_draft；正式 → post_create） */
  async publish (postData, opts = {}) {
    const draft = opts.draft !== false
    const url = '/cgi-bin/mmfinderassistant-bin/post/post_' + (draft ? 'draft' : 'create')
    const res = await requestWithRetry(this.api, {
      method: 'post',
      url,
      data: postData,
      headers: { referer: POST_REFERER, cookie: this.cookie, 'Content-type': 'application/json', 'User-Agent': this.userAgent },
    })
    const d = res.data || {}
    const errCode = d.errCode != null ? d.errCode : (d.data && d.data.errCode)
    if (errCode && Number(errCode) !== 0) {
      return { success: false, code: Number(errCode), error: (d.errMsg || (d.data && d.data.errMsg) || 'shipinhao publish failed'), draft }
    }
    const publishId = d.data && (d.data.postId || d.data.contentId || d.data.id) || d.postId || ''
    return { success: true, draft, platform: 'shipinhao', publishId: publishId ? String(publishId) : '', raw: d }
  }

  /**
   * 全链编排：authKey → uploadVideo → publish。
   * @param {{title, content, video:{path, filetype?, width?, height?, duration?}}} taskData
   * @param {{draft?: boolean, taskid?: string}} [opts]
   */
  async run (taskData, opts = {}) {
    this._assertPreconditions()
    if (!taskData || !taskData.video || !taskData.video.path) {
      throw new ShipinhaoVideoError('shipinhao-video: taskData.video.path required', errorCode.data_error)
    }
    if (!fs.existsSync(taskData.video.path)) {
      throw new ShipinhaoVideoError('shipinhao-video: video file not found: ' + taskData.video.path, errorCode.io_error)
    }
    const taskid = opts.taskid || ('T' + getTimeStamp(10))
    const filekey = taskData.video.path.split(/[\\/]/).pop()
    const authKey = await this.getUploadAuthKey()
    const meta = { authKey, filetype: taskData.video.filetype || 'mp4', filekey, taskid }
    const { uploadId, videoInfo } = await this.uploadVideo(taskData.video.path, meta, opts.onProgress)
    const mediaUrl = (videoInfo && videoInfo.url) || (videoInfo && videoInfo.data && videoInfo.data.url) || ''
    const postData = {
      description: String(taskData.content == null ? taskData.title : taskData.content),
      media: { videoId: uploadId, url: mediaUrl, width: taskData.video.width, height: taskData.video.height, duration: taskData.video.duration },
      location: null,
      timestamp: getTimeStamp(13),
      _log_finder_uin: this.finderUin || null,
      _log_finder_id: this.finderId || null,
      rawKeyBuff: null,
      scene: 7,
      reqScene: 7,
    }
    const result = await this.publish(postData, opts)
    return result
  }
}

module.exports = {
  ShipinhaoVideoChain,
  ShipinhaoVideoError,
  buildXArguments,
  getTimeStamp,
  md5Hex,
  DEFAULT_API_BASE,
  DEFAULT_CDN_BASE,
  CHUNK_SIZE: DEFAULT_CHUNK_SIZE,
}
