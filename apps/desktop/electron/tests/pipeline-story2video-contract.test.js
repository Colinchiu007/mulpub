// @vitest-environment node
const { PipelineEngine } = require('../services/pipeline-engine')
const { StageExecutor } = require('../services/stage-executor')
const { registerStory2VideoStages, STORY2VIDEO_STAGE_TYPES } = require('../services/story2video-stages')
const {
  IMPORTED_MEDIA_DIR,
  getRunInputDir,
  importUserSelectedMedia,
} = require('../services/story2video-paths')
const fs = require('fs')
const os = require('os')
const path = require('path')

const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() }

function createEngine() {
  const serviceBus = {
    splitText: vi.fn(async () => ({ scenes: [{ text: '第一幕。' }, { text: '第二幕。' }] })),
    optimizePromptsBatch: vi.fn(async () => ({
      results: [{ optimized_prompt: 'prompt-1' }, { optimized_prompt: 'prompt-2' }],
    })),
    optimizePrompt: vi.fn(async (prompt, options) => ({
      optimized_prompt: 'optimized: ' + prompt,
      platform: (options && options.platform) || 'generic',
      style: (options && options.style) || null,
      model_used: 'mock-model',
      key_source: 'config',
    })),
    composeVideo: vi.fn(async () => ({ code: 0, data: { videoPath: 'video.mp4' } })),
    callPythonSkill: vi.fn(),
  }
  const aiGenerator = {
    _modelProviderManager: {
      getDefault: vi.fn(() => ({ id: 'openai', models: ['gpt-4.1-mini'] })),
    },
    generateWithDefault: vi.fn(async (_type, params) => ({
      content: 'optimized: ' + params.messages[1].content,
      model: 'gpt-4.1-mini',
    })),
  }
  const stageExecutor = new StageExecutor({ serviceBus, log })
  // 显式注入并发上限：自适应默认依赖机器资源（CI runner 可能只有 1 核 → 默认 1），
  // 本文件契约测试涉及同流水线并发运行，必须环境无关。
  const engine = new PipelineEngine({ serviceBus, stageExecutor, aiGenerator, log, maxConcurrentRuns: 2 })
  return { engine, serviceBus, aiGenerator }
}

function createReclonePipelineEngine() {
  const sampleRoot = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-contract-reclone-'))
  const sampleDir = path.join(sampleRoot, 'voice-clone-samples', 'owner', 'storage-1')
  fs.mkdirSync(sampleDir, { recursive: true })
  fs.writeFileSync(path.join(sampleDir, 'sample.mp3'), Buffer.from([1, 2, 3]))

  const ttsCalls = []
  const cloneVoice = vi.fn(async () => ({ id: 'MiniMaxVoice_recloned123' }))
  const findCloneSamples = vi.fn(async () => ({
    sampleStorage: { relativeDir: 'voice-clone-samples/owner/storage-1' },
    name: '音色001',
  }))
  const manager = {
    getAdapter: vi.fn(() => ({ cloneVoice })),
  }
  const cloneService = {
    findCloneSamples,
    _resolveUserDataPath: () => sampleRoot,
  }
  const container = {
    get: vi.fn((key) => key === 'ttsVoiceCloneService' ? cloneService : null),
  }

  const serviceBus = {
    ttsCalls,
    callPythonSkill: vi.fn(async (skill, payload) => {
      if (skill === 'generate_image') {
        return { code: 0, data: { path: 'e2e-image.png' } }
      }
      if (skill === 'generate_tts') {
        ttsCalls.push(payload)
        if (ttsCalls.length === 1) {
          throw Object.assign(new Error('voice id is not accessible'), { code: 'INVALID_CONFIG' })
        }
        return { code: 0, data: { path: 'e2e-audio-recloned.mp3', duration: 1.25 } }
      }
      throw new Error('unexpected Python skill: ' + skill)
    }),
  }
  const aiGenerator = { _modelProviderManager: manager }
  const stageExecutor = new StageExecutor({ serviceBus, container, log })
  const engine = new PipelineEngine({ serviceBus, stageExecutor, aiGenerator, log, maxConcurrentRuns: 2 })
  engine.container = container
  registerStory2VideoStages(engine)

  return {
    engine,
    serviceBus,
    findCloneSamples,
    cloneVoice,
    manager,
    cleanup() {
      fs.rmSync(sampleRoot, { recursive: true, force: true })
    },
  }
}

