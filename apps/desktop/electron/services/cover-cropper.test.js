// @ts-check
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const {
  normalizeRect,
  computeTargetSize,
  pickJpegQuality,
  validateCropPayload,
} = require('./cover-cropper')

describe('cover-cropper 纯函数', () => {
  describe('normalizeRect', () => {
    it('合法 rect 原样通过', () => {
      const r = normalizeRect({ x: 0, y: 0, width: 100, height: 50 }, 1920, 1080)
      expect(r.ok).toBe(true)
      expect(r.rect).toEqual({ x: 0, y: 0, width: 100, height: 50 })
    })

    it('rect 越界被边界裁剪', () => {
      const r = normalizeRect({ x: -10, y: -5, width: 2000, height: 1200 }, 1920, 1080)
      expect(r.ok).toBe(true)
      expect(r.rect.x).toBe(0)
      expect(r.rect.y).toBe(0)
      expect(r.rect.width).toBe(1920)
      expect(r.rect.height).toBe(1080)
    })

    it('非法 rect（非对象/缺字段/零尺寸）拒绝', () => {
      expect(normalizeRect(null, 100, 100).ok).toBe(false)
      expect(normalizeRect({ x: 0, y: 0 }, 100, 100).ok).toBe(false)
      expect(normalizeRect({ x: 0, y: 0, width: 0, height: 50 }, 100, 100).ok).toBe(false)
      expect(normalizeRect({ x: 0, y: 0, width: 50, height: 0 }, 100, 100).ok).toBe(false)
    })

    it('非数字字段拒绝', () => {
      expect(normalizeRect({ x: 'a', y: 0, width: 50, height: 50 }, 100, 100).ok).toBe(false)
    })
  })

  describe('computeTargetSize', () => {
    it('无 outputWidth 时按原尺寸', () => {
      const r = computeTargetSize({ x: 0, y: 0, width: 400, height: 200 }, 1920, 1080, undefined)
      expect(r.width).toBe(400)
      expect(r.height).toBe(200)
    })

    it('有 outputWidth 时等比缩放', () => {
      const r = computeTargetSize({ x: 0, y: 0, width: 400, height: 200 }, 1920, 1080, 200)
      expect(r.width).toBe(200)
      expect(r.height).toBe(100)
    })

    it('outputWidth 超原宽不放大', () => {
      const r = computeTargetSize({ x: 0, y: 0, width: 400, height: 200 }, 1920, 1080, 800)
      expect(r.width).toBe(400)
      expect(r.height).toBe(200)
    })
  })

  describe('pickJpegQuality', () => {
    it('低于 maxBytes 用高质量 90', async () => {
      const fakeEncode = (q) => Buffer.alloc(100 * (q / 90))
      expect((await pickJpegQuality(fakeEncode, 1024 * 1024)).quality).toBe(90)
    })

    it('超过 maxBytes 时二分压缩到阈值内', async () => {
      const fakeEncode = (q) => Buffer.alloc(Math.round(1024 * 1024 * (q / 90)))
      const r = await pickJpegQuality(fakeEncode, 512 * 1024)
      expect(r.quality).toBeLessThan(90)
      expect(r.buffer.length).toBeLessThanOrEqual(512 * 1024)
      expect(r.overLimit).toBe(false)
    })

    it('最低质量仍超限时返回最低质量不失败', async () => {
      const fakeEncode = () => Buffer.alloc(999999)
      const r = await pickJpegQuality(fakeEncode, 512 * 1024)
      expect(r.quality).toBeGreaterThanOrEqual(30)
      expect(r.overLimit).toBe(true)
    })

    // ⛔ 回归保护（QM-5）：唯一真实消费者 cropImageFile 传的是 async 编码器
    //（webContents.executeJavaScript 返回 Promise）。同步实现下 `promise.length` 是 undefined
    // ⇒ `undefined <= maxBytes` 恒 false ⇒ 一路退到最低质量，最后把一个 Promise 交给
    // fs.writeFileSync（ERR_INVALID_ARG_TYPE）。上面三条同步夹具对这一类缺陷**结构性免疫**，
    // 所以这条必须单独存在。
    it('二分值码器返回 Promise 时不得把 Promise 当 Buffer', async () => {
      const calls = []
      const asyncEncode = (q) => { calls.push(q); return Promise.resolve(Buffer.alloc(Math.round(1024 * 1024 * (q / 90)))) }
      const r = await pickJpegQuality(asyncEncode, 512 * 1024)
      expect(r.overLimit).toBe(false)
      expect(Buffer.isBuffer(r.buffer)).toBe(true)
      expect(r.buffer.length).toBeLessThanOrEqual(512 * 1024)
      expect(calls.length).toBeGreaterThan(1)
    })
  })

  describe('validateCropPayload', () => {
    it('合法 payload 通过', () => {
      const r = validateCropPayload({ imagePath: 'C:/x.jpg', rect: { x: 0, y: 0, width: 100, height: 100 } })
      expect(r.ok).toBe(true)
    })

    it('imagePath 缺失/非字符串拒绝', () => {
      expect(validateCropPayload({ rect: {} }).ok).toBe(false)
      expect(validateCropPayload({ imagePath: 123, rect: {} }).ok).toBe(false)
    })

    it('rect 缺失拒绝', () => {
      expect(validateCropPayload({ imagePath: 'C:/x.jpg' }).ok).toBe(false)
    })
  })
})

