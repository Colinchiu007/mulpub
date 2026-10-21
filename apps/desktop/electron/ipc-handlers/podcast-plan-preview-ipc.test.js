/**
 * 4.3②-a 的 IPC 合同锁（PRD §7.10.4.1）——「只读预览」这一条通道接得对不对。
 *
 * 与 `podcast-episode-ipc.test.js` 的分工：那边量出期通道的信封形状，本文件量**这条通道不许有事**。
 * 「不许有事」不能靠读返回码：预览照样能回 `{code:0}` 而顺手建了目录、占了频道忙标记、
 * 或把整条出期链拽起来（那才是这条通道最坏的错法）。所以判据取三件缺席的产物：
 * ① 宿主三个入口 0 次调用；② registry 的 tryBeginPublish/endPublish 0 次；
 * ③ `podcastUserDataDir` 指向的那个目录在调用后**仍然不存在**（真 store 一旦被拽进来就会建它）。
 * 再加两条对账：通道名必须以字面量出现在注册点与 preload；两个 tracked bundle 必须含该通道名
 * ——改 `preload/podcast.js` 不重生 bundle 时，vitest 读源文件全绿而打包产物里根本没有这条通道。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

__enableElectronMock()

/** @type {any} */
let registerHandlers

beforeEach(async () => {
  vi.resetModules()
  __electronMock.app.isPackaged = false
  const mod = await import('./podcast')
  registerHandlers = mod.default || mod
})

const UNIT = '这是用于分块判据的一整句正文，句末带终止标点，长度足以让下限判据不误伤夹具本身。'
const OK_SCRIPT = [1, 2, 3, 4].map((i) => i + '、' + UNIT).join('\n')
const CHANNEL = 'ch_preview1'

function makeIpcMain () {
  const handlers = new Map()
  return { handlers, handle: (channel, fn) => handlers.set(channel, fn) }
}

/** 假的是「频道读」与「宿主/忙标记」，真的是注册、剥壳、错误映射、惰性构造这四层。 */
function setup (over = {}) {
  const ipcMain = makeIpcMain()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  const unusedDir = path.join(os.tmpdir(), 'mp-preview-unused-' + process.pid + '-' + Math.random().toString(36).slice(2))
  const host = {
    publishFromVideo: vi.fn(async () => { throw new Error('预览绝不该走到出期宿主') }),
    publishFromScript: vi.fn(async () => { throw new Error('预览绝不该走到出期宿主') }),
    cancelPublish: vi.fn(() => ({ outcome: 'unknown', phase: '' })),
  }
  const registry = {
    tryBeginPublish: vi.fn(() => true),
    endPublish: vi.fn(),
    assertChannelExists: vi.fn(),
    assertChannelWritable: vi.fn(),
    channelDir: vi.fn(() => unusedDir),
  }
  const channelService = {
    getChannel: () => ({ title: '播客频道', description: '', author: '' }),
    readFeedSync: () => null,
  }
  registerHandlers(ipcMain, Object.assign({
    log,
    podcastEpisodeHost: host,
    podcastRegistry: registry,
    podcastChannelService: channelService,
    podcastUserDataDir: unusedDir,
    store: { getUserSetting: vi.fn(() => null), setUserSetting: vi.fn() },
    modelProviderManager: {
      getDefault: vi.fn(() => ({ id: 'openai-tts', models: ['tts-1'], config: {}, category: 'tts' })),
    },
  }, over))
  return { ipcMain, log, host, registry, unusedDir, call: (payload) => ipcMain.handlers.get('podcast:episode:planPreview')({}, payload) }
}

