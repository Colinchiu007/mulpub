// @ts-check
/**
 * ops-resilience-reporter.test.js — 断连降级遥测队列 + 配置生效回执（design §2 / §3）
 *
 * 覆盖：失败分类白名单、ACK 频率控制（hash 比对 + 24h 心跳 + 恢复态）、
 * 客户端侧载荷校验镜像（绝不发送服务端会 400 的脏数据）、降级事件本地队列
 * （上限/最旧丢弃/单条 8KB）、断连期间零网络请求、恢复后集中补报、失败保留队列。
 */
import { describe, it, expect, beforeEach } from 'vitest'

const {
  OpsResilienceReporter,
  ACK_TYPES,
  DEGRADATION_TIERS,
  DEGRADATION_SETTING_KEY,
  ACK_SETTING_KEY,
  FAILURE_KINDS,
  ACK_HEARTBEAT_INTERVAL_MS,
  MAX_DEGRADATION_QUEUE,
  MAX_EVENT_BYTES,
  classifyFailureKind,
  decideAck,
  summarizeAppliedBlocks,
  tagOpsError,
  validateAckPayload,
  validateDegradationPayload,
} = require('./ops-resilience-reporter')

const RUNTIME_ENDPOINT = '/api/v1/runtime/bootstrap'

function makeStore (initial) {
  const rows = initial ? { ...initial } : {}
  return {
    getSetting: (k) => (k in rows ? JSON.parse(rows[k]) : ''),
    getSettingObject: (k, d = {}) => {
      const v = k in rows ? JSON.parse(rows[k]) : null
      return v && typeof v === 'object' && !Array.isArray(v) ? v : d
    },
    setSetting: (k, v) => { rows[k] = JSON.stringify(v) },
    _rows: rows,
  }
}

const LOG = { info () {}, warn () {}, error () {}, notify () {} }

/** 可控时钟 + 可控 fetch：断连期间断言 fetcher 从未被调用是本文件的核心防回归点 */
function makeFixture (overrides = {}) {
  const store = overrides.store || makeStore()
  const calls = []
  let clock = overrides.startAt || Date.parse('2026-10-07T10:00:00Z')
  const fetcher = async (url, init) => {
    calls.push({ url, init, body: init && init.body ? JSON.parse(init.body) : null })
    if (typeof overrides.respond === 'function') return overrides.respond(url, init, calls.length)
    return { ok: true, status: 200, json: async () => ({ ok: true }) }
  }
  const reporter = new OpsResilienceReporter({
    store,
    log: LOG,
    fetcher,
    now: () => clock,
    getAuth: () => (overrides.auth === null ? null : (overrides.auth || { url: 'https://ops.example.com', apiKey: 'catalog-key' })),
    getClientId: () => 'client-1',
    getClientVersion: () => '2.1.0',
  })
  return {
    store, calls, reporter,
    advance: (ms) => { clock += ms },
    queue: () => (store._rows[DEGRADATION_SETTING_KEY] ? JSON.parse(store._rows[DEGRADATION_SETTING_KEY]).events : []),
    setQueueRow: (row) => { store._rows[DEGRADATION_SETTING_KEY] = JSON.stringify(row) },
  }
}

