'use strict';

/**
 * check-max-lines 门禁用例（node:test）。
 * 覆盖：新代码阻断、存量挂账三态、清单落盘可复现、与 debt-budget 同口径、真实仓现状。
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

test('清单防腐化：僵尸条目与已还债都必须清账', () => {
  const base = { limit: 500, growthAllowance: 200, files: { 'packages/a/gone.js': 900, 'packages/b/shrunk.ts': 700 } };
  const { violations } = G.evaluate(base, { 'packages/b/shrunk.ts': 320 });
  assert.equal(violations.length, 2);
  assert.match(violations.join('\n'), /STALE_LEDGER_ENTRY: packages\/a\/gone\.js/);
  assert.match(violations.join('\n'), /STALE_LEDGER_ENTRY: packages\/b\/shrunk\.ts 已降到 500 行以下/);
});

test('清单与现实一致时零违规，且违规按路径字典序稳定输出', () => {
  const files = { 'packages/a/one.js': 800, 'packages/b/two.vue': 500 };
  const base = { limit: 500, growthAllowance: 200, files };
  assert.deepEqual(G.evaluate(base, files).violations, []);
  const bad = G.evaluate(base, { 'packages/a/one.js': 800, 'packages/b/two.vue': 500, 'packages/zz/new.js': 501 });
  assert.equal(bad.violations.length, 1);
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
