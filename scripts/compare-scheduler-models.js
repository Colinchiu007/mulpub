#!/usr/bin/env node
// @ts-check
/**
 * compare-scheduler-models.js — 运营后台 Python 模拟器 vs 桌面端真实 governor 对拍（P2）
 *
 * 固定输入分别跑：python scheduler_simulator.simulate 与桌面端 rate-limit-self-check.runSelfCheck，
 * 比较 max_concurrent_observed / rate_limited_count / quota_exceeded_count / total_duration_ms（容差）。
 * 防止两套调度模型契约漂移（spec: desktop/model-call-observability「模拟器与真实 governor 对拍」）。
 *
 * 用法：node scripts/compare-scheduler-models.js
 * 退出码：0 = 核心用例全部一致；1 = 存在不一致。
 * 已知差异（KNOWN_DIFF_CASES）只记录输出，不影响退出码；详见 runKnownDiffs。
 */
'use strict'

const { spawnSync } = require('child_process')
const path = require('path')
const { runSelfCheck } = require('../apps/desktop/electron/services/rate-limit-self-check')

/**
 * total_duration_ms 的容差口径。
 *
 * 六组用例的期望耗时跨度约 14 倍（~1.5s → 21s），只用一个绝对容差在量级上不等价：
 * 对 21s 的 quota-5h-real，1500ms 仅 7.1%，CI 满载下挂钟抖动 1653ms 即误判失败；
 * 对 1.5s 的用例，同样 1500ms 却是 100%，形同不设防。
 *
 * 但取 max(下限, 比例) 也还不够：concurrency-real 期望 11000ms 时比例项只有 1100ms，
 * 于是退化回 1500 的固定下限，而 CI 上该用例的实测抖动是 1640ms —— 又一次误判失败。
 * 两个数据点合起来说明真实 governor 的挂钟漂移是「固定项 + 与时长成正比的累积项」
 * （11000 上 14.9%、21000 上 7.9%），既不是纯常量也不是纯比例。
 * 故取 **绝对下限 + 比例 × 期望耗时**，并向上取整为整毫秒：短用例仍由下限保护，
 * 长用例在固定项之上再获得比例余量；该口径在原口径之上单调加宽，不会在任何用例上
 * 收紧出新的假红，而真回归（如 +100% 量级）仍远超容差、照样抓得住。
 *
 * 必须传「模拟器预测值」而非「真实测量值」：用实测值做分母会让一次变慢
 * 自己撑大自己的容差，回归将永远抓不住。
 */
const PARITY_TOLERANCE_FLOOR_MS = 1500
const PARITY_TOLERANCE_RATIO = 0.1

function durationTolerance (expectedMs) {
  const base = Number.isFinite(expectedMs) && expectedMs > 0 ? expectedMs : 0
  return Math.ceil(PARITY_TOLERANCE_FLOOR_MS + base * PARITY_TOLERANCE_RATIO)
}

const CASES = [
  { name: 'rpm120-concurrency2', params: { rpm: 120, maxConcurrent: 2, requestCount: 8, requestDurationMs: 20 } },
  { name: 'rpm30-concurrency1', params: { rpm: 30, maxConcurrent: 1, requestCount: 4, requestDurationMs: 20 } },
  { name: 'inject-429', params: { rpm: 120, maxConcurrent: 2, requestCount: 6, requestDurationMs: 20, inject429At: 3, cooldownMs: 300 } },
  { name: 'quota-5h', params: { rpm: 120, maxConcurrent: 2, limitPer5h: 2, requestCount: 4, requestDurationMs: 20 } },
  // 2026-08-13 模拟器并发推进升级后纳入（此前为 KNOWN_DIFF）
  { name: 'quota-5h-real', preset: 'doubao-tts', params: { rpm: 20, maxConcurrent: 2, limitPer5h: 5, requestCount: 8, requestDurationMs: 100 } },
  { name: 'concurrency-real', preset: 'custom(interval<duration)', params: { rpm: 60, maxConcurrent: 2, requestCount: 8, requestDurationMs: 2500 } },
]

/**
 * 已知差异用例（2026-08-13 模拟器并发推进升级后仅剩测量噪声）：
 * - slow-call-concurrency：elevenlabs 慢调用（3s×8，rpm=20，interval==duration 临界）——
 *   模拟器确定性 maxc=1；真实 governor 因定时器时钟误差产生 1ms 级短暂重叠 → maxc=2（测量噪声，非并发能力）。
 *   退出码不因这些差异变为非零；parity 测试断言差异值存在（防漂移）。
 */
const KNOWN_DIFF_CASES = [
  { name: 'slow-call-concurrency', preset: 'elevenlabs', params: { rpm: 20, maxConcurrent: 2, requestCount: 8, requestDurationMs: 3000 } },
]

