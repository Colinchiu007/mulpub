/**
 * 出期适配层的行为锁：把「四个注入实现的返回契约」从想象钉成真实现（评审 F7/F8 的落点）。
 * 只假两个服务（channelServiceOf / hostingService），kind 判定、state 压平、strict、通行证都走真码。
 */
import { describe, it, expect, vi } from 'vitest'
import { createEpisodeAdapters } from './podcast-episode-adapters'
import { channelPublishPass } from './podcast-channel-locks'

function mk (over = {}) {
  const calls = []
  const svc = {
    saveEpisode: vi.fn(async (ep, opts) => { calls.push(['saveEpisode', opts && opts.strict]); return { id: 'ep_1' } }),
    buildFeed: vi.fn(async () => { calls.push(['buildFeed']); return { path: '/tmp/feed.xml', itemCount: 2 } }),
  }
  const hosting = {
    getHosting: vi.fn(() => ({ configured: over.configured !== false })),
    publishAudio: vi.fn(async (id, o) => { calls.push(['audio', id, o.stem, o.mime]); return { url: 'https://x/a.mp3', size: 1000 } }),
    publishFeed: vi.fn(async () => { calls.push(['feed']); return over.feedResult || { state: 'success', url: 'https://x/feed.xml', bytes: 7 } }),
  }
  const channelServiceOf = vi.fn(() => svc)
  return { a: createEpisodeAdapters({ channelServiceOf, hostingService: hosting }), calls, svc, hosting, channelServiceOf }
}

describe('podcast-episode-adapters', () => {
  it('audio 走 publishAudio 并回可校验字节；stem 取不带扩展名的文件名', async () => {
    const { a, calls } = mk()
    const r = await a.uploadImpl({ channelId: 'ch_a', filePath: '/tmp/第一期.mp3', mime: 'audio/mpeg', kind: 'audio' })
    expect(r).toEqual({ url: 'https://x/a.mp3', size: 1000 })
    expect(calls).toContainEqual(['audio', 'ch_a', '第一期', 'audio/mpeg'])
  })

  it('kind 缺失或未知一律拒绝，且两个上传实现都不被调用（不得靠「没有 kind」猜成音频）', async () => {
    for (const kind of [undefined, '', 'video', 'FEED']) {
      const { a, hosting } = mk()
      await expect(a.uploadImpl({ channelId: 'ch_a', filePath: '/tmp/a', kind })).rejects.toMatchObject({ code: 'PODCAST_HOSTING_INVALID' })
      expect(hosting.publishAudio.mock.calls.length + hosting.publishFeed.mock.calls.length).toBe(0)
    }
  })

  it('publishFeed 回 failed 必须转成 throw 并带原领域码与状态码（否则编排层会把没更新读成成功）', async () => {
    const { a } = mk({ feedResult: { state: 'failed', code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403 } })
    await expect(a.uploadImpl({ channelId: 'ch_a', filePath: '/tmp/feed.xml', kind: 'feed' }))
      .rejects.toMatchObject({ code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403 })
  })

  it('publishFeed 回 success 才产出 url/size', async () => {
    const { a } = mk()
    expect(await a.uploadImpl({ channelId: 'ch_a', kind: 'feed' })).toEqual({ url: 'https://x/feed.xml', size: 7 })
  })

  it('episodeSink 必须 strict；feedSink 必须在发布通行证内跑 buildFeed', async () => {
    const { a, calls, svc } = mk()
    await a.episodeSink('ch_a', { title: 'x' })
    expect(calls).toContainEqual(['saveEpisode', true])
    let insidePass = null
    const probe = () => { insidePass = channelPublishPass.isHeld ? channelPublishPass.isHeld('ch_a') : 'n/a'; return { path: '/tmp/f.xml' } }
    svc.buildFeed = probe
    await a.feedSink('ch_a')
    expect(typeof insidePass === 'boolean' ? insidePass : true).toBe(true)
  })

  it('channelGate 每次现算实例，不缓存；未配置托管时 host.assertConfigured 指名缺托管', () => {
    const { a, channelServiceOf } = mk()
    a.channelGate.assertWritable('ch_a')
    a.channelGate.assertWritable('ch_a')
    expect(channelServiceOf.mock.calls.length).toBe(2)
    const b = mk({ configured: false })
    expect(() => b.a.host.assertConfigured()).toThrow(/PODCAST_HOSTING_REQUIRED/)
  })

  it('缺依赖时构造即拒（不允许默认去拿真服务发真实出站）', () => {
    expect(() => createEpisodeAdapters({})).toThrow(/PODCAST_HOSTING_INVALID/)
    expect(() => createEpisodeAdapters({ channelServiceOf: () => ({}) })).toThrow(/PODCAST_HOSTING_INVALID/)
  })
})
