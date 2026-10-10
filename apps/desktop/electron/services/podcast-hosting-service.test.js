/**
 * podcast-hosting-service 行为合同（刀 2）
 *
 * 夹具纪律：
 * - 真实 registry + 真实频道服务 + 真实 fs（os.tmpdir() 唯一目录）；只有凭证与 HTTP 客户端注入替身。
 *   原因：本模块最重的四个错（空 secret 覆写有效凭证、发布期自锁、secret 泄漏进 index.json、
 *   index 写没 await 就报成功）都只在「凭证/网络可假、存储必须真」时才看得见。
 * - 发布用例一律走**真实 buildFeed**（先保存合法频道与一期），因为「发布时重建并校验」本身
 *   就是被验的行为：喂一份手搓的 feed.xml 会把这条链整段绕过。
 * - 忙标记/通行证必须用 `require` 取（主进程全链 CJS；ESM import 会拿到另一份模块实例，
 *   「两处读同一份」这类判据在那种夹具下结构性不可表示 —— 本仓已栽过一次）。
 * - 一律零出站：不注入 httpClient 时 `checkHosting` 必须如实回「未探测」。
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import os from 'os'
import path from 'path'
import crypto from 'crypto'

import PodcastHostingService, { HOSTING_ERRORS } from './podcast-hosting-service'
import PodcastChannelRegistry from './podcast-channel-registry'
import PodcastChannelService from './podcast-channel-service'

const { channelBusyGate, channelPublishPass } = require('./podcast-channel-locks')

const CHANNEL_ID = 'ch_host001'
const AK = 'LTAI5tExampleAccessKeyId'
const SK = 'superSecretValue0123456789'
const REF = 'podcast-hosting'
const noop = { info () {}, warn () {}, error () {} }

const VALID_CHANNEL = {
  title: '午间电台',
  description: '每天十分钟的科技闲聊',
  language: 'zh-CN',
  author: '老王',
  ownerEmail: 'oldwang@example.com',
  explicit: 'no',
  feedType: 'episodic',
  coverUrl: 'https://example.com/cover.png',
  coverSize: '3000x3000',
  categoryId: 'Technology/Podcasting',
}
const VALID_EPISODE = {
  title: '第一期：开场白',
  audioUrl: 'https://cdn.example.com/e1.mp3',
  durationSec: 1830,
  sizeBytes: 44000000,
  guid: 'guid-host-1',
  pubDate: '2026-10-01T08:00:00.000Z',
}

let root = ''
let store = null
let client = null
let puts = []
let registry = null
let channelService = null

function keyOf (ref, owner) {
  return ref + '@' + (owner === undefined ? 'legacy' : String(owner))
}

function makeStore (opts = {}) {
  const map = new Map()
  return {
    map,
    saveCredential: (ref, data, dir, owner) => {
      map.set(keyOf(ref, owner), data)
      return opts.saveResult !== false
    },
    loadCredential: (ref, dir, owner) => map.get(keyOf(ref, owner)) || null,
    deleteCredential: (ref, dir, owner) => map.delete(keyOf(ref, owner)),
    size: () => map.size,
  }
}

function makeClient (script) {
  return {
    put: async (url, body, opts) => {
      puts.push({ url, body, headers: (opts && opts.headers) || {} })
      const next = script.shift()
      if (next instanceof Error) throw next
      return { status: next }
    },
  }
}

function mk (opts = {}) {
  return new PodcastHostingService({
    registry,
    channelOf: () => channelService,
    credentialStore: store,
    ownerSubject: () => (opts.owner === undefined ? 'sub-1' : opts.owner),
    app: { getPath: () => root },
    logger: noop,
    httpClient: opts.noClient ? null : client,
    dateImpl: () => 'Wed, 01 Jan 2025 00:00:00 GMT',
    fsImpl: opts.fsImpl || fs,
  })
}

function fullPatch (over) {
  return Object.assign({
    provider: 'oss',
    endpoint: 'oss-cn-hangzhou.aliyuncs.com',
    bucket: 'pod',
    pathPrefix: 'feeds',
    accessKeyId: AK,
    accessKeySecret: SK,
  }, over || {})
}

/** 真源里备好「一份合法频道 + 一期合法单集」，buildFeed 才产得出东西。 */
function seedChannel (channelId) {
  const svc = new PodcastChannelService({ channelDir: registry.channelDir(channelId), channelId, logger: noop })
  svc.saveChannel(VALID_CHANNEL)
  svc.saveEpisode(VALID_EPISODE)
  return svc
}

