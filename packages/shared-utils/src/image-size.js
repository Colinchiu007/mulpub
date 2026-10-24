/**
 * image-size.js — 从图片字节头解析宽高（零依赖、无副作用、单一实现）
 *
 * ## 为什么存在（QM-5 回归保护）
 * `apps/desktop/electron/services/cover-cropper.js` 的 `readImageAsDataUrl()` 只返回
 * `{dataUrl, sizeBytes}`，**从不返回 width/height**，而 `cropImageFile()` 把
 * `read.width / read.height` 喂给 `normalizeRect()` —— `Number(undefined) || 0` 得 0，
 * 于是每一次封面裁剪都返回「图片尺寸无效」。该功能自 PR #1174 起从未真正可用。
 *
 * ## 为什么不用 sharp
 * sharp **不在** `apps/desktop/package.json` 的 dependencies 里（只在
 * `.cover-rasterize-worker.js` 里以传递依赖被用到）。给它新增一条生产依赖边，
 * 代价是打包体积与「生产依赖闭包」门禁的连锁；而尺寸只是头里的几个字节。
 *
 * ## 三条不显然的口径（都有现场理由）
 *  ① **JPEG 按段结构走，绝不"扫第一个 SOF"**：EXIF（APP1）里可以塞一张缩略图，
 *     而缩略图自己就带 SOF0。朴素扫描会把 160x120 的缩略图当成主图尺寸——裁剪框按主图
 *     坐标归一化却被缩略图尺寸夹住，结果是静默裁错而不是报错。正解是读段长度整段跳过 APPn。
 *  ② **WebP 的 VP8X 优先于后续帧**：VP8X 给的是画布尺寸，动画帧给的是单帧尺寸；
 *     归一化裁剪框要的是画布。
 *  ③ **解析不出就返回 null，不猜、不给 0**。`{width:0}` 与 `null` 的区别是本条的全部意义：
 *     0 会被上游 `Number(x) || 0` 的判据读成"尺寸无效"，把"我的解析器不认识这种文件"
 *     伪装成"用户的图片坏了"（正是原 Bug 的形态）。`describeImageSizeError` 把
 *     EMPTY / TOO_SHORT / UNRECOGNIZED 三种原因分开出声。
 *
 * 支持格式与 `image-mime.js` 的登记表一致：JPEG / PNG / WebP（GIF 不在登记表内，故不实现）。
 */

'use strict'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]

/** PNG：签名 + IHDR，宽高是 IHDR 数据段前两个 4 字节大端量（固定偏移 16 / 20）。 */
function readPng (buf) {
  if (buf.length < 24) return null
  for (let i = 0; i < 8; i++) if (buf[i] !== PNG_SIGNATURE[i]) return null
  if (buf.toString('ascii', 12, 16) !== 'IHDR') return null
  return { width: buf.readUInt32BE(16), height: buf.readUInt32BE(20) }
}

/** JPEG 无长度字段的独立标记：SOI/EOI、TEMP 0x01、RST0-RST7 0xD0-0xD7。 */
function isJpegStandalone (marker) {
  return marker === 0x01 || marker === 0xd8 || marker === 0xd9 || (marker >= 0xd0 && marker <= 0xd7)
}

/** SOF 标记区间 0xC0-0xCF，扣掉 DHT(0xC4) / JPG(0xC8) / DAC(0xCC) 三个非 SOF。 */
function isJpegSof (marker) {
  return marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc
}

/**
 * JPEG：**按段结构**遍历，只在段边界上判断标记。
 * 走进段载荷里找 SOF 会把 EXIF 缩略图的尺寸当主图（见文件头口径 ①）。
 */
function readJpeg (buf) {
  if (buf.length < 4 || buf[0] !== 0xff || buf[1] !== 0xd8) return null
  let i = 2
  while (i + 1 < buf.length) {
    if (buf[i] !== 0xff) return null // 段结构已经断了
    while (i < buf.length && buf[i] === 0xff) i++ // 填充字节
    if (i >= buf.length) return null
    const marker = buf[i]
    i++
    if (marker === 0xda) return null // SOS：压缩数据开始，之后不该再按段解析
    if (isJpegStandalone(marker)) continue
    if (i + 2 > buf.length) return null
    const segLen = buf.readUInt16BE(i)
    if (isJpegSof(marker)) {
      // 段长度字段之后：1 字节精度、2 字节高、2 字节宽
      if (segLen < 8 || i + 7 >= buf.length) return null
      return { width: buf.readUInt16BE(i + 5), height: buf.readUInt16BE(i + 3) }
    }
    i += segLen // 整段跳过（APPn 里有什么都不看）
  }
  return null
}

