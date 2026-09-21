// @vitest-environment node
const fs = require('fs')
const http = require('http')
const { execFile } = require('child_process')
const os = require('os')
const path = require('path')
const {
  registerStory2VideoStages,
  STORY2VIDEO_STAGE_TYPES,
  normalizeAssetConcurrency,
  hasMeaningfulText,
  isPromptEngineTooShortRejection,
  isPromptEngineEmptyReasoningError,
  tryReCloneVoice,
  pickFixedVideoScenes,
  parseVideoSelection,
  clampVideoSelection,
  estimateSceneSeconds,
  withAssetTransientRetry,
  resolveVideoGeneratorConfig,
  resolveSceneFinalFrame,
  optimizeVideoScenePrompts,
  translatePromptsForLocale,
  runBoundedPromptTranslation,
  createPromptTranslationPending,
} = require('./story2video-stages')
const {
  cleanupRunInputDir,
  importUserSelectedMedia,
  STORY2VIDEO_TEMP_DIR,
} = require('./story2video-paths')
const { findFfmpeg } = require('./media-tool-paths')
const { StageExecutor, STAGE_TYPES } = require('./stage-executor')

// CI runner 可能没有预先创建系统临时目录下的 Story2Video 根目录。
fs.mkdirSync(STORY2VIDEO_TEMP_DIR, { recursive: true })

afterEach(() => {
  cleanupRunInputDir('run')
})

function makeStageExecutor() {
  const executors = new Map()
  return {
    executors,
    register(type, fn) { executors.set(type, fn) },
  }
}

function makePipeline(assetGenerator, aiGenerator, options = {}) {
  const stageExecutor = makeStageExecutor()
  const pipeline = {
    stageExecutor,
    _assetGenerator: assetGenerator,
    aiGenerator,
    container: options.container,
    governor: options.governor,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    registerStageExecutor(type, fn) {
      stageExecutor.register(type, fn)
      return { success: true }
    },
  }
  registerStory2VideoStages(pipeline)
  const assetsExecutor = stageExecutor.executors.get(STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS)
  assetsExecutor.optimizeExecutor = stageExecutor.executors.get(STORY2VIDEO_STAGE_TYPES.OPTIMIZE)
  assetsExecutor.sceneContextExecutor = stageExecutor.executors.get(STORY2VIDEO_STAGE_TYPES.SCENE_CONTEXT)
  assetsExecutor.finalizeAssetsExecutor = stageExecutor.executors.get(STORY2VIDEO_STAGE_TYPES.FINALIZE_ASSETS)
  return assetsExecutor
}

async function createRecloneFixture() {
  const sampleRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 's2v-stage-reclone-'))
  const sampleDir = path.join(sampleRoot, 'voice-clone-samples', 'owner', 'storage-1')
  await fs.promises.mkdir(sampleDir, { recursive: true })
  await fs.promises.writeFile(path.join(sampleDir, 'sample.mp3'), Buffer.from([1, 2, 3]))

  const cloneVoice = vi.fn(async () => ({ id: 'MiniMaxVoice_recloned123' }))
  const findCloneSamples = vi.fn(async () => ({
    sampleStorage: { relativeDir: 'voice-clone-samples/owner/storage-1' },
    name: '音色001',
  }))
  const replaceCloneVoiceId = vi.fn(async ({ voiceId, replacementVoiceId }) => ({
    code: 0,
    data: { migrated: true, voice: { id: replacementVoiceId }, previousVoiceId: voiceId },
  }))
  const manager = {
    // Match the production ModelProviderManager contract. It exposes
    // callAdapter(), not getAdapter(), and wraps adapter results in code/data.
    callAdapter: vi.fn(async (providerId, method, params) => {
      if (providerId !== 'minimax-multimodal' || method !== 'cloneVoice') {
        return { code: -1, errorCode: 'UNEXPECTED_CALL', message: providerId + '.' + method }
      }
      return { code: 0, data: await cloneVoice(params) }
    }),
  }
  const cloneService = {
    findCloneSamples,
    replaceCloneVoiceId,
    _resolveUserDataPath: () => sampleRoot,
  }
  const container = {
    get: vi.fn((key) => key === 'ttsVoiceCloneService' ? cloneService : null),
  }

  return {
    sampleRoot,
    manager,
    cloneVoice,
    findCloneSamples,
    replaceCloneVoiceId,
    container,
    aiGenerator: { _modelProviderManager: manager },
  }
}

function expectRecloneAttempt(fixture) {
  expect(fixture.findCloneSamples).toHaveBeenCalledWith(
    'MiniMaxVoice_original001',
    'minimax-multimodal',
    expect.any(String),
  )
  expect(fixture.manager.callAdapter).toHaveBeenCalledWith(
    'minimax-multimodal',
    'cloneVoice',
    expect.objectContaining({
      name: 'MiniMaxVoice_original001',
      samples: [expect.objectContaining({ blob: expect.any(Blob) })],
    }),
    { providerRunContext: expect.any(Object) },
  )
  expect(fixture.cloneVoice).toHaveBeenCalledTimes(1)
  expect(fixture.replaceCloneVoiceId).toHaveBeenCalledWith(expect.objectContaining({
    providerId: 'minimax-multimodal',
    voiceId: 'MiniMaxVoice_original001',
    replacementVoiceId: 'MiniMaxVoice_recloned123',
  }))
}

/**
 * prompt-engine 阶段的 ServiceBus 夹具：optimizePrompt 记录调用并返回 OptimizeResult。
 * respond 可自定义响应或抛错；默认返回 { optimized_prompt: '优化: <prompt>', platform, style, model_used, key_source }。
 */
function makeOptimizeBus(respond) {
  const calls = []
  const serviceBus = {
    calls,
    optimizePrompt: vi.fn(async (prompt, options) => {
      calls.push({ prompt, options })
      if (typeof respond === 'function') return respond({ prompt, options }, calls.length - 1)
      return {
        optimized_prompt: '优化: ' + prompt,
        platform: options.platform || 'generic',
        style: options.style || null,
        model_used: 'mock-model',
        key_source: 'config',
      }
    }),
    optimizePromptsBatch: vi.fn(),
  }
  return serviceBus
}

