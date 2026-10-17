#!/usr/bin/env node
/**
 * scripts/case-timeout-audit.js — 「CLI 端到端」用例级预算的 CI 复测入口
 *
 * 为什么要有这个文件：`apps/desktop/tests/gui-cli-e2e-budget.js` 里那条预算（60000ms）的数值
 * 必须有**实测分布**支撑，否则下一次有人觉得"60s 太松，收到 20s"就把 CI 改成一红一片，
 * 而且症状与真正的判据问题无法区分。本脚本是那条可重取的路径：
 * `node scripts/case-timeout-audit.js --json` 打印可直接粘进
 * `GUI_CLI_E2E_BUDGET_PROVENANCE` 的对象，并对照**当前生效的**预算判余量。
 *
 * 用法：
 *   node scripts/case-timeout-audit.js [--runs=10] [--json] [--multiplier=4]
 *                                      [--max-observed=<ms>]   手工覆盖实测值（默认自动采集）
 *
 * 退出码：0 = 采到样本且预算余量成立
 *        3 = 一条样本都没采到 ⇒ **探针瞎了**，绝不判"没问题"（观察者必须报告自己的失明）
 *        4 = 观测最大值吃掉 safetyMultiplier 倍余量 ⇒ 该抬预算，而不是去放宽断言
 *        5 = 读不到预算出处（常量被改名/删除）⇒ 比"采不到样本"更严重，脚本不提供第二份真相
 *
 * 六条采集坐标坑（前五条继承 scripts/lock-timing-audit.js 的实测，第六条是本轮新踩）：
 *   1. Actions 作业对象**没有** `completed` 字段 ⇒ 判完成态一律用 `status === 'completed'`；
 *   2. 日志请求必须**绕开本机代理**（带 7897 时 Actions 日志/产物会失败）；
 *   3. `gh api` 对含 ANSI 转义序列的响应会**拒答** ⇒ 必须带 `--allow-escape-sequences`；
 *   4. 列 run 那一步失败（repo 写错 / 未登录 / 网络）不能抛裸栈（rc=1 读起来像"脚本坏了"
 *      而不是"没采到"）⇒ 并进同一条零样本出口，并把失败坐标一起打出来；
 *   5. **run 列表的服务端 `event`+`status` 参数组合在本仓返回被静默截断的窗口**
 *      ⇒ 过滤一律放客户端做，并且要**翻页**（单页会把 --runs 静默缩水）；
 *   6. vitest 的 verbose 行**本身带 ANSI**（`\u001b[90m✓\u001b[22m …`），所以把日志正文原样喂给
 *      按子串匹配的探针会得到 0 命中 ⇒ 必须先剥 ANSI 再解析。本轮实测：同一份 14MB 日志
 *      未剥 ANSI `rawHits=0`、剥后 `cleanHits=1 values=11097`。**"0 命中"在这里不是"没有长尾"，
 *      是探针瞎了** —— 所以零样本出口必须是 rc=3 而不是 rc=0。
 * 另：作业日志只在 run 结束后可取 ⇒ 本工具是**事后复测**（对着已跑完的 main run），不是 PR 内自证。
 *     每次跑都留现场的是 gui-ci-exit-contract.test.js 里的台账断言。
 */
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const budget = require(path.resolve(__dirname, '..', 'apps', 'desktop', 'tests', 'gui-cli-e2e-budget.js'));

const REPO_REMOTE = process.env.MP_AUDIT_REPO || 'Colinchiu007/mulpub';
const WORKFLOW = 'quality-gate.yml';
const JOB_RE = /QG Desktop Shards/;
const ESC = String.fromCharCode(27);

function argOf(name, fallback) {
  const hit = process.argv.slice(2).find((a) => a.startsWith('--' + name + '='));
  return hit ? hit.split('=')[1] : fallback;
}

