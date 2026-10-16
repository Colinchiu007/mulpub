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
  // targetVersion 是「挂账可闭合」判据要求的字段（check-dep-audit.js 判定 4）。
  // 夹具默认取 patched 的下界，使 ledger() 表示一条合规挂账；不合规形态由专门用例显式覆盖。
  return Object.assign(entry(source, id), { decision: decision || 'upgrade-tracked', note: note === undefined ? '已排期升级' : note, targetVersion: '1.2.3' });
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

function npmJsonOf (ids) {
  const advisories = {};
  ids.forEach((id, n) => {
    advisories[n + 1] = { github_advisory_id: id, module_name: 'm-' + id, severity: 'high', patched_versions: '>=9.9.9', findings: [{ version: '1.0.0', paths: ['apps__desktop>x>m-' + id] }] };
  });
  return { advisories };
}

function writeTempBaseline (name, body) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), name + '-'));
  const file = path.join(dir, 'dep-audit-baseline.json');
  fs.writeFileSync(file, JSON.stringify(body, null, 2) + '\n', 'utf8');
  return { dir, file };
}

test('pip 扫描器缺失时，npm 域的新公告仍必须判红（不得整体短路 return 0）', () => {
  const { dir, file } = writeTempBaseline('dep-npm-only', {
    reviewBy: FUTURE,
    advisories: [ledger('npm', 'GHSA-known')],
  });
  try {
    const out = [];
    const code = D.runCheck({
      baselinePath: file,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push(a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: npmJsonOf(['GHSA-known', 'GHSA-brand-new']) }),
        pip: () => ({ ok: false, error: 'pip-audit 不存在' }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }),
      },
    });
    assert.equal(code, 1);
    assert.ok(out.some((l) => l.includes('NEW_ADVISORY: npm/GHSA-brand-new')),
      'npm 域的新公告必须被报出，实际输出：\n' + out.join('\n'));
    assert.ok(out.some((l) => l.includes('SCANNER_UNAVAILABLE')), '缺失扫描器仍要出声');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})

test('缺失域的挂账条目不得被判成「已不再命中」（防假红）', () => {
  const { dir, file } = writeTempBaseline('dep-pip-skip', {
    reviewBy: FUTURE,
    advisories: [ledger('npm', 'GHSA-known'), ledger('pip', 'PYSEC-keep')],
  });
  try {
    const out = [];
    const code = D.runCheck({
      baselinePath: file,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push(a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: npmJsonOf(['GHSA-known']) }),
        pip: () => ({ ok: false, error: 'pip-audit 不存在' }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }),
      },
    });
    assert.equal(code, 0, '实际输出：\n' + out.join('\n'));
    assert.ok(!out.some((l) => l.includes('RESOLVED_STILL_BASELINED: pip/')),
      '未扫描的域不得被判成基线腐化');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})

test('全部扫描域都不可用 ⇒ 本轮无判据，按失败处理', () => {
  const { dir, file } = writeTempBaseline('dep-none', {
    reviewBy: FUTURE,
    advisories: [ledger('npm', 'GHSA-known')],
  });
  try {
    const out = [];
    const code = D.runCheck({
      baselinePath: file,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push(a.join(' ')),
      runners: {
        npm: () => ({ ok: false, error: 'audit endpoint 不存在' }),
        pip: () => ({ ok: false, error: 'pip-audit 不存在' }),
        'npm-opscenter': () => ({ ok: false, error: 'npm audit 端点不可达' }),
      },
    });
    assert.equal(code, 1);
    assert.ok(out.some((l) => l.includes('无判据')), '必须出声说明是"没有判据"而不是"没有漏洞"');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})

test('--update 在任一扫描器缺失时拒绝写基线，且基线字节不变', () => {
  const { dir, file } = writeTempBaseline('dep-update-guard', {
    reviewBy: FUTURE,
    advisories: [ledger('npm', 'GHSA-known'), ledger('pip', 'PYSEC-keep')],
  });
  try {
    const pristine = fs.readFileSync(file);
    const out = [];
    const code = D.runCheck({
      baselinePath: file,
      isUpdate: true,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push(a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: npmJsonOf(['GHSA-known']) }),
        pip: () => ({ ok: false, error: 'pip-audit 不存在' }),
      },
    });
    assert.equal(code, 1);
    assert.ok(Buffer.compare(pristine, fs.readFileSync(file)) === 0, 'writeBaseline 会把未扫描域抹掉，必须拒写');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})

// ── ops-center 扫描域（①遗留收口）+「挂账必须可闭合」判据（③遗留收口）──

