'use strict';
/**
 * scripts/ccg-convergence-probe.js 的回归锁。
 * 跑法：node --test scripts/ccg-convergence-probe.test.js
 * 接线：quality-gate.yml 的 changes 作业 Gate 2b5（与 ccg-evidence-hash / ccg-record-ledger 同一步）。
 *
 * 诚实边界（每次跑都打印，不许事后猜）：vendor 引擎只在开发者机上存在，GitHub runner 上没有。
 * 所以本文件在 CI 上跑的是「缺引擎必须 rc=2 且点名探针失明」那一档；ladder 读数的断言在
 * 本机那一档执行。两档都必须**有产物**，缺档即红 —— 这是本仓「找不到就 skip 会把洞伪装成
 * 按设计跳过」那条纪律的正面执行。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const cp = require('child_process');

const probe = require('./ccg-convergence-probe.js');
const PROBE = path.join(__dirname, 'ccg-convergence-probe.js');

function runProbe (env, args) {
  const r = cp.spawnSync(process.execPath, [PROBE].concat(args || ['--json']), {
    cwd: path.resolve(__dirname, '..'), encoding: 'utf8', maxBuffer: 1 << 24,
    env: Object.assign({}, process.env, env || {}),
  });
  return { rc: r.status, out: String(r.stdout || ''), err: String(r.stderr || '') };
}

const found = probe.locateVendor();
console.log('[ccg-probe-test] vendor ' + (found ? 'FOUND: ' + found.engine : 'ABSENT（CI/无引擎档：只断言 fail-closed 那一格）'));

test('P1 契约：有引擎 ⇒ rc=0 且 ladder 读数符合；无引擎 ⇒ rc=2 且必须点名探针失明（两档都得有产物）', () => {
  const r = runProbe();
  if (!found) {
    assert.strictEqual(r.rc, 2, 'runner 上没有 vendor 引擎 ⇒ 必须是 2（探针失明），不得是 0（把没跑读成通过）：' + r.err);
    assert.match(r.err, /探针失明/, '文案必须把"探针瞎了"与"引擎没问题"分开：' + r.err);
    assert.ok(!/结论：验证层三个停止出口/.test(r.out), '失明档不得输出结论行：' + r.out);
    return;
  }
  assert.strictEqual(r.rc, 0, '本机有引擎 ⇒ 读数应成立，rc=' + r.rc + ' err=' + r.err + ' out=' + r.out);
  const j = JSON.parse(r.out);
  assert.strictEqual(j.ladder.shippedVerificationLayer.status, 'self_play', '验证层唯一可达的停止出口应是第三档');
  assert.strictEqual(j.ladder.legacyCurrentRoundOne.stop, false, '单轮 + currentRound=1 必须仍是"非终态"形状（静默放行那一格）');
  assert.strictEqual(j.ladder.stallWithOneRound.stalled, false, '单轮不可能判 stall');
  assert.strictEqual(j.ladder.secondRoundAtThreshold.status, 'converged', '第 2 轮达阈值即收敛 ⇒ 说明缺的是轮次不是出口');
  assert.strictEqual(j.driverTaskShape.currentRoundExpr, 'cfg.maxRounds', '驱动必须仍把 currentRound 报成 maxRounds，否则本篇结论作废');
  assert.ok(j.sample.cryptoItems >= 1, '夹具必须真的含 crypto 域条目（否则"出口不可达"这一格无从测起）');
});

test('P2 cfg 默认值必须现读自 vendor 源码，读不出即 null（不许回退到本地抄的一份数）', () => {
  // 读法必须与 main 同源：confidenceWeight / selfPlay.enabled 只在驱动里，maxRounds / threshold /
  // stallRounds / stallScoreDelta 只在引擎里。第一版这里只喂了 engine ⇒ 两个键恒 null，
  // 于是"探针读不出参数"被读成"探针的判据是硬的"。现走同一个 readVendorSources。
  const keys = ['maxRounds', 'scoreThreshold', 'stallRounds', 'stallScoreDelta', 'confidenceWeight', 'selfPlayEnabled'];
  if (!found) {
    for (const k of keys) {
      assert.strictEqual(probe.readDefaults(fs.readFileSync(PROBE, 'utf8'))[k], null,
        '非 vendor 源上读不出参数是预期的（本条只验"读不出→null"，不得回退成本地抄的数）：' + k);
    }
    return;
  }
  const sources = probe.readVendorSources(found);
  const real = probe.readDefaults(sources.combinedSrc);
  for (const k of keys) {
    assert.notStrictEqual(real[k], null, 'vendor 源码里读不出 ' + k + ' ⇒ 探针会 rc=2，不能悄悄沿用旧数');
    if (k === 'selfPlayEnabled') continue;
    const v = real[k];
    assert.ok(Number.isFinite(v), k + ' 必须是数字，实际读到 ' + v);
  }
  // 数字被换掉时，readDefaults 必须跟着变（证明判据真的在读源码，不是硬编码在探针里）
  const edited = probe.readDefaults(sources.combinedSrc.replace(
    /var threshold = \(cfg && cfg\.scoreThreshold\) \|\| [\d.]+/, 'var threshold = (cfg && cfg.scoreThreshold) || 4.5'));
  assert.strictEqual(edited.scoreThreshold, 4.5, '改 vendor 的阈值读数必须反映到探针（否则探针与判据脱钩）');
  // 驱动那一份也必须有读者：只读引擎时这两个键读不出，正是本条要钉住的"同源"要求
  const engineOnly = probe.readDefaults(sources.engineSrc);
  assert.strictEqual(engineOnly.confidenceWeight, null,
    'confidenceWeight 必须来自驱动 ⇒ 只喂引擎时读不出（这条若变绿说明探针又在单读一份源）');
  const driverOnly = probe.readDefaults(sources.driverSrc);
  assert.strictEqual(driverOnly.maxRounds, null, 'maxRounds 必须来自引擎 ⇒ 只喂驱动时读不出');
});

test('P3 漂移报警有牙：把驱动的 currentRound 改回 1（就是那个致命坑的形态），探针必须判偏离', () => {
  const shapeZero = probe.readDriverTaskShape('const task = {\n    currentRound: 1,\n    rounds: [{\n      round: 1, minScore: 3,');
  assert.strictEqual(shapeZero.currentRoundExpr, '1', '被禁形态必须被如实读出来');
  if (!found) return;
  const driverSrc = fs.readFileSync(probe.locateVendor().driver, 'utf8');
  const doctored = driverSrc.replace(/currentRound: cfg\.maxRounds/, 'currentRound: 1');
  assert.notStrictEqual(doctored, driverSrc, '夹具改动必须真的落到源码上（否则下面那句断言是空的）');
  const src2 = probe.readDriverTaskShape(doctored);
  assert.strictEqual(src2.currentRoundExpr, '1', 'vendor 退回静默放行形状时，本探针必须报偏离');
  // 上面三句只测了"读得出形状"，没测"读出不符时探针真的 rc=1"。那句话若不真跑一次探针，
  // 就是一句把 rc=1 写进注释的装饰性主张（本仓记作「声明与字节不同源」）。这里跑：
  // 把真引擎原样复制、只把驱动改成被禁形状，用 CCG_ARL_DIR 指过去。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-probe-doctor-'));
  try {
    const scripts = path.join(dir, 'scripts');
    fs.mkdirSync(scripts, { recursive: true });
    fs.copyFileSync(probe.locateVendor().engine, path.join(scripts, 'engine.js'));
    fs.writeFileSync(path.join(scripts, 'ccg-deep-review.js'), doctored, 'utf8');
    // CCG_ARL_DIR 指的是**技能根**（locateVendor 自己再拼 scripts/），传已含 scripts 的路径
    // 会让探针回落到真 vendor，于是这条"改了驱动"的断言量的根本不是那份夹具。
    const r = runProbe({ CCG_ARL_DIR: dir }, ['--json']);
    assert.match(r.out, new RegExp('ccg-probe-doctor'), '夹具必须真的被用上（vendor 路径应指向临时目录）：' + r.out);
    assert.strictEqual(r.rc, 1, '驱动退回 currentRound: 1 ⇒ 必须 rc=1（读数偏离），不得仍是 0：' + r.out + r.err);
    const j = JSON.parse(r.out);
    assert.strictEqual(j.verdict, 'DRIFT');
    assert.ok(j.problems.some((p) => /currentRound/.test(p)), '偏离原因必须点名是驱动形状：' + JSON.stringify(j.problems));
    assert.match(r.err, /读数偏离预期/, '机器档的告警走 stderr，不得混进 stdout 的 JSON');
    // 反向对照：同一份临时目录里把驱动换回真源码 ⇒ 必须 rc=0（否则 rc=1 是环境噪声而非这一格）
    fs.writeFileSync(path.join(scripts, 'ccg-deep-review.js'), driverSrc, 'utf8');
    const clean = runProbe({ CCG_ARL_DIR: dir }, ['--json']);
    assert.strictEqual(clean.rc, 0, 'A/B 对照：只换回驱动形状就必须回到 0，否则上一条红不能归因：' + clean.err + clean.out);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('P4 fail-closed：把 vendor 路径全部指到空目录 ⇒ rc=2、点名失明、且不输出任何结论行', () => {
  const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-probe-empty-'));
  const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-probe-home-'));
  try {
    const r = runProbe({ CCG_ARL_DIR: empty, HOME: fakeHome, USERPROFILE: fakeHome }, []);
    assert.strictEqual(r.rc, 2, '找不到引擎必须是 2（自身故障档），不得与"发现违规"的 1 混档：' + r.err);
    assert.match(r.err, /探针失明/);
    assert.ok(!/\[ccg-probe\] 结论/.test(r.out), '失明档不得产出结论：' + r.out);
    const r2 = runProbe({ CCG_ARL_DIR: empty, HOME: fakeHome, USERPROFILE: fakeHome }, ['--json']);
    assert.strictEqual(r2.rc, 2, '--json 档同样不得把失明伪装成空结果');
    assert.strictEqual(r2.out.trim(), '', '--json 失明档不该吐半截 JSON 让调用方解析成功：' + r2.out);
  } finally {
    fs.rmSync(empty, { recursive: true, force: true });
    fs.rmSync(fakeHome, { recursive: true, force: true });
  }
});

test('P5 夹具必须是真产物摘录（有出处、含 crypto 项），不接受为通过而构造的干净样例', () => {
  const s = JSON.parse(fs.readFileSync(probe.SAMPLE, 'utf8'));
  assert.strictEqual(s.kind, 'ccg-verification-layer-sample');
  for (const k of ['recordFile', 'reviewedCommit', 'pr', 'logLine', 'note']) {
    assert.ok(typeof s.provenance[k] === 'string' && s.provenance[k].length > 0, 'provenance.' + k + ' 必须非空');
  }
  assert.match(s.provenance.recordFile, /\.ccg\/reviews\/[0-9a-f]{64}\.json$/,
    '记录文件名必须是内容寻址形态（40hex 那一代的历史产物不能当本篇的夹具）');
  assert.ok(s.critique.findings.length >= 3, '条数太少的夹具测不出"哪几条被算成阻断"');
  const cryptoIds = s.critique.requiresExternalReview.map((x) => x.id);
  assert.ok(cryptoIds.length >= 1, '必须含 crypto 域条目');
  for (const id of cryptoIds) {
    const f = s.critique.findings.find((x) => x.id === id);
    assert.ok(f && (f.highRiskDomains || []).includes('crypto'), id + ' 的 highRiskDomains 必须与 requiresExternalReview 同源');
  }
});

test('P6 探针只能 require node 内置模块（Gate 2b5 所在的 changes 作业没有 Install deps）', () => {
  const src = fs.readFileSync(PROBE, 'utf8')
    .split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  const re = /require\(['"]([^'"]+)['"]\)/g;
  let m;
  const bad = [];
  while ((m = re.exec(src))) {
    const id = m[1];
    if (!id.startsWith('node:') && !['fs', 'path', 'os', 'child_process', 'crypto'].includes(id)) bad.push(id);
  }
  assert.deepStrictEqual(bad, [], '探针引入了第三方依赖，CI 上会是 Cannot find module：' + bad.join(','));
});
