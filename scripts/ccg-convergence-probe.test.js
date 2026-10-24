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

/**
 * "这行 require 会不会在 CI 上 Cannot find module" 的唯一判据：
 * 内置模块、以及**相对路径**的兄弟文件都不会（changes 作业没有 Install deps，但仓库自带这些文件）。
 * 把相对 require 也算成第三方是错的收窄 —— 它会让"把读数器拆成兄弟文件"这件事只能靠把逻辑抄回探针本体来做，
 * 而抄第二份实现正是本仓点名的漂移源。
 */
function isThirdPartyRequire (id) {
  if (typeof id !== 'string' || id === '') return false;
  if (id.startsWith('node:')) return false;
  if (id.startsWith('./') || id.startsWith('../')) return false;
  return !['fs', 'path', 'os', 'child_process', 'crypto'].includes(id);
}
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

/**
 * 自建 vendor 夹具 —— 让 P10-P12 在**任何机器**（含 CI runner）上都能跑。
 *
 * 为什么必须换成夹具：这三条原先只在"本机 vendor 带着一份未提交的本地补丁"时才成立，
 * 而那份补丁在 2026-10-24 11:48 被另一个会话改写掉了（末尾的 `if (require.main === module)`
 * 守卫和整张导出面一起没了）。后果是双重的：P1/P10 的 `--json` stdout 变成别人流水线打印的
 * 「判定记录按 diff 内容寻址命中…」（`JSON.parse` 当场炸），而 P10/P11 在别的机器上整条早退。
 * **把锁的成立前提建在机器局部状态上，等价于没有锁** —— 本仓「装饰性门禁」的第 N 种落点。
 * 夹具只满足探针"现读自 vendor"的那几个形状锚点，所以这里量的是**探针的装配**；
 * 真引擎的 ladder 语义仍由 P1/P3 在装了 vendor 的机器上覆盖（两档各有归属，不互相顶替）。
 */
const SYNTH_ENGINE = [
  "'use strict';",
  'function isStalled (rounds, cfg) {',
  '  var n = (cfg && cfg.stallRounds) || 2;',
  '  var delta = (cfg && cfg.stallScoreDelta) || 0.5;',
  '  if (!rounds || rounds.length < n + 1) return { stalled: false, detail: "轮次不足" };',
  '  void delta;',
  '  return { stalled: true, detail: "stale" };',
  '}',
  'function convergenceDecision (task, cfg) {',
  '  var maxRounds = (cfg && cfg.maxRounds) || 3;',
  '  var threshold = (cfg && cfg.scoreThreshold) || 8;',
  '  var rounds = task.rounds || [];',
  '  var last = rounds.length ? rounds[rounds.length - 1].minScore : 0;',
  '  if (last >= threshold) return { status: "converged", reason: "score", stop: true };',
  '  if (isStalled(rounds, cfg).stalled) return { status: "stalled", reason: "stall", stop: true };',
  '  if (task.currentRound >= maxRounds) return { status: "self_play", reason: "selfPlay", stop: true };',
  '  return { reason: "continue", stop: false };',
  '}',
  'module.exports = { convergenceDecision: convergenceDecision, isStalled: isStalled };',
].join('\n');

/**
 * @param {object} o 三个开关各自对应一种真实形状：
 * @param {boolean} o.arm     upheld 那条 push 之前有没有解除臂（false = 今天 vendor 的真实形状）
 * @param {boolean} o.exports 有没有导出面（false = 可安全 require 但拿不到函数 ⇒ 真失明，必须 rc=1）
 * @param {boolean} o.guard   末尾是否写在 `require.main` 守卫里（false = require 即执行 main ⇒ 禁止 require）
 */
