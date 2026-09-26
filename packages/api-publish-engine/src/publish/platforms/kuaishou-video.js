'use strict'
/**
 * kuaishou-video.js — 快手视频 API 发布链（W3 §5，Cookie + 直连平台官方 HTTP API）
 *
 * 九步链（逐字对照 01-docs/rpa-api-publish/evidence/yx-kuaishou-w3-slices.txt §1.1-§1.11）：
 *   0. 前置校验（fail-closed，零请求）：cookie 提取 api_ph（缺失不回退伪造 Guid）+ 视频文件存在
 *   1. upload/pre（★带签）：body={uploadType:1, api_ph} → {token, endPoints[0]}
 *   2. fragment×N（不签）：{endpoint}/api/upload/fragment?upload_token&fragment_id，
 *      Content-Range bytes s-e/total，Content-Type application/stream → {checksum}
 *   3. complete（不签）：?fragment_count&upload_token，空 body → result==1（失败按切片重试一次）
 *   4. upload/finish（★带签）：body={token,fileName,fileTyp:"video/mp4",fileLength,api_ph} → {fileId}
 *   5. cover/upload（不签）：multipart FormData{file(image/jpeg), api_ph} → {coverKey}
 *   6. buildPostData：全字段组装（切片 §1.7，ai_generated 平移 W2 治理：默认如实声明 1）
 *   7. video/pc/submit（★带签）：Content-Type application/json;charset=UTF-8
 *      → result==1 成功，publishId=currentTime.substring(0,10)
 *   8. photo/list 回查（不签）：queryType:"2" 近 5min，match unPublishCoverKey → publishId 兜底 uploadTime
 *
 * 错误语义（design §3/§5）：result==109 → login_expired 停任务不降级；
 *   submit 非 JSON（验证页）→ risk_blocked 不重试刷签；签名页未就绪 → unsupported（api-then-dom 可降级 DOM）。
 * 签名单一事实源：__NS_sig3 仅经进程内注册表 command `kuaishou.ns-sig3-browser`
 *   （W3 签名页基建，S2b 活体裁决 Tier-A GO）；本模块不引入任何 HTTP 签名通道。
 * 合规红线：只直连 cp.kuaishou.com 官方域，绝不调用任何第三方签名服务（legacy-chain-gate grep 门禁）。
 */
const fs = require('fs')
const path = require('path')
const { createHttpClient } = require('../core/http-base')
const { errorCode } = require('../../error-codes')
const { registry } = require('../../signer')

const CP_BASE = 'https://cp.kuaishou.com'
const REFERER = CP_BASE + '/article/publish/video?tabType=1'
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36'
// 切片 §1.3：分片大小 be=4194304（4MiB）
const PART_SIZE = 4 * 1024 * 1024
// design §3 签名字段本地断言：sig3 长度阈值 ≥40（S2b 实证真签为 56 字符 VM 产物）
const MIN_SIG_LEN = 40
const API_PH_KEY = 'kuaishou.web.cp.api_ph'
// 切片 §3.3 api_ph 提取器（fail-closed：缺失即抛错，绝不回退伪造 Guid）
const API_PH_RE = /kuaishou\.web\.cp\.api_ph=([a-z0-9]+)/
// 带签端点白名单（切片 §1.11）：upload/pre、upload/finish、video/pc/submit；
// 不带签：fragment、complete、cover/upload、photo/list
const SIGN_COMMAND = 'kuaishou.ns-sig3-browser'

class KuaishouVideoError extends Error {
  constructor (message, code) {
    super(message)
    this.name = 'KuaishouVideoError'
    this.code = code === undefined ? errorCode.data_error : code
  }
}

function cookieValue (cookie, key) {
  for (const seg of String(cookie || '').split(';')) {
    const kv = seg.trim()
    const eq = kv.indexOf('=')
    if (eq > 0 && kv.slice(0, eq).trim() === key) return kv.slice(eq + 1).trim()
  }
  return ''
}

/** 切片 §1.7 buildPostData$I 全字段；纯函数，供链与薄适配器共用。
 *  ctx = { fileId, coverKey, apiPh }；条件字段按 taskData 存在才带（切片 ?? 语义）。 */
