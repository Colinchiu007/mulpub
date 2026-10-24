'use strict';

/**
 * check-max-lines 门禁用例（node:test）。
 * 覆盖：新代码阻断、存量挂账三态、清单落盘可复现、与 debt-budget 同口径、真实仓现状，
 * 以及「僵尸条目 / 已还债 / 墓碑」三态区分（audit 2026-09-22 门禁逃逸 3 次复发的回归保护）。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const G = require('./check-max-lines.js');

function mk(n) { return new Array(n).fill('// x').join('\n'); }

// M-7：evaluate 多了第四个参数 testData。真实仓断言必须把它一起喂 ——
// 漏喂的表现不是「测试失败」而是「测试文件通道整段变成死代码」，而门禁主断言
// 恰恰是最容易漏喂的那两处，故在此集中成一个 helper。
function realRepoEvaluate(base) {
  const allTests = G.scanTestFiles();
  const tl = Number.isFinite(base.testLimit) ? base.testLimit : G.DEFAULT_TEST_LIMIT;
  const scannedTests = Object.keys(allTests).sort()
    .reduce((a, k) => { if (allTests[k] >= tl) a[k] = allTests[k]; return a; }, {});
  return G.evaluate(base, G.collectOverLimit(null, base.limit), G.scanAllLines(), { scanned: scannedTests, all: allTests });
}

test('新代码阻断：超限且未挂账 → NEW_OVER_LIMIT', () => {
  const { violations } = G.evaluate({ limit: 500, growthAllowance: 200, files: {} }, { 'packages/a/big.js': 640 });
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^NEW_OVER_LIMIT: packages\/a\/big\.js 640/);
});

test('存量挂账：登记内的文件小幅增长放行，暴涨阻断', () => {
  const base = { limit: 500, growthAllowance: 200, files: { 'packages/a/legacy.py': 1200 } };
  assert.deepEqual(G.evaluate(base, { 'packages/a/legacy.py': 1380 }).violations, [], '容差内属正常维护');
  const grew = G.evaluate(base, { 'packages/a/legacy.py': 1900 });
  assert.equal(grew.violations.length, 1);
  assert.match(grew.violations[0], /^LEDGER_GREW/);
  assert.match(grew.violations[0], /膨胀 700 行/);
});

test('清单防腐化：僵尸条目与已还债是两种病，必须给两种不同的处方', () => {
  const base = { limit: 500, growthAllowance: 200, files: { 'packages/a/gone.js': 900, 'packages/b/shrunk.ts': 700 } };
  const { violations } = G.evaluate(base, { 'packages/b/shrunk.ts': 320 });
  assert.equal(violations.length, 2);
  assert.match(violations.join('\n'), /STALE_LEDGER_ENTRY: packages\/a\/gone\.js/);
  assert.match(violations.join('\n'), /DEBT_REPAID_LEDGER: packages\/b\/shrunk\.ts/);
});

test('回归①生产路径可达性：已还债必须报 DEBT_REPAID_LEDGER 并指向 --prune', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-repaid-'));
  try {
    fs.mkdirSync(path.join(root, 'packages', 'demo'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'big.py'), mk(600));
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'repaid.vue'), mk(420));
    gitify(root);
    const base = {
      limit: 500, growthAllowance: 200,
      files: { 'packages/demo/big.py': 600, 'packages/demo/repaid.vue': 598 },
    };
    // 关键：按 main() 的真实喂法——collectOverLimit 只含 >=limit 的文件，
    // 已还债文件因此不在 scanned 中，旧实现会误判成「文件已删」并建议 --update。
    const { violations } = G.evaluate(base, G.collectOverLimit(root, base.limit), G.scanAllLines(root));
    const repaid = violations.filter((v) => v.includes('repaid.vue'));
    assert.equal(repaid.length, 1, '已还债文件必须且只能命中一条违规：' + violations.join(' | '));
    assert.match(repaid[0], /^DEBT_REPAID_LEDGER/);
    assert.match(repaid[0], /现 420/);
    assert.match(repaid[0], /--prune packages\/demo\/repaid\.vue/);
    assert.match(repaid[0], /不要用 --update/, '处方必须禁止整份 --update（它会顺手把别人的存量漂移登记成新基线）');
    assert.ok(!violations.some((v) => /^STALE_LEDGER_ENTRY: packages\/demo\/repaid/.test(v)), '不得再说成文件已删');
    assert.deepEqual(violations.filter((v) => v.includes('big.py')), [], '未还债的存量条目不得连带报违规');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('回归②墓碑：并发 PR 把已还债的条目带回挂账时只提示不阻塞（防全链被无关红卡死）', () => {
  const rel = 'apps/desktop/src/components/LogsSettings.vue';
  const base = { limit: 500, growthAllowance: 200, files: { [rel]: 598 }, pruned: { [rel]: 468 } };
  const res = G.evaluate(base, {}, { [rel]: 468 });
  assert.deepEqual(res.violations, [], '僵尸条目 + 墓碑 = 已知复活，不得阻断');
  assert.equal(res.notices.length, 1, JSON.stringify(res.notices));
  assert.match(res.notices[0], /^LEDGER_RESURRECTED: apps\/desktop\/src\/components\/LogsSettings\.vue/);
});

test('回归③墓碑取消挂账豁免：同路径重新超限仍按新增债务阻断（僵尸条目不得当免死金牌）', () => {
  const rel = 'apps/desktop/src/components/LogsSettings.vue';
  const base = { limit: 500, growthAllowance: 200, files: { [rel]: 598 }, pruned: { [rel]: 468 } };
  const res = G.evaluate(base, { [rel]: 560 }, { [rel]: 560 });
  assert.equal(res.violations.length, 1, res.violations.join(' | '));
  assert.match(res.violations[0], /^NEW_OVER_LIMIT/);
  assert.ok(!res.violations.some((v) => /LEDGER_GREW/.test(v)), '不得按登记值 598 的容差放行');
});

test('回归④真删除仍是硬违规，且处方指向 --prune 单键清账', () => {
  const base = { limit: 500, growthAllowance: 200, files: { 'packages/a/gone.js': 900 } };
  const res = G.evaluate(base, {}, { 'packages/b/other.js': 100 });
  assert.equal(res.violations.length, 1);
  assert.match(res.violations[0], /^STALE_LEDGER_ENTRY: packages\/a\/gone\.js/);
  assert.match(res.violations[0], /--prune packages\/a\/gone\.js/);
});

test('回归⑤--prune 单键清账：除目标键与 pruned 外其余不得变动', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-prune-'));
  try {
    const p = path.join(dir, 'bl.json');
    const before = { limit: 500, growthAllowance: 200, files: { 'packages/z.js': 900, 'packages/a.js': 598, 'packages/m.js': 700 } };
    fs.writeFileSync(p, JSON.stringify(before, null, 2) + '\n', 'utf8');
    const out = G.pruneBaseline('packages/a.js', { baselinePath: p, lines: { 'packages/a.js': 468 } });
    assert.equal(out.error, undefined, JSON.stringify(out));
    assert.deepEqual(out.changed, ['packages/a.js'], '只允许动目标键：' + out.changed.join(','));
    const after = JSON.parse(fs.readFileSync(p, 'utf8'));
    assert.deepEqual(Object.keys(after.files), ['packages/z.js', 'packages/m.js'],
      '其它挂账必须原样保留且不得重排（减小 diff 面）');
    assert.deepEqual(after.pruned, { 'packages/a.js': 468 }, '还清的行数要落墓碑');
    assert.equal(after.limit, 500);
    assert.equal(after.growthAllowance, 200);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('回归⑥--prune 拒绝给未还债的文件发墓碑（否则等于自己给自己发免死金牌）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-prune-refuse-'));
  try {
    const p = path.join(dir, 'bl.json');
    fs.writeFileSync(p, JSON.stringify({ limit: 500, growthAllowance: 200, files: { 'packages/z.js': 900 } }, null, 2) + '\n', 'utf8');
    const out = G.pruneBaseline('packages/z.js', { baselinePath: p, lines: { 'packages/z.js': 900 } });
    assert.ok(out.error, '仍超限的文件不得 prune：' + JSON.stringify(out));
    assert.match(out.error, /900/);
    assert.deepEqual(JSON.parse(fs.readFileSync(p, 'utf8')).files, { 'packages/z.js': 900 }, '被拒时不得改文件');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('回归⑦--update 默认增量：不得抬高已有登记值、不得删键、必须保留 pruned', () => {
  const base = {
    limit: 500, growthAllowance: 200,
    files: { 'packages/a.js': 900, 'packages/b.js': 700, 'packages/gone.js': 800 },
    pruned: { 'packages/repaid.js': 468 },
  };
  const scanned = { 'packages/a.js': 1500, 'packages/b.js': 700, 'packages/new.js': 640, 'packages/repaid.js': 900 };
  const { body, changes } = G.computeUpdate(base, scanned);
  assert.equal(body.files['packages/a.js'], 900, '存量膨胀不得被抬成新基线（那是第二次开门）');
  assert.equal(body.files['packages/gone.js'], 800, '缺 scanned 数据不得静默删账');
  assert.equal(body.files['packages/new.js'], 640, '新增超限文件仍可登记');
  assert.ok(!('packages/repaid.js' in body.files), '有墓碑的条目不得被重新登记');
  assert.deepEqual(body.pruned, { 'packages/repaid.js': 468 }, 'pruned 必须原样保留');
  assert.deepEqual(changes.added, ['packages/new.js']);
  assert.deepEqual(changes.blockedRaise, [{ path: 'packages/a.js', registered: 900, current: 1500 }]);
  assert.deepEqual(changes.blockedRemove, ['packages/gone.js']);
  assert.deepEqual(changes.skippedTombstone, ['packages/repaid.js']);
});

test('回归⑧真实仓现状：主断言必须带 existing 一起喂（防单侧断言再度掩盖死代码）', () => {
  const base = G.readBaseline();
  assert.ok(base, 'max-lines-baseline.json 必须入库（存量挂账）');
  const { violations } = realRepoEvaluate(base);
  assert.deepEqual(violations, [], '当前 HEAD 不应有违规：\n' + violations.join('\n'));
  assert.ok(G.collectOverLimit(null, base.limit) && Object.keys(G.collectOverLimit(null, base.limit)).length > 0,
    '扫描到超限文件（否则口径失效）');
});

test('清单与现实一致时零违规，且违规按路径字典序稳定输出', () => {
  const files = { 'packages/a/one.js': 800, 'packages/b/two.vue': 500 };
  const base = { limit: 500, growthAllowance: 200, files };
  assert.deepEqual(G.evaluate(base, files).violations, []);
  const bad = G.evaluate(base, { 'packages/a/one.js': 800, 'packages/b/two.vue': 500, 'packages/zz/new.js': 501 });
  assert.equal(bad.violations.length, 1);
});

test('防回归：debt-guard 必须同时监听 pull_request 与 push 到 main（状态型门禁只在 PR 上跑必然逃逸）', () => {
  const yml = fs.readFileSync(path.join(__dirname, '..', 'workflows', 'debt-guard.yml'), 'utf8');
  assert.match(yml, /^on:\s*$/m, 'on 块存在');
  assert.match(yml, /^ {2}pull_request:\s*$/m, '必须仍在 PR 上跑（required check 不得消失）');
  assert.match(yml, /^ {2}push:\s*\n {4}branches:\s*\[\s*main\s*\]/m,
    '必须同时在 push 到 main 时跑：否则 main 自身处于违规态无人显红，后续每个无关 PR 都被这条红卡住');
  assert.ok(!/^[ \t]*paths-ignore[ \t]*:/m.test(yml), '不得按路径跳过（会让纯文档 PR 永久 BLOCKED）；注释里提及不算，但不得有生效配置');
  assert.match(yml, /name: 债务熔断检查/, 'required check 名必须保持不变');
});

test('扫描口径：受管目录/后缀/排除项按预期生效', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-'));
  try {
    fs.mkdirSync(path.join(root, 'packages', 'demo'), { recursive: true });
    fs.mkdirSync(path.join(root, 'packages', 'demo', 'tests'), { recursive: true });
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'big.py'), mk(600));
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'small.js'), mk(120));
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'spec.md'), mk(900));
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'tests', 'huge.test.js'), mk(900));
    gitify(root);
    const got = G.collectOverLimit(root, 500);
    assert.deepEqual(Object.keys(got), ['packages/demo/big.py'], '只有受管目录内的超限源文件入表（.md 与 tests/ 排除）');
    assert.equal(got['packages/demo/big.py'], 600, '行数按 split(\\n) 口径（无尾换行的 600 行文本）');
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test('清单落盘可复现：键字典序、两次写入字节一致', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-bl-'));
  try {
    const p = path.join(dir, 'bl.json');
    const a = G.writeBaseline({ 'packages/z.js': 700, 'packages/a.js': 900 }, { limit: 500, growthAllowance: 200 }, p);
    const bytes1 = fs.readFileSync(p, 'utf8');
    G.writeBaseline({ 'packages/a.js': 900, 'packages/z.js': 700 }, { limit: 500, growthAllowance: 200 }, p);
    assert.equal(fs.readFileSync(p, 'utf8'), bytes1, '写入顺序不得影响产物（否则 CI diff 噪声）');
    assert.deepEqual(Object.keys(a.files), ['packages/a.js', 'packages/z.js']);
    assert.match(bytes1, /"\/\/":/, '注释键必须入库（告诉后人怎么更新）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('与 scripts/check-debt-budget.js 同口径（防两套扫描各说各话）', () => {
  const debt = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'check-debt-budget.js'), 'utf8');
  // debt-budget 数组字面量风格：单引号 + 逗号后空格，逐字比对防两套扫描各说各话
  const lit = (arr) => '[' + arr.map((s) => "'" + s + "'").join(', ') + ']';
  for (const arr of [G.SCAN_DIRS, G.EXCLUDE]) {
    assert.ok(debt.includes(lit(arr)), '口径字面量必须在 debt-budget 中逐字出现：' + lit(arr));
  }
  assert.ok(
    debt.includes("SOURCE_EXTS = new Set(['.js', '.ts', '.vue', '.py', '.tsx', '.jsx', '.css', '.scss'])"),
    'SOURCE_EXTS 必须同口径'
  );
});

test('真实仓现状：挂账清单与扫描结果一致（门禁主断言）', () => {
  const base = G.readBaseline();
  assert.ok(base, 'max-lines-baseline.json 必须入库（存量挂账）');
  const scanned = G.collectOverLimit(null, base.limit);
  const { violations } = realRepoEvaluate(base);
  assert.deepEqual(violations, [], '当前 HEAD 不应有违规：\n' + violations.join('\n'));
  assert.ok(Object.keys(scanned).length > 0, '扫描到超限文件（否则口径失效）');
  // M-7：测试文件通道同样不得是死代码 —— 真实仓确有 >testLimit 的存量测试，
  // 且必须全部落在 testFiles 挂账里，否则 evaluate 会报 TEST_STALE/TEST_OVER。
  assert.ok(Object.keys(base.testFiles || {}).length > 0, 'testFiles 挂账不得为空（否则测试通道形同虚设）');
  assert.equal(base.testLimit, G.DEFAULT_TEST_LIMIT);
  assert.ok(Object.keys(base.targets || {}).length > 0, 'targets 点名清单不得为空');
});

// ── M-7：点名还账（targets）─────────────────────────────────────────────
// 修复前每个挂账文件的天花板是「登记值 + 200」，还能再胖 200 行。实测 20 个 TOP
// 文件里 14 个已静默漂到登记值之上（最多 +195），只是一直没碰到 +200 那条线。
test('M-7 点名还账：targets 命中时天花板=目标值、容差 0（登记容差不得再兜底）', () => {
  const rel = 'apps/desktop/src/views/CreateView.vue';
  const base = { limit: 500, growthAllowance: 200, files: { [rel]: 5656 }, targets: { [rel]: 5656 } };
  assert.deepEqual(G.evaluate(base, { [rel]: 5656 }, { [rel]: 5656 }).violations, [], '恰好等于目标放行');
  const over = G.evaluate(base, { [rel]: 5657 }, { [rel]: 5657 });
  assert.equal(over.violations.length, 1, over.violations.join(' | '));
  assert.match(over.violations[0], /^TARGET_GREW/);
  assert.ok(!over.violations.some((v) => /^LEDGER_GREW/.test(v)), '点名后不得退回「登记值+200」老路');
});

test('M-7 点名还账：未被点名的文件仍走登记值+200（不得把所有文件一起冻结）', () => {
  const named = 'apps/desktop/src/views/CreateView.vue';
  const other = 'packages/a/legacy.py';
  const base = { limit: 500, growthAllowance: 200, files: { [named]: 1000, [other]: 1200 }, targets: { [named]: 1000 } };
  const r = G.evaluate(base, { [named]: 1000, [other]: 1390 }, { [named]: 1000, [other]: 1390 });
  assert.deepEqual(r.violations, [], '未点名文件容差内仍应放行');
});

test('M-7 点名还账：targets 优先于墓碑 —— 点名文件不得借墓碑复活逃逸', () => {
  const rel = 'apps/desktop/src/views/CreateView.vue';
  const base = { limit: 500, growthAllowance: 200, files: {}, pruned: { [rel]: 100 }, targets: { [rel]: 5656 } };
  const r = G.evaluate(base, { [rel]: 6000 }, { [rel]: 6000 });
  assert.equal(r.violations.length, 1, r.violations.join(' | '));
  assert.match(r.violations[0], /^TARGET_GREW/);
});

// ── M-7：测试文件通道 ─────────────────────────────────────────────────
test('M-7 测试通道：新测试文件超 testLimit → TEST_OVER_LIMIT', () => {
  const base = { limit: 500, growthAllowance: 200, files: {}, testLimit: 1500, testFiles: {} };
  const td = { scanned: { 'apps/desktop/src/views/New.test.js': 1501 }, all: { 'apps/desktop/src/views/New.test.js': 1501 } };
  const r = G.evaluate(base, {}, {}, td);
  assert.equal(r.violations.length, 1, r.violations.join(' | '));
  assert.match(r.violations[0], /^TEST_OVER_LIMIT/);
});

test('M-7 测试通道：已挂账测试文件容差内放行、超容差报 TEST_LEDGER_GREW', () => {
  const rel = 'apps/desktop/src/views/CreateView.test.js';
  const base = { limit: 500, growthAllowance: 200, files: {}, testLimit: 1500, testFiles: { [rel]: 6574 } };
  assert.deepEqual(G.evaluate(base, {}, {}, { scanned: { [rel]: 6700 }, all: { [rel]: 6700 } }).violations, [],
    '+126 行在容差 200 内');
  const r = G.evaluate(base, {}, {}, { scanned: { [rel]: 6900 }, all: { [rel]: 6900 } });
  assert.equal(r.violations.length, 1, r.violations.join(' | '));
  assert.match(r.violations[0], /^TEST_LEDGER_GREW/);
});

test('M-7 测试通道：测试挂账条目消失报 TEST_STALE、降到上限下报 TEST_DEBT_REPAID', () => {
  const gone = 'apps/desktop/src/views/Gone.test.js';
  const paid = 'apps/desktop/src/views/Paid.test.js';
  const base = { limit: 500, growthAllowance: 200, files: {}, testLimit: 1500, testFiles: { [gone]: 1600, [paid]: 1600 } };
  const r = G.evaluate(base, {}, {}, { scanned: {}, all: { [paid]: 1200 } });
  const s = r.violations.join('\n');
  assert.match(s, /TEST_STALE_LEDGER_ENTRY: apps\/desktop\/src\/views\/Gone\.test\.js/);
  assert.match(s, /TEST_DEBT_REPAID: apps\/desktop\/src\/views\/Paid\.test\.js/);
});

test('M-7 测试通道：漏喂 testData 必须 fail-closed 报 TEST_STALE，不得静默跳过', () => {
  // 这条是本轮被自己的实现纠正过一次的地方：初版我按「没喂参数就整段跳过」写断言，
  // 实测发现代码会拿空表比对真实挂账、报 TEST_STALE —— 而那是**对**的。
  // 漏喂参数是接线 bug，应当当场变红；改成静默通过只会把「测试通道接错了」
  // 变成一条永远绿的装饰性检查（同 check-gate-record-debt 的「不完整的遍历
  // 判出零条违规，那是假绿」）。断言按实际且正确的行为写。
  const base = { limit: 500, growthAllowance: 200, files: {}, testLimit: 1500, testFiles: { 'a/b.test.js': 1600 } };
  const r = G.evaluate(base, {}, {});
  assert.equal(r.violations.length, 1, r.violations.join(' | '));
  assert.match(r.violations[0], /^TEST_STALE_LEDGER_ENTRY: a\/b\.test\.js/);
  assert.equal(r.results.testLedgerCount, 1, '结果里仍应报出挂账条数供人工核对');
});

test('M-7 测试通道：scanTestFiles 真的扫得到 .test/.spec（含 tests/ 目录），且不误伤源码', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-testscan-'));
  try {
    const put = (rel, n) => {
      fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
      fs.writeFileSync(path.join(dir, rel), mk(n));
    };
    put('apps/desktop/src/views/A.test.js', 700);
    put('apps/desktop/src/views/B.spec.js', 800);
    put('apps/desktop/tests/e2e/C.test.js', 900);
    put('apps/desktop/src/views/plain.js', 700);
    put('apps/desktop/src/views/data.ts', 800);
    gitify(dir); // 域由 git 判定：夹具必须是工作树，否则本用例测的是「夹具不像真实仓」
    const keys = Object.keys(G.scanTestFiles(dir)).sort();
    assert.deepEqual(keys, [
      'apps/desktop/src/views/A.test.js',
      'apps/desktop/src/views/B.spec.js',
      'apps/desktop/tests/e2e/C.test.js',
    ], '只收测试文件，且含 tests/ 目录下的');
    assert.ok(!keys.some((k) => k.endsWith('plain.js')), '普通源码不得被这条通道带进来');
    assert.ok(!keys.some((k) => k.endsWith('data.ts')), '.ts 源码不得被带进来');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// M-7 的 🔴CRITICAL（由外部跨家族评审 opencode/deepseek 抓出，自查未覆盖）：
// --update / --update --rewrite 原本只重建 `//,limit,growthAllowance,files,pruned`，
// 跑一次就把 testLimit / targets / testFiles / testPruned 四个键**静默**抹掉 ——
// 门禁当场退回「只挡新增、测试文件全不管」的旧行为且零报错。
// 这类缺陷只能靠「显式搬运 + 回归锁」挡住，写注释没用。
test('M-7 CRITICAL：--update 不得抹掉 targets / testFiles / testLimit / testPruned', () => {
  const full = {
    '//': 'keep me',
    limit: 500, growthAllowance: 200, testLimit: 1500,
    files: { 'packages/a.js': 900 },
    targets: { 'packages/a.js': 900 },
    pruned: { 'packages/old.js': 700 },
    testFiles: { 'apps/desktop/src/views/A.test.js': 6574 },
    testPruned: { 'apps/desktop/src/views/Old.test.js': 1600 },
  };
  const { body } = G.computeUpdate(full, { 'packages/a.js': 900 });
  for (const k of ['testLimit', 'targets', 'testFiles', 'testPruned']) {
    assert.ok(k in body, '--update 后 ' + k + ' 必须在（实测曾被静默抹掉）');
  }
  assert.deepEqual(body.targets, full.targets, 'targets 必须原样搬运，不得被清空');
  assert.deepEqual(body.testFiles, full.testFiles, 'testFiles 必须原样搬运');
  assert.deepEqual(body.testPruned, full.testPruned, 'testPruned 必须原样搬运');
  assert.equal(body.testLimit, 1500, 'testLimit 必须原样搬运');
});

test('M-7 CRITICAL：writeBaseline 同样不得丢四个新键', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-wb-'));
  try {
    const p = path.join(dir, 'bl.json');
    const body = G.writeBaseline(
      { 'packages/a.js': 900 },
      { limit: 500, growthAllowance: 200, testLimit: 1500,
        targets: { 'packages/a.js': 900 },
        pruned: { 'packages/old.js': 700 },
        testFiles: { 'apps/desktop/src/views/A.test.js': 6574 },
        testPruned: { 'apps/desktop/src/views/Old.test.js': 1600 } },
      p
    );
    const back = JSON.parse(fs.readFileSync(p, 'utf8'));
    for (const k of ['testLimit', 'targets', 'testFiles', 'testPruned']) {
      assert.ok(k in back, '落盘后 ' + k + ' 必须存在');
    }
    assert.deepEqual(back.targets, body.targets);
    assert.deepEqual(back.testFiles, body.testFiles);
    // 缺省时也必须给出可用的结构，不能是 undefined（否则 evaluate 读 targets 时炸）
    const fresh = G.writeBaseline({}, {}, path.join(dir, 'fresh.json'));
    assert.deepEqual(fresh.targets, {}, '缺省 targets 必须是空对象而非 undefined');
    assert.deepEqual(fresh.testFiles, {}, '缺省 testFiles 必须是空对象');
    assert.equal(fresh.testLimit, G.DEFAULT_TEST_LIMIT, '缺省 testLimit 必须是 DEFAULT_TEST_LIMIT');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 扫描域 = git 的域（#80 回归保护，2026-10-18）─────────────────────────────
// 动因（实测）：#3782（change bundle-untrack）把 5 个构建产物移出版本控制（.gitignore 点名
// apps/desktop/electron/preload/index.bundle.js 与 home-shell-preload.bundle.js），而这两个路径
// 既落在 SCAN_DIRS 内、扩展名又是 .js。旧实现按 fs.readdirSync 走**磁盘**，于是「本机刚跑过
// build:preload」就等于两个 gitignored 产物进视野 ⇒ NEW_OVER_LIMIT 假红；CI 的检出里根本没有
// 它们 ⇒ 本机与 CI 量的不是同一棵树。修法：把「该不该被量」交给 git 判，
// 域 = 索引内文件 ∪ 未被忽略的未跟踪文件（正是 git status 的口径，也是 CI 检出的口径）。
const { spawnSync } = require('node:child_process')
const IMPL = path.join(__dirname, 'check-max-lines.js')

// 夹具必须自己决定「唯一变量是这份 .gitignore」：屏蔽全局 excludesFile 与机器态配置，
// 否则同一条用例在装了全局 gitignore 的机器上会多/少排几个文件（本仓 runner-only 红的同型教训）。
// 这份空 gitconfig 必须落在被测目录**之外**：写进 root 就会被 git 当成一个未跟踪文件，
// 于是「空仓库」夹具其实非空，空域判据点不到火（T6 首跑失败的真实原因）。
function gitcfgPathFor(root) { return path.join(os.tmpdir(), 'maxlines-gitcfg-' + process.pid + '-' + path.basename(root) + '.txt') }
function gitEnv(root) {
  const env = Object.assign({}, process.env)
  const empty = gitcfgPathFor(root)
  if (!fs.existsSync(empty)) fs.writeFileSync(empty, '')
  env.GIT_CONFIG_GLOBAL = empty
  // delete GIT_CONFIG_SYSTEM 不关 system 档（只是不重定向）。实测：system 档里的
  // core.excludesFile 会把文件从 --exclude-standard 里藏掉 ⇒ 域随机器态漂移。唯一开关是 NOSYSTEM。
  env.GIT_CONFIG_NOSYSTEM = '1'
  return env
}
// 隔离必须由代码证明，不能靠"这台机器大概没配"：读到 excludesFile 就说明夹具不再只有一个变量。
function assertConfigIsolated(root, env) {
  const r = spawnSync('git', ['-C', root, 'config', '--get', 'core.excludesFile'], { encoding: 'utf8', env: env })
  if (r.status === 0 && String(r.stdout || '').trim()) {
    throw new Error('夹具配置隔离未生效：core.excludesFile 仍被读到 ⇒ 扫描域会随机器态漂移，实测值=' + String(r.stdout).trim())
  }
}

function gitRun(root, args, env) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8', env: env || process.env })
  if (r.status !== 0) throw new Error('git ' + args.join(' ') + ' rc=' + r.status + ' ' + String(r.stderr || '').trim())
  return String(r.stdout || '')
}

/** 造一个'像真实仓'的临时工作树：写文件 → git init → git add（进索引即算受管，不需要 commit） */
function mkGitRoot(prefix, layout, gitignore) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'))
  if (gitignore) fs.writeFileSync(path.join(root, '.gitignore'), gitignore)
  for (const rel of Object.keys(layout)) {
    const abs = path.join(root, rel)
    fs.mkdirSync(path.dirname(abs), { recursive: true })
    fs.writeFileSync(abs, layout[rel])
  }
  const env = gitEnv(root)
  gitRun(root, ['init', '-q'], env)
  gitRun(root, ['add', '-A'], env)
  return root
}

