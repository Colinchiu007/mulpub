// 全仓 CI 作业 `timeout-minutes` 的机械判据（来路与设计取舍见 01-docs/PRD-GATE-TIMEOUT-GOVERNANCE-2026-10-20.md）。
// 逐格判据：PROVENANCE_VALUE_DRIFT / UNDER_BUDGET / INSUFFICIENT_SAMPLES / SEEDED_STALE /
//           SEEDED_EXPIRED / STALE_PROVENANCE / HUGGING（max ≥ HARD_RATIO × timeout）。
// 清单棘轮：UNREGISTERED_TIMEOUT_CELL（新增裸常量必须当场红）/ MISSING_TIMEOUT_CELL（登记项消失必须红）。
// 读不到 `timeout-minutes`、或读到非整数值时不得当成"没问题"，走退出码 2（失明 ≠ 合规）。
// 依赖：只用 node 内置模块 —— 本文件被 quality-gate.yml 的 changes job 点名，那个 job 没有 Install deps。
'use strict';

const fs = require('fs');
const path = require('path');
const registryLib = require(path.join(__dirname, 'lib', 'gate-timeout-registry.js'));

const EXIT_OK = 0;
const EXIT_VIOLATION = 1;
const EXIT_JUDGE_ERROR = 2;

// 兼容出口：单格时代的名字（既有锁与既有消费者直接引用）。
const JOB_ID = registryLib.COVERAGE_JOB_ID;
const JOB_NAME = registryLib.JOB_NAME;

// 阈值不在本文件另写一份 —— 全部来自注册表的三个标量，避免"各抄一份"。
// 注册表坏了就让 getter 抛（fail closed），由 main 转成退出码 2。
function thresholds() {
  const reg = registryLib.registry();
  return {
    minSamples: reg.raw.minSamples,
    staleDays: reg.raw.staleDays,
    seededGraceDays: reg.raw.seededGraceDays,
  };
}

/**
 * 按**作业块**取 timeout-minutes。
 * 不能用「文件里第一个 timeout-minutes」：quality-gate.yml 有 10 个该键，
 * 取错一格会让判据读着一个作业的数、守着另一个作业的命。
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
    if (m) { inside = (m[2] === jobId); continue; }
    if (!inside) continue;
    // 只认**作业级**（恰好 4 空格缩进）。实测 electron-ci.yml 里还有 2 格 8 空格的
    // **步级** timeout-minutes —— 那是另一层预算（步内），拿它当作业级会把 70 读成 10。
    const t = /^ {4}timeout-minutes:\s*(\d+)\s*$/.exec(raw);
    if (t) return Number(t[1]);
  }
  return null;
}

/**
 * 扫出**全部作业级** timeout-minutes 格子（清单棘轮的输入）：`^  <jobId>:$` 起块，
 * 块内**恰好 4 空格**的 `^    timeout-minutes: <整数>$`。缩进必须钉死：实测 electron-ci.yml
 * 的 `electron-tests` 作业级是 70，而它内部两个 step 各带 8 空格的 `timeout-minutes: 10`；
 * 用 `^\s+` 收会把 70 读成 10，于是对一格**合规**作业报 UNDER_BUDGET（假违规与假绿同害）。
 * 深缩进的（步级）单独收进 stepLevel 并打印：不在治理面内，但不得静默忽略。
 */
function scanTimeoutCells(text) {
  const lines = String(text).split(/\r?\n/);
  const cells = new Map();
  const stepLevel = [];
  const unparsed = [];
  let cur = null;
  for (const raw of lines) {
    const m = /^ {2}([A-Za-z0-9_-]+):\s*$/.exec(raw);
    if (m) { cur = m[1]; continue; }
    if (!/^\s*timeout-minutes:/.test(raw)) continue;
    const indent = (/^(\s*)/.exec(raw))[1].length;
    if (indent > 4) {
      const t = /^\s+timeout-minutes:\s*(\d+)\s*$/.exec(raw);
      stepLevel.push({ jobId: cur, raw: raw.trim(), value: t ? Number(t[1]) : null });
      continue;
    }
    const t = /^ {4}timeout-minutes:\s*(\d+)\s*$/.exec(raw);
    if (!t || !cur) { unparsed.push(raw.trim()); continue; }
    cells.set(cur, Number(t[1]));
  }
  return { cells, stepLevel, unparsed };
}

function daysSince(isoDate, nowMs) {
  const d = new Date(isoDate + 'T00:00:00Z');
  if (Number.isNaN(d.getTime())) return Infinity;
  const now = typeof nowMs === 'number' ? nowMs : Date.now();
  return Math.floor((now - d.getTime()) / 86400000);
}

/**
 * 逐格判定。`entry` 形如注册表 jobs[i]（至少要有 timeoutMinutes/state/provenance）。
 * 单格时代的 `judgeWorkflow` 也走这里 —— 规则只有一份实现。
 */
