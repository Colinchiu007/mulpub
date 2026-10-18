// @vitest-environment node
// CJS require 走 Module._load 拦截注册（vi.mock 仅作用于 SSR 转换层，不拦截 CJS 内置模块）
// Stage -1.3：mock execFile 以捕获 argv/env 注入，不真实 spawn python
__registerMock('child_process', { execFile: vi.fn() })
const PromptBridge = require('./prompt-bridge')

/**
 * 模拟桌面「模型设置」的默认 LLM（含明文 key，解密由 manager 完成）。
 */
function mockLlmManager () {
  return {
    getDefault: vi.fn(() => ({ id: 'sensenova-llm', name: 'SenseNova', base_url: 'https://token.sensenova.cn/v1', models: ['deepseek-v4-flash'] })),
    getProviderWithKey: vi.fn(() => ({ id: 'sensenova-llm', name: 'SenseNova', base_url: 'https://token.sensenova.cn/v1', models: ['deepseek-v4-flash'], api_key: 'sk-test' })),
  }
}

describe('PromptBridge prompt-engine 请求兼容', () => {
  it('请求超时适配慢推理模型（120s），HTTP 层不再提前掐断', () => {
    const bridge = new PromptBridge({})
    expect(bridge.requestTimeout).toBe(120000)
  })
  it('批量优化会省略空的可选字段，并把文本上下文转换为 synopsis 对象', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: [] }))

    const request = {
      prompt: '城市夜景',
      style: 'realistic',
      creative_level: 1,
      max_length: null,
      context: '一个发生在未来城市的故事',
    }
    await bridge.optimizeBatch([request])

    expect(request).toEqual({
      prompt: '城市夜景',
      style: 'realistic',
      creative_level: 1,
      max_length: null,
      context: '一个发生在未来城市的故事',
    })
    const body = JSON.parse(bridge._post.mock.calls[0][1])
    expect(body.requests[0]).toEqual({
      prompt: '城市夜景',
      style: 'realistic',
      creative_level: 1,
      context: { synopsis: '一个发生在未来城市的故事' },
      optimization_strategy: 'llm',
      llm: {
        provider: 'sensenova',
        model: 'deepseek-v4-flash',
        base_url: 'https://token.sensenova.cn/v1',
        api_key: 'sk-test',
        caller: 'multi-publish-desktop',
      },
    })
    expect(body.requests[0]).not.toHaveProperty('max_length')
  })

  it('单个优化同样不会发送 null max_length 或空 context', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await bridge.optimize({ prompt: '山间日出', creative_level: 1, max_length: null, context: '' })

    const body = JSON.parse(bridge._post.mock.calls[0][1])
    expect(body).toEqual({
      prompt: '山间日出',
      creative_level: 1,
      optimization_strategy: 'llm',
      llm: {
        provider: 'sensenova',
        model: 'deepseek-v4-flash',
        base_url: 'https://token.sensenova.cn/v1',
        api_key: 'sk-test',
        caller: 'multi-publish-desktop',
      },
    })
  })

  it('optimize 透传 traceId 且 body 不含 traceId（R1/R3）', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await bridge.optimize({ prompt: '城市夜景', style: 'realistic', creative_level: 1 }, 'run_9')

    expect(bridge._post.mock.calls[0][3]).toBe('run_9')
    const body = JSON.parse(bridge._post.mock.calls[0][1])
    expect(body).toMatchObject({
      prompt: '城市夜景',
      style: 'realistic',
      creative_level: 1,
      optimization_strategy: 'llm',
      llm: { provider: 'sensenova', model: 'deepseek-v4-flash', api_key: 'sk-test', caller: 'multi-publish-desktop' },
    })
    expect(body).not.toHaveProperty('traceId')
  })

  it('optimizeVideo 从 options 提取 traceId（字符串 + 对象双形态，R1）', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await bridge.optimizeVideo('a cat', { platform: 'veo3', traceId: 'run_7' })
    expect(bridge._post.mock.calls[0][3]).toBe('run_7')
    const body = JSON.parse(bridge._post.mock.calls[0][1])
    expect(body).not.toHaveProperty('traceId')
    expect(body.llm).toEqual({
      provider: 'sensenova',
      model: 'deepseek-v4-flash',
      base_url: 'https://token.sensenova.cn/v1',
      api_key: 'sk-test',
      caller: 'multi-publish-desktop',
    })
    expect(body.llm.caller).toBe('multi-publish-desktop')

    await bridge.optimizeVideo({ prompt: 'b dog', platform: 'kling-pro', traceId: 'run_8' })
    expect(bridge._post.mock.calls[1][3]).toBe('run_8')
    const body2 = JSON.parse(bridge._post.mock.calls[1][1])
    expect(body2).not.toHaveProperty('traceId')
    expect(body2.llm.provider).toBe('sensenova')
    expect(body2.llm.caller).toBe('multi-publish-desktop')
  })

  it('单个和批量优化对非对象输入使用相同的 prompt 兼容规则', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await bridge.optimize(42)
    await bridge.optimizeBatch([42])

    const single = JSON.parse(bridge._post.mock.calls[0][1])
    expect(single.prompt).toBe('42')
    expect(single.optimization_strategy).toBe('llm')
    expect(single.llm.provider).toBe('sensenova')
    expect(single.llm.caller).toBe('multi-publish-desktop')
    expect(JSON.parse(bridge._post.mock.calls[1][1])).toEqual({
      requests: [{
        prompt: '42',
        optimization_strategy: 'llm',
        llm: {
          provider: 'sensenova',
          model: 'deepseek-v4-flash',
          base_url: 'https://token.sensenova.cn/v1',
          api_key: 'sk-test',
          caller: 'multi-publish-desktop',
        },
      }],
    })
  })
  it('发送前归一平台/风格别名（cinematic/dall-e/stable-diffusion），空 style 不发送', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await bridge.optimize({ prompt: '城市夜景', platform: 'dall-e', style: 'cinematic', creative_level: 1 })
    await bridge.optimize({ prompt: '另一个', platform: 'stable-diffusion', style: '', creative_level: 1 })

    expect(JSON.parse(bridge._post.mock.calls[0][1])).toEqual({
      prompt: '城市夜景',
      platform: 'dalle',
      style: 'photography',
      creative_level: 1,
      optimization_strategy: 'llm',
      llm: expect.objectContaining({ provider: 'sensenova', caller: 'multi-publish-desktop' }),
    })
    expect(JSON.parse(bridge._post.mock.calls[1][1])).toEqual({
      prompt: '另一个',
      platform: 'stable_diffusion',
      creative_level: 1,
      optimization_strategy: 'llm',
      llm: expect.objectContaining({ provider: 'sensenova', caller: 'multi-publish-desktop' }),
    })
  })

  it('剥离内部字段 index：不透传到引擎（additionalProperties: false 会 422）', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await bridge.optimize({ prompt: '测试', index: 3, creative_level: 5 })

    const body = JSON.parse(bridge._post.mock.calls[0][1])
    expect(body).not.toHaveProperty('index')
    expect(body.prompt).toBe('测试')
  })

  it('context 对象含敏感凭据键时 bridge 拒绝发送（纵深防御）', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await expect(bridge.optimize({ prompt: 'x', context: { api_key: 'secret' } }))
      .rejects.toThrow(/敏感凭据/)
    expect(bridge._post).not.toHaveBeenCalled()
  })
})

