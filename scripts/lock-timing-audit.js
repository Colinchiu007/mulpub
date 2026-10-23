#!/usr/bin/env node
/**
 * scripts/lock-timing-audit.js — Windows 锁握手相位耗时的 CI 复测入口
 *
 * 为什么要有这个文件：`test-helpers/windows-file-lock.js` 里三段等待预算（启动 / 持锁 / 释放）
 * 的数值原先只有注释里一句"某宿主启动是秒级"——**没量过**。AGENTS.md QM-3 明确要求预算值
 * 必须有实测分布支撑，否则下一次有人觉得"45s 太松，收到 20s"就会把 CI 改成一红一片，
 * 而且症状与真正的锁问题无法区分（这正是"等待没有边界"家族第 8 颗的原始形状）。
 * 本脚本是那条"可复测的路径"：`node scripts/lock-timing-audit.js --json` 直接打印可以粘进
 * `LOCK_BUDGET_PROVENANCE` 的对象，并对照**当前生效的**预算判余量。
 *
 * 用法：
 *   node scripts/lock-timing-audit.js [--runs=26] [--json] [--multiplier=2]
 *                                     [--max-ready=<ms>]   手工覆盖实测值（默认自动采集）
 *
 * 退出码：0 = 采到样本且预算余量成立
 *        3 = 一条样本都没采到 ⇒ **探针瞎了**，绝不判"没问题"（观察者必须报告自己的失明）
 *        4 = 观测最大值吃掉 safetyMultiplier 倍余量 ⇒ 该抬预算，而不是去放宽断言
 *
 * 五条采集坐标坑（前四条都曾让探针"跑得通却零样本"，第五条让它在坐标坏掉时抛裸栈）：
 *   1. Actions 作业对象**没有** `completed` 字段 ⇒ 判完成态一律用 `status === 'completed'`；
 *   2. 日志请求必须**绕开本机代理**（走 7897 时 Actions 日志/产物会失败）；
 *   3. `gh api` 对含 ANSI 转义序列的响应会**拒答**，而 Actions 日志必然含 ANSI
 *      ⇒ 必须带 `--allow-escape-sequences`；
 *   4. 列 run 那一步失败（repo 写错 / 未登录 / 网络）以前抛栈、rc=1，读起来像"脚本坏了"
 *      而不是"没采到" ⇒ 现在并进同一条零样本出口，并把失败坐标一起打出来；
 *   5. **run 列表的服务端 `event`+`status` 参数组合在本仓返回一个被静默截断的窗口**
 *      （2026-10-01 实测：加任一参数，最新一条都停在 2026-09-15，total_count 从 2000+ 掉到
 *      1372），而那个窗口里还没有本夹具 ⇒ 表现为"采不到样本"。所以过滤一律放在客户端做，
 *      并且要**翻页**（最近 100 条 run 里只有约 9 条是 main push，单页会把 --runs 静默缩水）。
 * 另：作业日志只在 run 结束后可取 ⇒ 本工具是**事后复测**（对着已跑完的 main run），不是 PR 内自证。
 *     每次 push 都跑的活体检查在 `windows-file-lock.test.js`（读真实握手的台账）。
 */
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const REPO_REMOTE = process.env.MP_AUDIT_REPO || 'Colinchiu007/mulpub';
// 采样域 = **(workflow, jobName) 二元组**上实测产真实握手行的作业族，不是「我以为跑的那些」，
// 也不是两个独立集合的笛卡尔积。两张轴各自都会独立地漏，且漏掉的读数形状不同：
//
// 轴一 · 作业名（2026-10-20 实测，legacy 无标签档，origin/main 最近 4 趟已完成 main push 的 12 份日志）：
//   QG Coverage count=44 max=17466ms > QG Desktop Shards (2/2) count=16 max=14402ms
//   > QG Desktop Shards (1/2) count=28 max=3773ms。旧值只认 Shards ⇒ 需要最大预算的那个作业根本不在域里。
// 轴二 · workflow（2026-10-21 实测，run 39569099718 / job 119118831343）：
//   `electron-ci.yml` 的 `electron-tests` 作业里 `[windows-file-lock]` 共 11 行，
//   其中 **mock=false 7 行**、real_max=4282ms、real_min=343ms ⇒ 它真跑本夹具并产真实握手。
//   这一维比作业名轴更阴：作业名漏了表现为「样本少」，workflow 漏了**照样打印得出总样本数**，
//   且与「那个 workflow 恰好没跑」逐字同形 —— 上一片把这条写成「域还有第二层没扩」的注释，
//   就是为了让「已完整」不被读成结论；本轮把它转正为登记表的一行。
//
// 因此判据按配对成立：`isProducer(workflow, jobName)`。同名作业出现在别的 workflow 里不算命中
// （`electron-tests` 只在 electron-ci.yml 存在；`QG Coverage` 只在 quality-gate.yml 存在），
// 两个方向的负控都由 apps/desktop/electron/services/windows-file-lock.test.js 锁住。
// ⛔ 不得退化成「扫所有 workflow / 扫所有作业」：那会让样本来源无法归因，provenance 就失去意义。
// ⇒ 结论的适用范围：这里的 max 仍是**下界**（长尾只会因窗口变窄而漏看，不会因「这次没看到」被否证）。
const PRODUCERS = [
  { workflow: 'quality-gate.yml', jobRe: /QG Desktop Shards/ },
  { workflow: 'quality-gate.yml', jobRe: /QG Coverage/ },
  { workflow: 'electron-ci.yml', jobRe: /^electron-tests$/ },
];