test('npm audit v2 形状解析：按公告逐条展开，GHSA 从 url 取，patched 由 range 上界反推', () => {
  const rep = {
    vulnerabilities: {
      undici: {
        severity: 'high', isDirect: false, path: 'node_modules/undici', effects: ['vitest'], via: [
          { source: 1, url: 'https://github.com/advisories/GHSA-rfgv-xxqx-mfg5', severity: 'high', range: '>=7.0.0 <7.29.1', title: 'A' },
          { source: 2, url: 'https://github.com/advisories/GHSA-w293-vg96-wgc3', severity: 'high', range: '>=7.24.1 <7.29.1', title: 'B' },
          '@vitest/mocker',
        ],
      },
      'no-fix-pkg': { severity: 'moderate', via: [{ source: 3, url: 'https://github.com/advisories/GHSA-aaaa-bbbb-cccc', severity: 'moderate', range: '>=1.0.0', title: 'C' }] },
    },
    metadata: { vulnerabilities: { total: 3 } },
  }
  const out = D.parseNpmAuditV2(rep, 'npm-opscenter')
  assert.equal(out.length, 3, '3 条公告；字符串型 via 项是"指向别的包"，不得算公告')
  assert.deepEqual(out.map((e) => e.id).sort(), ['GHSA-AAAA-BBBB-CCCC', 'GHSA-RFGV-XXQX-MFG5', 'GHSA-W293-VG96-WGC3'])
  const a = out.find((e) => e.id === 'GHSA-RFGV-XXQX-MFG5')
  assert.equal(a.source, 'npm-opscenter', 'source 必须是独立域名，不能借用 pnpm 的 npm 键')
  assert.equal(a.patched, '>=7.29.1', 'range 的上界必须反推成 >=X，否则判据 4 无从比较')
  assert.deepEqual(a.roots, ['undici', 'vitest'])
  assert.equal(out.find((e) => e.id === 'GHSA-AAAA-BBBB-CCCC').patched, '', 'range 没有上界 = 无修复版本 ⇒ 必须是空串')
  for (const e of out) assert.ok(e.module && e.severity, '每条都得可归因')
  assert.deepEqual(D.parseNpmAuditV2({}, 'npm-opscenter'), [], '空报告必须是空数组，不是抛错')
})

test('<0.0.0 归一化：pnpm 的"无修复版本"写法不得被当成可升级目标', () => {
  assert.equal(D.normalizePatched('<0.0.0'), '')
  assert.equal(D.normalizePatched(''), '')
  assert.equal(D.normalizePatched(null), '')
  assert.equal(D.normalizePatched('>=1.20.0'), '>=1.20.0')
  const rep = { advisories: { 1: { github_advisory_id: 'GHSA-UNFIXED', module_name: 'x', severity: 'low', patched_versions: '<0.0.0', findings: [{ paths: ['a>x'] }] } } }
  assert.equal(D.parseNpmAudit(rep)[0].patched, '', 'parseNpmAudit 出口也必须归一')
})

test('域清单与默认 runner 一一对应（登记了域却没接线＝装饰性门禁）', () => {
  assert.ok(D.DOMAINS.includes('npm-opscenter'), 'DOMAINS 必须含 ops-center 域')
  assert.equal(D.OPS_FRONTEND_REL, 'ops-center/frontend')
  const runners = D.createDefaultRunners('https://registry.npmjs.org')
  assert.deepEqual(Object.keys(runners).sort(), [...D.DOMAINS].sort(), 'runner 集与域集必须相等：多一个少一个都算漂移')
  for (const src of D.DOMAINS) assert.equal(typeof runners[src], 'function', '域 ' + src + ' 没有 runner')
  assert.ok(fs.readFileSync(path.join(__dirname, 'check-dep-audit.js'), 'utf8').includes('--omit=dev'),
    'ops-center 域必须与 pnpm 侧的 --prod 同语义（--omit=dev）')
})

