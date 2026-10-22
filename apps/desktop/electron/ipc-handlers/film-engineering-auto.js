// @ts-check
'use strict'
/**
 * film-engineering 自动模式 IPC handlers（openspec change: film-auto-mode）
 *
 * 通道（全部 withSenderCheck + 入参校验）：
 *   film-engineering:auto-plan           → 规划并落盘计划（零 provider 调用）
 *   film-engineering:auto-start          → 确认/续跑并执行（服务端重建 shots，客户端不得传 plan）
 *   film-engineering:auto-status         → 只读：项目 + 台账 + 磁盘 + 收口清单 + 计数对账
 *   film-engineering:auto-update-shot    → 片段编辑（唯一内容真源写入入口）
 *   film-engineering:auto-regenerate-shot→ 单镜重生成（原子覆盖；需最新确认）
 *   film-engineering:auto-compose        → 收口清单校验（合成 run 由渲染端经既有 pipeline 通道发起）
 *   事件 film-engineering:auto-update    → 批次/逐镜进度（driver 已节流，负载只带计数）
 *
 * 关键合同（design D3/D4/D5/D17/D25/D28/D31）：
 *   - 客户端**不得**回传分镜或参考图路径：auto-start 只收 {planId, taskId, confirmed, overwrite?}，
 *     分镜一律由服务端读自己落盘的计划重建，并对 refPaths 逐项重校验受控媒体根；
 *   - 确认门槛绑定**所有产生 provider 调用的通道**（auto-start 与 auto-regenerate-shot）；
 *   - 单飞：同一时刻只允许一个自动任务在跑（AUTO_TASK_BUSY）；
 *   - 执行不经 pipeline 引擎（直连 production-driver + auto-runner）；合成仍走既有 manifest 直通 run。
 */

const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('./helpers')
const { registerAutoInspectHandlers } = require('./film-engineering-auto-inspect')
const { buildMethodologySummary, shotPreview } = require('./film-engineering-auto-projection')
const path = require('path')

const {
  validateAutoInputs, planAutoShots, buildPlanId, buildPayloadHash, buildShotFingerprint,
  MAX_AUTO_SHOTS, PRODUCTION_BATCH_SIZE,
} = require('../services/film-engineering/auto-plan')
const {
  writePlan, readPlan, markPlanConsumed, createProject, writeProject, readProject,
  readProjectFile, updateShot, appendConfirmation, latestConfirmation, needsReconfirm,
  incrementProviderCalls, reconcileCounters, projectDir, projectFilePath, ledgerFilePath,
  resolveTaskId, mediaRootOf, isWithinRoot,
} = require('../services/film-engineering/auto-project')
const {
  runAutoBatch, regenerateOneShot, collectMissingShots, autoRunIdFor, shotFileName,
} = require('../services/film-engineering/auto-runner')
// 第 12 轮 i6：重开项目时用**当前** kit 重算提示词资产哈希 ⇒ 检出「资产已变」
const { buildPlanPromptContext } = require('../services/film-engineering/shot-prompt-task')
const {
  runProduction, loadLedger, resolveResumePlan, buildRenderManifest, PRODUCTION_BATCH_SIZE: DRIVER_BATCH_SIZE,
} = require('../services/film-engineering/production-driver')
const { getFilmMediaRoot } = require('../services/film-engineering/film-render')
const { resolveFilmVideoProvider, FILM_ASPECTS, FILM_DURATIONS } = require('../services/film-engineering/video-gen')

/** 单飞注册表（D28）：同一时刻只允许一个自动模式任务在跑 */
const runningAutoTasks = new Set()
/** 停止标志注册表：批间生效；只对正在运行的任务有效（停止后即成为可续跑状态） */
const stoppingAutoTasks = new Set()


function nowStamp () {
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  return 'auto-' + d.getFullYear() + p(d.getMonth() + 1) + p(d.getDate()) + p(d.getHours()) + p(d.getMinutes()) + p(d.getSeconds())
}

function defaultProbe (runId, count) {
  const fs = require('fs')
  const { getFilmRunDir } = require('../services/film-engineering/video-gen')
  const dir = getFilmRunDir(runId)
  const missing = []
  for (let i = 0; i < count; i++) {
    if (!fs.existsSync(path.join(dir, shotFileName(i)))) missing.push(i)
  }
  return { missing }
}


