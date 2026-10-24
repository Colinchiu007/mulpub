/**
 * 逐片墙钟复测入口（预算出处的**可重跑路径**，不是注释里的愿望）。
 *
 * 它存在的理由：`STEP_BUDGET_PROVENANCE` 里的 max/p50 是量过一次的老基线，而这片把两片放进
 * **同一个 runner**，争用倍数未测。没有这个入口，"第一次真跑后按读数重定数"就是一句
 * 没有任何东西能执行的散文（本仓对 *_PROVENANCE 的口径：①常量旁给出处 ②每次真跑留痕
 * ③复测入口落在仓库里且输出字段与 provenance 逐字段对齐）。
 *
 * 采样两档（自动优先新形状，退回老基线）：
 * - 新形状：`electron-ci.yml` push 的 `electron-tests` 作业日志里
 *   `[electron-ci-step] shard=<i>/<n> verdict=… elapsed=<ms>ms` —— 同 runner 两片并行的真实逐片耗时。
 * - 老基线：`quality-gate.yml` main push 里 `QG Desktop Shards*` 成功作业的 `started_at/completed_at`
 *   —— 每片独占一个 runner，是**下界**（不含争用）。
 *
 * 退出码三档，不得混用：`0` 读数支持当前预算 · `1` 读数不支持（贴脸或低于地板）·
 * `2` 判据自身取不到数（gh 失败 / 零样本 / 未知旗标）。把 2 读成 0 就是"工具失明当结论"。
 */
'use strict';

const cp = require('node:child_process');
const path = require('node:path');

const STEP = require(path.join(__dirname, 'electron-ci-desktop-step.js'));

/** 与 STEP_BUDGET_PROVENANCE 对齐的输出字段名（结构锁按这份清单逐项要求出现）。 */
const FIELDS = ['runs', 'shards', 'minShardMin', 'p50ShardMin', 'maxShardMin',
  'budgetFloorSec', 'stepBudgetSec', 'safetyMultiplier', 'collectedAt', 'source'];

/**
 * 默认 5 次、退避 1500ms×k。依据是 2026-10-22 现场：一次采集连吃 4 次 SELF_FAULT、第 5 次才成功。
 * 按此单次成功率 1/5 ⇒ 试 3 次的残余失败率 (4/5)^3 ≈ 51%、试 5 次 ≈ 33%。**这不是分布**（n=5 且
 * 高度聚簇，撑不起分布）—— 选 5 的理由是**代价不对称**：多试两次只花几秒，试不出来就是人再重跑
 * 一整轮采集（分钟级）。残余 ~33% 仍会 SELF_FAULT ⇒ 它是降噪，不是保证；真要定数得按本仓对
 * *_PROVENANCE 的口径先攒样本。外部评审 i3 打的就是"把 3 说成够用下界"那句过度声明。
 */
const GH_RETRY_ATTEMPTS_DEFAULT = 5
const GH_RETRY_BASE_MS_DEFAULT = 1500
/**
 * 退避**总时长**的硬上限。只限 attempts 与 baseMs 是不够的：总睡时是 Σ k·baseMs，
 * 随 attempts 呈 O(n²) 增长 —— `MP_AUDIT_GH_ATTEMPTS=100` 叠 `…_BACKOFF_MS=30000`
 * 就是 30000×5050 ≈ 42 小时。"有界"必须由这条上限保证，而不是由输入够不够善意保证。
 * ⛔ 这条只治**退避**；单次 gh 调用挂死不在本判据覆盖内（spawnSync 没有传 timeout），
 *    那是另一维，如实写在执行记录的残留里，不在这里谎称已闭合。
 */
const GH_RETRY_BACKOFF_BUDGET_MS_DEFAULT = 120000

/** Actions 作业日志每行前缀是 `2026-10-21T07:52:30.4123456Z ` —— 不剥掉它任何 `^` 锚点都恒不命中。 */
function stripLogNoise (text) {
  return String(text == null ? '' : text)
    .split(/\r?\n/)
    .map((l) => l.replace(/^\d{4}-\d{2}-\d{2}T[\d:.]+Z\s?/, ''))
    .join('\n')
    .replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '');
}

