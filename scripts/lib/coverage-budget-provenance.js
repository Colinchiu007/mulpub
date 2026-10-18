// QG Coverage 作业超时的取证单点（2026-10-18 立，2026-10-19 复测重定数 60→65）。
//
// 为什么不是把数字写进 workflow 注释：`timeout-minutes` 是**无人看管的预算常量**。
// 现场（2026-10-18 立本文件时）：
//   · run 39037127191（PR #3836 的 main push）与 run 39084091986 **都恰好停在 40.0 分钟** ⇒ 被天花板杀掉，
//     后果不是"跑挂"而是 main 侧证据永久丢失（那一步连日志都不会写完）；
//   · 当时 60 趟窗口里成功样本的尾部是 39.4 / 39.4 / 39.5 / 39.5 / **39.7**，
//     即**成功样本贴着 40 的天花板过线**（39.7 / 40 = 0.9925），正是 `scripts/gate-budget.js` 命名的 `hugging` 形态。
// 于是 40 被视为"已经没有余量"，抬到 60（= ceil(39.7 × 1.5)）。
//
// 现场（2026-10-19 复测，**本次重定数的依据**）：
//   · 60 那一档并未被杀过：本窗口 cancelled 的最大时长 38.9，`censoredAtCeiling = 0`；
//   · 但**真实耗时涨了**：干净窗口（120 趟，含 9 趟在飞被正确排除）里 success 53 条，
//     尾部是 40.6 / 40.7 / 40.8 / 41 / 41.3 / **43.3**（p90 41.4）⇒ ceil(43.3 × 1.5) = 65 > 60。
//     也就是说 60 已悄悄低于本仓自己那条 ×1.5 规则 —— 没红只是因为真源里还记着旧窗口的 39.7。
//   · 同时窗口从 60 扩到 120：60 趟窗口里 success 只剩 16 条（< MIN_SAMPLES 20），
//     那不是"预算够"，而是"样本不够下结论"。
//
// 复用而非另起一套：安全系数取自 `scripts/gate-budget.js` 的 `SAFETY_MULTIPLIER`（单一真源，1.5）。
// 本文件只覆盖 `coverage` 这一个作业 —— 它**没有**步级 `WaitForExit` 预算，
// 天花板就是它唯一的预算，所以 gate-budget 那条"内层预算 + 前置开销 + 余量"的双层规则在这里退化为一层，
// 把两套规则强行合并会让其中一套在另一套的形态上静默失效（那才是本仓反复登记的"各抄一份"反面）。
//
// 三条判据（由 `scripts/check-coverage-budget.js` 机械执行，不靠自觉）：
//   ① timeout ≥ ceil(floor × SAFETY_MULTIPLIER)，floor = max(成功最大值, 有被杀趟时的天花板)；
//   ② 成功样本量 ≥ MIN_SAMPLES（一次读数不构成分布）；
//   ③ provenance 与 workflow 那格必须同源、且没过期。
// 另有一条**警报**（HUGGING）：max ≥ 0.9 × timeout 时，即便规则①暂时站得住也必须重定数 ——
// 因为"贴着天花板跑成功"是下一趟被杀的预告，不是安全证明。
//
// 复测：`node scripts/coverage-budget-sample.js --limit=120`（默认天花板取 workflow 现值；
// 要回答"上一代天花板杀了几趟"必须显式传 `--ceiling=<旧值>`，理由见该文件头）。
// ⚠️ 采样器自 2026-10-19 起把**在飞作业**（queued/in_progress）与**漏样**分开：
// 前者不阻断采样（否则只要仓库有 CI 在跑就永远调不了预算），后者仍照旧阻断。
'use strict';

const gate = require('../gate-budget.js');

const JOB_NAME = 'QG Coverage';
const WORKFLOW_PATH = '.github/workflows/quality-gate.yml';
// 65 = ceil(43.3 × 1.5)。**不是**上一档 60 加上去凑的：60 只覆盖到 floor 40（60 / 1.5），
// 而 2026-10-19 的干净窗口里成功样本最大值已是 43.3（p90 41.4），60 已低于本仓自己那条 ×1.5 规则。
// 也不取同文件里兄弟作业的 55 —— 55 对 43.3 只多 27%，仍低于 ×1.5。
const TIMEOUT_MINUTES = 65;

module.exports = {
  JOB_NAME,
  WORKFLOW_PATH,
  TIMEOUT_MINUTES,
  SAFETY_MULTIPLIER: gate.SAFETY_MULTIPLIER,
  PROVENANCE: {
    jobName: JOB_NAME,
    workflowPath: WORKFLOW_PATH,
    // 日期口径与采样器逐字一致：`coverage-budget-sample.js` 写的是 **UTC 日期**
    // （`new Date().toISOString().slice(0,10)`）。本次采集发生在 2026-10-19 01:50 CST
    // = 2026-10-18 17:50Z，故这一格是 2026-10-18。写成本地日 10-19 会得到 `age_days=-1`
    // —— 负龄看着像时钟 bug，也会和"再跑一次复测"的输出对不上。
    collectedAt: '2026-10-18',
    // 窗口从 60 扩到 120：2026-10-19 复测时 60 趟窗口里 success 只剩 16 条，
    // 低于判据的 MIN_SAMPLES=20 ⇒ 那不是"预算够用"，是"样本不够下结论"。
    // 扩窗后 success 53 条，max 43.3、p90 41.4，得 65。
    runsListed: 120,
    // 120 趟 quality-gate run 中 118 趟有 QG Coverage；按设计跳过 25（docs-only PR 会短路整个作业），
    // 活跃 93 趟里 9 趟**在飞**（queued/in_progress，见 change: coverage-budget-inflight：
    // 在飞不是漏样）、84 趟有完整时长，其中 53 趟 success —— samples 只数 success，
    // 别的档位会伪装成长尾。
    samples: 53,
    maxMinutes: 43.3,
    p90Minutes: 41.4,
    // 本窗口内**没有**贴天花板被杀的趟（当前天花板 60，cancelled 的最大时长 38.9）。
    // 这一格只描述它声明的那个窗口，不得为了好看写成别的数。
    censoredAtCeiling: 0,
    ceilingMinutesSampled: 60,
    safetyMultiplier: gate.SAFETY_MULTIPLIER,
    timeoutMinutes: TIMEOUT_MINUTES,
    remeasureCommand: 'node scripts/coverage-budget-sample.js --limit=120',
  },
};
