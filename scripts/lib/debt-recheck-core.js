'use strict'
/**
 * 债务重算的**纯判决核**（切片 D 拆分，change: debt-recheck-zero-measurement-fail）。
 *
 * 这一层不碰文件系统、不碰 git、不碰网络：所有外部依赖由调用方注入，因此每条决策都能
 * 在单测里逐档验证。真 git 装配在同目录 debt-recheck-live.js，CLI 入口在 scripts/check-debt-recheck.js。
 * 拆文件的动因是实测的：加完归因与退出码判据后本体 503 行，撞上 max-lines 红线——
 * 既有裁决是「拆结构而非上调 targets」，于是按**依赖形态**切（纯决策 / 真装配 / CLI），
 * 而不是为了减行数硬塞注释。
 */

const VERDICTS = Object.freeze(['IN_BASELINE', 'VIOLATES', 'UNJUDGEABLE', 'CHECKER_FAILED'])
const REASON_CLASSES = Object.freeze(['tool-fault', 'other-pr'])

/**
 * 归类表是**唯一**真源：`UNJUDGEABLE_REASONS` 与 `TOOL_FAULT_REASONS` 都由它派生。
 * 动因（run 39563222046 实测）：原先两份名单各抄一遍，`worktree-setup` 在词表里却不在故障名单里，
 * 于是"整轮一条都没量"被报成 success。只把它补进名单是同一缺陷的下一版——第六档照样会漏。
 * 档位按「可被修复的单位」切：seam 未装配 / 合成提交失败 / 只读检出失败是三种不同的修法，
 * 共用一个名字会让读日志的人从结论倒推原因。`unknown-shape` 仍是刻意留的逃生口（git 换回显形状时
 * 报"工具没看懂"，而不是诬告 PR 有冲突）。
 */
const REASON_CLASS = assertReasonClass({
  conflict: 'other-pr', // 这笔 PR 与主干真有冲突 ⇒ GitHub 侧本就不可合并，不是本工具的故障
  'unrelated-histories': 'tool-fault',
  'ref-missing': 'tool-fault',
  'worktree-setup': 'tool-fault',
  'merge-commit-failed': 'tool-fault',
  'merge-worktree-failed': 'tool-fault',
  'unknown-shape': 'tool-fault',
})
const UNJUDGEABLE_REASONS = Object.freeze(Object.keys(REASON_CLASS))
const TOOL_FAULT_REASONS = Object.freeze(UNJUDGEABLE_REASONS.filter((r) => REASON_CLASS[r] === 'tool-fault'))

/** 值写错（空串/第三种值）必须**加载即抛**：那种档既不算故障也不算他人冲突，会被静默退 0。 */
function assertReasonClass (table) {
  const keys = Object.keys(table || {})
  if (!keys.length) throw new Error('REASON_CLASS 为空 ⇒ 词表退化成零档，"什么都量不到"将无从归类')
  for (const k of keys) {
    if (!REASON_CLASSES.includes(table[k])) {
      throw new Error(`REASON_CLASS['${k}']=${JSON.stringify(table[k])} 不是 ${REASON_CLASSES.join('|')} ⇒ 该档归类不明`)
    }
  }
  return table
}

/** 词表外的 reason（未来的第五种形态）按工具故障处理（fail closed），不得默认放行。 */
function reasonFault (reason) {
  return REASON_CLASS[reason] !== 'other-pr'
}

