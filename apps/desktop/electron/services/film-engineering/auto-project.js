// @ts-check
'use strict'
/**
 * auto-project — 自动模式的落盘层（openspec change: film-auto-mode）
 *
 * 真源划分（design D5/D21）：
 *   计划文件   <mediaRoot>/auto/_plans/<planId>.json      服务端派生、TTL/consumed 生命周期（D17/i8）
 *   项目文件   <mediaRoot>/auto/<taskId>/project.json     唯一「可编辑内容真源」（提示词/参考/秒数）
 *   台账       <mediaRoot>/auto/<taskId>/ledger.json      执行真源（由 production-driver 写）
 *   产物       <mediaRoot>/auto/<taskId>/shot_NNN.mp4     结果真源（磁盘为真）
 *   归档       <mediaRoot>/auto/<taskId>/archive/<runSeq>/  overwrite 时保留旧一轮审计链（D27）
 *
 * 关键不变量：
 *  - 计划落盘后**不可变**，consumed 以独立标记文件表达（不重写计划内容）；
 *  - 项目文件读损坏一律 fail-closed（AUTO_PROJECT_UNREADABLE），绝不静默续跑；
 *  - 确认历史 append-only，且 `needsReconfirm` 以「载荷哈希 + 编辑时间戳」机械判定（D19/D25）；
 *  - providerCalls 为**观测计数器**（派发前自增），与台账差值为崩溃窗口的正常产物，如实暴露不修正（D30）。
 *
 * 所有 IO 走可注入 home（默认 os.tmpdir()），保证测试落在隔离目录、绝不触碰仓库共享文件。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')

const MAX_SHOT_PROMPT_LENGTH = 50000
const AUTO_ROOT_LABEL = 'auto'
const PLAN_DIR_LABEL = '_plans'
const PROJECT_FILE = 'project.json'
const LEDGER_FILE = 'ledger.json'
const ARCHIVE_LABEL = 'archive'
const PROJECT_SCHEMA_VERSION = 1
const PLAN_TTL_MS = 24 * 60 * 60 * 1000
const SHOT_SECONDS = Object.freeze([5, 8, 10])
const TASK_ID_RE = /^[A-Za-z0-9._-]{1,64}$/

function defaultHome () {
  return os.tmpdir()
}

/** 受控媒体根（与 film-render.getFilmMediaRoot 同构：<home>/film-engineering） */
function mediaRootOf (home) {
  return path.join(home || defaultHome(), 'film-engineering')
}

/** 自动模式根（<mediaRoot>/auto） */
function autoRootOf (home) {
  return path.join(mediaRootOf(home), AUTO_ROOT_LABEL)
}

function planDir (home) {
  return path.join(autoRootOf(home), PLAN_DIR_LABEL)
}

function planFilePath (home, planId) {
  return path.join(planDir(home), String(planId) + '.json')
}

function planConsumedPath (home, planId) {
  return path.join(planDir(home), String(planId) + '.consumed')
}

function projectDir (home, taskId) {
  return path.join(autoRootOf(home), String(taskId))
}

function projectFilePath (home, taskId) {
  return path.join(projectDir(home, taskId), PROJECT_FILE)
}

function ledgerFilePath (home, taskId) {
  return path.join(projectDir(home, taskId), LEDGER_FILE)
}

function archiveDir (home, taskId, runSeq) {
  return path.join(projectDir(home, taskId), ARCHIVE_LABEL, String(runSeq))
}

/** 原子写（.tmp + rename）：不留半截 JSON（与 production-driver.js:65-71 同法） */
function writeJsonAtomic (target, value) {
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const tmp = target + '.tmp'
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2), 'utf8')
  fs.renameSync(tmp, target)
}

function readJson (target) {
  let raw
  try { raw = fs.readFileSync(target, 'utf8') } catch { return null }
  try { return JSON.parse(raw) } catch { return null }
}

/** taskId 路径安全校验（1-64 位 [A-Za-z0-9._-]，且不得为 . / ..） */
function resolveTaskId (taskId) {
  const id = typeof taskId === 'string' ? taskId.trim() : ''
  if (!id || !TASK_ID_RE.test(id) || id === '.' || id === '..') {
    return { ok: false, errorCode: 'AUTO_BAD_PARAM', message: 'taskId 只允许 1-64 位字母、数字、._-' }
  }
  return { ok: true, taskId: id }
}

