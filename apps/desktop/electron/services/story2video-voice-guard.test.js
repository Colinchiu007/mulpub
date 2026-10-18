// @vitest-environment node
/**
 * story2video-voice-guard 独立用例：克隆音色前置守卫、运行期失败聚合、
 * 失败摘要去重（2026-10-18 事故回归）。被测实现已从 story2video-stages 拆到
 * story2video-voice-guard，本文件直接验证该模块 + 阶段执行器的接入行为。
 */
const {
  registerStory2VideoStages,
  STORY2VIDEO_STAGE_TYPES,
} = require('./story2video-stages')
const {
  isClonedVoiceUnavailableMessage,
  summarizeAssetFailures,
  buildVoiceCloneAggregateError,
} = require('./story2video-voice-guard')

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
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
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

/**
 * 2026-10-18 事故（项目 mvdxd21s_o1ws）：
 * 保存选项里的克隆音色 registry 记录仍为 active，但本地 voice-clone-samples 目录已丢失，
 * 于是 9 条 TTS 全部被供应商拒绝（you don't have access to this voice_id），
 * 重克隆回退 ENOENT 后失败聚合把同一句英文原样重复 9 次。
 * 契约：① 生成前只读守卫，命中失效立刻 fail fast（零图片/零旁白调用）；
 *       ② 运行期全部 TTS 失败且原因均为克隆音色不可用时，聚合为一条可操作提示；
 *       ③ summarizeAssetFailures 对相同错误去重并输出场景区间。
 */
