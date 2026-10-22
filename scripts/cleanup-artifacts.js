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
 * 五条口径：
 * 1. **逐页列举 + 每页重试**，任一页最终失败 ⇒ 如实计入 `pages_degraded` 并非零退出：
 *    "没做完"永远不被读成"没有待删条目"。首页就失败 ⇒ `UNPROVEN`，一条都不删。
 * 2. DELETE 走 `--silent`：204 空体会被 gh 当 JSON 解析（与上面同形）。写旗标由测试逐参数锁住。
 * 3. 默认 dry-run（只读数不动手），真删必须显式 `--write` —— CI 的定时作业是唯一的写方。
 * 4. **仓库坐标由调用点在命令行上显式给**（定时作业写 `--repo=` 接 runner 的仓库变量）。禁止只在
 *    workflow 的 `env:` 里声明一个脚本根本不读的键：那种写法今天靠 runner 自带的 `GITHUB_REPOSITORY`
 *    恰好兜住，读起来却像"坐标已经接好了"——判据对、传参错位，接线锁抓不到（QM-6 i4 实测命中）。
 * 5. **上游返回的 id 会被拼进 DELETE 的路径段**，所以按形状收口（纯正整数），不合要求的计入
 *    `rejected=` 并在首行出声；且 `rejected>0` 时结论不得是 `OK`（判 `REJECTED_PRESENT`、非零退出）——
 *    "有条目被我拒了"和"有页我没列完"一样，都不许被读成"清理做完了"。现读 GitHub 返回 number 型 id，
 *    所以这一档今天恒为 0；它守的是"形状变了要有人知道"，不是"兼容另一种形状"。
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
  let rejected = 0
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
        return { verdict: 'UNPROVEN', cutoff, pages: 0, degraded: 1, rejected: 0, candidates: 0, deleted: 0, deletedIds: [] }
      }
      degraded++
      break
    }
    pages++
    const list = res.body.artifacts
    for (const a of list) {
      if (!(a && a.expired === false && typeof a.created_at === 'string' && a.created_at < cutoff)) continue
      // id 来自上游 API，且会被拼进 DELETE 的**路径段**。非纯正整数一律不采纳并计数出声：
      // "把外部可控值原样写进请求路径"在本仓是要机械拦的形态，不是"看起来不可能发生"的形态。
      if (Number.isInteger(a.id) && a.id > 0) ids.push(a.id)
      else rejected++
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
        return { verdict: 'DELETE_FAILED', cutoff, pages, degraded, rejected, candidates: ids.length, deleted, deletedIds, failedId: id }
      }
      deleted++
      deletedIds.push(id)
    }
  }
  return {
    // rejected>0 与 degraded>0 同类：「看见了但没处理」。把它们都收成 OK 就等于对
    // 消费这个退出码的人说"清理做完了"，而实际有条目被形状判据挡在门外（QM-6 第三轮 i3）。
    // 现读 GitHub 的 artifacts API 返回 number 型 id（2026-10-22 实测 3/3 条 `typeof === 'number'`），
    // 所以这里不是"兼容字符串"，而是"哪天形状变了要有人知道"。
    verdict: degraded > 0 ? 'DEGRADED' : rejected > 0 ? 'REJECTED_PRESENT' : 'OK',
    cutoff, pages, degraded, rejected, candidates: ids.length, deleted, deletedIds,
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
  console.log(`ARTIFACT-CLEAN repo=${opt.repo} days=${opt.days} cutoff=${r.cutoff} pages=${r.pages} pages_degraded=${r.degraded} rejected=${r.rejected} candidates=${r.candidates} deleted=${r.deleted} mode=${opt.write ? 'write' : 'dry'} verdict=${r.verdict}`)
  process.exit(r.verdict === 'OK' ? 0 : 1)
}

if (require.main === module) main()

module.exports = { parseArgs, cutoffOf, runCleanup, defaultApi, defaultDel }
