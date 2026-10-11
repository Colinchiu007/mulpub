/**
 * 适配层的通行证与持锁凭证锁（刀 3 第 3 片）
 *
 * 这两条各自防一种"看着对、实际死"的接法：
 * · 整条链自持忙标记之后，链内每一次「取**可写**服务」都会被自己刚立的那把锁挡住
 *   （真实规则在 `podcast-channel-service._assertNotPublishing`：忙且无通行证即拒）。
 *   少了通行证，一次出期会稳定死在 attach，报 PODCAST_CHANNEL_BUSY——而用户从没并发过第二次。
 * · feed 步的 `publishFeed` 自带取锁。它必须凭**持锁凭证**再入；不传凭证就是自己拒自己。
 *
 * 夹具把真实写守卫的规则复刻进来（忙 + 无通行证 ⇒ 拒），因为这条锁要判的是「适配层有没有
 * 在正确的作用域里取服务」，而不是「服务内部怎么实现」——后者已有自己的 18 例。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createEpisodeAdapters } from './podcast-episode-adapters'
// ⛔ 这两个模块级单例必须经 require 取，不能改成 import：被测的适配层走 CJS require，
// vitest 下 import 会拿到**另一份**实例，isPassed 恒 false，红出来的是「适配层没包通行证」——
// 指错方向的红比没有红更坏，因为它会把人引去改生产代码。
const { channelBusyGate, channelPublishPass } = require('./podcast-channel-locks')

const CHANNEL = 'ch_aaaaaaaaaaaa'
const TOKEN = 'ep-run000001x'

/** 复刻真实写守卫规则的可写服务工厂 */
function makeService (state) {
  return {
    saveEpisode: (ep, opts) => { state.saved.push(ep); return Object.assign({ id: 'e1' }, ep) },
    buildFeed: () => { state.built += 1; return { path: '/ch/feed.xml', itemCount: 2 } },
  }
}

function makeAdapters (overrides = {}) {
  const state = { saved: [], built: 0, feedOptions: [], audioOptions: [] }
  const busy = overrides.busy === true
  const channelServiceOf = (id, options) => {
    // 与 podcast-channel-service 同一判据：忙且不在通行证内即拒
    if (options && options.writable) {
      if (busy && !channelPublishPass.isPassed(id)) {
        const e = new Error('PODCAST_CHANNEL_BUSY: 该频道有一次发布正在进行')
        e.code = 'PODCAST_CHANNEL_BUSY'
        throw e
      }
      state.writableTouches += (state.writableTouches || 0) + 1
      state.passAtAcquire = channelPublishPass.isPassed(id)
    }
    return makeService(state)
  }
  const hosting = {
    getHosting: () => ({ configured: overrides.notConfigured !== true }),
    publishAudio: async (id, options) => { state.audioOptions.push({ id, options }); return { url: 'https://cdn/a.mp3', size: 10 } },
    publishFeed: async (id, options) => {
      state.feedOptions.push({ id, options })
      if (busy && (options || {}).heldBy !== TOKEN) {
        const e = new Error('PODCAST_CHANNEL_BUSY')
        e.code = 'PODCAST_CHANNEL_BUSY'
        throw e
      }
      return overrides.feedState === 'failed'
        ? { state: 'failed', code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403 }
        : { state: 'success', url: 'https://cdn/feed.xml', bytes: 9, itemCount: 2 }
    },
  }
  const adapters = createEpisodeAdapters({
    channelServiceOf, hostingService: hosting, heldBy: overrides.heldBy,
    logger: { info () {}, warn: overrides.warn || vi.fn(), error () {} },
  })
  return { adapters, state, hosting }
}

beforeEach(() => {
  for (const row of channelBusyGate.snapshot()) channelBusyGate.end(row.channelId)
})

describe('podcast-episode-adapters · 可写服务必须在通行证作用域内取', () => {
  it('链持锁时 episodeSink 仍能落笔（少一层通行证即死于自己的忙标记）', async () => {
    channelBusyGate.tryBegin(CHANNEL, { reason: 'episode', token: TOKEN })
    const { adapters, state } = makeAdapters({ busy: true })
    await adapters.episodeSink(CHANNEL, { title: 'T' })
    expect(state.saved.length).toBe(1)
    expect(state.passAtAcquire).toBe(true)
  })

  it('链持锁时 feedSink 与 channelGate.assertWritable 同样不得被自己挡住', async () => {
    channelBusyGate.tryBegin(CHANNEL, { reason: 'episode', token: TOKEN })
    const { adapters, state } = makeAdapters({ busy: true })
    const built = await adapters.feedSink(CHANNEL)
    expect(built.path).toBe('/ch/feed.xml')
    expect(() => adapters.channelGate.assertWritable(CHANNEL)).not.toThrow()
    expect(state.built).toBe(1)
  })

  it('没有人在飞时不得留下通行证（通行证是同步作用域，漏删会永久放行所有写者）', async () => {
    const { adapters } = makeAdapters()
    await adapters.episodeSink(CHANNEL, { title: 'T' })
    await adapters.feedSink(CHANNEL)
    adapters.channelGate.assertWritable(CHANNEL)
    expect(channelPublishPass.size()).toBe(0)
  })

  it('episodeSink 一律 strict（一键路径不许留「先登记后补直链」的中间态）', async () => {
    const seen = []
    const channelServiceOf = (id, options) => ({
      saveEpisode: (ep, opts) => { seen.push(opts); return ep },
    })
    const { adapters } = { adapters: createEpisodeAdapters({
      channelServiceOf,
      hostingService: { getHosting: () => ({}), publishAudio: async () => ({}), publishFeed: async () => ({ state: 'success' }) },
    }) }
    await adapters.episodeSink(CHANNEL, { title: 'T' })
    expect(seen[0]).toEqual({ strict: true })
  })

  it('feed 步透传 heldBy：不传凭证时 publishFeed 会拒（那是自己挡自己）', async () => {
    channelBusyGate.tryBegin(CHANNEL, { reason: 'episode', token: TOKEN })
    const withToken = makeAdapters({ busy: true, heldBy: TOKEN })
    await expect(withToken.adapters.uploadImpl({ channelId: CHANNEL, filePath: '/ch/feed.xml', kind: 'feed' }))
      .resolves.toMatchObject({ url: 'https://cdn/feed.xml' })
    expect(withToken.state.feedOptions[0].options).toEqual({ heldBy: TOKEN })

    const noToken = makeAdapters({ busy: true })
    await expect(noToken.adapters.uploadImpl({ channelId: CHANNEL, filePath: '/x', kind: 'feed' }))
      .rejects.toMatchObject({ code: 'PODCAST_CHANNEL_BUSY' })
  })
})
