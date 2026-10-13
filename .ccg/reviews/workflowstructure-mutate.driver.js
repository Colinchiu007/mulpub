'use strict'
// 反证电池（原件入库，可直接重跑）：node .ccg/reviews/workflowstructure-mutate.driver.js
//
// 每条变异都必须"把判据改成 no-op / 把规则明文禁止的形态写回现场"后，**恰好让预期的红出现**。
// 三态区分：CAUGHT / NOT_CAUGHT（锁没抓住）/ SKIPPED_ANCHOR（锚点未命中＝变异根本没发生）。
// 把 SKIPPED 与 NOT_CAUGHT 混成一档，等于让"驱动自身失效"伪装成"锁是好的"。
//
// M1 是动因本体：把 87e31c45 删出来的那个空值节点逐字写回 gui-test.yml，
// 证明这条锁测的是"它声称测的那件事"，而不是"摘掉守卫后碰巧变红"。
// M11 是正控的反证：把 runs-on 判据从"带 steps 的作业"扩成"所有作业"，
// 复用型 workflow 调用（合法、且本仓暂无实例）必须当场被判红——否则"合规形态不得红"
// 那条断言只是恒真陈述。
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');

const ROOT = path.join(__dirname, '..', '..');
const TEST = '.github/scripts/check-workflow-structure.test.js';
const LOCK = '.github/scripts/check-workflow-structure.js';
const GUI = '.github/workflows/gui-test.yml';
const QG = '.github/workflows/quality-gate.yml';

function eolOf (file) {
  return fs.readFileSync(path.join(ROOT, file), 'utf8').includes('\r\n') ? '\r\n' : '\n';
}
const J = (file, lines) => lines.join(eolOf(file));

const MUTATIONS = [
  {
    id: 'M1',
    what: '动因形态写回现场：删掉 gui-test.yml 的 defaults.run.shell: bash，留一个空值节点',
    file: GUI,
    from: J(GUI, ['    defaults:', '      run:', '        shell: bash']),
    to: J(GUI, ['    defaults:', '      run:']),
    expect: 'both'
  },
  {
    id: 'M2',
    what: '空值遍历改成 no-op',
    file: LOCK,
    from: J(LOCK, ['function walkNulls (node, parts, label, out) {', '  if (node === null) {']),
    to: J(LOCK, ['function walkNulls (node, parts, label, out) {', '  if (true) return;', '  if (node === null) {']),
    expect: 'test'
  },
  {
    id: 'M3',
    what: '白名单收紧为"一律不许空"⇒ 正控必须红（证明规则不是"全判红"也能过）',
    file: LOCK,
    from: J(LOCK, ['function isAllowedEmpty (parts) {', "  return parts.length === 2 && parts[0] === 'on';"]),
    to: J(LOCK, ['function isAllowedEmpty (parts) {', '  return false;']),
    expect: 'test'
  },
  {
    id: 'M4',
    what: '扫描退化成空集合 ⇒ 扫描域下界必须红',
    file: LOCK,
    from: J(LOCK, ['  const files = [];', '  const violations = [];']),
    to: J(LOCK, ['  return { files: [], violations: [] };', '  const files = [];', '  const violations = [];']),
    expect: 'test'
  },
  {
    id: 'M5',
    what: 'CLI 恒退 0 ⇒ CLI 出口用例必须红',
    file: LOCK,
    from: J(LOCK, ['  if (violations.length > 0) process.exitCode = 1;']),
    to: J(LOCK, ['  // MUT M5: 恒退 0']),
    expect: 'test'
  },
  {
    id: 'M6',
    what: '摘掉 Gate 2b 的 shell: bash（退回默认 pwsh）⇒ 接线锁必须红',
    file: QG,
    from: J(QG, ['      - name: "Gate 2b - Desktop dev scripts (node --test)"', '        shell: bash']),
    to: J(QG, ['      - name: "Gate 2b - Desktop dev scripts (node --test)"']),
    expect: 'test'
  },
  {
    id: 'M12',
    what: '把本锁的 CLI 接回 Gate 3（那条已登记的装饰态）⇒ 反向锁必须红',
    file: QG,
    from: J(QG, ['          node .github/scripts/check-hardcoded-secrets.js']),
    to: J(QG, ['          node .github/scripts/check-hardcoded-secrets.js',
      '          node .github/scripts/check-workflow-structure.js']),
    expect: 'test'
  },
  {
    id: 'M7',
    what: '摘掉 JOB_NO_ACTION_TARGET 分支',
    file: LOCK,
    from: J(LOCK, ["    add(out, label, parts, 'JOB_NO_ACTION_TARGET', '作业必须有 steps 或 uses');"]),
    to: J(LOCK, ['    // MUT M7: 不再要求 steps/uses']),
    expect: 'test'
  },
  {
    id: 'M8',
    what: '摘掉 runs-on 判据（QM-6 双模型独立命中的 CRITICAL）',
    file: LOCK,
    from: J(LOCK, ["      add(out, label, parts.concat('runs-on'), 'JOB_MISSING_RUNS_ON', '带 steps 的作业必须声明 runs-on');"]),
    to: J(LOCK, ['      // MUT M8: 不再要求 runs-on']),
    expect: 'test'
  },
  {
    id: 'M9',
    what: '摘掉 steps/uses 互斥判据（QM-6 双模型独立命中的 MAJOR）',
    file: LOCK,
    from: J(LOCK, ["      add(out, label, parts, 'JOB_BOTH_STEPS_AND_USES', 'steps 与 uses 只能二选一：普通作业 / 复用另一个 workflow');"]),
    to: J(LOCK, ['      // MUT M9: 不再互斥']),
    expect: 'test'
  },
  {
    id: 'M10',
    what: '把"扫描器自身故障"的 rc=2 退化成 rc=1 ⇒ 三档退出码区分必须红',
    file: LOCK,
    from: J(LOCK, ['    process.exitCode = 2;']),
    to: J(LOCK, ['    process.exitCode = 1;']),
    expect: 'test'
  },
  {
    id: 'M11',
    what: '把 runs-on 判据从"带 steps 的作业"扩成"所有作业"⇒ 复用型作业的合规正控必须红',
    file: LOCK,
    from: J(LOCK, ["  if (Object.prototype.hasOwnProperty.call(job, 'steps')) {", '    // 两条互斥/必需判据由 QM-6 双模型独立命中']),
    to: J(LOCK, ["  if (!Object.prototype.hasOwnProperty.call(job, 'runs-on')) {", "    add(out, label, parts.concat('runs-on'), 'JOB_MISSING_RUNS_ON', 'MUT M11: 无条件要求 runs-on');", '  }', "  if (Object.prototype.hasOwnProperty.call(job, 'steps')) {", '    // 两条互斥/必需判据由 QM-6 双模型独立命中']),
    expect: 'test'
  }
];

