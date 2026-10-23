// @ts-check
'use strict'
/**
 * auto-runner — 自动模式的批执行器与单镜重生成（openspec change: film-auto-mode，design D21/D31/D15）
 *
 * 与 production-runner 的差异（这才是自动模式存在的意义）：
 *   - **提示词真源不同**：production-runner 从 film-kit 服务取原文（`service.getShot`），
 *     自动模式从 **project.json** 取（片段编辑后的提示词必须生效），仍逐字符直送 provider；
 *   - **批次落点不同**：runId 由 `runIdFor(taskId, batchIndex) = 'auto/<taskId>/b<N>'` 派生，
 *     产物落 `<mediaRoot>/auto/<taskId>/b<N>/shot_NNN.mp4`；**轮次 ≥2 时带轮次号**
 *     （`auto/<taskId>/r<runSeq>/b<N>/`）—— 同一 taskId 重新 plan 时旧轮次产物不得被采纳；
 *   - **单镜重生成**：批次目录内**原子覆盖**（临时目录生成 → ffprobe 校验 → rename），
 *     与 shot-downloader 的「探测通过才入库」同纪律（D15）。
 *
 * 逐镜失败不抛出：统一经 `onShotProgress(i, 'failed', reason)` 上报可辨识原因（与既有合同一致）。
 */

const fs = require('fs')
const path = require('path')
const { generateShotVideo, resolveFilmVideoProvider, getFilmRunDir, getFilmMediaRoot } = require('./video-gen')
const { probeClip } = require('./film-render')
const { PRODUCTION_BATCH_CONCURRENCY } = require('./production-runner')
const { PRODUCTION_BATCH_SIZE } = require('./production-driver')

/**
 * 自动模式批次 runId（批次落点：<mediaRoot>/auto/<taskId>/…/b<N>）。
 *
 * **轮次号进目录**（2026-10-23）：同一 taskId 用 overwrite 重新 plan 时，`createProject`
 * 会递增 `runSeq` 并把旧的 project.json / ledger.json 归档到 `archive/<runSeq>/`，
 * 但**产物目录原本不变**（`archiveTaskRun` 只搬那两个文件，不碰产物）。
 * 于是新轮次的 `b.runId` 与上一轮完全相同 ⇒ `resolveResumePlan` 的磁盘复核看到
 * 上一轮的 `shot_NNN.mp4` 还在 ⇒ **整批跳过、零 provider 调用**，
 * 而清单声称的是新分镜 ⇒ **完全静默的假成功**（已实跑复现）。
 *
 * `runSeq >= 2` 时目录带上轮次号 ⇒ 新旧轮次物理隔离。
 * `runSeq === 1` 沿用历史布局 ⇒ **存量项目零影响**（不换目录、不丢已生成产物）。
 *
 * 注意：这里带的是**轮次**，不是分镜集指纹。自动模式的 `project.shots` 是**活状态**
 * （`updateShot` 可改提示词/参考图/时长），若按分镜集派生目录，用户改一个字就会
 * 整批产物作废——那才是真正的破坏。轮次只在新 plan 时变，编辑不动它。
 */
function autoRunIdFor (taskId, batchIndex, runSeq) {
  const seq = Number.isInteger(runSeq) && runSeq > 0 ? runSeq : 1
  const base = seq > 1
    ? 'auto/' + String(taskId) + '/r' + seq
    : 'auto/' + String(taskId)
  return base + '/b' + String(batchIndex)
}

/** 全局镜序号 → 所属批与批内序号（文件名 shot_NNN 用的是**批内**序号） */
function locateShot (shotIndex, batchSize = PRODUCTION_BATCH_SIZE) {
  const size = Number.isInteger(batchSize) && batchSize > 0 ? batchSize : PRODUCTION_BATCH_SIZE
  const g = Number.isInteger(shotIndex) && shotIndex >= 0 ? shotIndex : 0
  return { batchIndex: Math.floor(g / size), inBatchIndex: g % size }
}

function shotFileName (index) {
  return 'shot_' + String(index).padStart(3, '0') + '.mp4'
}

/** 项目文件 → provider 参考输入映射（Map<shotId, paths[]>） */
function buildRefMap (project) {
  const map = new Map()
  const shots = project && Array.isArray(project.shots) ? project.shots : []
  for (const s of shots) {
    const paths = Array.isArray(s.refPaths) ? s.refPaths.filter((p) => typeof p === 'string' && p.trim()) : []
    if (paths.length > 0) map.set(String(s.shotId), paths)
  }
  return map
}

/**
 * 批后以**磁盘为真**同步项目文件的逐镜状态（不信自报）。
 * 文件存在 → done + outputPath；缺失 → failed（保留已记录的原因）。
 */
