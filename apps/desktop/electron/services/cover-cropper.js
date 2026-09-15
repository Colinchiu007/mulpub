// @ts-check
/**
 * cover-cropper.js —— 封面裁剪（参考产品 UE 对标 Phase A）
 *
 * 渲染层拖拽裁剪框后，经 IPC cover:crop 调主进程：
 *  - offscreen BrowserWindow 加载原图 → canvas 按 rect 裁剪 → JPEG 编码
 *  - 输出体积 > maxBytes（快手限制 512KB）时二分降质量重编码
 *
 * 纯函数（normalizeRect/computeTargetSize/pickJpegQuality/validateCropPayload）
 * 与 BrowserWindow 裁剪（cropImageFile）分离，纯函数可单测。
 */
const { BrowserWindow } = require('electron')
const path = require('path')
const fs = require('fs')
const os = require('os')
const crypto = require('crypto')
const log = require('./logger')

const JPEG_MIME = 'data:image/jpeg;base64,'

/** 校验 IPC payload（cover:crop） */
function validateCropPayload(payload) {
  if (!payload || typeof payload !== 'object') return { ok: false, error: '缺少参数对象' }
  const { imagePath, rect } = payload
  if (typeof imagePath !== 'string' || !imagePath) return { ok: false, error: 'imagePath 必须为非空字符串' }
  if (!rect || typeof rect !== 'object') return { ok: false, error: 'rect 必须为对象' }
  return { ok: true }
}

/**
 * rect 归一化：校验字段并裁剪到图片边界内。
 * @returns {{ok:boolean, rect?:object, error?:string}}
 */
function normalizeRect(rect, imageWidth, imageHeight) {
  if (!rect || typeof rect !== 'object') return { ok: false, error: 'rect 缺失' }
  const { x, y, width, height } = rect
  if (![x, y, width, height].every((v) => typeof v === 'number' && Number.isFinite(v))) {
    return { ok: false, error: 'rect 字段必须为有限数字' }
  }
  if (width <= 0 || height <= 0) return { ok: false, error: 'rect 宽高必须为正数' }
  const iw = Number(imageWidth) || 0
  const ih = Number(imageHeight) || 0
  if (iw <= 0 || ih <= 0) return { ok: false, error: '图片尺寸无效' }
  const cx = Math.max(0, Math.min(Math.round(x), iw))
  const cy = Math.max(0, Math.min(Math.round(y), ih))
  const cw = Math.max(1, Math.min(Math.round(width), iw - cx))
  const ch = Math.max(1, Math.min(Math.round(height), ih - cy))
  return { ok: true, rect: { x: cx, y: cy, width: cw, height: ch } }
}

/**
 * 目标输出尺寸：outputWidth 等比缩放；不放大；未给则用 rect 原尺寸。
 * @returns {{width:number, height:number}}
 */
function computeTargetSize(rect, imageWidth, imageHeight, outputWidth) {
  const { width, height } = rect
  if (!outputWidth || !Number.isFinite(outputWidth) || outputWidth <= 0 || outputWidth >= width) {
    return { width, height }
  }
  const scale = outputWidth / width
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) }
}

/**
 * JPEG 质量自适应：从 90 向下二分，直到体积 ≤ maxBytes 或达到 minQuality。
 * @param {(quality:number)=>Buffer} encodeFn 按质量编码返回 buffer
 * @param {number} maxBytes 体积上限
 * @param {number} [minQuality=30]
 * @returns {{quality:number, buffer:Buffer, overLimit:boolean}}
 */
function pickJpegQuality(encodeFn, maxBytes, minQuality = 30) {
  let lo = minQuality
  let hi = 90
  let best = { quality: 90, buffer: encodeFn(90), overLimit: false }
  if (best.buffer.length <= maxBytes) return best
  best = { quality: hi, buffer: best.buffer, overLimit: true }
  let iter = 0
  while (lo <= hi && iter < 20) {
    const mid = Math.round((lo + hi) / 2)
    const buf = encodeFn(mid)
    iter++
    if (buf.length <= maxBytes) {
      best = { quality: mid, buffer: buf, overLimit: false }
      lo = mid + 1
    } else {
      hi = mid - 1
    }
  }
  if (best.overLimit) {
    // 最低质量仍超限：返回最低质量（由调用方决定是否接受）
    return { quality: minQuality, buffer: encodeFn(minQuality), overLimit: true }
  }
  return best
}

function buildCropPage(imageDataUrl, rect, targetW, targetH) {
  return '<!DOCTYPE html><html><head><meta charset="utf-8"></head><body>'
    + '<img id="i" style="display:none"></img>'
    + '<canvas id="c"></canvas>'
    + '<scr' + 'ipt>'
    + 'var img=document.getElementById("i"),canvas=document.getElementById("c");'
    + 'var RX=' + rect.x + ',RY=' + rect.y + ',RW=' + rect.width + ',RH=' + rect.height + ';'
    + 'var TW=' + targetW + ',TH=' + targetH + ',Q=' + 90 + ';'
    + 'function encode(q){canvas.width=TW;canvas.height=TH;'
    + 'var ctx=canvas.getContext("2d");ctx.drawImage(img,RX,RY,RW,RH,0,0,TW,TH);'
    + 'return canvas.toDataURL("image/jpeg",q/100);}'
    + 'function run(){return new Promise(function(res,rej){'
    + 'if(img.complete&&img.naturalWidth>0){try{res({w:img.naturalWidth,h:img.naturalHeight})}catch(e){rej(e.message)}return}'
    + 'img.onload=function(){try{res({w:img.naturalWidth,h:img.naturalHeight})}catch(e){rej(e.message)}};'
    + 'img.onerror=function(){rej("image load error")};'
    + 'img.src=' + JSON.stringify(imageDataUrl) + ';});}'
    + 'window.__cp=run();'
    + 'window.__encode=encode;'
    + '</scr' + 'ipt></body></html>'
}