describe('克隆音色完整性 — 前置守卫与失败聚合（2026-10-18）', () => {
  const CLONE_VOICE_ID = 'MiniMaxMiniMaxCloneVoice_00jngz_0qrltk'
  const CLONE_PROVIDER = 'minimax-multimodal'
  const CLONE_MODEL = 'speech-2.8-turbo'

  function makeCloneStatusService(status) {
    return { getCloneVoiceStatus: vi.fn(async () => status) }
  }

  function makeCloneContainer(statusOrService) {
    const cloneService = statusOrService && typeof statusOrService.getCloneVoiceStatus === 'function'
      ? statusOrService
      : makeCloneStatusService(statusOrService)
    return {
      cloneService,
      container: {
        get: (key) => (key === 'ttsVoiceCloneService' ? cloneService : null),
      },
    }
  }

  function makeS2vContext(count) {
    return {
      split: Array.from({ length: count }, (_, index) => ({ text: '旁白文本' + (index + 1) })),
      optimize: Array.from({ length: count }, (_, index) => '画面提示词' + (index + 1)),
    }
  }

  function makeCloneParams() {
    return {
      voiceId: CLONE_VOICE_ID,
      voiceProvider: CLONE_PROVIDER,
      voiceModel: CLONE_MODEL,
    }
  }

  const invalidSampleMissingStatus = {
    code: 0,
    data: {
      registered: true,
      name: '音色001',
      invalid: true,
      invalidReason: 'sample_storage_missing',
    },
  }

  it('generate_assets 前置守卫：样本缺失时零图片/零 TTS 调用，并以 VOICE_CLONE_UNAVAILABLE 开头失败', async () => {
    const generateImage = vi.fn(async () => ({ code: 0, data: { path: 'should-not-exist.png' } }))
    const generateTTS = vi.fn(async () => ({ code: 0, data: { path: 'should-not-exist.mp3', duration: 2 } }))
    const { container, cloneService } = makeCloneContainer(invalidSampleMissingStatus)
    const fn = makePipeline({ generateImage, generateTTS }, null, { container })

    const result = await fn({
      stage: { options: { concurrency: 2 } },
      params: makeCloneParams(),
      context: makeS2vContext(2),
      serviceBus: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/^VOICE_CLONE_UNAVAILABLE: /)
    expect(result.error).toContain('「音色001」')
    expect(result.error).toContain('本地克隆样本已丢失')
    expect(result.error).toContain('本次未生成任何图片与旁白')
    expect(generateImage).not.toHaveBeenCalled()
    expect(generateTTS).not.toHaveBeenCalled()
    expect(cloneService.getCloneVoiceStatus).toHaveBeenCalledWith({
      providerId: CLONE_PROVIDER,
      model: CLONE_MODEL,
      voiceId: CLONE_VOICE_ID,
    })
  })

  it('generate_assets 前置守卫：voice_id 非法时给出「音色 ID 不合法」原因', async () => {
    const generateTTS = vi.fn(async () => ({ code: 0, data: { path: 'should-not-exist.mp3', duration: 2 } }))
    const { container } = makeCloneContainer({
      code: 0,
      data: { registered: true, name: '音色001', invalid: true, invalidReason: 'invalid_voice_id' },
    })
    const fn = makePipeline({ generateImage: vi.fn(), generateTTS }, null, { container })

    const result = await fn({
      stage: { options: { concurrency: 1 } },
      params: makeCloneParams(),
      context: makeS2vContext(1),
      serviceBus: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/^VOICE_CLONE_UNAVAILABLE: /)
    expect(result.error).toContain('音色 ID 不合法')
    expect(generateTTS).not.toHaveBeenCalled()
  })

  it('前置守卫：克隆服务缺失、缺少状态方法或查询抛错时不阻断生成', async () => {
    const generateImage = vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: 'image-' + index + '.png' } }))
    const generateTTS = vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'audio-' + index + '.mp3', duration: 2 } }))

    async function run(container) {
      const fn = makePipeline({ generateImage, generateTTS }, null, container ? { container } : {})
      return fn({
        stage: { options: { concurrency: 1 } },
        params: makeCloneParams(),
        context: makeS2vContext(1),
        serviceBus: {},
      })
    }

    // 1) 容器未注册该服务
    const noService = await run({ get: () => null })
    expect(noService.success).toBe(true)
    // 2) 旧版/替身服务缺少 getCloneVoiceStatus
    const withoutMethod = await run({
      get: (key) => (key === 'ttsVoiceCloneService' ? { findCloneSamples: vi.fn() } : null),
    })
    expect(withoutMethod.success).toBe(true)
    // 3) 状态查询自身抛错（守卫故障不得变成任务失败）
    const throwing = await run({
      get: (key) => (key === 'ttsVoiceCloneService'
        ? { getCloneVoiceStatus: vi.fn(async () => { throw new Error('status probe boom') }) }
        : null),
    })
    expect(throwing.success).toBe(true)
    expect(generateImage).toHaveBeenCalledTimes(3)
    expect(generateTTS).toHaveBeenCalledTimes(3)
  })

  it('前置守卫：未注册或样本完好（invalid=false）时不阻断生成', async () => {
    const generateImage = vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: 'image-' + index + '.png' } }))
    const generateTTS = vi.fn(async (_text, { index }) => ({ code: 0, data: { path: 'audio-' + index + '.mp3', duration: 2 } }))
    const notRegistered = makeCloneContainer({ code: 0, data: { registered: false } })
    const healthy = makeCloneContainer({
      code: 0,
      data: { registered: true, name: '音色001', invalid: false, invalidReason: null },
    })

    for (const { container } of [notRegistered, healthy]) {
      const fn = makePipeline({ generateImage, generateTTS }, null, { container })
      const result = await fn({
        stage: { options: { concurrency: 1 } },
        params: makeCloneParams(),
        context: makeS2vContext(1),
        serviceBus: {},
      })
      expect(result.success).toBe(true)
    }
    expect(generateImage).toHaveBeenCalledTimes(2)
    expect(generateTTS).toHaveBeenCalledTimes(2)
  })

  it('运行期：9 条相同克隆音色错误聚合为一条 VOICE_CLONE_UNAVAILABLE，原始英文不重复且 resume 仍写入', async () => {
    const generateImage = vi.fn(async (_prompt, { index }) => ({ code: 0, data: { path: 'image-' + index + '.png' } }))
    const generateTTS = vi.fn(async () => {
      throw new Error("you don't have access to this voice_id")
    })
    const fn = makePipeline({ generateImage, generateTTS })
    const context = makeS2vContext(9)

    const result = await fn({
      stage: { options: { concurrency: 3 } },
      params: makeCloneParams(),
      context,
      serviceBus: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/^VOICE_CLONE_UNAVAILABLE: /)
    expect(result.error).toContain('所选克隆音色已不可用')
    expect(result.error).toContain('供应商拒绝访问')
    expect(result.error).not.toContain("you don't have access")
    expect(result.error).not.toMatch(/TTS #/)
    expect(result.error.match(/VOICE_CLONE_UNAVAILABLE/g) || []).toHaveLength(1)
    expect(result.error.match(/供应商拒绝访问/g) || []).toHaveLength(1)
    // 断点续传上下文必须仍然写入（否则用户无法「从断点继续」）
    expect(context.generate_assets?.resume?.total).toBe(9)
    expect(context.generate_assets?.resume?.completed).toHaveLength(9)
    expect(generateTTS).toHaveBeenCalledTimes(9)
  })

  it('finalize_assets 前置守卫：样本缺失时零 TTS 调用并以 VOICE_CLONE_UNAVAILABLE 失败', async () => {
    const generateTTS = vi.fn(async () => ({ code: 0, data: { path: 'never-called.mp3', duration: 1 } }))
    const { container } = makeCloneContainer(invalidSampleMissingStatus)
    const fn = makePipeline({ generateTTS }, null, { container })

    const result = await fn.finalizeAssetsExecutor({
      stage: { options: { creationMode: 'manual', concurrency: 1 } },
      params: makeCloneParams(),
      context: {
        generate_assets: {
          candidates: [{
            index: 0,
            text: '手动旁白文本',
            prompt: '画面提示词',
            candidates: [{ id: 'image-0', kind: 'image', path: 'image-0.png' }],
          }],
        },
        scene_asset_selection: { selections: [{ index: 0, candidateId: 'image-0' }] },
      },
      serviceBus: {},
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/^VOICE_CLONE_UNAVAILABLE: /)
    expect(generateTTS).not.toHaveBeenCalled()
  })
})

describe('isClonedVoiceUnavailableMessage / summarizeAssetFailures（2026-10-18）', () => {
  it('命中克隆音色不可用的供应商真实文案与既有中文分支', () => {
    const messages = [
      "you don't have access to this voice_id",
      'voice_id not found',
      'voice id wrong',
      'invalid params, voice id wrong',
      'cloned voice is not available',
      'custom voice not found',
      '当前账号没有该音色',
      '该音色已失效',
    ]
    for (const message of messages) {
      expect(isClonedVoiceUnavailableMessage(message), message).toBe(true)
    }
  })

  it('不把限流/额度/网络错误误判为克隆音色不可用', () => {
    const messages = [
      'rate limit reached',
      'insufficient balance, please recharge your account',
      'fetch failed',
      '',
    ]
    for (const message of messages) {
      expect(isClonedVoiceUnavailableMessage(message), message).toBe(false)
    }
    expect(isClonedVoiceUnavailableMessage(null)).toBe(false)
    expect(isClonedVoiceUnavailableMessage(undefined)).toBe(false)
  })

  // 变异反证 M4（every 写成 some）在本用例存在前**存活**：全量同因时 every/some 都命中，
  // 只有「部分失败同因」才能分辨。混合原因必须不聚合（继续逐条可见），否则会把限流/网络
  // 等可重试失败吸收进「音色失效」结论。
  it('运行期聚合只在全部失败同因时触发：混合原因必须返回 null（锁 every，防退化成 some）', () => {
    expect(buildVoiceCloneAggregateError([
      { error: "you don't have access to this voice_id" },
      { error: 'rate limit reached' },
    ])).toBeNull()
    expect(buildVoiceCloneAggregateError([
      { error: "you don't have access to this voice_id" },
      { error: "you don't have access to this voice_id" },
    ])).toContain('VOICE_CLONE_UNAVAILABLE')
  })

  it('summarizeAssetFailures 把相同 message 合并为场景区间', () => {
    expect(summarizeAssetFailures('TTS', [
      { index: 0, error: "you don't have access to this voice_id" },
      { index: 1, error: "you don't have access to this voice_id" },
      { index: 2, error: "you don't have access to this voice_id" },
    ])).toEqual(["TTS #1-#3: you don't have access to this voice_id"])
  })

  it('summarizeAssetFailures 对单个、非连续与不同错误保持可读输出', () => {
    expect(summarizeAssetFailures('Image', [
      { index: 2, error: 'boom' },
      { index: 5, error: 'other failure' },
      { index: 6, error: 'boom' },
    ])).toEqual(['Image #3, #7: boom', 'Image #6: other failure'])
  })
})
