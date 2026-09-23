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
  assert.equal(res.notices.length, 1);
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
  const { violations } = G.evaluate(base, G.collectOverLimit(null, base.limit), G.scanAllLines());
  assert.deepEqual(violations, [], '当前 HEAD 不应有违规：\n' + violations.join('\n'));
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
  const { violations } = G.evaluate(base, scanned);
  assert.deepEqual(violations, [], '当前 HEAD 不应有违规：\n' + violations.join('\n'));
  assert.ok(Object.keys(scanned).length > 0, '扫描到超限文件（否则口径失效）');
});