/** 判定 (workflow, jobName) 这对坐标是否实测产真握手 —— 缺任一侧一律不命中（不得把 undefined 读成通配） */
function isProducer (workflow, jobName) {
  if (typeof workflow !== 'string' || typeof jobName !== 'string') return false;
  return PRODUCERS.some((p) => p.workflow === workflow && p.jobRe.test(jobName));
}

/** 采集端要逐个取的 workflow 坐标（去重排序，保证每次跑的取证顺序一致） */
function producerWorkflows () {
  return Array.from(new Set(PRODUCERS.map((p) => p.workflow))).sort();
}

/** 从某 workflow 的 jobs 里挑出已完成且在域内的作业 */
function pickProducerJobs (workflow, jobs) {
  return (jobs || []).filter((j) => j && j.status === 'completed' && isProducer(workflow, j.name));
}

function argOf (name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : fallback;
}

const RUNS = Number(argOf('runs', 26));
const MULTIPLIER = Number(argOf('multiplier', 2));
const AS_JSON = process.argv.includes('--json');
// 代理一律清空：带着它取 Actions 日志/产物会失败（本机实测）
const NO_PROXY = Object.assign({}, process.env, {
  HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '',
});

function gh (args, maxBuffer) {
  return execFileSync('gh', args, {
    encoding: 'utf8', maxBuffer: maxBuffer || (1 << 26), env: NO_PROXY,
  });
}
function api (pathname) { return JSON.parse(gh(['api', pathname])); }

/**
 * 夹具模块的单一入口。两处缺失都当场拦：
 *  - 缺 provenance ⇒ 预算成了无出处的数字；
 *  - 缺 parseTimingLine ⇒ 脚本只能自己抄一份行格式，而"打印格式"与"解析格式"分家
 *    正是本次要消除的缺陷（打印一改，脚本静默零样本，零样本又读起来像"没跑过夹具"）。
 */
let cachedHelper = null;
function helper () {
  if (cachedHelper) return cachedHelper;
  const mod = require(path.resolve(__dirname, '..', 'test-helpers', 'windows-file-lock.js'));
  if (!mod.LOCK_BUDGET_PROVENANCE) {
    throw new Error('PROVENANCE_MISSING: 夹具没导出 LOCK_BUDGET_PROVENANCE ⇒ 预算出处这条链已断，复测结果无处对照；这比"采不到样本"更严重，绝不能退回脚本里另写一份 source 文案');
  }
  if (typeof mod.parseTimingLine !== 'function') {
    throw new Error('PARSER_MISSING: 夹具没导出 parseTimingLine ⇒ 握手行格式会有两份事实（打印一份、本脚本一份），两份必然漂移');
  }
  cachedHelper = mod;
  return mod;
}

/** 从**当前源码**读预算：常量漂移时这里跟着变，不会出现"脚本判的是旧预算"这种第二份真相 */
function loadBudget () {
  const mod = helper();
  return {
    readyTimeoutMs: mod.DEFAULT_READY_TIMEOUT_MS,
    provenance: mod.LOCK_BUDGET_PROVENANCE,
  };
}

/**
 * 把一份作业日志拆成三档，**只有 mock=false 那一档算样本**。
 * 三档必须分列：`ready=0ms` 的假握手与"改动之前没有标签的历史行"都不是分布，
 * 但它们各自要说的话完全不同（前者=探针该收紧，后者=窗口还没攒够）。
 * @param {string} text
 * @returns {{samples:number[], mock:number, legacy:number, max:number, legacyMax:number}}
 */
