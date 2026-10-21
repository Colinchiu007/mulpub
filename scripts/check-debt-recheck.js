#!/usr/bin/env node
/**
 * 债务守门输入变更后重算在飞 PR（change: debt-baseline-recheck）
 *
 * 要补的缺口：收紧 scripts/debt-baseline.json 之后，在飞 PR 的 required check **不会重跑**
 * （pull_request 的 run 钉在触发那一刻的 merge ref 上），于是带着旧基线绿结论的 PR 照样能
 * 自动合并、主干当场变红。本脚本只在"主干上这两份守门输入变了"时被调用，逐笔 PR 取
 * 「与当下主干的合并态」重算，并把结论点名在 PR 上。
 *
 * 三条不可破的边界（规格见 openspec/specs/... 归档前的 change specs/ci-debt-baseline-recheck）：
 *   1. 度量只有一处实现：本脚本**不**复算任何指标，一律调用 scripts/check-debt-budget.js；
 *   2. 它不是闸门：量到了就退 0（哪怕结论是"有债"），只有工具侧故障才非 0，且不进 required；
 *   3. 量不到必须单列并带封闭 reason 词表，不得折叠成"通过"或"违规"。
 *
 * 用法（由 workflow 装配，测试面全部走注入）：
 *   node scripts/check-debt-recheck.js --print-plan     # 只打印将要重算哪些 PR，不动任何东西
 */

'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('node:child_process')

const VERDICTS = Object.freeze(['IN_BASELINE', 'VIOLATES', 'UNJUDGEABLE', 'CHECKER_FAILED'])
// 封闭词表：出现第五种形态只能归 unknown-shape（它属工具侧故障，见 TOOL_FAULT_REASONS）
const UNJUDGEABLE_REASONS = Object.freeze(['conflict', 'unrelated-histories', 'ref-missing', 'worktree-setup', 'unknown-shape'])
// 这些档意味着"我们没量到"，不是"这个 PR 有问题" ⇒ 整轮非零退出且不逐条刷评论
const TOOL_FAULT_REASONS = Object.freeze(['unrelated-histories', 'ref-missing', 'unknown-shape'])
const MARKER = '<!-- debt-baseline-recheck:v1'

const isOid = (s) => /^[0-9a-f]{40}$/.test(String(s || '').trim())

/**
 * 分类 merge-tree 的回显。两条实测形状（临时仓库探针）：
 *   无冲突：rc=0、首行 = 树 oid、stderr 空
 *   真冲突：rc=1、**首行仍是那个冲突树的 oid**、stdout 含 Auto-merging/CONFLICT、stderr 零字节
 * ⇒ 先看 rc，再看 CONFLICT 字样；两者都不能只看 stderr 或只看首行 oid。
 */
function classifyMergeTree ({ rc, stdout, stderr } = {}) {
  const out = String(stdout || '')
  const err = String(stderr || '')
  if (/refusing to merge unrelated histories/.test(err)) return { ok: false, reason: 'unrelated-histories' }
  if (rc === 0 && isOid(out.split('\n')[0])) return { ok: true, treeOid: out.split('\n')[0].trim() }
  if (rc !== 0 && /CONFLICT|Auto-merging/.test(out)) return { ok: false, reason: 'conflict' }
  return { ok: false, reason: 'unknown-shape' }
}

/**
 * seam 契约（三处注入，全部**不吃参数**，闭包自己带上下文）：
 *   classify()   → 真实现是 `classifyMergeTree(git(['merge-tree', …]))`（live 里闭包 baseSha/head）
 *   commitTree(treeOid) / worktreeAdd(commitOid) → 合成提交与只读检出
 *   runChecker(dir) → 在那个树里跑 check-debt-budget.js，只回 {rc,stdout,stderr}
 * 缺 commitTree/worktreeAdd/runChecker 任一 ⇒ 归 `worktree-setup`（工具没装配好），
 * **不得**归成 `conflict` —— 那会把"我们没接线"伪装成"这个 PR 有冲突"。
 */
