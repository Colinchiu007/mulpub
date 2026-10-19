'use strict';
/**
 * check-debt-baseline-change.test.js — 「债务基线调大」锁的回归对
 *
 * 两类锁一把都不能少：
 *  ① 判据行为锁（纯函数逐条 + 临时 git 仓端到端）—— 每条违规码都有独立的"必须红"用例；
 *  ② 合规形态必须绿（本仓反复踩过的另一半）—— 只测"红了会拦"，测不出"正当路径被自己焊死"。
 *     这里用真实测量值当上限（= 作者跑 --update 的产物）验一次 PASS，再 +1 验一次 SLACK，
 *     两侧只差那 1，别的都不变 —— 这才是"上限等于实测"这条判据的 A/B。
 *
 * 接线锁（③）单独一组：判据写了却不在 CI 上跑 = 装饰性门禁（check-unwired-tests 管测试文件，
 * 管不了"门禁命令有没有被点名执行"）。
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const G = require('./check-debt-baseline-change.js');
const B = require('./check-debt-budget.js');

const ROOT = path.resolve(__dirname, '..');

// ---------- ① 纯函数：键分类与增/减/平 ----------

test('数值键才算指标：字符串/数组/布尔一律不当上限', () => {
  assert.strictEqual(G.isMetric(5239), true);
  assert.strictEqual(G.isMetric(0), true);
  assert.strictEqual(G.isMetric('5239'), false);
  assert.strictEqual(G.isMetric(null), false);
  assert.strictEqual(G.isMetric(undefined), false);
  assert.strictEqual(G.isMetric([]), false);
  assert.strictEqual(G.isMetric(Number.NaN), false);
  assert.strictEqual(G.isMetric(Infinity), false);
});

test('diffMetrics 分四态：调大 / 调小 / 持平 / 凭空新增的数值键按从 0 调大', () => {
  const base = { maxFileLines: 5239, filesOver1000: 28, filesOver500: 95, maxFilePath: 'a.vue' };
  const head = { maxFileLines: 5359, filesOver1000: 27, filesOver500: 95, maxFilePath: 'a.vue', brandNew: 3 };
  const r = G.diffMetrics(base, head);
  assert.deepStrictEqual(r.increased.map((i) => i.key + ':' + i.from + '->' + i.to),
    ['maxFileLines:5239->5359', 'brandNew:null->3']);
  assert.deepStrictEqual(r.decreased.map((i) => i.key), ['filesOver1000']);
  assert.deepStrictEqual(r.unchanged.map((i) => i.key), ['filesOver500']);
});

test('diffMetrics 在 base 侧没有基线文件时把全部数值键视为调大（fail closed）', () => {
  const r = G.diffMetrics(null, { maxFileLines: 10, maxFilePath: 'a.vue' });
  assert.deepStrictEqual(r.increased.map((i) => i.key), ['maxFileLines']);
});

test('shapeChanged 同时管键的增减与类型漂移', () => {
  assert.strictEqual(G.shapeChanged({ a: 1, b: 'x' }, { a: 1, b: 'x' }), false);
  assert.strictEqual(G.shapeChanged({ a: 1, b: 'x' }, { a: 1 }), true);
  assert.strictEqual(G.shapeChanged({ a: 1 }, { a: 1, c: 2 }), true);
  assert.strictEqual(G.shapeChanged({ a: 1 }, { a: '1' }), true);
  assert.strictEqual(G.shapeChanged(null, { a: 1 }), false);
});

// ---------- ② R1–R3：记录面 ----------

const COMPLIANT_RECORD = [
  '## 本次执行记录：debt-baseline re-sync',
  '',
  '| 定性 | 这是"接受漂移"不是"清理"：只把基线改成当场实测的主干现状，没有删/拆任何长文件 |',
  '',
  '## 随本次 re-sync 一起开的跟进项',
  '1. 拆 apps/desktop/src/views/CreateView.vue，判据：maxFileLines 与 filesOver1000 同时下降。',
].join('\n');

// COMPLIANT = 模板 + 点名行。三条负例各自只拆自己那一维（"每道变异各测一格"口径），
// 直接用模板会让 R2/R3 的用例同时缺 R1，红集就不是唯一归因了。
const INC_KEYS = ['maxFileLines', 'filesOver500'];
const COMPLIANT = COMPLIANT_RECORD + '\n涉及指标：' + INC_KEYS.join(', ');

test('合规记录：点名 + 接受漂移 + 跟进项 ⇒ 零违规', () => {
  assert.deepStrictEqual(G.judgeRecord(INC_KEYS, COMPLIANT), []);
});

test('R1 没点名具体指标 ⇒ RECORD_MUST_NAME_METRIC，且逐个指标各出一条', () => {
  const rec = COMPLIANT.replace(/maxFileLines/g, '甲').replace(/filesOver500/g, '乙');
  const v = G.judgeRecord(INC_KEYS, rec);
  assert.deepStrictEqual(v.map((x) => x.code).sort(),
    ['RECORD_MUST_NAME_METRIC', 'RECORD_MUST_NAME_METRIC']);
});

test('R2 缺「接受漂移」⇒ DRIFT_ACK_MISSING（把"记账"与"清理"分开写，不许混）', () => {
  const rec = COMPLIANT.replace(/接受漂移/g, '如实更新');
  const v = G.judgeRecord(INC_KEYS, rec);
  assert.deepStrictEqual(v.map((x) => x.code), ['DRIFT_ACK_MISSING']);
});

test('R3 缺被推迟的真实清理（无「跟进」也无「后续」）⇒ DEFERRAL_MISSING', () => {
  // 负例文案本身不得含 R3 的任一关键词，否则是把"我没写出违规"演成"判据漏判"。
  const rec = COMPLIANT.replace('随本次 re-sync 一起开的跟进项', '顺带说明').replace(
    '1. 拆 apps/desktop/src/views/CreateView.vue，判据：maxFileLines 与 filesOver1000 同时下降。',
    '涉及指标：' + INC_KEYS.join(', ') + '（就这样，本次不做别的）');
  assert.ok(!/(跟进|后续)/.test(rec), '负例夹具自己没拆干净 R3 关键词 —— 这条用例测的就不是 R3');
  const v = G.judgeRecord(INC_KEYS, rec);
  assert.deepStrictEqual(v.map((x) => x.code), ['DEFERRAL_MISSING']);
});

test('记录缺失 ⇒ RECORD_MISSING（不得把"没有记录"读成"没有要求"）', () => {
  const v = G.judgeRecord(['maxFileLines'], null);
  assert.deepStrictEqual(v.map((x) => x.code), ['RECORD_MISSING']);
});

test('CRLF 记录仍能匹配：判据必须先剥 \\r 再匹配（本仓受管文档逐文件混行尾）', () => {
  const rec = COMPLIANT.replace(/\n/g, '\r\n');
  assert.ok(rec.includes('\r\n'));
  assert.deepStrictEqual(G.judgeRecord(INC_KEYS, rec), []);
});

// ---------- ③ R4：上限必须等于实测（本锁的牙） ----------

test('R4 上限高于实测 ⇒ SLACK，点名多留了多少', () => {
  const v = G.judgeAgainstReality([{ key: 'maxFileLines', from: 5239, to: 6000 }], { maxFileLines: 5359 });
  assert.strictEqual(v.violations.length, 1);
  assert.strictEqual(v.violations[0].code, 'SLACK:maxFileLines');
  assert.ok(v.violations[0].detail.includes('641'));
});

test('R4 上限低于实测 ⇒ UNDER_REALITY（另一侧也要出声，不许静默放行）', () => {
  const v = G.judgeAgainstReality([{ key: 'maxFileLines', from: 5239, to: 5000 }], { maxFileLines: 5359 });
  assert.deepStrictEqual(v.violations.map((x) => x.code), ['UNDER_REALITY:maxFileLines']);
});

test('R4 上限等于实测 ⇒ 记入 tight，无违规', () => {
  const r = G.judgeAgainstReality([{ key: 'filesOver1000', from: 28, to: 29 }], { filesOver1000: 29 });
  assert.deepStrictEqual(r.violations, []);
  assert.deepStrictEqual(r.tight, ['filesOver1000']);
});

test('R4 取不到实测 ⇒ MEASURE_UNAVAILABLE，按未证实处理不得当成通过', () => {
  const v = G.judgeAgainstReality([{ key: 'maxFileLines', from: 1, to: 2 }], null);
  assert.deepStrictEqual(v.violations.map((x) => x.code), ['MEASURE_UNAVAILABLE']);
  const v2 = G.judgeAgainstReality([{ key: 'maxFileLines', from: 1, to: 2 }], { other: 5 });
  assert.deepStrictEqual(v2.violations.map((x) => x.code), ['MEASURE_UNAVAILABLE']);
});

// ---------- ④ R5：换最大值文件绕开上涨 ----------

test('R5 换了 maxFilePath 而 maxFileLines 没降 ⇒ PATH_SWAPPED_WITHOUT_DROP', () => {
  const base = { maxFileLines: 5239, maxFilePath: 'apps/desktop/src/views/CreateView.vue' };
  const v = G.judgePathSwap(base, { maxFileLines: 5239, maxFilePath: 'apps/desktop/src/shorter.vue' });
  assert.deepStrictEqual(v.map((x) => x.code), ['PATH_SWAPPED_WITHOUT_DROP']);
  const v2 = G.judgePathSwap(base, { maxFileLines: 5300, maxFilePath: 'apps/desktop/src/shorter.vue' });
  assert.deepStrictEqual(v2.map((x) => x.code), ['PATH_SWAPPED_WITHOUT_DROP']);
});

test('R5 正当形态不得被拦：路径未变、或确实降下来了，都不红', () => {
  const base = { maxFileLines: 5239, maxFilePath: 'a.vue' };
  assert.deepStrictEqual(G.judgePathSwap(base, { maxFileLines: 5359, maxFilePath: 'a.vue' }), []);
  assert.deepStrictEqual(G.judgePathSwap(base, { maxFileLines: 4000, maxFilePath: 'b.vue' }), []);
});

// ---------- ⑤ 端到端：临时 git 仓真跑 main() ----------

function mkRepo() {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), 'dbbc-' + process.pid + '-'));
  const root = fs.realpathSync(base);
  const cfg = path.join(os.tmpdir(), 'dbbc-cfg-' + process.pid + '-' + path.basename(base) + '.txt');
  fs.writeFileSync(cfg, '', 'utf8');
  const env = Object.assign({}, process.env);
  for (const k of Object.keys(env)) {
    if (/^(GIT_CONFIG_(GLOBAL|SYSTEM|NOSYSTEM)|GIT_DIR|GIT_WORK_TREE)$/i.test(k)) delete env[k];
  }
  env.GIT_CONFIG_GLOBAL = cfg;
  env.GIT_CONFIG_NOSYSTEM = '1';
  env.GIT_AUTHOR_NAME = env.GIT_COMMITTER_NAME = 'dbbc-test';
  env.GIT_AUTHOR_EMAIL = env.GIT_COMMITTER_EMAIL = 't@example.invalid';
  env.GIT_AUTHOR_DATE = env.GIT_COMMITTER_DATE = '2026-01-01T00:00:00 +0000';
  const git = (args) => {
    const r = spawnSync('git', args, { cwd: root, env, encoding: 'utf8' });
    if (r.status !== 0) throw new Error('git ' + args.join(' ') + ': ' + (r.stderr || r.stdout));
    return r.stdout;
  };
  git(['init', '-q', '--initial-branch=main']);
  return { root, cfg, env, git };
}

function cleanup(f) {
  try { fs.rmSync(f.root, { recursive: true, force: true, maxRetries: 3 }); } catch (_) { /* 清理失败不得掩盖判定 */ }
  try { fs.rmSync(f.cfg, { force: true }); } catch (_) { /* 同上 */ }
}

