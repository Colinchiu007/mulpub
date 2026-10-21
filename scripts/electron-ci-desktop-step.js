/**
 * electron-ci 桌面全量步骤的**单一实现** —— 一步之内两片并行 + 一份共享预算 + 剥 ANSI 的现场计数。
 *
 * 为什么存在（2026-10-21 全部现取读数）：
 * 1. `electron-ci.yml` 的 `Unit tests (Vitest…)` 步骤在 main push 上 8 次里 5 红，红法逐字相同
 *    （`elapsed=2100s budget=2100s rc=124` + `TIMEOUT_BUDGET_EXCEEDED`，**零断言失败**）。
 *    成功趟墙钟 25m11s / 25m42s / 31m55s，失败趟 36m38s ⇒ 贴脸逼近预算。
 * 2. 该步自己那份"跑完没有"的计数器是瞎的：`grep -cE '^[[:space:]]+[✓×↓-]'` 对 vitest 的真实行
 *    恒 0（`od -c` 实测行首是 `033[32m✓033[39m` ⇒ 第一个字符是 ESC，不是空白），
 *    于是"跑满预算"被读成"一条都没跑"。
 * 3. workflow 里内联的 bash 逻辑没有回归锁 ⇒ 按本仓范式收回单一实现，workflow 只调用不判定
 *    （同 `agent-review-gate.js` / `main-red.js` 的先例）。
 *
 * 刻意**不抬预算**：分片数取 2 之后，单步墙钟 ≈ `max(两片)`。
 * 实测 `QG Desktop Shards` 最近 7 趟 main push 的 14 个成功分片样本 = 11.2–23.2 min（p50 18.6），
 * `23.2 × 1.5 = 34.8 min = 2088s ≤ 2100s` ⇒ 现有预算恰好成立，改的是形状不是数字。
 * ⚠ 该 23.2 min 是**单片独占 runner** 时的耗时；两片并行会引入争用，真实放大倍数**尚未测过**——
 * 所以每次跑都打印逐片墙钟（`[electron-ci-step] shard=… elapsed=…`），第一次 CI 真跑后按读数重定数。
 */
'use strict';

const path = require('node:path');

const REPO_ROOT = path.resolve(__dirname, '..');
const DESKTOP_PKG = '@multi-publish/desktop';

const SHARD_COUNT = 2;
/** 整步硬预算。唯一真源：workflow 里不得再出现 2100 这个数字（由回归锁钉）。 */
const STEP_BUDGET_MS = 2100000;
/** 共享预算下单片允许跑满整步；这个相等关系是显式的，不是"没设上限"。 */
const SHARD_TIMEOUT_MS = STEP_BUDGET_MS;

/** 取值出处（可重跑）：见 `source`；判据锁住 `预算 ≥ max × 倍数` 与样本量下界。 */
const STEP_BUDGET_PROVENANCE = {
  maxObservedShardMin: 23.2,
  p50ShardMin: 18.6,
  shards: 14,
  runs: 7,
  safetyMultiplier: 1.5,
  collectedAt: '2026-10-21',
  source: 'gh api …/actions/workflows/quality-gate.yml/runs?branch=main → 逐 run …/actions/runs/<id>/jobs，'
    + '筛 name 以 "QG Desktop Shards" 开头且 conclusion=success 的作业，'
    + '时长取该作业自己的 started_at/completed_at（不用 run 级）；'
    + '重跑命令见 openspec/records/electron-tests-shard-step.md',
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

  const handles = [];
  for (let i = 1; i <= count; i++) {
    const argv = buildShardArgs(i, count);
    handles.push(Object.assign({ shard: argv.find((a) => /^--shard=/.test(a)) }, spawnImpl(argv)));
  }
  // ↑ 上面这个循环里**没有任何 await** ⇒ 两片都已启动；回归锁正是钉这一点的。
  const startedAt = now();
  const deadline = sleep(Math.max(1, budgetMs)).then(() => 'deadline');
  const verdicts = {};
  const outputs = {};
  const settled = new Set();
  for (const h of handles) {
    Promise.resolve(h.done).then((r) => {
      verdicts[h.shard] = classifyShard(r);
      outputs[h.shard] = String((r && r.stdout) || '') + String((r && r.stderr) || '');
      settled.add(h.shard);
    }, (e) => {
      verdicts[h.shard] = 'crashed';
      outputs[h.shard] = String(e && e.message);
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
        settled.add(h.shard);
      }
    }
    break;
  }
  const elapsedMs = Math.max(0, (now() - startedAt) || 0);
  const lines = [];
  for (const h of handles) {
    lines.push('[electron-ci-step] shard=' + h.shard + ' verdict=' + (verdicts[h.shard] || 'unknown')
      + ' ' + formatCounters(outputs[h.shard] || '') + ' 共享预算=' + budgetMs + 'ms');
  }
  const timedOut = Object.keys(verdicts).some((k) => verdicts[k] === 'timeout');
  const failed = Object.keys(verdicts).some((k) => verdicts[k] === 'failed' || verdicts[k] === 'crashed');
  const rc = timedOut ? 124 : (failed ? 1 : 0);
  lines.push('[electron-ci-step] elapsed=' + elapsedMs + 'ms budget=' + budgetMs + 'ms rc=' + rc);
  if (rc === 124) {
    lines.push('TIMEOUT_BUDGET_EXCEEDED：本轮被**整步共享**预算掐断，不是断言失败。'
      + '逐片计数用剥过 ANSI 的实现（见 scripts/electron-ci-desktop-step.js 顶部第 2 条）；'
      + 'summary=0 在 timeout 档是**正确读数**（被杀趟没有摘要行），不得据此判工具坏。');
  }
  return { rc, verdicts, elapsedMs, outputs, report: lines.join('\n') };
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
