// 全仓 CI 作业超时的取证锁（node:test，只用内置模块 —— 本文件接在 quality-gate.yml 的 changes job，
// 那个 job 没有 Install deps，任何第三方 require 会当场 MODULE_NOT_FOUND）。
//
// 它守的四件事，逐条对应实测到的形状：
//   ① 数值必须由**可重跑的采集**支撑（不是把一次读数抄进注释）；
//   ② 成功样本是**右截尾**的 —— 贴着天花板的那几趟永远不会以"成功"出现，所以 max 单独不构成预算依据；
//   ③ 采集器与受检常量**必须同源**：字段漂移一次的 provenance，读起来完全像有效；
//   ④ 2026-10-20 扩到全仓 24 格后新增：**清单棘轮** —— workflow 里新出现的裸常量必须当场红，
//      登记项消失也必须红，否则"纳入治理"只是一次性快照，下一个会话照样能加一个没人看的数。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SELF = path.join(__dirname, 'check-coverage-budget.js');
const mod = require(SELF);
const regLib = require(path.join(__dirname, 'lib', 'gate-timeout-registry.js'));
const prov = regLib;
const sampler = require(path.join(__dirname, 'coverage-budget-sample.js'));

const ROOT = path.join(__dirname, '..');
const REAL_WORKFLOW = fs.readFileSync(
  path.join(ROOT, '.github', 'workflows', 'quality-gate.yml'), 'utf8');

function withTimeout(yaml, minutes) {
  return yaml.replace(
    /(name: QG Coverage[\s\S]*?timeout-minutes: )\d+/, '$1' + minutes);
}

test('0 真实仓当场读数合规（锁存在不等于它现在红着）', () => {
  const r = mod.judgeWorkflow({ workflowText: REAL_WORKFLOW, provenance: prov.PROVENANCE });
  assert.equal(r.judgeError, false, JSON.stringify(r.reasons));
  assert.equal(r.ok, true, JSON.stringify(r.violations));
  assert.ok(r.timeoutMinutes >= 1, '必须真读到数值：' + JSON.stringify(r));
});

test('1 读的是被点名那一格，不是文件里第一个 timeout-minutes', () => {
  // 双向对照：baseline 读 visual=20；把 **另一个作业**（visual）改成 99 后，
  // 同一个调用必须跟着变成 99（证明块域解析跟着我改的那格走，而不是命中固定第一处），
  // 而 coverage 的读数必须**不变**（别的格变大不得改变本作业的读数）。
  assert.equal(mod.parseJobTimeout(REAL_WORKFLOW, 'visual'), 20, 'baseline 就没读对那一格');
  const other = REAL_WORKFLOW.replace(
    /(name: QG Visual[\s\S]*?timeout-minutes: )\d+/, '$199');
  assert.notEqual(other, REAL_WORKFLOW, '负控没落地：QG Visual 段里没找到 timeout-minutes');
  assert.equal(mod.parseJobTimeout(other, 'visual'), 99, '改哪格就读哪格 —— 块域失效时这里不会跟着动');
  const r = mod.judgeWorkflow({ workflowText: other, provenance: prov.PROVENANCE });
  assert.equal(r.timeoutMinutes, prov.PROVENANCE.timeoutMinutes,
    '同文件另一格变大不得改变本作业的读数');
});

test('2 预算低于 floor × 安全系数 ⇒ UNDER_BUDGET（floor 取"成功最大值"与"截尾天花板"里的较大者）', () => {
  const r = mod.judgeWorkflow({
    workflowText: withTimeout(REAL_WORKFLOW, 30),
    provenance: prov.PROVENANCE,
  });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === 'UNDER_BUDGET'),
    JSON.stringify(r.violations));
});

