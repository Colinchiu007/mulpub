/**
 * 出期宿主的接线锁（刀 3 第 3 片）：忙标记整链持有、outBase 由主进程算、取消能真的打断在途进程。
 *
 * 这个文件存在的理由，是前两片留下的两条**说谎的注释**：
 * · `podcast-hosting-service.publishAudio` 的头写着「锁归整条出期链」，而实现里一次都没取锁
 *   （QM-6 后端 ① W1）。下面的「整条链持锁」与「手工写者被挡在窗外」两条就是那句话的现场证据；
 *   取锁一旦退化成 no-op，红的正是这两条而不是别的用例。
 * · PRD §6.4 最初把取消写成「`cancelToken` 由渲染层持有引用」。IPC 是结构化克隆，
 *   引用过不去，照原话实现的取消按钮会静默失效。所以取消改走**第二条通道 + 主进程侧登记**，
 *   下面的 accepted / too_late / unknown 三态锁钉住的就是改后的合同。
 *
 * 接缝：只假宿主（fs / spawn / 频道服务），真跑 channelBusyGate、真跑编排层、
 * 真跑 extract 的判据链（降级→编码器→抽取→实测→stat 对账）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEpisodeHost } from './podcast-episode-host'
import { TTS_COMPOSE_ERRORS } from './podcast-tts-compose'
import { isCancellableAt } from './podcast-episode-publish'
import { episodeCancelRegistry, RUN_ID_RE } from './podcast-episode-cancel'
import { channelBusyGate } from './podcast-channel-locks'
import PodcastHostingService from './podcast-hosting-service'
import os from 'os'

const CHANNEL = 'ch_aaaaaaaaaaaa'
/**
 * 每次 makeHost 用**自己的** runId：登记表按 runId 键控，测试之间共用同一个 id 时，
 * 前一条用例的残留登记会把后一条直接顶成「重复发起」——于是第一条假红会级联成
 * 整片全红，且红的理由与断言的东西毫无关系（这次就撞上了）。
 */
let runSeq = 0
function nextRun () { return 'run' + String(++runSeq).padStart(6, '0') + 'x' }
const VIDEO = '/videos/final.mp4'

/** 假文件系统：文件内容按路径存，目录状态可查——收尾有没有真的删，看的就是这张表。 */
function makeFs () {
  const files = new Map([[VIDEO, 'video-bytes']])
  const dirs = new Set(['/videos'])
  const calls = { unlink: [], mkdir: [], rmdir: [] }
  return {
    files, dirs, calls,
    existsSync: (p) => files.has(p) || dirs.has(String(p).replace(/\\/g, '/')),
    mkdirSync: (p) => { dirs.add(String(p).replace(/\\/g, '/')); calls.mkdir.push(p) },
    readFileSync: (p) => files.get(p) || '',
    statSync: (p) => ({ size: (files.get(p) || '').length }),
    readdirSync: (d) => Array.from(files.keys()).filter((p) => p.startsWith(String(d))),
    unlinkSync: (p) => { calls.unlink.push(p); files.delete(p) },
    rmdirSync: (p) => { calls.rmdir.push(p); dirs.delete(String(p).replace(/\\/g, '/')) },
  }
}

/** 假频道服务：saveEpisode / buildFeed 记录被调用时「链上有没有持锁」——这是 W1 的唯一现场证据。 */
function makeChannelService (state = {}) {
  const seen = state.seen || []
  const svc = {
    seen,
    saveEpisode: (ep, opts) => {
      seen.push({ step: 'saveEpisode', busy: channelBusyGate.isBusy(CHANNEL), strict: opts && opts.strict })
      svc.lastEpisode = ep
      return Object.assign({ id: 'ep_1' }, ep)
    },
    buildFeed: () => {
      seen.push({ step: 'buildFeed', busy: channelBusyGate.isBusy(CHANNEL) })
      return { path: '/ch/feed.xml', itemCount: 3, bytes: 900 }
    },
    writeFeedSync: (r) => { state.feedSync = r; return r },
  }
  return svc
}

/**
 * 假 spawn：按 args 特征分辨三站（编码器探测 / 抽混音 / ffprobe 实测）。
 * `onMix` 钩子在抽混音那一站触发，用来模拟「用户在抽取期间点了取消」。
 */
function makeSpawn (state = {}) {
  const calls = []
  return {
    calls,
    impl: async (opts) => {
      calls.push({ command: opts.command, args: opts.args })
      const isCodecs = opts.args.includes('-codecs')
      if (isCodecs) return { code: 0, stdout: ' A -- libmp3lame         mp3\n', stderr: '' }
      const isProbe = String(opts.command).includes('ffprobe')
      if (isProbe) {
        if (state.probeFail) return { code: 1, stdout: '', stderr: 'broken' }
        return { code: 0, stdout: 'duration=12.5\nsize=2048\ncodec_type=audio\ncodec_name=libmp3lame\n', stderr: '' }
      }
      // 抽混音：把 kill 句柄交出去（宿主负责登记到取消登记处），必要时在这里模拟用户取消
      if (typeof state.onMix === 'function') await state.onMix(opts)
      if (state.mixKilled) { calls.push({ killed: true }); return { code: -1, stdout: '', stderr: 'killed' } }
      // 输出路径就是 ffmpeg 命令的最后一个参数——照它落盘，后面的 statSync 才有东西可量
      state.fs.files.set(opts.args[opts.args.length - 1], 'x'.repeat(2048))
      return { code: 0, stdout: '', stderr: '' }
    },
  }
}

