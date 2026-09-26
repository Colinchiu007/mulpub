// @ts-check
import fs from 'node:fs'
import path from 'node:path'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { createCloudAccountSync } from './cloud-account-sync'

// 超时原语已拆到 ./cloud-account-core，测试的引用跟着代码走（不留在编排器上留兼容出口）
import { raceWithTimeout, TIMEOUT_SENTINEL } from './cloud-account-core'

const SUBJECT = 'sub-owner-a'

function cred (value) {
  return { platform: 'douyin', cookies: [{ name: 'sessionid', value, domain: '.douyin.com', path: '/' }], localStorage: {}, indexedDB: {} }
}

function makeFixture (overrides = {}) {
  const calls = []
  const events = []
  const accounts = overrides.accounts || []
  const deps = {
    AccountManager: {
      listAccounts: vi.fn(async () => accounts),
      addAccount: vi.fn(async (payload) => { calls.push({ path: 'addAccount', payload }); return { code: 0, data: { id: 'new-id-1' } } }),
      persistLoginState: vi.fn(async (accountId, patch) => { calls.push({ path: 'persistLoginState', accountId, patch }); return { code: 0 } }),
    },
    credentialStore: {
      loadCredential: vi.fn((accountId) => {
        const map = overrides.credentials || {}
        if (accountId in map) return map[accountId]
        return cred('local-' + accountId)
      }),
      saveCredential: vi.fn(async (accountId, c) => { calls.push({ path: 'saveCredential', accountId, credential: c }) }),
    },
    fetchAccountInfo: overrides.fetchAccountInfo || (async (platform) => ({ supported: true, platformAccountId: 'uid-' + platform })),
    // 冲突裁决的检测必须能逐次给出不同结论，否则无法区分「较新但失效」
    checkLogin: overrides.checkLogin || (async () => ({ supported: true, valid: true, code: 'CHECK_LOGIN_SUCCESS_HTTP_API' })),
    apiClient: { request: vi.fn(async (o) => { calls.push({ kind: 'api', ...o }); return overrides.respond ? overrides.respond(o) : {} }) },
    broadcast: (p) => events.push(p),
    queueLoginCheck: vi.fn(async () => {}),
    userDataDir: '/tmp/fake-userdata',
    env: overrides.env || {},
    now: () => 1700000000000,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  }
  return { deps, calls, events, service: createCloudAccountSync(deps) }
}

describe('账号云同步 —— 摘要', () => {
  it('云端可达时如实返回条数与平台分布', async () => {
    const { service } = makeFixture({
      accounts: [{ id: 'a1', platform: 'douyin', name: '甲' }],
      respond: (o) => (o.method === 'GET' ? { total: 7, byPlatform: [{ platform: 'douyin', count: 7 }], tombstones: 1 } : {}),
    })
    const res = await service.digest(SUBJECT)
    expect(res.data).toMatchObject({ total: 7, tombstones: 1, localCount: 1, reachable: true, errorCode: null })
    expect(res.data.byPlatform).toEqual([{ platform: 'douyin', count: 7 }])
  })

  it('云端不可达时不得伪装成「云端 0 个」', async () => {
    const { service } = makeFixture({
      accounts: [{ id: 'a1', platform: 'douyin', name: '甲' }],
      respond: () => { throw Object.assign(new Error('boom'), { code: 'MEMBER_API_REQUEST_FAILED' }) },
    })
    const res = await service.digest(SUBJECT)
    expect(res.data.reachable).toBe(false)
    expect(res.data.errorCode).toBe('MEMBER_API_REQUEST_FAILED')
    // 不可达 → 界面必须走"无法获取"分支，而不是显示共 0 个
    expect(res.data.byPlatform).toEqual([])
    expect(res.data.tombstones).toBe(0)
  })

  it('摘要失败不影响本机计数上报', async () => {
    const { service } = makeFixture({
      accounts: [{ id: 'a1', platform: 'zhihu', name: '乙' }, { id: 'a2', platform: 'zhihu', name: '丙' }],
      respond: () => { throw new Error('down') },
    })
    const res = await service.digest(SUBJECT)
    expect(res.data.localCount).toBe(2)
  })
})