/** 从作业日志取逐片墙钟（新形状才有；取不到返回空数组，由调用方出声）。 */
function parseShardElapsed (logText) {
  const out = [];
  for (const line of stripLogNoise(logText).split(/\r?\n/)) {
    const m = /^\[electron-ci-step\]\s+shard=(\S+)\s+verdict=(\S+)\s+elapsed=(\d+)ms/.exec(line);
    if (m) out.push({ shard: m[1], verdict: m[2], elapsedMs: Number(m[3]) });
  }
  return out;
}

function median (sorted) {
  if (sorted.length === 0) return NaN;
  return sorted[Math.floor(sorted.length / 2)];
}

/**
 * 分钟分布 + 与 provenance/预算的对照。`sourceKind` 必须标出这一批取自哪一档 ——
 * 两档的测量形状不同（同 runner 并行 vs 每片独占），混记会让"下界"读起来像"实测"。
 * verdict 只在这里算一次：`format` 与 `main` 都读同一个值，两处各算迟早漂移。
 */
function summarize (samplesMin, sourceKind, runCount) {
  const sorted = samplesMin.slice().sort((a, b) => a - b);
  const maxShardMin = sorted.length ? sorted[sorted.length - 1] : NaN;
  const p = STEP.STEP_BUDGET_PROVENANCE;
  const budgetFloorSec = Math.round(maxShardMin * 60 * p.safetyMultiplier);
  const stepBudgetSec = Math.round(STEP.STEP_BUDGET_MS / 1000);
  const verdict = sorted.length === 0 ? 'NO_SAMPLES'
    : stepBudgetSec < budgetFloorSec ? 'BELOW_FLOOR'
      : stepBudgetSec < Math.round(budgetFloorSec * 1.1) ? 'HUGGING'
        : 'OK';
  return {
    shards: sorted.length,
    // runs 是「采了几趟」，不是「几个不同的耗时值」——后者会让 14 片 7 趟读成 14 趟。
    runs: Number.isFinite(runCount) ? runCount : 0,
    minShardMin: sorted.length ? sorted[0] : NaN,
    p50ShardMin: median(sorted),
    maxShardMin,
    budgetFloorSec,
    stepBudgetSec,
    safetyMultiplier: p.safetyMultiplier,
    collectedAt: p.collectedAt,
    source: sourceKind,
    verdict,
  };
}

function format (s) {
  const INT_FIELDS = new Set(['runs', 'shards', 'budgetFloorSec', 'stepBudgetSec']);
  const cell = (k) => (INT_FIELDS.has(k) ? String(Math.round(s[k]))
    : (typeof s[k] === 'string' ? s[k] : (Number.isFinite(s[k]) ? s[k].toFixed(1) : 'n/a')));
  return '[shard-audit] ' + FIELDS.filter((k) => k !== 'source').map((k) => k + '=' + cell(k))
    .join(' ') + ' source=' + s.source + ' verdict=' + s.verdict
    + '\n[shard-audit] 全部(分钟)=' + (s.samples || []).map((m) => (Number.isFinite(m) ? m.toFixed(1) : 'n/a')).join(',');
}

/**
 * 只有**传输层抖动**可以重试。这份清单的来源是 2026-10-22 本机现场读数（不是设想）：
 * 4 次 SELF_FAULT 分别落在 `run list` 与 `jobs/<id>/logs`，签名是 wsarecv 强断、
 * blob 主机 EOF、HTTP 502、ETIMEDOUT。
 *
 * ⛔ 反方向同样重要：`HTTP 404` / `ENOENT`（gh 不在 PATH）/ `unknown flag` /
 * `GH011` / JSON 解析失败 都**永远不会**因为重试而变好。把它们也重试一遍，
 * 等于把一个稳定的判据故障洗成"多跑三次终于绿了"——那是藏红，不是鲁棒。
 * 注意 `GH_SPAWN_FAILED spawnSync gh` 这个前缀同时出现在 ENOENT（不可重试）
 * 与 ETIMEDOUT（可重试）上，所以只能按**码**判，不能按前缀判。
 */
