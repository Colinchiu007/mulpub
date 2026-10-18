// QG Coverage 时长分布的**复测入口**（AGENTS「实测分布支撑必须自带一条可重跑的采集路径」的落点）。
//
// 它存在的理由不是"今天量过一次"，而是让下一次调预算的人能一句话重取；
// 因此它的输出字段集与 `scripts/lib/coverage-budget-provenance.js` 逐字同源，
// 由 `check-coverage-budget.test.js` 第 7 条锁钉住 —— 字段漂移的 provenance 读起来完全像有效。
//
// 三条判据纪律（都在代码里，不在注释里）：
//   ① 坐标按**数字 workflow id** 取：`/actions/workflows/quality-gate.yml/jobs` 与
//      `/actions/workflows/<id>/jobs` 在本机 gh 下实测一律 404（5 种参数形态全试），
//      而 `/actions/runs/<id>/jobs` 正常 —— 后者只返回**最新 attempt**，那正是决定该 check 的那趟。
//   ② `probe_errors` 必须打印且非零即失败：不完整的遍历判定全绿是假绿。
//   ③ 采不到样本一律非零码出声，不得返回一张空表让人读成"没有长尾"。
'use strict';

const { execFileSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const REPO = 'Colinchiu007/mulpub';
const JOB_NAME = 'QG Coverage';
const WORKFLOW_FILE = 'quality-gate.yml';
const WORKFLOW_PATH = '.github/workflows/quality-gate.yml';
const STATIC = require(path.join(__dirname, 'lib', 'coverage-budget-provenance.js'));

function ghJson(args) {
  const out = execFileSync('gh', args, { encoding: 'utf8', maxBuffer: 1 << 27 });
  if (!out || out.trim().length === 0) throw new Error('empty_payload');
  return JSON.parse(out);
}

function percentile(sorted, p) {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p));
  return sorted[idx];
}

/**
 * 把逐 run 的读数折成 provenance。字段集必须与 PROVENANCE 逐字一致（第 7 条锁）。
 * @param {Array<{min:number,concl:string}>} rows
 * @param {{runsListed:number, collectedAt:string, ceilingMinutes?:number}} meta
 */
function buildProvenance(rows, meta) {
  // `skipped` 是**按设计跳过**（docs-only PR 会短路整个作业），它时长为 0 但不是样本缺失；
  // 把它混进过滤条件会让"剔除了多少"这件事不可见，下一次读到 `samples` 的人无法判断分母。
  const active = (rows || []).filter((r) => r && r.concl !== 'skipped');
  const timed = active.filter((r) => typeof r.min === 'number' && r.min > 0);
  const succ = timed.filter((r) => r.concl === 'success').map((r) => r.min).sort((a, b) => a - b);
  const maxAll = timed.length ? Math.max(...timed.map((r) => r.min)) : 0;
  // 天花板必须显式给定或从 workflow 现值取，**不得用"观测到的最大值"代替**：
  // 一旦有一趟成功贴着天花板过线（今天就是 39.7 分），max-as-ceiling 会把真正被杀的那两趟
  // 全部读成 0，于是判据最关键的输入自己失效。
  const ceiling = typeof meta.ceilingMinutes === 'number' ? meta.ceilingMinutes : maxAll;
  // 「被天花板裁掉」只数**没跑完就被杀**的那些趟（贴天花板 ±0.5 分钟）；
  // 手动取消 / 被新 push 顶掉不算，否则把「有人按了停止」读成「预算不够」。
  const censored = timed.filter((r) => r.concl === 'cancelled' && ceiling - r.min <= 0.5).length;

  return {
    jobName: JOB_NAME,
    workflowPath: WORKFLOW_PATH,
    collectedAt: meta.collectedAt,
    runsListed: meta.runsListed,
    samples: succ.length,
    maxMinutes: succ.length ? +succ[succ.length - 1].toFixed(1) : 0,
    p90Minutes: +percentile(succ, 0.9).toFixed(1),
    censoredAtCeiling: censored,
    ceilingMinutesSampled: ceiling,
    safetyMultiplier: STATIC.SAFETY_MULTIPLIER,
    timeoutMinutes: STATIC.TIMEOUT_MINUTES,
    remeasureCommand: STATIC.PROVENANCE.remeasureCommand,
  };
}

function summarize(rows) {
  const list = rows || [];
  const skipped = list.filter((r) => r && r.concl === 'skipped').length;
  const active = list.filter((r) => r && r.concl !== 'skipped');
  const timed = active.filter((r) => typeof r.min === 'number' && r.min > 0);
  const noDuration = active.length - timed.length;
  const succ = timed.filter((r) => r.concl === 'success').map((r) => r.min).sort((a, b) => a - b);
  return {
    rows: list.length,
    skipped,
    active: active.length,
    noDuration,
    withDuration: timed.length,
    samples: succ.length,
    hasData: succ.length > 0,
    maxMinutes: succ.length ? succ[succ.length - 1] : null,
  };
}