function defaultClassify () { return { ok: false, reason: 'unknown-shape' } }

/**
 * 一笔 PR：合并态 → 合成提交 → 只读 worktree → 在那个树里跑判据。
 * 一切外部依赖注入，以便在 os.tmpdir() 的小仓库里逐条验证决策。
 */
function evaluatePr (deps = {}) {
  const { pr = {}, classify = defaultClassify, commitTree, worktreeAdd, runChecker } = deps
  const merged = classify()
  if (!merged || merged.ok !== true) {
    const reason = merged && UNJUDGEABLE_REASONS.includes(merged.reason) ? merged.reason : 'unknown-shape'
    return { pr: pr.number, verdict: 'UNJUDGEABLE', reason }
  }
  if (typeof commitTree !== 'function' || typeof worktreeAdd !== 'function' || typeof runChecker !== 'function') {
    return { pr: pr.number, verdict: 'UNJUDGEABLE', reason: 'worktree-setup' }
  }
  const ct = commitTree(merged.treeOid) || {}
  if (ct.rc !== 0 || !ct.commitOid) return { pr: pr.number, verdict: 'UNJUDGEABLE', reason: 'worktree-setup' }
  const wa = worktreeAdd(ct.commitOid) || {}
  if (wa.rc !== 0 || !wa.dir) return { pr: pr.number, verdict: 'UNJUDGEABLE', reason: 'worktree-setup' }
  let res
  try {
    res = runChecker(wa.dir) || {}
  } catch (e) {
    return { pr: pr.number, verdict: 'CHECKER_FAILED', detail: '判据抛出：' + (e && e.message ? e.message : String(e)) }
  }
  if (res.rc === null || res.rc === undefined) {
    return { pr: pr.number, verdict: 'CHECKER_FAILED', detail: String(res.stderr || res.stdout || '').split('\n').filter(Boolean)[0] || '判据无输出' }
  }
  const detail = String(res.stdout || '').split('\n').map((l) => l.trim()).filter(Boolean).slice(-2).join(' | ')
  return {
    pr: pr.number,
    verdict: res.rc === 0 ? 'IN_BASELINE' : 'VIOLATES',
    detail: detail.slice(0, 300),
  }
}

function counts (entries) {
  const c = { total: entries.length, IN_BASELINE: 0, VIOLATES: 0, UNJUDGEABLE: 0, CHECKER_FAILED: 0 }
  for (const e of entries || []) if (c[e.verdict] !== undefined) c[e.verdict]++
  return c
}

/** 空集也必须出行：本仓实测过"空数组被读成检查已通过"。 */
function summarizeLine (entries) {
  const c = counts(entries)
  return `rows=${c.total} IN_BASELINE=${c.IN_BASELINE} VIOLATES=${c.VIOLATES} UNJUDGEABLE=${c.UNJUDGEABLE} CHECKER_FAILED=${c.CHECKER_FAILED}`
}

function summarize (entries) {
  const c = counts(entries)
  const faultReasons = (entries || [])
    .filter((e) => e.verdict === 'UNJUDGEABLE' && TOOL_FAULT_REASONS.includes(e.reason))
    .map((e) => e.reason)
  const toolFault = faultReasons.length > 0
  return {
    counts: c,
    line: summarizeLine(entries),
    // 量到了就退 0（哪怕全部违规）；工具失明必须非 0，且不得伪装成对别人 PR 的判决
    exitCode: toolFault ? 1 : 0,
    shouldComment: !toolFault && c.total > 0,
    faultReasons: [...new Set(faultReasons)],
  }
}

