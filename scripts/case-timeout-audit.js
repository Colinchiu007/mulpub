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
 *   node scripts/case-timeout-audit.js [--runs=8] [--json] [--multiplier=4] [--jobs=1]
 *                                      [--max-observed=<ms>]   手工覆盖实测值（默认自动采集）
 *   `--runs` / `--multiplier` / `--max-observed` 两种写法（`--k=v` 与 `--k v`）都生效；
 *   未知旗标与非法取值**一律抛错**并归到 rc=5，不静默忽略（曾经 `--max-observed=abc` 会让
 *   NaN 参与比较、判据恒假 ⇒ 打印 OK 并 rc=0，那是把"参数写错了"读成"没问题"）。
 *
 * 退出码：0 = 采到样本、预算余量成立且出处未漂移
 *        3 = 一条样本都没采到 ⇒ **探针瞎了**，绝不判"没问题"（观察者必须报告自己的失明）
 *        4 = 观测最大值吃掉 safetyMultiplier 倍余量 ⇒ 该抬预算，而不是去放宽断言
 *        5 = 脚本自身故障：参数非法 / 读不到预算出处（文件改名、常量被删）
 *        6 = 出处漂移：本次实测 max 高于模块里记的 max ⇒ 记的数已过期，先粘回出处再判余量
 *
 * 八条采集坐标坑（前五条继承 scripts/lock-timing-audit.js 的实测，后三条是本轮新踩/新依赖）：
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
 *   7. 本工具**依赖 CI 侧的 vitest verbose reporter**：只有它逐条打印 `✓ <文件> > <套件> > <用例> Nms`。
 *      `quality-gate.yml` 的 shard 命令行现在带 `--reporter=verbose`（当场实测：那条命令行原文里有它），
 *      哪天去掉，本脚本得到的是**零样本 ⇒ rc=3 出声**，不是静默判"没有长尾"。QM-6 前端轴 F8 建议
 *      另加一条 workflow 结构锁；此处不重复建锁的理由是失效方向已经 fail-closed，且该旗标由
 *      `vitest.config.js` 里 `process.env.CI` 分支持有，不是本脚本能核对的面。
 *      两个登记 workflow 都当场验过确实打这条行：`electron-ci.yml` 的 `electron-tests` 日志里
 *      取到该用例 1 条 = 1331ms（run 39394756637）。
 *   8. **域有两根轴，只扩一根会伪装成已修完**：旧实现是 `WORKFLOW` + `JOB_RE` 两个单数常量，
 *      于是"还有没有别的 workflow 在跑这条用例"在代码里不可表示。#86 的实测：`QG Coverage`（同 workflow
 *      另一作业族）1705ms、`electron-ci.yml` 的 `electron-tests` 1331ms 都在产同一行，而旧域一条都不认。
 *      正解是 `PRODUCERS` 显式登记表 + A/B 两臂负控（见 `apps/desktop/tests/gui-ci-exit-contract.test.js`），
 *      覆盖度也**逐 workflow 各判**（`shortWorkflows`）——合并成总 run 数会让稀少那条轴静默采不满。
 * 另：作业日志只在 run 结束后可取 ⇒ 本工具是**事后复测**（对着已跑完的 main run），不是 PR 内自证。
 *     每次跑都留现场的是 gui-ci-exit-contract.test.js 里的台账断言。
 * 成本：单份作业日志量级 ~14MB（既有实测），登记表有 3 个生产者分布在 2 个 workflow 上 ⇒
 *     `--runs=8` 是每轴各 8 趟 run、最多 8×2+8×1+8×1=32 份日志。这是它**刻意不接进 required check**
 *     的第二个理由（第一个见 openspec/records/gui-cli-e2e-timeout.md：接进关键路径等于重建预算墙）。
 */
'use strict';

const { execFileSync } = require('node:child_process');
const path = require('node:path');

const BUDGET_PATH = path.resolve(__dirname, '..', 'apps', 'desktop', 'tests', 'gui-cli-e2e-budget.js');