function makeHost (overrides = {}) {
  const fs = makeFs()
  const seen = []
  const svc = makeChannelService({ seen })
  const spawn = makeSpawn({ fs, onMix: overrides.onMix, mixKilled: overrides.mixKilled, probeFail: overrides.probeFail })
  const puts = []
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const registry = {
    channelDir: () => '/ch',
    tryBeginPublish: (id, meta) => channelBusyGate.tryBegin(id, meta),
    endPublish: (id) => channelBusyGate.end(id),
    publishHolder: (id) => channelBusyGate.holder(id),
    isPublishing: (id) => channelBusyGate.isBusy(id),
    assertChannelWritable: () => {},
    assertChannelExists: () => {},
  }
  const hosting = {
    calls: [],
    getHosting: () => ({ configured: overrides.notConfigured ? false : true, credentialRef: 'ref_1' }),
    publishAudio: async (id, options) => {
      seen.push({ step: 'publishAudio', busy: channelBusyGate.isBusy(CHANNEL) })
      hosting.calls.push({ id, options })
      if (overrides.audioFail) { const e = new Error('boom'); e.code = 'PODCAST_HOSTING_UPLOAD_FAILED'; e.status = 403; throw e }
      // size 取自那份文件本身：三处一致校验量的就是「公网那份等于本地这一份」，
      // 夹具若回一个写死的常量，任何改素材长度的用例都会变成假红
      return {
        url: 'https://cdn.example/' + id + '/a.mp3',
        size: (fs.files.get(options.filePath) || '').length,
        objectKey: 'k', status: 200,
      }
    },
    publishFeed: async (id, options) => {
      seen.push({ step: 'publishFeed', busy: channelBusyGate.isBusy(CHANNEL), heldBy: (options || {}).heldBy })
      hosting.calls.push({ feedId: id, options })
      if (overrides.feedFail) return { state: 'failed', code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 500 }
      return { state: 'success', url: 'https://cdn.example/' + id + '/feed.xml', bytes: 900, itemCount: 3 }
    },
  }
  const runId = nextRun()
  const tmpRoot = '/tmp/podcast-test'
  const host = createEpisodeHost(Object.assign({
    registry,
    channelServiceOf: () => svc,
    hostingService: hosting,
    logger: log,
    fsImpl: fs,
    spawnImpl: spawn.impl,
    tmpRoot,
    findFfmpeg: () => '/bin/ffmpeg',
    findFfprobe: () => '/bin/ffprobe',
  }, overrides.hostDeps || {}))
  const payload = Object.assign({
    channelId: CHANNEL,
    runId,
    project: { segments: [{ id: 's1', audioMeta: { degraded: false } }] },
    videoPath: VIDEO,
    title: '第一期 · 开场',
  }, overrides.payload || {})
  return { host, fs, seen, svc, spawn, hosting, log, registry, payload, tmpRoot, puts, runId }
}

function resetGate () {
  for (const row of channelBusyGate.snapshot()) channelBusyGate.end(row.channelId)
}

beforeEach(() => { resetGate() })

describe('podcast-episode-host · 入参形状层（拒绝必须发生在任何出站与任何磁盘写之前）', () => {
  it.each([
    ['缺 channelId', { channelId: '' }],
    ['缺 project 或 segments', { project: undefined }],
    ['segments 不是数组', { project: { segments: 'x' } }],
    ['缺成片路径', { videoPath: '' }],
    ['空标题', { title: '   ' }],
    ['缺 runId', { runId: '' }],
    ['runId 形态非法（含遍历序列）', { runId: '../escape' }],
    ['runId 太短', { runId: 'abc' }],
  ])('%s ⇒ 拒绝，且一次 spawn 都不发、一次 PUT 都不发', async (_label, patch) => {
    const h = makeHost({ payload: patch })
    const err = await h.host.publishFromVideo(h.payload).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(String(err.code || '')).toMatch(/^PODCAST_/)
    expect(h.spawn.calls.length).toBe(0)
    expect(h.hosting.calls.length).toBe(0)
    expect(h.seen.length).toBe(0)
  })

  it('标题长度按码点判，不按 UTF-16 单元（emoji 按单元会少算，判据就成了假门禁）', async () => {
    const emoji201 = '🙂'.repeat(201)
    const h = makeHost({ payload: { title: emoji201 } })
    const err = await h.host.publishFromVideo(h.payload).catch((e) => e)
    expect(err.code).toBe('PODCAST_EPISODE_INVALID')
    expect(Array.from(emoji201).length).toBe(201)
    expect(emoji201.length).toBe(402)
    const ok = makeHost({ payload: { title: '🙂'.repeat(200) } })
    await expect(ok.host.publishFromVideo(ok.payload)).resolves.toMatchObject({ state: 'success' })
  })

  it('meta 只收白名单键，其余丢弃并出声（不得静默落盘成对外可见的坏字段）', async () => {
    const h = makeHost({ payload: { meta: { description: '简介', evilDir: '/etc', evilSize: 1, secret: 'x' } } })
    await h.host.publishFromVideo(h.payload)
    expect(h.svc.lastEpisode.description).toBe('简介')
    expect(Object.keys(h.svc.lastEpisode)).not.toContain('evilDir')
    expect(Object.keys(h.svc.lastEpisode)).not.toContain('secret')
    expect(JSON.stringify(h.svc.lastEpisode)).not.toContain('/etc')
    expect(String(h.log.warn.mock.calls.join(' '))).toMatch(/3/)
  })

  it('成片文件不存在 ⇒ PODCAST_VIDEO_NOT_FOUND（不得复用 EXTRACT_FAILED：那是两条排查方向）', async () => {
    const h = makeHost({ payload: { videoPath: '/videos/gone.mp4' } })
    const err = await h.host.publishFromVideo(h.payload).catch((e) => e)
    expect(err.code).toBe('PODCAST_VIDEO_NOT_FOUND')
    expect(h.spawn.calls.length).toBe(0)
  })
})

