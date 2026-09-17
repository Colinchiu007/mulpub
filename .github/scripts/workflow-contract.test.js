const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');

const workflowPath = path.join(__dirname, '..', 'workflows', 'visual-test.yml');
const qualityGatePath = path.join(__dirname, '..', 'workflows', 'quality-gate.yml');
const agentJudgePath = path.join(__dirname, '..', 'workflows', 'agent-judge.yml');
const buildWorkflowPath = path.join(__dirname, '..', 'workflows', 'build.yml');
const desktopPackagePath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'package.json');
const desktopVitestConfigPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'vitest.config.js');
const rootPackagePath = path.join(__dirname, '..', '..', 'package.json');

test('视觉工作流使用与基线一致的 Windows 渲染环境', () => {
  const workflow = fs.readFileSync(workflowPath, 'utf8');

  assert.match(workflow, /runs-on:\s*windows-latest/);
  assert.match(workflow, /shell:\s*pwsh/);
  assert.match(workflow, /Start-Process -FilePath "pnpm\.cmd"/);
  assert.match(workflow, /ArgumentList @\("exec", "vite", "--host", "127\.0\.0\.1", "--port", "5174"\)/);
  assert.match(workflow, /taskkill \/PID/);
  assert.match(workflow, /pnpm\.cmd run test:visual:pixel/);
  assert.doesNotMatch(workflow, /sudo apt-get|setsid bash|trap cleanup EXIT/);
  assert.doesNotMatch(workflow, /agent-visual-judge\.js \|\| true/);
});

