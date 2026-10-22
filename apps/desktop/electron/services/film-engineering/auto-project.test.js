// @ts-check
'use strict'
/**
 * auto-project 契约测试（openspec change: film-auto-mode，design D5/D19/D25/D27/D30）
 *
 * 覆盖：
 *  - 计划文件：原子写 / TTL 过期 / consumed / taskId 归属不匹配（AUTO_PLAN_EXPIRED / AUTO_PLAN_MISMATCH）
 *  - 项目文件：创建 / 已存在拒绝（AUTO_TASK_EXISTS）/ overwrite 归档 / 损坏 fail-closed
 *  - 镜头编辑：prompt 非空且 ≤50000 / refPaths 受控根 / seconds 枚举（AUTO_SHOT_INVALID）
 *  - 确认历史：append-only、最新一条为基准、编辑后必须重新确认（needsReconfirm）
 *  - 计数：providerCalls 派发前原子自增 + 对账暴露差值（D25/D30）
 * 全部在 os.tmpdir() 随机隔离目录内，禁止触碰仓库共享文件。
 */
const fs = require('fs')
const os = require('os')
const path = require('path')

const {
  MAX_SHOT_PROMPT_LENGTH,
  AUTO_ROOT_LABEL,
  planFilePath,
  writePlan,
  readPlan,
  markPlanConsumed,
  projectDir,
  projectFilePath,
  createProject,
  writeProject,
  readProject,
  readProjectFile,
  updateShot,
  markEdited,
  appendConfirmation,
  latestConfirmation,
  needsReconfirm,
  incrementProviderCalls,
  reconcileCounters,
  archiveTaskRun,
  resolveTaskId,
  listTaskRuns,
} = require('./auto-project')

const MEDIA_ROOT = path.join(os.tmpdir(), 'film-engineering')
const refPath = (n) => path.join(MEDIA_ROOT, 'references', 'ref-' + n + '.png')

function tmpHome () {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'auto-project-test-'))
}

function fakePlan (taskId) {
  return {
    planId: 'plan-abc123',
    taskId,
    scriptHash: 'sha-script',
    refsFingerprint: 'sha-refs',
    aspect: '16x9',
    seconds: 5,
    targetDurationSec: 20,
    providerId: 'minimax',
    plannedDurationSec: 20,
    characterMap: { ROKO: '小强' },
    characterRefs: [{ name: '小强', path: refPath('a') }],
    sceneRefs: [],
    shots: [
      { index: 0, shotId: 'auto-000', prompt: 'P0', seconds: 5, refPaths: [refPath('a')] },
      { index: 1, shotId: 'auto-001', prompt: 'P1', seconds: 5, refPaths: [] },
    ],
    warnings: [],
  }
}

describe('auto-project · 计划文件', () => {
  it('原子写 + 读回 + consumed 标记', () => {
    const home = tmpHome()
    const taskId = 'auto-1'
    const plan = fakePlan(taskId)
    const w = writePlan({ home, plan, taskId, ttlMs: 60_000 })
    expect(w.ok).toBe(true)
    expect(fs.existsSync(planFilePath(home, plan.planId))).toBe(true)
    // 落盘期间不残留 .tmp
    expect(fs.readdirSync(path.dirname(planFilePath(home, plan.planId))).some((f) => f.endsWith('.tmp'))).toBe(false)

    const r = readPlan({ home, planId: plan.planId, taskId })
    expect(r.ok).toBe(true)
    expect(r.plan.shots).toHaveLength(2)

    markPlanConsumed({ home, planId: plan.planId })
    const r2 = readPlan({ home, planId: plan.planId, taskId })
    expect(r2.ok).toBe(false)
    expect(r2.errorCode).toBe('AUTO_PLAN_EXPIRED')
  })

  it('planId 不存在 / 过期 / taskId 不匹配', () => {
    const home = tmpHome()
    const missing = readPlan({ home, planId: 'plan-nope', taskId: 'auto-1' })
    expect(missing.errorCode).toBe('AUTO_PLAN_EXPIRED')

    const plan = fakePlan('auto-1')
    writePlan({ home, plan, taskId: 'auto-1', ttlMs: -1 }) // 立即过期
    const expired = readPlan({ home, planId: plan.planId, taskId: 'auto-1' })
    expect(expired.errorCode).toBe('AUTO_PLAN_EXPIRED')

    writePlan({ home, plan, taskId: 'auto-1', ttlMs: 60_000 })
    const mismatch = readPlan({ home, planId: plan.planId, taskId: 'auto-2' })
    expect(mismatch.errorCode).toBe('AUTO_PLAN_MISMATCH')
  })

  it('损坏的计划文件 → AUTO_PLAN_EXPIRED（fail-closed，不静默续跑）', () => {
    const home = tmpHome()
    const plan = fakePlan('auto-1')
    writePlan({ home, plan, taskId: 'auto-1', ttlMs: 60_000 })
    fs.writeFileSync(planFilePath(home, plan.planId), '{ not json', 'utf8')
    expect(readPlan({ home, planId: plan.planId, taskId: 'auto-1' }).errorCode).toBe('AUTO_PLAN_EXPIRED')
  })

  it('根目录标签为 auto（与受控媒体根同层）', () => {
    expect(AUTO_ROOT_LABEL).toBe('auto')
    expect(planFilePath('/x', 'plan-1').replace(/\\/g, '/')).toContain('/film-engineering/auto/_plans/plan-1.json')
  })
})