describe('cover-cropper IPC 合约（mock 依赖）', () => {
  let cropper
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('./cover-extractor', () => ({ extractVideoCover: vi.fn() }))
    cropper = require('./cover-cropper')
  })
  afterEach(() => {
    vi.resetModules()
  })

  it('cropImageFile: 文件不存在返回 ok:false', async () => {
    const r = await cropper.cropImageFile('Z:/no-such-file.jpg', { rect: { x: 0, y: 0, width: 10, height: 10 } })
    expect(r.ok).toBe(false)
  })

  it('readImageAsDataUrl: 文件不存在返回 ok:false', () => {
    const r = cropper.readImageAsDataUrl('Z:/no-such-file.jpg')
    expect(r.ok).toBe(false)
  })

  it('readImageAsDataUrl: 非图片扩展名返回 ok:false', () => {
    const r = cropper.readImageAsDataUrl('Z:/x.txt')
    expect(r.ok).toBe(false)
  })
})

// ⛔ 回归保护（QM-5，bug: cover:crop 自 PR #1174 起恒返回「图片尺寸无效」）
//
// **根因**：`readImageAsDataUrl()` 只返回 `{dataUrl,sizeBytes}`，从不返回 `width/height`；
// 而 `cropImageFile()` 把 `read.width / read.height` 喂给 `normalizeRect()`，
// `Number(undefined) || 0` 得 0 ⇒ 每一次裁剪都走进「图片尺寸无效」分支。
//
// **为什么四层门禁都没拦住**：既有单测把 `normalizeRect` 当**独立纯函数**测，宽高是测试自己
// 传进去的 1920/1080 —— 那条缝（谁生产 width、谁消费 width）从未被任何用例穿过；
// `cropImageFile` 只测了"文件不存在"这条早退路径。这正是本仓记作「注册≠注入≠生效」的形状。
describe('readImageAsDataUrl ↔ normalizeRect 的接缝（尺寸必须真的流过去）', () => {
  const fs = require('fs')
  const os = require('os')
  const path = require('path')
  // services → electron → desktop → apps → 仓库根（四级，不是三级）
  const repoRoot = path.resolve(__dirname, '..', '..', '..', '..')
  const REAL_PNG = path.join(repoRoot, '01-docs/assets/story2video-scene-context-architecture.png')

  let cropper
  beforeEach(() => {
    vi.resetModules()
    vi.doMock('./cover-extractor', () => ({ extractVideoCover: vi.fn() }))
    cropper = require('./cover-cropper')
  })
  afterEach(() => { vi.resetModules() })

  it('真实 PNG 必须带出 width=512 / height=904（两把独立尺子实测一致）', () => {
    const r = cropper.readImageAsDataUrl(REAL_PNG)
    expect(r.ok).toBe(true)
    expect(r.width).toBe(512)
    expect(r.height).toBe(904)
  })

  it('返回对象的键集必须包含 width/height —— 只测"我调用过 normalizeRect"不构成接缝锁', () => {
    const r = cropper.readImageAsDataUrl(REAL_PNG)
    expect(Object.keys(r).sort()).toEqual(['dataUrl', 'height', 'ok', 'sizeBytes', 'width'])
  })

  it('扩展名是 .png 但字节不是 PNG：报"读不出尺寸"，不得伪装成"图片尺寸无效"', () => {
    const p = path.join(os.tmpdir(), 'mp-crop-junk-' + process.pid + '-' + Date.now() + '.png')
    fs.writeFileSync(p, Buffer.from('definitely-not-a-png-file-body'))
    try {
      const r = cropper.readImageAsDataUrl(p)
      expect(r.ok).toBe(false)
      expect(r.error).toContain('无法解析图片尺寸')
      expect(r.error).toContain('UNRECOGNIZED')
      expect(r.error).not.toBe('图片尺寸无效')
    } finally {
      fs.rmSync(p, { force: true })
    }
  })

  it('cropImageFile 走真实图片时不得再停在「图片尺寸无效」', async () => {
    const r = await cropper.cropImageFile(REAL_PNG, { rect: { x: 0, y: 0, width: 200, height: 100 }, maxBytes: 1024 * 1024 })
    // 适用范围必须与测量域一起写出来：本测试 realm 里的 `electron` 是 test-setup 的替身，
    // `new BrowserWindow()` 不是构造函数，所以这条**只证明"尺寸这一关过了"**，
    // 不证明"真的产出了裁剪字节"（后者要真实 Electron 窗口，属 QM-1 / 手工验收面）。
    // 回归前的失败文案恰好是 '图片尺寸无效'，所以这条对原缺陷是敏感的。
    expect(r.error).not.toBe('图片尺寸无效')
    expect(String(r.error || '')).not.toContain('无法解析图片尺寸')
  })

  it('接缝接线守卫：cropImageFile 必须把 read 的宽高交给 normalizeRect（替身夹具结构性看不见的就是这一行）', () => {
    const src = fs.readFileSync(path.join(__dirname, 'cover-cropper.js'), 'utf8')
    expect(src).toMatch(/normalizeRect\(\s*rect,\s*read\.width,\s*read\.height\s*\)/)
    expect(src).toMatch(/readImageSize\(buf\)/)
    // 调用点必须 await：pickJpegQuality 现在是 async，摘掉 await 会让 `picked.buffer` 变 undefined，
    // 而本 realm 的裁剪在 `new BrowserWindow()` 之前就止步，行为用例抓不到这一格（测量域不覆盖它），
    // 所以由这条接线守卫兜住。
    expect(src).toMatch(/await pickJpegQuality\(/)
  })

  it('尺寸这一关过了以后，normalizeRect 拿到的是正数（数据真的流过，不是"我调用过"）', () => {
    const read = cropper.readImageAsDataUrl(REAL_PNG)
    const n = cropper.normalizeRect({ x: 0, y: 0, width: 200, height: 100 }, read.width, read.height)
    expect(n.ok).toBe(true)
    expect(n.rect).toEqual({ x: 0, y: 0, width: 200, height: 100 })
  })
})