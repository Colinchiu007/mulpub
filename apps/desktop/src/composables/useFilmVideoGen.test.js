// @ts-check
/**
 * useFilmVideoGen — 电影工程分镜视频生成 composable 契约测试（tasks 5.1/5.2，specs「视频生成/成本 checkpoint/单镜重试/成片合成」前端合同）
 *
 * 合同：
 *   - >10 镜前端拦截（pipeline 零调用，后端兜底另有集成测试覆盖）；
 *   - 发起负载纯 JSON 化（IPC 结构化克隆安全），initialContext.selectedShots 逐字符原文；
 *   - checkpoint 停闸 → costCheck 渲染数据（逐镜清单 + 参数 + provider）；
 *   - 确认 → confirmStageGate({cost_confirmation:{confirmed:true}}) → phase=generating；
 *   - 取消 → cancelRun 终止 run（引擎 paused 态不允许 advance，重发起走新 run 零计费）；
 *   - 逐镜结果列表：stages 状态 + context.generate_videos.videoResults 合并；
 *   - 单镜重试 → filmEngineeringRetryShot({runId,shotIndex,aspect,seconds})，不携带 prompt；
 *   - completed → finalPath 暴露（打开文件夹/另存由 View 走既有 IPC）。
 *
 * @vitest-environment node
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const publisher = vi.hoisted(() => ({
  pipelineStartOrchestrated: vi.fn(),
  pipelineGetRunContext: vi.fn(),
  pipelineCancelRun: vi.fn(),
  pipelineConfirmStageGate: vi.fn(),
  onPipelineUpdate: vi.fn(() => () => {}),
  filmEngineeringRetryShot: vi.fn(),
}))

vi.mock('@/api/publisher', () => publisher)

import { useFilmVideoGen, FILM_MAX_VIDEO_BATCH } from './useFilmVideoGen'

function makeShots(n) {
  return Array.from({ length: n }, (_, i) => ({
    shotId: 's-' + i,
    sceneId: 'scene-a',
    prompt: 'p' + i + ' <<<uuid:00000000-0000-4000-8000-00000000000' + (i % 10) + '>>>',
    model: 'seedance-2.0',
    refTokens: ['<<<uuid>>>'],
  }))
}

function baseSnapshot(over = {}) {
  return {
    runId: 'run-1',
    pipeline: 'film-engineering',
    status: { status: 'paused', currentStage: 4, progress: 0.66 },
    currentStage: 4,
    stages: [
      { name: 'load_template', status: 'completed' },
      { name: 'adapt_script', status: 'completed' },
      { name: 'select_shots', status: 'completed' },
      { name: 'export_prompts', status: 'completed' },
      { name: 'generate_videos', status: 'running' },
      { name: 'render', status: 'pending' },
    ],
    context: {
      selectedShots: makeShots(2),
      generate_videos: {
        awaitingConfirmation: true,
        costCheck: {
          totalShots: 2, maxBatch: 10, aspect: '16x9', seconds: 5, providerId: 'mv', model: 'm1',
          shots: [{ index: 0, shotId: 's-0', title: '开场', aspect: '16x9', seconds: 5 }, { index: 1, shotId: 's-1', title: '收尾', aspect: '16x9', seconds: 5 }],
        },
      },
    },
    checkpoint: { stageName: 'generate_videos', type: 'manual_checkpoint', required: true },
    ...over,
  }
}

/** 推进宏任务队列（事件推送/异步链落地） */
async function flush() {
  for (let i = 0; i < 6; i++) await Promise.resolve()
}

