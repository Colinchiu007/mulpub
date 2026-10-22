// @ts-check
'use strict'
/**
 * film-engineering 自动模式 IPC 契约测试（openspec change: film-auto-mode）
 *
 * 覆盖（design D3/D4/D17/D25/D28/D31）：
 *  - sender 校验：6 个通道全部拒绝外部网页
 *  - auto-plan：未配视频 Provider / 空剧本 / 非法参数 → fail-closed；成功则**服务端落盘计划**，
 *    返回给渲染端的是**预览投影**（无完整 prompt，只有 promptPreview）
 *  - auto-start：未确认 → 不执行且要求确认（零 provider 调用）；确认后按 runIdFor 落到 auto/<taskId>/b<N>；
 *    计划被消费（同 planId 二次启动 → AUTO_PLAN_EXPIRED）
 *  - 单飞：进行中再启动另一任务 → AUTO_TASK_BUSY
 *  - auto-update-shot：越界/非法字段拒绝；成功写 editedAt
 *  - auto-regenerate-shot：编辑后未重新确认 → 不重生成（零调用）
 *  - auto-compose：无台账 → AUTO_MANIFEST_INCOMPLETE
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import nodeFs from 'node:fs'
import nodeOs from 'node:os'
import nodePath from 'node:path'

vi.mock('../services/logger', () => ({
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
}))

__enableElectronMock()

let registerAutoHandlers
let readPlan
let readProject

beforeEach(async () => {
  vi.resetModules()
  const mod = await import('./film-engineering-auto')
  registerAutoHandlers = mod.default || mod
  const proj = await import('../services/film-engineering/auto-project')
  readPlan = proj.readPlan
  readProject = proj.readProject
})

const UNTRUSTED_EVENT = { senderFrame: { url: 'https://evil.example/' } }
function trustedEvent () {
  return { senderFrame: { url: 'http://localhost:5174/' }, sender: { send: vi.fn() } }
}

const CHANNELS = [
  'film-engineering:auto-plan',
  'film-engineering:auto-start',
  'film-engineering:auto-status',
  'film-engineering:auto-update-shot',
  'film-engineering:auto-regenerate-shot',
  'film-engineering:auto-compose',
]

function createMockIpcMain () {
  const handlers = {}
  return {
    handle: vi.fn((channel, fn) => { handlers[channel] = fn }),
    _get: (channel) => handlers[channel],
  }
}

const TEMPLATE_PROMPT = [
  'INT. STREET - NIGHT',
  '',
  '[CHARACTER: ROKO] Determined street kid.',
  '',
  'GEO SPATIAL LAYOUT',
  'Alley left, museum right.',
  '',
  'ACTION TIMING',
  '0.0-2.0s: steps forward.',
].join('\n')

const TEMPLATES = [
  { shotId: 't0', sceneId: 's0', prompt: TEMPLATE_PROMPT, model: 'm', refTokens: [] },
  { shotId: 't1', sceneId: 's1', prompt: TEMPLATE_PROMPT, model: 'm', refTokens: [] },
]

const SCRIPT = '第1场\n小强推开门。\n\n第2场\n小强抬头看灯。'

function tmpHome () {
  return nodeFs.mkdtempSync(nodePath.join(nodeOs.tmpdir(), 'auto-ipc-test-'))
}

function fakeAiGenerator (configured = true) {
  return {
    _modelProviderManager: {
      getDefault: (cap) => (cap === 'video' && configured ? { id: 'minimax' } : null),
    },
  }
}

function makeDeps (overrides = {}) {
  return {
    log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
    filmEngineeringService: { listTemplateShots: vi.fn(() => TEMPLATES) },
    aiGenerator: fakeAiGenerator(),
    home: tmpHome(),
    _testProbe: () => ({ missing: [] }),
    _testRunProduction: vi.fn(async () => ({
      ok: true,
      ledger: { batches: [{ batchIndex: 0, runId: 'auto/x/b0', shotIds: [], shots: [], status: 'done' }] },
      renderManifest: { entries: [] },
      manifestError: null,
      failedBatches: [],
    })),
    _testRunAutoBatch: vi.fn(async () => ({ refWarnings: [] })),
    _testRegenerateOneShot: vi.fn(async () => ({ ok: true, path: nodePath.join('x', 'shot_000.mp4') })),
    ...overrides,
  }
}

const PLAN_ARGS = {
  script: SCRIPT,
  characterRefs: [],
  sceneRefs: [],
  aspect: '16x9',
  seconds: 5,
  targetDurationSec: 10,
}

async function planOnce (ipcMain, event, extra = {}) {
  return ipcMain._get('film-engineering:auto-plan')(event, { ...PLAN_ARGS, ...extra })
}

describe('自动模式 IPC · sender 校验', () => {
  it.each(CHANNELS)('%s 拒绝外部网页调用', async (channel) => {
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, makeDeps())
    const result = await ipcMain._get(channel)(UNTRUSTED_EVENT, {})
    expect(result).toEqual({ code: -3, message: '未授权的调用来源' })
  })
})

describe('自动模式 IPC · auto-plan', () => {
  it('未配置视频 Provider → VIDEO_MODEL_NOT_CONFIGURED（不落盘）', async () => {
    const deps = makeDeps({ aiGenerator: fakeAiGenerator(false) })
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, deps)
    const r = await planOnce(ipcMain, trustedEvent())
    expect(r.code).not.toBe(0)
    expect(r.errorCode).toBe('VIDEO_MODEL_NOT_CONFIGURED')
    expect(deps.filmEngineeringService.listTemplateShots).not.toHaveBeenCalled()
  })

  it('空剧本 / 非法参数 → fail-closed 且不落盘', async () => {
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, makeDeps())
    const empty = await planOnce(ipcMain, trustedEvent(), { script: '   ' })
    expect(empty.errorCode).toBe('AUTO_SCRIPT_EMPTY')
    const badAspect = await planOnce(ipcMain, trustedEvent(), { aspect: '4x3' })
    expect(badAspect.errorCode).toBe('AUTO_BAD_PARAM')
  })

  it('成功 → 服务端落盘计划，返回预览投影（无完整 prompt）', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, deps)
    const r = await planOnce(ipcMain, trustedEvent(), { taskId: 'auto-t1' })
    expect(r.code).toBe(0)
    expect(r.data.taskId).toBe('auto-t1')
    expect(r.data.planId.startsWith('plan-')).toBe(true)
    expect(r.data.shotCount).toBe(2)
    expect(r.data.provider).toEqual({ id: 'minimax', model: '' })
    expect(r.data.shots[0]).not.toHaveProperty('prompt')
    expect(typeof r.data.shots[0].promptPreview).toBe('string')
    expect(r.data.shots[0].promptPreview.length).toBeGreaterThan(0)
    // 服务端可读回同一份计划（客户端不持有真源）
    const planned = readPlan({ home: deps.home, planId: r.data.planId, taskId: 'auto-t1' })
    expect(planned.ok).toBe(true)
    expect(planned.plan.shots).toHaveLength(2)
    expect(planned.plan.shots[0].prompt).toContain('GEO SPATIAL LAYOUT')
  })
})

describe('自动模式 IPC · auto-start', () => {
  it('未确认 → 不执行、零 provider 调用、要求确认', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, deps)
    const planned = await planOnce(ipcMain, trustedEvent(), { taskId: 'auto-t1' })
    const r = await ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      planId: planned.data.planId, taskId: 'auto-t1',
    })
    expect(r.code).toBe(0)
    expect(r.data.started).toBe(false)
    expect(r.data.needsReconfirm).toBe(true)
    expect(deps._testRunProduction).not.toHaveBeenCalled()
    expect(deps._testRunAutoBatch).not.toHaveBeenCalled()
  })

  it('确认后按 runIdFor 落 auto/<taskId>/b<N>，写确认历史，且计划被消费', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, deps)
    const planned = await planOnce(ipcMain, trustedEvent(), { taskId: 'auto-t1' })
    const event = trustedEvent()
    const r = await ipcMain._get('film-engineering:auto-start')(event, {
      planId: planned.data.planId, taskId: 'auto-t1', confirmed: true,
    })
    expect(r.code).toBe(0)
    expect(r.data.started).toBe(true)
    expect(r.data.resumed).toBe(false)
    expect(deps._testRunProduction).toHaveBeenCalledTimes(1)
    const call = deps._testRunProduction.mock.calls[0][0]
    expect(call.taskId).toBe('auto-t1')
    expect(call.runIdFor('auto-t1', 3)).toBe('auto/auto-t1/b3')
    expect(call.ledgerDir).toBe(nodePath.join(deps.home, 'film-engineering', 'auto', 'auto-t1'))
    // 项目文件：确认历史 append-only 一条且状态/提示词真源在项目文件
    const stored = readProject({ home: deps.home, taskId: 'auto-t1' })
    expect(stored.ok).toBe(true)
    expect(stored.project.confirmations).toHaveLength(1)
    expect(stored.project.shots[0].prompt).toContain('ACTION TIMING')
    // 等后台那一轮收尾：派发即返回后，单飞标志由异步收尾清理（否则下一次启动会撞 AUTO_TASK_BUSY）
    await new Promise((r) => setTimeout(r, 30))

    // 计划已被首次启动消费（防重放的刻意设计），但**续跑不依赖计划**：
    // 同名任务 + 同 planId 走续跑分支（内容真源是项目文件），不会因计划消费而失败。
    const again = await ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      planId: planned.data.planId, taskId: 'auto-t1', confirmed: true,
    })
    expect(again.code).toBe(0)
    expect(again.data.started).toBe(true)
    expect(again.data.resumed).toBe(true)
    expect(deps._testRunProduction).toHaveBeenCalledTimes(2)

    // 续跑**不再需要计划**：只给 taskId 也能续（面板「重新打开继续」走的正是这条路径）
    const bare = await ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      taskId: 'auto-t1', confirmed: true,
    })
    expect(bare.data.started).toBe(true)
    expect(bare.data.resumed).toBe(true)

    // 另一份计划 + 未显式覆盖 → 明确拒绝（不静默覆盖既有任务与产物）
    const conflict = await ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      planId: 'plan-from-elsewhere', taskId: 'auto-t1', confirmed: true,
    })
    expect(conflict.errorCode).toBe('AUTO_PLAN_MISMATCH')

    // 已被消费的计划换到另一个 taskId → 仍是过期（consumed 先于归属判定）
    const strayPlan = await ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      planId: planned.data.planId, taskId: 'auto-other', confirmed: true,
    })
    expect(strayPlan.errorCode).toBe('AUTO_PLAN_EXPIRED')
  })

  it('计划内参考图越出受控媒体根 → 拒绝启动（纵深防御，零调用）', async () => {
    const deps = makeDeps()
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, deps)
    const planned = await planOnce(ipcMain, trustedEvent(), { taskId: 'auto-t1' })
    // 模拟计划文件被篡改：把某镜参考图改成受控根之外
    const { planFilePath } = await import('../services/film-engineering/auto-project')
    const file = planFilePath(deps.home, planned.data.planId)
    const record = JSON.parse(nodeFs.readFileSync(file, 'utf8'))
    record.plan.shots[0].refPaths = ['C:/evil/secret.png']
    nodeFs.writeFileSync(file, JSON.stringify(record), 'utf8')
    const r = await ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      planId: planned.data.planId, taskId: 'auto-t1', confirmed: true,
    })
    expect(r.errorCode).toBe('AUTO_BAD_PARAM')
    expect(deps._testRunProduction).not.toHaveBeenCalled()
  })

  it('单飞：已有任务在跑时另一任务启动 → AUTO_TASK_BUSY', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const deps = makeDeps({
      _testRunProduction: vi.fn(async () => {
        await gate
        return { ok: true, ledger: { batches: [] }, renderManifest: null, manifestError: null, failedBatches: [] }
      }),
    })
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, deps)
    const p1 = await planOnce(ipcMain, trustedEvent(), { taskId: 'auto-a' })
    const p2 = await planOnce(ipcMain, trustedEvent(), { taskId: 'auto-b' })
    const first = ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      planId: p1.data.planId, taskId: 'auto-a', confirmed: true,
    })
    await new Promise((r) => setTimeout(r, 10))
    const second = await ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      planId: p2.data.planId, taskId: 'auto-b', confirmed: true,
    })
    expect(second.errorCode).toBe('AUTO_TASK_BUSY')
    release()
    const done = await first
    expect(done.data.started).toBe(true)
  })
})

describe('自动模式 IPC · 编辑 / 重生成 / 收口', () => {
  async function startedTask (deps) {
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, deps)
    const planned = await planOnce(ipcMain, trustedEvent(), { taskId: 'auto-t1' })
    await ipcMain._get('film-engineering:auto-start')(trustedEvent(), {
      planId: planned.data.planId, taskId: 'auto-t1', confirmed: true,
    })
    return ipcMain
  }

  it('auto-status 无项目 → exists:false', async () => {
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, makeDeps())
    const r = await ipcMain._get('film-engineering:auto-status')(trustedEvent(), { taskId: 'nope' })
    expect(r.code).toBe(0)
    expect(r.data.exists).toBe(false)
  })

  /**
   * 第 9 轮 i4（Warning / feasibility）：方法论接入状态此前**只挂在规划结果**上
   * ⇒ **重开一个已规划的项目时，面板整块不显示**（落盘的 `promptContext` +
   * 逐镜 `promptMissing` 没人重新汇总）。
   * ⇒ 服务端在 `projectView` 里用**同一个** `buildMethodologySummary` 重新汇总。
   *
   * 这条判据锁的是「项目投影里有 methodology」，且它的数据源是**落盘**的那两份
   * （不是规划结果 —— 规划结果不落盘，重开时不在内存里）。
   */
  it('auto-status 的项目投影带方法论接入状态（重开项目也可见，第 9 轮 i4）', async () => {
    const KIT = {
      doctrine: {
        schemaVersion: 2,
        blocks: [
          { key: 'style', label: 'STYLE', zh: 'z', en: 'e' },
          { key: 'frame_constraint', label: 'FRAME', zh: '尾帧必须是可继续的稳定姿态。', en: 'tail' },
        ],
        rules: [{ key: 'r', title: 't', zh: 'z', en: 'e' }],
        glossary: [{ term: 'g', zh: 'z', en: 'e' }],
      },
      palette: { paletteLine: { zh: '色盘：夜色近黑。', en: 'Palette: night.' } },
      promptLibrary: {
        root: '/x',
        tasks: {
          generate_shot_prompt: {
            zh: {
              system: '你是 AI 视频提示词工程师。',
              user: '{{shot_json}}\n- 色盘：{{palette_line}}\n- 风格前缀：{{style_prefix}}\n- GEO：{{geo_block}}\n- 角色：{{character_descriptors}}\n- 时长：{{duration_sec}}\n- 模型：{{model}}',
            },
            en: {
              system: 'You are an AI video prompt engineer.',
              user: '{{shot_json}}\n- palette: {{palette_line}}\n- style: {{style_prefix}}\n- geo: {{geo_block}}\n- characters: {{character_descriptors}}\n- duration: {{duration_sec}}\n- model: {{model}}',
            },
          },
        },
        taskNames: ['generate_shot_prompt'],
      },
      manifest: { filmMeta: { characters: [{ name: 'ROKO', descriptor: 'Determined street kid.' }] } },
    }
    const deps = makeDeps({
      filmEngineeringService: {
        listTemplateShots: vi.fn(() => TEMPLATES),
        getKitContext: vi.fn(() => KIT),
      },
    })
    const ipcMain = await startedTask(deps)
    const r = await ipcMain._get('film-engineering:auto-status')(trustedEvent(), { taskId: 'auto-t1' })
    expect(r.code).toBe(0)
    expect(r.data.exists).toBe(true)
    // 项目投影里必须有 methodology（数据源 = 落盘的 promptContext + 逐镜 promptMissing）
    expect(r.data.methodology).toBeTruthy()
    expect(r.data.methodology.totalVars).toBe(7)
    expect(typeof r.data.methodology.hitVars).toBe('number')
    expect(Array.isArray(r.data.methodology.blockedVars)).toBe(true)
    // `style_prefix` 恒 byDesign ⇒ 拦住直送（机器可判）
    expect(r.data.methodology.deliverable).toBe(false)
    expect(r.data.methodology.blockedVars.some(b => b.name === 'style_prefix' && b.reason === 'byDesign')).toBe(true)
  })

  it('重开项目时：kit 内容变了 ⇒ stale=true；**只换界面语言** ⇒ stale 不变（第 15 轮 i6）', async () => {
    const KIT = {
      doctrine: {
        schemaVersion: 2,
        blocks: [
          { key: 'style', label: 'STYLE', zh: 'z', en: 'e' },
          { key: 'frame_constraint', label: 'FRAME', zh: '尾帧必须是可继续的稳定姿态。', en: 'tail' },
        ],
        rules: [{ key: 'r', title: 't', zh: 'z', en: 'e' }],
        glossary: [{ term: 'g', zh: 'z', en: 'e' }],
      },
      palette: { paletteLine: { zh: '色盘：夜色近黑。', en: 'Palette: night.' } },
      promptLibrary: {
        root: '/x',
        tasks: {
          generate_shot_prompt: {
            zh: { system: 'S', user: '{{shot_json}}\n- 色盘：{{palette_line}}\n- 风格前缀：{{style_prefix}}\n- GEO：{{geo_block}}\n- 角色：{{character_descriptors}}\n- 时长：{{duration_sec}}\n- 模型：{{model}}' },
            en: { system: 'S', user: '{{shot_json}}\n- palette: {{palette_line}}\n- style: {{style_prefix}}\n- geo: {{geo_block}}\n- characters: {{character_descriptors}}\n- duration: {{duration_sec}}\n- model: {{model}}' },
          },
        },
        taskNames: ['generate_shot_prompt'],
      },
      manifest: { filmMeta: { characters: [{ name: 'ROKO', descriptor: 'Determined street kid.' }] } },
    }
    const kitNow = { ...KIT }
    const deps = makeDeps({
      filmEngineeringService: {
        listTemplateShots: vi.fn(() => TEMPLATES),
        getKitContext: vi.fn(() => kitNow),
      },
    })
    const ipcMain = await startedTask(deps)
    const r0 = await ipcMain._get('film-engineering:auto-status')(trustedEvent(), { taskId: 'auto-t1' })
    expect(r0.data.methodology).toBeTruthy()
    expect(r0.data.methodology.stale).toBe(false)
    // ① kit 内容被换 ⇒ stale=true
    kitNow.doctrine = { ...KIT.doctrine, blocks: KIT.doctrine.blocks.map(b => (b.key === 'frame_constraint' ? { ...b, zh: '被换掉的尾帧约束。' } : b)) }
    const r1 = await ipcMain._get('film-engineering:auto-status')(trustedEvent(), { taskId: 'auto-t1' })
    expect(r1.data.methodology.stale).toBe(true)
  })

  it('auto-update-shot 越界/非法字段拒绝，成功则写 editedAt', async () => {
    const deps = makeDeps()
    const ipcMain = await startedTask(deps)
    const oob = await ipcMain._get('film-engineering:auto-update-shot')(trustedEvent(), {
      taskId: 'auto-t1', shotIndex: 9, patch: { prompt: 'x' },
    })
    expect(oob.errorCode).toBe('AUTO_SHOT_INVALID')
    const bad = await ipcMain._get('film-engineering:auto-update-shot')(trustedEvent(), {
      taskId: 'auto-t1', shotIndex: 0, patch: { status: 'done' },
    })
    expect(bad.errorCode).toBe('AUTO_SHOT_INVALID')
    const ok = await ipcMain._get('film-engineering:auto-update-shot')(trustedEvent(), {
      taskId: 'auto-t1', shotIndex: 0, patch: { prompt: 'NEW PROMPT' },
    })
    expect(ok.code).toBe(0)
    expect(ok.data.shot.prompt).toBe('NEW PROMPT')
    expect(typeof ok.data.editedAt).toBe('string')
    const stored = readProject({ home: deps.home, taskId: 'auto-t1' })
    expect(stored.project.shots[0].prompt).toBe('NEW PROMPT')
    expect(stored.project.editedAt).toBeTruthy()
  })

  it('auto-regenerate-shot：编辑后未重新确认 → 不重生成（零调用）', async () => {
    const deps = makeDeps()
    const ipcMain = await startedTask(deps)
    await ipcMain._get('film-engineering:auto-update-shot')(trustedEvent(), {
      taskId: 'auto-t1', shotIndex: 0, patch: { prompt: 'NEW PROMPT' },
    })
    const r = await ipcMain._get('film-engineering:auto-regenerate-shot')(trustedEvent(), {
      taskId: 'auto-t1', shotIndex: 0,
    })
    expect(r.code).toBe(0)
    expect(r.data.ok).toBe(false)
    expect(r.data.needsReconfirm).toBe(true)
    expect(deps._testRegenerateOneShot).not.toHaveBeenCalled()
  })

  it('auto-regenerate-shot：确认后执行并把确认历史追加为第二条', async () => {
    const deps = makeDeps()
    const ipcMain = await startedTask(deps)
    await ipcMain._get('film-engineering:auto-update-shot')(trustedEvent(), {
      taskId: 'auto-t1', shotIndex: 0, patch: { prompt: 'NEW PROMPT' },
    })
    const r = await ipcMain._get('film-engineering:auto-regenerate-shot')(trustedEvent(), {
      taskId: 'auto-t1', shotIndex: 0, confirmed: true,
    })
    expect(r.code).toBe(0)
    expect(r.data.ok).toBe(true)
    expect(deps._testRegenerateOneShot).toHaveBeenCalledTimes(1)
    const stored = readProject({ home: deps.home, taskId: 'auto-t1' })
    expect(stored.project.confirmations).toHaveLength(2)
  })

  it('auto-compose：无台账 → AUTO_MANIFEST_INCOMPLETE', async () => {
    const deps = makeDeps()
    const ipcMain = await startedTask(deps)
    const r = await ipcMain._get('film-engineering:auto-compose')(trustedEvent(), { taskId: 'auto-t1' })
    expect(r.code).not.toBe(0)
    expect(r.errorCode).toBe('AUTO_MANIFEST_INCOMPLETE')
  })
})