const REPO_REMOTE = process.env.MP_AUDIT_REPO || 'Colinchiu007/mulpub';
/**
 * 采样域 = **(workflow × 作业名) 的生产者登记表**，一个一条，且每条都有当场取证。
 * 为什么必须是两根轴一起写：旧实现是两个单数常量 `WORKFLOW` + `JOB_RE`，域被拆成两根轴各持一半，
 * 于是"有没有第二个 workflow 也在跑这条用例"这个问题在代码里根本不可表示（PR #4072 记下过同一形状：
 * 只扩作业名轴会让人以为域已完整）。
 * 取证（2026-10-20，逐份作业日志按**目标用例全名**过滤 verbose 行）：
 *   run 39381404956  QG Desktop Shards (1/2) → 1 条 1261ms；QG Coverage → 1 条 1705ms；
 *                    QG Desktop Shards (2/2) → 0 条（shard 分配随文件数漂移 ⇒ 仍留在域里，见下）
 *   run 39394756637  electron-ci.yml / electron-tests → 1 条 1331ms；该 run 的 Changes 作业 → 0 条
 * ⛔ `(2/2)` 必须留在域内，即使**本次**它 0 命中：该用例落进哪一片由 vitest 的 `--shard` 决定，
 *    按"今天落在哪片"来排除，重分片后样本会静默缩水而读数照样自洽。
 */
const PRODUCERS = [
  { workflow: 'quality-gate.yml', jobRe: /QG Desktop Shards/ },
  { workflow: 'quality-gate.yml', jobRe: /QG Coverage/ },
  { workflow: 'electron-ci.yml', jobRe: /^electron-tests$/ },
];
const ESC = String.fromCharCode(27);
// 默认采样数与 provenance 里记的那条命令**取同一个数**（QM-6 前端轴 F4）：
// 否则 `--json` 的默认跑法与出处文案指向两个窗口，重跑的人拿到的数对不上记的数。
// 注意这是**每个 workflow** 各取 N 趟，不是总数 —— 两条轴的 main push 频率不同，合并成总数会让
// 稀少那条轴静默采不满（判据见 collect 的 shortWorkflows）。
const DEFAULT_RUNS = 8;

/** 某个 (workflow, 作业名) 是不是登记过的生产者（纯判据，A/B 负控直接打在它上面） */
function isProducer(workflow, jobName) {
  return PRODUCERS.some((p) => p.workflow === workflow && p.jobRe.test(String(jobName)));
}

/** 域涉及哪些 workflow（显式闭合集合；"扫所有 workflow"不许成为那个更省事的写法） */
function producerWorkflows() {
  return Array.from(new Set(PRODUCERS.map((p) => p.workflow))).sort();
}

/** 从一份 run 的作业列表里挑出该 workflow 下已完成的生产者作业 */
function pickProducerJobs(workflow, jobs) {
  return (jobs || []).filter((j) => j && j.status === 'completed' && isProducer(workflow, j.name));
}


/** `--k v` 空格形式只认这四个（QM-6 前端轴 G8：缺值必须报 MISSING_FLAG_VALUE，不能报成 UNKNOWN_FLAG——
 *  "这旗标不存在"与"这旗标少了个值"是两件事，混报会把排障方向指反） */
const SPACED_FLAGS = new Set(['runs', 'multiplier', 'max-observed', 'jobs']);

/**
 * 参数校验（QM-6 前端轴 F2 + G2，两条都是实测过的假绿路径）：
 * `--max-observed=abc` 会让 values=[NaN]，`budget < NaN*4` 恒为 false ⇒ 脚本打印 OK 并 rc=0；
 * `--max-observed=0` 更隐蔽：0 过得了校验，`budget < 0×4` 恒假 ⇒ 打印 `OK（headroom=Infinity×）` 并 rc=0。
 * `--runs=abc` 则让 picked 恒空 ⇒ 误报 rc=3「探针瞎了」。
 * 口径与 `check-clock-shift-oracle.js` 一致：**未知旗标、非法取值、缺值、危险组合一律抛错**，由 main 归到
 * "脚本自身故障"那一档（rc=5），既不作为"发现问题"，也不作为"没问题"。
 * 空格形式（`--runs 8`）与 `--runs=8` 两种写法都生效——只认其一会被静默丢弃。
 * `--max-observed` 与 `--json` **互斥**：手工档没有真采样，不许产出与自动采集同形的可粘贴对象，
 * 那等于允许把 `runs/jobs` 伪造成"已采样"再粘回出处。
 */
