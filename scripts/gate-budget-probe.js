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
 */
const cp = require('child_process')
const { execFileSync } = cp
const gate = require('./gate-budget.js')

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
    '--jq', '.workflow_runs[].id'], errs).trim()
  return raw.split(/\r?\n/).filter(Boolean)
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
  const pushIds = runIdsFor('push', '&branch=main', PUSH_PER_PAGE, errs)
  const prIds = runIdsFor('pull_request', '', PR_PER_PAGE, errs)

  const g4 = collectStepDurations(pushIds, 'QG Unit Tests', 'Gate 4 - Workspace unit tests', errs)
    .concat(collectStepDurations(prIds, 'QG Unit Tests', 'Gate 4 - Workspace unit tests', errs))
  const shard = collectStepDurations(pushIds, 'QG Desktop Shards', 'Desktop tests shard 2/2', errs)
    .concat(collectStepDurations(pushIds, 'QG Desktop Shards', 'Desktop tests shard 1/2', errs))

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

  const sized = gate.checkSizing({ provenance: fresh })
  console.log(JSON.stringify(fresh, null, 2))
  console.log('COORDS workflow=' + WF + ' repo=' + REPO + ' push_n=' + pushIds.length + ' pr_n=' + prIds.length +
    ` prior=${priorBudgetMin}min current=${currentBudgetMin}min overhead_sample=${OVERHEAD_SAMPLE_GATE4}/${OVERHEAD_SAMPLE_SHARD}`)
  console.log('probe_errors=' + errs.length)
  if (errs.length) { console.log('PROBE_UNRELIABLE（有 ' + errs.length + ' 次取数失败，上面的数字不可用于定预算）: ' + errs[0]); process.exitCode = 3; return }
  console.log('hugging=' + sized.hugging + ' max=' + sized.maxObs + ' budget=' + sized.budgetMin)
  console.log('sizing_ok=' + sized.ok + (sized.ok ? '' : ' reasons=' + sized.reasons.join(' ; ')))
  if (check) {
    if (!sized.ok) { console.log('BUDGET_NO_LONGER_SIZED —— 重新采集后更新 scripts/gate-budget.js（不得改判据消化它）'); process.exitCode = 1 }
    else if (sized.hugging) { console.log('SIZED_BUT_HUGGING：贴脸是要重测的信号，不是放宽判据的信号'); process.exitCode = 2 }
  }
}

main()