describe('story2video 编排契约', () => {
  it('本地阶段默认值与版本化 text 合同一致', () => {
    const { engine } = createEngine()
    const pipeline = engine.getPipeline('story2video-compose')
    const stages = Object.fromEntries(pipeline.stageDefs.map(stage => [stage.name, stage]))

    expect(stages.split.options).toMatchObject({
      language: 'auto',
      mode: 'balanced',
      target_duration: 6,
      fallback_to_local: true,
      require_scene_output: true,
    })
    expect(stages.generate_assets.options).toMatchObject({
      inputMode: 'text',
      aspectRatio: '9:16',
      voiceId: 'default',
    })
    expect(stages.optimize.type).toBe('story2video_optimize')
    // 恒含断言（review W1）：stageDef 兜底 max_length=2000，运行时 undefined 时不覆盖，
    // 通用执行器 tiered 默认 500 永不命中 Story2Video 入口
    expect(stages.optimize.options.max_length).toBe(2000)
    expect(stages.scene_context).toMatchObject({
      type: 'story2video_scene_context',
      inputFrom: 'split',
      options: {
        enabled: true,
        max_summary_length: 300,
        max_anchors: 8,
        include_negative_anchors: true,
        context_block_max_chars: 400,
        contentType: 'general',
      },
    })
    expect(stages.optimize.inputFrom).toBe('scene_context')
    expect(stages.compose.options).toMatchObject({
      composeParallelTask: 'story2video_prompt_translation_compose',
      resolution: '720x1280',
      subtitleEnabled: false,
      bgmVolume: 0.5,
      defaultSceneDuration: 6,
      sceneDurationMode: 'follow-audio',
      minSceneDuration: 6,
    })
    expect(stages.publish.options).toMatchObject({ publishEnabled: false, platforms: [] })
  })

  it('语言感知基准语速覆盖静态默认（base_words_per_second = 语言表值，非 bundled 3.3）', async () => {
    // 回归护栏（PRD 7.1.19 §5 已核实项）：resolveRuntimeStageOptions 以 normalizer 的
    // stageOptions.split.base_words_per_second（zh 4.5 / en 2.8 / 其余 3.3）覆盖 bundled/YAML 静态默认 3.3。
    const cases = [
      { language: 'zh', expected: 4.5 },
      { language: 'en', expected: 2.8 },
      { language: 'auto', expected: 3.3 },
    ]
    for (const { language, expected } of cases) {
      const { engine, serviceBus } = createEngine()
      const started = await engine.startOrchestrated('story2video-compose', {
        text: '语言感知基准语速回归。',
        story2videoTextConfig: {
          version: 1,
          mode: 'text',
          prompt: '语言感知基准语速回归。',
          split: { language, mode: 'balanced', maxSentenceLength: 200, targetCharsPerScene: 20 },
        },
        autoAdvance: false,
      })
      expect(started.success).toBe(true)
      const executed = await engine.executeStage(started.runId)
      expect(executed.success).toBe(true)
      expect(serviceBus.splitText).toHaveBeenCalled()
      const sent = serviceBus.splitText.mock.calls.at(-1)[1]
      expect(sent).toMatchObject({ language })
      expect(sent.config.scene.base_words_per_second).toBe(expected)
      // 语言感知值必须覆盖 bundled 静态默认 3.3：覆盖语义由 zh(4.5)/en(2.8) 两档断言锁定；
      // auto(3.3) 档与静态默认数值相同，仅锁定 base_words_per_second → config.scene 键映射。
    }
  })

  it('全自动 Story2Video 接受 none 策略并跨全部阶段完成', async () => {
    const stageExecutor = {
      execute: vi.fn(async ({ stage }) => ({
        success: true,
        output: { completedStage: stage.name },
      })),
    }
    const engine = new PipelineEngine({ stageExecutor, log })

    const started = await engine.startOrchestrated('story2video-compose', {
      text: '自动生成图文轮播视频。',
      autoAdvance: true,
      checkpointPolicy: 'none',
    })

    expect(started).toMatchObject({ success: true, completed: true })
    expect(started.paused).toBeUndefined()
    expect(stageExecutor.execute.mock.calls.map(([request]) => request.stage.name)).toEqual([
      'split', 'scene_context', 'optimize', 'select_video_scenes', 'generate_assets', 'compose', 'publish',
    ])
    expect(engine.getRunSnapshot(started.runId)).toMatchObject({
      status: { status: 'completed' },
      checkpoint: null,
    })
    expect(engine._history.find(run => run.id === started.runId)).toMatchObject({
      params: { autoAdvance: true, checkpointPolicy: 'none' },
    })
  })

  it('历史内容将 contentType 传入领域增强，并把富化提示词交给 prompt-engine 优化', async () => {
    const { engine, serviceBus, aiGenerator } = createEngine()
    registerStory2VideoStages(engine)
    serviceBus.splitText.mockResolvedValueOnce({
      scenes: [{ text: '唐朝长安城的灯火照亮宫殿。' }],
    })

    const started = await engine.startOrchestrated('story2video-compose', {
      text: '唐朝长安城的灯火照亮宫殿。',
      contentType: 'history',
      autoAdvance: false,
      // 阶段序列不含 domain_enrich 后 optimize 为第 3 阶段；手动逐步执行
      // 需要跳过 checkpoint 暂停（否则第 4 次 executeStage 会重跑 optimize）。
      checkpointPolicy: 'none',
    })

    // 阶段序列：split → scene_context → optimize（checkpointPolicy:none 下每次 executeStage 推进一个阶段）
    await engine.executeStage(started.runId)
    await engine.executeStage(started.runId)
    const optimized = await engine.executeStage(started.runId)

    expect(optimized.success).toBe(true)
    expect(engine.getRunContext(started.runId).scene_context).toMatchObject({
      scenes: [expect.objectContaining({
        text: '唐朝长安城的灯火照亮宫殿。',
        imagePromptSeed: expect.stringContaining('唐代'),
      })],
    })
    expect(serviceBus.optimizePrompt).toHaveBeenCalledTimes(1)
    expect(serviceBus.optimizePrompt).toHaveBeenCalledWith(
      expect.stringContaining('唐代'),
      expect.objectContaining({
        platform: 'generic',
        creative_level: 5,
        // 图片提示词上限 2026-08-16 放开：pipeline stageDef 默认 2000（原 500）
        max_length: 2000,
        num_candidates: 1,
        auto_detect_style: true,
      }),
    )
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
    expect(serviceBus.optimizePromptsBatch).not.toHaveBeenCalled()
  })

  it('真实 text 默认参数统一走 prompt-engine 契约，不调用默认 LLM 或旧批量路径', async () => {
    const { engine, serviceBus, aiGenerator } = createEngine()
    registerStory2VideoStages(engine)
    const started = await engine.startOrchestrated('story2video-compose', {
      text: '城市夜景。未来交通。',
      autoAdvance: false,
      checkpointPolicy: 'none',
    })

    // 阶段序列：split → scene_context → optimize（checkpointPolicy:none 下每次 executeStage 推进一个阶段）
    await engine.executeStage(started.runId)
    await engine.executeStage(started.runId)
    const optimized = await engine.executeStage(started.runId)

    expect(optimized.success).toBe(true)
    expect(serviceBus.optimizePrompt).toHaveBeenCalledTimes(2)
    for (const [, options] of serviceBus.optimizePrompt.mock.calls) {
      expect(options).toMatchObject({
        platform: 'generic',
        style: 'realistic',
        creative_level: 5,
        // 图片提示词上限 2026-08-16 放开：pipeline stageDef 默认 2000
        max_length: 2000,
        num_candidates: 1,
        auto_detect_style: true,
      })
    }
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
    expect(serviceBus.optimizePromptsBatch).not.toHaveBeenCalled()
  })

  it('optimize.maxLength 可配置：渲染层 Story2VideoTextConfig 透传到 prompt-engine 请求（2026-08-16 上限放开 500→2000）', async () => {
    const { engine, serviceBus, aiGenerator } = createEngine()
    registerStory2VideoStages(engine)
    const started = await engine.startOrchestrated('story2video-compose', {
      text: '可配置提示词长度。',
      autoAdvance: false,
      checkpointPolicy: 'none',
      story2videoTextConfig: {
        version: 1,
        mode: 'text',
        prompt: '可配置提示词长度。',
        optimize: { maxLength: 700 },
      },
    })
    expect(started.success).toBe(true)

    // 阶段序列：split → scene_context → optimize（checkpointPolicy:none 下每次 executeStage 推进一个阶段）
    await engine.executeStage(started.runId)
    await engine.executeStage(started.runId)
    const optimized = await engine.executeStage(started.runId)

    expect(optimized.success).toBe(true)
    expect(serviceBus.optimizePrompt).toHaveBeenCalledTimes(2)
    for (const [, options] of serviceBus.optimizePrompt.mock.calls) {
      expect(options.max_length).toBe(700)
    }
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
  })

  it('启动时保留 initialContext，并让运行快照同时提供 context 与 status', async () => {
    const { engine } = createEngine()
    engine.registerPipeline({
      name: 'contract-context',
      description: 'contract',
      stages: ['split'],
      stageDefs: [{ name: 'split', type: 'split' }],
    })

    const started = await engine.startOrchestrated('contract-context', {
      text: '测试',
      initialContext: { seed: 'kept' },
      autoAdvance: false,
    })

    expect(started.success).toBe(true)
    const context = engine.getRunContext(started.runId)
    expect(context.seed).toBe('kept')
    expect(engine.getRunSnapshot(started.runId)).toMatchObject({
      context: { seed: 'kept' },
      status: { status: 'running' },
      currentStage: 0,
    })
  })

  it('compose 阶段 onProgress 写入的 compose_progress 经 getRunContext 暴露', async () => {
    const { engine, serviceBus } = createEngine()
    serviceBus.composeVideo.mockImplementation(async (_assets, options) => {
      if (typeof options.onProgress === 'function') {
        options.onProgress({ phase: 'segments', percent: 39, segmentsDone: 3, segmentsTotal: 5 })
        options.onProgress({ phase: 'done', percent: 100, segmentsDone: 5, segmentsTotal: 5 })
      }
      return { code: 0, data: { videoPath: 'video.mp4' } }
    })
    engine.registerPipeline({
      name: 'contract-compose-progress',
      description: 'contract',
      stages: ['compose', 'publish'],
      stageDefs: [
        { name: 'compose', type: 'compose', inputFrom: 'assets' },
        { name: 'publish', type: 'publish', publishEnabled: false, platforms: [] },
      ],
    })

    const started = await engine.startOrchestrated('contract-compose-progress', {
      autoAdvance: false,
      initialContext: { assets: { scenes: [] } },
    })
    expect(started.success).toBe(true)
    await engine.executeStage(started.runId)

    // 运行中（compose 刚完成，publish 未执行）：getRunContext 直接暴露执行器写入的 compose_progress
    expect(engine.getRunContext(started.runId).compose_progress).toEqual({
      phase: 'done',
      percent: 100,
      segmentsDone: 5,
      segmentsTotal: 5,
    })

    // 全部阶段完成后（run 移入 history）：轮询接口 getRunSnapshot 仍携带 compose_progress
    await engine.executeStage(started.runId)
    expect(engine.getRunSnapshot(started.runId).context.compose_progress).toEqual({
      phase: 'done',
      percent: 100,
      segmentsDone: 5,
      segmentsTotal: 5,
    })
  })

  it('运行参数覆盖阶段默认值，并把批量优化结果规范化为数组', async () => {
    const { engine, serviceBus } = createEngine()
    engine.registerPipeline({
      name: 'contract-options',
      description: 'contract',
      stages: ['split', 'optimize', 'review'],
      stageDefs: [
        { name: 'split', type: 'split', options: { mode: 'semantic' } },
        { name: 'optimize', type: 'optimize_batch', options: { style: 'realistic' }, inputFrom: 'split' },
        { name: 'review', type: 'manual_checkpoint' },
      ],
    })

    const started = await engine.startOrchestrated('contract-options', {
      text: '测试',
      imageStyle: 'anime',
      autoAdvance: false,
    })
    await engine.executeStage(started.runId)
    const optimized = await engine.executeStage(started.runId)

    expect(optimized.success).toBe(true)
    expect(engine.getRunContext(started.runId).optimize).toEqual([
      { optimized_prompt: 'prompt-1' },
      { optimized_prompt: 'prompt-2' },
    ])
    expect(serviceBus.optimizePromptsBatch).toHaveBeenCalledWith(
      ['第一幕。', '第二幕。'],
      expect.objectContaining({ style: 'anime' }),
    )
  })

  it('autoAdvance 在声明的检查点暂停并能继续到完成', async () => {
    const { engine } = createEngine()
    engine.registerPipeline({
      name: 'contract-checkpoint',
      description: 'contract',
      stages: ['split', 'review'],
      stageDefs: [
        { name: 'split', type: 'split', checkpointRequired: false },
        { name: 'review', type: 'manual_checkpoint', checkpointRequired: true },
      ],
    })

    const started = await engine.startOrchestrated('contract-checkpoint', {
      text: '测试',
      autoAdvance: true,
    })

    expect(started.success).toBe(true)
    expect(started.paused).toBe(true)
    expect(started.checkpoint).toMatchObject({ stageName: 'review', required: true })
    expect(engine.getRunSnapshot(started.runId)).toMatchObject({
      status: { status: 'paused' },
      checkpoint: { stageName: 'review', required: true },
    })

    const resumed = await engine.advanceToNextCheckpoint(started.runId)
    expect(resumed.success).toBe(true)
    expect(resumed.context.split).toBeDefined()
    expect(resumed.completed).toBe(true)
  })

  it('内容政策 needs_user_input 检查点不能被继续操作绕过到 compose', async () => {
    const stageExecutor = {
      execute: vi.fn(async ({ stage }) => ({
        success: true,
        output: { stage: stage.name },
        checkpoint: 'needs_user_input',
        checkpointMeta: {
          type: 'needs_user_input',
          reason: 'content_policy',
          needsUserInput: true,
        },
      })),
    }
    const engine = new PipelineEngine({ stageExecutor, log })
    engine.registerPipeline({
      name: 'content-policy-stop',
      description: 'contract',
      stages: ['generate_assets', 'compose'],
      stageDefs: [
        { name: 'generate_assets', type: 'generate_assets' },
        { name: 'compose', type: 'compose' },
      ],
    })

    const started = await engine.startOrchestrated('content-policy-stop', {
      text: '测试',
      autoAdvance: true,
      checkpointPolicy: 'none',
    })
    const resumed = await engine.advanceToNextCheckpoint(started.runId)

    expect(started).toMatchObject({ success: true, paused: true })
    expect(resumed).toMatchObject({
      success: false,
      paused: true,
      needsUserInput: true,
      errorCode: 'PIPELINE_USER_INPUT_REQUIRED',
      checkpoint: { reason: 'content_policy' },
    })
    expect(stageExecutor.execute).toHaveBeenCalledTimes(1)
    expect(engine.getRunSnapshot(started.runId)).toMatchObject({
      status: { status: 'paused', currentStage: 0 },
      checkpoint: { reason: 'content_policy' },
    })
  })

  it('图片输入在没有文案时由 split 阶段生成场景', async () => {
    const { engine, serviceBus } = createEngine()
    engine.registerPipeline({
      name: 'contract-gallery',
      description: 'contract',
      stages: ['split'],
      stageDefs: [{ name: 'split', type: 'split' }],
    })

    const started = await engine.startOrchestrated('contract-gallery', {
      inputMode: 'images',
      images: [{ name: '封面.png', preview: 'data:image/png;base64,aW1hZ2U=' }],
      autoAdvance: false,
    })
    const split = await engine.executeStage(started.runId)

    expect(split.success).toBe(true)
    expect(split.output.scenes).toEqual([
      expect.objectContaining({ index: 0, text: '封面.png' }),
    ])
    expect(serviceBus.splitText).not.toHaveBeenCalled()
  })

  it('按 runId 执行阶段时只推进目标运行，不影响同流水线的并发运行', async () => {
    const { engine } = createEngine()
    engine.registerPipeline({
      name: 'contract-concurrent',
      description: 'contract',
      stages: ['split'],
      stageDefs: [{ name: 'split', type: 'split' }],
    })
    const first = await engine.startOrchestrated('contract-concurrent', { text: '第一条', autoAdvance: false })
    const second = await engine.startOrchestrated('contract-concurrent', { text: '第二条', autoAdvance: false })

    const executed = await engine.executeStage(first.runId)

    expect(executed.success).toBe(true)
    expect(engine.getRunSnapshot(first.runId)).toMatchObject({
      runId: first.runId,
      status: { status: 'completed', currentStage: 1 },
      endedAt: expect.any(String),
    })
    expect(engine.getRunSnapshot(second.runId)).toMatchObject({
      runId: second.runId,
      status: { status: 'running', currentStage: 0 },
    })
  })

  it('非法初始上下文不会留下孤儿运行', async () => {
    const { engine } = createEngine()
    engine.registerPipeline({
      name: 'contract-invalid-context',
      description: 'contract',
      stages: ['split'],
      stageDefs: [{ name: 'split', type: 'split' }],
    })
    const circular = {}
    circular.self = circular

    const started = await engine.startOrchestrated('contract-invalid-context', {
      text: '测试',
      initialContext: circular,
      autoAdvance: false,
    })

    expect(started.success).toBe(false)
    expect(engine._runs.size).toBe(0)
  })

  it('Story2Video 在创建运行前拒绝非 text 模式且不留下孤儿运行', async () => {
    const { engine } = createEngine()

    const started = await engine.startOrchestrated('story2video-compose', {
      inputMode: 'images',
      images: [{ name: '封面.png', preview: 'data:image/png;base64,aW1hZ2U=' }],
      autoAdvance: false,
    })

    expect(started).toMatchObject({ success: false })
    expect(started.error).toContain('只支持 text')
    expect(engine._runs.size).toBe(0)
  })

  it('主进程直调在创建运行前拒绝 10001 个 Unicode code point 文案', async () => {
    const { engine } = createEngine()
    const text = '😀'.repeat(10001)

    expect(Array.from(text)).toHaveLength(10001)

    const started = await engine.startOrchestrated('story2video-compose', {
      text,
      autoAdvance: false,
    })

    expect(started).toMatchObject({ success: false })
    expect(started.error).toMatch(/10000.*Unicode/i)
    expect(engine._runs.size).toBe(0)
  })

  it('Story2Video 使用版本化 text 配置执行分句和 prompt-engine 优化，普通编排流水线保持旧合同', async () => {
    const { engine, serviceBus, aiGenerator } = createEngine()
    registerStory2VideoStages(engine)
    const started = await engine.startOrchestrated('story2video-compose', {
      text: '海上日出',
      story2videoTextConfig: {
        mode: 'text',
        prompt: '海上日出',
        split: { language: 'auto', mode: 'precise', maxSentenceLength: 120 },
        optimize: { style: 'anime', creativeLevel: 8, numCandidates: 2 },
      },
      autoAdvance: false,
      checkpointPolicy: 'none',
    })

    expect(started.success).toBe(true)
    // 阶段序列：split → scene_context → optimize（checkpointPolicy:none 下每次 executeStage 推进一个阶段）
    await engine.executeStage(started.runId)
    await engine.executeStage(started.runId)
    await engine.executeStage(started.runId)
    expect(serviceBus.splitText).toHaveBeenCalledWith('海上日出', expect.objectContaining({
      language: 'auto',
      mode: 'precise',
      config: expect.objectContaining({
        sentence_tokenizer: expect.objectContaining({ max_sentence_length: 120 }),
        scene: expect.objectContaining({ target_seconds: 6 }),
      }),
    }))
    expect(serviceBus.splitText.mock.calls[0][1]).not.toHaveProperty('max_sentence_length')
    // 版本化 optimize 配置映射为 prompt-engine 请求参数（候选数/创意度/风格透传）
    expect(serviceBus.optimizePrompt).toHaveBeenCalledTimes(2)
    for (const [, options] of serviceBus.optimizePrompt.mock.calls) {
      expect(options).toMatchObject({
        platform: 'generic',
        style: 'anime',
        creative_level: 8,
        // 图片提示词上限 2026-08-16 放开：pipeline stageDef 默认 2000
        max_length: 2000,
        num_candidates: 2,
        auto_detect_style: true,
      })
    }
    expect(aiGenerator.generateWithDefault).not.toHaveBeenCalled()
    expect(serviceBus.optimizePromptsBatch).not.toHaveBeenCalled()

    engine.registerPipeline({
      name: 'contract-unchanged',
      description: 'contract',
      stages: ['split'],
      stageDefs: [{ name: 'split', type: 'split' }],
    })
    const regular = await engine.startOrchestrated('contract-unchanged', {
      inputMode: 'images',
      images: [{ name: '普通流水线图片' }],
      autoAdvance: false,
    })
    expect(regular.success).toBe(true)
    const split = await engine.executeStage(regular.runId)
    expect(split.output.scenes[0].text).toBe('普通流水线图片')
  })

  it('取消 Story2Video 运行时清理 data URL 输入目录', async () => {
    const { engine } = createEngine()
    const started = await engine.startOrchestrated('story2video-compose', {
      text: '测试',
      autoAdvance: false,
    })
    const inputDir = getRunInputDir(started.runId)
    fs.mkdirSync(inputDir, { recursive: true })
    fs.writeFileSync(require('path').join(inputDir, 'image_0000.png'), 'image')

    engine.cancel()

    expect(fs.existsSync(inputDir)).toBe(false)
  })

  it('Story2Video 拒绝旧音频模式时清理已导入的旁白临时文件', async () => {
    const sourceRoot = fs.mkdtempSync(path.join(os.tmpdir(), 's2v-import-source-'))
    const source = path.join(sourceRoot, 'voice.mp3')
    fs.writeFileSync(source, 'voice')
    const imported = importUserSelectedMedia(source, 'audio', {
      baseDir: path.join(IMPORTED_MEDIA_DIR, 'contract-' + Date.now()),
    })
    const { engine } = createEngine()

    try {
      const started = await engine.startOrchestrated('story2video-compose', {
        inputMode: 'audio',
        audio: [{ name: 'voice.mp3', path: imported.path }],
        autoAdvance: false,
      })
      expect(started.success).toBe(false)
      expect(started.error).toContain('只支持 text')
      expect(fs.existsSync(imported.path)).toBe(false)
    } finally {
      fs.rmSync(sourceRoot, { recursive: true, force: true })
      fs.rmSync(imported.path, { force: true })
    }
  })
})