describe('账号云同步 —— 上行与分池', () => {
  it('created/updated/unchanged 计数来自服务端逐条裁决', async () => {
    const { service, calls } = makeFixture({
      accounts: [
        { id: 'a1', platform: 'douyin', name: '甲', platform_account_id: 'u1' },
        { id: 'a2', platform: 'toutiao', name: '乙', platform_account_id: 'u2' },
        { id: 'a3', platform: 'bilibili', name: '丙', platform_account_id: 'u3' },
      ],
      respond: (o) => {
        if (o.method === 'GET') return { accounts: [], tombstones: [], total: 0 }
        if (o.method === 'PUT') {
          return { results: o.body.accounts.map((a, i) => ({ platform: a.platform, platformUid: a.platformUid, outcome: ['created', 'updated', 'unchanged'][i] })) }
        }
        return {}
      },
    })
    const res = await service.sync(SUBJECT)
    expect(res.data).toMatchObject({ created: 1, updated: 1, unchanged: 1, failed: 0 })
    const put = calls.find((c) => c.kind === 'api' && c.method === 'PUT')
    expect(put.body.accounts).toHaveLength(3)
  })

  it('取不到平台原生 uid 的账号一律不上行，且不拿昵称凑键', async () => {
    const f = makeFixture({
      accounts: [{ id: 'a1', platform: 'kuaishou', name: '快手，记录世界 记录你' }],
      // 平台 user-info 响应里没有 uid —— 脏名不可当身份
      fetchAccountInfo: async () => ({ supported: true }),
      respond: (o) => (o.method === 'GET' ? { accounts: [], tombstones: [] } : { results: [] }),
    })
    const res = await f.service.sync(SUBJECT)
    expect(res.data.uidUnavailable).toBe(1)
    expect(res.data.created).toBe(0)
    expect(f.calls.some((c) => c.kind === 'api' && c.method === 'PUT')).toBe(false)
    expect(res.data.items[0]).toMatchObject({ outcome: 'uid-unavailable', code: 'ACCOUNT_UID_INVALID' })
  })

  it('本机无凭证的账号不上行并如实失败，不冒充可发布', async () => {
    const f = makeFixture({
      accounts: [{ id: 'a1', platform: 'douyin', name: '甲', platform_account_id: 'u1' }],
      credentials: { a1: { cookies: [], localStorage: {}, indexedDB: {} } },
      respond: (o) => (o.method === 'GET' ? { accounts: [], tombstones: [] } : { results: [] }),
    })
    const res = await f.service.sync(SUBJECT)
    expect(res.data.failed).toBe(1)
    expect(res.data.items[0]).toMatchObject({ outcome: 'failed', code: 'CHECK_LOGIN_NO_CREDENTIAL' })
  })

  it('命中云端墓碑的账号被跳过且不 PUT', async () => {
    const { service } = makeFixture({
      accounts: [{ id: 'a1', platform: 'douyin', name: '甲', platform_account_id: 'u1' }],
      respond: (o) => (o.method === 'GET'
        ? { accounts: [], tombstones: [{ platform: 'douyin', platformUid: 'u1', deletedAt: '2026-01-01T00:00:00.000Z' }] }
        : { results: [] }),
    })
    const res = await service.sync(SUBJECT)
    expect(res.data.skipped).toBe(1)
    expect(res.data.items[0].outcome).toBe('skipped-tombstone')
  })

})

