// 全仓 CI 作业时长分布的**复测入口**（AGENTS「实测分布支撑必须自带一条可重跑的采集路径」的落点）。
//
// 它存在的理由不是"今天量过一次"，而是让下一次调预算的人能一句话重取；
// 因此它的输出字段集与 `scripts/lib/gate-timeout-registry.js` 的 PROVENANCE 逐字同源，
// 由 `check-coverage-budget.test.js` 第 12 条锁钉住 —— 字段漂移的 provenance 读起来完全像有效。
//
// 2026-10-20（change: gate-timeout-all-cells）：治理面从 1 格扩到全仓 24 格，本文件随之从
// "量 QG Coverage" 升格为"量注册表里任意一格"：
//   `node scripts/coverage-budget-sample.js --limit=60`                   ← 全仓（按注册表逐格）
//   `node scripts/coverage-budget-sample.js --workflow=quality-gate.yml --job=QG Coverage --limit=120`
// 矩阵作业（`QG Desktop Shards (1/2)`）按去掉 `(n/m)` 后缀归并；模板名作业
// （`Autonomous Loop (迭代 ${{ inputs.rounds }} 轮)`）按注册表里声明的 `samplerPattern` 前缀归并 ——
// 这两类名字不归并就会被读成"没有样本"，而"没采到"和"没有长尾"必须分得开。
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
// 走 shim 或直接走注册表都一样：shim 只转发，不持有数值。
const STATIC = require(path.join(__dirname, 'lib', 'gate-timeout-registry.js'));

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
    jobName: meta.jobName || JOB_NAME,
    workflowPath: meta.workflowPath || WORKFLOW_PATH,
    collectedAt: meta.collectedAt,
    runsListed: meta.runsListed,
    samples: succ.length,
    maxMinutes: succ.length ? +succ[succ.length - 1].toFixed(1) : 0,
    p90Minutes: +percentile(succ, 0.9).toFixed(1),
    censoredAtCeiling: censored,
    ceilingMinutesSampled: ceiling,
    safetyMultiplier: STATIC.SAFETY_MULTIPLIER,
    timeoutMinutes: typeof meta.timeoutMinutes === 'number' ? meta.timeoutMinutes : STATIC.TIMEOUT_MINUTES,
    remeasureCommand: meta.remeasureCommand || STATIC.PROVENANCE.remeasureCommand,
  };
}

/**
 * 「在飞」与「漏样」是两件事，必须分开数（2026-10-19，change: coverage-budget-inflight）。
 *
 * 现场：`--limit=60` 连续三次以「有 8~9 趟活跃作业取不到时长 —— 这是取数漏样…先修采集再谈预算」
 * rc=2 拒绝；逐 run 取证后那 8~9 趟**全部是 queued / in_progress**（还没跑完，本来就没有
 * completed_at），同一窗口里「已完成却无时长」的真漏样是 **0 趟**。
 * 旧口径把两者混成一格 ⇒ 只要仓库上有 CI 在跑就永远拒绝采样，预算常量于是**永远调不了**。
 * 这不是 fail-closed，是把「还没观测到」混同成「观测失败」。
 *
 * 反向**不许**借这条放宽：`completed` 却无时长仍是漏样，照样阻断 ——
 * 否则漏样会被读成「没有长尾」，那才是这一格原本要防的形态。
 */
function isInFlight(row) {
  return Boolean(row && row.status && row.status !== 'completed');
}

function summarize(rows) {
  const list = rows || [];
  const skipped = list.filter((r) => r && r.concl === 'skipped').length;
  const active = list.filter((r) => r && r.concl !== 'skipped');
  const inFlight = active.filter(isInFlight).length;
  const settled = active.filter((r) => !isInFlight(r));
  const timed = settled.filter((r) => typeof r.min === 'number' && r.min > 0);
  // noDuration 只描述**已跑完却没读到时长**的漏样；在飞单独占 inFlight 一格。
  const noDuration = settled.length - timed.length;
  const succ = timed.filter((r) => r.concl === 'success').map((r) => r.min).sort((a, b) => a - b);
  return {
    rows: list.length,
    skipped,
    active: active.length,
    inFlight,
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
    // 取不到时长也要**记进样本表**（min=null），由 summarize 分档报出 ——
    // 在这里 continue 掉会让"漏样"与"没有长尾"在现场同形。
    // status 必须一起带上：没有它，"在飞（还没跑完）"与"跑完了却没时长"在数据层就分不开，
    // 而这两类的处置完全相反（前者不算漏样、后者必须阻断）。
    const has = Boolean(j.started_at && j.completed_at);
    rows.push({
      run: r.databaseId, event: r.event, concl: j.conclusion, attempt: j.run_attempt,
      status: j.status,
      min: has ? +(((new Date(j.completed_at) - new Date(j.started_at)) / 60000).toFixed(1)) : null,
    });
  }
  return { rows, runsListed: runs.length, probeErrors, missingJob };
}