describe('podcast-episode-host · 整条链持频道忙标记（QM-6 ① W1 的现场证据）', () => {
  it('四个外发/落盘步每一步都发生在持锁期内', async () => {
    const h = makeHost()
    const r = await h.host.publishFromVideo(h.payload)
    expect(r.state).toBe('success')
    expect(h.seen.length).toBe(4)
    for (const step of h.seen) expect(step.busy).toBe(true)
    expect(h.seen.map((s) => s.step)).toEqual(['publishAudio', 'saveEpisode', 'buildFeed', 'publishFeed'])
  })

  it('链结束后锁必须释放（漏放＝该频道从此再也发不出去，而且不报错）', async () => {
    const h = makeHost()
    await h.host.publishFromVideo(h.payload)
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(false)
    expect(channelBusyGate.snapshot()).toEqual([])
    expect(h.host.cancelPublish(h.runId).outcome).toBe('unknown')
    const again = makeHost()
    await expect(again.host.publishFromVideo(again.payload)).resolves.toMatchObject({ state: 'success' })
  })

  it('失败与取消同样要释放：中途抛错不得把锁留在原地', async () => {
    const h = makeHost({ audioFail: true })
    await expect(h.host.publishFromVideo(h.payload)).rejects.toBeTruthy()
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(false)
    expect(h.host.cancelPublish(h.runId).outcome).toBe('unknown')
    const h2 = makeHost({ feedFail: true })
    await h2.host.publishFromVideo(h2.payload)
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(false)
  })

  it('同频道第二次发起立即拒绝（不排队），且被拒的一方不得在取消登记处留下条目', async () => {
    let release
    const gate = new Promise((res) => { release = res })
    const h = makeHost()
    let inAudio = false
    h.hosting.publishAudio = async () => { inAudio = true; await gate; return { url: 'https://cdn/a.mp3', size: 2048 } }
    let firstErr = null
    const first = h.host.publishFromVideo(h.payload).catch((e) => { firstErr = e; throw e })
    // 条件轮询而不是「await 一次」：本用例断言的是「上传已开始后取消不了」，
    // 前提必须是链**确实**停在这一站的 await 上，否则测的是另一个相位的窗口。
    for (let i = 0; i < 200 && !inAudio; i++) await new Promise((r) => setTimeout(r, 0))
    expect(inAudio, '第一条链必须已进到 uploadAudio（取消窗口的关闭点）').toBe(true)
    const h2 = makeHost()
    try {
      const err = await h2.host.publishFromVideo(h2.payload).catch((e) => e)
      // 先自证并发前提成立，再断言结论：否则「第一条其实已经失败并放了锁」会被读成
      // 「忙标记没生效」，而下一个人会去改生产代码。
      expect(firstErr, '第一条链必须仍在飞行中，否则这条用例没有并发前提').toBe(null)
      expect(err.code).toBe('PODCAST_CHANNEL_BUSY')
      // 取锁失败发生在登记之后，所以收尾必须把登记一并撤掉；漏撤＝这条 runId 从此永久占位
      // 跨模块状态一律走宿主的**公开出口**探，不直接 import 那个模块级单例：
      // 生产代码走 require、测试走 import，vitest 下这两条路径可以拿到两份实例
      // （本文件实测：宿主的登记确实发生过——锁凭证里带着 ep-<runId>——而测试侧读到的 size 恒为 0）。
      // 直接读单例的断言会把「我的探针没接上真源」读成「生产代码漏了收尾」，反过来更是装饰性门禁。
      expect(h2.host.cancelPublish(h2.runId).outcome).toBe('unknown')
      // 第一条仍在登记处：此刻相位已是 uploadAudio，所以这一探只会得到 too_late，不改动它的状态
      expect(h.host.cancelPublish(h.runId).outcome).toBe('too_late')
    } finally {
      release()
      await first
    }
    expect(h.host.cancelPublish(h.runId).outcome).toBe('unknown')
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(false)
  })

  it('手工写者在发布窗口内被挡住（这才是「锁归整条出期链」的用户侧含义）', async () => {
    const h = makeHost()
    let busyDuringChain = null
    h.svc.saveEpisode = (ep) => { busyDuringChain = channelBusyGate.isBusy(CHANNEL); return Object.assign({ id: 'ep_1' }, ep) }
    await h.host.publishFromVideo(h.payload)
    expect(busyDuringChain).toBe(true)
    // 链外：此刻手工写者可以进来（忙标记已释放），证明上面那个 true 不是恒真
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(false)
  })

  it('feed 步凭持锁凭证再入：真托管服务在整链持锁时不会死于自己的忙标记', async () => {
    const h = makeHost()
    const real = new PodcastHostingService({
      registry: h.registry,
      channelOf: () => h.svc,
      ownerSubject: () => 'sub_test',
      logger: { info () {}, warn () {}, error () {} },
      credentialStore: { loadCredential: () => null, saveCredential: () => false },
      httpClient: async () => ({ status: 200 }),
      fsImpl: Object.assign({}, h.fs, { existsSync: (p) => true }),
      dateImpl: (d) => d.toUTCString(),
      userDataDir: () => os.tmpdir(),
    })
    real.getHosting = () => ({ configured: true, endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'b', pathPrefix: 'podcast', credentialRef: 'ref_1' })
    real._readSecret = () => ({ accessKeyId: 'AK', accessKeySecret: 'SK', securityToken: '' })
    real._put = async (snapshot, objectKey, filePath) => ({
      size: objectKey.endsWith('feed.xml') ? 900 : (h.fs.files.get(filePath) || '').length, status: 200,
    })
    const host = createEpisodeHost({
      registry: h.registry,
      channelServiceOf: () => h.svc,
      hostingService: real,
      logger: h.log,
      fsImpl: h.fs,
      spawnImpl: h.spawn.impl,
      tmpRoot: h.tmpRoot,
      findFfmpeg: () => '/bin/ffmpeg',
      findFfprobe: () => '/bin/ffprobe',
    })
    const r = await host.publishFromVideo(h.payload)
    expect(r.state).toBe('success')
    expect(r.feedUrl).toContain('https://')
    // 真 publishFeed 走的仍是同一把锁：链内不被挡，链外照常拒第二次
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(false)
  })

  it('不传凭证时 publishFeed 照常自己取锁（不得让「口头声明已持锁」成为绕过忙标记的后门）', async () => {
    const h = makeHost()
    const real = new PodcastHostingService({
      registry: h.registry,
      channelOf: () => h.svc,
      ownerSubject: () => 'sub_test',
      logger: { info () {}, warn () {}, error () {} },
      credentialStore: { loadCredential: () => null, saveCredential: () => false },
      httpClient: async () => ({ status: 200 }),
      fsImpl: { existsSync: () => true, readFileSync: () => '', createReadStream: () => ({ on () {} }), statSync: () => ({ size: 1 }) },
      dateImpl: (d) => d.toUTCString(),
      userDataDir: () => os.tmpdir(),
    })
    real.getHosting = () => ({ configured: true, endpoint: 'oss-cn-hangzhou.aliyuncs.com', bucket: 'b', pathPrefix: 'podcast', credentialRef: 'ref_1' })
    real._readSecret = () => ({ accessKeyId: 'AK', accessKeySecret: 'SK', securityToken: '' })
    real._put = async () => ({ size: 900, status: 200 })
    channelBusyGate.tryBegin(CHANNEL, { reason: 'someone-else', token: 'other-token' })
    await expect(real.publishFeed(CHANNEL, { heldBy: 'wrong-token' })).rejects.toMatchObject({ code: 'PODCAST_CHANNEL_BUSY' })
    await expect(real.publishFeed(CHANNEL)).rejects.toMatchObject({ code: 'PODCAST_CHANNEL_BUSY' })
    // 被拒的一方不得把别人的锁放掉
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(true)
    resetGate()
  })
})

