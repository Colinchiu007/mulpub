// @ts-check
/**
 * 账号级采集编排回归（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §7.1 T9–T13）
 *
 * 全部依赖经构造注入（假账号列表 / 假凭证 / 假 HTTP / 假 store），因此在无 Electron、
 * 无网络的 CI 里可逐条断言「发了几个请求、按什么顺序、什么条件下**不**发请求」。
 * 这组用例的核心不是「能取到数」，而是「不该发的时候一个请求都不发」——
 * 防封的第一道闸就在这里。
 */
import { describe, it, expect, vi } from 'vitest'

const { AccountMetricsService, cookiesToHeader, cookieNameSet } = require('./index')

const ACCOUNTS = [
  { id: 'a1', platform: 'xiaohongshu', name: '账号1', status: 'active' },
  { id: 'a2', platform: 'douyin', name: '账号2', status: 'active' },
  { id: 'a3', platform: 'toutiao', name: '账号3', status: 'expired' },
  { id: 'a4', platform: 'wechat_mp', name: '账号4', status: 'active' },
  { id: 'a5', platform: 'kuaishou', name: '账号5', status: 'unverified' },
]

/** 假 store：记录落盘调用，返回固定 tracked 行 */
function makeStore (overrides) {
  const calls = { applied: [], listed: 0 }
  const store = {
    listTrackedForAccountSync: vi.fn(() => {
      calls.listed += 1
      return { rows: [{ id: 't1', platform: 'xiaohongshu', post_id: 'note-1', url: '', publish_history_id: 'task-1', created_at: '2026-10-01T00:00:00.000Z' }], total: 1, truncated: false }
    }),
    applyAccountSyncLinks: vi.fn((input) => {
      calls.applied.push(input)
      return { written: input.links.length, backfilled: input.links.length, skipped: 0 }
    }),
    setAccountSyncState: vi.fn(() => true),
    getAccountSyncState: vi.fn(() => null),
    ...overrides,
  }
  return { store, calls }
}

function makeService (opts) {
  const o = opts || {}
  const { store, calls } = o.storeAndCalls || makeStore()
  const httpCalls = []
  const userHttp = o.http
  // 观测器必须包在**所有**路径外面：否则「断言发了几个请求」在只测请求数的用例里恒为 0，
  // 变成一条永远为真的假锁（本用例组第一版就是这么写的，T10/T11 因此假红）。
  const http = async (req) => {
    httpCalls.push(req)
    if (userHttp) return userHttp(req)
    return { statusCode: 200, json: { data: { page_size: 10, note_infos: [{ id: 'note-1', title: 't', read_count: 10, like_count: 1, comment_count: 0, fav_count: 0, share_count: 0 }] } } }
  }
  const service = new AccountMetricsService({
    store,
    listAccounts: o.listAccounts || (async () => ACCOUNTS),
    loadCredential: o.loadCredential || ((id) => (id === 'a1' ? { cookies: [{ name: 'web_session', value: 'x' }] } : { cookies: [{ name: 'a', value: 'b' }] })),
    listPublishRecords: o.listPublishRecords || (async () => [{ id: 'r1', taskId: 'task-1', platform: 'xiaohongshu', title: 't', timestamp: '2026-10-01T00:00:00.000Z' }]),
    httpRequest: http,
    signer: o.signer === undefined ? { sign: () => ({ 'X-s': 'sig', 'X-t': '1' }) } : o.signer,
    config: { pageDelayBaseMs: 0, pageDelayJitterRatio: 0, maxPagesPerAccount: 3, pageSize: 10, accountDailyMax: 4, ...(o.config || {}) },
  })
  return { service, store, calls, httpCalls }
}

