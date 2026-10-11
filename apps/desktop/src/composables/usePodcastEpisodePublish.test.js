/**
 * usePodcastEpisodePublish 行为与合同锁（刀 3 第 4 片）
 *
 * 锁的是四条「编译期与肉眼都抓不到」的东西：
 * 1. **三态不压平**：partial 被当成失败，用户就会去删本来正确的一期（spec 指名场景）。
 * 2. **取消回执不得读成已取消**：accepted 只是登记上了，unknown 更是「这次发布没被它管到」。
 * 3. **可取消性只从信封取**：在这里抄一份相位表，就是给下一次改 PHASES 枚举留漂移路径，
 *    所以除了行为断言，另加一条结构锁——本文件不得出现编排层那个判据的名字。
 * 4. **载荷必须是纯 JSON**：project 是 reactive proxy 时 IPC 直接抛 "could not be cloned"，
 *    而症状是一次点不动的按钮，没有任何后端日志。
 *
 * 数据路径按 AGENTS.md 的口径走真实形状：IPC 返回非空目录/非空轨迹，断言它们被转发进响应式状态，
 * 不是只 mock 成空数组。文案断言一律取 `@/locales/zh` 的**真实值**做精确比较（不用 toContain 兜子串）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { isProxy, reactive } from 'vue'

import en from '@/locales/en'
import zh from '@/locales/zh'
import { IPC_EXCEPTION } from '@/composables/usePodcastChannel'
import {
  EPISODE_COPY_KEYS,
  EPISODE_PHASE_STEPS,
  RUN_ID_PATTERN,
  episodeCopyKeyFor,
  makeEpisodeRunId,
  usePodcastEpisodePublish,
} from '@/composables/usePodcastEpisodePublish'

const api = vi.hoisted(() => ({
  channelList: vi.fn(),
  episodeList: vi.fn(),
  episodePublishFromVideo: vi.fn(),
  episodePublishCancel: vi.fn(),
  // §6.4.2 第三条通道：默认「订不上」（available:false），使既有 31 条用例的行为保持原样；
  // 新增的进度用例显式把它换成可用的假实现。
  onEpisodePublishProgress: vi.fn(async () => ({ available: false })),
}))

vi.mock('@/api/podcast-channel', async (importOriginal) => {
  const actual = await importOriginal()
  return Object.assign({}, actual, api)
})

const ok = (data) => ({ available: true, result: Object.assign({ ok: true }, data) })
const fail = (envelope) => ({ available: true, result: Object.assign({ ok: false }, envelope) })

const CHANNELS = { channels: [{ id: 'ch_a', name: 'A', cap: 10, count: 1 }], defaultChannelId: 'ch_a', empty: false }
const SUCCESS_DATA = {
  state: 'success',
  phases: [
    { phase: 'pickChannel' },
    { phase: 'extractMix' },
    { phase: 'probe', durationSec: 12.5, sizeBytes: 204800, mime: 'audio/mpeg' },
    { phase: 'uploadAudio' },
    { phase: 'attach' },
    { phase: 'buildFeed' },
    { phase: 'uploadFeed' },
  ],
  audioUrl: 'https://cdn.example.com/audio/ch_a/ep.mp3',
  episodeId: 'ep-1',
  itemCount: 3,
  feedUrl: 'https://cdn.example.com/feeds/ch_a/feed.xml',
  message: '',
  errorCode: '',
  errorMessage: '',
}

function projectInput () {
  return reactive({
    projectId: 'p-1',
    title: '测试成片',
    segments: [
      { id: 's1', text: '第一段', audioMeta: { degraded: false } },
      { id: 's2', text: '第二段', audioMeta: { degraded: false } },
    ],
  })
}

function primeChannel (cap = 10, count = 1) {
  api.channelList.mockResolvedValue(ok(CHANNELS))
  api.episodeList.mockResolvedValue(ok({ episodes: [], cap, count }))
}

beforeEach(() => {
  vi.clearAllMocks()
  primeChannel()
})

describe('runId 形态（它同时是主进程临时目录名的一部分）', () => {
  it('默认生成命中 /^[A-Za-z0-9_-]{8,64}$/', () => {
    for (let i = 0; i < 200; i++) {
      expect(makeEpisodeRunId()).toMatch(RUN_ID_PATTERN)
    }
  })

  it('退化输入（时刻与随机数都为 0）仍必须合法——短于 8 位会被主进程当场判非法', () => {
    expect(makeEpisodeRunId(0, () => 0)).toMatch(RUN_ID_PATTERN)
  })

  it('超长输入被截到 64 位以内且不带入非法字符', () => {
    expect(makeEpisodeRunId(1e18, () => 0.12345678901234567)).toMatch(RUN_ID_PATTERN)
    expect(makeEpisodeRunId(Number.NaN, () => Number.NaN).length).toBeLessThanOrEqual(64)
  })
})

describe('领域码 → episode.* 文案键映射（§6.4 表的唯一一份）', () => {
  it('映射表逐字等于 §6.4 表所列（新增码必须同 PR 改这张表与两处 locale）', () => {
    expect({ ...EPISODE_COPY_KEYS }).toEqual({
      PODCAST_AUDIO_DEGRADED_SOURCE: 'audioDegraded',
      PODCAST_VIDEO_NOT_FOUND: 'videoMissing',
      PODCAST_AUDIO_EXTRACT_FAILED: 'extractFailed',
      PODCAST_AUDIO_ENCODER_UNAVAILABLE: 'encoderMissing',
      PODCAST_AUDIO_MEASURE_FAILED: 'measureFailed',
      PODCAST_AUDIO_SIZE_MISMATCH: 'sizeMismatch',
      PODCAST_EPISODES_FULL: 'capFull',
      PODCAST_EPISODE_INVALID: 'invalid',
      PODCAST_FEED_BUILD_FAILED: 'feedBuildFailed',
      PODCAST_PUBLISH_CANCELLED: 'cancelled',
      PODCAST_CANCEL_TOO_LATE: 'cancelTooLate',
    })
  })

  it('抽取失败按 stage 分两句：encoders＝打包产物崩坏，无 stage＝抽取本身失败', () => {
    expect(episodeCopyKeyFor('PODCAST_AUDIO_EXTRACT_FAILED', 'encoders')).toBe('encoderBroken')
    expect(episodeCopyKeyFor('PODCAST_AUDIO_EXTRACT_FAILED')).toBe('extractFailed')
    expect(episodeCopyKeyFor('PODCAST_AUDIO_EXTRACT_FAILED', 'mix')).toBe('extractFailed')
  })

  it('未映射的码交回给 podcast.errors.*（不在本通道重复造键）', () => {
    expect(episodeCopyKeyFor('PODCAST_HOSTING_UPLOAD_FAILED')).toBe('')
    expect(episodeCopyKeyFor('')).toBe('')
  })

  it('episode.* 与 phase.* 的每个键在 zh/en 都成对存在且为非空串', () => {
    // 映射表里的键 + encoderBroken（只由 stage 分支产出，不在表里）+ 结果三态的键
    const keys = [...new Set([...Object.values(EPISODE_COPY_KEYS), 'encoderBroken', 'success', 'partial'])]
    for (const key of keys) {
      const zhValue = zh.podcast.episode[key]
      const enValue = en.podcast.episode[key]
      expect(typeof zhValue, `zh podcast.episode.${key}`).toBe('string')
      expect(String(zhValue).length, `zh podcast.episode.${key} 不得为空`).toBeGreaterThan(0)
      expect(typeof enValue, `en podcast.episode.${key}`).toBe('string')
      expect(String(enValue).length, `en podcast.episode.${key} 不得为空`).toBeGreaterThan(0)
    }
    // 相位标签挂在 episode.phase.* 下，与上面的键分两族（混用会把 phase 键查成 undefined）
    for (const step of EPISODE_PHASE_STEPS) {
      expect(typeof zh.podcast.episode.phase[step], `zh phase.${step}`).toBe('string')
      expect(String(zh.podcast.episode.phase[step]).length, `zh phase.${step} 不得为空`).toBeGreaterThan(0)
      expect(typeof en.podcast.episode.phase[step], `en phase.${step}`).toBe('string')
      expect(String(en.podcast.episode.phase[step]).length, `en phase.${step} 不得为空`).toBeGreaterThan(0)
    }
    expect(Object.keys(zh.podcast.episode.phase).sort()).toEqual([...EPISODE_PHASE_STEPS].sort())
    expect(Object.keys(en.podcast.episode.phase).sort()).toEqual([...EPISODE_PHASE_STEPS].sort())
  })

  it('phase 七相位 + cancelled 的骨架顺序固定（浮层按它渲染，不得被顺手重排）', () => {
    expect([...EPISODE_PHASE_STEPS]).toEqual([
      'pickChannel', 'extractMix', 'probe', 'uploadAudio', 'attach', 'buildFeed', 'uploadFeed', 'cancelled',
    ])
  })
})

describe('usePodcastEpisodePublish 导出完整性（模板解构的每一个成员都要在）', () => {
  const SURFACE = [
    'publishing', 'result', 'runId', 'errorCode', 'errorDetail', 'errorStage', 'issues', 'cancelReceipt', 'cancelError',
    'activeChannelId', 'channelCap', 'channelCount',
    'state', 'cancellable', 'reachedPhases', 'measured', 'cancelOutcome', 'failureCode',
    'failureText', 'resultText', 'cancelText', 'detailText', 'hasIssues',
    // §6.4.2 第三条通道的四个成员：浮层的进度条与取消按钮读的就是这一组
    'livePhase', 'liveTrail', 'progressAvailable', 'stopProgressWatch',
    'start', 'requestCancel', 'reset',
  ]

  it('逐个 toHaveProperty（缺一个就是浮层拿到 undefined）', () => {
    const domain = usePodcastEpisodePublish()
    for (const name of SURFACE) {
      expect(domain, name).toHaveProperty(name)
    }
    expect(domain.state.value).toBe('')
    expect(domain.result.value).toBe(null)
    expect(domain.publishing.value).toBe(false)
  })

  it('导出集合与声明逐字相等（多一个成员＝浮层不会用、少一个成员＝模板静默拿 undefined）', () => {
    const domain = usePodcastEpisodePublish()
    expect(Object.keys(domain).sort()).toEqual([...SURFACE].sort())
  })
})

describe('发起出期：载荷形状与序列化', () => {
  it('project 脱壳为纯 JSON、不带 outBase、runId 由渲染层给且形态合法', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(ok(SUCCESS_DATA))
    const domain = usePodcastEpisodePublish()
    const project = projectInput()
    expect(isProxy(project)).toBe(true)

    await domain.start({ project, videoPath: 'D:/v/out.mp4', title: '第一期' })

    expect(api.episodePublishFromVideo).toHaveBeenCalledTimes(1)
    const payload = api.episodePublishFromVideo.mock.calls[0][0]
    expect(isProxy(payload)).toBe(false)
    expect(isProxy(payload.project)).toBe(false)
    expect(payload.project).not.toBe(project)
    expect(payload.project.segments).toEqual(project.segments)
    // 结构化克隆可达性：序列化后再解析必须逐字相同（循环引用等在这里就会露出来）
    expect(JSON.parse(JSON.stringify(payload))).toEqual(payload)
    expect(payload.channelId).toBe('ch_a')
    expect(payload.videoPath).toBe('D:/v/out.mp4')
    expect(payload.title).toBe('第一期')
    expect(payload.runId).toMatch(RUN_ID_PATTERN)
    // outBase 由主进程算：渲染层递路径＝把「写到哪、删到哪」的决定权交出去
    expect('outBase' in payload).toBe(false)
  })

  it('界面真源是结果页的分段副本时，segments 覆盖进载荷（降级判定读的就是这一份）', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(ok(SUCCESS_DATA))
    const domain = usePodcastEpisodePublish()
    const live = reactive([{ id: 's1', text: '改过', audioMeta: { degraded: true } }])

    await domain.start({ project: projectInput(), segments: live, videoPath: 'D:/v/out.mp4', title: '第一期' })

    const payload = api.episodePublishFromVideo.mock.calls[0][0]
    expect(payload.project.segments).toEqual([{ id: 's1', text: '改过', audioMeta: { degraded: true } }])
    expect(isProxy(payload.project.segments)).toBe(false)
  })

  it('缺项目数据（segments 不是数组）当场拒，不发外发调用', async () => {
    primeChannel()
    const domain = usePodcastEpisodePublish()
    const res = await domain.start({ project: reactive({ projectId: 'p' }), videoPath: 'D:/v/out.mp4', title: 'x' })
    expect(res.ok).toBe(false)
    expect(domain.errorCode.value).toBe('PODCAST_EPISODE_INVALID')
    expect(domain.failureText.value).toBe(zh.podcast.episode.invalid)
    expect(api.episodePublishFromVideo).not.toHaveBeenCalled()
  })

  it('没有频道上下文时先拒并给 PODCAST_CHANNEL_ID_REQUIRED，不得带空串打出去', async () => {
    api.channelList.mockResolvedValue(ok({ channels: [], defaultChannelId: '', empty: true }))
    api.episodeList.mockResolvedValue(ok({ episodes: [], cap: 0, count: 0 }))
    const domain = usePodcastEpisodePublish()
    const res = await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: 'x' })
    expect(res.ok).toBe(false)
    expect(domain.errorCode.value).toBe('PODCAST_CHANNEL_ID_REQUIRED')
    expect(api.episodePublishFromVideo).not.toHaveBeenCalled()
  })

  it('配额事前现算并拦截叠发：满了就不再外发（禁止跨动作缓存 count）', async () => {
    api.channelList.mockResolvedValue(ok({ channels: [{ id: 'ch_a', cap: 2, count: 2 }], defaultChannelId: 'ch_a', empty: false }))
    api.episodeList.mockResolvedValue(ok({ episodes: [], cap: 2, count: 2 }))
    const domain = usePodcastEpisodePublish()
    const res = await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: 'x' })
    expect(res.ok).toBe(false)
    expect(domain.errorCode.value).toBe('PODCAST_EPISODES_FULL')
    expect(domain.failureText.value).toBe(zh.podcast.episode.capFull)
    expect(api.episodePublishFromVideo).not.toHaveBeenCalled()
    // 每次发起都重新问目录与配额，而不是沿用上一次的值（PRD §8 禁止跨动作缓存）
    expect(api.episodeList).toHaveBeenCalledTimes(1)
    expect(api.channelList).toHaveBeenCalledTimes(1)
  })

  it('缺成片路径即拒并给新增码（不得复用 EXTRACT_FAILED 那条排查方向）', async () => {
    primeChannel()
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: '', title: 'x' })
    expect(domain.errorCode.value).toBe('PODCAST_VIDEO_NOT_FOUND')
    expect(domain.failureText.value).toBe(zh.podcast.episode.videoMissing)
    expect(api.episodePublishFromVideo).not.toHaveBeenCalled()
  })
})

describe('结果三态不得压平', () => {
  it('success：轨迹、实测值、feedUrl 一句都来自信封原值', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(ok(SUCCESS_DATA))
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })

    expect(domain.state.value).toBe('success')
    expect(domain.reachedPhases.value).toEqual([
      'pickChannel', 'extractMix', 'probe', 'uploadAudio', 'attach', 'buildFeed', 'uploadFeed',
    ])
    expect(domain.measured.value).toEqual({ durationSec: 12.5, sizeBytes: 204800, mime: 'audio/mpeg' })
    expect(domain.resultText.value).toBe(zh.podcast.episode.success.replace('{feedUrl}', SUCCESS_DATA.feedUrl))
    expect(domain.resultText.value).toContain('通常数小时至数天')
    expect(domain.resultText.value).not.toContain('即时生效')
    expect(domain.failureText.value).toBe('')
  })

  it('partial：本地已登记、公网未更新，不得变成 failed，也不得说成本地坏了', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(ok(Object.assign({}, SUCCESS_DATA, {
      state: 'partial',
      feedUrl: '',
      message: '这一期已登记到本地频道，公网 feed 尚未更新',
      errorCode: 'PODCAST_HOSTING_UPLOAD_FAILED',
      errorMessage: '上传失败（status=403）',
    })))
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })

    expect(domain.state.value).toBe('partial')
    expect(domain.state.value).not.toBe('failed')
    expect(domain.resultText.value).toBe(zh.podcast.episode.partial)
    expect(domain.resultText.value).not.toContain('失败')
    // 成因仍要可见可排查：未映射的码回落到 podcast.errors.<码>（不为本通道另造键）
    expect(domain.failureCode.value).toBe('PODCAST_HOSTING_UPLOAD_FAILED')
    expect(domain.failureText.value).toBe(zh.podcast.errors.PODCAST_HOSTING_UPLOAD_FAILED)
    expect(domain.detailText.value).toBe('上传失败（status=403）')
  })

  it('cancelled：回滚说明成一句，且与「取消回执」是两件事', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(ok(Object.assign({}, SUCCESS_DATA, {
      state: 'cancelled',
      phases: [{ phase: 'pickChannel' }, { phase: 'extractMix' }, { phase: 'cancelled' }],
      feedUrl: '',
    })))
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })

    expect(domain.state.value).toBe('cancelled')
    expect(domain.resultText.value).toBe(zh.podcast.episode.cancelled)
    expect(domain.reachedPhases.value).toEqual(['pickChannel', 'extractMix', 'cancelled'])
    expect(domain.cancelText.value).toBe('')
  })

  it('失败信封按 subCode 取 episode.* 文案，issues 原样带出', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(fail({
      code: -2,
      subCode: 'PODCAST_AUDIO_SIZE_MISMATCH',
      message: '上传字节与实测不符',
      issues: [{ code: 'EPISODE_SIZE_INVALID', path: 'episodes[0].sizeBytes', message: '字节数须为正整数' }],
    }))
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })

    expect(domain.state.value).toBe('failed')
    expect(domain.errorCode.value).toBe('PODCAST_AUDIO_SIZE_MISMATCH')
    expect(domain.failureText.value).toBe(zh.podcast.episode.sizeMismatch)
    expect(domain.result.value).toBe(null)
    expect(domain.hasIssues.value).toBe(true)
    expect(domain.issues.value).toEqual([{ code: 'EPISODE_SIZE_INVALID', path: 'episodes[0].sizeBytes', message: '字节数须为正整数' }])
  })

  it('stage=encoders 时抽取失败改口为「打包的 ffmpeg 无法执行」（主进程目前不透传 stage，见契约缺口）', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(fail({ code: -2, subCode: 'PODCAST_AUDIO_EXTRACT_FAILED', message: 'ffmpeg 无法执行（退出码 1）', stage: 'encoders' }))
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })
    expect(domain.failureText.value).toBe(zh.podcast.episode.encoderBroken)
  })
})

describe('取消（第二条通道）', () => {
  async function runningDomain () {
    primeChannel()
    let release
    api.episodePublishFromVideo.mockImplementation(() => new Promise((r) => { release = r }))
    const domain = usePodcastEpisodePublish()
    const started = domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })
    await vi.waitFor(() => expect(domain.publishing.value).toBe(true))
    return { domain, release, started }
  }

  it('accepted 只是「登记上了」，不得把运行中的状态读成 cancelled', async () => {
    const { domain, release, started } = await runningDomain()
    api.episodePublishCancel.mockResolvedValue(ok({ outcome: 'accepted', phase: 'extractMix' }))
    await domain.requestCancel()

    expect(domain.cancelOutcome.value).toBe('accepted')
    expect(domain.cancelText.value).toBe(zh.podcast.episode.cancelAccepted)
    expect(domain.state.value).toBe('running')
    expect(domain.resultText.value).toBe('')
    // 回执带的 phase 是主进程原值，能映射到相位标签就附上（本层不猜、不排）
    expect(domain.detailText.value).toBe(zh.podcast.episode.phase.extractMix)

    release(ok(Object.assign({}, SUCCESS_DATA, { state: 'cancelled', feedUrl: '' })))
    await started
    expect(domain.state.value).toBe('cancelled')
  })

  it('too_late 必须给出「为什么不能取消」，且不谎称已回滚', async () => {
    const { domain } = await runningDomain()
    api.episodePublishCancel.mockResolvedValue(ok({ outcome: 'too_late', phase: 'uploadAudio' }))
    await domain.requestCancel()
    expect(domain.cancelOutcome.value).toBe('too_late')
    expect(domain.cancelText.value).toBe(zh.podcast.episode.cancelTooLate)
    expect(domain.cancelText.value).not.toBe(zh.podcast.episode.cancelled)
  })

  it('unknown 不得读成「已取消，临时文件已回滚」', async () => {
    const { domain } = await runningDomain()
    api.episodePublishCancel.mockResolvedValue(ok({ outcome: 'unknown', phase: '' }))
    await domain.requestCancel()
    expect(domain.cancelOutcome.value).toBe('unknown')
    expect(domain.cancelText.value).toBe(zh.podcast.episode.cancelUnknown)
    expect(domain.cancelText.value).not.toContain('已回滚')
  })

  it('还没发起就没有可取消的对象：返回 null 且不发 IPC（不得伪造回执）', async () => {
    const domain = usePodcastEpisodePublish()
    expect(await domain.requestCancel()).toBe(null)
    expect(api.episodePublishCancel).not.toHaveBeenCalled()
    expect(domain.cancelReceipt.value).toBe(null)
  })

  it('取消通道按 runId 走，且与发起时同一个值', async () => {
    const { domain } = await runningDomain()
    api.episodePublishCancel.mockResolvedValue(ok({ outcome: 'accepted', phase: 'extractMix' }))
    await domain.requestCancel()
    expect(api.episodePublishCancel).toHaveBeenCalledWith({ runId: domain.runId.value })
    expect(domain.runId.value).toMatch(RUN_ID_PATTERN)
  })
})

describe('调用面的失败必须可见', () => {
  it('桥接层抛错 → PODCAST_IPC_EXCEPTION（不得静默成「没有结果」）', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockRejectedValue(new Error('boom'))
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })
    expect(domain.errorCode.value).toBe(IPC_EXCEPTION)
    expect(domain.state.value).toBe('failed')
    expect(domain.errorDetail.value).toBe('boom')
    expect(domain.publishing.value).toBe(false)
  })

  it('IPC 不可用（命名空间缺失）→ 走 errors.PODCAST_IPC_UNAVAILABLE 一句，而不是空结果', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue({ available: false })
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })
    expect(domain.errorCode.value).toBe('PODCAST_IPC_UNAVAILABLE')
    expect(domain.failureText.value).toBe(zh.podcast.errors.PODCAST_IPC_UNAVAILABLE)
  })

  it('reset 收干净：三态、回执、轨迹一次清空，不得留上一次的假结果', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(ok(SUCCESS_DATA))
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })
    domain.reset()
    expect(domain.state.value).toBe('')
    expect(domain.reachedPhases.value).toEqual([])
    expect(domain.measured.value).toBe(null)
    expect(domain.runId.value).toBe('')
    expect(domain.resultText.value).toBe('')
  })
})

describe('可取消判据不得在渲染层抄第二份（结构锁）', () => {
  /**
   * 结构锁必须先剥注释：本文件的头注释原文引了 §6.4 那句「取消按钮仅在 cancellableAt(phase)
   * 为真时可点」，不剥注释这条锁会把**引用**当成**实现**判红（本仓 IPC 字面量 harvest 的同族事故）。
   */
  function stripComments (src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^[ \t]*\/\/.*$/gm, '')
  }

  it('composable 里不得出现编排层判据的实现，也不得按相位序号自行判定', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const url = await import('node:url')
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    const src = stripComments(fs.readFileSync(path.resolve(here, 'usePodcastEpisodePublish.js'), 'utf8'))
    expect(src).toContain('cancellable === true')
    expect(src).not.toMatch(/cancellableAt/)
    expect(src).not.toMatch(/PHASES\.indexOf/)
    expect(src).not.toMatch(/indexOf\(\s*['"]uploadAudio['"]/)
    // 显示骨架允许存在，但它必须是「渲染用的常量」，不得被喂进任何比较
    expect(src).toMatch(/EPISODE_PHASE_STEPS/)
  })

  it('信封没给 cancellable 时恒为 false（浮层据此禁用取消按钮并说明原因）', async () => {
    primeChannel()
    api.episodePublishFromVideo.mockResolvedValue(ok(SUCCESS_DATA))
    const domain = usePodcastEpisodePublish()
    expect(domain.cancellable.value).toBe(false)
    await domain.start({ project: projectInput(), videoPath: 'D:/v/out.mp4', title: '第一期' })
    expect(domain.cancellable.value).toBe(false)
  })
})