test('2b 被天花板杀过 ⇒ 成功样本的最大值不得单独当上界（右截尾）', () => {
  // 形状：成功最大 10 分，但天花板是 40 且那里杀过 2 趟 ⇒ 真实上界至少 40，required 必须是 60。
  const r = mod.judgeWorkflow({
    timeoutMinutes: 50,
    provenance: Object.assign({}, prov.PROVENANCE, {
      maxMinutes: 10, p90Minutes: 10, samples: 40,
      censoredAtCeiling: 2, ceilingMinutesSampled: 40, timeoutMinutes: 50,
    }),
  });
  assert.equal(r.requiredMinutes, 60, JSON.stringify(r));
  assert.ok(r.violations.some((v) => v.rule === 'UNDER_BUDGET'),
    '贴天花板被杀的趟不得因为"成功样本很短"而被当成不存在：' + JSON.stringify(r.violations));
});

test('2c 没有被杀的趟 ⇒ floor 就取成功最大值（不得凭空按天花板抬价）', () => {
  const r = mod.judgeWorkflow({
    timeoutMinutes: 20,
    provenance: Object.assign({}, prov.PROVENANCE, {
      maxMinutes: 10, p90Minutes: 10, samples: 40,
      censoredAtCeiling: 0, ceilingMinutesSampled: 40, timeoutMinutes: 20,
    }),
  });
  // 没有被杀的趟时，天花板**不得**参与定 floor：否则一个从未被击中的 40 会把 required 抬到 60，
  // 判据就从"按观测定数"退化成"按最坏想象定数"。
  assert.equal(r.requiredMinutes, 15, JSON.stringify(r));
  assert.equal(r.ok, true, 'timeout=20 ≥ required=15 时这条预算是站得住的');
  const tight = mod.judgeWorkflow({
    timeoutMinutes: 12,
    provenance: Object.assign({}, prov.PROVENANCE, {
      maxMinutes: 10, p90Minutes: 10, samples: 40,
      censoredAtCeiling: 0, ceilingMinutesSampled: 40, timeoutMinutes: 12,
    }),
  });
  assert.equal(tight.requiredMinutes, 15, 'floor 必须仍是 10，不是天花板 40');
  assert.ok(tight.violations.some((v) => v.rule === 'UNDER_BUDGET'), JSON.stringify(tight.violations));
});

test('3 样本量不足 ⇒ INSUFFICIENT_SAMPLES（一次读数不构成分布）', () => {
  const r = mod.judgeWorkflow({
    workflowText: REAL_WORKFLOW,
    provenance: Object.assign({}, prov.PROVENANCE, { samples: 1, maxMinutes: 1 }),
  });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === 'INSUFFICIENT_SAMPLES'),
    JSON.stringify(r.violations));
});

test('4 provenance 过期 ⇒ STALE_PROVENANCE（"量过一次"会随仓库变成假话）', () => {
  const r = mod.judgeWorkflow({
    workflowText: REAL_WORKFLOW,
    provenance: Object.assign({}, prov.PROVENANCE, { collectedAt: '2020-01-01' }),
  });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === 'STALE_PROVENANCE'),
    JSON.stringify(r.violations));
});

test('5 provenance 记的数值与 workflow 实际值不同源 ⇒ PROVENANCE_VALUE_DRIFT', () => {
  const r = mod.judgeWorkflow({
    workflowText: withTimeout(REAL_WORKFLOW, prov.PROVENANCE.timeoutMinutes + 1),
    provenance: prov.PROVENANCE,
  });
  assert.equal(r.ok, false);
  assert.ok(r.violations.some((v) => v.rule === 'PROVENANCE_VALUE_DRIFT'),
    JSON.stringify(r.violations));
});

test('6 读不到 timeout-minutes 是判据自身失明，走退出码 2 而不是"违规"', () => {
  const stripped = REAL_WORKFLOW.replace(
    /(name: QG Coverage[\s\S]*?timeout-minutes: )\d+/, '$1');
  assert.equal(mod.parseJobTimeout(stripped, 'coverage'), null);
  const r = mod.judgeWorkflow({ workflowText: stripped, provenance: prov.PROVENANCE });
  assert.equal(r.judgeError, true, '把"没读到"读成"没问题"是本仓装饰性门禁的同型');
  assert.equal(mod.EXIT_JUDGE_ERROR, 2);
});

