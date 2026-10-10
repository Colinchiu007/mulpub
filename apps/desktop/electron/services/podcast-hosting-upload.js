// @ts-check
'use strict'
/**
 * podcast-hosting-upload.js — 播客「托管直传」（收录形态 B）的规则层
 *
 * 为什么单独成文件：object_key 派生、公网 URL 拼接与 OSS V1 签名都是
 * 「写错就静默产出一条坏 enclosure，而 feed 自检只看得见最终 URL」的纯函数，
 * 必须能脱离服务、脱离文件系统单独取值断言（先例 story2video-text-config）。
 *
 * 与 packages/api-publish-engine/src/oss-uploader.js 的关系（改这里前先读那份）：
 *   引擎那份是 **分片上传 + STS 三元组**：uv = { endpoint,
 *   upload_token: { access_id, access_key, access_token }, upload_file: { object_key } }，
 *   签名串里固定拼 `x-oss-security-token`，缺 access_token 就签不出 Authorization。
 *   它服务的是「平台方下发临时凭证」的形态（见 upload/token-acquirer.js 的 vendor 组装）。
 *   本特性拿到的是 **用户自带的长期 AK**（hosting.accessKeyId/accessKeySecret，没有
 *   securityToken），于是不走引擎的分片链，改用最小单对象 PUT + OSS V1 签名；
 *   当用户确实给出 securityToken（STS 形态）时，服务改走注入的 ossUploader（引擎形态）。
 *   两条路径共用本文件的 object_key 派生与公网 URL 拼接——口径只有一份。
 *
 * 出站一律经注入的 httpClient（默认在函数体内才 require axios）：
 * 本仓测试期禁止真实出站（AGENTS.md QM-3「测试层禁止真实出站」），
 * 不在模块顶层 require axios，否则被测试加载时就把真实传输层装了进来。
 */

const crypto = require('crypto')
const path = require('path')
const { pathToFileURL } = require('url')
const { audioMimeFromUrl } = require('@multi-publish/shared-utils/src/podcast-rss')

/** 本期实际接入的托管 provider；cos 只在目录里占位，落地即如实拒绝。 */
const HOSTING_PROVIDERS = Object.freeze(['oss'])
/** hosting.provider 允许被「填进表单」的取值（保存时不丢用户已输入的 cos）。 */
const HOSTING_PROVIDER_INPUT_VALUES = Object.freeze(['oss', 'cos'])

const DEFAULT_PATH_PREFIX = 'podcast'
const PUT_TIMEOUT_MS = Number(process.env.MP_PODCAST_UPLOAD_TIMEOUT_MS || 120000)

function issue (code, field, message) {
  return { code, field, message }
}

/**
 * 托管配置校验（形态 B 的资格判定）。
 * 返回 issues 数组，空数组即通过。凭证缺失与 provider 不支持必须分开报，
 * 两者的排查方向完全不同（一个是「没填」，一个是「本期没做」）。
 */
