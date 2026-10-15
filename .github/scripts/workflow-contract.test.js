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
  // 2026-10-11 修复。这两条断言以前逐字钉着 `"run","test:all","--","--exclude=@multi-publish/desktop"`，
  // 而那个独立的 `--` 恰恰**就是**缺陷：pnpm 把它原样附加到脚本命令上，nx 于是把 `--` 之后的一切
  // 当成「转发给每个任务命令的参数」，自己的选择集纹丝不动 —— 实测 nx 声明 `Running target test
  // for 13 projects`（含 desktop），desktop 全量被塞进 Gate 4 的 30 分钟预算，成功 run 1173s/1322s、
  // 失败 run 恰好 1801s 到点。锁只匹配文本形状、从不问 nx 收到什么，就把缺陷钉成了"受保护形态"。
  // 判据本体已搬到 scripts/check-gate4-selection.js（读 nx **自己打印的选择声明** + A/B 负控），
  // 这里守的是接线与形状，两边不得再退回转发式写法。
  assert.match(unitTestStep, /"run",\s*"test:affected:no-desktop"/);
  assert.match(unitTestStep, /"run",\s*"test:all:no-desktop"/);
  assert.doesNotMatch(unitTestStep, /"run",\s*"test:(affected|all)",\s*"--"/, 'exclude 又落回 nx 的转发区（独立 "--" 之后的参数不参与选择）');
  assert.match(unitTestStep, /node scripts\/check-gate4-selection\.js/, '自检必须真跑在 Start-Process 之前');
  assert.match(unitTestStep, /\$LASTEXITCODE -ne 0/, 'pwsh 步骤不自动中止，自检的 rc 必须显式判');
  assert.match(unitTestStep, /Write-TestProcessTreeDetail/, '超时必须能点名是哪个包的测试还挂着');
  assert.match(unitTestStep, /WaitForExit\(\[int\]\$gateBudgetMs\)/);
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

