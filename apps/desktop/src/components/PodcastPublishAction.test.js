/**
 * PodcastPublishAction 浮层行为（刀 3 第 4 片，PRD §6.4 显示项 + §6.4.2 降级路径）
 *
 * 锁的是五件「不报错但骗人」的事：
 * 1. 文案取自真实 locale 值（键存在但取不到时 vue-i18n 会把键名打到界面上，而门禁照样绿）。
 * 2. **不得画假进度条**：没有逐相位通道时所有相位保持 pending，绝不把首相位标成进行中。
 * 3. success 必须带 feedUrl 与「聚合端下次抓取后生效」，**不得**出现「即时生效」。
 * 4. partial 的出口复用同一条 `podcast:feed:publish`（浮层不得另开第二份发布实现）。
 * 5. 取消按钮在拿不到 `cancellable` 时**禁用且说明原因**——不是「点了试试」。
 *
 * 应用级模态的挂起/释放合同在 src/overlay-view-suspension.test.js 登记 owner；
 * 本文件另测两条现场行为：打开即挂起、卸载必须释放（父组件直接销毁不经过 visible=false）。
 */
import { mount } from '@vue/test-utils'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick } from 'vue'
import path from 'node:path'
import fs from 'node:fs'
import { fileURLToPath } from 'node:url'

import i18n from '@/i18n'
import zh from '@/locales/zh'
import PodcastPublishAction from '@/components/PodcastPublishAction.vue'

const api = vi.hoisted(() => ({
  channelList: vi.fn(),
  episodeList: vi.fn(),
  episodePublishFromVideo: vi.fn(),
  episodePublishCancel: vi.fn(),
  hostingGet: vi.fn(),
  feedPublish: vi.fn(),
}))

vi.mock('@/api/podcast-channel', async (importOriginal) => {
  const actual = await importOriginal()
  return Object.assign({}, actual, api)
})

const ok = (data) => ({ available: true, result: Object.assign({ ok: true }, data) })

const CHANNELS = { channels: [{ id: 'ch_a', name: 'A', cap: 10, count: 1 }], defaultChannelId: 'ch_a', empty: false }
const PROJECT = { projectId: 'p-1', title: '测试成片', segments: [{ id: 's1', text: '一段', audioMeta: { degraded: false } }] }
const PHASE_TRAIL = [
  { phase: 'pickChannel' },
  { phase: 'extractMix' },
  { phase: 'probe', durationSec: 42, sizeBytes: 1024, mime: 'audio/mpeg' },
  { phase: 'uploadAudio' },
  { phase: 'attach' },
  { phase: 'buildFeed' },
  { phase: 'uploadFeed' },
]
const SUCCESS_DATA = {
  state: 'success',
  phases: PHASE_TRAIL,
  audioUrl: 'https://cdn.example.com/a.mp3',
  episodeId: 'ep-1',
  itemCount: 4,
  feedUrl: 'https://cdn.example.com/feeds/ch_a/feed.xml',
  message: '',
  errorCode: '',
  errorMessage: '',
}

const here = path.dirname(fileURLToPath(import.meta.url))

function prime () {
  api.channelList.mockResolvedValue(ok(CHANNELS))
  api.episodeList.mockResolvedValue(ok({ episodes: [], cap: 10, count: 1 }))
  api.hostingGet.mockResolvedValue(ok({ hosting: { configured: true } }))
}

let pageCalls
beforeEach(() => {
  vi.clearAllMocks()
  prime()
  pageCalls = []
  window.electronAPI = {
    pageManager: {
      suspendEmbeddedViews: (owner) => { pageCalls.push(['suspend', owner]); return Promise.resolve(true) },
      resumeEmbeddedViews: (owner) => { pageCalls.push(['resume', owner]); return Promise.resolve(true) },
    },
  }
})

afterEach(() => {
  // `activeOwners` 是 useEmbeddedViewSuspension 的**模块级** Set，不随组件卸载自动清。
  // 上一条用例的浮层没被 unmount，owner 就还留在集合里，下一条用例的 suspend 会**当场 return false**
  // （`activeOwners.has(owner)` 命中），于是 pageCalls 里只有 resume、没有 suspend——
  // 红看起来像"挂起合同没接"，实际是夹具没做模块状态隔离。unmount 必须在 delete window.electronAPI
  // **之前**，否则释放路径上的 invoke 拿不到宿主，测试会改测到别的东西。
  if (lastWrapper) {
    try { lastWrapper.unmount() } catch (_) { /* unmount 失败不掩盖本用例的断言结果 */ }
    lastWrapper = null
  }
  delete window.electronAPI
})

let lastWrapper = null

