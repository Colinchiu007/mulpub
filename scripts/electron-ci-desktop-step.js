/**
 * electron-ci 桌面全量步骤的**单一实现** —— 一步之内两片并行 + 一份共享预算 + 剥 ANSI 的现场计数。
 *
 * 为什么存在（2026-10-21 全部现取读数，窗口=最近 12 趟 main push）：
 * 1. `electron-ci.yml` 的 `Unit tests (Vitest…)` 步骤在 main push 上 12 趟里 **8 趟非绿**，
 *    且逐趟下日志核对后 **8/8 都是预算墙**（作业日志里 `rc=124` 与 `TIMEOUT_BUDGET_EXCEEDED`
 *    各命中 1/2 次，**断言红=0**）；成功趟作业墙钟 1511 / 1542 / 1820 / 1934s，
 *    红趟 2177–2215s ⇒ 贴脸逼近 2100s 步骤预算。
 * 2. 该步自己那份"跑完没有"的计数器是瞎的：`grep -cE '^[[:space:]]+[✓×↓-]'` 对 vitest 的真实行
 *    恒 0（`od -c` 实测行首是 `033[32m✓033[39m` ⇒ 第一个字符是 ESC，不是空白；Actions 日志还要
 *    再剥每行的时间戳前缀）。按修好的锚重读同一批红趟，实测 `✓×行=18156–18929、摘要=0`
 *    ——即"跑了近一万九千条然后被掐断"，旧锚把它读成"一条都没跑"。
 * 3. workflow 里内联的 bash 逻辑没有回归锁 ⇒ 按本仓范式收回单一实现，workflow 只调用不判定
 *    （同 `agent-review-gate.js` / `main-red.js` 的先例）。
 *
 * 预算取值（**这一步同时改了形状和数字，两个理由分开给**）：
 * - 形状：两片并行 ⇒ 单步墙钟 ≈ `max(两片)` 而不是两片之和。
 * - 数字：`2100s` 对实测 `max(单片)=23.2min × 1.5 = 2091s` 只剩 **9 秒余量**，而那批单片基线是
 *   `QG Desktop Shards` 在**每片独占一个 runner** 时测的；本片把两片放进**同一个 runner**，
 *   争用倍数**没测过**。贴脸（HUGGING）是事前证据，正解按本仓口径是**先量再定数**而不是接受
 *   零余量 ⇒ 取 `2700s`（= max × 1.94，给同 runner 争用留约一倍空间）。
 *   这不是"给同样的活加宽墙"：同样形状下的旧墙 2100s 已被实测否证；且 2700s 是**单调放宽**
 *   （不会让任何原本通过的运行变红），仍受 job 级 `timeout-minutes: 70` 约束不倒挂
 *   （本 job 其余带 timeout 的步骤合计 20 min，20 + 45 = 65 < 70）。
 *   ⚠ 第一次 CI 真跑后必须按打印出来的逐片墙钟重定数（见 STEP_BUDGET_PROVENANCE.contentionNote）。
 */
'use strict';

const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DESKTOP_PKG = '@multi-publish/desktop';

const SHARD_COUNT = 2;
/** 整步硬预算（45 min）。唯一真源：workflow 里不得再出现这个字面量（由回归锁钉）。 */
const STEP_BUDGET_MS = 2700000;
/** 共享预算下单片允许跑满整步；这个相等关系是显式的，不是"没设上限"。 */
const SHARD_TIMEOUT_MS = STEP_BUDGET_MS;

/**
 * 取值出处（**复测入口落在仓库里**：`node scripts/electron-ci-shard-audit.js`；其输出字段与本对象
 * 逐字段对齐，由 `scripts/electron-ci-shard-audit.test.js` 的结构锁钉住，采不到样本时以非零码出声）。
 * 判据锁住 `预算 ≥ max × 倍数`、`预算 > max` 与样本量下界。
 */