function renderComment ({ entries = [], baseSha = '', judgedAt = '' } = {}) {
  const head = `${MARKER} base=${baseSha} judged=${judgedAt} -->`
  const rows = entries.map((e) => {
    const extra = e.verdict === 'UNJUDGEABLE' ? String(e.reason || '') : String(e.detail || '')
    return `| #${e.pr} | ${e.verdict} | ${extra} |`
  })
  return [
    head,
    '',
    '债务基线变更后的一次重算（**只点名、不阻断**：这条作业不是 required check，也不改任何分支保护）。',
    '',
    '| PR | 结论 | 现场 |',
    '|---|---|---|',
    ...(rows.length ? rows : ['| — | （本轮没有需要重算的 open PR） | rows=0 |']),
    '',
    '```',
    summarizeLine(entries),
    '```',
    '',
    '若上面出现 `VIOLATES`：请 re-sync 到当下主干后重跑，让 required check 用新基线重算一次；',
    '出现 `UNJUDGEABLE(reason=conflict)` 说明这笔 PR 与主干真有冲突，本次没能构造出合并态、**没有量过它**。',
  ].join('\n')
}

/** 只认标记前缀；标记里的 base=/judged= 是给人看的现场，纳入判定会把自家历史评论全判成过期。 */
function findMarkerComment (comments, markerPrefix = MARKER) {
  for (const c of comments || []) {
    const body = c && typeof c.body === 'string' ? c.body : ''
    if (body.trimStart().startsWith(markerPrefix)) return c
  }
  return null
}

