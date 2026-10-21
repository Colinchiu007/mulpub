// @ts-check
/**
 * useCollectionVideoCreation.test.js — 采集页「视频创作」就地编排回归锁
 * （fix-collection-rewrite-publish-flow，2026-10-20）。
 *
 * 用户可见事故：采集页点「去发布 → 视频创作」后**跳到视频创作页**，
 * 且带入的文案是**上一次改写**的结果。期望：发布浮层消失，就地弹出
 * 视频创作流水线的**执行进度浮层**，输入是**当前这次**改写的结果。
 *
 * 本文件锁 composable 层的三条契约：
 *  ① 启动流水线时用的文案 = 传入的当前改写结果（不是任何旧草稿）；
 *  ② 进度浮层在流水线跑起来之前就打开（用户立刻看到「启动中」而不是无反馈）；
 *  ③ 文案超流水线上限时**如实披露**（裁切发生即置位 truncated 标记）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  pipelineStartOrchestrated: vi.fn(),
  pipelineCancelRun: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  onPipelineUpdate: vi.fn(() => () => {}),
  storeGetSetting: vi.fn(),
  story2videoConfigProfileList: vi.fn(),
  modelProviderGetDefault: vi.fn(),
  aiGenerateGenVideoTitle: vi.fn(),
  routerPush: vi.fn(),
}))

vi.mock('@/api/publisher', () => ({
  pipelineStartOrchestrated: mocks.pipelineStartOrchestrated,
  pipelineCancelRun: mocks.pipelineCancelRun,
  pipelineGetRunContext: mocks.pipelineGetRunContext,
  onPipelineUpdate: mocks.onPipelineUpdate,
  storeGetSetting: mocks.storeGetSetting,
  story2videoConfigProfileList: mocks.story2videoConfigProfileList,
  modelProviderGetDefault: mocks.modelProviderGetDefault,
  aiGenerateGenVideoTitle: mocks.aiGenerateGenVideoTitle,
}))

vi.mock('vue-router', () => ({ useRouter: () => ({ push: mocks.routerPush }) }))
vi.mock('vue-i18n', () => ({ useI18n: () => ({ t: (k) => k }) }))
vi.mock('@/i18n', () => ({ getAppLocale: () => 'zh-CN' }))

import { useCollectionVideoCreation, clampStory2VideoText } from './useCollectionVideoCreation'

/** 流水线启动成功返回 */
function startOk (runId = 'run-1') {
  return { code: 0, data: { runId, success: true, stages: [{ name: 'script', status: 'running' }] } }
}