describe('podcast-episode-host · outBase 由主进程决定（渲染层没有「写到哪」的决定权）', () => {
  it('载荷里的 outBase 被忽略，实际落在 <tmpRoot>/episode-<runId>/ 下', async () => {
    const h = makeHost({ payload: { outBase: 'C:/Windows/System32/evil' } })
    h.spawn.impl = async (opts) => {
      if (opts.args.includes('-codecs')) return { code: 0, stdout: ' A -- libmp3lame\n', stderr: '' }
      if (String(opts.command).includes('ffprobe')) return { code: 0, stdout: 'duration=1\nsize=1\ncodec_type=audio\n', stderr: '' }
      h.mixArgs = opts.args
      h.fs.files.set(opts.args[opts.args.length - 1], 'x')
      return { code: 0, stdout: '', stderr: '' }
    }
    const host = createEpisodeHost({
      registry: h.registry, channelServiceOf: () => h.svc, hostingService: h.hosting,
      logger: h.log, fsImpl: h.fs, spawnImpl: h.spawn.impl, tmpRoot: h.tmpRoot,
      findFfmpeg: () => '/bin/ffmpeg', findFfprobe: () => '/bin/ffprobe',
    })
    await host.publishFromVideo(h.payload)
    const out = String(h.mixArgs[h.mixArgs.length - 1]).replace(/\\/g, '/')
    expect(out.startsWith('/tmp/podcast-test/episode-' + h.runId + '/')).toBe(true)
    expect(out).not.toMatch(/Windows|System32/)
  })

  it('临时产物在链结束时被逐个点名删除（不递归到父级目录）', async () => {
    const h = makeHost()
    h.spawn.impl = async (opts) => {
      if (opts.args.includes('-codecs')) return { code: 0, stdout: ' A -- libmp3lame\n', stderr: '' }
      if (String(opts.command).includes('ffprobe')) return { code: 0, stdout: 'duration=12.5\nsize=2048\ncodec_type=audio\n', stderr: '' }
      const out = opts.args[opts.args.length - 1]
      h.fs.files.set(out, 'x'.repeat(2048))
      return { code: 0, stdout: '', stderr: '' }
    }
    const host = createEpisodeHost({
      registry: h.registry, channelServiceOf: () => h.svc, hostingService: h.hosting,
      logger: h.log, fsImpl: h.fs, spawnImpl: h.spawn.impl, tmpRoot: h.tmpRoot,
      findFfmpeg: () => '/bin/ffmpeg', findFfprobe: () => '/bin/ffprobe',
    })
    await host.publishFromVideo(h.payload)
    expect(h.fs.calls.unlink.length).toBe(1)
    expect(String(h.fs.calls.unlink[0]).replace(/\\/g, '/').startsWith('/tmp/podcast-test/episode-' + h.runId + '/')).toBe(true)
    expect(h.fs.calls.rmdir.length).toBe(1)
    expect(h.fs.files.has(VIDEO)).toBe(true)
  })
})