function syncProjectFromDisk ({ project, batch, runDirOf = getFilmRunDir }) {
  if (!project || !Array.isArray(project.shots) || !batch) return project
  const runDir = runDirOf(batch.runId)
  const byId = new Map(project.shots.map((s) => [String(s.shotId), s]))
  ;(batch.shotIds || []).forEach((shotId, i) => {
    const shot = byId.get(String(shotId))
    if (!shot) return
    const file = path.join(runDir, shotFileName(i))
    if (fs.existsSync(file)) {
      shot.status = 'done'
      shot.outputPath = file
      shot.error = null
    } else {
      shot.status = 'failed'
      shot.error = shot.error || '磁盘缺少该镜产物'
    }
  })
  return project
}

/** 参考降级警告并入项目文件（去重，不重复堆叠） */
function mergeWarnings (project, warnings) {
  if (!project || !Array.isArray(warnings) || warnings.length === 0) return project
  if (!Array.isArray(project.warnings)) project.warnings = []
  const seen = new Set(project.warnings.map((w) => JSON.stringify(w)))
  for (const w of warnings) {
    const key = JSON.stringify(w)
    if (seen.has(key)) continue
    project.warnings.push(w)
    seen.add(key)
  }
  return project
}

/**
 * 执行单批（提示词取自 project.json；逐镜并发 2，与全量出片同口径）
 * @returns {Promise<{refWarnings: Array<object>}>}
 */
async function runAutoBatch (opts) {
  const o = opts || {}
  const { batch, project, aiGenerator, log } = o
  const deps = o.deps || {}
  const onShotProgress = typeof o.onShotProgress === 'function' ? o.onShotProgress : () => {}
  const onDispatched = typeof o.onDispatched === 'function' ? o.onDispatched : null
  const persist = typeof o.persist === 'function' ? o.persist : null
  const runDirOf = deps._testRunDir || getFilmRunDir
  if (!batch || !project) throw new Error('auto-runner: 需要 batch 与 project')

  const providerCfg = resolveFilmVideoProvider(aiGenerator)
  if (!providerCfg) {
    throw new Error('VIDEO_MODEL_NOT_CONFIGURED: 自动模式出片需要视频模型，请在模型设置中配置并设为默认视频 Provider 后重试')
  }
  const runDir = runDirOf(batch.runId)
  try { fs.mkdirSync(runDir, { recursive: true }) } catch { /* 目录已存在 */ }

  const gen = deps._testGenerateShotVideo || generateShotVideo
  const refMap = buildRefMap(project)
  const refWarnings = []
  const byId = new Map((project.shots || []).map((s) => [String(s.shotId), s]))
  const queue = (batch.shotIds || []).map((shotId, i) => ({ shotId: String(shotId), i }))

  const report = (i, status, reason) => {
    const shot = byId.get(String((batch.shotIds || [])[i]))
    if (shot) {
      shot.status = status === 'done' ? 'done' : 'failed'
      shot.error = status === 'done' ? null : (reason ? String(reason).slice(0, 500) : shot.error)
    }
    onShotProgress(i, status, reason)
  }

  const worker = async () => {
    while (queue.length > 0) {
      const job = queue.shift()
      if (!job) return
      const shot = byId.get(job.shotId)
      if (!shot || typeof shot.prompt !== 'string' || !shot.prompt.trim()) {
        if (log && typeof log.warn === 'function') log.warn('FilmAuto', 'shot ' + job.i + ' (' + job.shotId + ') failed: 提示词为空')
        report(job.i, 'failed', '未取到分镜提示词（项目文件中为空或分镜不存在）')
        continue
      }
      // D30：派发前计数（观测计数器；崩溃窗口差值由 auto-status 如实暴露）
      if (onDispatched) { try { onDispatched(shot) } catch { /* 计数失败不影响出片 */ } }
      const r = await gen({
        shot,
        index: job.i,
        runDir,
        aspect: project.aspect,
        seconds: Number(shot.seconds) || Number(project.seconds) || 5,
        providerCfg,
        refMap,
        mediaRoot: project.mediaRoot,
        refWarnings,
        sleep: deps._testSleep,
        download: deps._testDownload,
        log,
      })
      if (r && r.success) report(job.i, 'done')
      else report(job.i, 'failed', (r && r.error) ? r.error : '视频生成失败（未知原因）')
    }
  }

  await Promise.all(Array.from({ length: Math.min(PRODUCTION_BATCH_CONCURRENCY, (batch.shotIds || []).length) }, worker))
  // 批后以磁盘为真同步 + 参考警告合并 + 持久化（崩溃窗口由台账/磁盘双核兜底）
  syncProjectFromDisk({ project, batch, runDirOf })
  mergeWarnings(project, refWarnings)
  if (persist) { try { persist(project) } catch { /* 持久化失败不改变批执行结果 */ } }
  return { refWarnings }
}

/**
 * 单镜重生成（原子覆盖，D15）
 * 流程：临时目录生成 → ffprobe 校验 → rename 覆盖正式 shot_NNN.mp4
 * @returns {Promise<{ok: boolean, path?: string, errorCode?: string, message?: string}>}
 */