/** WebP：VP8 有损帧（keyframe 同步码 0x9d 0x01 0x2a 后各一个 14 位小端量）。 */
function readWebpLossy (buf, ps) {
  if (ps + 10 > buf.length) return null
  if (buf[ps + 3] !== 0x9d || buf[ps + 4] !== 0x01 || buf[ps + 5] !== 0x2a) return null
  return { width: buf.readUInt16LE(ps + 6) & 0x3fff, height: buf.readUInt16LE(ps + 8) & 0x3fff }
}

/** WebP：VP8L 无损（签名 0x30 之后 32 位 = 14 位宽减一 + 14 位高减一 + 1 位 alpha + 3 位版本）。 */
function readWebpLossless (buf, ps) {
  if (ps + 5 > buf.length) return null
  if (buf[ps] !== 0x30) return null
  const v = buf.readUInt32LE(ps + 1)
  return { width: (v & 0x3fff) + 1, height: ((v >>> 14) & 0x3fff) + 1 }
}

/** WebP：VP8X 扩展画布（1 字节标志 + 3 保留 + 两个 3 字节小端"减一"）。 */
function readWebpExtended (buf, ps) {
  if (ps + 10 > buf.length) return null
  return { width: buf.readUIntLE(ps + 4, 3) + 1, height: buf.readUIntLE(ps + 7, 3) + 1 }
}

/** WebP：RIFF 容器逐 chunk 走；VP8X 优先于帧（口径 ②）。 */
function readWebp (buf) {
  if (buf.length < 12) return null
  if (buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WEBP') return null
  let p = 12
  while (p + 8 <= buf.length) {
    const fourcc = buf.toString('ascii', p, p + 4)
    const size = buf.readUInt32LE(p + 4)
    const ps = p + 8
    if (!Number.isFinite(size) || size < 0 || ps + size > buf.length) return null
    if (fourcc === 'VP8X') { const r = readWebpExtended(buf, ps); if (r) return r }
    if (fourcc === 'VP8 ') { const r = readWebpLossy(buf, ps); if (r) return r }
    if (fourcc === 'VP8L') { const r = readWebpLossless(buf, ps); if (r) return r }
    p = ps + size + (size % 2) // chunk 按 2 字节对齐
  }
  return null
}

/**
 * 解析图片宽高。
 * @param {Buffer|null|undefined} buffer 图片原始字节（不需要整文件，头部足够；但传整份最稳）
 * @returns {{width:number, height:number}|null} 不认识 / 结构断裂 / 尺寸为 0 都返回 null
 */
function readImageSize (buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return null
  const guess = (buffer.length >= 8 && buffer[0] === PNG_SIGNATURE[0] && buffer[1] === 0x50)
    ? readPng(buffer)
    : (buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8)
        ? readJpeg(buffer)
        : (buffer.length >= 12 && buffer.toString('ascii', 0, 4) === 'RIFF')
            ? readWebp(buffer)
            : null
  if (!guess) return null
  if (!Number.isFinite(guess.width) || !Number.isFinite(guess.height) || guess.width <= 0 || guess.height <= 0) return null
  return { width: guess.width, height: guess.height }
}

/**
 * 把"为什么没解析出来"分成三件可区分的事（不得合并成一句"尺寸无效"）。
 * @param {Buffer|null|undefined} buffer
 * @returns {'OK'|'EMPTY'|'TOO_SHORT'|'UNRECOGNIZED'}
 */
function describeImageSizeError (buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) return 'EMPTY'
  if (buffer.length < 12) return 'TOO_SHORT'
  return readImageSize(buffer) ? 'OK' : 'UNRECOGNIZED'
}

module.exports = {
  readImageSize,
  describeImageSizeError,
}