function lines(n) {
  const parts = [];
  for (let i = 1; i <= n; i++) parts.push('line ' + i);
  return parts.join('\n') + '\n';
}

function writeJson(rel, obj) {
  const p = path.join(this.root, rel);
  fs.mkdirSync(path.dirname(p), { recursive: true });
  fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
}

function commit(f, msg) {
  f.git(['add', '-A']);
  f.git(['commit', '-q', '-m', msg]);
  return f.git(['rev-parse', 'HEAD']).trim();
}

/**
 * 建两提交：C1 写一份"比现状低 1"的旧基线（每个数值键都留一点真实增长空间），
 * C2 把基线写成 C2 树的**实测值**（= 作者跑 --update 的产物）+ 一份点名所有被调大键的合规记录。
 * 动态生成键名单：fixture 的实测值随 collectMetrics 实现演进而变，把键名写死会让本锁的用例
 * 因为"别人加了一个数值指标"而假红 —— 那是一次工具失明，不是一次回归。
 */
function buildFixture(opts) {
  const f = mkRepo();
  const bound = writeJson.bind(f);
  fs.mkdirSync(path.join(f.root, 'apps/desktop/src'), { recursive: true });
  fs.writeFileSync(path.join(f.root, 'apps/desktop/src/big.vue'), lines(600), 'utf8');
  fs.writeFileSync(path.join(f.root, '.gitignore'), 'generated.bundle.js\n', 'utf8');

  const m2 = B.toPersisted(B.collectMetrics(f.root, { env: f.env }));
  const lowered = {};
  for (const k of Object.keys(m2)) {
    lowered[k] = (typeof m2[k] === 'number') ? Math.max(0, m2[k] - 1) : m2[k];
  }
  lowered.maxFilePath = m2.maxFilePath; // 与 C2 同路径：R5 管的是"换文件绕开上涨"，不该在这里响
  lowered.scannedAt = '2026-01-01T00:00:00.000Z';
  bound('scripts/debt-baseline.json', lowered);
  const c1 = commit(f, 'base');

  const head = Object.assign({}, m2);
  if (opts && opts.slack) head.maxFileLines = head.maxFileLines + 1;
  bound('scripts/debt-baseline.json', head);
  if (!opts || !opts.noRecord) {
    const inc = Object.keys(head)
      .filter((k) => typeof head[k] === 'number' && typeof lowered[k] === 'number' && head[k] > lowered[k]);
    let rec = COMPLIANT_RECORD + '\n涉及指标：' + inc.join(', ');
    if (opts && opts.dropAck) rec = rec.replace(/接受漂移/g, '如实更新');
    bound('openspec/records/dbbc-branch.md', rec);
  }
  const c2 = commit(f, 'head');
  return { f, c1, c2, measured: head, lowered };
}