function isWithinRoot (root, target) {
  const rel = path.relative(path.resolve(root), path.resolve(target))
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel))
}

/**
 * 落盘计划（服务端派生；含归属与过期时间）
 * @param {{home?: string, plan: object, taskId: string, ttlMs?: number, now?: number}} opts
 */
function writePlan (opts) {
  const o = opts || {}
  const plan = o.plan
  if (!plan || typeof plan !== 'object' || typeof plan.planId !== 'string' || !plan.planId) {
    return { ok: false, errorCode: 'AUTO_BAD_PARAM', message: '计划缺少 planId' }
  }
  const id = resolveTaskId(o.taskId)
  if (!id.ok) return id
  const now = Number.isFinite(o.now) ? Number(o.now) : Date.now()
  const ttl = Number.isFinite(o.ttlMs) ? Number(o.ttlMs) : PLAN_TTL_MS
  const record = {
    schemaVersion: 1,
    planId: plan.planId,
    taskId: id.taskId,
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttl).toISOString(),
    plan,
  }
  try {
    writeJsonAtomic(planFilePath(o.home, plan.planId), record)
    try { fs.rmSync(planConsumedPath(o.home, plan.planId), { force: true }) } catch { /* 无标记即视为未消费 */ }
    return { ok: true, planId: plan.planId, expiresAt: record.expiresAt }
  } catch (e) {
    return { ok: false, errorCode: 'AUTO_PLAN_WRITE_FAILED', message: (e && e.message) || String(e) }
  }
}

/**
 * 读计划并校验生命周期与归属（D17）
 * @returns {{ok: true, plan: object} | {ok: false, errorCode: string, message: string}}
 */
function readPlan (opts) {
  const o = opts || {}
  const planId = typeof o.planId === 'string' ? o.planId : ''
  if (!planId) return { ok: false, errorCode: 'AUTO_PLAN_EXPIRED', message: 'planId 缺失或已过期' }
  if (fs.existsSync(planConsumedPath(o.home, planId))) {
    return { ok: false, errorCode: 'AUTO_PLAN_EXPIRED', message: '该计划已被消费，请重新生成预览' }
  }
  const record = readJson(planFilePath(o.home, planId))
  if (!record || typeof record !== 'object' || !record.plan || typeof record.plan !== 'object') {
    return { ok: false, errorCode: 'AUTO_PLAN_EXPIRED', message: '计划不存在或已损坏，请重新生成预览' }
  }
  const now = Number.isFinite(o.now) ? Number(o.now) : Date.now()
  const expiresAt = Date.parse(String(record.expiresAt || ''))
  if (!Number.isFinite(expiresAt) || now > expiresAt) {
    return { ok: false, errorCode: 'AUTO_PLAN_EXPIRED', message: '计划已过期，请重新生成预览' }
  }
  const id = resolveTaskId(o.taskId)
  if (!id.ok) return id
  if (record.taskId !== id.taskId) {
    return { ok: false, errorCode: 'AUTO_PLAN_MISMATCH', message: '计划归属与任务 ID 不一致' }
  }
  return { ok: true, plan: record.plan, record }
}

/** 标记计划已消费（独立标记文件；不重写计划内容） */
function markPlanConsumed (opts) {
  const o = opts || {}
  try {
    const marker = planConsumedPath(o.home, o.planId)
    fs.mkdirSync(path.dirname(marker), { recursive: true })
    fs.writeFileSync(marker, JSON.stringify({ consumedAt: new Date(Number.isFinite(o.now) ? Number(o.now) : Date.now()).toISOString() }), 'utf8')
    return { ok: true }
  } catch (e) {
    return { ok: false, errorCode: 'AUTO_PLAN_WRITE_FAILED', message: (e && e.message) || String(e) }
  }
}

/**
 * 构造项目文件（内容真源）。home 提供时做「同名任务」冲突检查（D4）；
 * overwrite=true 时归档旧一轮（D27）并递增 runSeq。
 */
