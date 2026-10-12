const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');
const { execFileSync } = require('node:child_process');

const { checkWorkflowText, collect, REPO_ROOT } = require('./check-workflow-structure.js');

// 违规投影：只留判据关心的三件事，避免断言被消息措辞绑死（改文案不该让锁红）。
const codes = (violations) => violations.map((v) => v.code)
const paths = (violations) => violations.map((v) => v.path)

function codesOf (text, label) {
  return codes(checkWorkflowText(text, label || 'fixture.yml'))
}

// ---- 反证 1：本锁的动因形态，逐字复刻 main 上真实坏掉的那一段 ----
// 2026-10-11 的 87e311c45 (#3200) 在"修 rebase 重复键"时顺手删掉了 defaults.run.shell: bash，
// 留下一个空值节点。GitHub 在**排队之前**就拒绝整份文件（annotation：
// `(Line: 32, Col: 11): Unexpected value ''`），后果是 workflow 零 job、main 每次 push 红，
// 且从 main 切出的 PR 一律拿不到这条检查——不是"跑得慢"，是"根本不跑"。
// 这里必须用**同一个 YAML 形态**（键在、值为空）做反证，用别的形态证不出锁在测它声称的变量。
test('空值的 defaults.run 必须报 EMPTY_VALUE（动因形态逐字复刻）', () => {
  const broken = [
    'name: GUI Tests',
    'on:',
    '  push:',
    '    branches: [main]',
    'jobs:',
    '  gui-test:',
    '    runs-on: windows-latest',
    '    defaults:',
    '      run:',
    '',
    '    steps:',
    '      - uses: actions/checkout@v4',
    ''
  ].join('\n')
  const violations = checkWorkflowText(broken, 'gui-test.yml')
  assert.deepEqual(codesOf(broken), ['EMPTY_VALUE'], '动因形态没被抓住，锁是装饰性的')
  assert.deepEqual(paths(violations), ['jobs.gui-test.defaults.run'],
    '必须点名坏掉的那个位置，只报"有问题"不足以定位')
})

// ---- 反证 2-6：其余"空值/缺必需节点"形态逐个抓住 ----
test('空映射与缺失必需节点逐个变红', () => {
  assert.deepEqual(codesOf('name: x\non: push\njobs: {}'), ['JOBS_INVALID'])
  assert.deepEqual(codesOf([
    'on: push',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    defaults:',
    '      run: {}',
    '    steps:',
    '      - run: echo hi',
    ''
  ].join('\n')), ['DEFAULTS_EMPTY'])
  // 步骤既无 uses 也无 run
  assert.deepEqual(codesOf('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - name: 空步骤\n'),
    ['STEP_NO_ACTION'])
  // 同时给 uses 与 run
  assert.deepEqual(codesOf('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - uses: a/b@v1\n        run: echo hi\n'),
    ['STEP_BOTH_USES_RUN'])
  // run 是空白串：语法合法、GitHub 同样拒绝
  assert.deepEqual(codesOf('on: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: "   "\n'),
    ['STEP_RUN_EMPTY'])
  // 作业既无 steps 也无 uses
  assert.deepEqual(codesOf('on: push\njobs:\n  a:\n    runs-on: x\n'), ['JOB_NO_ACTION_TARGET'])
  // 带 steps 却不声明 runs-on —— GitHub 同样在排队前拒绝（QM-6 两个模型独立命中）
  assert.deepEqual(codesOf('on: push\njobs:\n  a:\n    steps:\n      - run: echo hi\n'), ['JOB_MISSING_RUNS_ON'])
  // steps 与 uses 并存（复用 workflow 调用与普通作业混写）
  assert.deepEqual(codesOf('on: push\njobs:\n  a:\n    runs-on: x\n    uses: o/r/.github/workflows/called.yml@main\n    steps:\n      - run: echo hi\n'),
    ['JOB_BOTH_STEPS_AND_USES'])
  // 语法本身坏掉：必须报成违规而不是让 collect() 抛穿/静默跳过
  assert.deepEqual(codesOf('name: x\non: push\njobs: [1, 2, 3\n'), ['YAML_PARSE_FAIL'])
})