function collectFromLog (text) {
  const mod = helper();
  const out = { samples: [], mock: 0, legacy: 0, max: 0, legacyMax: 0 };
  for (const line of String(text).split('\n')) {
    const parsed = mod.parseTimingLine(line);
    if (!parsed) continue;
    if (parsed.mock === true) { out.mock += 1; continue; }
    if (parsed.mock === null) {
      out.legacy += 1;
      // 无标签行不能当分布（分不清真伪），但它的**最大值**仍是有用的尾部线索：
      // 假握手的 ready 恒为 0，只会压低 max 不会抬高，所以 legacyMax 是可信的下界。
      if (parsed.readyMs > out.legacyMax) out.legacyMax = parsed.readyMs;
      continue;
    }
    out.samples.push(parsed.readyMs);
  }
  if (out.samples.length) out.max = Math.max(...out.samples);
  return out;
}

/**
 * 零样本里「取到了无标签行」那一档的判词（唯一实现）。
 * 为什么要逐作业报：本次改动扩采样域的**动因**就是「旧域排掉了尾部最大的那个作业」，
 * 只报总数等于让下一个人重新去猜尾部落在谁身上。
 * @param {Record<string, {count:number, max:number}>} legacyByJob
 * @returns {string} 空串 = 一条无标签行都没取到 ⇒ 交回 NO_SAMPLES 那一档
 */
function formatLegacyNotice (legacyByJob) {
  const names = Object.keys(legacyByJob || {});
  if (!names.length) return '';
  const total = names.reduce((a, n) => a + legacyByJob[n].count, 0);
  const detail = names
    .sort((a, b) => legacyByJob[b].max - legacyByJob[a].max)
    .map((n) => n + ' count=' + legacyByJob[n].count + ' max=' + legacyByJob[n].max + 'ms')
    .join(' | ');
  return 'LEGACY_ONLY：取到 ' + total + ' 条**无标签**握手行（日志早于 mock 标签上线）'
    + '⇒ 不能当真实分布，等带标签的窗口攒够再复测；逐作业尾部（按 max 降序）：' + detail;
}

/**
 * 列出 wanted 个「main 分支、push 触发、已结束」的 run。
 * 一律**不带**服务端 event/status 过滤（见文件头第 5 条），改为客户端筛 + 翻页。
 * `workflow` 是**坐标参数**而非模块常量：域里有几个 workflow 就要逐个列一遍，
 * 少列一个不会报错，只会让样本悄悄来自一个更小的集合（这正是本轮修的那一维）。
 */
function listRuns (workflow, wanted, errors) {
  const MAX_PAGES = 12;
  const picked = [];
  let pages = 0;
  let scanned = 0;
  for (let page = 1; page <= MAX_PAGES && picked.length < wanted; page++) {
    let list;
    try {
      list = api('repos/' + REPO_REMOTE + '/actions/workflows/' + workflow
        + '/runs?per_page=100&page=' + page);
    } catch (e) {
      errors.push('run-list ' + workflow + ' p' + page + ' ' + String(e.message).replace(/\r?\n/g, ' ').slice(0, 60));
      break;
    }
    pages += 1;
    const rs = list.workflow_runs || [];
    scanned += rs.length;
    for (const r of rs) {
      if (r.event === 'push' && r.head_branch === 'main' && r.status === 'completed') picked.push(r);
    }
    if (rs.length < 100) break; // 已到末页
  }
  return { runs: picked.slice(0, wanted), pages, scanned };
}