function validateHosting (hosting) {
  if (!hosting || typeof hosting !== 'object' || Array.isArray(hosting)) {
    return [issue('PODCAST_HOSTING_REQUIRED', 'hosting', '使用本地音频需先配置对象存储托管（当前支持阿里云 OSS）')]
  }
  const provider = String(hosting.provider || '').trim().toLowerCase()
  if (!HOSTING_PROVIDER_INPUT_VALUES.includes(provider)) {
    return [issue('PODCAST_HOSTING_PROVIDER_INVALID', 'hosting.provider', '托管类型须为 oss 或 cos')]
  }
  if (!HOSTING_PROVIDERS.includes(provider)) {
    return [issue('PODCAST_HOSTING_PROVIDER_UNSUPPORTED', 'hosting.provider', `托管类型「${provider}」本期未接入，请改用阿里云 OSS 或自带音频外链`)]
  }
  const issues = []
  if (!String(hosting.endpoint || '').trim()) {
    issues.push(issue('PODCAST_HOSTING_ENDPOINT_REQUIRED', 'hosting.endpoint', 'OSS Endpoint 不能为空'))
  }
  if (!String(hosting.bucket || '').trim()) {
    issues.push(issue('PODCAST_HOSTING_BUCKET_REQUIRED', 'hosting.bucket', 'Bucket 名称不能为空'))
  }
  if (!String(hosting.accessKeyId || '').trim() || !String(hosting.accessKeySecret || '').trim()) {
    issues.push(issue('PODCAST_HOSTING_CREDENTIAL_REQUIRED', 'hosting.accessKeyId', 'AccessKeyId / AccessKeySecret 不能为空'))
  }
  // 落盘层的 normalizePathPrefix 会把 `..` 段与前后斜杠**清洗掉**（那是防逃逸的第二道闸）。
  // 但输入层若跟着一起静默清洗，用户填的发布路径与真正生效的路径就不是同一个东西了——
  // 公网地址会变、已提交给聚合端的 Feed 会指错层。所以这里出声拒绝，不做第二份"善意的改写"。
  const prefix = String(hosting.pathPrefix == null ? '' : hosting.pathPrefix).trim()
  if (prefix && (prefix.startsWith('/') || prefix.split('/').some((seg) => seg === '.' || seg === '..'))) {
    issues.push(issue('PODCAST_HOSTING_PREFIX_UNSAFE', 'hosting.pathPrefix', '路径前缀不得以 / 开头，也不得含 `.` 或 `..` 段（这类段会被判为非法，否则等于悄悄改掉你的发布路径）'))
  }
  return issues
}

/**
 * 把任意文件名收敛成可安全进 object_key 的一段：
 * 只取 basename（禁止 `..`/分隔符穿越前缀），非法字符换成 `-`，
 * 扩展名只保留 `[A-Za-z0-9]` 1~8 位（避免 `.exe`、多点尾巴这类意外）。
 */
function safeFileStem (fileName) {
  const base = path.basename(String(fileName == null ? '' : fileName))
  const extMatch = /\.[A-Za-z0-9]{1,8}$/.exec(base)
  const ext = extMatch ? extMatch[0].toLowerCase() : ''
  const stem = (ext ? base.slice(0, base.length - ext.length) : base)
    .replace(/[^A-Za-z0-9._-]/g, '-')
    .replace(/^[-.]+|[-.]+$/g, '')
    .slice(0, 80)
  return { stem: stem || 'audio', ext }
}

function normalizePathPrefix (prefix) {
  const raw = String(prefix == null ? '' : prefix).trim().replace(/^\/+|\/+$/g, '')
  if (!raw) return DEFAULT_PATH_PREFIX
  return raw
    .split('/')
    .map((seg) => seg.replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+|[-.]+$/g, ''))
    .filter(Boolean)
    .join('/') || DEFAULT_PATH_PREFIX
}

/**
 * object_key 派生（纯函数，形态 B 唯一实现）。
 * 规则 `<prefix>/<channelId>/<episodeId><ext>`：
 *   - 按频道分层：删除频道时可整层回收；
 *   - 键里不带用户标题（避免把未发布文本写进公网 URL —— 与门禁日志同一口径）；
 *   - episodeId 唯一 ⇒ 同名的两次上传不会互相覆盖。
 */
