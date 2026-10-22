'use strict'
/**
 * 债务重算的**生产装配面**：真 git、真 gh、真 worktree，以及门闩与写入预算。
 * 判决一律来自 ./debt-recheck-core.js，本文件只决定"什么时候、在哪个树上调它"和"量不到怎么说"。
 * 单测通过 deps 注入替身；**默认值就是真实实现**，且有一条锁（测试 §27-28）在不注入时真跑，
 * 否则默认闭包里的笔误（路径、参数、stderr 透传）在测试面结构性不可见。
 */

const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawnSync } = require('node:child_process')
const {
  classifyMergeTree, evaluatePr, summarize, measurementLine, renderComment, findMarkerComment, excerptOf, isOid,
} = require('./debt-recheck-core.js')

// ── 真 git 装配（生产与集成用例共用同一实现，不另写一份） ──────────────────────────
/**
 * 宿主环境里的 GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE **压过** `git -C <repo>`：
 * 带着它们时，整轮重算读的是别人的仓库，而产物长得完全一样（设计评审 i5）。
 * 剔除之外必须出声——静默剔除会让"这台机器的环境一直有问题"永远不被知道（同 ELECTRON_RUN_AS_NODE 那条口径）。
 */
const GIT_ENV_KEYS = Object.freeze(['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE'])

function gitSafeEnv (env) {
  const src = env || process.env
  const out = {}
  const stripped = []
  for (const k of Object.keys(src)) {
    if (GIT_ENV_KEYS.includes(k)) { stripped.push(k); continue }
    out[k] = src[k]
  }
  return { env: out, stripped }
}

function envDefectNotice (stripped, log) {
  if (!stripped || !stripped.length) return
  log('[recheck] 宿主环境带着 ' + stripped.join(',') + ' ⇒ 已从子进程 env 剔除；'
    + '留着它 git 会操作**另一个仓库**，那一轮的每条读数都是假的')
}

function gitRunner (repo, notice) {
  const say = notice || ((m) => console.warn(m))
  let warned = false
  return function git (args) {
    // env 按**每次调用**取，不在建 runner 时快照：宿主可能在工具跑起来之后才带上 GIT_DIR
    // （钩子与并发会话就是这么把仓换掉的），快照式剔除会漏掉那一格。告警只出一次，避免刷噪声。
    const child = gitSafeEnv()
    if (child.stripped.length && !warned) { warned = true; envDefectNotice(child.stripped, say) }
    const r = spawnSync('git', ['-C', repo].concat(args), { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: child.env })
    return { rc: r.status, stdout: r.stdout || '', stderr: r.stderr || '' }
  }
}

/**
 * 合成提交必须自带身份：`git commit-tree` 在没有 committer 身份时**直接 rc=128 / `Author identity unknown`**
 * （本机三格探针实测：仓库不配身份 + GIT_CONFIG_GLOBAL/SYSTEM 指空文件 ⇒ rc=128；同一 env 加 `-c` ⇒ rc=0）。
 * 这是一条**未声明的环境依赖**——它在配置了身份的机器上永远不会显形（本机就配置了），而 runner 上不配。
 * 用 `-c` 只在本次调用生效，不写任何配置，也不改别人的仓库。
 */
const SYNTHETIC_IDENTITY = Object.freeze(['-c', 'user.name=debt-baseline-recheck', '-c', 'user.email=debt-baseline-recheck@invalid'])

/**
 * 在合并态里读一次基线归属（D2 的行为证明；集成用例走这条）。
 * 用完必删 worktree —— 它在临时仓库之外仍会往 `.git/worktrees` 留注册。
 * ⚠ 它**从不跑判据**，所以返回的是 `built`（合并态造不造得出来），不是判决（前端轴 W-FE2：
 * 旧名带 evaluate、返回值带 verdict:'IN_BASELINE'，两者合起来会让下一个维护者把它当判决入口）。
 */