test('7 采集器与受检常量字段必须同源（字段漂移的 provenance 看起来完全像有效）', () => {
  const built = sampler.buildProvenance(
    [{ min: 10, concl: 'success' }, { min: 12, concl: 'success' }, { min: 40, concl: 'cancelled' }],
    { runsListed: 3, collectedAt: '2026-01-01' });
  const got = Object.keys(built).sort();
  const want = Object.keys(prov.PROVENANCE).sort();
  assert.deepEqual(got, want,
    '采集器产出的字段集与 provenance 不一致：多出=' + JSON.stringify(got.filter((k) => !want.includes(k))) +
    ' 缺少=' + JSON.stringify(want.filter((k) => !got.includes(k))));
  // 只比键名集合的 parity 对「字段语义漂移」结构性免疫（QM-6 后端轴 C3 命中）：
  // samples 变成均值、maxMinutes 变成"所有趟的最大值（含 cancelled）"都能过键名锁。
  assert.ok(Number.isInteger(built.samples) && built.samples === 2,
    'samples 必须是成功样本的**计数**：' + JSON.stringify(built));
  assert.equal(built.maxMinutes, 12,
    'maxMinutes 必须是成功样本的最大值（10/12 里的 12），不得把 40 分那趟被杀的记录进来');
  assert.ok(built.p90Minutes <= built.maxMinutes,
    'p90 不得大于 max，否则分位数算的是另一个总体：' + JSON.stringify(built));
});

test('8 贴天花板被杀的趟数必须进 provenance，否则"max"是被天花板裁过的假数', () => {
  const built = sampler.buildProvenance(
    [{ min: 40, concl: 'cancelled' }, { min: 40, concl: 'cancelled' }, { min: 9, concl: 'success' }],
    { runsListed: 3, collectedAt: '2026-01-01' });
  assert.equal(built.censoredAtCeiling, 2, JSON.stringify(built));
  // 成功样本的最大值与"被截尾"的读数必须分开报，混在一起会把天花板读成分布的上界
  assert.equal(built.maxMinutes, 9);
});

test('8b 截尾窗口是单边下界：杀在天花板"之上一点"仍算被天花板杀，中途取消不算', () => {
  // GitHub 掐作业有收尾延迟，实测被杀趟常比天花板多几十秒（40.3 分）；
  // 判据若写成 |ceiling - min| <= 0.5 就会把这一格漏掉 —— 那正是"被杀"最常见的外观。
  const built = sampler.buildProvenance(
    [{ min: 40.3, concl: 'cancelled' }, { min: 30, concl: 'cancelled' }, { min: 12, concl: 'success' }],
    { runsListed: 3, collectedAt: '2026-01-01', ceilingMinutes: 40 });
  assert.equal(built.censoredAtCeiling, 1, JSON.stringify(built));
  assert.equal(built.ceilingMinutesSampled, 40, '天花板锚点必须随读数一起出口，否则下一个人不知道它绑哪条线');
});

test('9 零样本必须出声并以非零码失败（"没采到"不得读成"没有长尾"）', () => {
  const r = sampler.summarize([]);
  assert.equal(r.samples, 0);
  assert.equal(r.hasData, false, '零样本不得产出一张看起来可用的 provenance');
});

test('9b 取不到时长的活跃趟必须被数出来（漏样与"没有长尾"在现场必须可区分）', () => {
  const r = sampler.summarize([
    { concl: 'success', min: 12 },
    { concl: 'failure', min: null },      // 活跃但取不到时长 ⇒ 是漏样，不是数据
    { concl: 'skipped', min: 0 },         // 按设计跳过 ⇒ 不算漏样
  ]);
  assert.equal(r.skipped, 1, JSON.stringify(r));
  assert.equal(r.noDuration, 1, '把"没读到时长"continue 掉，判据就会把漏样读成"没有长尾"：' + JSON.stringify(r));
  assert.equal(r.samples, 1, JSON.stringify(r));
});