describe('auto-project · 项目文件', () => {
  it('创建 → 写盘 → 读回（含 confirmations/counters 结构）', () => {
    const home = tmpHome()
    const plan = fakePlan('auto-1')
    const p = createProject({ plan, taskId: 'auto-1', now: '2026-10-09T00:00:00.000Z' })
    expect(p.schemaVersion).toBe(1)
    expect(p.taskId).toBe('auto-1')
    expect(p.planId).toBe(plan.planId)
    expect(p.shots).toHaveLength(2)
    expect(p.shots[0].status).toBe('pending')
    expect(p.shots[0].outputPath).toBeNull()
    expect(p.confirmations).toEqual([])
    expect(p.counters).toEqual({ providerCalls: 0 })
    expect(p.runSeq).toBe(1)

    expect(writeProject({ home, project: p }).ok).toBe(true)
    const back = readProject({ home, taskId: 'auto-1' })
    expect(back.ok).toBe(true)
    expect(back.project.shots[1].shotId).toBe('auto-001')
  })

  it('已存在且未 overwrite → AUTO_TASK_EXISTS（不覆盖既有产物与历史）', () => {
    const home = tmpHome()
    const plan = fakePlan('auto-1')
    writeProject({ home, project: createProject({ plan, taskId: 'auto-1' }) })
    const again = createProject({ plan, taskId: 'auto-1', home })
    expect(again.errorCode).toBe('AUTO_TASK_EXISTS')
  })

  it('overwrite 归档旧一轮（plan/ledger 进 archive/<seq>，confirmations 不被重置为静默丢失）', () => {
    const home = tmpHome()
    const plan = fakePlan('auto-1')
    const first = createProject({ plan, taskId: 'auto-1' })
    appendConfirmation(first, { payloadHash: 'h1', shotsFingerprint: 'f1', now: '2026-10-09T01:00:00.000Z' })
    writeProject({ home, project: first })
    fs.writeFileSync(path.join(projectDir(home, 'auto-1'), 'ledger.json'), '{"schemaVersion":1,"taskId":"auto-1","batches":[]}', 'utf8')

    const second = createProject({ plan, taskId: 'auto-1', home, overwrite: true })
    expect(second.taskId).toBe('auto-1')
    expect(second.runSeq).toBe(2)
    expect(second.supersededFrom).toBe(1)
    expect(second.confirmations).toEqual([]) // 新一轮确认段从空开始
    // 旧一轮产物与确认历史被归档保留（审计链不断裂）
    const archived = listTaskRuns({ home, taskId: 'auto-1' })
    expect(archived.ok).toBe(true)
    expect(archived.runs.map((r) => r.runSeq)).toContain(1)
    const archivedProject = JSON.parse(fs.readFileSync(archived.runs.find((r) => r.runSeq === 1).projectPath, 'utf8'))
    expect(archivedProject.confirmations).toHaveLength(1)
  })

  it('损坏的项目文件 → fail-closed', () => {
    const home = tmpHome()
    const plan = fakePlan('auto-1')
    writeProject({ home, project: createProject({ plan, taskId: 'auto-1' }) })
    fs.writeFileSync(projectFilePath(home, 'auto-1'), 'broken', 'utf8')
    const r = readProject({ home, taskId: 'auto-1' })
    expect(r.ok).toBe(false)
    expect(r.errorCode).toBe('AUTO_PROJECT_UNREADABLE')
  })

  it('taskId 解析：路径安全校验（拒绝分隔符/空）', () => {
    expect(resolveTaskId('auto-1').ok).toBe(true)
    expect(resolveTaskId('a/b').ok).toBe(false)
    expect(resolveTaskId('..').ok).toBe(false)
    expect(resolveTaskId('').ok).toBe(false)
    expect(resolveTaskId('x'.repeat(65)).ok).toBe(false)
  })
})