describe('账号云同步 —— 恢复到本机', () => {
  it('恢复出的账号必须 unverified 且不继承云端结论', async () => {
    const f = makeFixture({
      accounts: [],
      respond: (o) => {
        if (o.method === 'GET') return { accounts: [{ platform: 'douyin', platformUid: 'u9', displayName: '云端号', status: 'active', lastValidated: '2026-01-01T00:00:00.000Z' }], tombstones: [] }
        if (o.path === '/api/v1/me/accounts/sync') return { credentials: [{ platform: 'douyin', platformUid: 'u9', credential: cred('from-cloud') }] }
        return { results: [] }
      },
    })
    const res = await f.service.sync(SUBJECT)
    expect(res.data.restored).toBe(1)

    const add = f.calls.find((c) => c.path === 'addAccount')
    expect(add.payload).toMatchObject({ platform: 'douyin', name: '云端号', loginVerified: false })
    // 云端回传的 active 绝不被带入本机
    expect(add.payload.status).toBeUndefined()

    const saved = f.calls.find((c) => c.path === 'saveCredential')
    expect(saved.accountId).toBe('new-id-1')
    const persisted = f.calls.find((c) => c.path === 'persistLoginState')
    expect(persisted.patch).toMatchObject({ status: 'unverified', validationOrigin: 'restored' })
    expect(f.calls.indexOf(saved)).toBeLessThan(f.calls.indexOf(persisted))
    expect(f.deps.queueLoginCheck).toHaveBeenCalledWith('new-id-1', { platform: 'douyin', reason: 'cloud-restored' })
  })

  it('凭证未落盘时不得声称恢复成功，也不得写登录态', async () => {
    const f = makeFixture({
      accounts: [],
      respond: (o) => {
        if (o.method === 'GET') return { accounts: [{ platform: 'douyin', platformUid: 'u9', displayName: '云端号' }], tombstones: [] }
        if (o.path === '/api/v1/me/accounts/sync') return { credentials: [{ platform: 'douyin', platformUid: 'u9', credential: cred('from-cloud') }] }
        return { results: [] }
      },
    })
    f.deps.credentialStore.saveCredential = vi.fn(async () => { throw new Error('disk full') })
    const res = await f.service.sync(SUBJECT)
    expect(res.data.restored).toBe(0)
    expect(res.data.failed).toBe(1)
    expect(res.data.items[0].code).toBe('CREDENTIAL_PERSIST_FAILED')
    expect(f.calls.some((c) => c.path === 'persistLoginState')).toBe(false)
  })

  it('恢复后自动检测无定论时不写负结论（单向证据规则由服务侧保证不越权）', async () => {
    const f = makeFixture({
      accounts: [],
      respond: (o) => {
        if (o.method === 'GET') return { accounts: [{ platform: 'douyin', platformUid: 'u9' }], tombstones: [] }
        if (o.path === '/api/v1/me/accounts/sync') return { credentials: [{ platform: 'douyin', platformUid: 'u9', credential: cred('c') }] }
        return { results: [] }
      },
    })
    await f.service.sync(SUBJECT)
    // 服务自己只写 unverified（恢复即无本机结论），不写 active/expired
    const patch = f.calls.find((c) => c.path === 'persistLoginState').patch
    expect(patch.status).toBe('unverified')
  })
})

describe('账号云同步 —— 凭证冲突四分支', () => {
  const conflictFixture = (opts) => makeFixture({
    accounts: [{ id: 'a1', platform: 'douyin', name: '甲', platform_account_id: 'u1' }],
    credentials: { a1: cred('local-val') },
    checkLogin: opts.checkLogin,
    respond: (o) => {
      if (o.method === 'GET') return { accounts: [{ platform: 'douyin', platformUid: 'u1', displayName: '甲' }], tombstones: [] }
      if (o.path === '/api/v1/me/accounts/sync') return { credentials: [{ platform: 'douyin', platformUid: 'u1', credential: cred('cloud-val') }] }
      if (o.method === 'PUT') return { results: [{ platform: 'douyin', platformUid: 'u1', outcome: 'conflict', credentialFreshness: opts.freshness }] }
      return {}
    },
  })

  it('较新但失效的云端凭证不得覆盖有效本机凭证', async () => {
    const f = conflictFixture({
      freshness: 'cloud',
      checkLogin: async (platform, cookies) => ({ supported: true, valid: cookies[0].value === 'local-val' }),
    })
    const res = await f.service.sync(SUBJECT)
    const item = res.data.items.find((i) => String(i.outcome).startsWith('conflict') || i.outcome === 'invalid-credential')
    expect(item.outcome).toBe('conflict-resolved-local')
    expect(f.deps.credentialStore.saveCredential).not.toHaveBeenCalled()
  })

  it('云端凭证有效且更新时覆盖本机并强制本机自证', async () => {
    const f = conflictFixture({
      freshness: 'cloud',
      checkLogin: async (platform, cookies) => ({ supported: true, valid: cookies[0].value === 'cloud-val' }),
    })
    const res = await f.service.sync(SUBJECT)
    expect(res.data.items.find((i) => i.outcome === 'conflict-resolved-cloud')).toBeTruthy()
    const saved = f.calls.find((c) => c.path === 'saveCredential')
    expect(saved.credential.cookies[0].value).toBe('cloud-val')
    const persisted = f.calls.find((c) => c.path === 'persistLoginState')
    expect(persisted.patch.status).toBe('unverified')
  })

  it('两份都明确失效时保留本机凭证并标需重新登录', async () => {
    const f = conflictFixture({
      freshness: 'local',
      checkLogin: async () => ({ supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }),
    })
    const res = await f.service.sync(SUBJECT)
    expect(res.data.invalid).toBe(1)
    expect(res.data.items.find((i) => i.outcome === 'invalid-credential')).toBeTruthy()
    expect(f.deps.credentialStore.saveCredential).not.toHaveBeenCalled()
  })

  it('两份都无定论时保留本机且不写任何负结论', async () => {
    const f = conflictFixture({
      freshness: 'local',
      checkLogin: async () => ({ supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }),
    })
    const res = await f.service.sync(SUBJECT)
    expect(res.data.items.find((i) => i.outcome === 'conflict-unresolved')).toBeTruthy()
    expect(res.data.invalid).toBe(0)
    expect(f.calls.some((c) => c.path === 'persistLoginState')).toBe(false)
  })
})