const STEP_BUDGET_PROVENANCE = {
  maxObservedShardMin: 23.2,
  p50ShardMin: 18.6,
  shards: 14,
  runs: 7,
  safetyMultiplier: 1.5,
  collectedAt: '2026-10-21',
  /** 样本的**测量形状**与本步不同：这批是每片独占一个 runner 测的，本步把两片放进同一个 runner。
   * 争用倍数未测 ⇒ 预算不取 `max × 1.5 = 2091s`（对旧墙 2100s 只剩 9 秒，属贴脸），
   * 而取 2700s ≈ `max × 1.94`，给同-runner 争用留约一倍空间；第一次真跑后按打印的逐片 `elapsed=` 重定数。 */
  contentionNote: '样本取自「每片独占一个 runner」（QG Desktop Shards）；本步是同 runner 两片并行 ⇒ 争用倍数未测',
  runnerShape: '2 shards / 1 job / 1 runner',
  /**
   * append-only 读数账（2026-10-22 起）。顶部那几个数 = 本册中被**扶正**的那一条；
   * 新读数先入账、就先进判据（`预算 ≥ max(全部读数) × 倍数`），样本量够了才换顶部值 ——
   * 那是个显式动作，由 electron-ci-desktop-step.test.js 的两条 provenance 锁守着，
   * 不允许它跟着册子悄悄漂移。
   */
  readings: [
    {
      collectedAt: '2026-10-21',
      runnerShape: '1 shard / 1 job / 1 runner（QG Desktop Shards 矩阵，每片独占 runner ⇒ 不含争用，是下界）',
      runs: 7,
      shards: 14,
      minShardMin: 11.2,
      p50ShardMin: 18.6,
      maxShardMin: 23.2,
      source: 'quality-gate.yml main push 里 name 以 "QG Desktop Shards" 开头且 conclusion=success 的'
        + '作业 started_at/completed_at（复测入口 scripts/electron-ci-shard-audit.js 的第②档）',
    },
    {
      collectedAt: '2026-10-22',
      runnerShape: '2 shards / 1 job / 1 runner（**本步真实形状** ⇒ 含两片争用）',
      runs: 10,
      shards: 8,
      minShardMin: 19.4,
      p50ShardMin: 22.1,
      maxShardMin: 23.6,
      source: 'node scripts/electron-ci-shard-audit.js 逐字读数（不是手填）：runs=10 shards=8 min=19.4 '
        + 'p50=22.1 max=23.6 budgetFloorSec=2122 stepBudgetSec=2700 verdict=OK，'
        + '全部(分钟)=22.9,20.2,23.6,20.6,22.1,19.4,23.3,20.8',
    },
  ],
  source: '复测入口 scripts/electron-ci-shard-audit.js：① 新形状上线后读 electron-ci.yml push 的 '
    + 'electron-tests 作业日志里 `[electron-ci-step] shard=… elapsed=…ms` 逐片墙钟；'
    + '② 上线前的替代基线读 quality-gate.yml 里 name 以 "QG Desktop Shards" 开头且 conclusion=success '
    + '的作业，时长取该作业自己的 started_at/completed_at（不用 run 级）。'
    + '2026-10-21 实跑读数：runs=7 shards=14 min=11.2 p50=18.6 max=23.2 ⇒ max*1.5=2091s',
};

/** @param {number} index 1-based @param {number} count */
function buildShardArgs (index, count) {
  // ⛔ 不写独立 `--`：#3315 实测独立 `--` 之后的参数会被转发层当成"给任务命令的参数"，
  //    对选择集无效；这里全部平铺，`--shard` 与其它旗标同级。
  return [
    '--filter', DESKTOP_PKG, 'test',
    '--shard=' + index + '/' + count,
    '--maxWorkers=1',
    '--no-file-parallelism',
    '--reporter=verbose',
    '--testTimeout=10000',
    '--hookTimeout=10000',
    '--teardownTimeout=10000',
  ];
}

function stripAnsi (text) {
  return String(text == null ? '' : text).replace(new RegExp(String.fromCharCode(27) + '\\[[0-9;]*m', 'g'), '');
}

const DONE_LINE = /^[ \t]*[✓×↓-]/;
const SUMMARY_LINE = /^[ \t]*(Test Files|Tests)\s/;