function run(f, args) {
  const r = spawnSync(process.execPath, [path.join(ROOT, 'scripts/check-debt-baseline-change.js'),
    '--repo=' + f.root, '--git-config-global=' + f.cfg, ...args], { encoding: 'utf8' });
  return { rc: r.status, out: String(r.stdout || '') + String(r.stderr || '') };
}

test('端到端：正当 re-sync（上限=实测 + 记录齐）必须 PASS —— 合规形态不得被焊死', () => {
  const { f } = buildFixture({});
  try {
    const r = run(f, ['--base=' + f.git(['rev-parse', 'HEAD~1']).trim(), '--head=HEAD',
      '--head-branch=dbbc-branch']);
    assert.strictEqual(r.rc, 0, r.out);
    assert.ok(r.out.includes('PASS'), r.out);
    assert.ok(/调大=\d+/.test(r.out), r.out);
  } finally { cleanup(f); }
});

test('端到端：上限只多留 1 行 ⇒ SLACK 红 —— 与正当那条用例只差那 1', () => {
  const { f } = buildFixture({ slack: true });
  try {
    const r = run(f, ['--base=' + f.git(['rev-parse', 'HEAD~1']).trim(), '--head=HEAD',
      '--head-branch=dbbc-branch']);
    assert.strictEqual(r.rc, 1, r.out);
    assert.ok(r.out.includes('SLACK:maxFileLines'), r.out);
  } finally { cleanup(f); }
});

