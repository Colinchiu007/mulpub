// 判据自带回归锁：桌面 vitest 前置构建（preload 产物重建）装配契约
//
// 动因（2026-10-17，change: electron-ci-preload-build）：
// PR #3782（bundle-untrack）把 preload / paginator 产物移出版本控制，并只在
// quality-gate.yml 的三个 job 里插了「Build preload bundles」重建步骤 —— 它的
// 安全性论证因此**只对 quality-gate.yml 成立**，另外两条同样跑 apps/desktop 的
// vitest 的 workflow 被漏掉，于是 main 长期红灯：
//   - electron-ci.yml#electron-tests：`Unit tests` 直接跑桌面 vitest，两条锁读到
//     不存在的 preload 产物 ⇒ 2 条用例红；且该步骤带 `if: … != 'pull_request'`
//     ⇒ **PR 侧被跳过，PR 全绿不构成「修好了」的证据**（本文件 T1 把这条钉住）；
//   - clock-shift-oracle.yml#clock-shift-oracle：候选集含 apps/desktop 用例 ⇒
//     基线趟先红 ⇒ 判据报 ORACLE_NOT_AUTHORITATIVE 并**以 rc=0 退出** —— 红变成了
//     静默降级，比红更糟（本文件用 T4 钉住「缺失满足器必须 rc=1」）。
//
// 本文件锁四件事：
//   ① 域内 job 与登记表逐条对齐，且每条域内条目之前都有 preload 重建（T1）；
//   ② 域外控制点确实被扫到但确实不进域（T2）—— 防「没扫到」被读成「合规」；
//   ③ 两类漏配（BUILD_MISSING / BUILD_NOT_BEFORE_TESTS）各能把 rc 打红（T3/T4）；
//   ④ 「散文里的 --filter」不得制造域内假条目（T5，受控 A/B）。
// 其余用例（T6-T9）锁五形态判定分支、登记表各判定码、CLI 三档退出码与常量自洽。
//
// 约定：真仓读数取 `node .github/scripts/check-desktop-test-prereqs.js`，
// 夹具读数取本文件的合成 workflow（逐条断言，不用快照）。
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');
const { spawnSync } = require('node:child_process');

const lock = require('./check-desktop-test-prereqs.js');

const REPO_ROOT = path.resolve(__dirname, '..', '..');
const LOCK_REL = path.join('.github', 'scripts', 'check-desktop-test-prereqs.js');
const REGISTRY_REL = path.join('.github', 'scripts', 'desktop-test-prereq-jobs.json');
const WORKFLOWS_REL = path.join('.github', 'workflows');

// 判据模块不导出该步骤名（它是 workflow 侧的事实，不是判据的常量）⇒ 在测试里自带
const SATISFIER_STEP_NAME = 'Build preload bundles';

// 域内集合必须**恰好**是这四条。新增/减少都要在本文件里显式过目（不是自动跟随）。
const FIXED_JOB_KEYS = [
  'clock-shift-oracle.yml#clock-shift-oracle',
  'electron-ci.yml#electron-tests',
  'quality-gate.yml#coverage',
  'quality-gate.yml#desktop-shards'
];

// 域外控制点：每条都实测有 ≥1 条条目，用来反证「不进域」不是「没扫到」
// （0 条目的 job 无法作反证：它的 inDomain=false 与「扫描器瞎了」同形）。
const OUT_OF_DOMAIN_CONTROLS = [
  { key: 'autonomous-loop.yml#loop', minEntries: 1 },
  { key: 'build.yml#build', minEntries: 1 },
  { key: 'gui-test.yml#gui-test', minEntries: 1 },
  { key: 'quality-gate.yml#static-gates', minEntries: 1 },
  { key: 'quality-gate.yml#unit-tests', minEntries: 1 },
  { key: 'visual-test.yml#visual-test', minEntries: 1 }
];

// ---------------------------------------------------------------- 夹具

const FIXTURE_ROOTS = [];

function makeFixtureRoot () {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'mp-desktop-prereqs-'));
  FIXTURE_ROOTS.push(root);
  return root;
}

test.after(() => {
  for (const root of FIXTURE_ROOTS) {
    try {
      fs.rmSync(root, { recursive: true, force: true });
    } catch (err) {
      // 夹具清理失败不影响判据结论（临时目录由 OS 回收）
    }
  }
});

