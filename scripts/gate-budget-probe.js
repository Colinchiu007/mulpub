'use strict'
/**
 * Gate 预算复测入口（配套 scripts/gate-budget.js；不进 CI —— 它要 gh + 网络，
 * 由人 / 由下一个会话在"看到 CI 里的带内贴脸告警"或"又红了一次"时跑）。
 *
 *   node scripts/gate-budget-probe.js          # 采集并打印，与 PROVENANCE 逐字段对照
 *   node scripts/gate-budget-probe.js --check  # 另外断言"当前预算仍站得住"，不成立即非零退出
 *
 * 四条口径（缺一条这份数据不可用）：
 *  ① 被预算杀的 run 是**截尾观测**：只证明「≥ 当时的生效预算」，绝不进 max；
 *  ② 截尾阈值绑 `priorBudgetMin`（采样窗口内实际生效的预算），**不绑当前值** ——
 *     抬价后再用新价做阈值，会把历史上那批真截尾样本全部漏掉，进而把"一切正常"误判成
 *     "判据缺失"（QM-6 双轴独立命中同一处）；
 *  ③ 采集坐标（workflow / 事件 / per_page / 时刻）随输出打印 —— 服务端过滤参数会静默换掉样本集，
 *     单页取数会把 per_page 静默缩水；
 *  ④ probe_errors 必须为 0：聚合探针 `catch{continue}` 会把"取不到"洗成"没发生"。
 *
 * 第五条（2026-10-12，#3357 合并后实测逼出来的）：**样本必须按形态分档**。
 * 同一个 `Desktop tests shard` 步骤在一天之内换了代（预算 30→45；分片从"两腿各跑全量"
 * 变成真半量），混池算出的 max 会让 `RULE_VIOLATED` 拿旧形态的时长去给新形态定墙 ——
 * 那次它就是这么误报的（31.55 分属"全量 + 45 分预算"的形态）。分档判据不靠日期猜：
 * 每个 run 的形态 = **它自己那个 head 提交里的 workflow 正文与 gate-budget 正文**（git blob 可读，
 * 与 CI 当时用的内容同一份），解析复用 check-desktop-shard-forwarding.js 的 parseShardArgv。
 * 当前形态同形态样本不足时只说"判不了"（退 4），不说"要重定数"（退 1）。
 *
 *   退出码：0 站得住 · 1 规则不再满足（要重定数）· 2 贴脸（该重测）· 3 探针自身取数失败 · 4 当前形态样本不足
 */
const cp = require('child_process')
const path = require('path')
const { execFileSync } = cp
const gate = require('./gate-budget.js')
const ROOT_DIR = path.resolve(__dirname, '..')

const REPO = process.env.MP_GATE_PROBE_REPO || 'Colinchiu007/mulpub'
const WF = process.env.MP_GATE_PROBE_WORKFLOW || gate.PROVENANCE.workflowId
const PUSH_PER_PAGE = Number(process.env.MP_GATE_PROBE_PUSH_N || 40)
const PR_PER_PAGE = Number(process.env.MP_GATE_PROBE_PR_N || 60)
// 前置开销只需少量样本即可定出上界（实测 8 个成功 run 已覆盖 1.0–1.3 的跨度）；
// shard 侧多一步 install，取 6 个是为了看它的**离散度**而不是均值。这两个数不是随便取的。
const OVERHEAD_SAMPLE_GATE4 = 8
const OVERHEAD_SAMPLE_SHARD = 6

function gh (args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 })
}
function ghSafe (args, errs) {
  try { return gh(args) } catch (e) { errs.push(String(e.message || e).slice(0, 160)); return '' }
}
/** 步/作业时长 → 分钟。单位必须是 ms/60000（本仓曾把 /6000 的结果当成分钟，放大 10 倍）。 */
function minutes (startIso, endIso) {
  if (!startIso || !endIso || startIso === endIso) return null
  const v = (Date.parse(endIso) - Date.parse(startIso)) / 60000
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
}
function collectStepDurations (runIds, jobName, stepName, errs) {
  const out = []
  for (const id of runIds) {
    const tsv = ghSafe(['api', `repos/${REPO}/actions/runs/${id}/jobs`, '--jq',
      `.jobs[] | select(.name|test("${jobName}")) | .steps[] | select(.name=="${stepName}") | [.conclusion, .started_at, .completed_at] | @tsv`], errs).trim()
    if (!tsv) continue
    for (const line of tsv.split(/\r?\n/).filter(Boolean)) {
      const [concl, s, e] = line.split('\t')
      const min = minutes(s, e)
      if (min != null) out.push({ run: id, concl, min })
    }
  }
  return out
}
function runIdsFor (event, extra, perPage, errs) {
  const raw = ghSafe(['api', `repos/${REPO}/actions/workflows/${WF}/runs?event=${event}${extra}&per_page=${perPage}`,
    '--jq', '.workflow_runs[] | [.id, .head_sha] | @tsv'], errs).trim()
  return raw.split(/\r?\n/).filter(Boolean).map((line) => {
    const [id, sha] = line.split('\t')
    return { id, sha }
  })
}