test('端到端：记录没有「接受漂移」⇒ DRIFT_ACK_MISSING 红', () => {
  const { f } = buildFixture({ dropAck: true });
  try {
    const r = run(f, ['--base=' + f.git(['rev-parse', 'HEAD~1']).trim(), '--head=HEAD',
      '--head-branch=dbbc-branch']);
    assert.strictEqual(r.rc, 1, r.out);
    assert.ok(r.out.includes('DRIFT_ACK_MISSING'), r.out);
  } finally { cleanup(f); }
});

test('端到端：调大却没带任何执行记录 ⇒ RECORD_MISSING 红', () => {
  const { f } = buildFixture({ noRecord: true });
  try {
    const r = run(f, ['--base=' + f.git(['rev-parse', 'HEAD~1']).trim(), '--head=HEAD',
      '--head-branch=dbbc-branch']);
    assert.strictEqual(r.rc, 1, r.out);
    assert.ok(r.out.includes('RECORD_MISSING'), r.out);
  } finally { cleanup(f); }
});

test('端到端：凭空加一个"实测里没有"的数值键 ⇒ MEASURE_UNAVAILABLE 红（取不到读数不得当通过）', () => {
  const { f } = buildFixture({});
  try {
    // 在这个 fixture 的 head 提交上再叠一提交，把基线里加一个共享实现不产出的键。
    const p = path.join(f.root, 'scripts/debt-baseline.json');
    const obj = JSON.parse(fs.readFileSync(p, 'utf8'));
    obj.brandNewMetric = 5;
    fs.writeFileSync(p, JSON.stringify(obj, null, 2) + '\n', 'utf8');
    commit(f, 'add unknown metric');
    const r = run(f, ['--base=' + f.git(['rev-parse', 'HEAD~2']).trim(), '--head=HEAD',
      '--head-branch=dbbc-branch']);
    assert.strictEqual(r.rc, 1, r.out);
    assert.ok(r.out.includes('MEASURE_UNAVAILABLE'), r.out);
    // 同时必须被点名成"键集变了"——形状与取值是两个独立问题，都要出声。
    assert.ok(r.out.includes('SHAPE_CHANGED'), r.out);
  } finally { cleanup(f); }
});