test('ops-center 域的新公告必须进判定（证明它被扫到，而不只是被枚举）', () => {
  const { dir, file } = writeTempBaseline('dep-ops-new', { reviewBy: FUTURE, advisories: [] })
  try {
    const out = []
    const code = D.runCheck({
      baselinePath: file,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push(a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: { advisories: {} } }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {
          gotrue: { severity: 'high', via: [{ source: 9, url: 'https://github.com/advisories/GHSA-ZZZZ-ZZZZ-ZZZZ', severity: 'high', range: '>=1.0.0 <2.0.0' }] },
        } } }),
        pip: () => ({ ok: true, json: { dependencies: [] } }),
      },
    })
    assert.equal(code, 1, 'ops-center 域的新公告必须让门禁红')
    assert.ok(out.some((l) => l.includes('NEW_ADVISORY: npm-opscenter/GHSA-ZZZZ-ZZZZ-ZZZZ')), out.join('\n').slice(0, 400))
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('域存在但 runner 缺失 ⇒ 必须点名，不得静默当成"该域扫过且干净"', () => {
  const { dir, file } = writeTempBaseline('dep-ops-norunner', {
    reviewBy: FUTURE,
    advisories: [ledger('npm', 'GHSA-known')],
  })
  try {
    const out = []
    const code = D.runCheck({
      baselinePath: file,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push(a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: npmJsonOf(['GHSA-known']) }),
        pip: () => ({ ok: true, json: { dependencies: [] } }),
      },
    })
    const txt = out.join('\n')
    assert.ok(txt.includes('DOMAIN_NOT_WIRED'), '接线断了必须给硬失败码，而不是被 SCANNER_UNAVAILABLE 吸收：\n' + txt.slice(0, 400));
    assert.ok(!txt.includes('SCANNER_UNAVAILABLE'), '接线断了是代码事实，不得伪装成扫描器抖动（两类出口必须可区分）');
    assert.equal(code, 1, '域在清单里却没接线 = 覆盖面窄于声明 ⇒ fail closed（这不同于扫描器抖动）');
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('upgrade-tracked 的账必须能闭合：缺目标版本 / 目标低于修复下界 / 形状不可解析 一律拦', () => {
  const mk = (over) => Object.assign({ source: 'npm', id: 'GHSA-X', module: 'm', patched: '>=4.3.2', decision: 'upgrade-tracked', note: 'n' }, over)
  assert.ok(String(D.checkTargetEscapes(mk({ targetVersion: '4.3.1' }))).includes('低于修复下界'), '升到 4.3.1 仍然命中公告')
  assert.equal(D.checkTargetEscapes(mk({ targetVersion: '4.3.2' })), null, '恰好落在修复版 = 通过')
  assert.equal(D.checkTargetEscapes(mk({ targetVersion: '5.0.0' })), null, '高于下界 = 通过')
  assert.ok(String(D.checkTargetEscapes(mk({}))).includes('缺 targetVersion'))
  assert.ok(String(D.checkTargetEscapes(mk({ targetVersion: 'latest' }))).includes('x.y.z 字面量'), '区间/通配不算承诺')
  assert.ok(String(D.checkTargetEscapes(mk({ targetVersion: '4.3.2', patched: '' }))).includes('patched 为空'), '无修复版本却挂 upgrade-tracked = 自相矛盾')
  assert.ok(String(D.checkTargetEscapes(mk({ targetVersion: '4.3.2', patched: '4.x' }))).includes('解析不出'), '解析不了的形状一律 fail closed')
})

test('判定 4 必须接进 evaluate，而不是只导出一个没人调用的纯函数', () => {
  const found = [entry('npm', 'GHSA-A', { patched: '>=1.5.0' })]
  const bad = { reviewBy: FUTURE, advisories: [Object.assign({}, found[0], { decision: 'upgrade-tracked', note: 'n', targetVersion: '1.4.0' })] }
  const r1 = D.evaluate(bad, found, '2026-10-05', ['npm'])
  assert.ok(r1.violations.some((v) => v.startsWith('DECISION_CONTRADICTS_PATCHED:')), JSON.stringify(r1.violations))
  const good = { reviewBy: FUTURE, advisories: [Object.assign({}, found[0], { decision: 'upgrade-tracked', note: 'n', targetVersion: '1.5.0' })] }
  assert.deepEqual(D.evaluate(good, found, '2026-01-01', ['npm']).violations, [])
  const noFix = { reviewBy: FUTURE, advisories: [Object.assign({}, found[0], { patched: '', decision: 'no-fix-available', note: 'n' })] }
  assert.deepEqual(D.evaluate(noFix, [Object.assign({}, found[0], { patched: '' })], '2026-01-01', ['npm']).violations, [],
    'no-fix-available 允许 patched 为空 —— 判据只约束"待升级"这一类')
})

test('入库基线自洽：每条 upgrade-tracked 都带可闭合的 targetVersion（防迁移后再次腐化）', () => {
  const b = JSON.parse(fs.readFileSync(path.join(__dirname, 'dep-audit-baseline.json'), 'utf8'))
  const ut = b.advisories.filter((e) => e.decision === 'upgrade-tracked')
  assert.ok(ut.length >= 20, 'upgrade-tracked 不得是空遍历：' + ut.length)
  const bad = ut.map((e) => D.checkTargetEscapes(e)).filter(Boolean)
  assert.deepEqual(bad, [], '存在闭不了环的挂账：\n' + bad.join('\n'))
  assert.ok(b.advisories.some((e) => e.decision === 'no-fix-available'), '至少要有一条"确无修复版本"的对照，否则上面的边界没被测到')
  assert.ok(!b.advisories.some((e) => e.decision !== 'upgrade-tracked' && e.targetVersion), '非 upgrade-tracked 的条目不该带目标版本承诺')
})
// ---- QM-6 外部评审后的补充用例（2026-10-05）：每条都以「旧实现会红」为准绳写。 ----

test('patchedFromRange 多族规格：每个 < 上界都必须收进来（旧实现 .exec 只取第一个，第二族被静默丢掉）', () => {
  assert.equal(D.patchedFromRange('>=7.0.0 <7.29.1'), '>=7.29.1', '单族照旧')
  assert.equal(D.patchedFromRange('>=1.0.0 <1.2.3, >=2.0.0 <2.1.5'), '>=1.2.3, >=2.1.5', '两族必须都得')
  assert.equal(D.patchedFromRange('<1.2.3, <1.2.3, <2.0.0'), '>=1.2.3, >=2.0.0', '重复上界要去重')
  assert.equal(D.patchedFromRange('>=1.0.0'), '', '没有 < 上界就是没有修复版本，不得凭空造下界')
  assert.equal(D.patchedFromRange(''), '', '空串照旧返回空')
})

test('v2 解析跨族 range 时 patched 必须带全两段（否则下游判据看不见第二族）', () => {
  const rows = D.parseNpmAuditV2({ vulnerabilities: {
    foo: { severity: 'high', via: [{ source: 11, url: 'https://github.com/advisories/GHSA-TTWW-TTWW-TTWW', severity: 'high', range: '>=1.0.0 <1.2.3, >=2.0.0 <2.1.5' }] },
  } }, 'npm-opscenter')
  assert.equal(rows.length, 1)
  assert.equal(rows[0].patched, '>=1.2.3, >=2.1.5', 'range 有两族 ⇒ patched 必须有两段')
})

test('多段 patched 的目标必须逐段都逃过（旧实现只比第一段，2.0.5 会被误判成可闭合）', () => {
  const mk = (tv) => ({
    reviewBy: FUTURE,
    advisories: [Object.assign(entry('npm', 'GHSA-TTWW-TTWW-TTWW'), { decision: 'upgrade-tracked', note: '已排期', patched: '>=1.2.3, >=2.1.5', targetVersion: tv })],
  })
  const found = [entry('npm', 'GHSA-TTWW-TTWW-TTWW')]
  const r1 = D.evaluate(mk('2.0.5'), found, '2026-10-05', ['npm'])
  assert.equal(r1.violations.length, 1, '2.0.5 高于第一段下界但仍在第二族漏洞区间里 ⇒ 必须判账闭不了：' + JSON.stringify(r1.violations))
  assert.ok(r1.violations[0].includes('>=2.1.5'), '文案必须点名是哪一段没过，否则读日志的人只会去查第一段：' + r1.violations[0])
  const r2 = D.evaluate(mk('2.1.5'), found, '2026-10-05', ['npm'])
  assert.deepEqual(r2.violations, [], '逐段相等 = 恰好落在最高那条修复线上，通过')
  const r3 = D.evaluate(mk('3.0.0'), found, '2026-10-05', ['npm'])
  assert.deepEqual(r3.violations, [], '高于所有段 ⇒ 通过')
})

test('解析器与域一一对应；登记了域却没有解析器 ⇒ 按接线断了 fail closed（不得 else 兜底猜形状）', () => {
  assert.deepEqual(Object.keys(D.PARSERS).sort(), [...D.DOMAINS].sort(), 'PARSER 集与域集必须相等：多一个少一个都算漂移')
  const { dir, file } = writeTempBaseline('dep-parser-gap', { reviewBy: FUTURE, advisories: [] })
  try {
    const out = []
    const parsers = Object.assign({}, D.PARSERS)
    delete parsers['npm-opscenter']
    const code = D.runCheck({
      baselinePath: file,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push(a.join(' ')),
      parsers,
      runners: {
        npm: () => ({ ok: true, json: { advisories: {} } }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: { gotrue: { severity: 'high', via: [{ source: 9, url: 'https://github.com/advisories/GHSA-ZZZZ-ZZZZ-ZZZZ', severity: 'high', range: '>=1.0.0 <2.0.0' }] } } } }),
        pip: () => ({ ok: true, json: { dependencies: [] } }),
      },
    })
    const txt = out.join('\n')
    assert.equal(code, 1, '有 runner 却没登记解析器 ⇒ 覆盖面窄于声明，必须红')
    assert.ok(txt.includes('DOMAIN_NOT_WIRED'), '必须走接线断了的硬失败码：' + txt.slice(0, 300))
    assert.ok(txt.includes('npm-opscenter(缺解析器)'), '必须点名是「缺解析器」而不是「缺 runner」，两类成因要可区分：' + txt.slice(0, 300))
    assert.ok(!txt.includes('GHSA-ZZZZ-ZZZZ-ZZZZ'), '该域不得被静默按另一种形状解析后当成「扫过且干净」')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

test('绿文必须披露 prod 口径（--omit=dev 的盲区对 CI 读者不可见，就是假完整）', () => {
  const { dir, file } = writeTempBaseline('dep-green-scope', {
    reviewBy: FUTURE,
    advisories: [ledger('npm', 'GHSA-KNOWN')],
  })
  try {
    const out = []
    const code = D.runCheck({
      baselinePath: file,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push(a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: { advisories: { 1: { github_advisory_id: 'GHSA-KNOWN', module_name: 'm', severity: 'high', patched_versions: '>=1.2.3', findings: [{ version: '1.0.0', paths: ['apps__desktop>m'] }] } } } }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }),
        pip: () => ({ ok: true, json: { dependencies: [] } }),
      },
    })
    assert.equal(code, 0, out.join('\n').slice(0, 400))
    const green = out.find((l) => l.includes('✅'))
    assert.ok(green, '零违规必须打绿文')
    assert.ok(green.includes('--omit=dev'), '绿文必须让 CI 读者知道 dev 依赖不在判据面内：' + green)
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

// ─────────────────────────────────────────────────────────────────────────────
// 公告 ID 迁移（同一条公告换号）：解析层收集 aliases + 判定层按别名认同
//
// 现场（2026-10-16）：pip-audit 对 python-jose 3.5.0 报的 id 从 CVE-2026-85394 变成
// PYSEC-2026-4298（旧号降为 aliases 成员），而基线仍以旧号为键 ⇒ 门禁同时打出
// NEW_ADVISORY 与 RESOLVED_STILL_BASELINED 两条互相矛盾的结论，
// **而安全结论一个字都没变**（同一条公告、同一版本、同一「无修复版本」）。
//
// 逃逸原因：既有夹具的公告 id 全都是稳定的，从来没有「同一条公告换号」这个形状。
// ─────────────────────────────────────────────────────────────────────────────

test('pip-audit JSON 解析：收集 aliases，去重且剔除主 id 自身', () => {
  const rows = D.parsePipAudit({
    dependencies: [
      {
        name: 'python-jose',
        version: '3.5.0',
        vulns: [{ id: 'PYSEC-2026-4298', aliases: ['GHSA-3qf3-8w2g-rqmx', 'CVE-2026-85394', 'PYSEC-2026-4298'], fix_versions: [] }],
      },
      { name: 'no-alias', version: '1.0', vulns: [{ id: 'PYSEC-2', fix_versions: [] }] },
    ],
  });
  const jose = rows.find((r) => r.id === 'PYSEC-2026-4298');
  assert.deepEqual(jose.aliases, ['CVE-2026-85394', 'GHSA-3qf3-8w2g-rqmx'], 'aliases 需去重、剔除主 id 自身，并排序保证确定性');
  assert.deepEqual(rows.find((r) => r.id === 'PYSEC-2').aliases, [], '没有 aliases 字段时必须是 []，不能是 undefined');
});

test('同公告换号（基线旧号 → 扫描新号）不双报，只报 ID 迁移', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('pip', 'CVE-2026-85394', 'not-exploitable', '人工风险分析：三处 algorithms 显式限定')] };
  const found = [entry('pip', 'PYSEC-2026-4298', { aliases: ['CVE-2026-85394'] })];
  const { violations, migrations } = D.evaluate(base, found, FUTURE);
  assert.equal(violations.filter((v) => v.includes('NEW_ADVISORY')).length, 0, '换号不是新增公告');
  assert.equal(violations.filter((v) => v.includes('RESOLVED_STILL_BASELINED')).length, 0, '换号不是公告失效');
  assert.equal(migrations.length, 1, '必须报出迁移，不能静默');
  assert.deepEqual({ source: migrations[0].source, from: migrations[0].from, to: migrations[0].to }, { source: 'pip', from: 'CVE-2026-85394', to: 'PYSEC-2026-4298' });
  assert.equal(migrations[0].matchedVia, 'CVE-2026-85394', '裁决 i1：必须带认领证据');
  assert.equal(migrations[0].viaAlias, true, '裁决 i1：必须标明经别名认领');
});