test('Quality Gate Gate 7 与视觉工作流使用一致的渲染参数', () => {
  const workflow = fs.readFileSync(qualityGatePath, 'utf8');
  // 2026-08-09 并行化后 Gate 7 位于 visual job，其后是同 job 的 upload 步骤（原邻接 # --- Gate 8 注释已随拆分移除）
  const gate7 = workflow.match(/- name: "Gate 7 - Visual regression"[\s\S]*?(?=\n\s*- name: "Upload GUI quality artifacts")/)?.[0];

  assert.ok(gate7, 'Gate 7 workflow step must exist');
  assert.match(gate7, /TEST_URL:\s*http:\/\/127\.0\.0\.1:5174/);
  assert.match(gate7, /HEADLESS:\s*["']?true["']?/);
  assert.match(gate7, /PIXEL_THRESHOLD:\s*["']?0\.06["']?/);
});

test('Quality Gate Gate 8 在真实浏览器扫描前执行 manual 控件合同测试', () => {
  const workflow = fs.readFileSync(qualityGatePath, 'utf8');
  // 2026-08-09 并行化后 Gate 8 位于 e2e job，其后是同 job 的 upload 步骤（原邻接 # --- Gate 9 注释已随拆分移除）
  const gate8 = workflow.match(/- name: "Gate 8 - Browser E2E"[\s\S]*?(?=\n\s*- name: "Upload GUI quality artifacts")/)?.[0];

  assert.ok(gate8, 'Gate 8 workflow step must exist');
  assert.match(gate8, /node apps\/desktop\/tests\/e2e\/helpers\/route-functional-suite\.test\.js/);
  assert.match(gate8, /node apps\/desktop\/tests\/e2e\/helpers\/functional-runner\.test\.js/);
  assert.ok(
    gate8.indexOf('route-functional-suite.test.js') < gate8.indexOf('pnpm.cmd --filter @multi-publish/desktop run test:e2e'),
    'manual 控件合同测试必须先于真实 Browser E2E',
  );
  assert.ok(
    gate8.indexOf('functional-runner.test.js') < gate8.indexOf('pnpm.cmd --filter @multi-publish/desktop run test:e2e'),
    '导航恢复合同测试必须先于真实 Browser E2E',
  );
  assert.match(gate8, /\$contractExit\s*=\s*\$LASTEXITCODE/);
  assert.match(gate8, /if \(\$contractExit -ne 0\) \{ exit \$contractExit \}/);
  assert.match(gate8, /\$runnerContractExit\s*=\s*\$LASTEXITCODE/);
  assert.match(gate8, /if \(\$runnerContractExit -ne 0\) \{ exit \$runnerContractExit \}/);
  assert.match(gate8, /\$e2eExit\s*=\s*\$LASTEXITCODE/);
  assert.match(gate8, /finally\s*\{[\s\S]*?taskkill \/PID \$viteProcess\.Id \/T \/F/);
});

test('Windows 打包电影工程 E2E 先运行终态观察合同', () => {
  const workflow = fs.readFileSync(buildWorkflowPath, 'utf8');
  const contractIndex = workflow.indexOf('node apps/desktop/tests/e2e/film-engineering-real.test.js');
  const e2eIndex = workflow.indexOf('test:e2e:film-engineering');

  assert.ok(contractIndex >= 0, 'Windows build 必须运行电影工程 E2E 终态观察合同');
  assert.ok(e2eIndex >= 0, 'Windows build 必须运行电影工程真实 E2E');
  assert.ok(contractIndex < e2eIndex, '终态观察合同必须先于电影工程真实 E2E');
	});

test('Windows 打包电影工程 E2E 仅发布 tag 触发且带进程级硬看门狗', () => {
  const workflow = fs.readFileSync(buildWorkflowPath, 'utf8');
  const e2eStep = workflow.match(/- name: Run film engineering real E2E[\s\S]*?(?=\n      - name: Upload film engineering E2E report)/)?.[0];

  assert.ok(e2eStep, 'film engineering real E2E step must exist');
  assert.match(e2eStep, /startsWith\(github\.ref, 'refs\/tags\/v'\)/, '真实 E2E 必须仅发布 tag 触发');
  assert.match(e2eStep, /Start-Process -FilePath "pnpm\.cmd"/, '必须用 Start-Process 启动 E2E 进程');
  assert.match(e2eStep, /WaitForExit\(\$timeoutMs\)/, '必须用 WaitForExit 做硬超时');
  assert.match(e2eStep, /taskkill \/PID \$e2eProcess\.Id \/T \/F/, '超时必须强制杀死整个进程树');
  assert.match(e2eStep, /exit 124/, '超时必须返回非零退出码');
});

test('GUI gate Electron 步骤仅发布 tag 触发且带硬看门狗', () => {
  const guiWorkflowPath = path.join(__dirname, '..', 'workflows', 'gui-test.yml');
  const workflow = fs.readFileSync(guiWorkflowPath, 'utf8');
  const gateStep = workflow.match(/- name: Electron GUI gate[\s\S]*?(?=\n      - name: Stop Vite server)/)?.[0];

  assert.ok(gateStep, 'Electron GUI gate step must exist');
  assert.match(gateStep, /startsWith\(github\.ref, 'refs\/tags\/v'\)/, 'Electron GUI gate 必须仅发布 tag 触发');
  assert.match(gateStep, /timeout --signal=TERM --kill-after=30s 8m/, 'Electron GUI gate 必须带 8 分钟硬看门狗');
  // Windows 自托管 runner 拥有真实显示，xvfb 是 Linux-only 虚拟帧缓冲，在此不适用；
  // 契约改为断言该步骤直接启动 Electron GUI 测试，而非经 Linux-only 的 xvfb-run。
  assert.doesNotMatch(gateStep, /xvfb-run/, 'Windows 自托管 Electron GUI gate 不得依赖 Linux-only 的 xvfb-run');
  assert.match(gateStep, /node apps\/desktop\/tests\/electron-gui-v9\.js/, 'Electron GUI gate 必须直接启动 Electron GUI 测试');
});

test('桌面覆盖率门禁串行运行，避免全量 V8 coverage 资源竞争', () => {
  const desktopPackage = JSON.parse(fs.readFileSync(desktopPackagePath, 'utf8'));
  const coverageScript = desktopPackage.scripts['test:coverage'];

  assert.match(coverageScript, /--maxWorkers=1/);
  assert.match(coverageScript, /--no-file-parallelism/);
});

test('桌面默认 Vitest 串行收集，避免共享 mock 和资源型测试争用', () => {
  const source = fs.readFileSync(desktopVitestConfigPath, 'utf8');

  assert.match(source, /maxWorkers:\s*1/);
  assert.match(source, /fileParallelism:\s*false/);
  assert.match(source, /testTimeout:\s*10000/);
  assert.match(source, /hookTimeout:\s*10000/);
  assert.match(source, /teardownTimeout:\s*10000/);
  assert.match(source, /\.\.\.\(process\.env\.CI\s*\?\s*\{ reporters: \['verbose'\] \}\s*:\s*\{\}\)/);
});

test('质量门禁的全量 Vitest 有可终止的 Windows watchdog', () => {
  const workflow = fs.readFileSync(qualityGatePath, 'utf8');
  const rootPackage = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  const unitTestStep = workflow.match(
    /- name: "Gate 4 - Workspace unit tests"[\s\S]*?(?=\n\s*- name: "Gate 4b)/,
  )?.[0];

  assert.ok(unitTestStep, 'Gate 4 全工作区单元测试步骤必须存在');
  assert.equal(rootPackage.scripts.test, 'pnpm -r --if-present run test');
  assert.match(unitTestStep, /shell:\s*pwsh/);
  assert.match(unitTestStep, /Start-Process -FilePath "pnpm\.cmd"/);
  assert.match(unitTestStep, /"run",\s*"test:affected",\s*"--",\s*"--exclude=@multi-publish\/desktop"/);
  assert.match(unitTestStep, /"run",\s*"test:all",\s*"--",\s*"--exclude=@multi-publish\/desktop"/);
  assert.match(unitTestStep, /WaitForExit\(1800000\)/);
  assert.match(unitTestStep, /taskkill \/PID \$testProcess\.Id \/T \/F/);
  assert.doesNotMatch(unitTestStep, /--maxWorkers=1|--reporter=verbose|--testTimeout=10000/);
  assert.match(unitTestStep, /function Get-TestProcessTree/);
  assert.match(unitTestStep, /Get-TestProcessTree -RootProcessId \$testProcess\.Id/);
  assert.match(unitTestStep, /\$remainingTestProcesses = @\(Get-TestProcessTree -RootProcessId \$testProcess\.Id\)/);
  assert.match(unitTestStep, /Gate 4 left child processes alive after pnpm exited/);
  assert.doesNotMatch(unitTestStep, /CommandLine/);
});

test('Agent Judge 在 Windows 下使用 PowerShell 参数数组，并将无模型审计包降级为告警', () => {
  const workflow = fs.readFileSync(agentJudgePath, 'utf8');
  const judgeStep = workflow.match(/- name: Run AI Agent Judge[\s\S]*?(?=\n      # ---- 上传 artifacts)/)?.[0];
  const gateStep = workflow.match(/- name: Enforce coverage gate[\s\S]*?(?=\n      - name: |$)/)?.[0];

  assert.ok(judgeStep, 'Run AI Agent Judge step must exist');
  assert.ok(gateStep, 'Enforce coverage gate step must exist');
  assert.match(judgeStep, /shell:\s*pwsh/);
  assert.match(judgeStep, /\$judgeArgs = @\(/);
  assert.match(judgeStep, /--prd=\$env:PRD_PATH/);
  assert.match(judgeStep, /--src=\$env:SRC_PATH/);
  assert.match(judgeStep, /--llm=\$env:LLM_PROVIDER/);
  assert.match(judgeStep, /--coverageThreshold=\$env:COVERAGE_THRESHOLD/);
  assert.match(judgeStep, /\$reportStart = \[DateTimeOffset\]::UtcNow\.ToUnixTimeMilliseconds\(\)/);
  assert.match(judgeStep, /AGENT_JUDGE_REPORT_START=\$reportStart/);
  assert.match(judgeStep, /& node @judgeArgs/);
  assert.match(judgeStep, /exit \$judgeExit/);
  assert.doesNotMatch(judgeStep, /run-agent-judge\.js\s*\\/);

  assert.match(gateStep, /shell:\s*pwsh/);
  assert.match(gateStep, /\$gateArgs = @\(/);
  assert.match(gateStep, /agent-review-gate\.js/);
  assert.match(gateStep, /"agent-judge"/);
  assert.match(gateStep, /--report-dir=apps\/desktop\/tests\/visual-testing\/reports/);
  assert.match(gateStep, /--started-after=\$env:AGENT_JUDGE_REPORT_START/);
  assert.match(gateStep, /--llm-provider=\$env:LLM_PROVIDER/);
  assert.match(gateStep, /& node @gateArgs/);
  assert.doesNotMatch(gateStep, /Get-ChildItem|ConvertFrom-Json/);
  assert.match(workflow, /const reportStart = Number\(process\.env\.AGENT_JUDGE_REPORT_START\);/);
  assert.match(workflow, /mtime >= reportStart/);
});

test('自主覆盖审计仅在确认是无模型 NEED_HUMAN 报告时降级为告警', () => {
  const workflow = fs.readFileSync(qualityGatePath, 'utf8');
  const gate9 = workflow.match(/- name: "Gate 9 - Autonomous coverage audit"[\s\S]*?(?=\n      - name: "Upload GUI quality artifacts")/)?.[0];

  assert.ok(gate9, 'Gate 9 workflow step must exist');
  assert.match(gate9, /\$gateArgs = @\(/);
  assert.match(gate9, /agent-review-gate\.js/);
  assert.match(gate9, /"autonomous"/);
  assert.match(gate9, /--audit-exit-code=\$exitCode/);
  assert.match(gate9, /\$reportStart = \[DateTimeOffset\]::UtcNow\.ToUnixTimeMilliseconds\(\)/);
  assert.match(gate9, /--started-after=\$reportStart/);
  assert.match(gate9, /--has-openai-key=\$\(\[bool\]\$env:OPENAI_API_KEY\)/);
  assert.match(gate9, /if \(\$gateExit -eq 0\)/);
  assert.match(gate9, /LLM_BASE_URL: \$\{\{ secrets\.LLM_BASE_URL \}\}/);
  assert.match(gate9, /LLM_MODEL: \$\{\{ secrets\.LLM_MODEL \}\}/);
  assert.match(gate9, /AUTONOMOUS_GATE=FAIL/);
  assert.doesNotMatch(gate9, /Get-ChildItem|ConvertFrom-Json/);
  assert.match(workflow, /agent-review-gate\.test\.js/);
});

const CI_IGNORED_PATHS = [
  '01-docs/**',
  'docs/**',
  '*.md',
  'LICENSE',
  '.gitignore',
  '.editorconfig',
  '.ccg/**',
  '.claude/**',
  '.hermes/**',
  '.agents/**',
  'openspec/**',
];

test('CI 路径门控：全量 workflow 的 main PR 不得用 paths-ignore 跳过必需检查', () => {
  const names = ['build.yml', 'electron-ci.yml', 'quality-gate.yml'];
  for (const name of names) {
    const wf = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'workflows', name), 'utf8'));
    assert.deepEqual(wf.on.pull_request.branches, ['main']);
    assert.equal(
      wf.on.pull_request['paths-ignore'],
      undefined,
      `${name} 的 pull_request 不得过滤文档/流程 PR，否则 required check 会缺失`,
    );
  }
});

test('CI 路径门控：保留 push 触发的 workflow 同样使用白名单', () => {
  const names = ['build.yml', 'electron-ci.yml', 'quality-gate.yml'];
  for (const name of names) {
    const wf = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'workflows', name), 'utf8'));
    assert.deepEqual(
      wf.on.push['paths-ignore'],
      CI_IGNORED_PATHS,
      `${name} 的 push.paths-ignore 必须与 CI_IGNORED_PATHS 一致`,
    );
  }
});

test('Doc Gate 对所有 main PR 运行真实文档与测试门禁', () => {
  const wf = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'workflows', 'doc-gate.yml'), 'utf8'));
  assert.deepEqual(wf.on.pull_request.branches, undefined);
  assert.deepEqual(wf.on.pull_request.types, ['opened', 'synchronize', 'reopened']);
  assert.equal(
    wf.on.pull_request['paths-ignore'],
    undefined,
    'doc-gate 不得过滤 docs-only 或 CI-only PR，否则 required check 会缺失',
  );
});

test('Nx affected 引入契约：nx 配置与 quality-gate 双模式', () => {
  const rootPkg = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  assert.ok(rootPkg.devDependencies && rootPkg.devDependencies.nx, '根 package.json 必须声明 nx devDependency');
  assert.match(rootPkg.scripts['test:affected'], /nx affected -t test --base=origin\/main --parallel=1/);
  assert.match(rootPkg.scripts['test:all'], /nx run-many -t test --all --parallel=1/);

  const nxJson = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'nx.json'), 'utf8'));
  assert.equal(nxJson.targetDefaults.test.cache, true);

  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  assert.deepEqual(wf.on.push.branches, ['main']);
  assert.deepEqual(wf.on.push['paths-ignore'], CI_IGNORED_PATHS);
  assert.deepEqual(wf.on.pull_request.branches, ['main']);
  assert.equal(wf.on.pull_request['paths-ignore'], undefined);
  assert.ok(Object.keys(wf.on).includes('workflow_dispatch'), 'quality-gate 必须保留 workflow_dispatch');

  const src = fs.readFileSync(qualityGatePath, 'utf8');
  assert.match(src, /TEST_MODE=affected/);
  assert.match(src, /TEST_MODE=full/);
  assert.match(src, /nx affected -t test --base=origin\/main/);
  assert.match(src, /nx run-many -t test --all/);
  assert.match(src, /Restore Nx cache/);
});