describe('podcast-episode-host · 取消三态（IPC 传不了引用，所以取消是第二条通道）', () => {
  it('accepted：在抽取期间取消 → state=cancelled，且在途子进程真的被 kill', async () => {
    let killed = 0
    const h = makeHost()
    let host
    h.spawn.impl = async (opts) => {
      if (opts.args.includes('-codecs')) return { code: 0, stdout: ' A -- libmp3lame\n', stderr: '' }
      opts.registerKill(() => { killed += 1 })
      host.cancelPublish(h.runId) // 用户点取消走的是第二条通道，不是直接改 token
      opts.registerKill(null)
      return { code: -1, stdout: '', stderr: 'killed' }
    }
    host = createEpisodeHost({
      registry: h.registry, channelServiceOf: () => h.svc, hostingService: h.hosting,
      logger: h.log, fsImpl: h.fs, spawnImpl: (o) => h.spawn.impl(o), tmpRoot: h.tmpRoot,
      findFfmpeg: () => '/bin/ffmpeg', findFfprobe: () => '/bin/ffprobe',
    })
    const r = await host.publishFromVideo(h.payload)
    expect(r.state).toBe('cancelled')
    expect(killed).toBe(1)
    expect(r.phases.map((p) => p.phase)).toContain('extractMix')
    expect(h.hosting.calls.length).toBe(0)
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(false)
  })

  it('too_late：上传已开始后不再接受取消，且**不置位**（置位等于把既成事实说成用户不要了）', async () => {
    const h = makeHost()
    let cancelOutcome = null
    h.hosting.publishAudio = async (id) => {
      cancelOutcome = h.host.cancelPublish(h.runId)
      return { url: 'https://cdn/x.mp3', size: 2048 }
    }
    const r = await h.host.publishFromVideo(h.payload)
    expect(cancelOutcome.outcome).toBe('too_late')
    expect(cancelOutcome.phase).toBe('uploadAudio')
    expect(r.state).toBe('success')
  })

  it('unknown：未登记的 runId 不得被读成「已取消」', async () => {
    const h = makeHost()
    expect(h.host.cancelPublish('never-registered-x')).toEqual({ outcome: 'unknown', phase: '' })
  })

  it.each([
    ['编码器探测', 'encoders'],
    ['ffprobe 实测', 'probe'],
  ])('取消落在 %s 步 ⇒ 结果态仍是 cancelled，不得报成「ffmpeg 崩坏」或「实测失败」（QM-6 后端 Warning）', async (_label, step) => {
    const h = makeHost()
    let host
    h.spawn.impl = async (opts) => {
      const kind = opts.args.includes('-codecs') ? 'encoders'
        : (String(opts.command).includes('ffprobe') ? 'probe' : 'mix')
      if (kind === step) {
        opts.registerKill(() => {})
        host.cancelPublish(h.runId) // 用户在这一站的 await 上点取消
        return { code: 1, stdout: '', stderr: 'killed' }
      }
      if (kind === 'encoders') return { code: 0, stdout: ' A -- libmp3lame\n', stderr: '' }
      if (kind === 'mix') { h.fs.files.set(opts.args[opts.args.length - 1], 'x'.repeat(2048)); return { code: 0, stdout: '', stderr: '' } }
      return { code: 0, stdout: 'duration=12.5\nsize=2048\ncodec_type=audio\n', stderr: '' }
    }
    host = createEpisodeHost({
      registry: h.registry, channelServiceOf: () => h.svc, hostingService: h.hosting,
      logger: h.log, fsImpl: h.fs, spawnImpl: (o) => h.spawn.impl(o), tmpRoot: h.tmpRoot,
      findFfmpeg: () => '/bin/ffmpeg', findFfprobe: () => '/bin/ffprobe',
    })
    const r = await host.publishFromVideo(h.payload)
    expect(r.state).toBe('cancelled')
    expect(r.message).toContain('取消')
    expect(h.hosting.calls.length).toBe(0)
  })

  it('反面对照（宿主层）：ffmpeg 真的崩坏且无人取消时，结果必须是异常而不是 cancelled', async () => {
    const h = makeHost()
    h.spawn.impl = async () => ({ code: 1, stdout: '', stderr: 'missing dll' })
    const host = createEpisodeHost({
      registry: h.registry, channelServiceOf: () => h.svc, hostingService: h.hosting,
      logger: h.log, fsImpl: h.fs, spawnImpl: (o) => h.spawn.impl(o), tmpRoot: h.tmpRoot,
      findFfmpeg: () => '/bin/ffmpeg', findFfprobe: () => '/bin/ffprobe',
    })
    const err = await host.publishFromVideo(h.payload).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('PODCAST_AUDIO_EXTRACT_FAILED')
    expect(err.state).toBeUndefined()
    expect(Array.isArray(err.publishPhases)).toBe(true)
  })

  it('取消窗口判据只在编排层一份：前三个相位可取消、后四个一律不可', () => {
    expect(['pickChannel', 'extractMix', 'probe'].map(isCancellableAt)).toEqual([true, true, true])
    expect(['uploadAudio', 'attach', 'buildFeed', 'uploadFeed'].map(isCancellableAt)).toEqual([false, false, false, false])
    // 未知相位与空串一律 false：登记处若把「读不到相位」当成「还能取消」，
    // 就会在一次已经外发的发布上接受取消并谎报「已回滚」。
    expect(isCancellableAt('')).toBe(false)
    expect(isCancellableAt('not-a-phase')).toBe(false)
    expect(isCancellableAt(undefined)).toBe(false)
  })
})

