// @ts-check
/**
 * videogen-stages.digital-human.test.js — 数字人（avatar-spokesperson）分支测试
 *
 * 为什么单独成文件：videogen-stages.test.js 的 makeVideoAi 只提供
 * getDefault/getAdapter，没有 getProvider（数字人分支需要它做能力协商）。
 * 与其改既有 mock 影响 40+ 条通用用例，不如独立一份带 getProvider 的夹具。
 *
 * 锁定三件事（PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19 §7）：
 *  A1 数字人分支真的把 character/voice/script 传给 adapter
 *  A2 通用链路零回归（未标 digitalHuman 时行为逐字不变）
 *  A3 三要素缺失 fail closed，不静默降级成通用文生视频
 */

// @vitest-environment node
const {
  registerVideoGenStages,
  VIDEOGEN_STAGE_TYPES,
  resolveDigitalHumanProvider,
  resolveDigitalHumanInputs,
} = require('./videogen-stages')

const http = require('http')

const __videoServer = http.createServer((_req, res) => {
  res.writeHead(200, { 'Content-Type': 'video/mp4' })
  res.end(Buffer.from([0, 0, 0, 0]))
})
let VIDEO_URL = ''
async function waitForVideoUrl () {
  const deadline = Date.now() + 3000
  while (!VIDEO_URL && Date.now() < deadline) { await new Promise(r => setTimeout(r, 10)) }
  if (!VIDEO_URL) throw new Error('video server not ready')
}
__videoServer.listen(0, '127.0.0.1', () => {
  VIDEO_URL = 'http://127.0.0.1:' + __videoServer.address().port + '/v.mp4'
})
__videoServer.unref()

function makePipeline (aiGenerator, opts = {}) {
  const executors = new Map()
  const optimizeVideoPromptsBatch = vi.fn(async (prompts) => (prompts || []).map(p => ({ optimized_prompt: '[opt] ' + p })))
  const pipeline = {
    aiGenerator,
    stageExecutor: { register: (t, f) => executors.set(t, f) },
    serviceBus: { optimizeVideoPromptsBatch },
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    registerStageExecutor (type, fn) { executors.set(type, fn); return { success: true } },
  }
  registerVideoGenStages(pipeline)
  return { get: (type) => executors.get(type), optimizeVideoPromptsBatch }
}

/** 带 getProvider 的 manager：heygen 可用，agnes-video 也可用（模拟真实双配置） */
function makeManager (overrides = {}) {
  return {
    getDefault: (type) => (type === 'video' ? { id: 'agnes-video', models: ['agnes-video-v2.0'] } : (type === 'llm' ? { id: 'agnes-llm', models: ['agnes-2.0-flash'] } : null)),
    getProvider: (id) => (id === 'heygen' ? { id: 'heygen', category: 'video', models: ['heygen-video'] } : null),
    callAdapter: vi.fn(async () => ({ code: 0, data: { taskId: 't1' } })),
    ...overrides,
  }
}

function makeAi (manager) {
  return {
    _modelProviderManager: manager,
    generateWithDefault: vi.fn(async () => ({ content: '口播文案内容', model: 'llm' })),
  }
}