function synthDriver (o) {
  const lines = [
    "'use strict';",
    'var fs = require("fs");',
    'function externalReviewSatisfied (i, adj) {',
    '  return !!(i.externalReview && i.externalReview.performedBy === adj.expectedExternalBackend',
    '    && i.externalReview.evidenceRef && i.externalReview.reviewedAt);',
    '}',
    'function blockingFromAdjudication (adj) {',
    '  var blocking = [];',
    '  (adj.items || []).forEach(function (i) {',
    '    if ((i.highRiskDomains || []).length && externalReviewSatisfied(i, adj)) { return; }',
    "    if (i.verdict === 'upheld') {",
  ];
  if (o.arm) lines.push('      if (externalReviewSatisfied(i, adj)) { return; }');
  lines.push("      blocking.push({ id: i.id, reason: 'self_play_upheld' });");
  lines.push('    }');
  lines.push('  });');
  lines.push('  return blocking;');
  lines.push('}');
  lines.push('var tpl = { expectedExternalBackend: "claude" };');
  lines.push('void tpl;');
  // 下面三行是探针 readDefaults / readDriverTaskShape 的形状锚点，缺一条探针会 rc=2（失明）而不是我想要的档
  lines.push('var cfg = { selfPlay: { enabled: true, confidenceWeight: 0.6 } };');
  lines.push('void cfg;');
  lines.push('const task = { currentRound: cfg.maxRounds, rounds: [{ round: 1, minScore: 3 }] };');
  lines.push('void task;');
  lines.push('function main () { try { fs.writeFileSync(process.env.SYNTH_MARKER, "executed"); } catch (e) {} return 0; }');
  if (o.exports !== false) lines.push('module.exports = { blockingFromAdjudication: blockingFromAdjudication, externalReviewSatisfied: externalReviewSatisfied };');
  lines.push(o.guard === false ? 'process.exit(main());' : 'if (require.main === module) process.exit(main());');
  return lines.join('\n');
}

function makeSynthVendor () {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ccg-probe-synth-'));
  const scripts = path.join(dir, 'scripts');
  fs.mkdirSync(scripts, { recursive: true });
  fs.writeFileSync(path.join(scripts, 'engine.js'), SYNTH_ENGINE, 'utf8');
  return { dir, scripts, marker: path.join(dir, 'executed.marker') };
}

/** 用夹具跑一次探针；返回 rc / 解析后的 JSON（解析失败即原样带回 stdout 供断言文案）/ 是否执行了驱动 main。 */
function runSynth (opts) {
  const v = makeSynthVendor();
  try {
    fs.writeFileSync(path.join(v.scripts, 'ccg-deep-review.js'), synthDriver(opts), 'utf8');
    const r = runProbe({ CCG_ARL_DIR: v.dir, SYNTH_MARKER: v.marker }, ['--json']);
    let j = null;
    try { j = JSON.parse(r.out); } catch (e) { /* 留给调用方的断言去点名"stdout 不是 JSON" */ }
    return { rc: r.rc, j: j, out: r.out, err: r.err, executed: fs.existsSync(v.marker), dir: v.dir };
  } finally {
    fs.rmSync(v.dir, { recursive: true, force: true });
  }
}

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
    if (isThirdPartyRequire(id)) bad.push(id);
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

test('P9 isThirdPartyRequire 的反向夹具：收窄不等于放行 —— 真第三方必须仍被拦', () => {
  // 本刀把 P6 从「非内置即第三方」收窄成「非内置且非相对」，因为兄弟文件的 require 不需要 Install deps。
  // 收窄后的判据必须各配一条取被禁形态本身的用例，否则守的是什么只剩我的说法。
  assert.equal(isThirdPartyRequire('js-yaml'), true, '真第三方被放行 ⇒ 这条白名单被推平了');
  assert.equal(isThirdPartyRequire('@scope/pkg'), true);
  assert.equal(isThirdPartyRequire('node:fs'), false);
  assert.equal(isThirdPartyRequire('fs'), false);
  assert.equal(isThirdPartyRequire('./qm6-exit-capabilities.js'), false, '相对 require 不是第三方：changes 作业没有 Install deps 也解析得到');
  assert.equal(isThirdPartyRequire('../x.js'), false);
  assert.equal(isThirdPartyRequire(''), false, '空 id 由调用方的正则决定，这里不得凭空造一条违规');
});

