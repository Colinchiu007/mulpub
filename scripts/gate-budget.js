'use strict'
/**
 * Gate 测试预算的单一真源（2026-10-11，change: gate-budget-reprobe）。
 *
 * 为什么要有这个文件：预算原来以字面量 `WaitForExit(1800000)` 抄在 workflow 两处
 * （Gate 4 与 Desktop shard 步骤），配 `timeout-minutes: 40`。实测形状是
 * **「成功样本贴着上限跑」**——main push 40 次采样：成功 33 次，最短 17.6 分、中位 27.9 分、
 *   p90 29.4 分、**最长 29.88 分**（离 30 分上限差 7 秒），另有 **9 次被预算杀**（push+PR 两池
 *   合并计数；时长是截尾观测，只证「≥30 分」，绝不进 max）。
 *   Desktop shard（matrix 两步共用一处代码）：步级最长 **29.77 分**。
 *   前置开销实测：unit-tests job 从 job 起点到 Gate 4 起点 ≤1.38 分，Gate 4 之后只剩 2 秒 + 2 秒；
 *   desktop-shards job 含 checkout+install ≤1.38 分（手工核对两次：1.18 / 1.38）。
 *
 * ⚠ 归因纠正（2026-10-11，#3315 落地后）：**上面 Gate 4 那一组是被污染的观测**。
 * 30 分墙在 Gate 4 上的来源不是"套件长过 30 分钟"，而是它的 `--exclude=@multi-publish/desktop`
 * 被命令行里那个独立的 `--` 原样转进 nx 的**任务参数区** ⇒ nx 选择集纹丝不动，桌面全量被串行
 * 塞进 Gate 4（同一批活干了两遍——桌面套件另有 shard 跑）。#3315 把排除写进 `test:all:no-desktop`
 * 之后，main push 的 Gate 4 实测 **94 秒**（run 38127081785，步 09:06:20Z→09:07:54Z，本机按
 * jobs API 的 step 起止自取，不是转述）。**定数结果不变，但绑定关系要说准**：`checkSizing()` 取的是
 * `max(29.88, 29.77)`，而 29.88 正是那个被污染的值 —— 把它剔掉，剩下的 shard 侧 29.77 × 1.5 = 44.66，
 * 仍然向上取整到 **45**，所以 45 分钟既不靠污染数字成立，也不因纠正而失效。
 * 同一次 run 的 shard 侧是活体证据：`2/2` 于 09:06:32Z→09:36:33Z = **30.02 分** 被预算杀
 * （日志正文 `Desktop shard exceeded its 30-minute execution budget`，被杀前最后几行仍是 `✓`，
 * 整场没有 `Test Files` 汇总），`1/2` = 29.45 分侥幸过线。**这就是 main 现在还在红的那一侧。**
 * 修复后的 Gate 4 样本目前 n=1，**按本文件自己的规则不足以据此收紧**，要动数请等样本过
 * MIN_SAMPLE_GATE4_SUCCESS 再跑探针。
 *
 * 定数规则（写死、可测、不许用改判据消化矛盾；`checkSizing()` 里逐条有对应判据，不是只有注释）：
 *   ① 预算 ≥ 观测成功最大值 × SAFETY_MULTIPLIER(1.5) ⇒ max(29.88, 29.77) × 1.5 = 44.82 ⇒ **45 分钟**
 *      （这一条由 RULE_VIOLATED 直查；下面的 0.9 档是"更早的警报"，两者阈值不同、用途不同）
 *   ② job 上限 ≥ 预算 + 该 job 自己的实测最大前置 + TIMEOUT_MARGIN_MIN(5)，再向上取整到 5 的倍数
 *      45 + 1.38 + 5 = 51.38，向上取整到 5 的倍数 ⇒ 55（见下方 GATE_JOB_TIMEOUT_MIN 注释）
 *   只抬内层预算而不动 timeout-minutes 会更糟：GitHub 在 40 分掐掉整个 job，
 *   丢掉超时诊断表、进程树清理与末尾的运行时出站台账判定。
 *
 * 两个比例档（QM-6 双轴同指一处：健康态不得自判红）：
 *   max ≥ HARD_RATIO(0.9)×预算 ⇒ 判"预算不再满足规则"，必须重定数
 *   max ≥ WARN_RATIO(0.8)×预算 ⇒ 才开始要求"至少一个截尾样本"作为证据；
 *     未贴脸时 censored=0 是**抬完预算后的正确状态**，要求它等于让 mandated 的复测必然报红。
 *
 * 截尾计数必须绑"采样窗口内实际生效的预算"（PROVENANCE.priorBudgetMin），不能绑当前值：
 * 抬价之后再回头看 30 分墙上被杀的那批，用 45 分做阈值会把它们全部漏掉。
 */