/** 把已写好文件的临时目录变成受管状态。
 * 域改由 git 判定后，非工作树的临时目录不再可扫——那正是本次要拦的形态，
 * 所以既有夹具必须迁成真实 git 工作树（把环境造成那个形态，而不是放宽断言）。
 */
function gitify(root) {
  const env = gitEnv(root)
  gitRun(root, ['init', '-q'], env)
  assertConfigIsolated(root, env)
  gitRun(root, ['add', '-A'], env)
  return root
}

function rmRf(p) {
  fs.rmSync(p, { recursive: true, force: true })
  fs.rmSync(gitcfgPathFor(p), { force: true }) // 不留碎片：每跑一次会落一个空 gitconfig
}

test('扫描域回归：gitignored 的构建产物不得进 NEW_OVER_LIMIT（本机假红的根因）', () => {
  const root = mkGitRoot('maxlines-ignored-', {
    'apps/desktop/electron/keep.js': mk(10),                    // 受管小文件，保证仓库非空
    'apps/desktop/electron/preload/index.bundle.js': mk(900),   // 磁盘在、git 不认（构建产物）
    'packages/demo/handwritten.js': mk(900),                    // 真手写超限，必须仍然拦
  }, 'apps/desktop/electron/preload/*.bundle.js\n')
  try {
    const got = Object.keys(G.collectOverLimit(root, 500)).sort()
    assert.deepEqual(got, ['packages/demo/handwritten.js'],
      'gitignored 产物出现在扫描结果里 = 旧的磁盘域回来了（本机红 / CI 绿的分裂）')
  } finally { rmRf(root) }
})

