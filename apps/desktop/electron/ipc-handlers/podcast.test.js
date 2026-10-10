/**
 * podcast IPC handler 合同锁
 *
 * 三条不可让的判据：
 * ① envelope 键名逐字对齐 preload/composable 合同（错一个键渲染层静默拿到 undefined）；
 * ② 服务返回 false（删除时 id 不存在）不得被包成 removed:true——那是「界面显示已删除而库里没动」；
 * ③ 失败返回体不得携带用户未发布的标题/音频地址/xml 正文（日志与响应同纪律）。
 *
 * event 传 `{}`：未打包应用（app.isPackaged === false）+ vitest 环境下 withSenderCheck 走
 * 兼容分支放行（见 helpers._isTestEnv）。⛔ 该放行依赖 helpers 在 **load 期** 解构到的
 * `app` 是 mock 对象，所以必须先 `__enableElectronMock()` 再动态 import 本模块 ——
 * 静态 import 会被提升到 `__enableElectronMock()` 之前，helpers 就绑到真实 electron
 * （`require('electron')` 在纯 Node 下返回二进制路径字符串，`app` 变 undefined，
 * 所有 handler 统一回 AUTH_ERROR -3，而测试看起来像「合同键名错了」）。
 * 先例：`account-batch-check.test.js:34`。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

__enableElectronMock()

/** @type {any} */
let registerHandlers
/** @type {any} */
let unwrapObject
/** @type {any} */
let toIpcError

beforeEach(async () => {
  vi.resetModules()
  __electronMock.app.isPackaged = false
  const mod = await import('./podcast')
  registerHandlers = mod.default || mod
  unwrapObject = mod.unwrapObject
  toIpcError = mod.toIpcError
})

const EC = require('../core/error-codes').ERROR
const nodeFs = require('fs')
const nodeOs = require('os')
const nodePath = require('path')

function makeIpcMain () {
  const handlers = new Map()
  return {
    handlers,
    handle: (channel, fn) => handlers.set(channel, fn),
  }
}

function makeService (overrides = {}) {
  return {
    getChannel: vi.fn(() => ({ title: '午间电台' })),
    saveChannel: vi.fn((c) => Object.assign({ id: 'ch' }, c)),
    listEpisodes: vi.fn(() => [{ id: 'ep-1' }]),
    saveEpisode: vi.fn((e) => Object.assign({ updatedAt: 'now' }, e)),
    removeEpisode: vi.fn(() => true),
    buildFeed: vi.fn(() => ({ path: 'C:/tmp/feed.xml', itemCount: 2, bytes: 1234 })),
    verifyFeed: vi.fn(async () => ({ issues: [], checks: [{ name: 'parse', ok: true }], itemCount: 2 })),
    listEndpoints: vi.fn(() => [{ id: 'xiaoyuzhou' }]),
    episodeCap: vi.fn(() => 1000),
    readFeedSync: vi.fn(() => null),
    writeFeedSync: vi.fn((p) => Object.assign({ updatedAt: 'now' }, p)),
    ...overrides,
  }
}

async function invoke (ipcMain, channel, payload) {
  return ipcMain.handlers.get(channel)({}, payload)
}

function setup (overrides) {
  const ipcMain = makeIpcMain()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const service = makeService(overrides)
  registerHandlers(ipcMain, { podcastChannelService: service, log })
  return { ipcMain, service, log }
}

describe('podcast handler · 通道注册', () => {
  it('十七条通道全部注册（缺一条即渲染层拿到 "No handler registered"）', () => {
    const { ipcMain, service } = setup()
    expect([...ipcMain.handlers.keys()].sort()).toEqual([
      'podcast:channel:create', 'podcast:channel:get', 'podcast:channel:list',
      'podcast:channel:migrate:resolve', 'podcast:channel:rename',
      'podcast:channel:save', 'podcast:channel:setDefault',
      'podcast:endpoints:list', 'podcast:episode:list',
      'podcast:episode:remove', 'podcast:episode:save',
      'podcast:feed:build', 'podcast:feed:verify', 'podcast:feed:publish',
      'podcast:hosting:get', 'podcast:hosting:save', 'podcast:hosting:check',
    ].sort())
  })

  it('注册阶段不得触碰 userData：未注入服务时也能完成注册，第一次调用才惰性建服务', () => {
    const ipcMain = makeIpcMain()
    expect(() => registerHandlers(ipcMain, { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })).not.toThrow()
    expect(ipcMain.handlers.size).toBe(17)
  })
})