function parseArgs(argv) {
  const out = { runs: DEFAULT_RUNS, multiplier: null, json: false, maxObserved: null, jobs: 1 };
  const numeric = (name, raw, min) => {
    if (!/^-?\d+(\.\d+)?$/.test(String(raw))) throw new Error('BAD_FLAG_VALUE: --' + name + '=' + raw + ' 必须是数字');
    const v = Number(raw);
    if (!Number.isFinite(v) || v < min) throw new Error('BAD_FLAG_VALUE: --' + name + '=' + raw + ' 必须 ≥ ' + min);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') { out.json = true; continue; }
    const eq = /^--([a-z-]+)=(.*)$/.exec(a);
    const sp = /^--([a-z-]+)$/.exec(a);
    let name;
    let raw;
    if (eq) { name = eq[1]; raw = eq[2]; }
    else if (sp && SPACED_FLAGS.has(sp[1])) {
      if (argv[i + 1] === undefined) throw new Error('MISSING_FLAG_VALUE: --' + sp[1] + ' 需要取值（也可写成 --' + sp[1] + '=N）');
      name = sp[1]; raw = argv[++i];
    } else throw new Error('UNKNOWN_FLAG: ' + a + '（本脚本只认 --json / --runs=N / --multiplier=N / --max-observed=N / --jobs=N）');
    if (name === 'runs') out.runs = numeric('runs', raw, 1);
    else if (name === 'multiplier') out.multiplier = numeric('multiplier', raw, 1);
    else if (name === 'jobs') out.jobs = numeric('jobs', raw, 1);
    else if (name === 'max-observed') out.maxObserved = numeric('max-observed', raw, 1);
    else throw new Error('UNKNOWN_FLAG: --' + name);
  }
  if (out.maxObserved !== null && out.json) {
    throw new Error('BAD_COMBINATION: --max-observed 是手工档，不得与 --json 同用（手工档没有真采样，产出可粘贴 provenance 等于伪造 runs/jobs）');
  }
  return out;
}

/**
 * 覆盖度是否够用（QM-6 前端轴 G3）：collected < requested 时本次**不是它声称的那个窗口**，
 * 而 PARTIAL 只 warn 就继续 ⇒ `--json` 打出的仍是干净的可粘贴对象，降级信息只活在 stderr。
 * 单独做成纯函数是为了让它**能被断言**：埋在 main 里就只有真跑一次完整采集才摸得到。
 */
function coverageSufficient(requestedRuns, collectedRuns) {
  return Number.isFinite(requestedRuns) && Number.isFinite(collectedRuns) && collectedRuns >= requestedRuns;
}

/**
 * 出处漂移判定（QM-6 后端轴 #4）：脚本自己算出的 max 与模块里记的 max 不一致时必须出声，
 * 否则"改了常量没重测"和"重测过并回了写"在读数上完全同形。
 * 方向不对称：实测**更高** ⇒ 记的数过期（STALE，要抬预算）；实测**更低** ⇒ 不构成收紧理由
 * （长尾只会因窗口变窄而漏看，不会因本次没看到被否证），只留痕 OK_BELOW_RECORD。
 * @param {number} recordedMs
 * @param {number} observedMs
 * @returns {'OK'|'STALE'|'OK_BELOW_RECORD'|'UNREADABLE'}
 */