function collect () {
  const errors = [];
  // 按 workflow 分面记账：覆盖不足必须**点名是哪一条轴缺**，
  // 合并总数会把「electron-ci 一个 run 都没列到」摊进「quality-gate 采了 20 个」里读成整体够用。
  const perWorkflow = new Map();
  const runs = [];
  let pages = 0;
  for (const wf of producerWorkflows()) {
    const listed = listRuns(wf, RUNS, errors);
    perWorkflow.set(wf, { listed: listed.runs.length, pages: listed.pages, short: listed.runs.length < RUNS });
    pages += listed.pages;
    for (const r of listed.runs) runs.push(Object.assign({}, r, { workflow: wf }));
    if (listed.runs.length < RUNS) {
      errors.push('only-' + listed.runs.length + '-of-' + RUNS + '-runs ' + wf + ' in ' + listed.pages + ' pages');
    }
  }
  const shortWorkflows = producerWorkflows().filter((wf) => perWorkflow.get(wf).short);
  if (shortWorkflows.length) {
    const detail = shortWorkflows.map((wf) => wf + '=' + perWorkflow.get(wf).listed + '/' + RUNS).join(' ');
    console.warn('PARTIAL: 覆盖不足的 workflow 轴 ⇒ ' + detail
      + '（pages 合计=' + pages + '）⇒ 用这份数字回填 provenance 前先加大 --runs 或缩小结论适用范围');
  }

  const ready = [];
  let jobs = 0;
  let mockLines = 0;
  let legacyLines = 0;
  const byJob = new Map();
  const legacyByJob = new Map();
  for (const run of runs) {
    let jobsResp;
    try { jobsResp = api('repos/' + REPO_REMOTE + '/actions/runs/' + run.id + '/jobs'); }
    catch (e) { errors.push('jobs ' + run.id); continue; }
    const shardJobs = pickProducerJobs(run.workflow, jobsResp.jobs);
    if (!shardJobs.length) errors.push('no-producer-job run=' + run.id + ' wf=' + run.workflow);
    for (const job of shardJobs) {
      let body = '';
      try {
        body = gh(['api', '--allow-escape-sequences',
          'repos/' + REPO_REMOTE + '/actions/jobs/' + job.id + '/logs'], 1 << 28);
      } catch (e) {
        errors.push('log ' + job.id + ' ' + String(e.message).replace(/\r?\n/g, ' ').slice(0, 40));
        continue;
      }
      const got = collectFromLog(body);
      const n = got.samples.length;
      ready.push(...got.samples);
      mockLines += got.mock;
      legacyLines += got.legacy;
      // 无标签行必须**在 n===0 的早退之前**按作业累加：标签上线前的那一整趟复测里，
      // 每个作业都是 n===0，而那恰恰是本次改动动因（旧采样域排掉了尾部最大的作业）唯一的现场来源。
      if (got.legacy > 0) {
        const key = run.workflow + '/' + job.name;
        const prev = legacyByJob.get(key) || { count: 0, max: 0 };
        legacyByJob.set(key, { count: prev.count + got.legacy, max: Math.max(prev.max, got.legacyMax) });
      }
      if (n === 0) {
        // 分档出声：同样本为 0，"全是 mock 假握手"与"这个作业压根没跑夹具"是两件事，
        // 后者意味着采样域漂了（前者的成因见测试里那条「标记不等于效果」）。
        errors.push('no-sample job=' + job.id + ' wf=' + run.workflow + ' mock=' + got.mock + ' legacy=' + got.legacy);
        continue;
      }
      jobs += 1;
      // 键里带 workflow 坐标：同名作业分属两个 workflow 时，「样本来自哪个坐标」必须仍然可读，
      // 否则 by_job 里的一个数会被读成「这个作业名贡献的」而分不清来源。
      byJob.set(run.workflow + '/' + job.name, (byJob.get(run.workflow + '/' + job.name) || 0) + n);
      // 逐 run 留痕：这个工具要跑几分钟，没有中间现场就分不清"还在采"与"被杀了"
      //（2026-10-01 实测：--runs=26 一次以 rc=1 退出且 stdout/stderr 全空，无法归因）
      console.error('[lock-timing-audit] run=' + run.id + ' wf=' + run.workflow + ' job=' + job.id
        + ' samples+=' + n + ' mock+=' + got.mock + ' legacy+=' + got.legacy
        + ' total=' + ready.length);
    }
  }
  ready.sort((a, b) => a - b);
  return {
    ready, runCount: runs.length, jobs, pages, errors, shortWorkflows,
    mockLines, legacyLines, byJob: Object.fromEntries(byJob),
    legacyByJob: Object.fromEntries(legacyByJob),
  };
}