async function mountOverlay (props = {}, opts = {}) {
  i18n.global.locale.value = 'zh'
  const w = mount(PodcastPublishAction, {
    props: { visible: true, project: PROJECT, videoPath: 'D:/v/out.mp4', title: '第一期', ...props },
    global: { plugins: [i18n], stubs: { teleport: true } },
    ...opts,
  })
  lastWrapper = w
  await nextTick()
  // `start()` 在外发之前要依次 await `loadChannels()` 与 `refreshQuota()`，所以外发落在 mount 之后的
  // 若干个微任务上；只 await 一个 nextTick 的断言会读到"还没开始"的界面。等**真正的出口**
  // （外发发生至少一次），而不是加固定 sleep，也不放宽任何断言。
  // 故意不外发的用例（缺频道 / 配额满）拿不到这个条件，因此 catch 掉继续——它不该因此变红，
  // 也不该被当成通过：它自己的断言才是判据。
  await vi.waitFor(() => expect(api.episodePublishFromVideo.mock.calls.length).toBeGreaterThan(0), { timeout: 1200, interval: 20 }).catch(() => {})
  await nextTick()
  return w
}

async function mountAndSettle (data) {
  api.episodePublishFromVideo.mockResolvedValue(ok(data))
  const w = await mountOverlay()
  await vi.waitFor(() => expect(w.find('[data-testid="podcast-episode-result"]').exists()).toBe(true))
  return w
}

function phaseStates (w) {
  return w.findAll('[data-testid="podcast-episode-phases"] > li').map((li) => [li.text(), li.attributes('data-state')])
}

describe('显示项：相位骨架与降级路径', () => {
  it('渲染八个相位条目（七相位 + cancelled），标签逐字等于 zh.podcast.episode.phase.*', async () => {
    let release
    api.episodePublishFromVideo.mockImplementation(() => new Promise((r) => { release = r }))
    const w = await mountOverlay()
    expect(w.findAll('[data-testid="podcast-episode-phases"] > li')).toHaveLength(8)
    expect(phaseStates(w).map(([text]) => text)).toEqual([
      zh.podcast.episode.phase.pickChannel,
      zh.podcast.episode.phase.extractMix,
      zh.podcast.episode.phase.probe,
      zh.podcast.episode.phase.uploadAudio,
      zh.podcast.episode.phase.attach,
      zh.podcast.episode.phase.buildFeed,
      zh.podcast.episode.phase.uploadFeed,
      zh.podcast.episode.phase.cancelled,
    ])
    release(ok(SUCCESS_DATA))
  })

  it('进行中：所有相位一律 pending，并显式声明「进度不可用」（§6.4.2 不得画停在首相位的假进度条）', async () => {
    let release
    api.episodePublishFromVideo.mockImplementation(() => new Promise((r) => { release = r }))
    const w = await mountOverlay()
    expect(phaseStates(w).map(([, state]) => state)).toEqual(['pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending', 'pending'])
    expect(w.find('[data-testid="podcast-episode-progress-unavailable"]').text()).toBe(zh.podcast.episode.progressUnavailable)
    expect(w.find('[data-testid="podcast-episode-running"]').text()).toBe(zh.podcast.episode.running)
    release(ok(SUCCESS_DATA))
    await nextTick()
  })

  it('结束后按信封轨迹点亮已到达的相位，并显示当前相位的实测值（时长/字节/mime）', async () => {
    const w = await mountAndSettle(SUCCESS_DATA)
    expect(phaseStates(w).map(([, state]) => state)).toEqual(['done', 'done', 'done', 'done', 'done', 'done', 'done', 'pending'])
    expect(w.find('[data-testid="podcast-episode-measured"]').text()).toBe(
      zh.podcast.episode.measured.replace('{duration}', '42').replace('{bytes}', '1024').replace('{mime}', 'audio/mpeg'),
    )
  })
})

describe('关闭不等于取消（这句必须在界面上）', () => {
  it('浮层里逐字渲染该提示', async () => {
    const w = await mountAndSettle(SUCCESS_DATA)
    expect(w.find('[data-testid="podcast-episode-close-hint"]').text()).toBe(zh.podcast.episode.closeNotCancel)
  })

  it('关闭只 emit close，不碰第二条通道', async () => {
    const w = await mountAndSettle(SUCCESS_DATA)
    await w.find('[data-testid="ui-modal-close"]').trigger('click')
    expect(w.emitted('close')).toBeTruthy()
    expect(api.episodePublishCancel).not.toHaveBeenCalled()
  })
})