describe('§6.4.2 第三条通道：逐相位实时进度', () => {
  it('start 边界推动进度条，done 边界带出实测值，别的 runId 不得动本遮罩', async () => {
    api.channelList.mockResolvedValue(ok(CHANNELS))
    api.episodeList.mockResolvedValue(ok({ episodes: [], cap: 10, count: 1 }))
    const seq = []
    const unsubscribe = vi.fn()
    let emit = null
    api.onEpisodePublishProgress.mockImplementation(async (cb) => {
      seq.push('subscribe')
      emit = cb
      return { available: true, result: unsubscribe }
    })
    const domain = usePodcastEpisodePublish()
    api.episodePublishFromVideo.mockImplementation(async () => {
      seq.push('invoke')
      const id = domain.runId.value
      emit({ runId: id, phase: 'extractMix', state: 'start', cancellable: true })
      // 另一条链（别的窗口/别的 run）的事件：必须被整条丢弃
      emit({ runId: 'zz-not-this-run', phase: 'uploadAudio', state: 'start', cancellable: false })
      emit({ runId: id, phase: 'extractMix', state: 'done' })
      emit({ runId: id, phase: 'probe', state: 'start', cancellable: true })
      // 实测值挂在 probe 那一站（宿主在编排层 mark('probe', {…}) 上产出，界面读的也是这一站）
      emit({ runId: id, phase: 'probe', state: 'done', durationSec: 12, sizeBytes: 3456, mime: 'audio/mpeg' })
      return ok({ state: 'success', phases: [], feedUrl: 'https://x/feed.xml' })
    })

    await domain.start({ project: { projectId: 'p', segments: [] }, videoPath: 'D:/v/out.mp4', title: '第一期' })

    expect(domain.progressAvailable.value).toBe(true)
    expect(domain.reachedPhases.value).toEqual(['extractMix', 'probe'])
    // 进度条停在**最后一个 start** 那一站：链中收到的边界序列决定这一位，而不是信封里的轨迹
    expect(domain.livePhase.value).toBe('probe')
    // 实测值在链**中**就能拿到——这条断言就是本通道存在的全部理由（信封里此刻还是空的）
    expect(domain.measured.value).toMatchObject({ durationSec: 12, sizeBytes: 3456, mime: 'audio/mpeg' })
    // 订阅必须发生在发起调用之前：晚一步就会丢掉第一个 start 边界，
    // 而症状是「进度条少一站」不是「订阅失败」，所以这条顺序本身要断言。
    expect(seq).toEqual(['subscribe', 'invoke'])
    // 收尾必须注销，且只注销自己那一个 handler
    expect(unsubscribe).toHaveBeenCalledTimes(1)
  })

  it('取消位只认事件下发的布尔：信封没给也不猜', async () => {
    api.channelList.mockResolvedValue(ok(CHANNELS))
    api.episodeList.mockResolvedValue(ok({ episodes: [], cap: 10, count: 1 }))
    let emit = null
    api.onEpisodePublishProgress.mockImplementation(async (cb) => {
      emit = cb
      return { available: true, result: vi.fn() }
    })
    const liveHolder = { value: null }
    const domain = usePodcastEpisodePublish()
    api.episodePublishFromVideo.mockImplementation(async () => {
      const id = domain.runId.value
      expect(domain.cancellable.value).toBe(false)
      emit({ runId: id, phase: 'probe', state: 'start', cancellable: true })
      liveHolder.value = domain.cancellable.value
      emit({ runId: id, phase: 'uploadAudio', state: 'start', cancellable: false })
      return ok({ state: 'success', phases: [] })
    })
    await domain.start({ project: { projectId: 'p', segments: [] }, videoPath: 'D:/v/out.mp4', title: 'x' })
    // 链中读到的那一次为 true（由主进程算），最后一次事件为 false 之后按钮回到禁用
    expect(liveHolder.value).toBe(true)
    expect(domain.cancellable.value).toBe(false)
  })

  it('订不上时必须显式声明「进度不可用」，不得伪装成有进度', async () => {
    api.channelList.mockResolvedValue(ok(CHANNELS))
    api.episodeList.mockResolvedValue(ok({ episodes: [], cap: 10, count: 1 }))
    api.onEpisodePublishProgress.mockResolvedValue({ available: false })
    api.episodePublishFromVideo.mockResolvedValue(ok({ state: 'success', phases: [{ phase: 'probe' }] }))
    const domain = usePodcastEpisodePublish()
    await domain.start({ project: { projectId: 'p', segments: [] }, videoPath: 'D:/v/out.mp4', title: 'x' })
    expect(domain.progressAvailable.value).toBe(false)
    // 降级路径仍然要能回看轨迹：链末信封是此刻唯一的真相来源
    expect(domain.reachedPhases.value).toEqual(['probe'])
  })
})