const TRANSIENT_PATTERNS = [
  /wsarecv/i, /forcibly closed/i, /\bEOF\b/, /\bECONNRESET\b/i, /\bECONNREFUSED\b/i,
  /\bETIMEDOUT\b/, /\btimed out\b/i, /\bENOTFOUND\b/i, /\bEAI_AGAIN\b/i,
  /HTTP(?:\/[\d.]+)?\s*5\d\d/, /\bServer Error\b/i, /proxyconnect/i,
]

/**
 * @param {string|Error|null|undefined} failure gh 的报错文本或 Error
 * @returns {boolean} true = 可以重试；false = 一次就该抛
 *
 * 判定读**完整** stderr + 消息，打印才截断（外部评审 r2-i2）。
 * 截断文本只用于归因文案；拿截断文本当判据，等于把落在 200 字符之后的
 * `wsarecv: … forcibly closed`（本仓 2026-10-22 现场正是两行）判成"一次就抛"。
 */
function isTransientGhFailure (failure) {
  const raw = failure && failure.rawStderr != null ? String(failure.rawStderr) : ''
  const head = failure && failure.message != null
    ? String(failure.message)
    : String(failure == null ? '' : failure)
  const text = raw + '\n' + head
  return TRANSIENT_PATTERNS.some((re) => re.test(text))
}

/**
 * 重试预算。**有界**，且只作用于传输层抖动。**可被 env 覆盖以便排障，
 * 但非法值必须回落默认并出声**（与频控 / 队列 / QM1 同口径）—— attempts 设成 0
 * 等于关掉重试还谎称"按配置走了"，设成 NaN 会让循环整条失效。
 */
function resolvePositiveInt (raw, dflt, name, notice) {
  // 只有"根本没设置"才是安静路径（每次正常跑都走它）；空串是写了但写坏，
  // 也正是最容易手滑打出来的"关掉重试"写法 ⇒ 必须走下面的出声分支（外部评审 r2-i8）。
  if (raw === undefined || raw === null) return dflt
  const n = Number(raw)
  if (!Number.isFinite(n) || n < 1) {
    notice('[shard-audit] ' + name + '=' + raw + ' 非法 ⇒ 回落 ' + dflt +
      '（0 等于关掉重试，NaN 会让循环整条失效）')
    return dflt
  }
  return Math.trunc(n)
}

/** 同步睡一下（collect 是同步的；改成异步会把整条采集链变成 Promise 并牵动所有调用方）。 */
function sleepSync (ms) {
  try {
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms)
  } catch (e) {
    const until = Date.now() + ms
    while (Date.now() < until) { /* 兜底忙等：只在 Atomics 不可用的宿主上发生 */ }
  }
}

/** 一次真正的 gh 调用：非零即抛。文案截到 200 字符（归因够用又不刷日志），
 * 但把**完整** stderr 挂在 `rawStderr` 上交给判据 —— 截断只准影响打印。 */
function runGhOnce (spawnImpl, args) {
  const r = spawnImpl('gh', args)
  if (r && r.error) throw new Error('GH_SPAWN_FAILED ' + r.error.message)
  if (!r || r.status !== 0) {
    const raw = String(r && r.stderr)
    const e = new Error('GH_FAILED ' + args.slice(0, 3).join(' ') + ' :: ' + raw.slice(0, 200))
    e.rawStderr = raw
    throw e
  }
  return r
}

/**
 * 只在瞬时档重试；每次重试**出声**，耗尽后把试过的次数写进文案
 * （"试了三次仍坏"与"一次就坏"是两种归因，修法不同）。
 * 判据类失败（404 / 未知旗标 / GH011 / 解析失败）走 isTransientGhFailure=false 那条，**一次就抛**。
 */
