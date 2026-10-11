'use strict'
/**
 * Gate 预算复测入口（配套 scripts/gate-budget.js；不进 CI —— 它要 gh + 网络，
 * 由人 / 由下一个会话在"看到贴脸预警"或"又红了一次"时跑）。
 *
 *   node scripts/gate-budget-probe.js          # 采集并打印，与 PROVENANCE 逐字段对照
 *   node scripts/gate-budget-probe.js --check  # 另外断言"当前预算仍站得住"，不成立即非零退出
 *
 * 三条口径（缺一条这份数据不可用）：
 *  ① 被预算杀的 run 是**截尾观测**：只证明「≥ 预算」，绝不进 max；
 *  ② 采集坐标（workflow / 事件 / per_page / 时刻）随输出打印 —— 服务端过滤参数会静默换掉样本集，
 *     单页取数会把 per_page 静默缩水；
 *  ③ probe_errors 必须为 0：聚合探针 `catch{continue}` 会把"取不到"洗成"没发生"。
 */
const cp = require('child_process')
const { execFileSync } = cp
const gate = require('./gate-budget.js')

const REPO = process.env.MP_GATE_PROBE_REPO || 'Colinchiu007/mulpub'
const WF = process.env.MP_GATE_PROBE_WORKFLOW || gate.PROVENANCE.workflowId
const PUSH_PER_PAGE = Number(process.env.MP_GATE_PROBE_PUSH_N || 40)
const PR_PER_PAGE = Number(process.env.MP_GATE_PROBE_PR_N || 60)
const BUDGET_MS_HINT = gate.GATE_TEST_BUDGET_MS

function gh (args) {
  return execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 26 })
}

function ghSafe (args, errs) {
  try { return gh(args) } catch (e) { errs.push(String(e.message || e).slice(0, 160)); return '' }
}

/** 步/作业时长 → 分钟。注意单位：ms / 60000（本仓曾把 /6000 的结果当成分钟，放大 10 倍）。 */
function minutes (startIso, endIso) {
  if (!startIso || !endIso || startIso === endIso) return null
  const v = (Date.parse(endIso) - Date.parse(startIso)) / 60000
  return Number.isFinite(v) && v >= 0 ? Math.round(v * 100) / 100 : null
}