describe('auto-project · 镜头编辑与确认', () => {
  it('patch：prompt 非空且 ≤50000；seconds 枚举；refPaths 受控根', () => {
    const plan = fakePlan('auto-1')
    const p = createProject({ plan, taskId: 'auto-1', mediaRoot: MEDIA_ROOT })

    expect(updateShot(p, { shotIndex: 0, patch: { prompt: 'new' }, mediaRoot: MEDIA_ROOT }).ok).toBe(true)
    expect(p.shots[0].prompt).toBe('new')

    expect(updateShot(p, { shotIndex: 0, patch: { prompt: '   ' }, mediaRoot: MEDIA_ROOT }).errorCode).toBe('AUTO_SHOT_INVALID')
    expect(updateShot(p, { shotIndex: 0, patch: { prompt: 'x'.repeat(MAX_SHOT_PROMPT_LENGTH + 1) }, mediaRoot: MEDIA_ROOT }).errorCode).toBe('AUTO_SHOT_INVALID')
    expect(updateShot(p, { shotIndex: 0, patch: { seconds: 7 }, mediaRoot: MEDIA_ROOT }).errorCode).toBe('AUTO_SHOT_INVALID')
    expect(updateShot(p, { shotIndex: 9, patch: { prompt: 'x' }, mediaRoot: MEDIA_ROOT }).errorCode).toBe('AUTO_SHOT_INVALID')
    expect(updateShot(p, { shotIndex: 0, patch: { refPaths: ['C:/evil/a.png'] }, mediaRoot: MEDIA_ROOT }).errorCode).toBe('AUTO_SHOT_INVALID')
    expect(updateShot(p, { shotIndex: 0, patch: { refPaths: [refPath('b')] }, mediaRoot: MEDIA_ROOT }).ok).toBe(true)
    expect(p.shots[0].refPaths).toEqual([refPath('b')])
    // 清空参考图合法（删除该镜参考）
    expect(updateShot(p, { shotIndex: 0, patch: { refPaths: [] }, mediaRoot: MEDIA_ROOT }).ok).toBe(true)
    expect(p.shots[0].refPaths).toEqual([])
  })

  it('确认历史 append-only；最新一条为基准', () => {
    const plan = fakePlan('auto-1')
    const p = createProject({ plan, taskId: 'auto-1' })
    appendConfirmation(p, { payloadHash: 'h1', shotsFingerprint: 'f1', planVersion: 1, now: '2026-10-09T01:00:00.000Z' })
    appendConfirmation(p, { payloadHash: 'h2', shotsFingerprint: 'f2', planVersion: 1, now: '2026-10-09T02:00:00.000Z' })
    expect(p.confirmations).toHaveLength(2)
    expect(latestConfirmation(p).payloadHash).toBe('h2')
    expect(latestConfirmation(p).at).toBe('2026-10-09T02:00:00.000Z')
  })

  it('needsReconfirm：无确认 / 编辑晚于确认 / 载荷哈希不一致 三种情形均需重确认', () => {
    const plan = fakePlan('auto-1')
    const p = createProject({ plan, taskId: 'auto-1' })
    expect(needsReconfirm(p, { payloadHash: 'h1' })).toBe(true)

    appendConfirmation(p, { payloadHash: 'h1', shotsFingerprint: 'f1', now: '2026-10-09T01:00:00.000Z' })
    expect(needsReconfirm(p, { payloadHash: 'h1' })).toBe(false)
    expect(needsReconfirm(p, { payloadHash: 'h-other' })).toBe(true)

    markEdited(p, '2026-10-09T03:00:00.000Z')
    expect(needsReconfirm(p, { payloadHash: 'h1' })).toBe(true)
    appendConfirmation(p, { payloadHash: 'h1', shotsFingerprint: 'f1', now: '2026-10-09T03:00:01.000Z' })
    expect(needsReconfirm(p, { payloadHash: 'h1' })).toBe(false)
  })

  it('编辑接口自动写 editedAt（不依赖调用方自觉）', () => {
    const plan = fakePlan('auto-1')
    const p = createProject({ plan, taskId: 'auto-1', mediaRoot: MEDIA_ROOT })
    expect(p.editedAt).toBeNull()
    updateShot(p, { shotIndex: 0, patch: { prompt: 'x' }, mediaRoot: MEDIA_ROOT, now: '2026-10-09T04:00:00.000Z' })
    expect(p.editedAt).toBe('2026-10-09T04:00:00.000Z')
  })

  it('providerCalls 派发前自增；对账暴露差值（崩溃窗口正常产物，不静默修正）', () => {
    const plan = fakePlan('auto-1')
    const p = createProject({ plan, taskId: 'auto-1' })
    expect(incrementProviderCalls(p).counters.providerCalls).toBe(1)
    expect(incrementProviderCalls(p).counters.providerCalls).toBe(2)
    // 台账侧只完成 1 镜 → 差值 1 如实暴露
    const rec = reconcileCounters(p, { doneCount: 1, totalCount: 2 })
    expect(rec).toEqual({ providerCalls: 2, ledgerDoneCount: 1, mismatch: 1 })
  })
})

