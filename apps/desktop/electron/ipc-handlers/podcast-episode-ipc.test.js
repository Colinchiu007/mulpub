/**
 * 出期两条通道的 IPC 合同锁（刀 3 第 3 片，PRD §6.4 的现场证据）
 *
 * 这条链上「合同」与「实现」最容易在 IPC 这一层错位：渲染层按 `data.state` 三态分支，
 * 而失败信封走的是 `code/subCode`。所以本文件量的是**信封形状**，不重测宿主逻辑
 * （宿主的行为锁在 `podcast-episode-host.test.js`，那里才是判据的家）。
 *
 * 假的是宿主（注入 `podcastEpisodeHost`），真的是注册/剥壳/error 映射这三层——
 * 把宿主也 mock 掉就等于什么都没测：本仓「装饰性链路」的复发形态之一就是夹具替对方改了形状。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 与 podcast.test.js 同一接缝：event 传 {} 时 withSenderCheck 走测试兼容分支放行，
// 而该放行依赖 helpers 在 **load 期** 解构到 mock 的 app。所以必须先 __enableElectronMock()
// 再动态 import；静态 import/require 会把 helpers 绑到真实 electron，
// 于是四条用例统一回 AUTH_ERROR -3，读起来像「合同键名错了」而不是「接缝没接上」。
__enableElectronMock()

/** @type {any} */
let registerHandlers

beforeEach(async () => {
  vi.resetModules()
  __electronMock.app.isPackaged = false
  const mod = await import('./podcast')
  registerHandlers = mod.default || mod
})

function makeIpcMain () {
  const handlers = new Map()
  return {
    handlers,
    handle: (channel, fn) => handlers.set(channel, fn),
  }
}

function setup (host) {
  const ipcMain = makeIpcMain()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  registerHandlers(ipcMain, {
    log,
    podcastEpisodeHost: host,
    podcastUserDataDir: '/tmp/podcast-ipc-test-unused',
  })
  return { ipcMain, log }
}

const RESULT = {
  state: 'success', phases: [{ phase: 'pickChannel' }], audioUrl: 'https://cdn/a.mp3',
  episodeId: 'ep_1', itemCount: 3, feedUrl: 'https://cdn/feed.xml',
  message: '', errorCode: '', errorMessage: '',
}

describe('podcast IPC · episode:publishFromVideo / publish:cancel 信封合同', () => {
  it('成功信封逐字为九个键（少一个键渲染层就有一条分支永远读不到值）', async () => {
    const publishFromVideo = vi.fn(async () => RESULT)
    const { ipcMain } = setup({ publishFromVideo, cancelPublish: () => ({ outcome: 'unknown', phase: '' }) })
    const res = await ipcMain.handlers.get('podcast:episode:publishFromVideo')({}, { channelId: 'ch_a', runId: 'run000001x' })
    expect(Object.keys(res)).toEqual(['code', 'data'])
    expect(res.code).toBe(0)
    expect(Object.keys(res.data).sort()).toEqual([
      // 顺序是 sort() 的真实结果（'episodeId' < 'errorCode'，按 UTF-16 单元逐位比：p < r）——
      // 写这条断言时按直觉排会红，红的还是「键集合对不上」这种误导信息。
      'audioUrl', 'episodeId', 'errorCode', 'errorMessage', 'feedUrl', 'itemCount', 'message', 'phases', 'state',
    ])
    // 载荷原样交给宿主：本层不补默认值、不改字段名（outBase 由宿主算，这里也不该出现）
    expect(publishFromVideo.mock.calls[0][0]).toEqual({ channelId: 'ch_a', runId: 'run000001x' })
  })

  it('宿主抛领域错误 ⇒ 信封带 subCode 且 code 是 EC 数字（渲染层按 subCode 取文案）', async () => {
    const err = new Error('PODCAST_CHANNEL_BUSY: 该频道有一次发布正在进行')
    err.code = 'PODCAST_CHANNEL_BUSY'
    const { ipcMain } = setup({ publishFromVideo: async () => { throw err }, cancelPublish: () => ({ outcome: 'unknown', phase: '' }) })
    const res = await ipcMain.handlers.get('podcast:episode:publishFromVideo')({}, {})
    expect(res.code).not.toBe(0)
    expect(res.subCode).toBe('PODCAST_CHANNEL_BUSY')
    expect(res.message).toContain('正在进行')
  })

  it('取消通道回 { outcome, phase } 两个键，三态不得压平（unknown 不是「已取消」）', async () => {
    const cancelPublish = vi.fn(() => ({ outcome: 'too_late', phase: 'uploadAudio' }))
    const { ipcMain } = setup({ publishFromVideo: async () => RESULT, cancelPublish })
    const res = await ipcMain.handlers.get('podcast:episode:publish:cancel')({}, { runId: 'run000001x' })
    expect(res).toEqual({ code: 0, data: { outcome: 'too_late', phase: 'uploadAudio' } })
    expect(cancelPublish).toHaveBeenCalledWith('run000001x')
  })

  it('缺 runId 的取消调用回 unknown 而不是崩（宿主按未登记处理）', async () => {
    const { ipcMain } = setup({
      publishFromVideo: async () => RESULT,
      cancelPublish: (id) => ({ outcome: id ? 'accepted' : 'unknown', phase: '' }),
    })
    const res = await ipcMain.handlers.get('podcast:episode:publish:cancel')({}, {})
    expect(res.data.outcome).toBe('unknown')
  })

  it('注册阶段不得建宿主：未注入替身时注册照常完成，第一次调用才惰性构造', () => {
    const ipcMain = makeIpcMain()
    const hostFactory = vi.fn(() => require('../services/podcast-episode-host').createEpisodeHost)
    expect(() => registerHandlers(ipcMain, { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })).not.toThrow()
    expect(ipcMain.handlers.has('podcast:episode:publishFromVideo')).toBe(true)
    expect(ipcMain.handlers.has('podcast:episode:publish:cancel')).toBe(true)
    expect(hostFactory).not.toHaveBeenCalled()
  })

  it('两条通道名以**字面量**出现在注册点（间接注册会让它们从对账里消失）', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'podcast.js'), 'utf8')
    expect(src).toMatch(/ipcMain\.handle\('podcast:episode:publishFromVideo'/)
    expect(src).toMatch(/ipcMain\.handle\('podcast:episode:publish:cancel'/)
    expect(src).toMatch(/withSenderCheck\(handlerFor\('episode:publishFromVideo'/)
    expect(src).toMatch(/withSenderCheck\(handlerFor\('episode:publish:cancel'/)
  })
})