describe('useFilmVideoGen', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] })
    publisher.pipelineStartOrchestrated.mockReset()
    publisher.pipelineGetRunContext.mockReset()
    publisher.pipelineCancelRun.mockReset()
    publisher.pipelineConfirmStageGate.mockReset()
    publisher.filmEngineeringRetryShot.mockReset()
    publisher.onPipelineUpdate.mockReset().mockImplementation(() => () => {})
  })
  afterEach(() => {
    vi.useRealTimers()
  })

  it('>10 镜前端拦截：pipeline 零调用，报 tooManyShots', async () => {
    const c = useFilmVideoGen()
    const res = await c.start(makeShots(FILM_MAX_VIDEO_BATCH + 1), { aspect: '16x9', seconds: 5 })
    expect(res.ok).toBe(false)
    expect(res.errorCode).toBe('tooManyShots')
    expect(publisher.pipelineStartOrchestrated).not.toHaveBeenCalled()
    c.dispose()
  })

  it('发起：payload 纯 JSON 可结构化克隆，selectedShots 逐字符原文（uuid 令牌保留）', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext.mockResolvedValue({ code: 0, data: baseSnapshot() })
    const c = useFilmVideoGen()
    const shots = makeShots(2)
    const res = await c.start(shots, { aspect: '9x16', seconds: 8 })
    expect(res.ok).toBe(true)
    const [name, params] = publisher.pipelineStartOrchestrated.mock.calls[0]
    expect(name).toBe('film-engineering')
    expect(() => structuredClone(params)).not.toThrow()
    expect(params.autoAdvance).toBe(true)
    expect(params.aspect).toBe('9x16')
    expect(params.seconds).toBe(8)
    expect(params.initialContext.selectedShots.map((s) => s.prompt)).toEqual(shots.map((s) => s.prompt))
    c.dispose()
  })

  it('startOrchestrated 失败 → 透出错误不落 runId', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: -1, message: 'boom' })
    const c = useFilmVideoGen()
    const res = await c.start(makeShots(1), { aspect: '16x9', seconds: 5 })
    expect(res.ok).toBe(false)
    expect(c.runId.value).toBe(null)
    c.dispose()
  })

  it('checkpoint 停闸 → costCheck 暴露逐镜清单与参数', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext.mockResolvedValue({ code: 0, data: baseSnapshot() })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '16x9', seconds: 5 })
    await flush()
    expect(c.phase.value).toBe('awaiting-confirm')
    expect(c.costCheck.value.totalShots).toBe(2)
    expect(c.costCheck.value.shots.map((s) => s.shotId)).toEqual(['s-0', 's-1'])
    c.dispose()
  })

  it('确认 → confirmStageGate 携带 cost_confirmation patch；run 转 running → generating', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext
      .mockResolvedValueOnce({ code: 0, data: baseSnapshot() })
      .mockResolvedValueOnce({ code: 0, data: baseSnapshot({ status: { status: 'running', currentStage: 4, progress: 0.7 }, checkpoint: null }) })
    publisher.pipelineConfirmStageGate.mockResolvedValue({ code: 0, data: { success: true } })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '16x9', seconds: 5 })
    await flush()
    const res = await c.confirmCost()
    expect(res.ok).toBe(true)
    expect(publisher.pipelineConfirmStageGate).toHaveBeenCalledWith('run-1', {
      cost_confirmation: { confirmed: true, confirmedAt: expect.any(String) },
    })
    await flush()
    expect(c.phase.value).toBe('generating')
    c.dispose()
  })

  it('取消 → cancelRun 终止该 run', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext.mockResolvedValue({ code: 0, data: baseSnapshot() })
    publisher.pipelineCancelRun.mockResolvedValue({ code: 0, data: { success: true } })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '16x9', seconds: 5 })
    await flush()
    const res = await c.cancelCost()
    expect(res.ok).toBe(true)
    expect(publisher.pipelineCancelRun).toHaveBeenCalledWith('run-1')
    expect(publisher.pipelineConfirmStageGate).not.toHaveBeenCalled()
    c.dispose()
  })

  it('逐镜结果列表：videoResults 与 stage 状态合并（成功/失败可判别）', async () => {
    const snap = baseSnapshot({
      status: { status: 'running', currentStage: 5, progress: 0.83 },
      currentStage: 5,
      checkpoint: null,
      stages: baseSnapshot().stages.map((s) => (s.name === 'generate_videos' ? { ...s, status: 'completed' } : s)),
    })
    snap.context.generate_videos = {
      videoResults: [
        { index: 0, shotId: 's-0', success: true, path: '/tmp/film-engineering/run-1/shot_000.mp4' },
        { index: 1, shotId: 's-1', success: false, error: 'provider timeout' },
      ],
      runDir: '/tmp/film-engineering/run-1',
      partialFailure: true,
    }
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext
      .mockResolvedValueOnce({ code: 0, data: baseSnapshot() })
      .mockResolvedValue({ code: 0, data: snap })
    publisher.pipelineConfirmStageGate.mockResolvedValue({ code: 0, data: { success: true } })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '16x9', seconds: 5 })
    await flush()
    await c.confirmCost()
    await flush()
    const rows = c.shotResults.value
    expect(rows.length).toBe(2)
    expect(rows[0].status).toBe('success')
    expect(rows[1].status).toBe('failed')
    expect(rows[1].error).toBe('provider timeout')
    c.dispose()
  })

  it('单镜重试：仅传 runId/shotIndex/参数（prompt 由主进程取 run 内原文，前端不携带）', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext.mockResolvedValue({ code: 0, data: baseSnapshot() })
    publisher.filmEngineeringRetryShot.mockResolvedValue({ code: 0, data: { index: 1, success: true, path: '/x/shot_001.mp4' } })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '9x16', seconds: 8 })
    await flush()
    const res = await c.retryShot(1)
    expect(res.ok).toBe(true)
    const payload = publisher.filmEngineeringRetryShot.mock.calls[0][0]
    expect(payload.runId).toBe('run-1')
    expect(payload).not.toHaveProperty('prompt')
    expect(payload.shotIndex).toBe(1)
    expect(payload.aspect).toBe('9x16')
    expect(payload.seconds).toBe(8)
    c.dispose()
  })

  it('单镜重试失败 →透出主进程错误信息', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext.mockResolvedValue({ code: 0, data: baseSnapshot() })
    publisher.filmEngineeringRetryShot.mockResolvedValue({ code: -2, message: 'shotIndex 不属于该 run' })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '16x9', seconds: 5 })
    await flush()
    const res = await c.retryShot(9)
    expect(res.ok).toBe(false)
    expect(res.error).toMatch(/shotIndex/)
    c.dispose()
  })

  it('completed → finalPath 暴露，phase=done', async () => {
    const snap = baseSnapshot({
      status: { status: 'completed', currentStage: 5, progress: 1 },
      checkpoint: null,
      stages: baseSnapshot().stages.map((s) => ({ ...s, status: 'completed' })),
    })
    snap.context.render = { finalPath: '/tmp/film-engineering/run-1/final.mp4', mode: 'copy', clipCount: 2, runDir: '/tmp/film-engineering/run-1' }
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext
      .mockResolvedValueOnce({ code: 0, data: baseSnapshot() })
      .mockResolvedValue({ code: 0, data: snap })
    publisher.pipelineConfirmStageGate.mockResolvedValue({ code: 0, data: { success: true } })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '16x9', seconds: 5 })
    await flush()
    await c.confirmCost()
    await flush()
    expect(c.phase.value).toBe('done')
    expect(c.finalPath.value).toMatch(/final\.mp4$/)
    c.dispose()
  })

  it('阶段失败带 VIDEO_MODEL_NOT_CONFIGURED → phase=failed 且引导码透出', async () => {
    const snap = baseSnapshot({
      status: { status: 'failed', currentStage: 4, progress: 0.66 },
      checkpoint: null,
      error: { message: '需要视频模型', errorCode: 'VIDEO_MODEL_NOT_CONFIGURED' },
      stages: baseSnapshot().stages.map((s) => (s.name === 'generate_videos' ? { ...s, status: 'failed', error: { errorCode: 'VIDEO_MODEL_NOT_CONFIGURED' } } : s)),
    })
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext
      .mockResolvedValueOnce({ code: 0, data: baseSnapshot() })
      .mockResolvedValue({ code: 0, data: snap })
    publisher.pipelineConfirmStageGate.mockResolvedValue({ code: 0, data: { success: true } })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '16x9', seconds: 5 })
    await flush()
    await c.confirmCost()
    await flush()
    expect(c.phase.value).toBe('failed')
    expect(c.errorCode.value).toBe('VIDEO_MODEL_NOT_CONFIGURED')
    c.dispose()
  })

  it('push 事件仅消费本 runId 快照（串扰守卫）', async () => {
    publisher.pipelineStartOrchestrated.mockResolvedValue({ code: 0, data: { success: true, runId: 'run-1' } })
    publisher.pipelineGetRunContext.mockResolvedValue({ code: 0, data: baseSnapshot() })
    let pushCb = null
    publisher.onPipelineUpdate.mockImplementation((cb) => { pushCb = cb; return () => {} })
    const c = useFilmVideoGen()
    await c.start(makeShots(2), { aspect: '16x9', seconds: 5 })
    await flush()
    const before = c.progress.value
    pushCb({ runId: 'other-run', status: { status: 'completed', progress: 1 }, stages: [] })
    await flush()
    expect(c.progress.value).toBe(before)
    c.dispose()
  })
})