describe('podcast handler · 成功信封', () => {
  it('每条通道都回 { code:0, data:{…} }，键名与合同逐字一致', async () => {
    const { ipcMain, service } = setup()
    expect(await invoke(ipcMain, 'podcast:channel:get')).toEqual({ code: 0, data: { channel: { title: '午间电台' } } })
    expect(await invoke(ipcMain, 'podcast:episode:list')).toEqual({ code: 0, data: { episodes: [{ id: 'ep-1' }], cap: 1000, count: 1 } })
    // 评审 i2：分发端目录不再经「按频道构造」的 service，所以注入的假 service 一次都不该被调用
    const epRes = await invoke(ipcMain, 'podcast:endpoints:list')
    expect(Object.keys(epRes)).toEqual(['code', 'data'])
    expect(Object.keys(epRes.data)).toEqual(['endpoints'])
    expect(epRes.data.endpoints.length).toBeGreaterThan(0)
    expect(service.listEndpoints).not.toHaveBeenCalled()
    expect(await invoke(ipcMain, 'podcast:feed:build')).toEqual({ code: 0, data: { path: 'C:/tmp/feed.xml', itemCount: 2, bytes: 1234 } })
    const verified = await invoke(ipcMain, 'podcast:feed:verify')
    expect(verified).toEqual({ code: 0, data: { issues: [], checks: [{ name: 'parse', ok: true }], itemCount: 2 } })
    // xml 正文不得出现在任何返回值里（feed 里含用户未发布标题）
    expect(JSON.stringify(verified)).not.toContain('xml')
  })

  it('保存频道：两种载荷形状（对象本体 / {channel:…}）都收到同一个对象', async () => {
    const { ipcMain, service } = setup()
    await invoke(ipcMain, 'podcast:channel:save', { title: 'A' })
    await invoke(ipcMain, 'podcast:channel:save', { channel: { title: 'B' } })
    expect(service.saveChannel.mock.calls.map((c) => c[0])).toEqual([{ title: 'A' }, { title: 'B' }])
  })

  it('删除单集：字符串与 {id:…} 两种载荷都按 id 转交服务', async () => {
    const { ipcMain, service } = setup()
    await invoke(ipcMain, 'podcast:episode:remove', 'ep-1')
    await invoke(ipcMain, 'podcast:episode:remove', { id: 'ep-2' })
    expect(service.removeEpisode.mock.calls.map((c) => c[0])).toEqual(['ep-1', 'ep-2'])
  })
})