function copyInto (root, rel) {
  const to = path.join(root, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(path.join(REPO_ROOT, rel), to);
}

/**
 * 建「真仓快照」夹具根：14 份 workflow + 根/桌面 package.json + 登记表。
 * 逐份复制真文件（而不是合成最小集）有两个理由：闭包解析要读真 package.json 脚本表；
 * 摘除类反证必须作用在真文本上，合成文本摘不出「真仓到底缺了什么」。
 */
function makeRepoSnapshot () {
  const root = makeFixtureRoot();
  const names = fs.readdirSync(path.join(REPO_ROOT, WORKFLOWS_REL)).filter((name) => /\.ya?ml$/.test(name));
  for (const name of names) copyInto(root, path.join(WORKFLOWS_REL, name));
  copyInto(root, 'package.json');
  copyInto(root, path.join('apps', 'desktop', 'package.json'));
  copyInto(root, REGISTRY_REL);
  // 委托形态（2026-10-21 起 electron-ci 把桌面全量交棒给 scripts/electron-ci-desktop-step.js）
  // 的判据读的是**被委托脚本自己的源码**，而它按 collect 传入的 root 取文件 —— 快照根里若不带上
  // 这些源码，`electron-ci.yml#electron-tests` 就会在夹具里"不在域内"，于是每条反证都被 STALE_REQUIRED
  // 掩盖成另一种红（夹具与真仓判的不是同一件事）。所以：扫快照里所有 workflow 文本，
  // 凡 `node scripts/<x>.js` 点名的脚本，真仓有就带上。
  const delegated = new Set();
  for (const name of names) {
    const text = readFixtureFile(root, path.join(WORKFLOWS_REL, name));
    for (const m of text.matchAll(/node\s+scripts\/([\w.-]+\.js)/g)) delegated.add(m[1]);
  }
  for (const file of delegated) {
    const rel = path.join('scripts', file);
    if (fs.existsSync(path.join(REPO_ROOT, rel))) copyInto(root, rel);
  }
  return root;
}

function writeFixtureFile (root, rel, text) {
  const to = path.join(root, rel);
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.writeFileSync(to, text, 'utf8');
  return to;
}

function readFixtureFile (root, rel) {
  return fs.readFileSync(path.join(root, rel), 'utf8');
}

/**
 * 夹具登记表 = 真仓 required 四条 + 调用方追加项。
 * 追加项要写全 workflow/job（判据用 `${workflow}#${job}` 作键），why 至少 8 字符。
 */
function writeRegistry (root, extraRequired) {
  const real = JSON.parse(readFixtureFile(root, REGISTRY_REL));
  const items = real.required.concat(extraRequired || []).map((item) => ({
    workflow: item.workflow,
    job: item.job,
    why: item.why
  }));
  const registry = { _comment: real._comment, _allowEmptyDomain: false, required: items, exempt: [] };
  writeFixtureFile(root, REGISTRY_REL, JSON.stringify(registry, null, 2) + '\n');
  return registry;
}

/**
 * 行级摘除一个 step：命中 `- name: <name>` 行后，连同其后缩进更深（或空行）的行一起删。
 * 不用 YAML 往返（load 再 dump）：dump 会重排空行与引号风格，夹具就不再等于真文件，
 * 被证伪的也就不是「真仓少写这一步」这件事了。
 * @returns {{text: string, removed: number}}
 */
function removeStepByName (text, name) {
  const lines = text.split('\n');
  const out = [];
  let removed = 0;
  for (let i = 0; i < lines.length; i++) {
    const match = /^(\s*)- name:\s*(.*?)\s*$/.exec(lines[i]);
    if (match && match[2] === name) {
      const indent = match[1].length;
      removed += 1;
      i += 1;
      while (i < lines.length) {
        const line = lines[i];
        if (line.trim() === '') { i += 1; continue }
        const deeper = /^(\s*)\S/.exec(line);
        if (!deeper || deeper[1].length <= indent) break;
        i += 1;
      }
      i -= 1; // 外层 for 会 +1，退回一格以免吃掉下一个 step 的 `- name:` 行
      continue;
    }
    out.push(lines[i]);
  }
  return { text: out.join('\n'), removed };
}

/** 合成 step（YAML 片段），与真仓同样的 `run: |` 形态 */
function stepYaml (step) {
  const lines = ['      - name: ' + step.name];
  if (step.if !== undefined) lines.push('        if: ' + step.if);
  lines.push('        run: |');
  for (const runLine of step.run.split('\n')) lines.push(runLine.length > 0 ? '          ' + runLine : '');
  return lines.join('\n');
}

/** 合成 workflow：jobs 是 [jobId, steps[]] 的数组（保持书写顺序，便于按下标断言） */
function workflowYaml (title, jobs) {
  const lines = ['name: ' + title, 'on: workflow_dispatch', 'jobs:'];
  for (const job of jobs) {
    lines.push('  ' + job.id + ':');
    lines.push('    runs-on: ubuntu-latest');
    lines.push('    steps:');
    for (const step of job.steps) lines.push(stepYaml(step));
  }
  return lines.join('\n') + '\n';
}

function writeFixtureWorkflow (root, file, jobs) {
  writeFixtureFile(root, path.join(WORKFLOWS_REL, file), workflowYaml(file, jobs));
}

// ---------------------------------------------------------------- 读数助手

function jobByKey (result, key) {
  const job = result.jobs.find((item) => item.key === key);
  assert.ok(job, '读数里应当存在 job ' + key + '（对象不存在时断言会读成通过）');
  return job;
}

function codesOf (result) {
  return result.problems.map((problem) => problem.code);
}

/** 域内条目的紧凑投影：`step[i] <form> ref=<ref>` */
function inDomainEntryRefs (job) {
  return job.entries
    .filter((entry) => entry.verdict.inDomain)
    .map((entry) => 'step[' + entry.index + '] ' + entry.form + ' ref=' + entry.ref);
}

/** 全部条目的紧凑投影：`<form>|<ref>|<code>`（判定分支逐条钉住） */
function entryProjection (job) {
  return job.entries.map((entry) => entry.form + '|' + entry.ref + '|' + entry.verdict.code);
}

/** 跑判据 CLI（真实进程 ⇒ 同时验证退出码与 stdout 报告） */
function runLockCli (args) {
  const result = spawnSync(process.execPath, [LOCK_REL].concat(args), { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

// ---------------------------------------------------------------- 夹具常量（与探针逐字一致）

const PRELOAD_STEP = { name: SATISFIER_STEP_NAME, run: 'pnpm --filter @multi-publish/desktop run build:preload' };
const PAGINATOR_STEP = { name: 'Build paginator', run: 'pnpm --filter @multi-publish/desktop run build:paginator' };
const VUE_STEP = { name: 'Build all bundles', run: 'pnpm --filter @multi-publish/desktop run build:vue' };
const FILTER_TEST_STEP = { name: 'Desktop tests', run: 'pnpm --filter @multi-publish/desktop test -- --maxWorkers=1' };

// T5 的受控 A/B：两段文本只差一个 `pnpm ` 前缀，其余逐字相同
const PROSE_RUN = "Write-Host '  测试：--filter @multi-publish/desktop test'";
const PROSE_WITH_PNPM_RUN = 'pnpm ' + PROSE_RUN;
const COMMENT_RUN = '# pnpm --filter @multi-publish/desktop run test';

// ---------------------------------------------------------------- T1：真仓正向

test('T1 真仓：域内 job 与登记表逐条对齐，且每条域内条目之前都有 preload 重建', () => {
  const result = lock.collect({ root: REPO_ROOT });

  // ① 扫描面规模下界：先证明「扫到了东西」，否则后面所有「零欠债」都是假的
  assert.ok(result.workflows.length >= lock.MIN_WORKFLOW_FILES,
    '扫到 ' + result.workflows.length + ' 份 workflow，低于下界 ' + lock.MIN_WORKFLOW_FILES + '（扫描器失明？）');
  assert.ok(result.jobs.length >= lock.MIN_JOBS,
    '扫到 ' + result.jobs.length + ' 个 job，低于下界 ' + lock.MIN_JOBS);
  const entrySum = result.jobs.reduce((sum, job) => sum + job.entries.length, 0);
  assert.equal(entrySum, result.entries.length, 'jobs 的条目总数必须等于顶层 entries（否则某一侧的账被吞了）');

  // ② 真仓零欠债（唯一正控：本判据在真仓上必须绿，否则它拦不住任何东西）
  assert.deepEqual(codesOf(result), [],
    '真仓必须零欠债，实测：' + JSON.stringify(result.problems));

  // ③ 域内集合恰好是登记表四条 —— 两边各自与 FIXED_JOB_KEYS 比，才能区分
  //    「判据漏扫」与「登记表少写」两种走向相反的缺陷
  assert.deepEqual(result.domain.map((job) => job.key).sort(), FIXED_JOB_KEYS.slice().sort(),
    '域内 job 集合变了：请显式过目 FIXED_JOB_KEYS 与 .github/scripts/desktop-test-prereq-jobs.json');
  assert.deepEqual(result.registry.required.map((item) => item.workflow + '#' + item.job).sort(),
    FIXED_JOB_KEYS.slice().sort(), '登记表的 required 必须与 FIXED_JOB_KEYS 逐条对齐');
  assert.equal(result.registry._allowEmptyDomain, false, '登记表必须明示不允许空域（空域 = 扫描器失准）');
  assert.deepEqual(result.registry.exempt, [], '本轮没有豁免项；新增豁免要在这里显式过目');

  // ④ 每条域内条目之前都有 preload 重建（这是本判据存在的全部理由）
  for (const key of FIXED_JOB_KEYS) {
    const job = jobByKey(result, key);
    assert.equal(job.inDomain, true, key + ' 必须判进域（判外 = 该 job 的桌面 vitest 无人守）');
    const inDomainEntries = job.entries.filter((entry) => entry.verdict.inDomain);
    assert.ok(inDomainEntries.length >= 1,
      key + ' 判进域却没有任何域内条目（域内而无条目 = 判定面空转）');

    const satisfiers = job.steps.filter((step) => step.name === SATISFIER_STEP_NAME);
    assert.equal(satisfiers.length, 1,
      key + ' 应当恰有一条名为「' + SATISFIER_STEP_NAME + '」的步骤，实测 ' + satisfiers.length + ' 条');
    const satisfier = satisfiers[0];
    assert.ok(satisfier.codeView.includes('build:preload'),
      key + ' 的 ' + SATISFIER_STEP_NAME + ' 未调用 build:preload');
    assert.ok(satisfier.codeView.includes('build:paginator'),
      key + ' 的 ' + SATISFIER_STEP_NAME + ' 必须同批重建 paginator 产物' +
      '（#3782 把 preload 与 paginator 产物同批移出版本控制，只重建一半仍会缺文件）');
    assert.ok(satisfier.index <= inDomainEntries[0].index,
      key + ' 的重建步骤在第一条测试用例之后（' + satisfier.index + ' > ' + inDomainEntries[0].index + '）');
    for (const entry of inDomainEntries) {
      assert.ok(job.satisfierSteps.some((index) => index <= entry.index),
        key + ' step[' + entry.index + '] 之前没有满足器，satisfierSteps=' + JSON.stringify(job.satisfierSteps));
    }
  }

  // ⑤ PR 侧被 if 跳过的步骤必须有一条 NOTE（否则「PR 全绿」会被读成「这条判据跑过了」）
  assert.ok(result.notes.some((note) =>
    note.startsWith('electron-ci.yml#electron-tests step[') && note.includes('pull_request')),
  'notes 里应当留下「electron-ci 的桌面试测试步骤在 PR 侧被跳过」的告警，实测：' + JSON.stringify(result.notes));
});

// ---------------------------------------------------------------- T2：域外反失明

test('T2 真仓：域外控制点确实被扫到（≥1 条目）但确实不进域', () => {
  const result = lock.collect({ root: REPO_ROOT });

  for (const control of OUT_OF_DOMAIN_CONTROLS) {
    const job = jobByKey(result, control.key);
    assert.equal(job.inDomain, false, control.key + ' 不应判进域');
    assert.ok(job.entries.length >= control.minEntries,
      control.key + ' 只扫到 ' + job.entries.length + ' 条条目（0 条 = 没扫到，' +
      '它的 inDomain=false 与「扫描器瞎了」同形，不能当反证）');
    assert.deepEqual(job.entries.filter((entry) => entry.verdict.inDomain), [],
      control.key + ' 是域外控制点，不应有域内条目');
  }

  // 「扫到了」之外还要证明「判对了」：每种形态至少有一个域外控制点带着它的判定码
  // （下界式断言：不锚条目总数，真仓新增同类用法不会假红）
  const codes = (key) => jobByKey(result, key).entries.map((entry) => entry.verdict.code);
  assert.ok(codes('quality-gate.yml#unit-tests').includes('no-desktop-excluded'),
    'root-nx 里带 --exclude=@multi-publish/desktop 的形态应判 no-desktop-excluded');
  assert.ok(codes('build.yml#build').includes('config-scoped-vitest'),
    '带 --config 的 vitest 调用应判 config-scoped-vitest（它测的不是桌面全量套件）');
  assert.ok(codes('quality-gate.yml#static-gates').includes('dry-run-only'),
    'oracle 的 --dry-run 趟应判 dry-run-only（域外自检，不消费桌面用例）');
  assert.ok(codes('autonomous-loop.yml#loop').includes('no-vitest-in-closure'),
    '只重建产物、不跑 vitest 的脚本闭包应判 no-vitest-in-closure');
});

// ---------------------------------------------------------------- T3/T4：两类漏配各能把 rc 打红

test('T3 反证：摘掉 electron-ci 里新插的重建步骤 ⇒ BUILD_NOT_BEFORE_TESTS ⇒ rc=1', () => {
  const root = makeRepoSnapshot();
  const rel = path.join(WORKFLOWS_REL, 'electron-ci.yml');
  const removed = removeStepByName(readFixtureFile(root, rel), SATISFIER_STEP_NAME);
  assert.equal(removed.removed, 1, '夹具必须在真文件上摘掉恰好一条步骤，实测 ' + removed.removed);
  writeFixtureFile(root, rel, removed.text);
  assert.ok(typeof yaml.load(readFixtureFile(root, rel)) === 'object',
    '摘块不得把文件弄坏，否则测的是 YAML 解析失败而不是判据结论');

  const result = lock.collect({ root });
  const job = jobByKey(result, 'electron-ci.yml#electron-tests');
  assert.equal(job.steps.some((step) => step.name === SATISFIER_STEP_NAME), false, '夹具里该步骤应当已消失');
  assert.equal(job.inDomain, true, '摘掉重建步骤不改变它跑桌面 vitest 的事实');
  // 关键：这个 job 还有 `Build Vue frontend`（闭包含 build-preload.js）⇒ 判据仍认为有满足器，
  // 于是本用例量的是**顺序**缺陷（BUILD_NOT_BEFORE_TESTS），而不是缺失缺陷
  assert.ok(job.satisfierSteps.length >= 1,
    '夹具前提失效：electron-ci 里应当还有别的 preload 满足器，实测 satisfierSteps=' +
    JSON.stringify(job.satisfierSteps));
  assert.deepEqual(codesOf(result), ['BUILD_NOT_BEFORE_TESTS'],
    '实测：' + JSON.stringify(result.problems));
  assert.ok(result.problems[0].message.includes('electron-ci.yml#electron-tests'));
  assert.ok(result.problems[0].message.includes('step['),
    'BUILD_NOT_BEFORE_TESTS 的消息必须点名出问题的 step 下标，实测：' + result.problems[0].message);

  const cli = runLockCli(['--root', root]);
  assert.equal(cli.status, 1, '顺序型漏配必须 rc=1，实测 stdout：' + cli.stdout.slice(0, 400));
  assert.ok(cli.stdout.includes('BUILD_NOT_BEFORE_TESTS'), 'CLI 报告里必须出现该码');
});

test('T4 反证：摘掉 clock-shift-oracle 里唯一的重建步骤 ⇒ BUILD_MISSING ⇒ rc=1', () => {
  const root = makeRepoSnapshot();
  const rel = path.join(WORKFLOWS_REL, 'clock-shift-oracle.yml');
  const removed = removeStepByName(readFixtureFile(root, rel), SATISFIER_STEP_NAME);
  assert.equal(removed.removed, 1, '夹具必须在真文件上摘掉恰好一条步骤，实测 ' + removed.removed);
  writeFixtureFile(root, rel, removed.text);
  assert.ok(typeof yaml.load(readFixtureFile(root, rel)) === 'object');

  const result = lock.collect({ root });
  const job = jobByKey(result, 'clock-shift-oracle.yml#clock-shift-oracle');
  assert.equal(job.inDomain, true);
  assert.deepEqual(job.satisfierSteps, [],
    '摘掉后可验证的满足器应当为空，实测 ' + JSON.stringify(job.satisfierSteps));
  assert.deepEqual(codesOf(result), ['BUILD_MISSING'], '实测：' + JSON.stringify(result.problems));
  assert.ok(result.problems[0].message.includes('clock-shift-oracle.yml#clock-shift-oracle'));

  const cli = runLockCli(['--root', root]);
  // 动因：oracle 原形态是「基线趟先红 ⇒ 判据 rc=0 静默降级」，红得看不见。
  // 本判据的 rc=1 才是那个缺失信号的可拦形态。
  assert.equal(cli.status, 1, '缺失满足器必须 rc=1（不得静默降级），实测 stdout：' + cli.stdout.slice(0, 400));
  assert.ok(cli.stdout.includes('BUILD_MISSING'));
});

// ---------------------------------------------------------------- T5：散文里的 --filter（受控 A/B）

test('T5 受控 A/B：散文里的 --filter 不产域内条目（前 80 字符有无 pnpm 是唯一变量）', () => {
  const root = makeRepoSnapshot();
  writeFixtureWorkflow(root, 'zz-guard.yml', [
    { id: 'prose', steps: [{ name: 'Prose', run: PROSE_RUN }] },
    { id: 'prose-with-pnpm', steps: [PRELOAD_STEP, { name: 'Prose with pnpm', run: PROSE_WITH_PNPM_RUN }] },
    { id: 'comment-only', steps: [PRELOAD_STEP, { name: 'Comment', run: COMMENT_RUN }] }
  ]);
  writeRegistry(root, [
    { workflow: 'zz-guard.yml', job: 'prose-with-pnpm', why: '受控对照：同样文本前置 pnpm 后必须进域（正控）' }
  ]);

  // 结构前提：两段文本只差一个前缀，否则「唯一变量」这句话是假的
  assert.equal(PROSE_WITH_PNPM_RUN, 'pnpm ' + PROSE_RUN);
  assert.ok(lock.viewFlat(PROSE_RUN).includes('--filter @multi-publish/desktop'),
    '前置条件失效：平视图里应当能看到这段散文中的 --filter');
  assert.equal(lock.stripLineComment(COMMENT_RUN).trim(), '',
    '前置条件失效：注释行应当被剥成空串（否则注释态与散文态不可区分）');

  const result = lock.collect({ root });
  assert.deepEqual(codesOf(result), [], '实测：' + JSON.stringify(result.problems));

  const prose = jobByKey(result, 'zz-guard.yml#prose');
  assert.equal(prose.inDomain, false, '散文里的 --filter 不得判进域');
  assert.deepEqual(prose.entries, [],
    '守卫必须整条拒掉（0 条目），而不是「先产条目再判域外」——后者会把噪声留在报告里');

  // 正控：同文本前置 pnpm 后必须进域，且域内条目只能是那条 desktop-filter（pnpm-verb 的
  // `Write-Host` 噪声不锚总数）
  const withPnpm = jobByKey(result, 'zz-guard.yml#prose-with-pnpm');
  assert.equal(withPnpm.inDomain, true, '前置 pnpm 后应判进域（否则守卫的收窄面无法界定）');
  assert.deepEqual(withPnpm.satisfierSteps, [0]);
  assert.deepEqual(inDomainEntryRefs(withPnpm), ['step[1] desktop-filter ref=test'],
    '实测：' + JSON.stringify(entryProjection(withPnpm)));

  const commentOnly = jobByKey(result, 'zz-guard.yml#comment-only');
  assert.equal(commentOnly.inDomain, false, '注释行不得判进域');
  assert.equal(commentOnly.steps[0].entries.length, 1,
    '守卫的作用域必须是「命中那一条步骤」而不是整个 job：同一 job 里真正的 build 步仍须产条目' +
    '（若实现成「整 job 拒掉」，这条会变成 0，把只重建了一半的 job 一起静默放过）');
  assert.equal(commentOnly.steps[1].entries.length, 0,
    '注释在平视图与代码视图两个视图里都必须被剥除（只剥一个视图会留下「假绿面」）');
});

// ---------------------------------------------------------------- T6：判定分支逐个钉住（合成夹具）

test('T6 合成夹具：五形态的每个判定分支逐条钉住 + 未知形态不虚报', () => {
  const root = makeRepoSnapshot();
  const VITEST_INLINE = { name: 'Inline vitest', run: 'pnpm exec vitest run' };
  const UNION_ROOT = { name: 'Root test', run: 'pnpm run test' };
  const NX_EXCLUDED = { name: 'Affected', run: 'pnpm run test:all:no-desktop' };
  const NX_INCLUDED = { name: 'All', run: 'pnpm run test:all' };
  const ORACLE_FULL = { name: 'Oracle full', run: 'node scripts/check-clock-shift-oracle.js --shift-days=45' };
  const ORACLE_DRY = { name: 'Oracle dry', run: 'node scripts/check-clock-shift-oracle.js --dry-run' };
  const NX_DIRECT = { name: 'Nx direct', run: 'nx run-many -t test --all --parallel=1' };
  const CONFIG_SCOPED = { name: 'Startup', run: 'pnpm --filter @multi-publish/desktop run test:startup' };
  const UNKNOWN = { name: 'Unknown', run: 'pnpm run totally-unknown' };
  const PREFIXED_UNKNOWN = { name: 'Prefixed', run: 'pnpm run test-not-registered' };

  writeFixtureWorkflow(root, 'zz-a.yml', [
    { id: 'prose', steps: [{ name: 'Prose', run: PROSE_RUN }] },
    { id: 'guard-pass', steps: [PRELOAD_STEP, FILTER_TEST_STEP] }
  ]);
  writeFixtureWorkflow(root, 'zz-b.yml', [{ id: 'filter-after', steps: [FILTER_TEST_STEP, PRELOAD_STEP] }]);
  writeFixtureWorkflow(root, 'zz-c.yml', [{ id: 'paginator-only', steps: [PAGINATOR_STEP, FILTER_TEST_STEP] }]);
  writeFixtureWorkflow(root, 'zz-d.yml', [{ id: 'transitive', steps: [VUE_STEP, FILTER_TEST_STEP] }]);
  writeFixtureWorkflow(root, 'zz-e.yml', [{ id: 'vitest-inline', steps: [PRELOAD_STEP, VITEST_INLINE] }]);
  writeFixtureWorkflow(root, 'zz-f.yml', [{ id: 'union-root', steps: [PRELOAD_STEP, UNION_ROOT] }]);
  writeFixtureWorkflow(root, 'zz-g.yml', [{ id: 'root-nx-excluded', steps: [PRELOAD_STEP, NX_EXCLUDED] }]);
  writeFixtureWorkflow(root, 'zz-h.yml', [{ id: 'root-nx-included', steps: [PRELOAD_STEP, NX_INCLUDED] }]);
  writeFixtureWorkflow(root, 'zz-i.yml', [
    { id: 'oracle-full', steps: [PRELOAD_STEP, ORACLE_FULL] },
    { id: 'oracle-dry', steps: [ORACLE_DRY] }
  ]);
  writeFixtureWorkflow(root, 'zz-j.yml', [{ id: 'nx-direct', steps: [PRELOAD_STEP, NX_DIRECT] }]);
  writeFixtureWorkflow(root, 'zz-k.yml', [{ id: 'config-scoped', steps: [PRELOAD_STEP, CONFIG_SCOPED] }]);
  // ⑥ delegate 形态：三锚齐 ⇒ 域内；缺一锚 ⇒ 域外；**遮挡**（注释里先出现另一个脚本名）仍须域内。
  writeFixtureFile(root, 'scripts/zz-delegate-desktop.js',
    "const DESKTOP_PKG = '@multi-publish/desktop';\n"
    + "module.exports = { build() { return ['--filter', DESKTOP_PKG, 'test', '--shard=1/2']; } };\n");
  writeFixtureFile(root, 'scripts/zz-delegate-no-shard.js',
    "const DESKTOP_PKG = '@multi-publish/desktop';\n"
    + "module.exports = { build() { return ['--filter', DESKTOP_PKG, 'test']; } };\n");
  writeFixtureWorkflow(root, 'zz-m.yml', [
    { id: 'delegate-desktop', steps: [PRELOAD_STEP, { name: 'Delegated', run: 'node scripts/zz-delegate-desktop.js\n' }] },
    // 注释里点名另一个脚本：`viewFlat` 已剥注释 ⇒ 不得凭空多出一条域内/域外条目
    { id: 'delegate-comment', steps: [PRELOAD_STEP, { name: 'DelegatedComment', run: '# 复测入口 node scripts/zz-delegate-no-shard.js\nnode scripts/zz-delegate-desktop.js\n' }] },
    // 两个**都是可执行**的候选：必须扫全部并按语义判定 —— 只取第一个会把真委托档在后面（PR #4192 实测的同型缺陷）
    { id: 'delegate-two-candidates', steps: [PRELOAD_STEP, { name: 'DelegatedTwo', run: 'node scripts/zz-delegate-no-shard.js && node scripts/zz-delegate-desktop.js\n' }] },
    { id: 'delegate-no-shard', steps: [PRELOAD_STEP, { name: 'DelegatedNoShard', run: 'node scripts/zz-delegate-no-shard.js\n' }] },
    { id: 'delegate-missing-file', steps: [PRELOAD_STEP, { name: 'DelegatedMissing', run: 'node scripts/zz-delegate-absent.js\n' }] }
  ]);
  writeFixtureWorkflow(root, 'zz-l.yml', [
    { id: 'unknown-script', steps: [PRELOAD_STEP, UNKNOWN] },
    { id: 'prefixed-unknown', steps: [PRELOAD_STEP, PREFIXED_UNKNOWN] }
  ]);
  writeRegistry(root, [
    'zz-a.yml#guard-pass', 'zz-b.yml#filter-after', 'zz-c.yml#paginator-only', 'zz-d.yml#transitive',
    'zz-e.yml#vitest-inline', 'zz-f.yml#union-root', 'zz-h.yml#root-nx-included', 'zz-i.yml#oracle-full',
    'zz-j.yml#nx-direct', 'zz-l.yml#prefixed-unknown',
    'zz-m.yml#delegate-desktop', 'zz-m.yml#delegate-comment', 'zz-m.yml#delegate-two-candidates'
  ].map((key) => {
    const parts = key.split('#');
    return { workflow: parts[0], job: parts[1], why: '夹具正控：这条 job 会跑桌面 vitest，用于逐条验证判定分支' };
  }));

  const result = lock.collect({ root });

  // ① 欠债恰好三条 —— 夹具同时暴露「顺序缺陷」「缺失缺陷」「形态上界」三类，
  //    每类各一条，多一条说明某个域外用例被误判进域
  assert.deepEqual(codesOf(result).slice().sort(), ['BUILD_MISSING', 'BUILD_NOT_BEFORE_TESTS', 'FORM_COUNT_EXCEEDED'],
    '实测：' + JSON.stringify(result.problems));
  const messageOf = (code) => result.problems.find((problem) => problem.code === code).message;
  assert.ok(messageOf('FORM_COUNT_EXCEEDED').includes('nx-direct'),
    '上界超限必须点名形态，实测：' + messageOf('FORM_COUNT_EXCEEDED'));
  assert.ok(messageOf('BUILD_NOT_BEFORE_TESTS').includes('zz-b.yml#filter-after step[0]'),
    '顺序缺陷必须点名 job 与 step，实测：' + messageOf('BUILD_NOT_BEFORE_TESTS'));
  assert.ok(messageOf('BUILD_MISSING').includes('zz-c.yml#paginator-only'),
    '缺失缺陷必须点名 job，实测：' + messageOf('BUILD_MISSING'));

  // ② 每个 job 的条目投影（form|ref|判定码）—— 判定分支的逐条快照
  const EXPECTED_ENTRIES = {
    'zz-a.yml#prose': [],
    'zz-a.yml#guard-pass': ['desktop-filter|build:preload|no-vitest-in-closure', 'desktop-filter|test|vitest'],
    'zz-b.yml#filter-after': ['desktop-filter|test|vitest', 'desktop-filter|build:preload|no-vitest-in-closure'],
    'zz-c.yml#paginator-only': ['desktop-filter|build:paginator|no-vitest-in-closure', 'desktop-filter|test|vitest'],
    'zz-d.yml#transitive': ['desktop-filter|build:vue|no-vitest-in-closure', 'desktop-filter|test|vitest'],
    'zz-e.yml#vitest-inline': ['desktop-filter|build:preload|no-vitest-in-closure', 'pnpm-verb|vitest|vitest-inline'],
    'zz-f.yml#union-root': ['desktop-filter|build:preload|no-vitest-in-closure', 'pnpm-verb|test|vitest'],
    'zz-g.yml#root-nx-excluded': ['desktop-filter|build:preload|no-vitest-in-closure',
      'root-nx|test:all:no-desktop|no-desktop-excluded', 'pnpm-verb|test:all:no-desktop|no-desktop-excluded'],
    'zz-h.yml#root-nx-included': ['desktop-filter|build:preload|no-vitest-in-closure',
      'root-nx|test:all|nx-invokes-desktop-tests', 'pnpm-verb|test:all|nx-invokes-desktop-tests'],
    'zz-i.yml#oracle-full': ['desktop-filter|build:preload|no-vitest-in-closure',
      'oracle-cli|scripts/check-clock-shift-oracle.js|oracle-cli',
      'delegate|scripts/check-clock-shift-oracle.js|delegate-not-desktop-suite'],
    'zz-i.yml#oracle-dry': ['oracle-cli|scripts/check-clock-shift-oracle.js|dry-run-only',
      'delegate|scripts/check-clock-shift-oracle.js|delegate-not-desktop-suite'],
    'zz-j.yml#nx-direct': ['desktop-filter|build:preload|no-vitest-in-closure',
      'nx-direct|(nx-direct)|nx-invokes-desktop-tests'],
    'zz-k.yml#config-scoped': ['desktop-filter|build:preload|no-vitest-in-closure',
      'desktop-filter|test:startup|config-scoped-vitest'],
    'zz-m.yml#delegate-desktop': ['desktop-filter|build:preload|no-vitest-in-closure',
      'delegate|scripts/zz-delegate-desktop.js|delegate-runs-desktop-suite'],
    'zz-m.yml#delegate-comment': ['desktop-filter|build:preload|no-vitest-in-closure',
      'delegate|scripts/zz-delegate-desktop.js|delegate-runs-desktop-suite'],
    'zz-m.yml#delegate-two-candidates': ['desktop-filter|build:preload|no-vitest-in-closure',
      'delegate|scripts/zz-delegate-no-shard.js|delegate-not-desktop-suite',
      'delegate|scripts/zz-delegate-desktop.js|delegate-runs-desktop-suite'],
    'zz-m.yml#delegate-no-shard': ['desktop-filter|build:preload|no-vitest-in-closure',
      'delegate|scripts/zz-delegate-no-shard.js|delegate-not-desktop-suite'],
    'zz-m.yml#delegate-missing-file': ['desktop-filter|build:preload|no-vitest-in-closure',
      'delegate|scripts/zz-delegate-absent.js|delegate-not-desktop-suite'],
    'zz-l.yml#unknown-script': ['desktop-filter|build:preload|no-vitest-in-closure',
      'pnpm-verb|totally-unknown|unknown-script'],
    'zz-l.yml#prefixed-unknown': ['desktop-filter|build:preload|no-vitest-in-closure',
      'pnpm-verb|test-not-registered|unregistered-test-script']
  };
  const EXPECTED_IN_DOMAIN = {
    'zz-a.yml#prose': false,
    'zz-a.yml#guard-pass': true,
    'zz-b.yml#filter-after': true,
    'zz-c.yml#paginator-only': true,
    'zz-d.yml#transitive': true,
    'zz-e.yml#vitest-inline': true,
    'zz-f.yml#union-root': true,
    'zz-g.yml#root-nx-excluded': false,
    'zz-h.yml#root-nx-included': true,
    'zz-m.yml#delegate-desktop': true,
    'zz-m.yml#delegate-comment': true,
    'zz-m.yml#delegate-two-candidates': true,
    'zz-m.yml#delegate-no-shard': false,
    'zz-m.yml#delegate-missing-file': false,
    'zz-i.yml#oracle-full': true,
    'zz-i.yml#oracle-dry': false,
    'zz-j.yml#nx-direct': true,
    'zz-k.yml#config-scoped': false,
    'zz-l.yml#unknown-script': false,
    'zz-l.yml#prefixed-unknown': true
  };
  const EXPECTED_SATISFIER = {
    'zz-a.yml#prose': [],
    'zz-a.yml#guard-pass': [0],
    'zz-b.yml#filter-after': [1],
    'zz-c.yml#paginator-only': [],
    'zz-d.yml#transitive': [0],
    'zz-e.yml#vitest-inline': [0],
    'zz-f.yml#union-root': [0],
    'zz-g.yml#root-nx-excluded': [0],
    'zz-h.yml#root-nx-included': [0],
    'zz-i.yml#oracle-full': [0],
    'zz-i.yml#oracle-dry': [],
    'zz-j.yml#nx-direct': [0],
    'zz-k.yml#config-scoped': [0],
    'zz-m.yml#delegate-desktop': [0],
    'zz-m.yml#delegate-comment': [0],
    'zz-m.yml#delegate-two-candidates': [0],
    'zz-m.yml#delegate-no-shard': [0],
    'zz-m.yml#delegate-missing-file': [0],
    'zz-l.yml#unknown-script': [0],
    'zz-l.yml#prefixed-unknown': [0]
  };
  for (const key of Object.keys(EXPECTED_ENTRIES)) {
    const job = jobByKey(result, key);
    assert.deepEqual(entryProjection(job), EXPECTED_ENTRIES[key], key + ' 的条目投影变了');
    assert.equal(job.inDomain, EXPECTED_IN_DOMAIN[key], key + ' 的域内判定变了');
    assert.deepEqual(job.satisfierSteps, EXPECTED_SATISFIER[key], key + ' 的满足器集合变了');
  }

  // ③ 传递闭包：`build:vue` 经 `build` 摸到 preload 产物 ⇒ 算满足器（touchesPreload）；
  //    而单独一个 `build:paginator` 不算（zz-c 已由 BUILD_MISSING 证明）
  const transitive = jobByKey(result, 'zz-d.yml#transitive').entries[0];
  assert.equal(transitive.verdict.touchesPreload, true, 'build:vue 的闭包含 build:preload，应判 touchesPreload');
  assert.deepEqual(transitive.verdict.closure.slice().sort(), [
    'desktop:build', 'desktop:build:paginator', 'desktop:build:preload', 'desktop:build:vue', 'root:build'
  ].sort(), '闭包应当逐级展开到 build:preload');
  const paginatorOnly = jobByKey(result, 'zz-c.yml#paginator-only').entries[0];
  assert.equal(paginatorOnly.verdict.touchesPreload, false,
    '只重建 paginator 不算满足器（#3782 缺的是 preload 产物，不是 paginator）');
  // 根 `test` 是并集（root:test + desktop:test），而 test:all:no-desktop 显式排除桌面
  const unionRoot = jobByKey(result, 'zz-f.yml#union-root').entries[1];
  assert.deepEqual(unionRoot.verdict.closure.slice().sort(), ['desktop:test', 'root:test'].sort(),
    '根 test 脚本同时调用根与桌面的 test ⇒ 必须判进域');
  const oracleDry = jobByKey(result, 'zz-i.yml#oracle-dry').entries[0];
  assert.equal(oracleDry.verdict.inDomain, false,
    '只在 --dry-run 趟调用 oracle 不消费桌面用例（域外自检）');

  // ④ 形态计数：与真仓基线取差 —— 数字随真仓增长时本用例不得假红，
  //    但夹具引入的**增量**必须与逐条判定一致（多一处形态命中 = 有噪声被当成命令）
  const baseline = lock.collect({ root: makeRepoSnapshot() });
  const delta = {};
  for (const form of lock.FORM_KEYS) delta[form] = result.formCounts[form] - baseline.formCounts[form];
  assert.deepEqual(delta, {
    'desktop-filter': 23, 'pnpm-verb': 6, 'root-nx': 2, 'nx-direct': 1, 'oracle-cli': 2, delegate: 8
  }, '夹具的形态增量变了（真仓基线 ' + JSON.stringify(baseline.formCounts) +
    '，夹具 ' + JSON.stringify(result.formCounts) + '）');
  // delegate 增量的逐条来源必须可枚举（8 = zz-m 的 6 条 + zz-i 两条 oracle 步骤各 1 条）：
  // 这一句把"数字对上了但不知道多在哪"挡掉——增量必须能逐项归因，否则它只是另一个漂移的数。
  const delegateRefs = result.jobs.filter((j) => j.key.startsWith('zz-'))
    .reduce((n, j) => n + j.entries.filter((e) => e.form === 'delegate').length, 0);
  assert.equal(delegateRefs, 8, 'delegate 条目应逐条来自夹具的 6+2 处 `node scripts/*.js`，实测 ' + delegateRefs);
});

// ---------------------------------------------------------------- T7：登记表判据的分支

test('T7 登记表判据：形状/重复/冲突/陈旧/未登记各分支', () => {
  const KEY = 'zz-lock.yml#job-a';
  const OTHER = 'zz-lock.yml#job-b';
  const WHY = '这是一条足够长的说明文案';
  const domain = [{ key: KEY }];
  const context = { workflows: [{ file: 'zz-lock.yml', jobs: ['job-a', 'job-b'] }] };
  /** 跑一次 judgeRegistry，返回排序后的码（排序比较，不锚定内部 push 顺序） */
  const codes = (inputDomain, registry, ctx) =>
    lock.judgeRegistry(inputDomain, registry, ctx || context).map((problem) => problem.code).sort();
  const items = (keys, why) => keys.map((key) => {
    const parts = key.split('#');
    return { workflow: parts[0], job: parts[1], why: why || WHY };
  });

  // ① 形状不合法 ⇒ 单码 + **早退**（若继续走，空域会再叠加 UNREGISTERED_IN_DOMAIN，
  //    让「登记表写坏了」与「有 job 没登记」两件事混在一条报告里）
  for (const bad of [null, {}, { required: [] }, { required: {}, exempt: [] }, { required: [], exempt: {} }]) {
    assert.deepEqual(codes(domain, bad), ['REGISTRY_INVALID'], '形状 ' + JSON.stringify(bad) + ' 应判 REGISTRY_INVALID');
  }
  assert.equal(lock.judgeRegistry(domain, null, context).length, 1, '形状不合法必须早退（只出一条）');
  // 登记表写坏是**欠债**不是扫描器故障：若判成 fatal，CLI 会 rc=2，整条 PR 被读成「工具坏了」而无人去修登记表
  assert.equal(lock.judgeRegistry(domain, null, context)[0].severity, 'debt');

  // ② why 太短
  assert.deepEqual(codes(domain, { required: items([KEY], '太短'), exempt: [] }), ['REGISTRY_INVALID']);

  // ③ 同一列表内部重复（required / exempt 各一次）
  assert.deepEqual(codes(domain, { required: items([KEY, KEY]), exempt: [] }), ['REGISTRY_INVALID']);
  const dupInExempt = lock.judgeRegistry(domain, { required: [], exempt: items([KEY, KEY]) }, context);
  assert.deepEqual(dupInExempt.map((problem) => problem.code), ['REGISTRY_INVALID']);
  assert.ok(dupInExempt[0].message.includes('登记重复'), '实测：' + dupInExempt[0].message);

  // ④ 同键同时出现在两侧 ⇒ EXEMPT_CONFLICT（与「列表内部重复」必须是两种码，
  //    否则「这条已经豁免了」和「这条写了两次」在报告里无法区分）
  const conflict = lock.judgeRegistry(domain, { required: items([KEY]), exempt: items([KEY]) }, context);
  assert.deepEqual(conflict.map((problem) => problem.code), ['EXEMPT_CONFLICT'],
    '实测：' + JSON.stringify(conflict));
  assert.ok(conflict[0].message.includes('同时出现在 required 与 exempt'),
    '实测：' + conflict[0].message);

  // ⑤ 域内 job 未登记
  assert.deepEqual(codes(domain, { required: [], exempt: [] }), ['UNREGISTERED_IN_DOMAIN']);

  // ⑥ 已不在域内（required / exempt 两条陈旧诊断）
  assert.deepEqual(codes([], { required: items([KEY]), exempt: items([OTHER]) }), ['STALE_EXEMPT', 'STALE_REQUIRED']);

  // ⑦ 指向不存在的 workflow / job
  assert.deepEqual(codes([], { required: items(['nope.yml#job-a']), exempt: [] }), ['REGISTRY_STALE', 'STALE_REQUIRED']);
  assert.deepEqual(codes(domain, { required: items([KEY, 'zz-lock.yml#job-ghost']), exempt: [] }),
    ['REGISTRY_STALE', 'STALE_REQUIRED']);

  // ⑧ 合规形态必须零码（否则上面每一条红都可能是「判据恒红」造成的）
  assert.deepEqual(codes(domain, { required: items([KEY]), exempt: [] }), []);

  // ⑨ 多码并存：B 同时登记两侧且不在域内 ⇒ 三条诊断同时成立
  assert.deepEqual(codes(domain, { required: items([KEY, OTHER]), exempt: items([OTHER]) }),
    ['EXEMPT_CONFLICT', 'STALE_EXEMPT', 'STALE_REQUIRED']);
});

// ---------------------------------------------------------------- T8：规模下界 / 上界 / 接线

test('T8 常量与当场读数自洽，且锁本体与它的用例都被 CI 点名', () => {
  const result = lock.collect({ root: REPO_ROOT });

  // ① 五形态的键集与判定用的键集必须同源（少一个键 ⇒ 该形态不受任何上下界保护）
  assert.deepEqual(Object.keys(result.formCounts).slice().sort(), lock.FORM_KEYS.slice().sort());
  for (const form of lock.FORM_KEYS) {
    assert.ok(Object.prototype.hasOwnProperty.call(lock.MIN_FORM_COUNTS, form),
      form + ' 缺规模下界 ⇒ 该形态可以静默归零而不报错');
    const actual = result.formCounts[form];
    assert.ok(actual >= lock.MIN_FORM_COUNTS[form],
      form + ' 实测 ' + actual + ' 低于下界 ' + lock.MIN_FORM_COUNTS[form] + '（扫描面缩小了）');
  }
  for (const form of Object.keys(lock.MAX_FORM_COUNTS)) {
    assert.ok(lock.FORM_KEYS.includes(form), '上界表里出现了不在 FORM_KEYS 里的形态 ' + form);
    assert.ok(result.formCounts[form] <= lock.MAX_FORM_COUNTS[form],
      form + ' 实测 ' + result.formCounts[form] + ' 超过上界 ' + lock.MAX_FORM_COUNTS[form]);
  }
  // 下界只许收缩成「实测值」的下方：写成等于实测值时任何新增都会假红（那是上界，不是下界）
  for (const form of lock.FORM_KEYS) {
    assert.ok(lock.MIN_FORM_COUNTS[form] <= result.formCounts[form],
      form + ' 的下界不该高于实测值');
  }

  // ② 域内每个 job 至少有 1 条域内条目 —— 域内而无条目 = 判定面空转（job 被记进域，却没有任何一条被判）
  for (const job of result.domain) {
    assert.ok(job.entries.filter((entry) => entry.verdict.inDomain).length >= 1,
      job.key + ' 判进域却零域内条目');
  }

  // ③ 登记表自身不得有重复键（判据只在运行时报 REGISTRY_INVALID，静态看一眼更早）
  const registry = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, REGISTRY_REL), 'utf8'));
  const keys = registry.required.map((item) => item.workflow + '#' + item.job);
  assert.equal(new Set(keys).size, keys.length, '登记表 required 有重复键：' + JSON.stringify(keys));

  // ④ 接线：锁本体与它的用例都必须被 workflow 显式点名。这条不是形式主义 ——
  //    本仓 vitest 不收 .github/scripts/，没有点名时文件永远不会被执行，而它看起来「已存在」。
  const gate = fs.readFileSync(path.join(REPO_ROOT, WORKFLOWS_REL, 'quality-gate.yml'), 'utf8');
  assert.ok(gate.includes('node --test .github/scripts/check-desktop-test-prereqs.test.js'),
    'quality-gate.yml 未点名本文件的测试（未接线 = 永不执行）');
  assert.ok(gate.includes('node .github/scripts/check-desktop-test-prereqs.js'),
    'quality-gate.yml 未点名锁本体');
  // 接线必须落在 bash 步骤里：PowerShell 步骤不会因中间命令非零而中止，
  // 把新门禁接进 pwsh 步骤等于接进一条「前面红了后面照绿」的装饰门禁
  const stepStart = gate.lastIndexOf('- name:', gate.indexOf('node --test .github/scripts/check-desktop-test-prereqs.test.js'));
  const stepHead = gate.slice(stepStart, gate.indexOf('node --test .github/scripts/check-desktop-test-prereqs.test.js'));
  assert.ok(!/shell:\s*pwsh/.test(stepHead), '本判据不得被接进 pwsh 步骤（pipeline 只认最后一条命令的退出码）');
});

// ---------------------------------------------------------------- T9：CLI 三档

test('T9 CLI：三档退出码、两种 --root 写法、JSON 载荷与 GitHub 注解', () => {
  const real = lock.collect({ root: REPO_ROOT });

  // ① 真仓 rc=0 + JSON 载荷与进程内读数逐项一致（载荷是 CI 消费面，不能只是「能 parse」）
  const jsonRun = runLockCli(['--json']);
  assert.equal(jsonRun.status, 0, '真仓必须 rc=0，实测 stdout：' + jsonRun.stdout.slice(0, 400));
  const payload = JSON.parse(jsonRun.stdout);
  assert.equal(typeof payload.root, 'string');
  assert.ok(payload.workflowCount >= lock.MIN_WORKFLOW_FILES, 'JSON 载荷里的 workflowCount 低于下界');
  assert.ok(payload.jobCount >= lock.MIN_JOBS, 'JSON 载荷里的 jobCount 低于下界');
  assert.equal(payload.entryCount, real.entries.length);
  assert.deepEqual(payload.formCounts, real.formCounts);
  assert.deepEqual(payload.domain.map((job) => job.key), real.domain.map((job) => job.key));
  assert.deepEqual(payload.problems, [], '真仓 JSON 载荷必须零问题');
  assert.ok(payload.notes.length > 0, 'JSON 载荷必须带上 notes（PR 侧跳过测试的告警靠它传播）');
  for (const job of payload.domain) {
    assert.ok(Array.isArray(job.satisfierSteps) && job.satisfierSteps.length >= 1,
      job.key + ' 的 satisfierSteps 不能为空');
    assert.ok(job.entries.length >= 1, job.key + ' 的域内条目不能为空');
    for (const entry of job.entries) {
      assert.deepEqual(Object.keys(entry).slice().sort(),
        ['closure', 'code', 'form', 'ref', 'stepIndex'], '域内条目字段集变了（下游解析会受影响）');
    }
    assert.ok(job.satisfierSteps.some((index) => index <= job.entries[0].stepIndex),
      job.key + ' 的第一条域内条目之前没有满足器');
  }

  // ② 域外/空根 ⇒ rc=2（自身故障），不得读成「零欠债」
  const emptyRoot = makeFixtureRoot();
  const emptyRun = runLockCli(['--root', emptyRoot]);
  assert.equal(emptyRun.status, 2, '扫不到任何 workflow 必须 rc=2，实测 stdout：' + emptyRun.stdout.slice(0, 400));
  assert.ok(emptyRun.stdout.includes('[FATAL:SCAN_FAILURE]'),
    '空根必须落在 SCAN_FAILURE（而不是 YAML_PARSE_FAILURE），实测：' + emptyRun.stdout.slice(0, 400));

  // ③ 欠债 ⇒ rc=1 + 报告行 + GitHub 注解；两种 --root 写法都要生效
  const debtRoot = makeRepoSnapshot();
  const rel = path.join(WORKFLOWS_REL, 'electron-ci.yml');
  writeFixtureFile(debtRoot, rel, removeStepByName(readFixtureFile(debtRoot, rel), SATISFIER_STEP_NAME).text);
  for (const args of [['--root', debtRoot], ['--root=' + debtRoot]]) {
    const run = runLockCli(args);
    assert.equal(run.status, 1, JSON.stringify(args) + ' 应 rc=1，实测：' + run.stdout.slice(0, 400));
    assert.ok(run.stdout.includes('[DEBT:BUILD_NOT_BEFORE_TESTS]'),
      JSON.stringify(args) + ' 必须打出 [DEBT:...] 报告行');
    assert.ok(run.stdout.includes('::error title=BUILD_NOT_BEFORE_TESTS::'),
      JSON.stringify(args) + ' 必须打出 GitHub 注解（CI 摘要靠它定位）');
    assert.ok(run.stdout.includes('problems: fatal=0 debt=1'),
      JSON.stringify(args) + ' 的计数行应如实报 1 条欠债，实测：' + run.stdout.slice(-300));
  }

  // ④ --verbose 出全量明细（含域外），--help / -h 直接放行不下场扫描
  const verboseRun = runLockCli(['--root', debtRoot, '--verbose']);
  assert.equal(verboseRun.status, 1);
  assert.ok(verboseRun.stdout.includes('全部 job 的命中明细'), '--verbose 应打印全量明细');
  for (const flag of ['--help', '-h']) {
    const helpRun = runLockCli([flag]);
    assert.equal(helpRun.status, 0, flag + ' 必须 rc=0');
    assert.ok(helpRun.stdout.includes('用法：'), flag + ' 必须打用法');
    assert.ok(!helpRun.stdout.includes('[desktop-test-prereqs] root='), flag + ' 不应下场扫描');
  }

  // ⑤ 未知旗标 / 空取值一律 rc=2 且点名 ARGS_INVALID（静默忽略会让 CI 里写错的参数变成假绿）
  for (const args of [['--nope'], ['--root'], ['--root=']]) {
    const run = runLockCli(args);
    assert.equal(run.status, 2, JSON.stringify(args) + ' 应 rc=2');
    assert.ok(run.stderr.includes('ARGS_INVALID'), JSON.stringify(args) + ' 应点名 ARGS_INVALID');
  }
  assert.equal(lock.parseArgs(['--json', '--root', 'scripts']).json, true);
  assert.equal(lock.parseArgs(['--root=scripts']).root, path.resolve('scripts'));
});

// ---------------------------------------------------------------- T10：委托形态的真仓归属

test('T10 真仓：electron-tests 必须**因为委托判据**留在域内，删登记与"认名字"都不是修法', () => {
  const real = lock.collect({ root: REPO_ROOT });
  const job = real.jobs.find((j) => j.key === 'electron-ci.yml#electron-tests');
  assert.ok(job, 'electron-ci.yml#electron-tests 必须仍在扫描域里（作业被删了就要同步删登记，不许留着）');
  assert.equal(job.inDomain, true,
    '这一步现在委托给 scripts/electron-ci-desktop-step.js ⇒ 若本条变 false，说明委托判据退化，'
    + '而退化的现场是 STALE_REQUIRED 红 ⇒ 最省事的"修法"会是删登记，那正好把这条 required 检查的覆盖关掉');
  const codes = job.entries.map((e) => e.verdict.code);
  assert.ok(codes.includes('delegate-runs-desktop-suite'), '域内判定必须来自委托形态，实测 ' + JSON.stringify(codes));
  // ⛔ 反向：那一步（step 8）不得再有任何"workflow 自己写桌面命令"的命中 ——
  // 若哪天有人把内联命令塞回来，本条会红，而那正是"两份实现"的开端（唯一真源在脚本里）。
  const testStepIdx = job.entries.find((e) => e.verdict.code === 'delegate-runs-desktop-suite').index;
  assert.ok(!job.entries.some((e) => e.index === testStepIdx && e.form !== 'delegate'),
    'electron-ci 的测试步不该再自带桌面 --filter/pnpm 调用（判据与形状的唯一实现是 scripts/electron-ci-desktop-step.js），实测 '
      + JSON.stringify(job.entries.filter((e) => e.index === testStepIdx).map((e) => e.form + '|' + e.ref)));
  // 下界必须真实存在且非 0：否则"扫不到 delegate"与"仓库里没有委托"不可区分
  assert.ok(lock.MIN_FORM_COUNTS.delegate >= 1, 'delegate 形态下界缺失 ⇒ 扫描器失明会被读成合规');
  assert.ok(real.formCounts.delegate >= lock.MIN_FORM_COUNTS.delegate,
    '真仓 delegate 命中数低于下界：实测 ' + real.formCounts.delegate);
  // 登记表那条 why 不得继续描述被搬走的旧形态（注释替实现说谎 = 下一个会话照抄错前提）
  const reg = JSON.parse(fs.readFileSync(path.join(REPO_ROOT, lock.REGISTRY_REL), 'utf8'));
  const item = reg.required.find((r) => r.workflow === 'electron-ci.yml' && r.job === 'electron-tests');
  assert.ok(item && /委托|delegate/.test(item.why),
    'electron-ci 登记项的 why 必须改成描述委托形态，实测 ' + JSON.stringify(item && item.why));
  assert.ok(!/pnpm --filter @multi-publish\/desktop test/.test(item.why),
    'why 里不得再写已被搬走的内联命令形态');
  // 委托判据读的是**传入 root 那棵树**里的脚本源码：把脚本从快照里摘掉 ⇒ 该 job 立刻不在域内
  const snapshot = makeRepoSnapshot();
  fs.rmSync(path.join(snapshot, 'scripts', 'electron-ci-desktop-step.js'));
  const orphan = lock.collect({ root: snapshot });
  const orphanJob = orphan.jobs.find((j) => j.key === 'electron-ci.yml#electron-tests');
  assert.equal(orphanJob.inDomain, false,
    '摘掉被委托的脚本后仍判域内 ⇒ 说明判据在按名字/白名单认，而不是按被点名脚本自己的源码');
  assert.ok(orphan.problems.some((p) => p.code === 'STALE_REQUIRED'),
    '读不到委托源码必须走 fail-closed（"没有委托"），并让登记表把它作为陈旧项点名');
});
