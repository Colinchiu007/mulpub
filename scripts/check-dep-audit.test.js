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

test('同一 GHSA 的多个修复族：patched 必须**合并**（不是覆盖），且与族的先后顺序无关', () => {
  // 动因（2026-10-24 实测）：npm/pnpm 对一个 GHSA 的多条易感区间（不同版本线各有修复版）
  // 返回**多条** advisory，共享同一个 github_advisory_id。pnpm 域解析器原先是**覆盖**，
  // ⇒ 记录下来的下界取决于响应里各族的先后顺序 ⇒ 非确定 ⇒ 与人工 targetVersion 配对时随机判红。
  // 实测现场：GHSA-3jxr-9vmj-r5cp 的 patched 在 '>=1.1.16' 与 '>=5.0.7' 之间来回跳，
  // 而人写的 targetVersion 是 1.1.16 ⇒ 刷成 '>=5.0.7' 时当场 DECISION_CONTRADICTS_PATCHED。
  const family = (patched, version, path) => ({
    github_advisory_id: 'GHSA-multi', module_name: 'brace-expansion', severity: 'high',
    patched_versions: patched, findings: [{ version, paths: [path] }],
  });
  const forward = D.parseNpmAudit({ advisories: {
    1: family('>=1.1.16', '1.1.15', 'apps__desktop>minimatch>brace-expansion'),
    2: family('>=5.0.7', '5.0.6', '.>camofox>minimatch>brace-expansion'),
  } });
  const backward = D.parseNpmAudit({ advisories: {
    1: family('>=5.0.7', '5.0.6', '.>camofox>minimatch>brace-expansion'),
    2: family('>=1.1.16', '1.1.15', 'apps__desktop>minimatch>brace-expansion'),
  } });
  assert.equal(forward.length, 1, '同一 GHSA 的多个族必须收成一条');
  assert.equal(forward[0].patched, '>=1.1.16, >=5.0.7', '两个族的修复下界必须合并成多段');
  assert.equal(
    backward[0].patched, forward[0].patched,
    '族的先后顺序**不得**改变 patched 的取值（这正是"覆盖"语义留下的那个洞）',
  );
  // 数值排序（不是字典序）：>=10.2.0 必须排在 >=5.0.7 后面，否则基线 diff 会随顺序抖动。
  const big = D.parseNpmAudit({ advisories: {
    1: family('>=5.0.7', '5.0.6', 'a>minimatch>brace-expansion'),
    2: family('>=10.2.0', '10.1.0', 'b>minimatch>brace-expansion'),
  } });
  assert.equal(big[0].patched, '>=5.0.7, >=10.2.0', '多段必须按版本号数值升序（字典序会把 >=10.2.0 排到前面）');
  // 重复的族（同一 GHSA 同一修复版被报两次）必须去重，不能拼成 '>=1.1.16, >=1.1.16'。
  const dup = D.parseNpmAudit({ advisories: {
    1: family('>=1.1.16', '1.1.15', 'a>minimatch>brace-expansion'),
    2: family('>=1.1.16', '1.1.15', 'b>minimatch>brace-expansion'),
  } });
  assert.equal(dup[0].patched, '>=1.1.16', '同一修复版重复出现必须去重');
});