test('端到端：没碰基线的 PR ⇒ NOT_TOUCHED 且 exit 0（不得把别人一起拦下）', () => {
  const { f } = buildFixture({});
  try {
    fs.writeFileSync(path.join(f.root, 'README.md'), 'hello\n', 'utf8');
    commit(f, 'unrelated');
    const r = run(f, ['--base=' + f.git(['rev-parse', 'HEAD~1']).trim(), '--head=HEAD']);
    assert.strictEqual(r.rc, 0, r.out);
    assert.ok(r.out.includes('NOT_TOUCHED'), r.out);
  } finally { cleanup(f); }
});

test('端到端：只改元数据（数值一个没动）⇒ PASS，不需要记录', () => {
  const f = mkRepo();
  try {
    const bound = writeJson.bind(f);
    bound('scripts/debt-baseline.json', { scannedAt: '2026-01-01T00:00:00.000Z', maxFileLines: 10 });
    const c1 = commit(f, 'base');
    bound('scripts/debt-baseline.json', { scannedAt: '2026-02-01T00:00:00.000Z', maxFileLines: 10 });
    commit(f, 'head');
    const r = run(f, ['--base=' + c1, '--head=HEAD']);
    assert.strictEqual(r.rc, 0, r.out);
    assert.ok(r.out.includes('调大=0'), r.out);
  } finally { cleanup(f); }
});