test('桌面测试分片契约：desktop-shards 矩阵与 unit-tests 排除桌面', () => {
  const workflow = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  const job = workflow.jobs['desktop-shards'];
  assert.ok(job, 'desktop-shards job 必须存在');
  assert.deepEqual(job.strategy.matrix.shard, ['1/2', '2/2']);
  assert.ok(workflow.jobs['gate-result'].needs.includes('desktop-shards'), 'gate-result 必须依赖 desktop-shards');
  const src = fs.readFileSync(qualityGatePath, 'utf8');
  assert.match(src, /--shard=\$\{\{ matrix\.shard \}\}/);
  assert.match(src, /--exclude=@multi-publish\/desktop/);
  // 进程内串行确定性契约必须显式保留（W2）
  assert.match(src, /--maxWorkers=1/);
  assert.match(src, /--no-file-parallelism/);
  assert.match(src, /--testTimeout=10000/);
  // shard watchdog 必须有契约守护（W3）
  assert.match(src, /function Get-TestProcessTree/);
  assert.match(src, /WaitForExit\(1800000\)/);
  assert.match(src, /taskkill \/PID \$testProcess\.Id \/T \/F/);
  const rootPkg = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  // 死脚本清理（W1）：根 package.json 不应再有 test:desktop:shard
  assert.equal(rootPkg.scripts['test:desktop:shard'], undefined);
});