describe('classifyFailureKind / tagOpsError（design §3.2 failure_kind 白名单）', () => {
  it('白名单与契约逐字一致', () => {
    expect(FAILURE_KINDS).toEqual(['timeout', 'dns', 'network', 'http_4xx', 'http_5xx', 'verify_failed', 'invalid_payload', 'auth_failed'])
    expect(DEGRADATION_TIERS).toEqual(['L1', 'L2', 'L3', 'default'])
    expect(ACK_TYPES).toEqual(['applied', 'heartbeat', 'recovered'])
  })

  it('AbortError / ABORT_ERR / 超时文案 → timeout', () => {
    expect(classifyFailureKind({ name: 'AbortError' })).toBe('timeout')
    expect(classifyFailureKind({ code: 'ABORT_ERR' })).toBe('timeout')
    expect(classifyFailureKind(new Error('同步请求超时（10 秒）'))).toBe('timeout')
  })

  it('DNS 解析类错误码 → dns，其他连接错误 → network', () => {
    const enotfound = new Error('无法连接 Ops Center: getaddrinfo ENOTFOUND')
    enotfound.cause = { code: 'ENOTFOUND' }
    expect(classifyFailureKind(enotfound)).toBe('dns')
    const again = new Error('x'); again.cause = { code: 'EAI_AGAIN' }
    expect(classifyFailureKind(again)).toBe('dns')
    const refused = new Error('无法连接 Ops Center: ECONNREFUSED'); refused.cause = { code: 'ECONNREFUSED' }
    expect(classifyFailureKind(refused)).toBe('network')
  })

  it('HTTP 4xx/5xx 分流，401/403 归 auth_failed', () => {
    expect(classifyFailureKind(new Error('Ops Center 返回 HTTP 503'))).toBe('http_5xx')
    expect(classifyFailureKind(new Error('Ops Center 返回 HTTP 404'))).toBe('http_4xx')
    expect(classifyFailureKind(new Error('Ops Center API Key 无效（401/403）'))).toBe('auth_failed')
  })

  it('验签失败与结构非法分流', () => {
    expect(classifyFailureKind(new Error('运行时策略验签失败（SIGNATURE_MISMATCH），已拒绝应用任何运行时策略'))).toBe('verify_failed')
    expect(classifyFailureKind(new Error('运行时策略响应结构错误（缺少 announcements 数组）'))).toBe('invalid_payload')
    expect(classifyFailureKind(new Error('目录响应不是合法 JSON'))).toBe('invalid_payload')
  })

  it('未知异常归 network（断连是兜底分类，绝不产出白名单外值）', () => {
    expect(FAILURE_KINDS).toContain(classifyFailureKind(new Error('boom')))
    expect(classifyFailureKind(null)).toBe('network')
    expect(classifyFailureKind({ failureKind: 'verify_failed' })).toBe('verify_failed')
  })

  it('tagOpsError 就地挂 failureKind，不吞原始错误（同一引用便于调用点继续 throw）', () => {
    const err = tagOpsError(new Error('Ops Center 返回 HTTP 500'))
    expect(err).toBeInstanceOf(Error)
    expect(err.failureKind).toBe('http_5xx')
    const already = tagOpsError({ failureKind: 'dns', message: 'x' })
    expect(already.failureKind).toBe('dns')
  })
})

describe('decideAck（design §2.4 频率控制）', () => {
  const hash = 'a3f9c2e1b7d4c2f9'
  const now = Date.parse('2026-10-07T10:00:00Z')

  it('首次 ACK → applied', () => {
    expect(decideAck({ lastAck: null, configHash: hash, now })).toEqual({ send: true, ackType: 'applied' })
  })

  it('hash 变化 → 立即 applied', () => {
    const lastAck = { configHash: 'b7d4c2f9a3f9c2e1', ackType: 'applied', at: now - 1000 }
    expect(decideAck({ lastAck, configHash: hash, now })).toEqual({ send: true, ackType: 'applied' })
  })

  it('hash 未变且距上次 ACK 未满 24h → 不发', () => {
    const lastAck = { configHash: hash, ackType: 'applied', at: now - (ACK_HEARTBEAT_INTERVAL_MS - 1000) }
    expect(decideAck({ lastAck, configHash: hash, now })).toEqual({ send: false, ackType: null })
  })

  it('hash 未变但超过 24h → heartbeat', () => {
    const lastAck = { configHash: hash, ackType: 'applied', at: now - (ACK_HEARTBEAT_INTERVAL_MS + 1000) }
    expect(decideAck({ lastAck, configHash: hash, now })).toEqual({ send: true, ackType: 'heartbeat' })
  })

  it('断连恢复 → recovered（无视 hash 是否变化），且只发一次', () => {
    const lastAck = { configHash: hash, ackType: 'applied', at: now }
    expect(decideAck({ lastAck, configHash: hash, now, recovered: true })).toEqual({ send: true, ackType: 'recovered' })
  })

  it('config_hash 缺失或非法 → 不发（宁可不发也不投脏数据）', () => {
    expect(decideAck({ lastAck: null, configHash: '', now }).send).toBe(false)
    expect(decideAck({ lastAck: null, configHash: 'NOT_A_HASH', now }).send).toBe(false)
    expect(decideAck({ lastAck: { configHash: hash, at: now }, configHash: 'nope', now }).send).toBe(false)
  })
})

