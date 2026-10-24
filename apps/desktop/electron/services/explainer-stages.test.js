// @vitest-environment node
const {
  registerExplainerStages,
  EXPLAINER_STAGE_TYPES,
  parseScenesArray,
} = require('./explainer-stages')
const { buildScenePlan } = require('./explainer/explainer-prod-artifacts')

function makeStageExecutor() {
  const executors = new Map()
  return {
    executors,
    register(type, fn) { executors.set(type, fn) },
  }
}

function makePipeline(aiGenerator, innerExecutor) {
  const stageExecutor = makeStageExecutor()
  const pipeline = {
    stageExecutor,
    aiGenerator,
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() },
    registerStageExecutor(type, fn) {
      stageExecutor.register(type, fn)
      return { success: true }
    },
  }
  if (innerExecutor) {
    stageExecutor.execute = innerExecutor
  }
  const reg = registerExplainerStages(pipeline)
  const get = (type) => stageExecutor.executors.get(type)
  return { pipeline, get, reg }
}

function makeAi(content) {
  return {
    _modelProviderManager: {
      getDefault: () => ({ id: 'agnes-llm', models: ['agnes-2.0-flash'] }),
    },
    generateWithDefault: vi.fn(async () => ({ content, model: 'agnes-2.0-flash' })),
  }
}

/**
 * P2a 契约变更后的**输入夹具**（2026-10-24）。
 *
 * ⚠ 改的是**输入形态**（LLM 从「散文」改为「上游 artifact 的 JSON」），
 *   **不是**改断言意图 —— 原用例在意的仍是「research 能用默认 LLM 产出结果」
 *   「proposal 依赖 context.research」「script 依赖 context.proposal」「空内容会重试」。
 * ⚠ 夹具必须**同时满足**上游 schema 与计数型 success_criteria
 *   （research_brief：≥3 data_points / ≥3 angles / ≥5 条带 url 的 sources；
 *     proposal_packet：≥3 concept_options + ≥1 条 line_items + selected_concept 有效引用）。
 */
function makeResearchBriefJson () {
  const sources = [1, 2, 3, 4, 5].map(i => ({ url: 'https://example.com/s' + i, title: '来源' + i, reliability: 'primary' }))
  const dataPoints = [1, 2, 3].map(i => ({
    claim: i === 1 ? '起源' : '数据点' + i,
    source_url: 'https://example.com/d' + i,
    credibility: 'primary_source',
    surprise_factor: 'notable',
  }))
  const angles = [1, 2, 3].map(i => ({
    name: '角度' + i,
    hook: '钩子' + i,
    type: 'trending',
    why_now: '因为研究结论' + i,
    grounded_in: ['data_points[0]'],
  }))
  return JSON.stringify({
    topic: '人工智能的历史',
    research_date: '2026-10-24',
    landscape: {
      existing_content: [{ title: '既有内容', url: 'https://example.com/e1', source: 'ex', angle: '历史' }],
      saturated_angles: ['已被讲透的角度'],
      underserved_gaps: ['被忽略的角度'],
    },
    data_points: dataPoints,
    audience_insights: {
      common_questions: ['这和我有什么关系？'],
      misconceptions: [{ myth: '误解', reality: '事实', source: 'https://example.com/m1' }],
      knowledge_level: '入门',
      pain_points: ['看不懂术语'],
    },
    angles_discovered: angles,
    sources: sources,
    research_summary: '人工智能的历史可分三段。',
  })
}