test('收窄不得过头：未跟踪但未被忽略的新文件必须仍被计入（否则门禁对还没 git add 的新债失明）', () => {
  const root = mkGitRoot('maxlines-others-', { 'apps/desktop/electron/keep.js': mk(10) }, null)
  try {
    fs.writeFileSync(path.join(root, 'apps', 'desktop', 'electron', 'brandnew.js'), mk(900))
    const got = Object.keys(G.collectOverLimit(root, 500))
    assert.ok(got.indexOf('apps/desktop/electron/brandnew.js') >= 0,
      '域退化成只看索引，会把未提交的新债整类漏掉；正解是 tracked 并 others-not-ignored')
  } finally { rmRf(root) }
})

test('取不到 git 读数必须 fail closed：不得退回磁盘全量，也不得把空域读成没有债', () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-nogit-'))
  const bp = path.join(root, 'baseline.json')
  try {
    fs.mkdirSync(path.join(root, 'packages', 'demo'), { recursive: true })
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'big.js'), mk(900))
    fs.writeFileSync(bp, JSON.stringify({ limit: 500, growthAllowance: 200, files: {} }))
    const env = gitEnv(root)
    assert.throws(() => G.collectOverLimit(root, 500), /git/,
      '扫描根不是 git 工作树时必须出声，而不是静按磁盘扫（那正是被修的假红来源）')
    const r = spawnSync(process.execPath, [IMPL, '--root', root, '--baseline', bp],
      { encoding: 'utf8', env: env })
    const out = String(r.stdout) + String(r.stderr)
    assert.equal(r.status, 2, '判据自身故障走退出码 2（与发现违规的 1 分开）；实测输出：' + out)
    assert.match(out, /无法从 git 取得扫描域/)
  } finally { rmRf(root) }
})

