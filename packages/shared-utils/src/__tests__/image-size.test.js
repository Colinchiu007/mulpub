// @ts-check
/**
 * image-size.test.js — 从图片字节头解析宽高（零依赖）的回归锁
 *
 * ## 为什么存在
 * `cover-cropper.js` 的 `readImageAsDataUrl()` 只返回 `{dataUrl,sizeBytes}`，**从不返回 width/height**，
 * 而 `cropImageFile()` 把 `read.width / read.height` 喂给 `normalizeRect()` ⇒ 恒为 0 ⇒ 恒返回
 * 「图片尺寸无效」。该功能自 PR #1174 起从未真正可用。
 *
 * ## 夹具的真值从哪来（全部当场实测，不是猜）
 * - PNG  `01-docs/assets/story2video-scene-context-architecture.png` = 512x904
 *   —— 两把独立尺子一致：`[System.Drawing.Image]::FromFile(...)` = 512x904，
 *   `require('sharp')(path).metadata()` = 512x904。
 * - JPEG `apps/desktop/src/assets/pipeline-card-bg/animated-explainer.jpg` = 1024x576
 *   —— 同样两把尺子一致（System.Drawing 与 sharp）。
 * - WebP `apps/desktop/electron/film-kit/images/char_1.webp` = 512x286、
 *   `scene_1.webp` = 512x219 —— **只有 sharp 一把尺子**（本机 System.Drawing 无 webp 编解码器）。
 *   单尺子在列，不假装是双尺子：WebP 的真值另由逐字节手写的规范夹具（下节）交叉。
 *
 * ## 规范夹具（合成，字节布局按规范逐字节写出）
 * VP8L（无损）与 VP8X（扩展画布）在本仓没有真实文件，按 WebP 容器规范手工构造，
 * 用来覆盖"只有真文件才会显形"之外的另外两条分支。
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import { readImageSize, describeImageSizeError } from '../image-size.js'

const here = path.dirname(fileURLToPath(import.meta.url))
const repo = path.resolve(here, '..', '..', '..', '..')
const real = (rel) => fs.readFileSync(path.join(repo, rel))

/** 按 WebP 容器规范拼 chunk：FourCC + 4 字节 LE 长度 + 载荷（奇数长度补一个填充字节） */
function webp (fourcc, payload) {
  const size = Buffer.alloc(4)
  size.writeUInt32LE(payload.length, 0)
  const pad = payload.length % 2 ? Buffer.from([0]) : Buffer.alloc(0)
  return Buffer.concat([
    Buffer.from('RIFF', 'ascii'), Buffer.alloc(4), Buffer.from('WEBP', 'ascii'),
    Buffer.from(fourcc, 'ascii'), size, payload, pad,
  ])
}

describe('readImageSize：真实文件（值来自当场实测的两把/一把尺子）', () => {
  it('PNG 512x904（System.Drawing 与 sharp 一致）', () => {
    expect(readImageSize(real('01-docs/assets/story2video-scene-context-architecture.png')))
      .toEqual({ width: 512, height: 904 })
  })

  it('JPEG 1024x576（System.Drawing 与 sharp 一致）', () => {
    expect(readImageSize(real('apps/desktop/src/assets/pipeline-card-bg/animated-explainer.jpg')))
      .toEqual({ width: 1024, height: 576 })
  })

  it('WebP 有损 512x286 与 512x219（sharp 实测；本仓无 webp 解码器可作第二把尺子）', () => {
    expect(readImageSize(real('apps/desktop/electron/film-kit/images/char_1.webp'))).toEqual({ width: 512, height: 286 })
    expect(readImageSize(real('apps/desktop/electron/film-kit/images/scene_1.webp'))).toEqual({ width: 512, height: 219 })
  })

  it('两张不同尺寸的图必须给出不同的读数（夹具若对所有输入同形，"按输入区分"这一类缺陷对它免疫）', () => {
    const a = readImageSize(real('apps/desktop/electron/film-kit/images/char_1.webp'))
    const b = readImageSize(real('apps/desktop/electron/film-kit/images/scene_1.webp'))
    expect(a.height).not.toBe(b.height)
  })
})

describe('readImageSize：PNG', () => {
  it('签名 + IHDR 的前两个 4 字节 BE 是宽与高', () => {
    const b = Buffer.alloc(24)
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(b, 0)
    b.writeUInt32BE(13, 8)
    b.write('IHDR', 12, 'ascii')
    b.writeUInt32BE(640, 16)
    b.writeUInt32BE(480, 20)
    expect(readImageSize(b)).toEqual({ width: 640, height: 480 })
  })

  it('非 PNG 签名返回 null（不猜）', () => {
    expect(readImageSize(Buffer.from('not an image at all'))).toBeNull()
  })
})

