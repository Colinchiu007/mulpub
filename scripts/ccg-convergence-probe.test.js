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
    // QM-6 外部评审 i1（upheld）：原来只复制 engine.js + 驱动。若引擎将来 require 同目录的
    // 兄弟模块，那份缺失会让探针报 rc=2（失明）而不是 rc=1（偏离）——两档混掉，行为锁就退化成
    // "看起来在测、实际在误诊"。正解是**整目录复制**，让夹具与 vendor 的文件集同源。
    const vendorDir = path.dirname(probe.locateVendor().engine);
    for (const f of fs.readdirSync(vendorDir)) {
      const src = path.join(vendorDir, f);
      if (fs.statSync(src).isFile()) fs.copyFileSync(src, path.join(scripts, f));
    }
    assert.ok(fs.readdirSync(scripts).length >= 2, '临时目录必须带齐 vendor 的兄弟模块（否则 i1 那格重新出现）');
    assert.ok(fs.readdirSync(scripts).length === fs.readdirSync(vendorDir).length,
      '夹具文件集必须与 vendor 文件集同数，复制漏了就是把它测窄了');
    fs.writeFileSync(path.join(scripts, 'ccg-deep-review.js'), doctored, 'utf8');
    // CCG_ARL_DIR 指的是**技能根**（locateVendor 自己再拼 scripts/），传已含 scripts 的路径
    // 会让探针回落到真 vendor，于是这条"改了驱动"的断言量的根本不是那份夹具。
    const r = runProbe({ CCG_ARL_DIR: dir }, ['--json']);
    assert.match(r.out, new RegExp('ccg-probe-doctor'), '夹具必须真的被用上（vendor 路径应指向临时目录）：' + r.out);
    // 「传技能根 + 探针自己再拼 scripts/」是这一格成立的前提。只断言路径里含临时目录名，拼接语义
    // 将来变了仍可能通过 ⇒ 补形状断言，让变化红在**这一格**而不是笼统的 rc（QM-6 第二轮 i8）。
    const shape = JSON.parse(r.out);
    assert.ok(/scripts[\\/]engine\.js$/.test(shape.vendor.engine),
      'vendor.engine 必须是「根 + scripts/engine.js」的形状，否则 CCG_ARL_DIR 的语义已变：' + shape.vendor.engine);
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

test('P7 候选面 MUST NOT 含仓库自身（i2：否则任何 PR 放两个同名文件就能让 CI 执行它的代码）', () => {
  const src = fs.readFileSync(PROBE, 'utf8');
  const body = src.slice(src.indexOf('function locateVendor'), src.indexOf('function readDefaults'));
  assert.ok(body.length > 40, 'locateVendor 函数体必须被截到（锚点失效时不得让本条静默通过）：' + body.length);
  assert.ok(!/__dirname/.test(body), '候选面里出现 __dirname 就等于把仓库目录当 vendor —— 探针会 require() 一份由 PR 作者控制的代码');
  assert.match(body, /process\.env\.CCG_ARL_DIR/, '候选必须来自显式环境变量');
  assert.match(body, /USERPROFILE/, '候选必须来自用户技能目录（HOME 或 USERPROFILE）');
  // 反向实测：仓库 scripts/ 里若真躺着同名文件，探针也不得用它（本条只在现场存在时校验"没用它"）
  const repoEngine = path.join(__dirname, 'engine.js');
  const repoDriver = path.join(__dirname, 'ccg-deep-review.js');
  if (fs.existsSync(repoEngine) && fs.existsSync(repoDriver)) {
    const empty = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-probe-repo-'));
    const fakeHome = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-probe-repo-home-'));
    try {
      const r = runProbe({ CCG_ARL_DIR: empty, HOME: fakeHome, USERPROFILE: fakeHome }, []);
      assert.strictEqual(r.rc, 2, '仓库里有同名 engine.js 时探针必须仍判失明，不得回落执行仓库副本：' + r.out + r.err);
    } finally {
      fs.rmSync(empty, { recursive: true, force: true });
      fs.rmSync(fakeHome, { recursive: true, force: true });
    }
  } else {
    console.log('[ccg-probe-test] P7 行为档：仓库内无同名 engine.js（正常），只跑结构锁');
  }
});

test('P8 判据本体的 gitignore 放行必须是"最后命中的那条规则"（i4：规则顺序会变，注释里的行号不会替它守）', () => {
  const r = cp.spawnSync('git', ['check-ignore', '--no-index', '-v', 'scripts/ccg-convergence-probe.js'],
    { cwd: path.resolve(__dirname, '..'), encoding: 'utf8' });
  const out = String(r.stdout || '').trim();
  if (r.status === 1) {
    console.log('[ccg-probe-test] P8：该文件不被任何规则命中（rc=1）⇒ 未被忽略，合规');
    return;
  }
  assert.strictEqual(r.status, 0, 'check-ignore 取不到读数（rc=' + r.status + '）⇒ 判据失明，不得当成通过：' + r.stderr);
  assert.ok(out.includes(':!scripts/ccg-convergence-probe.js'),
    '最后命中的规则必须是放行规则；命中 scripts/*.js 说明有人把忽略规则挪到了放行规则之后，本体将不会入库：' + out);
});

// ── 刀E：探针必须知道 vendor 能不能表达「外部复核已发生」 ──
// 探针原来把「self-play 对高危项无条件计阻断」当成固定结论。本机给 vendor 打了 externalReview
// 补丁之后，那句话会变成**谎报**（结论说不可达，实际填三格即可闭合）。所以判定必须现读 vendor。
// 只测纯谓词不测端到端：CI 的 changes 作业上没有 vendor 引擎（探针走失明档），端到端断言在 runner
// 上永远测不到 —— 把判定收敛成可纯测的谓词，才有 CI 覆盖得住的锁。
test('P9 externalReviewCapable：vendor 具备解除谓词与期望后端字段 ⇒ 判为在位', () => {
  assert.strictEqual(typeof probe.externalReviewCapable, 'function',
    '探针必须导出 externalReviewCapable —— 不导出就没有常驻判据知道结论已变');
  const src = ['function externalReviewSatisfied (i, adj) { return true; }',
    '    expectedExternalBackend: expectedExternalBackend || null,'].join('\n');
  assert.strictEqual(probe.externalReviewCapable(src), true, '两格齐备 ⇒ 在位');
});

test('P10 在位判定不得靠「字样出现过」：散文/注释里提一句不算，缺任一格都不算', () => {
  const cases = [
    ['只在注释里提到', '// TODO: 将来支持 externalReviewSatisfied 与 expectedExternalBackend'],
    ['只有解除谓词、没有期望后端字段', 'function externalReviewSatisfied (i) { return false; }'],
    ['只有期望后端字段、没有谓词', 'expectedExternalBackend: cfg.critic,'],
    ['旧形态（无表达）', 'if ((i.highRiskDomains || []).length) { blocking.push(...) }'],
  ];
  for (const [name, src] of cases) {
    assert.strictEqual(probe.externalReviewCapable(src), false, name + ' ⇒ 不得判在位：' + src);
  }
});