function judgeEntry(opts) {
  const o = opts || {};
  const th = o.thresholds || thresholds();
  const entry = o.entry || {};
  const provenance = o.provenance || entry.provenance;
  const state = o.state || entry.state || 'measured';
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
  const declared = typeof o.timeoutMinutes === 'number'
    ? o.timeoutMinutes
    : (typeof entry.timeoutMinutes === 'number' ? entry.timeoutMinutes : null);
  const timeout = declared !== null ? declared : parseJobTimeout(o.workflowText || '', o.jobId || JOB_ID);
  if (timeout === null || timeout === undefined) reasons.push('读不到 timeout-minutes');
  if (reasons.length) {
    return { ok: false, judgeError: true, reasons, timeoutMinutes: timeout, violations: [] };
  }

  const violations = [];
  // floor 的取法是本判据存在的理由：成功样本是**右截尾**的 —— 在天花板处被杀的趟永远不会以
  // success 出现，只看 maxMinutes 会系统性低估长尾（现场：成功最大 39.7，另有两趟正好停在 40.0）。
  const floorMinutes = provenance.censoredAtCeiling > 0
    ? Math.max(provenance.maxMinutes, provenance.ceilingMinutesSampled)
    : provenance.maxMinutes;
  const required = Math.ceil(floorMinutes * provenance.safetyMultiplier);
  if (o.checkDrift !== false && typeof provenance.timeoutMinutes === 'number' &&
      provenance.timeoutMinutes !== timeout) {
    violations.push({ rule: 'PROVENANCE_VALUE_DRIFT',
      detail: '注册表记 ' + provenance.timeoutMinutes + '，workflow 实际 ' + timeout });
  }
  if (timeout < required) {
    violations.push({ rule: 'UNDER_BUDGET',
      detail: 'timeout=' + timeout + ' < ceil(floor ' + floorMinutes +
        ' × ' + provenance.safetyMultiplier + ') = ' + required +
        '（floor = max(成功最大 ' + provenance.maxMinutes +
        ', 截尾天花板 ' + (provenance.censoredAtCeiling > 0 ? provenance.ceilingMinutesSampled : '不计') + ')）' });
  }
  const age = daysSince(provenance.collectedAt, o.nowMs);
  if (state === 'measured') {
    if (provenance.samples < th.minSamples) {
      violations.push({ rule: 'INSUFFICIENT_SAMPLES',
        detail: 'samples=' + provenance.samples + ' < ' + th.minSamples + '（一次读数不构成分布）' });
    }
  } else if (state === 'seeded') {
    // 双向都要出声：攒够了却不升级 = 把宽限期当永久豁免；到期还没攒够 = 宽限期失效。
    if (provenance.samples >= th.minSamples) {
      violations.push({ rule: 'SEEDED_STALE',
        detail: 'state=seeded 但 samples=' + provenance.samples + ' ≥ ' + th.minSamples +
          ' ⇒ 该把 state 改成 measured（宽限期不是永久豁免）' });
    } else if (Number.isFinite(age) && age > th.seededGraceDays) {
      violations.push({ rule: 'SEEDED_EXPIRED',
        detail: 'state=seeded 且 collectedAt=' + provenance.collectedAt + ' 距今 ' + age +
          ' 天 > 宽限期 ' + th.seededGraceDays + '，样本仍只有 ' + provenance.samples +
          ' < ' + th.minSamples + ' ⇒ 重采，或在注册表里如实降级说明' });
    }
  }
  if (age > th.staleDays) {
    violations.push({ rule: 'STALE_PROVENANCE',
      detail: 'collectedAt=' + provenance.collectedAt + ' 距今 ' +
        (Number.isFinite(age) ? age : '不可解析') + ' 天 > ' + th.staleDays });
  }
  // 警报档取自 scripts/gate-budget.js 的 HARD_RATIO，不另立一个 0.9：
  // "贴着天花板跑成功"是下一趟被杀的预告，不是安全证明。
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

/** 单格兼容入口（既有锁与既有消费者用）。 */
function judgeWorkflow(opts) {
  const o = opts || {};
  return judgeEntry({
    entry: { timeoutMinutes: o.timeoutMinutes, state: 'measured' },
    provenance: o.provenance,
    timeoutMinutes: o.timeoutMinutes,
    workflowText: o.workflowText,
    jobId: o.jobId || JOB_ID,
    nowMs: o.nowMs,
  });
}

/** 把注册表条目补成 judgeEntry 需要的 provenance 形状（safetyMultiplier / remeasureCommand 是全局知识）。 */
function provenanceOf(entry) {
  return Object.assign({ jobName: entry.displayName, workflowPath: entry.workflow }, entry.provenance, {
    safetyMultiplier: require('./gate-budget.js').SAFETY_MULTIPLIER,
    timeoutMinutes: entry.timeoutMinutes,
    remeasureCommand: '(见 scripts/gate-timeout-sample.js)',
  });
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
  JOB_ID, JOB_NAME,
  get MIN_SAMPLES() { return thresholds().minSamples; },
  get STALE_DAYS() { return thresholds().staleDays; },
  parseJobTimeout, scanTimeoutCells, daysSince, judgeEntry, judgeWorkflow, provenanceOf, main,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
