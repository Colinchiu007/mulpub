// @ts-check
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { createCloudTombstoneRecorder } from './cloud-account-tombstone'

const SUBJECT = 'sub-owner-a'

function cred (value) {
  return { cookies: [{ name: 'sessionid', value, domain: '.douyin.com', path: '/' }], localStorage: {}, indexedDB: {} }
}

function makeDeps (overrides = {}) {
  const calls = []
  const deps = {
    credentialStore: {
      loadCredential: vi.fn(() => {
        const map = overrides.credentials || {}
        return map.douyin !== undefined ? map.douyin : cred('v')
      }),
    },
    fetchAccountInfo: overrides.fetchAccountInfo
      ? vi.fn(overrides.fetchAccountInfo)
      : vi.fn(async () => ({ supported: true, platformAccountId: 'uid-from-api' })),
    apiClient: { request: vi.fn(async (o) => { calls.push(o); return { code: 0 } }) },
    userDataDir: '/tmp/fake-userdata',
    log: { warn: vi.fn() },
  }
  return { deps, calls, recorder: createCloudTombstoneRecorder(deps) }
}

describe('云端墓碑登记（本机删除 → 阻止复活）', () => {
  it('真源已有 uid 时直接登记，不额外发平台请求', async () => {
    const f = makeDeps()
    const res = await f.recorder.record(SUBJECT, { id: 'a1', platform: 'douyin', platform_account_id: 'u1' })
    expect(res.recorded).toBe(true)
    expect(f.deps.fetchAccountInfo).not.toHaveBeenCalled()
    expect(f.calls[0]).toMatchObject({
      path: '/api/v1/me/accounts/tombstones',
      method: 'POST',
      body: { keys: [{ platform: 'douyin', platformUid: 'u1' }] },
    })
  })

  it('真源无 uid 时，用仍在本机的凭证调平台接口补齐 —— 这一步在删除后就不可能做到', async () => {
    const f = makeDeps()
    const res = await f.recorder.record(SUBJECT, { id: 'a1', platform: 'douyin', platform_account_id: '' })
    expect(f.deps.credentialStore.loadCredential).toHaveBeenCalledWith('a1', '/tmp/fake-userdata', SUBJECT)
    expect(f.deps.fetchAccountInfo).toHaveBeenCalledWith('douyin', expect.any(Array))
    expect(res.recorded).toBe(true)
    expect(f.calls[0].body.keys[0].platformUid).toBe('uid-from-api')
  })

  it('取不到 uid 时如实不登记，不猜一个值', async () => {
    const f = makeDeps({ fetchAccountInfo: async () => ({ supported: true }) })
    const res = await f.recorder.record(SUBJECT, { id: 'a1', platform: 'kuaishou' })
    expect(res).toEqual({ recorded: false, reason: 'UID_UNAVAILABLE' })
    expect(f.calls).toHaveLength(0)
  })

  it('云端不可达只留日志：绝不抛错、绝不因此回滚本机删除', async () => {
    const f = makeDeps()
    f.deps.apiClient.request = vi.fn(async () => { throw Object.assign(new Error('down'), { code: 'MEMBER_API_REQUEST_FAILED' }) })
    const res = await f.recorder.record(SUBJECT, { id: 'a1', platform: 'douyin', platform_account_id: 'u1' })
    expect(res).toEqual({ recorded: false, reason: 'POST_FAILED' })
    expect(f.deps.log.warn).toHaveBeenCalled()
  })

  it('未登录 / 无云客户端时静默跳过（本机删除仍要能成功）', async () => {
    const f = makeDeps()
    expect(await f.recorder.record(null, { id: 'a1', platform: 'douyin' })).toMatchObject({ reason: 'CLIENT_UNAVAILABLE' })
    const f2 = makeDeps()
    f2.deps.apiClient = null
    expect(await createCloudTombstoneRecorder(f2.deps).record(SUBJECT, { id: 'a1', platform: 'douyin' }))
      .toMatchObject({ reason: 'CLIENT_UNAVAILABLE' })
    expect(f2.calls).toHaveLength(0)
  })

  it('凭证读取失败也不冒泡（降级为 uid 缺失）', async () => {
    const f = makeDeps()
    f.deps.credentialStore.loadCredential = vi.fn(() => { throw new Error('locked') })
    const res = await f.recorder.record(SUBJECT, { id: 'a1', platform: 'douyin' })
    expect(res.recorded).toBe(false)
  })
})

describe('account:delete 的墓碑时序（源码结构锁）', () => {
  const src = fs.readFileSync(path.resolve(process.cwd(), 'electron/ipc-handlers/account.js'), 'utf8')

  it('墓碑登记必须出现在 AccountManager.deleteAccount 之前', () => {
    const handler = src.slice(src.indexOf("ipcMain.handle('account:delete'"))
    const recordAt = handler.indexOf('cloudTombstone.record(')
    const deleteAt = handler.indexOf('AccountManager.deleteAccount(accountId)')
    expect(recordAt).toBeGreaterThan(-1)
    expect(deleteAt).toBeGreaterThan(-1)
    // 反证位：把 record 挪到 delete 之后（或删除前置解析）时本条必须变红
    expect(recordAt).toBeLessThan(deleteAt)
  })

  it('墓碑失败路径必须走 warn 而不是 throw（本机删除是用户强意图）', () => {
    const handler = src.slice(src.indexOf("ipcMain.handle('account:delete'"))
    expect(handler).toContain("ipcLog('warn', 'account:delete', 'cloud-tombstone-skipped'")
    expect(handler).toContain("ipcLog('warn', 'account:delete', 'cloud-tombstone-error'")
  })
})

describe('跨包契约锁：会员白名单必须覆盖云账号全部路由', () => {
  // 今天真实发生过的漂移：桌面白名单放开 POST /disconnect，服务端却同时保留 DELETE + 请求头，
  // 两个会话在 6 分钟内把同一契约改来改去。方法集由两个不同包各自持有，只能靠这把锁绑死。
  it('CLOUD_ACCOUNTS_ROUTES 的每条 method+path 都在 ME_API_PATHS 白名单内', async () => {
    const { ME_API_PATHS } = await import('./identity/member-api-service.js')
    const { CLOUD_ACCOUNTS_ROUTES } = await import('../../../../packages/api-publish-engine/src/cloud-accounts/handlers.js')
    const missing = []
    for (const route of CLOUD_ACCOUNTS_ROUTES) {
      const [method, p] = route.split(' ')
      const entry = ME_API_PATHS.get(p)
      if (!entry || !entry.methods.includes(method)) missing.push(route)
    }
    expect(missing).toEqual([])
  })

  it('云账号路由清单必须含墓碑写入端点，且不含 DELETE', async () => {
    const { CLOUD_ACCOUNTS_ROUTES } = await import('../../../../packages/api-publish-engine/src/cloud-accounts/handlers.js')
    expect(CLOUD_ACCOUNTS_ROUTES).toContain('POST /api/v1/me/accounts/tombstones')
    expect(CLOUD_ACCOUNTS_ROUTES.filter((r) => r.startsWith('DELETE '))).toEqual([])
  })
})