function withTransientRetry (spawnImpl, args, ctx) {
  // 工厂被直接调用时没有 resolvePositiveInt 兜底，坏参数必须当场点名
  // （否则循环体一次不跑、末尾读 undefined.message 抛 TypeError，看起来像引擎坏了）（r2-i11）。
  if (!Number.isInteger(ctx.attempts) || ctx.attempts < 1) {
    throw new Error('BAD_GH_API_OPTS attempts=' + String(ctx.attempts) +
      '（必须是 ≥1 的整数；0 等于关掉重试还谎称"按配置走了"）')
  }
  let last
  let slept = 0
  for (let k = 1; k <= ctx.attempts; k++) {
    try {
      return runGhOnce(spawnImpl, args)
    } catch (e) {
      last = e
      if (!isTransientGhFailure(e)) throw e
      const next = ctx.baseMs * k
      // 硬上限在这里，不在"输入的善意"里：预算不够就停手并点名原因。
      if (slept + next > ctx.backoffBudgetMs) {
        ctx.notice('[shard-audit] 退避预算耗尽 slept=' + slept + 'ms next=' + next +
          'ms budget=' + ctx.backoffBudgetMs + 'ms ⇒ 停止重试（不再按配置硬等）')
        break
      }
      if (k < ctx.attempts) {
        ctx.notice('[shard-audit] gh 重试 attempt=' + (k + 1) + '/' + ctx.attempts +
          ' 因=' + String(e.message).slice(0, 120))
        slept += next
        ctx.sleepImpl(next)
      }
    }
  }
  throw new Error(last.message + ' attempts=' + ctx.attempts +
    ' sleptMs=' + slept + ' backoffBudget=' + ctx.backoffBudgetMs + 'ms')
}

/**
 * 默认取数面。做成工厂是为了让"重试到底落在不在 collect 真走的那条路上"这件事**可测**：
 * 只导出一个没人调用的工具函数，就等于给一条不会执行的路径写锁（本仓记过的同型）。
 */
function makeGhApi (ctx) {
  const call = (args) => withTransientRetry(ctx.spawnImpl, args, {
    attempts: ctx.attempts, baseMs: ctx.baseMs, sleepImpl: ctx.sleepImpl, notice: ctx.notice,
    backoffBudgetMs: ctx.backoffBudgetMs || GH_RETRY_BACKOFF_BUDGET_MS_DEFAULT,
  })
  return {
    ghJson: (args) => JSON.parse(call(args).stdout),
    ghText: (args) => call(args).stdout,
  }
}


/** 采集：优先新形状逐片 elapsed，取不到退回老基线；两档都标在 source 里，不得装作同一档。 */
function collect (opts) {
  // notice 默认落 stderr：重试过几次必须当场看得见，否则下一次调预算的人只能猜。
  const notice = opts.notice || ((line) => process.stderr.write(line + '\r\n'))
  // 取数面只剩一条：注入整份 api 会绕过重试与 attempts/baseMs 校验，而注释声称
  // `makeGhApi` 是唯一默认取数面（外部评审 r2-i7）。要注入就注入 spawnImpl —— 那条路上
  // 重试、退避上限、非法值校验和 JSON.parse 都真的跑一遍。
  if (opts.api) {
    throw new Error('BAD_COLLECT_OPTS opts.api 已移除：取数面只有 makeGhApi 一条，' +
      '注入整份 api 会绕过重试与非法值校验 ⇒ 请改注入 spawnImpl')
  }
  const api = makeGhApi({
    spawnImpl: opts.spawnImpl ||
      ((cmd, args) => cp.spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 1 << 27 })),
    sleepImpl: opts.sleepImpl || sleepSync,
    notice,
    attempts: resolvePositiveInt(opts.attempts != null ? opts.attempts : process.env.MP_AUDIT_GH_ATTEMPTS,
      GH_RETRY_ATTEMPTS_DEFAULT, 'MP_AUDIT_GH_ATTEMPTS', notice),
    baseMs: resolvePositiveInt(opts.baseMs != null ? opts.baseMs : process.env.MP_AUDIT_GH_BACKOFF_MS,
      GH_RETRY_BASE_MS_DEFAULT, 'MP_AUDIT_GH_BACKOFF_MS', notice),
  })
  const wanted = opts.runs || 10;
  const samples = [];
  let sourceKind = 'none';
  let runCount = 0;

  const ciRuns = api.ghJson(['run', 'list', '--workflow=electron-ci.yml', '--event=push',
    '--limit=' + wanted, '--json', 'databaseId,status']);
  for (const r of ciRuns) {
    if (r.status !== 'completed') continue;
    const jobsRaw = api.ghJson(['api', 'repos/{owner}/{repo}/actions/runs/' + r.databaseId + '/jobs', '--paginate']);
    const jobs = Array.isArray(jobsRaw) ? jobsRaw : (jobsRaw && jobsRaw.jobs) || [];
    const j = jobs.find((x) => x.name === 'electron-tests');
    if (!j || !j.id) continue;
    runCount++;
    const log = api.ghText(['api', 'repos/{owner}/{repo}/actions/jobs/' + j.id + '/logs', '--allow-escape-sequences']);
    const got = parseShardElapsed(log);
    for (const g of got) samples.push(g.elapsedMs / 60000);
    if (got.length > 0) sourceKind = 'new-shape(per-shard elapsed / 1 runner)';
  }
  if (samples.length > 0) return withSamples(samples, sourceKind, runCount);

  const qgRuns = api.ghJson(['run', 'list', '--workflow=quality-gate.yml', '--event=push',
    '--branch', 'main', '--limit=' + wanted, '--json', 'databaseId,status']);
  for (const r of qgRuns) {
    if (r.status !== 'completed') continue;
    const jobsRaw = api.ghJson(['api', 'repos/{owner}/{repo}/actions/runs/' + r.databaseId + '/jobs', '--paginate']);
    const jobs = Array.isArray(jobsRaw) ? jobsRaw : (jobsRaw && jobsRaw.jobs) || [];
    const js = jobs.filter((x) => typeof x.name === 'string' && x.name.indexOf('QG Desktop Shards') === 0
      && x.conclusion === 'success' && x.started_at && x.completed_at);
    if (js.length === 0) continue;
    runCount++;
    for (const j of js) samples.push(Math.round((new Date(j.completed_at) - new Date(j.started_at)) / 1000) / 60);
    sourceKind = 'legacy-baseline(one shard per runner ⇒ 不含争用，是下界)';
    if (runCount >= 7) break;
  }
  return withSamples(samples, sourceKind, runCount);
}

