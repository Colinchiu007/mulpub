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
    it('低于 maxBytes 用高质量 90', () => {
      const fakeEncode = (q) => Buffer.alloc(100 * (q / 90))
      expect(pickJpegQuality(fakeEncode, 1024 * 1024).quality).toBe(90)
    })

    it('超过 maxBytes 时二分压缩到阈值内', () => {
      const fakeEncode = (q) => Buffer.alloc(Math.round(1024 * 1024 * (q / 90)))
      const r = pickJpegQuality(fakeEncode, 512 * 1024)
      expect(r.quality).toBeLessThan(90)
      expect(r.buffer.length).toBeLessThanOrEqual(512 * 1024)
      expect(r.overLimit).toBe(false)
    })

    it('最低质量仍超限时返回最低质量不失败', () => {
      const fakeEncode = () => Buffer.alloc(999999)
      const r = pickJpegQuality(fakeEncode, 512 * 1024)
      expect(r.quality).toBeGreaterThanOrEqual(30)
      expect(r.overLimit).toBe(true)
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

  // ── 阶段 2.1（audit-34）：cover:read-data 的主进程异步化 ──
  // 判据不是"能不能读到"，而是**读的时候事件循环还在不在转**。
  // 行为层只能证语义等价（同形返回 + 同形错误文案），"不阻塞"这一维靠结构锁。
  it('readImageAsDataUrl 返回 Promise（不是同步返回结果对象）', () => {
    const p = cropper.readImageAsDataUrl('Z:/no-such-file.jpg')
    expect(typeof p.then).toBe('function')
    return p
  })

  it('readImageAsDataUrl: 文件不存在 → ok:false 且错误文案沿用「图片文件不存在」', async () => {
    // 文案锁的必要性：原实现靠 existsSync 给这句文案，异步化把它换成"读失败"分支。
    // 若顺手把 e.code 原文透出去，用户看到的将是 `ENOENT: no such file or directory, open 'D:\...'`
    // ——既泄漏本机路径又不可读（AGENTS：内部路径/原始 message 不得直出）。
    const r = await cropper.readImageAsDataUrl('Z:/no-such-file.jpg')
    expect(r.ok).toBe(false)
    expect(r.error).toBe('图片文件不存在')
    expect(String(r.error)).not.toContain('ENOENT')
  })

  it('readImageAsDataUrl: 非图片扩展名返回 ok:false（不碰磁盘）', async () => {
    const r = await cropper.readImageAsDataUrl('Z:/x.txt')
    expect(r.ok).toBe(false)
    expect(r.error).toContain('不支持的图片格式')
  })

  it('readImageAsDataUrl: 真实文件读出 dataURL 与字节数（异步读的正向通路）', async () => {
    // 真实落盘 + os.tmpdir 隔离（AGENTS「文件系统测试隔离」：不写仓库内共享文件）
    const fs = require('node:fs')
    const os = require('node:os')
    const path = require('node:path')
    const dir = path.join(os.tmpdir(), `mp-cover-read-${process.pid}-${Date.now()}`)
    fs.mkdirSync(dir, { recursive: true })
    const file = path.join(dir, 'cover.png')
    const bytes = Buffer.from('89504e470d0a1a0a', 'hex')
    fs.writeFileSync(file, bytes)
    try {
      const r = await cropper.readImageAsDataUrl(file)
      expect(r.ok).toBe(true)
      expect(r.sizeBytes).toBe(bytes.length)
      expect(r.dataUrl.startsWith('data:image/png;base64,')).toBe(true)
      // 精确断言而非 toContain：base64 内容必须与原字节逐字对应
      expect(Buffer.from(r.dataUrl.split(',')[1], 'base64').toString('hex')).toBe('89504e470d0a1a0a')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('结构锁：读取函数体内不得再有同步读原语，handler 必须 await', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/services/cover-cropper.js'), 'utf8')
    const start = src.indexOf('async function readImageAsDataUrl')
    // 锚点缺失 = 异步化被回退，必须红（不得用 indexOf 的 -1 继续切片）
    expect(start, 'readImageAsDataUrl 已不是 async —— 主进程同步读回来了').toBeGreaterThan(-1)
    const end = src.indexOf('\n}', start)
    expect(end, '读取函数收尾锚点缺失').toBeGreaterThan(start)
    const body = src.slice(start, end)
    expect(body).not.toMatch(/readFileSync/)
    expect(body).not.toMatch(/fs\.existsSync/)
    expect(body).toMatch(/await fs\.promises\.readFile/)

    const handler = fs.readFileSync(path.resolve(process.cwd(), 'electron/ipc-handlers/publish.js'), 'utf8')
    expect(handler).toMatch(/await readImageAsDataUrl\(/)
    // 同步调用形态是 `= readImageAsDataUrl(`；`await` 挡在等号与调用之间，故本判据不误伤正向形态
    expect(handler).not.toMatch(/=\s*readImageAsDataUrl\(/)
  })
})