const RUNS = Number(argOf('runs', 10));
const MULTIPLIER = Number(argOf('multiplier', budget.GUI_CLI_E2E_BUDGET_PROVENANCE.safetyMultiplier));
const AS_JSON = process.argv.includes('--json');
// 代理一律清空：带着它取 Actions 日志/产物会失败（本机实测）
const NO_PROXY = Object.assign({}, process.env, {
  HTTPS_PROXY: '', HTTP_PROXY: '', https_proxy: '', http_proxy: '',
});

function gh(args, maxBuffer) {
  return execFileSync('gh', args, {
    encoding: 'utf8', maxBuffer: maxBuffer || (1 << 26), env: NO_PROXY,
  });
}
function api(pathname) { return JSON.parse(gh(['api', pathname])); }

/** 剥 ANSI：CSI 序列以 ESC 起始、以字母终止（本轮实测判据，见文件头第 6 条） */
function stripAnsi(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === ESC) {
      let j = i + 1;
      while (j < raw.length && !/[A-Za-z]/.test(raw[j])) j++;
      i = j;
      continue;
    }
    out += raw[i];
  }
  return out;
}

/**
 * 列出 wanted 个「main 分支、push 触发、已结束」的 run。
 * 一律**不带**服务端 event/status 过滤（见文件头第 5 条），改为客户端筛 + 翻页。
 */
function listRuns(wanted, errors) {
  const MAX_PAGES = 12;
  const picked = [];
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES && picked.length < wanted; page++) {
    let list;
    try {
      list = api('repos/' + REPO_REMOTE + '/actions/workflows/' + WORKFLOW + '/runs?per_page=100&page=' + page);
    } catch (e) {
      errors.push('run-list p' + page + ' ' + String(e.message).replace(/\r?\n/g, ' ').slice(0, 60));
      break;
    }
    pages += 1;
    const rs = list.workflow_runs || [];
    for (const r of rs) {
      if (r.event === 'push' && r.head_branch === 'main' && r.status === 'completed') picked.push(r);
    }
    if (rs.length < 100) break; // 已到末页
  }
  return { runs: picked.slice(0, wanted), pages };
}

/** 从一份作业日志正文取该用例的耗时样本（剥 ANSI 后交给共享探针，脚本不自带第二份正则） */
function harvest(body) {
  const hits = [];
  for (const line of stripAnsi(body).split(/\r?\n/)) {
    const v = budget.parseGuiCliE2eDuration(line);
    if (v !== null) hits.push(v);
  }
  return hits;
}

function collect() {
  const errors = [];
  const listed = listRuns(RUNS, errors);
  const runs = listed.runs;
  if (runs.length < RUNS) {
    errors.push('only-' + runs.length + '-of-' + RUNS + '-runs in ' + listed.pages + ' pages');
    console.warn('PARTIAL: 只覆盖 ' + runs.length + '/' + RUNS + ' 个 main push run（pages=' + listed.pages
      + '）⇒ 用这份数字回填 provenance 前先加大 --runs 或缩小结论适用范围');
  }

  const values = [];
  let jobs = 0;
  for (const run of runs) {
    let jobsResp;
    try { jobsResp = api('repos/' + REPO_REMOTE + '/actions/runs/' + run.id + '/jobs'); }
    catch (e) { errors.push('jobs ' + run.id); continue; }
    const shards = (jobsResp.jobs || []).filter((j) => JOB_RE.test(j.name) && j.status === 'completed');
    if (!shards.length) errors.push('no-shard-job ' + run.id);
    for (const job of shards) {
      let body = '';
      try {
        body = gh(['api', '--allow-escape-sequences', 'repos/' + REPO_REMOTE + '/actions/jobs/' + job.id + '/logs'], 1 << 28);
      } catch (e) {
        errors.push('log ' + job.id + ' ' + String(e.message).replace(/\r?\n/g, ' ').slice(0, 40));
        continue;
      }
      const hits = harvest(body);
      if (!hits.length) { errors.push('no-sample job=' + job.id); continue; }
      jobs += 1;
      for (const v of hits) values.push(v);
      // 逐作业留痕：这个工具要跑几分钟，没有中间现场就分不清"还在采"与"被杀了"
      console.error('[case-timeout-audit] run=' + run.id + ' job=' + job.id
        + ' hits=' + hits.length + ' max=' + Math.max(...hits) + ' total=' + values.length);
    }
  }
  values.sort((a, b) => a - b);
  return { values, runCount: runs.length, jobs, pages: listed.pages, errors };
}