test('11 贴天花板警报 HUGGING：max ≥ 0.9 × timeout 时必须重定数，哪怕规则①仍站得住', () => {
  // 现场形状：timeout=40 而成功最大 39.7（0.9925）—— 下一趟被杀只是时间问题。
  const r = mod.judgeWorkflow({
    timeoutMinutes: 40,
    provenance: Object.assign({}, prov.PROVENANCE, {
      maxMinutes: 39.7, p90Minutes: 39.4, samples: 24,
      censoredAtCeiling: 0, ceilingMinutesSampled: 40, timeoutMinutes: 40,
    }),
  });
  assert.equal(r.hugging, true, JSON.stringify(r));
  assert.ok(r.violations.some((v) => v.rule === 'HUGGING'), JSON.stringify(r.violations));
  // 反向对偶：抬到 60 后同一批读数不得再报贴脸（否则这条警报是恒真的装饰）
  const ok60 = mod.judgeWorkflow({
    timeoutMinutes: 60,
    provenance: Object.assign({}, prov.PROVENANCE, {
      maxMinutes: 39.7, p90Minutes: 39.4, samples: 24,
      censoredAtCeiling: 0, ceilingMinutesSampled: 40, timeoutMinutes: 60,
    }),
  });
  assert.equal(ok60.hugging, false, JSON.stringify(ok60));
  assert.equal(ok60.ok, true, JSON.stringify(ok60.violations));
});

test('12 采集器与判据的字段清单逐字相等（漏一格时 parity 锁必须红，而不是深检恒真）', () => {
  const required = mod.judgeWorkflow({
    timeoutMinutes: 60,
    provenance: Object.assign({}, prov.PROVENANCE, { samples: 24, maxMinutes: 39.7,
      p90Minutes: 39.4, censoredAtCeiling: 0, ceilingMinutesSampled: 40, timeoutMinutes: 60 }),
  });
  assert.equal(required.ok, true);
  const missing = Object.assign({}, prov.PROVENANCE);
  delete missing.ceilingMinutesSampled;
  const r = mod.judgeWorkflow({ timeoutMinutes: 60, provenance: missing });
  assert.equal(r.judgeError, true, 'provenance 缺字段必须按判据自身失明处理');
  assert.ok(r.reasons.join(' ').indexOf('ceilingMinutesSampled') >= 0,
    '必须点名缺哪一格：' + JSON.stringify(r.reasons));
});

test('13 CLI 退出码分档：真实仓必须绿，显式注入的坏值必须判违规而不是自身故障', () => {
  const code = mod.main(['--root=' + ROOT]);
  assert.equal(code, mod.EXIT_OK, '真实仓上 CLI 必须绿');
  // 注入坏值必须**指名到格**（2026-10-20 起：--timeout 单独出现会因"不知道注入给哪一格"走退出码 2，
  // 那是把猜测变成判据的反面 —— 所以这里显式给出 --job）。
  const bad = mod.main(['--root=' + ROOT, '--job=coverage',
    '--workflow=.github/workflows/quality-gate.yml', '--timeout=1']);
  assert.equal(bad, mod.EXIT_VIOLATION, '--timeout=1 是显式注入的坏值，必须判违规而不是自身故障');
  const ambiguous = mod.main(['--root=' + ROOT, '--timeout=1']);
  assert.equal(ambiguous, mod.EXIT_JUDGE_ERROR, '--timeout 不配 --job 必须走自身故障档，不得猜');
});

// ── 2026-10-19 增：**在飞作业不是漏样**（coverage-budget-inflight） ──────────────
// 现场：`node scripts/gate-timeout-sample.js --limit=60` 连续三次以
//   「有 8~9 趟活跃作业取不到时长 —— 这是取数漏样…先修采集再谈预算」rc=2 拒绝。
// 逐趟取证后那 8~9 趟**全部是 queued / in_progress**（还没跑完，本来就没有 completed_at），
// 同窗口"已完成却无时长"的真漏样是 **0 趟**。
// 也就是说：只要仓库上有 CI 在跑，采样器就永远拒绝，预算常量于是**永远调不了** ——
// 这不是 fail-closed，是把"还没观测到"混同成"观测失败"。两类必须分开：
//   · 在飞（status != completed） ⇒ 不是样本，报出来但**不阻断**；
//   · 已完成却无时长       ⇒ 真漏样，仍然阻断（否则漏样会被读成"没有长尾"）。
test('14 在飞作业（status 非 completed）不得被算成漏样，也不得进样本分布', () => {
  const r = sampler.summarize([
    { concl: 'success', min: 41.7, status: 'completed' },
    { concl: 'success', min: 40.6, status: 'completed' },
    { concl: null, min: null, status: 'in_progress' },   // 在飞 ⇒ 不是漏样
    { concl: null, min: null, status: 'queued' },        // 排队 ⇒ 不是漏样
  ]);
  assert.equal(r.inFlight, 2, '在飞趟数必须被单独数出来：' + JSON.stringify(r));
  assert.equal(r.noDuration, 0,
    '在飞作业被算成漏样 ⇒ 只要有 CI 在跑就永远调不了预算：' + JSON.stringify(r));
  assert.equal(r.samples, 2, '在飞不得进 success 分布：' + JSON.stringify(r));
  assert.equal(r.hasData, true, JSON.stringify(r));
  assert.equal(r.maxMinutes, 41.7, JSON.stringify(r));
});