function mergedTreeEvidence ({ repo, baseSha, headSha, inspect, git }) {
  const run = git || gitRunner(repo)
  const mt = run(['merge-tree', '--write-tree', baseSha, headSha])
  const cls = classifyMergeTree(mt)
  if (!cls.ok) return { built: false, reason: cls.reason }
  const ct = run(SYNTHETIC_IDENTITY.concat(['commit-tree', cls.treeOid, '-p', baseSha, '-p', headSha, '-m', 'debt-baseline-recheck synthetic merge']))
  if (ct.rc !== 0) return { built: false, stage: 'commit-tree', reason: 'merge-commit-failed', detail: excerptOf(ct) }
  const commitOid = String(ct.stdout || '').trim()
  if (!isOid(commitOid)) return { built: false, stage: 'commit-tree', reason: 'merge-commit-failed', detail: '回显不是 40 位 oid' }
  const dir = path.join(os.tmpdir(), `debt-recheck-wt-${process.pid}-${Date.now()}`)
  const add = run(['worktree', 'add', '--detach', '-q', dir, commitOid])
  if (add.rc !== 0) return { built: false, stage: 'worktree-add', reason: 'merge-worktree-failed', detail: excerptOf(add) }
  try {
    const merged = { baseline: inspect(dir), aTxt: fs.existsSync(path.join(dir, 'a.txt')) ? fs.readFileSync(path.join(dir, 'a.txt'), 'utf8').trim() : null }
    return Object.assign({ built: true, dir }, merged)
  } finally {
    run(['worktree', 'remove', '--force', dir])
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
  const git = deps.git || gitRunner(repoDir, log)
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
          const r = git(SYNTHETIC_IDENTITY.concat(['commit-tree', treeOid, '-p', baseSha, '-p', head, '-m', 'debt-baseline-recheck synthetic merge']))
          // stderr 必须透传：默认闭包不往上带 stderr，`excerptOf` 就只能回空串，"现场已可归因"
          // 这句话在**唯一会被生产执行的那条路**上落空（切片 C 的缺陷③正是这么留下的）。
          return { rc: r.rc, commitOid: (r.stdout || '').trim(), stderr: r.stderr || '' }
        }),
        worktreeAdd: deps.worktreeAdd || ((commitOid) => {
          fs.rmSync(dir, { recursive: true, force: true })
          const r = git(['worktree', 'add', '--detach', '-q', dir, commitOid])
          return { rc: r.rc, dir, stderr: r.stderr || '' }
        }),
        runChecker: deps.runChecker || ((d) => {
          // 判据本体自己也跑 git（它按 `git ls-files` 取域），所以同一份 env 卫生必须传下去，
          // 否则"测量在合并态里"这句前提会被一个泄漏的 GIT_DIR 静默换掉测量对象。
          const r = spawnSync(process.execPath, [path.join(d, 'scripts', 'check-debt-budget.js')],
            { cwd: d, encoding: 'utf8', maxBuffer: 32 * 1024 * 1024, env: gitSafeEnv().env })
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
    log(`[recheck] pr=${pr.number} verdict=${one.verdict}${one.reason ? '/' + one.reason : ''}`
      + (one.detail ? ` :: ${String(one.detail).slice(0, 120)}` : '')
      + ` fetch+merge+judge_ms=${Date.now() - t0}`)
  }
  const s = summarize(entries)
  log('[recheck] ' + s.line + ' ' + measurementLine(entries) + ' base=' + baseSha.slice(0, 10))
  if (!s.shouldComment) {
    if (s.faultReasons.length) log('[recheck] 工具侧故障（' + s.faultReasons.join(',') + '）⇒ 不逐条刷评论，只报一次归因')
    log('[recheck] ' + measurementLine(entries) + ' ⇒ 本轮不写评论')
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

module.exports = {
  GIT_ENV_KEYS, gitSafeEnv, envDefectNotice,
  gitRunner, mergedTreeEvidence, shouldCommentOn, DEFAULT_MAX_COMMENTS, commentBudget, commentBudgetDefect, live,
}