function judgeDrift(recordedMs, observedMs) {
  if (!Number.isFinite(recordedMs) || !Number.isFinite(observedMs)) return 'UNREADABLE';
  if (observedMs > recordedMs) return 'STALE';
  if (observedMs === recordedMs) return 'OK';
  return 'OK_BELOW_RECORD';
}

/**
 * 从**当前源码**惰性读预算模块：文件被改名/删除时给 rc=5（自身故障档），而不是抛裸栈 rc=1
 * ——那是本脚本头部承诺的档位，顶层 require 会让它永远点不到火（QM-6 前端轴 F1，
 * 与 scripts/lock-timing-audit.js 的 loadBudget() 先例对齐）。
 * 路径可注入（默认指向真实模块）：不是为了排障，是为了让"读不到要走 5 档"这件事**能被测试摸到**
 * ——写死常量时这条分支在测试里不可达，等于又一根装饰性门禁。
 */
function loadBudget(explicitPath) {
  let mod;
  try { mod = require(explicitPath || BUDGET_PATH); }
  catch (e) { throw new Error('BUDGET_UNREADABLE: ' + String(e.message).split(/\r?\n/)[0]); }
  if (!mod || !mod.GUI_CLI_E2E_BUDGET_PROVENANCE || !mod.GUI_CLI_E2E_CASE_TIMEOUT_MS) {
    throw new Error('PROVENANCE_MISSING: 读不到预算出处 ⇒ 这条链已断，复测结果无处对照');
  }
  return mod;
}
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
 * 列出 wanted 个「main 分支、push 触发、已结束」的 run（**按 workflow 各列一份窗口**）。
 * 一律**不带**服务端 event/status 过滤（见文件头第 5 条），改为客户端筛 + 翻页。
 */