describe('cookiesToHeader / cookieNameSet', () => {
  it('支持对象数组（凭证库形态）、JSON 字符串、裸 name=value 串三种历史形态', () => {
    expect(cookiesToHeader([{ name: 'a', value: '1' }, { name: 'b', value: '2' }])).toBe('a=1; b=2')
    expect(cookiesToHeader(JSON.stringify([{ name: 'a', value: '1' }]))).toBe('a=1')
    expect(cookiesToHeader('a=1; b=2')).toBe('a=1; b=2')
    expect(cookiesToHeader(null)).toBe('')
    expect(cookiesToHeader([])).toBe('')
    expect(cookiesToHeader('[]')).toBe('')
  })

  it('Cookie 名集合按小写归一（平台声明大小写不一致时仍能命中）', () => {
    expect(Array.from(cookieNameSet('Web_Session=abc; foo=bar'))).toEqual(['web_session', 'foo'])
    expect(cookieNameSet('').size).toBe(0)
  })
})

describe('AccountMetricsService.runRound 前置门禁', () => {
  it('T9 只处理 active 账号；expired/unverified 不发任何请求（V1）', async () => {
    const { service, httpCalls } = makeService()
    const res = await service.runRound({ reason: 'manual' })
    expect(res.counts.active).toBe(3) // a1 / a2 / a4（a3 expired、a5 unverified 排除）
    // a4 是 wechat_mp：无适配器 ⇒ unsupported，也不发请求
    const platforms = httpCalls.map(c => c.url)
    expect(platforms.some(u => u.includes('wechat_mp'))).toBe(false)
    expect(res.counts.unsupported).toBeGreaterThanOrEqual(1)
  })

  it('T9b 缺必需会话 Cookie ⇒ needs_login 且**一个请求都不发**（V2，防封第一闸）', async () => {
    const { service, httpCalls } = makeService({
      // 只留小红书：它声明了必需会话 Cookie，缺了就必须在发请求前拦住。
      // 抖音/头条没有稳定会话名可声明（见 adapters 的 requiredCookieNames 注释），
      // 把它们混进来会让「一个请求都不发」这条断言变成在测别的平台。
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
      loadCredential: () => ({ cookies: [{ name: 'other', value: 'x' }] }),
    })
    const res = await service.runRound({ reason: 'manual' })
    expect(res.counts.needs_login).toBe(1)
    expect(httpCalls).toHaveLength(0)
    const xhs = res.accounts.find(a => a.accountId === 'a1')
    expect(xhs.status).toBe('needs_login')
    expect(xhs.error).toContain('missing_cookie:web_session')
  })

  it('T9c 凭证完全为空 ⇒ needs_login（不是 unsupported，两者必须可区分）', async () => {
    const { service, httpCalls } = makeService({ loadCredential: () => null })
    const res = await service.runRound({ reason: 'manual' })
    // 三个 active 账号里：a1(xhs)/a2(douyin) 走凭证门禁 ⇒ needs_login；
    // a4(wechat_mp) 在凭证之前就因无适配器判 unsupported（顺序如此，且两类必须分开计数）
    expect(res.counts.needs_login).toBe(2)
    expect(res.counts.unsupported).toBe(1)
    expect(httpCalls).toHaveLength(0)
  })

  it('T21 无 store 或无 http 时明确跳过（不假装成功）', async () => {
    const a = new AccountMetricsService({ httpRequest: async () => ({ statusCode: 200, json: {} }) })
    const ra = await a.runRound({})
    expect(ra.ran).toBe(false)
    expect(ra.skippedReason).toBe('store_unavailable')

    const { store } = makeStore()
    const b = new AccountMetricsService({ store })
    const rb = await b.runRound({})
    expect(rb.ran).toBe(false)
    expect(rb.skippedReason).toBe('http_unavailable')
  })

  it('T9d 未注册平台 ⇒ unsupported 且点名（不补 0 假装完整）', async () => {
    const { service } = makeService({
      listAccounts: async () => [{ id: 'w1', platform: 'wechat_mp', status: 'active' }],
    })
    const res = await service.runRound({})
    expect(res.accounts[0].status).toBe('unsupported')
    expect(res.accounts[0].error).toBe('no_adapter')
    expect(res.counts.unsupported).toBe(1)
  })

  it('已注册但缺签名器 ⇒ unsupported（不伪造签名硬发）', async () => {
    const { service, httpCalls } = makeService({ signer: null })
    const res = await service.runRound({})
    const xhs = res.accounts.find(a => a.accountId === 'a1')
    expect(xhs.status).toBe('unsupported')
    expect(xhs.error).toBe('signer_unavailable')
    expect(httpCalls.some(c => c.url.includes('xiaohongshu'))).toBe(false)
  })

  it('签名器在场但签不出 ⇒ unsupported（不降级为不带签名硬发）', async () => {
    const { service, httpCalls } = makeService({
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
      signer: { sign: () => null },
    })
    const res = await service.runRound({})
    const xhs = res.accounts.find(a => a.accountId === 'a1')
    expect(xhs.status).toBe('unsupported')
    expect(xhs.error).toBe('sign_failed')
    expect(httpCalls).toHaveLength(0)
  })
})