describe('F-I · auto-project · 方法论上下文的落盘口径', () => {
  it('plan 级 promptContext 落一次；逐镜只落 vars/missing（不含方法论长文本）', () => {
    const home = tmpHome()
    const project = createProject({
      home,
      taskId: 'task-methodology',
      now: '2026-10-21T00:00:00.000Z',
      plan: {
        planId: 'plan-1',
        aspect: '16x9',
        seconds: 5,
        targetDurationSec: 10,
        providerId: 'minimax',
        characterMap: {},
        promptContext: {
          taskId: 'generate_shot_prompt',
          locale: 'zh',
          promptAssetHash: 'a'.repeat(64),
          frameConstraint: { available: true, hash: 'b'.repeat(64), length: 12, locale: 'zh', fallback: false, truncated: false, source: 'doctrine.frame_constraint' },
          frameConstraintPending: true,
          fallbackLocales: { doctrine: {}, palette: {}, task: {} },
          assetsIncomplete: false,
        },
        shots: [
          { index: 0, shotId: 'auto-000', title: '镜 1', prompt: 'P0', imagePrompt: 'P0', videoPrompt: 'V0', endFramePrompt: '', characterNames: [], refPaths: [], seconds: 5, promptVars: { shot_json: '{}', palette_line: '色盘' }, promptMissing: [{ name: 'style_prefix', reason: 'byDesign' }], promptRenderHash: 'c'.repeat(64) },
          { index: 1, shotId: 'auto-001', title: '镜 2', prompt: 'P1', imagePrompt: 'P1', videoPrompt: 'V1', endFramePrompt: '', characterNames: [], refPaths: [], seconds: 5, promptVars: { shot_json: '{}', palette_line: '色盘' }, promptMissing: [{ name: 'style_prefix', reason: 'byDesign' }], promptRenderHash: 'd'.repeat(64) },
        ],
      },
    })
    expect(project.ok).toBeUndefined()
    // plan 级：上下文落一次
    expect(project.promptContext).toBeTruthy()
    expect(project.promptContext.promptAssetHash).toBe('a'.repeat(64))
    // 逐镜：只落 vars / missing / promptRenderHash
    expect(project.shots[0].promptVars).toEqual({ shot_json: '{}', palette_line: '色盘' })
    expect(project.shots[0].promptMissing).toEqual([{ name: 'style_prefix', reason: 'byDesign' }])
    expect(project.shots[0].promptRenderHash).toBe('c'.repeat(64))
    // 体积口径：方法论**长文本**不得在逐镜重复（这里断言逐镜没有 frameConstraint 原文）
    const serialized = JSON.stringify(project)
    expect(serialized.split('尾帧必须是可继续的稳定姿态。').length - 1).toBe(0)
    expect(serialized.split('a'.repeat(64)).length - 1).toBe(1)
  })

  /**
   * 第 8 轮 i6（Warning / consistency）：⑦ 的体积断言只查了**方法论长文本**，
   * 没覆盖「N 镜 × 至多 7 条重复 reason」——清单也是逐镜落的。
   *
   * 为什么不把清单改成「由重渲染得到」：面板的 `blockedVars` / `deliverable`
   * **就是**从落盘的 `promptMissing` 汇总的（见 `film-engineering-auto.js` 的
   * `buildMethodologySummary`）⇒ 清单不落盘，面板就没数据。
   * ⇒ 保留落盘，但给**体积上限**加判据：清单每条是短结构（名字 + 枚举 reason），
   *   条数 ≤ 7（变量总数）⇒ 单镜清单体积有界，不随资产文本长度增长。
   */
  it('逐镜清单体积有界：条目 ≤ 变量数、每条是短结构（name + 枚举 reason）', () => {
    const home = tmpHome()
    const project = createProject({
      home,
      taskId: 'task-methodology',
      now: '2026-10-21T00:00:00.000Z',
      plan: {
        planId: 'plan-1',
        aspect: '16:9',
        seconds: 5,
        targetDurationSec: 10,
        taskId: 'generate_shot_prompt',
        locale: 'zh',
        promptAssetHash: 'a'.repeat(64),
        frameConstraint: { available: true, hash: 'b'.repeat(64), length: 12, locale: 'zh', fallback: false, truncated: false, source: 'doctrine.frame_constraint' },
        frameConstraintPending: true,
        fallbackLocales: { doctrine: {}, palette: {}, task: {} },
        assetsIncomplete: false,
        shots: [
          {
            index: 0, shotId: 'auto-000', title: '镜 1', prompt: 'P0', imagePrompt: 'P0', videoPrompt: 'V0',
            endFramePrompt: '', characterNames: [], refPaths: [], seconds: 5,
            promptVars: { shot_json: '{}', palette_line: '色盘' },
            promptMissing: [
              { name: 'style_prefix', reason: 'byDesign' },
              { name: 'geo_block', reason: 'assetMissing' },
              { name: 'extra_var', reason: 'templateVar' },
              { name: 'Bad Name', reason: 'badVarName' },
            ],
            promptRenderHash: 'c'.repeat(64),
          },
        ],
      },
    })
    const miss = project.shots[0].promptMissing
    expect(Array.isArray(miss)).toBe(true)
    /**
     * 第 9 轮 i2（Critical/consistency）：上限必须**分两类**算 ——
     * `missing` 里除了 7 个任务变量，还可能有 `templateVar` / `badVarName`
     *（**模板多要的**变量与我们给错的名字），它们**不在 7 个之内**。
     * 原来的「条数 ≤ 7」在模板多要变量时**必然为假**（自己定的判据把自己打脸）。
     */
    const TASK_VAR_NAMES = ['shot_json', 'palette_line', 'style_prefix', 'geo_block', 'character_descriptors', 'duration_sec', 'model']
    const taskVarEntries = miss.filter(m => TASK_VAR_NAMES.includes(m.name))
    const otherEntries = miss.filter(m => !TASK_VAR_NAMES.includes(m.name))
    expect(taskVarEntries.length).toBeLessThanOrEqual(TASK_VAR_NAMES.length)
    // 非任务变量条目另计，且总量有界（模板乱要变量也不该让清单无限膨胀）
    // ⚠ 上限 **8**（不是 16）：8 × (64 字符名 + JSON 开销) ≈ 560 B < 1,024 B 的字节上限
    //   ⇒ 写成 16 会让「条数 ≤ 16」与「序列化 ≤ 1,024 B」**互相矛盾**（第 13 轮 i3）
    // ⚠ 第 15/16 轮 i2 两次更正：上面的推导**漏算了 7 条任务变量**（总 15 条）**与多字节**，
    //   第 15 轮又漏算了 **JSON 转义**（引号/反斜杠按 \uXXXX 记 6 字节/字）
    //   ⇒ 字节上限改为 **8 KiB**（15 × (64×6 B 名 + ~30 B) ≈ 6.2 KB ≤ 8 KB）⇒ 两条**自洽**。
    expect(otherEntries.length).toBeLessThanOrEqual(8)
    // **字节**预算（不是字符数）：CJK 名 3 字节/字
    expect(Buffer.byteLength(JSON.stringify(miss), 'utf8')).toBeLessThanOrEqual(8192)
    // 每条都是短结构：name + 枚举 reason，不含长文本
    const REASONS = ['byDesign', 'assetMissing', 'templateVar', 'badVarName', 'oversizeVar']
    for (const m of miss) {
      expect(Object.keys(m).sort()).toEqual(['name', 'reason'])
      expect(typeof m.name).toBe('string')
      expect(REASONS).toContain(m.reason)
      expect(m.name.length).toBeLessThanOrEqual(64)
    }
    // 单镜清单序列化后仍然很小（不含任何资产原文）
    expect(JSON.stringify(miss).length).toBeLessThan(1024)
  })
})
