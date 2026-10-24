import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

/**
 * 飞影「辅助与作品管理」端点测试（change: hifly-full-api）。
 *
 * 覆盖 5 个此前未实现的端点：
 *   GET    /account/credit          查询账户积分（免费）
 *   GET    /video/lively_templates  查询网感模板列表（免费）
 *   GET    /project/cover_styles    查询封面模板列表（免费）
 *   POST   /project/covers          创建封面（**免费**，与其它创作端点不同）
 *   DELETE /video/task              删除作品（免费，且仅限普通视频创作任务）
 *
 * 为什么单独一个文件：hifly.js 已 465 行（max-lines 硬线 500），
 * 新端点必须落独立 mixin；测试同型拆分。
 */

const { HiFlyAdapter } = require('./hifly.js')
const { ProviderError, ERROR_CODES } = require('./_base/provider-error')

const BASE = 'https://hfw-api.hifly.cc/api/v2/hifly'
const TOKEN = 'test-token'

function createFetchResponse (body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  }
}

function createFetchMock (responses = []) {
  const calls = []
  const fn = vi.fn(async (url, opts = {}) => {
    calls.push({ url: String(url), opts })
    const next = responses.shift()
    if (!next) return createFetchResponse({ code: 0 })
    return next
  })
  fn.calls = calls
  return fn
}

function createAdapter (extra = {}) {
  return new HiFlyAdapter({ id: 'hifly', apiKey: TOKEN, ...extra })
}

let originalFetch
beforeEach(() => { originalFetch = global.fetch })
afterEach(() => { global.fetch = originalFetch })

// ── 查询账户积分 ────────────────────────────────────────────────────────
describe('getAccountCredit — 查询账户积分（change: hifly-full-api）', () => {
  // 官方响应：{ code, message, left, request_id }。真实调用核对过 left=1582。
  it('读取 left 作为积分余额', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, left: 1582 })])
    const r = await createAdapter().getAccountCredit()
    expect(r).toEqual({ left: 1582 })
    expect(global.fetch.calls[0].url).toBe(`${BASE}/account/credit`)
    expect(global.fetch.calls[0].opts.method).toBe('GET')
  })

  // 余额缺失或非有限数 ⇒ 报错而不是返回 0/NaN（0 会被 UI 读成「没积分了」）
  it('left 缺失或非有限数 ⇒ PROVIDER_ERROR', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0 })])
    await expect(createAdapter().getAccountCredit()).rejects.toThrow(/left/)
  })

  it('left 为负或非整数 ⇒ PROVIDER_ERROR（不把脏读数当余额）', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, left: -5 })])
    await expect(createAdapter().getAccountCredit()).rejects.toThrow(/left/)
    global.fetch = createFetchMock([createFetchResponse({ code: 0, left: 1.5 })])
    await expect(createAdapter().getAccountCredit()).rejects.toThrow(/left/)
  })

  it('业务 code 非 0 ⇒ PROVIDER_ERROR', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 11, message: 'Token 无效' })])
    try {
      await createAdapter().getAccountCredit()
      expect.fail('Should throw')
    } catch (e) {
      expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
      expect(e.message).toContain('Token 无效')
    }
  })
})

// ── 查询网感模板列表 ────────────────────────────────────────────────────
describe('listLivelyTemplates — 查询网感模板列表（change: hifly-full-api）', () => {
  it('分页与筛选参数透传（type 默认 0 竖屏）', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, data: [] })])
    await createAdapter().listLivelyTemplates({ page: 2, size: 50, tag: '口播', type: 1 })
    const url = global.fetch.calls[0].url
    expect(url).toContain('/video/lively_templates')
    expect(url).toContain('page=2')
    expect(url).toContain('size=50')
    expect(url).toContain('type=1')
  })

  // 官方：size 默认 20，最大 200；type 0~3
  it('size > 200 ⇒ INVALID_CONFIG，不发请求', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().listLivelyTemplates({ size: 201 })).rejects.toThrow(/size/)
    expect(m).not.toHaveBeenCalled()
  })

  it('type 超出 0~3 ⇒ INVALID_CONFIG，不发请求', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().listLivelyTemplates({ type: 4 })).rejects.toThrow(/type/)
    expect(m).not.toHaveBeenCalled()
  })

  it('page < 1 ⇒ INVALID_CONFIG，不发请求', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().listLivelyTemplates({ page: 0 })).rejects.toThrow(/page/)
    expect(m).not.toHaveBeenCalled()
  })

  // 真实响应形态未核对（本轮未花积分调用），按官方文档 data 为数组。
  // 若服务端返回非数组，宁可报错也不要静默返回空列表（那会被读成「没有模板」）。
  it('data 非数组 ⇒ PROVIDER_ERROR', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, data: { a: 1 } })])
    await expect(createAdapter().listLivelyTemplates({})).rejects.toThrow(/data/)
  })
})