describe('readImageSize：JPEG 段结构', () => {
  /** 造一张 SOI + APP1(EXIF 里塞一个"缩略图 SOF0") + SOF0(主图) + EOI 的假 JPEG */
  function jpegWithThumbnail (thumbW, thumbH, mainW, mainH) {
    const sof = (w, h) => Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, (h >> 8) & 0xff, h & 0xff, (w >> 8) & 0xff, w & 0xff, 3, 1, 0x11, 0, 2, 0x11, 1, 3, 0x11, 1])
    // 段长度字段**含其自身 2 字节**（JPEG 规范）。第一版这里写成 payload 长度，判据当场把我
    // 自己的夹具判红而不是判主图 —— 夹具不合法时"解析失败"读起来和"判据坏了"一模一样。
    const app1Payload = sof(thumbW, thumbH)
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, ((app1Payload.length + 2) >> 8) & 0xff, (app1Payload.length + 2) & 0xff]), app1Payload])
    return Buffer.concat([Buffer.from([0xff, 0xd8]), app1, sof(mainW, mainH), Buffer.from([0xff, 0xd9])])
  }

  it('EXIF 缩略图里的 SOF 不得被当成主图尺寸', () => {
    expect(readImageSize(jpegWithThumbnail(160, 120, 1920, 1080))).toEqual({ width: 1920, height: 1080 })
  })

  it('没有 SOF 的裸流返回 null 而不是 {width:0}', () => {
    expect(readImageSize(Buffer.from([0xff, 0xd8, 0xff, 0xd9]))).toBeNull()
  })
})

describe('readImageSize：WebP 三种帧头', () => {
  it('VP8（有损）：同 9d 01 2a 之后两个 14 位小端量', () => {
    const payload = Buffer.alloc(14)
    payload.writeUInt8(0x30, 0) // keyframe flag（bit0=0）
    payload.writeUInt8(0x01, 1)
    payload.writeUInt8(0x0a, 2)
    payload.writeUInt8(0x9d, 3); payload.writeUInt8(0x01, 4); payload.writeUInt8(0x2a, 5)
    payload.writeUInt16LE(300 & 0x3fff, 6)
    payload.writeUInt16LE(200 & 0x3fff, 8)
    expect(readImageSize(webp('VP8 ', payload))).toEqual({ width: 300, height: 200 })
  })

  it('VP8L（无损）：签名 0x30 后 14+14 位是"减一"值', () => {
    const payload = Buffer.alloc(6)
    payload.writeUInt8(0x30, 0)
    payload.writeUInt32LE(((1023 & 0x3fff)) | ((4095 & 0x3fff) << 14), 1)
    expect(readImageSize(webp('VP8L', payload))).toEqual({ width: 1024, height: 4096 })
  })

  it('VP8X（扩展画布）：3 字节小端"减一"，且必须优先于后续帧', () => {
    const vp8x = Buffer.alloc(10)
    vp8x.writeUInt8(0, 0)
    vp8x.writeUIntLE(1023, 4, 3)
    vp8x.writeUIntLE(767, 7, 3)
    const inner = Buffer.alloc(14)
    inner.writeUInt8(0x30, 0); inner.writeUInt8(0x01, 1); inner.writeUInt8(0x0a, 2)
    inner.writeUInt8(0x9d, 3); inner.writeUInt8(0x01, 4); inner.writeUInt8(0x2a, 5)
    inner.writeUInt16LE(64, 6); inner.writeUInt16LE(64, 8)
    const doc = webp('VP8X', vp8x)
    const frame = Buffer.concat([Buffer.from('VP8 ', 'ascii'), (() => { const s = Buffer.alloc(4); s.writeUInt32LE(inner.length, 0); return s })(), inner])
    expect(readImageSize(Buffer.concat([doc.subarray(0, doc.length), frame]))).toEqual({ width: 1024, height: 768 })
  })
})

describe('describeImageSizeError：三分支必须可区分（排障者不该去找一个不存在的"未登录"原因）', () => {
  it('空 buffer / 太短 / 解析不出是三件不同的事', () => {
    expect(describeImageSizeError(null)).toBe('EMPTY')
    expect(describeImageSizeError(Buffer.alloc(4))).toBe('TOO_SHORT')
    expect(describeImageSizeError(Buffer.from('nope-nope-nope-nope'))).toBe('UNRECOGNIZED')
    expect(describeImageSizeError(real('apps/desktop/src/assets/pipeline-card-bg/animated-explainer.jpg'))).toBe('OK')
  })
})