async function regenerateOneShot (opts) {
  const o = opts || {}
  const { project, shotIndex, aiGenerator, log } = o
  const deps = o.deps || {}
  if (!project || !Array.isArray(project.shots)) {
    return { ok: false, errorCode: 'AUTO_SHOT_INVALID', message: '项目文件非法' }
  }
  const idx = Number(shotIndex)
  if (!Number.isInteger(idx) || idx < 0 || idx >= project.shots.length) {
    return { ok: false, errorCode: 'AUTO_SHOT_INVALID', message: 'shotIndex 越界' }
  }
  const shot = project.shots[idx]
  if (typeof shot.prompt !== 'string' || !shot.prompt.trim()) {
    return { ok: false, errorCode: 'AUTO_SHOT_INVALID', message: '提示词为空，无法重生成' }
  }
  const providerCfg = resolveFilmVideoProvider(aiGenerator)
  if (!providerCfg) {
    return {
      ok: false,
      errorCode: 'VIDEO_MODEL_NOT_CONFIGURED',
      message: '自动模式重生成需要视频模型，请在模型设置中配置并设为默认视频 Provider 后重试',
    }
  }
  const runDirOf = deps._testRunDir || getFilmRunDir
  const tmpRootOf = deps._testTmpRoot || getFilmMediaRoot
  const probeFn = deps._testProbeClip || probeClip
  const gen = deps._testGenerateShotVideo || generateShotVideo
  const { batchIndex, inBatchIndex } = locateShot(idx, o.batchSize)
  const runId = autoRunIdFor(project.taskId, batchIndex, project.runSeq)
  const runDir = runDirOf(runId)
  const stageDir = path.join(tmpRootOf(), 'auto', String(project.taskId), '.regen')
  const dest = path.join(runDir, shotFileName(inBatchIndex))

  try { fs.mkdirSync(runDir, { recursive: true }) } catch { /* 已存在 */ }
  try { fs.mkdirSync(stageDir, { recursive: true }) } catch { /* 已存在 */ }

  const r = await gen({
    shot,
    index: inBatchIndex,
    runDir: stageDir,
    aspect: project.aspect,
    seconds: Number(shot.seconds) || Number(project.seconds) || 5,
    providerCfg,
    refMap: buildRefMap(project),
    mediaRoot: project.mediaRoot,
    refWarnings: [],
    sleep: deps._testSleep,
    download: deps._testDownload,
    log,
  })
  if (!r || !r.success) {
    return { ok: false, errorCode: 'AUTO_REGENERATE_FAILED', message: (r && r.error) || '视频生成失败' }
  }
  const staged = path.join(stageDir, shotFileName(inBatchIndex))
  try {
    await probeFn(staged)
  } catch (e) {
    return { ok: false, errorCode: 'AUTO_REGENERATE_INVALID_CLIP', message: '生成的片段未通过校验：' + ((e && e.message) || String(e)) }
  }
  try {
    fs.renameSync(staged, dest)
  } catch (e) {
    return { ok: false, errorCode: 'AUTO_REGENERATE_FAILED', message: '覆盖正式产物失败：' + ((e && e.message) || String(e)) }
  }
  shot.status = 'done'
  shot.outputPath = dest
  shot.error = null
  return { ok: true, path: dest }
}

/** 全部镜是否磁盘齐备（收口合成前置；由 IPC 用注入 probe 复核） */
function collectMissingShots ({ project, probe, batchSize = PRODUCTION_BATCH_SIZE, runIdFor = autoRunIdFor }) {
  const missing = []
  const shots = project && Array.isArray(project.shots) ? project.shots : []
  const byBatch = new Map()
  shots.forEach((s, idx) => {
    const { batchIndex, inBatchIndex } = locateShot(idx, batchSize)
    if (!byBatch.has(batchIndex)) byBatch.set(batchIndex, { count: 0, items: [] })
    const entry = byBatch.get(batchIndex)
    entry.count += 1
    entry.items.push({ shotId: String(s.shotId), inBatchIndex })
  })
  for (const [batchIndex, entry] of byBatch.entries()) {
    const probeResult = probe(runIdFor(project.taskId, batchIndex, project.runSeq), entry.count) || { missing: [] }
    const miss = Array.isArray(probeResult.missing) ? probeResult.missing : []
    for (const mi of miss) {
      const item = entry.items.find((x) => x.inBatchIndex === mi)
      missing.push({ batchIndex, shotIndex: mi, shotId: item ? item.shotId : null })
    }
  }
  return missing
}

module.exports = {
  autoRunIdFor,
  locateShot,
  shotFileName,
  buildRefMap,
  syncProjectFromDisk,
  mergeWarnings,
  runAutoBatch,
  regenerateOneShot,
  collectMissingShots,
  AUTO_BATCH_CONCURRENCY: PRODUCTION_BATCH_CONCURRENCY,
}