function listRuns(workflow, wanted, errors) {
  const MAX_PAGES = 12;
  const picked = [];
  let pages = 0;
  for (let page = 1; page <= MAX_PAGES && picked.length < wanted; page++) {
    let list;
    try {
      list = api('repos/' + REPO_REMOTE + '/actions/workflows/' + workflow + '/runs?per_page=100&page=' + page);
    } catch (e) {
      errors.push('run-list ' + workflow + ' p' + page + ' ' + String(e.message).replace(/\r?\n/g, ' ').slice(0, 60));
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
function harvest(body, b) {
  const hits = [];
  for (const line of stripAnsi(body).split(/\r?\n/)) {
    const v = b.parseGuiCliE2eDuration(line);
    if (v !== null) hits.push(v);
  }
  return hits;
}

function collect(b, opts) {
  const errors = [];
  const values = [];
  let jobs = 0;
  let runCount = 0;
  let pages = 0;
  // 覆盖度**按 workflow 各自判**：合并成总数会让稀少那条轴静默采不满，而读数照样"够 8 个 run"。
  const shortWorkflows = [];
  for (const wf of producerWorkflows()) {
    const listed = listRuns(wf, opts.runs, errors);
    pages += listed.pages;
    runCount += listed.runs.length;
    if (!coverageSufficient(opts.runs, listed.runs.length)) {
      shortWorkflows.push(wf + '=' + listed.runs.length + '/' + opts.runs + '(pages=' + listed.pages + ')');
      errors.push('only-' + listed.runs.length + '-of-' + opts.runs + '-runs for ' + wf);
    }
    for (const run of listed.runs) {
      let jobsResp;
      try { jobsResp = api('repos/' + REPO_REMOTE + '/actions/runs/' + run.id + '/jobs'); }
      catch (e) { errors.push('jobs ' + run.id); continue; }
      const picked = pickProducerJobs(wf, jobsResp.jobs);
      if (!picked.length) errors.push('no-producer-job ' + wf + ' run=' + run.id);
      for (const job of picked) {
        let body = '';
        try {
          body = gh(['api', '--allow-escape-sequences', 'repos/' + REPO_REMOTE + '/actions/jobs/' + job.id + '/logs'], 1 << 28);
        } catch (e) {
          errors.push('log ' + job.id + ' ' + String(e.message).replace(/\r?\n/g, ' ').slice(0, 40));
          continue;
        }
        const hits = harvest(body, b);
        if (!hits.length) { errors.push('no-sample job=' + job.id + ' (' + wf + ' :: ' + job.name + ')'); continue; }
        jobs += 1;
        for (const v of hits) values.push(v);
        // 逐作业留痕：这个工具要跑几分钟，没有中间现场就分不清"还在采"与"被杀了"
        console.error('[case-timeout-audit] wf=' + wf + ' run=' + run.id + ' job=' + job.id
          + ' hits=' + hits.length + ' max=' + Math.max(...hits) + ' total=' + values.length);
      }
    }
  }
  if (shortWorkflows.length) {
    console.warn('PARTIAL: 至少一条 workflow 轴没采满 ⇒ ' + shortWorkflows.join(' , ')
      + '；用这份数字回填 provenance 前先加大 --runs 或缩小结论适用范围');
  }
  values.sort((a, b2) => a - b2);
  return { values, runCount, jobs, pages, errors, shortWorkflows };
}

/**
 * 组装 provenance。**字段集与 `source` 文案都必须与预算模块那份逐字一致** ——
 * 那份由结构锁核对（QM-6 前端轴 F5：只比 key 不比值，脚本自带一份 source 也不会红，
 * 那是"第二份真相"的漏口）。
 */
function buildProvenance(c, multiplier, b, collectedAt) {
  return {
    maxObservedMs: c.values[c.values.length - 1],
    samples: c.values.length,
    runs: c.runCount,
    jobs: c.jobs,
    safetyMultiplier: multiplier,
    collectedAt: collectedAt || new Date().toISOString().slice(0, 10),
    // 唯一真源：预算模块里的那一句
    source: b.GUI_CLI_E2E_BUDGET_PROVENANCE.source,
  };
}

function main() {
  let opts;
  let b;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (e) {
    // 参数坏掉属"脚本自身故障"档：既不判"发现问题"（1/3/4/6），也不判"没问题"（0）
    console.error('ARGS_INVALID：' + String(e.message).split(/\r?\n/)[0]);
    process.exitCode = 5;
    return;
  }
  try {
    b = loadBudget();
  } catch (e) {
    console.error(String(e.message).split(/\r?\n/)[0]);
    process.exitCode = 5;
    return;
  }
  const multiplier = opts.multiplier === null ? b.GUI_CLI_E2E_BUDGET_PROVENANCE.safetyMultiplier : opts.multiplier;

  let c;
  if (opts.maxObserved !== null) {
    // 手工档不采集 ⇒ runCount/jobs 必须是 null，不许拿 opts 的默认值冒充"已采到 8 个 run"
    //（QM-6 前端轴 R2-8：非 --json 那一行会打印 runs=8 jobs=1，读起来像真采过）
    c = { values: [opts.maxObserved], runCount: null, jobs: null, pages: null, errors: [], manual: true };
  } else {
    c = collect(b, opts);
    // 覆盖度不足 ⇒ 与零样本同一档出口：不出 JSON、不判 OK。"只 warn 一下继续"会让粘走 JSON 的人
    // 拿不到降级信息（QM-6 前端轴 G3）。判据**逐 workflow**（#86）：合并总数会让稀少那条轴
    // 静默采不满，而 `runs=` 那个读数照样像够数。
    if (c.shortWorkflows && c.shortWorkflows.length) {
      console.error('PARTIAL_COVERAGE：按 workflow 各自核，缺口=' + c.shortWorkflows.join(' , ')
        + '（requested=' + opts.runs + '/workflow，collected=' + c.runCount + '，pages=' + c.pages + '）'
        + '⇒ 本次不是它声称的那个窗口。要么缩小 --runs 明示窗口，要么等 main push 攒够；'
        + '不得把这份覆盖度写进 provenance');
      console.error('       MP_AUDIT_REPO=' + REPO_REMOTE + ' errors=' + c.errors.slice(0, 8).join(' , '));
      process.exitCode = 3;
      return;
    }
  }

  if (!c.values.length) {
    // 零样本必须出声并点名坐标：一次"采不到"被读成"没问题"，等于把门禁换成一盏恒绿的灯
    console.error('NO_SAMPLES：一条耗时样本都没采到 ⇒ 探针坐标可能过期'
      + '（workflow 名 / job 名 / status 字段 / 代理 / ANSI 拒答 / 未剥 ANSI / gh 登录态 / 服务端过滤截断 / 用例改名 / CI 不再用 --reporter=verbose）');
    console.error('       MP_AUDIT_REPO=' + REPO_REMOTE + ' pages=' + c.pages
      + ' runs=' + c.runCount + ' errors=' + c.errors.slice(0, 8).join(' , '));
    process.exitCode = 3;
    return;
  }

  const prov = buildProvenance(c, multiplier, b);

  if (opts.json) {
    console.log(JSON.stringify(prov, null, 2));
  } else if (c.manual) {
    console.log('[case-timeout-audit] mode=MANUAL max=' + prov.maxObservedMs + 'ms（未采集，runs/jobs 不适用）');
    console.log('当前 GUI_CLI_E2E_CASE_TIMEOUT_MS=' + b.GUI_CLI_E2E_CASE_TIMEOUT_MS
      + '，要求 ≥ max×' + multiplier + '=' + prov.maxObservedMs * multiplier);
  } else {
    const p50 = c.values[Math.floor(c.values.length / 2)];
    console.log('[case-timeout-audit] pages=' + c.pages + ' runs=' + c.runCount + ' jobs=' + c.jobs
      + ' samples=' + prov.samples + ' p50=' + p50 + 'ms max=' + prov.maxObservedMs
      + 'ms errors=' + c.errors.length);
    console.log('当前 GUI_CLI_E2E_CASE_TIMEOUT_MS=' + b.GUI_CLI_E2E_CASE_TIMEOUT_MS
      + '，要求 ≥ max×' + multiplier + '=' + prov.maxObservedMs * multiplier);
  }

  // 出处漂移先判（QM-6 前端轴 R2-10）：原先"余量不足"挡在前，两个条件同时成立时 STALE 被掩盖，
  // 读到的只有 rc=4，而真正要先修的是**出处没回写**。现在两条都打印，退出码取更紧急的那一档。
  const drift = judgeDrift(b.GUI_CLI_E2E_BUDGET_PROVENANCE.maxObservedMs, prov.maxObservedMs);
  if (drift === 'STALE') {
    console.error('PROVENANCE_STALE: 模块记的 maxObservedMs=' + b.GUI_CLI_E2E_BUDGET_PROVENANCE.maxObservedMs
      + ' 低于本次实测 ' + prov.maxObservedMs + ' ⇒ 出处过期，把本次 --json 输出整份粘回预算模块再来判余量');
  }
  if (b.GUI_CLI_E2E_CASE_TIMEOUT_MS < prov.maxObservedMs * multiplier) {
    console.error('BUDGET_TOO_TIGHT: 用例预算 ' + b.GUI_CLI_E2E_CASE_TIMEOUT_MS + 'ms < 实测最大 '
      + prov.maxObservedMs + 'ms × ' + multiplier
      + ' ⇒ 该抬预算（并同步 provenance 与台账断言），不得反过来放宽断言');
    process.exitCode = 4;
    return;
  }
  if (drift === 'STALE') { process.exitCode = 6; return; }
  console.log('OK: 预算余量成立（headroom='
    + (b.GUI_CLI_E2E_CASE_TIMEOUT_MS / prov.maxObservedMs).toFixed(2) + '×，drift=' + drift + '）');
}

if (require.main === module) main();

module.exports = {
  collect, harvest, stripAnsi, buildProvenance, parseArgs, judgeDrift, loadBudget,
  coverageSufficient,
  PRODUCERS, isProducer, producerWorkflows, pickProducerJobs,
  DEFAULT_RUNS, SPACED_FLAGS,
};