/** 只读取证：逐 run 拉作业，按名筛 QG Coverage。网络/gh 不可用时抛错，由调用方计入 probe_errors。 */
function collect(maxRuns) {
  const runs = ghJson(['run', 'list', '-R', REPO, '--workflow=' + WORKFLOW_FILE,
    '--limit', String(maxRuns), '--json', 'databaseId,event,conclusion'])
    .filter((r) => r && r.databaseId);
  const rows = [];
  let probeErrors = 0;
  let missingJob = 0;
  for (const r of runs) {
    let jobs;
    try {
      jobs = ghJson(['api', `repos/${REPO}/actions/runs/${r.databaseId}/jobs`]).jobs || [];
    } catch (e) {
      probeErrors++;
      continue;
    }
    const j = jobs.find((x) => x.name === JOB_NAME);
    if (!j) { missingJob++; continue; }
    // 取不到时长也要**记进样本表**（min=null），由 summarize 报成 `取不到时长` ——
    // 在这里 continue 掉会让"漏样"与"没有长尾"在现场同形。
    const has = Boolean(j.started_at && j.completed_at);
    rows.push({
      run: r.databaseId, event: r.event, concl: j.conclusion, attempt: j.run_attempt,
      min: has ? +(((new Date(j.completed_at) - new Date(j.started_at)) / 60000).toFixed(1)) : null,
    });
  }
  return { rows, runsListed: runs.length, probeErrors, missingJob };
}

function main(argv) {
  const args = argv || [];
  const limitArg = args.find((a) => a.indexOf('--limit=') === 0);
  const ceilingArg = args.find((a) => a.indexOf('--ceiling=') === 0);
  const positional = args.find((a) => /^\d+$/.test(a));
  const maxRuns = limitArg ? Number(limitArg.slice('--limit='.length))
    : (Number(positional || 60));
  if (!Number.isFinite(maxRuns) || maxRuns <= 0) {
    console.error('[COVERAGE-BUDGET] maxRuns 必须是正整数（不许静默忽略参数）');
    return 2;
  }
  let ceilingMinutes;
  if (ceilingArg) {
    ceilingMinutes = Number(ceilingArg.slice('--ceiling='.length));
    if (!Number.isFinite(ceilingMinutes) || ceilingMinutes <= 0) {
      console.error('[COVERAGE-BUDGET] --ceiling 必须是正数（采样窗口内实际生效的那条天花板）');
      return 2;
    }
  } else {
    // 默认取 workflow 现值：语义是"今天这条天花板杀没杀过人"。
    // 要回答"上一代天花板杀了几趟"（本次定数的依据），必须显式传 --ceiling=40。
    const judge = require(path.join(__dirname, 'check-coverage-budget.js'));
    try {
      const text = fs.readFileSync(path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml'), 'utf8');
      ceilingMinutes = judge.parseJobTimeout(text, judge.JOB_ID);
    } catch (e) { ceilingMinutes = null; }
    if (ceilingMinutes === null) {
      console.error('[COVERAGE-BUDGET] 取不到 workflow 现值当天花板，且未显式传 --ceiling ⇒ 判据自身故障');
      return 2;
    }
  }
  let got;
  try {
    got = collect(maxRuns);
  } catch (e) {
    console.error('[COVERAGE-BUDGET] 采集自身失败：' + String(e.message || e).slice(0, 200));
    return 2;
  }
  const date = new Date().toISOString().slice(0, 10);
  const built = buildProvenance(got.rows, {
    runsListed: got.runsListed, collectedAt: date, ceilingMinutes,
  });
  const sum = summarize(got.rows);
  console.log('[COVERAGE-BUDGET] workflow=' + WORKFLOW_FILE + ' repo=' + REPO +
    ' runs_listed=' + got.runsListed + ' 有该作业=' + sum.rows +
    ' 按设计跳过=' + sum.skipped + ' 活跃=' + sum.active +
    ' 取不到时长=' + sum.noDuration +
    ' 有时长=' + sum.withDuration + ' 无该作业=' + got.missingJob +
    ' probe_errors=' + got.probeErrors + ' ceiling=' + ceilingMinutes);
  console.log('[COVERAGE-BUDGET] 候选 provenance = ' + JSON.stringify(built));
  if (got.probeErrors > 0) {
    console.error('[COVERAGE-BUDGET] 采集不完整（probe_errors>0），本次读数不得用于调预算');
    return 2;
  }
  if (sum.noDuration > 0) {
    console.error('[COVERAGE-BUDGET] 有 ' + sum.noDuration +
      ' 趟活跃作业取不到时长 —— 这是取数漏样，不是"没有长尾"，先修采集再谈预算');
    return 2;
  }
  if (!sum.hasData) {
    console.error('[COVERAGE-BUDGET] 零样本：这是"没采到"，不是"没有长尾"');
    return 1;
  }
  console.log('[COVERAGE-BUDGET] OK samples=' + built.samples +
    ' max=' + built.maxMinutes + ' p90=' + built.p90Minutes +
    ' censored_at_ceiling=' + built.censoredAtCeiling);
  return 0;
}

module.exports = { buildProvenance, summarize, collect, main, JOB_NAME, WORKFLOW_PATH };

if (require.main === module) process.exit(main(process.argv.slice(2)));