/**
 * 裁剪图片文件（offscreen BrowserWindow + canvas）。
 * @param {string} imagePath 原图路径
 * @param {object} options
 * @param {object} options.rect 裁剪框 {x,y,width,height}
 * @param {number} [options.maxBytes=524288] 输出体积上限（快手 512KB）
 * @param {number} [options.outputWidth] 输出宽度（等比缩放，默认 rect 原宽）
 * @returns {Promise<{ok:boolean, path?:string, sizeBytes?:number, width?:number, height?:number, error?:string}>}
 */
async function cropImageFile(imagePath, options = {}) {
  const { rect, maxBytes = 512 * 1024, outputWidth } = options || {}
  if (!imagePath || !fs.existsSync(imagePath)) {
    return { ok: false, error: '图片文件不存在: ' + imagePath }
  }
  const v = validateCropPayload({ imagePath, rect })
  if (!v.ok) return { ok: false, error: v.error }

  // 读原图信息（复用 extractor 的读取能力：dataURL 形式让 BrowserWindow 加载）
  const read = readImageAsDataUrl(imagePath)
  if (!read.ok) return { ok: false, error: read.error }

  const n = normalizeRect(rect, read.width, read.height)
  if (!n.ok) return { ok: false, error: n.error }
  const nr = n.rect
  const target = computeTargetSize(nr, read.width, read.height, outputWidth)

  const outputDir = path.join(os.tmpdir(), 'multi-publish-crop')
  if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true })
  const hash = crypto.createHash('md5').update(imagePath + JSON.stringify(nr) + target.width + maxBytes).digest('hex').substring(0, 12)
  const outputPath = path.join(outputDir, 'crop-' + hash + '.jpg')

  let win = null
  try {
    win = new BrowserWindow({
      show: false,
      width: Math.max(200, target.width + 100),
      height: Math.max(200, target.height + 100),
      webPreferences: { offscreen: true, nodeIntegration: false, contextIsolation: true, sandbox: true },
    })
    await win.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(buildCropPage(read.dataUrl, nr, target.width, target.height)))
    const imgInfo = await Promise.race([
      win.webContents.executeJavaScript('window.__cp'),
      new Promise((_, rej) => setTimeout(() => rej(new Error('capture timeout')), 30000)),
    ])
    if (!imgInfo || !imgInfo.w || !imgInfo.h) {
      return { ok: false, error: '图片加载失败' }
    }
    const encode = (q) => win.webContents.executeJavaScript('window.__encode(' + q + ')')
      .then((dataUrl) => Buffer.from(String(dataUrl).replace(JPEG_MIME, ''), 'base64'))
    const picked = pickJpegQuality(encode, maxBytes)
    fs.writeFileSync(outputPath, picked.buffer)
    log.info('CoverCropper', 'Crop saved: ' + outputPath + ' (' + picked.buffer.length + ' bytes, q=' + picked.quality + ')')
    return {
      ok: true,
      path: outputPath,
      sizeBytes: picked.buffer.length,
      width: target.width,
      height: target.height,
      overLimit: picked.overLimit,
    }
  } catch (err) {
    log.error('CoverCropper', 'Failed to crop cover: ' + err.message)
    return { ok: false, error: err.message }
  } finally {
    if (win && !win.isDestroyed()) win.destroy()
  }
}

/**
 * 读取图片为 dataURL（渲染层 <img> 直接展示）。
 * @param {string} imagePath
 * @returns {{ok:boolean, dataUrl?:string, width?:number, height?:number, error?:string}}
 */
function readImageAsDataUrl(imagePath) {
  try {
    if (typeof imagePath !== 'string' || !imagePath) return { ok: false, error: 'imagePath 必须为非空字符串' }
    if (!fs.existsSync(imagePath)) return { ok: false, error: '图片文件不存在' }
    const ext = path.extname(imagePath).toLowerCase()
    const mimeMap = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp' }
    const mime = mimeMap[ext]
    if (!mime) return { ok: false, error: '不支持的图片格式: ' + ext }
    const buf = fs.readFileSync(imagePath)
    return { ok: true, dataUrl: 'data:' + mime + ';base64,' + buf.toString('base64'), sizeBytes: buf.length }
  } catch (e) {
    return { ok: false, error: e.message }
  }
}

module.exports = {
  validateCropPayload,
  normalizeRect,
  computeTargetSize,
  pickJpegQuality,
  cropImageFile,
  readImageAsDataUrl,
}