/** 「有多少条测试真的跑完了」——必须先剥 ANSI，否则对 vitest 真实输出恒 0（本次修的失明）。 */
function countCompletedTests (text) {
  return stripAnsi(text).split(/\r?\n/).filter((l) => DONE_LINE.test(l)).length;
}
/** vitest 摘要行；**被掐断的趟返回 0 是正确读数**，不得与"计数器坏"同形（见 formatCounters）。 */
function countSummaryLines (text) {
  return stripAnsi(text).split(/\r?\n/).filter((l) => SUMMARY_LINE.test(l)).length;
}
function formatCounters (text) {
  return 'completed=' + countCompletedTests(text) + ' summary=' + countSummaryLines(text);
}

/** 四档各自可分辨：`timeout` 与 `failed` 的修法相反，混档等于把预算墙读成用例坏。 */
function classifyShard (res) {
  if (res == null) return 'crashed';
  if (res.timedOut === true || (res.rc == null && res.signal)) return 'timeout';
  if (res.rc === 0) return 'ok';
  if (typeof res.rc === 'number') return 'failed';
  return 'crashed';
}

const sleepDefault = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * 起 `SHARD_COUNT` 片，**先全部启动再等**（串行就是本片的失效形态），共享同一份 `budgetMs`。
 * @returns {Promise<{rc:number, verdicts:Object, elapsedMs:number, counters:Object, report:string}>}
 */
async function runStep (opts) {
  const spawnImpl = opts.spawnImpl;
  const budgetMs = opts.budgetMs == null ? STEP_BUDGET_MS : opts.budgetMs;
  const now = opts.now || Date.now;
  const sleep = opts.sleep || sleepDefault;
  // 默认走各片自己带回来的 kill（realSpawn 给的即是）；测试注入自己的 spy。
  const kill = opts.kill || ((shard, handle) => { if (handle && typeof handle.kill === 'function') handle.kill(); });
  const count = opts.shardCount || SHARD_COUNT;

  const startedAt = now();
  const handles = [];
  for (let i = 1; i <= count; i++) {
    const argv = buildShardArgs(i, count);
    handles.push(Object.assign({ shard: argv.find((a) => /^--shard=/.test(a)) }, spawnImpl(argv)));
  }
  // ↑ 上面这个循环里**没有任何 await** ⇒ 两片都已启动；回归锁正是钉这一点的。
  const deadline = sleep(Math.max(1, budgetMs)).then(() => 'deadline');
  const verdicts = {};
  const outputs = {};
  // 逐片墙钟：并行争用倍数是这片**唯一没测过**的因子，取数只能从真跑的现场来，
  // 所以每片收敛时各记一次（不记就等于"文档里写了要重测、现场却没有任何东西可测"）。
  const shardElapsed = {};
  const settled = new Set();
  for (const h of handles) {
    Promise.resolve(h.done).then((r) => {
      verdicts[h.shard] = classifyShard(r);
      outputs[h.shard] = String((r && r.stdout) || '') + String((r && r.stderr) || '');
      shardElapsed[h.shard] = Math.max(0, (now() - startedAt) || 0);
      settled.add(h.shard);
    }, (e) => {
      verdicts[h.shard] = 'crashed';
      outputs[h.shard] = String(e && e.message);
      shardElapsed[h.shard] = Math.max(0, (now() - startedAt) || 0);
      settled.add(h.shard);
    });
  }
  while (settled.size < handles.length) {
    // ⛔ 必须 allSettled 而不是 race(h.done)：race 在**第 1 片**收敛时就报 all，
    // 于是慢的那片既没被等也没被归类 —— 实测症状是 verdict 里整格缺席（比判错更坏：它看着像"没跑"）。
    const who = await Promise.race([
      Promise.allSettled(handles.map((h) => h.done)).then(() => 'all'),
      deadline,
    ]);
    if (who === 'all') break;
    for (const h of handles) {
      if (!settled.has(h.shard)) {
        try { kill(h.shard, h); } catch (e) { /* 杀不掉仍按 timeout 归档，不得因为杀失败就改判 */ }
        verdicts[h.shard] = 'timeout';
        outputs[h.shard] = '';
        shardElapsed[h.shard] = Math.max(0, (now() - startedAt) || 0);
        settled.add(h.shard);
      }
    }
    break;
  }
  const elapsedMs = Math.max(0, (now() - startedAt) || 0);
  const lines = [];
  for (const h of handles) {
    lines.push('[electron-ci-step] shard=' + h.shard + ' verdict=' + (verdicts[h.shard] || 'unknown')
      + ' elapsed=' + (shardElapsed[h.shard] == null ? 'unknown' : shardElapsed[h.shard]) + 'ms'
      + ' ' + formatCounters(outputs[h.shard] || '') + ' 共享预算=' + budgetMs + 'ms');
  }
  const maxShardMs = Object.keys(shardElapsed).reduce((mx, k) => Math.max(mx, shardElapsed[k]), 0);
  lines.push('[electron-ci-step] maxShardElapsed=' + maxShardMs + 'ms ⇒ 复测入口 node scripts/electron-ci-shard-audit.js'
    + '（按新形状重算分布并核对 STEP_BUDGET_PROVENANCE）');
  const timedOut = Object.keys(verdicts).some((k) => verdicts[k] === 'timeout');
  const failed = Object.keys(verdicts).some((k) => verdicts[k] === 'failed' || verdicts[k] === 'crashed');
  const rc = timedOut ? 124 : (failed ? 1 : 0);
  lines.push('[electron-ci-step] elapsed=' + elapsedMs + 'ms budget=' + budgetMs + 'ms rc=' + rc);
  if (rc === 124) {
    lines.push('TIMEOUT_BUDGET_EXCEEDED：本轮被**整步共享**预算掐断，不是断言失败。'
      + '逐片计数用剥过 ANSI 的实现（见 scripts/electron-ci-desktop-step.js 顶部第 2 条）；'
      + 'summary=0 在 timeout 档是**正确读数**（被杀趟没有摘要行），不得据此判工具坏。');
  }
  return { rc, verdicts, elapsedMs, shardElapsed, outputs, report: lines.join('\n') };
}