describe('数字人分支（avatar-spokesperson）', () => {
  describe('resolveDigitalHumanProvider', () => {
    it('默认解析到 heygen，不走 getDefault(video)', () => {
      const manager = makeManager()
      const result = resolveDigitalHumanProvider(makeAi(manager), {})
      expect(result.providerId).toBe('heygen')
      // 关键：不是 agnes-video（getDefault('video') 的结果）
      expect(result.providerId).not.toBe('agnes-video')
    })

    it('params.videoProvider 可显式覆盖', () => {
      const manager = makeManager({
        getProvider: (id) => (id === 'other-dh' ? { id: 'other-dh', models: ['m'] } : null),
      })
      const result = resolveDigitalHumanProvider(makeAi(manager), { videoProvider: 'other-dh' })
      expect(result.providerId).toBe('other-dh')
    })

    it('provider 不存在 → null（不臆造可用性）', () => {
      const manager = makeManager({ getProvider: () => null })
      expect(resolveDigitalHumanProvider(makeAi(manager), {})).toBeNull()
    })

    it('manager 缺失 → null', () => {
      expect(resolveDigitalHumanProvider(null, {})).toBeNull()
    })
  })

  describe('resolveDigitalHumanInputs', () => {
    const full = { avatarId: 'ava-1', voiceId: 'voice-1', text: '主题' }

    it('三要素齐全时返回解析结果', () => {
      const result = resolveDigitalHumanInputs(full, { options: {} }, {})
      expect(result).toEqual({ character: 'ava-1', voice: 'voice-1', script: '主题' })
    })

    it('优先取 context.script 作为口播文案', () => {
      const result = resolveDigitalHumanInputs(full, { options: {} }, { script: 'LLM 写的口播文案' })
      expect(result.script).toBe('LLM 写的口播文案')
    })

    it('context.avatar_select 的产出可作为兜底来源', () => {
      const result = resolveDigitalHumanInputs({}, { options: {} }, {
        avatar_select: { script: '文案A', avatarId: 'ava-2', voiceId: 'voice-2' },
      })
      expect(result).toEqual({ character: 'ava-2', voice: 'voice-2', script: '文案A' })
    })

    const missing = [
      ['缺 avatarId', { voiceId: 'voice-1', text: 't' }],
      ['缺 voiceId', { avatarId: 'ava-1', text: 't' }],
      ['缺文案', { avatarId: 'ava-1', voiceId: 'voice-1' }],
    ]
    for (const [label, params] of missing) {
      it(`${label} → null（fail closed）`, () => {
        expect(resolveDigitalHumanInputs(params, { options: {} }, {})).toBeNull()
      })
    }

    it('空白字符串视为缺失', () => {
      expect(resolveDigitalHumanInputs({ avatarId: '  ', voiceId: 'v', text: 't' }, { options: {} }, {})).toBeNull()
    })
  })

  describe('GENERATE 执行器 — 数字人分支', () => {
    it('★ 走数字人分支时把 character/voice/script 传给 heygen', async () => {
      await waitForVideoUrl()
      const manager = makeManager()
      manager.callAdapter = vi.fn(async (providerId, method) => {
        if (method === 'getVideoStatus') return { code: 0, data: { status: 'completed', videoUrl: VIDEO_URL } }
        return { code: 0, data: { taskId: 'dh-task' } }
      })
      const { get, optimizeVideoPromptsBatch } = makePipeline(makeAi(manager))

      const result = await get(VIDEOGEN_STAGE_TYPES.GENERATE)({
        runId: 'run_dh_1',
        stage: { options: { digitalHuman: true } },
        params: { text: '主题', avatarId: 'ava-1', voiceId: 'voice-1' },
        context: { script: '这是一段口播文案' },
      })

      expect(result.success).toBe(true)
      expect(manager.callAdapter).toHaveBeenCalledWith(
        'heygen',
        'generateVideo',
        expect.objectContaining({
          character: 'ava-1',
          voice: 'voice-1',
          script: '这是一段口播文案',
        }),
        expect.any(Object),
      )
      // 数字人不需要画面提示词优化，不应触达 prompt-engine
      expect(optimizeVideoPromptsBatch).not.toHaveBeenCalled()
    }, 20000)

    it('产物形状与通用分支一致（MERGE 可直接消费）', async () => {
      await waitForVideoUrl()
      const manager = makeManager()
      manager.callAdapter = vi.fn(async (providerId, method) => {
        if (method === 'getVideoStatus') return { code: 0, data: { status: 'completed', videoUrl: VIDEO_URL } }
        return { code: 0, data: { taskId: 'dh-task' } }
      })
      const { get } = makePipeline(makeAi(manager))

      const result = await get(VIDEOGEN_STAGE_TYPES.GENERATE)({
        runId: 'run_dh_shape',
        stage: { options: { digitalHuman: true } },
        params: { text: '主题', avatarId: 'ava-1', voiceId: 'voice-1' },
        context: { script: '口播文案' },
      })

      expect(result.output.videos).toHaveLength(1)
      expect(result.output.videos[0].path).toContain('scene_000.mp4')
      expect(Array.isArray(result.output.scenes)).toBe(true)
    }, 20000)

    it('三要素缺失 → AVATAR_INPUTS_INCOMPLETE，不降级成通用视频', async () => {
      const manager = makeManager()
      const { get, optimizeVideoPromptsBatch } = makePipeline(makeAi(manager))

      const result = await get(VIDEOGEN_STAGE_TYPES.GENERATE)({
        runId: 'run_dh_missing',
        stage: { options: { digitalHuman: true } },
        params: { text: '主题', avatarId: 'ava-1' }, // 缺 voiceId
        context: { script: '口播文案' },
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('AVATAR_INPUTS_INCOMPLETE')
      expect(manager.callAdapter).not.toHaveBeenCalled()
      expect(optimizeVideoPromptsBatch).not.toHaveBeenCalled()
    }, 20000)

    it('HeyGen 未配置 → VIDEO_MODEL_NOT_CONFIGURED', async () => {
      const manager = makeManager({ getProvider: () => null })
      const { get } = makePipeline(makeAi(manager))

      const result = await get(VIDEOGEN_STAGE_TYPES.GENERATE)({
        runId: 'run_dh_noprovider',
        stage: { options: { digitalHuman: true } },
        params: { text: '主题', avatarId: 'ava-1', voiceId: 'voice-1' },
        context: { script: '口播文案' },
      })

      expect(result.success).toBe(false)
      expect(result.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
      expect(result.error).toContain('HeyGen')
    }, 20000)

    it('adapter 二层失败（code:0 + data.code:-1）不被吞成成功', async () => {
      const manager = makeManager()
      manager.callAdapter = vi.fn(async () => ({ code: 0, data: { code: -1, message: 'params.character is required' } }))
      const { get } = makePipeline(makeAi(manager))

      const result = await get(VIDEOGEN_STAGE_TYPES.GENERATE)({
        runId: 'run_dh_innerfail',
        stage: { options: { digitalHuman: true } },
        params: { text: '主题', avatarId: 'ava-1', voiceId: 'voice-1' },
        context: { script: '口播文案' },
      })

      expect(result.success).toBe(false)
      expect(result.error).toContain('params.character is required')
    }, 20000)
  })

  describe('GENERATE 执行器 — 通用链路零回归', () => {
    it('未标 digitalHuman 时仍走 prompt-engine + getDefault(video)', async () => {
      await waitForVideoUrl()
      const manager = makeManager()
      manager.callAdapter = vi.fn(async (providerId, method) => {
        if (method === 'getVideoStatus') return { code: 0, data: { status: 'completed', videoUrl: VIDEO_URL } }
        return { code: 0, data: { taskId: 'generic-task' } }
      })
      const { get, optimizeVideoPromptsBatch } = makePipeline(makeAi(manager))

      const result = await get(VIDEOGEN_STAGE_TYPES.GENERATE)({
        runId: 'run_generic',
        stage: { options: {} }, // 无 digitalHuman
        params: { text: '主题' },
        context: { storyboard: [{ prompt: 'p1' }] },
      })

      expect(result.success).toBe(true)
      // 通用链路必须仍打 agnes-video（getDefault('video')），不是 heygen
      expect(manager.callAdapter).toHaveBeenCalledWith(
        'agnes-video', 'generateVideo', expect.objectContaining({ prompt: '[opt] p1' }), expect.any(Object),
      )
      expect(optimizeVideoPromptsBatch).toHaveBeenCalled()
    }, 20000)
  })

  describe('AVATAR 阶段（videogen_avatar）', () => {
    it('产出包含 voiceId（此前缺失，导致 generate 拿不到音色）', async () => {
      const manager = makeManager()
      const { get } = makePipeline(makeAi(manager))

      const result = await get(VIDEOGEN_STAGE_TYPES.AVATAR)({
        runId: 'run_avatar',
        stage: { options: {} },
        params: { text: '主题', avatarId: 'ava-1', voiceId: 'voice-1' },
        context: {},
      })

      expect(result.success).toBe(true)
      expect(result.output).toMatchObject({ avatarId: 'ava-1', voiceId: 'voice-1' })
      expect(typeof result.output.script).toBe('string')
    })

    it('缺主题 → 明确失败，不产出残缺上下文', async () => {
      const manager = makeManager()
      const { get } = makePipeline(makeAi(manager))

      const result = await get(VIDEOGEN_STAGE_TYPES.AVATAR)({
        runId: 'run_avatar', stage: { options: {} }, params: { text: '  ' }, context: {},
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('params.text')
    })
  })
})
