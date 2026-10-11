/**
 * 切频道时的页面态失效合同（含 feedSync 横幅真源）
 *
 * 两条独立的动因，都不在「看起来像装饰」的范围内：
 *
 * 1) 目录域拆分（刀 1）把 `switchChannel` 留在 picker 里，但函数体直接写了
 *    `channel.value = null` / `await loadChannel()` —— 这些标识符属于**页面域**，
 *    在 picker 的词法作用域里根本不存在。用户侧的症状是「点了另一个频道，什么都没发生」，
 *    而整条路径此前没有任何用例引用过 `switchChannel`，所以四层门禁全绿。
 *    picker 自己声明的契约是 `deps.onChannelActivated`（清理与重取的形状只有页面域知道），
 *    解构之后一次都没调用——本文件的第一条用例就是锁这条契约被真的用起来。
 *
 * 2) `feedSync` 是横幅的唯一数据来源，而重试按钮拿的是 `props.channelId`。
 *    两者必须同时失效：否则 A 频道的 `failed` 会挂到 B 名下，用户点【重新生成并上传 feed】
 *    就是按 B 的当前单集重建并覆盖 B 的公网主键——一次面向错误目标的不可逆外发写。
 *    「无证据」一律收成 null（不显示），不得留着上一频道的旧证据。
 *
 * 接缝纪律：只 mock `@/api/podcast-channel` 的函数引用，composable 与 picker 都用真实实现；
 * 断言一律读**真实状态**（feedSync/activeChannelId），不读源码字符串。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'node:url'

const __dir = path.dirname(fileURLToPath(import.meta.url))

let api = null
// 必须是**部分** mock：usePodcastChannel 还经桥接层 import 整个 api 面，
// 整体替换会让 ESM 具名导出校验在 link 期就炸。
vi.mock('@/api/podcast-channel', async (importOriginal) => {
  const actual = await importOriginal()
  api = {
    channelList: vi.fn(),
    channelGet: vi.fn(),
    episodeList: vi.fn(),
  }
  return Object.assign({}, actual, api)
})

const ok = (data) => ({ available: true, result: { ok: true, ...data } })
const fail = (code) => ({ available: true, result: { ok: false, code } })

const CH_A = 'ch_aaaaaaaaa'
const CH_B = 'ch_bbbbbbbbb'
const CHANNELS = [
  { id: CH_A, name: 'A 台', cap: 10, count: 1 },
  { id: CH_B, name: 'B 台', cap: 10, count: 0 },
]
// 形状逐字取写侧真实载荷（status / attemptedAt / error.code / error.status / updatedAt）：
// spec 早期草稿写的是 result/errorCodes/hostingSnapshot，代码里一个都不存在——夹具跟着假形状写
// 就会对新实现结构性免疫（本仓「夹具替对方剥壳」的同族坑）。
const FAILED_SYNC = {
  status: 'failed',
  attemptedAt: '2026-10-10T00:00:00.000Z',
  objectKey: 'podcast/ch_aaaaaaaaa/feed.xml',
  error: { code: 'PODCAST_HOSTING_UPLOAD_FAILED', status: 403, itemCount: 2 },
  updatedAt: '2026-10-10T00:00:01.000Z',
}

function deferred () {
  let resolve
  const promise = new Promise((r) => { resolve = r })
  return { promise, resolve }
}

/** A 有 failed 的 durable 状态；B 默认无 feedSync。 */
function stubChannels ({ getB } = {}) {
  api.channelList.mockResolvedValue(ok({ channels: CHANNELS, defaultChannelId: CH_A, migrationStatus: 'done' }))
  api.episodeList.mockResolvedValue(ok({ episodes: [], cap: 10, count: 0 }))
  api.channelGet.mockImplementation(async (payload) => {
    const id = payload && payload.channelId
    if (id === CH_A) return ok({ channel: { title: 'A 台' }, feedSync: FAILED_SYNC })
    if (getB) return getB()
    return ok({ channel: { title: 'B 台' }, feedSync: null })
  })
}

/**
 * 取某个函数/箭头的**函数体**（按花括号配平），并剥掉行注释。
 * 锚点找不到必须抛错——静默返回空串会让结构锁恒绿（本仓「解析退化成空集合即假绿」同族）。
 */