describe('账号云同步 —— 进度边界与并发合同', () => {
  it('每条账号在检测体执行前收到 start、终态收到 done（双边界）', async () => {
    const f = makeFixture({
      accounts: [{ id: 'a1', platform: 'douyin', name: '甲', platform_account_id: 'u1' }],
      respond: (o) => (o.method === 'GET' ? { accounts: [], tombstones: [] } : { results: [{ platform: 'douyin', platformUid: 'u1', outcome: 'created' }] }),
    })
    await f.service.sync(SUBJECT)
    const phases = f.events.map((e) => e.phase)
    expect(phases[0]).toBe('start')
    expect(phases).toContain('done')
    expect(phases.indexOf('start')).toBeLessThan(phases.indexOf('done'))
    expect(f.events[0]).toMatchObject({ total: 1, platform: 'douyin' })
  })

  it('重入被拒：第二次 sync 返回 CLOUD_SYNC_IN_PROGRESS 且不发云请求', async () => {
    let release
    const gate = new Promise((r) => { release = r })
    const f = makeFixture({
      accounts: [{ id: 'a1', platform: 'douyin', name: '甲', platform_account_id: 'u1' }],
      respond: async (o) => {
        if (o.method === 'GET') { await gate; return { accounts: [], tombstones: [] } }
        return { results: [] }
      },
    })
    const first = f.service.sync(SUBJECT)
    const second = await f.service.sync(SUBJECT)
    expect(second.errorCode).toBe('CLOUD_SYNC_IN_PROGRESS')
    expect(second.code).toBe(409)
    release()
    await first
  })

  it('未登录身份由调用方拦截；成员服务缺失时 503 而非静默成功', async () => {
    const f = makeFixture({ accounts: [] })
    f.deps.apiClient = null
    const svc = createCloudAccountSync(f.deps)
    const res = await svc.sync(SUBJECT)
    expect(res.code).toBe(503)
    expect(res.errorCode).toBe('BUSINESS_USER_REPOSITORY_NOT_CONFIGURED')
  })

  it('断开云端必须显式 confirm', async () => {
    const f = makeFixture({ accounts: [] })
    expect((await f.service.disconnect(SUBJECT, '')).errorCode).toBe('DISCONNECT_CONFIRMATION_REQUIRED')
    const ok = await f.service.disconnect(SUBJECT, 'cloud')
    expect(ok.code).toBe(0)
    const call = f.calls.find((c) => c.kind === 'api' && c.body && c.body.confirm === 'cloud')
    expect(call.method).toBe('POST')
    expect(call.path).toBe('/api/v1/me/accounts/disconnect')
  })
})

