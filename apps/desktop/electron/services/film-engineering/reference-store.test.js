// @ts-check
/**
 * reference-store 单元测试（影视工程画布 - 参考图喂给生成）
 * 覆盖：魔数嗅探 / dataURL 解码 / 大小上限 / 落盘往返 / 客户端 mime 不可信 / 路径安全 / 写入失败隔离
 */
import { describe, it, expect, vi } from 'vitest'
import nodeFs from 'node:fs'
import nodeOs from 'node:os'
import nodePath from 'node:path'
import { saveReference, sniffImageType, decodeDataUrl, MAX_REF_BYTES } from './reference-store'

// 1x1 合法 PNG
const PNG_1PX = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
)
// 最小 JPEG 魔数头（FF D8 FF + JFIF APP0）
const JPEG_MIN = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01])
// 最小 WEBP（RIFF....WEBPVP8 ）
const WEBP_MIN = Buffer.concat([
  Buffer.from('RIFF', 'ascii'), Buffer.from([0x0a, 0x00, 0x00, 0x00]), Buffer.from('WEBPVP8 ', 'ascii'),
])
// GIF（白名单外格式）
const GIF_MIN = Buffer.concat([Buffer.from('GIF89a', 'ascii'), Buffer.from([0x01, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00])])

function b64DataUrl (buf, mime) {
  return 'data:' + (mime || 'application/octet-stream') + ';base64,' + buf.toString('base64')
}

function tmpMediaRoot () {
  return nodePath.join(
    nodeOs.tmpdir(),
    'film-ref-test-' + Date.now() + '-' + Math.random().toString(36).slice(2),
  )
}

describe('sniffImageType 魔数嗅探', () => {
  it('识别 PNG / JPEG / WEBP', () => {
    expect(sniffImageType(PNG_1PX)).toEqual({ ext: 'png', mime: 'image/png' })
    expect(sniffImageType(JPEG_MIN)).toEqual({ ext: 'jpg', mime: 'image/jpeg' })
    expect(sniffImageType(WEBP_MIN)).toEqual({ ext: 'webp', mime: 'image/webp' })
  })

  it('白名单外格式与过短缓冲返回 null', () => {
    expect(sniffImageType(GIF_MIN)).toBeNull()
    expect(sniffImageType(Buffer.from('MZ\u0090\u0000fake-exe-content!!'))).toBeNull()
    expect(sniffImageType(Buffer.from([0x89, 0x50]))).toBeNull()
    expect(sniffImageType(null)).toBeNull()
    expect(sniffImageType('not-a-buffer')).toBeNull()
  })
})

describe('decodeDataUrl 解码', () => {
  it('base64 dataURL 正常解码', () => {
    const r = decodeDataUrl(b64DataUrl(PNG_1PX, 'image/png'))
    expect(r.error).toBeUndefined()
    expect(r.buffer.equals(PNG_1PX)).toBe(true)
  })

  it('percent-encoded（非 base64）dataURL 可解码', () => {
    const r = decodeDataUrl('data:text/plain,hello%20world')
    expect(r.error).toBeUndefined()
    expect(r.buffer.toString('utf8')).toBe('hello world')
  })

  it('非 dataURL 字符串与非法输入返回错误', () => {
    expect(decodeDataUrl('http://evil/x.png').error).toMatch(/dataURL/)
    expect(decodeDataUrl(undefined).error).toMatch(/字符串/)
    expect(decodeDataUrl('data:image/png;base64,').error).toMatch(/空/)
  })
})

describe('saveReference 落盘', () => {
  it('PNG 落盘成功：服务端生成文件名、位于媒体根 references/ 下、字节一致', async () => {
    const root = tmpMediaRoot()
    const r = await saveReference({ mediaRoot: root, dataUrl: b64DataUrl(PNG_1PX, 'image/png') })
    try {
      expect(r.ok).toBe(true)
      expect(r.fileName).toMatch(/^ref-[0-9a-f]{16}\.png$/)
      expect(nodePath.dirname(r.path)).toBe(nodePath.join(root, 'references'))
      expect(r.bytes).toBe(PNG_1PX.length)
      expect(r.mime).toBe('image/png')
      expect(nodeFs.readFileSync(r.path).equals(PNG_1PX)).toBe(true)
    } finally {
      nodeFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('客户端声明 mime 与内容魔数不符时按魔数判定（伪装 png 的 GIF 被拒）', async () => {
    const root = tmpMediaRoot()
    const r = await saveReference({ mediaRoot: root, dataUrl: b64DataUrl(GIF_MIN, 'image/png') })
    expect(r.ok).toBeFalsy()
    expect(r.error).toMatch(/PNG|JPEG|WEBP/)
    expect(nodeFs.existsSync(nodePath.join(root, 'references'))).toBe(false)
  })

  it('超过 10MB 上限被拒', async () => {
    const big = Buffer.concat([PNG_1PX, Buffer.alloc(MAX_REF_BYTES - PNG_1PX.length + 1)])
    const r = await saveReference({ mediaRoot: tmpMediaRoot(), dataUrl: b64DataUrl(big, 'image/png') })
    expect(r.ok).toBeFalsy()
    expect(r.error).toMatch(/10MB/)
  })

  it('mediaRoot 缺失 / dataUrl 非法均 fail closed', async () => {
    expect((await saveReference({ mediaRoot: '', dataUrl: b64DataUrl(PNG_1PX) })).ok).toBeFalsy()
    const r2 = await saveReference({ mediaRoot: tmpMediaRoot(), dataUrl: 'javascript:alert(1)' })
    expect(r2.ok).toBeFalsy()
    const r3 = await saveReference({})
    expect(r3.ok).toBeFalsy()
  })

  it('两次上传生成不同文件名（随机不覆盖）', async () => {
    const root = tmpMediaRoot()
    const a = await saveReference({ mediaRoot: root, dataUrl: b64DataUrl(PNG_1PX, 'image/png') })
    const b = await saveReference({ mediaRoot: root, dataUrl: b64DataUrl(PNG_1PX, 'image/png') })
    try {
      expect(a.ok).toBe(true)
      expect(b.ok).toBe(true)
      expect(a.fileName).not.toBe(b.fileName)
    } finally {
      nodeFs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('fs 写入异常被隔离为 {ok:false}，不抛出', async () => {
    const fsImpl = {
      mkdirSync: vi.fn(),
      writeFileSync: vi.fn(() => { throw new Error('ENOSPC: no space left') }),
    }
    const r = await saveReference({ mediaRoot: '/tmp/any', dataUrl: b64DataUrl(PNG_1PX, 'image/png'), fsImpl })
    expect(r.ok).toBe(false)
    expect(r.error).toMatch(/写入失败/)
  })
})