function buildKuaishouPostData (taskData, ctx = {}) {
  const td = taskData || {}
  const coverKey = ctx.coverKey || ''
  const title = String(td.title == null ? '' : td.title).trim()
  const content = String(td.content || td.desc || '').trim()
  const tags = Array.isArray(td.tags) ? td.tags.filter(Boolean).map((t) => '#' + String(t).replace(/^#/, '')) : []
  // 快手无独立标题字段：标题 + 正文 + 话题标签合并进 caption（与 DOM RPA _composeEditorCaption 语义对齐）
  const caption = [title, content, tags.join(' ')].filter(Boolean).join('\n')
  const data = {
    caption,
    pkCoverKey: td.pkCoverKey || '', pkCoverSize: 'a', pkCoverTimeStamp: 0, pkCoverType: 2,
    poiId: td.poiId || '', latitude: '', longitude: '',
    domain: td.domain || '', secondDomain: td.secondDomain || '',
    coverCropped: false, coverKey, coverType: coverKey ? 3 : 1,
    fileId: ctx.fileId || '', [API_PH_KEY]: ctx.apiPh || '',
    movieId: '', notifyResult: 0,
    photoStatus: td.visibilityType != null ? td.visibilityType : 1,
    photoType: 0,
    publishTime: td.publishTime != null ? td.publishTime : 0,
  }
  if (td.downloadType === 2) data.downloadType = 2
  if (td.disableNearbyShow != null) data.disableNearbyShow = td.disableNearbyShow
  if (td.allowSameFrame != null) data.allowSameFrame = td.allowSameFrame
  if (Array.isArray(td.associateTasks)) data.associateTasks = td.associateTasks
  if (td.declareInfo && td.declareInfo.source !== 4) data.declareInfo = td.declareInfo
  if (td.collectionId != null) data.collectionId = td.collectionId
  // AI 生成内容声明如实选择（W2 治理平移）：默认 1，显式 aiGenerated=false 才 0
  data.ai_generated = td.aiGenerated !== false ? 1 : 0
  return data
}

class KuaishouVideoChain {
  /**
   * @param {object} opts
   * @param {string} opts.cookie            登录 cookie（必须含 api_ph，fail-closed）
   * @param {Function} [opts.signer]        async (command, payload) => signature；缺省走进程内注册表
   * @param {object} [opts.cpHttp]          cp.kuaishou.com 客户端（测试注入本机假服务器）
   * @param {object} [opts.uploadHttp]      分片上传端点客户端（测试注入）
   * @param {string} [opts.uploadScheme]    endPoints 重写协议（测试 'http:'）
   */
  constructor (opts = {}) {
    this.cookie = opts.cookie
    this.userAgent = opts.userAgent || UA
    this.logger = opts.logger || console
    this.cpBase = opts.cpBase || CP_BASE
    this.uploadScheme = opts.uploadScheme || 'https:'
    this.signer = opts.signer
    this.partSize = opts.partSize || PART_SIZE
    const timeout = opts.timeout
    const headers = { 'User-Agent': this.userAgent }
    this.cpHttp = opts.cpHttp || createHttpClient({ timeout, headers })
    this.uploadHttp = opts.uploadHttp || createHttpClient({ timeout, headers })
  }

  // cp 域请求统一拼绝对 URL（注入的 cpHttp 无 baseURL，与测试假服务器对齐）
  _cpUrl (urlPath) { return String(this.cpBase).replace(/\/$/, '') + urlPath }

  _baseHeaders (extra) {
    return Object.assign({ 'User-Agent': this.userAgent, Cookie: this.cookie, Referer: REFERER }, extra || {})
  }

  /** Step 0：fail-closed 前置校验（零请求）——api_ph 缺失即抛错，不回退伪造 Guid（切片 §3.3） */
  _assertPreconditions () {
    this.apiPh = cookieValue(this.cookie, API_PH_KEY)
    if (!this.apiPh) {
      throw new KuaishouVideoError('kuaishou-video: missing ' + API_PH_KEY + ' in cookie (账号信息缺失，请重新授权此账号再试)', errorCode.data_error)
    }
  }

  /** 求签：仅经注册表 command；签名页未就绪 → err.signerNotReady（上层降级 unsupported）；
   *  结果本地断言：非空字符串且长度 ≥40（design §3），否则 fail-closed 抛错 */
  async _sign (url, params, type, opts) {
    const signer = this.signer
    if (typeof signer !== 'function') {
      const err = new Error('kuaishou-video: 签名页未就绪（no signer injected；bridge 由桌面装配层注入）')
      err.signerNotReady = true
      throw err
    }
    const payload = { url, type: type || 'json', params, accountId: (opts && opts.accountId) || undefined }
    let sig
    try {
      sig = await signer(SIGN_COMMAND, payload)
    } catch (e) {
      const msg = String(e.message || e)
      const notReady = /未就绪|not\s*ready|bridge not injected|未验证|unverified|degraded|not registered|未注册/i.test(msg)
      const wrapped = new Error('kuaishou-video: signer failed: ' + msg)
      wrapped.signerNotReady = notReady
      throw wrapped
    }
    if (typeof sig !== 'string' || sig.length < MIN_SIG_LEN) {
      throw new KuaishouVideoError('kuaishou-video: invalid __NS_sig3 (empty or shorter than ' + MIN_SIG_LEN + ' chars, fail-closed)', errorCode.data_error)
    }
    return sig
  }

  /** ★带签 POST（JSON 体）：__NS_sig3 拼 query；result==109 → err.loginExpired */
  async _signedPostJson (urlPath, bodyObj, opts) {
    const sig = await this._sign(urlPath, bodyObj, 'json', opts)
    const res = await this.cpHttp.request({
      method: 'post',
      url: this._cpUrl(urlPath) + '?__NS_sig3=' + encodeURIComponent(sig),
      data: JSON.stringify(bodyObj),
      headers: this._baseHeaders({ 'Content-Type': 'application/json', [API_PH_KEY]: this.apiPh }),
      maxBodyLength: Infinity,
      validateStatus: (s) => s >= 200 && s < 500,
    })
    return this._unwrap(res, urlPath)
  }

  /** 不签 POST（cp 域）：contentType=null 表示空 body 不带 Content-Type（切片 §1.4） */
  async _postJson (urlPath, bodyObj, contentType) {
    const headers = this._baseHeaders({ [API_PH_KEY]: this.apiPh })
    let data
    if (contentType === null) {
      data = ''
    } else {
      headers['Content-Type'] = contentType || 'application/json'
      data = bodyObj === undefined ? '' : JSON.stringify(bodyObj)
    }
    const res = await this.cpHttp.request({
      method: 'post', url: this._cpUrl(urlPath), data, headers, maxBodyLength: Infinity,
      validateStatus: (s) => s >= 200 && s < 500,
    })
    return this._unwrap(res, urlPath)
  }

  _unwrap (res, urlPath) {
    const d = res.data
    if (d && typeof d === 'object') {
      if (res.status >= 400) {
        throw new KuaishouVideoError('kuaishou-video: ' + urlPath + ' HTTP ' + res.status + ' result=' + d.result, errorCode.request_error)
      }
      // 切片 §1.10 / design §3：任一步 result==109 → login_expired 停任务不降级
      if (d.result === 109) {
        const err = new KuaishouVideoError('kuaishou-video: ' + urlPath + ' result=109 login_expired', errorCode.data_error)
        err.loginExpired = true
        throw err
      }
      return d
    }
    throw new KuaishouVideoError('kuaishou-video: ' + urlPath + ' 非 JSON 应答（status=' + res.status + '）', errorCode.request_error)
  }

  /** Step 1：upload/pre（★带签）→ {token, endPoints[0]}（切片 §1.2） */
  async getUploadArgs (opts) {
    const body = { uploadType: 1, [API_PH_KEY]: this.apiPh }
    const d = await this._signedPostJson('/rest/cp/works/v2/video/pc/upload/pre', body, opts)
    const token = d && d.data && d.data.token
    const endpoints = (d && d.data && d.data.endPoints) || []
    if (d.result !== 1 || !token || !endpoints.length) {
      throw new KuaishouVideoError('kuaishou-video: upload/pre 失败 result=' + d.result + '（未获取上传 token/endPoints）', errorCode.data_error)
    }
    let host = String(endpoints[0]).replace(/^https?:\/\//, '')
    if (this.uploadScheme === 'http:') host = host.replace(/:\d+$/, ':' + new URL(this.cpBase).port)
    return { token, endpoint: this.uploadScheme + '//' + host }
  }

  /** Step 2：分片上传（不签）：Content-Range bytes s-e/total，application/stream → checksum 必填（切片 §1.3） */
  async uploadFragments (filePath, size, token, endpoint, opts) {
    const total = Math.max(1, Math.ceil(size / this.partSize))
    const fh = fs.openSync(filePath, 'r')
    try {
      for (let i = 0; i < total; i++) {
        const start = i * this.partSize
        const len = Math.min(this.partSize, size - start)
        const buf = Buffer.alloc(len)
        fs.readSync(fh, buf, 0, len, start)
        const url = endpoint + '/api/upload/fragment?upload_token=' + encodeURIComponent(token) + '&fragment_id=' + (i + 1)
        const res = await this.uploadHttp.request({
          method: 'post', url, data: buf, maxBodyLength: Infinity,
          headers: this._baseHeaders({ 'Content-Range': 'bytes ' + start + '-' + (start + len - 1) + '/' + size, 'Content-Type': 'application/stream' }),
          validateStatus: (s) => s >= 200 && s < 500,
        })
        const d = res.data
        const checksum = d && typeof d === 'object' ? d.checksum : ''
        if (!checksum) {
          throw new KuaishouVideoError('kuaishou-video: fragment#' + (i + 1) + ' 未返回 checksum', errorCode.io_error)
        }
        if (opts && opts.onProgress) opts.onProgress(Math.round(((i + 1) / total) * 70), '视频上传中')
      }
    } finally { fs.closeSync(fh) }
    return total
  }

  /** Step 3：complete（不签，空 body）：result==1；失败按切片 §1.4 重试一次，仍失败 → 抛错停链 */
  async uploadComplete (total, token, endpoint) {
    const url = '/api/upload/complete?fragment_count=' + total + '&upload_token=' + encodeURIComponent(token)
    let d = await this._uploadPost(url)
    if (!d || d.result !== 1) d = await this._uploadPost(url)
    if (!d || d.result !== 1) {
      throw new KuaishouVideoError('kuaishou-video: upload/complete result=' + (d && d.result), errorCode.io_error)
    }
  }

  async _uploadPost (url) {
    const res = await this.uploadHttp.request({
      method: 'post', url: this._currentEndpoint + url, data: '',
      headers: this._baseHeaders(),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    if (res.status >= 400) {
      throw new KuaishouVideoError('kuaishou-video: ' + url + ' HTTP ' + res.status, errorCode.io_error)
    }
    return res.data
  }

  /** Step 4：upload/finish（★带签）→ fileId（切片 §1.5） */
  async uploadFinish (meta, opts) {
    const body = {
      token: meta.token, fileName: meta.fileName, fileTyp: 'video/mp4', fileLength: meta.fileLength,
      [API_PH_KEY]: this.apiPh,
    }
    const d = await this._signedPostJson('/rest/cp/works/v2/video/pc/upload/finish', body, opts)
    const fileId = d && d.data && d.data.fileId
    if (d.result !== 1 || !fileId) {
      throw new KuaishouVideoError('kuaishou-video: upload/finish 失败 result=' + d.result, errorCode.data_error)
    }
    return fileId
  }

  /** Step 5：封面上传（不签，multipart：file(image/jpeg) + api_ph 字段）→ coverKey（切片 §1.6） */
  async uploadCover (coverPath, opts) {
    const buf = fs.readFileSync(coverPath)
    const boundary = '----MpKuaishouBoundary' + Date.now().toString(36)
    const head = Buffer.from(
      '--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="file"; filename="cover.jpg"\r\n' +
      'Content-Type: image/jpeg\r\n\r\n')
    const mid = Buffer.from(
      '\r\n--' + boundary + '\r\n' +
      'Content-Disposition: form-data; name="' + API_PH_KEY + '"\r\n\r\n' + this.apiPh + '\r\n' +
      '--' + boundary + '--\r\n')
    const body = Buffer.concat([head, buf, mid])
    const res = await this.cpHttp.request({
      method: 'post', url: this._cpUrl('/rest/cp/works/v2/video/pc/upload/cover/upload'), data: body, maxBodyLength: Infinity,
      headers: this._baseHeaders({ 'Content-Type': 'multipart/form-data; boundary=' + boundary, [API_PH_KEY]: this.apiPh }),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    const d = this._unwrap(res, 'cover/upload')
    const coverKey = d && d.data && d.data.coverKey
    if (d.result !== 1 || !coverKey) {
      throw new KuaishouVideoError('kuaishou-video: cover/upload 失败 result=' + d.result, errorCode.data_error)
    }
    return coverKey
  }

  buildPostData (taskData, ctx) { return buildKuaishouPostData(taskData, ctx) }

  /** Step 7：submit（★带签，Content-Type application/json;charset=UTF-8）→ {result,currentTime}（切片 §1.8） */
  async submit (postData, opts) {
    const urlPath = '/rest/cp/works/v2/video/pc/submit'
    const sig = await this._sign(urlPath, postData, 'json', opts)
    const res = await this.cpHttp.request({
      method: 'post', url: this._cpUrl(urlPath) + '?__NS_sig3=' + encodeURIComponent(sig),
      data: JSON.stringify(postData), maxBodyLength: Infinity,
      headers: this._baseHeaders({ 'Content-Type': 'application/json;charset=UTF-8', [API_PH_KEY]: this.apiPh }),
      validateStatus: (s) => s >= 200 && s < 500,
    })
    return res
  }

  /** Step 8：photo/list 回查（不签）：近 5min 窗口 match unPublishCoverKey → publishId 兜底 uploadTime（切片 §1.9） */
  async queryPhotoList (coverKey) {
    const body = {
      queryType: '2', cursor: Number.MAX_SAFE_INTEGER,
      startTime: Date.now() - 5 * 60 * 1000, endTime: Number.MAX_SAFE_INTEGER,
      limit: 30, [API_PH_KEY]: this.apiPh,
    }
    const d = await this._postJson('/rest/cp/works/v2/video/pc/photo/list', body)
    const list = (d && d.data && d.data.list) || []
    const hit = list.find((x) => x && x.unPublishCoverKey === coverKey)
    return hit || null
  }

  /** 全链编排（切片 §1.10）。返回归一结果：
   *  成功 {success:true, mode:'api', platform:'kuaishou', publishId}
   *  109 → {success:false, login_expired:true}（停任务不降级）
   *  submit 非 JSON 验证页 → {success:false, risk_blocked:true}（不重试刷签）
   *  签名页未就绪 → {success:false, unsupported:true}（api-then-dom 可降级 DOM，零请求） */
  async run (taskData, opts = {}) {
    this._assertPreconditions()
    if (!taskData || !taskData.video || !taskData.video.path) {
      throw new KuaishouVideoError('kuaishou-video: taskData.video.path required', errorCode.data_error)
    }
    const filePath = taskData.video.path
    if (!fs.existsSync(filePath)) {
      throw new KuaishouVideoError('kuaishou-video: video file not found: ' + filePath, errorCode.io_error)
    }
    const size = fs.statSync(filePath).size
    try {
      // 1. upload/pre（签）
      const { token, endpoint } = await this.getUploadArgs(opts)
      this._currentEndpoint = endpoint
      // 2-3. fragment×N → complete（不签）
      const total = await this.uploadFragments(filePath, size, token, endpoint, opts)
      await this.uploadComplete(total, token, endpoint)
      // 4. finish（签）→ fileId
      const fileId = await this.uploadFinish({ token, fileName: path.basename(filePath), fileLength: size }, opts)
      // 5. 封面（不签）→ coverKey（封面缺失时以视频首帧路径兜底 = 复用视频文件，切片允许无独立封面）
      const coverPath = (taskData.cover && taskData.cover.path) || filePath
      let coverKey = ''
      if (fs.existsSync(coverPath)) coverKey = await this.uploadCover(coverPath, opts)
      // 6-7. buildPostData → submit（签）
      const postData = this.buildPostData(taskData, { fileId, coverKey, apiPh: this.apiPh })
      const res = await this.submit(postData, opts)
      const d = res.data
      if (!d || typeof d !== 'object') {
        // 非 JSON（验证页/HTML）→ 风控信号：停报不降级、不重试刷签
        return { success: false, risk_blocked: true, platform: 'kuaishou', error: '快手返回验证页/非 JSON 应答，疑似风控拦截，请在创作者中心手动确认后再试（不自动验证、不换号）' }
      }
      if (d.result === 109) {
        return { success: false, login_expired: true, platform: 'kuaishou', error: '快手登录已失效（result=109），请重新授权此账号再试' }
      }
      if (d.result !== 1) {
        return { success: false, platform: 'kuaishou', error: d.message || ('快手提交失败 result=' + d.result) }
      }
      let publishId = String(d.currentTime || '').substring(0, 10)
      // 8. 回查 photo/list：命中 unPublishCoverKey → uploadTime 兜底
      try {
        const hit = await this.queryPhotoList(coverKey)
        if (!publishId && hit && hit.uploadTime) publishId = String(hit.uploadTime).substring(0, 10)
      } catch (e) { /* 回查失败不影响提交成功裁决 */ }
      if (taskData.publishTime) publishId = String(taskData.publishTime).substring(0, 10)
      return { success: true, mode: 'api', platform: 'kuaishou', publishId, draft: opts.draft !== false }
    } catch (err) {
      if (err && err.loginExpired) {
        return { success: false, login_expired: true, platform: 'kuaishou', error: '快手登录已失效（result=109），请重新授权此账号再试' }
      }
      if (err && err.signerNotReady) {
        // 签名页未就绪不是风控：标记 unsupported，api-then-dom 模式可降级 DOM
        return { success: false, unsupported: true, platform: 'kuaishou', error: err.message }
      }
      throw err
    }
  }
}

module.exports = {
  KuaishouVideoChain,
  KuaishouVideoError,
  buildKuaishouPostData,
  cookieValue,
  SIGN_COMMAND,
  CP_BASE,
  registry,
}