function pythonMetrics (params) {
  const script = [
    "import json, sys",
    "sys.path.insert(0, 'ops-center/backend')",
    "from services.scheduler_simulator import simulate",
    "p = json.loads(sys.argv[1])",
    "r = simulate(p)",
    "print(json.dumps(r['metrics']))",
  ].join('\n')
  const pyParams = {
    rpm: params.rpm,
    max_concurrent: params.maxConcurrent,
    limit_per_5h: params.limitPer5h != null ? params.limitPer5h : null,
    request_count: params.requestCount,
    request_duration_ms: params.requestDurationMs,
    arrival_interval_ms: 0,
    inject_429_at: params.inject429At != null ? params.inject429At : null,
    exceed_5h: params.limitPer5h != null,
    cooldown_ms: params.cooldownMs != null ? params.cooldownMs : 30000,
  }
  const res = spawnSync('python', ['-c', script, JSON.stringify(pyParams)], {
    cwd: path.resolve(__dirname, '..'),
    encoding: 'utf8',
    timeout: 30000,
  })
  if (res.status !== 0) throw new Error('python simulator failed: ' + (res.stderr || res.stdout))
  const lines = res.stdout.trim().split('\n')
  return JSON.parse(lines[lines.length - 1])
}

async function runParity (toleranceMs = PARITY_TOLERANCE_FLOOR_MS) {
  const results = []
  for (const c of CASES) {
    const py = pythonMetrics(c.params)
    const real = await runSelfCheck(c.params)
    // 下限取调用方传入值（默认 1500ms），并按期望耗时放大比例余量；
    // 分母必须是 py.total_duration_ms（预测值），不得用 real，见 durationTolerance 注释。
    const allowed = Math.max(toleranceMs, durationTolerance(py.total_duration_ms))
    const checks = {
      max_concurrent_observed: real.metrics.max_concurrent_observed === py.max_concurrent_observed,
      rate_limited_count: real.metrics.rate_limited_count === py.rate_limited_count,
      quota_exceeded_count: real.metrics.quota_exceeded_count === py.quota_exceeded_count,
      total_duration_ms: Math.abs(real.metrics.total_duration_ms - py.total_duration_ms) <= allowed,
    }
    results.push({
      name: c.name,
      python: py,
      real: real.metrics,
      checks,
      allowedTotalDurationMs: allowed,
      diffTotalDurationMs: real.metrics.total_duration_ms - py.total_duration_ms,
      pass: Object.values(checks).every(Boolean),
    })
  }
  return results
}

async function runKnownDiffs () {
  const results = []
  for (const c of KNOWN_DIFF_CASES) {
    const py = pythonMetrics(c.params)
    const real = await runSelfCheck(c.params)
    results.push({
      name: c.name,
      preset: c.preset,
      python: py,
      real: real.metrics,
      diff: {
        max_concurrent_observed: real.metrics.max_concurrent_observed - py.max_concurrent_observed,
        total_duration_ms: real.metrics.total_duration_ms - py.total_duration_ms,
      },
      note: '已知（测量噪声）：interval==duration 临界下真实 governor 定时器误差导致 1ms 级重叠，maxc 比确定性模拟器高 1',
    })
  }
  return results
}

async function main () {
  const results = await runParity()
  let ok = true
  for (const r of results) {
    console.log('[' + (r.pass ? 'PASS' : 'FAIL') + '] ' + r.name)
    console.log('  python :', JSON.stringify(r.python))
    console.log('  real   :', JSON.stringify(r.real))
    console.log('  checks :', JSON.stringify(r.checks))
    if (!r.pass) ok = false
  }
  const known = await runKnownDiffs()
  for (const r of known) {
    console.log('[KNOWN DIFF] ' + r.name + ' (' + r.preset + ')')
    console.log('  python :', JSON.stringify({ maxc: r.python.max_concurrent_observed, total: r.python.total_duration_ms }))
    console.log('  real   :', JSON.stringify({ maxc: r.real.max_concurrent_observed, total: r.real.total_duration_ms, no_network: r.real.network_calls === 0 }))
    console.log('  diff   :', JSON.stringify(r.diff))
    console.log('  note   :', r.note)
  }
  console.log(known.length ? 'KNOWN_DIFFS: ' + known.length + ' cases recorded (documented limitation, not parity failure)' : 'KNOWN_DIFFS: none')
  console.log(ok ? 'PARITY OK' : 'PARITY MISMATCH')
  process.exit(ok ? 0 : 1)
}

module.exports = { runParity, CASES, runKnownDiffs, KNOWN_DIFF_CASES, durationTolerance, PARITY_TOLERANCE_FLOOR_MS, PARITY_TOLERANCE_RATIO }

if (require.main === module) {
  main().catch((e) => { console.error(e); process.exit(1) })
}

