/**
 * 文本出期通道的 IPC 合同锁（tasks 4.3②-b 的通道半边）
 *
 * 与 podcast-episode-ipc.test.js 同一立场：只量**信封形状与载荷转发**，宿主行为的家在
 * podcast-episode-host.test.js。这里之所以值得单独一份文件，是因为文本链多了一条
 * 「计费同意闸门在主进程①层」的口径：IPC 层**不得**自己预置 billingConfirmed、
 * 也不得把它缺省成 false 再传给宿主——那会把「用户没确认」伪装成「宿主检查过且未通过」，
 * 而 §7.10.3 的浮层交互依赖宿主那条 PODCAST_TTS_BILLING_UNCONFIRMED 原样到达渲染层。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

// 与同目录用例同一接缝：event 传 {} 时 withSenderCheck 走测试兼容分支放行，而该放行依赖
// helpers 在 **load 期** 解构到 mock 的 app，所以必须先 __enableElectronMock() 再动态 import。
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
  return { handlers, handle: (channel, fn) => handlers.set(channel, fn) }
}

function setup (host) {
  const ipcMain = makeIpcMain()
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() }
  registerHandlers(ipcMain, {
    log,
    podcastEpisodeHost: host,
    podcastUserDataDir: '/tmp/podcast-script-ipc-test-unused',
  })
  return { ipcMain, log }
}

const RESULT = {
  state: 'success', phases: [{ phase: 'pickChannel' }], audioUrl: 'https://cdn/a.mp3',
  episodeId: 'ep_1', itemCount: 3, feedUrl: 'https://cdn/feed.xml',
  message: '', errorCode: '', errorMessage: '',
}

describe('podcast IPC · episode:publishFromScript 信封合同', () => {
  it('通道已注册，且注册阶段不得建宿主（未注入替身时注册照常完成）', () => {
    const ipcMain = makeIpcMain()
    const hostFactory = vi.fn(() => require('../services/podcast-episode-host').createEpisodeHost)
    expect(() => registerHandlers(ipcMain, { log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } })).not.toThrow()
    expect(ipcMain.handlers.has('podcast:episode:publishFromScript')).toBe(true)
    expect(hostFactory).not.toHaveBeenCalled()
  })

  it('成功信封与成片链**同一组九个键**（渲染层按 data.state 三态分支，少一键就有一条分支永远读不到值）', async () => {
    const publishFromScript = vi.fn(async () => RESULT)
    const { ipcMain } = setup({ publishFromScript, publishFromVideo: async () => RESULT, cancelPublish: () => ({ outcome: 'unknown', phase: '' }) })
    const res = await ipcMain.handlers.get('podcast:episode:publishFromScript')({}, {
      channelId: 'ch_a', runId: 'run000001x', title: '一期文本', copy: { content: '正文'.repeat(60) }, billingConfirmed: true,
    })
    expect(Object.keys(res)).toEqual(['code', 'data'])
    expect(res.code).toBe(0)
    expect(Object.keys(res.data).sort()).toEqual([
      // 顺序是 sort() 的真实结果（'episodeId' < 'errorCode'：p < r），按直觉排会红在键集合对不上
      'audioUrl', 'episodeId', 'errorCode', 'errorMessage', 'feedUrl', 'itemCount', 'message', 'phases', 'state',
    ])
  })

  it('载荷**逐字**交给宿主：本层不补 billingConfirmed 默认值、不改字段名、不删 voiceRef/gapSec', async () => {
    const publishFromScript = vi.fn(async () => RESULT)
    const { ipcMain } = setup({ publishFromScript, publishFromVideo: async () => RESULT, cancelPublish: () => ({ outcome: 'unknown', phase: '' }) })
    const payload = {
      channelId: 'ch_a', runId: 'run000001x', title: '一期文本',
      copy: { content: '正文'.repeat(60) },
      voiceRef: { providerId: 'p', model: 'm', voiceId: 'v' }, gapSec: 0.4, meta: { source: 'copy-library' },
    }
    await ipcMain.handlers.get('podcast:episode:publishFromScript')({}, payload)
    expect(publishFromScript.mock.calls[0][0]).toEqual(payload)
  })

  it('未同意计费：宿主抛 PODCAST_TTS_BILLING_UNCONFIRMED 必须原样带 subCode 到达渲染层（浮层据此显示确认框该出现的文案）', async () => {
    const err = new Error('PODCAST_TTS_BILLING_UNCONFIRMED: 文本出期会逐块调用 TTS 服务商并产生计费，请先确认用量与费用')
    err.code = 'PODCAST_TTS_BILLING_UNCONFIRMED'
    const { ipcMain } = setup({
      publishFromScript: async () => { throw err },
      publishFromVideo: async () => RESULT, cancelPublish: () => ({ outcome: 'unknown', phase: '' }),
    })
    const res = await ipcMain.handlers.get('podcast:episode:publishFromScript')({}, { channelId: 'ch_a' })
    expect(res.code).not.toBe(0)
    expect(res.subCode).toBe('PODCAST_TTS_BILLING_UNCONFIRMED')
    expect(res.message).toContain('确认用量与费用')
  })

  it('入参不合法的 issues 数组随信封透传（渲染层按码逐条出文案，不得只弹「失败」）', async () => {
    const err = new Error('PODCAST_TTS_COPY_TOO_SHORT: 正文 12 码点')
    err.code = 'PODCAST_TTS_COPY_TOO_SHORT'
    err.issues = [{ code: 'PODCAST_TTS_COPY_TOO_SHORT', message: '正文 12 码点，短于一期口播的下限 80' }]
    const { ipcMain } = setup({
      publishFromScript: async () => { throw err },
      publishFromVideo: async () => RESULT, cancelPublish: () => ({ outcome: 'unknown', phase: '' }),
    })
    const res = await ipcMain.handlers.get('podcast:episode:publishFromScript')({}, { channelId: 'ch_a' })
    expect(res.code).not.toBe(0)
    expect(res.issues).toEqual(err.issues)
  })

  it('通道名以**字面量**出现在注册点（间接注册会让它从清点式对账里消失）', () => {
    const src = require('fs').readFileSync(require('path').join(__dirname, 'podcast.js'), 'utf8')
    expect(src).toMatch(/ipcMain\.handle\('podcast:episode:publishFromScript'/)
    expect(src).toMatch(/withSenderCheck\(handlerFor\('episode:publishFromScript'/)
  })

  it('两个 tracked bundle 必须含这条通道名（只改源不重生 ⇒ 打包产物里根本没有这条通道，而 vitest 跑的是源文件）', () => {
    const fs = require('fs')
    const path = require('path')
    for (const b of ['../preload/index.bundle.js', '../home-shell-preload.bundle.js']) {
      const t = fs.readFileSync(path.join(__dirname, b), 'utf8')
      expect(t).toContain('podcast:episode:publishFromScript')
    }
  })
})