// ── 真 git 装配（生产与集成用例共用同一实现，不另写一份） ──────────────────────────
function gitRunner (repo) {
  return function git (args) {
    const r = spawnSync('git', ['-C', repo].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
    return { rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
  }
}

/**
 * 在合并态里读一次基线归属（D2 的行为证明；集成用例走这条）。
 * 用完必删 worktree —— 它在临时仓库之外仍会往 `.git/worktrees` 留注册。
 * ⚠ 它**从不跑判据**，所以返回的是 `built`（合并态造不造得出来），不是判决（前端轴 W-FE2：
 * 旧名带 evaluate、返回值带 verdict:'IN_BASELINE'，两者合起来会让下一个维护者把它当判决入口）。
 */
function mergedTreeEvidence ({ repo, baseSha, headSha, inspect }) {
  const git = gitRunner(repo)
  const mt = git(['merge-tree', '--write-tree', baseSha, headSha])
  const cls = classifyMergeTree(mt)
  if (!cls.ok) return { built: false, reason: cls.reason }
  const ct = git(['commit-tree', cls.treeOid, '-p', baseSha, '-p', headSha, '-m', 'debt-baseline-recheck synthetic merge'])
  if (ct.rc !== 0) return { built: false, reason: 'worktree-setup' }
  const commitOid = ct.stdout.trim()
  if (!isOid(commitOid)) return { built: false, reason: 'worktree-setup' }
  const dir = path.join(os.tmpdir(), `debt-recheck-wt-${process.pid}-${Date.now()}`)
  const add = git(['worktree', 'add', '--detach', '-q', dir, commitOid])
  if (add.rc !== 0) return { built: false, reason: 'worktree-setup' }
  try {
    const merged = { baseline: inspect(dir), aTxt: fs.existsSync(path.join(dir, 'a.txt')) ? fs.readFileSync(path.join(dir, 'a.txt'), 'utf8').trim() : null }
    return Object.assign({ built: true, dir }, merged)
  } finally {
    git(['worktree', 'remove', '--force', dir])
  }
}

/**
 * 「哪些文件算守门输入」的第二处真源（前端轴 W-FE3）：本仓的债务红线实际由 debt-guard.yml 执行，
 * 所以触发清单必须从**它的阻断 step** 派生，而不是由人抄一份。两条口径：
 *  - 带 `continue-on-error: true` 的 step 是软门禁（本项目里是死代码检测），改了它不会让谁的
 *    required check 由绿变红 ⇒ 不进集合；
 *  - 每个阻断脚本还要连**它自己声明的基线/账本文件**一起进集合（读 `path.join(__dirname, '<file>')`
 *    的字面量），因为收紧一份账本与收紧判据本体是同一件事的两半。
 * `readScript` 由调用方注入（测试给假文件系统，真实对账读仓库）。
 */
function blockingGateInputs (debtGuardYml, readScript) {
  const lines = String(debtGuardYml || '').split(/\r?\n/)
  const blocks = []
  let cur = null
  for (const l of lines) {
    if (/^\s*-\s+/.test(l)) { if (cur) blocks.push(cur); cur = [l]; continue }
    if (cur) cur.push(l)
  }
  if (cur) blocks.push(cur)
  const scripts = []
  for (const b of blocks) {
    const text = b.join('\n')
    if (/continue-on-error:\s*true/.test(text)) continue
    for (const m of text.matchAll(/(?:^|[\s|])node\s+([.\w/-]+\.js)/g)) {
      const p = m[1].replace(/\\/g, '/')
      if (!scripts.includes(p)) scripts.push(p)
    }
  }
  const out = new Set(scripts)
  for (const s of scripts) {
    const body = String((readScript && readScript(s)) || '')
    const bm = body.match(/path\.join\(\s*__dirname\s*,\s*['"]([^'"]+\.json)['"]\s*\)/)
    if (!bm) continue
    out.add(s.replace(/[^/]*$/, '') + bm[1])
  }
  return Array.from(out).sort()
}

/**
 * 生产装配：`--live` 由 workflow 调用。外部依赖（git / gh / 判据 / env / log）**全部可注入**，
 * 默认值就是真实实现 —— 注入面存在的唯一理由是：门闩与预算必须是**行为可测**的
 * （外部复核 i3-W4：结构锁只证"被调用"，证不出"无旁路可绕过"）。
 * 逐条继续、末尾统一判定；单条失败不得中断整轮，也不得静默跳过。
 */
function live (deps = {}) {
  const env = deps.env || process.env
  const log = deps.log || ((m) => console.log(m))
  const repoDir = deps.repoDir || process.cwd()
  const git = deps.git || gitRunner(repoDir)
  const repo = env.MP_REPO || 'Colinchiu007/mulpub'
  const gh = deps.gh || ((args) => spawnSync('gh', args.concat(['--repo', repo]),
    { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }))
  const listed = gh(['pr', 'list', '--state', 'open', '--json', 'number,title'])
  if (listed.status !== 0) {
    log('[recheck] gh pr list 失败 ⇒ 工具侧故障，整轮按未证实处理：' + String(listed.stderr).slice(0, 200))
    return 1
  }
  let prs = []
  try { prs = JSON.parse(listed.stdout || '[]') } catch (e) {
    log('[recheck] gh 回显不可解析 ⇒ 未证实：' + e.message)
    return 1
  }
  const baseSha = (git(['rev-parse', 'origin/main']).stdout || '').trim()
  const entries = []
  for (const pr of prs) {
    const t0 = Date.now()
    const ref = `+refs/pull/${pr.number}/head:refs/recheck/pr-${pr.number}`
    const dir = path.join(os.tmpdir(), `debt-recheck-${pr.number}`)
    const f = git(['fetch', '-q', 'origin', ref])
    const head = f.rc === 0 ? (git(['rev-parse', `refs/recheck/pr-${pr.number}`]).stdout || '').trim() : ''
    let one
    if (head === '') {
      // 取不到 PR 头就**没有合并态可量** ⇒ 如实归 ref-missing。旧写法 `head || 'HEAD'` 会拿主干
      // 跟自己合并（一定成功），再把这份假读数当真判决报出去（前端轴 W-FE1）。
      one = { pr: pr.number, verdict: 'UNJUDGEABLE', reason: 'ref-missing' }
    } else {
      one = evaluatePr({
        pr,
        classify: deps.classify || (() => classifyMergeTree(git(['merge-tree', '--write-tree', baseSha, head]))),
        commitTree: deps.commitTree || ((treeOid) => {
          const r = git(['commit-tree', treeOid, '-p', baseSha, '-p', head, '-m', 'debt-baseline-recheck synthetic merge'])
          return { rc: r.rc, commitOid: (r.stdout || '').trim() }
        }),
        worktreeAdd: deps.worktreeAdd || ((commitOid) => {
          fs.rmSync(dir, { recursive: true, force: true })
          const r = git(['worktree', 'add', '--detach', '-q', dir, commitOid])
          return { rc: r.rc, dir }
        }),
        runChecker: deps.runChecker || ((d) => {
          const r = spawnSync(process.execPath, [path.join(d, 'scripts', 'check-debt-budget.js')],
            { cwd: d, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
          return { rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
        }),
      })
    }
    // 清理只属于真实检出这条路：注入 worktreeAdd 时那个目录根本没被创建，
    // 拿真 git 去 remove 一个不存在的目录会在测试里留下与判据无关的噪声。
    if (!deps.worktreeAdd) {
      git(['worktree', 'remove', '--force', dir])
      git(['update-ref', '-d', `refs/recheck/pr-${pr.number}`])
    }
    one.title = String(pr.title || '').slice(0, 60)
    entries.push(one)
    log(`[recheck] pr=${pr.number} verdict=${one.verdict}${one.reason ? '/' + one.reason : ''} fetch+merge+judge_ms=${Date.now() - t0}`)
  }
  const s = summarize(entries)
  log('[recheck] ' + s.line + ' base=' + baseSha.slice(0, 10))
  if (!s.shouldComment) {
    if (s.faultReasons.length) log('[recheck] 工具侧故障（' + s.faultReasons.join(',') + '）⇒ 不逐条刷评论，只报一次归因')
    return s.exitCode
  }
  // 门闩（deep-review i3：CI 侧耗时与评论速率**未测** ⇒ 首轮只测量，不得一次给最多 30 个 PR 写评论）。
  // 开启条件：本文件已回填一次真实运行的实测读数（fetch/merge/judge/comment 四段），由人改成 "1"。
  if (!shouldCommentOn(env)) {
    log('[recheck] MP_RECHECK_COMMENT!=1 ⇒ 只打印结论、不写评论（首轮未测 CI 耗时与评论速率，写入需人工开启）')
    log(s.line)
    for (const e of entries) if (e.verdict !== 'IN_BASELINE') log(`[recheck] would-comment pr=${e.pr} verdict=${e.verdict}${e.reason ? '/' + e.reason : ''}`)
    return s.exitCode
  }
  const defect = commentBudgetDefect(env)
  if (defect !== null) log('[recheck] ' + defect)
  const cap = commentBudget(env)
  let written = 0
  for (const e of entries) {
    if (e.verdict === 'IN_BASELINE') continue
    if (written >= cap) {
      log(`[recheck] 本轮写入已达上限 ${cap} ⇒ 其余条目只留痕不写（pr=${e.pr} 起）`)
      break
    }
    // 写前二次核查：清单是几分钟前拉的，这期间 PR 可能已被合并；对已合并的 PR 写评论是纯噪声。
    // 读不到状态一律按未证实处理 ⇒ **不写**（把工具的失明读成"它大概还 open"是本仓同型错误）。
    const st = gh(['pr', 'view', String(e.pr), '--json', 'state'])
    let state = ''
    try { state = String((JSON.parse(st.stdout || '{}').state) || '') } catch { state = '' }
    if (st.status !== 0 || state !== 'OPEN') {
      log(`[recheck] pr=${e.pr} 写前复查 state=${state || 'unreadable'} ⇒ 跳过（不往已合并或状态读不到的 PR 上写）`)
      continue
    }
    const body = renderComment({ entries: [e], baseSha, judgedAt: new Date().toISOString() })
    const found = gh(['api', `repos/${repo}/issues/${e.pr}/comments?per_page=100`])
    let existing = null
    try { existing = findMarkerComment(JSON.parse(found.stdout || '[]')) } catch { existing = null }
    // 两条端点形状不同源，必须分开写死：新增走 `issues/<n>/comments`，更新走
    // **`issues/comments/<id>`**。少一层 `issues/` 的 PATCH 是永远 404 的错端点，
    // 而它会被上面的拒写归因读成"这个 PR 不可写"——把拼错的 URL 伪装成平台侧竞争。
    const args = existing
      ? ['api', '-X', 'PATCH', `repos/${repo}/issues/comments/${existing.id}`, '-f', 'body=' + body]
      : ['api', `repos/${repo}/issues/${e.pr}/comments`, '-f', 'body=' + body]
    const w = gh(args)
    // 预算按**尝试**计，不按成功计：一次失败的写请求同样占掉这一轮的写入额度，
    // 且失败后重试会把"逐条继续"变成重试风暴（本刀刻意不重试）。
    written += 1
    const wOut = String(w.stderr || '') + String(w.stdout || '')
    if (w.status !== 0 && /404|410/.test(wOut)) {
      // 状态复查与写入之间必然存在时间窗（PR 在这两步之间被合并 ⇒ 平台侧拒写）。
      // 这是预期内的竞争，不是新的判据：只点名一次，不改判、不回头重读状态。
      log(`[recheck] pr=${e.pr} 写入被平台拒绝（404/410 ⇒ 该 PR 在复查之后已不可写）rc=${w.status}`)
      continue
    }
    log(`[recheck] pr=${e.pr} 评论${existing ? '更新' : '新增'} rc=${w.status}${w.status ? ' :: ' + String(w.stderr).slice(0, 120) : ''}`)
  }
  return s.exitCode
}

/** 严格 "1" 才开：`true`/`"01"`/空串都不算，避免"看着像开"的取值偷偷放行写入。 */
function shouldCommentOn (env = {}) {
  return env.MP_RECHECK_COMMENT === '1'
}

const DEFAULT_MAX_COMMENTS = 10

/**
 * 一轮最多写几条评论（外部复核 i3-W3：门闩开了也不得一次刷满全部在飞 PR）。
 * `0` 是**合法**上限（"只点名不写"），不得被 `||` 之类的假值回落吃掉；
 * 非法值回落默认，并由 `commentBudgetDefect` 单独出声。
 */
function commentBudget (env = {}) {
  const raw = env.MP_RECHECK_MAX_COMMENTS
  if (raw === undefined || raw === null) return DEFAULT_MAX_COMMENTS
  if (typeof raw !== 'string' || !/^-?\d+$/.test(raw.trim())) return DEFAULT_MAX_COMMENTS
  const n = Number(raw.trim())
  if (!Number.isInteger(n) || n < 0) return DEFAULT_MAX_COMMENTS
  return n
}

/** 与 `commentBudget` 同判据的"要不要告警"侧；**未设**不告警，显式设成空串要告警（那是设错了，不是没设）。 */
function commentBudgetDefect (env = {}) {
  const raw = env.MP_RECHECK_MAX_COMMENTS
  if (raw === undefined || raw === null) return null
  if (commentBudget(env) === DEFAULT_MAX_COMMENTS && String(raw).trim() !== String(DEFAULT_MAX_COMMENTS)) {
    return `MP_RECHECK_MAX_COMMENTS=${JSON.stringify(raw)} 不是非负整数 ⇒ 回落默认 ${DEFAULT_MAX_COMMENTS}`
  }
  return null
}

function main (argv) {
  if (argv.includes('--live')) return live()
  if (argv.includes('--print-plan')) {
    console.log('plan: 由 workflow 传入 open PR 清单后逐笔重算；本脚本不自行联网（测试面一律注入）')
    return 0
  }
  console.log('用法: node scripts/check-debt-recheck.js --live | --print-plan')
  return 2
}

module.exports = {
  VERDICTS,
  UNJUDGEABLE_REASONS,
  TOOL_FAULT_REASONS,
  MARKER,
  classifyMergeTree,
  evaluatePr,
  mergedTreeEvidence,
  blockingGateInputs,
  summarize,
  summarizeLine,
  renderComment,
  findMarkerComment,
  shouldCommentOn,
  commentBudget,
  commentBudgetDefect,
  live,
}

if (require.main === module) process.exitCode = main(process.argv.slice(2))