describe('summarizeAppliedBlocks（ACK 的 applied/skipped 载荷）', () => {
  it('按块给出应用条数，缺席/非法的块进 skipped', () => {
    const payload = {
      announcements: [{ id: 1 }, { id: 2 }],
      update_policy: { auto_check: true },
      content_policy: null,
      feature_flags: { a: true, b: false },
      platform_defs: [],
    }
    const { applied, skipped } = summarizeAppliedBlocks(payload)
    expect(applied.announcements).toBe(2)
    expect(applied.feature_flags).toBe(2)
    expect(applied.platform_defs).toBe(0)
    expect(skipped).toContain('content_policy')
    expect(skipped).not.toContain('announcements')
    // 14 块（story-text-limit-control：storyTextLimit 13 → 14）
    expect(skipped.length + Object.keys(applied).length).toBe(14)
  })

  it('payload 非对象时全部进 skipped', () => {
    expect(summarizeAppliedBlocks(null).skipped).toHaveLength(14)
  })
})

describe('validateAckPayload / validateDegradationPayload（客户端侧镜像服务端校验）', () => {
  const validAck = {
    client_id: 'client-1',
    client_version: '2.1.0',
    config_version: 42,
    config_hash: 'a3f9c2e1b7d4c2f9',
    applied_blocks: { appMenu: 1 },
    skipped_blocks: ['contentTemplates'],
    degraded: false,
    degradation_tier: null,
    ack_type: 'applied',
    degraded_since: null,
  }

  it('合法载荷零错误', () => {
    expect(validateAckPayload(validAck)).toEqual([])
  })

  it('非法 config_hash / ack_type / client_id 被拦（服务端会 400，客户端先拦）', () => {
    expect(validateAckPayload({ ...validAck, config_hash: 'NOT_A_HASH' }).join()).toMatch(/config_hash/)
    expect(validateAckPayload({ ...validAck, ack_type: 'whatever' }).join()).toMatch(/ack_type/)
    expect(validateAckPayload({ ...validAck, client_id: '' }).join()).toMatch(/client_id/)
    expect(validateAckPayload({ ...validAck, config_version: -1 }).join()).toMatch(/config_version/)
  })

  it('degraded=true 时必须带四值白名单内的 degradation_tier 与 degraded_since', () => {
    expect(validateAckPayload({ ...validAck, degraded: true, degradation_tier: null }).join()).toMatch(/degradation_tier/)
    expect(validateAckPayload({ ...validAck, degraded: true, degradation_tier: 'L9' }).join()).toMatch(/degradation_tier/)
    expect(validateAckPayload({ ...validAck, degraded: true, degradation_tier: 'L2', degraded_since: null }).join()).toMatch(/degraded_since/)
    expect(validateAckPayload({ ...validAck, degraded: true, degradation_tier: 'L2', degraded_since: '2026-10-07T10:00:00Z' })).toEqual([])
  })

  it('applied_blocks / skipped_blocks 的元素形态被校验', () => {
    expect(validateAckPayload({ ...validAck, applied_blocks: { appMenu: -1 } }).join()).toMatch(/applied_blocks/)
    expect(validateAckPayload({ ...validAck, applied_blocks: [] }).join()).toMatch(/applied_blocks/)
    expect(validateAckPayload({ ...validAck, skipped_blocks: 'contentTemplates' }).join()).toMatch(/skipped_blocks/)
    expect(validateAckPayload({ ...validAck, skipped_blocks: ['x'.repeat(65)] }).join()).toMatch(/skipped_blocks/)
  })

  it('降级载荷的 failure_kind / offline_seconds / serving_tier 被校验', () => {
    const validDeg = {
      client_id: 'client-1', channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failure_kind: 'timeout',
      consecutive_failures: 3, degraded_since: '2026-10-07T10:00:00Z', recovered_at: '2026-10-07T11:00:00Z',
      offline_seconds: 3600, serving_tier: 'L2',
    }
    expect(validateDegradationPayload(validDeg)).toEqual([])
    expect(validateDegradationPayload({ ...validDeg, failure_kind: 'WHATEVER' }).join()).toMatch(/failure_kind/)
    expect(validateDegradationPayload({ ...validDeg, offline_seconds: -1 }).join()).toMatch(/offline_seconds/)
    expect(validateDegradationPayload({ ...validDeg, serving_tier: 'L9' }).join()).toMatch(/serving_tier/)
    expect(validateDegradationPayload({ ...validDeg, channel: 'other' }).join()).toMatch(/channel/)
  })
})