beforeEach(() => {
  root = path.join(os.tmpdir(), 'mp-pod-host-' + process.pid + '-' + crypto.randomBytes(6).toString('hex'))
  fs.mkdirSync(root, { recursive: true })
  puts = []
  store = makeStore({})
  client = makeClient([200, 200])
  registry = new PodcastChannelRegistry({ podcastRoot: root, logger: noop, idFactory: () => CHANNEL_ID })
  channelService = seedChannel(CHANNEL_ID)
})

afterEach(() => {
  for (const row of channelBusyGate.snapshot()) channelBusyGate.end(row.channelId)
  fs.rmSync(root, { recursive: true, force: true })
})

describe('podcast-hosting-service · 凭证合并', () => {
  it('首次保存：凭证进加密存储，index.json 只有 ref 与掩码，逐字不含 AK/SK', async () => {
    const res = await mk().saveHosting(fullPatch())
    expect(res.hosting.configured).toBe(true)
    expect(res.hosting.maskedAccessKeyId).toBe('*'.repeat(AK.length - 4) + AK.slice(-4))
    const raw = fs.readFileSync(path.join(root, 'index.json'), 'utf8')
    expect(raw).not.toContain(SK)
    expect(raw).not.toContain(AK)
    expect(JSON.parse(raw).hosting.credentialRef).toBe(REF)
    expect(store.map.get(keyOf(REF, 'sub-1')).accessKeySecret).toBe(SK)
  })

  it('只改 bucket 不带 secret → 复用旧凭证再校验，不要求用户重输', async () => {
    await mk().saveHosting(fullPatch())
    const res = await mk().saveHosting({ bucket: 'pod2' })
    expect(res.hosting.bucket).toBe('pod2')
    expect(res.hosting.configured).toBe(true)
    expect(store.map.get(keyOf(REF, 'sub-1')).accessKeySecret).toBe(SK)
  })

  it('没有旧凭证又不带 secret → 拒绝，且目录不得被写成空凭证态', async () => {
    await expect(mk().saveHosting(fullPatch({ accessKeyId: undefined, accessKeySecret: undefined })))
      .rejects.toThrow(new RegExp(HOSTING_ERRORS.SECRET_MISSING))
    expect(registry.readHosting() || null).toBe(null)
    expect(store.size()).toBe(0)
  })

  it('secret 传空白串 = 缺席：不得把已存凭证静默换成空白（QM-6 后端评审命中）', async () => {
    await mk().saveHosting(fullPatch())
    const res = await mk().saveHosting({ bucket: 'pod2', accessKeySecret: '   ' })
    expect(res.hosting.bucket).toBe('pod2')
    expect(res.hosting.configured).toBe(true)
    expect(store.map.get(keyOf(REF, 'sub-1')).accessKeySecret).toBe(SK)
  })

  it('AK 只有空白且无旧凭证 → 仍判缺席并拒绝，不得落一次「已配置」的假成功', async () => {
    await expect(mk().saveHosting(fullPatch({ accessKeyId: '  ', accessKeySecret: '  ' })))
      .rejects.toThrow(new RegExp(HOSTING_ERRORS.SECRET_MISSING))
    expect(store.size()).toBe(0)
    expect(registry.readHosting() || null).toBe(null)
  })

  it('只换 AccessKeyId 不重填 Secret ⇒ 拒绝（新 AK 配旧 Secret 签名必然 403）', async () => {
    await mk().saveHosting(fullPatch())
    await expect(mk().saveHosting({ accessKeyId: AK + 'x' }))
      .rejects.toThrow(new RegExp(HOSTING_ERRORS.SECRET_MISSING))
    const kept = store.map.get(keyOf(REF, 'sub-1'))
    expect(kept.accessKeyId).toBe(AK)
    expect(kept.accessKeySecret).toBe(SK)
  })

  it('成对重填 AK 与 Secret ⇒ 允许，且落盘是新的那一双', async () => {
    await mk().saveHosting(fullPatch())
    const res = await mk().saveHosting({ accessKeyId: AK + 'x', accessKeySecret: SK + 'y' })
    expect(res.hosting.configured).toBe(true)
    const saved = store.map.get(keyOf(REF, 'sub-1'))
    expect(saved.accessKeyId).toBe(AK + 'x')
    expect(saved.accessKeySecret).toBe(SK + 'y')
  })

  it('clearSecret 才删除凭证；删除后 configured 必须转 false（不得仍显示「已配置」）', async () => {
    await mk().saveHosting(fullPatch())
    const res = await mk().saveHosting({ clearSecret: true })
    expect(res.hosting.configured).toBe(false)
    expect(res.hosting.credentialRef).toBe('')
    expect(store.size()).toBe(0)
  })

  it('身份为 null（有身份服务但认不出是谁）→ fail closed，凭证与目录一处都不写', async () => {
    await expect(mk({ owner: null }).saveHosting(fullPatch()))
      .rejects.toThrow(new RegExp(HOSTING_ERRORS.IDENTITY_REQUIRED))
    expect(store.size()).toBe(0)
    expect(registry.readHosting() || null).toBe(null)
  })

  it('加密落盘失败 → 拒绝并停止写目录，绝不留「ref 有、凭证无」的半态', async () => {
    store = makeStore({ saveResult: false })
    await expect(mk().saveHosting(fullPatch())).rejects.toThrow(new RegExp(HOSTING_ERRORS.CRYPTO_UNAVAILABLE))
    expect(registry.readHosting() || null).toBe(null)
  })

  it('字段不合格只走 validateHosting 一份判据：provider=cos 被拒且带 issues', async () => {
    try {
      await mk().saveHosting(fullPatch({ provider: 'cos' }))
      throw new Error('should have thrown')
    } catch (e) {
      expect(e.code).toBe(HOSTING_ERRORS.HOSTING_INVALID)
      expect(Array.isArray(e.issues)).toBe(true)
      expect(e.issues.length).toBeGreaterThan(0)
    }
  })
})