const GATE_TEST_BUDGET_MS = 2700000 // 45 分钟 = 观测最大 29.88 分 × 1.5 = 44.82，向上取整到分钟
// 45 + 1.38（两 job 各自实测前置，逐 job 判定见 checkSizing）+ 5 余量 = 51.38，向上取整到 5 的倍数 ⇒ 55
const GATE_JOB_TIMEOUT_MIN = 55
const SAFETY_MULTIPLIER = 1.5
const TIMEOUT_MARGIN_MIN = 5
const WARN_RATIO = 0.8   // 贴脸：开始要求截尾证据，并让 CI 打带内告警
const HARD_RATIO = 0.9   // 不再满足规则：必须重测重定数
// 样本量下限：低于此，下面的数字就不是"分布"而是"一次观测"，不得用来定预算
const MIN_SAMPLE_GATE4_SUCCESS = 20
const MIN_SAMPLE_CENSORED_WHEN_HUGGING = 1
// 同形态样本下限：#3357 合并后实测——窗口里混着"两腿各跑全量"与"真半量"两代形态，
// 混池算出的 max 会让 RULE_VIOLATED 拿旧形态的时长去给新形态定墙。分档之后只能说"判不了"。
// ⚠ 分母是**每一池各自**（gate4 与 shard 是两个 job、两种预算语义，加总成 28 是个假数）；
// 它与 MIN_SAMPLE_GATE4_SUCCESS 同为 20 但**不是同一件事**（那个只数 Gate 4 一池，与本形态无关）。
// 且它只削弱"预算站得住"这个正向结论，不削弱由观测值直接推出的告警（见 checkSizing 的 alarms/scarcity 分装）。
const MIN_SAMPLE_CURRENT_FORM = 20

/**
 * 纯函数：只读 workflow 正文，判"桌面分片这一步到底分不分文件"。
 * 判据本身住在 scripts/check-desktop-shard-forwarding.js 的 `classifyShardForm`
 * （裸 "--" / 缺 `--shard=` / 续行被注释吃掉 三种失效形态共用一份事实），本文件只是转接 ——
 * 抄第二份判据的话，"CI 报红的那批 run"会被探针归进 fixed 池，分档前提自己被骗。
 * 三态语义：
 *   fixed   —— 那一步在，且三种失效形态一个都没命中；
 *   broken  —— 那一步在，但命中任一失效形态（旗标没送到 / 被裸 "--" 截断 / 续行断裂）；
 *   unknown —— **读不到那一步**（步骤改名、解析不到数组），绝不猜成 fixed。
 * ⛔ require 故意放在 try 外面：模块没了是装配断裂，不是数据缺失，必须炸出声；
 * 把它洗成 unknown 会让"判据失明"和"这批样本没形态"在退出码上无法区分。
 */
function shardFormOf (workflowText) {
  const { classifyShardForm } = require('./check-desktop-shard-forwarding.js')
  try {
    return classifyShardForm(workflowText)
  } catch (e) {
    return 'unknown'
  }
}

/** 纯函数：从某个历史提交里的 gate-budget.js 正文取当时生效的预算（分钟）；取不到返回 null。 */
function budgetMinFromGateBudgetText (text) {
  // 锚在声明行：正文注释里"历史上 GATE_TEST_BUDGET_MS = 1800000 曾…"这种叙述不是现行常量，
  // 不锚就会把历史叙述当成那个 run 生效的预算，形态键立刻漂移。
  const m = /^[ \t]*const GATE_TEST_BUDGET_MS\s*=\s*(\d+)/m.exec(String(text || ''))
  if (!m) return null
  return Math.round((Number(m[1]) / 60000) * 100) / 100
}

/**
 * 纯函数：旧提交里还没有 gate-budget.js 时，从 workflow 正文的 `WaitForExit(<ms>)` 字面量取预算。
 * 两处（Gate 4 与 shard）取值**不一致就当读不到** —— 那说明这一步的墙不止一张，
 * 取第一个猜一个正是本文件反复出事的形态。
 */
