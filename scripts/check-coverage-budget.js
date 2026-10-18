// QG Coverage 作业超时的机械判据 —— 「预算数值必须有可重跑的实测支撑」这条纪律的执行体。
//
// 为什么要有这个文件（2026-10-18）：`timeout-minutes: 40` 撞上过两趟 main push
// （run 39037127191 = #3836 的那次，恰好 40.0 分钟被杀），后果不是"跑挂"而是**main 侧证据永久丢失**；
// 而当时没有任何东西在看这个数够不够 —— 它是"装饰性门禁"的镜像形态：**无人看管的预算常量**。
// 本文件把它变成一条命令：红了就改数值或重采集，不许改宽判据。
//
// 判据（四条，全部可在 `coverage-budget-sample.js` 的现场读数上复核）：
//   PROVENANCE_VALUE_DRIFT  provenance 记的数值 ≠ workflow 实际值 ⇒ 表与 runner 不同源；
//   UNDER_BUDGET            timeout < ceil(max × safetyMultiplier)；
//   INSUFFICIENT_SAMPLES    成功样本 < MIN_SAMPLES（一次读数不构成分布）；
//   STALE_PROVENANCE        采集日距今 > STALE_DAYS（数字不随仓库变，样本会）。
// 另：读不到 `timeout-minutes` 时**不得**当成"没问题"，走退出码 2（把工具的失明读成结论是本仓的老错型）。
//
// 依赖：只用 node 内置模块 —— 本文件被 quality-gate.yml 的 changes job 点名，那个 job 没有 Install deps。
'use strict';

const fs = require('fs');
const path = require('path');

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_JUDGE_ERROR = 2;

const JOB_ID = 'coverage';
const JOB_NAME = 'QG Coverage';
const MIN_SAMPLES = 20;
const STALE_DAYS = 90;

/**
 * 按**作业块**取 timeout-minutes。
 * 不能用「文件里第一个 timeout-minutes」：本 workflow 有 10 个该键（5 / 15 / 20 / 40 / 55 都有），
 * 取错一格会让判据读着一个作业的数、守着另一个作业的命。
 * @param {string} text workflow 原文
 * @param {string} jobId 作业键（如 'coverage'）
 * @returns {number|null} 读不到返回 null（由调用方按失明处理，不得返回默认值）
 */
function parseJobTimeout(text, jobId) {
  const lines = String(text).split(/\r?\n/);
  let inJobs = false;
  let inside = false;
  for (const raw of lines) {
    if (/^jobs:\s*$/.test(raw)) { inJobs = true; continue; }
    if (!inJobs) continue;
    const m = /^( {2})([A-Za-z0-9_-]+):\s*$/.exec(raw);
    if (m) {
      inside = (m[2] === jobId);
      continue;
    }
    if (!inside) continue;
    const t = /^\s+timeout-minutes:\s*(\d+)\s*$/.exec(raw);
    if (t) return Number(t[1]);
  }
  return null;
}

function daysSince(isoDate) {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return Infinity;
  return Math.floor((Date.now() - d.getTime()) / 86400000);
}

