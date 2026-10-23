// @ts-check
/**
 * zhihu-fav-batch:run 的字数区间接线回归（feat-zhihu-fav-batch-wordcount，2026-10-21）
 *
 * 事故/缺口形态：知乎收藏批量把改写请求固定成 `{content, style, length:'keep', llm}`，
 * **没有任何字数** ⇒ Python 回落 `_LENGTH_RANGES['keep']`（目标 1500 / 区间 300-3000），
 * 用户既改不了长度、也看不到改写稿多长。
 *
 * 本文件锁三条：
 *  ① 合法区间 ⇒ Python 请求体带 min_word_count / max_word_count（区间真的生效）；
 *  ② 缺省/非法 ⇒ 请求体**不含**这两字段（Python 回落 length 三档，旧行为不变）；
 *  ③ 改写稿的实际字数随条目回传（rewrittenWordCount），超上限的条数被计入统计。
 *
 * 独立于既有 zhihu-fav-batch.test.js：那一份锁「编排流程」，本份锁「字数契约」。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const registerHandlers = require('./zhihu-favlist')
const BatchRateController = require('../services/batch-rate-controller')

const axiosStub = { get: vi.fn(), post: vi.fn() }
global.__registerMock('axios', axiosStub)

function realShapeCollectResult (over = {}) {
  return {
    success: true,
    title: '测试标题',
    content: '这是正文内容，长度必须足够。'.repeat(3),
    coverImage: 'https://picx.zhimg.com/cover.jpg',
    description: '描述',
    publishTime: '2026-10-03',
    source: 'zhihu',
    ...over,
  }
}

function makeDeps (overrides = {}) {
  const handlers = {}
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } }
  const store = { getSetting: vi.fn(() => 'test-secret') }
  const urlCollector = { collect: vi.fn(async () => realShapeCollectResult()) }
  const pythonBridge = { requestBackend: vi.fn(async () => ({ result_content: '改写后的正文', word_count: 6 })) }
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() }
  const rateControllerFactory = (opts) => new BatchRateController({ sleepFn: async () => {}, baseIntervalMs: 1, jitterMs: 0, ...opts })
  return { ipcMain, handlers, deps: { store, urlCollector, pythonBridge, log, rateControllerFactory, ...overrides } }
}

function makeEvent () {
  const sends = []
  return { sender: { send: vi.fn((ch, payload) => sends.push({ ch, payload })) }, sends }
}

const ITEM = (url, kind) => ({ url, kind, title: `t-${url}`, favTime: 1 })

/** 取本批次发往 Python 的 /aggregation/rewrite 请求体 */
function rewriteBody (deps) {
  const call = deps.pythonBridge.requestBackend.mock.calls.find(([m, p]) => p === '/aggregation/rewrite')
  return call ? call[2] : null
}

