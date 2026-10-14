const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const {
  PROJECT_ROOT,
  assert,
  findMainWindow,
  getResults,
  resetResults,
} = require('./test-helpers');
const { isIgnorableConsoleError, resolveGuiExitCode } = require('./electron-gui-v9');

const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.github', 'workflows');

function readWorkflow(name) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
  return { source, workflow: yaml.load(source) };
}

function workflowSteps(workflow) {
  return Object.values(workflow.jobs).flatMap((job) => job.steps || []);
}

describe('GUI CI 退出码契约', () => {
  beforeEach(() => {
    resetResults();
    vi.spyOn(console, 'log').mockImplementation(() => {});
  });

  it('从真实测试配置定位项目根目录', () => {
    const expectedRoot = path.resolve(__dirname, '../../..').replace(/\\/g, '/');

    expect(PROJECT_ROOT).toBe(expectedRoot);
  });

  it('可选 bridge 降级启动超过 15 秒时仍能找到主窗口', async () => {
    vi.useFakeTimers();
    const mainWindow = {
      url: vi.fn(async () => 'http://127.0.0.1:5174/#/'),
    };
    let windowQueries = 0;
    const app = {
      windows: vi.fn(() => {
        windowQueries += 1;
        return windowQueries >= 17 ? [mainWindow] : [];
      }),
    };

    try {
      const result = findMainWindow(app);
      await vi.advanceTimersByTimeAsync(20_000);

      await expect(result).resolves.toBe(mainWindow);
      expect(app.windows).toHaveBeenCalledTimes(17);
    } finally {
      vi.useRealTimers();
    }
  });

  it('存在失败断言时返回非零退出码', () => {
    assert('失败断言', false);

    expect(resolveGuiExitCode({ results: getResults() })).toBe(1);
  });

  it.each([
    ['控制台错误', { consoleErrors: ['渲染进程报错'] }],
    ['页面错误', { pageErrors: [new Error('未捕获异常')] }],
    ['运行异常', { runnerError: new Error('测试执行失败') }],
  ])('%s会返回非零退出码', (_name, errors) => {
    expect(resolveGuiExitCode({
      results: getResults(),
      ...errors,
    })).toBe(1);
  });

  it('断言和运行过程均无错误时返回零退出码', () => {
    assert('成功断言', true);

    expect(resolveGuiExitCode({ results: getResults() })).toBe(0);
  });

  it('只忽略 CI 环境已知的 Chromium/网络噪声', () => {
    expect(isIgnorableConsoleError("Request Autofill.enable failed. {'code':-32601}"))
      .toBe(true);
    expect(isIgnorableConsoleError('Failed to load resource: net::ERR_NETWORK_ACCESS_DENIED'))
      .toBe(true);
    expect(isIgnorableConsoleError('Error: 许可证权限不足'))
      .toBe(false);
  });

  it('没有执行任何断言时返回非零退出码', () => {
    expect(resolveGuiExitCode({ results: getResults() })).toBe(1);
  });

  it('runner 使用 exitCode，并保留异步关闭机会', () => {
    const runnerPath = path.join(__dirname, 'electron-gui-v9.js');
    const source = fs.readFileSync(runnerPath, 'utf8');
    const closeIndex = source.indexOf('await app.close()');
    const exitCodeIndex = source.indexOf('process.exitCode');

    expect(closeIndex).toBeGreaterThan(-1);
    expect(exitCodeIndex).toBeGreaterThan(closeIndex);
    expect(source).toContain('window.on("pageerror"');
    expect(source).toContain('message.type() === "error" && !isIgnorableConsoleError');
    expect(source).toContain(
      'resolveGuiExitCode({ results, consoleErrors, pageErrors, runnerError })',
    );
    expect(source).not.toMatch(/process\.exit\s*\(/);
  });

  it('runner 在查找主窗口前监听所有新窗口的启动期错误', () => {
    const source = fs.readFileSync(path.join(__dirname, 'electron-gui-v9.js'), 'utf8');
    const listenerIndex = source.indexOf('app.on("window"');
    const findWindowIndex = source.indexOf('await findMainWindow(app)');

    expect(listenerIndex).toBeGreaterThan(-1);
    expect(findWindowIndex).toBeGreaterThan(listenerIndex);
  });
});

describe('GUI/CI 工作流门禁契约', () => {
  const workflowNames = [
    'build.yml',
    'electron-ci.yml',
    'gui-test.yml',
    'quality-gate.yml',
  ];

  it.each(workflowNames)('%s 是结构完整的 GitHub Actions 工作流', (name) => {
    const { workflow } = readWorkflow(name);

    expect(workflow).toHaveProperty('on');
    expect(workflow).toHaveProperty('jobs');
    expect(Object.keys(workflow.jobs).length).toBeGreaterThan(0);
  });

  it.each(workflowNames)('%s 的门禁步骤不允许 continue-on-error', (name) => {
    const { workflow } = readWorkflow(name);

    expect(workflowSteps(workflow).filter((step) => step['continue-on-error'] === true)).toEqual([]);
  });

  it('GUI 工作流分层执行浏览器 E2E 和 Electron GUI 门禁', () => {
    const { source } = readWorkflow('gui-test.yml');

    expect(source).toContain('- name: Start Vite server');
    expect(source).toContain('- name: Browser E2E gates');
    expect(source).toContain('- name: Electron GUI gate');
    expect(source).toContain('- name: Stop Vite server');
    expect(source).toContain('pnpm --filter @multi-publish/desktop test:e2e');
    expect(source).toContain('node apps/desktop/tests/electron-gui-v9.js');
    expect(source).not.toMatch(/electron-gui-v9\.js\s*\|\|/);
    expect(source).not.toMatch(/e2e-smoke\.js;\s*echo/);
  });

  // 2026-10-14 形状变更（change: gui-test-required-shape）。旧用例把「触发层正向 paths 白名单」
  // 钉成契约，而实测证明这个形状恰恰是 required 的死穴：不匹配时整条 workflow 根本不启动，
  // 于是它产生的检查是「永远不到来」而不是「跳过」。现场对照（#3499，只改 openspec/records 的 PR）：
  //   build / electron-tests / 债务熔断检查 全部以 skipping 出现（它们的 pull_request 无 paths，
  //   路径判定下沉到作业层 changes 作业）；GUI Tests 一条都没出现（计数 0）。
  // 故本组锁改为钉新形状，并保留「清单搬家不缩水」的正向对偶。
  it('GUI 工作流的 PR 触发不得再带 paths 白名单或 paths-ignore（都会让检查整体缺席）', () => {
    const { workflow } = readWorkflow('gui-test.yml');

    expect(workflow.on.pull_request.paths).toBeUndefined();
    expect(workflow.on.pull_request['paths-ignore']).toBeUndefined();
  });

  it('GUI 相关性清单搬进判据脚本后内容不得缩水（搬家不等于删需求）', () => {
    const { GUI_PATHS } = require(path.join(PROJECT_ROOT, 'scripts', 'ci-gui-relevance.js'));

    expect(GUI_PATHS).toEqual(expect.arrayContaining([
      'apps/desktop/**',
      'packages/**',
      'package.json',
      'pnpm-lock.yaml',
      '.github/workflows/gui-test.yml',
    ]));
    expect(GUI_PATHS.length).toBeGreaterThanOrEqual(5);
  });

  it('相关性判定按行为而非字面串：运行时路径算相关，文档与无关 CI 路径不算，空清单保守判否', () => {
    const { isGuiRelevant } = require(path.join(PROJECT_ROOT, 'scripts', 'ci-gui-relevance.js'));

    for (const f of [
      'apps/desktop/src/App.vue',
      'packages/shared-utils/src/login-state.js',
      'package.json',
      'pnpm-lock.yaml',
      '.github/workflows/gui-test.yml',
    ]) {
      expect(isGuiRelevant([f])).toBe(true);
    }
    for (const f of [
      'openspec/records/some-record.md',
      'CHANGELOG.md',
      '.github/workflows/quality-gate.yml',
    ]) {
      expect(isGuiRelevant([f])).toBe(false);
    }
    expect(isGuiRelevant([])).toBe(false);
  });

  it('gui-test 作业必须由 changes 判定作业门控，且非 PR 事件不得被短路（否则 main push / tag 不再跑）', () => {
    const { workflow } = readWorkflow('gui-test.yml');
    const job = workflow.jobs['gui-test'];

    expect(job.needs).toEqual(expect.arrayContaining(['changes']));
    expect(job.if).toContain("github.event_name != 'pull_request'");
    expect(job.if).toContain('needs.changes.outputs.gui-relevant');
  });

  it('CLI 端到端：真 git 仓库里文档改动判否、桌面改动判是，取证失败必须 rc=1 且不写产出', () => {
    // 只测导出的 isGuiRelevant 等于没测 CLI 层（#3493 的同名教训）：base/head 取源、
    // merge-base 语义、取证失败时的 fail-closed、GITHUB_OUTPUT 追加，四件事都只存在于进程入口。
    const { execFileSync } = require('node:child_process');
    const os = require('os');
    const scriptPath = path.join(PROJECT_ROOT, 'scripts', 'ci-gui-relevance.js');
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gui-rel-'));
    const g = (args) => execFileSync('git', args, { cwd: dir, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
    const runCli = (base, head, env = {}) => {
      try {
        const stdout = execFileSync('node', [scriptPath, `--repo=${dir}`, `--base=${base}`, `--head=${head}`], {
          cwd: dir, encoding: 'utf8', env: { ...process.env, ...env },
        });
        return { rc: 0, stdout };
      } catch (e) {
        return { rc: e.status, stdout: String(e.stdout || ''), stderr: String(e.stderr || '') };
      }
    };

    try {
      g(['init', '-q', '-b', 'main']);
      g(['config', 'user.email', 't@t']);
      g(['config', 'user.name', 't']);
      fs.mkdirSync(path.join(dir, 'apps/desktop'), { recursive: true });
      fs.mkdirSync(path.join(dir, 'openspec/records'), { recursive: true });
      fs.writeFileSync(path.join(dir, 'apps/desktop/a.js'), '1\n');
      fs.writeFileSync(path.join(dir, 'openspec/records/base.md'), '1\n');
      g(['add', '-A']);
      g(['commit', '-qm', 'base']);
      const base = g(['rev-parse', 'HEAD']).trim();

      // ① 文档改动 ⇒ 不相关
      fs.writeFileSync(path.join(dir, 'openspec/records/base.md'), '2\n');
      g(['add', '-A']);
      g(['commit', '-qm', 'docs']);
      const docsHead = g(['rev-parse', 'HEAD']).trim();
      const out1 = runCli(base, docsHead);
      expect(out1.rc).toBe(0);
      expect(out1.stdout).toContain('gui-relevant=false');

      // ② 桌面改动 ⇒ 相关（正向对偶：摘掉判据会连这条一起红，不是恒 false）
      fs.writeFileSync(path.join(dir, 'apps/desktop/a.js'), '2\n');
      g(['add', '-A']);
      g(['commit', '-qm', 'desktop']);
      const out2 = runCli(base, g(['rev-parse', 'HEAD']).trim());
      expect(out2.rc).toBe(0);
      expect(out2.stdout).toMatch(/gui-relevant=true/);
      expect(out2.stdout).toContain('apps/desktop/a.js');

      // ③ 取证失败 ⇒ rc=1 且不往 GITHUB_OUTPUT 写任何东西（写了就等于把"读不到"判成"不相关"）
      const outFile = path.join(dir, 'gha-output.txt');
      const bad = runCli('definitely-not-a-ref', 'HEAD', { GITHUB_OUTPUT: outFile });
      expect(bad.rc).toBe(1);
      expect(fs.existsSync(outFile)).toBe(false);

      // ③b 空变更集（base==head）必须**留痕**并判不相关 —— 与"取证失败"必须可区分
      const empty = runCli(docsHead, docsHead);
      expect(empty.rc).toBe(0);
      expect(empty.stdout).toContain('EMPTY_CHANGESET');
      expect(empty.stdout).toContain('gui-relevant=false');

      // ④ GITHUB_OUTPUT 正常路径必须真的追加（作业产出靠它，光打印不算）
      const okOut = runCli(base, docsHead, { GITHUB_OUTPUT: outFile });
      expect(okOut.rc).toBe(0);
      expect(fs.readFileSync(outFile, 'utf8')).toContain('gui-relevant=false');
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  // 实测反转了"依赖失败 ⇒ 检查不到来"的直觉：QG Changes 红过的 4 个历史 run 里，下游作业的
  // check run 全部存在且 conclusion=skipped；而 skipped 满足 required ⇒ 判据作业坏了会让这条
  // gate **静默假通过**。所以必须有 if:always() 的聚合作业把三种失败压成一个可见的红。
  it('必须有 GUI Gate Result 聚合作业，且它同时读 changes 与 gui-test 的结果', () => {
    const { workflow } = readWorkflow('gui-test.yml');
    const agg = workflow.jobs['gui-gate-result'];

    expect(agg, '缺 gui-gate-result 聚合作业 ⇒ 判据坏了会被读成 skipped=通过').toBeDefined();
    expect(agg.if).toBe('always()');
    expect(agg.needs).toEqual(expect.arrayContaining(['changes', 'gui-test']));
    const steps = agg.steps || [];
    const withRun = steps.find((s) => s.run);
    expect(withRun, '聚合作业必须有一条 run 步骤，否则 verdict 无处执行').toBeDefined();
    // 注入面单独锁：${{ needs.* }} 是写在 step.env 里的，漏一条声明 bash 就拿到空串，
    // 于是"判据作业坏了"会被读成空值分支 —— 这是本仓记过的 env/输出接缝失效形态。
    const env = withRun.env || {};
    expect(String(env.CHANGES_RESULT)).toContain('needs.changes.result');
    expect(String(env.GUI_RESULT)).toContain('needs.gui-test.result');
    expect(String(env.GUI_RELEVANT)).toContain('needs.changes.outputs.gui-relevant');
    expect(String(env.EVENT_NAME)).toContain('github.event_name');
    const body = withRun.run;
    // 裁决必须 fail closed：changes 非 success 一律红；skipped 只在「PR 且 relevant 明确为 false」时合法
    expect(body).toMatch(/CHANGES_RESULT" != "success/);
    expect(body).toMatch(/GUI_RELEVANT" = "false/);
    expect(body).toMatch(/\*\)/);
  });

  it('进 required 清单的正确名字是聚合作业显示名（防止后人只收 gui-test 留下假通过）', () => {
    const { workflow } = readWorkflow('gui-test.yml');
    const names = Object.entries(workflow.jobs)
      .filter(([, j]) => j.name)
      .map(([, j]) => j.name);

    expect(names).toContain('GUI Gate Result');
    expect(names).not.toContain('Gate Result');
  });

  it('push 触发保持原样（本次只修 PR 侧检查缺席，不得顺手扩大 main push 的跑量）', () => {
    const { workflow } = readWorkflow('gui-test.yml');

    expect(workflow.on.push.paths).toEqual(expect.arrayContaining([
      'apps/desktop/**',
      'packages/**',
      '.github/workflows/gui-test.yml',
    ]));
  });

  it('质量门禁执行真实 E2E 和视觉测试，并且只清理自己启动的服务', () => {
    const { source, workflow } = readWorkflow('quality-gate.yml');
    const gate8 = workflowSteps(workflow).find((step) => step.name === 'Gate 8 - Browser E2E');

    expect(gate8).toBeDefined();
    expect(gate8.run).toMatch(/node apps\/desktop\/tests\/e2e\/helpers\/route-functional-suite\.test\.js/);
    expect(gate8.run).toMatch(/pnpm(?:\.cmd)? --filter @multi-publish\/desktop run test:e2e/);
    expect(gate8.run.indexOf('route-functional-suite.test.js')).toBeLessThan(gate8.run.indexOf('pnpm.cmd --filter @multi-publish/desktop run test:e2e'));
    expect(gate8.run).toMatch(/\$contractExit\s*=\s*\$LASTEXITCODE/);
    expect(gate8.run).toMatch(/if \(\$contractExit -ne 0\) \{ exit \$contractExit \}/);
    expect(gate8.run).toMatch(/\$e2eExit\s*=\s*\$LASTEXITCODE/);
    expect(gate8.run).toMatch(/finally\s*\{[\s\S]*?taskkill \/PID \$viteProcess\.Id \/T \/F/);
    expect(source).toMatch(/pnpm(?:\.cmd)? run test:visual:pixel/);
    expect(gate8.run).not.toContain('taskkill /F /IM node.exe');
  });

  it('质量门禁不会掩盖 Playwright 安装和 Vue 构建失败', () => {
    const { source } = readWorkflow('quality-gate.yml');

    expect(source).toMatch(/playwright install chromium[\s\S]{0,180}\$LASTEXITCODE/);
    expect(source).toMatch(/pnpm(?:\.cmd)? run build:vue[\s\S]{0,180}\$LASTEXITCODE/);
  });

  it('Windows 原生命令统一手动捕获退出码，不受 PowerShell 版本默认值影响', () => {
    const { workflow } = readWorkflow('quality-gate.yml');
    // 2026-08-09 并行化：Gate 7/8/9 分布在 visual/e2e/autonomous 三个 job，跨 job 汇总所有步骤查找
    const allSteps = Object.values(workflow.jobs).flatMap((job) => job.steps || []);
    const guardedStepNames = [
      'Gate 7 - Visual regression',
      'Gate 8 - Browser E2E',
      'Gate 9 - Autonomous coverage audit',
    ];

    for (const name of guardedStepNames) {
      const step = allSteps.find((candidate) => candidate.name === name);
      expect(step, `step ${name} must exist`).toBeDefined();
      expect(step.run).toContain('$PSNativeCommandUseErrorActionPreference = $false');
    }
  });

  it('Electron 冒烟测试只把超时存活视为成功', () => {
    const { workflow } = readWorkflow('electron-ci.yml');
    const smokeStep = workflow.jobs['electron-tests'].steps.find(
      (step) => step.name === 'Electron smoke test (headless, windows-latest)',
    );
    expect(smokeStep, 'smoke step must exist').toBeDefined();

    // 仅对冒烟步骤断言：诊断步骤（Vitest failure diagnostics）可合法吞掉错误，
    // 但冒烟步骤必须如实传播退出码——不得用 `|| true` 掩盖真实失败。
    expect(smokeStep.run).not.toContain('|| true');
    expect(smokeStep.run).toContain('status=$?');
    expect(smokeStep.run).toContain('"$status" -eq 124');
    expect(smokeStep.run).toContain('exit "$status"');
  });

  it('Electron CI 运行于 GitHub 官方 windows-latest 云 runner（2026-09-17 全量迁云，不再依赖 ECS 自托管）', () => {
    const { workflow } = readWorkflow('electron-ci.yml');

    expect(workflow.jobs['electron-tests']['runs-on']).toEqual('windows-latest');
    // 45 → 70（#2458）：串行单测步骤预算从 20m 抬到 35m 后，job 级必须一起抬，
    // 否则「不可归因的超时」只是从 timeout(1) 换成 Actions 的 job killer。
    // 该值与步骤预算的**关系**由同文件「预算挂实测、超时可自证、且不与 job 级倒挂」那条守住，
    // 不要把它改回一个孤立的魔数。
    expect(workflow.jobs['electron-tests']['timeout-minutes']).toBe(70);
  });

  it('Electron CI 跳过桌面媒体下载脚本，并显式恢复测试所需运行时', () => {
    const { workflow } = readWorkflow('electron-ci.yml');
    const steps = workflow.jobs['electron-tests'].steps;
    const dependencySteps = steps.filter((step) => step.name === 'Install dependencies');
    const runtimeSteps = steps.filter((step) => step.name === 'Restore required JavaScript runtimes');
    const checksumSteps = steps.filter((step) => step.name === 'Verify Electron checksum pin (win32, windows-latest)');
    const electronSteps = steps.filter((step) => step.name === 'Install Electron runtime');
    const rebuildSteps = steps.filter((step) => step.name === 'Rebuild native modules for Electron ABI');
    const testSteps = steps.filter((step) => step.name === 'Unit tests (Vitest, non-Electron, single-worker deterministic)');

    expect(dependencySteps).toHaveLength(1);
    expect(runtimeSteps).toHaveLength(1);
    expect(checksumSteps).toHaveLength(1);
    expect(electronSteps).toHaveLength(1);
    expect(testSteps).toHaveLength(1);
    expect(dependencySteps[0].run.trim()).toBe(
      'pnpm install --frozen-lockfile --ignore-scripts',
    );
    // GitHub 官方 runner 冷启动缓存下 pnpm install 需要更充裕预算（ECS 自托管热缓存仅需 5min）
    expect(dependencySteps[0]['timeout-minutes']).toBe(10);

    const runtimeInstall = runtimeSteps[0].run;
    expect(runtimeInstall).toContain('node scripts/run-package-install.js esbuild');
    expect(runtimeInstall).toContain(
      'node scripts/run-package-install.js --script scripts/postinstall.js vue-demi',
    );
    expect(runtimeInstall).not.toContain('ffmpeg-ffprobe-static');

    const checksumPolicy = checksumSteps[0].run;
    expect(checksumPolicy).toContain('electron-v43.7.7-win32-x64.zip');
    expect(checksumPolicy).toContain("require('./node_modules/electron/checksums.json')");

    expect(electronSteps[0].run).toContain(
      'unset electron_use_remote_checksums npm_config_electron_use_remote_checksums',
    );
    expect(electronSteps[0].run).toContain('node node_modules/electron/install.js');
    expect(electronSteps[0]['timeout-minutes']).toBe(10);
    expect(electronSteps[0].env).toEqual({
      ELECTRON_MIRROR: 'https://cdn.npmmirror.com/binaries/electron/',
    });

    // 迁移契约（2026-08-13 pnpm）：better-sqlite3 不在依赖图（sqlite-wrapper.js 为 sql.js 兼容层），
    // `pnpm exec @electron/rebuild` 无法解析未声明的 bin（npm npx 会临时下载，pnpm exec 不会）——
    // electron-ci 必须不再包含 better-sqlite3 rebuild 步骤（历史 npm no-op 步骤已移除）。
    expect(rebuildSteps).toHaveLength(0);

    const dependencyIndex = steps.indexOf(dependencySteps[0]);
    const runtimeIndex = steps.indexOf(runtimeSteps[0]);
    const checksumIndex = steps.indexOf(checksumSteps[0]);
    const electronIndex = steps.indexOf(electronSteps[0]);
    const testIndex = steps.indexOf(testSteps[0]);

    expect(dependencyIndex).toBeLessThan(runtimeIndex);
    expect(runtimeIndex).toBeLessThan(checksumIndex);
    expect(checksumIndex).toBeLessThan(electronIndex);
    expect(electronIndex).toBeLessThan(testIndex);
  });

  it('Electron CI 不执行仅供桌面发布门禁使用的真实媒体工具测试', () => {
    const { workflow } = readWorkflow('electron-ci.yml');
    const job = workflow.jobs['electron-tests'];
    const nativeDependencyTest = fs.readFileSync(
      path.join(PROJECT_ROOT, 'apps/desktop/electron/tests/stage-media-tools.test.js'),
      'utf8',
    );
    const realComposeSmoke = fs.readFileSync(
      path.join(PROJECT_ROOT, 'apps/desktop/electron/tests/story2video-real-ffmpeg.node-test.cjs'),
      'utf8',
    );
    const videoEngine = fs.readFileSync(
      path.join(PROJECT_ROOT, 'apps/desktop/electron/services/video-engine.js'),
      'utf8',
    );

    expect(job.env).toMatchObject({ SKIP_NATIVE_MEDIA_TOOL_TESTS: '1' });
    expect(nativeDependencyTest).toContain("process.env.NODE_ENV === 'test'");
    expect(nativeDependencyTest).toContain("process.env.SKIP_NATIVE_MEDIA_TOOL_TESTS === '1'");
    expect(nativeDependencyTest).toContain('it.skipIf(skipNativeMediaTests)');
    expect(realComposeSmoke).toContain("process.env.NODE_ENV === 'test'");
    expect(realComposeSmoke).toContain("process.env.SKIP_NATIVE_MEDIA_TOOL_TESTS === '1'");
    expect(realComposeSmoke).toContain("t.skip('远程 CI 不执行桌面 FFmpeg 合成门禁')");
    expect(videoEngine).toContain("const { findFfmpeg } = require('./media-tool-paths');");
    expect(videoEngine).not.toMatch(/spawnSync\(\s*['"]ffmpeg['"]/);
  });

  it('Electron CI 使用测试环境、串行 watchdog 和失败进程诊断', () => {
    const { source, workflow } = readWorkflow('electron-ci.yml');
    const job = workflow.jobs['electron-tests'];
    const steps = job.steps;
    const unitStep = steps.find((step) => step.name === 'Unit tests (Vitest, non-Electron, single-worker deterministic)');
    const diagnosticStep = steps.find((step) => step.name === 'Vitest failure diagnostics');

    expect(job.env).toMatchObject({ NODE_ENV: 'test' });
    expect(unitStep.run).toContain('BUDGET_SECONDS=2100');
    expect(unitStep.run).toMatch(/timeout --signal=TERM --kill-after=30s \$\{BUDGET_SECONDS\}s/);
    expect(unitStep.run).toContain('--maxWorkers=1');
    expect(unitStep.run).toContain('--no-file-parallelism');
    expect(unitStep.run).toContain('--reporter=verbose');
    expect(unitStep.run).toContain('--testTimeout=10000');
    expect(unitStep.run).toContain('--hookTimeout=10000');
    expect(unitStep.run).toContain('--teardownTimeout=10000');
    expect(diagnosticStep.if).toBe('failure()');
    expect(diagnosticStep.run).toContain('tasklist.exe');
    expect(source).not.toContain('maxWorkers=4');
  });

  /**
   * #2458：串行单 worker 那一轮的**步骤级**预算。
   *
   * 依据只能取步骤级实测：`timeout(1)` 约束的就是这一步，而 job 级总时长还含两次
   * install / checkout / 冒烟，拿它当步骤基线会系统性高估（层级混淆的来龙去脉与
   * 两组数字都记在 docs/electron-ci-step-budget-baseline.md）：
   *   - 步骤健康耗时 794 s（run 36380533567，main push `bef5fb72` 的自证行
   *     `[electron-ci-timeout-budget] elapsed=794s budget=2100s rc=0`）；
   *   - 被替换掉的旧墙 1200 s（`--kill-after=30s 20m`）。
   * 真实红因是 runner 负载把步骤耗时放大到越过 1200 s + 超时不可归因，
   * 不是"自然耗时已贴墙"（794 s 对 1200 s 还有约 33% 余量）。
   */
  it('Electron CI 串行单测预算挂实测、超时可自证、且不与 job 级倒挂', () => {
    const { source, workflow } = readWorkflow('electron-ci.yml');
    const job = workflow.jobs['electron-tests'];
    const unitStep = job.steps.find((step) => step.name === 'Unit tests (Vitest, non-Electron, single-worker deterministic)');

    // 1) 预算挂在步骤级实测上：既要对被替换的旧墙有实质余量，也要覆盖健康耗时的倍数
    const budgetSeconds = Number(unitStep.run.match(/BUDGET_SECONDS=(\d+)/)[1]);
    const measuredStepElapsedSeconds = 794; // 自证行实测，不是 job 总时长
    const retiredWallSeconds = 20 * 60;     // 旧魔数 20m
    expect(budgetSeconds).toBeGreaterThan(retiredWallSeconds);
    expect(budgetSeconds).toBeGreaterThanOrEqual(retiredWallSeconds * 1.5);
    expect(budgetSeconds).toBeGreaterThanOrEqual(measuredStepElapsedSeconds * 2);
    // 旧魔数不得复活（它的问题不是"比自然耗时只多 1 分钟"，而是既无实测依据、红时又不可归因）
    expect(unitStep.run).not.toMatch(/--kill-after=30s 20m/);

    // 2) 超时必须能自证，而不是让人再去下 7MB 日志反推
    expect(unitStep.run).toContain('TIMEOUT_BUDGET_EXCEEDED');
    expect(unitStep.run).toContain('elapsed=');
    // 输出被 tee 走之后，判成败只能读 PIPESTATUS：`cmd | tee` 的 $? 是 tee 的（恒 0）
    expect(unitStep.run).toContain('RC=${PIPESTATUS[0]}');
    expect(unitStep.run).toMatch(/exit "\$\{RC\}"/);

    // 3) 预算不得倒挂：job 级上限必须容得下「本步骤预算 + 其余显式 timeout-minutes 之和」，
    //    否则抬内层只是把不可归因的超时从 timeout(1) 换成 Actions 的 job killer。
    const otherCapsMinutes = job.steps.reduce(
      (sum, step) => sum + (typeof step['timeout-minutes'] === 'number' ? step['timeout-minutes'] : 0),
      0,
    );
    expect(job['timeout-minutes']).toBeGreaterThan(otherCapsMinutes + budgetSeconds / 60);
    expect(source).toContain('# 预算不得倒挂');
  });

  it('自主审计成功分支不会继续写入基础设施失败状态', () => {
    const { source } = readWorkflow('quality-gate.yml');

    expect(source).toMatch(/if \(\$exitCode -eq 0\)[\s\S]{0,300}exit 0/);
  });

  it('构建工作流的 Gitee 发布脚本完整且不吞掉上传失败', () => {
    const { source } = readWorkflow('build.yml');

    expect(source).toMatch(/tag_name\\?":\\?"\$\{TAG\}/);
    expect(source).toContain('/attach_files');
    expect(source).toMatch(/release_id=.*node/);
    expect(source).toContain('${RELEASE_API}/${release_id}/attach_files');
    expect(source).not.toContain('${RELEASE_API}/${TAG}/attach_files');
    expect(source).toContain('echo "Gitee sync completed"');
    expect(source).not.toMatch(/\|\|\s*echo\s+"Failed to upload/);
  });
});