function judgeWorkflow(opts) {
  const o = opts || {};
  const provenance = o.provenance;
  const requiredKeys = ['jobName', 'workflowPath', 'collectedAt', 'runsListed', 'samples',
    'maxMinutes', 'p90Minutes', 'censoredAtCeiling', 'ceilingMinutesSampled', 'safetyMultiplier',
    'timeoutMinutes', 'remeasureCommand'];
  const reasons = [];
  if (!provenance || typeof provenance !== 'object') reasons.push('provenance 缺失');
  else {
    const missing = requiredKeys.filter((k) => provenance[k] === undefined || provenance[k] === null);
    if (missing.length) reasons.push('provenance 缺字段：' + missing.join(','));
    if (typeof provenance.safetyMultiplier !== 'number' || provenance.safetyMultiplier <= 1) {
      reasons.push('safetyMultiplier 必须 >1');
    }
  }
  const timeout = typeof o.timeoutMinutes === 'number'
    ? o.timeoutMinutes : parseJobTimeout(o.workflowText || '', JOB_ID);
  if (timeout === null || timeout === undefined) reasons.push('读不到 ' + JOB_NAME + ' 的 timeout-minutes');
  if (reasons.length) {
    return { ok: false, judgeError: true, reasons, timeoutMinutes: timeout, violations: [] };
  }

  const violations = [];
  // floor 的取法是本文件存在的理由：成功样本是**右截尾**的 —— 在天花板处被杀的趟永远不会以 success
  // 出现，所以只看 maxMinutes 会系统性地低估长尾（今天就是现场：成功最大 39.7 分，另有两趟正好停在 40.0）。
  // 有被杀的趟时，真实上界至少到那条天花板。
  const floorMinutes = provenance.censoredAtCeiling > 0
    ? Math.max(provenance.maxMinutes, provenance.ceilingMinutesSampled)
    : provenance.maxMinutes;
  const required = Math.ceil(floorMinutes * provenance.safetyMultiplier);
  if (provenance.timeoutMinutes !== timeout) {
    violations.push({ rule: 'PROVENANCE_VALUE_DRIFT',
      detail: 'provenance 记 ' + provenance.timeoutMinutes + '，workflow 实际 ' + timeout });
  }
  if (timeout < required) {
    violations.push({ rule: 'UNDER_BUDGET',
      detail: 'timeout=' + timeout + ' < ceil(floor ' + floorMinutes +
        ' × ' + provenance.safetyMultiplier + ') = ' + required +
        '（floor = max(成功最大 ' + provenance.maxMinutes +
        ', 截尾天花板 ' + (provenance.censoredAtCeiling > 0 ? provenance.ceilingMinutesSampled : '不计') + ')）' });
  }
  if (provenance.samples < MIN_SAMPLES) {
    violations.push({ rule: 'INSUFFICIENT_SAMPLES',
      detail: 'samples=' + provenance.samples + ' < ' + MIN_SAMPLES + '（一次读数不构成分布）' });
  }
  const age = daysSince(provenance.collectedAt);
  if (age > STALE_DAYS) {
    violations.push({ rule: 'STALE_PROVENANCE',
      detail: 'collectedAt=' + provenance.collectedAt + ' 距今 ' +
        (Number.isFinite(age) ? age : '不可解析') + ' 天 > ' + STALE_DAYS });
  }
  // 警报档（取自 scripts/gate-budget.js 的同一比例，不另立一个 0.9）：
  // "贴着天花板跑成功"是下一趟被杀的预告，不是安全证明 —— 本作业现场就是 39.7 / 40。
  const hardRatio = require('./gate-budget.js').HARD_RATIO;
  const hugging = timeout > 0 && provenance.maxMinutes >= hardRatio * timeout;
  if (hugging) {
    violations.push({ rule: 'HUGGING',
      detail: 'max=' + provenance.maxMinutes + ' ≥ ' + hardRatio + ' × timeout=' + timeout +
        '（贴脸：规则①可能仍站得住，但必须重定数）' });
  }
  return {
    ok: violations.length === 0,
    judgeError: false,
    reasons: [],
    timeoutMinutes: timeout,
    requiredMinutes: required,
    floorMinutes,
    hugging,
    violations,
    readout: 'timeout=' + timeout + ' 需≥' + required + ' 余量=' + (timeout - required) + ' 分' +
      ' floor=' + floorMinutes +
      ' samples=' + provenance.samples + ' max=' + provenance.maxMinutes +
      ' p90=' + provenance.p90Minutes + ' censored_at_ceiling=' + provenance.censoredAtCeiling +
      '(绑 ' + provenance.ceilingMinutesSampled + ' 分那条天花板，非当前值)' +
      ' collected=' + provenance.collectedAt + ' age_days=' + (Number.isFinite(age) ? age : 'NaN'),
  };
}

function main(argv) {
  const args = argv || [];
  const rootArg = args.find((a) => a.indexOf('--root=') === 0);
  const root = rootArg ? rootArg.slice('--root='.length) : path.join(__dirname, '..');
  const timeoutArg = args.find((a) => a.indexOf('--timeout=') === 0);
  // --timeout 只用于**注入坏值做负控**（回归锁与变异反证要用它，不能靠改 workflow 制造红）。
  let timeoutOverride;
  if (timeoutArg) {
    timeoutOverride = Number(timeoutArg.slice('--timeout='.length));
    if (!Number.isFinite(timeoutOverride)) {
      console.error('[COVERAGE-BUDGET] --timeout 必须是数字（未知/非法取值一律出声，不静默忽略）');
      return EXIT_JUDGE_ERROR;
    }
  }
  const wfPath = path.join(root, '.github', 'workflows', 'quality-gate.yml');
  let text;
  try {
    text = fs.readFileSync(wfPath, 'utf8');
  } catch (e) {
    console.error('[COVERAGE-BUDGET] 判据自身故障：读不到 ' + wfPath + ' — ' + e.message);
    return EXIT_JUDGE_ERROR;
  }
  const prov = require(path.join(__dirname, 'lib', 'coverage-budget-provenance.js'));
  const r = judgeWorkflow({
    workflowText: text,
    provenance: prov.PROVENANCE,
    timeoutMinutes: timeoutOverride,
  });
  if (r.judgeError) {
    console.error('[COVERAGE-BUDGET] 判据自身故障（按"未证实"处理，不得读成合规）：' + r.reasons.join('；'));
    return EXIT_JUDGE_ERROR;
  }
  console.log('[COVERAGE-BUDGET] job=' + JOB_NAME + ' ' + r.readout +
    ' ⇒ ' + (r.ok ? 'OK' : 'VIOLATION'));
  for (const v of r.violations) console.error('[COVERAGE-BUDGET] ' + v.rule + ' — ' + v.detail);
  if (!r.ok) {
    console.error('[COVERAGE-BUDGET] 两条正解：跑 `node scripts/coverage-budget-sample.js 60` 重采集后更新 provenance，' +
      '或把 timeout-minutes 抬到 required 之上。' +
      '禁止改宽本判据（MIN_SAMPLES / STALE_DAYS / safetyMultiplier）来消红。');
    return EXIT_VIOLATION;
  }
  return EXIT_OK;
}

module.exports = {
  EXIT_OK, EXIT_VIOLATION, EXIT_JUDGE_ERROR,
  JOB_ID, JOB_NAME, MIN_SAMPLES, STALE_DAYS,
  parseJobTimeout, daysSince, judgeWorkflow, main,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
