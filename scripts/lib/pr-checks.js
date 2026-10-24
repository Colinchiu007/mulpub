// @ts-nocheck
'use strict'
/**
 * scripts/lib/pr-checks.js — PR 侧 CI 检查的**取数器**（两个合并入口共用的唯一真源）
 *
 * ## 动因（2026-10-24 实测）
 *
 * `scripts/merge-when-green.{sh,ps1}` 都用 `gh pr checks <n> --json name,state` 取数。
 * **`gh pr checks --json` 这个 flag 是后加的**：老 gh（实测 2.46.0）不认 ⇒ 命令返回
 * `unknown flag: --json` 并非 0 退出。
 *
 * 致命处不在于「取不到数」，而在于**取数失败被读成「0 条检查」**：
 *   - 合并脚本把取数包在 `|| echo 0` / `if (... 2>&1)` 形态里 ⇒ 失败回落成 0；
 *   - 而 break 条件是「pending == 0 **且** total > 0」⇒ **total 恒为 0 ⇒ 永不 break**；
 *   - 于是脚本在「CI 其实早就全绿」的分支里**无限 sleep 到 120 分钟超时**，
 *     日志一直打「尚未产生 CI 检查（runner 可能离线）」——**症状极具误导性**：
 *     看起来像 runner 离线，实际是 CLI 版本不够。
 *
 * ## 修法（只改取数层，不改判定层）
 *
 * 1. **优先**走 `gh pr checks --json name,state`（新 gh 的原生路径，语义与真 gh 逐字一致）；
 * 2. 老 gh ⇒ **降级**走 `gh api --paginate repos/<o>/<r>/commits/<sha>/check-runs`
 *    （`api.github.com` 通，且 `api` 子命令比 `pr checks` 老得多 ⇒ 覆盖面更广）；
 * 3. 两条路都取不到 ⇒ **以非 0 退出并说明原因**，**绝不**回落成「0 条检查」
 *    （这是本文件存在的全部理由：把「取数失败」与「真的没有检查」分成两个值）。
 *
 * ## 降级路径的语义对齐（关键）
 *
 * `gh pr checks` 报的是**每个检查名的最新一次 run**（GitHub check suite 的 rollup 语义），
 * 而 `check-runs` 返回该 commit 上**全部** check run（**含重跑**）。
 * ⇒ 降级路径必须**按 name 取最新一次 run**，否则：
 *   - 取「全部」⇒ 一次先红后绿的重跑会让脚本**永远判红**（记忆：同一 commit 上最多 84 条重复 run）；
 *   - 取「最严」⇒ 与真 gh 语义不一致（真 gh 取最新，不取最严）。
 * ⇒ 本文件按 **`started_at` 最新**（同刻则 `id` 最大）取，与真 gh 的 rollup 语义最接近。
 *
 * ## state 枚举映射（照抄真 gh 的大写枚举）
 *
 * 真 gh 的 `state` 取值域：`PENDING / IN_PROGRESS / QUEUED / SUCCESS / FAILURE /
 * CANCELLED / TIMED_OUT / ERROR / SKIPPED / NEUTRAL / ACTION_REQUIRED / STALE / …`
 * 合并脚本按名字取状态：未完成档 = `PENDING IN_PROGRESS QUEUED WAITING REQUESTED`，
 * 失败档 = `FAILURE CANCELLED TIMED_OUT ERROR`。
 * ⇒ 映射**必须落在真 gh 的同一取值域里**，否则降级路径与原生路径的判定结果会分叉。
 *
 * ⚠️ **未知 conclusion 归 `ERROR`**（失败档）而不是 UNKNOWN：
 *   未知值若落进「既非未完成、也非失败」的空洞 ⇒ 会被当成「已完成且没红」⇒ **放行**。
 *   合并门禁里**漏判（放行坏 PR）比误判（多跑一轮）贵得多** ⇒ 保守归失败。
 *
 * ## 用法
 *
 * ```bash
 * node scripts/lib/pr-checks.js --pr 1234 [--repo owner/name]
 * # stdout: [{"name":"QG Changes","state":"SUCCESS"}, ...]
 * # rc=0 取到数（可能是空数组＝尚未产生检查）；rc≠0 取数失败（stderr 说明原因）
 * ```
 */

const { spawnSync } = require('child_process')

/** 真 gh 的 state 取值域里，合并脚本当作「未完成」的那些 */
const INCOMPLETE_STATES = new Set(['PENDING', 'IN_PROGRESS', 'QUEUED', 'WAITING', 'REQUESTED'])
/** 真 gh 的 state 取值域里，合并脚本当作「失败」的那些 */
const FAILED_STATES = new Set(['FAILURE', 'CANCELLED', 'TIMED_OUT', 'ERROR'])