describe('podcast-episode-cancel · 登记表本身（runId 是键也是目录名，所以形态判据是边界不是装饰）', () => {
  it('runId 形态：8–64 位字母数字与 _-；遍历序列、空格、超长一律拒', () => {
    for (const bad of ['../x', 'short', 'a'.repeat(65), 'has space', '', null, undefined, '中文名']) {
      expect(RUN_ID_RE.test(String(bad == null ? '' : bad))).toBe(false)
    }
    expect(RUN_ID_RE.test('run00000001')).toBe(true)
    expect(() => episodeCancelRegistry.begin('../escape', { cancellableAt: () => true })).toThrow(/PODCAST_EPISODE_INVALID/)
  })

  it('同一 runId 不得重复登记（复用会把取消打到别人的链上）', () => {
    resetGate()
    const a = episodeCancelRegistry.begin('duprunid01', { cancellableAt: () => true })
    expect(() => episodeCancelRegistry.begin('duprunid01', { cancellableAt: () => true })).toThrow(/已有一次发布在飞/)
    episodeCancelRegistry.end('duprunid01')
    expect(episodeCancelRegistry.isRegistered('duprunid01')).toBe(false)
    void a
  })

  it('killRunning 只杀进程、不置位：超时不得在下一个采样点被读成「用户取消了」', () => {
    const t = episodeCancelRegistry.begin('killrun0001', { cancellableAt: () => true, initialPhase: 'extractMix' })
    let killed = 0
    episodeCancelRegistry.setKill(t, () => { killed += 1 })
    expect(episodeCancelRegistry.killRunning(t)).toBe(true)
    expect(killed).toBe(1)
    expect(t.cancelled).toBe(false)
    episodeCancelRegistry.end('killrun0001')
  })

  it('setPhase 未登记的 token 无效（防止已结束链的迟到回调把相位写回登记表）', () => {
    const t = episodeCancelRegistry.begin('phastrun01', { cancellableAt: () => true, initialPhase: 'pickChannel' })
    episodeCancelRegistry.setPhase(t, 'extractMix')
    expect(t.phase).toBe('extractMix')
    episodeCancelRegistry.end('phastrun01')
    episodeCancelRegistry.setPhase(t, 'uploadAudio')
    expect(t.phase).toBe('extractMix')
  })
})

describe('podcast-episode-host · 结果三态不压平', () => {
  it('partial：feed 上传失败时本地这一期仍在，状态与成因如实分开', async () => {
    const h = makeHost({ feedFail: true })
    const r = await h.host.publishFromVideo(h.payload)
    expect(r.state).toBe('partial')
    expect(r.episodeId).toBe('ep_1')
    expect(r.feedUrl).toBe('')
    expect(r.errorCode).toBe('PODCAST_HOSTING_UPLOAD_FAILED')
    expect(h.seen.some((s) => s.step === 'saveEpisode')).toBe(true)
  })

  it('partial 的成因同时带 message 与 status（真 adapter 的 403 必须进得了结果契约）', async () => {
    const h = makeHost()
    h.hosting.publishFeed = async () => ({ state: 'failed', code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403 })
    const r = await h.host.publishFromVideo(h.payload)
    expect(r.state).toBe('partial')
    expect(r.errorMessage).toContain('403')
  })

  it('音频上传抛错 ⇒ 原样上抛领域码，并带 publishPhases（不再有第二种字段名）', async () => {
    const h = makeHost({ audioFail: true })
    const err = await h.host.publishFromVideo(h.payload).catch((e) => e)
    expect(err.code).toBe('PODCAST_HOSTING_UPLOAD_FAILED')
    expect(Array.isArray(err.publishPhases)).toBe(true)
    expect(err.phases).toBeUndefined()
  })

  it('未配置托管 ⇒ PODCAST_HOSTING_REQUIRED，且一次 spawn 都不发（先拒配置再动素材）', async () => {
    const h = makeHost({ notConfigured: true })
    const err = await h.host.publishFromVideo(h.payload).catch((e) => e)
    expect(err.code).toBe('PODCAST_HOSTING_REQUIRED')
    expect(h.spawn.calls.length).toBe(0)
  })
})