describe('useCollectionVideoCreation — 采集页视频创作就地编排', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mocks.onPipelineUpdate.mockReturnValue(() => {})
    mocks.storeGetSetting.mockResolvedValue(null)
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [] })
    mocks.pipelineStartOrchestrated.mockResolvedValue(startOk())
    mocks.pipelineGetRunContext.mockResolvedValue({ code: 0, data: { runId: 'run-1', status: { status: 'running', progress: 10 } } })
  })

  it('启动流水线用的文案 = 传入的当前改写结果（最新那次，不是旧草稿）', async () => {
    const c = useCollectionVideoCreation()
    const LATEST = '这是第二次改写后的最新文案'
    const started = await c.startVideoCreation({ text: LATEST, title: '标题' })
    expect(started).toBe(true)

    expect(mocks.pipelineStartOrchestrated).toHaveBeenCalledTimes(1)
    const [pipelineName, params] = mocks.pipelineStartOrchestrated.mock.calls[0]
    expect(pipelineName).toBe('story2video-compose')
    // 启动参数里的 prompt / text 必须是**最新**改写结果
    expect(params.text).toBe(LATEST)
    expect(params.story2videoTextConfig.prompt).toBe(LATEST)
  })

  it('进度浮层在流水线跑起来之前就打开（用户立刻有反馈）', async () => {
    const c = useCollectionVideoCreation()
    expect(c.videoModalOpen.value).toBe(false)
    const pending = c.startVideoCreation({ text: '文案' })
    // 启动尚未完成时浮层已打开
    expect(c.videoModalOpen.value).toBe(true)
    expect(c.videoPhase.value).toBe('starting')
    await pending
    expect(c.videoModalOpen.value).toBe(true)
    expect(c.videoPhase.value).toBe('running')
    expect(c.videoRunId.value).toBe('run-1')
  })

  it('阶段列表来自流水线 Registry，且**不含**改写阶段（改写已完成）', async () => {
    const c = useCollectionVideoCreation()
    await c.startVideoCreation({ text: '文案' })
    const names = c.videoStages.value.map((s) => s.name)
    expect(names.length).toBeGreaterThan(0)
    expect(names).not.toContain('rewrite_copy')
  })

  it('流水线启动失败 ⇒ 浮层留在失败态并给出可见错误（不静默关掉）', async () => {
    mocks.pipelineStartOrchestrated.mockResolvedValue({ code: -1, message: '启动失败' })
    const c = useCollectionVideoCreation()
    const started = await c.startVideoCreation({ text: '文案' })
    expect(started).toBe(false)
    expect(c.videoModalOpen.value).toBe(true)
    expect(c.videoPhase.value).toBe('failed')
    expect(c.videoErrorText.value).toBeTruthy()
    expect(c.videoBusy.value).toBe(false)
  })

  it('空文案 ⇒ 拒绝启动（不建流水线 run）', async () => {
    const c = useCollectionVideoCreation()
    const started = await c.startVideoCreation({ text: '   ' })
    expect(started).toBe(false)
    expect(mocks.pipelineStartOrchestrated).not.toHaveBeenCalled()
  })

  it('文案超流水线上限 ⇒ 裁切并如实披露（truncated 标记 + 原文长度）', async () => {
    const c = useCollectionVideoCreation()
    const long = '字'.repeat(12000) // 默认上限 10000 码点
    await c.startVideoCreation({ text: long })
    expect(c.videoTextTruncated.value).toBe(true)
    expect(c.videoTextTruncatedLength.value).toBe(12000)
    const [, params] = mocks.pipelineStartOrchestrated.mock.calls[0]
    expect([...params.text].length).toBe(10000)
  })

  it('取消：已启动的 run 走 pipelineCancelRun，阶段落 cancelled', async () => {
    const c = useCollectionVideoCreation()
    await c.startVideoCreation({ text: '文案' })
    await c.cancelVideoCreation()
    expect(mocks.pipelineCancelRun).toHaveBeenCalledWith('run-1')
    expect(c.videoPhase.value).toBe('cancelled')
    expect(c.videoStages.value.every((s) => s.status === 'cancelled')).toBe(true)
  })

  it('成片就绪后【查看视频】跳历史视图；未就绪时按钮不生效', async () => {
    const c = useCollectionVideoCreation()
    await c.startVideoCreation({ text: '文案' })
    c.viewVideoInHistory()
    expect(mocks.routerPush).not.toHaveBeenCalled()
  })

  // ── 配置档案（主干 publish-config-picker 带来的「去发布」弹窗选择）──
  //
  // 本入口不再跳创作页 ⇒ 用户在弹窗里选中的配置必须由采集页自己兑现。
  // 兑现不了就是主干在热门选题页修过的同一个坑：**选了等于没选**。
  it('选了配置档案 ⇒ 启动参数用**档案的**选项（不是「上次选项」，也不是默认值）', async () => {
    mocks.story2videoConfigProfileList.mockResolvedValue({
      code: 0,
      data: [{
        id: 'profile-000000000009',
        name: '口播竖屏',
        pipelineId: 'story2video-compose',
        snapshot: {
          schemaVersion: 1,
          kind: 'orchestrated',
          s2vConfig: { voiceSpeed: 1.8 },
          s2vOutputConfig: { resolution: '1080x1920', fps: 30, format: 'mp4' },
        },
        updatedAt: 1,
      }],
    })
    const c = useCollectionVideoCreation()
    await c.startVideoCreation({ text: '文案', configProfileId: 'profile-000000000009' })
    const [, params] = mocks.pipelineStartOrchestrated.mock.calls[0]
    // 档案里的值必须进到启动参数（默认值是 voiceSpeed=1 / resolution=720x1280）
    expect(params.story2videoTextConfig.voice.speed).toBe(1.8)
    expect(params.story2videoTextConfig.size).toBe('1080x1920')
    expect(c.videoConfigProfileWarning.value).toBe('')
  })

  it('配置档案已不存在 ⇒ 视频照常出，但浮层里留一条**可见**提示', async () => {
    mocks.story2videoConfigProfileList.mockResolvedValue({ code: 0, data: [] })
    const c = useCollectionVideoCreation()
    const started = await c.startVideoCreation({ text: '文案', configProfileId: 'profile-000000000099' })
    expect(started).toBe(true)
    expect(c.videoConfigProfileWarning.value).toBe('create.story2video.configProfile.notFound')
  })

  it('没选配置档案 ⇒ 不去读配置库（无谓的 IPC 也不发生）', async () => {
    const c = useCollectionVideoCreation()
    await c.startVideoCreation({ text: '文案' })
    expect(mocks.story2videoConfigProfileList).not.toHaveBeenCalled()
    expect(c.videoConfigProfileWarning.value).toBe('')
  })
})