test('合并口径：任一族没有修复版本 ⇒ 合并结果也是空（保守：整本账无解）', () => {
  // 一条线无解 ⇒ 整本账无解 ⇒ 保守侧（no-fix-available）才是诚实答案；
  // 写成 '>=1.2.3' 会让人以为"升上去就闭账"，而那条线永远闭不上。
  const family = (patched) => ({
    github_advisory_id: 'GHSA-nofix', module_name: 'x', severity: 'high',
    patched_versions: patched, findings: [{ version: '1.0.0', paths: ['a>x'] }],
  });
  assert.equal(D.parseNpmAudit({ advisories: { 1: family('<0.0.0'), 2: family('>=1.2.3') } })[0].patched, '');
  assert.equal(D.parseNpmAudit({ advisories: { 1: family('>=1.2.3'), 2: family('<0.0.0') } })[0].patched, '');
  // 族内本身无修复版本（单族）仍归一成空串（既有语义不变）。
  assert.equal(D.parseNpmAudit({ advisories: { 1: family('<0.0.0') } })[0].patched, '');
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

test('基线腐化：某域本轮**仍有产出**、而其中一条公告不再命中 ⇒ 必须清账', () => {
  // 这条是 RESOLVED 路径的正控，夹具刻意让 npm 域本轮扫出别的东西（GHSA-live）——
  // 只有「该域确实在测量且有产出」时，「某条不再命中」才是可信的已修信号（2026-10-22 口径改造）。
  const base = { reviewBy: FUTURE, advisories: [ledger('npm', 'GHSA-gone'), ledger('npm', 'GHSA-live'), ledger('pip', 'PYSEC-x')] };
  const { violations } = D.evaluate(base, [entry('npm', 'GHSA-live'), entry('pip', 'PYSEC-x')], FUTURE);
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

test('--update 产物：新增条目由机器**预填机械承诺**（不再一律 TODO），且可复现', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'depaudit-'));
  try {
    const p = path.join(dir, 'bl.json');
    const old = { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-1'), { note: '保留原结论' })] };
    const found = [entry('npm', 'GHSA-1'), entry('npm', 'GHSA-2'), entry('pip', 'PYSEC-3')];
    const first = D.writeBaseline(found, old, p, { today: '2026-10-24' });
    const text1 = fs.readFileSync(p, 'utf8');
    D.writeBaseline(found.slice().reverse(), old, p, { today: '2026-10-24' });
    assert.equal(fs.readFileSync(p, 'utf8'), text1, '写入顺序不得影响产物（否则 diff 噪声）');
    assert.deepEqual(first.advisories.map((a) => a.source + '/' + a.id), ['npm/GHSA-1', 'npm/GHSA-2', 'pip/PYSEC-3']);
    assert.equal(first.advisories[0].note, '保留原结论', '已有条目的结论必须保留');
    assert.equal(first.reviewBy, FUTURE);
    // 新条目：机器预填「已登记、待升级」+ 机械算出的承诺版本 + 到期日
    const fresh = first.advisories[1];
    assert.equal(fresh.decision, 'upgrade-tracked', '新条目不再一律 TODO（那会让门禁在涌入期长期红、全仓 BLOCKED）');
    assert.equal(fresh.targetVersion, '1.2.3', '承诺版本取公告修复下界');
    assert.equal(fresh.dueBy, '2026-11-07', '到期日 = 登记日 + 预填宽限期（14 天）');
    assert.equal(fresh.prefilled, true, '必须标记为机器预填（机器只托管自己预填过的条目）');
    assert.ok(/机械登记/.test(fresh.note), 'note 必须写明「机械登记、未经可利用性评估」：' + fresh.note);
    // 预填后新条目**不判红**（这正是「机器预填」的目的：涌入期不再把全仓挡死）
    const { violations } = D.evaluate(first, found, '2026-10-24');
    assert.deepEqual(violations.filter((v) => v.startsWith('BASELINE_META_INVALID')), [],
      '预填条目不得再被判「无结论挂账」：' + JSON.stringify(violations));
    // 而「无修复版本」的条目**不预填** ⇒ 保持 TODO ⇒ 门禁照红等人做真正的风险判断
    const noFix = D.writeBaseline([Object.assign(entry('npm', 'GHSA-NOFIX'), { patched: '' })], { reviewBy: FUTURE, advisories: [] }, p, { today: '2026-10-24' });
    assert.equal(noFix.advisories[0].decision, 'TODO', '推不出承诺就不预填（宁可等人判断，也不给个错的承诺）');
    assert.equal(noFix.advisories[0].dueBy, undefined);
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
    // patched_versions 必须与 ledger() 的 targetVersion('1.2.3') 同族 ——
    // 否则夹具**自相矛盾**（扫描说 >=9.9.9、台账说 >=1.2.3），而门禁现在拿**扫描现值**校验承诺
    // ⇒ 这种矛盾会当场变成一条假红。此前门禁拿基线自己校验自己，所以这类不一致一直没被发现。
    advisories[n + 1] = { github_advisory_id: id, module_name: 'm-' + id, severity: 'high', patched_versions: '>=1.2.3', findings: [{ version: '1.0.0', paths: ['apps__desktop>x>m-' + id] }] };
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
  // 地板是**反空转护栏**（至少要有几条 upgrade-tracked，让下面的 checkTargetEscapes 真的被遍历到），
  // **不是「基线规模目标」**。
  // 为什么从 20 改成 5（2026-10-24）：这行原本写死 `>= 20`，而那个 20 是 **#2904 引入本用例时
  // 基线的快照规模**（当时基线 25 条、upgrade-tracked 24 条）。⇒ 基线**会随公告被真的解掉而缩小**
  // （2026-10-24：24 → 17，upgrade-tracked 15 条）⇒ 把地板写成当时的快照值，等于
  // **「把债真的清掉」这个正确动作反而判红**（本片正是去解 7 条公告、把 7 条已失效的挂账清掉的）。
  // ⇒ 地板改成一个小而稳定的下界：只要还有条目在被遍历，这组断言就不是空转。
  const MIN_UPGRADE_TRACKED = 5
  assert.ok(ut.length >= MIN_UPGRADE_TRACKED, 'upgrade-tracked 不得是空遍历：' + ut.length)
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
  // 校验用的是**扫描现值**的 patched ⇒ found 必须带同一份多段事实
  const found = [entry('npm', 'GHSA-TTWW-TTWW-TTWW', { patched: '>=1.2.3, >=2.1.5' })]
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
  // 2026-10-22 口径改造随动：夹具原先让 npm 域本轮**完全不产出**，那在新口径下是
  // 「未证实」（UNVERIFIED_ZERO_SCAN）而不是「已修」，本条要测的 RESOLVED 路径就不成立了。
  // 补一条 npm 的活条目让该域确实有产出——本条测的仍是跨 source 别名不认领，不是零产出。
  const base = { reviewBy: FUTURE, advisories: [ledger('npm', 'X-1'), ledger('npm', 'X-live')] };
  const found = [entry('npm', 'X-live'), entry('pip', 'Y-2', { aliases: ['X-1'] })];
  const { violations, migrations } = D.evaluate(base, found, FUTURE);
  assert.equal(violations.filter((v) => v.includes('NEW_ADVISORY')).length, 1, 'pip 的新条目照红');
  assert.equal(violations.filter((v) => v.includes('RESOLVED_STILL_BASELINED')).length, 1, 'npm 的旧条目照判失效');
  assert.equal(violations.filter((v) => v.includes('UNVERIFIED_ZERO_SCAN')).length, 0,
    '该域有产出 ⇒ 不进零产出档：\n' + violations.join('\n'));
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
// ——— 2026-10-22：错误信封不得被当成「空审计报告」 ———
//
// 现场：npm 审计端点 `socket hang up` 时，`npm audit` 把**错误 JSON** 打到 stdout：
//   {"message":"request to .../security/audits/quick failed, reason: socket hang up","error":{...}}
// 旧实现只要求 stdout 里有 `{` 且能 JSON.parse ⇒ ok:true ⇒ 解析出 0 条命中 ⇒
// 基线里该域所有条目被判 `RESOLVED_STILL_BASELINED`「已不再命中（多半已升级），请 --update 清账」。
// 红文案把人指向删基线，而真相是「根本没量到」——照它做会把真实挂账清空、门禁恒绿。
test('shellRun 必须把错误信封判成「不是审计报告」', async (t) => {
  /** 注入 spawn：返回给定 stdout，模拟扫描器的真实输出（不启子进程）。 */
  const fakeSpawn = (stdout) => () => ({ stdout, stderr: '' });

  await t.test('isAuditReport：只有带 vulnerabilities/advisories 键才算审计报告', () => {
    assert.equal(D.isAuditReport({ vulnerabilities: {} }), true, 'npm v2 的零漏洞报告必须算报告');
    assert.equal(D.isAuditReport({ advisories: {} }), true, 'pnpm/旧版零漏洞报告必须算报告');
    assert.equal(D.isAuditReport({ message: 'request to x failed', error: {} }), false, '错误信封不算报告');
    assert.equal(D.isAuditReport({}), false, '空对象不算报告（区分「量到 0」与「没量到」）');
    assert.equal(D.isAuditReport([]), false);
    assert.equal(D.isAuditReport(null), false);
  });

  await t.test('错误信封 → ok:false，且错误文案点明「不是审计报告」', () => {
    const stdout = JSON.stringify({
      message: 'request to https://registry.npmjs.org/-/npm/v1/security/audits/quick failed, reason: socket hang up',
      error: { code: 'ECONNRESET' },
    });
    const res = D.shellRunOnce('npm', ['audit'], { expectReport: 'npm', spawn: fakeSpawn(stdout) });
    assert.equal(res.ok, false, '错误信封绝不能被当成合法报告');
    assert.match(res.error, /不是审计报告/, '错误文案必须说清是「拿不到报告」而不是「没有漏洞」');
  });

  await t.test('合法零漏洞报告 → ok:true（不能把「真的没漏洞」误判成扫描失败）', () => {
    const stdout = JSON.stringify({ auditReportVersion: 2, vulnerabilities: {}, metadata: {} });
    const res = D.shellRunOnce('npm', ['audit'], { expectReport: 'npm', spawn: fakeSpawn(stdout) });
    assert.equal(res.ok, true);
    assert.deepEqual(res.json.vulnerabilities, {});
  });

  await t.test('不传 expectAuditReport 时不改行为（pip-audit 的输出形状不同）', () => {
    const stdout = JSON.stringify({ dependencies: [], fixes: [] });
    const res = D.shellRunOnce('pip-audit', [], { spawn: fakeSpawn(stdout) });
    assert.equal(res.ok, true, 'pip 域不能被 npm 的报告形状约束误伤');
  });

  await t.test('重试：第一次错误信封、第二次合法报告 ⇒ 整体成功（端点抖动不该放大成门禁红）', () => {
    let calls = 0;
    const spawn = () => {
      calls += 1;
      return calls === 1
        ? { stdout: JSON.stringify({ message: 'request to x failed, reason: socket hang up' }), stderr: '' }
        : { stdout: JSON.stringify({ vulnerabilities: {}, auditReportVersion: 2 }), stderr: '' };
    };
    const res = D.shellRun('npm', ['audit'], { expectReport: 'npm', attempts: 2, retryDelays: [0], spawn });
    assert.equal(res.ok, true, '第一次失败后必须真的重试并接受第二次的合法报告');
    assert.equal(calls, 2, '必须恰好尝试两次');
  });

  await t.test('重试耗尽 → 返回最后一次错误（由 runCheck 记 SCANNER_UNAVAILABLE，不产出空报告）', () => {
    let calls = 0;
    const spawn = () => {
      calls += 1;
      return { stdout: JSON.stringify({ message: 'request to x failed, reason: socket hang up' }), stderr: '' };
    };
    const res = D.shellRun('npm', ['audit'], { expectReport: 'npm', attempts: 3, retryDelays: [0], spawn });
    assert.equal(res.ok, false);
    assert.equal(calls, 3, 'attempts=3 必须真的试三次');
  });
});

// ——— 接线锁：cwd 必须透传给扫描器 ———
//
// 动因（2026-10-22 当场踩到）：给 shellRunOnce 加「错误信封」校验时，一次行级编辑把
// `cwd: opts.cwd || ROOT` 那行吞掉了，于是 ops-center 域的 `npm audit` 跑在**仓库根**
// （那里没有它的 package-lock.json）⇒ 拿不到报告 ⇒ 该域被判 SCANNER_UNAVAILABLE
// 永久跳过。而结果是**绿色**的（只是少扫一个域），不吵不闹 —— 正是最该上锁的形态。
test('shellRunOnce 必须把 cwd 透传给扫描器', () => {
  let seen = null;
  const spawn = (cmd, args, options) => {
    seen = options;
    return { stdout: JSON.stringify({ vulnerabilities: {} }), stderr: '' };
  };
  const cwd = path.join(process.cwd(), 'ops-center', 'frontend');
  const res = D.shellRunOnce('npm', ['audit'], { cwd, expectReport: 'npm', spawn });
  assert.equal(res.ok, true);
  assert.equal(seen.cwd, cwd, 'cwd 丢失会让 ops-center 域在错误的目录里扫描，且只表现为「扫不到」');
});
// ——— pip 域：同一个 bug 的第三份 ———
//
// 外部评审（2026-10-22）当场点名：只给两个 npm 域加形状校验、漏掉 pip，
// 等于把「错误信封被读成零漏洞」这个 bug 留了三分之一。
// `parsePipAudit()` 对任何缺 `dependencies` 的对象都返回 []，所以这里必须单独上锁。
test('pip 域也必须做报告形状校验', async (t) => {
  const fakeSpawn = (stdout) => () => ({ stdout, stderr: '' });

  await t.test('isPipAuditReport：只认顶层 dependencies 数组', () => {
    assert.equal(D.isPipAuditReport({ dependencies: [] }), true, '零漏洞的 pip 报告（空数组）必须算报告');
    assert.equal(D.isPipAuditReport({ dependencies: [{ name: 'x', vulns: [] }] }), true);
    assert.equal(D.isPipAuditReport({ message: 'pip-audit failed', error: {} }), false, '错误信封不算报告');
    assert.equal(D.isPipAuditReport({ vulnerabilities: {} }), false, 'npm 形状不能冒充 pip 报告');
    assert.equal(D.isPipAuditReport({}), false);
    assert.equal(D.isPipAuditReport(null), false);
  });

  await t.test('pip 错误信封 + expectReport:pip → ok:false（否则会谎报 pip 挂账已修复）', () => {
    const stdout = JSON.stringify({ message: 'pip-audit: could not resolve requirements', error: { code: 'ENOENT' } });
    const res = D.shellRunOnce('pip-audit', ['-r', 'x'], { expectReport: 'pip', spawn: fakeSpawn(stdout) });
    assert.equal(res.ok, false);
    assert.match(res.error, /不是审计报告/);
  });

  await t.test('pip 合法报告 + expectReport:pip → ok:true', () => {
    const stdout = JSON.stringify({ dependencies: [], fixes: [] });
    const res = D.shellRunOnce('pip-audit', ['-r', 'x'], { expectReport: 'pip', spawn: fakeSpawn(stdout) });
    assert.equal(res.ok, true);
    assert.deepEqual(res.json.dependencies, []);
  });

  await t.test('用 npm 的尺子量 pip 会被拒（两个域形状不同，不能共用一把尺）', () => {
    const stdout = JSON.stringify({ dependencies: [] });
    const res = D.shellRunOnce('pip-audit', ['-r', 'x'], { expectReport: 'npm', spawn: fakeSpawn(stdout) });
    assert.equal(res.ok, false, 'npm 形状校验不应接受 pip 报告');
  });
});
/* ── UNVERIFIED_ZERO_SCAN：把「扫描成功但零产出」与「公告真的都修了」分开（2026-10-22）──────
 * 动因是 CI 现场：dep-audit.yml 那个 job 不装任何依赖，`npm-opscenter` 域返回 0 条，
 * 判据连报两条 `RESOLVED_STILL_BASELINED … 请 --update 清账`；而同一 commit 在本机
 * 两种树形态下（ops-center/frontend 有 / 无 node_modules）都照样命中那两条 GHSA。
 * 照提示跑 --update 会把仍然有效的挂账从安全基线里抹掉 —— 本组锁就是来堵这一格的。
 */
test('Z1 CI 形状：域本轮 0 产出而基线里它有挂账 ⇒ 报未证实，且不得报「已不再命中」', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('npm-opscenter', 'GHSA-68FV-2MGG-JV7Q'), ledger('pip', 'PYSEC-x')] };
  const { violations } = D.evaluate(base, [entry('pip', 'PYSEC-x')], FUTURE);
  assert.equal(violations.filter((v) => v.startsWith('RESOLVED_STILL_BASELINED')).length, 0,
    '0 产出不是已修的证据，一条 RESOLVED 都不许报：\n' + violations.join('\n'));
  assert.equal(violations.length, 1, '应恰好一条未证实告警：\n' + violations.join('\n'));
  assert.match(violations[0], /^UNVERIFIED_ZERO_SCAN: npm-opscenter/);
  assert.match(violations[0], /1\s*条挂账/, '文案必须给出该域有几条挂账，否则读者无从判断影响面');
  assert.match(violations[0], /不得.*清账|不得.*判成已修/);
});

test('Z2 负控：域本轮 0 产出、但基线里该域本来就没挂账 ⇒ 不得凭空造债', () => {
  const base = { reviewBy: FUTURE, advisories: [ledger('npm', 'GHSA-live')] };
  const { violations } = D.evaluate(base, [entry('npm', 'GHSA-live')], FUTURE);
  assert.deepEqual(violations, [], 'pip 与 npm-opscenter 都 0 产出但账上无它们 ⇒ 全绿');
});

test('Z3 与 SCANNER_UNAVAILABLE 不重复：该域本轮没扫成时，未证实由那一条 warning 管', () => {
  // scannedSources 只含 pip ⇒ npm 既不该被判腐化，也不该被判零产出（那是两类成因，文案不同）。
  const base = { reviewBy: FUTURE, advisories: [ledger('npm', 'GHSA-a'), ledger('pip', 'PYSEC-x')] };
  const { violations } = D.evaluate(base, [entry('pip', 'PYSEC-x')], FUTURE, ['pip']);
  assert.deepEqual(violations, [], '未扫成的域必须整体不判：\n' + violations.join('\n'));
});

test('Z4 --update 在「0 产出但有挂账」时必须拒绝写基线，且基线文件逐字节不变', () => {
  // 这条是 Z1 的另一半：红文案自己会喊 --update，所以恰恰在那一刻必须挡住（writeBaseline 按 found 全量落盘）。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-audit-zero-'));
  const bp = path.join(dir, 'baseline.json');
  const body = { reviewBy: FUTURE, advisories: [ledger('npm-opscenter', 'GHSA-68FV-2MGG-JV7Q'), ledger('pip', 'PYSEC-x')] };
  fs.writeFileSync(bp, JSON.stringify(body, null, 2), 'utf8');
  const before = fs.readFileSync(bp, 'utf8');
  const out = [];
  try {
    const code = D.runCheck({
      registry: 'npm',
      isUpdate: true,
      baselinePath: bp,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push('ERR ' + a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: { advisories: {} } }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }),
        pip: () => ({ ok: true, json: { dependencies: [{ name: 'm', version: '1.0.0', vulns: [{ id: 'PYSEC-x', aliases: [], fix_versions: ['>=1.2.3'] }] }] } }),
      },
    });
    assert.equal(code, 1, '0 产出但有挂账的域存在时 --update 必须失败，读数：\n' + out.join('\n'));
    assert.ok(out.some((l) => l.includes('拒绝写基线')), '必须点名拒绝：\n' + out.join('\n'));
    assert.equal(fs.readFileSync(bp, 'utf8'), before, '基线不得被写坏哪怕一字节');
  } finally {
    fs.rmSync(bp, { force: true }); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Z6 没扫成的域拒绝写基线：这一格由既有那道闸守，且必须真的拦住（QM-6 外部评审 i1 的处置）', () => {
  // npm 本轮 res.ok=false（离线/端点抖动）⇒ 它不在 scannedSources。评审 i1 说这里与 evaluate 的分档
  // 不一致、建议过滤成「只保留已扫域」——**不采纳**，因为 writeBaseline 的重建源只有 found，
  // 放过就等于把 npm 在基线里的每一行（含人工 decision/note）整段抹掉。
  // 实测把这一格拦住的是 runCheck 里那道既有闸（`unavailable.length && isUpdate`），
  // 它排在本次新增的零产出守卫**之前**——所以新守卫不需要再加过滤，这条用例锁的是"到底有没有人拦"。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-audit-unscanned-'));
  const bp = path.join(dir, 'baseline.json');
  const body = { reviewBy: FUTURE, advisories: [ledger('npm', 'GHSA-offline', 'not-exploitable', '逐条复核过三处 algorithms'), ledger('pip', 'PYSEC-x')] };
  fs.writeFileSync(bp, JSON.stringify(body, null, 2), 'utf8');
  const before = fs.readFileSync(bp, 'utf8');
  const out = [];
  try {
    const code = D.runCheck({
      registry: 'npm',
      isUpdate: true,
      baselinePath: bp,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push('ERR ' + a.join(' ')),
      runners: {
        npm: () => ({ ok: false, error: 'offline' }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }),
        pip: () => ({ ok: true, json: { dependencies: [{ name: 'm', version: '1.0.0', vulns: [{ id: 'PYSEC-x', aliases: [], fix_versions: ['>=1.2.3'] }] }] } }),
      },
    });
    assert.equal(code, 1, '有域没扫成时 --update 必须失败，读数：\n' + out.join('\n'));
    assert.ok(out.some((l) => l.includes('扫描器不可用，拒绝写基线') && l.includes('npm')),
      '必须点名是哪道闸、哪个域：\n' + out.join('\n'));
    assert.equal(fs.readFileSync(bp, 'utf8'), before, '基线里那条人工 note 不得被抹掉哪怕一字节');
  } finally {
    fs.rmSync(bp, { force: true }); fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('Z5 正控（Z4 的对偶）：所有域都有产出时 --update 照常写基线，别把清账通道一起焊死', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-audit-ok-'));
  const bp = path.join(dir, 'baseline.json');
  fs.writeFileSync(bp, JSON.stringify({ reviewBy: FUTURE, advisories: [ledger('npm-opscenter', 'GHSA-live'), ledger('pip', 'PYSEC-x')] }, null, 2), 'utf8');
  try {
    const code = D.runCheck({
      registry: 'npm',
      isUpdate: true,
      baselinePath: bp,
      log: () => {}, error: () => {},
      runners: {
        npm: () => ({ ok: true, json: { advisories: {} } }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: { axios: { via: [{ source: 1, url: 'https://github.com/advisories/GHSA-live', severity: 'high', range: '>=1.0.0 <1.2.3' }] } } } }),
        pip: () => ({ ok: true, json: { dependencies: [{ name: 'm', version: '1.0.0', vulns: [{ id: 'PYSEC-x', aliases: [], fix_versions: ['>=1.2.3'] }] }] } }),
      },
    });
    assert.equal(code, 0, '各域都有产出时写基线不得被新守卫误伤：' + bp);
    const after = JSON.parse(fs.readFileSync(bp, 'utf8'));
    assert.ok(after.advisories.some((a) => a.source === 'npm-opscenter'), 'npm-opscenter 那条必须落在新基线里');
  } finally {
    fs.rmSync(bp, { force: true }); fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ── 刷新路径（定时作业 dep-audit-refresh.yml 用）：合成底 + 刷新报告 + PR 正文 ──

test('刷新合成底：分支上人已补的结论必须保住，且不得把主干上补的结论当成新公告', () => {
  const main = {
    reviewBy: '2026-12-31',
    advisories: [
      Object.assign(ledger('npm', 'GHSA-main'), { note: '主干上补的结论' }),
    ],
  };
  const branch = {
    reviewBy: '2026-12-31',
    advisories: [
      Object.assign(ledger('npm', 'GHSA-branch'), { decision: 'accepted-risk', note: '分支上补的结论' }),
    ],
  };
  const merged = D.mergeBaselines(main, branch);
  const keys = merged.advisories.map((a) => a.source + '/' + a.id);
  assert.deepEqual(keys.sort(), ['npm/GHSA-branch', 'npm/GHSA-main'], '并集：任一侧有就要在');
  assert.equal(merged.advisories.find((a) => a.id === 'GHSA-main').note, '主干上补的结论',
    '主干那条的人工结论不得被分支那份覆盖掉');
  assert.equal(merged.advisories.find((a) => a.id === 'GHSA-branch').decision, 'accepted-risk');
});

test('刷新合成底：reviewBy 只许往后走（人顺延的生效，机器不得缩短）', () => {
  assert.equal(D.laterDate('2026-12-31', '2027-01-31'), '2027-01-31');
  assert.equal(D.laterDate('2027-01-31', '2026-12-31'), '2027-01-31');
  assert.equal(D.laterDate('', '2026-12-31'), '2026-12-31');
  const merged = D.mergeBaselines({ reviewBy: '2027-03-01', advisories: [] }, { reviewBy: '2026-12-31', advisories: [] });
  assert.equal(merged.reviewBy, '2027-03-01', '更晚的那个胜出');
});

test('刷新路径：--update 带上 --merge-from 后，人在分支上补的 decision/note 不得被冲成 TODO', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-refresh-merge-'));
  const bp = path.join(dir, 'baseline.json');
  const branchBp = path.join(dir, 'branch-baseline.json');
  // 主干：一条已登记（无结论）+ 一条本轮新公告
  fs.writeFileSync(bp, JSON.stringify({ reviewBy: FUTURE, advisories: [ledger('npm', 'GHSA-known')] }, null, 2), 'utf8');
  // 分支：人给 GHSA-known 补了结论
  fs.writeFileSync(branchBp, JSON.stringify({
    reviewBy: FUTURE,
    advisories: [Object.assign(ledger('npm', 'GHSA-known'), { decision: 'accepted-risk', note: '人已复核：不可达' })],
  }, null, 2), 'utf8');
  try {
    const code = D.runCheck({
      isUpdate: true,
      baselinePath: bp,
      mergeFrom: branchBp,
      log: () => {}, error: () => {},
      runners: {
        npm: () => ({ ok: true, json: npmJsonOf(['GHSA-known', 'GHSA-brand-new']) }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }),
        pip: () => ({ ok: true, json: { dependencies: [] } }),
      },
    });
    assert.equal(code, 0);
    const after = JSON.parse(fs.readFileSync(bp, 'utf8'));
    const known = after.advisories.find((a) => a.id === 'GHSA-known');
    assert.equal(known.decision, 'accepted-risk', '分支上补的结论必须保住（被冲成 TODO 就等于删掉人的风险分析）');
    assert.equal(known.note, '人已复核：不可达');
    const fresh = after.advisories.find((a) => a.id === 'GHSA-brand-new');
    assert.equal(fresh.decision, 'upgrade-tracked', '新公告由机器预填机械承诺（不再是 TODO —— 那会让门禁在涌入期长期红）');
    assert.equal(fresh.targetVersion, '1.2.3', '承诺版本取公告修复下界');
    assert.ok(fresh.dueBy, '预填条目必须带到期日（到期即红是预填能成立的前提）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('刷新路径：--merge-from 读不到时必须拒刷（拿主干当底硬刷会把人刚补的结论冲掉）', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-refresh-missing-'));
  const bp = path.join(dir, 'baseline.json');
  fs.writeFileSync(bp, JSON.stringify({ reviewBy: FUTURE, advisories: [] }, null, 2), 'utf8');
  try {
    const before = fs.readFileSync(bp, 'utf8');
    const out = [];
    const code = D.runCheck({
      isUpdate: true,
      baselinePath: bp,
      mergeFrom: path.join(dir, 'no-such-file.json'),
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push('ERR ' + a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: npmJsonOf([]) }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }),
        pip: () => ({ ok: true, json: { dependencies: [] } }),
      },
    });
    assert.equal(code, 1, '读不到分支基线必须失败');
    assert.ok(out.some((l) => l.includes('MERGE_BASELINE_UNREADABLE')), '必须点名哪道闸：\n' + out.join('\n'));
    assert.equal(fs.readFileSync(bp, 'utf8'), before, '拒刷时基线必须一字节不变');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('刷新路径：--merge-from 与判定路径同用必须被拒（判定底只能是主干那份）', () => {
  const out = [];
  const code = D.runCheck({
    baselinePath: path.join(os.tmpdir(), 'never-written.json'),
    mergeFrom: path.join(os.tmpdir(), 'x.json'),
    log: (...a) => out.push(a.join(' ')),
    error: (...a) => out.push('ERR ' + a.join(' ')),
    runners: { npm: () => ({ ok: true, json: npmJsonOf([]) }) },
  });
  assert.equal(code, 1);
  assert.ok(out.some((l) => l.includes('只能与 --update 同用')), '必须出声：\n' + out.join('\n'));
});

