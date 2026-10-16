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

  it('音色三层全空 ⇒ 信封带 subCode=PODCAST_TTS_VOICE_UNRESOLVED 与 issues（拒绝态不是空态）', async () => {
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
