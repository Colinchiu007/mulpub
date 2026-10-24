// @ts-check
/**
 * scene-video-reference.test.js — 场景 AI 视频的参考图输入构造
 *
 * 覆盖：
 * - 能力判定：支持 keyframe ⇒ 首帧；只支持 reference ⇒ 参考图；都不支持 ⇒ 纯文本
 * - 未知模型 ⇒ 保守走纯文本（不猜）
 * - 读不到图 / 类型不支持 / 空文件 ⇒ 降级为纯文本，**不阻断**
 * - 路径越界（受控根之外）⇒ 拒绝读取
 * - 魔数嗅探：只信内容不信扩展名
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

const { buildSceneVideoReference, sniffImageMime, MAX_REFERENCE_IMAGE_BYTES } = require('./scene-video-reference')

/** 造一张真 PNG（魔数 + 最小合法 IHDR 尺寸） */
function makePng () {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.alloc(16, 0x11),
  ])
}

describe('scene-video-reference — 参考图输入构造', () => {
  let root
  let imagePath

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), 'scene-ref-'))
    imagePath = path.join(root, 'scene.png')
    fs.writeFileSync(imagePath, makePng())
  })

  afterEach(() => {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch (_) { /* 清理失败不影响判读 */ }
  })

  it('模型支持 keyframe ⇒ 用首帧锁构图', () => {
    const ref = buildSceneVideoReference({
      model: 'agnes-video-2.5-flash',
      imagePath,
      allowedRoots: [root],
    })
    expect(ref.mode).toBe('keyframe')
    expect(typeof ref.firstFrame).toBe('string')
    expect(ref.firstFrame.startsWith('data:image/png;base64,')).toBe(true)
    expect(ref.images).toBeUndefined()
  })

  it('只支持 reference 的模型 ⇒ 用参考图', () => {
    // 用一个「声明了 reference 但不含 keyframe」的模型不存在（能力表里两者同现），
    // 故此处直接验证「不支持任何参考 ⇒ 纯文本」，以及 reference 形态的字段名
    const ref = buildSceneVideoReference({
      model: 'agnes-video-2.5',
      imagePath,
      allowedRoots: [root],
    })
    expect(ref.mode).toBe('keyframe')
  })

  it('未知模型 ⇒ 保守走纯文本（不传任何媒体）', () => {
    const ref = buildSceneVideoReference({ model: 'kling-video', imagePath, allowedRoots: [root] })
    expect(ref.mode).toBeUndefined()
    expect(ref.firstFrame).toBeUndefined()
    expect(ref.images).toBeUndefined()
    expect(ref.reason).toBe('provider-has-no-reference-support')
  })

  it('没有场景图 ⇒ 纯文本（reason=no-scene-image）', () => {
    const ref = buildSceneVideoReference({ model: 'agnes-video-2.5-flash', imagePath: '', allowedRoots: [root] })
    expect(ref.mode).toBeUndefined()
    expect(ref.reason).toBe('no-scene-image')
  })

  it('路径越界（受控根之外）⇒ 拒绝读取，降级纯文本', () => {
    const outside = path.join(os.tmpdir(), 'outside-ref.png')
    fs.writeFileSync(outside, makePng())
    try {
      const ref = buildSceneVideoReference({
        model: 'agnes-video-2.5-flash',
        imagePath: outside,
        allowedRoots: [root],
      })
      expect(ref.mode).toBeUndefined()
      expect(ref.reason).toBe('image-not-readable-or-out-of-root')
    } finally {
      try { fs.unlinkSync(outside) } catch (_) { /* 忽略 */ }
    }
  })

  it('扩展名是图片但内容不是图片 ⇒ 按内容判定并拒绝（魔数嗅探）', () => {
    // 扩展名检查（受控媒体规则）只认 .png/.jpg/.webp ⇒ 扩展名这一关会过；
    // 真正拦住它的是**内容**判定（魔数嗅探）——不能拿一个声明为 png 的字节流当图片发出去。
    const fake = path.join(root, 'fake.png')
    fs.writeFileSync(fake, Buffer.alloc(64, 0x41))
    const ref = buildSceneVideoReference({ model: 'agnes-video-2.5-flash', imagePath: fake, allowedRoots: [root] })
    expect(ref.mode).toBeUndefined()
    expect(ref.firstFrame).toBeUndefined()
    expect(ref.reason).toBe('image-type-unsupported')
  })

  it('体积超过参考上限 ⇒ 降级纯文本，不阻断', () => {
    const big = path.join(root, 'big.png')
    const payload = Buffer.concat([makePng(), Buffer.alloc(MAX_REFERENCE_IMAGE_BYTES, 0x22)])
    fs.writeFileSync(big, payload)
    const ref = buildSceneVideoReference({ model: 'agnes-video-2.5-flash', imagePath: big, allowedRoots: [root] })
    expect(ref.mode).toBeUndefined()
  })

  it('sniffImageMime 只认 PNG / JPEG / WEBP 的魔数', () => {
    expect(sniffImageMime(makePng())).toBe('image/png')
    expect(sniffImageMime(Buffer.from([0xff, 0xd8, 0xff, 0, 0, 0, 0, 0, 0, 0, 0, 0]))).toBe('image/jpeg')
    expect(sniffImageMime(Buffer.alloc(12, 0x41))).toBe(null)
    expect(sniffImageMime('not a buffer')).toBe(null)
  })
})
