'use strict'
/*
 * cleanup-artifacts.js — 删除过期 CI artifact（原本内联在 .github/workflows/cleanup-artifacts.yml 的 run 块里）
 *
 * 为什么要搬出来（2026-10-21 实测）：那条 `gh api --paginate … | while read … done` 把
 * **54 页上游列举**绑成一个管道，任意一页 5xx 就让整步 `set -euo pipefail` 退出；而 gh 对
 * 空体响应（GitHub 的 500 就是 `Content-Length: 0`）报的是 `unexpected end of JSON input`，
 * 读起来像"我们的脚本坏了"。当天实测：`?per_page=1` ⇒ 500、同一 URL 隔几秒再请求 ⇒ 200
 * （page=2 两次调用一次 500 一次 200）⇒ **间歇性**，不是某个坏记录。`--paginate` 没有重试，
 * 所以日日必红（自 2026-10-14 起 schedule 连续失败，且它不是 required ⇒ 没有任何东西在看它）。
 *
 * 三条口径：
 * 1. **逐页列举 + 每页重试**，任一页最终失败 ⇒ 如实计入 `pages_degraded` 并非零退出：
 *    "没做完"永远不被读成"没有待删条目"。首页就失败 ⇒ `UNPROVEN`，一条都不删。
 * 2. DELETE 走 `--silent`：204 空体会被 gh 当 JSON 解析（与上面同形）。写旗标由测试逐参数锁住。
 * 3. 默认 dry-run（只读数不动手），真删必须显式 `--write` —— CI 的定时作业是唯一的写方。
 *
 * 依赖：只允许 node 内置（落点 `changes` 作业无 Install deps）。
 * 用法：node scripts/cleanup-artifacts.js [--days=5] [--dry-run|--write] [--repo=o/r] [--retries=3]
 */

const DEFAULT_DAYS = 5
const DEFAULT_RETRIES = 3
const PER_PAGE = 100

function fail (msg) {
  const e = new Error(msg)
  e.code = 'ART_CLEAN_ARGS'
  throw e
}

function parseArgs (argv, env) {
  const opt = { days: DEFAULT_DAYS, retries: DEFAULT_RETRIES, perPage: PER_PAGE, write: false, repo: (env && env.GITHUB_REPOSITORY) || '' }
  for (const a of argv) {
    if (a === '--dry-run') opt.write = false
    else if (a === '--write') opt.write = true
    else if (/^--days=\d+$/.test(a)) opt.days = Number(a.slice(7))
    else if (/^--retries=\d+$/.test(a)) opt.retries = Number(a.slice(10))
    else if (/^--per-page=\d+$/.test(a)) opt.perPage = Number(a.slice(11))
    else if (/^--repo=[^/]+\/[^/]+$/.test(a)) opt.repo = a.slice(7)
    else fail(`ART_CLEAN_ARGS: 未知或非法参数 ${a}（只接受 --write / --dry-run / --days=N / --retries=N / --per-page=N / --repo=o/r）`)
  }
  if (opt.days < 1) fail(`ART_CLEAN_ARGS: --days 必须 ≥ 1，实得 ${opt.days}`)
  if (!opt.repo) fail('ART_CLEAN_ARGS: 没有仓库坐标（传 --repo=o/r 或设 GITHUB_REPOSITORY）；不得猜测')
  return opt
}

function cutoffOf (now, days) {
  return new Date(now.getTime() - days * 86400000).toISOString().replace(/\.\d{3}Z$/, 'Z')
}

/**
 * @param {{now:Date, opt:object, api:Function, del:Function, log?:Function}} deps
 *   api(argv) => {ok:boolean, body:object|null}；del(argv) => {ok:boolean}
 */
function runCleanup (deps) {
  const { now, opt, api, del } = deps
  const log = deps.log || (() => {})
  const cutoff = cutoffOf(now, opt.days)
  let page = 1
  let pages = 0
  let degraded = 0
  const ids = []

  for (;;) {
    let res = null
    let attempts = 0
    for (; attempts < opt.retries; attempts++) {
      res = api(['api', `repos/${opt.repo}/actions/artifacts?per_page=${opt.perPage}&page=${page}`])
      if (res && res.ok && res.body && Array.isArray(res.body.artifacts)) break
      if (attempts + 1 < opt.retries) log(`  retry page=${page} attempt=${attempts + 1}`)
    }
    if (!res || !res.ok || !res.body || !Array.isArray(res.body.artifacts)) {
      if (page === 1) {
        return { verdict: 'UNPROVEN', cutoff, pages: 0, degraded: 1, candidates: 0, deleted: 0, deletedIds: [] }
      }
      degraded++
      break
    }
    pages++
    const list = res.body.artifacts
    for (const a of list) {
      if (a && a.expired === false && typeof a.created_at === 'string' && a.created_at < cutoff && a.id !== undefined) ids.push(a.id)
    }
    if (list.length < opt.perPage) break
    page++
  }

  let deleted = 0
  const deletedIds = []
  if (opt.write) {
    for (const id of ids) {
      const r = del(['api', '--silent', '-X', 'DELETE', `repos/${opt.repo}/actions/artifacts/${id}`])
      if (!r || !r.ok) {
        return { verdict: 'DELETE_FAILED', cutoff, pages, degraded, candidates: ids.length, deleted, deletedIds, failedId: id }
      }
      deleted++
      deletedIds.push(id)
    }
  }
  return {
    verdict: degraded > 0 ? 'DEGRADED' : 'OK',
    cutoff, pages, degraded, candidates: ids.length, deleted, deletedIds,
  }
}

function defaultApi (argv) {
  const { spawnSync } = require('node:child_process')
  const r = spawnSync('gh', argv, { encoding: 'utf8' })
  if (r.status !== 0) return { ok: false, status: r.status, stderr: (r.stderr || '').trim().slice(0, 160) }
  try { return { ok: true, body: JSON.parse(r.stdout || '{}') } } catch (e) { return { ok: false, status: r.status, stderr: 'unparseable body: ' + String(e.message).slice(0, 60) } }
}

function defaultDel (argv) {
  const { spawnSync } = require('node:child_process')
  const r = spawnSync('gh', argv, { encoding: 'utf8' })
  return { ok: r.status === 0, stderr: (r.stderr || '').trim().slice(0, 160) }
}

function main () {
  let opt
  try { opt = parseArgs(process.argv.slice(2), process.env) } catch (e) {
    console.error(`[cleanup-artifacts] ${e.message}`)
    process.exit(2)
  }
  const started = new Date()
  const r = runCleanup({ now: started, opt, api: defaultApi, del: defaultDel, log: (m) => console.log(m) })
  console.log(`ARTIFACT-CLEAN repo=${opt.repo} days=${opt.days} cutoff=${r.cutoff} pages=${r.pages} pages_degraded=${r.degraded} candidates=${r.candidates} deleted=${r.deleted} mode=${opt.write ? 'write' : 'dry'} verdict=${r.verdict}`)
  process.exit(r.verdict === 'OK' ? 0 : 1)
}

if (require.main === module) main()

module.exports = { parseArgs, cutoffOf, runCleanup, defaultApi, defaultDel }