test('15 已完成却无时长仍是真漏样（这一格不许被上一条顺手放宽）', () => {
  const r = sampler.summarize([
    { concl: 'success', min: 41.7, status: 'completed' },
    { concl: 'success', min: null, status: 'completed' },  // 跑完了却没时长 ⇒ 真漏样
    { concl: 'cancelled', min: null, status: 'completed' },
    { concl: null, min: null, status: 'in_progress' },
  ]);
  assert.equal(r.noDuration, 2, '已完成缺时长必须仍计入漏样：' + JSON.stringify(r));
  assert.equal(r.inFlight, 1, JSON.stringify(r));
  // 反向对偶：只有"在飞"时不得到达阻断分支
  const onlyInflight = sampler.summarize([{ concl: null, min: null, status: 'queued' }]);
  assert.equal(onlyInflight.noDuration, 0, JSON.stringify(onlyInflight));
  assert.equal(onlyInflight.inFlight, 1, JSON.stringify(onlyInflight));
});

test('16 接线锁：采集必须带上 status，且退出码决策必须可被行为断言钉住', () => {
  const src = fs.readFileSync(path.join(__dirname, 'coverage-budget-sample.js'), 'utf8');
  assert.match(src, /status:\s*j\.status|status:\s*job\.status/,
    'collect() 必须把作业 status 记进行里，否则"在飞"与"漏样"在数据层就分不开');
  assert.match(src, /inFlight/, 'summarize 必须输出 inFlight 这一格');
  assert.match(src, /in_flight=/, '汇总行必须打印在飞趟数，静默剔除会让分母不可见');

  // ★ 2026-10-19 修正：上一版这里只有正则结构断言（/sum\.noDuration\s*>\s*0/），
  //   而实测 `if (false && sum.noDuration > 0)` 这种**架空阻断**的写法完全匹配 ⇒ 变异 M3 不红。
  //   结构锁看不出"条件被短路"，所以决策抽成 refusalCode 纯函数、在这里做行为断言。
  const code = (sum, probeErrors) => sampler.refusalCode(sum, probeErrors);
  assert.equal(code({ noDuration: 0, inFlight: 0, hasData: true }, 0), 0,
    '干净窗口必须放行');
  assert.equal(code({ noDuration: 1, inFlight: 0, hasData: true }, 0), 2,
    '真漏样必须阻断 —— 这一格被架空就等于把漏样读成"没有长尾"');
  assert.equal(code({ noDuration: 0, inFlight: 9, hasData: true }, 0), 0,
    '★ 在飞作业不得阻断采样：这一格失守，只要仓库有 CI 在跑就永远调不了预算');
  assert.equal(code({ noDuration: 0, inFlight: 0, hasData: true }, 1), 2,
    'probe_errors>0 仍必须阻断');
  assert.equal(code({ noDuration: 0, inFlight: 0, hasData: false }, 0), 1,
    '零样本必须非零出声（"没采到"不是"没有长尾"）');
});

// ── 2026-10-20 增：**清单棘轮**（change: gate-timeout-all-cells）─────────────────
// 现场：全仓实测 24 格 `timeout-minutes` 分布在 11 个 workflow，而此前只有 `QG Coverage`
// 一格有人看。只把 24 格抄进一张表是**一次性快照** —— 下一个会话照样能新增一个没人看的裸常量。
// 所以真正要装的是棘轮：workflow 里出现的每一格都必须在册，登记项消失也必须出声。

