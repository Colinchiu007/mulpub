// @ts-check
'use strict'
/**
 * prompt-library — 任务化中英成对 prompt 库的加载与渲染（v7 批次一 F30）
 *
 * 形态来自 FireRed-OpenStoryline（Apache-2.0）的「目录即契约」：
 *   prompts/tasks/<task>/{zh,en}/{system,user}.md
 *
 * 为什么是目录而非 JSON 集合：
 *   1. 加一个任务 = 建一个目录，不改任何代码（本模块零改动）；
 *   2. zh/ en/ 并列是硬结构，天然满足仓库 CI Gate 7「locale 成对」的要求；
 *   3. Markdown 正文可读可 diff，比 JSON 里的长字符串更适合 prompt 迭代。
 *
 * fail-closed 契约（与 kit-loader 同构）：
 *   - 任务目录缺失 / 缺 zh 或 en / 缺 system 或 user / 文件为空 → 整体不可用；
 *   - 不允许静默降级为「只加载存在的语言」——那会让某语种静默退回中文。
 *
 * 路径穿越防护（来自 FireRed skills_io.py 的 base_path 判定精神）：
 *   任务名与语言码先过白名单正则，再断言解析后的绝对路径仍位于 tasksRoot 之内。
 *   本模块只读，不做任何写入，但同一约束仍须成立——否则 `..` 形式的任务名
 *   会把「按任务取 prompt」变成「按任意路径读文件」。
 */

const fs = require('fs')
const path = require('path')

/** 任务名白名单：小写字母开头的 kebab/snake 标识符 */
const TASK_NAME_RE = /^[a-z][a-z0-9_]*$/
/** 语言码白名单：仓库只维护 zh / en 两语种 */
const LOCALES = Object.freeze(['zh', 'en'])
/** 每个任务必须具备的文件 */
const REQUIRED_PARTS = Object.freeze(['system.md', 'user.md'])
/** 单个 prompt 文件的大小上限（防误把大文件当 prompt 读入内存） */
const MAX_PROMPT_FILE_BYTES = 64 * 1024
/** 模板变量上限（防渲染时意外的巨量替换） */
const MAX_TEMPLATE_VARS = 64
/** 模板变量名白名单 */
const VAR_NAME_RE = /^[a-z][a-z0-9_]*$/

/**
 * 断言 target 解析后仍位于 root 之内（防 `..` 与符号链接越界）
 * @param {string} root
 * @param {string} target
 * @param {string} root
 * @param {string} target
 * @param {{resolveSymlinks?: boolean}} [opts]
 *   resolveSymlinks=true 时对两侧做 fs.realpathSync 后**再次**断言（v7 对抗评审 i2）。
 *   词法 path.resolve 只能挡住 `..`，挡不住 tasksRoot 内一个指向外部的符号链接/junction；
 *   初版注释宣称「越界符号链接一律拒绝」而实现未覆盖，这里补上实现而不是改小注释。
 * @returns {{ok: true, resolved: string} | {ok: false, error: string}}
 */
function resolveInside (root, target, opts) {
  const o = opts || {}
  const rootAbs = path.resolve(root)
  const targetAbs = path.resolve(target)
  const rel = path.relative(rootAbs, targetAbs)
  if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
    return { ok: false, error: '路径越界：' + target + ' 不在 ' + rootAbs + ' 之内' }
  }
  if (o.resolveSymlinks === true) {
    let realRoot
    let realTarget
    try {
      realRoot = fs.realpathSync(rootAbs)
      realTarget = fs.realpathSync(targetAbs)
    } catch (e) {
      // 解析失败时 fail-closed：拿不到真实路径就无法证明它没越界，不猜
      return { ok: false, error: '无法解析真实路径（可能是指向不存在目标的链接）：' + target + ' — ' + (e instanceof Error ? e.message : String(e)) }
    }
    const realRel = path.relative(realRoot, realTarget)
    if (realRel.startsWith('..') || path.isAbsolute(realRel)) {
      return { ok: false, error: '符号链接越界：' + target + ' 的真实路径 ' + realTarget + ' 不在 ' + realRoot + ' 之内' }
    }
    return { ok: true, resolved: realTarget }
  }
  return { ok: true, resolved: targetAbs }
}