/** CI 入口：真起 pnpm 子进程；本地/测试一律走 runStep({spawnImpl}) 注入，不打真进程。 */
function realSpawn (argv) {
  const { spawn } = require('node:child_process');
  const child = spawn('pnpm', argv, {
    cwd: REPO_ROOT,
    // win32 上 pnpm 是 .cmd shim，无 shell 会 ENOENT；参数全是旗标、无用户输入，不存在注入面。
    shell: process.platform === 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let out = '';
  // 32MB 上限保护的是**本机这个父进程**的内存，不是判定：rc 一律取自子进程退出码，
  // 截断只会让 `completed=`/`summary=` 这两个诊断计数偏小，不会把 timeout 读成 ok 或反之。
  // 登记为遗留（见执行记录）：真要精确到最后一行，应改成流式计数而不是整份缓冲。
  const cap = 32 * 1024 * 1024;
  child.stdout.on('data', (c) => { out = (out + c).slice(0, cap); process.stdout.write(c); });
  child.stderr.on('data', (c) => { out = (out + c).slice(0, cap); process.stderr.write(c); });
  const done = new Promise((resolve) => {
    child.on('close', (code, signal) => resolve({ rc: code, signal, stdout: out, stderr: '' }));
    child.on('error', (e) => resolve({ rc: null, signal: null, timedOut: false, stdout: out, error: String(e.message) }));
  });
  return { shard: argv.find((a) => /^--shard=/.test(a)), done, kill: () => child.kill('SIGTERM') };
}

async function main () {
  // kill 不需要在这里接：realSpawn 每片自带 kill，runStep 的默认 kill 直接用它。
  const res = await runStep({ spawnImpl: realSpawn, budgetMs: STEP_BUDGET_MS });
  process.stderr.write(res.report + '\n');
  process.exitCode = res.rc;
}

module.exports = {
  SHARD_COUNT, STEP_BUDGET_MS, SHARD_TIMEOUT_MS, STEP_BUDGET_PROVENANCE,
  buildShardArgs, stripAnsi, countCompletedTests, countSummaryLines, formatCounters,
  classifyShard, runStep, realSpawn,
};

if (require.main === module) { main(); }