function waitExitBudgetMin (text) {
  const vals = [...new Set((String(text || '').match(/WaitForExit\((\d{4,})\)/g) || []).map((s) => Number(/(\d{4,})/.exec(s)[1])))]
  if (vals.length !== 1) return null
  return Math.round((vals[0] / 60000) * 100) / 100
}

const PROVENANCE = {
  collectedAt: '2026-10-11T08:22:54Z',
  workflowId: '306371582',
  events: 'push(branch=main) n=40 + pull_request n=60 合并计数（探针同口径；只算 push 面是 33）',
  priorBudgetMin: 30,          // 采样窗口内实际生效的预算（截尾判据以它为锚）
  currentBudgetMin: 45,        // 本次抬到的值（抬完的窗口内 censored=0 属预期）
  gate4SuccessN: 69,
  gate4MaxSuccessMin: 29.88,
  censoredUnderPriorBudgetN: 9,
  censoredUnderCurrentBudgetN: 0,
  gate4CensoredNote: '被杀样本时长截尾，只证 ≥priorBudgetMin，不进 max；抬价后的窗口内 current 档为 0 属预期',
  shardMaxSuccessMin: 29.77,
  gate4OverheadMaxMin: 1.38,
  shardOverheadMaxMin: 1.38,
  multiplier: SAFETY_MULTIPLIER,
  remeasureCmd: 'node scripts/gate-budget-probe.js --check',
}

const PROVENANCE_FIELDS = Object.keys(PROVENANCE)

const JOB_OVERHEAD_FIELD = {
  'unit-tests': 'gate4OverheadMaxMin',
  'desktop-shards': 'shardOverheadMaxMin',
}

/**
 * 纯判据：不碰网络、不读文件，便于离线锁住"数与规则是否自洽"。
 *
 * `form`（可选）= 当前形态的同源样本统计
 * `{ key, gate4SuccessN, shardSuccessN, gate4MaxSuccessMin, shardMaxSuccessMin, censoredUnderPriorBudgetN }`。
 * 传了它，取值来源**按字段分治**（不是"整体取代 provenance"，那样说会过度声称）：
 *   maxObs、样本数、贴脸时要求的截尾证据 ⇒ 一律取 form；
 *   perJob 的实测前置（gate4OverheadMaxMin / shardOverheadMaxMin）⇒ 仍取 provenance，form 里没有这两项。
 *
 * 两类结论分开装，因为它们的**动作方向相反**：
 *   alarms   —— 由观测值直接推出，意思是"现在就该动数"；
 *   scarcity —— 由样本量推出，意思是"还不能确认预算站得住"。
 * 样本稀缺只让"max 就是真上界"这个正向结论更弱（右截尾 ⇒ 观测 max 只会低估），
 * 它否定不了"确实跑出过一个 44 分"。第 1 轮把稀缺做成整条 else 的开关，于是
 * 「14 个样本 + 观测 44 分」只剩一句"判不了"，真违规被自己的判据关掉。
 */