describe('Round3 B 跨镜终态辅助合同', () => {
  it('按 video.final_frame → endingState → finalFrame 优先级解析，忽略空白与非字符串', () => {
    expect(resolveSceneFinalFrame({
      video: { final_frame: '  canonical frame  ' },
      endingState: 'legacy ending',
      finalFrame: 'legacy frame',
    })).toEqual({ value: 'canonical frame', source: 'video.final_frame' })
    expect(resolveSceneFinalFrame({ video: { final_frame: '  ' }, endingState: ' ending ' }))
      .toEqual({ value: 'ending', source: 'endingState' })
    expect(resolveSceneFinalFrame({ video: { final_frame: 42 }, endingState: {}, finalFrame: ' frame ' }))
      .toEqual({ value: 'frame', source: 'finalFrame' })
    expect(resolveSceneFinalFrame({ video: { final_frame: 42 }, endingState: {}, finalFrame: [] }))
      .toEqual({ value: '', source: null })
  })

  it('resume checkpoint final_frame 覆盖场景残留值，并在缺失时降级到旧字段', () => {
    expect(resolveSceneFinalFrame(
      { video: { final_frame: 'stale scene frame' }, endingState: 'stale ending' },
      { final_frame: 'checkpoint planned frame', finalFrame: 'legacy checkpoint frame' },
    )).toEqual({ value: 'checkpoint planned frame', source: 'checkpoint.final_frame' })
    expect(resolveSceneFinalFrame(
      { video: { final_frame: 'scene fallback' } },
      { final_frame: '  ', continuity: { finalFrame: 'checkpoint continuity frame' } },
    )).toEqual({ value: 'checkpoint continuity frame', source: 'checkpoint.continuity.finalFrame' })
  })

  it('稀疏 resume 在场景顺序中恢复真实终态，后续场景承接 resume frame', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-sparse-resume-'))
    const resumedVideo = path.join(dir, 'scene-1.mp4')
    fs.writeFileSync(resumedVideo, 'resumed')
    const scenes = [{}, { endingState: 'resume-end-1' }, {}]
    const optimizeVideoPrompt = vi.fn(async (prompt, options) => ({
      optimized_prompt: 'optimized-' + prompt,
      video: { final_frame: 'runtime-' + prompt },
    }))
    const log = { info: vi.fn(), warn: vi.fn() }
    try {
      const results = await optimizeVideoScenePrompts({
        pipelineEngine: {},
        serviceBus: { optimizeVideoPrompt },
        videoSceneIndexes: [0, 1, 2],
        optimizedPrompts: ['p0', 'p1', 'p2'],
        scenes,
        resumeCompleted: new Map([[1, { videoPath: resumedVideo }]]),
        videoGenerator: { providerId: 'kling' },
        videoConfig: {},
        runId: 'sparse-resume',
        log,
        fallbackLabel: 'fallback',
        missingBridgeLabel: 'fallback',
      })
      expect([...results.keys()]).toEqual([0, 2])
      expect(optimizeVideoPrompt).toHaveBeenCalledTimes(2)
      expect(optimizeVideoPrompt.mock.calls[0][1]).not.toHaveProperty('prev_final_frame')
      expect(optimizeVideoPrompt.mock.calls[1][1]).toMatchObject({ prev_final_frame: 'resume-end-1' })
      expect(log.info).toHaveBeenCalledWith(
        'Story2VideoStages',
        expect.stringContaining('resume scene 1 final_frame restored (source=endingState, chars=12)'),
      )
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('resume 缺终态与优化异常均断链，日志不泄露上游错误原文', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-resume-no-frame-'))
    const resumedVideo = path.join(dir, 'scene-0.mp4')
    fs.writeFileSync(resumedVideo, 'resumed')
    const secret = 'Bearer super-secret-token request_body=private'
    const optimizeVideoPrompt = vi.fn(async (prompt) => {
      if (prompt === 'p1') throw new TypeError(secret)
      return { optimized_prompt: 'optimized-' + prompt, video: { final_frame: 'end-2' } }
    })
    const log = { info: vi.fn(), warn: vi.fn() }
    try {
      const results = await optimizeVideoScenePrompts({
        pipelineEngine: {},
        serviceBus: { optimizeVideoPrompt },
        videoSceneIndexes: [0, 1, 2],
        optimizedPrompts: ['p0', 'p1', 'p2'],
        scenes: [{}, {}, {}],
        resumeCompleted: new Map([[0, { videoPath: resumedVideo }]]),
        videoGenerator: { providerId: 'kling' },
        videoConfig: {},
        runId: 'resume-no-frame',
        log,
        fallbackLabel: 'fallback',
        missingBridgeLabel: 'fallback',
      })
      expect(optimizeVideoPrompt.mock.calls[0][1]).not.toHaveProperty('prev_final_frame')
      expect(optimizeVideoPrompt.mock.calls[1][1]).not.toHaveProperty('prev_final_frame')
      expect(results.get(1)).toEqual({ error: '视频提示词优化失败' })
      const warningText = log.warn.mock.calls.flat().join(' ')
      expect(warningText).toContain('resume scene 0 缺少可用 final_frame')
      expect(warningText).toContain('video prompt optimize failed (TypeError)')
      expect(warningText).not.toContain(secret)
      expect(warningText).not.toContain('super-secret-token')
    } finally {
      fs.rmSync(dir, { recursive: true, force: true })
    }
  })

  it('异常 name 也走白名单，不能把凭据写入日志', async () => {
    const secret = 'Bearer malicious-error-name secret-token'
    const malicious = new Error('private request body')
    malicious.name = secret
    const optimizeVideoPrompt = vi.fn(async () => { throw malicious })
    const log = { info: vi.fn(), warn: vi.fn() }

    const results = await optimizeVideoScenePrompts({
      pipelineEngine: {},
      serviceBus: { optimizeVideoPrompt },
      videoSceneIndexes: [0],
      optimizedPrompts: ['p0'],
      scenes: [{}],
      resumeCompleted: new Map(),
      videoGenerator: { providerId: 'kling' },
      videoConfig: {},
      runId: 'malicious-error-name',
      log,
      fallbackLabel: 'fallback',
      missingBridgeLabel: 'fallback',
    })

    expect(results.get(0)).toEqual({ error: '视频提示词优化失败' })
    const warningText = log.warn.mock.calls.flat().join(' ')
    expect(warningText).toContain('video prompt optimize failed (Error)')
    expect(warningText).not.toContain(secret)
    expect(warningText).not.toContain('secret-token')
  })
})

describe('story2video 资源索引契约', () => {
  it('资源并发值被限制为安全整数范围', () => {
    expect(normalizeAssetConcurrency(Infinity)).toBe(3)
    expect(normalizeAssetConcurrency(0)).toBe(1)
    expect(normalizeAssetConcurrency(2.8)).toBe(2)
    expect(normalizeAssetConcurrency(999)).toBe(8)
  })

  it('历史内容（contentType=history）经 scene_context 生成 imagePromptSeed 视觉种子', async () => {
    const fn = makePipeline(null).sceneContextExecutor
    const result = await fn({
      stage: { options: { contentType: 'history' } },
      params: {},
      context: { split: [{ text: '唐朝长安城的灯火照亮宫殿。' }] },
      serviceBus: {},
    })
    expect(result.success).toBe(true)
    expect(result.output.scenes[0].text).toContain('唐朝')
    expect(result.output.scenes[0].imagePromptSeed).toContain('唐代')
    expect(result.output.scenes[0].prompt).toContain('无文字')
  })

  it('通用内容（contentType=general）经 scene_context 不生成种子，场景原字段透传', async () => {
    const fn = makePipeline(null).sceneContextExecutor
    const result = await fn({
      stage: { options: { contentType: 'general' } },
      params: {},
      context: { split: [{ text: '普通内容。' }] },
      serviceBus: {},
    })
    expect(result.success).toBe(true)
    expect(result.output.scenes[0].imagePromptSeed).toBeUndefined()
    expect(result.output.scenes[0].prompt).toBeUndefined()
    expect(result.output.scenes[0].text).toBe('普通内容。')
  })

  it('scene_context 禁用（enabled=false）+ contentType=history 仍生成种子（保持 domain_enrich 独立语义）', async () => {
    const fn = makePipeline(null).sceneContextExecutor
    const result = await fn({
      stage: { options: { contentType: 'history', enabled: false } },
      params: {},
      context: { split: [{ text: '唐朝长安城的灯火照亮宫殿。' }] },
      serviceBus: {},
    })
    expect(result.success).toBe(true)
    expect(result.output.metadata.fallbackReason).toBe('scene_context_disabled')
    expect(result.output.scenes[0].imagePromptSeed).toContain('唐代')
    expect(result.output.scenes[0].prompt).toContain('无文字')
    // 禁用时跳过上下文融合：场景不带 storyContext/context
    expect(result.output.scenes[0].storyContext).toBeUndefined()
    expect(result.output.scenes[0].context).toBeUndefined()
  })

  it('提示词优化统一走 prompt-engine：逐场景调用、携带契约参数且不回退默认 LLM', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()

    const result = await fn({
      stage: { options: { quality_baseline: false, style: 'cinematic', creative_level: 8, platform: 'dall-e', negative_prompt: '水印' } },
      params: {},
      context: {
        split: {
          scenes: [
            { text: '唐朝长安城的灯火。', imagePromptSeed: '唐代长安城夜景，无文字' },
            { text: '未来城市的车流。' },
          ],
        },
      },
      serviceBus,
    })

    expect(result).toEqual({
      success: true,
      output: [
        expect.objectContaining({ optimized_prompt: '优化: 唐代长安城夜景，无文字', providerId: 'prompt-engine', model: 'mock-model' }),
        expect.objectContaining({ optimized_prompt: '优化: 未来城市的车流。', providerId: 'prompt-engine', model: 'mock-model' }),
      ],
    })
    expect(serviceBus.calls).toHaveLength(2)
    // 契约参数：平台/风格别名归一 + 自动风格检测 + 边界收敛
    expect(serviceBus.calls[0]).toMatchObject({
      prompt: '唐代长安城夜景，无文字',
      options: expect.objectContaining({
        platform: 'dalle',
        style: 'photography',
        creative_level: 8,
        optimization_strategy: 'llm',
        // 精修层长度语义（image-prompt-higgsfield-mechanics）：creative_level≥7 未显式 → 8013 能力上限
        max_length: 2000,
        num_candidates: 1,
        auto_detect_style: true,
        negative_prompt: '水印',
      }),
    })
    expect(serviceBus.optimizePromptsBatch).not.toHaveBeenCalled()
  })

  it('prompt-engine 返回含 <think> 思考块的结果时，净化后作为提示词（不带思考内容）', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(() => ({
      optimized_prompt: '<think>用户让我把场景 12 变成图片提示词</think>\n\nA real final prompt',
      model_used: 'mock-model',
    }))
    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '唐朝长安城的灯火。' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output[0].optimized_prompt).toBe('A real final prompt')
    expect(result.output[0].optimized_prompt).not.toContain('think')
  })

  it('prompt-engine 返回拒绝文本（missing description）时回退原文，不把拒绝内容当提示词', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(() => ({
      optimized_prompt: 'I cannot generate the image prompt because the visual description of the scene is missing from your request. Please provide the details of Scene 11 (subject, action, setting, etc.) so I can convert it into a production-ready prompt.',
      model_used: 'mock-model',
    }))
    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '一个有内容的场景描述。' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    // 拒绝文本被拦截：有实质内容时回退原文
    expect(result.output[0].optimized_prompt).toBe('一个有内容的场景描述。')
    expect(result.output[0].skipped_optimize).toBe(true)
    expect(result.output[0].optimize_note).toBe('llm_rejected_use_original')
    expect(result.output[0].optimized_prompt).not.toContain('cannot generate')
  })

  it('单个纯数字文案（如 1）守卫优先于拒绝路径：不调用 prompt-engine、直接用原文', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '1' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output[0]).toEqual({ optimized_prompt: '1', providerId: null, model: null, skipped_optimize: true })
    // 守卫优先：未调用 prompt-engine
    expect(serviceBus.calls).toHaveLength(0)
  })
  it('单个纯数字文案（如 5）跳过 prompt-engine 优化，用原文兜底，不编造场景', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const context = { split: [{ text: '5' }, { text: '一个有内容的场景描述。' }] }
    const result = await fn({
      stage: { options: { quality_baseline: false } },
      params: {},
      context,
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output).toHaveLength(2)
    // 单个纯数字场景：跳过优化，用原文，标记 skipped_optimize
    expect(result.output[0]).toEqual({ optimized_prompt: '5', providerId: null, model: null, skipped_optimize: true })
    // 有内容场景：正常调用 prompt-engine
    expect(result.output[1]).toMatchObject({ optimized_prompt: '优化: 一个有内容的场景描述。' })
    expect(serviceBus.calls).toHaveLength(1)
    expect(context.optimize_progress).toEqual({ done: 2, total: 2 })
  })
  it('两位数字文案（如 81）走 prompt-engine 优化（方案B），不再用原文兜底', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const result = await fn({
      stage: { options: { quality_baseline: false } },
      params: {},
      context: { split: [{ text: '81' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output[0]).toMatchObject({ optimized_prompt: '优化: 81' })
    expect(result.output[0].skipped_optimize).not.toBe(true)
    expect(serviceBus.calls).toHaveLength(1)
  })
  it('多位数文案（如 1949）走 prompt-engine 优化（方案B）', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const result = await fn({
      stage: { options: { quality_baseline: false } },
      params: {},
      context: { split: [{ text: '1949' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output[0]).toMatchObject({ optimized_prompt: '优化: 1949' })
    expect(serviceBus.calls).toHaveLength(1)
  })
  it('prompt-engine 校验拒绝（Too short）时回退原文并继续，不使流水线失败（方案B 配套）', async () => {
    const fn = makePipeline(null).optimizeExecutor
    // FastAPI 422 形态：{ detail: [{ msg: 'Too short...' }] }
    const serviceBus = makeOptimizeBus(() => ({ detail: [{ msg: 'Too short (1 words). Try a more detailed description' }] }))
    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '81' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output[0]).toEqual({
      optimized_prompt: '81',
      providerId: null,
      model: null,
      skipped_optimize: true,
      optimize_note: 'prompt_engine_too_short_use_original',
    })
    // 已调用 prompt-engine（方案B 放行），但拒绝被优雅回退
    expect(serviceBus.calls).toHaveLength(1)
  })
  it('prompt-engine 中文真实文案 422（描述太简短了（N 字））时回退原文并继续（2026-08-09 Bug 反哺）', async () => {
    const fn = makePipeline(null).optimizeExecutor
    // 真实链路返回：FastAPI 422 detail 中文文案（不匹配旧词表「太短」，曾导致整条流水线失败）
    const serviceBus = makeOptimizeBus(() => ({ detail: [{ msg: '描述太简短了（2 字），建议更详细描述画面' }] }))
    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '测试' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output[0]).toMatchObject({
      optimized_prompt: '测试',
      skipped_optimize: true,
      optimize_note: 'prompt_engine_too_short_use_original',
    })
    expect(serviceBus.calls).toHaveLength(1)
  })
  it('prompt-engine 返回空内容/仅推理错误时回退原文并继续（2026-08-20 视频任务失败根因）', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(() => ({
      optimized_prompt: '原文',
      error: 'LLM 返回了空内容或仅包含推理内容，未生成有效优化词',
    }))
    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '一个有内容的场景描述。' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output[0]).toMatchObject({
      optimized_prompt: '一个有内容的场景描述。',
      skipped_optimize: true,
      optimize_note: 'prompt_engine_empty_reasoning_use_original',
    })
    expect(serviceBus.calls).toHaveLength(1)
  })
  it('prompt-engine 非过短校验拒绝（如非法风格）仍按失败处理', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(() => ({ detail: [{ msg: 'unknown style value: foo' }] }))
    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '一个有内容的场景描述。' }] },
      serviceBus,
    })
    expect(result).toMatchObject({ success: false })
    expect(result.error).toMatch(/prompt-engine 请求被拒绝/)
  })
  it('单字中文优化 + 纯符号/纯数字跳过（组合场景，方案B 边界）', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const context = { split: [{ text: '一' }, { text: '。。。' }, { text: '5' }, { text: '81' }] }
    const result = await fn({
      stage: { options: { quality_baseline: false } },
      params: {},
      context,
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output).toHaveLength(4)
    // 单字中文与 2 位数字 → 优化（无 skipped_optimize）；纯符号与单个数字 → 原文跳过
    expect(result.output[0]).toMatchObject({ optimized_prompt: '优化: 一' })
    expect(result.output[0]).not.toHaveProperty('skipped_optimize')
    expect(result.output[1]).toEqual({ optimized_prompt: '。。。', providerId: null, model: null, skipped_optimize: true })
    expect(result.output[2]).toEqual({ optimized_prompt: '5', providerId: null, model: null, skipped_optimize: true })
    expect(result.output[3]).toMatchObject({ optimized_prompt: '优化: 81' })
    expect(result.output[3]).not.toHaveProperty('skipped_optimize')
    expect(serviceBus.calls).toHaveLength(2)
  })
  it('逐场景提示词优化并行执行（有界并发，避免长文案串行拖慢）', async () => {
    // 用并发计数断言（确定性），不依赖墙钟：并发执行时活跃调用数应 ≥2
    let active = 0
    let maxActive = 0
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(async () => {
      active += 1
      maxActive = Math.max(maxActive, active)
      await new Promise(resolve => setTimeout(resolve, 50))
      active -= 1
      return { optimized_prompt: '优化结果', model_used: 'mock-model' }
    })
    const scenes = Array.from({ length: 6 }, (_, i) => ({ text: '场景' + i, imagePromptSeed: '画面' + i }))
    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: { scenes } },
      serviceBus,
    })
    expect(result.success).toBe(true)
    expect(result.output).toHaveLength(6)
    expect(serviceBus.calls).toHaveLength(6)
    expect(maxActive).toBeGreaterThanOrEqual(2)
  })

  it('优化进度前置写入：阶段开始即显示「共 N 个场景，已完成 X 个」', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const context = {
      split: {
        scenes: [
          { text: '场景0', imagePromptSeed: '画面0' },
          { text: '场景1', imagePromptSeed: '画面1' },
          { text: '场景2', imagePromptSeed: '画面2' },
        ],
      },
    }
    const result = await fn({
      stage: { options: {} },
      params: {},
      context,
      serviceBus,
    })
    expect(result.success).toBe(true)
    // 前置写入：前端在阶段执行期间即可显示数量信息，而不是等阶段结束后才出现
    expect(context.optimize_progress).toEqual({ done: 3, total: 3 })
  })

  it('断点续传时优化进度从已完成场景数开始，成功后清理续传缓存', async () => {
    const resumeEntry = { optimized_prompt: '已有优化', providerId: 'prompt-engine', model: 'mock-model' }
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const context = {
      split: {
        scenes: [
          { text: '场景0', imagePromptSeed: '画面0' },
          { text: '场景1', imagePromptSeed: '画面1' },
        ],
      },
      optimize_resume: [resumeEntry],
    }
    const result = await fn({
      stage: { options: {} },
      params: {},
      context,
      serviceBus,
    })
    expect(result.success).toBe(true)
    // 只优化未完成的场景，已完成的直接复用
    expect(serviceBus.calls).toHaveLength(1)
    expect(result.output).toHaveLength(2)
    expect(result.output[0]).toEqual(resumeEntry)
    expect(context.optimize_progress).toEqual({ done: 2, total: 2 })
    expect(context.optimize_resume).toBeUndefined()
  })

  it('prompt-engine 缺失、空响应、error 兜底、422 或持续瞬时失败时优化阶段 fail closed', async () => {
    // 服务缺失：未注入 PromptBridge → 明确错误
    const noBus = makePipeline(null).optimizeExecutor
    const missing = await noBus({
      stage: { options: {} }, params: {}, context: { split: [{ text: '场景' }] }, serviceBus: {},
    })
    expect(missing).toMatchObject({ success: false, error: expect.stringMatching(/prompt-engine|PromptBridge/i) })

    // 空响应
    const emptyBus = makeOptimizeBus(() => ({ optimized_prompt: '   ' }))
    const blank = await makePipeline(null).optimizeExecutor({
      stage: { options: {} }, params: {}, context: { split: [{ text: '场景' }] }, serviceBus: emptyBus,
    })
    expect(blank).toMatchObject({ success: false, error: expect.stringMatching(/空提示词/i) })

    // error 兜底响应（返回原文 + error）→ 必须失败，不能把「未优化原文」当成功
    const errorBus = makeOptimizeBus(() => ({ optimized_prompt: '原场景', error: 'quota exceeded' }))
    const errored = await makePipeline(null).optimizeExecutor({
      stage: { options: {} }, params: {}, context: { split: [{ text: '场景' }] }, serviceBus: errorBus,
    })
    expect(errored).toMatchObject({ success: false, error: expect.stringMatching(/quota exceeded/i) })

    // 422 detail 形态
    const detailBus = makeOptimizeBus(() => ({ detail: [{ msg: 'value is not a valid enumeration member' }] }))
    const detailResult = await makePipeline(null).optimizeExecutor({
      stage: { options: {} }, params: {}, context: { split: [{ text: '场景' }] }, serviceBus: detailBus,
    })
    expect(detailResult).toMatchObject({ success: false, error: expect.stringMatching(/422/i) })

    // 瞬态错误有界重试后成功
    const retryBus = makeOptimizeBus(() => { throw new Error('provider timeout') })
    retryBus.optimizePrompt
      .mockRejectedValueOnce(new Error('provider timeout'))
      .mockResolvedValue({ optimized_prompt: '优化后提示词', model_used: 'mock-model' })
    const recovered = await makePipeline(null).optimizeExecutor({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '第一幕' }] },
      serviceBus: retryBus,
    })
    expect(recovered).toMatchObject({ success: true })
    expect(recovered.output).toHaveLength(1)

    // 持续瞬时失败 → 场景级失败，不产生 output
    const persistentBus = makeOptimizeBus(() => { throw new Error('provider timeout') })
    const failed = await makePipeline(null).optimizeExecutor({
      stage: { options: { maxRetries: 0 } },
      params: {},
      context: { split: [{ text: '第一幕' }] },
      serviceBus: persistentBus,
    })
    expect(failed).toMatchObject({ success: false, error: expect.stringMatching(/scene 0.*provider timeout/i) })
    expect(failed).not.toHaveProperty('output')
    expect(persistentBus.optimizePromptsBatch).not.toHaveBeenCalled()
  })

  it('任一 scene 的图片或音频失败时默认阻断，不能生成错位清单', async () => {
    const fn = makePipeline({
      generateImage: vi.fn(async (_prompt, { index }) => index === 1
        ? { code: -1, message: 'image failed' }
        : { code: 0, data: { path: `image-${index}.png` } }),
      generateTTS: vi.fn(async (_text, { index }) => ({
        code: 0,
        data: { path: `audio-${index}.mp3`, duration: 2 },
      })),
    })

    const result = await fn({
      stage: { options: { concurrency: 2 } },
      params: {},
      context: {
        split: [{ text: '一' }, { text: '二' }, { text: '三' }],
        optimize: ['p1', 'p2', 'p3'],
      },
      serviceBus: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/scene.*失败|asset.*failed/i)
    expect(result.error).toContain('Image #2: image failed')
  })

  it('将选定的 TTS 服务商、模型和音色完整透传至资产生成器', async () => {
    const generateTTS = vi.fn(async (_text, { index }) => ({
      code: 0,
      data: { path: `audio-${index}.mp3`, duration: 2 },
    }))
    const fn = makePipeline({
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: `image-${index}.png` } })),
      generateTTS,
    })

    const result = await fn({
      stage: { options: { concurrency: 1 } },
      params: {
        voiceId: 'voice-selected',
        voiceProvider: 'elevenlabs',
        voiceModel: 'eleven_multilingual_v2',
        voiceSpeed: 1.1,
        voicePitch: 2,
      },
      context: { split: [{ text: '旁白内容' }], optimize: ['画面提示词'] },
      serviceBus: {},
    })

    expect(result.success).toBe(true)
    expect(generateTTS).toHaveBeenCalledWith('旁白内容', expect.objectContaining({
      voice_id: 'voice-selected',
      voice_provider: 'elevenlabs',
      voice_model: 'eleven_multilingual_v2',
      rate: 1.1,
      pitch: 2,
    }))
  })

  it('历史断点恢复：成功资产复用，未完成图片和语音使用当前设置模型', async () => {
    const root = fs.mkdtempSync(path.join(STORY2VIDEO_TEMP_DIR, 's2v-current-model-resume-'))
    const resumedImage = path.join(root, 'old-image.png')
    const resumedAudio = path.join(root, 'old-audio.mp3')
    fs.writeFileSync(resumedImage, 'old image')
    fs.writeFileSync(resumedAudio, 'old audio')
    const resumedImageRealPath = fs.realpathSync.native(resumedImage)
    const resumedAudioRealPath = fs.realpathSync.native(resumedAudio)
    const generateImage = vi.fn(async (_prompt, opts) => ({ code: 0, data: { path: path.join(root, `new-image-${opts.index}.png`) } }))
    const generateTTS = vi.fn(async (_text, opts) => ({ code: 0, data: { path: path.join(root, `new-audio-${opts.index}.mp3`), duration: 2 } }))
    const manager = {
      getDefault: vi.fn((type) => ({
        id: type === 'image' ? 'current-image' : 'current-tts',
        models: [type === 'image' ? 'image-current-model' : 'voice-current-model'],
      })),
      getProvider: vi.fn(() => null),
    }
    const fn = makePipeline({ generateImage, generateTTS }, { _modelProviderManager: manager })
    try {
      const result = await fn({
        stage: { options: { concurrency: 1 } },
        params: {
          __resumeUseCurrentModels: true,
          imageProvider: 'old-image',
          imageModel: 'old-image-model',
          voiceProvider: 'old-tts',
          voiceModel: 'old-voice-model',
          voiceId: 'old-voice-id',
        },
        context: {
          split: [{ text: '已完成场景' }, { text: '待恢复场景' }],
          optimize: ['old-prompt-0', 'new-prompt-1'],
          generate_assets: { resume: { completed: [{ index: 0, imagePath: resumedImage, audioPath: resumedAudio, duration: 2 }] } },
        },
        serviceBus: {},
      })

      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(generateImage).toHaveBeenCalledTimes(1)
      expect(generateImage).toHaveBeenCalledWith('new-prompt-1', expect.objectContaining({
        image_provider: 'current-image',
        image_model: 'image-current-model',
        index: 1,
      }))
      expect(generateTTS).toHaveBeenCalledTimes(1)
      expect(generateTTS).toHaveBeenCalledWith('待恢复场景', expect.objectContaining({
        voice_id: 'old-voice-id',
        voice_provider: 'current-tts',
        voice_model: 'voice-current-model',
        index: 1,
      }))
      expect(result.output.scenes[0]).toMatchObject({ imagePath: resumedImageRealPath, audioPath: resumedAudioRealPath })
      expect(result.output.scenes[1]).toMatchObject({ index: 1 })
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('历史断点恢复：legacy Python 图片和语音路径也使用当前能力模型', async () => {
    const calls = []
    const manager = {
      getDefault: vi.fn((type) => ({
        id: type === 'image' ? 'current-image' : 'current-tts',
        models: [type === 'image' ? 'image-current-model' : 'voice-current-model'],
      })),
      getProvider: vi.fn(() => null),
    }
    const fn = makePipeline(null, { _modelProviderManager: manager })
    const serviceBus = {
      callPythonSkill: vi.fn(async (skill, payload) => {
        calls.push({ skill, payload })
        return skill === 'generate_image'
          ? { code: 0, data: { path: 'legacy-image.png' } }
          : { code: 0, data: { path: 'legacy-audio.mp3', duration: 2 } }
      }),
    }

    const result = await fn({
      stage: {
        options: {
          concurrency: 1,
          imageProvider: 'old-image',
          imageModel: 'old-image-model',
          voiceProvider: 'old-tts',
          voiceModel: 'old-voice-model',
        },
      },
      params: { __resumeUseCurrentModels: true },
      context: { split: [{ text: '待恢复场景' }], optimize: ['prompt'] },
      serviceBus,
    })

    expect(result.success).toBe(true)
    expect(calls.find((call) => call.skill === 'generate_image')?.payload).toMatchObject({
      image_provider: 'current-image',
      image_model: 'image-current-model',
    })
    expect(calls.find((call) => call.skill === 'generate_tts')?.payload).toMatchObject({
      voice_provider: 'current-tts',
      voice_model: 'voice-current-model',
    })
  })

  it('历史断点恢复：图片、音频按资产分别复用，缺失资产才调用当前模型', async () => {
    const root = fs.mkdtempSync(path.join(STORY2VIDEO_TEMP_DIR, 's2v-partial-asset-resume-'))
    const oldAudio = path.join(root, 'scene-0.mp3')
    const oldImage = path.join(root, 'scene-1.png')
    fs.writeFileSync(oldAudio, 'old audio')
    fs.writeFileSync(oldImage, 'old image')
    const oldAudioRealPath = fs.realpathSync.native(oldAudio)
    const oldImageRealPath = fs.realpathSync.native(oldImage)
    const generateImage = vi.fn(async (_prompt, opts) => ({ code: 0, data: { path: path.join(root, 'generated-' + opts.index + '.png') } }))
    const generateTTS = vi.fn(async (_text, opts) => ({ code: 0, data: { path: path.join(root, 'generated-' + opts.index + '.mp3'), duration: 2 } }))
    const manager = {
      getDefault: vi.fn((type) => ({
        id: type === 'image' ? 'current-image' : 'current-tts',
        capability_models: { image: 'image-current-model', tts: 'voice-current-model' },
        models: ['fallback-model'],
      })),
      getProvider: vi.fn(() => null),
    }
    const fn = makePipeline({ generateImage, generateTTS }, { _modelProviderManager: manager })
    try {
      const result = await fn({
        stage: { options: { concurrency: 1 } },
        params: { __resumeUseCurrentModels: true, imageProvider: 'old-image', imageModel: 'old-image-model', voiceProvider: 'old-tts', voiceModel: 'old-voice-model' },
        context: {
          split: [{ text: '第一幕' }, { text: '第二幕' }],
          optimize: ['prompt-0', 'prompt-1'],
          generate_assets: { resume: { completed: [
            { index: 0, audioPath: oldAudioRealPath, duration: 2 },
            { index: 1, imagePath: oldImageRealPath },
          ] } },
        },
        serviceBus: {},
      })

      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(generateImage).toHaveBeenCalledTimes(1)
      expect(generateImage).toHaveBeenCalledWith('prompt-0', expect.objectContaining({ image_model: 'image-current-model', index: 0 }))
      expect(generateTTS).toHaveBeenCalledTimes(1)
      expect(generateTTS).toHaveBeenCalledWith('第二幕', expect.objectContaining({ voice_model: 'voice-current-model', index: 1 }))
      expect(result.output.scenes).toEqual(expect.arrayContaining([
        expect.objectContaining({ index: 0, audioPath: oldAudioRealPath }),
        expect.objectContaining({ index: 1, imagePath: oldImageRealPath }),
      ]))
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('历史断点恢复：失效或不受控的旧资产路径不会伪装成功', async () => {
    const root = fs.mkdtempSync(path.join(STORY2VIDEO_TEMP_DIR, 's2v-invalid-asset-resume-'))
    const generateImage = vi.fn(async (_prompt, opts) => ({ code: 0, data: { path: path.join(root, 'generated-' + opts.index + '.png') } }))
    const generateTTS = vi.fn(async (_text, opts) => ({ code: 0, data: { path: path.join(root, 'generated-' + opts.index + '.mp3'), duration: 2 } }))
    const manager = {
      getDefault: vi.fn((type) => ({ id: type === 'image' ? 'current-image' : 'current-tts', models: ['current-model'] })),
      getProvider: vi.fn(() => null),
    }
    const fn = makePipeline({ generateImage, generateTTS }, { _modelProviderManager: manager })
    try {
      const result = await fn({
        stage: { options: { concurrency: 1 } },
        params: { __resumeUseCurrentModels: true },
        context: {
          split: [{ text: '失效路径场景' }],
          optimize: ['prompt'],
          generate_assets: { resume: { completed: [{ index: 0, imagePath: path.join(root, 'missing.png'), audioPath: path.join(root, 'missing.mp3') }] } },
        },
        serviceBus: {},
      })
      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(generateImage).toHaveBeenCalledTimes(1)
      expect(generateTTS).toHaveBeenCalledTimes(1)
      expect(result.output.scenes[0].imagePath).toContain('generated-0.png')
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('TTS 返回词级时间戳时透传到场景，alignScenes 直接用 TTS 时间戳（不依赖 aligner）', async () => {
    const generateTTS = vi.fn(async () => ({
      code: 0,
      data: {
        path: 'audio-0.mp3',
        duration: 1.3,
        timings: [
          { text: '今天', start: 0.0, end: 0.5 },
          { text: '天气', start: 0.5, end: 0.9 },
          { text: '真好', start: 0.9, end: 1.3 },
        ],
      },
    }))
    const fn = makePipeline({
      generateImage: vi.fn(async () => ({ code: 0, data: { path: 'image-0.png' } })),
      generateTTS,
    })
    const scene = {
      index: 0,
      text: '今天天气真好',
      subtitleBlocks: ['今天天气真好'],
      sceneSource: 'smart-sentence-splitter',
    }

    const result = await fn({
      stage: { options: {} },
      params: { voiceProvider: 'minimax-tts' },
      context: { split: { scenes: [scene] }, optimize: ['画面提示词'] },
      serviceBus: {},
    })

    expect(result.success).toBe(true)
    expect(generateTTS).toHaveBeenCalledWith('今天天气真好', expect.objectContaining({ with_timestamps: true }))
    const outputScene = result.output.scenes[0]
    expect(outputScene.timings).toHaveLength(3)
    // TTS 时间戳路径无需 aligner 可用（CI 无 ALIGNER_DIR）即可完成对齐，方法名标识来源
    expect(outputScene.subtitleAlign.method).toBe('tts-timestamps')
    expect(outputScene.subtitleAlign.aligned).toBe(true)
    expect(outputScene.subtitleTimeline[0].startTime).toBe(0)
    expect(outputScene.subtitleTimeline[0].endTime).toBe(1.3)
  })

  it('显式允许部分资源时只保留同 index 的成对 scene', async () => {
    const fn = makePipeline({
      generateImage: vi.fn(async (_prompt, { index }) => index === 1
        ? { code: -1, message: 'image failed' }
        : { code: 0, data: { path: `image-${index}.png` } }),
      generateTTS: vi.fn(async (_text, { index }) => ({
        code: 0,
        data: { path: `audio-${index}.mp3`, duration: 2 },
      })),
    })

    const result = await fn({
      stage: { options: { concurrency: 2 } },
      params: { allowPartialAssets: true },
      context: {
        split: [{ text: '一' }, { text: '二' }, { text: '三' }],
        optimize: ['p1', 'p2', 'p3'],
      },
      serviceBus: {},
    })

    expect(result.success).toBe(true)
    expect(result.output.scenes).toEqual([
      expect.objectContaining({ index: 0, imagePath: 'image-0.png', audioPath: 'audio-0.mp3' }),
      expect.objectContaining({ index: 2, imagePath: 'image-2.png', audioPath: 'audio-2.mp3' }),
    ])
    expect(result.output.scenes).not.toContainEqual(expect.objectContaining({ index: 1 }))
    expect(result.output.failures).toEqual({
      images: [expect.objectContaining({ index: 1, error: 'image failed' })],
      audio: [],
    })
  })

  it('图片模式直接摄取用户图片，不调用图片生成器并保持 scene index', async () => {
    const assetGenerator = {
      generateImage: vi.fn(),
      generateTTS: vi.fn(async (_text, { index }) => ({
        code: 0,
        data: { path: `audio-${index}.mp3`, duration: 2 },
      })),
    }
    const fn = makePipeline(assetGenerator)
    const imageData = 'data:image/png;base64,aW1hZ2U='

    const result = await fn({
      stage: { options: { concurrency: 1 } },
      params: { inputMode: 'images', images: [imageData] },
      context: {
        split: [{ text: '图片 1' }],
        optimize: ['图片 1 的视觉提示词'],
      },
      serviceBus: {},
    })

    expect(result.success).toBe(true)
    expect(assetGenerator.generateImage).not.toHaveBeenCalled()
    expect(result.output.scenes).toHaveLength(1)
    expect(result.output.scenes[0]).toMatchObject({ index: 0, audioPath: 'audio-0.mp3' })
    expect(result.output.scenes[0].imagePath).toMatch(/story2video[\\/]inputs[\\/].*image_0000\.png$/)
  })

  it('音频模式摄取用户音频并跳过 TTS，保留逐段索引和声明时长', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-audio-input-'))
    const audioPath = path.join(root, 'narration.mp3')
    fs.writeFileSync(audioPath, Buffer.from('audio'))
    const imported = importUserSelectedMedia(audioPath, 'audio')
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({
        code: 0,
        data: { path: path.join(root, 'image-' + index + '.png') },
      })),
      generateTTS: vi.fn(),
    }
    const fn = makePipeline(assetGenerator)

    try {
      const result = await fn({
        stage: { options: { concurrency: 1 } },
        params: {
          inputMode: 'audio',
          audio: [{ name: 'narration.mp3', path: imported.path, duration: 1.25 }],
        },
        context: {
          split: [{ text: 'narration.mp3' }],
          optimize: ['narration 的画面'],
        },
        serviceBus: {},
      })

      expect(result.success).toBe(true)
      expect(assetGenerator.generateTTS).not.toHaveBeenCalled()
      expect(result.output.scenes).toHaveLength(1)
      expect(result.output.scenes[0]).toMatchObject({ index: 0, duration: 1.25 })
      expect(fs.realpathSync.native(result.output.scenes[0].audioPath))
        .toBe(fs.realpathSync.native(imported.path))
    } finally {
      fs.rmSync(imported.path, { force: true })
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('音频模式拒绝未导入到 Story2Video 受控目录的路径', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-untrusted-audio-'))
    const audioPath = path.join(root, 'narration.mp3')
    fs.writeFileSync(audioPath, Buffer.from('audio'))
    const assetGenerator = {
      generateImage: vi.fn(async () => ({ code: 0, data: { path: 'image-0.png' } })),
      generateTTS: vi.fn(),
    }
    const fn = makePipeline(assetGenerator)

    try {
      const result = await fn({
        stage: { options: { concurrency: 1 } },
        params: {
          inputMode: 'audio',
          audio: [{ name: 'narration.mp3', path: audioPath, duration: 1.25 }],
        },
        context: {
          split: [{ text: 'narration.mp3' }],
          optimize: ['narration 的画面'],
        },
        serviceBus: {},
      })

      expect(result.success).toBe(false)
      expect(result.error).toMatch(/audio|资源|asset/i)
      expect(assetGenerator.generateTTS).not.toHaveBeenCalled()
    } finally {
      fs.rmSync(root, { recursive: true, force: true })
    }
  })

  it('图片和 TTS 两类资源同时开始生成，并接受直接 path 响应', async () => {
    let release
    const gate = new Promise(resolve => { release = resolve })
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => {
        await gate
        return { path: `image-${index}.png` }
      }),
      generateTTS: vi.fn(async (_text, { index }) => {
        await gate
        return { data: { path: `audio-${index}.mp3`, duration: 2 } }
      }),
    }
    const fn = makePipeline(assetGenerator)
    const pending = fn({
      stage: { options: { concurrency: 999 } },
      params: {},
      context: { split: [{ text: '一' }], optimize: ['p1'] },
      serviceBus: {},
    })

    await vi.waitFor(() => {
      expect(assetGenerator.generateImage).toHaveBeenCalledTimes(1)
      expect(assetGenerator.generateTTS).toHaveBeenCalledTimes(1)
    })
    release()
    const result = await pending
    expect(result.success).toBe(true)
    expect(result.output.scenes[0]).toMatchObject({
      imagePath: 'image-0.png',
      audioPath: 'audio-0.mp3',
    })
  })

  it('保留真实 provider 与离线降级资源的来源，供项目交付时明确提示', async () => {
    const fn = makePipeline({
      generateImage: vi.fn(async () => ({
        code: 0,
        data: {
          path: 'image-0.png',
          provider: 'local-diffusion',
          source: 'model-provider',
          degraded: false,
        },
      })),
      generateTTS: vi.fn(async () => ({
        code: 0,
        data: {
          path: 'audio-0.mp3',
          duration: 2,
          source: 'ffmpeg-silence',
          degraded: true,
        },
      })),
    })

    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '一' }], optimize: ['p1'] },
      serviceBus: {},
    })

    expect(result.success).toBe(true)
    expect(result.output.scenes[0]).toMatchObject({
      imageMeta: { source: 'model-provider', degraded: false },
      audioMeta: { source: 'ffmpeg-silence', degraded: true },
    })
    expect(result.output.stats).toMatchObject({ degradedImages: 0, degradedTts: 1 })
  })

  it('资源清单保留场景分句来源和每场景字幕块', async () => {
    const fn = makePipeline({
      generateImage: vi.fn(async () => ({ code: 0, data: { path: 'image-0.png' } })),
      generateTTS: vi.fn(async () => ({ code: 0, data: { path: 'audio-0.mp3', duration: 1.5 } })),
    })
    const scene = {
      index: 0,
      text: '场景层由服务确定，字幕层由本地逻辑继续切分。',
      subtitleBlocks: ['场景层由服务确定，', '字幕层由本地逻辑', '继续切分。'],
      sceneSource: 'smart-sentence-splitter',
      subtitleSource: 'local-typescript',
      degraded: false,
    }

    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: { scenes: [scene] }, optimize: ['画面提示词'] },
      serviceBus: {},
    })

    expect(result.success).toBe(true)
    expect(result.output.scenes[0]).toMatchObject(scene)
    expect(result.output.sentences[0]).toMatchObject(scene)
    expect(result.output.segmentation).toEqual({
      sceneSource: 'smart-sentence-splitter',
      subtitleSource: 'local-typescript',
      degraded: false,
      fallbackReason: null,
    })
  })

  it('61 个场景逐个调用 prompt-engine 优化，不因场景数被拒绝', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const scenes = Array.from({ length: 61 }, (_, index) => ({ text: '第 ' + (index + 1) + ' 个场景' }))

    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: scenes },
      serviceBus,
    })

    expect(result.success).toBe(true)
    expect(result.output).toHaveLength(61)
    expect(serviceBus.calls).toHaveLength(61)
  }, 30000)

  it('61 个场景继续进入资源生成，不因场景数被拒绝', async () => {
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: `image-${index}.png` } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: `audio-${index}.mp3`, duration: 1 } })),
    }
    const fn = makePipeline(assetGenerator)
    const scenes = Array.from({ length: 61 }, (_, index) => ({ text: String(index) }))

    const result = await fn({
      stage: { options: {} },
      params: {},
      context: { split: scenes, optimize: scenes.map(scene => scene.text) },
      serviceBus: {},
    })

    expect(result.success).toBe(true)
    expect(result.error).toBeUndefined()
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(scenes.length)
    expect(assetGenerator.generateTTS).toHaveBeenCalledTimes(scenes.length)
  }, 30000)
})

