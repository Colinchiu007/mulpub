'use strict'
/**
 * bilibili-video.js — B站视频发布链（upos，W1 §4.2）
 *
 * 复刻自参考产品逆向 + 本地活体校验（真实发布 bvid=BV1MahW6tE36），并改走 publish/core：
 *   1. preupload?r=probe        → lines（上传线路）
 *   2. preupload?<line>         → {auth, endpoint, upos_uri, biz_id}（命中 601 抛风控）
 *   3. PUT/POST {cdn}?uploads   → upload_id（headers X-Upos-Auth）
 *   4. PUT {cdn}?partNumber..   → 8MiB 二进制分片（status≤204 视为成功，读 etag 头）
 *   5. POST {cdn}?output=json.. → complete（{parts:[{partNumber,eTag}]} → location）
 *   6. POST /x/vu/web/add/v3    → csrf=bili_jct（私密优先 /x/vupre/web/draft/add）
 *
 * 客户端：api=member.bilibili.com，cdn=运行时按 endpoint/upos_uri 解析的 upos host；
 * 二者均可注入 → 测试全指本机假 HTTP 服务器，杜绝外发。Tier-A 本地：csrf/DedeUserID 自 cookie。
 * 合规红线：只直连 bilibili 官方域名，绝不调用任何第三方签名/远程服务。
 * fail-closed：缺 cookie/UA、文件不存在 → 发首请求前抛错（零请求）。
 */
const fs = require('fs')
const { createHttpClient, requestWithRetry } = require('../core/http-base')
const { chunkTotal, DEFAULT_CHUNK_SIZE } = require('../core/chunker')
const { errorCode } = require('../../error-codes')

const API_BASE = 'https://member.bilibili.com'
const UPLOAD_REFERER = 'https://member.bilibili.com/platform/upload/video/frame'
const UPOS_REFERER = 'https://member.bilibili.com/'
const CHUNK = DEFAULT_CHUNK_SIZE // 8388608

class BilibiliVideoError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'BilibiliVideoError'
    this.code = code === undefined ? errorCode.data_error : code
  }
}

function pickCookieValue (cookie, key) {
  const m = String(cookie || '').match(new RegExp('(?:^|;\\s*)' + key + '=([^;]+)'))
  return m ? m[1] : ''
}