test('P10 行为档必须真的被取到：可安全 require 的驱动上读数不得是 unavailable，且加臂必须自动翻成在位', () => {
  // A15 只查"探针源码里这次调用在位"，查不出"调用在位但结果被常数覆盖"这一格 —— 只有真跑一次才看得见。
  const base = runSynth({ arm: false, exports: true, guard: true });
  assert.equal(base.executed, false, '夹具的 main 不得被 require 执行');
  assert.ok(base.j, '探针在自建夹具上必须产出 JSON，实际 stdout=' + base.out.slice(0, 200));
  assert.equal(base.rc, 0, '无臂夹具的两路一致（都不在位）⇒ 应当 rc=0：' + JSON.stringify(base.j && base.j.problems));
  assert.equal(base.j.exitCapabilities.upheldBehavioral, false,
    '可 require 的驱动却报 unavailable ⇒ 行为路径根本没跑，此时"两路一致"只是在复述结构读法');
  assert.equal(base.j.exitCapabilities.receiptLive, true,
    '正控必须为真：夹具那份凭证确实被某个分支消费。为 false 时"带凭证仍阻断"这句话什么也没测');
  assert.equal(base.j.exitCapabilities.behavioralSkip, null, '这一档没有跳过理由，跳过面必须是 null 而不是空串');
  assert.equal(base.j.upheldCrossCheck.ok, base.j.exitCapabilities.upheld === base.j.exitCapabilities.upheldBehavioral,
    '交叉结论必须由同一份 JSON 里的两个读数推出，不得是独立写死的常量');
  assert.match(base.j.upheldCrossCheck.note, /两路一致/, '一致时的文案必须点名"两路"，不得退化成一句单路读数');
  // 加臂版：结构读法与行为真跑**都必须**自动翻成在位。这条以前只有结构侧的夹具（A2），
  // 行为侧要等真 vendor 补上臂才量得到 —— 那等于这一格永远没测。
  const armed = runSynth({ arm: true, exports: true, guard: true });
  assert.ok(armed.j, '加臂夹具必须产出 JSON：' + armed.out.slice(0, 200));
  assert.equal(armed.j.exitCapabilities.upheld, true, '结构读法没跟上加臂 ⇒ A2 那对夹具是纸面的');
  assert.equal(armed.j.exitCapabilities.upheldBehavioral, true, '真跑没跟上加臂 ⇒ 行为档在这一格是装饰');
  assert.equal(armed.rc, 0, '两路都说在位 ⇒ rc=0（将来真加出口的 PR 不会被自己的锁咬住）：' + JSON.stringify(armed.j.problems));
  console.log('[ccg-probe-test] P10 现场 vendor（只打印、不作断言前提）：'
    + (found ? '本机装了 vendor，其驱动是否可安全 require 见 P12 的当场读数' : 'runner 上无 vendor'));
});

test('P11 驱动可安全 require 但拿不到函数（改名/缺导出面）⇒ 必须 rc=1 并点名，不得按"跳过"结案', () => {
  // 这一格测的是"结构读数与真跑读数一条都不剩"的组合：没有守卫时它长成"两路一致：不在位"，
  // 与"真跑确认过、确实没有出口"逐字同形 —— 那正是本刀立项要消灭的那类假话。
  // 原先这条绑在"本机 vendor 带着导出面"上（那份补丁今天已被别的会话改写掉），现改为自建夹具。
  const noExp = runSynth({ arm: false, exports: false, guard: true });
  assert.equal(noExp.executed, false, 'require 只执行模块体，不得跑到 main');
  assert.ok(noExp.j, '夹具必须产出 JSON：' + noExp.out.slice(0, 200));
  assert.equal(noExp.j.exitCapabilities.upheldBehavioral, 'unavailable', '这一条测的就是 unavailable 那条支路');
  assert.equal(noExp.j.exitCapabilities.behavioralSkip, 'no-exports',
    '可 require 但没导出面 = 真失明，不得与"vendor 缺席/不可执行"那类**按设计的跳过**共用一个理由');
  assert.equal(noExp.rc, 1, '真失明必须 rc=1，不得仍是 0：' + JSON.stringify(noExp.j.problems));
  assert.ok(noExp.j.problems.some((p) => /行为档/.test(p)), '偏离原因必须点名行为档，不得让人去猜哪一路瞎了：' + JSON.stringify(noExp.j.problems));
  assert.equal(noExp.j.upheldCrossCheck.ok, true,
    '行为档缺席本身不参与比较（不得由比较结果反推结论）；拦住它的是上一条 rc=1，两者不得混为一谈');
  // A/B 对照：同一目录只把导出面装回去 ⇒ 必须回到 0，否则上一条红不能归因到"缺导出面"这一格
  const withExp = runSynth({ arm: false, exports: true, guard: true });
  assert.equal(withExp.rc, 0, 'A/B 对照：只装回导出面就必须回到 0，否则 P11 的红不能归因：' + withExp.err);
});