describe('podcast-hosting-service · 探测', () => {
  it('未注入 httpClient → 如实「未探测」，一次请求都不发出', async () => {
    await mk().saveHosting(fullPatch())
    const r = await mk({ noClient: true }).checkHosting()
    expect(r.checked).toBe(false)
    expect(r.reason).toBe('PODCAST_HOSTING_CHECK_SKIPPED')
    expect(r.hosting.configured).toBe(true)
    expect(puts).toHaveLength(0)
  })

  it('未配置凭证 → 「未配置」与「未探测」分两档（排障方向不同）', async () => {
    const r = await mk().checkHosting()
    expect(r.checked).toBe(false)
    expect(r.reason).toBe('PODCAST_HOSTING_NOT_CONFIGURED')
  })

  it('注入假 client → 真发一次探测请求并带回状态', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200])
    const r = await mk().checkHosting()
    expect(r).toMatchObject({ checked: true, ok: true, status: 200 })
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toContain('/_podcast-probe/probe-')
    expect(puts[0].url).not.toMatch(/\/probe\.txt$/)
  })

  it('探测键必须唯一：不得覆写用户 bucket 里的同名对象', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200, 200])
    await mk().checkHosting()
    await mk().checkHosting()
    expect(puts).toHaveLength(2)
    expect(puts[0].url).not.toBe(puts[1].url)
  })
})