function collectStepDurations (runIds, jobName, stepName, errs) {
  const out = []
  for (const id of runIds) {
    const tsv = ghSafe(['api', `repos/${REPO}/actions/runs/${id}/jobs`, '--jq',
      `.jobs[] | select(.name=="${jobName}") | .steps[] | select(.name=="${stepName}") | [.conclusion, .started_at, .completed_at] | @tsv`], errs).trim()
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

function main () {
  const check = process.argv.includes('--check')
  const errs = []
  const pushIds = runIdsFor('push', '&branch=main', PUSH_PER_PAGE, errs)
  const prIds = runIdsFor('pull_request', '', PR_PER_PAGE, errs)

  const g4push = collectStepDurations(pushIds, 'QG Unit Tests', 'Gate 4 - Workspace unit tests', errs)
  const g4pr = collectStepDurations(prIds, 'QG Unit Tests', 'Gate 4 - Workspace unit tests', errs)
  const shard = collectStepDurations(pushIds, 'QG Desktop Shards', 'Desktop tests shard 2/2', errs)
    .concat(collectStepDurations(pushIds, 'QG Desktop Shards', 'Desktop tests shard 1/2', errs))

  const ok = (list) => list.filter((r) => r.concl === 'success')
  const maxOf = (list) => (list.length ? Math.max(...list.map((r) => r.min)) : 0)
  // 截尾：非 success 且时长已达预算 —— 只当作"≥预算"计数
  const censored = (list) => list.filter((r) => r.concl !== 'success' && r.min * 60000 >= BUDGET_MS_HINT * 0.95)

  const fresh = {
    collectedAt: new Date().toISOString().replace(/\.\d+Z$/, 'Z'),
    workflowId: String(WF),
    events: `push(branch=main) n=${pushIds.length} / pull_request n=${prIds.length}`,
    gate4SuccessN: ok(g4push).length + ok(g4pr).length,
    gate4MaxSuccessMin: Math.max(maxOf(ok(g4push)), maxOf(ok(g4pr))),
    gate4CensoredN: censored(g4push).length + censored(g4pr).length,
    gate4CensoredNote: '被杀样本时长截尾，只证 ≥预算，不进 max',
    shardMaxSuccessMin: maxOf(ok(shard)),
    gate4OverheadMaxMin: 0, // 见下：单独算（job 起点 → Gate 4 起点）
    shardOverheadMaxMin: 0,
    multiplier: gate.SAFETY_MULTIPLIER,
    remeasureCmd: 'node scripts/gate-budget-probe.js --check',
  }

  // 前置开销：job started_at → Gate 4 step started_at
  const overheads = []
  for (const r of ok(g4push).slice(0, 8)) {
    const tsv = ghSafe(['api', `repos/${REPO}/actions/runs/${r.run}/jobs`, '--jq',
      '.jobs[] | select(.name=="QG Unit Tests") | [.started_at, (.steps[]|select(.name=="Gate 4 - Workspace unit tests")|.started_at)] | @tsv'], errs).trim()
    const [js, gs] = tsv.split('\t')
    const m = minutes(js, gs)
    if (m != null) overheads.push(m)
  }
  fresh.gate4OverheadMaxMin = overheads.length ? Math.max(...overheads) : 0
  fresh.shardOverheadMaxMin = fresh.gate4OverheadMaxMin // shard 侧含 install，下面用 job-step 差另算
  const shardOverheads = []
  for (const r of ok(shard).slice(0, 6)) {
    const tsv = ghSafe(['api', `repos/${REPO}/actions/runs/${r.run}/jobs`, '--jq',
      '.jobs[] | select(.name=="QG Desktop Shards") | [.started_at, (.steps[]|select(.name|test("Desktop tests shard"))|.started_at)] | @tsv'], errs).trim()
    for (const line of tsv.split(/\r?\n/).filter(Boolean)) {
      const [js, ss] = line.split('\t')
      const m = minutes(js, ss)
      if (m != null) shardOverheads.push(m)
    }
  }
  if (shardOverheads.length) fresh.shardOverheadMaxMin = Math.max(...shardOverheads)

  const sized = gate.checkSizing({ provenance: fresh })
  console.log(JSON.stringify(fresh, null, 2))
  console.log('COORDS workflow=' + WF + ' repo=' + REPO + ' push_n=' + pushIds.length + ' pr_n=' + prIds.length +
    ' budget_ms=' + BUDGET_MS_HINT)
  console.log('probe_errors=' + errs.length)
  if (errs.length) { console.log('PROBE_UNRELIABLE（有 ' + errs.length + ' 次取数失败，上面的数字不可用于定预算）: ' + errs[0]); process.exitCode = 3; return }
  const huggingCeiling = fresh.gate4MaxSuccessMin * 60000 >= BUDGET_MS_HINT * 0.8 || fresh.shardMaxSuccessMin * 60000 >= BUDGET_MS_HINT * 0.8
  console.log('贴脸预警(成功最大值已达预算 80%)=' + huggingCeiling)
  console.log('sizing_ok=' + sized.ok + (sized.ok ? '' : ' reasons=' + sized.reasons.join(' ; ')))
  if (check && !sized.ok) { console.log('BUDGET_NO_LONGER_SIZED（截尾 ' + fresh.gate4CensoredN + ' 次）—— 必须重新定数并更新 gate-budget.js'); process.exitCode = 1 }
  if (check && sized.ok && huggingCeiling) { console.log('BUDGET_STILL_SIZED 但贴脸：这是"要重测"的信号，不是"放宽判据"的信号'); process.exitCode = 2 }
}

main()