function checkSizing ({
  budgetMs = GATE_TEST_BUDGET_MS,
  jobTimeouts = { 'unit-tests': GATE_JOB_TIMEOUT_MIN, 'desktop-shards': GATE_JOB_TIMEOUT_MIN },
  provenance = PROVENANCE,
  form = null,
} = {}) {
  const alarms = []
  const scarcity = []
  const budgetMin = budgetMs / 60000
  const maxObs = form
    ? Math.max(form.gate4MaxSuccessMin, form.shardMaxSuccessMin)
    : Math.max(provenance.gate4MaxSuccessMin, provenance.shardMaxSuccessMin)
  const hugging = maxObs >= budgetMin * WARN_RATIO
  const censoredN = form ? form.censoredUnderPriorBudgetN : provenance.censoredUnderPriorBudgetN

  // 定数规则①本身必须是判据，不能只活在注释里（QM-6 第 2 轮可维护性轴命中：
  // 原来只有 0.9 档，于是"预算=1.2×观测最大值"这种违反 ×1.5 的形态会被读成"一切正常"）。
  if (!(budgetMin >= maxObs * SAFETY_MULTIPLIER - 1e-9)) {
    alarms.push(`RULE_VIOLATED：预算 ${budgetMin} 分 < 观测成功最大 ${maxObs} 分 × ${SAFETY_MULTIPLIER} = ${(maxObs * SAFETY_MULTIPLIER).toFixed(2)} 分——按规则重定数，不得改倍数`)
  }
  if (maxObs >= budgetMin * HARD_RATIO) {
    alarms.push(`NO_LONGER_SIZED：观测成功最大 ${maxObs} 分已达预算 ${budgetMin} 分的 ${HARD_RATIO * 100}%，必须重新采集并重定数（不是放宽判据）`)
  }
  if (hugging && !(censoredN >= MIN_SAMPLE_CENSORED_WHEN_HUGGING)) {
    alarms.push(`已贴脸（${maxObs} ≥ ${WARN_RATIO} × ${budgetMin}）却无任何"在生效预算处被杀"的截尾样本：此时 max 是假上界`)
  }

  // 样本下限：MIN_SAMPLE_GATE4_SUCCESS 只数 Gate 4 一池；MIN_SAMPLE_CURRENT_FORM 是**每池各自**的下限
  // —— 同值 20 是分母不同的两件事（把两池加总成 28 是个假数：Gate 4 够不代表 shard 够）。
  if (form) {
    if (form.gate4SuccessN < MIN_SAMPLE_CURRENT_FORM || form.shardSuccessN < MIN_SAMPLE_CURRENT_FORM) {
      scarcity.push(`INSUFFICIENT_CURRENT_FORM：当前形态（${form.key || '未命名'}）两池成功样本 gate4=${form.gate4SuccessN} / shard=${form.shardSuccessN}，各自下限 ${MIN_SAMPLE_CURRENT_FORM} —— 不能确认预算站得住；上面若仍有告警，告警照样算数`)
    }
  } else if (provenance.gate4SuccessN < MIN_SAMPLE_GATE4_SUCCESS) {
    scarcity.push(`Gate 4 成功样本仅 ${provenance.gate4SuccessN}，低于下限 ${MIN_SAMPLE_GATE4_SUCCESS}——不能拿来定预算`)
  }

  const perJob = {}
  for (const [job, field] of Object.entries(JOB_OVERHEAD_FIELD)) {
    const usesOverhead = provenance[field]
    const need = budgetMin + usesOverhead + TIMEOUT_MARGIN_MIN
    const t = jobTimeouts[job]
    const ok = typeof t === 'number' && t >= need
    const reason = ok ? '' : `${job}: timeout-minutes ${t} < 预算 ${budgetMin} + 自身前置 ${usesOverhead} + 余量 ${TIMEOUT_MARGIN_MIN} = ${need.toFixed(1)} 分`
    perJob[job] = { ok, usesOverhead, need, reason }
    if (!ok) alarms.push(reason)
  }

  const reasons = [...alarms, ...scarcity]
  return { ok: reasons.length === 0, reasons, alarms, scarcity, budgetMin, maxObs, hugging, perJob }
}

/**
 * 出口码表（纯函数，探针与测试共用；这里的顺序就是优先级，不是 if 的书写顺序）：
 *   3 取数失败（数字本身不可用，最优先）
 *   1 有告警（要动数）
 *   4 同形态样本不足（别动数，等样本攒够）
 *   2 贴脸但规则仍站得住（要重测的信号）
 *   0 一切正常
 * ⛔ 告警必须排在稀缺之前：把"已经观测到 44 分"读成"还没量够、先别动"，正是本文件要消灭的误标签；
 * 抽成表还让"分支换序"这种回归变成一条可点名的单测，而不是等下一次误报。
 */
function exitCodeFor (sized, probeErrorsN = 0) {
  if (probeErrorsN > 0) return 3
  if ((sized.alarms || []).length) return 1
  if ((sized.scarcity || []).length) return 4
  if (sized.hugging) return 2
  return 0
}

module.exports = {
  GATE_TEST_BUDGET_MS,
  GATE_JOB_TIMEOUT_MIN,
  SAFETY_MULTIPLIER,
  TIMEOUT_MARGIN_MIN,
  WARN_RATIO,
  HARD_RATIO,
  MIN_SAMPLE_GATE4_SUCCESS,
  MIN_SAMPLE_CENSORED_WHEN_HUGGING,
  MIN_SAMPLE_CURRENT_FORM,
  JOB_OVERHEAD_FIELD,
  PROVENANCE,
  PROVENANCE_FIELDS,
  checkSizing,
  exitCodeFor,
  budgetMinFromGateBudgetText,
  waitExitBudgetMin,
  shardFormOf,
  budgetMinFromGateBudgetText,
}