/**
 * 校验任务名与语言码
 * @param {string} task
 * @param {string} locale
 * @returns {{ok: true} | {ok: false, error: string}}
 */
function validateTaskKey (task, locale) {
  if (typeof task !== 'string' || !TASK_NAME_RE.test(task)) {
    return { ok: false, error: '任务名非法（须匹配 ' + TASK_NAME_RE.source + '）：' + String(task) }
  }
  if (!LOCALES.includes(/** @type {any} */ (locale))) {
    return { ok: false, error: '语言码非法（须为 ' + LOCALES.join('/') + '）：' + String(locale) }
  }
  return { ok: true }
}

/**
 * 列出 tasksRoot 下全部任务名（排序后返回，保证确定性）
 * @param {string} tasksRoot
 * @returns {string[]}
 */
function listTasks (tasksRoot) {
  let entries
  try {
    entries = fs.readdirSync(tasksRoot, { withFileTypes: true })
  } catch {
    return []
  }
  return entries
    .filter((e) => e.isDirectory() && TASK_NAME_RE.test(e.name))
    .map((e) => e.name)
    .sort()
}

/**
 * 读取单个 prompt 文件（含大小上限与越界防护）
 * @param {string} tasksRoot
 * @param {string} task
 * @param {string} locale
 * @param {string} part
 * @param {string[]} errors
 * @returns {string | null}
 */
function readPromptFile (tasksRoot, task, locale, part, errors) {
  // tasksRoot 已指向 .../prompts/tasks，故相对路径从 <task> 起算
  const relPath = path.join(task, locale, part)
  const inside = resolveInside(tasksRoot, path.join(tasksRoot, relPath), { resolveSymlinks: true })
  if (!inside.ok) {
    errors.push(relPath + ': ' + inside.error)
    return null
  }
  let stat
  try {
    stat = fs.statSync(inside.resolved)
  } catch {
    errors.push(relPath + ': 缺失或不可读')
    return null
  }
  if (!stat.isFile()) {
    errors.push(relPath + ': 不是普通文件')
    return null
  }
  if (stat.size > MAX_PROMPT_FILE_BYTES) {
    errors.push(relPath + ': 超过 ' + MAX_PROMPT_FILE_BYTES + ' 字节上限（实际 ' + stat.size + '）')
    return null
  }
  let text
  try {
    text = fs.readFileSync(inside.resolved, 'utf-8')
  } catch (e) {
    errors.push(relPath + ': 读取失败 — ' + (e instanceof Error ? e.message : String(e)))
    return null
  }
  if (!text.trim()) {
    errors.push(relPath + ': 内容为空')
    return null
  }
  return text
}

/**
 * 加载整个 prompt 库（fail-closed：任一任务不完整即整体不可用）
 * @param {{tasksRoot: string}} opts
 * @returns {{ok: true, library: {root: string, tasks: Record<string, {zh: {system: string, user: string}, en: {system: string, user: string}}>, taskNames: string[]}}
 *          | {ok: false, error: string, errors: string[]}}
 */