test('P12 ⛔ 驱动顶层裸执行 main() 时，探针一律不得 require 它（2026-10-24 现场的回归锁）', () => {
  // 现场：本机 vendor 驱动末尾从 `if (require.main === module) process.exit(main())` 变成裸
  // `process.exit(main())`，探针那次 require 把别人的整条评审流水线跑进本进程并 exit 掉探针 ——
  // `--json` 的 stdout 于是变成「判定记录按 diff 内容寻址命中…」，`JSON.parse` 当场炸，
  // 报错读起来像"探针输出坏了"，不像"探针执行了不该执行的东西"。
  const unsafe = runSynth({ arm: false, exports: true, guard: false });
  assert.equal(unsafe.executed, false,
    '探针 require 了一份顶层就 process.exit(main()) 的驱动 —— 后果不是慢，是探针变成别人流水线的宿主');
  assert.ok(unsafe.j, '被劫持时 stdout 不再是纯 JSON（这正是现场看到的形态）：' + unsafe.out.slice(0, 200));
  assert.equal(unsafe.j.exitCapabilities.upheldBehavioral, 'unavailable');
  assert.equal(unsafe.j.exitCapabilities.behavioralSkip, 'executes-on-require',
    '跳过理由必须是"不可安全加载"，不得折叠成 no-vendor —— 那会把"装了但不敢跑"读成"这台机器没装"');
  assert.match(unsafe.j.upheldCrossCheck.note, /executes-on-require/,
    '交叉文案必须带出真实成因：' + unsafe.j.upheldCrossCheck.note);
  assert.equal(unsafe.rc, 0, '这一格只有一路读数，属**如实出声**的跳过，不是读数矛盾 ⇒ rc 仍由 ladder 决定：' + JSON.stringify(unsafe.j.problems));
  // 对照组一：同一夹具只把守卫加回来 ⇒ 行为档立刻取得到（证明上一条的 unavailable 是"没 require"造成的，不是夹具坏了）
  const safe = runSynth({ arm: false, exports: true, guard: true });
  assert.equal(safe.j.exitCapabilities.upheldBehavioral, false, '加回守卫后行为档必须落到定值，否则上一条的 rc=0 是白得的');
  assert.equal(safe.executed, false, '有守卫时 require 也不得跑到 main');
  // 对照组二（负控）：marker 机制本身必须可用 —— 直接按 CLI 跑那份未守卫驱动就该写下 marker。
  // 缺这一条，"探针没执行它"与"marker 从来写不出来"两种情况在断言里完全同形（本仓「探针失明」同型）。
  const v = makeSynthVendor();
  try {
    fs.writeFileSync(path.join(v.scripts, 'ccg-deep-review.js'), synthDriver({ arm: false, exports: true, guard: false }), 'utf8');
    cp.spawnSync(process.execPath, [path.join(v.scripts, 'ccg-deep-review.js')], {
      encoding: 'utf8', env: Object.assign({}, process.env, { SYNTH_MARKER: v.marker }),
    });
    assert.ok(fs.existsSync(v.marker), '负控失效：按 CLI 直接跑该驱动都没写 marker，说明这套夹具证明不了任何"没执行"');
  } finally {
    fs.rmSync(v.dir, { recursive: true, force: true });
  }
});