test('真实仓交叉探针：域必须等于 git status 口径、规模非退化，且账本每个键都可被量到', () => {
  const root = path.resolve(__dirname, '..', '..')
  const domain = G.gitDomain(root)
  assert.ok(domain instanceof Set && domain.size > 5000,
    '真实仓域规模下界（解析退化=空集合，读起来完全像通过）；实测 domain=' + domain.size)
  // 独立探针：git status --porcelain=v1 -z -uall 的 ?? 记录，并上 git ls-files -z。
  // 探针必须与实现同环境（同读机器 git 配置），否则比的是配置差异不是口径差异；
  // 且不得复用 G.gitDomain 自己作对照（同源判据不能自证，本仓「装饰性门禁」同型）。
  const probe = new Set(gitRun(root, ['ls-files', '-z']).split('\0').filter(Boolean))
  for (const rec of gitRun(root, ['status', '--porcelain=v1', '-z', '-uall', '--no-renames']).split('\0')) {
    if (rec.startsWith('?? ')) probe.add(rec.slice(3))
  }
  assert.deepEqual(Array.from(domain).sort(), Array.from(probe).sort(),
    '域与 git status 口径不一致（两把探针对同一主张给出不同答案，必须先解释再收口）')
  const base = G.readBaseline()
  const missing = []
  for (const sec of ['files', 'testFiles', 'targets']) {
    for (const k of Object.keys((base && base[sec]) || {})) if (!domain.has(k)) missing.push(sec + ':' + k)
  }
  assert.deepEqual(missing, [], '挂账清单里出现不受管的路径 = 账本与现实脱钩')
})