describe('自动模式 IPC · 停止（批间生效）', () => {
  it('运行中置停止标志 → driver 的 shouldStop() 变 true，且结束后清理（幂等）', async () => {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const deps = makeDeps({
      _testRunProduction: vi.fn(async () => {
        await gate
        return {
          ok: false, stopped: true,
          ledger: { batches: [{ batchIndex: 0, runId: 'auto/x/b0', shotIds: [], shots: [], status: 'pending' }] },
          renderManifest: null, manifestError: null, failedBatches: [],
        }
      }),
    })
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, deps)
    const planned = await planOnce(ipcMain, trustedEvent(), { taskId: 'auto-stop-1' })
    const startEvent = trustedEvent()
    const started = await ipcMain._get('film-engineering:auto-start')(startEvent, {
      planId: planned.data.planId, taskId: 'auto-stop-1', confirmed: true,
    })
    // ★ 回归锁：长任务必须**立即返回**（真机 E2E 抓到的缺陷：原实现 await 整轮，
    //   渲染端 await autoStart() 被挂住、面板永远升不到运行态）。
    expect(started.data.started).toBe(true)
    expect(started.data.dispatched).toBe(true)
    expect(started.data.stopped).toBe(false)
    expect(started.data.ok).toBe(null)

    // 未停止时 shouldStop() 为 false（否则每批都会被误判为停止）
    const driverOpts = deps._testRunProduction.mock.calls[0][0]
    expect(driverOpts.shouldStop()).toBe(false)

    const stop = await ipcMain._get('film-engineering:auto-stop')(trustedEvent(), { taskId: 'auto-stop-1' })
    expect(stop.code).toBe(0)
    expect(stop.data.stopping).toBe(true)
    expect(driverOpts.shouldStop()).toBe(true)

    release()
    await new Promise((r) => setTimeout(r, 30))
    // 收口结果经事件回报（而不是 invoke 返回值）——界面据此刷新到完成态
    const events = startEvent.sender.send.mock.calls.map((c) => c[1])
    const complete = events.find((e) => e.type === 'production:complete')
    expect(complete).toBeTruthy()
    expect(complete.stopped).toBe(true)

    // 任务结束后标志被清理：再次请求停止 → 明确回报「未在运行」
    const idle = await ipcMain._get('film-engineering:auto-stop')(trustedEvent(), { taskId: 'auto-stop-1' })
    expect(idle.data.stopping).toBe(false)
    expect(idle.data.running).toBe(false)
  })

  it('停止通道拒绝非法 taskId', async () => {
    const ipcMain = createMockIpcMain()
    registerAutoHandlers(ipcMain, makeDeps())
    const r = await ipcMain._get('film-engineering:auto-stop')(trustedEvent(), { taskId: 'a/b' })
    expect(r.code).not.toBe(0)
    expect(r.errorCode).toBe('AUTO_BAD_PARAM')
  })
})