describe('OpsResilienceReporter — 降级本地队列（design §3.4/§3.5）', () => {
  it('首次失败开一集断连并落盘队列；后续失败只更新计数，不追加条目', () => {
    const f = makeFixture()
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'default' })
    expect(f.queue()).toHaveLength(1)
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'dns', servingTier: 'default' })
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'dns', servingTier: 'default' })
    expect(f.queue()).toHaveLength(1)
    expect(f.queue()[0]).toMatchObject({ consecutive_failures: 3, failure_kind: 'dns', channel: 'runtime' })
    expect(f.queue()[0].degraded_since).toMatch(/^2026-10-07T/)
  })

  it('断连期间零对外网络请求（遥测绝不依赖被监控的同一通道）', () => {
    const f = makeFixture()
    for (let i = 0; i < 5; i++) {
      f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'L2' })
    }
    expect(f.calls).toHaveLength(0)
    expect(f.reporter.getState()).toMatchObject({ degraded: true, consecutiveFailures: 5, servingTier: 'L2' })
  })

  it('恢复后集中补报本轮全部断连事件，成功即出队', async () => {
    const f = makeFixture()
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'default' })
    f.advance(3600 * 1000)
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'default' })
    f.advance(1800 * 1000)
    const r = await f.reporter.reportRecovered({ servingTier: 'L1' })

    const deg = f.calls.find((c) => c.url.includes('/api/v1/telemetry/degradation'))
    expect(deg).toBeTruthy()
    expect(deg.url).toBe('https://ops.example.com/api/v1/telemetry/degradation')
    expect(deg.init.headers['X-Catalog-Key']).toBe('catalog-key')
    expect(deg.body).toMatchObject({
      client_id: 'client-1', channel: 'runtime', failure_kind: 'timeout',
      consecutive_failures: 2, offline_seconds: 5400, serving_tier: 'L1',
    })
    expect(deg.body.recovered_at).toBeTruthy()
    expect(r).toMatchObject({ code: 0, reported: 1 })
    expect(f.queue()).toHaveLength(0)
    expect(f.reporter.getState()).toMatchObject({ degraded: false, consecutiveFailures: 0 })
  })

  it('上报失败保留队列供下轮重试（对齐「水印仅成功时推进」范式）', async () => {
    let first = true
    const f = makeFixture({
      respond: () => {
        if (first) { first = false; return { ok: false, status: 503, json: async () => ({}) } }
        return { ok: true, status: 200, json: async () => ({ ok: true }) }
      },
    })
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'network', servingTier: 'L2' })
    f.advance(60000)
    expect(await f.reporter.reportRecovered({ servingTier: 'L1' })).toMatchObject({ code: -1 })
    expect(f.queue()).toHaveLength(1)

    f.advance(60000)
    expect(await f.reporter.reportRecovered({ servingTier: 'L1' })).toMatchObject({ code: 0, reported: 1 })
    expect(f.queue()).toHaveLength(0)
  })

  it('队列上限 200 条，超出丢最旧', () => {
    const events = new Array(MAX_DEGRADATION_QUEUE).fill(0).map((_, i) => ({
      client_id: 'c', channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failure_kind: 'timeout',
      consecutive_failures: 1, degraded_since: '2026-10-01T00:00:00Z', offline_seconds: 0, serving_tier: 'default', seq: i,
    }))
    const f = makeFixture()
    f.setQueueRow({ events, open: null })
    // 先把 open 事件消耗掉，再制造一批新事件触发裁剪
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'default' })
    const q = f.queue()
    expect(q).toHaveLength(MAX_DEGRADATION_QUEUE)
    expect(q[0].consecutive_failures).toBeGreaterThan(0)
  })

  it('单条超过 8KB 的事件不落盘（防异常 payload 撑爆 settings）', () => {
    const f = makeFixture()
    const bloated = {
      id: 'deg-bloated', client_id: 'client-1', channel: 'runtime', endpoint: RUNTIME_ENDPOINT,
      failure_kind: 'timeout', consecutive_failures: 1, degraded_since: '2026-10-07T09:00:00.000Z',
      recovered_at: null, offline_seconds: 0, serving_tier: 'default', blob: 'x'.repeat(MAX_EVENT_BYTES),
    }
    f.setQueueRow({ events: [bloated], open: { id: 'deg-bloated' } })
    // 更新后的事件仍超限 → 拒绝落盘，且不污染已存内容（宁可少报一条，也不写坏数据）
    expect(f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'default' })).toBe(false)
    expect(f.queue()[0].consecutive_failures).toBe(1)
  })

  it('未配置运营中心时静默跳过，不抛错也不联网', async () => {
    const f = makeFixture({ auth: null })
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'default' })
    expect(await f.reporter.reportRecovered({ servingTier: 'L1' })).toMatchObject({ code: 0, skipped: true })
    expect(f.calls).toHaveLength(0)
    expect(f.queue()).toHaveLength(1)
  })

  it('bearer 模式改用 Authorization 头（零配置化自动发现路径）', async () => {
    const f = makeFixture({ auth: { url: 'https://ops.example.com/', getAccessToken: async () => 'jwt-token' } })
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'default' })
    f.advance(1000)
    await f.reporter.reportRecovered({ servingTier: 'L1' })
    const deg = f.calls.find((c) => c.url.includes('telemetry'))
    expect(deg.init.headers.Authorization).toBe('Bearer jwt-token')
    expect(deg.init.headers['X-Catalog-Key']).toBeUndefined()
  })
})