test("git 可用但报告零文件也必须 fail closed：空域不等于「没有超限文件」", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-emptyrepo-'));
  try {
    gitRun(root, ['init', '-q'], gitEnv(root)) // 干净空仓库：ls-files rc=0 且输出为空
    assert.throws(() => G.gitDomain(root), /0 个文件/, '空索引必须抛错，不得当成「全仓无债」——那正是把工具的失明读成结论')
  } finally { rmRf(root) }
})

test("现场留痕：plain 模式打印 domain= 且与 gitDomain(root).size 一致；--json 模式不得打印（会污染 JSON）", () => {
  const plain = spawnSync(process.execPath, [IMPL], { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8' })
  const out = String(plain.stdout)
  const m = out.match(/^\[max-lines\] domain=(\d+) /m)
  assert.ok(m, 'plain 模式必须打印域规模留痕，否则下次没人知道它测的是哪个集合；实测首行：' + out.split('\n')[0])
  assert.equal(Number(m[1]), G.gitDomain(path.resolve(__dirname, '..', '..')).size, '打印的数必须就是判据实际用的域大小（同源，不是另算一遍）')
  const j = spawnSync(process.execPath, [IMPL, '--json'], { cwd: path.resolve(__dirname, '..', '..'), encoding: 'utf8' })
  assert.ok(!/^\[max-lines\]/m.test(String(j.stdout)), "--json 模式混入非 JSON 行会让消费方解析失败")
  const parsed = JSON.parse(String(j.stdout))
  assert.equal(parsed.domainSize, G.gitDomain(path.resolve(__dirname, '..', '..')).size, '--json 必须把域规模放进对象里')
})

// ── QM-6 两轴采纳后补的三格锁（被审快照 1aecfedeb → 采纳提交见 PR）─────────────
test("被跟踪但同时命中 .gitignore 的文件必须仍在域内（并集语义，不得改成只取非忽略项）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-forced-'));
  try {
    fs.writeFileSync(path.join(root, '.gitignore'), 'apps/desktop/electron/preload/*.bundle.js\n')
    fs.mkdirSync(path.join(root, 'apps', 'desktop', 'electron', 'preload'), { recursive: true })
    fs.writeFileSync(path.join(root, 'apps', 'desktop', 'electron', 'keep.js'), mk(10))
    fs.writeFileSync(path.join(root, 'apps', 'desktop', 'electron', 'preload', 'forced.bundle.js'), mk(900))
    const env = gitEnv(root)
    gitRun(root, ['init', '-q'], env)
    assertConfigIsolated(root, env)
    gitRun(root, ['add', '-A'], env)
    gitRun(root, ['add', '-f', '--', 'apps/desktop/electron/preload/forced.bundle.js'], env) // 历史上 git add -f 过的产物
    const got = Object.keys(G.collectOverLimit(root, 500)).sort()
    assert.ok(got.indexOf('apps/desktop/electron/preload/forced.bundle.js') >= 0,
      '域判据必须是「索引 ∪ 未忽略的未跟踪」而非 check-ignore；后者会让被跟踪的生成物静默不再被量')
  } finally { rmRf(root) }
})

test("索引里有、磁盘上没有：不被测量，但也不能被当成「查过了没问题」——挂账条目必须报 STALE", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-ghost-'));
  try {
    fs.mkdirSync(path.join(root, 'packages', 'demo'), { recursive: true })
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'ghost.js'), mk(600))
    gitify(root)
    fs.rmSync(path.join(root, 'packages', 'demo', 'ghost.js')) // 暂存删除：索引仍列它
    const env = gitEnv(root)
    assert.ok(G.gitDomain(root).has('packages/demo/ghost.js'), '域按 git 判，不该随磁盘删除而缩小（否则 STALE 判据失去对象）')
    assert.ok(!Object.keys(G.scanAllLines(root, G.gitDomain(root))).some((k) => k.endsWith('ghost.js')), '读不到内容就不入表')
    const base = { limit: 500, growthAllowance: 200, files: { 'packages/demo/ghost.js': 600 } }
    const r = G.evaluate(base, {}, G.scanAllLines(root, G.gitDomain(root)))
    assert.match(r.violations.join(' | '), /^STALE_LEDGER_ENTRY: packages\/demo\/ghost\.js/,
      '幽灵路径必须由挂账清单的 STALE 判据出声，不得静默消失（评审后端轴 W1 的可达那一格）')
  } finally { rmRf(root) }
})

