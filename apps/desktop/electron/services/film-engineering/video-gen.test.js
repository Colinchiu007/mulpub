// @ts-check
'use strict'
/**
 * film-engineering video-gen 契约测试（specs: 分镜视频生成阶段）
 * 覆盖：提示词原文直送 / 优化器零调用（违例拦截）/ provider 未配置 fail-closed /
 *       批次上限 / 枚举校验 / 部分失败逐镜标注
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  FILM_VIDEO_STAGE_TYPES,
  MAX_VIDEO_BATCH,
  registerFilmVideoStages,
  buildShotSubmitPayload,
  pickFilmFrameCount,
} = require('./video-gen')

const UUID_A = 'aaaaaaaa-1111-4111-8111-111111111111'
// 含 <<<uuid>>> 令牌与块标签的 kit 风格提示词（原文保真对象）
const KIT_PROMPT = 'EXT. TUNNEL\n[CHARACTER: ROKO] runs.\n\n<<<' + UUID_A + '>>>\n\nGEO SPATIAL LAYOUT\nRoko center frame.\n\nPOSITIVE CONSTRAINTS\nNo text overlays.'

function makeShot (i, title) {
  return {
    shotId: 'shot-' + i,
    sceneId: 'scene-' + i,
    title: title || ('分镜 ' + i),
    prompt: KIT_PROMPT.replace('runs', 'runs #' + i),
    model: 'seedance_2_0',
    refTokens: [UUID_A],
  }
}

/** mock PipelineEngine + manager；callAdapter 记录全部提交 */
function makeEngine (opts = {}) {
  const executors = new Map()
  const calls = []
  const optimizeCalls = []
  const pid = opts.providerId || 'mock-video'
  const manager = {
    getDefault (type) {
      if (opts.noVideoProvider && type === 'video') return null
      if (type !== 'video') return null
      return { id: pid, config: { models: ['mv-1'], capability_models: { video: 'mv-1' } } }
    },
    getProvider () { return { id: pid } },
    callAdapter: async (providerId, method, payload) => {
      calls.push({ providerId, method, payload })
      if (method === 'generateVideo') {
        // 失败镜按提交 prompt 中的 #i 序号判定（并发下不依赖调用顺序）
        const shotIdx = Number(/runs #(\d+)/.exec(payload.prompt || '')?.[1])
        if (opts.submitFailIndexes && opts.submitFailIndexes.includes(shotIdx)) {
          return { code: -1, message: 'submit rejected by provider' }
        }
        return { code: 0, data: { taskId: 'task-' + calls.length } }
      }
      if (method === 'getVideoStatus') {
        return { code: 0, data: { status: 'completed', videoUrl: 'mock://video' } }
      }
      return { code: -1, message: 'unknown method ' + method }
    },
  }
  const engine = {
    stageExecutor: { register (type, fn) { executors.set(type, fn) } },
    registerStageExecutor (type, fn) { this.stageExecutor.register(type, fn); return { success: true } },
    container: { get: (k) => (k === 'aiGenerator' ? { _modelProviderManager: manager } : null) },
    aiGenerator: { _modelProviderManager: manager },
    log: { info () {}, warn () {}, error () {} },
    serviceBus: {
      // 原文直送合同：film 阶段一旦调用视频优化器即违例
      optimizeVideoPromptsBatch: async (prompts) => {
        optimizeCalls.push(prompts)
        throw new Error('CONTRACT VIOLATION: prompt-engine optimizer called from film_generate_videos')
      },
    },
    _executors: executors,
    _calls: calls,
    _optimizeCalls: optimizeCalls,
  }
  registerFilmVideoStages(engine)
  return engine
}

function runInput (engine, runId, shots, params = {}, opts = {}) {
  const fn = engine._executors.get(FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS)
  expect(fn, 'film_generate_videos not registered').toBeTruthy()
  const context = { selectedShots: shots }
  if (opts.localReferences) context.localReferences = opts.localReferences
  // 默认模拟用户已过成本确认闸（confirmed 重入）；成本闸专项测试传 costGate:true 跳过
  if (!opts.costGate) {
    context.cost_confirmation = { confirmed: true, confirmedAt: new Date().toISOString() }
  }
  return fn({
    runId,
    stage: { name: 'generate_videos', type: FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS, options: {} },
    params: { aspect: '16x9', seconds: 5, ...params },
    context,
    serviceBus: engine.serviceBus,
    onProgress: () => {},
    // 测试注入：轮询零等待 + 假下载直接落盘
    _testSleep: async () => {},
    _testDownload: async (url, dest) => { fs.writeFileSync(dest, 'fake-mp4') },
  })
}

describe('film_generate_videos - 提交载荷合同', () => {
  it('纯函数：提示词逐字符原文（含 <<<uuid>>> 令牌），画幅/帧数映射正确', () => {
    const shot = makeShot(1)
    const payload = buildShotSubmitPayload({ shot, aspect: '16x9', seconds: 5, model: 'mv-1' })
    expect(payload.prompt).toBe(shot.prompt)
    expect(payload.prompt).toContain('<<<' + UUID_A + '>>>')
    expect(payload.width).toBe(1280)
    expect(payload.height).toBe(720)
    expect(payload.numFrames).toBe(pickFilmFrameCount(5))
    expect(payload.num_frames).toBe(payload.numFrames)
    expect(payload.frameRate).toBe(24)
    expect(payload.frame_rate).toBe(24)
    const portrait = buildShotSubmitPayload({ shot, aspect: '9x16', seconds: 8, model: 'mv-1' })
    expect(portrait.width).toBe(720)
    expect(portrait.height).toBe(1280)
    expect(portrait.numFrames).toBe(pickFilmFrameCount(8))
    // source 画幅不下发尺寸参数
    const src = buildShotSubmitPayload({ shot, aspect: 'source', seconds: 5, model: 'mv-1' })
    expect(src.width).toBeUndefined()
    expect(src.height).toBeUndefined()
  })
})

describe('film_generate_videos - 阶段执行', () => {
  it('提示词原文直送 generateVideo，且绝不触碰 prompt-engine 优化器', async () => {
    const engine = makeEngine()
    const shots = [makeShot(1), makeShot(2)]
    const res = await runInput(engine, 't-direct', shots)
    expect(res.success).toBe(true)
    const submits = engine._calls.filter(c => c.method === 'generateVideo')
    expect(submits.length).toBe(2)
    expect(submits[0].payload.prompt).toBe(shots[0].prompt)
    expect(submits[1].payload.prompt).toBe(shots[1].prompt)
    expect(engine._optimizeCalls.length).toBe(0)
    expect(res.output.videoResults.every(r => r.success)).toBe(true)
  })

  it('manifest 直通：无 selectedShots 但有 renderManifest → success(manifestMode)，零 provider 调用（全量收口合成 run）', async () => {
    const engine = makeEngine()
    const fn = engine._executors.get(FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS)
    const manifest = [
      { shotId: 's1', path: '/x/shot_000.mp4', sourceKind: 'generated', orderIndex: 0 },
      { shotId: 's2', path: '/y/shot_001.mp4', sourceKind: 'downloaded', orderIndex: 1 },
    ]
    const res = await fn({
      runId: 't-manifest-run',
      stage: { name: 'generate_videos', type: FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS, options: {} },
      params: {},
      context: { renderManifest: manifest },
      serviceBus: engine.serviceBus,
      onProgress: () => {},
    })
    expect(res.success).toBe(true)
    expect(res.output.manifestMode).toBe(true)
    expect(res.output.entryCount).toBe(2)
    expect(engine._calls.length).toBe(0)
    expect(engine._optimizeCalls.length).toBe(0)
    // 回归锚：无 manifest 无 shots 仍走既有错误；manifest 空数组不放行
    const res2 = await fn({
      runId: 't-manifest-empty',
      stage: { name: 'generate_videos', type: FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS, options: {} },
      params: {},
      context: { renderManifest: [] },
      serviceBus: engine.serviceBus,
      onProgress: () => {},
    })
    expect(res2.success).toBe(false)
    expect(res2.error).toContain('selectedShots')
  })

  it('provider 未配置：VIDEO_MODEL_NOT_CONFIGURED fail-closed，零 provider 调用', async () => {
    const engine = makeEngine({ noVideoProvider: true })
    const res = await runInput(engine, 't-noprovider', [makeShot(1)])
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
    expect(res.error).toContain('模型设置')
    expect(engine._calls.length).toBe(0)
  })

  it('批次 > MAX_VIDEO_BATCH(10) 拒绝，不发起任何提交', async () => {
    expect(MAX_VIDEO_BATCH).toBe(10)
    const engine = makeEngine()
    const shots = Array.from({ length: 11 }, (_, i) => makeShot(i))
    const res = await runInput(engine, 't-batch', shots)
    expect(res.success).toBe(false)
    expect(res.error).toContain(String(MAX_VIDEO_BATCH))
    expect(engine._calls.length).toBe(0)
  })

  it('画幅/时长非法枚举拒绝', async () => {
    const engine = makeEngine()
    const bad1 = await runInput(engine, 't-aspect', [makeShot(1)], { aspect: '4x3' })
    expect(bad1.success).toBe(false)
    expect(bad1.error).toContain('aspect')
    const bad2 = await runInput(engine, 't-seconds', [makeShot(1)], { seconds: 7 })
    expect(bad2.success).toBe(false)
    expect(bad2.error).toContain('seconds')
    expect(engine._calls.length).toBe(0)
  })

  it('部分失败：失败镜逐镜标注原因，成功镜产物落盘（partialFailure）', async () => {
    const engine = makeEngine({ submitFailIndexes: [1] })
    const shots = [makeShot(0), makeShot(1), makeShot(2)]
    const runId = 't-partial'
    const res = await runInput(engine, runId, shots)
    expect(res.success).toBe(true)
    expect(res.output.partialFailure).toBe(true)
    const results = res.output.videoResults
    expect(results.length).toBe(3)
    expect(results[1].success).toBe(false)
    expect(results[1].error).toContain('submit rejected')
    expect(results[0].success).toBe(true)
    expect(results[2].success).toBe(true)
    const runDir = path.join(os.tmpdir(), 'film-engineering', runId)
    expect(fs.existsSync(path.join(runDir, 'shot_000.mp4'))).toBe(true)
    expect(fs.existsSync(path.join(runDir, 'shot_002.mp4'))).toBe(true)
    expect(fs.existsSync(path.join(runDir, 'shot_001.mp4'))).toBe(false)
  })

  it('全部失败：阶段失败并汇总各镜原因', async () => {
    const engine = makeEngine({ submitFailIndexes: [0, 1] })
    const res = await runInput(engine, 't-allfail', [makeShot(0), makeShot(1)])
    expect(res.success).toBe(false)
    expect(res.error).toContain('全部失败')
  })
})

describe('film_generate_videos - 成本确认闸（specs: 成本确认 checkpoint·确认卡内容）', () => {
  it('未确认首次执行：停在等待态，payload 携带逐镜 shotId/标题/画幅/时长，零 provider 调用', async () => {
    const engine = makeEngine()
    const shots = [makeShot(0, '隧道奔跑'), makeShot(1, '天台对峙')]
    const res = await runInput(engine, 't-gate-1', shots, { aspect: '9x16', seconds: 8 }, { costGate: true })
    expect(res.success).toBe(true)
    expect(res.output.awaitingConfirmation).toBe(true)
    expect(res.output.costCheck).toBeTruthy()
    expect(res.output.costCheck.totalShots).toBe(2)
    expect(res.output.costCheck.aspect).toBe('9x16')
    expect(res.output.costCheck.seconds).toBe(8)
    expect(res.output.costCheck.shots.map(s => s.shotId)).toEqual(['shot-0', 'shot-1'])
    expect(res.output.costCheck.shots[0].title).toBe('隧道奔跑')
    expect(res.output.costCheck.shots[1].title).toBe('天台对峙')
    expect(res.output.costCheck.shots[0].aspect).toBe('9x16')
    expect(res.output.costCheck.shots[0].seconds).toBe(8)
    expect(engine._calls.length).toBe(0)
  })

  it('confirmed=false 同样停在闸上（不存在隐式放行路径）', async () => {
    const engine = makeEngine()
    const fn = engine._executors.get(FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS)
    const res = await fn({
      runId: 't-gate-2',
      stage: { name: 'generate_videos', type: FILM_VIDEO_STAGE_TYPES.GENERATE_VIDEOS, options: {} },
      params: { aspect: '16x9', seconds: 5 },
      context: { selectedShots: [makeShot(0)], cost_confirmation: { confirmed: false } },
      serviceBus: engine.serviceBus,
      onProgress: () => {},
      _testSleep: async () => {},
      _testDownload: async () => {},
    })
    expect(res.success).toBe(true)
    expect(res.output.awaitingConfirmation).toBe(true)
    expect(engine._calls.length).toBe(0)
  })

  it('等待态输出会作为阶段 output 进入 context（checkpoint.context 可提取确认卡载荷）', async () => {
    // 引擎合同：success+output → run.context[stage.name]=output，checkpoint 快照含 context，
    // 因此等待态 payload 经 getRunSnapshot().checkpoint.context.generate_videos.costCheck 可达前端。
    const engine = makeEngine()
    const res = await runInput(engine, 't-gate-3', [makeShot(0)], {}, { costGate: true })
    expect(res.output.costCheck.shots[0].shotId).toBe('shot-0')
  })

  it('闸前参数校验不被绕过：超批次/非法枚举在等待态之前即失败', async () => {
    const engine = makeEngine()
    const over = Array.from({ length: 11 }, (_, i) => makeShot(i))
    const bad = await runInput(engine, 't-gate-4', over, {}, { costGate: true })
    expect(bad.success).toBe(false)
    expect(bad.error).toContain(String(MAX_VIDEO_BATCH))
    expect(engine._calls.length).toBe(0)
  })

  it('provider 未配置时闸不产出确认卡（直接 fail-closed，避免过闸即死）', async () => {
    const engine = makeEngine({ noVideoProvider: true })
    const res = await runInput(engine, 't-gate-5', [makeShot(0)], {}, { costGate: true })
    expect(res.success).toBe(false)
    expect(res.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
    expect(engine._calls.length).toBe(0)
  })

  it('确认后重入同一阶段：真实执行生成（过闸后续跑不再返回等待态）', async () => {
    const engine = makeEngine()
    const shots = [makeShot(0), makeShot(1)]
    const gated = await runInput(engine, 't-gate-6', shots, {}, { costGate: true })
    expect(gated.output.awaitingConfirmation).toBe(true)
    const res = await runInput(engine, 't-gate-6', shots)
    expect(res.success).toBe(true)
    expect(res.output.awaitingConfirmation).toBeUndefined()
    expect(res.output.videoResults.length).toBe(2)
    expect(engine._calls.filter(c => c.method === 'generateVideo').length).toBe(2)
  })
})

describe('film_generate_videos - 画布参考图输入（tasks 4.3：引擎侧消费 localReferences）', () => {
  // 1x1 PNG：落盘到受控媒体根 references/ 下，模拟 upload-reference 产物
  const PNG_1x1 = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
    'base64',
  )
  const MEDIA_ROOT = path.join(os.tmpdir(), 'film-engineering')

  /** 写入受控根内参考图；abs=false 时返回越界路径（不写盘） */
  function refPath (name, { abs = true } = {}) {
    const p = path.join(MEDIA_ROOT, 'references', name)
    if (abs) {
      fs.mkdirSync(path.dirname(p), { recursive: true })
      fs.writeFileSync(p, PNG_1x1)
    }
    return p
  }

  it('向后兼容：无 localReferences 时提交载荷与既有一致（无参考字段、无 warning）', async () => {
    const engine = makeEngine()
    const res = await runInput(engine, 't-ref-none', [makeShot(0)])
    expect(res.success).toBe(true)
    const submit = engine._calls.find(c => c.method === 'generateVideo')
    expect('image' in submit.payload).toBe(false)
    expect('firstFrameImage' in submit.payload).toBe(false)
    expect(res.output.referenceWarnings).toBeUndefined()
  })

  it('能力内注入：agnes-video 连线参考 → 提交载荷携带 image dataURL（首帧语义）', async () => {
    const engine = makeEngine({ providerId: 'agnes-video' })
    const p = refPath('ref-unit-a.png')
    const shots = [makeShot(0), makeShot(1)]
    const res = await runInput(engine, 't-ref-inject', shots, {}, { localReferences: [{ shotId: 'shot-0', paths: [p] }] })
    expect(res.success).toBe(true)
    const submits = engine._calls.filter(c => c.method === 'generateVideo')
    const s0 = submits.find(c => /runs #0/.test(c.payload.prompt))
    const s1 = submits.find(c => /runs #1/.test(c.payload.prompt))
    expect(s0.payload.image).toBe('data:image/png;base64,' + PNG_1x1.toString('base64'))
    expect('firstFrameImage' in s0.payload).toBe(false)
    expect('image' in s1.payload).toBe(false) // 未连线镜不受影响
    expect(res.output.referenceWarnings).toBeUndefined()
  })

  it('能力降级：provider 不支持参考输入 → 明示 warning 且照常纯文本出片', async () => {
    const engine = makeEngine()
    const p = refPath('ref-unit-b.png')
    const res = await runInput(engine, 't-ref-degrade', [makeShot(0)], {}, { localReferences: [{ shotId: 'shot-0', paths: [p] }] })
    expect(res.success).toBe(true)
    const submit = engine._calls.find(c => c.method === 'generateVideo')
    expect('image' in submit.payload).toBe(false)
    expect('firstFrameImage' in submit.payload).toBe(false)
    expect(res.output.referenceWarnings.length).toBe(1)
    expect(res.output.referenceWarnings[0].shotId).toBe('shot-0')
    expect(res.output.referenceWarnings[0].reason).toContain('mock-video')
  })

  it('路径安全：越界/不存在参考不进载荷，镜仍出片并 warning', async () => {
    const engine = makeEngine({ providerId: 'minimax' })
    const shots = [makeShot(0)]
    const bad = [{ shotId: 'shot-0', paths: [refPath('ref-unit-evil.png', { abs: false }), '/nope/missing.png'] }]
    const res = await runInput(engine, 't-ref-unsafe', shots, {}, { localReferences: bad })
    expect(res.success).toBe(true)
    const submit = engine._calls.find(c => c.method === 'generateVideo')
    expect('firstFrameImage' in submit.payload).toBe(false)
    expect(res.output.referenceWarnings.length).toBe(1)
    expect(res.output.referenceWarnings[0].reason).toContain('outside-media-root')
  })

  it('成本确认卡携带参考摘要（shotsWithReferences/providerSupportsReference），闸前零 provider 调用不变', async () => {
    const engine = makeEngine()
    const p = refPath('ref-unit-c.png')
    const shots = [makeShot(0), makeShot(1)]
    const res = await runInput(engine, 't-ref-gate', shots, {}, { costGate: true, localReferences: [{ shotId: 'shot-0', paths: [p] }] })
    expect(res.output.awaitingConfirmation).toBe(true)
    expect(res.output.costCheck.references.shotsWithReferences).toBe(1)
    expect(res.output.costCheck.references.providerSupportsReference).toBe(false)
    expect(engine._calls.length).toBe(0)
  })
})