function makeProposalPacketJson () {
  const concept = (id, title, narrative) => ({
    id, title, hook: '钩子-' + title,
    narrative_structure: narrative,
    visual_approach: '时间线 + 数据卡',
    suggested_playbook: 'clean-professional',
    target_audience: '泛科技读者',
    target_platform: 'youtube',
    target_duration_seconds: 60,
    key_points: ['要点1', '要点2'],
    core_message: '核心信息',
    tone: '平实',
    grounded_in: ['data_points[0]'],
    why_this_works: '因为有研究支撑',
  })
  return JSON.stringify({
    concept_options: [
      concept('c1', '历史主线', 'journey'),
      concept('c2', '算力视角', 'problem_solution'),
      concept('c3', '产业视角', 'debate'),
    ],
    selected_concept: { concept_id: 'c1', rationale: '覆盖面最广', modifications: [] },
    production_plan: {
      pipeline: 'animated-explainer',
      playbook: 'clean-professional',
      stages: [{ stage: 'assets', tools: ['image_selector', 'tts_selector'], approach: '逐场景生成' }],
      quality_tradeoffs: [{ tradeoff: '速度 vs 质量', recommendation: '优先质量', quality_impact: 'medium' }],
      alternative_paths: [],
      delivery_promise: { promise_type: 'data_explainer', motion_required: true, source_required: false, tone_mode: 'conversational', quality_floor: 'presentable' },
      renderer_family: 'explainer-data',
      render_runtime: 'remotion',
      composition_mode: 'templated',
      art_direction: '冷静克制',
      voice_selection: { provider: 'edge-tts', voice_id: 'zh-CN-XiaoxiaoNeural', rationale: '中文女声', sample_approval_required: true },
    },
    cost_estimate: {
      total_estimated_usd: 0,
      line_items: [{ tool: 'image_selector', operation: 'per scene', quantity: 8, estimated_usd: 0, notes: '单价未知（无价格卡）' }],
      budget_verdict: 'within_budget',
    },
    approval: { status: 'pending', user_notes: '' },
  })
}

function makeScriptJson () {
  return JSON.stringify({
    title: '人工智能的历史',
    total_duration_seconds: 60,
    voice_performance: { performance_intent: '讲清楚', pacing_profile: 'conversational', energy_curve: '平→高→平', pause_policy: '段落间停 0.4s', sample_section_id: 'section-1', provider_notes: { key: 'value' } },
    sections: [
      {
        id: 'section-1', label: '起源', text: '人工智能的故事要从图灵讲起。', start_seconds: 0, end_seconds: 20,
        speaker_directions: '平缓',
        delivery_cues: { pace: 'measured', energy: '中', emphasis_words: ['图灵'], pause_before_seconds: 0, pause_after_seconds: 0.4, delivery_note: '句末略停', provider_text: '人工智能的故事要从图灵讲起。' },
        enhancement_cues: [{ type: 'overlay', description: '时间线', duration_seconds: 3 }],
      },
    ],
  })
}