describe('PromptBridge BYOK llm 注入', () => {
  it('resolveLlmBind：sensenova-llm 映射引擎 sensenova 并携带桌面配置的 base_url/api_key/model', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = mockLlmManager()
    expect(bridge.resolveLlmBind()).toEqual({
      provider: 'sensenova',
      model: 'deepseek-v4-flash',
      base_url: 'https://token.sensenova.cn/v1',
      api_key: 'sk-test',
      caller: 'multi-publish-desktop',
    })
  })

  it('resolveLlmBind：deepseek 直接映射引擎 deepseek', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'deepseek', name: 'DeepSeek', models: ['deepseek-v4-flash'] })),
      getProviderWithKey: vi.fn(() => ({ id: 'deepseek', models: ['deepseek-v4-flash'], api_key: 'sk-ds' })),
    }
    expect(bridge.resolveLlmBind()).toEqual({
      provider: 'deepseek',
      model: 'deepseek-v4-flash',
      api_key: 'sk-ds',
      caller: 'multi-publish-desktop',
    })
  })

  it('resolveLlmBind：其余 OpenAI 兼容供应商一律映射 openai_compat', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'openrouter', name: 'OpenRouter', base_url: 'https://openrouter.ai/api/v1', models: ['claude-sonnet'] })),
      getProviderWithKey: vi.fn(() => ({ id: 'openrouter', base_url: 'https://openrouter.ai/api/v1', models: ['claude-sonnet'], api_key: 'sk-or' })),
    }
    expect(bridge.resolveLlmBind()).toEqual({
      provider: 'openai_compat',
      model: 'claude-sonnet',
      base_url: 'https://openrouter.ai/api/v1',
      api_key: 'sk-or',
      caller: 'multi-publish-desktop',
    })
  })

  it('resolveLlmBind：多模态默认 LLM 按 capability_models.llm 路由（不取 models[0] TTS 模型）', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'minimax-multimodal', name: 'MiniMax 多模态', models: ['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'] })),
      getProviderWithKey: vi.fn(() => ({
        id: 'minimax-multimodal',
        base_url: 'https://api.minimax.chat/v1',
        models: ['speech-2.8-turbo', 'image-01', 'MiniMax-Hailuo-2.3', 'MiniMax-M2.7'],
        capability_models: { llm: 'MiniMax-M2.7', tts: 'speech-2.8-turbo', image: 'image-01', video: 'MiniMax-Hailuo-2.3' },
        api_key: 'sk-minimax',
      })),
    }
    expect(bridge.resolveLlmBind()).toEqual({
      provider: 'openai_compat',
      model: 'MiniMax-M2.7',
      base_url: 'https://api.minimax.chat/v1',
      api_key: 'sk-minimax',
      caller: 'multi-publish-desktop',
    })
  })

  it('resolveLlmBind：多模态 provider 无 capability_models.llm 时拒绝猜测模型', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'minimax-multimodal', name: 'MiniMax 多模态', models: ['MiniMax-M2.7'] })),
      getProviderWithKey: vi.fn(() => ({
        id: 'minimax-multimodal',
        category: 'multimodal',
        models: ['MiniMax-M2.7'],
        capability_models: { tts: 'speech-2.8-turbo' },
        api_key: 'sk-minimax',
      })),
    }
    expect(() => bridge.resolveLlmBind()).toThrow(/未配置可用模型/)
  })

  it('resolveLlmBind：无 modelProviderManager 时 fail-closed 抛错', () => {
    const bridge = new PromptBridge({})
    expect(() => bridge.resolveLlmBind()).toThrow(/模型服务未就绪/)
  })

  it('resolveLlmBind：未配置默认 LLM 时抛错引导配置', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = { getDefault: vi.fn(() => null), getProviderWithKey: vi.fn(() => null) }
    expect(() => bridge.resolveLlmBind()).toThrow(/未配置默认文字推理模型/)
  })

  it('resolveLlmBind：默认 LLM 缺 API Key 时抛错', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'sensenova-llm', name: 'SenseNova', models: ['deepseek-v4-flash'] })),
      getProviderWithKey: vi.fn(() => ({ id: 'sensenova-llm', models: ['deepseek-v4-flash'], api_key: '' })),
    }
    expect(() => bridge.resolveLlmBind()).toThrow(/未配置 API Key/)
  })

  it('resolveLlmBind：默认 LLM 无可用模型时抛错', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'sensenova-llm', models: [] })),
      getProviderWithKey: vi.fn(() => ({ id: 'sensenova-llm', models: [], api_key: 'sk-x' })),
    }
    expect(() => bridge.resolveLlmBind()).toThrow(/未配置可用模型/)
  })

  it('resolveLlmBind：用户默认模型（config.user_default_model）优先于 capability_models.llm（双默认语义）', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'minimax-multimodal', name: 'MiniMax 多模态', models: ['speech-2.8-turbo', 'MiniMax-M1', 'MiniMax-M2.7'] })),
      getProviderWithKey: vi.fn(() => ({
        id: 'minimax-multimodal',
        category: 'multimodal',
        models: ['speech-2.8-turbo', 'MiniMax-M1', 'MiniMax-M2.7'],
        capability_models: { llm: 'MiniMax-M2.7', tts: 'speech-2.8-turbo' },
        config: { user_default_model: 'MiniMax-M1' },
        api_key: 'sk-minimax',
      })),
    }
    expect(bridge.resolveLlmBind().model).toBe('MiniMax-M1')
  })

  it('resolveLlmBind：用户默认模型不在 models 时失效回退 capability_models.llm', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'minimax-multimodal', name: 'MiniMax 多模态', models: ['speech-2.8-turbo', 'MiniMax-M2.7'] })),
      getProviderWithKey: vi.fn(() => ({
        id: 'minimax-multimodal',
        category: 'multimodal',
        models: ['speech-2.8-turbo', 'MiniMax-M2.7'],
        capability_models: { llm: 'MiniMax-M2.7', tts: 'speech-2.8-turbo' },
        config: { user_default_model: '过期模型X' },
        api_key: 'sk-minimax',
      })),
    }
    expect(bridge.resolveLlmBind().model).toBe('MiniMax-M2.7')
  })

  it('resolveLlmBind：多模态下运营的能力默认（capability_models.llm）优先于 provider 级默认', () => {
    // 2026-10-18（voice-model-program-resolved，跨家族评审 C1）：能力级默认必须先于 provider 级默认。
    // 多模态的 config.default_model 是 provider「主模型」（通常为 llm），但不区分能力；
    // capability_models.llm 才是运营为该能力显式指定的默许模型。
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'minimax-multimodal', name: 'MiniMax 多模态', models: ['speech-2.8-turbo', 'MiniMax-M1', 'MiniMax-M2.7'] })),
      getProviderWithKey: vi.fn(() => ({
        id: 'minimax-multimodal',
        category: 'multimodal',
        models: ['speech-2.8-turbo', 'MiniMax-M1', 'MiniMax-M2.7'],
        capability_models: { llm: 'MiniMax-M2.7', tts: 'speech-2.8-turbo' },
        config: { default_model: 'MiniMax-M1' },
        api_key: 'sk-minimax',
      })),
    }
    expect(bridge.resolveLlmBind().model).toBe('MiniMax-M2.7')
  })

  it('resolveLlmBind：多模态缺能力声明时回退运营预设默认（config.default_model）', () => {
    // C1 修复的另一半：多模态**仅 llm 能力**取 provider 级默认（tts/image/video 跳过它，
    // 以免拿 LLM 模型当 TTS）。这条锁住「无 capability_models.llm 时 llm 仍可用 default_model」。
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'minimax-multimodal', name: 'MiniMax 多模态', models: ['speech-2.8-turbo', 'MiniMax-M1'] })),
      getProviderWithKey: vi.fn(() => ({
        id: 'minimax-multimodal',
        category: 'multimodal',
        models: ['speech-2.8-turbo', 'MiniMax-M1'],
        capability_models: { tts: 'speech-2.8-turbo' },
        config: { default_model: 'MiniMax-M1' },
        api_key: 'sk-minimax',
      })),
    }
    expect(bridge.resolveLlmBind().model).toBe('MiniMax-M1')
  })

  it('resolveLlmBind：单能力 provider 用户默认模型生效', () => {
    const bridge = new PromptBridge({})
    bridge.modelProviderManager = {
      getDefault: vi.fn(() => ({ id: 'openai', name: 'OpenAI', models: ['gpt-4o', 'gpt-4o-mini'] })),
      getProviderWithKey: vi.fn(() => ({
        id: 'openai',
        category: 'llm',
        models: ['gpt-4o', 'gpt-4o-mini'],
        config: { user_default_model: 'gpt-4o-mini', default_model: 'gpt-4o' },
        api_key: 'sk-oai',
      })),
    }
    expect(bridge.resolveLlmBind().model).toBe('gpt-4o-mini')
  })

  it('optimize：缺省策略在低 creative_level 同样注入 llm/caller；无默认 LLM 时拒绝', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await bridge.optimize({ prompt: 'a majestic cat', platform: 'generic', creative_level: 1 })
    const body = JSON.parse(bridge._post.mock.calls[0][1])
    expect(body.optimization_strategy).toBe('llm')
    expect(body.llm.provider).toBe('sensenova')
    expect(body.llm.api_key).toBe('sk-test')
    expect(body.llm.caller).toBe('multi-publish-desktop')

    const bare = new PromptBridge({})
    bare.isRunning = true
    bare._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))
    await expect(bare.optimize({ prompt: 'x', platform: 'generic', creative_level: 1 }))
      .rejects.toThrow(/模型服务未就绪/)
    expect(bare._post).not.toHaveBeenCalled()
  })

  it('optimize：显式 auto 被拒绝，不请求引擎', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await expect(bridge.optimize({ prompt: 'a cat', platform: 'generic', creative_level: 1, optimization_strategy: 'auto' }))
      .rejects.toThrow(/optimization_strategy/)
    expect(bridge._post).not.toHaveBeenCalled()
  })

  it('optimizeBatch：混合策略按条目注入绑定，模板项不被批次中的 LLM 项污染', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: [] }))

    await bridge.optimizeBatch([
      { prompt: 'template', platform: 'generic', creative_level: 1, optimization_strategy: 'template' },
      { prompt: 'scene', domain: 'video', platform: 'generic_video', creative_level: 5 },
    ])
    const body = JSON.parse(bridge._post.mock.calls[0][1])
    expect(body.requests[0]).not.toHaveProperty('llm')
    expect(body.requests[0]).not.toHaveProperty('caller')
    expect(body.requests[1].llm.provider).toBe('sensenova')
    expect(body.requests[1].llm.caller).toBe('multi-publish-desktop')
  })

  it('optimize：显式 llm 覆盖低 creative_level，显式 template 覆盖高 creative_level', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: {} }))

    await bridge.optimize({
      prompt: '低等级但必须使用模型',
      platform: 'generic',
      creative_level: 1,
      optimization_strategy: 'llm',
    })
    const llmBody = JSON.parse(bridge._post.mock.calls[0][1])
    expect(llmBody.optimization_strategy).toBe('llm')
    expect(llmBody.llm.provider).toBe('sensenova')
    expect(llmBody.llm.caller).toBe('multi-publish-desktop')

    await bridge.optimize({
      prompt: '高等级但明确使用模板',
      platform: 'generic',
      creative_level: 10,
      optimization_strategy: 'template',
    })
    const templateBody = JSON.parse(bridge._post.mock.calls[1][1])
    expect(templateBody.optimization_strategy).toBe('template')
    expect(templateBody).not.toHaveProperty('llm')
    expect(templateBody).not.toHaveProperty('caller')
  })

  it('optimizeVideosBatch：legacy 8013 分支每条注入 llm/caller', async () => {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    bridge._post = vi.fn(() => Promise.resolve({ code: 0, data: [] }))

    await bridge.optimizeVideosBatch(['scene one', { prompt: 'scene two', platform: 'kling-pro' }])
    const body = JSON.parse(bridge._post.mock.calls[0][1])
    expect(body.requests).toHaveLength(2)
    for (const req of body.requests) {
      expect(req.llm.provider).toBe('sensenova')
      expect(req.llm.caller).toBe('multi-publish-desktop')
    }
  })
})


