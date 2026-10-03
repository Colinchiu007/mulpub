const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const yaml = require('js-yaml');
// docs-only 短路判定单一真源（change: docs-only-ci-shortcircuit）：
// 白名单真源在 scripts/classify-docs-only.js，本契约测试从它 import 并断言
// 三个全量 workflow 的 push.paths-ignore 与其一致——禁止两份清单漂移。
const { CI_IGNORED_PATHS } = require(path.join(__dirname, '..', '..', 'scripts', 'classify-docs-only.js'));

const workflowPath = path.join(__dirname, '..', 'workflows', 'visual-test.yml');
const qualityGatePath = path.join(__dirname, '..', 'workflows', 'quality-gate.yml');
const agentJudgePath = path.join(__dirname, '..', 'workflows', 'agent-judge.yml');
const buildWorkflowPath = path.join(__dirname, '..', 'workflows', 'build.yml');
const desktopPackagePath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'package.json');
const desktopVitestConfigPath = path.join(__dirname, '..', '..', 'apps', 'desktop', 'vitest.config.js');
const rootPackagePath = path.join(__dirname, '..', '..', 'package.json');

// 全量视觉（views + workflows 四套注册表）的像素基线此前在 CI 上没有任何产物来源
// —— QG Visual 只跑 run-pixel-tests.js 的 pixelTests，而 QM-4 第 7 条禁止拿本地图当基线。
// 本步骤锁「采集确实接进了 CI」，并锁住它此刻**就是阻断门禁**：基线已按 QM-4 第 7 条同源重建
// （13 条非同源基线换成同一次 CI 渲染，自证「新基线 vs 同一次 CI 渲染 = 0 px」）。
// 若有人重新加回 continue-on-error，就是把它降级成"只采集不判定"——main 的视觉回归会整体关掉，
// 必须同 PR 写明基线为何又不可判据了，并同步反号本断言；只改一边会得到恒红或恒绿。
test('视觉工作流跑全量四套用例并把产物落进可取用的 artifact', () => {
  const wf = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
  const steps = wf.jobs['visual-test'].steps;
  const capture = steps.find(step => /run-all-visual\.js/.test(String(step.run || '')));

  assert.ok(capture, 'visual-test.yml 必须有一个步骤执行 tests/visual-testing/scripts/run-all-visual.js');
  assert.notEqual(capture['continue-on-error'], true, '基线已按 QM-4 第 7 条同源重建，全量采集是阻断门禁');
  // 采集失败必须以**非零**退出交给 continue-on-error 变成可见的警告；正文以 Write-Host 收尾时
  // PowerShell 一律退 0，那样"整批采集失败"会显示成绿色通过——唯一的告警通道就没了。
  assert.match(String(capture.run), /\$captureExit = \$LASTEXITCODE/);
  assert.match(String(capture.run), /^( {0,2})exit \$captureExit\s*$/m);
  assert.doesNotMatch(String(capture.run), /exit 0/);
  assert.equal(capture.if, 'always()', '第一套像素门禁红时也必须跑完全量，否则基线采集取决于前一套成败');
  // YAML block scalar 会把整块公共缩进剥掉，所以这里按"行首"匹配（曾按 10 空格匹配而恒不成立）。
  // 顺序也要钉住：采集必须排在装 Playwright / build:vue 之后，否则对着没有依赖、没有构建产物的 runner 跑
  const order = steps.map(step => String(step.name || step.uses));
  const captureIdx = order.findIndex(name => /Full visual suites/.test(name));
  const buildIdx = order.findIndex(name => /Build Vue frontend/.test(name));
  const browserIdx = order.findIndex(name => /Install Playwright \+ Chromium/.test(name));
  // 先确认前置步骤本身存在：findIndex 找不到时返回 -1，`captureIdx > -1` 会恒真，
  // 于是"步骤被改名"会把顺序锁静默降级成永真断言。
  assert.ok(buildIdx >= 0, 'visual-test.yml 必须有「Build Vue frontend」步骤（顺序锁的前置）');
  assert.ok(browserIdx >= 0, 'visual-test.yml 必须有「Install Playwright + Chromium」步骤（顺序锁的前置）');
  assert.ok(captureIdx > buildIdx && captureIdx > browserIdx,
    '采集步骤必须排在 Playwright 安装与前端构建之后');
  assert.match(String(capture.run), /node tests\/visual-testing\/scripts\/run-all-visual\.js/);
  // 每个步骤是独立进程树，上一步的像素门禁在自己的 finally 里已经关掉了 5174 的 Vite。
  // 采集步骤若复用那个地址，四套用例是对着一个不存在的端口跑成 103 条连接失败（红得很安静，
  // 因为步骤本身 continue-on-error）。所以必须自己起一台、自己收掉，且端口与像素门禁分开。
  assert.match(String(capture.run), /Start-Process -FilePath "pnpm\.cmd"/);
  assert.match(String(capture.run), /never became ready/);
  assert.match(String(capture.run), /taskkill \/PID/);
  assert.match(String(capture.env.TEST_URL), /:5175$/);

  const gate = steps.find(step => /test:visual:pixel/.test(String(step.run || '')));
  assert.ok(gate, 'visual-test.yml 必须保留像素门禁步骤');
  assert.notEqual(gate['continue-on-error'], true, '像素门禁不得被降级为非阻断');

  const upload = steps.find(step => String(step.uses || '').startsWith('actions/upload-artifact'));
  assert.ok(upload, 'visual-test.yml 必须上传截图与报告，否则同源基线无从取得');
  assert.equal(upload.if, 'always()', '采集红时也必须上传，否则恰恰丢掉最需要看的现场');
  assert.match(String(upload.with.path), /tests\/visual-testing\/screenshots/);

  // 采集服务起不来时唯一的现场是它自己的 vite 日志；日志名必须落在 artifact 上传的通配里，
  // 否则报完 "never became ready" 就什么都没留下（写成 vite-visual-all.stdout.log 就不匹配 vite-visual.*.log）。
  const logNames = String(capture.run).match(/"(vite-visual[^"]*\.log)"/g) || [];
  assert.ok(logNames.length >= 2, `采集步骤必须重定向 stdout 与 stderr 两份 vite 日志，实得 ${logNames.length} 份`);
  const uploadPaths = String(upload.with.path);
  assert.match(uploadPaths, /vite-visual\.\*\.log/, 'artifact 必须上传 vite 日志');
  for (const raw of logNames) {
    const name = raw.replace(/"/g, '');
    assert.match(name, /^vite-visual\.[A-Za-z0-9_-]+\.(stdout|stderr)\.log$/, `${name} 不匹配 artifact 的 vite-visual.*.log 通配`);
  }
});

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

  // 两条流水线必须渲染**同一个应用状态**，否则从 Visual Tests artifact 取来的基线与 QG Visual 的比对环境又不同源
  // （accounts-list-flag-on 这类 flag 开启态用例对 VITE_MP_DEV_FLAG_OVERRIDE 敏感）。
  const vtEnv = yaml.load(fs.readFileSync(workflowPath, 'utf8')).jobs['visual-test'].env;
  assert.equal(vtEnv.TEST_URL, 'http://127.0.0.1:5174');
  assert.equal(String(vtEnv.HEADLESS), 'true');
  assert.equal(String(vtEnv.PIXEL_THRESHOLD), '0.06');
  assert.equal(String(vtEnv.VITE_MP_DEV_FLAG_OVERRIDE), '1', 'flag 开启态用例在两条流水线必须渲染同一种状态');
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
  // 进程树遍历已收敛到 scripts/get-test-process-tree.ps1（带 PID 复用防护 + 可注入进程表的锁）。
  // 旧断言锁的是"步骤里内联了一份 function Get-TestProcessTree"，那正是本次要消灭的形态：
  // 同一份只按数字 ParentProcessId 递归的实现被抄成两份，实测把 csrss/winlogon/dwm 认成
  // 残留测试子进程后逐个 taskkill /F（run 36519025075 attempt 1）。因此这里改成锁三件事：
  // 引用共享实现、必须传时间锚点、**不得再内联第二份**。
  assert.match(unitTestStep, /get-test-process-tree\.ps1/);
  assert.match(unitTestStep, /\$launchMark = Get-Date/);
  assert.match(unitTestStep, /\$remainingTestProcesses = @\(Get-TestProcessTree -RootProcessId \$testProcess\.Id -NotBefore \$launchMark\)/);
  assert.doesNotMatch(unitTestStep, /function Get-TestProcessTree/);
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