describe('取消按钮：拿不到可取消性就禁用并说明原因', () => {
  it('信封未给 cancellable：按钮 disabled + 原因可见 + 点击不发 IPC', async () => {
    let release
    api.episodePublishFromVideo.mockImplementation(() => new Promise((r) => { release = r }))
    const w = await mountOverlay()
    const btn = w.find('[data-testid="podcast-episode-cancel"]')
    expect(btn.attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="podcast-episode-cancel-disabled"]').text()).toBe(zh.podcast.episode.cancelDisabled)
    await btn.trigger('click')
    expect(api.episodePublishCancel).not.toHaveBeenCalled()
    release(ok(SUCCESS_DATA))
  })

  it('信封给了 cancellable 才可点，且按同一个 runId 走第二条通道', async () => {
    let release
    api.episodePublishFromVideo.mockImplementation(() => new Promise((r) => { release = r }))
    const w = await mountOverlay()
    release(ok(Object.assign({}, SUCCESS_DATA, { cancellable: true })))
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-episode-cancel"]').attributes('disabled')).toBeUndefined())
    api.episodePublishCancel.mockResolvedValue(ok({ outcome: 'too_late', phase: 'uploadAudio' }))
    await w.find('[data-testid="podcast-episode-cancel"]').trigger('click')
    await vi.waitFor(() => expect(api.episodePublishCancel).toHaveBeenCalledTimes(1))
    expect(api.episodePublishCancel.mock.calls[0][0].runId).toMatch(/^[A-Za-z0-9_-]{8,64}$/)
    await nextTick()
    expect(w.find('[data-testid="podcast-episode-cancel-state"]').text()).toBe(zh.podcast.episode.cancelTooLate)
  })
})

describe('结果三态各自一句话', () => {
  it('success 带 feedUrl 与「聚合端下次抓取后生效」，且不得出现「即时生效」', async () => {
    const w = await mountAndSettle(SUCCESS_DATA)
    const line = w.find('[data-testid="podcast-episode-result"]')
    expect(line.attributes('data-state')).toBe('success')
    expect(line.text()).toBe(zh.podcast.episode.success.replace('{feedUrl}', SUCCESS_DATA.feedUrl))
    expect(line.text()).toContain('通常数小时至数天')
    expect(line.text()).not.toContain('即时生效')
  })

  it('partial：本地已登记那句 + 只重试 feed 的出口，重试复用 podcast:feed:publish', async () => {
    api.feedPublish.mockResolvedValue(ok({ state: 'success', itemCount: 4, backupCreated: true, prevExists: true }))
    const w = await mountAndSettle(Object.assign({}, SUCCESS_DATA, {
      state: 'partial', feedUrl: '', message: '这一期已登记到本地频道，公网 feed 尚未更新',
      errorCode: 'PODCAST_HOSTING_UPLOAD_FAILED', errorMessage: '上传失败（status=403）',
    }))
    const line = w.find('[data-testid="podcast-episode-result"]')
    expect(line.attributes('data-state')).toBe('partial')
    expect(line.text()).toBe(zh.podcast.episode.partial)
    // 永不把「公网没跟上」说成本地坏了——那会诱导用户删掉本来正确的一期重来
    expect(line.text()).not.toContain('坏了')
    expect(line.text()).not.toContain('失败')
    const retry = w.find('[data-testid="podcast-episode-retry-feed"]')
    expect(retry.exists()).toBe(true)
    expect(retry.text()).toBe(zh.podcast.hosting.retryFeed)
    await retry.trigger('click')
    await vi.waitFor(() => expect(api.feedPublish).toHaveBeenCalledWith({ channelId: 'ch_a' }))
    expect(w.find('[data-testid="podcast-episode-retry-state"]').attributes('data-state')).toBe('success')
  })

  it('cancelled：回滚说明成一句，且不得被读成失败', async () => {
    const w = await mountAndSettle(Object.assign({}, SUCCESS_DATA, {
      state: 'cancelled',
      phases: [{ phase: 'pickChannel' }, { phase: 'extractMix' }, { phase: 'cancelled' }],
      feedUrl: '',
    }))
    expect(w.find('[data-testid="podcast-episode-result"]').text()).toBe(zh.podcast.episode.cancelled)
    expect(w.find('[data-testid="podcast-episode-result"]').attributes('data-state')).toBe('cancelled')
    expect(w.find('[data-testid="podcast-episode-failure"]').exists()).toBe(false)
  })

  it('失败：按领域码出 episode.* 那句并逐条列 issues，详情行带主进程 message', async () => {
    api.episodePublishFromVideo.mockResolvedValue({
      available: true,
      result: {
        ok: false, code: -2, subCode: 'PODCAST_EPISODE_INVALID', message: '单集标题不能为空',
        issues: [{ code: 'EPISODE_TITLE_REQUIRED', path: 'title', message: '单集标题不能为空' }],
      },
    })
    const w = await mountOverlay()
    await vi.waitFor(() => expect(w.find('[data-testid="podcast-episode-failure"]').exists()).toBe(true))
    expect(w.find('[data-testid="podcast-episode-failure"]').text()).toBe(zh.podcast.episode.invalid)
    expect(w.find('[data-testid="podcast-episode-failure"]').attributes('data-code')).toBe('PODCAST_EPISODE_INVALID')
    expect(w.find('[data-testid="podcast-episode-issues"]').findAll('li')).toHaveLength(1)
    expect(w.find('[data-testid="podcast-episode-issues"]').text()).toBe(zh.podcast.errors.EPISODE_TITLE_REQUIRED)
    expect(w.find('[data-testid="podcast-episode-detail"]').text()).toBe(zh.podcast.episode.detail.replace('{detail}', '单集标题不能为空'))
  })
})