function makeAiSequence(contents) {
  const calls = []
  return {
    calls,
    _modelProviderManager: {
      getDefault: () => ({ id: 'agnes-llm', models: ['agnes-2.0-flash'] }),
    },
    generateWithDefault: vi.fn(async () => {
      const content = contents.length > 1 ? contents.shift() : contents[0]
      calls.push(content)
      return { content, model: 'agnes-2.0-flash' }
    }),
  }
}
describe('animated-explainer 阶段执行器', () => {
  it('注册全部 8 个自定义阶段类型（P2b 新增 compose / publish 专属 type）', () => {
    const { reg, get } = makePipeline(makeAi('x'))
    expect(reg.success).toBe(true)
    expect(reg.registered).toHaveLength(8)
    for (const type of Object.values(EXPLAINER_STAGE_TYPES)) {
      expect(get(type)).toBeTypeOf('function')
    }
  })

  describe('research 阶段', () => {
    it('用默认 LLM 生成大纲', async () => {
      const ai = makeAi(makeResearchBriefJson())
      const { get } = makePipeline(ai)
      const result = await get(EXPLAINER_STAGE_TYPES.RESEARCH)({
        stage: {},
        params: { text: '人工智能的历史' },
        context: {},
      })
      expect(result.success).toBe(true)
      // ⚠ 契约变更：research 的产物从「散文大纲」变成**上游 research_brief 对象**
      expect(result.output.data_points[0].claim).toContain('起源')
      expect(ai.generateWithDefault).toHaveBeenCalledWith('llm', expect.objectContaining({
        messages: expect.arrayContaining([
          expect.objectContaining({ role: 'user', content: expect.stringContaining('人工智能的历史') }),
        ]),
      }))
    })

    it('用结构化 key 上报开始与完成摘要', async () => {
      const { get } = makePipeline(makeAi(makeResearchBriefJson()))
      const progress = vi.fn()
      const result = await get(EXPLAINER_STAGE_TYPES.RESEARCH)({
        stage: {}, params: { text: '主题' }, context: {}, onProgress: progress,
      })
      expect(result.success).toBe(true)
      expect(progress.mock.calls.map(([event]) => event.percent)).toEqual([0, 100])
      expect(progress.mock.calls[0][0].messageKey).toBe('stageProgress.explainerResearch')
      expect(progress.mock.calls[1][0]).toMatchObject({
        summaryKey: 'stageProgress.explainerResearchSummary',
      })
    })

    it('缺少主题时失败', async () => {
      const { get } = makePipeline(makeAi('x'))
      const result = await get(EXPLAINER_STAGE_TYPES.RESEARCH)({
        stage: {}, params: {}, context: {},
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('非空主题')
    })

    it('未配置默认 LLM 时失败', async () => {
      const { get } = makePipeline({
        generateWithDefault: vi.fn(async () => ({ content: 'x' })),
      })
      const result = await get(EXPLAINER_STAGE_TYPES.RESEARCH)({
        stage: {}, params: { text: '主题' }, context: {},
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('未找到需要的相关模型')
    })

    it('LLM 返回空内容时失败', async () => {
      const { get } = makePipeline(makeAi('   '))
      const result = await get(EXPLAINER_STAGE_TYPES.RESEARCH)({
        stage: {}, params: { text: '主题' }, context: {},
      })
      expect(result.success).toBe(false)
      expect(result.error).toContain('返回空内容')
    })
  })

  describe('proposal / script 阶段', () => {
    it('proposal 依赖 context.research', async () => {
      const { get } = makePipeline(makeAi(makeProposalPacketJson()))
      const missing = await get(EXPLAINER_STAGE_TYPES.PROPOSAL)({
        stage: {}, params: {}, context: {},
      })
      expect(missing.success).toBe(false)
      const ok = await get(EXPLAINER_STAGE_TYPES.PROPOSAL)({
        stage: {}, params: {}, context: { research: JSON.parse(makeResearchBriefJson()) },
      })
      expect(ok.success).toBe(true)
    })

    it('script 依赖 context.proposal', async () => {
      const { get } = makePipeline(makeAi(makeScriptJson()))
      const missing = await get(EXPLAINER_STAGE_TYPES.SCRIPT)({
        stage: {}, params: {}, context: {},
      })
      expect(missing.success).toBe(false)
      const ok = await get(EXPLAINER_STAGE_TYPES.SCRIPT)({
        stage: {}, params: {}, context: { proposal: JSON.parse(makeProposalPacketJson()) },
      })
      expect(ok.success).toBe(true)
    })
  })
})

describe('scenes 阶段与 JSON 解析', () => {
  const scenesJson = JSON.stringify([
    { prompt: '海边日出，暖色调', text: '清晨，太阳从海平面升起。', duration: 6 },
    { prompt: '沙滩上的脚印', text: '潮水轻轻拍打沙滩。', duration: 5 },
  ])

  it('解析带 markdown 围栏的 LLM 输出', () => {
    expect(parseScenesArray('```json\n' + scenesJson + '\n```')).toHaveLength(2)
    expect(parseScenesArray('说明文字。' + scenesJson + '结束。')).toHaveLength(2)
    expect(parseScenesArray('没有数组')).toBeNull()
  })

  it('buildScenePlan 过滤无效项并限制数量与默认时长', () => {
    // ⚠ P2b 契约变更：旧的 normalizeScenes 已被 buildScenePlan 取代
    //   （**同一意图**：过滤无效项 / 限数量 / 默认时长），测试随之迁移而非删除。
    const plan = buildScenePlan({
      scenes: [
        { type: 'broll', description: '主体一', duration: 6 },
        { type: 'broll', description: '', duration: 6 },
        { duration: 6 },
        { type: 'diagram', description: '主体三', duration: 99 },
      ],
    }, { targetDurationSeconds: 0 })
    expect(plan.scenes).toHaveLength(4)
    // 无描述的场景仍保留（描述缺失由「未指定」承担），但缺 type 的回落 generated
    expect(plan.scenes[0].type).toBe('broll')
    expect(plan.scenes[2].type).toBe('generated')
    expect(plan.scenes[3].end_seconds).toBeGreaterThan(0)
  })

  it('scenes 阶段输出上游 scene_plan artifact', async () => {
    // ⚠ P2b 契约变更：产物从「场景数组」变成 **scene_plan 对象**
    //   （旧的 prompt/text 字段由 description + script_section_id 关联承载）
    const ai = makeAi('```json\n' + scenesJson + '\n```')
    const { get } = makePipeline(ai)
    const result = await get(EXPLAINER_STAGE_TYPES.SCENES)({
      stage: {},
      params: {},
      context: { script: '旁白文案。' },
    })
    expect(result.success).toBe(true)
    expect(result.output.version).toBe('1.0')
    expect(result.output.scenes).toHaveLength(2)
    expect(result.output.scenes[0].description).toBe('海边日出，暖色调')
    expect(result.output.scenes[0].end_seconds).toBeGreaterThan(0)
  })

  it('scenes 阶段完成时上报场景计数摘要', async () => {
    const ai = makeAi(scenesJson)
    const { get } = makePipeline(ai)
    const progress = vi.fn()
    const result = await get(EXPLAINER_STAGE_TYPES.SCENES)({
      stage: {}, params: {}, context: { script: '旁白文案。' }, onProgress: progress,
    })
    expect(result.success).toBe(true)
    expect(progress.mock.calls.at(-1)[0]).toMatchObject({
      percent: 100,
      summaryKey: 'stageProgress.explainerScenesSummary',
      summaryParams: { count: 2 },
      detail: { done: 2, total: 2, kind: 'scene' },
    })
  })

  it('scenes 阶段解析失败时用行级兜底继续（长文案）', async () => {
    const { get } = makePipeline(makeAi('抱歉，我无法生成。'))
    const result = await get(EXPLAINER_STAGE_TYPES.SCENES)({
      stage: {},
      params: {},
      context: { script: '第一段旁白。\n\n第二段旁白。' },
    })
    expect(result.success).toBe(true)
    expect(result.output.scenes.length).toBeGreaterThanOrEqual(1)
    expect(result.output.scenes[0].description).toContain('第一段旁白')
  })

  it('scenes 阶段 JSON 与兜底都失败时报可行动错误（含原始片段）', async () => {
    const { get } = makePipeline(makeAi('抱歉，我无法生成。'))
    const result = await get(EXPLAINER_STAGE_TYPES.SCENES)({
      stage: {},
      params: {},
      context: { script: 'x' },
    })
    expect(result.success).toBe(false)
    expect(result.error).toContain('无法解析场景')
    expect(result.error).toContain('抱歉，我无法生成')
  })
})

describe('generate_assets 适配与 editing', () => {
  it('generate_assets 通过适配 context 复用 story2video 执行器', async () => {
    const inner = vi.fn(async () => ({ success: true, output: { scenes: [{ text: 'x' }] } }))
    const { get } = makePipeline(makeAi('x'), inner)
    // ⚠ P2b：输入换成 scene_plan（双形态适配的新形态那一支）
    const scenePlan = buildScenePlan({
      scenes: [{ id: 'scene-1', type: 'broll', description: '主体', duration: 6, shot_language: { shot_size: 'medium' } }],
    }, {})
    const result = await get(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)({
      runId: 'run_1',
      stage: { options: { concurrency: 2 } },
      params: {},
      context: { scene_plan: scenePlan, script: { sections: [{ id: 's1', text: '旁白', start_seconds: 0, end_seconds: 6 }] } },
      onProgress: vi.fn(),
    })
    expect(result.success).toBe(true)
    expect(inner).toHaveBeenCalledWith(expect.objectContaining({
      stage: expect.objectContaining({ name: 'assets', type: 'story2video_generate_assets' }),
      context: expect.objectContaining({
        optimize: [expect.objectContaining({ prompt: expect.stringContaining('镜头：medium') })],
      }),
      onProgress: expect.any(Function),
    }))
  })

  it('generate_assets 兼容旧形态（断点续跑的旧 run 上下文里仍是场景数组）', async () => {
    // ⚠ **双形态适配**的旧形态那一支：P2b 之前 scenes 阶段输出的是 [{prompt,text,duration}] 数组
    const inner = vi.fn(async () => ({ success: true, output: { scenes: [{ text: 'x' }] } }))
    const { get } = makePipeline(makeAi('x'), inner)
    const scenes = [{ prompt: 'p1', text: 't1', duration: 6 }]
    const result = await get(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)({
      runId: 'run_1', stage: { options: {} }, params: {}, context: { scenes }, onProgress: vi.fn(),
    })
    expect(result.success).toBe(true)
    expect(inner).toHaveBeenCalledWith(expect.objectContaining({
      context: expect.objectContaining({
        optimize: [{ optimized_prompt: 'p1', prompt: 'p1' }],
        split: scenes,
      }),
    }))
  })

  it('generate_assets 未指定 provider 时解析默认图片/TTS provider', async () => {
    const ai = makeAi('x')
    ai._modelProviderManager.getDefault = vi.fn((type) => {
      if (type === 'image') return { id: 'minimax-image', models: ['image-01'] }
      if (type === 'tts') return { id: 'minimax-tts', models: ['speech-2.8-turbo'] }
      return { id: 'agnes-llm', models: ['agnes-2.0-flash'] }
    })
    const inner = vi.fn(async () => ({ success: true, output: { scenes: [] } }))
    const { get } = makePipeline(ai, inner)
    const result = await get(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)({
      runId: 'r', stage: { options: {} }, params: {},
      context: { scenes: [{ prompt: 'p1', text: 't1', duration: 6 }] },
    })
    expect(result.success).toBe(true)
    expect(inner).toHaveBeenCalledWith(expect.objectContaining({
      stage: expect.objectContaining({
        options: expect.objectContaining({
          imageProvider: 'minimax-image',
          imageModel: 'image-01',
          voiceProvider: 'minimax-tts',
          voiceModel: 'speech-2.8-turbo',
        }),
      }),
    }))
  })

  it('generate_assets 缺少场景或提示词时失败', async () => {
    const { get } = makePipeline(makeAi('x'), vi.fn())
    const noScenes = await get(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)({
      runId: 'r', stage: {}, params: {}, context: {},
    })
    expect(noScenes.success).toBe(false)
    const noPrompt = await get(EXPLAINER_STAGE_TYPES.GENERATE_ASSETS)({
      runId: 'r', stage: {}, params: {},
      context: { scenes: [{ prompt: '', text: 't' }] },
    })
    expect(noPrompt.success).toBe(false)
    expect(noPrompt.error).toContain('缺少画面提示词')
  })

  it('editing 产出上游 edit_decisions artifact', async () => {
    // ⚠ P2b 契约变更：editing 从「校验资源清单并透传」变成「产出 edit_decisions」
    const scenePlan = buildScenePlan({
      scenes: [
        { id: 'scene-1', type: 'broll', description: '主体', duration: 6, shot_language: { shot_size: 'medium' } },
        { id: 'scene-2', type: 'diagram', description: '流程', duration: 8, shot_language: { shot_size: 'wide' } },
      ],
    }, {})
    const manifest = {
      version: '1.0',
      assets: [
        { id: 'asset-scene-1-image', type: 'image', path: '/a1.png', source_tool: 'sd', scene_id: 'scene-1' },
        { id: 'asset-scene-1-narration', type: 'narration', path: '/a1.mp3', source_tool: 'tts', scene_id: 'scene-1', duration_seconds: 6 },
        { id: 'asset-scene-2-image', type: 'image', path: '/a2.png', source_tool: 'sd', scene_id: 'scene-2' },
        { id: 'asset-scene-2-narration', type: 'narration', path: '/a2.mp3', source_tool: 'tts', scene_id: 'scene-2', duration_seconds: 8 },
      ],
      total_cost_usd: 0,
      metadata: { issues: [] },
    }
    const { get } = makePipeline(makeAi('x'))
    const ok = await get(EXPLAINER_STAGE_TYPES.EDITING)({
      stage: {}, params: {}, context: { scene_plan: scenePlan, assets: manifest },
    })
    expect(ok.success).toBe(true)
    expect(ok.output.version).toBe('1.0')
    expect(ok.output.cuts).toHaveLength(2)
    expect(ok.output.render_runtime).toBe('remotion')
    const bad = await get(EXPLAINER_STAGE_TYPES.EDITING)({
      stage: {}, params: {}, context: {},
    })
    expect(bad.success).toBe(false)
  })

describe('LLM 调用容错（2026-08-11 E2E 复盘）', () => {
  it('callDefaultLlm 空内容时重试直到拿到非空内容', async () => {
    // ⚠ 契约变更：research 的产物是**上游 research_brief 对象** ⇒ 第二次返回必须是
    //   合法 JSON（原用例返回的是散文）⇒ 改**输入**，断言「第二次拿到非空内容」的意图不变。
    const ai = makeAiSequence(['', makeResearchBriefJson()])
    const { get } = makePipeline(ai)
    const result = await get(EXPLAINER_STAGE_TYPES.RESEARCH)({
      stage: {}, params: { text: '测试主题' },
    })
    expect(result.success).toBe(true)
    expect(ai.calls).toHaveLength(2)
    // ⚠ 契约变更：第二次返回的是**上游 research_brief JSON**（原用例返回散文「1. 主题：测试大纲」）
    //   ⇒ 断言的**形态**变（查 JSON 里的 topic），**意图**不变（第二次调用拿到了非空的有效内容）。
    expect(ai.calls[1]).toContain('人工智能的历史')
  })

  it('callDefaultLlm 连续空内容达到上限后失败（不再无限重试）', async () => {
    const ai = makeAiSequence(['', ''])
    const { get } = makePipeline(ai)
    const result = await get(EXPLAINER_STAGE_TYPES.RESEARCH)({
      stage: {}, params: { text: '测试主题' },
    })
    expect(result.success).toBe(false)
    expect(String(result.error)).toContain('空内容')
    expect(ai.calls.length).toBeLessThanOrEqual(3)
  })

  it('callDefaultLlm 配置错误不重试直接失败', async () => {
    const ai = {
      _modelProviderManager: { getDefault: () => ({ id: 'agnes-llm', models: ['agnes-2.0-flash'] }) },
      generateWithDefault: vi.fn(async () => {
        throw new Error('未找到需要的相关模型，请在设置中添加模型')
      }),
    }
    const { get } = makePipeline(ai)
    const result = await get(EXPLAINER_STAGE_TYPES.RESEARCH)({
      stage: {}, params: { text: '测试主题' },
    })
    expect(result.success).toBe(false)
    expect(ai.generateWithDefault).toHaveBeenCalledTimes(1)
  })

  it('scenes JSON 解析失败时让 LLM 修复为严格 JSON 后成功', async () => {
    const scenesJson = JSON.stringify([
      { prompt: '修复后的画面', text: '修复后的旁白', duration: 6 },
    ])
    const ai = makeAiSequence(['不是 JSON 的文字', '```json\n' + scenesJson + '\n```'])
    const { get } = makePipeline(ai)
    const result = await get(EXPLAINER_STAGE_TYPES.SCENES)({
      stage: {}, params: {},
      context: { script: '旁白文案。' },
    })
    expect(result.success).toBe(true)
    // ⚠ P2b 契约变更：产物是 **scene_plan 对象**；旧格式的 prompt 被映射成 description
    expect(result.output.scenes).toHaveLength(1)
    expect(result.output.scenes[0].description).toBe('修复后的画面')
    expect(ai.calls.length).toBeGreaterThanOrEqual(2)
  })

  it('scenes 修复失败后回落行级兜底（不整线失败）', async () => {
    const ai = makeAiSequence(['不是 JSON 的文字', '还是不是 JSON', '无法生成'])
    const { get } = makePipeline(ai)
    const result = await get(EXPLAINER_STAGE_TYPES.SCENES)({
      stage: {}, params: {},
      context: { script: '第一段旁白。\n\n第二段旁白。' },
    })
    expect(result.success).toBe(true)
    expect(result.output.scenes.length).toBeGreaterThanOrEqual(1)
    expect(result.output.scenes[0].description).toContain('第一段旁白')
  })
})
})