test("system 档的 core.excludesFile 真能改域：夹具的 NOSYSTEM 是承重的（A/B 两档 + 与 gitEnv 对齐）", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-syscfg-'));
  try {
    fs.mkdirSync(path.join(root, 'packages', 'demo'), { recursive: true })
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'a.js'), mk(10))
    fs.writeFileSync(path.join(root, 'packages', 'demo', 'hidden.bundle.js'), mk(10))
    const ign = path.join(root, '..', 'maxlines-hidden-' + path.basename(root) + '.ign')
    fs.writeFileSync(ign, 'hidden.bundle.js\n')
    const sys = path.join(root, '..', 'maxlines-system-' + path.basename(root) + '.gitconfig')
    fs.writeFileSync(sys, '[core]\n\texcludesFile = ' + ign.replace(/\\/g, '/') + '\n')
    const bp = path.join(root, '..', 'maxlines-baseline-' + path.basename(root) + '.json')
    fs.writeFileSync(bp, JSON.stringify({ limit: 500, growthAllowance: 200, files: {} }))
    gitRun(root, ['init', '-q'], gitEnv(root))
    const domSize = (env) => {
      const r = spawnSync(process.execPath, [IMPL, '--root', root, '--baseline', bp, '--json'], { cwd: root, encoding: 'utf8', env: env })
      assert.equal(r.status, 0, '门禁应正常出结论（夹具文件都远未到 limit）；实测：' + String(r.stdout) + String(r.stderr))
      return JSON.parse(String(r.stdout)).domainSize
    }
    const withSystem = domSize(Object.assign({}, process.env, { GIT_CONFIG_SYSTEM: sys }))
    const noSystem = domSize(Object.assign({}, process.env, { GIT_CONFIG_SYSTEM: sys, GIT_CONFIG_NOSYSTEM: '1' }))
    assert.ok(noSystem > withSystem, 'system 档里的 excludesFile 确实会把文件藏出域：带档 ' + withSystem + ' vs 关档 ' + noSystem)
    // 关键：把 system 档叠到 gitEnv 之上再比。干净机器上「摘掉开关」与「留着开关」同形，
    // 只有让 system 档真的在场，gitEnv 里那行 NOSYSTEM 才是可测变量。
    const stacked = Object.assign({}, gitEnv(root), { GIT_CONFIG_SYSTEM: sys })
    assert.equal(domSize(stacked), noSystem, 'gitEnv 必须在 system 档存在时依然关得掉它，否则那行是装饰')
    // 守卫自己也得有牙：真出现 excludesFile 时必须当场炸，而不是只打印漂亮话。
    assert.throws(() => assertConfigIsolated(root, Object.assign({}, process.env, {
      GIT_CONFIG_SYSTEM: sys, GIT_CONFIG_GLOBAL: gitcfgPathFor(root)
    })), /夹具配置隔离未生效/)
  } finally {
    fs.rmSync(path.join(root, '..', 'maxlines-hidden-' + path.basename(root) + '.ign'), { force: true })
    fs.rmSync(path.join(root, '..', 'maxlines-system-' + path.basename(root) + '.gitconfig'), { force: true })
    fs.rmSync(path.join(root, '..', 'maxlines-baseline-' + path.basename(root) + '.json'), { force: true })
    rmRf(root)
  }
})