// ============================================================
// 阶段级进行中信息契约（stage.progress 统一通道，openspec pipeline-progress-feedback-unification）
// ============================================================
describe('阶段级进行中信息契约（stage.progress）', () => {
  it('执行器 onProgress → getRunSnapshot().stages[i].progress 可见且 context.stage_progress 双写', async () => {
    const { engine } = createEngine()
    engine.registerStageExecutor('contract_progress_emit', async ({ onProgress }) => {
      onProgress({ percent: 25, message: '正在生成第 1/4 张图片', detail: { done: 1, total: 4, kind: 'image' } })
      onProgress({ percent: 75, message: '正在生成第 3/4 张图片', detail: { done: 3, total: 4, kind: 'image' } })
      onProgress({ percent: 100, message: '资源生成完成', detail: { done: 4, total: 4, kind: 'image' }, summary: '共 4 张图片' })
      return { success: true, output: { ok: true } }
    })
    engine.registerPipeline({
      name: 'contract-stage-progress',
      description: 'contract',
      stages: ['custom'],
      stageDefs: [{ name: 'custom', type: 'contract_progress_emit' }],
    })
    const started = await engine.startOrchestrated('contract-stage-progress', { autoAdvance: false })
    expect(started.success).toBe(true)
    await engine.executeStage(started.runId)
    const snapshot = engine.getRunSnapshot(started.runId)
    expect(snapshot.stages[0].progress).toMatchObject({
      percent: 100,
      message: '资源生成完成',
      detail: { done: 4, total: 4, kind: 'image' },
    })
    expect(snapshot.stages[0].summary).toBe('共 4 张图片')
    expect(snapshot.context.stage_progress).toEqual(snapshot.stages[0].progress)
  })

  it('非法/降序进度被拒绝，并为成功阶段补完成事件', async () => {
    const { engine } = createEngine()
    engine.registerStageExecutor('contract_progress_bad', async ({ onProgress }) => {
      onProgress({ percent: 50, message: '合法进度' })
      onProgress({ percent: 30, message: '降序应被丢弃' })
      onProgress({ percent: NaN, message: 'NaN 应被丢弃' })
      onProgress({ percent: 101, message: '越界应被丢弃' })
      onProgress({ percent: 80, message: '' })
      onProgress({ percent: 90, message: '最终合法值' })
      return { success: true, output: {} }
    })
    engine.registerPipeline({
      name: 'contract-progress-bad',
      description: 'c',
      stages: ['custom'],
      stageDefs: [{ name: 'custom', type: 'contract_progress_bad' }],
    })
    const started = await engine.startOrchestrated('contract-progress-bad', { autoAdvance: false })
    expect(started.success).toBe(true)
    await engine.executeStage(started.runId)
    const snapshot = engine.getRunSnapshot(started.runId)
    expect(snapshot.stages[0].progress).toMatchObject({
      percent: 100,
      messageKey: 'stageProgress.stageComplete',
      summaryKey: 'stageProgress.stageSummary',
    })
  })

  it('_calcProgress 阶段数占比 + 当前阶段 percent 加权', () => {
    const { engine } = createEngine()
    const run = {
      currentStage: 1,
      stages: [
        { status: 'completed' },
        { status: 'running', progress: { percent: 50 } },
        { status: 'pending' },
      ],
    }
    // (1 + 0.5) / 3 = 50%
    expect(engine._calcProgress(run)).toBe(50)
    run.stages[1].progress = { percent: 100 }
    // (1 + 1) / 3 ≈ 67%
    expect(engine._calcProgress(run)).toBe(67)
    run.stages[1].progress = null
    // 1 / 3 ≈ 33%（无进行中进度回退阶段数占比）
    expect(engine._calcProgress(run)).toBe(33)
    run.stages[1].status = 'completed'
    // 2 / 3 ≈ 67%
    expect(engine._calcProgress(run)).toBe(67)
  })

  it('成功但未自行上报的执行器仍获得可本地化生命周期进度', async () => {
    const { engine } = createEngine()
    engine.registerStageExecutor('contract_no_progress', async () => ({ success: true, output: { ok: true } }))
    engine.registerPipeline({
      name: 'contract-no-progress',
      description: 'c',
      stages: ['custom'],
      stageDefs: [{ name: 'custom', type: 'contract_no_progress' }],
    })
    const started = await engine.startOrchestrated('contract-no-progress', {
      autoAdvance: false,
    })
    expect(started.success).toBe(true)
    await engine.executeStage(started.runId)
    const snapshot = engine.getRunSnapshot(started.runId)
    expect(snapshot.stages[0].progress).toMatchObject({
      percent: 100,
      messageKey: 'stageProgress.stageComplete',
      summaryKey: 'stageProgress.stageSummary',
    })
    expect(snapshot.stages[0].summary).toBe('Stage complete.')
    expect(snapshot.context.stage_progress).toEqual(snapshot.stages[0].progress)
  })
})