describe('podcast IPC · episode:planPreview 只读合同', () => {
  it('成功信封为 {code:0,data:{ok,plan,voice}}，且载荷不回用户正文（隐私：script 是未发布草稿）', async () => {
    const ctx = setup()
    const res = await ctx.call({ channelId: CHANNEL, script: OK_SCRIPT })
    expect(Object.keys(res).sort()).toEqual(['code', 'data'])
    expect(res.code).toBe(0)
    expect(Object.keys(res.data).sort()).toEqual(['ok', 'plan', 'voice'])
    expect(res.data.plan.totalBlocks).toBe(4)
    expect(res.data.voice.origin).toBe('providerDefault')
    const serialized = JSON.stringify(res)
    expect(serialized.includes('分块判据')).toBe(false)
  })

  it('预览不建目录、不占忙标记、不碰出期宿主（三件缺席同时成立，返回码不构成证据）', async () => {
    const ctx = setup()
    const res = await ctx.call({ channelId: CHANNEL, script: OK_SCRIPT })
    expect(res.code).toBe(0)
    expect(fs.existsSync(ctx.unusedDir)).toBe(false)
    expect(ctx.registry.tryBeginPublish).not.toHaveBeenCalled()
    expect(ctx.registry.endPublish).not.toHaveBeenCalled()
    expect(ctx.host.publishFromVideo).not.toHaveBeenCalled()
    expect(ctx.host.publishFromScript).not.toHaveBeenCalled()
    expect(ctx.registry.assertChannelWritable).not.toHaveBeenCalled()
  })

  it('音色两层全空 ⇒ 信封带 subCode=PODCAST_TTS_VOICE_UNRESOLVED 与 issues（拒绝态不是空态）', async () => {
    const ctx = setup({
      modelProviderManager: { getDefault: vi.fn(() => null) },
    })
    const res = await ctx.call({ channelId: CHANNEL, script: OK_SCRIPT })
    expect(res.code).not.toBe(0)
    expect(res.subCode).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    expect(Array.isArray(res.issues)).toBe(true)
    expect(res.issues[0].path).toBe('voice')
  })

  it('正文短于下限 ⇒ 同一形状拒绝，且不得回一个 totalBlocks:0 的成功载荷', async () => {
    const ctx = setup()
    const res = await ctx.call({ channelId: CHANNEL, script: '太短了' })
    expect(res.code).not.toBe(0)
    expect(res.subCode).toBe('PODCAST_TTS_COPY_TOO_SHORT')
    expect(res.data).toBeUndefined()
  })

  it('频道不存在时由服务如实拒绝，本层不得把它降级成空预览（getService 走只读判据）', async () => {
    const registry = {
      tryBeginPublish: vi.fn(() => true), endPublish: vi.fn(),
      assertChannelExists: vi.fn(() => {
        const e = new Error('PODCAST_CHANNEL_ID_REQUIRED: 频道不存在')
        e.code = 'PODCAST_CHANNEL_ID_REQUIRED'
        throw e
      }),
      assertChannelWritable: vi.fn(), channelDir: vi.fn(() => '/tmp/never'),
    }
    const ctx = setup({
      podcastRegistry: registry,
      podcastChannelService: null,
    })
    const res = await ctx.call({ channelId: 'ch_missing', script: OK_SCRIPT })
    expect(res.code).not.toBe(0)
    expect(registry.assertChannelWritable).not.toHaveBeenCalled()
  })

  it('注册阶段不构造预览宿主：未注入替身时注册照常完成，第一次调用才惰性构造', () => {
    const ipcMain = makeIpcMain()
    expect(() => registerHandlers(ipcMain, { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })).not.toThrow()
    expect(ipcMain.handlers.has('podcast:episode:planPreview')).toBe(true)
  })

  it('通道名以字面量出现在注册点与 preload（间接注册会让它从对账里消失）', () => {
    const handlerSrc = fs.readFileSync(path.resolve(__dirname, 'podcast.js'), 'utf8')
    expect(handlerSrc).toMatch(/ipcMain\.handle\('podcast:episode:planPreview'/)
    expect(handlerSrc).toMatch(/withSenderCheck\(handlerFor\('episode:planPreview'/)
    const preloadSrc = fs.readFileSync(path.resolve(__dirname, '../preload/podcast.js'), 'utf8')
    expect(preloadSrc).toMatch(/episodePlanPreview/)
    expect(preloadSrc).toMatch(/ipcRenderer\.invoke\('podcast:episode:planPreview'/)
  })

  it('两个 tracked bundle 必须含这条通道名（改 preload 不重生 bundle ⇒ 打包面根本没有它）', () => {
    const bundles = [
      path.resolve(__dirname, '../preload/index.bundle.js'),
      path.resolve(__dirname, '../home-shell-preload.bundle.js'),
    ]
    expect(bundles.length).toBe(2)
    for (const b of bundles) {
      expect(fs.existsSync(b), b).toBe(true)
      expect(fs.readFileSync(b, 'utf8')).toContain('podcast:episode:planPreview')
    }
  })

  it('接线处不得自带第二份分块或音色口径（本通道只转发共用实现）', () => {
    const handlerSrc = fs.readFileSync(path.resolve(__dirname, 'podcast.js'), 'utf8')
    expect(handlerSrc).not.toMatch(/split\('\\n'\)/)
    expect(handlerSrc).not.toMatch(/Array\.from\([^)]*\)\.length\s*>\s*\d+/)
  })
})

describe('podcast IPC · episode:planPreview 撤档后 handler 侧的四条现场判据（QM6 i1/i3/i4/i6）', () => {
  it('空/空白 channelId 由形状层拒，且不得把空 id 送进频道服务（存在性守卫不得演成第二次拒绝源）', async () => {
    const getChannel = vi.fn(() => ({ title: '播客频道', description: '', author: '' }))
    const ctx = setup({ podcastChannelService: { getChannel, readFeedSync: () => null } })
    const res = await ctx.call({ channelId: '   ', script: OK_SCRIPT })
    expect(res.code).not.toBe(0)
    expect(res.subCode).toBe('PODCAST_CHANNEL_ID_REQUIRED')
    expect(getChannel, '空 id 不该走存在性读取——拒绝的落点只有形状层一处').not.toHaveBeenCalled()
    expect(ctx.registry.assertChannelWritable).not.toHaveBeenCalled()
  })

  it('存量频道带着 meta.voiceRef（撤档前写入的历史数据）⇒ 出声一次，且解析如实落到 capability 默认', async () => {
    const ctx = setup({
      podcastChannelService: {
        getChannel: () => ({ title: '播客频道', description: '', author: '', voiceRef: { providerId: 'doubao-tts', model: 'doubao-tts', voiceId: 'legacy-voice' } }),
        readFeedSync: () => null,
      },
    })
    const res = await ctx.call({ channelId: CHANNEL, script: OK_SCRIPT })
    expect(res.code).toBe(0)
    expect(res.data.voice.origin).toBe('providerDefault')
    expect(res.data.voice.voiceId, '历史 voiceRef 不得再被当作音色来源').not.toBe('legacy-voice')
    const warns = ctx.log.warn.mock.calls.map((c) => String(c[0] || ''))
    expect(warns.filter((w) => w.indexOf('voiceRef') >= 0).length, '静默把「原本命中频道档」改成回退，必须在现场留痕').toBe(1)
    expect(ctx.registry.assertChannelWritable).not.toHaveBeenCalled()
  })

  it('历史 voiceRef 只填了一段 ⇒ 撤档后如实**通过**并出声（QM6 i1：行为变更的另一侧）', async () => {
    // 撤档前 `resolveEpisodeVoice` 对三段不齐的 channelRef 是硬拒绝（且注释明文「不得顺着回退链往下走」）；
    // 撤档后该字段根本不进解析 ⇒ 从「拒绝」变成「按偏好/capability 通过」。这一侧也是行为变更，必须出声。
    const ctx = setup({
      podcastChannelService: {
        getChannel: () => ({ title: '播客频道', description: '', author: '', voiceRef: { voiceId: 'half-configured' } }),
        readFeedSync: () => null,
      },
    })
    const res = await ctx.call({ channelId: CHANNEL, script: OK_SCRIPT })
    expect(res.code, '撤档的定义是该字段既不采纳也不拒绝；为保留旧的半配置拒绝就得把频道档请回来，与撤档锁冲突').toBe(0)
    const warns = ctx.log.warn.mock.calls.map((c) => String(c[0] || ''))
    expect(warns.filter((w) => w.indexOf('voiceRef') >= 0).length, '从拒绝变通过同样是静默改行为，必须留痕').toBe(1)
    expect(ctx.registry.assertChannelWritable).not.toHaveBeenCalled()
  })

  it('出声判据只覆盖「当年会参与第①档判定」的值，不给未受影响的历史数据发告警（QM6 i3）', async () => {
    // 旧语义里 `{}` 与三段全空取不到 voiceId，本就落偏好/capability ⇒ 撤档没改任何东西，出声即误报；
    // 但主干那行注入还先按 typeof==='object' 滤过一遍 ⇒ 非对象标量当年被滤成 null，撤档没改它们；
    // 只有「过了那道滤网」的值才谈得上被撤档改变：数组撞旧守卫当场硬拒绝、对象看三段规范键名
    // （半配置当场拒绝、齐缺落 fallthrough）⇒ 前者出声、后者不出声。
    // 合法性判据仍只在入参形状层一处。
    const cases = [
      [{}, 0],
      [{ providerId: '', model: '', voiceId: '' }, 0],
      [null, 0],
      [undefined, 0],
      ['', 0],
      [false, 0],
      [[], 1],
      [0, 0],
      ['legacy-string', 0],
      [true, 0],
      [{ providerId: 0 }, 1],
      [{ voiceId: 0 }, 1],
      [{ voiceId: 'x' }, 1],
      [{ voiceID: 'typo-key' }, 0],
      [{ providerId: 'p', unrelated: 'x' }, 1],
      [{ unrelated: 'x' }, 0],
      [{ providerId: 'p', model: 'm', voiceId: 'v' }, 1],
    ]
    for (const [ref, wantWarns] of cases) {
      const ctx = setup({
        podcastChannelService: {
          getChannel: () => ({ title: '播客频道', description: '', author: '', voiceRef: ref }),
          readFeedSync: () => null,
        },
      })
      const res = await ctx.call({ channelId: CHANNEL, script: OK_SCRIPT })
      const label = 'voiceRef=' + JSON.stringify(ref)
      expect(res.code, label + ' 不该影响预览成败（撤档后它不是输入）').toBe(0)
      const warns = ctx.log.warn.mock.calls.map((c) => String(c[0] || ''))
      expect(warns.filter((w) => w.indexOf('voiceRef') >= 0).length, label + ' 的出声次数').toBe(wantWarns)
    }
  })

  it('存在性读取必须排在预览自身的校验之后（QM6 i4：位置即判据，不是顺序偏好）', async () => {
    // 主干上这次读发生在分块与形状校验之后（它是音色解析的入参求值）。把读挪到 handler 最前会让
    // 「正文太短 + 频道有问题」报频道错，用户看不到真正该改的那一格；畸形 id 的拒绝源也会从形状层
    // 搬到服务层——那是两个不同的用户可见错误码。
    const getChannel = vi.fn(() => { throw new Error('存在性读取不该发生在形状校验之前') })
    const ctx = setup({ podcastChannelService: { getChannel, readFeedSync: () => null } })
    const short = await ctx.call({ channelId: CHANNEL, script: '太短了' })
    expect(short.subCode).toBe('PODCAST_TTS_COPY_TOO_SHORT')
    expect(getChannel, '正文判据必须先于存在性读取；把读挪回前面这条必须红').not.toHaveBeenCalled()
    const badId = await ctx.call({ channelId: 'bad/../id', script: OK_SCRIPT })
    expect(badId.code, '畸形 id 必须由形状层拒').not.toBe(0)
    expect(badId.subCode).toBe('PODCAST_CHANNEL_ID_INVALID')
    expect(getChannel, '畸形 id 同样不得走到存在性读取').not.toHaveBeenCalled()
  })

  it('撤档把「命中频道档的成功」变成「两层全空的拒绝」那一格必须留痕（第五轮 P1）', async () => {
    // 原版把出声整段留在 await 之后：previewEpisodePlan 抛错时控制流直接进 handlerFor 的 catch，
    // getChannel 与出声一次都不执行——而「历史频道带 voiceRef + 偏好空 + capability 无默认」恰是
    // 撤档前后行为真的变了的那一格（撤档前它命中频道档、预览是成功的），留痕机制对该格失明。
    const getChannel = vi.fn(() => ({ title: '播客频道', description: '', author: '', voiceRef: { providerId: 'p', model: 'm', voiceId: 'v' } }))
    const ctx = setup({
      podcastChannelService: { getChannel, readFeedSync: () => null },
      modelProviderManager: { getDefault: vi.fn(() => null) },
    })
    const res = await ctx.call({ channelId: CHANNEL, script: OK_SCRIPT })
    expect(res.subCode).toBe('PODCAST_TTS_VOICE_UNRESOLVED')
    const warns = ctx.log.warn.mock.calls.map((c) => String(c[0] || ''))
    expect(warns.filter((w) => w.indexOf('voiceRef') >= 0).length, '拒绝支也要留痕，否则撤档改了行为而日志零痕迹').toBe(1)
    expect(getChannel, '留痕必须先读一次频道 meta').toHaveBeenCalled()
  })

  it('频道缺失 + 音色两层全空 ⇒ 频道错误抢先（第五轮 P3，主干上它是入参求值）', async () => {
    // 主干上 channelRefOf(channelId) 是音色解析的**入参求值** ⇒ 频道缺失本来就抢先于音色错误。
    // 撤档删掉那次求值后，如果拒绝支不补读频道，用户看到的会是「请检查服务商与音色设置」——
    // 把人支去翻一个没问题的地方。这里带 assertChannelExists 的正控，免得下面的 writable 禁词是装饰。
    const registry = {
      tryBeginPublish: vi.fn(() => true), endPublish: vi.fn(),
      assertChannelExists: vi.fn(() => {
        const e = new Error('PODCAST_CHANNEL_NOT_FOUND: 频道不存在，可能已被删除')
        e.code = 'PODCAST_CHANNEL_NOT_FOUND'
        throw e
      }),
      assertChannelWritable: vi.fn(), channelDir: vi.fn(() => '/tmp/never'),
    }
    const ctx = setup({
      podcastRegistry: registry,
      podcastChannelService: null,
      modelProviderManager: { getDefault: vi.fn(() => null) },
    })
    const res = await ctx.call({ channelId: 'ch_gone', script: OK_SCRIPT })
    expect(res.subCode, '频道错误必须抢先于音色错误（两者排查方向不同）').toBe('PODCAST_CHANNEL_NOT_FOUND')
    expect(registry.assertChannelExists, '正控：这条路径必须真经过一次存在性读取').toHaveBeenCalled()
    expect(registry.assertChannelWritable, '只读通道不得请求可写句柄').not.toHaveBeenCalled()
  })

  it('留痕按频道去重且消息带 channelId（第五轮 P5：常驻状态不去重就每次开框刷屏）', async () => {
    // 撤档不回填该字段 ⇒ 状态对同一频道是常驻的；本文件对同类常驻状态已有两条去重先例
    // （stockShapeWarned、previewDepWarned），口径是「刷屏会把真信号冲掉」。去重键必须是 channelId，
    // 全局一条布尔会让第二个受影响频道的现场被第一个吃掉。
    const ctx = setup({
      podcastChannelService: {
        getChannel: () => ({ title: '播客频道', description: '', author: '', voiceRef: { voiceId: 'v' } }),
        readFeedSync: () => null,
      },
    })
    for (let i = 0; i < 3; i += 1) {
      const res = await ctx.call({ channelId: CHANNEL, script: OK_SCRIPT })
      expect(res.code).toBe(0)
    }
    const hits = ctx.log.warn.mock.calls.map((c) => String(c[0] || '')).filter((w) => w.indexOf('voiceRef') >= 0)
    expect(hits.length, '同一频道只出一次').toBe(1)
    expect(hits[0], '消息必须可归因到具体频道').toContain(CHANNEL)
  })
})