/** 造一份最小可用注册表（judgeRegistry 只读 raw.jobs/raw.minSamples 等标量）。 */
function syntheticRegistry(jobs) {
  return {
    raw: { schema: 1, minSamples: 20, staleDays: 90, seededGraceDays: 30, jobs },
    jobs: jobs.slice(),
    byKey: new Map(jobs.map((j) => [j.workflow + '#' + j.jobId, j])),
  };
}
function jobFixture(over) {
  return Object.assign({
    workflow: '.github/workflows/demo.yml',
    jobId: 'demo',
    displayName: 'demo',
    timeoutMinutes: 10,
    state: 'measured',
    provenance: {
      samples: 25, maxMinutes: 2, p90Minutes: 1.8, censoredAtCeiling: 0,
      ceilingMinutesSampled: 10, runsListed: 30, collectedAt: '2026-10-18',
    },
  }, over || {});
}
const DEMO_YAML = 'jobs:\n  demo:\n    name: demo\n    runs-on: ubuntu-latest\n    timeout-minutes: 10\n';

test('17 棘轮①：workflow 里出现注册表没登记的 timeout-minutes ⇒ UNREGISTERED_TIMEOUT_CELL', () => {
  const r = mod.judgeRegistry({
    registry: syntheticRegistry([jobFixture()]),
    workflows: ['.github/workflows/demo.yml'],
    readWorkflow: () => DEMO_YAML + '  sneaky:\n    name: sneaky\n    timeout-minutes: 30\n',
  });
  assert.equal(r.judgeError, false, JSON.stringify(r.reasons));
  assert.equal(r.ok, false, '多出一格未登记的裸常量必须判红');
  const v = r.violations.find((x) => x.rule === 'UNREGISTERED_TIMEOUT_CELL');
  assert.ok(v, '必须点名 UNREGISTERED_TIMEOUT_CELL，实际：' + JSON.stringify(r.violations));
  assert.equal(v.key, '.github/workflows/demo.yml#sneaky');
});

test('18 棘轮②：注册表登记了但 workflow 里已读不到该格 ⇒ MISSING_TIMEOUT_CELL', () => {
  const jobs = [jobFixture(), jobFixture({ jobId: 'gone', displayName: 'gone' })];
  const r = mod.judgeRegistry({
    registry: syntheticRegistry(jobs),
    workflows: ['.github/workflows/demo.yml'],
    readWorkflow: () => DEMO_YAML,
  });
  assert.equal(r.ok, false, '登记项消失必须判红（否则表会越来越像"全部合规"）');
  const v = r.violations.find((x) => x.rule === 'MISSING_TIMEOUT_CELL');
  assert.ok(v, '必须点名 MISSING_TIMEOUT_CELL，实际：' + JSON.stringify(r.violations));
  assert.equal(v.key, '.github/workflows/demo.yml#gone');
});

test('19 缩进纪律：步级 timeout-minutes（8 空格）不得被读成作业级（实测把 70 读成 10）', () => {
  const text = fs.readFileSync(path.join(ROOT, '.github', 'workflows', 'electron-ci.yml'), 'utf8');
  const scan = mod.scanTimeoutCells(text);
  assert.equal(scan.cells.get('electron-tests'), 70,
    'electron-tests 的作业级天花板是 70；读成 10 会让一格合规作业报 UNDER_BUDGET（假违规与假绿同害）');
  assert.equal(scan.cells.get('changes'), 5, '同一文件里另一格（changes）也必须读对');
  assert.ok(scan.stepLevel.length >= 2,
    '两个 8 空格的步级 timeout-minutes 必须被单列出来（不得静默忽略，也不得混进作业级）：' +
    JSON.stringify(scan.stepLevel));
  assert.equal(mod.parseJobTimeout(text, 'electron-tests'), 70, 'parseJobTimeout 必须与扫描器同口径');
});