function registerAutoHandlers (ipcMain, deps) {
  const o = deps || {}
  const log = o.log || { info () {}, warn () {}, error () {} }
  const service = o.filmEngineeringService
  const aiGenerator = o.aiGenerator
  const home = o.home
  const mediaRoot = mediaRootOf(home)
  const probe = o._testProbe || defaultProbe
  const driver = o._testRunProduction || runProduction
  const runBatchFn = o._testRunAutoBatch || runAutoBatch
  const regenerateFn = o._testRegenerateOneShot || regenerateOneShot

  /** 失败信封（带 errorCode，供渲染端做本地化映射） */
  function fail (code, errorCode, message) {
    return { code, errorCode, message }
  }

  function validationFail (errorCode, message) {
    return fail(EC.VALIDATION_ERROR, errorCode, message)
  }

  function providerOrError () {
    const provider = resolveFilmVideoProvider(aiGenerator)
    if (!provider) {
      return {
        error: fail(EC.REQUEST_ERROR, 'VIDEO_MODEL_NOT_CONFIGURED',
          '自动模式需要视频模型（如 Seedance / Kling / Veo 等），请在模型设置中配置并设为默认视频 Provider 后重试'),
      }
    }
    return { provider }
  }

  /** 项目文件 → 渲染端投影（含可编辑字段；供片段编辑使用） */
  function projectView (project, ledger, extra) {
    const shots = Array.isArray(project.shots) ? project.shots : []
    const done = shots.filter((s) => s.status === 'done').length
    const rec = reconcileCounters(project, { doneCount: done, totalCount: shots.length })
    // 影视工程 v2 · F-I（第 12 轮 i6）：**重开项目时也要校验资产没被换过** ——
    // 面板的命中/阻断是从落盘的 `promptMissing` 重算的，但那份清单是**当时**的资产算出来的；
    // 若 kit 已被替换，重算出来的结论会**看起来仍然成立** ⇒ 与「篡改必须可检测」契约冲突。
    // ⇒ 用**当前** kit 重算 `promptAssetHash`，与落盘值不一致 ⇒ 标 `stale`（面板提示「资产已变」）。
    let stale = null
    const persistedCtx = project.promptContext
    if (persistedCtx && typeof persistedCtx.promptAssetHash === 'string' && persistedCtx.promptAssetHash) {
      try {
        const kitNow = typeof service.getKitContext === 'function' ? service.getKitContext() : null
        if (kitNow) {
          const now = buildPlanPromptContext({ kit: kitNow, locale: persistedCtx.locale })
          // ⚠ 只有**当前 kit 结构完整**（无 W10/W11）时才算 stale（第 13 轮 i6）：
          // kit/doctrine **缺失**时重算出来的哈希必然不同 ⇒ 会误报「资产已变」，
          // 而事实是「资产不完整」⇒ 那是**另一条**提示（`assetsIncomplete`）。
          const structurallyComplete = now.warnings.length === 0
          if (structurallyComplete && now.promptContext && now.promptContext.promptAssetHash) {
            stale = now.promptContext.promptAssetHash !== persistedCtx.promptAssetHash
          }
        }
      } catch (e) {
        // 取不到当前 kit ⇒ **不判 stale**（不误报）；宁可不提示，也不谎称资产已变
      }
    }
    return {
      taskId: project.taskId,
      runSeq: project.runSeq || 1,
      planId: project.planId,
      aspect: project.aspect,
      seconds: project.seconds,
      targetDurationSec: project.targetDurationSec,
      plannedDurationSec: project.plannedDurationSec,
      providerId: project.providerId,
      createdAt: project.createdAt,
      editedAt: project.editedAt,
      lastConfirmedAt: (latestConfirmation(project) || {}).at || null,
      shots,
      // 影视工程 v2 · F-I（第 9 轮 i4）：方法论接入状态在**重开项目**时也要可见。
      // 数据源是**落盘**的 plan 级 `promptContext` + 逐镜 `promptMissing`（不是规划结果 ——
      // 规划结果不落盘，重开时不在内存里）⇒ 复用**同一个** `buildMethodologySummary`，
      // 渲染端不另写一份实现（两份实现必然漂移，漂移会让面板显示的接上量与落盘清单对不上）。
      methodology: buildMethodologySummary({ shots, promptContext: project.promptContext, stale }),
      warnings: Array.isArray(project.warnings) ? project.warnings : [],
      counters: rec,
      doneCount: done,
      totalCount: shots.length,
      ledgerPresent: Boolean(ledger),
      ...(extra || {}),
    }
  }

  // ── 规划（零 provider 调用）────────────────────────────────────────────
  ipcMain.handle('film-engineering:auto-plan', withSenderCheck(async (_e, payload) => {
    const params = payload || {}
    const pre = providerOrError()
    if (pre.error) return pre.error
    const valid = validateAutoInputs(params)
    if (!valid.ok) return validationFail(valid.errorCode, valid.message)
    const taskIdRes = resolveTaskId(params.taskId === undefined || params.taskId === null || params.taskId === '' ? nowStamp() : params.taskId)
    if (!taskIdRes.ok) return validationFail(taskIdRes.errorCode, taskIdRes.message)
    const taskId = taskIdRes.taskId

    let templates
    try {
      templates = service.listTemplateShots()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      return message.startsWith('FILM_KIT_UNAVAILABLE')
        ? fail(EC.REQUEST_ERROR, 'FILM_KIT_UNAVAILABLE', message)
        : fail(EC.REQUEST_ERROR, 'AUTO_TEMPLATE_UNAVAILABLE', message)
    }

    // 影视工程 v2 · F-I：把方法论资产（doctrine / palette / promptLibrary / 角色）接进规划。
    // 拿不到 kit 上下文时**不产出**任何方法论字段 ⇒ 既有字段逐字不变（纯增量）。
    // ⚠ 不给初值：try 与 catch **两条分支都会赋值** ⇒ 初值是无用赋值（ESLint no-useless-assignment）。
    let kitCtx
    try {
      kitCtx = typeof service.getKitContext === 'function' ? service.getKitContext() : null
    } catch (e) {
      kitCtx = null
    }
    const planned = planAutoShots({
      script: params.script,
      characterRefs: params.characterRefs || [],
      sceneRefs: params.sceneRefs || [],
      aspect: params.aspect,
      seconds: Number(params.seconds),
      targetDurationSec: Number(params.targetDurationSec),
      templateShots: templates,
      providerId: pre.provider.providerId,
      mediaRoot,
      kit: kitCtx,
      locale: params.locale === 'en' ? 'en' : 'zh',
    })
    if (!planned.ok) return validationFail(planned.errorCode, planned.message)

    const scriptHash = planned.scriptHash
    const planId = buildPlanId({
      taskId,
      scriptHash,
      refsFingerprint: planned.refsFingerprint,
      aspect: params.aspect,
      seconds: Number(params.seconds),
      targetDurationSec: Number(params.targetDurationSec),
      providerId: pre.provider.providerId,
    })
    const plan = {
      planId,
      taskId,
      scriptHash,
      refsFingerprint: planned.refsFingerprint,
      aspect: params.aspect,
      seconds: Number(params.seconds),
      targetDurationSec: Number(params.targetDurationSec),
      plannedDurationSec: planned.plannedDurationSec,
      providerId: pre.provider.providerId,
      providerModel: pre.provider.model || '',
      characterMap: planned.characterMap,
      characterRefs: (params.characterRefs || []).map((r) => ({ name: r.name, path: r.path })),
      sceneRefs: (params.sceneRefs || []).slice(),
      shots: planned.shots,
      warnings: planned.warnings,
      // 影视工程 v2 · F-I：plan 级方法论上下文（落计划文件 + 项目文件）
      ...(planned.promptContext ? { promptContext: planned.promptContext } : {}),
    }
    const written = writePlan({ home, plan, taskId })
    if (!written.ok) return fail(EC.REQUEST_ERROR, written.errorCode, written.message)
    const payloadHash = buildPayloadHash({
      shots: plan.shots, aspect: plan.aspect, seconds: plan.seconds, providerId: plan.providerId,
    })
    return {
      code: 0,
      data: {
        planId,
        taskId,
        planExpiresAt: written.expiresAt,
        payloadHash,
        aspect: plan.aspect,
        seconds: plan.seconds,
        targetDurationSec: plan.targetDurationSec,
        plannedDurationSec: plan.plannedDurationSec,
        shotCount: plan.shots.length,
        batchCount: planned.estimates.batchCount,
        shotsWithReferences: planned.shotsWithReferences,
        characterMap: plan.characterMap,
        warnings: plan.warnings,
        estimates: planned.estimates,
        // 影视工程 v2 · F-I：方法论接入状态（只读面板的数据源；plan 级摘要）
        methodology: buildMethodologySummary(planned),
        provider: { id: plan.providerId, model: plan.providerModel },
        shots: plan.shots.map(shotPreview),
      },
    }
  }))

  // ── 启动 / 续跑 ────────────────────────────────────────────────────────
  ipcMain.handle('film-engineering:auto-start', withSenderCheck(async (event, payload) => {
    const params = payload || {}
    const pre = providerOrError()
    if (pre.error) return pre.error
    const taskIdRes = resolveTaskId(params.taskId)
    if (!taskIdRes.ok) return validationFail(taskIdRes.errorCode, taskIdRes.message)
    const taskId = taskIdRes.taskId

    // 续跑 vs 新建（评审 i2 修正后的真实语义）：
    //   计划在**首次启动时就被消费**（这是刻意的——防重放），因此续跑**不能**再依赖计划；
    //   续跑的内容真源是项目文件本身（prompts/refPaths/seconds 都在里面），
    //   磁盘上已有的镜由 driver 的 probe 复核后跳过，剩下的继续跑。
    const existing = readProject({ home, taskId })
    let project = null
    let resumed = false
    let planUsed = null
    if (existing.ok) {
      const samePlan = !params.planId || existing.project.planId === params.planId
      if (samePlan && params.overwrite !== true) {
        project = existing.project
        resumed = true
      } else if (params.overwrite === true) {
        const planRes = readPlan({ home, planId: params.planId, taskId })
        if (!planRes.ok) return validationFail(planRes.errorCode, planRes.message)
        planUsed = planRes.plan
        project = createProject({ plan: planUsed, taskId, home, overwrite: true })
      } else {
        return validationFail('AUTO_PLAN_MISMATCH',
          '同名任务来自另一份计划；如需覆盖请显式确认（旧一轮将归档保留）')
      }
    } else {
      const planRes = readPlan({ home, planId: params.planId, taskId })
      if (!planRes.ok) return validationFail(planRes.errorCode, planRes.message)
      planUsed = planRes.plan
      project = createProject({ plan: planUsed, taskId, home })
    }
    if (!project || project.errorCode) {
      return validationFail((project && project.errorCode) || 'AUTO_START_FAILED', (project && project.message) || '无法创建任务')
    }

    // 纵深防御（评审 i6）：计划/项目虽由服务端生成，但它们都是磁盘文件——
    // 启动前对每一条 refPaths 重校验受控媒体根，越界即 fail-closed（不静默丢弃后继续跑）。
    const badRefs = (Array.isArray(project.shots) ? project.shots : [])
      .flatMap((s) => (Array.isArray(s && s.refPaths) ? s.refPaths : []))
      .filter((p) => typeof p !== 'string' || !isWithinRoot(mediaRoot, p))
    if (badRefs.length > 0) {
      return validationFail('AUTO_BAD_PARAM',
        '任务内含越出受控媒体根的参考图路径（' + badRefs.length + ' 条），已拒绝启动；请重新生成预览')
    }
    const payloadHash = buildPayloadHash({
      shots: project.shots, aspect: project.aspect, seconds: project.seconds, providerId: project.providerId,
    })

    // 确认门槛（D25）：无确认 / 载荷哈希变化 / 编辑晚于确认 → 必须重新确认
    const needs = needsReconfirm(project, { payloadHash })
    if (needs && params.confirmed !== true) {
      return {
        code: 0,
        data: { started: false, needsReconfirm: true, taskId, planId: project.planId, payloadHash, resumed },
      }
    }
    if (needs) {
      appendConfirmation(project, {
        payloadHash,
        shotsFingerprint: buildShotFingerprint(project.shots),
        planVersion: project.runSeq || 1,
      })
    }

    // 单飞（D28）
    if (runningAutoTasks.size > 0) {
      return fail(EC.REQUEST_ERROR, 'AUTO_TASK_BUSY', '已有自动模式任务在运行，请等待其完成或停止后重试')
    }

    const writeNow = () => { try { writeProject({ home, project }) } catch { /* 持久化失败不改变执行结果 */ } }
    writeNow()
    if (planUsed) markPlanConsumed({ home, planId: planUsed.planId })
    runningAutoTasks.add(taskId)
    stoppingAutoTasks.delete(taskId)

    const shotIds = project.shots.map((s) => s.shotId)
    const countDoneNow = () => project.shots.filter((s) => s.status === 'done').length
    const emitSafe = (evt) => {
      try {
        if (event && event.sender && typeof event.sender.send === 'function') {
          event.sender.send('film-engineering:auto-update', evt)
        }
      } catch { /* 窗口已销毁：事件推送失败不影响执行 */ }
    }

    // ★ 长任务必须**立即返回**（真机 E2E 抓到的缺陷）：
    //   原实现 `await driver(...)` 会让渲染端的 `await autoStart()` 一直挂到整轮跑完（可达数小时），
    //   于是面板停在确认卡、进度永远升不到运行态——用户看到的是「点了没反应」。
    //   现在：派发后立刻回初始投影，进度与收口一律经事件（driver 已节流）+ `auto-status` 汇总；
    //   任务本身仍在主进程继续跑，关掉界面不中断（沿用「磁盘为真 + 断点续跑」纪律）。
    void (async () => {
      try {
        const r = await driver({
          taskId,
          shotIds,
          ledgerDir: projectDir(home, taskId),
          mediaRoot,
          runIdFor: (t, batchIndex) => autoRunIdFor(t, batchIndex),
          probe,
          runOnlyBatch: null,
          // 停止（批间生效）：已开始的批跑完，未开始的批保持 pending；已完成的镜不会被重做
          shouldStop: () => stoppingAutoTasks.has(taskId),
          emit: emitSafe,
          runBatch: (batch, ctx) => runBatchFn({
            batch,
            project,
            aiGenerator,
            log,
            deps: o,
            onShotProgress: ctx.onShotProgress,
            onDispatched: () => incrementProviderCalls(project),
            persist: writeNow,
          }),
        })
        writeNow()
        emitSafe({
          type: 'production:complete',
          ok: Boolean(r && r.ok),
          stopped: Boolean(r && r.stopped),
          doneCount: r && r.ledger ? countDone(r.ledger) : countDoneNow(),
          totalCount: shotIds.length,
          failedBatchCount: r && r.failedBatches ? r.failedBatches.length : 0,
          manifestError: (r && r.manifestError) || null,
        })
      } catch (e) {
        writeNow()
        const message = e instanceof Error ? e.message : String(e)
        log.warn('[film-engineering] auto-start run error:', message)
        emitSafe({ type: 'production:complete', ok: false, error: message, doneCount: countDoneNow(), totalCount: shotIds.length })
      } finally {
        runningAutoTasks.delete(taskId)
        stoppingAutoTasks.delete(taskId)
      }
    })()

    return {
      code: 0,
      data: {
        started: true,
        resumed,
        stopped: false,
        dispatched: true,
        taskId,
        planId: project.planId,
        // ok/renderManifest 只在**本轮结束时**成立：这里刻意回 null 而不是 false——
        // 回 false 会让界面把「刚开始」误判成「失败」。
        ok: null,
        doneCount: countDoneNow(),
        totalCount: shotIds.length,
        failedBatches: [],
        renderManifest: null,
        manifestError: null,
        counters: reconcileCounters(project, { doneCount: countDoneNow(), totalCount: shotIds.length }),
      },
    }
  }))

  // ── 停止（批间生效）────────────────────────────────────────────────────
  // 语义：只对**正在运行**的任务置停止标志；已开始的批跑完，未开始的批保持 pending。
  // 已经完成的镜不会被重做（续跑靠磁盘复核），因此停止后再启动就是「断点续跑」。
  ipcMain.handle('film-engineering:auto-stop', withSenderCheck((_e, payload) => {
    const params = payload || {}
    const id = resolveTaskId(params.taskId)
    if (!id.ok) return validationFail(id.errorCode, id.message)
    if (!runningAutoTasks.has(id.taskId)) {
      return { code: 0, data: { ok: true, stopping: false, running: false } }
    }
    stoppingAutoTasks.add(id.taskId)
    return { code: 0, data: { ok: true, stopping: true, running: true } }
  }))


  // ── 检视与修订通道（拆到同级模块；见该文件头部说明）──────────────────
  const inspectChannels = registerAutoInspectHandlers(ipcMain, {
    EC, path, withSenderCheck, home, mediaRoot, probe, log, aiGenerator, deps: o, runningAutoTasks,
    readProject, writeProject, loadLedger, projectDir, buildRenderManifest, projectView,
    validationFail, fail, providerOrError, buildPayloadHash, needsReconfirm, appendConfirmation,
    buildShotFingerprint, regenerateFn, updateShot, collectMissingShots,
  })


  return {
    registered: [
      'film-engineering:auto-plan', 'film-engineering:auto-start', 'film-engineering:auto-stop',
      'film-engineering:auto-status', 'film-engineering:auto-update-shot',
      'film-engineering:auto-regenerate-shot', 'film-engineering:auto-compose',
    ],
    event: 'film-engineering:auto-update',
  }
}

/** 台账里已完成镜数（批状态非 done 的镜不计） */
function countDone (ledger) {
  if (!ledger || !Array.isArray(ledger.batches)) return 0
  let n = 0
  for (const b of ledger.batches) {
    for (const s of b.shots || []) if (s.status === 'done') n += 1
  }
  return n
}

module.exports = registerAutoHandlers
module.exports.registerAutoHandlers = registerAutoHandlers
module.exports.runningAutoTasks = runningAutoTasks
module.exports.stoppingAutoTasks = stoppingAutoTasks
module.exports.nowStamp = nowStamp
module.exports.MAX_AUTO_SHOTS = MAX_AUTO_SHOTS
module.exports.DRIVER_BATCH_SIZE = DRIVER_BATCH_SIZE