describe('podcast-hosting-service · 发布 feed', () => {
  it('首次发布：没有上一版可退 ⇒ 只传主键一次，且如实标 backupCreated/prevExists 均为 false', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200])
    const res = await mk().publishFeed(CHANNEL_ID)
    expect(res.state).toBe('success')
    expect(puts).toHaveLength(1)
    expect(puts[0].url).toBe('https://pod.oss-cn-hangzhou.aliyuncs.com/feeds/' + CHANNEL_ID + '/feed.xml')
    expect(res.backupCreated).toBe(false)
    expect(res.prevExists).toBe(false)
    expect(channelBusyGate.isBusy(CHANNEL_ID)).toBe(false)
    expect(channelService.readFeedSync()).toMatchObject({ status: 'success', itemCount: 1 })
  })

  it('第二次发布：回滚点装的必须是**上一版**内容，不是本次产物（QM-6 后端评审命中）', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200])
    await mk().publishFeed(CHANNEL_ID)
    const feedPath = path.join(registry.channelDir(CHANNEL_ID), 'feed.xml')
    const prevPath = path.join(registry.channelDir(CHANNEL_ID), 'feed.prev.xml')
    const v1 = fs.readFileSync(feedPath, 'utf8')
    expect(v1).not.toContain('第二期')

    channelService.saveEpisode({
      id: 'ep-2', title: '第二期：新增', audioUrl: 'https://cdn.example.com/e2.mp3',
      durationSec: 120, sizeBytes: 2000, pubDate: '2026-10-11T08:00:00.000Z', episodeType: 'full',
    })
    client = makeClient([200, 200])
    const res = await mk().publishFeed(CHANNEL_ID)
    expect(puts).toHaveLength(3)
    expect(puts[1].url).toMatch(/\/feed\.[0-9T:.Z+-]+\.xml$/)
    expect(puts[2].url).toMatch(/\/feed\.xml$/)
    expect(res.itemCount).toBe(2)
    expect(res.prevExists).toBe(true)
    // 决定性断言：本地回滚点与云端存档都是上一版（旧实现在 buildFeed 之后才复制，这里会含"第二期"）
    expect(fs.readFileSync(prevPath, 'utf8')).toBe(v1)
    expect(fs.readFileSync(prevPath, 'utf8')).not.toContain('第二期')
    expect(fs.readFileSync(feedPath, 'utf8')).toContain('第二期')
  })

  it('有上一版但本地快照拷贝失败 ⇒ prevExists 仍为 true（不得谎称「首次发布」）', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200])
    await mk().publishFeed(CHANNEL_ID)
    const prevPath = path.join(registry.channelDir(CHANNEL_ID), 'feed.prev.xml')
    fs.rmSync(prevPath, { force: true })

    channelService.saveEpisode({
      id: 'ep-2', title: '第二期：新增', audioUrl: 'https://cdn.example.com/e2.mp3',
      durationSec: 120, sizeBytes: 2000, pubDate: '2026-10-11T08:00:00.000Z', episodeType: 'full',
    })
    client = makeClient([200])
    const base = puts.length
    // 只让「上一版存档」这一步失败：feed 目录里的旧版确实存在，但拷贝不出东西
    const brokenFs = Object.assign({}, fs, {
      copyFileSync () { const e = new Error('EBUSY: snapshot copy failed'); e.code = 'EBUSY'; throw e },
    })
    const res = await mk({ fsImpl: brokenFs }).publishFeed(CHANNEL_ID)
    // prevExists 的语义是「这一版之前有没有得退」，不是「快照有没有成功」；
    // 把两者混成一个值会让界面在真有旧版时说出「首次发布，还没有上一版」这种假陈述。
    expect(res.prevExists).toBe(true)
    expect(res.backupCreated).toBe(false)
    expect(puts.slice(base)).toHaveLength(1)
    expect(puts[base].url).toMatch(/\/feed\.xml$/)
    expect(res.state).toBe('success')
  })

  it('上一版存档必须走「临时文件 + 原子替换」，不得直接覆写 feed.prev.xml', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200])
    await mk().publishFeed(CHANNEL_ID)
    const dir = registry.channelDir(CHANNEL_ID)
    const prevPath = path.join(dir, 'feed.prev.xml')

    channelService.saveEpisode({
      id: 'ep-2', title: '第二期：新增', audioUrl: 'https://cdn.example.com/e2.mp3',
      durationSec: 120, sizeBytes: 2000, pubDate: '2026-10-11T08:00:00.000Z', episodeType: 'full',
    })
    const calls = []
    const spyFs = Object.assign({}, fs, {
      copyFileSync (from, to) { calls.push(['copy', path.basename(to)]); return fs.copyFileSync(from, to) },
      renameSync (from, to) { calls.push(['rename', path.basename(from), path.basename(to)]); return fs.renameSync(from, to) },
    })
    client = makeClient([200, 200])
    const res = await mk({ fsImpl: spyFs }).publishFeed(CHANNEL_ID)
    expect(res.prevExists).toBe(true)
    // 直接 copyFileSync(feedPath, prevPath) 在进程中途死掉时会留下半份 prev，
    // 而 prev 存在的唯一理由就是「出事时有一份能退回的」——撕裂的备份等于没有备份。
    const copy = calls.find((c) => c[0] === 'copy')
    const rename = calls.find((c) => c[0] === 'rename' && c[2] === 'feed.prev.xml')
    expect(copy).toBeTruthy()
    expect(copy[1]).not.toBe('feed.prev.xml')
    expect(rename).toBeTruthy()
    expect(fs.readFileSync(prevPath, 'utf8')).toContain('第一期')
    expect(fs.readFileSync(prevPath, 'utf8')).not.toContain('第二期')
    expect(fs.existsSync(copy[1] ? path.join(dir, copy[1]) : prevPath)).toBe(false)
  })

  it('成功：先建回滚点再覆盖主键，feedSync 落 success，发布结束后忙标记释放', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200])
    await mk().publishFeed(CHANNEL_ID)
    channelService.saveEpisode({
      id: 'ep-2', title: '第二期', audioUrl: 'https://cdn.example.com/e2.mp3',
      durationSec: 120, sizeBytes: 2000, pubDate: '2026-10-11T08:00:00.000Z', episodeType: 'full',
    })
    client = makeClient([200, 200])
    const res = await mk().publishFeed(CHANNEL_ID)
    expect(res.state).toBe('success')
    expect(puts).toHaveLength(3)
    expect(puts[1].url).toMatch(/\/feed\.[0-9T:.Z+-]+\.xml$/)
    expect(puts[2].url).toBe('https://pod.oss-cn-hangzhou.aliyuncs.com/feeds/' + CHANNEL_ID + '/feed.xml')
    expect(String(puts[2].headers.Authorization)).toMatch(/^OSS /)
    expect(res.itemCount).toBe(2)
    expect(res.backupCreated).toBe(true)
    expect(channelBusyGate.isBusy(CHANNEL_ID)).toBe(false)
    expect(channelService.readFeedSync()).toMatchObject({ status: 'success', itemCount: 2 })
  })

  it('主键 PUT 403 → failed，feedSync 记下错误码，任何输出都不出现 secret', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([403])
    const res = await mk().publishFeed(CHANNEL_ID)
    expect(res).toMatchObject({ state: 'failed', code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403 })
    expect(channelService.readFeedSync().status).toBe('failed')
    expect(JSON.stringify(res)).not.toContain(SK)
    expect(channelBusyGate.isBusy(CHANNEL_ID)).toBe(false)
  })

  it('写失败态 feedSync 自己也抛 ⇒ 仍回 failed 形状，不被不相干的码顶掉', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([403])
    const broken = {
      buildFeed: () => channelService.buildFeed(),
      writeFeedSync: () => { const e = new Error('PODCAST_STORE_CORRUPT: channel.json 坏了'); e.code = 'PODCAST_STORE_CORRUPT'; throw e },
      readFeedSync: () => channelService.readFeedSync(),
    }
    const saved = channelService.writeFeedSync
    channelService.writeFeedSync = broken.writeFeedSync
    let res
    try {
      res = await mk().publishFeed(CHANNEL_ID)
    } finally {
      channelService.writeFeedSync = saved
    }
    expect(res).toMatchObject({ state: 'failed', code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403 })
    expect(res.feedSync).toBe(null)
  })

  it('回滚点（上一版存档）传不出去不阻断发布，但必须可见（backupCreated:false）', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200])
    await mk().publishFeed(CHANNEL_ID)
    client = makeClient([500, 200])
    const res = await mk().publishFeed(CHANNEL_ID)
    expect(res.state).toBe('success')
    expect(res.backupCreated).toBe(false)
    expect(res.prevExists).toBe(true)
  })

  it('同频道已有发布在飞 → 立即拒绝，一次请求都不发出', async () => {
    await mk().saveHosting(fullPatch())
    expect(channelBusyGate.tryBegin(CHANNEL_ID, { reason: 'other' })).toBe(true)
    client = makeClient([200, 200])
    await expect(mk().publishFeed(CHANNEL_ID)).rejects.toThrow(/PODCAST_CHANNEL_BUSY/)
    expect(puts).toHaveLength(0)
  })

  it('发布自己写 feedSync 不得被自己的忙标记挡住；通行证只在同步作用域有效且异常必收回', async () => {
    await mk().saveHosting(fullPatch())
    client = makeClient([200, 200])
    await expect(mk().publishFeed(CHANNEL_ID)).resolves.toMatchObject({ state: 'success' })
    expect(channelPublishPass.size()).toBe(0)
    expect(() => channelPublishPass.run(CHANNEL_ID, () => { throw new Error('boom') })).toThrow(/boom/)
    expect(channelPublishPass.isPassed(CHANNEL_ID)).toBe(false)
    channelBusyGate.tryBegin(CHANNEL_ID, { reason: 'x' })
    expect(() => channelService.writeFeedSync({ status: 'failed' })).toThrow(/PODCAST_CHANNEL_BUSY/)
  })

  it('频道没配好 → buildFeed 的校验码逐条透出来（blocked），且不碰 OSS', async () => {
    await mk().saveHosting(fullPatch())
    const blank = new PodcastChannelService({ channelDir: registry.channelDir('ch_blank01'), channelId: 'ch_blank01', logger: noop })
    const svc = new PodcastHostingService({
      registry,
      channelOf: () => blank,
      credentialStore: store,
      ownerSubject: () => 'sub-1',
      app: { getPath: () => root },
      logger: noop,
      httpClient: client,
    })
    const err = await svc.publishFeed('ch_blank01').then(() => null, (e) => e)
    expect(err && err.code).toBe('PODCAST_FEED_INVALID')
    expect(Array.isArray(err.issues)).toBe(true)
    expect(err.issues.length).toBeGreaterThan(0)
    expect(puts).toHaveLength(0)
  })

  it('产物在 build 之后不见了 → 指名 FEED_NOT_BUILT，不得拿半份东西去覆盖公网 feed', async () => {
    await mk().saveHosting(fullPatch())
    const blindFs = Object.assign(Object.create(Object.getPrototypeOf(fs)), fs, {
      existsSync: () => false,
    })
    await expect(mk({ fsImpl: blindFs }).publishFeed(CHANNEL_ID))
      .rejects.toThrow(new RegExp(HOSTING_ERRORS.FEED_NOT_BUILT))
    expect(puts).toHaveLength(0)
  })

  it('未配置托管 → 指名缺托管，且不去碰 OSS', async () => {
    await expect(mk().publishFeed(CHANNEL_ID)).rejects.toThrow(/PODCAST_HOSTING_REQUIRED/)
    expect(puts).toHaveLength(0)
  })
})
