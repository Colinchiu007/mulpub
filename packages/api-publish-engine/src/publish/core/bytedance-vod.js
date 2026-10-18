'use strict'
/**
 * bytedance-vod.js — 字节系平台（抖音 / 今日头条·西瓜）共用的 VOD 视频上传协议
 *
 * ## 为什么抽这一层
 *
 * 2026-10-18 对头条视频链做了**实网抓包**（可读分区 cookie + Playwright 真实上传，
 * 发布类请求硬 abort），拿到的三段协议与抖音链逐字同形：
 *
 * ```
 *   GET  <vod>?Action=ApplyUploadInner&Version=2020-11-19&SpaceName=<空间>&FileType=video
 *        &IsInner=1&FileSize=<n>[&EnOID=1]&app_id=<appId>&user_id=<uid>&s=<16hex>
 *   POST <UploadHost>/upload/v1/<StoreUri>?uploadid=..&part_number=..&phase=transfer&part_offset=..
 *   POST <UploadHost>/upload/v1/<StoreUri>?uploadid=..&phase=finish&uploadmode=part
 *   POST <vod>?Action=CommitUploadInner&Version=2020-11-19&SpaceName=<空间>&app_id=<appId>&user_id=<uid>
 * ```
 *
 * 两条链的差异**只在 apply 的三个参数**（SpaceName / app_id / 是否有 EnOID）：
 *
 * | 项 | 抖音 | 头条 |
 * | --- | --- | --- |
 * | SpaceName | `aweme` | `middlevideo_toutiao`（由 getAuthKey 响应给出） |
 * | app_id | `2906` | `1231` |
 * | EnOID | 无 | `1` |
 *
 * 上传主机本就来自 apply 响应的 `UploadHost`（不是写死的），所以抖音的
 * `vod.bytedanceapi.com` 与头条的 `tos-lf-x.snssdk.com` 走的是**同一段代码**。
 *
 * 因此把「apply → 分片 → finish → commit」抽成单一实现，两边共用；
 * 各链只保留自己独有的 auth 与投稿端点。
 *
 * ## 与旧实现的关系
 *
 * 本模块的逻辑是从 `platforms/douyin-video.js#uploadVideo` 原样抽出（行为等价），
 * 抖音链改为调用它；回归由 `test/douyin-video-chain.test.js` 逐字步骤断言兜住。
 */

const crypto = require('crypto')
const fs = require('fs')
const zlib = require('zlib')
const aws4 = require('aws4')

const VOD_VERSION = '2020-11-19'
const REGION = 'cn-north-1'

function sha256hex (s) { return crypto.createHash('sha256').update(s, 'utf8').digest('hex') }
function crc32hex (buf) { return ((zlib.crc32(buf) >>> 0)).toString(16).padStart(8, '0') }
function hostOf (base) { try { return new URL(base).host } catch (e) { return '' } }

/**
 * 分片大小阶梯（字节）：<=500MB→3MiB，<=1GB→5MiB，否则 10MiB
 *
 * ⚠️ 写法刻意保留抖音原实现的 `>` 形式（而不是等价的 `<=` 写法）：
 * 两者在**恰好 500MB / 1000MB** 处会得到不同档位，本次是纯抽取重构，
 * 必须逐字保持原行为，否则大文件分片数会变（回归面在抖音链）。
 */
function partSizeFor (size) {
  const MB = 1024 * 1024
  if (size > 1000 * MB) return 10 * MB
  if (size > 500 * MB) return 5 * MB
  return 3 * MB
}

/** 只回传 aws4 真正签进去的头，避免把宿主默认头带出去 */
function pickSigned (headers) {
  const out = {}
  for (const k of Object.keys(headers || {})) {
    if (/^(authorization|x-amz-date|x-amz-content-sha256|x-amz-security-token|content-type)$/i.test(k)) out[k] = headers[k]
  }
  return out
}