describe('podcast handler · 失败映射', () => {
  it('服务判定 false（id 不存在）→ NOT_FOUND，绝不回 removed:true', async () => {
    const { ipcMain } = setup({ removeEpisode: vi.fn(() => false) })
    const res = await invoke(ipcMain, 'podcast:episode:remove', 'missing')
    expect(res.code).toBe(EC.NOT_FOUND)
    expect(res.removed).toBeUndefined()
    expect(res.data).toBeUndefined()
  })

  it('空 id 直接拒绝，且不进服务（防把「没传参」变成「删掉了别的东西」）', async () => {
    const { ipcMain, service } = setup()
    const res = await invoke(ipcMain, 'podcast:episode:remove', '   ')
    expect(res.code).toBe(EC.VALIDATION_ERROR)
    expect(service.removeEpisode).not.toHaveBeenCalled()
  })

  it('校验失败：issues 原样透传，message 只含校验码，不含用户文本', async () => {
    const issues = [{ code: 'CHANNEL_TITLE_REQUIRED', field: 'title', message: '频道标题不能为空' }]
    const err = new Error('PODCAST_CHANNEL_INVALID: CHANNEL_TITLE_REQUIRED')
    err.code = 'PODCAST_CHANNEL_INVALID'
    err.issues = issues
    const { ipcMain, log } = setup({ saveChannel: vi.fn(() => { throw err }) })
    const res = await invoke(ipcMain, 'podcast:channel:save', { title: '用户的私密标题' })
    expect(res.code).toBe(EC.VALIDATION_ERROR)
    expect(res.issues).toEqual(issues)
    expect(JSON.stringify(res)).not.toContain('用户的私密标题')
    // 日志同样只记通道名 + 错误消息
    const logged = log.warn.mock.calls.map((c) => String(c[0])).join('|')
    expect(logged).toContain('[ipc:podcast] channel:save')
    expect(logged).not.toContain('用户的私密标题')
  })

  it('无 issues 的服务错误按码分档：损坏/超限/非法 → 校验错，其它 → 请求错', async () => {
    for (const [code, expected] of [
      ['PODCAST_STORE_CORRUPT', EC.VALIDATION_ERROR],
      ['PODCAST_EPISODES_FULL', EC.VALIDATION_ERROR],
      ['PODCAST_FEED_NOT_BUILT', EC.REQUEST_ERROR],
    ]) {
      const err = new Error(code)
      err.code = code
      expect(toIpcError(err).code).toBe(expected)
    }
  })

  it('按设计不带 issues 的领域错误（空数组）不得被归入 VALIDATION_ERROR（QM-6 后端 b2-2）', () => {
    // 空数组是 truthy，原判据 Array.isArray([]) 为真 ⇒ SECRET_MISSING 这类「意图上与字段不合格区分开」
    // 的错误被标成校验类。渲染层按 subCode 取文案所以用户无感，但分类本身在说谎：
    // 任何后续按 code 分流的逻辑（如「校验错就展开表单」）会走错方向。
    const err = new Error('PODCAST_HOSTING_SECRET_MISSING')
    err.code = 'PODCAST_HOSTING_SECRET_MISSING'
    err.issues = []
    const res = toIpcError(err)
    expect(res.code).toBe(EC.REQUEST_ERROR)
    expect(res.subCode).toBe('PODCAST_HOSTING_SECRET_MISSING')
    expect(res.issues).toBeUndefined()
  })
})

describe('podcast handler · unwrapObject 形状判据', () => {
  it('数组与非对象一律判缺失（交给服务/引擎出 CHANNEL_MISSING，不在本层另写判据）', () => {
    expect(unwrapObject([], 'channel')).toBeNull()
    expect(unwrapObject(null, 'channel')).toBeNull()
    expect(unwrapObject('x', 'channel')).toBeNull()
    expect(unwrapObject({ channel: ['a'] }, 'channel')).toBeNull()
    expect(unwrapObject({ title: 'A' }, 'channel')).toEqual({ title: 'A' })
  })
})


describe("podcast IPC · 评审 i2/i4 处置", () => {
  it("生产路径（不注入 service、payload 为空）也必须返回分发端目录，而不是恒抛 PODCAST_CHANNEL_ID_REQUIRED", async () => {
    const ipcMain = makeIpcMain()
    registerHandlers(ipcMain, { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    const res = await ipcMain.handlers.get("podcast:endpoints:list")({}, {})
    expect(res.code).toBe(0)
    expect(Array.isArray(res.data.endpoints)).toBe(true)
    expect(res.data.endpoints.length).toBeGreaterThan(0)
  })

  it("写入口走 assertChannelWritable、读入口只走 assertChannelExists（读写分档判据只在 registry 一份）", async () => {
    const dir = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), "mp-pod-ipcw-"))
    const writeId = "ch_wtest01"
    const readId = "ch_rtest01"
    for (const id of [writeId, readId]) nodeFs.mkdirSync(nodePath.join(dir, id), { recursive: true })
    const calls = []
    const registry = {
      assertChannelExists: (id) => { calls.push("read:" + id); return id },
      assertChannelWritable: (id) => { calls.push("write:" + id); return id },
      channelDir: (id) => nodePath.join(dir, id),
    }
    const ipcMain = makeIpcMain()
    registerHandlers(ipcMain, { podcastRegistry: registry, log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })
    await ipcMain.handlers.get("podcast:feed:build")({}, { channelId: writeId })
    await ipcMain.handlers.get("podcast:episode:list")({}, { channelId: readId })
    expect(calls).toEqual(["write:" + writeId, "read:" + readId])
    nodeFs.rmSync(dir, { recursive: true, force: true })
  })
})