function createProject (opts) {
  const o = opts || {}
  const id = resolveTaskId(o.taskId)
  if (!id.ok) return id
  const taskId = id.taskId
  const plan = o.plan
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.shots)) {
    return { ok: false, errorCode: 'AUTO_BAD_PARAM', message: '计划缺少 shots' }
  }
  const home = o.home
  let runSeq = 1
  let supersededFrom = null
  if (home) {
    const existing = fs.existsSync(projectFilePath(home, taskId))
    if (existing && o.overwrite !== true) {
      return { ok: false, errorCode: 'AUTO_TASK_EXISTS', message: '同名任务已存在；如需覆盖请显式确认（旧一轮将归档保留）' }
    }
    if (existing && o.overwrite === true) {
      const prev = readJson(projectFilePath(home, taskId))
      const prevSeq = prev && Number.isInteger(prev.runSeq) ? prev.runSeq : 1
      supersededFrom = prevSeq
      runSeq = prevSeq + 1
      try { archiveTaskRun({ home, taskId, runSeq: prevSeq }) } catch { /* 归档失败不阻断新任务，但保留旧文件 */ }
    }
  }
  const nowIso = o.now || new Date().toISOString()
  const shots = plan.shots.map((s, i) => ({
    index: Number.isInteger(s.index) ? s.index : i,
    shotId: String(s.shotId || ('auto-' + String(i).padStart(3, '0'))),
    beatIndex: s.beatIndex === undefined ? null : s.beatIndex,
    title: String(s.title || ''),
    prompt: String(s.prompt || ''),
    // 影视工程 v2 · F-A：三分提示词必须落盘——只存 prompt 的话，续跑/重生成时
    // 派生出来的 videoPrompt 会丢失（回落 imagePrompt），「视频只拿运动信息」在
    // 第二次运行就失效。imagePrompt 缺省回落 prompt（存量计划兼容）。
    imagePrompt: String(s.imagePrompt === undefined || s.imagePrompt === null ? (s.prompt || '') : s.imagePrompt),
    videoPrompt: String(s.videoPrompt || ''),
    endFramePrompt: String(s.endFramePrompt || ''),
    // 影视工程 v2 · F-I：逐镜只存**变量与缺失清单**（方法论长文本在 plan 级存一次）
    ...(s.promptVars && typeof s.promptVars === 'object' ? { promptVars: s.promptVars } : {}),
    ...(Array.isArray(s.promptMissing) ? { promptMissing: s.promptMissing.slice() } : {}),
    ...(typeof s.promptRenderHash === 'string' && s.promptRenderHash ? { promptRenderHash: s.promptRenderHash } : {}),
    characterNames: Array.isArray(s.characterNames) ? s.characterNames.slice() : [],
    refPaths: Array.isArray(s.refPaths) ? s.refPaths.slice() : [],
    seconds: Number(s.seconds) || Number(plan.seconds) || 5,
    status: 'pending',
    outputPath: null,
    error: null,
  }))
  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    taskId,
    runSeq,
    supersededFrom,
    planId: String(plan.planId || ''),
    // 影视工程 v2 · F-I：plan 级方法论上下文（含尾帧约束原文与资产版本戳）
    ...(plan.promptContext && typeof plan.promptContext === 'object' ? { promptContext: plan.promptContext } : {}),
    createdAt: nowIso,
    editedAt: null,
    aspect: String(plan.aspect || '16x9'),
    seconds: Number(plan.seconds) || 5,
    targetDurationSec: Number(plan.targetDurationSec) || 0,
    plannedDurationSec: Number(plan.plannedDurationSec) || shots.length * (Number(plan.seconds) || 5),
    providerId: String(plan.providerId || ''),
    mediaRoot: mediaRootOf(home),
    characterMap: plan.characterMap && typeof plan.characterMap === 'object' ? { ...plan.characterMap } : {},
    characterRefs: Array.isArray(plan.characterRefs) ? plan.characterRefs.map((r) => ({ ...r })) : [],
    sceneRefs: Array.isArray(plan.sceneRefs) ? plan.sceneRefs.slice() : [],
    warnings: Array.isArray(plan.warnings) ? plan.warnings.slice() : [],
    shots,
    confirmations: [],
    counters: { providerCalls: 0 },
  }
}