function withSamples (samples, sourceKind, runCount) {
  const s = summarize(samples, sourceKind, runCount);
  s.samples = samples;
  return s;
}

/** 只接已登记的旗标；未知旗标一律抛错走「自身故障」档（静默忽略等于把一次 smoke 放大成整域）。 */
function parseArgs (argv) {
  const out = { runs: 10 };
  for (const a of argv) {
    const m = /^--(?:runs|limit)[= ](\d+)$/.exec(a) || /^--runs=(\d+)$/.exec(a);
    if (m) out.runs = Number(m[1]);
    else if (a === '--json') out.json = true;
    else throw new Error('未知参数：' + a + '（本判据只接 --runs=N / --limit=N / --json）');
  }
  return out;
}

/**
 * 退出码三档。`opts.collectImpl` / `opts.write` 只为把"零样本"与"自身故障"两档做成**可执行**的
 * 回归锁——不能测的退出码等于没有退出码（本仓口径：判据的每个分支都要有现场红）。
 */
function main (argv, opts) {
  const o = opts || {};
  const write = o.write || ((s) => process.stdout.write(s));
  const doCollect = o.collectImpl || collect;
  let s;
  try {
    s = doCollect(parseArgs(argv || process.argv.slice(2)));
  } catch (e) {
    write('[shard-audit] SELF_FAULT ' + e.message + '\n');
    return 2;
  }
  if (!s || s.shards === 0 || s.verdict === 'NO_SAMPLES') {
    write('[shard-audit] NO_SAMPLES 两档采样域都取不到逐片耗时 ⇒ 不出结论（不得读成"预算没问题"）\n');
    return 2;
  }
  write(format(s) + '\n');
  if (s.verdict === 'BELOW_FLOOR' || s.verdict === 'HUGGING') {
    write('[shard-audit] 读数不支持当前预算：按 provenance 重定数或改形状，**不得**放宽判据。\n');
    return 1;
  }
  return 0;
}

module.exports = { FIELDS, STEP, parseShardElapsed, stripLogNoise, summarize, format, collect, main, parseArgs, isTransientGhFailure, TRANSIENT_PATTERNS, withTransientRetry, makeGhApi, resolvePositiveInt, GH_RETRY_ATTEMPTS_DEFAULT, GH_RETRY_BASE_MS_DEFAULT, GH_RETRY_BACKOFF_BUDGET_MS_DEFAULT };

if (require.main === module) { process.exitCode = main(); }
