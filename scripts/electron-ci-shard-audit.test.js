/**
 * `scripts/electron-ci-shard-audit.js` 的回归锁。
 *
 * 这个审计本体存在的唯一理由：`STEP_BUDGET_PROVENANCE` 里的数字必须**有东西能重取**，
 * 否则"量过一次之后没人再量"就是注释里的愿望（本仓对 *_PROVENANCE 的三条口径：常量旁给出处、
 * 每次真跑留痕、复测入口落在仓库里且输出字段与 provenance 逐字段对齐）。
 * 因此这里最硬的一条是「字段对齐」与「零样本不得读成通过」——
 * 后者是"探针失明"的入口：审计取不到数时若返回 0，下一个会话会把"没量到"读成"预算没问题"。
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const audit = require('./electron-ci-shard-audit.js');
const step = require('./electron-ci-desktop-step.js');
const REPO = path.resolve(__dirname, '..');

const P = step.STEP_BUDGET_PROVENANCE;

test('清单：FIELDS 只能由人改，且 provenance 的两个口径字段必须出现在审计输出里', () => {
  assert.deepEqual(audit.FIELDS, ['runs', 'shards', 'minShardMin', 'p50ShardMin', 'maxShardMin',
    'budgetFloorSec', 'stepBudgetSec', 'safetyMultiplier', 'collectedAt', 'source'],
    '输出字段清单被改动 ⇒ 同步核对 STEP_BUDGET_PROVENANCE 是否还能逐字段对上');
  const s = audit.summarize([10], 'x', 1);
  // 「逐字段对齐」的具体含义：审计报出的 safetyMultiplier / collectedAt **就是** provenance 里那两个值。
  // 只写"输出里有个叫 safetyMultiplier 的键"是不够的——键在值错照样骗人。
  assert.equal(s.safetyMultiplier, P.safetyMultiplier);
  assert.equal(s.collectedAt, P.collectedAt);
  assert.equal(s.stepBudgetSec, Math.round(step.STEP_BUDGET_MS / 1000));
});

test('当前仓内读数必须支持当前预算：budget ≥ max × 倍数，且贴脸单独成档不被放行', () => {
  const floor = Math.round(P.maxObservedShardMin * 60 * P.safetyMultiplier);
  const budget = Math.round(step.STEP_BUDGET_MS / 1000);
  assert.ok(budget >= floor, '预算低于实测地板 ⇒ 改形状或重测，不得放宽本判据（floor=' + floor + ' budget=' + budget + '）');
  assert.ok(budget >= floor * 1.1, '贴脸（余量 <10%）单独判 HUGGING，不得混进 OK');
  assert.ok(budget > P.maxObservedShardMin * 60, '预算必须大于观测最大值本身');
});

test('逐片墙钟的锚必须只认新形状：带时间戳与 ANSI 前缀的真实行取得到，旧形状行取不到', () => {
  const ESC = String.fromCharCode(27);
  const real = '2026-10-21T07:52:30.4123456Z ' + ESC + '[32m[electron-ci-step] shard=--shard=1/2 '
    + 'verdict=ok elapsed=1500000ms completed=9000 summary=2' + ESC + '[39m\n';
  const got = audit.parseShardElapsed(real);
  assert.equal(got.length, 1, 'Actions 日志每行带时间戳前缀，不剥就恒不命中（本仓踩过的同型失明）');
  assert.equal(got[0].elapsedMs, 1500000);
  assert.equal(got[0].shard, '--shard=1/2');
  // 负控：旧形状（没有 elapsed= 的自证行）必须取不到，否则这条锚测的是"任何像日志的东西"
  assert.equal(audit.parseShardElapsed('2026-10-21T07:52:30Z [electron-ci-timeout-budget] elapsed=2100s budget=2100s rc=124\n').length, 0);
  assert.equal(audit.parseShardElapsed('').length, 0);
});

test('锚必须解析得动 runStep **真打印**的那一行（生产者↔消费者同一条缝，不能各写一份形状）', async () => {
  // 手写夹具会跟着判据一起写错（两边同形 ⇒ 永远绿）。这里把被测模块的 report 原文喂给锚。
  const spawnImpl = (argv) => ({
    shard: argv.find((a) => /^--shard=/.test(a)),
    done: Promise.resolve({ rc: 0, stdout: ' ✓ a > b 1ms\n Tests 1 passed\n', stderr: '' }),
  });
  const res = await step.runStep({
    spawnImpl, budgetMs: 5000,
    now: () => Date.now(), sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
  });
  const got = audit.parseShardElapsed(res.report);
  assert.equal(got.length, 2, 'report 里有两行逐片读数，锚必须各取到一条。report=' + JSON.stringify(String(res.report).split(/\r?\n/)));
  assert.deepEqual(got.map((g) => g.shard).sort(), ['--shard=1/2', '--shard=2/2']);
  for (const g of got) assert.ok(Number.isFinite(g.elapsedMs), 'elapsedMs 必须是数：' + JSON.stringify(g));
  // 且这些样本喂回 summarize 后必须产出真实读数（不是 NaN 档）
  const s = audit.summarize(got.map((g) => g.elapsedMs / 60000), 'new-shape', 1);
  assert.equal(s.shards, 2);
  assert.ok(['OK', 'HUGGING', 'BELOW_FLOOR'].indexOf(s.verdict) >= 0, '有样本时不得报 NO_SAMPLES：' + s.verdict);
});

test('采样两档不得混记：新形状有样本时一次都不查 legacy；legacy 必须自报"下界"', () => {
  let legacyQueried = 0;
  const api = {
    ghJson: (args) => {
      if (args[0] === 'run' && String(args[2]).indexOf('electron-ci.yml') >= 0) return [{ databaseId: 1, status: 'completed' }];
      if (args[0] === 'run') { legacyQueried++; return []; }
      return { jobs: [{ id: 9, name: 'electron-tests', conclusion: 'success' }] };
    },
    ghText: () => '[electron-ci-step] shard=--shard=1/2 verdict=ok elapsed=1200000ms completed=1 summary=1\n',
  };
  const s = audit.collect({ runs: 2, api });
  assert.equal(s.shards, 1);
  assert.equal(legacyQueried, 0, '新形状已有逐片实测时退回 legacy 会把"每片独占 runner"的下界当现场');
  assert.match(String(s.source), /new-shape/);

  const api2 = {
    ghJson: (args) => {
      if (args[0] === 'run' && String(args[2]).indexOf('electron-ci.yml') >= 0) return [{ databaseId: 1, status: 'completed' }];
      if (args[0] === 'run') return [{ databaseId: 7, status: 'completed' }];
      if (String(args[1]).indexOf('runs/1/') >= 0) return { jobs: [{ id: 9, name: 'electron-tests', conclusion: 'success' }] };
      return { jobs: [{ name: 'QG Desktop Shards (1/2)', conclusion: 'success',
        started_at: '2026-10-21T00:00:00Z', completed_at: '2026-10-21T00:20:00Z' }] };
    },
    ghText: () => '本趟没有新形状自证行\n',
  };
  const s2 = audit.collect({ runs: 2, api: api2 });
  assert.match(String(s2.source), /legacy/);
  assert.match(String(s2.source), /下界|不含争用/, 'legacy 档必须自己说明它是下界，否则会被读成实测争用值');
});

test('runs 是趟数而不是不同耗时值的个数（14 片 7 趟不得读成 14 趟）', () => {
  const s = audit.summarize([11.2, 11.2, 23.2, 23.2], 'x', 7);
  assert.equal(s.runs, 7);
  assert.equal(s.shards, 4);
  assert.equal(s.maxShardMin, 23.2);
});

test('verdict 四档各自可分辨：NO_SAMPLES / BELOW_FLOOR / HUGGING / OK', () => {
  const budgetSec = Math.round(step.STEP_BUDGET_MS / 1000);
  // 由预算反推"让 floor 落在哪"的 max（分钟）：floor = max*60*safetyMultiplier
  const maxFor = (ratio) => budgetSec / (60 * P.safetyMultiplier) * ratio;
  assert.equal(audit.summarize([maxFor(0.8)], 'x', 1).verdict, 'OK', '余量 ≥10%');
  assert.equal(audit.summarize([maxFor(1.0)], 'x', 1).verdict, 'HUGGING', '贴脸单独成档：这是"该重测/该抬"的事前证据，不是通过');
  assert.equal(audit.summarize([maxFor(1.5)], 'x', 1).verdict, 'BELOW_FLOOR', '低于地板必须单独成档，修法与贴脸不同');
  assert.equal(audit.summarize([], 'x', 0).verdict, 'NO_SAMPLES');
});

test('三档退出码各自可达：零样本与自身故障都是非零，不得把"没量到"读成"预算没问题"', () => {
  const sink = () => true;
  // ① 零样本 ⇒ 2 且出声
  const z = [];
  assert.equal(audit.main(['--runs=1'], { collectImpl: () => audit.summarize([], 'none', 0), write: (s) => z.push(String(s)) }), 2);
  assert.ok(z.some((l) => l.includes('NO_SAMPLES')), '零样本必须出声，不能只留一个数');
  // ② 采集自身抛错 ⇒ 2 且点名 SELF_FAULT（把工具的失败读成"没有欠账"是本仓的同型事故）
  const e = [];
  assert.equal(audit.main(['--runs=1'], { collectImpl: () => { throw new Error('GH_FAILED x'); }, write: (s) => e.push(String(s)) }), 2);
  assert.ok(e.some((l) => l.includes('SELF_FAULT')));
  // ③ 读数不支持预算 ⇒ 1，且文案禁止"放宽判据"
  const h = [];
  const budgetMin = step.STEP_BUDGET_MS / 60000;
  const hugMax = budgetMin / P.safetyMultiplier; // max*1.5 恰好等于预算 ⇒ 余量 0% ⇒ HUGGING
  assert.equal(audit.main(['--runs=1'], { collectImpl: () => audit.summarize([hugMax], 'x', 1), write: (s) => h.push(String(s)) }), 1);
  assert.ok(h.some((l) => l.includes('HUGGING')));
  assert.ok(h.some((l) => l.includes('不得') && l.includes('放宽判据')));
  // ④ 未知旗标必须抛（静默忽略会把"只跑 N 趟的 smoke"放大成整域）
  assert.throws(() => audit.parseArgs(['--limitt=3']), /未知参数/);
  assert.throws(() => audit.parseArgs(['--runs=abc']), /未知参数/);
  assert.deepEqual(audit.parseArgs(['--runs=4']), { runs: 4 });
  assert.deepEqual(audit.parseArgs(['--limit=4']), { runs: 4 });
});

test('接线：审计的回归锁必须点名在 changes job，且本体必须有 .gitignore 反选', () => {
  const wf = fs.readFileSync(path.join(REPO, '.github', 'workflows', 'quality-gate.yml'), 'utf8');
  assert.ok(wf.includes('node --test scripts/electron-ci-shard-audit.test.js'),
    '未接线的判据等于没写（本仓无自动收集，逐条显式点名）');
  const gi = fs.readFileSync(path.join(REPO, '.gitignore'), 'utf8');
  assert.ok(gi.includes('!scripts/electron-ci-shard-audit.js'),
    '第 106 行 scripts/*.js 会把本体静默忽略 ⇒ 本地全绿、CI 上 Cannot find module');
  // 反选必须写成 gitignore 的 negation 模式（`!` 开头），**注释必须用 #**：
  // 把注释写成 `! 说明文字` 会得到三条永远匹配不到任何东西的坏模式（本 PR 实测踩过并修正）。
  const bangCommentLines = gi.split(/\r?\n/).filter((l) => /^! /.test(l));
  assert.deepEqual(bangCommentLines, [], '.gitignore 里 `!` 是 negation 不是注释，`! ` 开头的行是坏模式');
});