test('shared-utils 测试超时预算（冷启动 flaky 回归保护）', () => {
  const cfg = fs.readFileSync(path.join(__dirname, '..', '..', 'packages', 'shared-utils', 'vitest.config.js'), 'utf8');
  assert.match(cfg, /testTimeout:\s*10000/);
});

test('Quality Gate Gate 10 前端一致性卡点接线（desktop-ui-consistency）', () => {
  const workflow = fs.readFileSync(qualityGatePath, 'utf8');
  const gate = workflow.match(/- name: "Gate 10 - Frontend consistency[\s\S]*?(?=\r?\n\s*- name:|\r?\n  [a-z][-\w]*:)/)?.[0];
  assert.ok(gate, 'Gate 10 workflow step must exist');
  assert.match(gate, /node --test \.github\/scripts\/check-frontend-consistency\.test\.js/);
  assert.match(gate, /node \.github\/scripts\/check-frontend-consistency\.js/);
  // 契约：卡点脚本与其基线文件必须真实存在
  assert.ok(fs.existsSync(path.join(__dirname, 'check-frontend-consistency.js')), 'checkpoint script must exist');
  assert.ok(fs.existsSync(path.join(__dirname, 'frontend-consistency-baseline.json')), 'baseline must exist');
});

test('Quality Gate Gate 7 locale 卡点包含 key 存在性检查（i18n-user-facing-messages）', () => {
  const workflow = fs.readFileSync(qualityGatePath, 'utf8');
  const gate = workflow.match(/- name: "Gate 7 - locale content sync[\s\S]*?(?=\r?\n\s*- name:|\r?\n  [a-z][-\w]*:)/)?.[0];
  assert.ok(gate, 'Gate 7 locale content sync step must exist');
  assert.match(gate, /node \.github\/scripts\/check-locale-sync\.js --pair-base origin\/main/);
  assert.match(gate, /node \.github\/scripts\/check-locale-sync\.js --cjk/);
  assert.match(gate, /node \.github\/scripts\/check-locale-sync\.js --keys/);
  assert.match(gate, /node \.github\/scripts\/check-locale-sync\.js --py-cjk/);
  assert.match(gate, /node --test \.github\/scripts\/check-locale-sync\.test\.js/);
  assert.ok(fs.existsSync(path.join(__dirname, 'locale-py-cjk-baseline.json')), 'locale-py-cjk-baseline.json must exist');
  assert.ok(fs.existsSync(path.join(__dirname, 'check-locale-sync.js')), 'check-locale-sync.js must exist');
  assert.ok(fs.existsSync(path.join(__dirname, 'check-locale-sync.test.js')), 'check-locale-sync.test.js must exist');
});

test('Quality Gate Gate 12 品牌残留门禁接线（naming-normalization）', () => {
  const workflow = fs.readFileSync(qualityGatePath, 'utf8');
  const gate = workflow.match(/- name: "Gate 12 - Brand residue[\s\S]*?(?=\r?\n\s*- name:|\r?\n  [a-z][-\w]*:)/)?.[0];
  assert.ok(gate, 'Gate 12 workflow step must exist');
  assert.match(gate, /node --test scripts\/check-no-brand-residue\.test\.js/);
  assert.match(gate, /node scripts\/check-no-brand-residue\.js/);
  assert.ok(
    gate.indexOf('check-no-brand-residue.test.js') < gate.indexOf('node scripts/check-no-brand-residue.js'),
    '自测必须先于扫描运行（先证明检出能力，再扫当前仓库）',
  );
  // Gate 12 必须位于 Gate 11 之后（静态门禁序列）
  const gate11 = workflow.indexOf('Gate 11 - ESLint');
  const gate12 = workflow.indexOf('Gate 12 - Brand residue');
  assert.ok(gate11 >= 0 && gate12 > gate11, 'Gate 12 必须在 Gate 11 之后');
  // 契约：门禁脚本与自测必须真实存在
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', '..', 'scripts', 'check-no-brand-residue.js')),
    'checkpoint script must exist',
  );
  assert.ok(
    fs.existsSync(path.join(__dirname, '..', '..', 'scripts', 'check-no-brand-residue.test.js')),
    'checkpoint self-test must exist',
  );
  // 契约：门禁脚本自身不得包含品牌词字面量（按码点构造进正则，避免门禁自证违规）
  const script = fs.readFileSync(path.join(__dirname, '..', '..', 'scripts', 'check-no-brand-residue.js'), 'utf8');
  const brandFull = String.fromCharCode(0x79, 0x69, 0x78, 0x69, 0x61, 0x6f, 0x65, 0x72);
  const brandAbbr = brandFull[0] + brandFull[2] + brandFull[6];
  assert.doesNotMatch(script, new RegExp(brandFull, 'i'));
  assert.doesNotMatch(script, new RegExp('(?<![A-Za-z])' + brandAbbr, 'i'));
});