// ---- 正控：合法写法不得被误伤 ----
// 缺了这一组，"把所有 null 一律判红"也能让上面两条反证通过，而那样的锁会拦掉
// workflow_dispatch: 这种 GitHub 明确允许的省略配置——规则宽严必须同时被证。
test('合法的空事件配置与省略配置不得报红', () => {
  const ok = [
    'name: ok',
    'on:',
    '  workflow_dispatch:',
    '  pull_request:',
    '    branches: [main]',
    'jobs:',
    '  a:',
    '    runs-on: ubuntu-latest',
    '    defaults:',
    '      run:',
    '        shell: bash',
    '    steps:',
    '      - uses: actions/checkout@v4',
    '      - name: 跑点东西',
    '        run: echo hi',
    '        env:',
    '          FOO: bar',
    ''
  ].join('\n')
  assert.deepEqual(codesOf(ok), [], '合法形态被误判 ⇒ 规则过宽')
  // `on: push` 标量简写同样是合法省略配置
  assert.deepEqual(codesOf('name: ok\non: push\njobs:\n  a:\n    runs-on: x\n    steps:\n      - run: echo hi\n'), [])
  // 复用另一个 workflow 的作业：既没有 steps 也没有 runs-on，是合法形态
  // （判据若把"缺 runs-on"挂在所有作业上，就会把这一类正当写法判红）
  assert.deepEqual(codesOf('on: push\njobs:\n  call-other:\n    uses: o/r/.github/workflows/called.yml@main\n    with:\n      ref: main\n'), [],
    '复用型作业不得被 runs-on/steps 判据误伤')
})

// ---- 真实仓库：扫描域非空 + 零违规 ----
// "扫到 0 个文件"与"扫到 13 个文件全合规"在只断言 violations 为空时不可区分，
// 所以扫描域本身必须有下界与成员点名（解析退化成空集合即假绿）。
test('真实仓库全部 workflow 合规，且扫描域确实覆盖到它们', () => {
  const result = collect({ root: REPO_ROOT })
  assert.ok(result.files.length >= 12,
    'workflow 扫描域退化：files=' + result.files.length + '（本仓实测 13 份）')
  assert.ok(result.files.some((f) => /gui-test\.yml$/.test(f)),
    '动因文件必须在扫描域内：' + result.files.join(','))
  assert.deepEqual(result.violations.map((v) => v.label + ':' + v.path + '(' + v.code + ')'), [],
    'main 上的 workflow 必须逐份通过结构校验')
})