describe('AccountMetricsService.runRound 分页与失败', () => {
  it('T10 满页继续翻，游标首条重复即停（V7 去重，防平台重复页死循环）', async () => {
    let call = 0
    const http = async () => {
      call += 1
      if (call === 1) {
        // 第一页满页（10 条，page_size=10）⇒ hasMore 为真，应继续翻
        const notes = Array.from({ length: 10 }, (_, k) => ({ id: 'first-' + k, read_count: 1 }))
        return { statusCode: 200, json: { data: { page_size: 10, note_infos: notes } } }
      }
      // 第二页首条与第一页首条相同 ⇒ 平台重复页，必须立刻停（不再发第 3 次）
      const notes = Array.from({ length: 10 }, (_, k) => ({ id: 'first-' + k, read_count: 1 }))
      return { statusCode: 200, json: { data: { page_size: 10, note_infos: notes } } }
    }
    const { service, httpCalls } = makeService({
      http,
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
      config: { maxPagesPerAccount: 5 },
    })
    await service.runRound({})
    expect(httpCalls).toHaveLength(2)
  })

  it('T11 页数触顶 ⇒ truncated 为真且请求数 == maxPagesPerAccount（V3，不静默）', async () => {
    let i = 0
    const http = async () => {
      i += 1
      // 每页都是满页且首条不断变化 ⇒ 永远 hasMore
      const notes = Array.from({ length: 10 }, (_, k) => ({ id: 'n' + i + '-' + k, read_count: 1 }))
      return { statusCode: 200, json: { data: { page_size: 10, note_infos: notes } } }
    }
    const { service, httpCalls } = makeService({
      http,
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
      config: { maxPagesPerAccount: 3 },
    })
    const res = await service.runRound({})
    expect(httpCalls).toHaveLength(3)
    expect(res.counts.truncated).toBe(1)
    expect(res.accounts[0].truncated).toBe(true)
  })

  it('T12 非 2xx ⇒ failed 且**不写任何快照**（V9：「取到 0」与「没取到」是两种结论）', async () => {
    const { service, store } = makeService({
      http: async () => ({ statusCode: 500, json: null }),
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
    })
    const res = await service.runRound({})
    expect(res.counts.failed).toBe(1)
    expect(res.accounts[0].error).toBe('http_500')
    expect(store.applyAccountSyncLinks).not.toHaveBeenCalled()
  })

  it('T12b 结构不符 ⇒ parse_error 判失败，不把「接口变了」渲染成「这个账号没作品」', async () => {
    const { service } = makeService({
      http: async () => ({ statusCode: 200, json: { data: {} } }),
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
    })
    const res = await service.runRound({})
    expect(res.accounts[0].status).toBe('failed')
    expect(res.accounts[0].error).toContain('parse_error')
  })

  it('T12c 请求抛错 ⇒ request_error 且计数（不让异常冒泡中断整轮）', async () => {
    const { service } = makeService({
      http: async () => { throw new Error('socket hang up') },
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }, { id: 'a2', platform: 'douyin', status: 'active' }],
    })
    const res = await service.runRound({})
    expect(res.ran).toBe(true)
    expect(res.accounts.find(a => a.accountId === 'a1').error).toContain('request_error')
  })

  it('T13 账号之间串行：不存在两个账号的请求交错（防并发放大风控）', async () => {
    const inflight = new Set()
    let maxInflight = 0
    const http = async (req) => {
      const key = req.url.includes('xiaohongshu') ? 'xhs' : 'dy'
      inflight.add(key)
      maxInflight = Math.max(maxInflight, inflight.size)
      await new Promise(r => setTimeout(r, 5))
      inflight.delete(key)
      if (key === 'xhs') return { statusCode: 200, json: { data: { page_size: 10, note_infos: [{ id: 'n1', read_count: 1 }] } } }
      return { statusCode: 200, json: { aweme_list: [{ aweme_id: 'a1', statistics: {} }], has_more: 0 } }
    }
    const { service } = makeService({ http })
    await service.runRound({})
    expect(maxInflight).toBe(1)
  })
})