function writeProject (opts) {
  const o = opts || {}
  const id = resolveTaskId(o.project && o.project.taskId)
  if (!id.ok) return id
  if (!o.project || o.project.schemaVersion !== PROJECT_SCHEMA_VERSION) {
    return { ok: false, errorCode: 'AUTO_BAD_PARAM', message: '项目文件 schemaVersion 非法' }
  }
  try {
    writeJsonAtomic(projectFilePath(o.home, id.taskId), o.project)
    return { ok: true, path: projectFilePath(o.home, id.taskId) }
  } catch (e) {
    return { ok: false, errorCode: 'AUTO_PROJECT_WRITE_FAILED', message: (e && e.message) || String(e) }
  }
}

function readProjectFile (filePath) {
  const project = readJson(filePath)
  if (!project || typeof project !== 'object' || project.schemaVersion !== PROJECT_SCHEMA_VERSION || !Array.isArray(project.shots)) {
    return { ok: false, errorCode: 'AUTO_PROJECT_UNREADABLE', message: '项目文件不存在或已损坏' }
  }
  return { ok: true, project }
}

function readProject (opts) {
  const o = opts || {}
  const id = resolveTaskId(o.taskId)
  if (!id.ok) return id
  return readProjectFile(projectFilePath(o.home, id.taskId))
}

function touchShot (shot, patch) {
  if (Object.prototype.hasOwnProperty.call(patch, 'prompt')) shot.prompt = String(patch.prompt)
  if (Object.prototype.hasOwnProperty.call(patch, 'refPaths')) shot.refPaths = patch.refPaths.map(String)
  if (Object.prototype.hasOwnProperty.call(patch, 'seconds')) shot.seconds = Number(patch.seconds)
  if (Object.prototype.hasOwnProperty.call(patch, 'title')) shot.title = String(patch.title)
}

/**
 * 镜头编辑（内容真源唯一入口）。校验失败一律不改动（先校验后应用）。
 * @returns {{ok: true, shot: object} | {ok: false, errorCode: string, message: string}}
 */
function updateShot (project, opts) {
  const o = opts || {}
  const invalid = (message) => ({ ok: false, errorCode: 'AUTO_SHOT_INVALID', message })
  if (!project || !Array.isArray(project.shots)) return invalid('项目文件非法')
  const idx = o.shotIndex
  if (!Number.isInteger(idx) || idx < 0 || idx >= project.shots.length) return invalid('shotIndex 越界')
  const patch = o.patch
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) return invalid('patch 必须为对象')
  const allowed = ['prompt', 'refPaths', 'seconds', 'title']
  if (Object.keys(patch).some((k) => !allowed.includes(k))) return invalid('patch 含不支持的字段')
  if (Object.prototype.hasOwnProperty.call(patch, 'prompt')) {
    const p = patch.prompt
    if (typeof p !== 'string' || p.trim() === '') return invalid('提示词不能为空')
    if (p.length > MAX_SHOT_PROMPT_LENGTH) return invalid('提示词不能超过 ' + MAX_SHOT_PROMPT_LENGTH + ' 字符')
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'seconds')) {
    if (!SHOT_SECONDS.includes(Number(patch.seconds))) return invalid('单镜秒数必须为 ' + SHOT_SECONDS.join('/'))
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'refPaths')) {
    if (!Array.isArray(patch.refPaths)) return invalid('refPaths 必须为数组')
    const root = o.mediaRoot || project.mediaRoot || mediaRootOf(o.home)
    for (const p of patch.refPaths) {
      if (typeof p !== 'string' || !path.isAbsolute(p) || !isWithinRoot(root, p)) {
        return invalid('参考图路径必须位于受控媒体根内')
      }
    }
  }
  touchShot(project.shots[idx], patch)
  markEdited(project, o.now)
  return { ok: true, shot: project.shots[idx] }
}

/** 标记内容变更时间（编辑/重生成的机械判据，D16） */
function markEdited (project, now) {
  if (project && typeof project === 'object') {
    project.editedAt = now || new Date().toISOString()
  }
  return project
}

/** 追加确认记录（append-only；不覆盖历史） */
function appendConfirmation (project, opts) {
  const o = opts || {}
  if (!project || typeof project !== 'object') return project
  if (!Array.isArray(project.confirmations)) project.confirmations = []
  project.confirmations.push({
    at: o.now || new Date().toISOString(),
    payloadHash: String(o.payloadHash || ''),
    shotsFingerprint: String(o.shotsFingerprint || ''),
    planVersion: Number.isInteger(o.planVersion) ? o.planVersion : Number(project.runSeq) || 1,
  })
  return project
}