const WF_PATH = '.github/workflows/quality-gate.yml'
const GATE_BUDGET_PATH = 'scripts/gate-budget.js'
/** 取某个提交里的文件正文；不存在返回 null（旧提交没有 gate-budget.js 属正常，不是探针故障）。 */
function blobOf (sha, rel) {
  try {
    return execFileSync('git', ['show', `${sha}:${rel}`], { encoding: 'utf8', maxBuffer: 1 << 26 })
  } catch (e) {
    return null
  }
}
/**
 * 一个 run 的形态 = 它自己 head 提交里的 (预算, 分片是否真分文件)。
 * 预算优先读 gate-budget.js；更早的提交没有这个文件，退到 workflow 里当时的字面量
 * `WaitForExit(1800000)`（单位 ms）。两条都取不到即 unknown。
 * ⚠ unknown 不是探针故障：PR run 的 head 提交在 squash 合并 + 删分支后本地往往取不到（refs/pull/* 不默认 fetch），
 *   这是**结构性**的。所以它记进 unknowns（可见、单独计数、一律不进当前形态池），不记进 errs ——
 *   否则探针永远退 3，等于把这条新判据自己关掉（"防误报"改成"永久不可用"是另一种假绿）。
 */
function formOfRun (sha, cache, unknowns) {
  if (!sha) { unknowns.push({ sha: '(missing)', why: 'FORM_NO_SHA：某个 run 没带 head_sha' }); return null }
  if (cache.has(sha)) return cache.get(sha)
  const wf = blobOf(sha, WF_PATH)
  if (wf === null) {
    unknowns.push({ sha, why: 'FORM_BLOB_MISSING：本地没有该提交（PR head 分支已删？先 git fetch）' })
    cache.set(sha, null)
    return null
  }
  const gb = blobOf(sha, GATE_BUDGET_PATH)
  let budgetMin = gb === null ? null : gate.budgetMinFromGateBudgetText(gb)
  if (budgetMin == null) budgetMin = gate.waitExitBudgetMin(wf)
  const shardForm = gate.shardFormOf(wf)
  const f = budgetMin == null || shardForm === 'unknown'
    ? null
    : { key: `budget=${budgetMin}min|shard=${shardForm}`, budgetMin, shardForm }
  if (!f) unknowns.push({ sha, why: `FORM_UNRESOLVED：budget=${budgetMin} shard=${shardForm}` })
  cache.set(sha, f)
  return f
}

const okRun = (r) => r.concl === 'success'
const maxOf = (list) => (list.length ? Math.max(...list.map((r) => r.min)) : 0)
/**
 * 截尾判据：非成功 + 时长贴着**指定档**的预算（≥98%）。
 * 阈值由调用方传入（prior / current），绝不用单一"当前预算"档 —— 见文件头口径②。
 * 另记 failedEarly：非成功但明显没到墙，那是真失败，不得混进截尾计数。
 */
const censoredUnder = (list, budgetMin) =>
  list.filter((r) => !okRun(r) && r.min >= budgetMin * 0.98)