describe('story2video 内容策略人工处理', () => {
  it('applies the same five-attempt content-policy contract to the Python image fallback', async () => {
    const fn = makePipeline(null)
    const serviceBus = {
      callPythonSkill: vi.fn(async (skill) => {
        if (skill === 'generate_image') {
          return {
            code: -1,
            error: { code: 'CONTENT_POLICY', message: 'content policy rejected' },
          }
        }
        return { code: 0, data: { path: 'audio-0.mp3', duration: 2 } }
      }),
    }

    const result = await fn({
      stage: { options: { concurrency: 1 } },
      params: {},
      context: { split: [{ text: '一' }], optimize: ['prompt'] },
      serviceBus,
    })

    expect(serviceBus.callPythonSkill.mock.calls.filter(([skill]) => skill === 'generate_image')).toHaveLength(5)
    expect(result).toMatchObject({
      success: true,
      checkpoint: 'needs_user_input',
      checkpointMeta: { reason: 'content_policy', attempts: 5, sceneIndex: 0 },
    })
  })

  it('turns exhausted image policy retries into a needs_user_input checkpoint even when partial assets are allowed', async () => {
    const checkpoint = {
      type: 'needs_user_input',
      status: 'needs_user_input',
      reason: 'content_policy',
      needsUserInput: true,
      sceneIndex: 1,
      sceneNumber: 2,
      attempts: 5,
      recommendation: '请改写场景。',
    }
    const fn = makePipeline({
      generateImage: vi.fn(async (_prompt, { index }) => index === 1
        ? {
            code: -1,
            message: 'Image generation requires user input after content-policy review',
            needsUserInput: true,
            checkpoint,
            data: { needsUserInput: true, checkpoint, generationAttempts: [{ attempt: 5, outcome: 'content_policy_rejected' }] },
          }
        : { code: 0, data: { path: `image-${index}.png` } }),
      generateTTS: vi.fn(async (_text, { index }) => ({
        code: 0,
        data: { path: `audio-${index}.mp3`, duration: 2 },
      })),
    })

    const result = await fn({
      stage: { options: { concurrency: 2 } },
      params: { allowPartialAssets: true },
      context: {
        split: [{ text: '一' }, { text: '二' }],
        optimize: ['p1', 'p2'],
      },
      serviceBus: {},
    })

    expect(result).toMatchObject({
      success: true,
      checkpoint: 'needs_user_input',
      checkpointMeta: {
        type: 'needs_user_input',
        status: 'needs_user_input',
        reason: 'content_policy',
        sceneIndex: 1,
        sceneNumber: 2,
        attempts: 5,
      },
    })
    expect(result.output.scenes).toEqual([
      expect.objectContaining({ index: 0, imagePath: 'image-0.png', audioPath: 'audio-0.mp3' }),
    ])
    expect(result.output.failures.images).toEqual([
      expect.objectContaining({ index: 1, needsUserInput: true, checkpoint }),
    ])
  })

  it('Python 图片兜底：空结果 5 次后的失败消息如实说明，不再硬编码 content-policy（2026-08-16 审查补强）', async () => {
    const fn = makePipeline(null)
    const serviceBus = {
      callPythonSkill: vi.fn(async (skill) => {
        if (skill === 'generate_image') {
          return {
            code: -1,
            error: { code: 'PROVIDER_ERROR', message: 'provider returned no image result (empty response)', emptyResult: true },
          }
        }
        return { code: 0, data: { path: 'audio-0.mp3', duration: 2 } }
      }),
    }

    const result = await fn({
      stage: { options: { concurrency: 1 } },
      params: {},
      context: { split: [{ text: '一' }], optimize: ['prompt'] },
      serviceBus,
    })

    expect(serviceBus.callPythonSkill.mock.calls.filter(([skill]) => skill === 'generate_image')).toHaveLength(5)
    expect(result.success).toBe(false)
    expect(result.error).toContain('repeatedly returned no result')
    expect(result.error).not.toContain('content-policy')
  })
})

describe('story2video 限流/瞬时错误有界重试', () => {
  afterEach(() => {
    vi.useRealTimers()
  })

  it('额度/套餐错误按结果对象不重试，立即返回失败', async () => {
    const calls = vi.fn()
    const result = await withAssetTransientRetry(() => {
      calls()
      return { code: -1, message: 'Token Plan usage limit reached' }
    })
    expect(calls).toHaveBeenCalledTimes(1)
    expect(result).toMatchObject({ code: -1, message: 'Token Plan usage limit reached' })
  })

  it('额度/套餐抛错型错误不重试，直接抛出', async () => {
    const calls = vi.fn()
    await expect(withAssetTransientRetry(() => {
      calls()
      throw new Error('Token Plan usage limit reached')
    })).rejects.toThrow('Token Plan usage limit reached')
    expect(calls).toHaveBeenCalledTimes(1)
  })

  it('上游 "system error" 抛错型错误按瞬时重试后恢复（回归 mtelxg9v_v5d6）', async () => {
    vi.useFakeTimers()
    const calls = vi.fn()
    const promise = withAssetTransientRetry(() => {
      calls()
      if (calls.mock.calls.length === 1) throw new Error('Image provider "minimax-multimodal" failed: system error')
      return { code: 0, data: { path: 'img-0.png' } }
    })
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result).toMatchObject({ code: 0 })
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('上游 "fetch failed" 抛错型错误按瞬时重试后恢复（回归 mtelxg9v_v5d6）', async () => {
    vi.useFakeTimers()
    const calls = vi.fn()
    const promise = withAssetTransientRetry(() => {
      calls()
      if (calls.mock.calls.length === 1) throw new Error('Image provider "agnes-image" failed: fetch failed')
      return { code: 0, data: { path: 'img-0.png' } }
    })
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result).toMatchObject({ code: 0 })
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('上游 "system error" 结果对象按瞬时重试后恢复（回归 mtelxg9v_v5d6）', async () => {
    vi.useFakeTimers()
    const calls = vi.fn()
    const promise = withAssetTransientRetry(() => {
      calls()
      if (calls.mock.calls.length === 1) return { code: -1, message: 'Image provider "minimax-multimodal" failed: system error' }
      return { code: 0, data: { path: 'img-0.png' } }
    })
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result).toMatchObject({ code: 0 })
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('上游 "fetch failed" 结果对象按瞬时重试后恢复（回归 mtelxg9v_v5d6）', async () => {
    vi.useFakeTimers()
    const calls = vi.fn()
    const promise = withAssetTransientRetry(() => {
      calls()
      if (calls.mock.calls.length === 1) return { code: -1, message: 'Image provider "agnes-image" failed: fetch failed' }
      return { code: 0, data: { path: 'img-0.png' } }
    })
    await vi.advanceTimersByTimeAsync(5000)
    const result = await promise
    expect(result).toMatchObject({ code: 0 })
    expect(calls).toHaveBeenCalledTimes(2)
  })

  it('提示词优化遇到限流时用更长退避重试并恢复', async () => {
    vi.useFakeTimers()
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(() => { throw new Error("You've reached the API rate limit for free users.") })
    serviceBus.optimizePrompt
      .mockRejectedValueOnce(new Error("You've reached the API rate limit for free users."))
      .mockRejectedValueOnce(new Error('rate limit'))
      .mockResolvedValue({ optimized_prompt: '优化后提示词', model_used: 'mock-model' })
    const promise = fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '第一幕' }] },
      serviceBus,
    })
    await vi.advanceTimersByTimeAsync(30000)
    const result = await promise
    expect(result).toMatchObject({ success: true })
    expect(result.output).toHaveLength(1)
    expect(serviceBus.optimizePrompt).toHaveBeenCalledTimes(3)
  })

  it('story2video_optimize 把 runId 作为 traceId 传给 serviceBus（R2/C1）', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(() => ({ optimized_prompt: '优化后提示词' }))
    await fn({
      runId: 'run_77',
      stage: { options: { quality_baseline: false } },
      params: {},
      context: { split: [{ text: '第一幕' }] },
      serviceBus,
    })
    expect(serviceBus.optimizePrompt).toHaveBeenCalledWith('第一幕', expect.objectContaining({ traceId: 'run_77' }))
  })

  it('限流持续存在时按限流次数上限失败并保留场景与原因', async () => {
    vi.useFakeTimers()
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(() => { throw new Error('You have reached the API rate limit for free users.') })
    const promise = fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '第一幕' }] },
      serviceBus,
    })
    await vi.advanceTimersByTimeAsync(60000)
    const result = await promise
    expect(result).toMatchObject({
      success: false,
      error: expect.stringMatching(/scene 0.*rate limit/i),
    })
    expect(serviceBus.optimizePrompt).toHaveBeenCalledTimes(4)
  })

  it('非瞬时 provider 错误不重试，立即失败', async () => {
    vi.useFakeTimers()
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus(() => { throw new Error('invalid api key') })
    const promise = fn({
      stage: { options: {} },
      params: {},
      context: { split: [{ text: '第一幕' }] },
      serviceBus,
    })
    await vi.advanceTimersByTimeAsync(1000)
    const result = await promise
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/invalid api key/) })
    expect(serviceBus.optimizePrompt).toHaveBeenCalledTimes(1)
  })

  it('资源生成遇到 TTS 限流时重试并恢复，不拖垮整阶段', async () => {
    vi.useFakeTimers()
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: `image-${index}.png` } })),
      generateTTS: vi.fn()
        .mockResolvedValueOnce({ code: -1, message: 'TTS provider "minimax-tts" failed: rate limit reached' })
        .mockResolvedValueOnce({ code: -1, message: 'TTS provider "minimax-tts" failed: rate limit reached' })
        .mockResolvedValue({ code: 0, data: { path: 'audio-0.mp3', duration: 2 } }),
    }
    const fn = makePipeline(assetGenerator)
    const promise = fn({
      stage: { options: { concurrency: 1 } },
      params: {},
      context: { split: [{ text: '一' }], optimize: ['prompt'] },
      serviceBus: {},
    })
    await vi.advanceTimersByTimeAsync(30000)
    const result = await promise
    expect(result).toMatchObject({ success: true })
    expect(result.output.scenes).toHaveLength(1)
    expect(assetGenerator.generateTTS).toHaveBeenCalledTimes(3)
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(1)
  })

  it('提示词优化断点续传：已完成场景结果直接复用，不重复调用 prompt-engine', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const context = {
      split: [{ text: '一' }, { text: '二' }],
      optimize_resume: [{ optimized_prompt: '旧结果0', providerId: 'prompt-engine', model: 'mock-model' }],
    }
    const result = await fn({
      stage: { options: { quality_baseline: false } },
      params: {},
      context,
      serviceBus,
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output).toEqual([
      { optimized_prompt: '旧结果0', providerId: 'prompt-engine', model: 'mock-model' },
      expect.objectContaining({ optimized_prompt: '优化: 二' }),
    ])
    expect(serviceBus.calls).toHaveLength(1)
    // 实时进度：共 2 个场景，已完成 2 个
    expect(context.optimize_progress).toEqual({ done: 2, total: 2 })
  })

  it('资源生成断点续传：已完成场景跳过图片/TTS provider 调用', async () => {
    const resumeDir = fs.mkdtempSync(path.join(STORY2VIDEO_TEMP_DIR, 's2v-resume-legacy-'))
    const resumedImage = path.join(resumeDir, 'resume-image-0.png')
    const resumedAudio = path.join(resumeDir, 'resume-audio-0.mp3')
    fs.writeFileSync(resumedImage, 'resume image')
    fs.writeFileSync(resumedAudio, 'resume audio')
    const resumedImageRealPath = fs.realpathSync.native(resumedImage)
    const resumedAudioRealPath = fs.realpathSync.native(resumedAudio)
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: `image-${index}.png` } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: `audio-${index}.mp3`, duration: 2 } })),
    }
    const fn = makePipeline(assetGenerator)
    const context = {
      split: [{ text: '一' }, { text: '二' }],
      optimize: ['p0', 'p1'],
      generate_assets: {
        resume: {
          completed: [{ index: 0, imagePath: resumedImage, audioPath: resumedAudio, duration: 3 }],
        },
      },
    }
    const result = await fn({
      stage: { options: { concurrency: 2 } },
      params: {},
      context,
      serviceBus: {},
    })
    expect(result).toMatchObject({ success: true })
    expect(result.output.scenes).toHaveLength(2)
    expect(result.output.scenes[0]).toMatchObject({ index: 0, imagePath: resumedImageRealPath, audioPath: resumedAudioRealPath })
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(1)
    expect(assetGenerator.generateImage).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ index: 1 }))
    expect(assetGenerator.generateTTS).toHaveBeenCalledTimes(1)
    // 实时进度：图片 2/2 · 旁白 2/2（含续传场景）
    expect(context.assets_progress).toEqual({
      imagesDone: 2, imagesTotal: 2, videosDone: 0, videosTotal: 0, ttsDone: 2, ttsTotal: 2,
    })
    fs.rmSync(resumeDir, { recursive: true, force: true })
  })

  it('资源生成进度前置写入：阶段开始即显示「图片 0/N · 旁白 0/M」', async () => {
    let releaseImage
    const imageGate = new Promise((resolve) => { releaseImage = resolve })
    const assetGenerator = {
      generateImage: vi.fn(() => imageGate.then(() => ({ code: 0, data: { path: 'image-0.png' } }))),
      generateTTS: vi.fn(async () => ({ code: 0, data: { path: 'audio-0.mp3', duration: 2 } })),
    }
    const fn = makePipeline(assetGenerator)
    const context = { split: [{ text: '一' }], optimize: ['p0'] }
    const pending = fn({ stage: { options: {} }, params: {}, context, serviceBus: {} })
    // 首个资源完成前（图片生成可能耗时 16-30s），进度已前置写入
    expect(context.assets_progress).toEqual({
      imagesDone: 0, imagesTotal: 1, videosDone: 0, videosTotal: 0, ttsDone: 0, ttsTotal: 1,
    })
    releaseImage()
    const result = await pending
    expect(result.success).toBe(true)
    expect(context.assets_progress.imagesDone).toBe(1)
  })

  it('资源生成失败时记录已完成场景供断点续传', async () => {
    vi.useFakeTimers()
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: `image-${index}.png` } })),
      generateTTS: vi.fn(async (_text, { index }) => index === 1
        ? { code: -1, message: 'rate limit reached' }
        : { code: 0, data: { path: `audio-${index}.mp3`, duration: 2 } }),
    }
    const fn = makePipeline(assetGenerator)
    const context = {
      split: [{ text: '一' }, { text: '二' }],
      optimize: ['p0', 'p1'],
    }
    const promise = fn({
      stage: { options: { concurrency: 1 } },
      params: {},
      context,
      serviceBus: {},
    })
    await vi.advanceTimersByTimeAsync(60000)
    const result = await promise
    expect(result).toMatchObject({ success: false })
    expect(context.generate_assets?.resume?.completed).toEqual(expect.arrayContaining([
      expect.objectContaining({ index: 0, imagePath: 'image-0.png', audioPath: 'audio-0.mp3' }),
      expect.objectContaining({ index: 1, imagePath: 'image-1.png', audioPath: null }),
    ]))
    expect(context.generate_assets?.resume?.total).toBe(2)
  })

  it('资源生成遇到图片限流时重试后仍失败则按原样失败（不误判为内容政策）', async () => {
    vi.useFakeTimers()
    const assetGenerator = {
      generateImage: vi.fn().mockResolvedValue({ code: -1, message: 'Image provider "minimax-image" failed: rate limit reached' }),
      generateTTS: vi.fn(async () => ({ code: 0, data: { path: 'audio-0.mp3', duration: 2 } })),
    }
    const fn = makePipeline(assetGenerator)
    const promise = fn({
      stage: { options: { concurrency: 1 } },
      params: {},
      context: { split: [{ text: '一' }], optimize: ['prompt'] },
      serviceBus: {},
    })
    await vi.advanceTimersByTimeAsync(60000)
    const result = await promise
    expect(result).toMatchObject({ success: false, error: expect.stringMatching(/rate limit/i) })
    expect(result.error).not.toContain('content_policy')
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(4)
  })
})