// ── 查询封面模板列表 ────────────────────────────────────────────────────
describe('listCoverStyles — 查询封面模板列表（change: hifly-full-api）', () => {
  it('分页参数透传', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, data: [] })])
    await createAdapter().listCoverStyles({ page: 1, size: 30 })
    const url = global.fetch.calls[0].url
    expect(url).toContain('/project/cover_styles')
    expect(url).toContain('size=30')
  })

  it('size > 200 ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().listCoverStyles({ size: 500 })).rejects.toThrow(/size/)
    expect(m).not.toHaveBeenCalled()
  })
})

// ── 创建封面（免费） ────────────────────────────────────────────────────
describe('createCover — 创建封面（change: hifly-full-api）', () => {
  // 官方标注：此接口**不**产生积分消耗（与 6 个创作端点不同）
  it('template + content 透传，响应含图片地址', async () => {
    global.fetch = createFetchMock([
      createFetchResponse({ code: 0, data: { cover_url: 'https://cdn/cover.jpg' } }),
    ])
    const r = await createAdapter().createCover({ template: 'tpl-1', content: '今天聊三件事' })
    expect(r.coverUrl).toBe('https://cdn/cover.jpg')
    expect(JSON.parse(global.fetch.calls[0].opts.body)).toEqual({
      template: 'tpl-1',
      content: '今天聊三件事',
    })
  })

  // 官方：content 与 slots 至少填一项
  it('content 与 slots 都不给 ⇒ INVALID_CONFIG，不发请求', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().createCover({ template: 'tpl-1' })).rejects.toThrow(/content|slots/)
    expect(m).not.toHaveBeenCalled()
  })

  it('缺 template ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().createCover({ content: 'x' })).rejects.toThrow(/template/)
    expect(m).not.toHaveBeenCalled()
  })

  // canvas_preset 只允许 9:16 与 3:4；output_format 只允许 jpg/png
  it('canvas_preset / output_format 越界 ⇒ INVALID_CONFIG', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(
      createAdapter().createCover({ template: 't', content: 'x', canvasPreset: '16:9' }),
    ).rejects.toThrow(/canvas/i)
    await expect(
      createAdapter().createCover({ template: 't', content: 'x', outputFormat: 'webp' }),
    ).rejects.toThrow(/output/i)
    expect(m).not.toHaveBeenCalled()
  })

  it('slots 透传（数组元素含 name/label/value）', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, data: { cover_url: 'u' } })])
    await createAdapter().createCover({
      template: 't',
      slots: [{ name: 'title', label: '标题', value: '三件事' }],
    })
    const body = JSON.parse(global.fetch.calls[0].opts.body)
    expect(body.slots).toEqual([{ name: 'title', label: '标题', value: '三件事' }])
  })
})

// ── 删除作品 ────────────────────────────────────────────────────────────
describe('deleteWork — 删除作品（change: hifly-full-api）', () => {
  it('task_id 走 query，DELETE 方法', async () => {
    global.fetch = createFetchMock([createFetchResponse({ code: 0, data: null })])
    await createAdapter().deleteWork('task-abc')
    const url = global.fetch.calls[0].url
    expect(url).toContain('/video/task')
    expect(url).toContain('task_id=task-abc')
    expect(global.fetch.calls[0].opts.method).toBe('DELETE')
  })

  it('缺 taskId ⇒ INVALID_CONFIG，不发请求', async () => {
    const m = createFetchMock()
    global.fetch = m
    await expect(createAdapter().deleteWork('')).rejects.toThrow(/taskId/)
    expect(m).not.toHaveBeenCalled()
  })

  // 官方明确：仅支持普通视频创作任务 ID，不支持翻译/唱歌/图片驱动的任务 ID。
  // 服务端会拒；adapter 无法本地判定（不记任务来源），所以只把原文透出。
  it('服务端拒绝 ⇒ PROVIDER_ERROR 且原文透出', async () => {
    global.fetch = createFetchMock([
      createFetchResponse({ code: 11, message: '该任务不支持删除' }),
    ])
    try {
      await createAdapter().deleteWork('sing-task')
      expect.fail('Should throw')
    } catch (e) {
      expect(e.code).toBe(ERROR_CODES.PROVIDER_ERROR)
      expect(e.message).toContain('该任务不支持删除')
    }
  })
})