test('刷新报告：新增 / 清账 / 换号三档必须分开（混成一句「基线变了」会把两件事说成一件事）', () => {
  const oldBase = {
    reviewBy: FUTURE,
    advisories: [
      Object.assign(ledger('npm', 'GHSA-old'), { decision: 'accepted-risk', note: '旧结论' }),
      Object.assign(ledger('npm', 'GHSA-gone'), { decision: 'accepted-risk', note: '待清' }),
      Object.assign(ledger('pip', 'PYSEC-old'), { decision: 'not-exploitable', note: '换号前' }),
    ],
  };
  const newBase = {
    reviewBy: FUTURE,
    advisories: [
      Object.assign(ledger('npm', 'GHSA-old'), { decision: 'accepted-risk' }),
      Object.assign(ledger('npm', 'GHSA-new'), { decision: 'TODO', note: '待补结论（新公告）' }),
      Object.assign(ledger('pip', 'PYSEC-new'), { decision: 'not-exploitable', aliases: ['PYSEC-old'] }),
    ],
  };
  const r = D.buildRefreshReport(oldBase, newBase, { scanAt: '2026-10-24T00:00:00Z' });
  assert.deepEqual(r.added.map((e) => e.key), ['npm/GHSA-new'], '只有真新公告算新增');
  assert.deepEqual(r.cleared.map((e) => e.key), ['npm/GHSA-gone'], '换号的那条不算清账');
  assert.deepEqual(r.migrated.map((m) => m.from + '→' + m.to), ['pip/PYSEC-old→pip/PYSEC-new']);
  assert.deepEqual(r.needDecision.map((e) => e.key), ['npm/GHSA-new'], '待补结论 = decision 仍是 TODO 的');
  assert.equal(r.needDecision[0].isNew, true, '本轮新登记的必须标出来');
  assert.equal(r.changed, true);
});