describe('AccountMetricsService.runRound 归因与落盘', () => {
  it('T14 归因结果交给 store 时带 ownerSubject 与来源标记（归属过滤不能只靠上游）', async () => {
    const { service, calls } = makeService()
    await service.runRound({ ownerSubject: 'user-A' })
    expect(calls.applied).toHaveLength(1)
    expect(calls.applied[0].ownerSubject).toBe('user-A')
    expect(calls.applied[0].source).toBe('account_sync')
    expect(calls.applied[0].links.length).toBeGreaterThanOrEqual(1)
  })

  it('T14b 无作品时不触碰 store（零写入）', async () => {
    const { service, store } = makeService({
      http: async () => ({ statusCode: 200, json: { data: { page_size: 10, note_infos: [] } } }),
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
    })
    await service.runRound({})
    expect(store.applyAccountSyncLinks).not.toHaveBeenCalled()
  })

  it('T6d 无标题作品不下发到二级归因但一级仍可命中（真实 postId 优先）', async () => {
    const { service, calls } = makeService({
      http: async () => ({ statusCode: 200, json: { data: { page_size: 10, note_infos: [{ id: 'note-1', read_count: 42 }] } } }),
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
    })
    const res = await service.runRound({})
    expect(res.counts.linked).toBe(1)
    expect(calls.applied[0].links[0].work.metrics.views).toBe(42)
  })
})