/** upos_uri(endpoint//host + upos://bucket/object) → {host, objectPath:'/bucket/object'} */
function buildUposTarget (args) {
  const uposUri = args.upos_uri || ''
  const endpoint = String(args.endpoint || '').replace(/^https?:/, '').replace(/^\/\//, '').replace(/\/$/, '')
  if (uposUri.startsWith('upos://')) {
    const after = uposUri.slice('upos://'.length) // bucket/object
    return { host: endpoint, objectPath: '/' + after }
  }
  if (uposUri.startsWith('//')) {
    const rest = uposUri.replace(/^\/\//, '') // host/bucket/object
    const segs = rest.split('/')
    return { host: segs[0], objectPath: '/' + segs.slice(1).join('/') }
  }
  if (uposUri.startsWith('/')) return { host: endpoint, objectPath: uposUri }
  return { host: endpoint, objectPath: '/' + uposUri }
}

class BilibiliVideoChain {
  /**
   * @param {{cookie, userAgent, api?, cdn?, apiBase?, timeout?, agents?, logger?}} opts
   */
  constructor (opts = {}) {
    this.cookie = opts.cookie
    this.userAgent = opts.userAgent
    this.logger = opts.logger || console
    const headers = { 'User-Agent': this.userAgent }
    this.api = opts.api || createHttpClient({ baseURL: opts.apiBase || API_BASE, timeout: opts.timeout, agents: opts.agents, headers })
    this._cdn = opts.cdn || null // 注入则复用（测试）；否则运行时按 endpoint 建
    this._cdnOpts = { timeout: opts.timeout, agents: opts.agents, headers }
  }

  _assertPreconditions () {
    if (!this.cookie) throw new BilibiliVideoError('bilibili-video: missing cookie (fail-closed, refusing to publish)', errorCode.data_error)
    if (!this.userAgent) throw new BilibiliVideoError('bilibili-video: missing User-Agent (fail-closed, refusing to publish)', errorCode.request_error)
  }

  _apiHeaders (acceptJson) {
    return { Cookie: this.cookie, Referer: UPLOAD_REFERER, 'User-Agent': this.userAgent, Accept: acceptJson === false ? '*/*' : 'application/json, text/plain, */*' }
  }

  /** Step 1+2：probe 线路 → 逐条取一次上传 args（auth/endpoint/upos_uri/biz_id），命中 601 抛风控 */
  async getUploadArgs (fileName, size) {
    const probe = await requestWithRetry(this.api, { method: 'get', url: '/preupload', params: { r: 'probe' }, headers: this._apiHeaders() })
    const lines = (probe.data && probe.data.lines) || []
    let lastErr = null
    for (const l of lines) {
      const qs = (l.query ? l.query + '&' : '') + 'r=' + (l.os || 'upos') + '&name=' + encodeURIComponent(fileName + '.mp4') + '&size=' + size + '&profile=' + encodeURIComponent('ugcupos/bup') + '&ssl=0&version=2.7.1&build=2070100'
      let a
      try {
        const res = await requestWithRetry(this.api, { method: 'get', url: '/preupload?' + qs, headers: this._apiHeaders() })
        a = res.data
      } catch (e) { lastErr = e; continue }
      if (a && a.code === 601) throw new BilibiliVideoError('B站上传风控(601)：请先在创作者中心完成一次滑块验证后重试', errorCode.data_error)
      if (a && a.auth && (a.endpoint || a.upos_uri)) return a
    }
    throw new BilibiliVideoError('B站获取上传参数失败（可能被风控拦截或需重新登录）' + (lastErr ? ': ' + lastErr.message : ''), errorCode.data_error)
  }

  _cdnClient (host) {
    if (this._cdn) return this._cdn
    this._cdn = createHttpClient(Object.assign({ baseURL: 'https://' + host }, this._cdnOpts))
    return this._cdn
  }

  /** Step 3：初始化分片上传，返回 upload_id */
  async initUpload (args) {
    const { objectPath } = buildUposTarget(args)
    const cdn = this._cdnClient(buildUposTarget(args).host)
    const res = await requestWithRetry(cdn, {
      method: 'post', url: objectPath, params: { uploads: '', output: 'json' },
      headers: { Referer: UPOS_REFERER, 'X-Upos-Auth': args.auth, 'User-Agent': this.userAgent },
      data: '',
    })
    const uploadId = res.data && res.data.upload_id
    if (!uploadId) throw new BilibiliVideoError('B站上传：未获取 upload_id', errorCode.data_error)
    return uploadId
  }

  /** Step 4：上传单分片（二进制），status>204 抛错，读 etag 头 */
  async uploadPart (cdn, objectPath, buf, params) {
    const res = await cdn.request({
      method: 'put',
      url: objectPath + '?partNumber=' + params.partNumber + '&uploadId=' + params.uploadId + '&chunk=' + (params.partNumber - 1) + '&chunks=' + params.chunks + '&size=' + params.size + '&start=' + params.start + '&end=' + params.end + '&total=' + params.total,
      data: buf,
      headers: { Referer: UPOS_REFERER, 'X-Upos-Auth': params.auth, 'Content-Type': 'application/octet-stream', 'User-Agent': this.userAgent },
      maxBodyLength: Infinity, maxContentLength: Infinity,
      validateStatus: () => true,
    })
    if (res.status > 204) throw new BilibiliVideoError('B站分片上传失败 status=' + res.status, errorCode.request_error)
    const etag = String((res.headers && (res.headers.etag || res.headers.ETag)) || 'etag').replace(/"/g, '')
    return etag
  }

  /** Step 5：完成上传，返回 location */
  async completeUpload (cdn, objectPath, fileName, uploadId, parts, args) {
    const res = await requestWithRetry(cdn, {
      method: 'post', url: objectPath,
      params: { output: 'json', name: fileName + '.mp4', profile: 'ugcupos/bup', uploadId, biz_id: args.biz_id != null ? args.biz_id : 0 },
      data: { parts: parts.map((p) => ({ partNumber: p.partNumber, eTag: p.eTag })) },
      headers: { Referer: UPOS_REFERER, 'X-Upos-Auth': args.auth, 'Content-Type': 'application/json', 'User-Agent': this.userAgent },
    })
    const location = (res.data && res.data.location) || objectPath.replace(/^\//, '')
    return location
  }

  /** 读文件 → init → 逐片 PUT → complete，返回 {objBase, bizId, size} */
  async uploadVideo (filePath, fileName, args, onProgress) {
    const { host, objectPath } = buildUposTarget(args)
    const cdn = this._cdnClient(host)
    const uploadId = await this.initUpload(args)
    const size = fs.statSync(filePath).size
    const chunks = chunkTotal(size)
    const fh = fs.openSync(filePath, 'r')
    const parts = []
    try {
      for (const c of chunks) {
        const buf = Buffer.alloc(c.size)
        fs.readSync(fh, buf, 0, c.size, c.start)
        const etag = await this.uploadPart(cdn, objectPath, buf, { partNumber: c.index + 1, uploadId, chunks: chunks.length, size: c.size, start: c.start, end: c.end + 1, total: size, auth: args.auth })
        parts.push({ partNumber: c.index + 1, size: c.size, eTag: etag })
        if (onProgress) onProgress(Math.round(((c.index + 1) / chunks.length) * 100), '视频上传中')
      }
    } finally { fs.closeSync(fh) }
    const location = await this.completeUpload(cdn, objectPath, fileName, uploadId, parts, args)
    // add/v3 videos[].filename = location 去扩展名、去 bucket 段
    const objBase = String(location).split('.')[0].split('/').slice(1).join('/') || String(location).split('/').pop().replace(/\.[^.]+$/, '')
    return { objBase, bizId: args.biz_id != null ? args.biz_id : 0, size }
  }

  /** 构造 add/v3 投稿体（去「自动发布」水印） */
  buildPostData (taskData, upload) {
    const tags = (taskData.tags || []).map((t) => (typeof t === 'string' ? t : t.name)).filter(Boolean)
    const clean = (t) => String(t == null ? '' : t).replace(/[（(][^（()）]*?(自动发布|一键发布工具|由多平台)[^（()）]*?[)）]/g, '').replace(/\s*\n\s*$/g, '').trim()
    return {
      copyright: 1, source: '', tid: Number(taskData.category || taskData.tid) || 21, title: clean(taskData.title),
      desc: clean(taskData.content || taskData.desc), desc_format_id: 0, tag: tags.join(','), dynamic: '',
      cover: taskData.coverUrl || '', no_reprint: 1, act_reserve_create: 0, lossless_music: 0, no_disturbance: 0,
      recreate: -1, web_os: 1, interactive: 0, open_elec: 0, subtitle: { lan: '', open: 0 },
      videos: [{ cid: upload.bizId || 0, desc: '', title: taskData.title || '', filename: upload.objBase || '' }],
    }
  }

  /** Step 6：投稿（csrf=bili_jct；私密优先 draft） */
  async publish (postData, opts = {}) {
    const csrf = pickCookieValue(this.cookie, 'bili_jct')
    const draft = opts.draft !== false
    const url = draft ? '/x/vupre/web/draft/add' : '/x/vu/web/add/v3'
    const res = await requestWithRetry(this.api, {
      method: 'post', url, params: { t: Date.now(), csrf },
      data: Object.assign({}, postData, { csrf }),
      headers: { Cookie: this.cookie, Referer: UPLOAD_REFERER, 'Content-Type': 'application/json;charset=UTF-8', 'User-Agent': this.userAgent },
      maxBodyLength: Infinity,
    })
    const d = res.data || {}
    if (d.code === 0 && d.data && (d.data.bvid || d.data.aid)) {
      return { success: true, draft, platform: 'bilibili', publishId: String(d.data.bvid || d.data.aid), aid: d.data.aid, url: d.data.bvid ? 'https://www.bilibili.com/video/' + d.data.bvid : undefined }
    }
    if (d.code === -1025 || d.code === -1026) return { success: false, code: d.code, error: 'B站登录态失效，请重新登录', cookieExpired: true, platform: 'bilibili' }
    if (d.code === 601) return { success: false, code: 601, error: 'B站风控(601)：请先在创作者中心完成滑块验证后重试', platform: 'bilibili' }
    return { success: false, code: d.code, error: d.message || 'B站发布失败', platform: 'bilibili' }
  }

  /** 全链编排 */
  async run (taskData, opts = {}) {
    this._assertPreconditions()
    if (!taskData || !taskData.video || !taskData.video.path) throw new BilibiliVideoError('bilibili-video: taskData.video.path required', errorCode.data_error)
    if (!fs.existsSync(taskData.video.path)) throw new BilibiliVideoError('bilibili-video: video file not found: ' + taskData.video.path, errorCode.io_error)
    const mid = pickCookieValue(this.cookie, 'DedeUserID')
    const ts = String(Date.now())
    const fileName = mid + '_' + ts + '_' + ts.substring(9, 12)
    const size = fs.statSync(taskData.video.path).size
    const args = await this.getUploadArgs(fileName, size)
    const upload = await this.uploadVideo(taskData.video.path, fileName, args, opts.onProgress)
    const postData = this.buildPostData(taskData, upload)
    const result = await this.publish(postData, opts)
    return result
  }
}

module.exports = {
  BilibiliVideoChain,
  BilibiliVideoError,
  buildUposTarget,
  pickCookieValue,
  API_BASE,
  CHUNK,
}