/**
 * `gh pr checks --json` 在老 gh 上的报错形态。
 * ⚠️ 只认这些**明确**的「flag 不认」信号；其它失败一律当「取数失败」处理（不降级），
 *    避免把网络抖动/权限问题误当成「版本不够」而走上另一条取数路。
 */
const JSON_FLAG_UNSUPPORTED_PATTERNS = [
  /unknown flag/i,
  /unknown option/i,
  /flag provided but not defined/i,
  /unknown shorthand flag/i,
]

/**
 * check-run 的 (status, conclusion) → 真 gh 的 state。
 * @param {{status?:string, conclusion?:string}} row
 * @returns {string}
 */
function mapCheckRunToState (row) {
  const r = row || {}
  const status = String(r.status || '').toLowerCase()
  if (status !== 'completed') {
    if (status === 'queued') return 'QUEUED'
    if (status === 'in_progress') return 'IN_PROGRESS'
    // 未知 status 保守归未完成（宁可多等一轮，不可把未跑完的当跑完）
    return 'PENDING'
  }
  const conclusion = String(r.conclusion || '').toLowerCase()
  switch (conclusion) {
    case 'success': return 'SUCCESS'
    case 'failure': return 'FAILURE'
    case 'neutral': return 'NEUTRAL'
    case 'cancelled': return 'CANCELLED'
    case 'timed_out': return 'TIMED_OUT'
    case 'skipped': return 'SKIPPED'
    case 'action_required': return 'ACTION_REQUIRED'
    case 'stale': return 'STALE'
    case '': return 'ERROR'
    default: return 'ERROR'
  }
}

/**
 * 同名多次 run ⇒ 取**最新一次**（与真 gh `gh pr checks` 的 rollup 语义对齐）。
 *
 * ⚠️ **不取「最严」**：真 gh 取最新。取最严会让「先红后绿的重跑」永远判红
 *    （实测同一 commit 上因 handle-ci-failure 重跑可产生数十条同名 run）。
 *
 * @param {Array<object>} rows check-run 行
 * @returns {Array<{name:string,state:string}>} 每个 name 一行
 */
function pickLatestPerName (rows) {
  const best = new Map()
  for (const raw of rows || []) {
    if (!raw || typeof raw !== 'object') continue
    const name = String(raw.name == null ? '' : raw.name).trim()
    if (!name) continue
    const startedAt = String(raw.started_at || raw.completed_at || '')
    const id = Number(raw.id || 0)
    const cur = best.get(name)
    if (!cur) { best.set(name, { name, state: mapCheckRunToState(raw), startedAt, id }); continue }
    const newer = startedAt > cur.startedAt || (startedAt === cur.startedAt && id > cur.id)
    if (newer) best.set(name, { name, state: mapCheckRunToState(raw), startedAt, id })
  }
  return Array.from(best.values()).map((r) => ({ name: r.name, state: r.state }))
}

/**
 * 这段错误文本是不是「gh 不认 --json 这个 flag」。
 * @param {string} text
 * @returns {boolean}
 */
function isJsonFlagUnsupported (text) {
  const s = String(text || '')
  return JSON_FLAG_UNSUPPORTED_PATTERNS.some((re) => re.test(s))
}

/**
 * 取 PR 侧检查行。
 *
 * @param {{pr:number|string, repo?:string, run?:Function}} opts
 *   `run(args)` 注入执行器（默认 spawnSync('gh', args)）⇒ 便于单测。
 * @returns {{ok:boolean, rows:Array<{name:string,state:string}>, via:string, error?:string}}
 */