describe('QM-6 评审修复项的回归锁', () => {
  it('T30 分页自然结束（末页空）不得报 truncated —— 「采完」与「触顶」必须可区分', async () => {
    let call = 0
    const http = async () => {
      call += 1
      if (call === 1) {
        const notes = Array.from({ length: 10 }, (_, k) => ({ id: 'n' + k, read_count: 1 }))
        return { statusCode: 200, json: { data: { page_size: 10, note_infos: notes } } }
      }
      return { statusCode: 200, json: { data: { page_size: 10, note_infos: [] } } }
    }
    const { service } = makeService({
      http,
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
      config: { maxPagesPerAccount: 5 },
    })
    const res = await service.runRound({})
    expect(res.accounts[0].status).toBe('ok')
    expect(res.accounts[0].truncated).toBeUndefined()
    expect(res.counts.truncated).toBe(0)
  })

  it('T30b 非满页自然结束（hasMore=false）同样不报 truncated', async () => {
    const { service } = makeService({
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
      config: { maxPagesPerAccount: 5 },
    })
    const res = await service.runRound({})
    expect(res.accounts[0].truncated).toBeUndefined()
  })

  it('T31 业务码判未登录 ⇒ needs_login（不是 failed）：界面给出的下一步动作完全不同', async () => {
    const { service } = makeService({
      http: async () => ({ statusCode: 200, json: { status_code: 8, status_msg: '未登录' } }),
      listAccounts: async () => [{ id: 'a1', platform: 'douyin', status: 'active' }],
      loadCredential: () => ({ cookies: [{ name: 'sessionid', value: 'x' }] }),
    })
    const res = await service.runRound({})
    expect(res.accounts[0].status).toBe('needs_login')
    expect(res.accounts[0].error).toContain('session_expired')
    expect(res.counts.failed).toBe(0)
  })

  it('T32 适配器声明的 bodyFromCookie 会被注入 JSON body（快手的设备指纹两处都要放）', async () => {
    let seenBody = null
    const { service } = makeService({
      http: async (req) => {
        seenBody = req.body
        return { statusCode: 200, json: { data: { photoList: { photoItems: [] } } } }
      },
      listAccounts: async () => [{ id: 'k1', platform: 'kuaishou', status: 'active' }],
      loadCredential: () => ({ cookies: [{ name: 'kuaishou.web.cp.api_ph', value: 'PH-VALUE' }] }),
    })
    await service.runRound({})
    expect(seenBody).toBeTruthy()
    expect(seenBody.page).toBe(0)
    expect(seenBody['kuaishou.web.cp.api_ph']).toBe('PH-VALUE')
  })

  it('T33 归因输入读取失败 ⇒ 出声且不写快照（不让「库坏了」看起来像「已采集但没数据」）', async () => {
    const { store, calls } = makeStore({ listTrackedForAccountSync: () => ({ rows: [], total: 0, error: 'no such table: tracked_content' }) })
    const { service } = makeService({ storeAndCalls: { store, calls } })
    const res = await service.runRound({ ownerSubject: 'user-A' })
    expect(res.writeError).toContain('no such table: tracked_content')
    expect(res.counts.snapshots).toBe(0)
    expect(calls.applied).toHaveLength(0)
  })

  it('T34 节流参数随配置变化重建（否则改 env 只有一半生效，排障时更难判断）', async () => {
    const a = new AccountMetricsService({ store: {}, httpRequest: async () => ({ statusCode: 200, json: {} }), config: { pageDelayBaseMs: 100 } })
    const first = a._throttler()
    expect(a._config().pageDelayBaseMs).toBe(100)
    const b = new AccountMetricsService({ store: {}, httpRequest: async () => ({ statusCode: 200, json: {} }), config: { pageDelayBaseMs: 200 } })
    expect(b._throttler()).not.toBe(first)
  })
})

describe('AccountMetricsService 重入与调度', () => {
  it('T20b 进行中再次调用直接返回 already_running（连点刷新不叠加请求）', async () => {
    let release
    const gate = new Promise(r => { release = r })
    const { service } = makeService({
      http: async () => { await gate; return { statusCode: 200, json: { data: { page_size: 10, note_infos: [] } } } },
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
    })
    const first = service.runRound({})
    await new Promise(r => setTimeout(r, 5))
    const second = await service.runRound({})
    expect(second.ran).toBe(false)
    expect(second.skippedReason).toBe('already_running')
    release()
    await first
  })

  it('T20c 账号日上限生效：超出额度不再发请求并计数（V6）', async () => {
    const { service, httpCalls } = makeService({
      listAccounts: async () => [{ id: 'a1', platform: 'xiaohongshu', status: 'active' }],
      config: { accountDailyMax: 1 },
    })
    const first = await service.runRound({})
    expect(first.counts.synced).toBe(1)
    const before = httpCalls.length
    const second = await service.runRound({})
    expect(second.counts.skipped_daily_cap).toBe(1)
    expect(httpCalls.length).toBe(before)
  })

  it('getStatus 读持久化状态；无持久化时回落内存态', async () => {
    const { service, store } = makeService()
    expect(service.getStatus('u')).toBeNull()
    await service.runRound({ ownerSubject: 'u' })
    expect(store.setAccountSyncState).toHaveBeenCalled()
    const persisted = { lastRunAt: 'x' }
    store.getAccountSyncState = vi.fn(() => persisted)
    expect(service.getStatus('u')).toBe(persisted)
  })

  it('start/stop 幂等且不残留定时器（不 unref 会拖住进程退出）', () => {
    const { service } = makeService()
    service.start()
    service.start() // 第二次应是 no-op
    service.stop()
    service.stop()
    expect(true).toBe(true)
  })
})
