// @ts-check
'use strict'
/**
 * 参考图落盘（影视工程画布 - 参考图喂给生成）
 *
 * 渲染端把用户选择的本地图片读成 dataURL，经 film-engineering:upload-reference
 * 通道送到主进程；本模块负责解码、内容魔数嗅探（不信任客户端声明的 mime）、
 * 大小上限与路径安全校验后，落盘到受控媒体根 references/ 目录，返回服务端
 * 生成的规范化文件名——用户可控内容绝不参与文件名，路径穿越在结构上不可能。
 */

const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/** 单张参考图解码后大小上限（PRD 数据校验：10MB） */
const MAX_REF_BYTES = 10 * 1024 * 1024

/**
 * 图片内容嗅探：只认文件魔数，不信任客户端 mime。
 * @param {Buffer|null|undefined} buf
 * @returns {{ext: string, mime: string}|null}
 */
function sniffImageType (buf) {
  if (!Buffer.isBuffer(buf) || buf.length < 12) return null
  // PNG: 89 50 4E 47 0D 0A 1A 0A
  if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47 &&
      buf[4] === 0x0d && buf[5] === 0x0a && buf[6] === 0x1a && buf[7] === 0x0a) {
    return { ext: 'png', mime: 'image/png' }
  }
  // JPEG: FF D8 FF
  if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
    return { ext: 'jpg', mime: 'image/jpeg' }
  }
  // WEBP: RIFF????WEBP
  if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') {
    return { ext: 'webp', mime: 'image/webp' }
  }
  return null
}

/**
 * 解码 dataURL（base64 或 percent-encoded）。
 * @param {unknown} dataUrl
 * @returns {{buffer: Buffer, declaredMime: string}|{error: string}}
 */
function decodeDataUrl (dataUrl) {
  if (typeof dataUrl !== 'string' || !dataUrl) return { error: 'dataUrl 必须为非空字符串' }
  const m = /^data:([^;,]*)?(;base64)?,(.*)$/is.exec(dataUrl)
  if (!m) return { error: 'dataURL 格式非法' }
  const [, declaredMime, b64flag, body] = m
  let buffer
  try {
    buffer = b64flag ? Buffer.from(body, 'base64') : Buffer.from(decodeURIComponent(body), 'binary')
  } catch {
    return { error: 'dataURL 解码失败' }
  }
  if (!buffer || buffer.length === 0) return { error: '参考图内容为空' }
  return { buffer, declaredMime: (declaredMime || '').toLowerCase() }
}

/** 目标路径是否位于 root 内（纵深防御；文件名服务端生成时恒真） */
function isWithin (root, target) {
  const rel = path.relative(root, target)
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * 保存一张参考图到 <mediaRoot>/references/ref-<16hex>.<ext>。
 * @param {{mediaRoot?: string, dataUrl?: unknown, fsImpl?: typeof fs}} opts
 * @returns {Promise<{ok: true, path: string, fileName: string, bytes: number, mime: string}|{ok: false, error: string}>}
 */
async function saveReference ({ mediaRoot, dataUrl, fsImpl = fs } = {}) {
  if (typeof mediaRoot !== 'string' || !mediaRoot.trim()) {
    return { ok: false, error: '媒体根目录未配置' }
  }
  const decoded = decodeDataUrl(dataUrl)
  if (decoded.error) return { ok: false, error: decoded.error }
  if (decoded.buffer.length > MAX_REF_BYTES) {
    return { ok: false, error: '参考图不能超过 ' + Math.floor(MAX_REF_BYTES / 1024 / 1024) + 'MB' }
  }
  const sniffed = sniffImageType(decoded.buffer)
  if (!sniffed) return { ok: false, error: '仅支持 PNG / JPEG / WEBP 格式参考图' }
  const fileName = 'ref-' + crypto.randomBytes(8).toString('hex') + '.' + sniffed.ext
  const dir = path.join(mediaRoot, 'references')
  const filePath = path.join(dir, fileName)
  if (!isWithin(mediaRoot, filePath)) return { ok: false, error: '参考图落盘路径越界' }
  try {
    fsImpl.mkdirSync(dir, { recursive: true })
    fsImpl.writeFileSync(filePath, decoded.buffer)
  } catch (e) {
    return { ok: false, error: '参考图写入失败: ' + (e && e.message ? e.message : String(e)) }
  }
  return { ok: true, path: filePath, fileName, bytes: decoded.buffer.length, mime: sniffed.mime }
}

module.exports = { saveReference, sniffImageType, decodeDataUrl, isWithin, MAX_REF_BYTES }