test('targets 重锚：允许同 PR 上调，但只允许恰好锚定当前行数', async (t) => {
  const mkBase = (targets) => ({ limit: 500, growthAllowance: 200, files: {}, targets });
  await t.test('合法：文件确实从 100 涨到 113，目标同步 100 -> 113', () => {
    const r = G.evaluate(mkBase({ 'a.js': 113 }), { 'a.js': 113 }, { 'a.js': 113 }, null, { targets: { 'a.js': 100 } });
    assert.deepEqual(r.violations, []);
  });
  await t.test('无增长支撑：文件只有 90 行却把目标从 100 上调到 120', () => {
    const r = G.evaluate(mkBase({ 'a.js': 120 }), {}, { 'a.js': 90 }, null, { targets: { 'a.js': 100 } });
    assert.ok(r.violations.some((v) => v.startsWith('TARGET_BUMP_UNJUSTIFIED')), r.violations.join(';'));
  });
  await t.test('留额度：文件 113 行，目标却上调到 120', () => {
    const r = G.evaluate(mkBase({ 'a.js': 120 }), { 'a.js': 113 }, { 'a.js': 113 }, null, { targets: { 'a.js': 100 } });
    assert.ok(r.violations.some((v) => v.startsWith('TARGET_BUMP_HEADROOM')), r.violations.join(';'));
  });
  await t.test('删目标等于永久解除零增长约束', () => {
    const r = G.evaluate(mkBase({}), {}, { 'a.js': 90 }, null, { targets: { 'a.js': 100 } });
    assert.ok(r.violations.some((v) => v.startsWith('TARGET_REMOVED')), r.violations.join(';'));
  });
  await t.test('无关 PR：targets 未变时不受影响', () => {
    const r = G.evaluate(mkBase({ 'a.js': 100 }), {}, { 'a.js': 90 }, null, { targets: { 'a.js': 100 } });
    assert.deepEqual(r.violations, []);
  });
  await t.test('只降不升：为还债而下调目标永远允许', () => {
    const r = G.evaluate(mkBase({ 'a.js': 90 }), {}, { 'a.js': 90 }, null, { targets: { 'a.js': 100 } });
    assert.deepEqual(r.violations, []);
  });
});

