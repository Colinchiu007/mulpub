/**
 * podcast preload 桥合同锁
 *
 * 本文件唯一职责：钉住「preload 是 envelope 的唯一剥壳点」。
 * 主进程 handler 回 { code, data }，渲染层 composable 合同是 { ok, ...data }，
 * 两侧各自的单测都会绿——断链只能在这一层被抓住（AGENTS.md「跨包响应信封只在一处剥」）。
 * 夹具 ipcRenderer 必须**逐输入**返回不同响应（恒返回同一份会让「按输入区分」的缺陷免疫）。
 */
import { describe, it, expect } from 'vitest'
import { createPodcastApi, unwrap, IPC_EXCEPTION } from './podcast'

const CHANNELS = [
  'podcast:channel:get',
  'podcast:channel:save',
  'podcast:episode:list',
  'podcast:episode:save',
  'podcast:episode:remove',
  'podcast:feed:build',
  'podcast:feed:verify',
  'podcast:endpoints:list',
]

function makeIpc (responsesByChannel) {
  const calls = []
  return {
    calls,
    invoke: async (channel, ...args) => {
      calls.push({ channel, args })
      const res = responsesByChannel[channel]
      if (res instanceof Error) throw res
      return res
    },
  }
}

describe('podcast preload · 通道与命名空间', () => {
  it('暴露 podcast.* 十七个方法，通道名逐字对齐主进程合同', () => {
    const api = createPodcastApi(makeIpc({}))
    expect(Object.keys(api.podcast).sort()).toEqual([
      'channelCreate', 'channelGet', 'channelList', 'channelMigrateResolve',
      'channelRename', 'channelSave', 'channelSetDefault',
      'endpointList', 'episodeList',
      'episodeRemove', 'episodeSave', 'feedBuild', 'feedPublish', 'feedVerify',
      'hostingCheck', 'hostingGet', 'hostingSave',
    ])
    for (const channel of CHANNELS) {
      expect(channel).toMatch(/^podcast:/)
    }
    // 每个方法各自打到自己的通道，不得共用一条
    const ipc = makeIpc({})
    const { podcast } = createPodcastApi(ipc)
    const calls = [
      podcast.channelGet(), podcast.channelSave({}), podcast.episodeList(),
      podcast.episodeSave({}), podcast.episodeRemove('x'), podcast.feedBuild(),
      podcast.feedVerify(), podcast.endpointList(),
    ]
    expect(calls).toHaveLength(8)
    return Promise.all(calls).then(() => {
      expect(ipc.calls.map((c) => c.channel).sort()).toEqual([...CHANNELS].sort())
    })
  })
})

describe('podcast preload · envelope 剥壳', () => {
  it('成功：data 的键平铺到返回值，并带 ok:true', async () => {
    const ipc = makeIpc({ 'podcast:channel:get': { code: 0, data: { channel: { title: 'T' } } } })
    const { podcast } = createPodcastApi(ipc)
    await expect(podcast.channelGet()).resolves.toEqual({ ok: true, channel: { title: 'T' } })
  })

  it('成功但 data 缺席：仍是 ok:true 且 data 键为空（不得凭空造出一个 channel）', async () => {
    const { podcast } = createPodcastApi(makeIpc({ 'podcast:episode:list': { code: 0 } }))
    await expect(podcast.episodeList()).resolves.toEqual({ ok: true })
  })

  it('失败：code / message / issues 原样透传，ok:false', async () => {
    const issues = [{ code: 'CHANNEL_TITLE_REQUIRED', field: 'title', message: 'x' }]
    const { podcast } = createPodcastApi(makeIpc({
      'podcast:channel:save': { code: -2, message: 'PODCAST_CHANNEL_INVALID', issues },
    }))
    await expect(podcast.channelSave({})).resolves.toEqual({
      ok: false, code: -2, subCode: '', message: 'PODCAST_CHANNEL_INVALID', issues,
    })
  })

  it('失败但 issues 缺席：补空数组（渲染层按数组遍历，不得因 undefined 抛错而丢失错误码）', async () => {
    const { podcast } = createPodcastApi(makeIpc({ 'podcast:feed:build': { code: -1, message: 'boom' } }))
    const res = await podcast.feedBuild()
    expect(res).toEqual({ ok: false, code: -1, subCode: '', message: 'boom', issues: [] })

  })
  // 评审 i7：领域码必须能被渲染层拿去取文案；EC 数字只区分「往哪查」，两码不得互相顶替
  it('失败信封带 subCode 时必须原样透出（未知码不得被压成 EC 数字后失去专属文案）', async () => {
    const { podcast } = createPodcastApi(makeIpc({
      'podcast:episode:save': { code: -3, subCode: 'PODCAST_CHANNEL_BUSY', message: 'PODCAST_CHANNEL_BUSY: episode:save' },
    }))
    const res = await podcast.episodeSave({}
    )
    expect(res.subCode).toBe('PODCAST_CHANNEL_BUSY')
    expect(res.code).toBe(-3)
  })

  it('载荷破坏（返回 null / 非对象 / code 缺失）一律判失败，不得判成功', async () => {
    for (const bad of [null, undefined, 'pong', 0, { message: 'no code' }]) {
      const { podcast } = createPodcastApi(makeIpc({ 'podcast:feed:verify': bad }))
      const res = await podcast.feedVerify()
      expect(res.ok).toBe(false)
      if (bad && typeof bad === 'object') expect(res.code).toBe(IPC_EXCEPTION)
    }
  })

  it('unwrap 只认 code===0：code:-0 之外的任何真值（如 1）不得当成功', async () => {
    const fn = unwrap(async () => ({ code: 1, data: { channel: { title: 'T' } } }))
    const res = await fn()
    expect(res.ok).toBe(false)
    expect(res.code).toBe(1)
    expect(res.channel).toBeUndefined()
  })

  it('入参原样传给 ipcRenderer（频道对象不得被桥层改写）', async () => {
    const payload = { title: 'T', categoryId: 'Arts/Books' }
    const ipc = makeIpc({ 'podcast:channel:save': { code: 0, data: { channel: payload } } })
    const { podcast } = createPodcastApi(ipc)
    await podcast.channelSave(payload)
    expect(ipc.calls[0].args).toEqual([payload])
  })
})
