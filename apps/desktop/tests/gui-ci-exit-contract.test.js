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

  it('GUI 工作流在自身、依赖清单和共享包变化时也会触发', () => {
    const { workflow } = readWorkflow('gui-test.yml');
    const pullRequestPaths = workflow.on.pull_request.paths;

    expect(pullRequestPaths).toEqual(expect.arrayContaining([
      '.github/workflows/gui-test.yml',
      'package.json',
      'pnpm-lock.yaml',
      'packages/**',
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
    expect(smokeStep, 'Electron smoke step must exist').toBeDefined();

    // 仅对冒烟步骤断言：诊断步骤（Vitest failure diagnostics）可合法吞掉错误（tasklist 采集进程列表），
    // 但冒烟步骤必须如实传播退出码 —— 不得用 `|| true` 掩盖真实失败。
    expect(smokeStep.run).not.toContain('|| true');
    expect(smokeStep.run).toContain('status=$?');
    expect(smokeStep.run).toContain('"$status" -eq 124');
    expect(smokeStep.run).toContain('exit "$status"');
  });

  it('Electron CI 运行于 GitHub 官方 windows-latest 云 runner（2026-09-17 全量迁云，不再依赖 ECS 自托管）', () => {
    const { workflow } = readWorkflow('electron-ci.yml');

    expect(workflow.jobs['electron-tests']['runs-on']).toEqual('windows-latest');
    expect(workflow.jobs['electron-tests']['timeout-minutes']).toBe(45);
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
    // 迁云后 runner 为 windows-latest，校验对象随之从 linux-x64 换为 win32-x64；
    // 不再断言硬编码 sha256（清单由 checksums.json 提供，断言清单被读取即可）。
    expect(checksumPolicy).toContain('electron-v43.1.1-win32-x64.zip');
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
    expect(unitStep.run).toContain('timeout --signal=TERM --kill-after=30s 20m');
    expect(unitStep.run).toContain('--maxWorkers=1');
    expect(unitStep.run).toContain('--no-file-parallelism');
    expect(unitStep.run).toContain('--reporter=verbose');
    expect(unitStep.run).toContain('--testTimeout=10000');
    expect(unitStep.run).toContain('--hookTimeout=10000');
    expect(unitStep.run).toContain('--teardownTimeout=10000');
    expect(diagnosticStep.if).toBe('failure()');
    // Windows 云 runner 无 `ps`；失败诊断改用 tasklist.exe 枚举进程
    expect(diagnosticStep.run).toContain('tasklist.exe');
    expect(source).not.toContain('maxWorkers=4');
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