function main () {
  let budget;
  try {
    budget = loadBudget();
  } catch (e) {
    console.error('PROVENANCE_MISSING：读不到预算出处 ⇒ ' + String(e.message).split(/\r?\n/)[0].slice(0, 140));
    process.exitCode = 5;
    return;
  }
  let ready;
  let runCount;
  let jobs;
  let pages = 1;
  let errors = [];
  let mockLines = 0;
  let legacyLines = 0;
  let byJob = {};
  let legacyByJob = {};
  let shortWorkflows = [];

  const manual = argOf('max-ready', null);

  if (manual !== null) {
    ready = [Number(manual)];
    runCount = Number(argOf('runs', 1));
    jobs = Number(argOf('jobs', 1));
  } else {
    const got = collect();
    ready = got.ready; runCount = got.runCount; jobs = got.jobs; errors = got.errors;
    pages = got.pages;
    shortWorkflows = got.shortWorkflows;
    mockLines = got.mockLines; legacyLines = got.legacyLines; byJob = got.byJob;
    legacyByJob = got.legacyByJob;
  }

  if (!ready.length) {
    // 零样本必须出声并点名坐标：一次"采不到"被读成"没问题"，等于把门禁换成一盏恒绿的灯。
    // 但"零样本"底下有两种完全不同的成因，修法也相反 —— 这里分档报，不得混成一句话：
    //   legacy>0 ⇒ 日志早于本次改动（历史行没标签），要等窗口攒够，不是坐标坏了；
    //   mock>0 且 legacy=0 ⇒ 域里有作业在跑夹具却只产出假握手，要去看采样域/打印点。
    const legacyNotice = formatLegacyNotice(legacyByJob);
    const cause = legacyNotice || 'NO_SAMPLES：一条握手样本都没采到 ⇒ 探针坐标可能过期'
      + '（workflow 名 / job 名 / status 字段 / 代理 / ANSI 拒答 / gh 登录态 / 服务端过滤截断）';
    console.error(cause);
    // 坐标必须整域打印：只印一个 workflow 名会把「另一个坐标坏了」读成「整域都没跑」，
    // 而两者的修法相反（前者查那个 workflow 的 job 名，后者查 gh 登录态/代理）。
    console.error('       MP_AUDIT_REPO=' + REPO_REMOTE + ' domain=' + producerWorkflows().join(',')
      + ' pages=' + pages + ' runs_total=' + runCount
      + ' mock_lines=' + mockLines + ' legacy_lines=' + legacyLines
      + ' errors=' + errors.slice(0, 8).join(' , '));
    process.exitCode = 3;
    return;
  }

  const maxObservedReadyMs = ready[ready.length - 1];
  const provenance = {
    maxObservedReadyMs,
    samples: ready.length,
    runs: runCount,
    jobs,
    safetyMultiplier: MULTIPLIER,
    collectedAt: new Date().toISOString().slice(0, 10),
    // 唯一真源：夹具导出的那一句。曾经这里还有"取不到就用脚本内硬编码文案"的分支，
    // 那是让同一份出处存在两个版本 —— 现在 loadBudget 会先以 PROVENANCE_MISSING 拦停。
    source: budget.provenance.source,
  };

  if (AS_JSON) {
    console.log(JSON.stringify(provenance, null, 2));
  } else {
    const p50 = ready[Math.floor(ready.length / 2)];
    console.log('[lock-timing-audit] domain=' + producerWorkflows().join(',')
      + (shortWorkflows.length ? ' SHORT(' + shortWorkflows.join(',') + ')' : '')
      + ' pages=' + pages + ' runs_total=' + runCount + ' jobs=' + jobs
      + ' samples=' + ready.length + ' mock_lines=' + mockLines + ' legacy_lines=' + legacyLines
      + ' by_job=' + JSON.stringify(byJob)
      + ' ready.p50=' + p50 + 'ms ready.max=' + maxObservedReadyMs
      + 'ms errors=' + errors.length);
    console.log('当前 DEFAULT_READY_TIMEOUT_MS=' + budget.readyTimeoutMs
      + '，要求 ≥ max×' + MULTIPLIER + '=' + maxObservedReadyMs * MULTIPLIER);
  }

  if (budget.readyTimeoutMs < maxObservedReadyMs * MULTIPLIER) {
    console.error('BUDGET_TOO_TIGHT: 启动预算 ' + budget.readyTimeoutMs + 'ms < 实测最大 '
      + maxObservedReadyMs + 'ms × ' + MULTIPLIER
      + ' ⇒ 该抬预算（并同步 LOCK_CASE_TIMEOUT_MS 的消费方），不得反过来放宽断言');
    process.exitCode = 4;
    return;
  }
  console.log('OK: 预算余量成立（headroom='
    + (budget.readyTimeoutMs / maxObservedReadyMs).toFixed(2) + '×）');
}

if (require.main === module) main();

module.exports = {
  collect, collectFromLog, formatLegacyNotice, loadBudget,
  PRODUCERS, isProducer, producerWorkflows, pickProducerJobs,
};