test('20 state=seeded 双向出声：攒够了不升级 / 宽限期到期仍不足，都必须红', () => {
  const yaml = 'jobs:\n  demo:\n    timeout-minutes: 10\n';
  const stale = mod.judgeRegistry({
    registry: syntheticRegistry([jobFixture({ state: 'seeded',
      provenance: Object.assign({}, jobFixture().provenance, { samples: 25 }) })]),
    workflows: ['.github/workflows/demo.yml'],
    readWorkflow: () => yaml,
  });
  assert.ok(stale.violations.some((x) => x.rule === 'SEEDED_STALE'),
    'samples ≥ minSamples 却仍标 seeded ⇒ 该升级（宽限期不是永久豁免）：' + JSON.stringify(stale.violations));

  const expired = mod.judgeRegistry({
    registry: syntheticRegistry([jobFixture({ state: 'seeded',
      provenance: Object.assign({}, jobFixture().provenance, { samples: 5, collectedAt: '2026-01-01' }) })]),
    workflows: ['.github/workflows/demo.yml'],
    readWorkflow: () => yaml,
  });
  assert.ok(expired.violations.some((x) => x.rule === 'SEEDED_EXPIRED'),
    '宽限期到期样本仍不足 ⇒ 必须重采或降级说明：' + JSON.stringify(expired.violations));
});

test('21 注册表校验器 fail closed：坏字段一律抛，不得静默放过', () => {
  const good = JSON.parse(fs.readFileSync(path.join(ROOT, 'scripts', 'gate-timeout-registry.json'), 'utf8'));
  const clone = () => JSON.parse(JSON.stringify(good));
  const cases = [
    ['schema 错', (c) => { c.schema = 2; }],
    ['重复登记', (c) => { c.jobs.push(JSON.parse(JSON.stringify(c.jobs[0]))); }],
    ['p90 > max', (c) => { c.jobs[0].provenance.p90Minutes = c.jobs[0].provenance.maxMinutes + 1; }],
    ['samples > runsListed', (c) => { c.jobs[0].provenance.samples = c.jobs[0].provenance.runsListed + 1; }],
    ['state 非法', (c) => { c.jobs[0].state = 'nope'; }],
    ['collectedAt 非 YYYY-MM-DD', (c) => { c.jobs[0].provenance.collectedAt = '2026/10/18'; }],
    ['workflow 不是 workflows 路径', (c) => { c.jobs[0].workflow = 'quality-gate.yml'; }],
    ['timeout 非整数', (c) => { c.jobs[0].timeoutMinutes = 5.5; }],
  ];
  for (const [name, mutate] of cases) {
    const c = clone();
    mutate(c);
    assert.throws(() => regLib.validateRegistry(c), /GATE-TIMEOUT-REGISTRY/,
      name + ' 必须抛错（半份注册表比没有注册表更危险：它会以合法外表继续放行）');
  }
  assert.equal(regLib.validateRegistry(good), true, '真实注册表必须通过校验');
});

test('22 真实仓全量对账：24 格都在册且都合规（棘轮自证覆盖面对齐）', () => {
  const r = mod.judgeRegistry({ root: ROOT });
  assert.equal(r.judgeError, false, JSON.stringify(r.reasons));
  assert.deepEqual(r.violations, [], '真实仓上不得有违规：' + JSON.stringify(r.violations));
  const reg = regLib.loadRegistry(ROOT);
  assert.equal(r.cells.length, reg.jobs.length,
    '判定格数必须等于注册表格数 —— 少一格说明有登记项没被真正判定（假绿形态）');
  assert.ok(reg.jobs.length >= 20, '治理面不得悄悄缩水：实测全仓 24 格，现在只剩 ' + reg.jobs.length);
  // 注册表里每一格都必须在 workflow 里真实存在（反向也要成立，不然棘轮只管一半）
  for (const j of reg.jobs) {
    const text = fs.readFileSync(path.join(ROOT, j.workflow), 'utf8');
    assert.equal(mod.parseJobTimeout(text, j.jobId), j.timeoutMinutes,
      j.workflow + '#' + j.jobId + ' 的注册值与 workflow 实际值必须逐字相等');
  }
});