function collectPrChecks (opts) {
  const o = opts || {}
  const pr = String(o.pr == null ? '' : o.pr).trim()
  if (!pr) return { ok: false, rows: [], via: 'none', error: '缺少 --pr' }
  const run = typeof o.run === 'function' ? o.run : defaultRunner

  // ── 路径 1：原生 `gh pr checks --json name,state`（新 gh）
  const native = run(['pr', 'checks', pr, '--json', 'name,state'])
  if (native && native.status === 0) {
    const parsed = parseChecksJson(native.stdout)
    if (parsed) return { ok: true, rows: parsed, via: 'gh-pr-checks' }
  }
  const nativeErr = (native && (native.stderr || native.stdout)) || ''
  if (!isJsonFlagUnsupported(nativeErr)) {
    return {
      ok: false,
      rows: [],
      via: 'gh-pr-checks',
      error: 'gh pr checks 取数失败（不是 --json 不被支持的问题，不降级）：' + String(nativeErr).trim().slice(0, 300),
    }
  }

  // ── 路径 2：降级到 `gh api commits/<sha>/check-runs`（老 gh）
  const head = run(['pr', 'view', pr, '--json', 'headRefOid', '--jq', '.headRefOid'])
  const sha = head && head.status === 0 ? String(head.stdout || '').trim() : ''
  if (!sha) {
    return { ok: false, rows: [], via: 'check-runs', error: '降级路径取不到 PR head sha：' + String((head && (head.stderr || head.stdout)) || '').trim().slice(0, 300) }
  }
  const slug = String(o.repo || process.env.GH_REPO || '').trim()
  if (!/^[^/\s]+\/[^/\s]+$/.test(slug)) {
    return { ok: false, rows: [], via: 'check-runs', error: '降级路径需要仓库 slug（--repo 或 GH_REPO），当前为：' + JSON.stringify(slug) }
  }
  const api = run(['api', '--paginate', `repos/${slug}/commits/${sha}/check-runs`])
  if (!api || api.status !== 0) {
    return { ok: false, rows: [], via: 'check-runs', error: 'gh api check-runs 取数失败：' + String((api && (api.stderr || api.stdout)) || '').trim().slice(0, 300) }
  }
  const rawRows = parseCheckRunsOutput(api.stdout)
  if (rawRows === null) {
    return { ok: false, rows: [], via: 'check-runs', error: 'check-runs 输出不是可解析的 JSON' }
  }
  return { ok: true, rows: pickLatestPerName(rawRows), via: 'check-runs' }
}

/** 解析 `gh pr checks --json` 的数组输出；形状不对就返回 null（不猜） */
function parseChecksJson (text) {
  const s = String(text || '').trim()
  if (!s) return []
  let parsed
  try { parsed = JSON.parse(s) } catch { return null }
  if (!Array.isArray(parsed)) return null
  const out = []
  for (const item of parsed) {
    if (!item || typeof item !== 'object') return null
    const name = String(item.name == null ? '' : item.name).trim()
    if (!name) return null
    out.push({ name, state: String(item.state == null ? '' : item.state).toUpperCase() })
  }
  return out
}

/**
 * 解析 `gh api --paginate .../check-runs` 的输出。
 *
 * ⚠️ **输出形态不止一种**（实测踩到）：`gh api --paginate` **不带 `--jq`** 时，
 *   每一页各自是一个 JSON 数组，多页直接拼在一起 ⇒ 形如 `[{...}][{...}]`，
 *   **整体不是合法 JSON**；而带 `--jq '.check_runs[] | {...}'` 时才是「每行一个对象」。
 *   不同 gh 版本 / 不同 shim 实现给的形态不一致 ⇒ 这里**三种都认**：
 *   ① 整体是一个 JSON 数组；② 逐行一个 JSON 对象；③ 多个连续 JSON 值。
 *
 * @param {string} text
 * @returns {Array<object>|null} null = 解析不出来（**不等于**「没有检查」）
 */
function parseCheckRunsOutput (text) {
  const s = String(text || '').trim()
  if (!s) return []
  // 形态 ①：整体是一个 JSON 值（数组或对象）
  try {
    const v = JSON.parse(s)
    return flattenRows([v])
  } catch { /* 不是形态 ①，继续试 */ }
  // 形态 ②：逐行一个 JSON 对象
  const lines = s.split('\n').map((l) => l.trim()).filter(Boolean)
  const objs = []
  let linesOk = true
  for (const line of lines) {
    try {
      const o = JSON.parse(line)
      if (!o || typeof o !== 'object') { linesOk = false; break }
      objs.push(o)
    } catch { linesOk = false; break }
  }
  if (linesOk && objs.length > 0) return flattenRows(objs)
  // 形态 ③：多个连续 JSON 值（每页一个）
  const values = parseJsonValues(s)
  if (values === null) return null
  return flattenRows(values)
}

/**
 * 递归剥掉 REST 的**包装层**，取出真正的行。
 *
 * ⚠️ 实测（2026-10-24）REST 端点的返回形态不止一种：
 *   - `{total_count, check_runs:[...]}`（标准形态）
 *   - `[{total_count, check_runs:[...]}]`（**包装对象被套在数组里** —— 实测由某 CLI 的分页实现产生）
 *   - `[[{...}],[{...}]]`（每页一个数组直接拼接）
 *   - 逐行一个对象
 * ⇒ 不剥这层就会得到「0 行」的空结果 ⇒ **静默假绿**（读起来像「没有 CI 检查」）。
 */
