/**
 * toutiao-video-cover.js — 头条封面上传五步链（2026-10-19 真机实证，PR #4008 记录）
 *
 * ## 为什么独立成模块
 *
 * `toutiao-video.js` 已 491/500 行（`check-max-lines` 硬闸），封面链 5 步放不进去；
 * 且它与视频链的凭证**不同源**（`type=image_temp` vs `type=video`），职责天然分开。
 *
 * ## 五步（全部真机实证，勿凭记忆改）
 *
 * 1. 凭证：`GET /xigua/api/upload/getAuthKey/?params={"type":"image_temp",…,"useStsToken":false}`
 *    → `data = {accessKey, uploadToken}`（uploadToken 是 `HMAC-SHA1:1.0:<unix>:<accessKey>:<sig>`）
 * 2. 三元组：`GET https://vas-lf-x.ixigua.com/video/openapi/v1/?action=GetImageUploadParams&s=<5hex>&use_edge_node=1&file_size=<n>`
 *    头**双带** `Authorization: <uploadToken>` + `X-TT-Access: <accessKey>`（缺后者 → `10413 X-TT-Access does not match`）
 *    → `data = {tos_host, tos_sign, bucket, object_ids:["tos-cn-i-e874c6/<oid>"]}`
 * 3. 传图：`PUT https://<tos_host>/<oid>`，头 `Authorization: <tos_sign 原文（完整 JWT）>` + `Content-Type: image/jpeg`
 *    → 204 即落盘。**JWT 截断即 401**；CRC 头可带可不带。
 * 4. **登记（不可跳）**：`POST …?action=GetImageUploadInfos&`，body `[{"uri":"<oid>"}]`
 *    → `{result_uri, info:{width,height,size,format,md5}}` —— 服务端此刻才入库；
 *    **跳过这步直接提交 ⇒ `21084 封面图片不存在`**（PUT 204 成功也没用）。
 * 5. 返回 `result_uri`（`tos-cn-i-e874c6/…` 形态），调用方填进 `PublishVideo` 的 `VideoInfo.ThumbUri`。
 *
 * ## 已被否证的路由（勿再试）
 *
 * - `ApplyImageUpload`（imagex 公共网关，ServiceId=pk90l89vgd）→ `100008 Could not find operation`；
 *   头条 publish 页不走这条路。
 * - `ApplyUploadInner&SpaceName=pgc&FileType=object`：真页面里出现 6 次但**从未产生 tos 传输**，
 *   是 SDK 候选路由**预探测**（与 `GetUploadCandidates` 同层），不是封面上传。
 */

/** vas openapi 的固定 host（真页面实证；未观测到其它 host） */
const VAS_BASE = 'https://vas-lf-x.ixigua.com'

/** image_temp 凭证类型（与视频的 type=video 不同源） */
const AUTH_KEY_TYPE = 'image_temp'

/**
 * 从 getAuthKey(image_temp) 响应里取 `{accessKey, uploadToken}`。
 * 纯函数：形状不对返回 null，让调用方 fail closed（不伪造凭证）。
 *
 * @param {object} data getAuthKey 的 data 字段
 * @returns {{accessKey: string, uploadToken: string}|null}
 */
function pickImageTempCreds (data) {
  const d = data || {}
  const a = d.accessKey
  const t = d.uploadToken
  if (typeof a !== 'string' || !a || typeof t !== 'string' || !t) return null
  return { accessKey: a, uploadToken: t }
}

/**
 * 从 GetImageUploadParams 响应里取上传三元组。
 * 纯函数：缺任一必需键返回 null（不猜、不拼默认值）。
 *
 * @param {object} data GetImageUploadParams 的 data 字段
 * @returns {{objectId: string, tosHost: string, tosSign: string, bucket: string}|null}
 */
function pickUploadTarget (data) {
  const d = data || {}
  const oid = (d.object_ids || [])[0]
  if (typeof oid !== 'string' || !oid) return null
  if (typeof d.tos_host !== 'string' || !d.tos_host) return null
  if (typeof d.tos_sign !== 'string' || !d.tos_sign) return null
  return { objectId: oid, tosHost: d.tos_host, tosSign: d.tos_sign, bucket: d.bucket || '' }
}