describe('应用级模态的挂起合同（owner 现场行为，登记锁在 overlay-view-suspension.test.js）', () => {
  it('打开即挂起，owner 是 podcast-episode-publish-overlay', async () => {
    api.episodePublishFromVideo.mockResolvedValue(ok(SUCCESS_DATA))
    await mountOverlay()
    expect(pageCalls).toEqual([['suspend', 'podcast-episode-publish-overlay']])
  })

  it('visible 转 false 必须释放（释放是状态出口，走 watch 的 false 分支）', async () => {
    api.episodePublishFromVideo.mockResolvedValue(ok(SUCCESS_DATA))
    const w = await mountOverlay()
    await w.setProps({ visible: false })
    await nextTick()
    expect(pageCalls).toEqual([
      ['suspend', 'podcast-episode-publish-overlay'],
      ['resume', 'podcast-episode-publish-overlay'],
    ])
  })

  it('父组件直接销毁本组件（不经过 visible=false）也必须释放，不得残留挂起计数', async () => {
    api.episodePublishFromVideo.mockResolvedValue(ok(SUCCESS_DATA))
    const w = await mountOverlay()
    w.unmount()
    await nextTick()
    expect(pageCalls).toEqual([
      ['suspend', 'podcast-episode-publish-overlay'],
      ['resume', 'podcast-episode-publish-overlay'],
    ])
  })
})

describe('重开浮层不得开出第二条链（关闭不取消发布的直接推论）', () => {
  const src = fs.readFileSync(path.resolve(__dirname, 'PodcastPublishAction.vue'), 'utf8')
  const i = src.indexOf('watch(() => props.visible')
  const block = src.slice(i, i + 420)

  it('open 分支必须以 publishing 作闸门，否则在途链会被第二条链顶掉', () => {
    expect(i).toBeGreaterThan(-1)
    expect(block).toContain('if (!publishing.value) {')
    expect(block).toContain('startPublish()')
    // 变异反证：把闸门摘掉（退回无条件 startPublish）本用例必须变红
    expect(block.indexOf('startedForThisOpen = false')).toBeGreaterThan(block.indexOf('if (!publishing.value)'))
  })
})

describe('两枚入口的接线（R92：子组件有 emit，父模板必须有绑定）', () => {
  it('结果页经装配层挂入口与浮层（入口与浮层成对，宿主不持有第二份状态）', () => {
    const src = fs.readFileSync(path.resolve(here, '../views/ResultView.vue'), 'utf8')
    expect(src).toContain('PodcastEpisodeEntry')
    expect(src).toContain('<PodcastEpisodeEntry')
  })

  it.each([['../views/CreateView.vue', 'openPodcastEpisodePublish']])('%s 必须挂浮层并绑定 @close（缺绑定＝按钮点了没反应，编译期查不出）', (rel, marker) => {
    const src = fs.readFileSync(path.resolve(here, rel), 'utf8')
    expect(src).toContain('PodcastPublishAction')
    expect(src).toContain(marker)
    expect(src).toMatch(/<PodcastPublishAction[\s\S]*?@close=/)
    // 按需挂载：宿主测试环境没有播客 preload 面，无条件构造浮层会把整个宿主的用例拖红
    expect(src).toMatch(/<PodcastPublishAction[\s\S]*?v-if=/)
  })

  it('装配层自己必须绑 @close 并按需挂载（否则上面的成对合同只是注释）', () => {
    const src = fs.readFileSync(path.resolve(here, './PodcastEpisodeEntry.vue'), 'utf8')
    expect(src).toMatch(/<PodcastPublishAction[\s\S]*?@close=/)
    expect(src).toMatch(/<PodcastPublishAction[\s\S]*?v-if="openedOnce"/)
    expect(src).toContain('data-testid="podcast-episode-entry"')
    // 关闭只隐藏、不销毁：链在主进程，销毁会把进行中的进度一起带走
    expect(src).not.toMatch(/v-if="visible"/)
  })
})