test('端到端：base ref 解析不了 ⇒ 退出码 2（自身故障），不得读成"没违规"', () => {
  const { f } = buildFixture({});
  try {
    const r = run(f, ['--base=no-such-ref-at-all', '--head=HEAD']);
    assert.strictEqual(r.rc, 2, r.out);
    assert.ok(r.out.includes('SELF_FAILURE'), r.out);
  } finally { cleanup(f); }
});

test('端到端：未知旗标 ⇒ 退出码 2 且点名旗标（参数不得被静默忽略）', () => {
  const { f } = buildFixture({});
  try {
    const r = run(f, ['--ba se=x']);
    assert.strictEqual(r.rc, 2, r.out);
    assert.ok(r.out.includes('未知旗标'), r.out);
  } finally { cleanup(f); }
});

test('端到端：--base= 显式空（非 PR 事件）⇒ advisory exit 0', () => {
  const { f } = buildFixture({});
  try {
    const r = run(f, ['--base=', '--head=HEAD']);
    assert.strictEqual(r.rc, 0, r.out);
    assert.ok(r.out.includes('NO_BASE'), r.out);
  } finally { cleanup(f); }
});

// ---------- ⑥ 接线锁：判据与它的测试都必须在 CI 上被点名 ----------

test('CI 接线：changes 作业点名执行本判据与它的测试，且吃 classify 的产物', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/quality-gate.yml'), 'utf8').replace(/\r/g, '');
  const body = jobBody(yml, 'changes');

  assert.ok(body.includes('node scripts/check-debt-baseline-change.js'), '判据没在 changes 作业里被执行');
  assert.ok(body.includes('node --test scripts/check-debt-baseline-change.test.js'), '测试没接线');
  // base 必须由 classify 的产出经 env 注入，不在命令行里自己算第二遍（Gate 2c2 的 EXEC_BASE 同形先例）。
  // 判据取**这一段步骤自己的** env 与 run，不取整份作业体 —— 否则别的环境名会串台。
  const stepStart = body.search(/- name: "Gate [^"]*[dD]ebt-baseline[^"]*"/);
  assert.ok(stepStart >= 0, '找不到本判据的命名步骤');
  // 步骤体 = 从本步骤的 name 行到**下一个** `- name:` 行（找不到就到作业体末尾）。
  // 必须按边界切：整份作业体里到处都有 env/shell/exit 1，拿全文做子串断言等于恒真。
  const rest = body.slice(stepStart + 6);
  const nextStep = rest.search(/\n {6}- name: /);
  const stepBody = nextStep >= 0 ? body.slice(stepStart, stepStart + 6 + nextStep) : body.slice(stepStart);
  assert.ok(stepBody.length > 200, '步骤体只有 ' + stepBody.length + ' 字符，边界取错了');
  assert.ok(/DEBT_BASE: \$\{\{\s*steps\.classify\.outputs\.pr-base\s*\}\}/.test(stepBody),
    'base 未复用 classify 产物 —— 第二套取源一旦漂移就会出现同一 PR 两个结论');
  assert.ok(/--base="\$\{DEBT_BASE:-\}"/.test(stepBody), '命令没有消费那个 env（写了 env 却不读 = 装饰）');
  assert.ok(/shell: bash/.test(stepBody), '两条命令同块却没有 shell: bash —— pwsh 不在中间命令非零时中止');
  assert.ok(stepBody.includes('exit 1'), 'base/head 取源异常时必须有阻断分支');
});

/** 按 YAML 顶层作业边界切出一份 job 体（不能用 indexOf('\n  ')：4 空格缩进行也以两空格开头，
 *  那样取到的"作业体"只有几个字符，反向锁会恒真。 */