// ---- CLI 出口：坏文件必须让进程非零 ----
// 门禁真正接进 CI 的是命令行出口；只测函数会把"函数对但 CLI 恒退 0"留在暗处。
// 三档退出码必须互相可区分：0 = 合规，1 = 发现违规，2 = 扫描器自身读不到目录。
// 判据默认 root 由 __dirname 推导而不是 cwd，所以这里**故意从别处启动**：既证明它不依赖
// cwd，也避免"测试恰好跑在仓库里"把这条性质掩盖掉。
test('CLI：仓库现状退 0，注入坏文件的临时目录退 1，读不到目录退 2', () => {
  const script = path.join(__dirname, 'check-workflow-structure.js');
  const elsewhere = os.tmpdir();
  assert.doesNotThrow(() => execFileSync(process.execPath, [script], { cwd: elsewhere, stdio: 'pipe' }),
    '对真实仓库必须退 0（且不得依赖 cwd）');

  const dir = path.join(os.tmpdir(), 'mp-wf-bad-' + process.pid + '-' + Math.random().toString(36).slice(2, 8));
  const wfDir = path.join(dir, '.github', 'workflows');
  fs.mkdirSync(wfDir, { recursive: true });
  try {
    fs.writeFileSync(path.join(wfDir, 'bad.yml'), [
      'name: bad',
      'on: push',
      'jobs:',
      '  a:',
      '    runs-on: x',
      '    defaults:',
      '      run:',
      '    steps:',
      '      - run: echo hi',
      ''
    ].join('\n'), 'utf8')
    let threw = false;
    try {
      execFileSync(process.execPath, [script, '--root=' + dir], { cwd: elsewhere, stdio: 'pipe', encoding: 'utf8' });
    } catch (err) {
      threw = true;
      assert.equal(err.status, 1, '发现违规必须是 rc=1（rc=2 是"扫描器自身故障"，两者不得混）');
      assert.match(String(err.stdout || '') + String(err.stderr || ''), /EMPTY_VALUE/);
    }
    assert.equal(threw, true, '坏 workflow 必须让 CLI 非零退出，否则门禁不阻断');

    // 扫描器自身故障：目录不存在 ⇒ rc=2 + ERROR:，不得伪装成"发现违规"
    let rc2 = 0;
    let out2 = '';
    try {
      execFileSync(process.execPath, [script, '--root=' + path.join(dir, 'no-such-here')], { cwd: elsewhere, stdio: 'pipe', encoding: 'utf8' });
    } catch (err) {
      rc2 = err.status;
      out2 = String(err.stdout || '') + String(err.stderr || '');
    }
    assert.equal(rc2, 2, '读不到 workflow 目录必须退 2，与"发现违规"的 1 区分开');
    assert.match(out2, /ERROR:/, '自身故障必须点名 ERROR:，裸栈会被读成门禁发现违规');
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

// ---- 接线锁：判据必须落在一个"真会跑、红了真会拦"的位置 ----
// 「写了测试」≠「接进 CI」≠「接的位置能拦住」。本锁的落点是 quality-gate.yml 的 Gate 3，
// 而那个步骤历史上是 pwsh：一个 run 块里多条命令不 fail-fast，只有最后一条的退出码决定成败
// （#3357 在正文末尾补的 `if ($LASTEXITCODE -ne 0)` 只转存最后一条，第一行的 node --test 红掉
// 时步骤照样绿）。所以"必须 bash"要由锁钉住，而不是由注释里的一句话约定。
test('CI 接线：Gate 3 必须 bash、必须点名测试与 CLI，且所在 job 不会被 docs-only 短路', () => {
  const wfPath = path.join(REPO_ROOT, '.github', 'workflows', 'quality-gate.yml');
  const wf = yaml.load(fs.readFileSync(wfPath, 'utf8'));
  const job = wf.jobs['static-gates'];
  assert.ok(job, 'quality-gate.yml 必须有 static-gates 作业（本锁的宿主）');

  const gate3 = (job.steps || []).find((s) => /Gate 3 - Hardcoded secrets scan/.test(String(s.name || '')));
  assert.ok(gate3, '必须存在 Gate 3 步骤');
  assert.equal(gate3.shell, 'bash',
    'Gate 3 必须显式 shell: bash —— 默认 pwsh 下中间命令非零不中止，本锁会退化成装饰门禁');
  assert.match(String(gate3.run), /check-workflow-structure\.test\.js/,
    '测试文件必须出现在 Gate 3 的 node --test 清单里');
  assert.match(String(gate3.run), /node\s+\.github\/scripts\/check-workflow-structure\.js/,
    'CLI 本体必须被点名：只接测试等于"函数对但门禁没跑"（空白用 \\s+，不把命令写成单空格精确形状那种易碎锁）');

  // 触发前提：改坏 workflow 的 PR 必然改 .github/workflows/**；一旦这个前缀进了 docs-only 白名单，
  // static-gates 会被整片跳过，本锁对它唯一要防的那类 PR 反而不跑。
  const { CI_IGNORED_PATHS } = require(path.join(REPO_ROOT, 'scripts', 'classify-docs-only.js'));
  const workflowsIgnored = CI_IGNORED_PATHS.filter((p) => String(p).includes('.github/workflows'));
  assert.deepEqual(workflowsIgnored, [],
    '.github/workflows/** 不得进 docs-only 白名单，否则本锁对"改坏 workflow"的 PR 静默失效');
});