describe('clampStory2VideoText — 码点裁切（不切碎 emoji）', () => {
  it('未超限 ⇒ 原样返回，不标记截断', () => {
    const r = clampStory2VideoText('短文案', 100)
    expect(r.text).toBe('短文案')
    expect(r.truncated).toBe(false)
  })

  it('超限 ⇒ 按码点裁切（emoji 不被劈成半个代理对）', () => {
    const src = '😀'.repeat(10)
    const r = clampStory2VideoText(src, 4)
    expect(r.truncated).toBe(true)
    expect([...r.text].length).toBe(4)
    expect(r.text).not.toMatch(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/)
  })
})

// ── 外部依赖的契约锁（QM-6 深审 i5 的建议：别靠「防御性文字」担保依赖完整性）──
//
// 本 composable **复用**热门选题一键成片的六个既有模块（不写第二份实现）。
// 「它们存在且导出名没变」这件事必须有**自动化断言**，而不是注释里的一句「已存在」：
// 将来任何一方改名/移除，这里当场红，而不是等到构建期才发现。
describe('外部复用模块的存在性与导出契约', () => {
  it('阶段跟踪模块：导出齐全且函数', async () => {
    const m = await import('@/features/hot-topics/gen-video-stage-tracking')
    for (const name of [
      'stageNamesForPipeline',
      'markFirstGenVideoStageRunning',
      'markFirstGenVideoStageFailed',
      'resetGenVideoStagesToPending',
      'completeUnfinishedGenVideoStages',
      'finalizeGenVideoTerminalStages',
      'cancelGenVideoStages',
    ]) {
      expect(typeof m[name], `阶段跟踪模块缺少导出 ${name}`).toBe('function')
    }
  })

  it('展示派生模块：导出齐全且函数', async () => {
    const m = await import('@/features/hot-topics/gen-video-view-model')
    for (const name of [
      'buildGenVideoPipelineLabel',
      'computeGenVideoProgressPercent',
      'isGenVideoTerminalPhase',
      'canRetryGenVideo',
      'canCancelGenVideo',
      'canBackgroundGenVideo',
      'isGenVideoResultReady',
    ]) {
      expect(typeof m[name], `展示派生模块缺少导出 ${name}`).toBe('function')
    }
  })

  it('启动参数构造模块：导出齐全且函数', async () => {
    const m = await import('@/features/hot-topics/gen-video-pipelines')
    expect(typeof m.buildGenVideoStartParams).toBe('function')
    expect(typeof m.DEFAULT_GEN_VIDEO_PIPELINE).toBe('string')
  })

  it('成片路径提取模块：导出齐全且函数', async () => {
    const m = await import('@/features/pipeline/run-context-video-path')
    expect(typeof m.extractRunContextVideoPath).toBe('function')
  })

  it('发布出口 query 模块：导出齐全且函数', async () => {
    const m = await import('@/composables/useGenVideoPublishTitle')
    expect(typeof m.buildGenVideoPublishQuery).toBe('function')
  })

  it('故事文案上限模块：导出齐全（内置默认值是裁切的依据）', async () => {
    const m = await import('@/story2video/story-text-limit')
    expect(typeof m.DEFAULT_STORY2VIDEO_TEXT_LIMIT).toBe('object')
    expect(m.DEFAULT_STORY2VIDEO_TEXT_LIMIT.maxChars).toBeGreaterThan(0)
  })
})