// base 的取法本身必须被锁住：2026-10-23 实测 PR #4337 在主干上被判
// `TARGET_BASE_UNAVAILABLE`，而同一份代码在本机 rc=0 —— 差的就是这一个 ref。
// 根因：CI 的 actions/checkout 默认 fetch-depth: 1，既没有 origin/main 的远程跟踪 ref、
// 也没有父提交 ⇒ `git show origin/main:...` 必然失败 ⇒ fail-closed 规则恒红。
// 本组用例把「取不到 base 就必须能被取到」与「四条候选全落空必须返回 null」两件事都钉住。
test('targets 重锚审计的 base 取法：取不到 origin/main 时必须能回落到 HEAD^，四条全落空才返回 null', async (t) => {
  const mkRepo = (prefix) => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), prefix + '-'));
    const env = gitEnv(root);
    gitRun(root, ['init', '-q'], env);
    const writeBase = (targets) => {
      fs.mkdirSync(path.join(root, '.github', 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(root, '.github', 'scripts', 'max-lines-baseline.json'),
        JSON.stringify({ limit: 500, growthAllowance: 200, files: {}, targets }));
    };
    writeBase({ 'a.js': 100 });
    gitRun(root, ['add', '-A'], env);
    gitRun(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'base'], env);
    writeBase({ 'a.js': 120 });
    gitRun(root, ['add', '-A'], env);
    gitRun(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'bump'], env);
    return { root, env };
  };

  await t.test('显式给的 base 优先', () => {
    const { root, env } = mkRepo('maxlines-basepick');
    try {
      const r = G.readBaseTargets(root, 'HEAD^');
      assert.ok(r, '必须取到 base');
      assert.equal(r.ref, 'HEAD^');
      assert.deepEqual(r.targets, { 'a.js': 100 }, '读到的是 base 那份基线，不是 HEAD 的');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await t.test('给的 ref 取不到 ⇒ 回落到 HEAD^（CI 浅克隆/无 origin/main 的形态）', () => {
    const { root } = mkRepo('maxlines-basefallback');
    try {
      const r = G.readBaseTargets(root, 'no-such-ref');
      assert.ok(r, '必须回落到某个可取的 base，而不是返回 null 触发恒红');
      // 断言**内容**（读到的必须是 base 那份基线），不断言落在哪个别名上：
      // 非 merge 提交下 HEAD^1 与 HEAD^ 指向同一个提交（git 的别名），断言别名等于把实现细节钉死。
      assert.ok(['HEAD^1', 'HEAD^'].includes(r.ref), '回落的 ref 应是 HEAD^1/HEAD^ 之一，实得 ' + r.ref);
      assert.deepEqual(r.targets, { 'a.js': 100 });
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });

  await t.test('四条候选全落空 ⇒ 返回 null（fail-closed，不得静默放行）', () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'maxlines-basenone-'));
    const env = gitEnv(root);
    try {
      gitRun(root, ['init', '-q'], env);
      fs.mkdirSync(path.join(root, '.github', 'scripts'), { recursive: true });
      fs.writeFileSync(path.join(root, '.github', 'scripts', 'max-lines-baseline.json'), JSON.stringify({ targets: { 'a.js': 100 } }));
      gitRun(root, ['add', '-A'], env);
      gitRun(root, ['-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-q', '-m', 'only'], env);
      // 单提交仓：HEAD^1 / HEAD^ 都不存在，origin/main 也不存在 ⇒ 四条候选全落空
      const r = G.readBaseTargets(root, null);
      assert.equal(r, null, '取不到 base 必须返回 null，让 targetAudit 走 fail-closed');
    } finally { fs.rmSync(root, { recursive: true, force: true }); }
  });
});


// ⚠ 2026-10-23 实测踩到并修掉的一个洞：base 审计的 fail-closed 那条 violation，
// 曾经会落到**每一条合成夹具**上（CI 里 GITHUB_ACTIONS=true ⇒ 推 violation 而不是 notice）
// ⇒ 整个测试文件在 CI 红、本机全绿（not ok 1「新代码阻断：超限且未挂账 → NEW_OVER_LIMIT」，2 !== 1）。
// 三档语义必须分清：undefined = 调用方没要求审计 / null = 要求了但取不到 base / 对象 = base 读到了。
test('base 审计的三档语义：夹具不污染、真跑取不到 base 才 fail-closed', async (t) => {
  const OLD_ENV = process.env.GITHUB_ACTIONS;
  process.env.GITHUB_ACTIONS = 'true'; // 模拟 CI：fail-closed 那条才会推 violation
  try {
    await t.test('合成夹具（不传 baseInfo）⇒ 无 violation、无 base 相关 notice', () => {
      const base = { limit: 500, growthAllowance: 200, files: {} };
      const r = G.evaluate(base, { 'packages/a/big.js': 640 });
      assert.deepEqual(r.violations.map((v) => v.split(':')[0]), ['NEW_OVER_LIMIT'],
        '只应有 NEW_OVER_LIMIT 一条，不得混进 base 审计的违规：' + JSON.stringify(r.violations));
      assert.ok(!r.notices.some((n) => /base/.test(n)), '夹具不得收到 base 相关 notice：' + JSON.stringify(r.notices));
    });

    await t.test('显式要求审计但取不到 base（baseInfo=null）⇒ CI 内 fail-closed', () => {
      const base = { limit: 500, growthAllowance: 200, files: {} };
      const r = G.evaluate(base, { 'packages/a/big.js': 640 }, { 'packages/a/big.js': 640 }, null, null);
      assert.ok(r.violations.some((v) => v.startsWith('TARGET_BASE_UNAVAILABLE')),
        '取不到 base 必须 fail-closed：' + JSON.stringify(r.violations));
    });

    await t.test('base 读到了 ⇒ 正常做三条判据，不出 TARGET_BASE_UNAVAILABLE', () => {
      // 读数方向：evaluate 收到的 baseline 是**本次改动后的**基线（targets=新值 800），
      // baseInfo.targets 是**改动前**的 base（targets=旧值 700）⇒ 「上调」= 800 > 700。
      // 而文件实际只有 640 行（并未超过旧目标 700）⇒ 落在 TARGET_BUMP_UNJUSTIFIED 那一格。
      const base = { limit: 500, growthAllowance: 200, files: {}, targets: { 'packages/a/big.js': 800 } };
      const r = G.evaluate(base, { 'packages/a/big.js': 640 }, { 'packages/a/big.js': 640 }, null, { targets: { 'packages/a/big.js': 700 } });
      assert.ok(!r.violations.some((v) => v.startsWith('TARGET_BASE_UNAVAILABLE')),
        'base 读到时不得报取不到 base：' + JSON.stringify(r.violations));
      assert.ok(r.violations.some((v) => v.startsWith('TARGET_BUMP_UNJUSTIFIED')),
        '无增长支撑的上调必须被抓：' + JSON.stringify(r.violations));
    });
  } finally {
    if (OLD_ENV === undefined) delete process.env.GITHUB_ACTIONS;
    else process.env.GITHUB_ACTIONS = OLD_ENV;
  }
});