// 2026-10-05 实测：PR #2596 的 QG Unit Tests 假红，Gate Result 连带红。
//
// 成因链：Gate 4 先问 nx「本次 PR 有没有受影响的非桌面项目」。这个空集若被误读成
// 「探测失败，继续跑」，`nx affected` 会跑 0 个任务、**不启动任何测试进程**，于是末尾
// 运行时出站台账判定（check-test-egress-ledger.js，fail-closed：无台账即红）把一条完全
// 正常的 PR 判红。两版判据都在这里栽过：#2902 栽在 pwsh 把 `ConvertFrom-Json '[]'`
// 摊平成 $null；#2596 栽在 nx 会往 stdout 掺 `NX   Unrecognized Cache Artifacts`
// （CI runner 还原 Nx 缓存后必现，缓存键只含 .nx/cache、不含 .nx/workspace-data/d 那个 db）。
//
// 锁四件事：判据住在可单测脚本里、不得退回字符串全等、判据自身故障必须硬失败、
// 早退分支必须排在降级 warning 之前。
test('Gate 4 affected 探测：三态判据在可单测脚本里，早退只认确证空集', () => {
  const workflow = fs.readFileSync(qualityGatePath, 'utf8');
  const unitTestStep = workflow.match(
    /- name: "Gate 4 - Workspace unit tests"[\s\S]*?(?=\n\s*- name: "Gate 4b)/,
  )?.[0];
  assert.ok(unitTestStep, 'Gate 4 步骤必须存在');

  // ① 判据必须走可单测脚本（#2923 同族：决策搬进 scripts/ 才轮得到真测试打它）
  assert.match(
    unitTestStep,
    /node scripts\/nx-affected-probe\.js --exit \$nxExit/,
    'affected 判据必须由 scripts/nx-affected-probe.js 判定，不得留在内联 PowerShell 里',
  );

  // ② 不得退回 #2902 的字符串全等 —— 那正是被 nx stdout 提示一掺就漏判的写法
  assert.doesNotMatch(
    unitTestStep,
    /\$affectedText\s+-eq\s+'\[\]'|\$affectedText\s+-eq\s+''/,
    '全等判据已被证明会被 nx 的 stdout 提示污染，不得以任何形式搬回 Gate 4',
  );

  // ③ 判据脚本自身故障必须硬失败：「判据没跑起来」与「判据跑了但取不到证据」是两件事，
  //    混成同一条降级路径就等于让判据静默失效。
  assert.match(
    unitTestStep,
    /if \(\$LASTEXITCODE -ne 0\) \{\s*\r?\n\s*throw "nx affected 判读脚本执行失败/,
    'nx-affected-probe.js 自身非零退出必须 throw，不得静默降级',
  );

  // ④ 早退必须排在降级判定之前（#2902 确立的顺序约束，至今仍是硬要求），
  //    且早退的**条件本身**必须是 kind=empty（确证空集）——只判位置不判条件的话，
  //    把条件换成 `if ($nxExit -eq 0)`（"nx 没报错就当没有受影响项目"）能从位置锁下溜过去，
  //    那是把 fail-closed 方向又调转回去。
  assert.match(
    unitTestStep,
    /if \(\$probe\.kind -eq 'empty'\) \{/,
    '早退条件必须是确证空集（$probe.kind -eq empty），不得退化为只看 nx 退出码',
  );
  const iEmpty = unitTestStep.indexOf("-eq 'empty'");
  const iWarn = unitTestStep.indexOf('nx affected detection unusable');
  assert.notStrictEqual(iEmpty, -1, '必须按 kind 分流，且 empty 分支存在');
  assert.notStrictEqual(iWarn, -1, '必须保留「判据取不到证据」时的降级 warning');
  assert.ok(iEmpty < iWarn, '早退分支必须排在降级 warning 之前，否则空集判据形同虚设');

  // ⑤ 判据的语义测试必须真的被 CI 收集（历史上本仓出现过"锁写了但没有任何 workflow 跑它"）
  const gate2c = workflow.match(/- name: "Gate 2c - Unwired-test ratchet[\s\S]*?(?=\n\s*- name: ")/)?.[0];
  assert.ok(gate2c, '必须能定位到 Gate 2c 步骤');
  assert.match(
    gate2c,
    /node --test scripts\/nx-affected-probe\.test\.js/,
    'nx-affected-probe.test.js 必须接进 static-gates，否则语义锁不会被执行',
  );
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

// 标题原为「仅在确认是无模型 NEED_HUMAN 报告时降级为告警」。2026-10-15 起还有第二条
// 降级路径（与本 PR 无归属关系的存量覆盖 FAIL），「仅」字因此变成假的，按实改写。
test('自主覆盖审计的两条降级路径都必须显式命名并各自接线，不得由 overall 泛化', () => {
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
  // 令牌读取必须对**空文件**安全：PASS 路径下门禁写的是 0 字节文件，而 PowerShell 的
  // Get-Content -Raw 对空文件返回 $null（不是空串）——实测 (Get-Content -Raw).Trim() 抛
  // "You cannot call a method on a null-valued expression"，整步 rc=1（PR #3477 首轮 CI 红）。
  assert.match(gate9, /\[string\]\(Get-Content gate9-verdict-note\.txt -Raw\)/,
    "读令牌必须经 [string] 归一化，否则 PASS（空文件）会把整步打红");
  assert.doesNotMatch(gate9, /\(Get-Content[^\n]*\)\.Trim\(\)/,
    "不得直接对 Get-Content 的结果调 .Trim()（空文件时为 $null）");
  // 禁令的反面必须有正向锁，否则「把内联探针整条删掉」也会满足 doesNotMatch ——
  // 那等于把「未审计不再可见」当成合规。正向锁钉的是：令牌由门禁自己算并落盘，workflow 只读令牌文件。
  assert.match(gate9, /--note-file=\S+/);
  assert.match(gate9, /AUTONOMOUS_VERDICT_NOTE=\$verdictNote/);
  assert.doesNotMatch(gate9, /Get-ChildItem|ConvertFrom-Json/);
  assert.match(workflow, /agent-review-gate\.test\.js/);

  // ── 归属判据的接线（2026-10-15）──────────────────────────────────────────
  // 门禁要区分「全仓存量欠账」与「本 PR 声称实现却没实现」，输入就是 PR 正文里的 feat_ 清单。
  // 只喂审计器、不喂门禁 ⇒ 降级判据恒拿到空清单 ⇒ 可归因的覆盖失败也被当存量放行，
  // 那是拆闸门。取参数**块**而不是取整步正文：审计器与门禁吃的是同一段字面串，
  // 按整步匹配会被 auditArgs 一侧先命中，于是「门禁侧整条删掉」照样绿。
  const gateBlock = String(gate9).match(/\$gateArgs = @\([\s\S]*?\r?\n {10}\)/);
  assert.ok(gateBlock, '必须能取到 $gateArgs 参数块（锚点失效不得静默跳过）');
  assert.match(gateBlock[0], /--required-feature-ids=\$env:REQUIRED_FEATURE_IDS/,
    '门禁参数块必须含 --required-feature-ids，否则归属判据没有输入');
  const auditBlock = String(gate9).match(/\$auditArgs = @\([\s\S]*?\r?\n {10}\)/);
  assert.ok(auditBlock, '必须能取到 $auditArgs 参数块');
  assert.notEqual(gateBlock[0], auditBlock[0], '两块取到同一段说明锚点退化（那会让上面的正向锁被审计器侧代答）');
  // 上游产出方：清单必须由 Gate 9 的 PR 画像步骤写进 GITHUB_ENV，否则上面那个变量恒为空串，
  // 归属判据恒退化成「存量」——全绿而闸门已空。
  assert.match(workflow, /REQUIRED_FEATURE_IDS=\$ids/,
    'feat_ 清单必须由 classify 步骤写出，消费侧才拿得到值');
});

test("verdict 令牌的跨 job 通路必须真的接上（Gate Result 读的 job output 要有声明与写出方）", () => {
  const workflow = fs.readFileSync(qualityGatePath, "utf8");
  const parsed = yaml.load(workflow);
  const autonomous = parsed.jobs.autonomous;
  assert.ok(autonomous, "必须存在 autonomous 作业");
  // ① 消费侧：Gate Result 用 needs.autonomous.outputs.verdict-note —— 那必须先有声明。
  //    本仓实测：声明此前**整块不存在**，于是 ${{ needs.autonomous.outputs.verdict-note }} 恒为空串，
  //    `if ($env:AUTONOMOUS_VERDICT_NOTE)` 永不成立，"未实际审计"在 PR 汇总里根本打不出来（#3443 的
  //    登记注释说"现由 verdict 探针补上可见性"，那句只在 autonomous 自己的日志里成立）。
  const outputs = autonomous.outputs || {};
  assert.ok(outputs["verdict-note"],
    "autonomous 作业必须声明 outputs.verdict-note，否则 Gate Result 里那个 env 永远是空串");
  assert.match(String(outputs["verdict-note"]), /steps\./, "声明必须取自某个步骤的 output，而不是写死的字面量");
  const ref = String(outputs["verdict-note"]).match(/steps\.([\w-]+)\.outputs\.(\w+)/);
  assert.ok(ref, "outputs 声明的形态必须是 steps.<id>.outputs.<name>");
  const producer = (autonomous.steps || []).find(s => String(s.id || "") === ref[1]);
  assert.ok(producer, `声明引用的步骤 id ${ref[1]} 必须存在（按 id 取步骤，改名即红）`);
  // ② 产出侧：被引用的那个步骤必须真往 GITHUB_OUTPUT 写同名键。
  assert.match(String(producer.run), new RegExp("GITHUB_OUTPUT"),
    "产出步骤必须写 $env:GITHUB_OUTPUT，否则声明指向一个从来没人产出的键");
  assert.match(String(producer.run), new RegExp("verdict_note=" ),
    "GITHUB_OUTPUT 里必须有 verdict_note= 这个键（与声明的 output 名同源）");
  // ③ 消费侧仍在原地（防止"把消费点删掉"被当成修好了）。
  const gateResultStep = ((parsed.jobs["gate-result"] || {}).steps || []).find(s => /Gate result/.test(String(s.name || "")));
  assert.ok(gateResultStep, "gate-result 作业必须有 Gate result 步骤");
  assert.equal(String(gateResultStep.env.AUTONOMOUS_VERDICT_NOTE),
    "${{ needs.autonomous.outputs.verdict-note }}",
    "消费点必须按声明的 output 名取，删掉它等于把可见性又关掉一次");
});

test("ubuntu 作业的 run 块不得被写成 PowerShell 语法（PR #3477 首轮 CI 红的回归锁）", () => {
  const parsed = yaml.load(fs.readFileSync(qualityGatePath, "utf8"));
  const job = parsed.jobs["business-api-postgres"];
  assert.ok(job, "必须存在 business-api-postgres 作业");
  // 正向半边：这个作业跑在 ubuntu 上，且没有任何步骤自己声明 pwsh ⇒ GitHub 用 bash（带 -e -o pipefail）。
  assert.match(String(job["runs-on"]), /ubuntu/,
    "该作业的默认 shell 由 runs-on 决定；runs-on 变了这条必须重新推导");
  const pwshSteps = (job.steps || []).filter(s => /pwsh|powershell/i.test(String(s.shell || "")));
  assert.deepEqual(pwshSteps.map(s => String(s.name)), [],
    "一旦有步骤显式声明 pwsh，下面那条禁令就要按步骤逐个重划归属");
  for (const s of job.steps || []) {
    if (!s.run) continue;
    // 只看**可执行行**：禁令若按字符串出现切，会把"解释为什么不能写 PowerShell"的那句注释自己判红
    // —— 而那条注释恰恰是防止下一次再犯的唯一现场说明。口径与 workflow-contract 里其它
    // doesNotMatch 型断言一致：按语义/生命周期切，不按字面出现切。
    const code = String(s.run)
      .split("\n")
      .filter(l => !/^\s*#/.test(l))
      .join("\n");
    assert.doesNotMatch(code, /\$LASTEXITCODE/,
      `${s.name}: bash 步骤的可执行行里出现 $LASTEXITCODE 就是 PowerShell 语法，runner 会报 syntax error`);
    assert.ok(code.length > 0, `${s.name}: 剥掉注释后正文为空，等于这条禁令对该步骤没跑（假绿）`);
  }
  // 这条锁自己不能是恒真的：作业里必须真有 run 块被扫到。
  const scanned = (job.steps || []).filter(s => s.run).length;
  assert.ok(scanned >= 2, `扫描域退化（只扫到 ${scanned} 个 run 块），禁令等于没跑`);
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
  // 故一律禁止 paths-ignore。**这句要按实测改宽口径**：正向 `paths` 白名单同样会让检查整体缺席
  // （不匹配时整条 workflow 不启动，连 skipped 都没有）——实测 #3499 只改 openspec/records 的 PR 上
  // build / electron-tests / 债务熔断检查 都以 skipping 出现，而带正向白名单的 GUI Tests 计数 0。
  // 本条之所以只禁 paths-ignore，是因为历史上**没有任何 required 检查挂在带正向白名单的 workflow 上**；
  // 要把某个 workflow 纳入 required，必须先把它的 PR 侧白名单下沉到作业层（gui-test.yml 即此例，
  // 锁见 apps/desktop/tests/gui-ci-exit-contract.test.js 的「PR 触发不得再带 paths 白名单」）。
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

// 「进了 docs-only 白名单的数据文件，它的校验必须先待在不会被短路的 job 里」这条前提锁，
// 此前只对 gate-record-debt-ledger.json 成立。CHANGELOG.md 命中的是根级 `*.md`，
// 而 static-gates 整个 job 被 docs-only 门控 ⇒ 副本棘轮若只接在那边，
// "只改 CHANGELOG 的 PR"（也就是唯一会把文件写坏的那类 PR）恰好一次都不被检测。
// 反证已实跑（M5/M6）：从该步骤正文删掉任一行 ⇒ 本组断言变红。
test('CHANGELOG 副本棘轮必须与 growth 同进步骤、同在 changes job，并共用 merge-base 口径', () => {
  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  const changes = wf.jobs.changes;
  assert.ok(changes, 'changes job 必须存在（它是 docs-only 判定的宿主，不会被自己短路）');
  const step = (changes.steps || []).find((s) => /CHANGELOG growth/.test(s.name || ''));
  assert.ok(step, 'Gate 2c3 CHANGELOG growth 步骤必须存在');
  const body = step.run;
  const iTest = body.indexOf('node --test scripts/check-changelog-duplicate-entries.test.js');
  const iGate = body.indexOf('node scripts/check-changelog-duplicate-entries.js');
  const iGrowth = body.indexOf('node scripts/check-changelog-growth.js');
  assert.ok(iTest >= 0, '该步骤必须跑副本棘轮的回归测试——不接线等于不跑');
  assert.ok(iGate >= 0, '该步骤必须跑副本棘轮本体（只接测试不接门禁，坏文件照样进 main）');
  assert.ok(iGrowth >= 0, 'growth 判据不得被顺手摘掉——两把锁是一前一后，不是二选一');
  assert.ok(iGate > iGrowth, '棘轮必须排在 growth 之后（先保"条目不许丢"，再判"不许复制"）');
  assert.match(body.slice(iGate), /--base="\$\{MB:-\$BASE_REF\}"/, '必须复用同一步骤算出的 merge-base，不得自己再算一遍 base');
  assert.doesNotMatch(body.slice(iGate), /--base=\s*$/, '不得漏传 --base（漏了会退回默认 HEAD^，在合并提交上等于拿错的父提交比）');
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
  // 两个 :no-desktop 变体是 CI 侧真正执行的那两条。它们存在而不是让 workflow 去转发旗标的理由：
  // `pnpm run <script> -- --exclude=X` 里的 `--` 会被原样附加，nx 把之后的一切当成任务转发参数，
  // 排除因此**静默失效**（2026-10-11 实测）。把排除写进脚本，命令行就没有可写错的那个位置了。
  // 语义由 scripts/check-gate4-selection.js 的 A/B 臂守（读 nx 自己打印的选择声明），本条只守形状。
  assert.match(
    rootPkg.scripts['test:all:no-desktop'],
    /^nx run-many -t test --all --parallel=1 --exclude=@multi-publish\/desktop$/,
    'test:all:no-desktop 必须把 exclude 作为 nx 旗标，且不得出现独立 "--"',
  );
  assert.match(
    rootPkg.scripts['test:affected:no-desktop'],
    /^nx affected -t test --base=origin\/main --parallel=1 --exclude=@multi-publish\/desktop$/,
    'test:affected:no-desktop 同上',
  );

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
  assert.match(src, /WaitForExit\(\[int\]\$gateBudgetMs\)/);
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

  // 2b) main push 的并发组必须**按 run 唯一**（#2642）。
  //     上面 2) 锁的是 cancel-in-progress，它并没有坏 —— 实测被取消的 25 条 main push run
  //     连 job 都没派发过（jobs=0），表达式是生效的。坏的是 group：GitHub 在同一并发组里
  //     只允许一个排队者，新 push 一到就把还在排队的旧 push 置为 cancelled，而那条 sha
  //     此后再不会出现任何 run ⇒ 主侧执行证据永久丢失。
  //     近 1000 条 main push run 按 (sha, workflow) 归集实测：「取消过但被后续 run 补回」= **0 格**，
  //     「该格全部 cancelled」= 51 格，其中 #2642 立案之后仍新增 5 格
  //     （ecee7649f / 3af9d1114 / 6ddd41c4c）。所以改 group，**不要**改上面那一行。
  const EXPECT_GROUP = '${{ github.event_name == \'pull_request\' && format(\'{0}-pr-{1}\', github.workflow, github.event.pull_request.number) || format(\'{0}-run-{1}\', github.workflow, github.run_id) }}';
  // 逐字相等而不是"两个 token 都在"：QM-6 实测三种变异都能同时命中 /run_id/ 与 /pull_request\.number/ 却语义已坏 ——
  // ① 分支对调（PR 拿到 run 唯一 ⇒ 失去互相取消；非 PR 落到 -pr- 且 number 为空 ⇒ 全部共享一组，本 PR 要修的现象原样复活）；
  // ② 无条件拼接双 token（PR 每 run 唯一 ⇒ 失去互相取消）；③ 谓词改成 != 'push'（dispatch 落到 -pr- ⇒ 共享一组）。
  // 所以这里锁整棵分支结构；要改表达式必须连同本行一起改，并在 PR 里写明为什么。
  for (const name of ['quality-gate.yml', 'electron-ci.yml']) {
    const wf = readWf(name);
    const group = String(wf.concurrency && wf.concurrency.group);
    assert.equal(
      group,
      EXPECT_GROUP,
      `${name} 的 concurrency.group 与唯一真源表达式不一致（期望 PR 走 -pr-<number>、非 PR 走 -run-<run_id>），实测 ${group}`,
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

// Gate 7b：把基线新鲜度从「只在 main push 上事后报警」变成 PR 侧的阻断防线。
// 动因（实测）：#2761 改了发布表单 UI 未刷新基线，而检查器当时只接在 visual-test.yml
// （2026-09-17 起不再由 PR 触发）里 ⇒ 该 PR 全绿合并、main 连红 11 次。
test('quality-gate 的 visual job 必须含 PR 侧基线新鲜度步骤（Gate 7b，partial 形态）', () => {
  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  const steps = wf.jobs.visual.steps;
  assert.ok(Array.isArray(steps) && steps.length > 0, 'visual job 必须有 steps')

  const idxGate7 = steps.findIndex((s) => typeof s.name === 'string' && s.name.includes('Gate 7 - Visual regression'))
  const idxFresh = steps.findIndex((s) => typeof s.name === 'string' && /Gate 7b - Baseline freshness/.test(s.name))
  // 先断言两个坐标都存在：findIndex 返回 -1 会让下面的顺序断言退化成永真
  assert.notStrictEqual(idxGate7, -1, 'Gate 7 像素步骤必须仍存在（它被改名会静默废掉本条顺序锁）')
  assert.notStrictEqual(idxFresh, -1, '缺少 Gate 7b 基线新鲜度步骤')
  assert.ok(idxFresh > idxGate7, '新鲜度必须在像素步骤之后（它判的是本次刚产出的渲染）')

  const fresh = steps[idxFresh]
  assert.match(String(fresh.name), /partial/, '步骤名必须标明 partial 形态，避免被读成全量判定')
  assert.strictEqual(fresh.shell, 'bash', '必须 bash：一个 run 块里两条命令，pwsh 不会中途退出（装饰性门禁）')
  const body = String(fresh.run)
  assert.match(body, /node --test scripts\/check-baseline-freshness\.test\.js/, '必须先跑检查器自身单测')
  assert.match(body, /--partial\b/, '必须带 --partial：本 job 只跑浅色像素套，无渲染的不得判成过期')
  assert.match(body, /--renders=apps\/desktop\/tests\/visual-testing\/screenshots/, '渲染目录必须指向本次产物')
  assert.doesNotMatch(body, /continue-on-error/, '不得降级为非阻断')
  // 两轮有界重试（#31）：单张视图采集 flake 不得卡死任意 PR（PR #2914 run 37267645916
  // attempt=1 红在 create-history 3909px，同 sha attempt=2 全绿）。摘掉任何一段都会
  // 静默退回「单轮定生死」—— round1 红的视图会因一次采集抖动失败整个 PR。
  assert.match(body, /--json-out=/, 'round1 必须落盘结构化判定（两轮交集终判的数据源）')
  assert.match(body, /--verdict-rounds=/, '违规时必须走两轮交集终判，不得单轮定生死')
  assert.match(body, /--json-out=\$R2 \|\| true/, 'round2 checker 必须也落盘 R2 且容错（缺 R2 时终判按缺文件 fail-closed）')
  assert.match(body, /exec vite --host 127\.0\.0\.1 --port 5174/, 'round2 必须自起 dev server（Gate 7 的 server 已在其 finally 里被杀）')

  // 审计证据链（QM-6 后端评审 W3）：round1 渲染被 mv 成 screenshots-round1、round2 的
  // vite 日志名带 gate7b —— noEvidence 失败时它们是唯一渲染证据，必须随 artifact 上传。
  const upload = steps.find((s) => typeof s.name === 'string' && s.name.includes('Upload GUI quality artifacts'))
  assert.ok(upload, 'Upload GUI quality artifacts 步骤必须存在')
  const uploadPaths = String((upload['with'] && upload['with'].path) || '')
  assert.match(uploadPaths, /screenshots-round1/, 'round1 违规渲染目录必须随 artifact 上传（noEvidence 失败时的唯一渲染证据）')
  assert.match(uploadPaths, /vite-gate7b-round2/, 'round2 vite 日志必须随 artifact 上传')
})

// Gate 7b 的判定域锁：基线的权威渲染是 views 套件产出的 `<name>.png`（检查器 findRender 优先取它），
// 而像素套件产的 `<name>-current.png` 与它**不是同一张图**。实测（run 37103860559，同一次 run 内两两对照）：
//   dashboard 差 350 px、intelligence 差 10528 px、collection 差 67870 px、create-result 差 10111 px；
//   同一差值在两个不同 head（a0e98805 / 94243c2a）上逐字相同 ⇒ 确定性差异，不是抖动。
// 后果曾真实发生：Gate 7b 对一条**全量新鲜度已报 0 违规**的 head 报了 7 条假违规（collection 1.568% 等）。
// 所以 PR 侧必须在同一个持有 dev server 的步骤里补跑 views 两套，否则 Gate 7b 是在错的域上判定。
test('Gate 7b 之前必须在 Gate 7 同一步骤内产出 views 两套渲染（判定域锁）', () => {
  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'));
  const steps = wf.jobs.visual.steps;
  const idxGate7 = steps.findIndex((s) => typeof s.name === 'string' && s.name.includes('Gate 7 - Visual regression'));
  const idxFresh = steps.findIndex((s) => typeof s.name === 'string' && /Gate 7b - Baseline freshness/.test(s.name));
  assert.notStrictEqual(idxGate7, -1, 'Gate 7 步骤必须仍存在（改名会静默废掉本条锁）');
  assert.notStrictEqual(idxFresh, -1, '缺少 Gate 7b 步骤');
  const body = String(steps[idxGate7].run);

  // 三条采集必须在同一步骤：dev server 在该步骤的 finally 里被杀掉，另起一步就没有可拍的服务了
  assert.match(body, /run test:visual:pixel/, '像素套仍在');
  assert.match(body, /pnpm\.cmd run test:visual(?!:)/, '必须补跑 views 核心套（产 <name>.png）');
  assert.match(body, /pnpm\.cmd run test:visual:supplement/, '必须补跑 views 补充套');

  // views 的比较结果不另设门禁（0 px 严格强于 6%），但退出码必须出声，
  // 否则「套件崩了」会伪装成「本次没产图」，而 partial 恰好把没产图记成 skipped。
  assert.match(body, /suite exits:.*pixel=.*views=.*views-supplement=/, '三套退出码必须逐条打印');

  assert.ok(idxFresh > idxGate7, 'views 采集必须在 Gate 7b 判定之前');
})

// 暗档在 PR 侧的渲染来源锁（门禁②）。
// 动因（2026-10-08 实测）：`test:visual:pixel:dark` 只存在于 visual-test.yml
// （main push / dispatch 才跑），而 quality-gate.yml 的 QG Visual 只跑浅色 ⇒ Gate 7b 的
// `--partial` 把每张 `*-dark.png` 记成 skipped。后果不是"少判几张"，而是
// **暗色档漂移在 PR 侧结构性不可判**：PR #3159 改了暗色 CSS 并重建了 29 张基线，
// 其中 8 张暗档与它自己的代码不一致（渲染侧新色值逐字命中该提交新增的 CSS 行，
// 基线侧是旧值），却在 PR 上全绿合入，直到 main push 才红，且红了约 9 小时无人认领
// （run 37799089491 / step「Baseline freshness gate」/ 违规 8 张全部 *-dark.png）。
// 本锁要求暗档采集接在**两处**：Gate 7（首轮判定）与 Gate 7b 的 round2（flake 甄别重采）。
// 只补一处会得到"首轮判、round2 不判"的半接线 —— round2 的判定域因此永远缺暗档，
// 一次采集 flake 就会把暗档误判成 flake 放行。
test('QG Visual 必须在 PR 侧产暗档渲染，且 Gate 7 与 Gate 7b round2 两处都接', () => {
  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'))
  const steps = wf.jobs.visual.steps
  const g7 = steps.find((s) => /Gate 7 - Visual regression/.test(String(s.name || '')))
  const g7b = steps.find((s) => /Gate 7b - Baseline freshness/.test(String(s.name || '')))
  assert.ok(g7 && g7b, '未定位到 Gate 7 / Gate 7b 步骤 —— 本锁的锚点失效')

  const body7 = String(g7.run || '')
  assert.match(body7, /pnpm\.cmd run test:visual:pixel:dark/, 'Gate 7 必须跑暗档像素套，否则 PR 侧暗档永远没有同源渲染')
  assert.match(body7, /suite exits:.*pixel=.*views=.*views-supplement=.*dark=/, '暗档退出码必须与三套一起逐条打印，否则「套件崩了」会伪装成「本次没产图」')

  const body7b = String(g7b.run || '')
  assert.match(body7b, /pnpm\.cmd run test:visual:pixel:dark/, 'Gate 7b round2 重采也必须跑暗档，否则 round2 的判定域缺暗档')

  // partial 必须保留（该 job 仍产不出少数基线的渲染），但不得因此把暗档整档豁免：
  // 摘掉 --partial 会让"无渲染"从 skipped 变成 UNCOVERED_BASELINE 假红。
  const partialCount = (body7b.match(/--partial/g) || []).length
  assert.ok(partialCount >= 2, 'Gate 7b 两轮判定都必须带 --partial（当前 ' + partialCount + ' 处）')
})

// Gate 7 的就绪故障必须参与判定（change: visual-readiness-gate，2026-10-11）。
// 动因：同一步骤历史上是「捕获而不判定」——`pnpm.cmd run test:visual` 的退出码存进
// $viewsExit 之后只被写进 `[GATE-7] suite exits:` 一行，阻断只看 $pixelExit。后果有现场：
// film-engineering 因就绪选择器指向 Hub 懒挂载标签里的节点（`.film-canvas-view` 藏在
// `v-if="isMounted('canvas')"` 后面）而每次 run 都抛就绪超时（main push run 38104148726 /
// job 114366028731 现场 `views=1`），同一步骤结尾照打 `[GATE-7] All visual tests passed`
// —— 一个从未渲染出来的视图因此长期不可判。
// 四条锁：① 四个套件各有 `-eq 3` 判定；② 名单必须显式初始化为空串 —— PowerShell 里
// `$null -ne ''` 为**真**，删掉初始化会把每条合规 PR 都判红，所以本锁同时要求
// 「合规形态能绿」（否则存在性锁会锁死自己的修复路径）；③ 就绪拦截排在像素判定之前
// （更高信息量的原因先出声）；④ 退出码仍逐个取 $LASTEXITCODE，不许退回 `|| x=$?`。
test('Gate 7 必须按退出码 3 阻断就绪故障（捕获而不判定的回退锁）', () => {
  const wf = yaml.load(fs.readFileSync(qualityGatePath, 'utf8'))
  const g7 = wf.jobs.visual.steps.find((s) => /Gate 7 - Visual regression/.test(String(s.name || '')))
  assert.ok(g7, 'Gate 7 步骤必须存在（改名会静默废掉本条锁）')
  const body = String(g7.run || '')

  for (const v of ['pixelExit', 'viewsExit', 'viewsSuppExit', 'darkExit']) {
    const re = new RegExp('if \\(\\$' + v + ' -eq 3\\)')
    assert.ok(re.test(body), '套件退出码 $' + v + ' 必须参与 =3 判定（只捕获不判定 = 装饰性门禁）')
  }
  assert.match(body, /\$suitesNotReady = ''/, '名单必须显式初始化为空串：$null -ne 空串在 PowerShell 里为真')
  assert.match(body, /if \(\$suitesNotReady -ne ''\)/, '就绪名单非空必须触发拦截')
  assert.match(body, /\[GATE-7\] FATAL.*就绪/, '拦截必须点名这是就绪类故障')
  assert.match(body, /exit 3/, '拦截退出码必须是 3（与套件侧 ERR_VISUAL_NOT_READY 同档）')

  const idxReady = body.indexOf("if ($suitesNotReady -ne '')")
  const idxPixel = body.indexOf('if ($pixelExit -ne 0)')
  assert.ok(idxReady >= 0, '未找到就绪拦截块 —— 上面的正则与这里的 indexOf 口径不一致')
  assert.ok(idxPixel >= 0, '未找到像素判定块 —— Gate 7 既有阻断被改名，本条顺序锁失效')
  assert.ok(idxReady < idxPixel, '就绪拦截必须排在像素判定之前')

  const assigns = (body.match(/\$LASTEXITCODE/g) || []).length
  assert.ok(assigns >= 7, 'Gate 7 每个套件都必须显式取 $LASTEXITCODE（当前 ' + assigns + ' 处，不得退回 || x=$?）')
})