// ============================================================
// 轻量快照（progressOnly，openspec pipeline-progress-real-time-push）
// ============================================================
describe('getRunSnapshot progressOnly 轻量快照', () => {
  it('progressOnly 不含 context，保留阶段进度/状态与 run 级 progress', async () => {
    const { engine } = createEngine()
    engine.registerStageExecutor('contract_push_emit', async ({ onProgress }) => {
      onProgress({ percent: 60, message: '正在发布到 weibo (3/5)', detail: { done: 3, total: 5, kind: 'platform' } })
      onProgress({ percent: 100, message: '发布完成', summary: '已发布到 5 个平台' })
      return { success: true, output: { publishedTo: ['weibo'] } }
    })
    engine.registerPipeline({
      name: 'contract-light-snapshot',
      description: 'c',
      stages: ['custom'],
      stageDefs: [{ name: 'custom', type: 'contract_push_emit' }],
    })
    const started = await engine.startOrchestrated('contract-light-snapshot', {
      autoAdvance: false,
      initialContext: { secret: 'should-not-leak' },
    })
    await engine.executeStage(started.runId)

    const light = engine.getRunSnapshot(started.runId, { progressOnly: true })
    expect(light.progressOnly).toBe(true)
    expect(light.context).toBeUndefined()
    expect(light.stages[0].progress).toMatchObject({ percent: 100, message: '发布完成' })
    expect(light.stages[0].summary).toBe('已发布到 5 个平台')
    expect(light.status.progress).toBe(100)
    // 单阶段流水线 executeStage 后 run 已终态（completed）
    expect(light.status.status).toBe('completed')
    expect(light.runId).toBe(started.runId)

    // 完整快照仍含 context（不回归）
    const full = engine.getRunSnapshot(started.runId)
    expect(full.context.secret).toBe('should-not-leak')
    expect(full.context.custom).toEqual({ publishedTo: ['weibo'] })
  })

  it('progressOnly checkpoint 仅保留类型元数据（不携带 context 快照）', () => {
    const { engine } = createEngine()
    const run = {
      id: 'run-cp',
      pipeline: 'p',
      status: 'paused',
      currentStage: 0,
      stages: [{ name: 'a', status: 'paused' }],
      checkpoint: { type: 'scene_asset_selection', stageName: 'finalize_assets', stageIndex: 5, required: true, context: { sensitive: 'x' }, savedAt: '2026-01-01' },
      orchestrationMode: 'orchestrator',
    }
    engine._runs.set('run-cp', run)
    const light = engine.getRunSnapshot('run-cp', { progressOnly: true })
    expect(light.checkpoint).toEqual({ type: 'scene_asset_selection', stageName: 'finalize_assets', stageIndex: 5, required: true })
    expect(light.checkpoint.context).toBeUndefined()
    expect(light.checkpoint.savedAt).toBeUndefined()
  })
})