/**
 * 从 GetImageUploadInfos 响应里取登记结果。
 * 纯函数：`info.md5` 缺失视为**未登记成功**（真页面登记成功必有 info 元数据）。
 *
 * @param {object} resp GetImageUploadInfos 的完整响应（{code,message,data}）
 * @param {string} requestedUri 请求登记的 uri（校验服务端回认的是不是它）
 * @returns {{uri: string, info: object}|null} 未登记/回认不一致返回 null
 */
function pickRegisteredImage (resp, requestedUri) {
  const arr = (resp || {}).data
  const item = Array.isArray(arr) ? arr[0] : null
  if (!item) return null
  const uri = item.result_uri || item.uri
  if (typeof uri !== 'string' || !uri) return null
  const info = item.info || {}
  if (!info.md5) return null
  // 回认校验：登记的对象必须就是刚传的那个（防串号）
  if (requestedUri && uri !== requestedUri) return null
  return { uri, info }
}

/**
 * 封面上传五步链（有 IO 的编排）。
 *
 * @param {object} o
 * @param {string} o.imagePath 本地封面图（jpeg）
 * @param {object} o.mpClient   mp.toutiao.com 的 http client（baseURL 已指向 mp 域）
 * @param {object} o.headers    mp 域基础头（含 Cookie/UA 等，`chain._mpHeaders({Accept:'application/json'})`）
 * @param {object} o.vasClient  vas-lf-x.ixigua.com 的 http client
 * @param {object} o.axiosLike  通用请求器（供 tos PUT 用；要求支持 url 拼绝对地址）
 * @param {string} [o.userAgent]
 * @param {Function} [o.onProgress] (percent, message)
 * @param {object} [o.ErrorClass] 平台错误类型（缺省 Error）
 * @returns {Promise<{uri: string, info: object}>} 登记后的 uri 与元数据
 */