function loadPromptLibrary (opts) {
  const o = opts || /** @type {any} */ ({})
  const tasksRoot = o.tasksRoot
  if (typeof tasksRoot !== 'string' || !tasksRoot) {
    return { ok: false, error: 'tasksRoot 必须为非空字符串', errors: ['tasksRoot 必须为非空字符串'] }
  }
  const rootAbs = path.resolve(tasksRoot)
  let rootStat
  try {
    rootStat = fs.statSync(rootAbs)
  } catch {
    return { ok: false, error: 'PROMPT_LIBRARY_UNAVAILABLE: tasksRoot 不存在 — ' + rootAbs, errors: ['tasksRoot 不存在'] }
  }
  if (!rootStat.isDirectory()) {
    return { ok: false, error: 'PROMPT_LIBRARY_UNAVAILABLE: tasksRoot 不是目录 — ' + rootAbs, errors: ['tasksRoot 不是目录'] }
  }

  const taskNames = listTasks(rootAbs)
  if (taskNames.length === 0) {
    return { ok: false, error: 'PROMPT_LIBRARY_UNAVAILABLE: tasksRoot 下没有任何任务目录 — ' + rootAbs, errors: ['任务目录为空'] }
  }

  const errors = []
  /** @type {Record<string, any>} */
  const tasks = {}
  for (const task of taskNames) {
    const entry = {}
    for (const locale of LOCALES) {
      const keyCheck = validateTaskKey(task, locale)
      if (!keyCheck.ok) {
        errors.push(task + '/' + locale + ': ' + keyCheck.error)
        continue
      }
      const parts = {}
      for (const part of REQUIRED_PARTS) {
        const text = readPromptFile(rootAbs, task, locale, part, errors)
        if (text !== null) parts[part.replace(/\.md$/, '')] = text
      }
      entry[locale] = parts
    }
    tasks[task] = entry
  }

  if (errors.length > 0) {
    return { ok: false, error: 'PROMPT_LIBRARY_UNAVAILABLE: ' + errors.join('; '), errors }
  }
  return { ok: true, library: { root: rootAbs, tasks, taskNames } }
}

/**
 * 渲染模板：把 {{var}} 替换为 vars[var]。
 * 未提供的变量**保留原样**（便于发现漏填），并在 missing 中列出——不静默替换为空串。
 * @param {string} template
 * @param {Record<string, unknown>} [vars]
 * @returns {{text: string, missing: string[], unknownVars: string[]}}
 */
function renderTemplate (template, vars) {
  const t = typeof template === 'string' ? template : ''
  const v = vars && typeof vars === 'object' ? vars : {}
  const provided = Object.keys(v)
  const unknownVars = provided.filter((k) => !VAR_NAME_RE.test(k)).slice(0, MAX_TEMPLATE_VARS)
  const missing = []
  const seen = new Set()
  const text = t.replace(/\{\{([a-z][a-z0-9_]*)\}\}/g, (whole, name) => {
    if (seen.size > MAX_TEMPLATE_VARS) return whole
    seen.add(name)
    if (!Object.prototype.hasOwnProperty.call(v, name)) {
      if (!missing.includes(name)) missing.push(name)
      return whole
    }
    const raw = v[name]
    if (raw === null || raw === undefined) return ''
    if (typeof raw === 'string') return raw
    if (typeof raw === 'number' || typeof raw === 'boolean') return String(raw)
    try {
      return JSON.stringify(raw)
    } catch {
      return whole
    }
  })
  return { text, missing, unknownVars }
}

/**
 * 取某任务某语种的 system/user 原文
 * @param {{root: string, tasks: Record<string, any>}} library
 * @param {string} task
 * @param {string} locale
 * @returns {{ok: true, system: string, user: string} | {ok: false, error: string}}
 */
function getTaskPrompts (library, task, locale) {
  if (!library || typeof library !== 'object' || !library.tasks) {
    return { ok: false, error: 'library 非法' }
  }
  const keyCheck = validateTaskKey(task, locale)
  if (!keyCheck.ok) return { ok: false, error: keyCheck.error }
  const entry = library.tasks[task]
  if (!entry) return { ok: false, error: '任务不存在：' + task }
  const loc = entry[locale]
  if (!loc || typeof loc.system !== 'string' || typeof loc.user !== 'string') {
    return { ok: false, error: '任务 ' + task + ' 缺少 ' + locale + ' 的 system/user' }
  }
  return { ok: true, system: loc.system, user: loc.user }
}

module.exports = {
  LOCALES,
  REQUIRED_PARTS,
  MAX_PROMPT_FILE_BYTES,
  TASK_NAME_RE,
  VAR_NAME_RE,
  resolveInside,
  validateTaskKey,
  listTasks,
  loadPromptLibrary,
  renderTemplate,
  getTaskPrompts,
}