describe('story2video 真实 StageExecutor 重克隆回归', () => {
  it('generate_assets legacy serviceBus 重克隆成功后复用 callPythonSkill', async () => {
    const fixture = createReclonePipelineEngine()
    try {
      const result = await fixture.engine.stageExecutor.execute({
        runId: 'run_e2e_voice_clone_001',
        stage: {
          name: 'generate_assets',
          type: STORY2VIDEO_STAGE_TYPES.GENERATE_ASSETS,
          options: { concurrency: 1 },
        },
        params: {
          voiceId: 'MiniMaxVoice_original001',
          voiceProvider: 'minimax-multimodal',
          voiceModel: 'speech-2.8-turbo',
        },
        context: {
          split: [{ text: '音色001 的 E2E 旁白' }],
          optimize: ['一个安静的室内场景'],
        },
      })

      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(result.output.scenes[0]).toMatchObject({
        audioPath: 'e2e-audio-recloned.mp3',
        imagePath: 'e2e-image.png',
      })
      expect(fixture.serviceBus.ttsCalls.map((payload) => payload.voice_id)).toEqual([
        'MiniMaxVoice_original001',
        'MiniMaxVoice_recloned123',
      ])
      expect(fixture.serviceBus.ttsCalls.map((payload) => payload.voice_model)).toEqual([
        'speech-2.8-turbo',
        'speech-2.8-turbo',
      ])
      expect(fixture.findCloneSamples).toHaveBeenCalledWith(
        'MiniMaxVoice_original001',
        'minimax-multimodal',
        expect.any(String),
      )
      expect(fixture.manager.getAdapter).toHaveBeenCalledWith('minimax-multimodal')
      expect(fixture.cloneVoice).toHaveBeenCalledTimes(1)
    } finally {
      fixture.cleanup()
    }
  })

  it('finalize_assets legacy serviceBus 重克隆成功后复用 callPythonSkill', async () => {
    const fixture = createReclonePipelineEngine()
    try {
      const result = await fixture.engine.stageExecutor.execute({
        runId: 'run_e2e_voice_clone_finalize',
        stage: {
          name: 'finalize_assets',
          type: STORY2VIDEO_STAGE_TYPES.FINALIZE_ASSETS,
          options: { creationMode: 'manual', concurrency: 1 },
        },
        params: {
          voiceId: 'MiniMaxVoice_original001',
          voiceProvider: 'minimax-multimodal',
          voiceModel: 'speech-2.8-turbo',
        },
        context: {
          generate_assets: {
            candidates: [{
              index: 0,
              text: '音色001 的最终旁白',
              prompt: '一个安静的室内场景',
              candidates: [{ id: 'image-0', kind: 'image', path: 'e2e-image.png' }],
            }],
          },
          scene_asset_selection: {
            selections: [{ index: 0, candidateId: 'image-0' }],
          },
        },
      })

      expect(result.success, JSON.stringify(result)).toBe(true)
      expect(result.output.scenes[0]).toMatchObject({
        audioPath: 'e2e-audio-recloned.mp3',
        imagePath: 'e2e-image.png',
      })
      expect(fixture.serviceBus.ttsCalls.map((payload) => payload.voice_id)).toEqual([
        'MiniMaxVoice_original001',
        'MiniMaxVoice_recloned123',
      ])
      expect(fixture.serviceBus.ttsCalls.map((payload) => payload.voice_model)).toEqual([
        'speech-2.8-turbo',
        'speech-2.8-turbo',
      ])
      expect(fixture.cloneVoice).toHaveBeenCalledTimes(1)
    } finally {
      fixture.cleanup()
    }
  })
})