describe('超时原语', () => {
  it('超时后原任务迟到的 reject 不产生 unhandledRejection', async () => {
    const unhandled = []
    const onRejection = (e) => unhandled.push(e)
    process.on('unhandledRejection', onRejection)
    try {
      let rejectLate
      const p = new Promise((_, rej) => { rejectLate = rej })
      const raced = await raceWithTimeout(p, 5, TIMEOUT_SENTINEL)
      expect(raced).toBe(TIMEOUT_SENTINEL)
      rejectLate(new Error('late'))
      await new Promise((r) => setTimeout(r, 20))
      expect(unhandled).toHaveLength(0)
    } finally {
      process.off('unhandledRejection', onRejection)
    }
  })

  it('环境变量非法值回落默认（并发 3 / 单账号 20s / 总预算 180s）', async () => {
    const f = makeFixture({
      accounts: [{ id: 'a1', platform: 'douyin', name: '甲', platform_account_id: 'u1' }],
      env: { MP_CLOUD_SYNC_CONCURRENCY: '0', MP_CLOUD_SYNC_ACCOUNT_TIMEOUT_MS: 'abc', MP_CLOUD_SYNC_TOTAL_TIMEOUT_MS: '99999999' },
      respond: (o) => (o.method === 'GET' ? { accounts: [], tombstones: [] } : { results: [{ platform: 'douyin', platformUid: 'u1', outcome: 'created' }] }),
    })
    const res = await f.service.sync(SUBJECT)
    expect(res.code).toBe(0)
    expect(res.data.created).toBe(1)
  })
})

beforeEach(() => { vi.clearAllMocks() })

describe('账号云同步 —— 进度行键（rowKey）', () => {
  it('恢复阶段 start 与 done 必须同一 rowKey，同平台多条不得挤成一行', async () => {
    // 回归：恢复项此刻还没有本机 accountId（正是这次恢复才创建），旧实现让 rowKeyOf 优先取 accountId，
    // 于是 start 落在 platform-index、done 落在 accountId，一条账号在界面上裂成两行，doneCount/百分比同时失真。
    const f = makeFixture({
      accounts: [],
      respond: (o) => {
        if (o.method === 'GET') return {
          accounts: [
            { platform: 'douyin', platformUid: 'u9', displayName: '云端甲', status: 'active' },
            { platform: 'douyin', platformUid: 'u8', displayName: '云端乙', status: 'active' },
          ],
          tombstones: [],
        }
        if (o.path === '/api/v1/me/accounts/sync') return { credentials: [
          { platform: 'douyin', platformUid: 'u9', credential: cred('c9') },
          { platform: 'douyin', platformUid: 'u8', credential: cred('c8') },
        ] }
        return { results: [] }
      },
    })
    const res = await f.service.sync(SUBJECT)
    expect(res.data.restored).toBe(2)

    const restoreEvents = f.events.filter((ev) => String(ev.rowKey || '').startsWith('restore:douyin:'))
    expect(restoreEvents.length).toBe(4) // 两条账号 x start/done
    const keys = [...new Set(restoreEvents.map((ev) => ev.rowKey))]
    expect(keys.sort()).toEqual(['restore:douyin:u8', 'restore:douyin:u9'])
    for (const key of keys) {
      const pair = restoreEvents.filter((ev) => ev.rowKey === key)
      expect(pair.map((ev) => ev.phase)).toEqual(['start', 'done'])
      // index 也必须逐条递增（旧实现恒为 0）
      expect(pair[0].index).toBe(pair[1].index)
      expect(pair[0].index).toBeGreaterThan(0)
    }
    // done 带回了新建的 accountId，但行键仍是 start 时那个，不因此改名
    const doneEvents = restoreEvents.filter((ev) => ev.phase === 'done')
    expect(doneEvents.every((ev) => ev.accountId)).toBe(true)
    expect(new Set(doneEvents.map((ev) => ev.rowKey))).toEqual(new Set(keys))
  })

  it('结构锁：源码里每个进度 send 都必须带 rowKey（防下一个出口又漏）', () => {
    // 与 cloud-account-tombstone.test.js 同一口径：测试 cwd = apps/desktop
    const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/services/cloud-account-sync.js'), 'utf8')
    const sends = src.match(/send\(\{\s*phase:\s*'(?:start|done)'[^}]*\}/gs) || []
    expect(sends.length).toBeGreaterThanOrEqual(7)
    const missing = sends.filter((snippet) => !/\browKey\b/.test(snippet))
    // 缺 rowKey 的具体事件直接列出来，别只报一个数字
    expect(missing.map((snippet) => snippet.replace(/\s+/g, ' ').slice(0, 90))).toEqual([])
  })
})