async function uploadCoverImage (o) {
  const ErrorClass = o.ErrorClass || Error
  const fs = require('node:fs')
  const crypto = require('node:crypto')
  const fail = (msg) => { throw new ErrorClass('头条封面上传失败: ' + msg) }
  const buf = fs.readFileSync(o.imagePath)
  const size = buf.length

  // ① image_temp 凭证
  const ak = await o.mpClient.request({
    method: 'get',
    url: '/xigua/api/upload/getAuthKey/?params=' + encodeURIComponent(JSON.stringify({
      type: AUTH_KEY_TYPE, column: false, ugc: false, useImageX: true, useStsToken: false,
    })),
    headers: o.headers, validateStatus: (s) => s >= 200 && s < 500,
  })
  const creds = pickImageTempCreds((ak.data || {}).data)
  if (!creds) fail('getAuthKey(image_temp) 未返回 accessKey/uploadToken（响应=' + JSON.stringify(ak.data).slice(0, 200) + '）')

  // ② 三元组（双头：Authorization + X-TT-Access）
  const vasHeaders = Object.assign({}, o.headers, {
    Authorization: creds.uploadToken,
    'X-TT-Access': creds.accessKey,
    'Content-Type': 'application/json',
  })
  const gp = await o.vasClient.request({
    method: 'get',
    url: '/video/openapi/v1/?action=GetImageUploadParams&s=' + crypto.randomBytes(5).toString('hex') + '&use_edge_node=1&file_size=' + size,
    headers: vasHeaders, validateStatus: (s) => s >= 200 && s < 500,
  })
  const gpCode = (gp.data || {}).code
  if (gpCode !== 2000) {
    fail('GetImageUploadParams code=' + gpCode + ' ' + ((gp.data || {}).message || '') + '（响应=' + JSON.stringify(gp.data).slice(0, 200) + '）')
  }
  const target = pickUploadTarget((gp.data || {}).data)
  if (!target) fail('GetImageUploadParams 缺 object_ids/tos_host/tos_sign（data=' + JSON.stringify((gp.data || {}).data).slice(0, 200) + '）')
  if (o.onProgress) o.onProgress(88, '封面已获上传授权')

  // ③ PUT 图（Authorization = tos_sign 原文，完整 JWT）
  // tosBaseUrl 仅测试注入（零外发）；生产缺省 https://<tos_host>（三元组原样返回的 host）
  const tosBase = o.tosBaseUrl || ('https://' + target.tosHost)
  // CRC32：tos 服务端校验（缺省/不匹配 → 4007 MismatchChecksum，真机实测）
  function crc32hex (b) {
    let c
    const table = []
    for (let n = 0; n < 256; n++) { c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
    let crc = 0 ^ (-1)
    for (let i = 0; i < b.length; i++) crc = (crc >>> 8) ^ table[(crc ^ b[i]) & 0xFF]
    return ((crc ^ (-1)) >>> 0).toString(16).padStart(8, '0')
  }
  const put = await o.axiosLike.request({
    method: 'put',
    url: tosBase + '/' + target.objectId,
    data: buf, maxBodyLength: Infinity,
    headers: { 'Content-Type': 'image/jpeg', 'Content-CRC32': crc32hex(buf), Authorization: target.tosSign, 'User-Agent': o.userAgent || '' },
    validateStatus: (s) => s >= 200 && s < 500,
  })
  if (put.status >= 300) fail('PUT 图未落盘（HTTP ' + put.status + ' ' + JSON.stringify(put.data).slice(0, 160) + '）')

  // ④ 登记（GetImageUploadInfos；body=[{uri}]，缺它 ⇒ PublishVideo 21084）
  const gi = await o.vasClient.request({
    method: 'post',
    url: '/video/openapi/v1/?action=GetImageUploadInfos&',
    data: JSON.stringify([{ uri: target.objectId }]),
    headers: vasHeaders, validateStatus: (s) => s >= 200 && s < 500,
  })
  const registered = pickRegisteredImage(gi.data, target.objectId)
  if (!registered) fail('GetImageUploadInfos 未登记成功（响应=' + JSON.stringify(gi.data).slice(0, 220) + '）')
  if (o.onProgress) o.onProgress(92, '封面已上传并登记')

  // ⑤ 返回登记 uri（result_uri 与 objectId 理论同值，以服务端回认为准）
  return { uri: registered.uri, info: registered.info }
}

/**
 * 从调用方封面输入里选「本地文件路径」（三态契约的第一态）。
 * 纯函数：非字符串/空值一律跳过（对象形态的 cover 走的是 URI 态，不属于本态）。
 *
 * @param {Array} coverInputs run() 收集的封面输入数组（与 hasLocalCoverOnly 同一来源）
 * @returns {string|null}
 */
function pickLocalCoverPath (coverInputs) {
  const arr = Array.isArray(coverInputs) ? coverInputs : []
  return arr.find((x) => typeof x === 'string' && x) || null
}

/**
 * 链内便捷封装：从 ToutiaoVideoChain 实例取 client/headers 并完成五步。
 * 放本模块的原因：run() 已 495/500 行，接线体（~20 行）放链内必撞行数闸；
 * 且 client/headers 的取法是链的实现细节，收在这里让链内只留 4 行调用。
 *
 * @param {object} chain ToutiaoVideoChain 实例（用其 mp/headers/userAgent）
 * @param {string} imagePath 本地封面 jpeg
 * @param {object} [o] {onProgress}
 * @returns {Promise<{uri: string, info: object}>}
 */
async function uploadLocalCoverFor (chain, imagePath, o) {
  const opts = o || {}
  const { createHttpClient } = require('../core/http-base')
  return uploadCoverImage({
    imagePath,
    mpClient: opts.mpClient || chain.mp,
    headers: chain._mpHeaders({ Accept: 'application/json' }),
    // 零外发约定：链的 mpBase 被注入成非官方域（测试）时，vas 同样跟过去；生产不传即用官方域
    vasClient: opts.vasClient || createHttpClient({ baseURL: opts.vasBase || (chain.mpBase && !chain.mpBase.includes('mp.toutiao.com') ? chain.mpBase : VAS_BASE), timeout: 30000 }),
    axiosLike: opts.axiosLike || chain.mp,
    tosBaseUrl: opts.tosBaseUrl,
    userAgent: chain.userAgent,
    ErrorClass: Error,
    onProgress: opts.onProgress,
  })
}

module.exports = {
  VAS_BASE,
  AUTH_KEY_TYPE,
  pickImageTempCreds,
  pickUploadTarget,
  pickRegisteredImage,
  pickLocalCoverPath,
  uploadCoverImage,
  uploadLocalCoverFor,
}
