'use strict'
/**
 * Gate 测试预算的单一真源（2026-10-11，change: gate-budget-reprobe）。
 *
 * 为什么要有这个文件：预算原来以字面量 `WaitForExit(1800000)` 抄在 workflow 的两处
 * （Gate 4 与 Desktop shard 步骤），配 `timeout-minutes: 40`。实测形状是
 * **「成功样本贴着上限跑」**——不是偶发抖动，是套件已经长过 30 分钟：
 *
 *   main push（跑 `test:all`，非桌面全量）40 次采样：成功 33 次，
 *     最短 17.6 分、中位 27.9 分、p90 29.4 分、**最长 29.9 分**（离 30 分上限差 7 秒），
 *     另有 **7 次被预算杀**（时长是截尾观测，只证明「≥30 分」，不能当 30 分用）。
 *   Desktop shard（matrix 两步）10 次采样：步级最长 **30.0 分**（撞线），高段 28–29 分。
 *   Gate 4 所在 job 的前置开销（checkout+install+前置 gates）实测 **≤1.3 分**，
 *     Gate 4 之后只剩 2 秒（Gate 4b）+ 2 秒（post-checkout）。
 *
 * 所以定数规则（不许随手改数）：**预算 ≥ 观测成功最大值 × 1.5**，
 * **job 上限 ≥ 预算 + 实测最大前置 + 5 分钟余量**。若只抬内部预算而不动 `timeout-minutes: 40`，
 * GitHub 会在 40 分钟处掐掉整个 job，比现在更糟——丢诊断表、丢进程树清理、丢末尾出站台账判定。
 *
 * 被杀的 7 次是截尾的：真实需求的上界由这份数据**给不出来**。所以这里同时提供
 * `scripts/gate-budget-probe.js` 作为**可重跑的复测入口**，抬完必须回看一轮再定第二次数。
 */

const GATE_TEST_BUDGET_MS = 2700000 // 45 分钟 = 29.9 × 1.5 向上取整
const GATE_JOB_TIMEOUT_MIN = 55     // 45 + 3（实测最大前置，shard 侧 2.8）+ 5 余量，向上取整
const SAFETY_MULTIPLIER = 1.5
const OVERHEAD_ALLOWANCE_MIN = 3
const TIMEOUT_MARGIN_MIN = 5
// 样本量下限：低于此，下面的数字就不是"分布"而是"一次观测"，不得用来定预算
const MIN_SAMPLE_GATE4_SUCCESS = 20
const MIN_SAMPLE_GATE4_CENSORED = 1

const PROVENANCE = {
  collectedAt: '2026-10-11T06:52:51Z',
  workflowId: '306371582',
  events: 'push(branch=main) n=40 / pull_request n=60',
  gate4SuccessN: 33,
  gate4MaxSuccessMin: 29.9,
  gate4CensoredN: 7,
  gate4CensoredNote: '被杀样本时长截尾，只证 ≥30 分，不进 max',
  shardMaxSuccessMin: 30.0,
  gate4OverheadMaxMin: 1.3,
  shardOverheadMaxMin: 2.8,
  multiplier: SAFETY_MULTIPLIER,
  remeasureCmd: 'node scripts/gate-budget-probe.js --check',
}

const PROVENANCE_FIELDS = Object.keys(PROVENANCE)

/** 纯判据：不碰网络、不读文件，便于离线锁住"数与规则是否自洽"。 */
function checkSizing ({ budgetMs = GATE_TEST_BUDGET_MS, jobTimeoutMin = GATE_JOB_TIMEOUT_MIN, provenance = PROVENANCE } = {}) {
  const reasons = []
  const budgetMin = budgetMs / 60000
  const maxObs = Math.max(provenance.gate4MaxSuccessMin, provenance.shardMaxSuccessMin)
  if (!(budgetMin >= maxObs * SAFETY_MULTIPLIER - 1e-9)) {
    reasons.push(`预算 ${budgetMin} 分 < 观测成功最大 ${maxObs} 分 × ${SAFETY_MULTIPLIER} = ${(maxObs * SAFETY_MULTIPLIER).toFixed(1)} 分`)
  }
  const needTimeout = budgetMin + provenance.shardOverheadMaxMin + TIMEOUT_MARGIN_MIN
  if (!(jobTimeoutMin >= needTimeout)) {
    reasons.push(`job 上限 ${jobTimeoutMin} 分 < 预算 ${budgetMin} + 最大前置 ${provenance.shardOverheadMaxMin} + 余量 ${TIMEOUT_MARGIN_MIN} = ${needTimeout.toFixed(1)} 分`)
  }
  if (provenance.gate4SuccessN < MIN_SAMPLE_GATE4_SUCCESS) {
    reasons.push(`Gate 4 成功样本仅 ${provenance.gate4SuccessN}，低于下限 ${MIN_SAMPLE_GATE4_SUCCESS}——不能拿来定预算`)
  }
  if (provenance.gate4CensoredN < MIN_SAMPLE_GATE4_CENSORED) {
    reasons.push(`未记录"被预算杀"的样本数（下限 ${MIN_SAMPLE_GATE4_CENSORED}）：截尾观测缺失意味着 max 是假上界`)
  }
  return { ok: reasons.length === 0, reasons, budgetMin, maxObs }
}

module.exports = {
  GATE_TEST_BUDGET_MS,
  GATE_JOB_TIMEOUT_MIN,
  SAFETY_MULTIPLIER,
  OVERHEAD_ALLOWANCE_MIN,
  TIMEOUT_MARGIN_MIN,
  MIN_SAMPLE_GATE4_SUCCESS,
  MIN_SAMPLE_GATE4_CENSORED,
  PROVENANCE,
  PROVENANCE_FIELDS,
  checkSizing,
}