/** 失败命令的首行 stderr 就是结论（git 一律 `fatal: …` 开头），全文不进评论。 */
function excerptOf (r) {
  const s = String((r && (r.stderr || r.stdout)) || '')
  const first = s.split('\n').map((l) => l.trim()).filter(Boolean)[0] || ''
  return first.slice(0, 200)
}

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
 * 两个真 git 阶段各有自己的档名与 stage：`merge-commit-failed` / `merge-worktree-failed`，
 * 并把该命令的 stderr 首行放进 `detail`（修法不同 ⇒ 档名必须不同）。
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
    const missing = ['commitTree', 'worktreeAdd', 'runChecker'].filter((n) => typeof deps[n] !== 'function')
    return { pr: pr.number, verdict: 'UNJUDGEABLE', reason: 'worktree-setup', stage: 'seam', detail: '未注入 ' + missing.join(',') }
  }
  const ct = commitTree(merged.treeOid) || {}
  if (ct.rc !== 0 || !ct.commitOid) {
    return { pr: pr.number, verdict: 'UNJUDGEABLE', reason: 'merge-commit-failed', stage: 'commit-tree', detail: excerptOf(ct) || '回显不是合法 commit oid' }
  }
  const wa = worktreeAdd(ct.commitOid) || {}
  if (wa.rc !== 0 || !wa.dir) {
    return { pr: pr.number, verdict: 'UNJUDGEABLE', reason: 'merge-worktree-failed', stage: 'worktree-add', detail: excerptOf(wa) || '检出没有返回目录' }
  }
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
  const list = entries || []
  const faultReasons = list
    .filter((e) => e.verdict === 'UNJUDGEABLE' && reasonFault(e.reason))
    .map((e) => e.reason)
  const toolFault = faultReasons.length > 0
  const measured = c.IN_BASELINE + c.VIOLATES
  const allConflict = c.total > 0 && list.every((e) => e.verdict === 'UNJUDGEABLE' && e.reason === 'conflict')
  // 第二网不看名单是否完备，只看计数：整轮一条都没量到、又不是"每个人都在跟主干冲突"，
  // 就是失明。它专门接住全 CHECKER_FAILED 这种 verdict 面（故障名单按 UNJUDGEABLE 筛，够不着）。
  const zeroMeasurement = c.total > 0 && measured === 0 && !allConflict
  return {
    counts: c,
    measured,
    allConflict,
    line: summarizeLine(entries),
    // 量到了就退 0（哪怕全部违规）；工具失明必须非 0，且不得伪装成对别人 PR 的判决
    exitCode: toolFault || zeroMeasurement ? 1 : 0,
    shouldComment: !(toolFault || zeroMeasurement) && c.total > 0,
    faultReasons: [...new Set(faultReasons)],
  }
}

/**
 * "这一轮到底量到了没有"必须与"结论好不好"分开出声。三种零测量形态互不相同形：
 * rows=0（无事可做）/ 全 conflict（他人原因，仍退 0）/ 工具故障（本工具原因，退 1）。
 */
function measurementLine (entries) {
  const c = counts(entries)
  const measured = c.IN_BASELINE + c.VIOLATES
  if (measured > 0) return `MEASURED=${measured}`
  if (c.total === 0) return 'MEASURED=0(rows=0)'
  const list = entries || []
  if (list.every((e) => e.verdict === 'UNJUDGEABLE' && e.reason === 'conflict')) return 'MEASURED=0(all-conflict)'
  const faults = [...new Set(list.filter((e) => e.verdict === 'UNJUDGEABLE' && reasonFault(e.reason)).map((e) => e.reason))].sort()
  return `MEASURED=0(tool-fault:${faults.join(',') || 'unclassified'})`
}

function renderComment ({ entries = [], baseSha = '', judgedAt = '' } = {}) {
  const head = `${MARKER} base=${baseSha} judged=${judgedAt} -->`
  const rows = entries.map((e) => {
    const extra = e.verdict === 'UNJUDGEABLE'
      ? [String(e.reason || ''), String(e.detail || '')].filter(Boolean).join(' :: ')
      : String(e.detail || '')
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
    '出现其它 reason（`merge-commit-failed` / `merge-worktree-failed` / `worktree-setup` / `ref-missing` / …）',
    '是**本作业自己没量到**，与你的 PR 无关；那种轮次已由作业非零退出点名，不必你来修。',
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


module.exports = {
  VERDICTS,
  REASON_CLASSES,
  REASON_CLASS,
  UNJUDGEABLE_REASONS,
  TOOL_FAULT_REASONS,
  assertReasonClass,
  reasonFault,
  excerptOf,
  MARKER,
  isOid,
  classifyMergeTree,
  evaluatePr,
  counts,
  summarize,
  summarizeLine,
  measurementLine,
  renderComment,
  findMarkerComment,
  blockingGateInputs,
}
