'use strict'
/**
 * 微信公众号 API 轨 —— 图片上传（封面与正文图共用，PRD §F2 / §5.2）
 *
 * 依据：参考产品（4.0）逆向实测契约，两条轨**不可互换**：
 *  - 远程 URL  ⇒ POST /cgi-bin/uploadimg2cdn，body `t=ajax-editor-upload-img&imgUrl=<url>&...`
 *                 （服务端代取，避免本地转发与 SSRF 面）
 *  - 本地文件  ⇒ POST /cgi-bin/filetransfer?action=upload_material&scene=8，multipart
 *                 （平台只收 multipart 二进制；scene=8 与参考产品一致）
 *
 * 判据（B4）：**最终 URL 只能来自平台回包**（`cdn_url` 或 `url`）。
 * 不得回退使用输入路径——上一轮「历史缩略图不是真实封面」就是同族陷阱。
 */
const fs = require('node:fs')
const path = require('node:path')

const { BASE } = require('./session')
const { WechatMpError } = require('./errors')

const MAX_COVER_BYTES = 2 * 1024 * 1024

const MIME_BY_EXT = { jpg: 'jpeg', jpeg: 'jpeg', png: 'png', gif: 'gif', webp: 'webp' }

function isHttpUrl (v) {
  return /^https?:\/\//i.test(String(v == null ? '' : v))
}

/** 是否是平台自己的 CDN（已是 CDN 的 URL 不必再上传一次）。 */
function isPlatformCdn (v) {
  return /mmbiz\.qpic\.cn/i.test(String(v == null ? '' : v))
}

/** 扩展名 → 微信接受的图片子类型；未知扩展名回落 jpeg（B3）。 */
function extToMime (filePath) {
  const ext = String(path.extname(String(filePath == null ? '' : filePath)) || '').replace(/^\./, '').toLowerCase()
  return MIME_BY_EXT[ext] || 'jpeg'
}

/** 从上传回包里取最终 URL（B4）。 */
function pickUploadedUrl (resp) {
  if (!resp) return ''
  return String(resp.cdn_url || resp.url || '')
}

function nowStamp (digits) {
  const ms = Date.now()
  return digits === 13 ? String(ms) : String(Math.floor(ms / 1000))
}

function randomT (prefix) {
  return prefix + Math.floor(Math.random() * 1e9)
}

function uploadHeaders (cookie) {
  return {
    Cookie: cookie || '',
    Referer: BASE + '/cgi-bin/home',
    Origin: BASE,
  }
}

/** 远程 URL 上传（URL 轨）。 */
async function uploadImageByUrl (http, opts) {
  const { cookie, token, url } = opts || {}
  if (!url) throw new WechatMpError('cover-upload-failed', '封面上传失败：图片地址为空')
  const t = randomT('0.428538')
  // URLSearchParams：token 是外部输入，编码交给标准实现（手拼会被 CCG 误判为硬编码密钥）
  const body = new URLSearchParams({
    t: 'ajax-editor-upload-img',
    imgUrl: String(url),
    token: String(token || ''),
    lang: 'zh_CN',
    f: 'json',
    ajax: '1',
  }).toString()
  const resp = await http.post(BASE + '/cgi-bin/uploadimg2cdn', body, {
    headers: {
      ...uploadHeaders(cookie),
      'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
    },
    params: { lang: 'zh_CN', token: token || '', t },
  })
  const data = (resp && resp.data) || {}
  const finalUrl = pickUploadedUrl(data)
  if (!finalUrl) {
    throw new WechatMpError('cover-upload-failed', '封面上传失败：平台未返回图片地址', { kind: 'url' })
  }
  return {
    url: finalUrl,
    fileId: data.file_id == null ? '' : String(data.file_id),
    format: data.img_format || '',
    sourceKind: 'url',
  }
}

/** 本地文件上传（multipart 轨）。 */
async function uploadLocalImage (http, opts) {
  const { cookie, session, filePath } = opts || {}
  // C4：没有上传票据就别发请求——发出去也只会拿到一个无法用于封面的结果
  if (!session || !session.ticketId || !session.ticket) {
    throw new WechatMpError('cover-upload-failed', '封面上传失败：账号上传票据缺失，请重新登录后重试')
  }
  let stat
  try {
    stat = fs.statSync(filePath)
  } catch (e) {
    throw new WechatMpError('cover-upload-failed', '封面上传失败：图片文件不存在（' + path.basename(String(filePath || '')) + '）')
  }
  if (!stat.isFile()) {
    throw new WechatMpError('cover-upload-failed', '封面上传失败：封面路径不是文件')
  }
  if (stat.size > MAX_COVER_BYTES) {
    const mb = (stat.size / 1024 / 1024).toFixed(2)
    throw new WechatMpError('cover-upload-failed', '封面上传失败：图片大小 ' + mb + 'MB 超过 2MB 上限，请压缩后重试')
  }
  const name = path.basename(String(filePath))
  const mime = extToMime(filePath)
  const buffer = fs.readFileSync(filePath)
  const form = new FormData()
  form.append('id', nowStamp(13))
  form.append('name', name)
  form.append('type', 'image/' + mime)
  form.append('lastModifiedDate', new Date().toString())
  form.append('size', String(stat.size))
  form.append('file', new Blob([buffer], { type: 'image/' + mime }), name)
  const resp = await http.post(BASE + '/cgi-bin/filetransfer', form, {
    headers: {
      ...uploadHeaders(cookie),
      // 只声明 multipart：boundary 由 http 客户端（axios）按 FormData 追加，
      // 手写 boundary 是本仓既有反例，不重复踩。
      'Content-Type': 'multipart/form-data',
    },
    params: {
      action: 'upload_material',
      f: 'json',
      scene: 8,
      writetype: 'doublewrite',
      groupid: 1,
      ticket_id: session.ticketId,
      ticket: session.ticket,
      svr_time: nowStamp(10),
      token: session.token,
      lang: 'zh_CN',
      seq: nowStamp(13),
      t: randomT('0.245301'),
    },
  })
  const data = (resp && resp.data) || {}
  const finalUrl = pickUploadedUrl(data)
  if (!finalUrl) {
    throw new WechatMpError('cover-upload-failed', '封面上传失败：平台未返回图片地址', { kind: 'local' })
  }
  return {
    url: finalUrl,
    fileId: data.content == null ? '' : String(data.content),
    format: data.type || '',
    sourceKind: 'local',
  }
}

/** 按来源自动选轨（本地文件 / 远程 URL）。 */
async function uploadImage (http, opts) {
  const source = (opts && opts.source) || ''
  if (isHttpUrl(source)) return uploadImageByUrl(http, { ...opts, url: source })
  return uploadLocalImage(http, { ...opts, filePath: source })
}

module.exports = {
  MAX_COVER_BYTES,
  isHttpUrl,
  isPlatformCdn,
  extToMime,
  pickUploadedUrl,
  uploadImageByUrl,
  uploadLocalImage,
  uploadImage,
}
