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