function flattenRows (values) {
  const out = []
  const visit = (v) => {
    if (Array.isArray(v)) { for (const x of v) visit(x); return }
    if (!v || typeof v !== 'object') return
    if (Array.isArray(v.check_runs)) { for (const x of v.check_runs) visit(x); return }
    if (Array.isArray(v.items)) { for (const x of v.items) visit(x); return }
    out.push(v)
  }
  for (const v of values || []) visit(v)
  return out
}

/**
 * 扫描「连续 JSON 值」的文本，返回解析出的值列表；解析失败返回 null。
 * （形如 `[{...}][{...}]` —— 逐个取顶层 JSON 值。）
 */
function parseJsonValues (text) {
  const s = String(text || '')
  const out = []
  let i = 0
  while (i < s.length) {
    while (i < s.length && /\s/.test(s[i])) i++
    if (i >= s.length) break
    const open = s[i]
    if (open !== '{' && open !== '[') return null
    const close = open === '{' ? '}' : ']'
    let depth = 0
    let inStr = false
    let esc = false
    let end = -1
    for (let j = i; j < s.length; j++) {
      const c = s[j]
      if (inStr) {
        if (esc) { esc = false; continue }
        if (c === '\\') { esc = true; continue }
        if (c === '"') inStr = false
        continue
      }
      if (c === '"') { inStr = true; continue }
      if (c === open) depth++
      else if (c === close) {
        depth--
        if (depth === 0) { end = j; break }
      }
    }
    if (end < 0) return null
    try { out.push(JSON.parse(s.slice(i, end + 1))) } catch { return null }
    i = end + 1
  }
  return out
}

/** 默认执行器：spawnSync('gh', args) */
function defaultRunner (args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 })
  return {
    status: r.status,
    stdout: String(r.stdout || ''),
    stderr: String(r.stderr || ''),
    error: r.error,
  }
}

/**
 * CLI 入口。
 *
 * @param {string[]} [argv]
 * @param {{run?:Function}} [deps] **显式注入点**：`run` 只允许代码注入（测试用），
 *   绝不从命令行/环境读取执行器路径（否则等于开一个「任意命令执行」的口子）。
 *   之所以要这个注入点：`spawnSync` 在模块加载期就被解构绑定，
 *   测试里再改 `require('child_process').spawnSync` **追不上**（绑定早已固化）。
 */
function main (argv, deps) {
  const args = argv || process.argv.slice(2)
  const run = (deps && typeof deps.run === 'function') ? deps.run : undefined
  let pr = ''
  let repo = ''
  let format = 'json'
  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--pr') pr = args[++i] || ''
    else if (a.startsWith('--pr=')) pr = a.slice(5)
    else if (a === '--repo') repo = args[++i] || ''
    else if (a.startsWith('--repo=')) repo = a.slice(7)
    else if (a === '--format') format = String(args[++i] || '').toLowerCase()
    else if (a.startsWith('--format=')) format = a.slice(9).toLowerCase()
  }
  if (format !== 'json' && format !== 'tsv') {
    process.stderr.write('[pr-checks] 未知 --format：' + format + '（支持 json | tsv）\n')
    return 2
  }
  const res = collectPrChecks({ pr, repo, run })
  if (!res.ok) {
    process.stderr.write('[pr-checks] 取数失败：' + res.error + '\n')
    process.stderr.write('[pr-checks] 这**不是**「没有 CI 检查」——请勿据此判定「runner 离线」或「可以合并」。\n')
    return 1
  }
  if (format === 'tsv') {
    // TSV：**state 在前、name 在后** ⇒ name 里含空格/引号/中文都不影响按 state 判定
    // （bash 侧零 jq 依赖，且「哪些 state 算未完成/算失败」的判定逐字留在脚本里，不搬进本文件）。
    const out = res.rows
      .map((r) => r.state + '\t' + String(r.name).replace(/[\t\r\n]/g, ' '))
      .join('\n')
    process.stdout.write(out ? out + '\n' : '')
  } else {
    process.stdout.write(JSON.stringify(res.rows) + '\n')
  }
  if (res.via === 'check-runs') {
    process.stderr.write('[pr-checks] 提示：本机 gh 不支持 `pr checks --json`，已降级到 `gh api commits/<sha>/check-runs`（同名取最新一次 run）。\n')
  }
  return 0
}

module.exports = {
  INCOMPLETE_STATES,
  FAILED_STATES,
  mapCheckRunToState,
  pickLatestPerName,
  isJsonFlagUnsupported,
  parseChecksJson,
  parseCheckRunsOutput,
  parseJsonValues,
  flattenRows,
  collectPrChecks,
  main,
}

if (require.main === module) {
  process.exit(main(process.argv.slice(2)))
}