/** 查询串编码（键值逐字 encodeURIComponent，保序） */
function applyQueryString (params) {
  return Object.keys(params)
    .filter((k) => params[k] !== undefined && params[k] !== null && params[k] !== '')
    .map((k) => encodeURIComponent(k) + '=' + encodeURIComponent(params[k]))
    .join('&')
}

/** 通用 aws4 签名 GET（vod/imagex apply） */
async function signedGet (client, base, service, query, creds, region) {
  const path = '/?' + query
  const headers = { 'x-amz-content-sha256': sha256hex('') }
  const o = { host: hostOf(base), path, method: 'GET', headers, service, region: region || REGION }
  aws4.sign(o, creds)
  return client.request({
    method: 'get', url: path, headers: pickSigned(o.headers),
    validateStatus: (s) => s >= 200 && s < 500,
  })
}

/** 通用 aws4 签名 POST（vod/imagex commit，JSON 体） */
async function signedPost (client, base, service, path, bodyObj, creds, region) {
  const bodyStr = JSON.stringify(bodyObj)
  const headers = { 'content-type': 'application/json', 'x-amz-content-sha256': sha256hex(bodyStr) }
  const o = { host: hostOf(base), path, method: 'POST', headers, body: bodyStr, service, region: region || REGION }
  aws4.sign(o, creds)
  return client.request({
    method: 'post', url: path, data: bodyStr, headers: pickSigned(o.headers),
    maxBodyLength: Infinity, validateStatus: (s) => s >= 200 && s < 500,
  })
}

/**
 * 构造 ApplyUploadInner 的查询串（两条链的差异集中在这里表达）。
 *
 * @param {object} o
 * @param {number} o.size            文件字节数
 * @param {string} o.spaceName       VOD 空间名（抖音 aweme / 头条 middlevideo_toutiao）
 * @param {number} o.appId           应用 id（抖音 2906 / 头条 1231）
 * @param {string|number} o.uid      平台用户 id
 * @param {boolean} [o.innerOid]     是否带 EnOID=1（头条需要，抖音不带）
 * @param {string} [o.suffix]        s 参数（默认随机 16 hex）
 */
function buildApplyQuery (o) {
  const q = {
    Action: 'ApplyUploadInner',
    Version: VOD_VERSION,
    SpaceName: o.spaceName,
    FileType: 'video',
    IsInner: 1,
    FileSize: o.size,
  }
  if (o.innerOid) q.EnOID = 1
  q.app_id = o.appId
  q.user_id = o.uid
  q.s = o.suffix || crypto.randomBytes(8).toString('hex')
  return applyQueryString(q)
}

/**
 * 完整 VOD 视频上传：apply → 分片 transfer → finish → CommitUploadInner → Vid
 *
 * @param {object} o
 * @param {object} o.vod        vod 客户端（aws4 签名请求走这里）
 * @param {object} o.upload     上传客户端（二进制分片走这里）
 * @param {string} o.vodBase
 * @param {object} o.creds      { sessionToken, accessKeyId, secretAccessKey }
 * @param {string} o.filePath
 * @param {string|number} o.uid
 * @param {string} o.spaceName
 * @param {number} o.appId
 * @param {boolean} [o.innerOid]
 * @param {string} [o.region]
 * @param {string} [o.userAgent]
 * @param {string} [o.uploadScheme] 默认 'https:'
 * @param {Function} [o.onProgress] (percent, message)
 * @param {Function} [o.ErrorClass] 平台错误类型（缺省 Error）
 * @returns {Promise<string>} Vid
 */