test('同公告换号方向相反（基线新号 → 扫描旧号）同样不双报', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('pip', 'PYSEC-2026-4298')] };
  const found = [entry('pip', 'CVE-2026-85394', { aliases: ['PYSEC-2026-4298'] })];
  const { violations, migrations } = D.evaluate(base, found, FUTURE);
  assert.equal(violations.length, 0);
  assert.equal(migrations.length, 1);
  assert.deepEqual({ source: migrations[0].source, from: migrations[0].from, to: migrations[0].to }, { source: 'pip', from: 'PYSEC-2026-4298', to: 'CVE-2026-85394' });
  assert.equal(migrations[0].matchedVia, 'PYSEC-2026-4298', '认领证据 = 被认领的那个基线键的主 id');
  assert.equal(migrations[0].viaAlias, true);
});

test('对偶：别名匹配不得把真正的新公告一起放过', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('pip', 'CVE-old')] };
  const found = [
    entry('pip', 'PYSEC-migrated', { aliases: ['CVE-old'] }),
    entry('pip', 'PYSEC-really-new'),
  ];
  const { violations } = D.evaluate(base, found, FUTURE);
  assert.equal(
    violations.filter((v) => v.includes('NEW_ADVISORY') && v.includes('PYSEC-really-new')).length, 1,
    '无别名关联的新公告必须照红 —— 该锁若整体放过，等于把门禁改松');
  assert.equal(violations.filter((v) => v.includes('PYSEC-migrated')).length, 0);
});