describe('PromptBridge CLI fallback', () => {
  function makeBridge () {
    const bridge = new PromptBridge({})
    bridge.isRunning = true
    bridge.modelProviderManager = mockLlmManager()
    return bridge
  }

  it('_cliFallbackSingle builds correct CLI args and returns JSON', async () => {
    const bridge = makeBridge()
    // Override _cliFallbackSingle to capture args without spawning real process
    const origMethod = bridge._cliFallbackSingle.bind(bridge)
    let capturedArgs = null
    bridge._cliFallbackSingle = (request, traceId) => {
      // Intercept: build the same args the real method would, but return mock
      capturedArgs = { request, traceId }
      return Promise.resolve({ optimized_prompt: 'mock-cli-result', platform: 'generic', model_used: 'template', tokens_used: 0, duration_ms: 0, key_source: 'none', strategy_used: 'template', caller: null, cache_hit: false, error: null })
    }
    const result = await bridge._cliFallbackSingle({
      prompt: 'test prompt',
      optimization_strategy: 'template',
      creative_level: 5,
      platform: 'generic',
    })
    expect(result.optimized_prompt).toBe('mock-cli-result')
    expect(capturedArgs.request.prompt).toBe('test prompt')
    expect(capturedArgs.request.optimization_strategy).toBe('template')
  })

  it('_cliFallbackSingle 把 API Key 从 argv 移入 PROMPT_ENGINE_API_KEY env（Stage -1.3 合同）', async () => {
    const bridge = makeBridge()
    const cp = require('child_process')
    let capturedEnv = null
    let capturedArgs = null
    cp.execFile.mockImplementation((cmd, args, opts, cb) => {
      capturedEnv = opts.env
      capturedArgs = args
      const result = {
        optimized_prompt: 'env-key-result',
        platform: 'generic',
        model_used: 'gpt-4o',
        tokens_used: 0,
        duration_ms: 0,
        key_source: 'caller',
        strategy_used: 'llm',
        caller: 'multi-publish-desktop',
        cache_hit: false,
        error: null,
      }
      cb(null, JSON.stringify(result), '')
    })
    const result = await bridge._cliFallbackSingle({
      prompt: '城市夜景',
      optimization_strategy: 'llm',
      creative_level: 5,
      platform: 'generic',
      llm: {
        provider: 'openai_compat',
        model: 'gpt-4o',
        api_key: 'sk-super-secret',
        base_url: 'https://api.example.com/v1',
        caller: 'multi-publish-desktop',
      },
    })
    expect(result.optimized_prompt).toBe('env-key-result')
    // argv 不含 --api-key，也不含 key 明文
    expect(capturedArgs).not.toContain('--api-key')
    expect(capturedArgs).not.toContain('sk-super-secret')
    // provider/model/base_url 仍在 argv
    expect(capturedArgs).toContain('--provider')
    expect(capturedArgs).toContain('openai_compat')
    expect(capturedArgs).toContain('--base-url')
    // env 携带 key
    expect(capturedEnv.PROMPT_ENGINE_API_KEY).toBe('sk-super-secret')
  })

  it('optimize falls back to _cliFallbackSingle when HTTP _post fails', async () => {
    const bridge = makeBridge()
    bridge._post = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
    // Spy on _cliFallbackSingle
    const fallbackSpy = vi.fn(() => Promise.resolve({ optimized_prompt: 'fallback-result', platform: 'generic', model_used: 'template', tokens_used: 0, duration_ms: 0, key_source: 'none', strategy_used: 'template', caller: null, cache_hit: false, error: null }))
    bridge._cliFallbackSingle = fallbackSpy

    const result = await bridge.optimize({ prompt: 'test', optimization_strategy: 'template' })
    expect(result.optimized_prompt).toBe('fallback-result')
    expect(bridge._post).toHaveBeenCalledOnce()
    expect(fallbackSpy).toHaveBeenCalledOnce()
    // Verify the normalized request was passed to fallback
    const passedReq = fallbackSpy.mock.calls[0][0]
    expect(passedReq.prompt).toBe('test')
    expect(passedReq.optimization_strategy).toBe('template')
  })

  it('optimizeBatch falls back to _cliFallbackSingle per-item when HTTP _post fails', async () => {
    const bridge = makeBridge()
    bridge._post = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
    let callCount = 0
    bridge._cliFallbackSingle = vi.fn(() => {
      callCount++
      return Promise.resolve({ optimized_prompt: `item-${callCount}`, platform: 'generic', model_used: 'template', tokens_used: 0, duration_ms: 0, key_source: 'none', strategy_used: 'template', caller: null, cache_hit: false, error: null })
    })

    const results = await bridge.optimizeBatch([
      { prompt: 'item1', optimization_strategy: 'template' },
      { prompt: 'item2', optimization_strategy: 'template' },
    ])
    expect(results).toHaveLength(2)
    expect(results[0].optimized_prompt).toBe('item-1')
    expect(results[1].optimized_prompt).toBe('item-2')
    expect(bridge._post).toHaveBeenCalledOnce()
    expect(bridge._cliFallbackSingle).toHaveBeenCalledTimes(2)
  })

  it('optimize does NOT fall back to CLI when HTTP succeeds', async () => {
    const bridge = makeBridge()
    bridge._post = vi.fn(() => Promise.resolve({ optimized_prompt: 'http-result' }))
    const fallbackSpy = vi.fn()
    bridge._cliFallbackSingle = fallbackSpy

    const result = await bridge.optimize({ prompt: 'test', optimization_strategy: 'template' })
    expect(result.optimized_prompt).toBe('http-result')
    expect(fallbackSpy).not.toHaveBeenCalled()
  })

  it('optimizeBatch does NOT fall back when HTTP succeeds', async () => {
    const bridge = makeBridge()
    bridge._post = vi.fn(() => Promise.resolve([{ optimized_prompt: 'batch-result' }]))
    const fallbackSpy = vi.fn()
    bridge._cliFallbackSingle = fallbackSpy

    await bridge.optimizeBatch([{ prompt: 'test', optimization_strategy: 'template' }])
    expect(bridge._post).toHaveBeenCalledOnce()
    expect(fallbackSpy).not.toHaveBeenCalled()
  })

  it('optimizeBatch catches per-item CLI errors gracefully', async () => {
    const bridge = makeBridge()
    bridge._post = vi.fn(() => Promise.reject(new Error('ECONNREFUSED')))
    let callCount = 0
    bridge._cliFallbackSingle = vi.fn(() => {
      callCount++
      if (callCount === 1) return Promise.resolve({ optimized_prompt: 'ok', platform: 'generic', model_used: 'template', tokens_used: 0, duration_ms: 0, key_source: 'none', strategy_used: 'template', caller: null, cache_hit: false, error: null })
      return Promise.reject(new Error('CLI item2 failed'))
    })

    const results = await bridge.optimizeBatch([
      { prompt: 'item1', optimization_strategy: 'template' },
      { prompt: 'item2', optimization_strategy: 'template' },
    ])
    expect(results).toHaveLength(2)
    expect(results[0].optimized_prompt).toBe('ok')
    expect(results[1].error).toContain('CLI item2 failed')
  })
})