describe('zhihu-fav-batch:run — 字数区间接线', () => {
  let handlers
  let deps
  let event

  beforeEach(() => {
    axiosStub.get.mockReset()
    axiosStub.post.mockReset()
    registerHandlers._resetFavBatchStateForTest()
    const ctx = makeDeps()
    handlers = ctx.handlers
    deps = ctx.deps
    event = makeEvent()
    registerHandlers(ctx.ipcMain, ctx.deps)
  })

  it('合法区间 ⇒ Python 请求体带 min_word_count / max_word_count', async () => {
    const r = await handlers['zhihu-fav-batch:run'](event, {
      items: [ITEM('https://zhuanlan.zhihu.com/p/1', 'article')],
      wordCountMin: 0,
      wordCountMax: 6000,
    })
    expect(r.code).toBe(0)
    const body = rewriteBody(deps)
    expect(body).toBeTruthy()
    expect(body.min_word_count).toBe(0)
    expect(body.max_word_count).toBe(6000)
  })

  it('缺省区间 ⇒ 请求体不含 min/max 字段（Python 回落 length 三档，旧行为不变）', async () => {
    const r = await handlers['zhihu-fav-batch:run'](event, {
      items: [ITEM('https://zhuanlan.zhihu.com/p/1', 'article')],
    })
    expect(r.code).toBe(0)
    const body = rewriteBody(deps)
    expect(body).toBeTruthy()
    expect(Object.prototype.hasOwnProperty.call(body, 'min_word_count')).toBe(false)
    expect(Object.prototype.hasOwnProperty.call(body, 'max_word_count')).toBe(false)
    // length 三档仍在（Python 侧的校验要求 length ∈ {keep,compress,expand}）
    expect(body.length).toBe('keep')
  })

  it('非法区间（浮点 / max<min / 越界）⇒ 一律不含 min/max 字段（降级到旧行为，不发坏值）', async () => {
    for (const bad of [
      { wordCountMin: 1.5, wordCountMax: 6000 },
      { wordCountMin: 6000, wordCountMax: 100 },
      { wordCountMin: -1, wordCountMax: 6000 },
      { wordCountMin: 0, wordCountMax: 50001 },
    ]) {
      registerHandlers._resetFavBatchStateForTest()
      const ctx = makeDeps()
      registerHandlers(ctx.ipcMain, ctx.deps)
      await ctx.handlers['zhihu-fav-batch:run'](makeEvent(), {
        items: [ITEM('https://zhuanlan.zhihu.com/p/1', 'article')],
        ...bad,
      })
      const body = rewriteBody(ctx.deps)
      expect(body, '请求体应存在').toBeTruthy()
      expect(Object.prototype.hasOwnProperty.call(body, 'min_word_count'), '非法区间不得下发 min_word_count').toBe(false)
      expect(Object.prototype.hasOwnProperty.call(body, 'max_word_count'), '非法区间不得下发 max_word_count').toBe(false)
    }
  })

  it('条目带回改写稿实际字数 rewrittenWordCount', async () => {
    const r = await handlers['zhihu-fav-batch:run'](event, {
      items: [ITEM('https://zhuanlan.zhihu.com/p/1', 'article')],
      wordCountMin: 0,
      wordCountMax: 6000,
    })
    expect(r.code).toBe(0)
    const results = (r.data && r.data.results) || []
    expect(results.length).toBe(1)
    const item = results[0].data
    expect(item.rewrittenContent).toBe('改写后的正文')
    expect(item.rewrittenWordCount).toBe(6)
  })

  it('超出用户上限的条数被计入统计（不截断内容，只告知）', async () => {
    // 改写稿 9000 字 > 上限 6000
    const ctx = makeDeps({
      pythonBridge: { requestBackend: vi.fn(async () => ({ result_content: '超长改写稿', word_count: 9000 })) },
    })
    registerHandlers(ctx.ipcMain, ctx.deps)
    const r = await ctx.handlers['zhihu-fav-batch:run'](makeEvent(), {
      items: [ITEM('https://zhuanlan.zhihu.com/p/1', 'article')],
      wordCountMin: 0,
      wordCountMax: 6000,
    })
    expect(r.code).toBe(0)
    expect(r.data.overLimit).toBe(1)
    // 内容未被截断（截断 = 静默丢内容；本仓理念是可见化）
    const results = (r.data && r.data.results) || []
    expect(results[0].data.rewrittenContent).toBe('超长改写稿')
    expect(results[0].data.rewrittenWordCount).toBe(9000)
  })

  it('未超上限 ⇒ overLimit 为 0', async () => {
    const r = await handlers['zhihu-fav-batch:run'](event, {
      items: [ITEM('https://zhuanlan.zhihu.com/p/1', 'article')],
      wordCountMin: 0,
      wordCountMax: 6000,
    })
    expect(r.code).toBe(0)
    expect(r.data.overLimit).toBe(0)
  })

  it('改写失败 ⇒ 条目仍带 rewriteError，且不产生字数与超限计数', async () => {
    const ctx = makeDeps({
      pythonBridge: { requestBackend: vi.fn(async () => ({ result_content: '' })) },
    })
    registerHandlers(ctx.ipcMain, ctx.deps)
    const r = await ctx.handlers['zhihu-fav-batch:run'](makeEvent(), {
      items: [ITEM('https://zhuanlan.zhihu.com/p/1', 'article')],
      wordCountMin: 0,
      wordCountMax: 6000,
    })
    expect(r.code).toBe(0)
    expect(r.data.overLimit).toBe(0)
    const results = (r.data && r.data.results) || []
    const item = results[0] && results[0].data
    if (item) {
      expect(item.rewriteFailed).toBe(true)
      expect(item.rewrittenWordCount).toBeUndefined()
    }
  })
})