function jobBody(yml, jobId) {
  const lines = yml.split('\n');
  const start = lines.findIndex((l) => l === '  ' + jobId + ':');
  assert.ok(start >= 0, '找不到作业 ' + jobId + ' —— 结构变了必须同步这条锁');
  let end = lines.length;
  for (let i = start + 1; i < lines.length; i++) {
    if (/^  [a-zA-Z0-9_-]+:$/.test(lines[i])) { end = i; break; }
  }
  assert.ok(end - start > 20, jobId + ' 作业体只有 ' + (end - start) + ' 行，区间取错了（判据自失明）');
  return lines.slice(start, end).join('\n');
}

test('CI 接线反向锁：判据不得被挂到会被 docs-only 短路的 static-gates 作业', () => {
  const yml = fs.readFileSync(path.join(ROOT, '.github/workflows/quality-gate.yml'), 'utf8').replace(/\r/g, '');
  const staticBody = jobBody(yml, 'static-gates');
  assert.ok(!staticBody.includes('check-debt-baseline-change.js'),
    '本锁校验的 scripts/debt-baseline.json 属工具面，但把门禁挂在会被短路的作业里，就等于在"最可能改账本的那一类 PR"上关掉它');
});

test('gitignore：新判据与新测试都不得被 scripts/*.js 静默忽略', () => {
  const gi = fs.readFileSync(path.join(ROOT, '.gitignore'), 'utf8').replace(/\r/g, '');
  assert.ok(gi.includes('!scripts/check-debt-baseline-change.js'), '判据本体缺 negation');
  assert.ok(gi.includes('!scripts/check-debt-baseline-change.test.js'), '测试缺 negation（被忽略 ⇒ CI 永远拿不到 ⇒ 接线锁也锁不住）');
  // 「git check-ignore -v」在**命中 negation** 时也返回 0（它报的是"最后匹配的那条规则"，
  // 不管那条是不是 ! 开头）。所以"被忽略与否"只能问 git 自己看不看得见这个文件：
  // 已跟踪 ⇒ ls-files 命中；未跟踪 ⇒ status -uall 里出现 ??。两者皆无 = 被吞了。
  for (const rel of ['scripts/check-debt-baseline-change.js', 'scripts/check-debt-baseline-change.test.js']) {
    assert.ok(fs.existsSync(path.join(ROOT, rel)), rel + ' 必须真实存在');
    const tracked = String(spawnSync('git', ['ls-files', '--', rel], { cwd: ROOT, encoding: 'utf8' }).stdout).trim();
    const untracked = String(spawnSync('git', ['status', '--porcelain', '-uall', '--', rel], { cwd: ROOT, encoding: 'utf8' }).stdout).trim();
    assert.ok(tracked.length > 0 || /^\?\? /.test(untracked),
      rel + ' 对 git 不可见（被 .gitignore 吞掉）：ls-files="' + tracked + '" status="' + untracked + '"');
  }
});

test('判据只有一份测量实现：本锁必须复用共享的 collectMetrics，不得自己数行数', () => {
  const src = fs.readFileSync(path.join(ROOT, 'scripts/check-debt-baseline-change.js'), 'utf8');
  assert.ok(/require\('\.\/check-debt-budget'\)/.test(src), '没有复用同一份测量实现');
  assert.ok(src.includes('debtBudget.collectMetrics('), '没有调用共享实现的 collectMetrics');
  assert.ok(!/function\s+countFilesByMinLines/.test(src), '又抄了一份行数统计 —— 两份实现必然漂移');
  assert.ok(!/readdirSync/.test(src), '自己走磁盘扫域 —— #3876 的形态：磁盘域比 CI 检出多算被忽略的产物');
  assert.strictEqual(typeof B.collectMetrics, 'function', '共享实现没导出 collectMetrics，本锁的 R4 就无从取数');
});