function deriveObjectKey ({ pathPrefix, channelId, episodeId, fileName } = {}) {
  const id = String(episodeId || '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  const ch = String(channelId || '').replace(/[^A-Za-z0-9._-]/g, '-').replace(/^[-.]+|[-.]+$/g, '')
  const { stem, ext } = safeFileStem(fileName)
  const name = [stem, id].filter(Boolean).join('-')
  return `${normalizePathPrefix(pathPrefix)}/${ch}/${name}${ext}`
}

/**
 * 公网可读 URL：OSS 的虚拟主机风格是 `https://<bucket>.<endpoint 主机>/<key>`。
 * endpoint 常常已经带 bucket 前缀（`bucket.oss-cn-x.aliyuncs.com`）或干脆是完整 URL，
 * 两种写法都得得到同一个 host，不得拼出 `bucket.bucket.oss-...`。
 */
function objectPublicUrl ({ endpoint, bucket, objectKey } = {}) {
  const rawEndpoint = String(endpoint || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const b = String(bucket || '').trim()
  const key = String(objectKey || '').replace(/^\/+/, '')
  if (!rawEndpoint || !b || !key) return null
  const host = rawEndpoint.toLowerCase().startsWith(`${b.toLowerCase()}.`)
    ? rawEndpoint
    : `${b}.${rawEndpoint}`
  return `https://${host}/${key.split('/').map(encodeURIComponent).join('/')}`
}

/** CanonicalizedResource：V1 签名里必须是 `/bucket/key`，与 URL 的编码无关。 */
function ossCanonicalizedResource ({ bucket, objectKey } = {}) {
  return `/${String(bucket || '').trim()}/${String(objectKey || '').replace(/^\/+/, '')}`
}

/**
 * OSS V1（HMAC-SHA1）签名的待签串。
 * stringToSign = VERB\nContent-MD5\nContent-Type\nDate\nCanonicalizedOSSHeaders + CanonicalizedResource
 * 本实现只签 `x-oss-security-token`（STS 形态才带）与 `x-oss-date` 两个头，
 * 其余头不进签名串，避免「加一个无关头就 403」的隐性耦合。
 */
function ossV1StringToSign ({ method, contentType, date, canonicalizedResource, securityToken } = {}) {
  const ossHeaders = []
  if (securityToken) ossHeaders.push(`x-oss-security-token:${securityToken}`)
  if (date) ossHeaders.push(`x-oss-date:${date}`)
  // CanonicalizedOSSHeaders 必须按头名字典序，且以换行结尾（无带头时为空串）。
  const canonicalHeaders = ossHeaders.sort().map((h) => `${h}\n`).join('')
  return [String(method || 'PUT').toUpperCase(), '', String(contentType || ''), String(date || ''), `${canonicalHeaders}${canonicalizedResource}`].join('\n')
}

/**
 * 生成 PUT 所需的头（含 Authorization）。凭证一律只进请求头，
 * 禁止出现在返回值/日志/错误消息里（返回的 headers 由调用方直接交给 httpClient）。
 */
function buildOssPutHeaders ({ endpoint, bucket, objectKey, contentType, accessKeyId, accessKeySecret, securityToken, date } = {}) {
  const resource = ossCanonicalizedResource({ bucket, objectKey })
  const stamp = String(date || new Date().toUTCString())
  const stringToSign = ossV1StringToSign({
    method: 'PUT',
    contentType,
    date: stamp,
    canonicalizedResource: resource,
    securityToken,
  })
  const signature = crypto.createHmac('sha1', String(accessKeySecret || '')).update(stringToSign).digest('base64')
  const headers = {
    'Content-Type': String(contentType || 'application/octet-stream'),
    'x-oss-date': stamp,
    Authorization: `OSS ${String(accessKeyId || '')}:${signature}`,
  }
  if (securityToken) headers['x-oss-security-token'] = String(securityToken)
  void endpoint // host 由 URL 承载，签名不需要（保留形参是为了调用点可读）
  return headers
}

/**
 * 引擎（OssUploader.upload）要求的 uv 形状，逐字段对齐 token-acquirer.js:31 的 vendor 组装。
 * 只有 STS 三元组齐备时才有意义 —— 长期 AK 形态走 buildOssPutHeaders。
 */
function buildEngineUploadToken ({ endpoint, bucket, accessKeyId, accessKeySecret, securityToken, objectKey } = {}) {
  const host = String(endpoint || '').trim().replace(/^https?:\/\//i, '').replace(/\/+$/, '')
  const b = String(bucket || '').trim()
  return {
    endpoint: host.toLowerCase().startsWith(`${b.toLowerCase()}.`) ? host : `${b}.${host}`,
    upload_token: {
      access_id: String(accessKeyId || ''),
      access_key: String(accessKeySecret || ''),
      access_token: String(securityToken || ''),
    },
    upload_file: { object_key: String(objectKey || '') },
  }
}

/** 本地文件的音频 MIME：复用 shared-utils 的单一实现，禁止再抄一份扩展名表。 */
function audioContentTypeFromPath (filePath) {
  return audioMimeFromUrl(pathToFileURL(String(filePath || '')).href)
}

/**
 * 单对象 PUT 直传。fs/httpClient 全部注入：
 * 测试给假 client（禁止真实出站），生产给 axios。
 * 非 2xx 一律抛错并带上状态码，错误消息只允许出现状态码与长度，不得回显凭证或 URL 查询串。
 */
async function putObject ({ httpClient, fsImpl, filePath, url, headers, timeoutMs = PUT_TIMEOUT_MS } = {}) {
  if (!url) {
    // 带 code 抛：调用方 `e.code || UPLOAD_FAILED` 的兜底会把"URL 拼不出来"报成"上传失败"，
    // 两者的排查方向完全不同（一个查配置，一个查网络/签名）。
    const e = new Error('PODCAST_HOSTING_URL_UNRESOLVED')
    e.code = 'PODCAST_HOSTING_URL_UNRESOLVED'
    throw e
  }
  const client = httpClient || require('axios')
  const fs = fsImpl || require('fs')
  const size = fs.statSync(filePath).size
  const stream = fs.createReadStream(filePath)
  const finalHeaders = { ...headers, 'Content-Length': String(size) }
  // 必须挂 error 监听：createReadStream 会把 open 排进下一个 tick，destroy() 取消不掉它。
  // 于是「请求早已返回、文件随后被删」时这次迟到的 open 会以 'error' 事件落到**无人监听**的流上，
  // 直接变成主进程的 uncaughtException（实测在播客托管用例的临时目录回收时命中）。
  // 记账而不是吞掉：请求进行中读体失败 ⇒ 这份 2xx 不可信，不得当成功返回。
  let streamError = null
  if (stream && typeof stream.on === 'function') {
    stream.on('error', (e) => { if (!streamError) streamError = e })
  }
  try {
    const res = await client.put(url, stream, {
      headers: finalHeaders,
      timeout: timeoutMs,
      maxBodyLength: Infinity,
      maxContentLength: Infinity,
      validateStatus: () => true,
    })
    const status = res && Number(res.status)
    if (!Number.isInteger(status) || status < 200 || status > 299) {
      const labelled = Number.isInteger(status) ? status : 'no-status'
      const err = new Error(`PODCAST_HOSTING_UPLOAD_FAILED(${labelled})`)
      err.code = 'PODCAST_HOSTING_UPLOAD_FAILED'
      err.status = Number.isInteger(status) ? status : null
      if (streamError) err.streamError = streamError
      throw err
    }
    if (streamError) {
      const err = new Error('PODCAST_HOSTING_BODY_READ_FAILED')
      err.code = 'PODCAST_HOSTING_BODY_READ_FAILED'
      err.status = status
      err.streamError = streamError
      throw err
    }
    return { status, size }
  } catch (e) {
    if (e && !e.streamError && streamError) e.streamError = streamError
    throw e
  } finally {
    if (stream && typeof stream.destroy === 'function' && !stream.destroyed) stream.destroy()
  }
}

module.exports = {
  HOSTING_PROVIDERS,
  HOSTING_PROVIDER_INPUT_VALUES,
  DEFAULT_PATH_PREFIX,
  PUT_TIMEOUT_MS,
  issue,
  validateHosting,
  safeFileStem,
  normalizePathPrefix,
  deriveObjectKey,
  objectPublicUrl,
  ossCanonicalizedResource,
  ossV1StringToSign,
  buildOssPutHeaders,
  buildEngineUploadToken,
  audioContentTypeFromPath,
  putObject,
}