describe('podcast IPC · 刀2 托管与发布（真服务 + 假凭证/假网络，端到端打通道）', () => {
  const nodeFs = require('fs')
  const nodeOs = require('os')
  const nodePath = require('path')
  const nodeCrypto = require('crypto')

  function makeHostingDeps (script) {
    const root = nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'mp-pod-ipch-'))
    const puts = []
    const client = { put: async (url, body, opts) => { puts.push({ url, headers: (opts && opts.headers) || {} }); const n = script.shift(); return { status: n } } }
    const store = {
      map: new Map(),
      saveCredential: (ref, data) => { store.map.set(ref, data); return true },
      loadCredential: (ref) => store.map.get(ref) || null,
      deleteCredential: (ref) => store.map.delete(ref),
    }
    const ipcMain = makeIpcMain()
    registerHandlers(ipcMain, {
      podcastUserDataDir: root,
      podcastIdFactory: () => 'ch_ipc0001',
      podcastHttpClient: client,
      podcastCredentialStore: store,
      identityService: { getState: () => ({ user: { sub: 'sub-ipc' } }) },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    })
    return { root, ipcMain, puts, store }
  }

  const CH = { title: '午间电台', description: '每天十分钟', language: 'zh-CN', author: '老王', ownerEmail: 'a@b.com', explicit: 'no', feedType: 'episodic', coverUrl: 'https://example.com/c.png', coverSize: '3000x3000', categoryId: 'Technology/Podcasting' }
  const EP = { title: '第一期', audioUrl: 'https://cdn.example.com/e1.mp3', durationSec: 600, sizeBytes: 1000, guid: 'g-ipc-1', pubDate: '2026-10-01T08:00:00.000Z' }

  async function seed (ctx) {
    await ctx.ipcMain.handlers.get('podcast:channel:create')({}, { name: '午间电台' })
    await ctx.ipcMain.handlers.get('podcast:channel:save')({}, { channelId: 'ch_ipc0001', channel: CH })
    await ctx.ipcMain.handlers.get('podcast:episode:save')({}, { channelId: 'ch_ipc0001', episode: EP })
  }

  it('hosting:save 成功信封只回掩码；index.json 逐字不含 AK/SK', async () => {
    const ctx = makeHostingDeps([])
    await seed(ctx)
    const saved = await ctx.ipcMain.handlers.get('podcast:hosting:save')({}, {
      hosting: { provider: 'oss', endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'pod', pathPrefix: 'feeds', accessKeyId: 'AKIDabcdefghij', accessKeySecret: 'SECRETxyz0123456789' },
    })
    expect(saved.code).toBe(0)
    expect(Object.keys(saved.data)).toEqual(['hosting'])
    expect(Object.keys(saved.data.hosting).sort()).toEqual(['configured', 'credentialRef', 'endpoint', 'maskedAccessKeyId', 'pathPrefix', 'provider', 'bucket', 'updatedAt'].sort())
    expect(saved.data.hosting.maskedAccessKeyId).toBe('*'.repeat(10) + 'ghij')
    expect(JSON.stringify(saved)).not.toContain('SECRETxyz0123456789')
    const raw = nodeFs.readFileSync(nodePath.join(ctx.root, 'podcast', 'index.json'), 'utf8')
    expect(raw).not.toContain('SECRETxyz0123456789')
    expect(raw).not.toContain('AKIDabcdefghij')
    const got = await ctx.ipcMain.handlers.get('podcast:hosting:get')({}, {})
    expect(got.data.hosting.configured).toBe(true)
    // 决定性一条：secret 必须落在**注入的那份**存储里。少了这条，credentialStore 没接线时
    // 测试会退回真实 credential-store —— 本机有系统凭据保护所以照绿，CI runner 上 DPAPI
    // 不可用直接 CRYPTO_UNAVAILABLE（`expected -1 to be +0`），两种环境差都会被误读成产品坏了。
    expect(ctx.store.map.get('podcast-hosting')).toBeTruthy()
    expect(ctx.store.map.get('podcast-hosting').accessKeySecret).toBe('SECRETxyz0123456789')
  })

  it('hosting:save 必须打到注入的凭证存储上（决定性接缝锁：真实存储不可达时如实失败）', async () => {
    // 上一段的正例断言在「接线被摘掉」时仍可能通过（本机有系统凭据保护，真实存储自己就成功了），
    // 所以它不构成接缝锁。这条把注入件设成「保存失败」，只有真的用到了注入件才会红：
    // CI runner 上 DPAPI 不可用 ⇒ 没有接线就是 CRYPTO_UNAVAILABLE（本轮实测的 -1），
    // 本机有 DPAPI ⇒ 没有接线会假成功。两种环境都必须被这条抓住。
    const ctx = makeHostingDeps([])
    await seed(ctx)
    ctx.store.saveCredential = () => false
    const saved = await ctx.ipcMain.handlers.get('podcast:hosting:save')({}, {
      hosting: { provider: 'oss', endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'pod', pathPrefix: 'feeds', accessKeyId: 'AKIDabcdefghij', accessKeySecret: 'SECRETxyz0123456789' },
    })
    expect(saved.code).not.toBe(0)
    expect(saved.subCode).toBe('PODCAST_HOSTING_CRYPTO_UNAVAILABLE')
    const idxPath = nodePath.join(ctx.root, 'podcast', 'index.json')
    const raw = nodeFs.existsSync(idxPath) ? nodeFs.readFileSync(idxPath, 'utf8') : ''
    expect(raw).not.toContain('credentialRef')
    nodeFs.rmSync(ctx.root, { recursive: true, force: true })
    nodeFs.rmSync(ctx.root, { recursive: true, force: true })
  })

  it('缺 channelId 的 feed:publish 不得打到 OSS；hosting 未配置时发布指名缺托管', async () => {
    const ctx = makeHostingDeps([200, 200])
    await seed(ctx)
    const noChan = await ctx.ipcMain.handlers.get('podcast:feed:publish')({}, {})
    expect(noChan.code).not.toBe(0)
    expect(noChan.subCode).toBe('PODCAST_CHANNEL_ID_REQUIRED')
    const noHost = await ctx.ipcMain.handlers.get('podcast:feed:publish')({}, { channelId: 'ch_ipc0001' })
    expect(noHost.subCode).toBe('PODCAST_HOSTING_REQUIRED')
    expect(ctx.puts).toHaveLength(0)
    nodeFs.rmSync(ctx.root, { recursive: true, force: true })
  })

  it('feed:publish 成功：信封键逐字对齐渲染层合同，且不含签名头', async () => {
    const ctx = makeHostingDeps([200, 200, 200])
    await seed(ctx)
    await ctx.ipcMain.handlers.get('podcast:hosting:save')({}, {
      hosting: { provider: 'oss', endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'pod', pathPrefix: 'feeds', accessKeyId: 'AKIDabcdefghij', accessKeySecret: 'SECRETxyz0123456789' },
    })
    // 第一次发布没有"上一版"可存档（只传主键）；第二次才有存档 + 主键两次 PUT。
    const first = await ctx.ipcMain.handlers.get('podcast:feed:publish')({}, { channelId: 'ch_ipc0001' })
    expect(first.code).toBe(0)
    expect(Object.keys(first.data).sort()).toEqual(['backupCreated', 'bytes', 'code', 'itemCount', 'prevExists', 'state', 'status', 'url'].sort())
    expect(first.data).toMatchObject({ state: 'success', prevExists: false })
    expect(ctx.puts).toHaveLength(1)
    const res = await ctx.ipcMain.handlers.get('podcast:feed:publish')({}, { channelId: 'ch_ipc0001' })
    expect(res.data).toMatchObject({ state: 'success', prevExists: true })
    expect(ctx.puts).toHaveLength(3)
    expect(JSON.stringify(res)).not.toContain('SECRETxyz0123456789')
    expect(JSON.stringify(res)).not.toContain('OSS ')
    nodeFs.rmSync(ctx.root, { recursive: true, force: true })
  })

  it('注册阶段不得建托管服务（惰性）：注册本身不触盘、不起服务', () => {
    const ipcMain = makeIpcMain()
    expect(() => registerHandlers(ipcMain, { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })).not.toThrow()
    expect(ipcMain.handlers.size).toBe(17)
  })
})