/**
 * 组装 provenance。**字段集必须与测试文件里那份逐字一致** —— 那份由结构锁核对，
 * 这里不得自造或漏字段（曾经这里还有"取不到就用脚本内硬编码文案"的分支，那是让同一份出处
 * 存在两个版本）。
 */
function buildProvenance(c, multiplier) {
  return {
    maxObservedMs: c.values[c.values.length - 1],
    samples: c.values.length,
    runs: c.runCount,
    jobs: c.jobs,
    safetyMultiplier: multiplier,
    collectedAt: new Date().toISOString().slice(0, 10),
    // 唯一真源：预算模块里的那一句
    source: budget.GUI_CLI_E2E_BUDGET_PROVENANCE.source,
  };
}

function main() {
  if (!budget.GUI_CLI_E2E_BUDGET_PROVENANCE || !budget.GUI_CLI_E2E_CASE_TIMEOUT_MS) {
    console.error('PROVENANCE_MISSING：读不到预算出处 ⇒ 这条链已断，复测结果无处对照');
    process.exitCode = 5;
    return;
  }

  const manual = argOf('max-observed', null);
  let c;
  if (manual !== null) {
    c = { values: [Number(manual)], runCount: Number(argOf('runs', 1)), jobs: Number(argOf('jobs', 1)), pages: 1, errors: [] };
  } else {
    c = collect();
  }

  if (!c.values.length) {
    // 零样本必须出声并点名坐标：一次"采不到"被读成"没问题"，等于把门禁换成一盏恒绿的灯
    console.error('NO_SAMPLES：一条耗时样本都没采到 ⇒ 探针坐标可能过期'
      + '（workflow 名 / job 名 / status 字段 / 代理 / ANSI 拒答 / 未剥 ANSI / gh 登录态 / 服务端过滤截断 / 用例改名）');
    console.error('       MP_AUDIT_REPO=' + REPO_REMOTE + ' pages=' + c.pages
      + ' runs=' + c.runCount + ' errors=' + c.errors.slice(0, 8).join(' , '));
    process.exitCode = 3;
    return;
  }

  const prov = buildProvenance(c, MULTIPLIER);

  if (AS_JSON) {
    console.log(JSON.stringify(prov, null, 2));
  } else {
    const p50 = c.values[Math.floor(c.values.length / 2)];
    console.log('[case-timeout-audit] pages=' + c.pages + ' runs=' + c.runCount + ' jobs=' + c.jobs
      + ' samples=' + prov.samples + ' p50=' + p50 + 'ms max=' + prov.maxObservedMs
      + 'ms errors=' + c.errors.length);
    console.log('当前 GUI_CLI_E2E_CASE_TIMEOUT_MS=' + budget.GUI_CLI_E2E_CASE_TIMEOUT_MS
      + '，要求 ≥ max×' + MULTIPLIER + '=' + prov.maxObservedMs * MULTIPLIER);
  }

  if (budget.GUI_CLI_E2E_CASE_TIMEOUT_MS < prov.maxObservedMs * MULTIPLIER) {
    console.error('BUDGET_TOO_TIGHT: 用例预算 ' + budget.GUI_CLI_E2E_CASE_TIMEOUT_MS + 'ms < 实测最大 '
      + prov.maxObservedMs + 'ms × ' + MULTIPLIER
      + ' ⇒ 该抬预算（并同步 provenance 与台账断言），不得反过来放宽断言');
    process.exitCode = 4;
    return;
  }
  console.log('OK: 预算余量成立（headroom='
    + (budget.GUI_CLI_E2E_CASE_TIMEOUT_MS / prov.maxObservedMs).toFixed(2) + '×）');
}

if (require.main === module) main();

module.exports = { collect, harvest, stripAnsi, buildProvenance, JOB_RE };