function runTests () {
  try {
    execFileSync(process.execPath, ['--test', TEST], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' });
    return { red: false, out: '' };
  } catch (err) {
    return { red: true, out: String(err.stdout || '') + String(err.stderr || '') };
  }
}

function runCli () {
  try {
    return { rc: 0, out: execFileSync(process.execPath, [LOCK], { cwd: ROOT, stdio: 'pipe', encoding: 'utf8' }) };
  } catch (err) {
    return { rc: typeof err.status === 'number' ? err.status : -1, out: String(err.stdout || '') + String(err.stderr || '') };
  }
}

const results = [];
for (const m of MUTATIONS) {
  const file = path.join(ROOT, m.file);
  const before = fs.readFileSync(file, 'utf8');
  const hits = before.split(m.from).length - 1;
  if (hits === 0) {
    results.push({ id: m.id, verdict: 'SKIPPED_ANCHOR', note: '锚点未命中，变异没有发生；from=' + JSON.stringify(m.from.slice(0, 70)) });
    continue;
  }
  // String.replace(字符串锚点) 只替换**第一处**命中。锚点不唯一时，变异可能打在
  // 另一个同形位置上——被测对象没变而驱动照跑，会把"锁没抓住"写进结论。
  if (hits !== 1) {
    results.push({ id: m.id, verdict: 'SKIPPED_ANCHOR', note: '锚点命中 ' + hits + ' 处，不唯一 ⇒ 注入落点不可归因' });
    continue;
  }
  fs.writeFileSync(file, before.replace(m.from, m.to));
  let verify;
  try {
    const t = runTests();
    if (m.expect === 'both') {
      const c = runCli();
      verify = t.red && c.rc !== 0
        ? { verdict: 'CAUGHT', note: 'testRed=true cliRc=' + c.rc + ' cli=' + c.out.trim().split('\n').slice(-1)[0] }
        : { verdict: 'NOT_CAUGHT', note: 'testRed=' + t.red + ' cliRc=' + c.rc };
    } else {
      verify = t.red
        ? { verdict: 'CAUGHT', note: '首个红=' + (t.out.match(/✖ [^\n]+/) || ['(未抓到用例行)'])[0] }
        : { verdict: 'NOT_CAUGHT', note: '变异后照绿' };
    }
  } finally {
    fs.writeFileSync(file, before);
    if (fs.readFileSync(file, 'utf8') !== before) {
      verify = { verdict: 'RESTORE_FAILED', note: '还原后字节不一致' };
    }
  }
  results.push({ id: m.id, ...verify });
}

const baseTest = runTests();
const baseCli = runCli();
console.log('=== 变异结果（每条含 what）===');
for (const m of MUTATIONS) {
  const r = results.find((x) => x.id === m.id) || { verdict: 'MISSING' };
  console.log(`${r.verdict.padEnd(15)} ${m.id}  ${m.what}`);
  console.log(`                  ↳ ${r.note || ''}`);
}
console.log('=== 还原后基线 ===');
console.log('tests red? ' + baseTest.red + '   cli rc=' + baseCli.rc + '   ' + baseCli.out.trim());
const bad = results.filter((r) => r.verdict !== 'CAUGHT');
console.log(bad.length === 0 ? 'ALL_MUTATIONS_CAUGHT=' + results.length : 'MUTATION_BAD=' + JSON.stringify(bad));
const ok = bad.length === 0 && !baseTest.red && baseCli.rc === 0;
console.log('DRIVER_RC=' + (ok ? 0 : 1));
process.exitCode = ok ? 0 : 1;