function fnBody (file, anchor) {
  const src = fs.readFileSync(file, 'utf8').replace(/\r\n/g, '\n')
  const at = src.indexOf(anchor)
  if (at < 0) throw new Error('结构锁锚点缺失：' + path.basename(file) + ' 里找不到 ' + anchor)
  const open = src.indexOf('{', at)
  if (open < 0) throw new Error('结构锁锚点后没有函数体：' + anchor)
  let depth = 0
  let end = -1
  for (let i = open; i < src.length; i++) {
    const ch = src[i]
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) { end = i; break }
    }
  }
  if (end < 0) throw new Error('结构锁函数体花括号不配平：' + anchor)
  return src.slice(open, end + 1).split('\n').filter((line) => !line.trim().startsWith('//')).join('\n')
}

beforeEach(() => { vi.resetModules() })
afterEach(() => { vi.clearAllMocks() })

describe('usePodcastChannel · 切频道的页面态失效', () => {
  it('切频道必须成功返回（回归：picker 曾引用页面域标识符而抛 ReferenceError）', async () => {
    const { usePodcastChannel } = await import('./usePodcastChannel')
    stubChannels()
    const s = usePodcastChannel()
    await s.loadChannels()
    await s.loadChannel()

    await expect(s.switchChannel(CH_B)).resolves.toMatchObject({ ok: true })
    expect(s.activeChannelId.value).toBe(CH_B)
  })

  it('channel:get 往返窗口内 feedSync 必须已为 null（不得挂着 A 的失败态对 B 出站）', async () => {
    const { usePodcastChannel } = await import('./usePodcastChannel')
    const gate = deferred()
    stubChannels({
      getB: async () => {
        await gate.promise
        return ok({ channel: { title: 'B 台' }, feedSync: null })
      },
    })
    const s = usePodcastChannel()
    await s.loadChannels()
    await s.loadChannel()
    expect(s.feedSync.value).toEqual(FAILED_SYNC)

    const inflight = s.switchChannel(CH_B)
    expect(s.feedSync.value).toBeNull()
    gate.resolve()
    await inflight
    expect(s.feedSync.value).toBeNull()
  })

  it('切频道后 channel:get 失败 → feedSync 保持 null，不残留上一频道的旧证据', async () => {
    const { usePodcastChannel } = await import('./usePodcastChannel')
    stubChannels({ getB: async () => fail('PODCAST_STORE_UNAVAILABLE') })
    const s = usePodcastChannel()
    await s.loadChannels()
    await s.loadChannel()
    expect(s.feedSync.value).toEqual(FAILED_SYNC)

    await s.switchChannel(CH_B)
    expect(s.feedSync.value).toBeNull()
  })

  it('切到真带 failed 的频道后，横幅数据必须是新频道自己那份', async () => {
    const { usePodcastChannel } = await import('./usePodcastChannel')
    const bSync = { status: 'partial', updatedAt: '2026-10-11T00:00:00.000Z' }
    stubChannels({ getB: async () => ok({ channel: { title: 'B 台' }, feedSync: bSync }) })
    const s = usePodcastChannel()
    await s.loadChannels()
    await s.loadChannel()

    await s.switchChannel(CH_B)
    expect(s.feedSync.value).toEqual(bSync)
  })

  it('接线锁：picker 的 switchChannel 必须经 onChannelActivated 清理，不得自己引用页面态标识符', async () => {
    // 取「函数体 + 剥注释」而不是整段文件：本仓实测踩过两次——按 indexOf(下一个函数名) 切区间
    // 会在对方被搬走时静默放大到接近整份文件；而注释里举例说明「曾经写错过什么」的字面量会被
    // 未剥注释的判据当成违规（幽灵命中）。两条都在这里防住。
    const body = fnBody(path.join(__dir, 'usePodcastChannelPicker.js'), 'async function switchChannel')
    for (const leaked of ['channel.value', 'episodes.value', 'feedResult.value', 'verifyResult.value', 'loadChannel()', 'loadEpisodes()']) {
      expect(body).not.toContain(leaked)
    }
    expect(body).toContain('onChannelActivated()')

    const activated = fnBody(path.join(__dir, 'usePodcastChannel.js'), 'onChannelActivated:')
    expect(activated).toContain('feedSync.value = null')
    expect(activated).toContain('channel.value = null')
  })
})