async function uploadVideoToVod (o) {
  const ErrorClass = o.ErrorClass || Error
  // 错误码映射：抽共用实现时**必须**保住原链的错误语义。
  // 抖音原实现对三条失败路径分别用 data_error(-2) / io_error(-5) / data_error(-2)，
  // 而 DouyinVideoError 在 code===undefined 时默认 -2 ⇒ 若不显式传，`分片缺失` 会从
  // io_error 被悄悄降级成 data_error（`publish-api-capabilities` 虽都映射 400，
  // 但错误语义与调用方判据会变）。调用方按 key 提供即可。
  const codes = o.errorCodes || {}
  const fail = (msg, codeKey) => { throw new ErrorClass(msg, codeKey === undefined ? undefined : codes[codeKey]) }
  const size = fs.statSync(o.filePath).size

  // ① apply
  const applyQ = buildApplyQuery({ size, spaceName: o.spaceName, appId: o.appId, uid: o.uid, innerOid: o.innerOid })
  const ar = await signedGet(o.vod, o.vodBase, 'vod', applyQ, o.creds, o.region)
  const nodes = ((((ar.data || {}).Result || {}).InnerUploadAddress || {}).UploadNodes) || []
  if (!nodes.length) fail('vod apply 无 UploadNodes', 'noNodes')
  const n0 = nodes[0]
  const store = (n0.StoreInfos || [])[0] || {}

  // ② 分片上传（主机与路径都来自 apply 响应）
  const uploadId = crypto.randomUUID()
  const scheme = o.uploadScheme || 'https:'
  const base = scheme + '//' + n0.UploadHost + '/upload/v1/' + store.StoreUri
  const partSize = partSizeFor(size)
  const total = Math.max(1, Math.ceil(size / partSize))
  const fh = fs.openSync(o.filePath, 'r')
  let uploaded = 0
  try {
    for (let i = 0; i < total; i++) {
      const start = i * partSize
      const len = Math.min(partSize, size - start)
      const buf = Buffer.alloc(len)
      fs.readSync(fh, buf, 0, len, start)
      const crc = crc32hex(buf)
      const url = base + '?uploadid=' + uploadId + '&part_number=' + (i + 1) + '&phase=transfer&part_offset=' + start
      await o.upload.request({
        method: 'post', url, data: buf, maxBodyLength: Infinity,
        headers: {
          Authorization: store.Auth, 'Content-CRC32': crc,
          'Content-Type': 'application/octet-stream', 'X-Storage-U': String(o.uid),
          ...(o.userAgent ? { 'User-Agent': o.userAgent } : {}),
        },
        validateStatus: (s) => s >= 200 && s < 500,
      })
      uploaded++
      if (o.onProgress) o.onProgress(Math.round((uploaded / total) * 70), '视频上传中')
    }
  } finally { fs.closeSync(fh) }
  if (uploaded < total) fail('分片缺失（' + uploaded + '/' + total + '）', 'shortChunks')

  // ③ finish
  await o.upload.request({
    method: 'post', url: base + '?uploadid=' + uploadId + '&phase=finish&uploadmode=part', data: '',
    headers: {
      Authorization: store.Auth, 'Content-Type': 'text/plain',
      'X-Storage-U': String(o.uid), ...(o.userAgent ? { 'User-Agent': o.userAgent } : {}),
    },
    validateStatus: (s) => s >= 200 && s < 500,
  })

  // ④ CommitUploadInner
  const commitPath = '/?Action=CommitUploadInner&' + applyQueryString({
    Version: VOD_VERSION, SpaceName: o.spaceName, app_id: o.appId, user_id: o.uid,
  })
  const commitBody = {
    SessionKey: n0.SessionKey,
    Functions: [{ name: 'GetMeta' }, { name: 'Snapshot', input: { SnapshotTime: 0 } }],
  }
  const cr = await signedPost(o.vod, o.vodBase, 'vod', commitPath, commitBody, o.creds, o.region)
  const results = ((((cr.data || {}).Result || {}).Results) || [])
  const vid = results[0] && results[0].Vid
  if (!vid) fail('CommitUploadInner 未返回 Vid', 'noVid')
  return vid
}

module.exports = {
  VOD_VERSION,
  REGION,
  sha256hex,
  crc32hex,
  hostOf,
  partSizeFor,
  pickSigned,
  applyQueryString,
  signedGet,
  signedPost,
  buildApplyQuery,
  uploadVideoToVod,
}