describe('hasMeaningfulText — 无实质内容守卫（方案B，2026-08-09）', () => {
  it('单个纯数字 → 无实质内容（跳过优化）', () => {
    expect(hasMeaningfulText('1')).toBe(false)
    expect(hasMeaningfulText('5')).toBe(false)
  })

  it('2 位及以上纯数字 → 有意义（走优化，方案B）', () => {
    expect(hasMeaningfulText('81')).toBe(true)
    expect(hasMeaningfulText('1949')).toBe(true)
    expect(hasMeaningfulText('123456')).toBe(true)
  })

  it('单字中文 → 有意义（正常优化）', () => {
    expect(hasMeaningfulText('一')).toBe(true)
    expect(hasMeaningfulText('猫')).toBe(true)
  })

  it('纯空白/纯标点/纯符号 → 无实质内容（跳过优化）', () => {
    expect(hasMeaningfulText('   ')).toBe(false)
    expect(hasMeaningfulText('。。。')).toBe(false)
    expect(hasMeaningfulText('!!!')).toBe(false)
    expect(hasMeaningfulText('……')).toBe(false)
  })

  it('数字含上下文（如 81 年、1949 年）→ 有意义', () => {
    expect(hasMeaningfulText('81 年')).toBe(true)
    expect(hasMeaningfulText('1949年开国大典')).toBe(true)
  })
})

describe('isPromptEngineTooShortRejection — 过短校验拒绝判定', () => {
  it('命中 Too short / 太短 / min length 等文案', () => {
    expect(isPromptEngineTooShortRejection('prompt-engine 请求被拒绝(422): Too short (1 words). Try a more detailed description')).toBe(true)
    expect(isPromptEngineTooShortRejection('Too short: please provide more detail')).toBe(true)
    expect(isPromptEngineTooShortRejection('输入太短，无法优化')).toBe(true)
    expect(isPromptEngineTooShortRejection('must be at least 5 characters')).toBe(true)
  })

  it('命中真实中文文案（2026-08-09 Bug 反哺：描述太简短了（N 字））', () => {
    expect(isPromptEngineTooShortRejection('prompt-engine 请求被拒绝(422): 描述太简短了（2 字），建议更详细描述画面')).toBe(true)
    expect(isPromptEngineTooShortRejection('描述过短，请补充更多细节')).toBe(true)
    expect(isPromptEngineTooShortRejection('描述太简短')).toBe(true)
  })

  it('非过短拒绝不误判', () => {
    expect(isPromptEngineTooShortRejection('prompt-engine 请求被拒绝(422): unknown style value: foo')).toBe(false)
    expect(isPromptEngineTooShortRejection('prompt-engine 优化失败: llm error')).toBe(false)
    expect(isPromptEngineTooShortRejection('')).toBe(false)
  })
})

describe('tryReCloneVoice — 克隆音色不可访问时不得静默换默认音色', () => {
  it('克隆服务不可用时不调用 retryFn，返回 null 交由上层透传原始音色错误', async () => {
    const engine = { log: { warn() {}, info() {} }, container: { get: () => null } }
    const retryFn = vi.fn(async () => ({ code: 0, data: { path: 'C:/tmp/fallback.mp3', audio_path: 'C:/tmp/fallback.mp3', duration: 1.5 } }))
    const result = await tryReCloneVoice({
      pipelineEngine: engine,
      error: new Error("you don't have access to this voice_id"),
      text: '测试文案', voiceId: 'MiniMaxCloneVoice_00jngz', voiceProvider: 'minimax-multimodal', voiceModel: 'speech-2.8-turbo',
      resolveManager: () => ({ getAdapter: () => ({ cloneVoice: vi.fn() }) }),
      retryFn,
    })
    expect(result).toBeNull()
    expect(retryFn).not.toHaveBeenCalled()
  })

  it('本地样本存在但重新克隆失败时返回 null，不换用 provider 默认音色', async () => {
    const sampleRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 's2v-clone-fail-'))
    const sampleDir = path.join(sampleRoot, 'voice-clone-samples', 'owner', 'storage-1')
    await fs.promises.mkdir(sampleDir, { recursive: true })
    await fs.promises.writeFile(path.join(sampleDir, 'sample.mp3'), Buffer.from([1, 2, 3]))
    try {
      const engine = {
        log: { warn() {}, info() {} },
        container: {
          get: (key) => key === 'ttsVoiceCloneService'
            ? {
                findCloneSamples: vi.fn(async () => ({ sampleStorage: { relativeDir: 'voice-clone-samples/owner/storage-1' } })),
                _resolveUserDataPath: () => sampleRoot,
              }
            : null,
        },
      }
      const retryFn = vi.fn(async () => { throw new Error('should not be called with default voice') })
      const result = await tryReCloneVoice({
        pipelineEngine: engine,
        error: new Error("you don't have access to this voice_id"),
        text: '测试文案', voiceId: 'MiniMaxCloneVoice_00jngz', voiceProvider: 'minimax-multimodal', voiceModel: 'speech-2.8-turbo',
        resolveManager: () => ({ getAdapter: () => ({ cloneVoice: vi.fn(async () => { throw new Error('2038 voice clone user forbidden') }) }) }),
        retryFn,
      })
      expect(result).toBeNull()
      expect(retryFn).not.toHaveBeenCalled()
    } finally {
      await fs.promises.rm(sampleRoot, { recursive: true, force: true })
    }
  })

  it('重克隆成功但重试合成失败时返回 null，保留原始错误', async () => {
    const sampleRoot = await fs.promises.mkdtemp(path.join(os.tmpdir(), 's2v-clone-retry-'))
    const sampleDir = path.join(sampleRoot, 'voice-clone-samples', 'owner', 'storage-1')
    await fs.promises.mkdir(sampleDir, { recursive: true })
    await fs.promises.writeFile(path.join(sampleDir, 'sample.mp3'), Buffer.from([1, 2, 3]))
    try {
      const engine = {
        log: { warn() {}, info() {} },
        container: {
          get: (key) => key === 'ttsVoiceCloneService'
            ? {
                findCloneSamples: vi.fn(async () => ({ sampleStorage: { relativeDir: 'voice-clone-samples/owner/storage-1' } })),
                _resolveUserDataPath: () => sampleRoot,
              }
            : null,
        },
      }
      const retryFn = vi.fn(async (newVoiceId) => { throw new Error('voice id wrong after re-clone: ' + newVoiceId) })
      const result = await tryReCloneVoice({
        pipelineEngine: engine,
        error: new Error("you don't have access to this voice_id"),
        text: '测试文案', voiceId: 'MiniMaxCloneVoice_00jngz', voiceProvider: 'minimax-multimodal', voiceModel: 'speech-2.8-turbo',
        resolveManager: () => ({ getAdapter: () => ({ cloneVoice: vi.fn(async () => ({ id: 'MiniMaxCloneVoice_new123' })) }) }),
        retryFn,
      })
      expect(result).toBeNull()
      expect(retryFn).toHaveBeenCalledTimes(1)
      expect(retryFn).toHaveBeenCalledWith('MiniMaxCloneVoice_new123')
    } finally {
      await fs.promises.rm(sampleRoot, { recursive: true, force: true })
    }
  })
})