function main () {
  const check = process.argv.includes('--check')
  const errs = []
  const pushRuns = runIdsFor('push', '&branch=main', PUSH_PER_PAGE, errs)
  const prRuns = runIdsFor('pull_request', '', PR_PER_PAGE, errs)
  const pushIds = pushRuns.map((r) => r.id)
  const prIds = prRuns.map((r) => r.id)
  const shaById = new Map([].concat(pushRuns, prRuns).map((r) => [String(r.id), r.sha]))
  const formCache = new Map()

  const g4 = collectStepDurations(pushIds, 'QG Unit Tests', 'Gate 4 - Workspace unit tests', errs)
    .concat(collectStepDurations(prIds, 'QG Unit Tests', 'Gate 4 - Workspace unit tests', errs))
  const shard = collectStepDurations(pushIds, 'QG Desktop Shards', 'Desktop tests shard 2/2', errs)
    .concat(collectStepDurations(pushIds, 'QG Desktop Shards', 'Desktop tests shard 1/2', errs))
  // 归池标签：形态分档要把两处的样本分开统计（同一 run 里它们是不同作业、不同预算语义）
  g4.forEach((s) => { s.pool = 'g4' })
  shard.forEach((s) => { s.pool = 'shard' })

  // 零行即探针故障：选择器打不到（matrix job 名带 " (2/2)" 后缀就是这次的现场）会静默返回空集，
  // 于是 shardMax 记成 0、checkSizing 照样 ok —— 那是"测了个空"被读成"没发生"。
  const assertNonEmpty = (list, what) => {
    if (!list.length) throw new Error('PROBE_EMPTY_SET: ' + what + ' 没命中任何步骤，本次采集不可用于定预算')
  }

  const priorBudgetMin = Number(gate.PROVENANCE.priorBudgetMin) || 30
  const currentBudgetMin = gate.GATE_TEST_BUDGET_MS / 60000

  // 先算 Gate 4 的前置，再算 shard 的（顺序即依赖：shard 的样本集来自同一批 run，别互相覆盖）
  const overheadOf = (runIds, jobName, stepNeedle, cap) => {
    const vals = []
    for (const id of runIds.slice(0, cap)) {
      const tsv = ghSafe(['api', `repos/${REPO}/actions/runs/${id}/jobs`, '--jq',
        `.jobs[] | select(.name|test("${jobName}")) | [.started_at, (.steps[]|select(.name|test("${stepNeedle}"))|.started_at)] | @tsv`], errs).trim()
      for (const line of tsv.split(/\r?\n/).filter(Boolean)) {
        const m = minutes(...line.split('\t'))
        if (m != null) vals.push(m)
      }
    }
    return vals.length ? Math.max(...vals) : 0
  }
  const gate4Overhead = overheadOf(pushIds, 'QG Unit Tests', 'Gate 4 - Workspace unit tests', OVERHEAD_SAMPLE_GATE4)
  const shardOverhead = overheadOf(pushIds, 'QG Desktop Shards', 'Desktop tests shard', OVERHEAD_SAMPLE_SHARD)
  assertNonEmpty(g4.filter(okRun), 'Gate 4 成功样本')
  assertNonEmpty(shard, 'shard 步骤（含 matrix 后缀）')
  if (!shardOverhead) throw new Error('PROBE_EMPTY_SET: shard 前置开销取不到（选择器没命中）')

  // ── 形态分档（口径⑤）：先定"当前形态"，再把样本按各自 run 的形态归池 ──
  const headSha = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: ROOT_DIR, encoding: 'utf8' }).trim()
  const unknowns = []
  const currentForm = formOfRun(headSha, formCache, unknowns)
  if (!currentForm) throw new Error('CURRENT_FORM_UNKNOWN：HEAD 的 workflow / gate-budget 解析不出形态 —— 判据失明，不得沿用任何旧数')
  const formOfSample = (s) => formOfRun(shaById.get(String(s.run)), formCache, unknowns)
  const byForm = new Map()
  let unknownSamples = 0
  for (const s of g4.concat(shard)) {
    const f = formOfSample(s)
    if (!f) { unknownSamples++; continue }
    if (!byForm.has(f.key)) byForm.set(f.key, { g4: [], shard: [] })
    byForm.get(f.key)[s.pool].push(s)
  }
  if (!byForm.has(currentForm.key)) byForm.set(currentForm.key, { g4: [], shard: [] })
  const bucket = byForm.get(currentForm.key)
  const curG4 = bucket.g4.filter(okRun)
  const curShard = bucket.shard.filter(okRun)
  const form = {
    key: currentForm.key,
    gate4SuccessN: curG4.length,
    shardSuccessN: curShard.length,
    gate4MaxSuccessMin: maxOf(curG4),
    shardMaxSuccessMin: maxOf(curShard),
    // 贴脸时要求的"被杀样本"证据也必须同形态：拿混池旧档的 9 条去给当前形态的贴脸作证，
    // 等于用别的代码形态的墙来证明这堵墙还够高。
    censoredUnderPriorBudgetN: censoredUnder(bucket.g4, priorBudgetMin).length + censoredUnder(bucket.shard, priorBudgetMin).length,
  }

  const fresh = {
    collectedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    workflowId: String(WF),
    events: `push(branch=main) n=${pushIds.length} / pull_request n=${prIds.length}`,
    priorBudgetMin,
    currentBudgetMin,
    gate4SuccessN: g4.filter(okRun).length,
    gate4MaxSuccessMin: maxOf(g4.filter(okRun)),
    censoredUnderPriorBudgetN: censoredUnder(g4, priorBudgetMin).length + censoredUnder(shard, priorBudgetMin).length,
    censoredUnderCurrentBudgetN: censoredUnder(g4, currentBudgetMin).length + censoredUnder(shard, currentBudgetMin).length,
    gate4CensoredNote: '被杀样本时长截尾，只证 ≥priorBudgetMin，不进 max；抬价后 current 档为 0 属预期',
    shardMaxSuccessMin: maxOf(shard.filter(okRun)),
    gate4OverheadMaxMin: gate4Overhead,
    shardOverheadMaxMin: shardOverhead,
    multiplier: gate.SAFETY_MULTIPLIER,
    remeasureCmd: 'node scripts/gate-budget-probe.js --check',
  }

  const sized = gate.checkSizing({ provenance: fresh, form })
  console.log(JSON.stringify(fresh, null, 2))
  console.log('COORDS workflow=' + WF + ' repo=' + REPO + ' push_n=' + pushIds.length + ' pr_n=' + prIds.length +
    ` prior=${priorBudgetMin}min current=${currentBudgetMin}min overhead_sample=${OVERHEAD_SAMPLE_GATE4}/${OVERHEAD_SAMPLE_SHARD}`)
  // 形态分档现场：每一代形态各有多少样本、max 多少 —— 混池的旧口径就是被这张表揭穿的
  for (const [key, b] of [...byForm.entries()].sort()) {
    const cur = key === currentForm.key ? ' ←当前' : ''
    console.log(`FORM ${key}: g4_ok=${b.g4.filter(okRun).length}/${b.g4.length} max=${maxOf(b.g4.filter(okRun))}` +
      ` shard_ok=${b.shard.filter(okRun).length}/${b.shard.length} max=${maxOf(b.shard.filter(okRun))}${cur}`)
  }
  console.log('form_current=' + currentForm.key + ' form_gate4=' + form.gate4SuccessN + ' form_shard=' + form.shardSuccessN +
    '（下限各 ' + gate.MIN_SAMPLE_CURRENT_FORM + '，两池分母不同不得加总）' +
    ' form_max=' + Math.max(form.gate4MaxSuccessMin, form.shardMaxSuccessMin) +
    ' form_censored=' + form.censoredUnderPriorBudgetN + ' form_unknown_n=' + unknownSamples +
    (unknowns.length ? ' unknown_why[1]=' + unknowns[0].why + ' (sha ' + String(unknowns[0].sha).slice(0, 8) + ')' : ''))
  console.log('probe_errors=' + errs.length)
  // 出口码由 gate-budget.js 的**表**决定（取数失败 > 告警 > 稀缺 > 贴脸 > 干净），
  // 不在这里用 if 的书写顺序表达优先级 —— 换序就会把"已观测到贴脸时长"读成"还没量够、别动"。
  const code = gate.exitCodeFor(sized, errs.length)
  if (code === 3) { console.log('PROBE_UNRELIABLE（有 ' + errs.length + ' 次取数失败，上面的数字不可用于定预算）: ' + errs[0]); process.exitCode = 3; return }
  console.log('hugging=' + sized.hugging + ' max=' + sized.maxObs + ' budget=' + sized.budgetMin)
  console.log('sizing_ok=' + sized.ok + (sized.ok ? '' : ' reasons=' + sized.reasons.join(' ; ')))
  console.log('alarms=' + sized.alarms.length + ' scarcity=' + sized.scarcity.length + ' exit_code=' + code)
  if (check) {
    // 横幅复用判据码本身：日志里搜 INSUFFICIENT_CURRENT_FORM 必须同时命中判据与出口说明，
    // 两个名字（上一版这里写的是 INSUFFICIENT_SAMPLES_FOR_FORM）会让排障者搜不到对方。
    if (code === 1) console.log('EXIT=1 BUDGET_NO_LONGER_SIZED —— 重新采集后更新 scripts/gate-budget.js（不得改判据消化它）')
    else if (code === 4) console.log('EXIT=4 INSUFFICIENT_CURRENT_FORM —— 当前形态样本不够：既不抬也不降，等样本攒够再采（不得改判据/改倍数让它不红）')
    else if (code === 2) console.log('EXIT=2 SIZED_BUT_HUGGING：贴脸是要重测的信号，不是放宽判据的信号')
    else console.log('EXIT=0 SIZED_OK')
    process.exitCode = code
  }
}

main()
