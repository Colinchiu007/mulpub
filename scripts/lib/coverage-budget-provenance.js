// QG Coverage 作业超时的取证单点（2026-10-18）。
//
// 为什么不是把数字写进 workflow 注释：`timeout-minutes: 40` 是**无人看管的预算常量**。
// 现场（同一天两次读到，窗口滑动前后各一次）：
//   · run 39037127191（PR #3836 的 main push）与 run 39084091986 **都恰好停在 40.0 分钟** ⇒ 被天花板杀掉，
//     后果不是"跑挂"而是 main 侧证据永久丢失（那一步连日志都不会写完）；
//   · 当前 60 趟窗口里成功样本的尾部是 39.4 / 39.4 / 39.5 / 39.5 / **39.7** —— 也就是
//     **成功样本贴着天花板过线**（39.7 / 40 = 0.9925），正是 `scripts/gate-budget.js` 命名的 `hugging` 形态。
// 两条合起来说明 40 不是"够用但运气差"，而是**已经没有余量**。
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
// 复测：`node scripts/coverage-budget-sample.js --limit=60`（默认天花板取 workflow 现值；
// 要回答"上一代天花板杀了几趟"必须显式传 `--ceiling=40`，理由见该文件头）。
'use strict';

const gate = require('../gate-budget.js');

const JOB_NAME = 'QG Coverage';
const WORKFLOW_PATH = '.github/workflows/quality-gate.yml';
// 60 = ceil(39.7 × 1.5)，也是"被 40 杀过两趟"之后仍有整分钟余量的最小档；
// 不是随手取的整数，也不是同文件里兄弟作业的 55 —— 55 对本作业只比观测最大值多 15%，
// 低于本仓自己那条 ×1.5 规则。
const TIMEOUT_MINUTES = 60;

module.exports = {
  JOB_NAME,
  WORKFLOW_PATH,
  TIMEOUT_MINUTES,
  SAFETY_MULTIPLIER: gate.SAFETY_MULTIPLIER,
  PROVENANCE: {
    jobName: JOB_NAME,
    workflowPath: WORKFLOW_PATH,
    collectedAt: '2026-10-18',
    runsListed: 60,
    // 60 趟 quality-gate run 中 55 趟有 QG Coverage，剔除 skipped（docs-only PR 按设计跳过）后
    // 有 32 趟完整时长，其中 24 趟 success —— samples 只数 success，别的档位会伪装成长尾。
    samples: 24,
    maxMinutes: 39.7,
    p90Minutes: 39.4,
    // 本窗口内**没有**贴天花板被杀的趟（两条 40.0 的杀记录在窗口滑动之前，见 run 39037127191 /
    // 39084091986，已在上方现场段列出）。这一格只描述它声明的那个窗口，不得为了好看写成别的数。
    censoredAtCeiling: 0,
    ceilingMinutesSampled: 40,
    safetyMultiplier: gate.SAFETY_MULTIPLIER,
    timeoutMinutes: TIMEOUT_MINUTES,
    remeasureCommand: 'node scripts/coverage-budget-sample.js --limit=60',
  },
};