describe('Story2Video 阶段重克隆 — legacy serviceBus TTS 路径', () => {
  it('generate_assets 重克隆成功后复用 serviceBus.callPythonSkill，而不是访问不存在的 assetGenerator', async () => {
    const fixture = await createRecloneFixture()
    const ttsCalls = []
    const serviceBus = {
      callPythonSkill: vi.fn(async (skill, payload) => {
        if (skill === 'generate_image') {
          return { code: 0, data: { path: 'image-0.png' } }
        }
        if (skill === 'generate_tts') {
          ttsCalls.push(payload)
          if (ttsCalls.length === 1) throw Object.assign(new Error('invalid params, voice id wrong'), { code: 'INVALID_CONFIG' })
          return { code: 0, data: { path: 'audio-recloned.mp3', duration: 1.25 } }
        }
        throw new Error('unexpected Python skill: ' + skill)
      }),
    }
    const assetsExecutor = makePipeline(null, fixture.aiGenerator, { container: fixture.container })

    try {
      const result = await assetsExecutor({
        runId: 'run_1787360004146_izko',
        stage: { options: { concurrency: 1 } },
        params: {
          voiceId: 'MiniMaxVoice_original001',
          voiceProvider: 'minimax-multimodal',
        },
        context: {
          split: [{ text: '音色001 的测试旁白' }],
          optimize: ['一个安静的室内场景'],
        },
        serviceBus,
      })

      expect(result.success, JSON.stringify({ result, callAdapterCalls: fixture.manager.callAdapter.mock.calls.length, cloneCalls: fixture.cloneVoice.mock.calls.length, findSamplesCalls: fixture.container.get.mock.calls })).toBe(true)
      expect(ttsCalls).toHaveLength(2)
      expect(ttsCalls.map((payload) => payload.voice_id)).toEqual([
        'MiniMaxVoice_original001',
        'MiniMaxVoice_recloned123',
      ])
      expect(ttsCalls.map((payload) => payload.voice_model)).toEqual([undefined, undefined])
      expectRecloneAttempt(fixture)
      expect(result.output.scenes[0]).toMatchObject({
        audioPath: 'audio-recloned.mp3',
        imagePath: 'image-0.png',
      })
      expect(ttsCalls.some((payload) => payload.voice_id === 'default')).toBe(false)
    } finally {
      await fs.promises.rm(fixture.sampleRoot, { recursive: true, force: true })
    }
  })

  it('finalize_assets 重克隆成功后同样复用 legacy serviceBus TTS 路径', async () => {
    const fixture = await createRecloneFixture()
    const ttsCalls = []
    const serviceBus = {
      callPythonSkill: vi.fn(async (skill, payload) => {
        if (skill !== 'generate_tts') throw new Error('unexpected Python skill: ' + skill)
        ttsCalls.push(payload)
        if (ttsCalls.length === 1) throw Object.assign(new Error("you don't have access to this voice_id"), { code: 'INVALID_CONFIG' })
        return { code: 0, data: { path: 'finalized-audio-recloned.mp3', duration: 1.5 } }
      }),
    }
    const assetsExecutor = makePipeline(null, fixture.aiGenerator, { container: fixture.container })

    try {
      const result = await assetsExecutor.finalizeAssetsExecutor({
        runId: 'run_1787360004146_izko-finalize',
        stage: { options: { creationMode: 'manual', concurrency: 1 } },
        params: {
          voiceId: 'MiniMaxVoice_original001',
          voiceProvider: 'minimax-multimodal',
          voiceModel: 'speech-2.8-turbo',
        },
        context: {
          generate_assets: {
            candidates: [{
              index: 0,
              text: '音色001 的手动旁白',
              prompt: '一个安静的室内场景',
              candidates: [{ id: 'image-0', kind: 'image', path: 'image-0.png' }],
            }],
          },
          scene_asset_selection: {
            selections: [{ index: 0, candidateId: 'image-0' }],
          },
        },
        serviceBus,
      })

      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(ttsCalls.map((payload) => payload.voice_id)).toEqual([
        'MiniMaxVoice_original001',
        'MiniMaxVoice_recloned123',
      ])
      expect(ttsCalls.map((payload) => payload.voice_model)).toEqual(['speech-2.8-turbo', 'speech-2.8-turbo'])
      expectRecloneAttempt(fixture)
      expect(result.output.scenes[0]).toMatchObject({
        audioPath: 'finalized-audio-recloned.mp3',
        imagePath: 'image-0.png',
      })
      expect(ttsCalls.some((payload) => payload.voice_id === 'default')).toBe(false)
    } finally {
      await fs.promises.rm(fixture.sampleRoot, { recursive: true, force: true })
    }
  })

  it('finalize_assets 使用 assetGenerator 时重克隆后仍调用 assetGenerator.generateTTS', async () => {
    const fixture = await createRecloneFixture()
    const ttsCalls = []
    const assetGenerator = {
      generateTTS: vi.fn(async (text, payload) => {
        ttsCalls.push({ text, payload })
        if (ttsCalls.length === 1) throw Object.assign(new Error('voice id wrong'), { code: 'INVALID_CONFIG' })
        return { code: 0, data: { path: 'finalized-asset-generator-recloned.mp3', duration: 1.9 } }
      }),
    }
    const assetsExecutor = makePipeline(assetGenerator, fixture.aiGenerator, { container: fixture.container })

    try {
      const result = await assetsExecutor.finalizeAssetsExecutor({
        runId: 'run_1787360004146_izko-finalize-asset-generator',
        stage: { options: { creationMode: 'manual', concurrency: 1 } },
        params: {
          voiceId: 'MiniMaxVoice_original001',
          voiceProvider: 'minimax-multimodal',
          voiceModel: 'speech-2.8-turbo',
        },
        context: {
          generate_assets: {
            candidates: [{
              index: 0,
              text: '音色001 的 assetGenerator 手动旁白',
              prompt: '一个安静的室内场景',
              candidates: [{ id: 'image-0', kind: 'image', path: 'image-0.png' }],
            }],
          },
          scene_asset_selection: {
            selections: [{ index: 0, candidateId: 'image-0' }],
          },
        },
        serviceBus: {},
      })

      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(assetGenerator.generateTTS).toHaveBeenCalledTimes(2)
      expect(ttsCalls.map(({ payload }) => payload.voice_id)).toEqual([
        'MiniMaxVoice_original001',
        'MiniMaxVoice_recloned123',
      ])
      expect(ttsCalls.map(({ payload }) => payload.voice_model)).toEqual(['speech-2.8-turbo', 'speech-2.8-turbo'])
      expectRecloneAttempt(fixture)
      expect(ttsCalls[1]).toMatchObject({
        text: '音色001 的 assetGenerator 手动旁白',
        payload: {
          voice_provider: 'minimax-multimodal',
          voice_model: 'speech-2.8-turbo',
        },
      })
      expect(result.output.scenes[0]).toMatchObject({
        audioPath: 'finalized-asset-generator-recloned.mp3',
        imagePath: 'image-0.png',
      })
    } finally {
      await fs.promises.rm(fixture.sampleRoot, { recursive: true, force: true })
    }
  })

  it('generate_assets 使用 assetGenerator 时重克隆后仍调用 assetGenerator.generateTTS', async () => {
    const fixture = await createRecloneFixture()
    const ttsCalls = []
    const assetGenerator = {
      generateImage: vi.fn(async () => ({ code: 0, data: { path: 'image-asset-generator.png' } })),
      generateTTS: vi.fn(async (text, payload) => {
        ttsCalls.push({ text, payload })
        if (ttsCalls.length === 1) throw Object.assign(new Error('voice id wrong'), { code: 'INVALID_CONFIG' })
        return { code: 0, data: { path: 'audio-asset-generator-recloned.mp3', duration: 1.75 } }
      }),
    }
    const assetsExecutor = makePipeline(assetGenerator, fixture.aiGenerator, { container: fixture.container })

    try {
      const result = await assetsExecutor({
        runId: 'run_1787360004146_izko-asset-generator',
        stage: { options: { concurrency: 1 } },
        params: {
          voiceId: 'MiniMaxVoice_original001',
          voiceProvider: 'minimax-multimodal',
          voiceModel: 'speech-2.8-turbo',
        },
        context: {
          split: [{ text: '音色001 的 assetGenerator 测试旁白' }],
          optimize: ['一个安静的室内场景'],
        },
        serviceBus: {},
      })

      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(assetGenerator.generateTTS).toHaveBeenCalledTimes(2)
      expect(ttsCalls.map(({ payload }) => payload.voice_id)).toEqual([
        'MiniMaxVoice_original001',
        'MiniMaxVoice_recloned123',
      ])
      expect(ttsCalls.map(({ payload }) => payload.voice_model)).toEqual(['speech-2.8-turbo', 'speech-2.8-turbo'])
      expectRecloneAttempt(fixture)
      expect(ttsCalls[1]).toMatchObject({
        text: '音色001 的 assetGenerator 测试旁白',
        payload: {
          voice_provider: 'minimax-multimodal',
          voice_model: 'speech-2.8-turbo',
          with_timestamps: true,
        },
      })
      expect(result.output.scenes[0]).toMatchObject({
        audioPath: 'audio-asset-generator-recloned.mp3',
        imagePath: 'image-asset-generator.png',
      })
    } finally {
      await fs.promises.rm(fixture.sampleRoot, { recursive: true, force: true })
    }
  })

  it('generate_assets 内容安全改写重试：触发 onContentPolicyRewrite 时上报 assetsImageRewriting 进度（2026-08-30 复盘 mtequszp_enqn）', async () => {
    const progressEvents = []
    const assetGenerator = {
      generateImage: vi.fn(async (prompt, opts) => {
        // 模拟供应商判定输入敏感 → 触发改写回调 → 改写后成功
        if (typeof opts.onContentPolicyRewrite === 'function') opts.onContentPolicyRewrite()
        return { code: 0, data: { path: 'image-rewritten.png' } }
      }),
      generateTTS: vi.fn(async () => ({ code: 0, data: { path: 'audio-rewritten.mp3', duration: 1.5 } })),
    }
    const assetsExecutor = makePipeline(assetGenerator, { generate: vi.fn() })

    const result = await assetsExecutor({
      runId: 'run_content_policy_rewrite',
      stage: { options: { concurrency: 1 } },
      params: {},
      context: {
        split: [{ text: '含敏感表述的旁白' }],
        optimize: ['一个含敏感表述的场景描述'],
      },
      serviceBus: {},
      onProgress: (update) => progressEvents.push(update),
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    // 改写回调被透传到 assetGenerator.generateImage 的 opts
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(1)
    expect(assetGenerator.generateImage.mock.calls[0][1].onContentPolicyRewrite).toBeTypeOf('function')
    // 进度上报中出现 assetsImageRewriting（改写重试进行中提示）
    const rewritingEvent = progressEvents.find((e) => e.messageKey === 'stageProgress.assetsImageRewriting')
    expect(rewritingEvent).toBeTruthy()
    expect(rewritingEvent.message).toContain('Rewriting sensitive prompt')
    // 改写提示保留图片计数（供前端「正在生成图片 · x/y」后追加提示）
    expect(rewritingEvent.messageParams).toMatchObject({ images: 0, imagesTotal: 1 })
  })

  it('generate_assets auto 路径透传 sceneContext 供内容安全改写保留原文背景（方案层 2，2026-08-30）', async () => {
    const assetGenerator = {
      generateImage: vi.fn(async (prompt, opts) => {
        if (typeof opts.onContentPolicyRewrite === 'function') opts.onContentPolicyRewrite()
        return { code: 0, data: { path: 'image-scene-context.png' } }
      }),
      generateTTS: vi.fn(async () => ({ code: 0, data: { path: 'audio-scene-context.mp3', duration: 1.5 } })),
    }
    const assetsExecutor = makePipeline(assetGenerator, { generate: vi.fn() })

    const result = await assetsExecutor({
      runId: 'run_scene_context',
      stage: { options: { concurrency: 1 } },
      params: {},
      context: {
        split: [{ text: '旁白' }],
        optimize: ['一个场景描述'],
        scene_context: {
          scenes: [
            {
              storyContext: '唐代，中国，老妇人，厨房，油灯',
              anchors: ['唐代', '油灯'],
              context: { character: '老妇人', setting: '水墨画' },
            },
          ],
        },
      },
      serviceBus: {},
      onProgress: () => {},
    })

    expect(result.success, JSON.stringify(result)).toBe(true)
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(1)
    // auto 路径必须把 sceneContext 透传给 generateImage，供改写保留背景锚点
    expect(assetGenerator.generateImage.mock.calls[0][1].sceneContext).toEqual({
      contextBlock: '唐代，中国，老妇人，厨房，油灯',
      anchors: ['唐代', '油灯'],
      // 优化点 6：透传角色一致性与视觉风格
      character: '老妇人',
      style: '水墨画',
    })
  })
})

describe('story2video 生成并发按 provider 每分钟连接次数收敛', () => {
describe('isPromptEngineEmptyReasoningError — 空内容/纯推理判定', () => {
  it('命中空内容/仅推理/未生成有效优化词文案', () => {
    expect(isPromptEngineEmptyReasoningError('场景 0 prompt-engine 优化失败: LLM 返回了空内容或仅包含推理内容，未生成有效优化词')).toBe(true)
    expect(isPromptEngineEmptyReasoningError('prompt-engine 优化失败: empty content from LLM')).toBe(true)
    expect(isPromptEngineEmptyReasoningError('LLM output only reasoning content')).toBe(true)
  })

  it('非空/非推理错误不误判', () => {
    expect(isPromptEngineEmptyReasoningError('prompt-engine 优化失败: quota exceeded')).toBe(false)
    expect(isPromptEngineEmptyReasoningError('prompt-engine 请求被拒绝(422): Too short')).toBe(false)
    expect(isPromptEngineEmptyReasoningError('')).toBe(false)
  })
})

  it('provider rate_per_minute=20（maxConcurrent=2）时图片/TTS 并发上限为 2，而非请求的 5（assetGenerator 路径不套外层 governor）', async () => {
    const executors = new Map()
    let gate
    const gateP = new Promise((resolve) => { gate = resolve })
    let imageActive = 0
    let imagePeak = 0
    let ttsActive = 0
    let ttsPeak = 0
    const assetGenerator = {
      generateImage: vi.fn(async () => {
        imageActive += 1
        imagePeak = Math.max(imagePeak, imageActive)
        await gateP
        imageActive -= 1
        return { path: 'image-x.png' }
      }),
      generateTTS: vi.fn(async () => {
        ttsActive += 1
        ttsPeak = Math.max(ttsPeak, ttsActive)
        await gateP
        ttsActive -= 1
        return { data: { path: 'audio-x.mp3', duration: 2 } }
      }),
    }
    const manager = {
      getDefault: vi.fn((type) => ({ id: 'minimax-multimodal' })),
      getProvider: vi.fn((id) => ({ id, category: 'multimodal', config: { rate_per_minute: 20, limit_per_5h: 500 } })),
    }
    const governorRun = vi.fn((meta, task) => task())
    const pipeline = {
      stageExecutor: executors,
      _assetGenerator: assetGenerator,
      aiGenerator: null,
      governor: { sweepAll: vi.fn(), run: governorRun },
      container: { get: (name) => (name === 'modelProviderManager' ? manager : null) },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerStageExecutor(type, fn) {
        executors.set(type, fn)
        return { success: true }
      },
    }
    registerStory2VideoStages(pipeline)
    const assetsExecutor = executors.get(STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS)
    assetsExecutor.optimizeExecutor = executors.get(STORY2VIDEO_STAGE_TYPES.OPTIMIZE)

    const pending = assetsExecutor({
      stage: { options: { concurrency: 5 } },
      params: {},
      context: {
        split: [{ text: '一' }, { text: '二' }, { text: '三' }],
        optimize: ['p1', 'p2', 'p3'],
      },
      serviceBus: {},
    })

    // 门打开前：每类最多并发 2 个（预算 maxConcurrent=2），而不是请求的 5
    await vi.waitFor(() => {
      expect(assetGenerator.generateImage).toHaveBeenCalled()
      expect(assetGenerator.generateTTS).toHaveBeenCalled()
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(imagePeak).toBeLessThanOrEqual(2)
    expect(ttsPeak).toBeLessThanOrEqual(2)
    expect(imagePeak).toBeGreaterThanOrEqual(1)

    gate()
    const result = await pending
    expect(result.success).toBe(true)
    expect(result.output.scenes.length).toBe(3)
    // 新契约（2026-08-10 双包死锁复盘）：assetGenerator 路径由 AIGenerator 内部 governor 单层调度，
    // 阶段外层不再套 withModelBudget/governor.run（避免同 key 双包自死锁）→ 外层 governorRun 不应被调用。
    expect(governorRun.mock.calls.length).toBe(0)
    // 日志包含预算收敛后的并发值
    const logCalls = pipeline.log.info.mock.calls.flat().join(' ')
    expect(logCalls).toContain('imageConcurrency=2')
    expect(logCalls).toContain('ttsConcurrency=2')
  })

  it('provider 未配置预算时回退静态表预算（openai 静态 maxConcurrent=3，不降级）', async () => {
    const executors = new Map()
    let gate
    const gateP = new Promise((resolve) => { gate = resolve })
    let imageActive = 0
    let imagePeak = 0
    const assetGenerator = {
      generateImage: vi.fn(async () => {
        imageActive += 1
        imagePeak = Math.max(imagePeak, imageActive)
        await gateP
        imageActive -= 1
        return { path: 'image-x.png' }
      }),
      generateTTS: vi.fn(async () => ({ data: { path: 'audio-x.mp3', duration: 2 } })),
    }
    const manager = {
      getDefault: vi.fn(() => ({ id: 'openai' })),
      getProvider: vi.fn((id) => ({ id, category: 'llm', config: {} })),
    }
    const pipeline = {
      stageExecutor: executors,
      _assetGenerator: assetGenerator,
      aiGenerator: null,
      governor: { sweepAll: vi.fn() },
      container: { get: (name) => (name === 'modelProviderManager' ? manager : null) },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerStageExecutor(type, fn) {
        executors.set(type, fn)
        return { success: true }
      },
    }
    registerStory2VideoStages(pipeline)
    const assetsExecutor = executors.get(STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS)
    assetsExecutor.optimizeExecutor = executors.get(STORY2VIDEO_STAGE_TYPES.OPTIMIZE)

    const pending = assetsExecutor({
      stage: { options: { concurrency: 3 } },
      params: {},
      context: {
        split: [{ text: '一' }, { text: '二' }, { text: '三' }],
        optimize: ['p1', 'p2', 'p3'],
      },
      serviceBus: {},
    })
    await vi.waitFor(() => {
      expect(assetGenerator.generateImage).toHaveBeenCalled()
    })
    await new Promise((resolve) => setTimeout(resolve, 30))
    expect(imagePeak).toBe(3) // 无配置 → 回退请求并发 3
    gate()
    const result = await pending
    expect(result.success).toBe(true)
  })
})

describe('story2video 调度边界（2026-08-10 双包死锁复盘）', () => {
  it('legacy python 路径（无 assetGenerator）每项资源仍经 withModelBudget → governor.run 统一调度', async () => {
    const executors = new Map()
    const governorRun = vi.fn((meta, task) => task())
    const pipeline = {
      stageExecutor: { register(type, fn) { executors.set(type, fn) } },
      _assetGenerator: null,
      aiGenerator: null,
      governor: { sweepAll: vi.fn(), run: governorRun },
      container: { get: () => null },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerStageExecutor(type, fn) {
        executors.set(type, fn)
        return { success: true }
      },
    }
    registerStory2VideoStages(pipeline)
    const assetsExecutor = executors.get(STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS)
    assetsExecutor.optimizeExecutor = executors.get(STORY2VIDEO_STAGE_TYPES.OPTIMIZE)
    const serviceBus = {
      _assetGenerator: null,
      callPythonSkill: vi.fn(async (skill) => {
        if (skill === 'generate_image') return { code: 0, data: { path: 'img-legacy.png' } }
        if (skill === 'generate_tts') return { code: 0, data: { path: 'audio-legacy.mp3', duration: 2 } }
        return { code: 0, data: {} }
      }),
    }

    const result = await assetsExecutor({
      stage: {
        options: {
          concurrency: 2,
          imageProvider: 'minimax-multimodal',
          imageModel: 'image-1',
          voiceProvider: 'minimax-multimodal',
          voiceModel: 'voice-1',
        },
      },
      params: {},
      context: {
        split: [{ text: '一' }, { text: '二' }],
        optimize: ['p1', 'p2'],
      },
      serviceBus,
    })

    expect(result.success).toBe(true)
    expect(result.output.scenes.length).toBe(2)
    // legacy 路径保留外层统一调度：2 图片 + 2 TTS 每项都经 governor.run，且 meta 携带 type/providerId/model
    expect(governorRun.mock.calls.length).toBe(4)
    expect(governorRun.mock.calls.some(([meta]) => meta.type === 'image' && meta.providerId === 'minimax-multimodal' && meta.model === 'image-1')).toBe(true)
    expect(governorRun.mock.calls.some(([meta]) => meta.type === 'tts' && meta.providerId === 'minimax-multimodal' && meta.model === 'voice-1')).toBe(true)
  })

  it('真实 governor 回归：assetGenerator 内部再入 governor 时，3 场景并发有界完成，不自死锁', async () => {
    const { ApiUsageGovernor } = require('./api-usage-governor')
    // 与生产接线一致：pipelineEngine.governor 与 aiGenerator._governor 指向同一个 ApiUsageGovernor 单例
    const governor = new ApiUsageGovernor({
      log: { warn: () => {}, info: () => {} },
      providerLimits: { 'minimax-multimodal': { rpm: 15, maxConcurrent: 2, cooldownMs: 60000, retry429: 3 } },
    })
    const aiGeneratorLike = {
      _governor: governor,
      generate: vi.fn(async (type, providerId, params) => {
        // 模拟 AIGenerator.generate 的 governor 网关（同实例、同 key）
        return governor.run({ type, providerId, model: String(params.model || '') }, async () => {
          await new Promise((resolve) => setTimeout(resolve, 10))
          if (type === 'image') return { code: 0, data: { path: 'img-' + params.index + '.png' } }
          return { code: 0, data: { path: 'audio-' + params.index + '.mp3', duration: 2 } }
        })
      }),
    }
    const assetGenerator = {
      generateImage: vi.fn(async (prompt, opts) => aiGeneratorLike.generate('image', 'minimax-multimodal', { ...opts, model: opts.image_model })),
      generateTTS: vi.fn(async (text, opts) => aiGeneratorLike.generate('tts', 'minimax-multimodal', { ...opts, model: opts.voice_model })),
    }
    const executors = new Map()
    const pipeline = {
      stageExecutor: executors,
      _assetGenerator: assetGenerator,
      aiGenerator: aiGeneratorLike,
      governor,
      container: { get: () => null },
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerStageExecutor(type, fn) {
        executors.set(type, fn)
        return { success: true }
      },
    }
    registerStory2VideoStages(pipeline)
    const assetsExecutor = executors.get(STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS)
    assetsExecutor.optimizeExecutor = executors.get(STORY2VIDEO_STAGE_TYPES.OPTIMIZE)

    const result = await Promise.race([
      assetsExecutor({
        stage: {
          options: {
            concurrency: 3,
            imageProvider: 'minimax-multimodal',
            imageModel: 'image-1',
            voiceProvider: 'minimax-multimodal',
            voiceModel: 'voice-1',
          },
        },
        params: {},
        context: {
          split: [{ text: '一' }, { text: '二' }, { text: '三' }],
          optimize: ['p1', 'p2', 'p3'],
        },
        serviceBus: {},
      }),
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('generate_assets 死锁：阶段外层与 AIGenerator 内层同 key 双包，互相等待信号量')), 30000)),
    ])

    expect(result.success).toBe(true)
    expect(result.output.scenes.length).toBe(3)
    // 3 图片 + 3 TTS 全部经内层 governor 完成；外层未再套 governor（否则此处 30s 死锁判定超时）
    expect(aiGeneratorLike.generate.mock.calls.length).toBe(6)
    expect(governor.getStatus('minimax-multimodal:image:image-1').active).toBe(0)
    expect(governor.getStatus('minimax-multimodal:tts:voice-1').active).toBe(0)
  }, 60000)
})

describe('story2video 视频+图片轮播混合模式（2026-08-11）', () => {
  const scenes = Array.from({ length: 10 }, (_, i) => ({
    index: i,
    text: '场景' + i,
    prompt: 'prompt-' + i,
    seconds: 6,
  }))

  describe('fixed 模式场景选择', () => {
    it('按顺序累计估算时长标记前 fixedRatio% 的场景', () => {
      const { selected, ratio } = pickFixedVideoScenes(scenes, 25)
      // 目标 25%×60s=15s：场景0(6s)+场景1(6s)+场景2(6s) 累计 18s 首次 ≥15s → [0,1,2]
      expect(selected).toEqual([0, 1, 2])
      expect(ratio).toBe(30) // 边界含入：18s/60s
    })

    it('fixedRatio 较小时至少标记 1 个场景', () => {
      const { selected, ratio } = pickFixedVideoScenes(scenes, 10)
      expect(selected).toEqual([0])
      expect(ratio).toBe(10)
    })

    it('空场景返回空选择', () => {
      expect(pickFixedVideoScenes([], 25)).toEqual({ selected: [], ratio: 0 })
    })

    it('不同时长的场景按秒累计（非按个数）', () => {
      const uneven = [
        { index: 0, seconds: 2 },
        { index: 1, seconds: 2 },
        { index: 2, seconds: 2 },
        { index: 3, seconds: 12 },
      ]
      const { selected } = pickFixedVideoScenes(uneven, 30) // 30% × 18s = 5.4s
      expect(selected).toEqual([0, 1, 2]) // 6s ≥ 5.4s 边界场景 2 被标记
    })
  })

  describe('ai-judged 解析与钳制', () => {
    it('严格解析合法 JSON 数组', () => {
      const raw = JSON.stringify([
        { index: 0, video: true, excitement: 9, reason: '开场动作' },
        { index: 1, video: false, excitement: 3, reason: '过渡' },
      ])
      const parsed = parseVideoSelection(raw, 10)
      expect(parsed).toEqual([
        { index: 0, video: true, excitement: 9, reason: '开场动作' },
        { index: 1, video: false, excitement: 3, reason: '过渡' },
      ])
    })

    it('非 JSON / 非法 index / 重复 index 一律返回 null（fail closed）', () => {
      expect(parseVideoSelection('not json', 10)).toBeNull()
      expect(parseVideoSelection(JSON.stringify([{ index: 99, video: true, excitement: 5 }]), 10)).toBeNull()
      expect(parseVideoSelection(JSON.stringify([{ index: 0, video: true }, { index: 0, video: false }]), 10)).toBeNull()
      expect(parseVideoSelection('', 10)).toBeNull()
    })

    it('超 maxRatio 时按 excitement 从低到高剔除', () => {
      const entries = [
        { index: 0, video: true, excitement: 9 },
        { index: 1, video: true, excitement: 8 },
        { index: 2, video: true, excitement: 7 },
        { index: 3, video: true, excitement: 6 },
      ]
      // 4 场景各 6s → 24s/24s=100%；maxRatio 50 → 应剔除至 2 个（50%）
      const { selected, ratio } = clampVideoSelection(scenes.slice(0, 4), entries, {
        minRatio: 20, maxRatio: 50, maxScenes: 3,
      })
      expect(selected).toEqual([0, 1])
      expect(ratio).toBe(50)
    })

    it('不足 minRatio 时按 excitement 补入未选场景', () => {
      const entries = [
        { index: 0, video: true, excitement: 9 },
        { index: 1, video: false, excitement: 8 },
        { index: 2, video: false, excitement: 7 },
      ]
      // 初选 1 场景 = 33.3%；minRatio 60 → 补入 index1 → 66.7%
      const { selected, ratio } = clampVideoSelection(scenes.slice(0, 3), entries, {
        minRatio: 60, maxRatio: 80, maxScenes: 3,
      })
      expect(selected).toEqual([0, 1])
      expect(ratio).toBe(66.7)
    })

    it('maxScenes 上限截断', () => {
      const entries = scenes.map(scene => ({ index: scene.index, video: true, excitement: 10 - scene.index }))
      const { selected } = clampVideoSelection(scenes, entries, { minRatio: 0, maxRatio: 100, maxScenes: 3 })
      expect(selected).toHaveLength(3)
      expect(selected).toEqual([0, 1, 2])
    })

    it('全部剔除后保留最高 excitement 单场景', () => {
      const entries = scenes.map(scene => ({ index: scene.index, video: true, excitement: scene.index + 1 }))
      const { selected } = clampVideoSelection(scenes, entries, { minRatio: 100, maxRatio: 5, maxScenes: 2 })
      expect(selected).toHaveLength(1)
      expect(selected[0]).toBe(9)
    })
  })

  describe('select_video_scenes 执行器', () => {
    function makeSelectPipeline(aiGenerator) {
      const stageExecutor = makeStageExecutor()
      const pipeline = {
        stageExecutor,
        _assetGenerator: null,
        aiGenerator,
        log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
        registerStageExecutor(type, fn) { stageExecutor.register(type, fn); return { success: true } },
      }
      registerStory2VideoStages(pipeline)
      return stageExecutor.executors.get(STORY2VIDEO_STAGE_TYPES.SELECT_VIDEO_SCENES)
    }

    const videoOptions = {
      video: { mode: 'fixed', provider: '', model: '', fixedRatio: 25, minRatio: 20, maxRatio: 40, maxScenes: 3 },
    }

    it('mode=off 输出空 plan，不校验视频生成器', async () => {
      const fn = makeSelectPipeline(null)
      const context = { optimize: ['p0', 'p1'], split: [{ text: '一' }, { text: '二' }] }
      const result = await fn({ stage: { options: { video: { mode: 'off' } } }, params: {}, context })
      expect(result).toMatchObject({ success: true })
      expect(result.output).toEqual({ mode: 'off', scenes: [], ratio: 0, selectedCount: 0 })
      expect(context.video_plan.mode).toBe('off')
    })

    it('fixed 模式未配置视频生成器时 fail closed 引导设置', async () => {
      const fn = makeSelectPipeline(null)
      const context = { optimize: ['p0', 'p1'], split: [{ text: '一' }, { text: '二' }] }
      const result = await fn({ stage: { options: videoOptions }, params: {}, context })
      expect(result.success).toBe(false)
      expect(result.error).toContain('视频生成器未配置')
    })

    it('fixed 模式输出视频场景计划（顺序前段）', async () => {
      const aiGenerator = {
        _modelProviderManager: {
          getDefault: vi.fn((type) => type === 'video'
            ? { id: 'kling', models: ['kling-v1'] }
            : { id: 'openai', models: ['gpt-4.1-mini'] }),
        },
      }
      const fn = makeSelectPipeline(aiGenerator)
      const context = {
        optimize: ['p0', 'p1', 'p2', 'p3'],
        split: [{ text: '一' }, { text: '二' }, { text: '三' }, { text: '四' }],
      }
      const result = await fn({ stage: { options: videoOptions }, params: {}, context })
      expect(result.success).toBe(true)
      expect(result.output.mode).toBe('fixed')
      expect(result.output.provider).toBe('kling')
      expect(result.output.scenes.filter(s => s.useVideo).map(s => s.index)).toEqual([0])
      expect(result.output.selectedCount).toBe(1)
    })

    it('ai-judged 模式调用 LLM 并按区间钳制', async () => {
      const aiGenerator = {
        _modelProviderManager: {
          getDefault: vi.fn((type) => type === 'video'
            ? { id: 'ltx', models: ['ltx-v1'] }
            : { id: 'openai', models: ['gpt-4.1-mini'] }),
        },
        generateWithDefault: vi.fn(async (_type, _params) => ({
          content: JSON.stringify([
            { index: 0, video: true, excitement: 10, reason: '高潮' },
            { index: 1, video: true, excitement: 8, reason: '动作' },
            { index: 2, video: true, excitement: 9, reason: '转场' },
          ]),
        })),
      }
      const fn = makeSelectPipeline(aiGenerator)
      const context = {
        optimize: ['p0', 'p1', 'p2'],
        split: [{ text: '一' }, { text: '二' }, { text: '三' }],
      }
      const result = await fn({
        stage: { options: { video: { mode: 'ai-judged', provider: '', model: '', fixedRatio: 25, minRatio: 60, maxRatio: 80, maxScenes: 3 } } },
        params: {},
        context,
      })
      expect(result.success).toBe(true)
      // 初选 3 场景=100%，maxRatio 80 → 剔除最低 excitement（index1）→ [0,2]=66.7%
      expect(result.output.scenes.filter(s => s.useVideo).map(s => s.index)).toEqual([0, 2])
    })

    it('恢复标记下视频计划和 AI 判断均读取当前能力模型', async () => {
      const llmBindings = []
      const aiGenerator = {
        _modelProviderManager: {
          getDefault: vi.fn((type) => type === 'video'
            ? { id: 'current-video', models: ['video-current-model'] }
            : { id: 'current-llm', models: ['llm-current-model'] }),
        },
        generateWithDefault: vi.fn(async (type) => {
          const current = aiGenerator._modelProviderManager.getDefault(type)
          llmBindings.push({ provider: current.id, model: current.models[0] })
          return { content: JSON.stringify([{ index: 0, video: true, excitement: 8 }]) }
        }),
      }
      const fn = makeSelectPipeline(aiGenerator)
      const result = await fn({
        stage: { options: { video: { mode: 'ai-judged', provider: 'old-video', model: 'old-video-model', minRatio: 20, maxRatio: 80, maxScenes: 1 } } },
        params: { __resumeUseCurrentModels: true },
        context: {
          optimize: ['p0'],
          split: [{ text: '一' }],
          video_plan: { provider: 'old-video', model: 'old-video-model' },
        },
      })

      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ provider: 'current-video', model: 'video-current-model' })
      expect(llmBindings).toEqual([{ provider: 'current-llm', model: 'llm-current-model' }])
      expect(result.output.provider).not.toBe('old-video')
      expect(result.output.model).not.toBe('old-video-model')
    })

    it('ai-judged LLM 返回无法解析时 fail closed', async () => {
      const aiGenerator = {
        _modelProviderManager: {
          getDefault: vi.fn((type) => type === 'video' ? { id: 'ltx', models: ['ltx-v1'] } : { id: 'openai', models: ['x'] }),
        },
        generateWithDefault: vi.fn(async () => ({ content: '不是 JSON' })),
      }
      const fn = makeSelectPipeline(aiGenerator)
      const context = { optimize: ['p0'], split: [{ text: '一' }] }
      const result = await fn({
        stage: { options: { video: { mode: 'ai-judged', minRatio: 20, maxRatio: 40, maxScenes: 3 } } },
        params: {},
        context,
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('无法解析')
    })

    it('显式 provider 优先于默认视频生成器', () => {
      const aiGenerator = {
        _modelProviderManager: {
          getDefault: vi.fn(() => ({ id: 'default-video', models: ['m'] })),
        },
      }
      const resolved = resolveVideoGeneratorConfig({ aiGenerator }, { provider: 'minimax', model: 'minimax-v1' })
      expect(resolved).toEqual({ providerId: 'minimax', model: 'minimax-v1' })
    })

    it('估算时长：sentence.duration 优先，其次 targetSeconds，兜底 6s', () => {
      expect(estimateSceneSeconds({ duration: 3 }, 6)).toBe(3)
      expect(estimateSceneSeconds({ targetSeconds: 4 }, 6)).toBe(4)
      expect(estimateSceneSeconds({}, 6)).toBe(6)
      expect(estimateSceneSeconds({ duration: 0 }, 6)).toBe(6)
    })
  })
})

describe('generate_assets 视频分支（2026-08-11）', () => {
  let server
  let baseUrl
  let tinyVideoPath
  let mediaAvailable = true
  const FFMPEG = findFfmpeg()

  beforeAll(async () => {
    // 跨平台：CI 设 SKIP_NATIVE_MEDIA_TOOL_TESTS=1 时 findFfmpeg() 返回 null，整个 describe 跳过
    if (!FFMPEG) {
      mediaAvailable = false
      return
    }
    // 生成 1 秒真实 mp4（颜色源 + 静音），供视频下载/合成测试使用
    tinyVideoPath = path.join(os.tmpdir(), 'story2video-test-tiny-' + process.pid + '.mp4')
    await new Promise((resolve, reject) => {
      execFile(FFMPEG, ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=320x240:d=1', '-f', 'lavfi', '-i', 'anullsrc=r=44100:cl=mono', '-shortest', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', tinyVideoPath], (error) => {
        if (error) reject(new Error(String(error).slice(0, 300)))
        else resolve()
      })
    })
    server = http.createServer((req, res) => {
      if (req.url && req.url.includes('missing')) {
        res.writeHead(404, { 'Content-Type': 'text/plain' })
        res.end('not found')
        return
      }
      res.writeHead(200, { 'Content-Type': 'video/mp4' })
      fs.createReadStream(tinyVideoPath).pipe(res)
    })
    await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
    baseUrl = 'http://127.0.0.1:' + server.address().port + '/video.mp4'
  })

  afterAll(() => {
    if (server) server.close()
    if (tinyVideoPath) { try { fs.unlinkSync(tinyVideoPath) } catch (_) { /* 清理失败可忽略 */ } }
  })
  const skipIfNoMedia = () => { if (!mediaAvailable) return true; return false }

  function makeBlendPipeline(aiGenerator, assetGenerator) {
    const stageExecutor = makeStageExecutor()
    const pipeline = {
      stageExecutor,
      _assetGenerator: assetGenerator || null,
      aiGenerator,
      log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
      registerStageExecutor(type, fn) { stageExecutor.register(type, fn); return { success: true } },
    }
    registerStory2VideoStages(pipeline)
    const executor = stageExecutor.executors.get(STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS)
    executor.__log = pipeline.log
    return executor
  }

  it('视频场景产出 videoPath 且不生成图片；图片场景照常；TTS 全部生成', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-1' } }
      if (method === 'getVideoStatus') return { videoUrl: baseUrl }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video'
          ? { id: 'kling', models: ['kling-v1'] }
          : { id: 'openai', models: ['gpt-4.1-mini'] }),
        callAdapter,
      },
    }
    const fn = makeBlendPipeline(aiGenerator)
    const context = {
      split: [{ text: '一' }, { text: '二' }],
      optimize: ['video-prompt-0', 'image-prompt-1'],
      video_plan: {
        mode: 'fixed',
        scenes: [
          { index: 0, useVideo: true, seconds: 6 },
          { index: 1, useVideo: false, seconds: 6 },
        ],
        selectedCount: 1,
      },
    }
    const serviceBus = {
      optimizeVideoPrompt: vi.fn(async (prompt) => ({ optimized_prompt: prompt })),
      generateTTS: vi.fn(async (text) => ({ code: 0, data: { path: 'audio-' + text + '.mp3', duration: 2 } })),
      callPythonSkill: vi.fn(async (_skill, payload) => {
        if (payload && payload.style) return { code: 0, data: { path: 'image-' + payload.index + '.png' } }
        return { code: 0, data: { path: 'audio-' + (payload && payload.text) + '.mp3', duration: 2 } }
      }),
    }
    const result = await fn({
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: 'kling-v1', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus,
    })
    expect(result.success).toBe(true)
    expect(result.output.scenes).toHaveLength(2)
    expect(result.output.scenes[0]).toMatchObject({ index: 0, videoPath: expect.stringContaining('scene_video_000.mp4'), audioPath: expect.any(String) })
    expect(result.output.scenes[0].imagePath).toBeNull()
    expect(result.output.scenes[1]).toMatchObject({ index: 1, imagePath: 'image-1.png', videoPath: null })
    // 视频 provider 只被调用（提交+轮询各 1 次）
    expect(callAdapter).toHaveBeenCalledWith('kling', 'generateVideo', expect.objectContaining({ width: 720, height: 1280, prompt: 'video-prompt-0' }))
    expect(callAdapter).toHaveBeenCalledWith('kling', 'getVideoStatus', expect.objectContaining({ taskId: 'task-1' }))
    // 进度：图片 1/1 · 视频 1/1 · 旁白 2/2
    expect(context.assets_progress).toEqual({
      imagesDone: 1, imagesTotal: 1, videosDone: 1, videosTotal: 1, ttsDone: 2, ttsTotal: 2,
    })
    expect(result.output.videos).toHaveLength(1)
    expect(result.output.videos[0]).toMatchObject({ index: 0, path: expect.stringContaining('scene_video_000.mp4') })
  })

  it('视频场景提示词经视频优化引擎改写后提交 generateVideo（不再直接复用图片提示词）', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-opt' } }
      if (method === 'getVideoStatus') return { videoUrl: baseUrl }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video'
          ? { id: 'kling', models: ['kling-v1'] }
          : { id: 'openai', models: ['gpt-4.1-mini'] }),
        callAdapter,
      },
    }
    const fn = makeBlendPipeline(aiGenerator)
    const context = {
      split: [{ text: '一' }],
      optimize: ['image-optimized-prompt-0'],
      video_plan: { mode: 'fixed', scenes: [{ index: 0, useVideo: true, seconds: 6 }], selectedCount: 1 },
    }
    const optimizeVideoPrompt = vi.fn(async (prompt) => ({ optimized_prompt: '[video-opt] ' + prompt }))
    const result = await fn({
      runId: 'run_blend',
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: 'kling-v1', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: {
        optimizeVideoPrompt,
        generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
        callPythonSkill: vi.fn(async (_skill, payload) => ({ code: 0, data: { path: 'img-' + payload.index + '.png' } })),
      },
    })
    expect(result.output.scenes[0]).toMatchObject({ index: 0, videoPath: expect.stringContaining('scene_video_000.mp4') })
    expect(result.success).toBe(true)
    expect(optimizeVideoPrompt).toHaveBeenCalledWith('image-optimized-prompt-0', expect.objectContaining({ platform: 'kling', traceId: 'run_blend' }))
    expect(callAdapter).toHaveBeenCalledWith('kling', 'generateVideo', expect.objectContaining({ prompt: '[video-opt] image-optimized-prompt-0' }))
  })

  it('跨镜承接：视频场景按场景顺序串行优化，prev_final_frame 链式透传并回写 final_frame（Round3 B）', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-chain' } }
      if (method === 'getVideoStatus') return { videoUrl: baseUrl }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video'
          ? { id: 'kling', models: ['kling-v1'] }
          : { id: 'openai', models: ['gpt-4.1-mini'] }),
        callAdapter,
      },
    }
    const fn = makeBlendPipeline(aiGenerator)
    const context = {
      split: [{ text: '一' }, { text: '二' }],
      optimize: ['video-prompt-0', 'video-prompt-1'],
      video_plan: {
        mode: 'fixed',
        scenes: [
          { index: 0, useVideo: true, seconds: 6 },
          { index: 1, useVideo: true, seconds: 6 },
        ],
        selectedCount: 2,
      },
    }
    let releaseFirst
    const firstGate = new Promise((resolve) => { releaseFirst = resolve })
    let firstStarted = false
    const optimizeVideoPrompt = vi.fn(async (prompt) => {
      if (!firstStarted) {
        firstStarted = true
        await firstGate
      }
      const index = prompt.endsWith('1') ? 1 : 0
      return { optimized_prompt: '[video-opt] ' + prompt, video: { final_frame: 'end-' + index } }
    })
    const runPromise = fn({
      runId: 'run_chain',
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: 'kling-v1', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: {
        optimizeVideoPrompt,
        generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
        callPythonSkill: vi.fn(async (_skill, payload) => ({ code: 0, data: { path: 'img-' + payload.index + '.png' } })),
      },
    })
    // 第一次优化被 gate 卡住：第二个场景的优化不得开始（串行链）
    await new Promise((resolve) => setTimeout(resolve, 300))
    expect(optimizeVideoPrompt).toHaveBeenCalledTimes(1)
    releaseFirst()
    const result = await runPromise
    expect(result.success).toBe(true)
    expect(optimizeVideoPrompt).toHaveBeenCalledTimes(2)
    // 首场景无 prev_final_frame；次场景携带上一镜 final_frame
    expect(optimizeVideoPrompt.mock.calls[0][1]).not.toHaveProperty('prev_final_frame')
    expect(optimizeVideoPrompt).toHaveBeenNthCalledWith(2, 'video-prompt-1', expect.objectContaining({ prev_final_frame: 'end-0' }))
    // 终态回写 scenes[index].video.final_frame 供后续镜承接
    expect(context.split[0].video.final_frame).toBe('end-0')
    expect(context.split[1].video.final_frame).toBe('end-1')
    // 生成提交使用预优化提示词
    expect(callAdapter).toHaveBeenCalledWith('kling', 'generateVideo', expect.objectContaining({ prompt: '[video-opt] video-prompt-0' }))
    expect(callAdapter).toHaveBeenCalledWith('kling', 'generateVideo', expect.objectContaining({ prompt: '[video-opt] video-prompt-1' }))
    expect(result.output.scenes).toHaveLength(2)
    expect(result.output.scenes[0].videoMeta.continuity).toMatchObject({
      mode: 'planned_final_frame',
      status: 'active',
      finalFrame: 'end-0',
    })
    expect(result.output.scenes[1].videoMeta.continuity).toMatchObject({
      mode: 'planned_final_frame',
      status: 'active',
      finalFrame: 'end-1',
    })
  })
  it('视频提示词优化失败时该场景回退图片轮播，不中断整条流水线', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async () => ({ code: 0 }))
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video' ? { id: 'kling', models: ['kling-v1'] } : { id: 'openai', models: ['x'] }),
        callAdapter,
      },
    }
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: 'img-' + index + '.png' } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
    }
    const fn = makeBlendPipeline(aiGenerator, assetGenerator)
    const context = {
      split: [{ text: '一' }],
      optimize: ['p0'],
      video_plan: { mode: 'fixed', scenes: [{ index: 0, useVideo: true, seconds: 6 }], selectedCount: 1 },
    }
    const result = await fn({
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: '', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: { optimizeVideoPrompt: vi.fn(async () => { throw new Error('prompt-engine 未运行') }) },
    })
    expect(result.success).toBe(true)
    expect(assetGenerator.generateImage).toHaveBeenCalled()
    expect(result.output.scenes[0]).toMatchObject({ index: 0, imagePath: 'img-0.png', videoPath: null })
  })

  it('视频生成失败时回退图片轮播（补生成图片）', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: -1, message: 'provider 欠费' }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn(() => ({ id: 'kling', models: ['kling-v1'] })),
        callAdapter,
      },
    }
    const fn = makeBlendPipeline(aiGenerator)
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: 'fallback-image-' + index + '.png' } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'audio-' + index + '.mp3', duration: 2 } })),
    }
    const context = {
      split: [{ text: '一' }, { text: '二' }],
      optimize: ['p0', 'p1'],
      video_plan: { mode: 'fixed', scenes: [{ index: 0, useVideo: true, seconds: 6 }, { index: 1, useVideo: false, seconds: 6 }], selectedCount: 1 },
    }
    const result = await fn({
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: '' } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: { optimizeVideoPrompt: vi.fn(async (prompt) => ({ optimized_prompt: prompt })) },
    })
    // 无 assetGenerator → legacy python 路径：图片经 serviceBus.callPythonSkill('generate_image')
    expect(result.success).toBe(false) // serviceBus 未提供 generate_image → 场景生成失败
    expect(result.error).toContain('Asset scene generation failed')
  })
  it('getVideoStatus 返回错误响应时立即终止（不空转 10 分钟）', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-err' } }
      if (method === 'getVideoStatus') return { code: -1, message: 'provider 任务失败' }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video' ? { id: 'kling', models: ['kling-v1'] } : { id: 'openai', models: ['x'] }),
        callAdapter,
      },
    }
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: 'img-' + index + '.png' } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
    }
    const fn = makeBlendPipeline(aiGenerator, assetGenerator)
    // 直接调用 generateSceneVideo 验证错误终止
    const { generateSceneVideo } = require('./story2video-stages')
    const outcome = await generateSceneVideo({
      manager: aiGenerator._modelProviderManager,
      providerId: 'kling',
      model: 'kling-v1',
      prompt: 'p',
      index: 0,
      seconds: 6,
      size: { width: 720, height: 1280 },
      fps: 24,
      runDir: path.join(os.tmpdir(), 'story2video-video-err-test-' + process.pid),
      pollIntervalMs: 5,
    })
    expect(outcome.success).toBe(false)
    expect(outcome.error).toContain('provider 任务失败')
    // 图片回退路径仍可用（assetGenerator 被调用）
    const context = {
      split: [{ text: '一' }],
      optimize: ['p0'],
      video_plan: { mode: 'fixed', scenes: [{ index: 0, useVideo: true, seconds: 6 }], selectedCount: 1 },
    }
    const result = await fn({
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: '', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: { optimizeVideoPrompt: vi.fn(async (prompt) => ({ optimized_prompt: prompt })) },
    })
    expect(result.success).toBe(true)
    expect(assetGenerator.generateImage).toHaveBeenCalled()
    expect(result.output.scenes[0]).toMatchObject({ index: 0, imagePath: 'img-0.png', videoPath: null })
  })

  it('视频下载 HTTP 非 200 时视为失败并回退图片', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-404' } }
      if (method === 'getVideoStatus') return { videoUrl: 'http://127.0.0.1:' + server.address().port + '/missing.mp4' }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video' ? { id: 'kling', models: ['kling-v1'] } : { id: 'openai', models: ['x'] }),
        callAdapter,
      },
    }
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: 'img-' + index + '.png' } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
    }
    const fn = makeBlendPipeline(aiGenerator, assetGenerator)
    const context = {
      split: [{ text: '一' }],
      optimize: ['p0'],
      video_plan: { mode: 'fixed', scenes: [{ index: 0, useVideo: true, seconds: 6 }], selectedCount: 1 },
    }
    const result = await fn({
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: '', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: { optimizeVideoPrompt: vi.fn(async (prompt) => ({ optimized_prompt: prompt })) },
    })
    expect(result.success).toBe(true)
    expect(assetGenerator.generateImage).toHaveBeenCalled()
    expect(result.output.scenes[0]).toMatchObject({ index: 0, imagePath: 'img-0.png', videoPath: null })
  })

  it('resume 续跑时跨镜链初值从已回写 final_frame 的场景恢复（评审 W1）', async () => {
    if (skipIfNoMedia()) return
    // 上轮已完成的场景 0/1（视频产物存在，final_frame 已回写）→ 本轮仅优化场景 2，且承接 end-1
    const resumeDir = fs.mkdtempSync(path.join(STORY2VIDEO_TEMP_DIR, 's2v-resume-chain-'))
    const resumeVideos = ['v0.mp4', 'v1.mp4'].map(name => {
      const p = path.join(resumeDir, name)
      fs.writeFileSync(p, 'resumed')
      return p
    })
    const resumeVideoRealPaths = resumeVideos.map((filePath) => fs.realpathSync.native(filePath))
    const resumeAudios = ['a0.mp3', 'a1.mp3'].map(name => {
      const p = path.join(resumeDir, name)
      fs.writeFileSync(p, 'resumed audio')
      return p
    })
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-resume' } }
      if (method === 'getVideoStatus') return { videoUrl: baseUrl }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video' ? { id: 'kling', models: ['kling-v1'] } : { id: 'openai', models: ['gpt-4.1-mini'] }),
        callAdapter,
      },
    }
    const fn = makeBlendPipeline(aiGenerator)
    const context = {
      split: [
        { text: '一', video: { final_frame: 'end-0' } },
        { text: '二', video: { final_frame: 'end-1-stale' } },
        // 评审 W1-1 场景 B：旧回写残留（上轮优化成功但视频生成失败）不得作为链种子
        { text: '三', video: { final_frame: 'end-2-old' } },
      ],
      optimize: ['p0', 'p1', 'video-prompt-2'],
      video_plan: { mode: 'fixed', scenes: [
        { index: 0, useVideo: true, seconds: 6 },
        { index: 1, useVideo: true, seconds: 6 },
        { index: 2, useVideo: true, seconds: 6 },
      ], selectedCount: 3 },
      generate_assets: { resume: { completed: [
        { index: 0, videoPath: resumeVideos[0], audioPath: resumeAudios[0], duration: 2 },
        { index: 1, videoPath: resumeVideos[1], audioPath: resumeAudios[1], duration: 2, final_frame: 'checkpoint-end-1' },
      ] } },
    }
    const optimizeVideoPrompt = vi.fn(async (prompt) => ({ optimized_prompt: '[video-opt] ' + prompt, video: { final_frame: 'end-2' } }))
    const result = await fn({
      runId: 'run_resume_chain',
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: 'kling-v1', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: {
        optimizeVideoPrompt,
        generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
        callPythonSkill: vi.fn(async (_skill, payload) => ({ code: 0, data: { path: 'img-' + payload.index + '.png' } })),
      },
    })
    try { fs.rmSync(resumeDir, { recursive: true, force: true }) } catch (_) { /* 清理失败可忽略 */ }
    expect(result.success).toBe(true)
    // 仅场景 2 触发优化，且链初值恢复自场景 1 的 final_frame（正向扫描仅采纳本轮跳过场景）
    expect(optimizeVideoPrompt).toHaveBeenCalledTimes(1)
    expect(optimizeVideoPrompt).toHaveBeenCalledWith('video-prompt-2', expect.objectContaining({ prev_final_frame: 'checkpoint-end-1' }))
    // 场景 0/1 复用续跑产物；场景 2 生成新视频
    expect(result.output.scenes[0]).toMatchObject({
      index: 0,
      videoPath: resumeVideoRealPaths[0],
    })
    expect(result.output.scenes[1]).toMatchObject({
      index: 1,
      videoPath: resumeVideoRealPaths[1],
    })
    expect(result.output.scenes[2]).toMatchObject({ index: 2, videoPath: expect.stringContaining('scene_video_002.mp4') })
    expect(result.output.scenes[1].videoMeta.continuity).toMatchObject({
      mode: 'planned_final_frame',
      status: 'active',
      finalFrame: 'checkpoint-end-1',
      finalFrameSource: 'resume:checkpoint.final_frame',
    })
  })

  it('resume 续跑时复用已完成视频，并让未完成视频使用当前 provider/model', async () => {
    if (skipIfNoMedia()) return
    const resumeDir = fs.mkdtempSync(path.join(STORY2VIDEO_TEMP_DIR, 's2v-resume-video-model-'))
    const resumedVideo = path.join(resumeDir, 'scene-0.mp4')
    fs.writeFileSync(resumedVideo, 'resumed')
    const resumedVideoRealPath = fs.realpathSync.native(resumedVideo)
    const calls = []
    const callAdapter = vi.fn(async (provider, method, payload) => {
      calls.push({ provider, method, payload })
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-current-model' } }
      if (method === 'getVideoStatus') return { videoUrl: baseUrl }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video'
          ? { id: 'current-video', models: ['video-current-model'] }
          : { id: 'current-llm', models: ['llm-current-model'] }),
        callAdapter,
      },
    }
    const fn = makeBlendPipeline(aiGenerator)
    const context = {
      split: [{ text: '已完成视频' }, { text: '待恢复视频' }],
      optimize: ['old-prompt-0', 'new-prompt-1'],
      video_plan: {
        mode: 'fixed',
        provider: 'old-video',
        model: 'old-video-model',
        scenes: [
          { index: 0, useVideo: true, seconds: 6 },
          { index: 1, useVideo: true, seconds: 6 },
        ],
        selectedCount: 2,
      },
      generate_assets: { resume: { completed: [{ index: 0, videoPath: resumedVideo, audioPath: 'audio-0.mp3', duration: 2 }] } },
    }
    try {
      const result = await fn({
        runId: 'run_resume_video_model',
        stage: { options: { videoMode: 'fixed', video: { provider: 'old-video', model: 'old-video-model', pollIntervalMs: 5 } } },
        params: { __resumeUseCurrentModels: true, videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
        context,
        serviceBus: {
          optimizeVideoPrompt: vi.fn(async (prompt) => ({ optimized_prompt: prompt })),
          callPythonSkill: vi.fn(async (skill, payload) => skill === 'generate_tts'
            ? { code: 0, data: { path: 'audio-' + payload.index + '.mp3', duration: 2 } }
            : { code: 0, data: { path: 'image-' + payload.index + '.png' } }),
        },
      })

      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(result.output.scenes[0]).toMatchObject({
        index: 0,
        videoPath: resumedVideoRealPath,
      })
      expect(result.output.scenes[1]).toMatchObject({ index: 1, videoPath: expect.stringContaining('scene_video_001.mp4') })
      const videoSubmissions = calls.filter((call) => call.method === 'generateVideo')
      expect(videoSubmissions).toHaveLength(1)
      expect(videoSubmissions[0]).toMatchObject({
        provider: 'current-video',
        payload: expect.objectContaining({ model: 'video-current-model', prompt: 'new-prompt-1' }),
      })
    } finally {
      fs.rmSync(resumeDir, { recursive: true, force: true })
    }
  })
  it('全新运行带旧回写残留时首个待优化场景拿空链，后续镜按本轮链推进（评审 W1-1 场景 D）', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-fresh' } }
      if (method === 'getVideoStatus') return { videoUrl: baseUrl }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video' ? { id: 'kling', models: ['kling-v1'] } : { id: 'openai', models: ['gpt-4.1-mini'] }),
        callAdapter,
      },
    }
    const fn = makeBlendPipeline(aiGenerator)
    const context = {
      // 无 resume；split[0] 残留旧回写（上一轮运行遗留），本轮全新运行不得采纳
      split: [
        { text: '一', video: { final_frame: 'end-old-0' } },
        { text: '二' },
        { text: '三' },
      ],
      optimize: ['p0', 'p1', 'p2'],
      video_plan: { mode: 'fixed', scenes: [
        { index: 0, useVideo: true, seconds: 6 },
        { index: 1, useVideo: true, seconds: 6 },
        { index: 2, useVideo: true, seconds: 6 },
      ], selectedCount: 3 },
    }
    const optimizeVideoPrompt = vi.fn(async (prompt) => {
      const index = prompt.endsWith('1') ? 1 : (prompt.endsWith('2') ? 2 : 0)
      return { optimized_prompt: '[video-opt] ' + prompt, video: { final_frame: 'end-' + index } }
    })
    const result = await fn({
      runId: 'run_fresh',
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: 'kling-v1', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: {
        optimizeVideoPrompt,
        generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
        callPythonSkill: vi.fn(async (_skill, payload) => ({ code: 0, data: { path: 'img-' + payload.index + '.png' } })),
      },
    })
    expect(result.success).toBe(true)
    // 场景 0 不带 prev_final_frame（残留 end-old-0 被忽略）；场景 1/2 按本轮链推进
    expect(optimizeVideoPrompt.mock.calls[0][1]).not.toHaveProperty('prev_final_frame')
    expect(optimizeVideoPrompt).toHaveBeenNthCalledWith(2, 'p1', expect.objectContaining({ prev_final_frame: 'end-0' }))
    expect(optimizeVideoPrompt).toHaveBeenNthCalledWith(3, 'p2', expect.objectContaining({ prev_final_frame: 'end-1' }))
  })

  it('视频引擎未返回 final_frame 时告警跨镜承接未生效（评审 W5-1）', async () => {
    if (skipIfNoMedia()) return
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-noframe' } }
      if (method === 'getVideoStatus') return { videoUrl: baseUrl }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video' ? { id: 'kling', models: ['kling-v1'] } : { id: 'openai', models: ['gpt-4.1-mini'] }),
        callAdapter,
      },
    }
    const fn = makeBlendPipeline(aiGenerator)
    const context = {
      split: [{ text: '一' }],
      optimize: ['p0'],
      video_plan: { mode: 'fixed', scenes: [{ index: 0, useVideo: true, seconds: 6 }], selectedCount: 1 },
    }
    // 引擎只回优化提示词、无 video.final_frame（8013 兼容后端形态）→ 链从未建立也要告警
    const result = await fn({
      runId: 'run_noframe',
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: 'kling-v1', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: {
        optimizeVideoPrompt: vi.fn(async (prompt) => ({ optimized_prompt: '[video-opt] ' + prompt })),
        generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
        callPythonSkill: vi.fn(async (_skill, payload) => ({ code: 0, data: { path: 'img-' + payload.index + '.png' } })),
      },
    })
    expect(result.success).toBe(true)
    expect(result.output.scenes[0]).toMatchObject({ index: 0, videoPath: expect.stringContaining('scene_video_000.mp4') })
    expect(result.output.scenes[0].videoMeta.continuity).toMatchObject({
      mode: 'planned_final_frame',
      status: 'degraded',
      finalFrame: null,
      reason: 'missing_final_frame',
    })
    const warnCalls = fn.__log.warn.mock.calls.filter(c => String(c[1]).includes('跨镜承接'))
    expect(warnCalls.length).toBeGreaterThan(0)
  })


  it('图片/旁白与视频并行启动：视频轮询未完成时，非视频场景图片与全部 TTS 已开始生成（2026-08-13 优化）', async () => {
    if (skipIfNoMedia()) return
    let releaseVideo
    const videoGate = new Promise((resolve) => { releaseVideo = resolve })
    const callAdapter = vi.fn(async (_provider, method) => {
      if (method === 'generateVideo') return { code: 0, data: { taskId: 'task-slow' } }
      if (method === 'getVideoStatus') { await videoGate; return { videoUrl: baseUrl } }
      return { code: 0 }
    })
    const aiGenerator = {
      _modelProviderManager: {
        getDefault: vi.fn((type) => type === 'video' ? { id: 'kling', models: ['kling-v1'] } : { id: 'openai', models: ['gpt-4.1-mini'] }),
        callAdapter,
      },
    }
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: 'img-' + index + '.png' } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'aud-' + index + '.mp3', duration: 2 } })),
    }
    const fn = makeBlendPipeline(aiGenerator, assetGenerator)
    const context = {
      split: [{ text: '一' }, { text: '二' }, { text: '三' }],
      optimize: ['video-p0', 'p1', 'p2'],
      video_plan: { mode: 'fixed', scenes: [{ index: 0, useVideo: true, seconds: 6 }], selectedCount: 1 },
    }
    const runPromise = fn({
      stage: { options: { videoMode: 'fixed', video: { provider: 'kling', model: 'kling-v1', pollIntervalMs: 5 } } },
      params: { videoMode: 'fixed', aspectRatio: '9:16', fps: 30 },
      context,
      serviceBus: { optimizeVideoPrompt: vi.fn(async (prompt) => ({ optimized_prompt: prompt })) },
    })
    // 视频被 gate 卡住：断言非视频场景图片（场景 1/2）与全部 TTS（3 条）已开始生成
    await new Promise((resolve) => setTimeout(resolve, 500))
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(2)
    expect(assetGenerator.generateTTS).toHaveBeenCalledTimes(3)
    // 进度：视频 0 但图片/旁白已推进
    expect(context.assets_progress.videosDone).toBe(0)
    expect(context.assets_progress.videosTotal).toBe(1)
    expect(context.assets_progress.imagesDone).toBeGreaterThan(0)
    expect(context.assets_progress.ttsDone).toBeGreaterThan(0)
    // 放行视频，等待整阶段完成
    releaseVideo()
    const result = await runPromise
    expect(result.success).toBe(true)
    expect(result.output.scenes[0]).toMatchObject({ index: 0, videoPath: expect.stringContaining('scene_video_000.mp4') })
    expect(result.output.scenes).toHaveLength(3)
    expect(context.assets_progress.videosDone).toBe(1)
    expect(context.assets_progress.imagesTotal).toBe(2)
    expect(context.assets_progress.imagesDone).toBe(2)
    expect(context.assets_progress.ttsDone).toBe(3)
  })
})