test('刷新报告：待补结论清单要含「此前就没人补的」，不能只列本轮新增（否则清单会清空而人以为没事了）', () => {
  const oldBase = { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-x'), { decision: 'TODO' })] };
  const newBase = { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-x'), { decision: 'TODO' })] };
  const r = D.buildRefreshReport(oldBase, newBase, {});
  assert.deepEqual(r.needDecision.map((e) => e.key), ['npm/GHSA-x']);
  assert.equal(r.needDecision[0].isNew, false, '不是本轮新登记的');
  assert.equal(r.changed, false, '什么都没变 ⇒ changed=false（不该白推一次）');
});

test('PR 正文：必须写清机器做了什么、没做什么，以及每个 decision 要额外填什么', () => {
  const r = D.buildRefreshReport(
    { reviewBy: FUTURE, advisories: [] },
    { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-x'), { decision: 'TODO', note: '待补结论（新公告）', patched: '>=4.17.21' })] },
    { scanAt: '2026-10-24T00:00:00Z' },
  );
  const body = D.renderRefreshBody(r, {});
  assert.ok(body.includes('`upgrade-tracked`'), '必须列出合法 decision 取值');
  assert.ok(body.includes('targetVersion'), '必须写清 upgrade-tracked 还要填 targetVersion');
  assert.ok(body.includes('npm/GHSA-x'), '必须点名待补的那条');
  assert.ok(body.includes('BASELINE_META_INVALID'), '必须写清不补会怎样判红');
  assert.ok(body.includes('reviewBy'), '必须交代复核日');
  assert.ok(body.includes('GITHUB_TOKEN'), '必须写清首轮 CI 不会自动跑（GITHUB_TOKEN 不触发工作流）');
});

test('PR 正文：没有任何待补条目时不得留一张空表冒充待办', () => {
  const r = D.buildRefreshReport(
    { reviewBy: FUTURE, advisories: [] },
    { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-x'), { decision: 'accepted-risk', note: '有结论' })] },
    {},
  );
  const body = D.renderRefreshBody(r, {});
  assert.ok(body.includes('无「decision 还是 TODO」的条目'), '应当明说没有待补结论的条目');
  assert.ok(!body.includes('| source/id | 包 | 严重度 | 修复版本 | 本轮新登记 | 要填 |'), '不得留空待办表');
});

test('刷新路径：合成底喂给「0 产出」那道闸时必须更保守（分支上有、主干上没有的域也别被静默清空）', () => {
  // 动因：--merge-from 之后，零产出守卫看到的底从「主干那份」变成「主干 ∪ 分支」。
  // 这一格若判错方向，刷新就会把「这轮没量到」当成「已修」——那正是这道闸存在的理由。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-refresh-zero-'));
  const bp = path.join(dir, 'baseline.json');
  const branchBp = path.join(dir, 'branch-baseline.json');
  // 主干：没有 npm-opscenter 的条目；分支：有（上一轮刷新登记的）
  fs.writeFileSync(bp, JSON.stringify({ reviewBy: FUTURE, advisories: [] }, null, 2), 'utf8');
  fs.writeFileSync(branchBp, JSON.stringify({
    reviewBy: FUTURE,
    advisories: [Object.assign(ledger('npm-opscenter', 'GHSA-x'), { decision: 'TODO', note: '待补结论（新公告）' })],
  }, null, 2), 'utf8');
  try {
    const before = fs.readFileSync(bp, 'utf8');
    const out = [];
    const code = D.runCheck({
      isUpdate: true,
      baselinePath: bp,
      mergeFrom: branchBp,
      log: (...a) => out.push(a.join(' ')),
      error: (...a) => out.push('ERR ' + a.join(' ')),
      runners: {
        npm: () => ({ ok: true, json: npmJsonOf([]) }),
        'npm-opscenter': () => ({ ok: true, json: { vulnerabilities: {} } }), // 扫成了，但 0 产出
        pip: () => ({ ok: true, json: { dependencies: [] } }),
      },
    });
    assert.equal(code, 1, '分支上挂着、而该域本轮 0 产出 ⇒ 必须拒写（未证实 ≠ 已修）');
    assert.ok(out.some((l) => l.includes('拒绝写基线')), '必须点名拒绝：\n' + out.join('\n'));
    assert.equal(fs.readFileSync(bp, 'utf8'), before, '拒写时基线一字节不变');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('刷新报告：必须带上「刷新后仍会判红」的条目（结论已失效 ≠ 还没给结论）', () => {
  // 动因（2026-10-24 首次真实运行实测）：公告库把 patched 的修复下界改了
  // （brace-expansion >=1.1.16 → >=5.0.7），人写的 targetVersion 还是 1.1.16
  // ⇒ 门禁判 DECISION_CONTRADICTS_PATCHED。而刷新报告若只列「decision 还是 TODO 的」，
  // 正文会说「无需补结论」而门禁其实红着 —— 而机器人开的 PR 永远不跑 CI（正文是唯一信号）。
  const e = Object.assign(ledger('npm', 'GHSA-3jxr-9vmj-r5cp'), {
    decision: 'upgrade-tracked', targetVersion: '1.1.16', patched: '>=5.0.7', note: '原有结论',
  });
  const viol = [D.checkTargetEscapes(e)].filter(Boolean);
  assert.equal(viol.length, 1, '这条必须真被判红：' + JSON.stringify(e));
  const r = D.buildRefreshReport(
    { reviewBy: FUTURE, advisories: [e] },
    { reviewBy: FUTURE, advisories: [e] },
    { violations: viol },
  );
  assert.deepEqual(r.needDecision.map((x) => x.key), [], '它不是「还没给结论」（decision 合法且非 TODO）');
  assert.equal(r.violations.length, 1, '但必须被单独列出来');
  const body = D.renderRefreshBody(r, {});
  assert.ok(body.includes('DECISION_CONTRADICTS_PATCHED'), '正文必须带上门禁的原话：\n' + body);
  assert.ok(body.includes('刷新后门禁仍会判红'), '正文必须有这一档的标题');
  assert.ok(body.includes('不要因为上一节写「无」就以为没事'), '正文必须点破两档的区别');
});

test('刷新正文：没有失效结论时那一档必须说「无」（不留空表冒充待办）', () => {
  const r = D.buildRefreshReport(
    { reviewBy: FUTURE, advisories: [] },
    { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-x'), { decision: 'accepted-risk', note: '有结论' })] },
    { violations: [] },
  );
  const body = D.renderRefreshBody(r, {});
  assert.ok(body.includes('刷新后的基线自洽'), '应当明说没有失效结论');
  assert.ok(!body.includes('| 判据 | 说明 |'), '不得留一张空表');
});

// ── 机器预填 + 到期即红 + 承诺按「扫描现值」校验（2026-10-24）──

test('到期即红：预填条目的 dueBy 过了就要出声（机器不续期，续期=把复核变成永续挂账）', () => {
  const item = Object.assign(entry('npm', 'GHSA-DUE'), {
    decision: 'upgrade-tracked', note: '机械登记', targetVersion: '1.2.3',
    dueBy: '2026-10-20', prefilled: true,
  });
  const found = [entry('npm', 'GHSA-DUE')];
  const base = { reviewBy: FUTURE, advisories: [item] };
  const before = D.evaluate(base, found, '2026-10-19', ['npm']);
  assert.deepEqual(before.violations, [], '未到期不得判红：' + JSON.stringify(before.violations));
  const after = D.evaluate(base, found, '2026-10-21', ['npm']);
  const over = after.violations.filter((v) => v.startsWith('DECISION_OVERDUE'));
  assert.equal(over.length, 1, '到期必须判红：' + JSON.stringify(after.violations));
  assert.ok(over[0].includes('2026-10-20'), '文案必须点名到期日：' + over[0]);
  // dueBy 形状非法 ⇒ fail closed（不是「看不懂就当没到期」）
  const bad = D.evaluate({ reviewBy: FUTURE, advisories: [Object.assign({}, item, { dueBy: 'soon' })] }, found, '2026-10-21', ['npm']);
  assert.ok(bad.violations.some((v) => v.includes('BASELINE_META_INVALID')), '非法 dueBy 必须判红：' + JSON.stringify(bad.violations));
});

test('承诺按「扫描现值」校验：基线里记的 patched 陈旧时，闭不上的承诺必须露出来', () => {
  // 动因（2026-10-24 实测）：多族公告在旧口径下只记一族 ⇒ 基线记的下界偏小；
  // 拿陈旧事实校验承诺 ⇒ 一个实际闭不上的承诺也能过门禁（当时实测 2 笔隐形欠账）。
  const base = { reviewBy: FUTURE, advisories: [
    Object.assign(entry('npm', 'GHSA-MF'), {
      decision: 'upgrade-tracked', note: '已排期', patched: '>=1.1.16', targetVersion: '1.1.16',
    }),
  ] };
  // 扫描现值：两族（1.x 与 5.x），而承诺只到 1.1.16 ⇒ 闭不上 5.0.6 那份
  const found = [entry('npm', 'GHSA-MF', { patched: '>=1.1.16, >=5.0.7' })];
  const r = D.evaluate(base, found, '2026-10-24', ['npm']);
  const bad = r.violations.filter((v) => v.includes('DECISION_CONTRADICTS_PATCHED'));
  assert.equal(bad.length, 1, '陈旧事实不得替承诺背书：' + JSON.stringify(r.violations));
  assert.ok(bad[0].includes('>=5.0.7'), '文案必须点名真正卡住的那一段：' + bad[0]);
});

test('机器托管的条目：事实变大时 targetVersion 只**收紧**到派生值，绝不放宽人抬得更高的', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dep-managed-'));
  const p = path.join(dir, 'bl.json');
  try {
    // 旧条目：机器预填过（带 prefilled），人把 targetVersion 抬到了 5.0.10（比派生值高）
    const old = { reviewBy: FUTURE, advisories: [
      Object.assign(entry('npm', 'GHSA-M'), {
        decision: 'upgrade-tracked', note: '机械登记', targetVersion: '5.0.10',
        dueBy: '2026-11-07', prefilled: true,
      }),
    ] };
    // 扫描现值：事实要求 >=5.0.7（比人抬的低）
    const out = D.writeBaseline([Object.assign(entry('npm', 'GHSA-M'), { patched: '>=5.0.7' })], old, p, { today: '2026-10-24' });
    assert.equal(out.advisories[0].targetVersion, '5.0.10', '人抬得更高的必须保留（机器只收紧不放宽）');
    assert.equal(out.advisories[0].dueBy, '2026-11-07', '到期日不得被机器延长');
    // 事实要求得更高时 ⇒ 机器收紧（承诺不得闭不上）
    const out3 = D.writeBaseline([Object.assign(entry('npm', 'GHSA-M'), { patched: '>=5.0.11' })], old, p, { today: '2026-10-24' });
    assert.equal(out3.advisories[0].targetVersion, '5.0.11', '事实要求更高时必须收紧（承诺不得闭不上）');
    // 人的条目（无 prefilled 标记）⇒ 机器不碰 targetVersion
    const human = { reviewBy: FUTURE, advisories: [
      Object.assign(entry('npm', 'GHSA-H'), { decision: 'upgrade-tracked', note: '人写的', targetVersion: '1.1.16' }),
    ] };
    const out4 = D.writeBaseline([Object.assign(entry('npm', 'GHSA-H'), { patched: '>=1.1.16, >=5.0.7' })], human, p, { today: '2026-10-24' });
    assert.equal(out4.advisories[0].targetVersion, '1.1.16', '人的条目机器不碰（门禁去判它，并让人看见）');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('合成底必须保留 dueBy / prefilled（否则刷新会把机器托管的条目变成人的条目）', () => {
  const main = { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-A'), { dueBy: '2026-11-07', prefilled: true })] };
  const branch = { reviewBy: FUTURE, advisories: [Object.assign(ledger('npm', 'GHSA-A'), { dueBy: '2026-12-01', prefilled: true, note: '人改过' })] };
  const merged = D.mergeBaselines(main, branch);
  const a = merged.advisories[0];
  assert.equal(a.dueBy, '2026-12-01', '分支上的到期日优先（人改过）');
  assert.equal(a.prefilled, true, 'prefilled 标记必须带过去');
  assert.equal(a.note, '人改过');
});

test('刷新正文：机器已预填的条目必须单独列出来（否则人会以为「没东西要做」）', () => {
  const e = Object.assign(entry('npm', 'GHSA-P'), {
    decision: 'upgrade-tracked', note: '机械登记', targetVersion: '1.2.3', dueBy: '2026-11-07', prefilled: true,
  });
  const r = D.buildRefreshReport(
    { reviewBy: FUTURE, advisories: [] },
    { reviewBy: FUTURE, advisories: [e] },
    { violations: [] },
  );
  assert.deepEqual(r.needDecision.map((x) => x.key), [], '预填条目不是「还没给结论」');
  assert.deepEqual(r.prefilled.map((x) => x.key), ['npm/GHSA-P'], '但必须单独列出「等你确认」');
  const body = D.renderRefreshBody(r, {});
  assert.ok(body.includes('机器已预填、等你确认'), '正文必须有这一档：\n' + body);
  assert.ok(body.includes('2026-11-07'), '正文必须写明到期日');
  assert.ok(body.includes('机器不续期'), '正文必须点明到期日不由机器续：\n' + body);
});
