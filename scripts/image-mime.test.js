/**
 * image-mime.test.js — R7 单一真源表自身的行为锁
 *
 * 本文件即 FORMATS 与派生映射的**自动一致性校验**（i3，CCG 020ff510）：改 FORMATS 必须同跑本文件。
 *
 * 锁三件事：
 * ① 映射正确性（jpg/jpeg 同 mime、往返一致）—— 真源表错了，所有换算一起错；
 * ② 「不猜」纪律：未知 ext/mime 返回 null 而不是默认值（宁可失败不把 webp 发成 jpeg）；
 * ③ dataUrl 前缀解析（cover-cropper/extractor 的 dataUrl 链路依赖）。
 */

'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')

const { EXT_TO_MIME, MIME_TO_EXT, LEGACY_MIME_ALIASES, extToMime, mimeToExt, mimeOfDataUrl } = require('./lib/image-mime')

test('映射正确性：jpg 与 jpeg 同 mime（历史四表一致的语义）', () => {
  assert.equal(EXT_TO_MIME['.jpg'], 'image/jpeg')
  assert.equal(EXT_TO_MIME['.jpeg'], 'image/jpeg')
  assert.equal(EXT_TO_MIME['.png'], 'image/png')
  assert.equal(EXT_TO_MIME['.webp'], 'image/webp')
})

test('大小写不敏感 + 无点前缀兼容（调用方传法不一）', () => {
  assert.equal(extToMime('.PNG'), 'image/png')
  assert.equal(extToMime('png'), 'image/png')
  assert.equal(mimeToExt('IMAGE/WEBP'), '.webp')
})

test('往返一致：mimeToExt(extToMime) 回到规范 ext（jpeg 规范化为 jpg）', () => {
  for (const [ext, mime] of Object.entries(EXT_TO_MIME)) {
    assert.equal(mimeToExt(mime) !== null, true, mime + ' 必须可逆')
    assert.equal(extToMime(mimeToExt(mime)), mime)
  }
  // jpeg 规范化：mime→ext 统一给 .jpg（与 media-downloader 落盘口径一致）
  assert.equal(mimeToExt('image/jpeg'), '.jpg')
})

test('「不猜」纪律：未知输入返回 null，绝不返回默认格式', () => {
  assert.equal(extToMime('.avif'), null)
  assert.equal(extToMime('.gif'), null)
  assert.equal(extToMime(''), null)
  assert.equal(extToMime(null), null)
  assert.equal(mimeToExt('image/avif'), null)
  assert.equal(mimeToExt('video/mp4'), null)
  assert.equal(mimeOfDataUrl('data:text/html;base64,AA'), null)
  assert.equal(mimeOfDataUrl('not-a-data-url'), null)
})

test('dataUrl 前缀解析（cover 链路的 dataUrl 形态）', () => {
  assert.equal(mimeOfDataUrl('data:image/jpeg;base64,AA'), 'image/jpeg')
  assert.equal(mimeOfDataUrl('data:image/png;base64,AA'), 'image/png')
})

test('i5：非规范别名在真源显式登记，且归一后仍落规范 ext', () => {
  assert.equal(LEGACY_MIME_ALIASES['image/jpg'], 'image/jpeg', '别名登记必须指向规范 mime')
  assert.equal(mimeToExt(LEGACY_MIME_ALIASES['image/jpg']), '.jpg', '别名归一后与规范路径一致')
  assert.equal(mimeToExt('image/jpg'), null, 'mimeToExt 本体不认非规范 mime（不猜纪律不被别名破坏）')
})


test('R7 结构锁的自检素材：本仓四个历史映射点在真源里都有一致语义', () => {
  // 与四份历史字面量逐项对账（若历史表彼此矛盾，此用例先红）
  assert.equal(extToMime('.jpg'), 'image/jpeg')            // cover-cropper L195
  assert.equal(extToMime('.jpeg'), 'image/jpeg')
  assert.equal(extToMime('.png'), 'image/png')             // prompt-eval/engine L130
  assert.equal(extToMime('.webp'), 'image/webp')
  assert.equal(mimeToExt('image/jpeg'), '.jpg')            // media-downloader L63
  assert.equal(mimeToExt('image/png'), '.png')
  assert.equal(mimeToExt('image/webp'), '.webp')
})