describe('story2video 场景上下文增强中间层（scene_context，2026-08-11）', () => {
  const TANG_FULL_TEXT = '这是一个关于中国唐代的故事。唐玄宗时期，长安城一片繁华。故事讲述一位老妇人在长安城中的日常生活与劳作。'
  const TANG_COOKING_SCENE = '一个老妇人在做饭'

  it('scene_context 阶段已注册', () => {
    const pipeline = makePipeline(null)
    expect(pipeline.sceneContextExecutor).toBeTypeOf('function')
  })

  it('唐代全文 + 「一个老妇人在做饭」场景 → 逐场景上下文块含唐代/中国/土灶锚点与时代负面锚点', async () => {
    const fn = makePipeline(null).sceneContextExecutor
    const result = await fn({
      stage: { options: {} },
      params: { text: TANG_FULL_TEXT },
      context: {
        split: { scenes: [{ index: 0, text: TANG_COOKING_SCENE }] },
      },
    })
    expect(result.success).toBe(true)
    const output = result.output
    expect(output.story.dynasty).toMatchObject({ name: '唐朝', period: '唐朝（618-907）' })
    expect(output.story.culture).toBe('中国')
    expect(output.metadata).toMatchObject({ enriched: true, degraded: false })
    expect(output.scenes).toHaveLength(1)
    const scene = output.scenes[0]
    expect(scene.storyContext).toContain('唐朝')
    expect(scene.storyContext).toContain('中国')
    expect(scene.storyContext).toContain('做饭')
    expect(scene.storyContext).toContain('土灶')
    expect(scene.storyContext).toContain('柴火')
    expect(scene.negativeAnchors).toEqual(expect.arrayContaining(['电烤箱', '微波炉', '西式现代厨房']))
    expect(scene.character).toMatchObject({ name: '老妇人' })
  })

  it('无全文（图片/音频模式）降级透传，不阻断流水线', async () => {
    const fn = makePipeline(null).sceneContextExecutor
    const result = await fn({
      stage: { options: {} },
      params: { text: '', inputMode: 'images' },
      context: {
        split: { scenes: [{ index: 0, text: '图片 1', sourceImage: { path: '/tmp/a.png' } }] },
      },
    })
    expect(result.success).toBe(true)
    expect(result.output.metadata.degraded).toBe(true)
    expect(result.output.scenes).toHaveLength(1)
  })

  it('空场景数组 fail closed', async () => {
    const fn = makePipeline(null).sceneContextExecutor
    const result = await fn({
      stage: { options: {} },
      params: { text: TANG_FULL_TEXT },
      context: { split: { scenes: [] } },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('非空场景数组')
  })

  it('optimize 优先消费 scene_context：请求 context 使用逐场景上下文块，负面锚点合并进 negative_prompt', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const sceneContextResult = await makePipeline(null).sceneContextExecutor({
      stage: { options: { quality_baseline: false } },
      params: { text: TANG_FULL_TEXT },
      context: { split: { scenes: [{ index: 0, text: TANG_COOKING_SCENE }] } },
    })
    const result = await fn({
      stage: { options: { negative_prompt: '水印' } },
      params: {},
      context: { scene_context: sceneContextResult.output },
      serviceBus,
    })
    expect(result.success).toBe(true)
    expect(serviceBus.calls).toHaveLength(1)
    const call = serviceBus.calls[0]
    expect(call.options.context).toMatchObject({
      synopsis: expect.stringContaining('唐代'),
      full_text: expect.stringContaining('唐代'),
      setting: expect.stringContaining('做饭'),
    })
    expect(call.options.context.character).toMatchObject({ name: '老妇人' })
    // 用户 negative_prompt 与场景负面锚点合并
    expect(call.options.negative_prompt).toContain('水印')
    expect(call.options.negative_prompt).toContain('电烤箱')
  })

  it('optimize 在无 scene_context 时回退 buildOptimizeContext，保持旧行为兼容', async () => {
    const fn = makePipeline(null).optimizeExecutor
    const serviceBus = makeOptimizeBus()
    const result = await fn({
      stage: { options: { quality_baseline: false, context: '角色一致性' } },
      params: {},
      context: { split: [{ text: '一个老妇人在做饭' }] },
      serviceBus,
    })
    expect(result.success).toBe(true)
    expect(serviceBus.calls[0].options.context).toMatchObject({ synopsis: '角色一致性', full_text: '一个老妇人在做饭' })
  })

// ==================== translatePromptsForLocale 回归测试 ====================
describe('translatePromptsForLocale', () => {
  function makeAiGenerator(responseContent) {
    return {
      generateWithDefault: vi.fn().mockResolvedValue({ content: responseContent }),
    }
  }

  it('正常 JSON 解析 — 提取翻译文本', async () => {
    const ai = makeAiGenerator('{"0":"一个红苹果","1":"一片蓝天"}')
    const items = await translatePromptsForLocale(ai, ['A red apple', 'A blue sky'], 'zh', console)
    expect(items[0].translation).toBe('一个红苹果')
    expect(items[1].translation).toBe('一片蓝天')
  })

  it('markdown 代码块包裹的 JSON 也能正确解析', async () => {
    const ai = makeAiGenerator('```json\n{"0":"一个红苹果","1":"一片蓝天"}\n```')
    const items = await translatePromptsForLocale(ai, ['A red apple', 'A blue sky'], 'zh', console)
    expect(items[0].translation).toBe('一个红苹果')
    expect(items[1].translation).toBe('一片蓝天')
  })

  it('不带语言标签的代码块也能正确解析', async () => {
    const ai = makeAiGenerator('```\n{"0":"翻译一"}\n```')
    const items = await translatePromptsForLocale(ai, ['prompt one'], 'zh', console)
    expect(items[0].translation).toBe('翻译一')
  })

  it('逐行回退：json 标记不应作为译文', async () => {
    // LLM 返回了代码块但 JSON.parse 失败的场景（模拟回退路径）
    // 实际场景：```json\n{...}\n``` 剥离后 parse 成功，这里测试回退路径本身的防御
    const ai = {
      generateWithDefault: vi.fn().mockResolvedValue({ content: 'json\n{"0":"一个红苹果"}' }),
    }
    const items = await translatePromptsForLocale(ai, ['A red apple'], 'zh', console)
    // 'json' 应被过滤，不应成为译文
    expect(items[0].translation).not.toBe('json')
  })

  it('逐行回退：JSON 对象文本不应作为译文', async () => {
    const ai = {
      generateWithDefault: vi.fn().mockResolvedValue({ content: '{"0":"一个红苹果","1":"一片蓝天"}' }),
    }
    // 当 LLM 返回的不是合法 JSON（如缺少引号），回退到逐行解析
    const items = await translatePromptsForLocale(ai, ['A red apple', 'A blue sky'], 'zh', console)
    // JSON 对象文本不应直接成为译文
    for (const item of items) {
      if (typeof item.translation === 'string') {
        expect(item.translation).not.toMatch(/^\{["']\d/)
      }
    }
  })

  it('aiGenerator 不可用时跳过翻译', async () => {
    const items = await translatePromptsForLocale(null, ['A red apple'], 'zh', console)
    expect(items[0].translation).toBeNull()
  })

  it('空提示词列表不报错', async () => {
    const ai = makeAiGenerator('{}')
    const items = await translatePromptsForLocale(ai, [], 'zh', console)
    expect(items).toEqual([])
  })

  it('HTML 闭合标签包裹的 JSON 也能正确解析', async () => {
    const ai = makeAiGenerator('<response>{"0":"一个红苹果","1":"一片蓝天"}</response>')
    const items = await translatePromptsForLocale(ai, ['A red apple', 'A blue sky'], 'zh', console)
    expect(items[0].translation).toBe('一个红苹果')
    expect(items[1].translation).toBe('一片蓝天')
  })

  it('带前导 HTML 标签/思考文本的 JSON 也能正确解析', async () => {
    const ai = makeAiGenerator('<thinking>let me translate</thinking>{"0":"一个红苹果","1":"一片蓝天"}')
    const items = await translatePromptsForLocale(ai, ['A red apple', 'A blue sky'], 'zh', console)
    expect(items[0].translation).toBe('一个红苹果')
    expect(items[1].translation).toBe('一片蓝天')
  })

  it('marker 协议包裹（前后说明文字）的 JSON 也能正确解析', async () => {
    const ai = makeAiGenerator('以下是译文：\n{"0":"一个红苹果","1":"一片蓝天"}\n完毕')
    const items = await translatePromptsForLocale(ai, ['A red apple', 'A blue sky'], 'zh', console)
    expect(items[0].translation).toBe('一个红苹果')
    expect(items[1].translation).toBe('一片蓝天')
  })

  it('JSON 值含花括号与转义引号时仍正确解析', async () => {
    const ai = makeAiGenerator('{"0":"译文 {备注} \\"引号\\"","1":"一片蓝天"}')
    const items = await translatePromptsForLocale(ai, ['A red apple', 'A blue sky'], 'zh', console)
    expect(items[0].translation).toBe('译文 {备注} "引号"')
    expect(items[1].translation).toBe('一片蓝天')
  })

  it('说明文字含未闭合花括号时不干扰真实 JSON', async () => {
    const ai = makeAiGenerator('注意 {没有闭合 {"0":"真实译文"}')
    const items = await translatePromptsForLocale(ai, ['A red apple'], 'zh', console)
    expect(items[0].translation).toBe('真实译文')
  })

  it('LLM 回显示例后返回真实 JSON 时取最终对象', async () => {
    const ai = makeAiGenerator('例如 {"0":"示例译文"} 请返回 {"0":"真实译文"}')
    const items = await translatePromptsForLocale(ai, ['A red apple'], 'zh', console)
    expect(items[0].translation).toBe('真实译文')
  })
})

describe('提示词翻译与 compose 并行契约', () => {
  it('自动模式 optimize 只登记可序列化 pending，不提前调用翻译 LLM', async () => {
    const aiGenerator = { generateWithDefault: vi.fn() }
    const pipeline = makePipeline(null, aiGenerator)
    const optimize = pipeline.optimizeExecutor
    const serviceBus = makeOptimizeBus(() => ({ optimized_prompt: 'A red apple' }))
    const context = { split: [{ text: '红苹果' }] }
    const result = await optimize({
      runId: 'translation-auto-pending',
      stage: { options: {} },
      params: { creationMode: 'auto', uiLocale: 'zh' },
      context,
      serviceBus,
    })
    expect(result.success).toBe(true)
    expect(context.prompt_translations_pending).toEqual({
      uiLocale: 'zh',
        items: [{ index: 0, prompt: 'A red apple', translation: null }],
    })
    expect(context.prompt_translations).toBeUndefined()
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('英文或空白 locale 不创建翻译任务', async () => {
    const aiGenerator = { generateWithDefault: vi.fn() }
    const pipeline = makePipeline(null, aiGenerator)
    const optimize = pipeline.optimizeExecutor
    const serviceBus = makeOptimizeBus(() => ({ optimized_prompt: 'A red apple' }))
    for (const creationMode of ['auto', 'manual']) {
      for (const uiLocale of ['en', '   ']) {
      const context = { split: [{ text: '红苹果' }] }
      const result = await optimize({
        stage: { options: {} },
        params: { creationMode, uiLocale },
        context,
        serviceBus,
      })
      expect(result.success).toBe(true)
      expect(context.prompt_translations_pending).toBeUndefined()
      }
    }
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('手动模式 optimize 也只登记可序列化 pending，不提前调用翻译 LLM', async () => {
    const aiGenerator = { generateWithDefault: vi.fn() }
    const pipeline = makePipeline(null, aiGenerator)
    const optimize = pipeline.optimizeExecutor
    const serviceBus = makeOptimizeBus(() => ({ optimized_prompt: 'A red apple' }))
    const context = { split: [{ text: '红苹果' }] }
    const result = await optimize({
      stage: { options: {} },
      params: { creationMode: 'manual', uiLocale: 'zh' },
      context,
      serviceBus,
    })
    expect(result.success).toBe(true)
    expect(context.prompt_translations_pending).toEqual({
      uiLocale: 'zh',
      items: [{ index: 0, prompt: 'A red apple', translation: null }],
    })
    expect(context.prompt_translations).toBeUndefined()
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('真实 StageExecutor 注册翻译任务，compose 完成后按 scene index 回填', async () => {
    const serviceBus = {
      composeVideo: vi.fn(async () => ({
        code: 0,
        data: {
          videoPath: 'video.mp4',
          segments: [{ index: 1, prompt: 'p1' }, { index: 0, prompt: 'p0' }],
        },
      })),
    }
    const stageExecutor = new StageExecutor({ serviceBus, log: { info() {}, warn() {}, error() {} } })
    const pipeline = {
      stageExecutor,
      aiGenerator: {
        generateWithDefault: vi.fn().mockResolvedValue({ content: '{"0":"译文0","1":"译文1"}' }),
      },
      log: { info() {}, warn() {}, error() {} },
      registerStageExecutor(type, fn) { return stageExecutor.register(type, fn) || { success: true } },
    }
    registerStory2VideoStages(pipeline)
    const context = {
      generate_assets: { scenes: [{ index: 0 }, { index: 1 }] },
      prompt_translations_pending: {
        uiLocale: 'zh',
        items: [{ index: 0, prompt: 'p0' }, { index: 1, prompt: 'p1' }],
      },
    }
    const result = await stageExecutor.execute({
      runId: 'translation-compose-real-hook',
      stage: {
        name: 'compose',
        type: STAGE_TYPES.COMPOSE,
        inputFrom: 'generate_assets',
        options: { composeParallelTask: 'story2video_prompt_translation_compose' },
      },
      params: {},
      context,
    })
    expect(result.success).toBe(true)
    expect(result.output.segments).toEqual([
      { index: 1, prompt: 'p1', promptTranslation: '译文1' },
      { index: 0, prompt: 'p0', promptTranslation: '译文0' },
    ])
    expect(context.generate_assets.scenes.map((scene) => scene.promptTranslation)).toEqual(['译文0', '译文1'])
    expect(context.prompt_translations_pending).toBeUndefined()
    expect(context.prompt_translations.items.map((item) => item.translation)).toEqual(['译文0', '译文1'])
  })

  it('手动模式 compose 只补写翻译，不覆盖候选、选择和已选媒体', async () => {
    const serviceBus = {
      composeVideo: vi.fn(async () => ({
        code: 0,
        data: {
          videoPath: 'manual-video.mp4',
          segments: [{ index: 0, prompt: 'manual-prompt' }],
        },
      })),
    }
    const stageExecutor = new StageExecutor({ serviceBus, log: { info() {}, warn() {}, error() {} } })
    const pipeline = {
      stageExecutor,
      aiGenerator: {
        generateWithDefault: vi.fn().mockResolvedValue({ content: '{"0":"手动译文"}' }),
      },
      log: { info() {}, warn() {}, error() {} },
      registerStageExecutor(type, fn) { return stageExecutor.register(type, fn) || { success: true } },
    }
    registerStory2VideoStages(pipeline)
    const candidates = [{
      index: 0,
      prompt: 'manual-prompt',
      promptTranslation: null,
      candidates: [{ id: 'image-0', kind: 'image', path: 'selected.png' }],
    }]
    const selection = { selections: [{ index: 0, candidateId: 'image-0' }] }
    const context = {
      generate_assets: {
        candidates,
        selection,
        scenes: [{ index: 0, prompt: 'manual-prompt', imagePath: 'selected.png', audioPath: 'voice.mp3' }],
      },
      prompt_translations_pending: {
        uiLocale: 'zh',
        items: [{ index: 0, prompt: 'manual-prompt' }],
      },
      scene_asset_selection: selection,
    }
    const result = await stageExecutor.execute({
      runId: 'translation-manual-compose-preserve',
      stage: {
        name: 'compose',
        type: STAGE_TYPES.COMPOSE,
        inputFrom: 'generate_assets',
        options: { composeParallelTask: 'story2video_prompt_translation_compose' },
      },
      params: {},
      context,
    })
    expect(result.success).toBe(true)
    expect(result.output.segments[0].promptTranslation).toBe('手动译文')
    expect(context.generate_assets.scenes[0]).toMatchObject({
      index: 0,
      prompt: 'manual-prompt',
      promptTranslation: '手动译文',
      imagePath: 'selected.png',
      audioPath: 'voice.mp3',
    })
    expect(context.generate_assets.candidates).toEqual(candidates)
    expect(context.generate_assets.selection).toEqual(selection)
    expect(context.scene_asset_selection).toEqual(selection)
    expect(context.prompt_translations_pending).toBeUndefined()
  })

  it('手动模式 compose 在等待翻译时已启动视频合成', async () => {
    const events = []
    let resolveTranslation
    const translationResponse = new Promise((resolve) => { resolveTranslation = resolve })
    const serviceBus = {
      composeVideo: vi.fn(async () => {
        events.push('compose-start')
        expect(events).toEqual(['translation-start', 'compose-start'])
        resolveTranslation({ content: '{"0":"手动译文"}' })
        return { code: 0, data: { videoPath: 'overlap.mp4', segments: [{ index: 0, prompt: 'manual-prompt' }] } }
      }),
    }
    const stageExecutor = new StageExecutor({ serviceBus, log: { info() {}, warn() {}, error() {} } })
    const pipeline = {
      stageExecutor,
      aiGenerator: {
        generateWithDefault: vi.fn(() => {
          events.push('translation-start')
          return translationResponse
        }),
      },
      log: { info() {}, warn() {}, error() {} },
      registerStageExecutor(type, fn) { return stageExecutor.register(type, fn) || { success: true } },
    }
    registerStory2VideoStages(pipeline)
    const result = await stageExecutor.execute({
      runId: 'translation-manual-compose-overlap',
      stage: { name: 'compose', type: STAGE_TYPES.COMPOSE, options: { composeParallelTask: 'story2video_prompt_translation_compose' } },
      params: {},
      context: {
        generate_assets: { scenes: [{ index: 0, prompt: 'manual-prompt', imagePath: 'selected.png', audioPath: 'voice.mp3' }] },
        prompt_translations_pending: { uiLocale: 'zh', items: [{ index: 0, prompt: 'manual-prompt' }] },
      },
    })
    expect(result.success).toBe(true)
    expect(events).toEqual(['translation-start', 'compose-start'])
  })

  it('手动模式 compose 翻译失败时成片成功并保留手动素材状态', async () => {
    const serviceBus = {
      composeVideo: vi.fn(async () => ({
        code: 0,
        data: { videoPath: 'manual-fail-open.mp4', segments: [{ index: 0, prompt: 'manual-prompt' }] },
      })),
    }
    const stageExecutor = new StageExecutor({ serviceBus, log: { info() {}, warn() {}, error() {} } })
    const pipeline = {
      stageExecutor,
      aiGenerator: { generateWithDefault: vi.fn().mockRejectedValue(new Error('translation unavailable')) },
      log: { info() {}, warn() {}, error() {} },
      registerStageExecutor(type, fn) { return stageExecutor.register(type, fn) || { success: true } },
    }
    registerStory2VideoStages(pipeline)
    const candidates = [{ index: 0, candidates: [{ id: 'image-0', kind: 'image', path: 'selected.png' }] }]
    const selection = { selections: [{ index: 0, candidateId: 'image-0' }] }
    const context = {
      generate_assets: {
        candidates,
        selection,
        scenes: [{ index: 0, prompt: 'manual-prompt', imagePath: 'selected.png', audioPath: 'voice.mp3', promptTranslation: null }],
      },
      scene_asset_selection: selection,
      prompt_translations_pending: { uiLocale: 'zh', items: [{ index: 0, prompt: 'manual-prompt' }] },
    }
    const result = await stageExecutor.execute({
      runId: 'translation-manual-compose-fail-open',
      stage: { name: 'compose', type: STAGE_TYPES.COMPOSE, options: { composeParallelTask: 'story2video_prompt_translation_compose' } },
      params: {},
      context,
    })
    expect(result.success).toBe(true)
    expect(result.output.videoPath).toBe('manual-fail-open.mp4')
    expect(context.generate_assets.candidates).toEqual(candidates)
    expect(context.generate_assets.selection).toEqual(selection)
    expect(context.scene_asset_selection).toEqual(selection)
    expect(context.generate_assets.scenes[0]).toMatchObject({
      index: 0,
      prompt: 'manual-prompt',
      promptTranslation: null,
      imagePath: 'selected.png',
      audioPath: 'voice.mp3',
    })
    expect(context.prompt_translations_pending.items[0].translation).toBeNull()
    expect(context.prompt_translation_diagnostic.degraded).toBe(true)
  })

  it('手动模式 compose 复用匹配的已有译文，不重复请求 LLM', async () => {
    const serviceBus = {
      composeVideo: vi.fn(async () => ({ code: 0, data: { videoPath: 'reused.mp4', segments: [{ index: 0, prompt: 'manual-prompt' }] } })),
    }
    const stageExecutor = new StageExecutor({ serviceBus, log: { info() {}, warn() {}, error() {} } })
    const aiGenerator = { generateWithDefault: vi.fn() }
    const pipeline = {
      stageExecutor,
      aiGenerator,
      log: { info() {}, warn() {}, error() {} },
      registerStageExecutor(type, fn) { return stageExecutor.register(type, fn) || { success: true } },
    }
    registerStory2VideoStages(pipeline)
    const context = {
      generate_assets: { scenes: [{ index: 0, prompt: 'manual-prompt', promptTranslation: null }] },
      prompt_translations_pending: { uiLocale: 'zh', items: [{ index: 0, prompt: 'manual-prompt', translation: '已有译文' }] },
    }
    const result = await stageExecutor.execute({
      runId: 'translation-manual-compose-reuse',
      stage: { name: 'compose', type: STAGE_TYPES.COMPOSE, options: { composeParallelTask: 'story2video_prompt_translation_compose' } },
      params: {},
      context,
    })
    expect(result.success).toBe(true)
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
    expect(context.generate_assets.scenes[0].promptTranslation).toBe('已有译文')
    expect(result.output.segments[0].promptTranslation).toBe('已有译文')
    expect(context.prompt_translations_pending).toBeUndefined()
  })

  it('单批翻译超时后 fail-open，并保留 pending 供后续重试', async () => {
    vi.useFakeTimers()
    try {
      const pending = {
        uiLocale: 'zh',
      items: [{ index: 0, prompt: 'A red apple', translation: null }],
      }
      const aiGenerator = {
        generateWithDefault: vi.fn(() => new Promise(() => {})),
      }
      const translationPromise = runBoundedPromptTranslation(aiGenerator, pending, { warn: vi.fn() })
      await vi.advanceTimersByTimeAsync(25000)
      await expect(translationPromise).resolves.toEqual({
        results: [{ index: 0, prompt: 'A red apple', translation: null }],
        degraded: true,
        reason: 'prompt translation incomplete or timed out',
      })
      expect(aiGenerator.generateWithDefault).toHaveBeenCalledOnce()
    } finally {
      vi.useRealTimers()
    }
  })

  it('第一批超时后继续处理第二批，不丢弃后续结果', async () => {
    vi.useFakeTimers()
    try {
      const aiGenerator = {
        generateWithDefault: vi.fn()
          .mockImplementationOnce(() => new Promise(() => {}))
          .mockResolvedValueOnce({ content: '{"3":"第二批译文"}' }),
      }
      const translationPromise = runBoundedPromptTranslation(aiGenerator, {
        uiLocale: 'zh',
        items: [
          { index: 0, prompt: 'first' },
          { index: 1, prompt: 'second' },
          { index: 2, prompt: 'third' },
          { index: 3, prompt: 'fourth' },
        ],
      }, { warn: vi.fn() })
      await vi.advanceTimersByTimeAsync(25000)
      await expect(translationPromise).resolves.toMatchObject({
        degraded: true,
        results: [
          { index: 0, translation: null },
          { index: 1, translation: null },
          { index: 2, translation: null },
          { index: 3, translation: '第二批译文' },
        ],
      })
      expect(aiGenerator.generateWithDefault).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })

  it('已有部分译文时重试只请求未完成项，并且 pending 可经 JSON 快照恢复', async () => {
    const pending = createPromptTranslationPending([
      { optimized_prompt: 'first' },
      { optimized_prompt: 'second' },
    ], 'zh')
    const restored = JSON.parse(JSON.stringify({
      ...pending,
      items: pending.items.map((item, index) => ({ ...item, translation: index === 0 ? '已有译文' : null })),
    }))
    const aiGenerator = {
      generateWithDefault: vi.fn().mockResolvedValue({ content: '{"1":"新译文"}' }),
    }
    const result = await runBoundedPromptTranslation(aiGenerator, {
      ...restored,
      existingItems: restored.items,
    }, { warn: vi.fn() })
    expect(aiGenerator.generateWithDefault).toHaveBeenCalledOnce()
    expect(aiGenerator.generateWithDefault.mock.calls[0][1].messages[1].content).toContain('second')
    expect(result.results).toEqual([
      { index: 0, prompt: 'first', translation: '已有译文' },
      { index: 1, prompt: 'second', translation: '新译文' },
    ])
  })

  it('pending 合并过滤负数、非整数、空提示词和重复 index', async () => {
    const aiGenerator = {
      generateWithDefault: vi.fn().mockResolvedValue({ content: '{"0":"译文"}' }),
    }
    const result = await runBoundedPromptTranslation(aiGenerator, {
      uiLocale: 'zh',
      items: [
        { index: -1, prompt: 'negative' },
        { index: 0.5, prompt: 'fraction' },
        { index: 0, prompt: 'valid' },
        { index: 0, prompt: 'duplicate' },
        { index: 1, prompt: '   ' },
      ],
    }, { warn: vi.fn() })
    expect(result.results.map((item) => item.index)).toEqual([0])
    expect(result.results.every((item) => item.prompt)).toBe(true)
  })
})

})

describe('generate_assets 出图 negative_prompt 透传（2026-08-16 east-asian-face-anchor）', () => {
  const sceneWithFaceAnchors = [{ index: 0, text: '一', negativeAnchors: ['西方面孔', '金发'] }]

  it('auto + assetGenerator：negative_prompt 合并场景负面锚后透传 generateImage opts', async () => {
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, opts) => ({ code: 0, data: { path: 'image-' + opts.index + '.png' } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'audio-' + index + '.mp3', duration: 1 } })),
    }
    const fn = makePipeline(assetGenerator)
    const result = await fn({
      stage: { options: { concurrency: 1, negative_prompt: '水印' } },
      params: {},
      context: { scene_context: { scenes: sceneWithFaceAnchors }, split: [{ text: '一' }], optimize: ['p1'] },
      serviceBus: {},
    })
    expect(result.success).toBe(true)
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(1)
    const callOpts = assetGenerator.generateImage.mock.calls[0][1]
    expect(callOpts.negative_prompt).toContain('西方面孔')
    expect(callOpts.negative_prompt).toContain('水印')
  })

  it('manual + assetGenerator：每场景 2 图均带合并后的 negative_prompt', async () => {
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, opts) => {
        // manual 路径会对产物做真实候选复制，mock 必须返回真实存在的文件
        const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 's2v-manual-neg-')), 'img-' + opts.index + '.png')
        fs.writeFileSync(p, 'x')
        return { code: 0, data: { path: p } }
      }),
      generateTTS: vi.fn(),
    }
    const fn = makePipeline(assetGenerator)
    const result = await fn({
      stage: { options: { concurrency: 1, creationMode: 'manual', negative_prompt: '水印' } },
      params: { manualMaterialMode: 'all-images' },
      context: { scene_context: { scenes: sceneWithFaceAnchors }, split: [{ text: '一' }], optimize: ['p1'] },
      serviceBus: {},
    })
    expect(result.success).toBe(true)
    expect(assetGenerator.generateImage).toHaveBeenCalledTimes(2)
    for (const [, callOpts] of assetGenerator.generateImage.mock.calls) {
      expect(callOpts.negative_prompt).toContain('西方面孔')
      expect(callOpts.negative_prompt).toContain('水印')
    }
  })

  it('auto + python generate_image：negative_prompt 进入 callPythonSkill 载荷', async () => {
    const fn = makePipeline(null)
    const serviceBus = {
      callPythonSkill: vi.fn(async (skill, payload) => {
        if (skill === 'generate_image') {
          // manual 路径会对产物做真实候选复制，mock 必须返回真实存在的文件
          const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 's2v-manual-neg-')), 'img-' + payload.index + '.png')
          fs.writeFileSync(p, 'x')
          return { code: 0, data: { path: p } }
        }
        return { code: 0, data: { path: 'audio-' + payload.index + '.mp3', duration: 1 } }
      }),
    }
    const result = await fn({
      stage: { options: { concurrency: 1, negative_prompt: '水印' } },
      params: {},
      context: { scene_context: { scenes: sceneWithFaceAnchors }, split: [{ text: '一' }], optimize: ['p1'] },
      serviceBus,
    })
    expect(result.success).toBe(true)
    const imageCalls = serviceBus.callPythonSkill.mock.calls.filter(([skill]) => skill === 'generate_image')
    expect(imageCalls.length).toBeGreaterThan(0)
    const payload = imageCalls[0][1]
    expect(payload.negative_prompt).toContain('西方面孔')
    expect(payload.negative_prompt).toContain('水印')
  })

  it('manual + python generate_image：negative_prompt 进入 callPythonSkill 载荷（seq 0/1）', async () => {
    const fn = makePipeline(null)
    const serviceBus = {
      callPythonSkill: vi.fn(async (skill, payload) => {
        if (skill === 'generate_image') {
          // manual 路径会对产物做真实候选复制，mock 必须返回真实存在的文件
          const p = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 's2v-manual-neg-')), 'img-' + payload.index + '.png')
          fs.writeFileSync(p, 'x')
          return { code: 0, data: { path: p } }
        }
        return { code: 0, data: { path: 'audio-' + payload.index + '.mp3', duration: 1 } }
      }),
    }
    const result = await fn({
      stage: { options: { concurrency: 1, creationMode: 'manual', negative_prompt: '水印' } },
      params: { manualMaterialMode: 'all-images' },
      context: { scene_context: { scenes: sceneWithFaceAnchors }, split: [{ text: '一' }], optimize: ['p1'] },
      serviceBus,
    })
    expect(result.success).toBe(true)
    const imageCalls = serviceBus.callPythonSkill.mock.calls.filter(([skill]) => skill === 'generate_image')
    expect(imageCalls.length).toBe(2)
    for (const [, payload] of imageCalls) {
      expect(payload.negative_prompt).toContain('西方面孔')
      expect(payload.negative_prompt).toContain('水印')
    }
  })

  it('无场景锚 + 有 stage.options.negative_prompt → 仍透传 base（审查 W）', async () => {
    const assetGenerator = {
      generateImage: vi.fn(async (_prompt, opts) => ({ code: 0, data: { path: 'image-' + opts.index + '.png' } })),
      generateTTS: vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'audio-' + index + '.mp3', duration: 1 } })),
    }
    const fn = makePipeline(assetGenerator)
    const result = await fn({
      stage: { options: { concurrency: 1, negative_prompt: '水印' } },
      params: {},
      context: { scene_context: { scenes: [{ index: 0, text: '一', negativeAnchors: [] }] }, split: [{ text: '一' }], optimize: ['p1'] },
      serviceBus: {},
    })
    expect(result.success).toBe(true)
    const callOpts = assetGenerator.generateImage.mock.calls[0][1]
    expect(callOpts.negative_prompt).toBe('水印')
  })
})