// CI_IGNORED_PATHS 真源已迁移至 scripts/classify-docs-only.js（见文件头部 import）；
// 此处不再内嵌第二份清单——两份必然漂移，漂移即「push 跳过但 PR 不短路」或反之。

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

test('CI 路径门控：任何 workflow 的 pull_request 都不得用 paths-ignore（全量扫描）', () => {
  // 根因复盘（2026-09-21，PR #2151 死锁）：debt-guard.yml 曾在 pull_request 上配
  // paths-ignore: 01-docs/**，而它的 job 显示名「债务熔断检查」已被 GitHub ruleset
  // main-ci-gate 列为 required check —— 纯文档 PR 永不产生该检查，mergeStateStatus
  // 永久 BLOCKED（ruleset current_user_can_bypass=never，--admin 也绕不过）。
  // required contexts 清单只存在 GitHub ruleset、仓库内不可读，无法逐一对账，
  // 故一律禁止 paths-ignore；正向 paths 白名单仍允许（按需触发，不影响 required 语义）。
  const dir = path.join(__dirname, '..', 'workflows');
  const offenders = [];
  for (const f of fs.readdirSync(dir).filter((n) => /\.(ya?ml)$/.test(n))) {
    const wf = yaml.load(fs.readFileSync(path.join(dir, f), 'utf8'));
    const on = wf.on === undefined ? wf.true : wf.on; // YAML 1.1 可能把 on 解析为 true
    const pr = on && on.pull_request;
    if (pr && pr['paths-ignore'] !== undefined) offenders.push(f);
  }
  assert.deepEqual(
    offenders,
    [],
    `以下 workflow 的 pull_request 不得配置 paths-ignore，否则 required check 会在被忽略的路径上缺失：${offenders.join(', ')}`,
  );
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

// ---------------------------------------------------------------------------
// docs-only 短路接线防再犯锁（change: docs-only-ci-shortcircuit）
// 摘掉 changes job、或从任一重型 job 摘掉 docs-only 条件 => 本组断言变红。
// 反证已实跑：摘 changes job / 摘 static-gates 的 if 各红一条；还原后全绿。
// ---------------------------------------------------------------------------
test('docs-only 短路：quality-gate 的 changes job 存在且产出 docs-only 输出', () => {
  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  const changes = wf.jobs.changes;
  assert.ok(changes, 'changes job 必须存在（docs-only 判定入口）');
  assert.equal(changes['runs-on'], 'ubuntu-latest', '判定只依赖 git+node，必须用 ubuntu（不占 Windows 并发额度）');
  assert.match(
    JSON.stringify(changes.outputs),
    /docs-only/,
    'changes job 必须输出 docs-only 供重型 job 条件消费',
  );
  const step = changes.steps.find((s) => s.id === 'classify');
  assert.ok(step, 'classify 步骤必须存在');
  assert.match(step.run, /classify-docs-only\.js/, '判定必须走单一真源脚本（禁止内联第二份判定）');
  assert.match(step.run, /github\.event_name.*pull_request/, '非 PR 事件必须显式 false（全量执行）');
});

test('docs-only 短路：全部重型 job 挂 needs: [changes] 且条件为 docs-only != true', () => {
  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  const heavy = [
    'static-gates',
    'unit-tests',
    'desktop-shards',
    'coverage',
    'business-api-postgres',
    'visual',
    'e2e',
    'autonomous',
  ];
  for (const name of heavy) {
    const job = wf.jobs[name];
    assert.ok(job, `${name} job 必须存在`);
    assert.deepEqual(job.needs, ['changes'], `${name} 必须 needs: [changes]`);
    assert.equal(
      job.if,
      "needs.changes.outputs.docs-only != 'true'",
      `${name} 必须带 docs-only 短路条件（纯文档 PR 跳过、混合 PR 全量）`,
    );
  }
  // gate-result 必须聚合 changes 的结论：判定 job 自身红（git 取证失败）时不得静默放行
  const gateResult = wf.jobs['gate-result'];
  assert.ok(gateResult.needs.includes('changes'), 'gate-result 必须依赖 changes（判定失败即拦）');
  const step = gateResult.steps.find((s) => s.name === 'Gate result');
  assert.match(step.run, /needs\.changes\.result/, 'changes 结论必须进入 gate-result 聚合表');
});

test('docs-only 短路：electron-ci 与 build 的 job 级条件同样接线', () => {
  for (const name of ['electron-ci.yml', 'build.yml']) {
    const wf = yaml.load(fs.readFileSync(path.join(__dirname, '..', 'workflows', name), 'utf8'));
    const jobNames = Object.keys(wf.jobs);
    assert.ok(jobNames.length > 0, `${name} 必须有 job`);
    for (const jn of jobNames) {
      const job = wf.jobs[jn];
      if (jn === 'changes') continue;
      // 豁免：tag-only 发布 job（如 build.yml 的 release）。它 needs: [build] 间接依赖
      // changes，且 tag push 是非 PR 事件 => docs-only 恒 false => build 全量 => release
      // 正常执行；给它加 docs-only 条件反而会破坏 tag 条件的单一职责。
      const isTagOnlyJob =
        typeof job.if === 'string' &&
        /startsWith\(github\.ref,\s*'refs\/tags\/v'\)/.test(job.if) &&
        Array.isArray(job.needs) &&
        job.needs.includes('build');
      if (isTagOnlyJob) continue;
      assert.equal(
        job.if,
        "needs.changes.outputs.docs-only != 'true'",
        `${name} 的 ${jn} 必须带 docs-only 短路条件`,
      );
      assert.deepEqual(job.needs, ['changes'], `${name} 的 ${jn} 必须 needs: [changes]`);
    }
    const changes = wf.jobs.changes;
    assert.ok(changes, `${name} 必须有 changes 判定 job`);
    assert.match(
      JSON.stringify(changes.outputs),
      /docs-only/,
      `${name} 的 changes job 必须输出 docs-only`,
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
  // shard watchdog 必须有契约守护（W3）。与 Gate 4 同源：锁共享实现 + 时间锚点，
  // 并锁"全文件不得再内联第二份 Get-TestProcessTree"（两份拷贝正是本次事故的放大器）。
  const shardStep = src.match(
    /- name: "Desktop tests shard[\s\S]*?(?=\n\s*# ---|\n\s*- name: |\n\n\s*coverage:)/,
  )?.[0];
  assert.ok(shardStep, 'Desktop tests shard 步骤必须存在');
  assert.match(shardStep, /get-test-process-tree\.ps1/);
  assert.match(shardStep, /\$launchMark = Get-Date/);
  assert.match(shardStep, /-NotBefore \$launchMark/);
  assert.doesNotMatch(src, /function Get-TestProcessTree/);
  assert.match(src, /WaitForExit\(1800000\)/);
  assert.match(src, /taskkill \/PID \$testProcess\.Id \/T \/F/);
  const rootPkg = JSON.parse(fs.readFileSync(rootPackagePath, 'utf8'));
  // 死脚本清理（W1）：根 package.json 不应再有 test:desktop:shard
  assert.equal(rootPkg.scripts['test:desktop:shard'], undefined);
});

// 回归保护：gate-result 是 main 的必需状态检查，但它曾只有一串 echo、无任何 exit 判定，
// 上游全红也恒退出 0 —— 等于一个永不变红的"必需检查"。反证方式：把本用例跑在修复前的
// quality-gate.yml 上，/\$blocking/ 与 /exit 1/ 两条断言必然失败。
test('gate-result 必须真正聚合上游结论（不得退回只 echo 不判定的空转形态）', () => {
  const workflow = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  const job = workflow.jobs['gate-result'];
  assert.ok(job, 'gate-result job 必须存在');
  // if: always() 保证上游失败时本 job 仍运行，从而有机会作出判定
  assert.equal(job.if, 'always()', 'gate-result 必须带 if: always()');
  assert.deepEqual(
    job.needs,
    ['changes', 'static-gates', 'unit-tests', 'desktop-shards', 'coverage', 'business-api-postgres', 'visual', 'e2e', 'autonomous'],
    'gate-result 必须聚合全部上游 job（含 docs-only 判定 job：它红了必须有人拦）',
  );
  const step = job.steps.find(s => s.name === 'Gate result');
  assert.ok(step, 'Gate result 步骤必须存在');
  assert.match(step.run, /\$blocking/, '必须计算阻断项集合');
  assert.match(step.run, /\$allowed\s*=\s*@\('success',\s*'skipped'\)/, "放行口径必须是 success/skipped");
  assert.match(step.run, /exit 1/, '存在阻断项时必须以非零码退出');
  // 这两条锁住"静默丢弃"复发：visual / e2e 的结论必须进入聚合
  assert.match(step.run, /needs\.visual\.result/, 'visual 结论必须参与聚合');
  assert.match(step.run, /needs\.e2e\.result/, 'browser E2E 结论必须参与聚合');
  // 真库 job 同族：它红了必须有人拦，否则「005 迁移 + 真 SQL 回归」只是一条没人看的绿线
  assert.match(step.run, /needs\.business-api-postgres\.result/, 'business-api-postgres 结论必须参与聚合');
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
  // Gate 12 的落点契约（#2745 同族第三处，随实现迁移同步改写，不是删断言）：
  // 旧断言是「Gate 12 必须在 Gate 11 之后」——那是 static-gates 内部的静态序列次序，
  // 而 *.md / 01-docs/** / docs/** 全在 docs-only 白名单里，整个 static-gates 对纯文档 PR 被短路，
  // 于是 AGENTS.md 承诺的「文档 PR 的保留门禁：品牌残留」实际一次都不执行。
  // 现在它住在无条件执行的 changes job，"在 Gate 11 之后"这条次序判据不再适用，
  // 换成承重得多的位置判据：必须在 changes job 正文里，且不在被门控的 static-gates 里。
  const changesAt = workflow.indexOf('\n  changes:');
  const staticAt = workflow.indexOf('\n  static-gates:');
  assert.ok(changesAt >= 0 && staticAt > changesAt, '未定位到 changes / static-gates 边界 —— 本锁锚点失效');
  const changesJob = workflow.slice(changesAt, staticAt);
  assert.ok(changesJob.includes('Gate 12 - Brand residue'),
    'Gate 12 不在 changes job 里 ⇒ 纯文档 PR 被 docs-only 短路后无人校验品牌残留');
  assert.ok(!workflow.slice(staticAt).includes('Gate 12 - Brand residue'),
    'Gate 12 仍留在被 docs-only 门控的 static-gates（接线未搬走）');
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

test('CI 提速契约：并发控制、quality-gate 显示名与重复流水线去重', () => {
  const wfDir = path.join(__dirname, '..', 'workflows');
  const readWf = (n) => yaml.load(fs.readFileSync(path.join(wfDir, n), 'utf8'));

  // 1) quality-gate 必须有顶层 name：ci-failure-handler 的 workflow_run.workflows 白名单按
  //    显示名匹配，缺失时显示为文件路径，导致 QG 失败永不触发 Issue 创建。
  const qg = readWf('quality-gate.yml');
  assert.equal(
    qg.name,
    'quality-gate',
    'quality-gate.yml 必须有 name: quality-gate（ci-failure-handler 白名单按显示名匹配）',
  );

  // 2) 所有 PR 触发的 workflow 必须配置 concurrency：否则同一 PR 重复推送时旧 run 不取消，
  //    持续占用并发额度并造成排队（实测单次 PR 曾达 17 个 job）。
  const prWorkflows = [
    'quality-gate.yml', 'electron-ci.yml', 'build.yml', 'doc-gate.yml',
    'gui-test.yml', 'visual-test.yml', 'debt-guard.yml', 'agent-judge.yml',
    'ops-center-ci.yml', 'autonomous-loop.yml',
  ];
  for (const name of prWorkflows) {
    const wf = readWf(name);
    assert.ok(
      wf.concurrency && wf.concurrency.group,
      `${name} 必须配置 concurrency（同一 PR 重复推送时取消旧 run）`,
    );
    assert.match(
      String(wf.concurrency['cancel-in-progress']),
      /pull_request/,
      `${name} 的 cancel-in-progress 必须仅对 PR 生效（main push 不得被取消）`,
    );
  }

  // 3) visual-test 不得由 pull_request 触发：它与 quality-gate 的 QG Visual（Gate 7）逐行同构，
  //    每次改 apps/desktop/** 会跑两遍。保留 push 以维持「代码默认 readiness 超时」路径的覆盖。
  const vt = readWf('visual-test.yml');
  assert.equal(
    vt.on.pull_request,
    undefined,
    'visual-test.yml 不得由 pull_request 触发（与 QG Visual 重复；PR 上由 QG Visual 承担）',
  );
  assert.ok(vt.on.push, 'visual-test.yml 必须保留 push 触发（维持默认 readiness 超时路径的覆盖）');

  // 4) doc-gate 的 stale-check 占位 job 不得恢复（纯 echo 却每次 PR 起一台 runner）。
  const dg = readWf('doc-gate.yml');
  assert.ok(!dg.jobs['stale-check'], 'doc-gate.yml 的 stale-check 占位 job 已删除，不得恢复');
  assert.ok(
    dg.jobs['ci-tests'],
    'doc-gate.yml 必须保留 ci-tests job（其 job 名为历史 required-check context 名）',
  );

  // 5) electron-ci 的桌面 vitest 步必须仅在非 PR 事件执行（PR 交给 QG desktop-shards 分片）。
  const ec = fs.readFileSync(path.join(wfDir, 'electron-ci.yml'), 'utf8');
  assert.match(
    ec,
    /if: github\.event_name != 'pull_request'/,
    'electron-ci 的桌面 vitest 步必须限定为非 PR 事件（避免同一批桌面测试在 PR 上重复执行）',
  );
});

// 基线新鲜度门禁（check-baseline-freshness.js）存在的意义：QM-4 第 7 条禁止本机截图当基线，
// 但这条纪律在 #2623 之前无人检测、之后不到一天又被 #2685 的本机重捕打破（9 张漂 0.008%–1.573%，
// CI 全绿）。摘掉这个步骤就等于把唯一的检测关掉，因此它必须与"阻断"形态一起被锁住。
test('视觉工作流必须有阻断形态的基线新鲜度门禁，且跑自己的单测', () => {
  const wf = yaml.load(fs.readFileSync(workflowPath, 'utf8'));
  const steps = wf.jobs['visual-test'].steps;
  const fresh = steps.find(step => /check-baseline-freshness\.js/.test(String(step.run || '')));

  assert.ok(fresh, 'visual-test.yml 必须有执行 scripts/check-baseline-freshness.js 的步骤');
  assert.notEqual(fresh['continue-on-error'], true, '基线新鲜度检查必须是阻断形态；降级成告警就等于没有检查');
  assert.equal(fresh.if, 'always()', '采集步骤红时也要拿到新鲜度结论，不得被前置失败静默跳过');
  // 两条命令（先跑单测再跑真检查）写在同一个 run 块里 ⇒ 必须 shell: bash：
  // PowerShell 步骤不会在中间命令非零时中止，只有最后一条决定成败 ⇒ 会造出一条恒绿装饰门禁。
  assert.equal(fresh.shell, 'bash');
  assert.match(String(fresh.run), /node --test scripts\/check-baseline-freshness\.test\.js/,
    '检查器自身的单测必须与真检查同步执行，否则它会静默失修');
  const idxFresh = steps.indexOf(fresh);
  const idxCapture = steps.findIndex(step => /run-all-visual\.js/.test(String(step.run || '')));
  assert.ok(idxCapture >= 0, '前置条件：采集步骤必须存在，否则新鲜度检查拿不到同 run 的渲染');
  assert.ok(idxFresh > idxCapture, '新鲜度检查必须排在采集步骤之后（判据是同一次 run 的渲染）');
})

// 加强版判据（由 QM-6 两路外部评审各自命中一条 Critical 逼出来）：
// ① 准备步骤必须**整条命令就是**该脚本 —— 原写法按"正文里出现过字样"匹配，一个
//    `run: echo "see node_modules/electron/install.js"` 的假步骤就能让它恒绿；
// ② SKIP 变量必须查**步骤 / 作业 / workflow 三层** —— 只在步骤层查，作业级 env 一样能
//    让 ensure-electron.js:35 直接 exit 0，准备步骤集体变成装饰；
// ③ 被依赖的脚本本体也要验，否则整条锁只是在验"调用过一个 no-op"；
// ④ 同类作业清单由内容收集后与"要 prep 的 + 有前提可判定的豁免"做 deepEqual，
//    新增同类作业当场红，而不是看不见它。
test('跑桌面测试的质量门禁作业必须先备好 Electron 二进制（清单自动收集、判据不得被空步骤糊住）', () => {
  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  assert.ok(wf.jobs && Object.keys(wf.jobs).length > 0, '前置条件：解析不出 jobs 时本判据会在空集合上恒真');

  const isDesktopTestStep = (s) => {
    const run = String((s && s.run) || '');
    return /@multi-publish\/desktop|apps\/desktop/.test(run)
      && /test:coverage|test:startup|--shard=|vitest run|run test/.test(run);
  };
  const collected = Object.keys(wf.jobs)
    .filter((job) => ((wf.jobs[job] && wf.jobs[job].steps) || []).some(isDesktopTestStep))
    .sort();
  const NEEDS_PREP = ['coverage', 'desktop-shards', 'unit-tests'];
  // e2e 与 visual 同类：经 Playwright 打本机 dev server / Chromium，不加载 Electron 模块；
  // 这条前提由下面的目录扫描钉住 —— 有人往这两个目录里引入 require('electron') 时，豁免当场失效变红。
  const EXEMPT = ['e2e', 'visual'];
  assert.deepEqual(collected, NEEDS_PREP.concat(EXEMPT).sort(),
    '跑到"可能 require(electron)"的桌面测试作业清单漂移了：实际=' + JSON.stringify(collected)
    + '，预期=' + JSON.stringify(NEEDS_PREP.concat(EXEMPT).sort())
    + '。新作业要么补准备步骤，要么进 EXEMPT 并给出会被下面钉住的豁免前提');

  // e2e 的豁免前提是一条**可判定的事实**（那批用例经 Playwright 打浏览器，不加载 Electron 模块），
  // 不是一句注释：一旦有人往 apps/desktop/tests/e2e 里引入 require('electron')，前提失效 ⇒ 本条立刻红。
  const repoRoot = path.join(__dirname, '..', '..');
  const SUITES = ['e2e', 'visual-testing'].map((d) => path.join(repoRoot, 'apps', 'desktop', 'tests', d));
  const offenders = [];
  const walk = (dir) => {
    for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
      const f = path.join(dir, ent.name);
      if (ent.isDirectory()) { walk(f); continue }
      if (!/\.m?js$/.test(ent.name)) continue;
      if (/require\(['"]electron['"]\)|from ['"]electron['"]/.test(fs.readFileSync(f, 'utf8'))) {
        offenders.push(path.relative(repoRoot, f));
      }
    }
  };
  for (const d of SUITES) if (fs.existsSync(d)) walk(d);
  assert.deepEqual(offenders, [],
    'e2e/visual 作业的豁免前提失效（这些文件会加载 Electron 模块）：' + JSON.stringify(offenders)
    + ' —— 所在作业必须从 EXEMPT 移到 NEEDS_PREP，即补准备步骤');

  const PREP_CMD = /^\s*node scripts\/ensure-electron\.js\s*$/;
  const SKIP_ENV = /ELECTRON_SKIP_BINARY_DOWNLOAD/;
  assert.deepEqual(Object.keys(wf.env || {}).filter((k) => SKIP_ENV.test(k)), [],
    'workflow 顶层 env 不得设 ELECTRON_SKIP_BINARY_DOWNLOAD：那会让所有作业的准备步骤"合法地"集体空转');

  for (const job of NEEDS_PREP) {
    const steps = (wf.jobs[job] && wf.jobs[job].steps) || [];
    assert.ok(steps.length > 0, `作业 ${job} 必须存在且有步骤（改名或删掉时保护整条消失）`);
    const idxOf = (pred) => steps.map(pred).map((hit, i) => (hit ? i : -1)).filter((x) => x >= 0);
    const testIdxs = idxOf((s) => isDesktopTestStep(s));
    assert.ok(testIdxs.length >= 1, `作业 ${job} 里找不到桌面测试步骤（判据不得对空集合放行）`);
    const prepIdxs = idxOf((s) => PREP_CMD.test(String((s && s.run) || '')));
    assert.equal(prepIdxs.length, 1,
      `作业 ${job} 必须恰好有一步 "run: node scripts/ensure-electron.js"（实得 ${prepIdxs.length} 步）：`
      + '0 步 = 回到 #2783 的装配；多步 = 一处缺口会被另一处满足而掩盖');
    const prep = steps[prepIdxs[0]];
    assert.notEqual(prep['continue-on-error'], true,
      `作业 ${job} 的准备步骤不得 continue-on-error：备失败也照跑，随机超时原样复发`);
    assert.equal(prep.if, undefined, `作业 ${job} 的准备步骤不得带 if: 条件短路`);
    for (const [where, env] of [['作业级', wf.jobs[job].env], ['准备步骤', prep.env]]) {
      assert.ok(!Object.keys(env || {}).some((k) => SKIP_ENV.test(k)),
        `作业 ${job} 的${where} env 不得设 ELECTRON_SKIP_BINARY_DOWNLOAD：ensure-electron.js:35 见它就 exit 0，`
        + '准备步骤会变成装饰而本锁仍然绿');
    }
    const installIdx = steps.findIndex((s) => /pnpm install --frozen-lockfile/.test(String(s.run || '')));
    assert.ok(installIdx >= 0 && installIdx < prepIdxs[0],
      `作业 ${job} 必须先 pnpm install 再备二进制（实得 install=${installIdx} prep=${prepIdxs[0]}）：`
      + 'electron 包本身是装出来的，顺序反了判据测的是空气');
    assert.notEqual(steps[installIdx]['continue-on-error'], true,
      `作业 ${job} 的 Install deps 不得 continue-on-error：安装失败还往下跑，缺 dist 会重新变成随机超时`);
    assert.ok(prepIdxs[0] < testIdxs[0],
      `作业 ${job} 的准备步骤必须排在首个桌面测试步骤之前（实得 prep=${prepIdxs[0]} test=${testIdxs[0]}）`);
  }

  // 被这条锁依赖的脚本本体：掏空它必须让锁变红，否则上面全部判据只是在验"调用过一个 no-op"。
  const ensureSrc = fs.readFileSync(path.join(repoRoot, 'scripts', 'ensure-electron.js'), 'utf8');
  assert.match(ensureSrc, /function isDistComplete/,
    'ensure-electron.js 的完整性判据被删：准备步骤会退化成"跑过 install.js 就算好"');
  assert.match(ensureSrc, /install\.js 执行后 dist 仍不完整[\s\S]{0,80}process\.exit\(1\)/,
    'ensure-electron.js 必须在装完仍不完整时非零退出，否则"准备步骤会红"这件事本身消失');
})