/** 矩阵作业的 GitHub 名带 `(1/2)` / `(2/2)` 后缀，归并到同一格再统计。 */
function stripMatrix(name) {
  return String(name || '').replace(/\s*\(\d+\/\d+\)\s*$/, '').trim();
}

/**
 * 注册表条目 → GitHub 作业名匹配器。
 * 两条真实形态逼出来的：
 *   · 矩阵（`QG Desktop Shards (1/2)`）—— 后缀必须剥掉，否则样本恒为 0；
 *   · 模板名（`Autonomous Loop (迭代 3 轮)`，声明里是 `${{ inputs.rounds }}`）——
 *     只能靠 `samplerPattern` 静态前缀，正名匹配永远匹配不到。
 * 匹配不到就会报 NO_SAMPLE，那和"这些作业没有长尾"在现场长得一样，所以宁可在注册表里
 * 显式声明 `samplerPattern`，也不写"尽力猜"的模糊匹配。
 */
function matcherFor(entry) {
  if (entry && typeof entry.samplerPattern === 'string' && entry.samplerPattern.trim()) {
    const prefix = entry.samplerPattern.trim();
    return (name) => String(name || '').startsWith(prefix);
  }
  const want = entry && entry.displayName;
  return (name) => stripMatrix(name) === want || String(name || '') === want;
}

/**
 * 逐 run 拉作业并筛出**某一格**的读数。矩阵兄弟在一趟里会有多条，全部收进来
 * （它们共享同一条天花板，缺一半会把分布截掉一条腿）。
 */
function collectForWorkflow(workflowFile, maxRuns, entry) {
  const runs = ghJson(['run', 'list', '-R', REPO, '--workflow=' + workflowFile,
    '--limit', String(maxRuns), '--json', 'databaseId,event,conclusion'])
    .filter((r) => r && r.databaseId);
  const match = matcherFor(entry);
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
    const hits = jobs.filter((x) => match(x.name));
    if (hits.length === 0) { missingJob++; continue; }
    for (const j of hits) {
      const has = Boolean(j.started_at && j.completed_at);
      rows.push({
        run: r.databaseId, event: r.event, concl: j.conclusion, attempt: j.run_attempt,
        status: j.status,
        min: has ? +(((new Date(j.completed_at) - new Date(j.started_at)) / 60000).toFixed(1)) : null,
      });
    }
  }
  return { rows, runsListed: runs.length, probeErrors, missingJob };
}