describe('§6.4.2 出期进度通道（宿主是唯一发射点）', () => {
  it('每个相位都有 start 与 done 两个边界，且 cancellable 是主进程算出的布尔', async () => {
    const h = makeHost()
    const events = []
    await h.host.publishFromVideo(h.payload, { emitProgress: (e) => events.push(e) })
    const starts = events.filter((e) => e.state === 'start').map((e) => e.phase)
    const dones = events.filter((e) => e.state === 'done').map((e) => e.phase)
    expect(starts.length).toBeGreaterThanOrEqual(5)
    expect(starts).toContain('extractMix')
    expect(dones.length).toBe(starts.length)
    for (const p of starts) expect(dones).toContain(p)
    for (const e of events) {
      expect(typeof e.cancellable).toBe('boolean')
      expect(typeof e.phase).toBe('string')
      expect(e.phase.length).toBeGreaterThan(0)
      expect(e.runId).toBe(h.payload.runId)
    }
    // 链结束时最后一条必须是终态边界：界面靠它把遮罩从 running 收口
    expect(['done', 'skipped', 'failed', 'cancelled']).toContain(events[events.length - 1].state)
  })

  it('probe 的 done 边界带出实测三项——链中界面就要看到量到了什么，不是只看到转圈', async () => {
    const h = makeHost()
    const events = []
    await h.host.publishFromVideo(h.payload, { emitProgress: (e) => events.push(e) })
    const probeDone = events.find((e) => e.phase === 'probe' && e.state === 'done')
    expect(probeDone).toBeTruthy()
    expect(typeof probeDone.durationSec).toBe('number')
    expect(typeof probeDone.sizeBytes).toBe('number')
    expect(typeof probeDone.mime).toBe('string')
  })

  it('发送失败不得冒泡到出期链本身（进度是旁路，不是前置条件）', async () => {
    const h = makeHost()
    await expect(h.host.publishFromVideo(h.payload, {
      emitProgress: () => { throw new Error('sender destroyed') },
    })).resolves.toMatchObject({ state: 'success' })
  })

  it('phase 取值必须落在 PHASES 闭集并上 cancelled（§6.4.2 口径①与 §6.4 显示项合一后的闭集锁）', async () => {
    const h = makeHost()
    const events = []
    await h.host.publishFromVideo(h.payload, { emitProgress: (e) => events.push(e) })
    await h.host.publishFromVideo({ ...h.payload, videoPath: 'D:/v/不存在.mp4' }, { emitProgress: (e) => events.push(e) }).catch(() => {})
    const { PHASES } = require('./podcast-episode-publish')
    const allowed = PHASES.concat(['cancelled'])
    expect(events.length).toBeGreaterThan(0)
    for (const e of events) expect(allowed).toContain(e.phase)
  })

  it('不传 emitProgress 时整条链照旧成功（可选注入，旧调用形状不受影响）', async () => {
    const h = makeHost()
    await expect(h.host.publishFromVideo(h.payload)).resolves.toMatchObject({ state: 'success' })
  })

  it('失败链留下 failed 终态边界并带 subCode（否则界面停在最后一个 start，读起来像卡死）', async () => {
    const h = makeHost({ payload: { videoPath: 'D:/v/不存在.mp4' } })
    const events = []
    await h.host.publishFromVideo(h.payload, { emitProgress: (e) => events.push(e) }).catch(() => {})
    const last = events[events.length - 1]
    expect(last.state).toBe('failed')
    expect(typeof last.subCode).toBe('string')
    expect(last.subCode.length).toBeGreaterThan(0)
  })
})

/**
 * 刀 4 第 4 片：文本出期（tasks 4.3）。**只有 extractMix 这一站换了实现**——
 * `probe` 及之后逐字复用同一条编排链，所以这里的锁全部围绕三件事：
 * ① 计费确认是**同意闸门**，未确认即拒且零出站（TTS 花的是 provider 的钱，不是本地算力）；
 * ② 分块/音色/标题/正文的判据**只有 `podcast-tts-compose` 一份实现**，宿主不得另写；
 * ③ 忙标记、临时目录收尾、取消窗口、相位闭集与视频链完全同形。
 */
