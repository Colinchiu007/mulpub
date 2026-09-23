'use strict';

/**
 * check-dep-audit 门禁用例（node:test）。
 * 全部注入假扫描结果/假时钟，不联网、不调用 pnpm / pip-audit。
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const D = require('./check-dep-audit.js');

const FUTURE = '2099-01-01';

function entry (source, id, extra) {
  return Object.assign({ source, id, module: 'm', severity: 'high', patched: '>=1.2.3', roots: ['apps__desktop'] }, extra);
}

function ledger (source, id, decision, note) {
  return Object.assign(entry(source, id), { decision: decision || 'upgrade-tracked', note: note === undefined ? '已排期升级' : note });
}

test('npm audit JSON 解析：按 GHSA 去重并汇总 workspace 根', () => {
  const rows = D.parseNpmAudit({
    advisories: {
      1: { github_advisory_id: 'GHSA-a', module_name: 'qs', severity: 'moderate', patched_versions: '>=6.16.0', findings: [{ version: '6.15.3', paths: ['packages__ai-writer-api>express>qs', 'apps__desktop>vite>qs'] }] },
      2: { github_advisory_id: 'GHSA-a', module_name: 'qs', severity: 'moderate', patched_versions: '>=6.16.0', findings: [{ version: '6.15.3', paths: ['packages__ui>x>qs'] }] },
      3: { id: 99, module_name: 'no-ghsa', severity: 'low', patched_versions: '', findings: [] },
    },
  });
  assert.equal(rows.length, 2, '同一公告只保留一条');
  const ghsa = rows.find((r) => r.id === 'GHSA-a');
  assert.deepEqual(ghsa.roots, ['apps__desktop', 'packages__ai-writer-api', 'packages__ui']);
  assert.equal(ghsa.source, 'npm');
  assert.equal(rows.find((r) => r.module === 'no-ghsa').id, 'npm-99', '缺 GHSA 号时退回 npm advisory id');
});

test('pip-audit JSON 解析：同一公告命中多个包时合并包名', () => {
  const rows = D.parsePipAudit({
    dependencies: [
      { name: 'ecdsa', version: '0.19.2', vulns: [{ id: 'PYSEC-1', fix_versions: [] }] },
      { name: 'joserfc', version: '1.0', vulns: [{ id: 'PYSEC-1', fix_versions: ['1.1'] }] },
      { name: 'clean', version: '1.0', vulns: [] },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].source, 'pip');
  assert.equal(rows[0].module, 'ecdsa,joserfc');
  assert.equal(rows[0].patched, '1.1');
  assert.deepEqual(D.parsePipAudit({}), []);
});

test('新公告必须阻断：基线之外的任意 advisory id 触发 NEW_ADVISORY', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('npm', 'GHSA-old')] };
  const { violations } = D.evaluate(base, [entry('npm', 'GHSA-old'), entry('npm', 'GHSA-new')], FUTURE);
  assert.equal(violations.length, 1);
  assert.match(violations[0], /^NEW_ADVISORY: npm\/GHSA-new/);
  assert.match(violations[0], /修复版本 >=1.2.3/);
});

test('基线腐化：已不再命中的公告必须清账', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('npm', 'GHSA-gone'), ledger('pip', 'PYSEC-x')] };
  const { violations } = D.evaluate(base, [entry('pip', 'PYSEC-x')], FUTURE);
  assert.deepEqual(violations, ['RESOLVED_STILL_BASELINED: npm/GHSA-gone 已不再命中（多半已升级），请 --update 清账']);
});

test('挂账 accountability：decision 非法 / note 空 / reviewBy 缺失或过期都要拦', () => {
  const bad = {
    reviewBy: FUTURE,
    advisories: [
      ledger('npm', 'GHSA-1', 'wontfix', ''),
      Object.assign(entry('npm', 'GHSA-2'), { note: 'x' }),
      ledger('npm', 'GHSA-3', 'accepted-risk', '   '),
    ],
  };
  const found = [entry('npm', 'GHSA-1'), entry('npm', 'GHSA-2'), entry('npm', 'GHSA-3')];
  const { violations } = D.evaluate(bad, found, FUTURE);
  assert.equal(violations.filter((v) => v.startsWith('BASELINE_META_INVALID')).length, 4,
    'decision 非法 ×1 + decision 缺失 ×1 + note 空 ×2 = 4');
  const noDate = D.evaluate({ advisories: [] }, [], FUTURE);
  assert.ok(noDate.violations.some((v) => /reviewBy/.test(v)));
  const expired = D.evaluate({ reviewBy: '2020-01-01', advisories: [] }, [], FUTURE);
  assert.match(expired.violations[0], /^REVIEW_DEADLINE_PASSED/);
});

test('基线与现实一致且结论完整 → 零违规（门禁主断言）', () => {
  const items = [ledger('npm', 'GHSA-1'), ledger('pip', 'PYSEC-1', 'no-fix-available', '上游明确不修')];
  const found = [entry('npm', 'GHSA-1'), entry('pip', 'PYSEC-1', { module: 'ecdsa', severity: 'unknown', patched: '' })];
  const { violations } = D.evaluate({ reviewBy: FUTURE, advisories: items }, found, FUTURE);
  assert.deepEqual(violations, [], violations.join('\n'));
});

test('--update 产物：新增条目一律 decision=TODO（逼人工补结论），且可复现', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depaudit-'));
  try {
    const p = path.join(dir, 'bl.json');
    const old = { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-1'), { note: '保留原结论' })] };
    const found = [entry('npm', 'GHSA-1'), entry('npm', 'GHSA-2'), entry('pip', 'PYSEC-3')];
    const first = D.writeBaseline(found, old, p);
    const text1 = fs.readFileSync(p, 'utf8');
    D.writeBaseline(found.slice().reverse(), old, p);
    assert.equal(fs.readFileSync(p, 'utf8'), text1, '写入顺序不得影响产物（否则 diff 噪声）');
    assert.deepEqual(first.advisories.map((a) => a.source + '/' + a.id), ['npm/GHSA-1', 'npm/GHSA-2', 'pip/PYSEC-3']);
    assert.equal(first.advisories[0].note, '保留原结论', '已有条目的结论必须保留');
    assert.equal(first.advisories[1].decision, 'TODO');
    assert.equal(first.reviewBy, FUTURE);
    // 新条目的 TODO 一定会被 META_INVALID 拦下 —— 这就是「不允许无结论挂账」
    const { violations } = D.evaluate(first, found, FUTURE);
    assert.equal(violations.filter((v) => v.startsWith('BASELINE_META_INVALID')).length, 2);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('仓库现状：入库基线与判定口径自洽（真实扫描结论已登记）', () => {
  const base = D.readBaseline();
  assert.ok(base, 'dep-audit-baseline.json 必须入库');
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(base.reviewBy), 'reviewBy 必须是日期');
  const ids = base.advisories.map((a) => a.source + '/' + a.id);
  assert.equal(new Set(ids).size, ids.length, '基线不得有重复条目');
  assert.ok(ids.length > 0, '本次实跑扫描已确认存在已知漏洞，基线不应当空');
  for (const a of base.advisories) {
    assert.ok(D.VALID_DECISIONS.includes(a.decision), '条目结论非法: ' + a.id + '=' + a.decision);
    assert.ok(String(a.note || '').trim().length > 0, '条目缺 note: ' + a.id);
  }
  // 幂等自检：用基线自身当扫描结果跑一遍，除日期外不应产生任何违规
  const asFound = base.advisories.map((a) => entry(a.source, a.id, a));
  const { violations } = D.evaluate(base, asFound, '2000-01-01');
  assert.deepEqual(violations.filter((v) => !/REVIEW_DEADLINE_PASSED/.test(v)), [], violations.join('\n'));
});

test('registry 口径：audit 必须走官方源（npmmirror 无 audit 端点）', () => {
  const src = fs.readFileSync(path.join(__dirname, 'check-dep-audit.js'), 'utf8');
  assert.equal(D.DEFAULT_REGISTRY, 'https://registry.npmjs.org');
  assert.ok(src.includes("'--registry=' + registry"), 'audit 调用必须显式带 registry');
  assert.ok(src.includes("process.env.NPM_AUDIT_REGISTRY || DEFAULT_REGISTRY"));
});