function latestConfirmation (project) {
  const list = project && Array.isArray(project.confirmations) ? project.confirmations : []
  return list.length > 0 ? list[list.length - 1] : null
}

/**
 * 是否需要重新确认（D25：门禁判定「镜头集合 + 时间戳 + 载荷哈希」，不是调用额度）
 * 三种情形均需重确认：无确认记录 / 载荷哈希与最新确认不一致 / 编辑晚于最新确认。
 */
function needsReconfirm (project, opts) {
  const o = opts || {}
  const latest = latestConfirmation(project)
  if (!latest) return true
  if (o.payloadHash !== undefined && String(latest.payloadHash) !== String(o.payloadHash)) return true
  const editedAt = project && project.editedAt ? String(project.editedAt) : ''
  if (editedAt && editedAt > String(latest.at || '')) return true
  return false
}

/** 派发前自增（观测计数器；不是授权令牌） */
function incrementProviderCalls (project, n) {
  const step = Number.isInteger(n) && n > 0 ? n : 1
  if (!project || typeof project !== 'object') return project
  if (!project.counters || typeof project.counters !== 'object') project.counters = { providerCalls: 0 }
  project.counters.providerCalls = (Number(project.counters.providerCalls) || 0) + step
  return project
}

/** 计数与台账对账（差值如实暴露，不静默修正） */
function reconcileCounters (project, opts) {
  const o = opts || {}
  const providerCalls = Number(project && project.counters ? project.counters.providerCalls : 0) || 0
  const done = Number(o.doneCount) || 0
  return { providerCalls, ledgerDoneCount: done, mismatch: Math.max(providerCalls - done, 0) }
}

/** 归档一轮（overwrite 前调用）：移动 project.json / ledger.json 到 archive/<runSeq>/ */
function archiveTaskRun (opts) {
  const o = opts || {}
  const id = resolveTaskId(o.taskId)
  if (!id.ok) return id
  const dir = archiveDir(o.home, id.taskId, o.runSeq)
  fs.mkdirSync(dir, { recursive: true })
  for (const [src, name] of [[projectFilePath(o.home, id.taskId), PROJECT_FILE], [ledgerFilePath(o.home, id.taskId), LEDGER_FILE]]) {
    if (fs.existsSync(src)) {
      try { fs.renameSync(src, path.join(dir, name)) } catch { /* 目标已存在等：保留原文件不阻断 */ }
    }
  }
  return { ok: true, dir }
}

/** 列出某任务的历史轮次（审计回溯用） */
function listTaskRuns (opts) {
  const o = opts || {}
  const id = resolveTaskId(o.taskId)
  if (!id.ok) return id
  const root = path.join(projectDir(o.home, id.taskId), ARCHIVE_LABEL)
  // 不要写成 `let names = []`：try 与 catch 两条路径都会先赋值，初始值必被覆盖，
  // ESLint no-useless-assignment 判 error（Gate 11 阻断）
  let names

  try { names = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory()).map((d) => d.name) } catch { names = [] }
  const runs = names
    .map((n) => Number(n))
    .filter((n) => Number.isInteger(n) && n > 0)
    .sort((a, b) => a - b)
    .map((runSeq) => ({ runSeq, projectPath: path.join(root, String(runSeq), PROJECT_FILE) }))
  return { ok: true, runs }
}

module.exports = {
  MAX_SHOT_PROMPT_LENGTH,
  AUTO_ROOT_LABEL,
  PLAN_DIR_LABEL,
  PROJECT_FILE,
  LEDGER_FILE,
  ARCHIVE_LABEL,
  PROJECT_SCHEMA_VERSION,
  PLAN_TTL_MS,
  SHOT_SECONDS,
  mediaRootOf,
  autoRootOf,
  planDir,
  planFilePath,
  planConsumedPath,
  projectDir,
  projectFilePath,
  ledgerFilePath,
  archiveDir,
  writeJsonAtomic,
  readJson,
  resolveTaskId,
  isWithinRoot,
  writePlan,
  readPlan,
  markPlanConsumed,
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
  listTaskRuns,
}