describe('podcast-episode-host · publishFromScript（文本出期：只换 extractMix 这一站）', () => {
  const CONTENT = '第一段口播正文，长度要足够一期节目使用，这里先补足到 compose 判据的下限之上。'
    + '第二段继续写：文本出期不依赖成片，音轨来源就是这段稿子逐块合成出来的。'
    + '第三段收尾，把内容推到一次真实节目该有的长度，避免触发内容过短的拒绝。'

  function scriptDeps (over = {}) {
    const calls = { tts: [], concat: 0, probe: 0 }
    const syn = {
      // 每块返回一个独立文件路径，交给假 concat 拼成 outBase
      generateTTS: async ({ text, index }) => {
        calls.tts.push({ text, index })
        if (over.ttsFail) { const e = new Error('provider down'); e.code = 'PODCAST_TTS_BLOCK_FAILED'; throw e }
        const p = '/tts/block-' + index + '.mp3'
        syn.fs.files.set(p, 'x'.repeat(1200))
        if (over.ttsDegraded) return { path: p, degraded: true }
        return { path: p, degraded: false }
      },
      concatBlocks: async (req) => {
        calls.concat++
        syn.fs.files.set(req.outPath, 'y'.repeat(2400))
        return { path: req.outPath, mime: 'audio/mpeg', gapInserted: false }
      },
      probeImpl: async () => {
        calls.probe++
        return { durationSec: 12.5, sizeBytes: 2400, mime: 'audio/mpeg' }
      },
    }
    syn.calls = calls
    return syn
  }

  function makeScriptHost (over = {}) {
    const syn = scriptDeps(over)
    const h = makeHost(Object.assign({}, over.hostOpts, {
      hostDeps: Object.assign({
        generateTTS: syn.generateTTS,
        concatBlocks: syn.concatBlocks,
        probeImpl: syn.probeImpl,
      }, over.hostDeps || {}),
    }))
    // 合成层要往 runDir 写块文件与成品，夹具的 fs 必须看得见这张表
    const orig = syn.generateTTS
    syn.fs = h.fs
    syn.generateTTS = (a) => orig(a)
    const payload = Object.assign({
      channelId: CHANNEL,
      runId: h.runId,
      title: '文字稿一期',
      copy: { content: CONTENT },
      billingConfirmed: true,
    }, over.payload || {})
    return Object.assign(h, { syn, scriptPayload: payload })
  }

  it('未确认计费 ⇒ PODCAST_TTS_BILLING_UNCONFIRMED，且一次 TTS、一次 spawn、一次 PUT 都不发', async () => {
    const h = makeScriptHost({ payload: { billingConfirmed: false } })
    const err = await h.host.publishFromScript(h.scriptPayload).catch((e) => e)
    expect(err).toBeInstanceOf(Error)
    expect(err.code).toBe('PODCAST_TTS_BILLING_UNCONFIRMED')
    expect(h.syn.calls.tts.length).toBe(0)
    expect(h.spawn.calls.length).toBe(0)
    expect(h.hosting.calls.length).toBe(0)
    expect(h.fs.calls.mkdir.length).toBe(0)
  })

  it('计费闸门先于内容判据：正文为空也不得把「未同意」报成「正文过短」', async () => {
    const h = makeScriptHost({ payload: { billingConfirmed: false, copy: { content: '' } } })
    const err = await h.host.publishFromScript(h.scriptPayload).catch((e) => e)
    expect(err.code).toBe('PODCAST_TTS_BILLING_UNCONFIRMED')
  })

  it.each([
    ['正文短于一期下限', TTS_COMPOSE_ERRORS.CONTENT_TOO_SHORT, { copy: { content: '太短' } }],
    ['标题为空', TTS_COMPOSE_ERRORS.TITLE_INVALID, { title: '   ' }],
    ['voiceRef 只给两段（三段必须同存或同缺）', TTS_COMPOSE_ERRORS.VOICE_REF_INCOMPLETE, { voiceRef: { providerId: 'p', model: 'm' } }],
    ['runId 形态非法', TTS_COMPOSE_ERRORS.RUN_ID_INVALID, { runId: '../escape' }],
  ])('%s ⇒ 拒绝，码逐字取自 podcast-tts-compose（宿主不另写一份也不重新映射）', async (_label, want, patch) => {
    const h = makeScriptHost({ payload: patch })
    const err = await h.host.publishFromScript(h.scriptPayload).catch((e) => e)
    expect(err.code).toBe(want)
    expect(Array.isArray(err.issues)).toBe(true)
    expect(err.issues.length).toBeGreaterThan(0)
    expect(h.syn.calls.tts.length).toBe(0)
    expect(h.hosting.calls.length).toBe(0)
  })

  it('缺三个注入实现之一 ⇒ 当场拒，且**发生在取锁与任何磁盘写之前**（不得退化成「换成视频链」或让合成层自己报错）', async () => {
    const h = makeHost({
      hostDeps: { generateTTS: (scriptDeps()).generateTTS, concatBlocks: (scriptDeps()).concatBlocks },
    })
    const err = await h.host.publishFromScript({
      channelId: CHANNEL, runId: h.runId, title: 't', copy: { content: CONTENT }, billingConfirmed: true,
    }).catch((e) => e)
    expect(err.code).toBe('PODCAST_EPISODE_INVALID')
    expect(h.spawn.calls.length).toBe(0)
    // 这两条才是「宿主自己挡」与「放进链里让合成层挡」的分界：后者已经 mkdir 并取了忙标记。
    expect(h.fs.calls.mkdir.length).toBe(0)
    expect(channelBusyGate.isBusy(CHANNEL)).toBe(false)
  })

  it('成功链：走合成而不起 ffmpeg，相位闭集与视频链逐字相同，整条链持忙标记，临时目录收尾', async () => {
    const h = makeScriptHost()
    const events = []
    const r = await h.host.publishFromScript(h.scriptPayload, { emitProgress: (e) => events.push(e) })
    expect(r.state).toBe('success')
    expect(h.syn.calls.concat).toBe(1)
    expect(h.syn.calls.tts.length).toBeGreaterThanOrEqual(1)
    // 换的只有 extractMix 这一站：文本链一次真子进程都不该起（concat/probe 都是注入实现），
    // 若实现把抽混音那条链带回来，这条会立刻红
    expect(h.spawn.calls.length).toBe(0)
    const starts = events.filter((e) => e.state === 'start').map((e) => e.phase)
    expect(starts).toEqual(['pickChannel', 'extractMix', 'probe', 'uploadAudio', 'attach', 'buildFeed', 'uploadFeed'])
    expect(events[events.length - 1].state).toBe('done')
    for (const s of h.seen) expect(s.busy).toBe(true)
    expect(h.fs.calls.rmdir.length).toBe(1)
  })

  it('取消窗口不随素材来源漂移：extractMix 及之前可取消，uploadAudio 起一律不可取消', async () => {
    const h = makeScriptHost()
    const events = []
    await h.host.publishFromScript(h.scriptPayload, { emitProgress: (e) => events.push(e) })
    const byPhase = {}
    for (const e of events) if (e.state === 'start' && !(e.phase in byPhase)) byPhase[e.phase] = e.cancellable
    expect(byPhase).toEqual({
      pickChannel: true, extractMix: true, probe: true,
      uploadAudio: false, attach: false, buildFeed: false, uploadFeed: false,
    })
  })

  it('块级 degraded 汇总成整期拒绝：一条静音一期比一期失败更伤', async () => {
    const h = makeScriptHost({ ttsDegraded: true })
    const events = []
    const err = await h.host.publishFromScript(h.scriptPayload, { emitProgress: (e) => events.push(e) }).catch((e) => e)
    expect(String(err.code)).toBe('PODCAST_TTS_CHUNK_DEGRADED')
    const last = events[events.length - 1]
    expect(last.state).toBe('failed')
    expect(last.subCode).toBe('PODCAST_TTS_CHUNK_DEGRADED')
    expect(h.hosting.calls.length).toBe(0)
    expect(h.fs.calls.rmdir.length).toBe(1)
  })
})
