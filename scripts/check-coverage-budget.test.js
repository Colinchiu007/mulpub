// QG Coverage 作业超时的取证锁（node:test，只用内置模块 —— 本文件接在 quality-gate.yml 的 changes job，
// 那个 job 没有 Install deps，任何第三方 require 会当场 MODULE_NOT_FOUND）。
//
// 它守的三件事，逐条对应本轮实测到的形状：
//   ① 数值必须由**可重跑的采集**支撑（不是把一次读数抄进注释）；
//   ② 成功样本是**右截尾**的 —— 贴着天花板的那几趟永远不会以"成功"出现，所以 max 单独不构成预算依据；
//   ③ 采集器与受检常量**必须同源**：字段漂移一次的 provenance，读起来完全像有效。
'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SELF = path.join(__dirname, 'check-coverage-budget.js');
const mod = require(SELF);
const prov = require(path.join(__dirname, 'lib', 'coverage-budget-provenance.js'));
const sampler = require(path.join(__dirname, 'coverage-budget-sample.js'));

const REAL_WORKFLOW = fs.readFileSync(
  path.join(__dirname, '..', '.github', 'workflows', 'quality-gate.yml'), 'utf8');

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
  const code = mod.main(['--root=' + path.join(__dirname, '..')]);
  assert.equal(code, mod.EXIT_OK, '真实仓上 CLI 必须绿');
  const bad = mod.main(['--root=' + path.join(__dirname, '..'),
    '--timeout=1']);
  assert.equal(bad, mod.EXIT_VIOLATION, '--timeout=1 是显式注入的坏值，必须判违规而不是自身故障');
});