/** 按注册表挑出本次要采的格子（--workflow / --job 过滤；不传则全仓）。 */
function targetsFromRegistry(reg, opts) {
  const o = opts || {};
  const wfFilter = o.workflows && o.workflows.length ? o.workflows : null;
  const jobFilter = o.job || null;
  return reg.jobs.filter((j) => {
    const wfBase = j.workflow.replace(/^\.github\/workflows\//, '');
    if (wfFilter && !wfFilter.some((w) => w === wfBase || w === j.workflow)) return false;
    if (jobFilter && jobFilter !== j.displayName && jobFilter !== j.jobId) return false;
    return true;
  });
}

/**
 * 退出码决策的**单一真源**（2026-10-19，change: coverage-budget-inflight）。
 *
 * 为什么抽成纯函数：上一版的阻断判断是 main() 里的一行 `if (sum.noDuration > 0)`，
 * 而锁只能对它做正则结构断言 —— 实测 `if (false && sum.noDuration > 0)` 这种架空写法
 * **完全逃过**结构锁（M3 变异反证当场没红，见 openspec 记录的「NOT_CAUGHT 留痕」段）。
 * 把决策抽出来之后，"漏样到底阻不阻断"变成可被行为断言钉死的形状，
 * 而不是一句能被短路符绕过的条件。
 *
 * 分档语义：
 *   2 = 采集不可信（probe 失败 / **已跑完**却无时长的真漏样）
 *   1 = 采到了但零成功样本（"没采到"不是"没有长尾"）
 *   0 = 可用于调预算
 * `inFlight` **不参与**任何一档：在飞作业还没跑完，它不是漏样，也不是样本。
 */
function refusalCode(sum, probeErrors) {
  if (probeErrors > 0) return 2;
  if (sum && sum.noDuration > 0) return 2;
  if (!sum || !sum.hasData) return 1;
  return 0;
}

function main(argv) {
  const args = argv || [];
  const limitArg = args.find((a) => a.indexOf('--limit=') === 0);
  const ceilingArg = args.find((a) => a.indexOf('--ceiling=') === 0);
  const wfArgs = args.filter((a) => a.indexOf('--workflow=') === 0).map((a) => a.slice('--workflow='.length));
  const jobArg = args.find((a) => a.indexOf('--job=') === 0);
  const positional = args.find((a) => /^\d+$/.test(a));
  const maxRuns = limitArg ? Number(limitArg.slice('--limit='.length))
    : (Number(positional || 60));
  if (!Number.isFinite(maxRuns) || maxRuns <= 0) {
    console.error('[GATE-TIMEOUT] maxRuns 必须是正整数（不许静默忽略参数）');
    return 2;
  }
  let ceilingOverride;
  if (ceilingArg) {
    ceilingOverride = Number(ceilingArg.slice('--ceiling='.length));
    if (!Number.isFinite(ceilingOverride) || ceilingOverride <= 0) {
      console.error('[GATE-TIMEOUT] --ceiling 必须是正数（采样窗口内实际生效的那条天花板）');
      return 2;
    }
  }

  let reg;
  try {
    reg = STATIC.loadRegistry();
  } catch (e) {
    console.error('[GATE-TIMEOUT] 注册表不可用，拒绝采样：' + String(e.message || e).slice(0, 200));
    return 2;
  }
  const targets = targetsFromRegistry(reg, {
    workflows: wfArgs,
    job: jobArg ? jobArg.slice('--job='.length) : null,
  });
  if (targets.length === 0) {
    console.error('[GATE-TIMEOUT] --workflow/--job 过滤后没有任何登记项（不静默返回空表）');
    return 2;
  }

  const date = new Date().toISOString().slice(0, 10);   // UTC 日期，与注册表口径逐字一致
  const candidates = [];
  let probeErrors = 0;
  let gaps = 0;
  let zeroSample = 0;
  for (const entry of targets) {
    const wfBase = entry.workflow.replace(/^\.github\/workflows\//, '');
    let got;
    try {
      got = collectForWorkflow(wfBase, maxRuns, entry);
    } catch (e) {
      console.error('[GATE-TIMEOUT] ' + entry.workflow + '#' + entry.jobId + ' 采集自身失败：' +
        String(e.message || e).slice(0, 200));
      probeErrors++;
      continue;
    }
    probeErrors += got.probeErrors;
    const ceilingMinutes = ceilingOverride !== undefined ? ceilingOverride : entry.timeoutMinutes;
    const sum = summarize(got.rows);
    const built = buildProvenance(got.rows, {
      runsListed: got.runsListed,
      collectedAt: date,
      ceilingMinutes,
      jobName: entry.displayName,
      workflowPath: entry.workflow,
      timeoutMinutes: ceilingOverride !== undefined ? entry.timeoutMinutes : entry.timeoutMinutes,
      remeasureCommand: 'node scripts/coverage-budget-sample.js --workflow=' + wfBase +
        ' --job=' + entry.jobId + ' --limit=' + maxRuns,
    });
    if (sum.noDuration > 0) gaps += sum.noDuration;
    if (!sum.hasData) zeroSample++;
    console.log('[GATE-TIMEOUT] ' + (entry.workflow + '#' + entry.jobId).padEnd(54) +
      ' workflow=' + wfBase + ' runs_listed=' + got.runsListed + ' 有该作业=' + sum.rows +
      ' 按设计跳过=' + sum.skipped + ' 活跃=' + sum.active +
      ' in_flight=' + sum.inFlight +
      ' 取不到时长=' + sum.noDuration +
      ' 有时长=' + sum.withDuration + ' 无该作业=' + got.missingJob +
      ' probe_errors=' + got.probeErrors + ' ceiling=' + ceilingMinutes);
    if (sum.hasData) candidates.push(built);
    else {
      console.error('[GATE-TIMEOUT] ' + entry.workflow + '#' + entry.jobId +
        ' 零成功样本 —— 这是"没采到"，不是"没有长尾"（窗口太小或该作业本窗口全在飞/被杀）');
    }
  }

  // 决策只认 refusalCode（单一真源）；这里仅负责把对应的话说清楚。
  const refusal = refusalCode({ noDuration: gaps, hasData: candidates.length > 0 }, probeErrors);
  if (refusal === 2 && probeErrors > 0) {
    console.error('[GATE-TIMEOUT] 采集不完整（probe_errors=' + probeErrors + '），本次读数不得用于调预算');
    return 2;
  }
  if (refusal === 2) {
    console.error('[GATE-TIMEOUT] 有 ' + gaps +
      ' 趟**已跑完**却取不到时长 —— 这是取数漏样，不是"没有长尾"，先修采集再谈预算' +
      '（在飞趟数已单列，不计入此列：它们还没跑完，不是漏样）');
    return 2;
  }
  if (refusal === 1) return 1;

  console.log('[GATE-TIMEOUT] 候选注册表条目（逐格 JSON，直接替换 registry.jobs 里同名项；' +
    '零样本的格子未列出）：');
  console.log(JSON.stringify(candidates, null, 2));
  console.log('[GATE-TIMEOUT] OK 采到 ' + candidates.length + '/' + targets.length + ' 格；零样本=' + zeroSample +
    '；probe_errors=' + probeErrors + '；collectedAt=' + date);
  return zeroSample > 0 ? 1 : 0;
}

module.exports = {
  buildProvenance, summarize, collect, main, refusalCode, JOB_NAME, WORKFLOW_PATH,
  stripMatrix, matcherFor, collectForWorkflow, targetsFromRegistry,
};

if (require.main === module) process.exit(main(process.argv.slice(2)));