describe('OpsResilienceReporter — ACK 上报（design §2）', () => {
  const applied = {
    config_version: 42,
    config_hash: 'a3f9c2e1b7d4c2f9',
    announcements: [{ id: 1 }],
    feature_flags: { a: true },
    platform_defs: [],
    content_policy: null,
  }

  it('hash 变化时以 ack_type=applied 上报一次，载荷自校验通过', async () => {
    const f = makeFixture()
    await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })
    const ack = f.calls.find((c) => c.url.includes('/api/v1/runtime/ack'))
    expect(ack.url).toBe('https://ops.example.com/api/v1/runtime/ack')
    expect(ack.init.method).toBe('POST')
    expect(ack.body.ack_type).toBe('applied')
    expect(ack.body.config_hash).toBe('a3f9c2e1b7d4c2f9')
    expect(ack.body.config_version).toBe(42)
    expect(ack.body.applied_blocks.announcements).toBe(1)
    expect(ack.body.skipped_blocks).toContain('content_policy')
    expect(validateAckPayload(ack.body)).toEqual([])
  })

  it('连续三次 hash 未变且未满 24h → 不产生任何 ACK 请求', async () => {
    const f = makeFixture()
    await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })
    const after = f.calls.length
    await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })
    f.advance(1000)
    await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })
    expect(f.calls.length).toBe(after)
  })

  it('hash 未变但超过 24h → heartbeat', async () => {
    const f = makeFixture()
    await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })
    f.advance(ACK_HEARTBEAT_INTERVAL_MS + 1000)
    await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })
    const acks = f.calls.filter((c) => c.url.includes('runtime/ack'))
    expect(acks).toHaveLength(2)
    expect(acks[1].body.ack_type).toBe('heartbeat')
  })

  it('断连恢复后首次成功同步以 recovered + degraded=true + 断连时长上报', async () => {
    const f = makeFixture()
    await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })
    f.reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'L1' })
    f.advance(3600 * 1000)
    await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })

    const deg = f.calls.find((c) => c.url.includes('telemetry/degradation'))
    const ack = f.calls.filter((c) => c.url.includes('runtime/ack'))[1]
    expect(deg.body).toMatchObject({ offline_seconds: 3600 })
    expect(Date.parse(deg.body.recovered_at)).toBe(Date.parse('2026-10-07T11:00:00Z'))
    expect(ack.body).toMatchObject({ ack_type: 'recovered', degraded: true, degradation_tier: 'L1' })
    expect(ack.body.degraded_since).toBeTruthy()
    expect(validateAckPayload(ack.body)).toEqual([])
  })

  it('ACK 失败不影响本轮应用结果，也不推进 ACK 记录（下轮补发）', async () => {
    const f = makeFixture({ respond: () => ({ ok: false, status: 500, json: async () => ({}) }) })
    expect(await f.reporter.recordApplied({ payload: applied, servingTier: 'L1' })).toMatchObject({ code: -1 })
    const f2 = makeFixture({ store: f.store })
    await f2.reporter.recordApplied({ payload: applied, servingTier: 'L1' })
    expect(f2.calls.some((c) => c.url.includes('runtime/ack'))).toBe(true)
  })

  it('payload 缺少 config_hash 时不发 ACK（脏数据不入库）', async () => {
    const f = makeFixture()
    await f.reporter.recordApplied({ payload: { ...applied, config_hash: '' }, servingTier: 'L1' })
    expect(f.calls.some((c) => c.url.includes('runtime/ack'))).toBe(false)
  })

  it('无 store 时全部降级为跳过，不抛错', async () => {
    const reporter = new OpsResilienceReporter({ store: null, log: LOG, fetcher: async () => ({ ok: true, json: async () => ({}) }) })
    reporter.recordFailure({ channel: 'runtime', endpoint: RUNTIME_ENDPOINT, failureKind: 'timeout', servingTier: 'default' })
    expect(await reporter.reportRecovered({ servingTier: 'L1' })).toMatchObject({ code: 0, skipped: true })
    expect(await reporter.recordApplied({ payload: applied, servingTier: 'L1' })).toMatchObject({ code: 0, skipped: true })
    expect(reporter.getState().queued).toBe(0)
  })
})
// ── 回归锁：skipped ≠ 成功（QM-6 opencode 外部评审抓到的 CRITICAL）──────────
// 失效链：ops-center-sync 未把 fetcher 注入 reporter ⇒ _fetcher=null ⇒ _postJson 一律
// {code:0, skipped:true}；而调用方按 `result.code !== 0` 判失败 ⇒ skipped 被当成成功 ⇒
// ① 降级事件被出队永久删除（服务端从未收到，断连证据丢失）
// ② ACK 记录被写成「已发」（看板被污染，且下一次 ACK 被 24h 心跳窗口挡住）
// 测试当时全绿，是因为 makeFixture 总是注入 fetcher —— 夹具替实现兜住了接线漏。
describe('skipped 不等于成功：证据不得被丢弃', () => {
  const DEGRADED_SINCE = '2026-10-07T10:00:00Z'
  const RECOVERED_AT = Date.parse('2026-10-07T11:00:00Z')
  // 时间断言一律比「时刻」不比「字符串」：落盘会经 toISOString() 归一化成带 .000Z 的形式，
  // 直接比字面量会得到一个与被测行为无关的脆弱断言。
  const DEGRADED_SINCE_MS = Date.parse(DEGRADED_SINCE)

  function makeNoTransport (extra = {}) {
    const store = makeStore()
    const reporter = new OpsResilienceReporter({
      store,
      log: LOG,
      // 刻意不注入 fetcher —— 复现生产接线漏掉的形态
      now: () => RECOVERED_AT,
      getAuth: () => ({ url: 'https://ops.example.com', apiKey: 'catalog-key' }),
      getClientId: () => 'client-1',
      getClientVersion: () => '2.1.0',
      ...extra,
    })
    // 先制造一轮降级（recordFailure 不需要网络）
    reporter.recordFailure({ channel: 'runtime', failureKind: 'timeout', servingTier: 'L2', now: Date.parse(DEGRADED_SINCE) })
    return { store, reporter }
  }

  it('无 fetcher 时降级事件必须留在队列，不得被出队丢弃', async () => {
    const { store, reporter } = makeNoTransport()
    expect(reporter.getState().queued).toBe(1)
    const r = await reporter.reportRecovered({ servingTier: 'L1', now: RECOVERED_AT })
    expect(r.skipped).toBe(true)
    // 关键断言：证据还在
    const row = JSON.parse(store._rows[DEGRADATION_SETTING_KEY])
    expect(row.events.length).toBe(1)
    expect(Date.parse(row.events[0].degraded_since)).toBe(DEGRADED_SINCE_MS)
  })

  it('无 fetcher 时不得写 ACK 记录（否则下一次被 24h 心跳窗口挡住）', async () => {
    const { store, reporter } = makeNoTransport()
    await reporter.recordApplied({
      payload: { config_version: 7, config_hash: 'a1b2c3d4e5f60718' },
      servingTier: 'L1',
      now: RECOVERED_AT,
    })
    expect(store._rows[ACK_SETTING_KEY]).toBeUndefined()
  })

  it('拿不到鉴权头（no-headers）同样不得丢弃证据', async () => {
    const { store, reporter } = makeNoTransport({
      fetcher: async () => ({ ok: true, status: 200, json: async () => ({}) }),
      getAuth: () => ({ url: 'https://ops.example.com', apiKey: '', getAccessToken: () => null }),
    })
    const r = await reporter.reportRecovered({ servingTier: 'L1', now: RECOVERED_AT })
    expect(r.skipped).toBe(true)
    expect(JSON.parse(store._rows[DEGRADATION_SETTING_KEY]).events.length).toBe(1)
  })

  it('区分 no-fetcher 与 no-headers：前者是接线漏了，不能被当成常态', async () => {
    const { reporter } = makeNoTransport()
    const events = []
    const probe = new OpsResilienceReporter({
      store: makeStore(),
      log: { ...LOG, notify: (...a) => events.push(a[1]) },
      now: () => RECOVERED_AT,
      getAuth: () => ({ url: 'https://ops.example.com', apiKey: 'k' }),
    })
    probe.recordFailure({ failureKind: 'timeout', servingTier: 'L2', now: Date.parse(DEGRADED_SINCE) })
    await probe.reportRecovered({ servingTier: 'L1', now: RECOVERED_AT })
    expect(events).toContain('degradation-report-skipped')
    expect(reporter).toBeTruthy()
  })

  it('degraded_since 必须是降级起点而非恢复时刻', async () => {
    const calls = []
    const store = makeStore()
    const reporter = new OpsResilienceReporter({
      store,
      log: LOG,
      fetcher: async (url, init) => { calls.push({ url, body: JSON.parse(init.body) }); return { ok: true, status: 200, json: async () => ({}) } },
      now: () => RECOVERED_AT,
      getAuth: () => ({ url: 'https://ops.example.com', apiKey: 'k' }),
      getClientId: () => 'client-1',
      getClientVersion: () => '2.1.0',
    })
    reporter.recordFailure({ failureKind: 'timeout', servingTier: 'L2', now: Date.parse(DEGRADED_SINCE) })
    await reporter.recordApplied({
      payload: { config_version: 7, config_hash: 'a1b2c3d4e5f60718' },
      servingTier: 'L1',
      now: RECOVERED_AT,
    })
    const ack = calls.find((c) => c.url.includes('runtime/ack'))
    expect(ack.body.degraded_since).toBeTruthy()
    expect(Date.parse(ack.body.degraded_since)).toBe(DEGRADED_SINCE_MS)
    // 反向自证：不是恢复时刻
    expect(Date.parse(ack.body.degraded_since)).not.toBe(RECOVERED_AT)
  })
})
