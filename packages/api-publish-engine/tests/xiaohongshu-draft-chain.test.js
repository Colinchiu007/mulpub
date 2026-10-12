// @ts-check
/**
 * 小红书发布链契约测试 —— 图片上传 + 草稿箱存入
 *
 * 端点（2026-10-07 对照参考实现产物逐字核对 + 真机 404 实证后修正）：
 *   1. GET  creator.xiaohongshu.com/api/media/v1/upload/web/permit
 *        ?biz_name=spectrum&scene=image&file_count=1&version=1&source=web
 *        Referer: https://creator.xiaohongshu.com/publish/publish        → { file_id, file_ids, token, upload_addr }
 *        （四个业务参数全在 query 上；用 POST + body 调同一路径会404 —— 2026-10-07 真机实证）
 *   2. PUT  ros-upload.xiaohongshu.com/{file_id}                    → 上传图片二进制
 *   3. POST edith.xiaohongshu.com/web_api/sns/v2/note              → 提交（draft=true 存草稿箱）
 *
 * 认证：Authorization: AT <access-token-creator.xiaohongshu.com> + xhs 签名头
 *
 * 草稿语义：草稿保存在小红书**创作者中心**（服务端），可用草稿列表接口读回 —— 这正是
 * 需求「只需要放在小红书草稿箱」要的语义：内容落到平台侧草稿箱，不公开发布。
 *
 * 与旧实现的关键差异（旧 adapters/xiaohongshu.js 的三处缺陷）：
 *   1. 端点错：打的是 /api/publish（不存在），真实为 web_api/sns/v2/note
 *   2. 签名结构错：{ sign: {X-s,X-t} } 塞进 query ⇒ 序列化成 sign=[object Object]
 *   3. 草稿缺失：无 draft 语义
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { XiaohongshuDraftChain } = require('../src/publish/platforms/xiaohongshu-draft')

describe('xiaohongshu draft chain', () => {
  let calls
  let chain

  beforeEach(() => {
    calls = []
    chain = new XiaohongshuDraftChain({
      http: {
        request: vi.fn(async (cfg) => {
          calls.push({ method: cfg.method, url: cfg.url, headers: cfg.headers, data: cfg.data })
          if (cfg.url.includes('/upload/web/permit')) {
            return { data: { code: 0, data: { file_id: 'F1', token: 'TK1', cos_key: 'k1' } } }
          }
          if (cfg.url.includes('ros-upload')) {
            return { status: 200, data: Buffer.from('ok') }
          }
          if (cfg.url.includes('/web_api/sns/v2/note')) {
            return { data: { code: 0, data: { note_id: 'N123', draft_id: 'D9' } } }
          }
          throw new Error('unexpected url ' + cfg.url)
        }),
      },
      sign: vi.fn(async () => ({
        'x-s': 'XYW_test',
        'x-t': '1700000000000',
        'x-s-common': 'Y3M=',
        'x-b3-traceid': 'a'.repeat(16),
        'x-xray-traceid': 'b'.repeat(32),
      })),
      userAgent: 'UA/1.0',
    })
  })

  it('三步链路顺序正确：permit → ros-upload PUT → note 提交', async () => {
    const out = await chain.publishToDraft({
      title: '测试标题',
      content: '正文内容',
      images: [{ path: 'C:/tmp/cover.png' }],
      draft: true,
      cookie: 'a1=AAAA; web_session=BBBB',
      authorization: 'AT token-value',
      readFile: async () => Buffer.from('fake-image-bytes'),
    })

    expect(calls.map(c => c.method)).toEqual(['GET', 'PUT', 'POST'])
    // permit 路径 + query 形态（query 参数是 404 的直接嫌疑项，必须钉住）
    expect(calls[0].url).toMatch(/\/api\/media\/v1\/upload\/web\/permit\?/)
    expect(calls[0].url).toContain('biz_name=spectrum')
    expect(calls[0].url).toContain('scene=image')
    expect(calls[0].url).toContain('file_count=1')
    expect(calls[0].url).toContain('version=1')
    expect(calls[0].url).toContain('source=web')
    expect(calls[0].headers.referer).toBe('https://creator.xiaohongshu.com/publish/publish')
    // 上传 URL 用平台下发的 uploadAddr + fileIds[0]（拿不到才回落硬编码域）
    expect(calls[1].url).toMatch(/^https:\/\/(ros-upload\.xiaohongshu\.com|[^/]+\.xiaohongshu\.com)\//)
    expect(calls[1].headers['X-Cos-Security-Token']).toBe('TK1') // 与 fixture 的 token 对齐
    expect(calls[2].url).toBe('https://edith.xiaohongshu.com/web_api/sns/v2/note')
    expect(out.success).toBe(true)
    expect(out.visibilityType).toBe(0) // 2026-10-10 形态切换：draft 字段移除，草稿语义=privacy_info.type
    expect(out.noteId).toBe('N123')
  })

  it('签名头必须是独立 header，绝不能塞进 query（旧实现的 [object Object] 缺陷）', async () => {
    await chain.publishToDraft({
      title: 't', content: 'c', images: [{ path: 'C:/tmp/a.png' }],
      draft: true, cookie: 'a1=AAAA', authorization: 'AT tk',
      readFile: async () => Buffer.from('x'),
    })
    const submit = calls[2]
    expect(submit.headers['x-s']).toBe('XYW_test')
    expect(submit.headers['x-t']).toBe('1700000000000')
    expect(submit.headers.Authorization).toBeUndefined() // 2026-10-10 对齐参考产品A：AT 头不发送（跨域半认可触发 code:-1）
    expect(submit.url).not.toMatch(/[?&]sign=/)
    expect(submit.url).not.toContain('%5Bobject')
  })

  it('privacy_info 承担草稿语义（type=1=private，平台无 draft 字段）', async () => {
    await chain.publishToDraft({
      title: 't', content: 'c', images: [{ path: 'C:/tmp/a.png' }],
      visibilityType: 1, cookie: 'a1=AAAA', authorization: 'AT tk',
      readFile: async () => Buffer.from('x'),
    })
    const body = JSON.parse(calls[2].data)
    expect(body.common.privacy_info).toEqual({ op_type: 1, type: 1 })
    expect(body.common.draft).toBeUndefined()
    expect(Array.isArray(body.image_info.images)).toBe(true)
    expect(body.image_info.images[0].file_id).toBe('F1')
    expect(body.image_info.images[0].stickers).toEqual({ floating: [], version: 2 })
  })

  it('正文承载形态：HTML 正文（Quill 富文本）→ note desc 纯文本，不含标签字面量', async () => {
    await chain.publishToDraft({
      title: 't', content: '<p>一段</p><p>二段</p>', images: [{ path: 'C:/tmp/a.png' }],
      draft: true, cookie: 'a1=AAAA', authorization: 'AT tk',
      readFile: async () => Buffer.from('x'),
    })
    const body = JSON.parse(calls[2].data)
    // 小红书笔记描述是纯文本语义：HTML 进描述会以字面量 `<p>` 出现在笔记正文里
    expect(body.common.desc).toBe('一段\n二段')
  })

  it('无图片时 fail-closed：小红书不支持纯文字笔记', async () => {
    // 本链路的入参校验是同步抛出（不返回 rejected Promise）
    await expect(Promise.resolve().then(() => chain.publishToDraft({
      title: 't', content: 'c', images: [],
      draft: true, cookie: 'a1=AAAA', authorization: 'AT tk',
      readFile: async () => Buffer.from('x'),
    }))).rejects.toThrow(/image|图片/i)
  })

  it('缺 a1 时 fail-closed，不得发出请求（2026-10-10：Authorization 头不再发送，缺 AT 不再拦截）', async () => {
    await expect(chain.publishToDraft({
      title: 't', content: 'c', images: [{ path: 'C:/tmp/a.png' }],
      draft: true, cookie: 'web_session=x', authorization: 'AT tk',
      readFile: async () => Buffer.from('x'),
    })).rejects.toThrow(/a1/i)
    expect(calls).toHaveLength(0)
  })

  it('平台返回业务错误码时必须如实抛错（不得当成功）', async () => {
    const bad = new XiaohongshuDraftChain({
      http: {
        request: vi.fn(async (cfg) => {
          if (cfg.url.includes('/upload/web/permit')) return { data: { code: 0, data: { file_id: 'F1', token: 'T' } } }
          return { data: { code: -100, msg: '风控拦截' } }
        }),
      },
      sign: vi.fn(async () => ({ 'x-s': 'XYW_t' })),
      userAgent: 'UA/1.0',
    })
    await expect(bad.publishToDraft({
      title: 't', content: 'c', images: [{ path: 'C:/tmp/a.png' }],
      draft: true, cookie: 'a1=AAAA', authorization: 'AT tk',
      readFile: async () => Buffer.from('x'),
    })).rejects.toThrow(/风控拦截|-100/)
  })
})