test('别名匹配不得跨 source：pip 的 alias 不能认领 npm 的同名 id', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('npm', 'X-1')] };
  const found = [entry('pip', 'Y-2', { aliases: ['X-1'] })];
  const { violations, migrations } = D.evaluate(base, found, FUTURE);
  assert.equal(violations.filter((v) => v.includes('NEW_ADVISORY')).length, 1, 'pip 的新条目照红');
  assert.equal(violations.filter((v) => v.includes('RESOLVED_STILL_BASELINED')).length, 1, 'npm 的旧条目照判失效');
  assert.deepEqual(migrations, [], '跨 source 不算同一条公告');
});

test('--update 跨 ID 迁移必须保留人工结论（decision/note），不得重置成 TODO', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('pip', 'CVE-2026-85394', 'not-exploitable', '人工风险分析原文')] };
  const found = [entry('pip', 'PYSEC-2026-4298', { aliases: ['CVE-2026-85394'] })];
  const tmp = path.join(os.tmpdir(), 'dep-audit-migration-' + process.pid + '.json');
  try {
    const body = D.writeBaseline(found, base, tmp);
    const item = body.advisories.find((a) => a.module === 'm');
    assert.equal(item.id, 'PYSEC-2026-4298', '键要跟着扫描结果迁移到新号');
    assert.equal(item.decision, 'not-exploitable', '人工结论必须沿用 —— 迁移不得把风险分析冲掉');
    assert.equal(item.note, '人工风险分析原文', '人工 note 必须沿用');
    assert.deepEqual(item.aliases, ['CVE-2026-85394'], 'aliases 要落盘，供下一轮继续双向认同');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('迁移不放宽既有校验：沿用过来的 upgrade-tracked 仍受 patched 约束', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('pip', 'CVE-old', 'upgrade-tracked', '已排期升级')] };
  const found = [entry('pip', 'PYSEC-migrated', { aliases: ['CVE-old'], patched: '' })];
  const tmp = path.join(os.tmpdir(), 'dep-audit-migration-check-' + process.pid + '.json');
  try {
    const body = D.writeBaseline(found, base, tmp);
    const { violations } = D.evaluate(body, found, FUTURE);
    assert.equal(
      violations.filter((v) => v.includes('DECISION_CONTRADICTS_PATCHED')).length, 1,
      '别名匹配只影响「这条公告是否已在账上」，decision/patched 校验一条都不能少');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('对偶：公告库把同一条公告的两个号都报出来时，不得报出反向伪迁移', () => {
  // 现场依据：公告库确实会把一条公告的多个 id 分别列出（本轮 pip-audit 给的就是
  // 主 id + aliases 两个号）。此时 found 里存在与基线同键的条目，
  // 按 found 的排序谁先谁后**不该**决定"迁移方向" —— 所以有直接命中就不报迁移。
  const baseNew = { reviewBy: FUTURE, advisories: [ledger('pip', 'PYSEC-2026-4298')] };
  const both = [
    entry('pip', 'CVE-2026-85394', { aliases: ['PYSEC-2026-4298'] }),
    entry('pip', 'PYSEC-2026-4298', { aliases: ['CVE-2026-85394'] }),
  ];
  const r1 = D.evaluate(baseNew, both, FUTURE);
  assert.equal(r1.violations.length, 0, '两个号指向同一条公告，不该有任何违规');
  assert.deepEqual(r1.migrations, [], '基线键在 found 里有直接命中 ⇒ 不存在迁移，更不该报「新号 → 旧号」的反向迁移');
  assert.equal(r1.ledgerCount, 1);

  const baseOld = { reviewBy: FUTURE, advisories: [ledger('pip', 'CVE-2026-85394')] };
  const r2 = D.evaluate(baseOld, both, FUTURE);
  assert.equal(r2.violations.length, 0);
  assert.deepEqual(r2.migrations, [], '同一件事两个方向都成立时，静默比报一个可能反的迁移更诚实');
});

// ─────────────────────────────────────────────────────────────────────────────
// QM-6 评审裁决后新增的回归锁（critic i1 / i2，均已实测证实为真缺陷）
// ─────────────────────────────────────────────────────────────────────────────

const path2 = require('node:path');

test('裁决 i1：基线双份（旧 bug 一增一失留下两份）时，--update 不得丢掉任一份的人工结论', () => {
  // 实测现场：把同一条公告在基线里写两份（旧号 + 新号各一份，人工 note 写在旧号那份），
  // found 只报新号 ⇒ 修复前 --update 只认领新号那条，旧号那份连同它的人工结论
  // 一起被全量重写丢掉 —— 而那正是「换号前那一轮」写的复核依据。
  //
  // 注意口径：writeBaseline 的语义是「以 found 为准全量重写」（自愈式清账），
  // 不为本 bug 改变它 —— 那样会把 --update 变成"永不删条目"，与登记边界冲突。
  // 所以判据是**结论不丢**（合并到保留的那条），不是"条目数不变"。
  const base = { reviewBy: FUTURE, advisories: [
    ledger('pip', 'PYSEC-2026-4298', 'not-exploitable', '【新号那份】三处 algorithms 显式限定'),
    ledger('pip', 'CVE-2026-85394', 'not-exploitable', '【旧号那份】另一轮的人工结论'),
  ] };
  const found = [entry('pip', 'PYSEC-2026-4298', { aliases: ['CVE-2026-85394'] })];
  const tmp = path.join(os.tmpdir(), 'dep-audit-dup-' + process.pid + '.json');
  try {
    const body = D.writeBaseline(found, base, tmp);
    const kept = body.advisories.filter((a) => a.module === 'm');
    assert.equal(kept.length, 1, 'writeBaseline 以 found 全量重写，双份合并成一条（既有语义不变）');
    // 关键判据：**两份的人工 note 都必须还在**，一条都不能丢
    assert.ok(/新号那份/.test(String(kept[0].note)), '新号那份的 note 必须保住：' + String(kept[0].note));
    assert.ok(/旧号那份/.test(String(kept[0].note)), '旧号那份的 note 必须保住（修复前它被整体丢弃）：' + String(kept[0].note));
    assert.ok(/已合并/.test(String(kept[0].note)), '必须标明这是合并产物，不能让读者以为只有一份结论');
    // 双份形态下 evaluate 也不得对旧键报 RESOLVED：它不是"已不再命中"，是被 aliases 覆盖了
    const { violations, migrations } = D.evaluate(base, found, FUTURE, new Set(['pip']));
    assert.equal(violations.filter((v) => v.includes('RESOLVED_STILL_BASELINED')).length, 0,
      '旧键被新号那条通过 aliases 覆盖 ⇒ 不得再诱导人去删它');
    assert.equal(migrations.length, 0, '双份都在账上时不存在"迁移"，两个号都是活的');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('裁决 i2：有迁移时不得打印「基线与现实一致」——那正是欠账所述的"训练人忽略门禁"绿文版', () => {
  // 实测现场：基线单键旧号 + found 新号 ⇒ violations=0 而基线键仍是旧号。
  // 修复前 main() 走绿文分支打印「基线与现实一致且结论完整」，CI 读者据此以为已对齐、
  // 不去跑 --update ⇒ stale 基线被永久合法化（比红文更危险：红文至少吵）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-audit-i2-'));
  const bp = path.join(dir, 'baseline.json');
  fs.writeFileSync(bp, JSON.stringify({ reviewBy: FUTURE, advisories: [ledger('pip', 'CVE-2026-85394', 'not-exploitable', '人工结论')] }, null, 2), 'utf8');
  const out = [];
  try {
    const code = D.runCheck({
      registry: 'npm',
      baselinePath: bp,
      log: (...a) => out.push(a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: { advisories: {} } }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }),
        pip: () => ({ ok: true, json: { dependencies: [{ name: 'python-jose', version: '3.5.0', vulns: [{ id: 'PYSEC-2026-4298', aliases: ['CVE-2026-85394', 'GHSA-3qf3-8w2g-rqmx'], fix_versions: [] }] }] } }),
      },
    });
    const green = out.find((l) => l.includes('基线与现实一致'));
    const hint = out.find((l) => l.includes('--update') && l.includes('ID_MIGRATED'));
    assert.equal(code, 0, '迁移不阻断（登记边界：不引入新违规类型）。实际输出：\n' + out.join('\n'));
    assert.ok(!green, '有迁移而基线键仍是旧号时，不得打印「基线与现实一致且结论完整」——实测该形态 violations=0 而键未迁，这句话自相矛盾：' + (green || ''));
    assert.ok(hint, '必须明确提示迁移尚未落盘、需要跑 --update，而不是用一句"一致"盖过去。实际输出：\n' + out.join('\n'));
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

// ─────────────────────────────────────────────────────────────────────────────
// QM-6 第二轮裁决后新增的回归锁（critic i1 / i2 / i3，均已实测证实为真缺陷）
// ─────────────────────────────────────────────────────────────────────────────

test('裁决 i1：别名认领必须带上证据字段——否则 alias 撞车会把真新增吞成"迁移"', () => {
  // 实测现场：基线有 CVE-OLD，found 是一条与它**无关的真新公告** PYSEC-NEW，
  // 仅因 aliases 误标含 CVE-OLD ⇒ 修复前 evaluate 输出 violations=0 + 1 条迁移，
  // 且输出里没有任何字段说明"这条是经别名认领的"，审计无法区分换号与撞车。
  const base = { reviewBy: FUTURE, advisories: [ledger('pip', 'CVE-OLD', 'not-exploitable', '人工结论')] };
  const found = [entry('pip', 'PYSEC-NEW', { aliases: ['CVE-OLD'] })];
  const { violations, migrations } = D.evaluate(base, found, FUTURE, new Set(['pip']));
  assert.equal(violations.length, 0, '别名认领仍不阻断（登记边界）');
  assert.equal(migrations.length, 1);
  // 关键判据：迁移记录必须带"经哪个 id 认领"的证据，否则审计分不清换号与撞车
  assert.equal(migrations[0].matchedVia, 'CVE-OLD', '必须记录是经哪个 id 认领的');
  assert.equal(migrations[0].viaAlias, true, '必须标明这是经别名（非主键）认领的');
});

test('裁决 i2：两个新键争同一条旧基线 ⇒ 必须报碰撞，且 --update 不得复制成双份', () => {
  // 实测现场：基线 CVE-OLD 一条，found 的 PYSEC-A 与 PYSEC-B 的 aliases 都含 CVE-OLD。
  // 修复前：evaluate 只报 1 条迁移、B 静默通过；writeBaseline 把同一旧行复制成两行
  // （同 note、不同 id）⇒ 正是欠账条目所述"同一条公告在基线里留两份"的双份复发。
  const base = { reviewBy: FUTURE, advisories: [ledger('pip', 'CVE-OLD', 'not-exploitable', '人工结论')] };
  const found = [
    entry('pip', 'PYSEC-A', { aliases: ['CVE-OLD'] }),
    entry('pip', 'PYSEC-B', { aliases: ['CVE-OLD'] }),
  ];
  const { violations } = D.evaluate(base, found, FUTURE, new Set(['pip']));
  assert.equal(violations.filter((v) => v.includes('MIGRATION_COLLISION')).length, 1,
    '多个 found 争同一条基线键必须出声（不阻断，但不得静默）');
  assert.ok(violations.some((v) => v.includes('PYSEC-A') && v.includes('PYSEC-B')),
    '碰撞提示必须点名两个争抢方');
  const tmp = path.join(os.tmpdir(), 'dep-audit-collision-' + process.pid + '.json');
  try {
    const body = D.writeBaseline(found, base, tmp);
    const kept = body.advisories.filter((a) => a.module === 'm');
    assert.equal(kept.length, 1, '不得把同一旧行复制成多份 —— 那正是"一增一失"的双份复发形态');
  } finally { fs.rmSync(tmp, { force: true }); }
});

test('裁决 i3：基线条目已存的 aliases 必须参与认领（"双向认同"不能是单向）', () => {
  // 实测现场：基线条目 PYSEC-NEW 已存 aliases=[CVE-OLD]（上一轮 --update 落盘的形态），
  // 下一轮 found 只报 CVE-OLD 且不带 aliases。修复前：NEW_ADVISORY(CVE-OLD) +
  // RESOLVED_STILL_BASELINED(PYSEC-NEW) —— 原事故在公告库清理 aliases 后原样复现。
  const base = { reviewBy: FUTURE, advisories: [Object.assign(ledger('pip', 'PYSEC-NEW', 'not-exploitable', '人工结论'), { aliases: ['CVE-OLD'] })] };
  const found = [entry('pip', 'CVE-OLD')];
  const { violations, migrations } = D.evaluate(base, found, FUTURE, new Set(['pip']));
  assert.equal(violations.filter((v) => v.includes('NEW_ADVISORY')).length, 0,
    '基线条目已存的 aliases 必须参与认领，不得把旧号当新公告');
  assert.equal(violations.filter((v) => v.includes('RESOLVED_STILL_BASELINED')).length, 0,
    '同理不得把新号判成"已不再命中"');
  assert.equal(migrations.length, 1, '该形态报一条迁移（方向：PYSEC-NEW → CVE-OLD）');
  assert.equal(migrations[0].from, 'PYSEC-NEW');
  assert.equal(migrations[0].to, 'CVE-OLD');
  assert.equal(migrations[0].matchedVia, 'PYSEC-NEW', '证据字段同样要带（= 被认领的基线键主 id）');
});
