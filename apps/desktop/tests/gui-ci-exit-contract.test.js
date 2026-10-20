// 覆盖域提醒（轴 2 外部评审的 Info，已采纳）：本文件除 GUI workflow 的结构锁外，
// 还锁着 scripts/ci-gui-relevance.js 的**进程入口**（CLI 端到端那条用例：临时真 git 仓库 +
// 真 GITHUB_OUTPUT）。它刻意不拆到 scripts/*.test.js —— 那里既会被 .gitignore 的 scripts/*.js
// 吞掉，又要在 quality-gate.yml 里另点名一次，否则对 check-unwired-tests 棘轮不可见。
// 要找"判据 CLI 的锁"，就在本文件里，不在 scripts/ 下。
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const yaml = require('js-yaml');

const {
  PROJECT_ROOT,
  assert,
  findMainWindow,
  getResults,
  resetResults,
} = require('./test-helpers');
const { isIgnorableConsoleError, resolveGuiExitCode } = require('./electron-gui-v9');
// 用例级预算与它的出处（同一份常量也被 scripts/case-timeout-audit.js require；
// 放测试文件里复测入口读不到 —— 它没法 require 一份 vitest 用例）。
const cliE2eBudget = require('./gui-cli-e2e-budget');

// Git Bash 解析复用单一真源：bash 步骤的语义（-e -o pipefail）只能用它复现，
// 自己再写一份候选路径就会与 CCG 那边的口径漂移。
const { resolveGitBash } = require(path.join(PROJECT_ROOT, 'scripts', 'lib', 'ccg-test-helpers'));

const WORKFLOW_DIR = path.join(PROJECT_ROOT, '.github', 'workflows');

function readWorkflow(name) {
  const source = fs.readFileSync(path.join(WORKFLOW_DIR, name), 'utf8');
  return { source, workflow: yaml.load(source) };
}

// 步骤名自本轮起带 `, shard <i>/<n>` 后缀（matrix 分片），精确等值会全部失效；
// 用前缀匹配并把后缀当成「可缺省」的，才能同时兼容分片前后两种形状。
function findUnitTestStep(job) {
  return (job.steps || []).find(
    (step) => String(step.name || '').startsWith('Unit tests (Vitest, non-Electron, single-worker deterministic'),
  );
}

// matrix.shard 按事件分档（PR 1 片 / 非 PR N 片）之后，片数不再是一个数组字面量，
// 而是 `${{ fromJSON(...) }}` 表达式。两个锁都要用「非 PR 那一档」的片数 ——
// 抽在这里，避免各解各的把它们解成两种口径。
// 行为锁的用例级预算：它要起 bash + date×2 + grep/sed/tail×6，而 Git Bash 在 Windows 上
// 每次起进程约 0.5s；1s 的 timeout 触发后还有一轮诊断。60s 对实测 ~13s 有 4.6 倍余量。
// 用命名常量而不是裸数字：本仓「预算必须挂依据」的纪律同样适用于测试自身的超时。
const SHELL_HARNESS_TIMEOUT_MS = 60000;

function matrixShardSet(job) {
  const expr = JSON.stringify(job && job.strategy && job.strategy.matrix && job.strategy.matrix.shard);
  const arrays = [...String(expr).matchAll(/\[([0-9,\s]*)\]/g)]
    .map((m) => m[1].split(',').map((x) => Number(x.trim())).filter((x) => Number.isFinite(x)));
  return arrays.length > 0 ? arrays[arrays.length - 1] : [];
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
    const startedAt = process.hrtime.bigint();
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
      try {
        fs.rmSync(dir, { recursive: true, force: true });
      } finally {
        // 双层 finally：口径上必须"含清理"（与 vitest 给这条用例记的那段墙钟同一把尺子，QM-6 前端轴 F6），
        // 但清理本身抛错时**不得吞掉样本**（QM-6 前端轴 G4：否则台账锁会报"记录没被执行"这种误导红，
        // 而真因是 Windows 上的句柄占用）。原语的错照样往外抛，样本照样入账。
        cliE2eBudget.recordGuiCliE2eElapsed(Number(process.hrtime.bigint() - startedAt) / 1e6);
      }
    }
  }, cliE2eBudget.GUI_CLI_E2E_CASE_TIMEOUT_MS);

  // ── 上面那条用例的预算锁（三把，一把都不能省）───────────────────────────────
  // 动因（当场实测，非推断）：main push 77598c4ac 与更早的 ce3f25cdf 各红一次，红点逐字相同 ——
  // 该用例 `Error: Test timed out in 10000ms`，耗时行读数 11097ms / 12744ms；而同一作业在
  // 相邻的 4 次 main push（f818c214e / ea257dd99 / 44054389e / 354c4183b）上是 1059–1657ms。
  // 摆动 8 倍来自 runner 负载（它要真起 17 个子进程），与被测语义无关 ⇒ 全局 10s 预算被环境
  // 开销独吞，即 AGENTS.md QM-3「环境开销不得与被测语义共用一个预算」的又一落点。
  it('CLI 端到端用例必须显式声明用例级预算，且只能引用那个单点常量', () => {
    const source = fs.readFileSync(__filename, 'utf8');
    const start = source.indexOf("it('" + cliE2eBudget.GUI_CLI_E2E_TEST_NAME + "'");
    expect(start, '用例名漂移 ⇒ 锚点找不到，锁会静默失去测量对象').toBeGreaterThan(-1);
    const marker = '}, cliE2eBudget.GUI_CLI_E2E_CASE_TIMEOUT_MS);';
    const declared = source.indexOf(marker, start);
    expect(declared, '该用例没有引用单点预算常量（裸数字写法也会在这里红：marker 整串就是判据本体）').toBeGreaterThan(-1);

    // 归属边界走共用纯函数（QM-6 前端轴 G1）：**取不到边界即红**，不退化成"到文件末尾"。
    const boundary = cliE2eBudget.findNextCaseIndex(source, start + 1);
    expect(boundary, '找不到下一条用例的边界 ⇒ "预算属于本条用例"这项检查会静默放宽，一律判红不判过')
      .toBeGreaterThan(-1);
    expect(boundary).toBeGreaterThan(declared);

    // 禁词扫描必须先剥注释（含**块**注释）：本文件在讲这次病灶时必然提到 "10000ms" 这个旧预算数字，
    // 不剥注释的禁词锁会把自己的说明判成违规（实测被这条锁抓到过一次），只剥行注释则块注释照样反咬。
    const body = cliE2eBudget.stripComments(source.slice(start, declared));
    // 带数字边界：`toContain('10000')` 会误伤 `100000` 这类无关大数（QM-6 前端轴 F9）。
    // 这条拦的是"把旧的全局预算抄回用例体内"（例如 `{ timeout: 10000 }` 或 `const legacy = 10000`）——
    // 变异 M15 实测过它有牙。**裸数字第三参写法不在这里拦**（`}, 60000)` 会被区间终点整条排除在
    // 被测区之外，那种写法由上面 marker 存在性拦住）——QM-6 前端轴 G7 指出我原先那条
    // `/\}\s*,\s*\d+\s*\)/` 是永不命中的装饰残留，已删；职责写在这里，不留假锁。
    expect(body, '不得把旧的全局预算写回用例体内').not.toMatch(/(?<!\d)10000(?!\d)/);
  });

  it('预算必须挂在 CI 实测长尾上：≥ maxObservedMs × safetyMultiplier，且样本量与出处都有下界', () => {
    const p = cliE2eBudget.GUI_CLI_E2E_BUDGET_PROVENANCE;
    expect(p.samples, '样本量下界 4：只量一次就当分布，与拿注释当依据是同一个错').toBeGreaterThanOrEqual(4);
    expect(p.maxObservedMs, '实测长尾必须是正数；0 会让"预算 ≥ 0×4"恒真').toBeGreaterThan(0);
    expect(p.safetyMultiplier, '安全系数低于 2 就等于把预算贴在观测值上').toBeGreaterThanOrEqual(2);
    // 两档系数的大小关系不许倒置：台账（单样本）松、分布（窗口 max）紧，反过来会让台账先于脚本失效，
    // 于是"贴脸"在本地响、真正要防的分布长尾却没人看（QM-6 前端轴 G5）。
    expect(cliE2eBudget.LEDGER_HEADROOM_FACTOR)
      .toBeLessThanOrEqual(p.safetyMultiplier);
    expect(cliE2eBudget.GUI_CLI_E2E_CASE_TIMEOUT_MS)
      .toBeGreaterThanOrEqual(p.maxObservedMs * p.safetyMultiplier);
    expect(p.collectedAt).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(p.source).toContain('scripts/case-timeout-audit.js');
    expect(p.source).toContain('rc=3');
    // 复测入口必须真的在仓库里：provenance 指向一个不存在的脚本，等于把"可复测"写成装饰
    expect(fs.existsSync(path.join(PROJECT_ROOT, 'scripts', 'case-timeout-audit.js'))).toBe(true);
  });

  // 必须排在上面那条用例**之后**（vitest 按声明顺序跑）：台账靠那次真跑填充。
  // 顺序被改动时这条会因"台账为空"直接红，不会静默通过。
  it('台账必须有本次真跑的样本，且观测值不得贴脸逼近预算（贴脸＝要重测量并抬预算，不是放宽断言）', () => {
    const samples = cliE2eBudget.guiCliE2eElapsedSamples();
    expect(samples.length, '台账为空 ⇒ 用例里的耗时记录没被执行，这条锁是装饰').toBeGreaterThanOrEqual(1);
    const max = Math.max(...samples);
    const p = cliE2eBudget.GUI_CLI_E2E_BUDGET_PROVENANCE;
    process.stdout.write('[gui-cli-e2e-budget] elapsed=' + samples.join(',') + 'ms'
      + ' budget=' + cliE2eBudget.GUI_CLI_E2E_CASE_TIMEOUT_MS + 'ms'
      + ' ledgerFactor=' + cliE2eBudget.LEDGER_HEADROOM_FACTOR
      + ' distributionFactor=' + p.safetyMultiplier
      + ' headroom=' + (cliE2eBudget.GUI_CLI_E2E_CASE_TIMEOUT_MS / max).toFixed(2) + 'x\n');
    // 两档系数各自乘在各自的量上（QM-6 前端轴 G5 的处置；统一成一把尺子被本机负载实测否证，见模块注释）：
    // 这里乘的是**本次单样本**，出处锁/复测脚本乘的是**一个窗口的分布 max**。
    // 实现仍共用同一个纯函数 `headroomSufficient`——共用的是**不等式**，不是那个系数。
    expect(cliE2eBudget.headroomSufficient(max, cliE2eBudget.GUI_CLI_E2E_CASE_TIMEOUT_MS,
      cliE2eBudget.LEDGER_HEADROOM_FACTOR),
      '单样本 × 台账系数吃掉预算 ⇒ 先重测分布再抬预算，不得放宽断言').toBe(true);
    // 判据本身的正负控（没有这几行，上面那句只是在陈述"今天本机够快"）
    expect(cliE2eBudget.headroomSufficient(15000, 60000, 4)).toBe(true);
    expect(cliE2eBudget.headroomSufficient(15001, 60000, 4)).toBe(false);
    expect(cliE2eBudget.headroomSufficient(30000, 60000, 2)).toBe(true);
    expect(cliE2eBudget.headroomSufficient(30000, 60000, 3)).toBe(false);
    expect(cliE2eBudget.headroomSufficient(NaN, 60000, 4)).toBe(false);
    expect(cliE2eBudget.headroomSufficient(0, 60000, 4)).toBe(false);
  });

  it('耗时探针必须认得 CI 现场那两种形态，且不得误认同文件别的用例 / 未剥 ANSI 的原始行', () => {
    const head = 'tests/gui-ci-exit-contract.test.js > ' + cliE2eBudget.GUI_CLI_E2E_SUITE_NAME + ' > ';
    const name = cliE2eBudget.GUI_CLI_E2E_TEST_NAME;
    // 两行都取 2026-10-17 从 CI 作业日志里实际抓到的形态（✓=跑成、×=被框架切断）
    expect(cliE2eBudget.parseGuiCliE2eDuration('2026-10-17T08:13:07.6685257Z ✓ ' + head + name + ' 1657ms')).toBe(1657);
    expect(cliE2eBudget.parseGuiCliE2eDuration('2026-10-17T08:41:39.0638977Z × ' + head + name + ' 11097ms')).toBe(11097);
    // 负例四条：别的用例 / 没有 ms 后缀 / 非字符串 / 原始未剥 ANSI 行
    expect(cliE2eBudget.parseGuiCliE2eDuration('✓ ' + head + '另一个用例 12ms')).toBeNull();
    expect(cliE2eBudget.parseGuiCliE2eDuration('✓ ' + head + name)).toBeNull();
    expect(cliE2eBudget.parseGuiCliE2eDuration(null)).toBeNull();
    const ansi = '✓ \x1b[90mtests/gui-ci-exit-contract\x1b[22m.test.js > '
      + cliE2eBudget.GUI_CLI_E2E_SUITE_NAME + ' > ' + name + ' 1657ms';
    // 当场实测的口径，别写成"带 ANSI 的行一律不命中"：ANSI 落在**段与段之间**不影响子串匹配，
    // 落在被匹配的串**内部**（CI 现场就是这样，见 \x1b[90m…\x1b[2m 把文件名拦腰截断）才会让探针 0 命中。
    expect(cliE2eBudget.parseGuiCliE2eDuration(ansi),
      '文件名被 ANSI 截断 ⇒ 子串探针失明，复测入口会报"没长尾"，那正是探针瞎了而不是没问题')
      .toBeNull();

    const audit = require(path.join(PROJECT_ROOT, 'scripts', 'case-timeout-audit.js'));
    expect(cliE2eBudget.parseGuiCliE2eDuration(audit.stripAnsi(ansi))).toBe(1657);
    // 另外两种真实存在的 CSI 形态也必须被剥掉（QM-6 后端轴 #12：清了行序列与私有序列的终止符
    // 不是同一个字母族，漏剥就会让文件名中间残留不可见字符，而"0 命中"读起来像"没有长尾"）
    expect(audit.stripAnsi('✓ tests/gui-ci-exit-contract\x1b[K.test.js > '
      + cliE2eBudget.GUI_CLI_E2E_SUITE_NAME + ' > ' + name + ' 1657ms'))
      .toBe('✓ tests/gui-ci-exit-contract.test.js > ' + cliE2eBudget.GUI_CLI_E2E_SUITE_NAME + ' > ' + name + ' 1657ms');
    expect(audit.stripAnsi('\x1b[?25l✓ ' + head + name + ' 1657ms')).toContain(head + name + ' 1657ms');

    // 名字**超集**与行尾还有尾巴，两种都必须判"不是这条用例"（QM-6 后端轴 #8：
    // 子串匹配会把未来那条 `…（复跑）` 的耗时并进同一份分布，读数更充实却不再测它声称的东西）
    expect(cliE2eBudget.parseGuiCliE2eDuration('✓ ' + head + name + '（复跑） 9999ms')).toBeNull();
    expect(cliE2eBudget.parseGuiCliE2eDuration('✓ ' + head + name + ' 1657ms 后面还有字')).toBeNull();

    // 字段集与 source **文案**都必须逐字一致（QM-6 前端轴 F5：只比 key 不比值，
    // 脚本自带一份 source 也不会红，那就是"第二份真相"的漏口）
    const made = audit.buildProvenance({ values: [1000, 2000], runCount: 2, jobs: 2 }, 4, cliE2eBudget, '2026-10-17');
    expect(Object.keys(made).sort()).toEqual(Object.keys(cliE2eBudget.GUI_CLI_E2E_BUDGET_PROVENANCE).sort());
    expect(made.source).toBe(cliE2eBudget.GUI_CLI_E2E_BUDGET_PROVENANCE.source);
    expect(made.maxObservedMs).toBe(2000);
    expect(made.collectedAt).toBe('2026-10-17');
    // 出处文案里的 `--runs=N` 必须就是脚本的默认档，否则"照文案重跑"拿到的是另一个窗口（前端轴 F4）
    expect(cliE2eBudget.GUI_CLI_E2E_BUDGET_PROVENANCE.source)
      .toContain('--runs=' + audit.DEFAULT_RUNS);
    // 脚本不得自带第二份耗时正则：漂移的两份必然给不同数
    expect(audit.harvest('\x1b[90m' + ansi, cliE2eBudget)).toEqual([1657]);
    expect(fs.readFileSync(path.join(PROJECT_ROOT, 'scripts', 'case-timeout-audit.js'), 'utf8'))
      .not.toMatch(/\(\\d\+\)ms/);

    // 参数面（QM-6 前端轴 F2，实测过的假绿：`--max-observed=abc` 会让 NaN 参与比较、
    // 判据恒假 ⇒ 打印 OK 并 rc=0；`--runs=abc` 会让候选恒空 ⇒ 误报"探针瞎了"）
    expect(() => audit.parseArgs(['--max-observed=abc'])).toThrow(/BAD_FLAG_VALUE/);
    expect(() => audit.parseArgs(['--runs=0'])).toThrow(/BAD_FLAG_VALUE/);
    expect(() => audit.parseArgs(['--whatever=1'])).toThrow(/UNKNOWN_FLAG/);
    expect(audit.parseArgs(['--runs', '5', '--json'])).toEqual(audit.parseArgs(['--runs=5', '--json']));
    expect(audit.parseArgs([]).runs).toBe(audit.DEFAULT_RUNS);
    // 出处漂移判据（QM-6 后端轴 #4）：四个方向各自可分辨，且"实测更低"不许当成收紧理由
    expect(audit.judgeDrift(12744, 13000)).toBe('STALE');
    expect(audit.judgeDrift(12744, 12744)).toBe('OK');
    expect(audit.judgeDrift(12744, 900)).toBe('OK_BELOW_RECORD');
    expect(audit.judgeDrift(12744, NaN)).toBe('UNREADABLE');
    // rc=5 那一档必须**可达**（前端轴 F1）：路径可注入，否则"读不到出处"这条分支在测试里摸不到，
    // 而摸不到的分支就是装饰性门禁的第五种落点。
    expect(() => audit.loadBudget(path.join(PROJECT_ROOT, 'no-such-budget-module.js')))
      .toThrow(/BUDGET_UNREADABLE/);
    expect(() => audit.loadBudget()).not.toThrow();

    // 参数面的另外三档（QM-6 前端轴 G2 / G8）：0 值、缺值、手工档配 --json，都必须抛，
    // 且各归各的消息——`--max-observed=0` 过得了旧校验会让 `budget < 0×4` 恒假、
    // 打印 `OK（headroom=Infinity×）` 并 rc=0；`--runs`（缺值）曾被报成 UNKNOWN_FLAG。
    expect(() => audit.parseArgs(['--max-observed=0'])).toThrow(/BAD_FLAG_VALUE/);
    expect(() => audit.parseArgs(['--runs'])).toThrow(/MISSING_FLAG_VALUE/);
    expect(() => audit.parseArgs(['--max-observed=5000', '--json'])).toThrow(/BAD_COMBINATION/);
    // 覆盖度判据（QM-6 前端轴 G3）：不足窗口就不得出可粘贴 provenance，与零样本同档出声。
    expect(audit.coverageSufficient(8, 8)).toBe(true);
    expect(audit.coverageSufficient(8, 5)).toBe(false);
    expect(audit.coverageSufficient(8, NaN)).toBe(false);

    // 归属边界的"宽"必须本身可测（QM-6 前端轴 G1 的第二层）：四种合规写法都要能认出边界，
    // 而"后面没有用例了"必须返回 -1（返回 -1 由声明锁判红，不是判过）。
    const forms = [
      "\n  it('A', () => {});",
      '\n  it("B", () => {});',
      "\n  it.each([1])('C', () => {});",
      "\n  it.skipIf(true)('D', () => {});",
      '\n  it("E", () => {}); ',
    ];
    forms.forEach((src, i) => {
      // 匹配从那个换行符本身起算（`\n` 是 match 的第 0 个字符），所以边界下标就是 0
      expect(cliE2eBudget.findNextCaseIndex(src, 0), '第 ' + (i + 1) + ' 种写法认不出 ⇒ 锚点会静默放宽')
        .toBe(0);
    });
    expect(cliE2eBudget.findNextCaseIndex('\n  describe("x", () => {});', 0)).toBe(-1);
    expect(cliE2eBudget.findNextCaseIndex('', 0)).toBe(-1);

    // 套件名必须承重（QM-6 前端轴 R2-6）：探针按「文件 + 用例名」匹配，套件名原先只是个被拼进
    // 样本行的常量——它漂移时拼出来的行照样能被解析，等于不承重。这里反过来要求**真实源文件里
    // 的 describe 字面串必须等于该常量**，于是改名要么两处一起改、要么这条红。
    const rawSelf = fs.readFileSync(__filename, 'utf8');
    expect(rawSelf, '套件名常量与真实 describe 字面串脱钩 ⇒ 拼样本行的常量不承重')
      .toContain("describe('" + cliE2eBudget.GUI_CLI_E2E_SUITE_NAME + "'");

    // 剥注释这条本身也要有正负控（后端轴 #1）：块注释里的病灶引用必须被剥，
    // 而 URL 里的 `//` 不许被误剥（误剥会把真违规洗白）。
    expect(cliE2eBudget.stripComments('a /* 旧预算 10000ms 的说明 */ b')).not.toContain('10000');
    expect(cliE2eBudget.stripComments('a // 旧预算 10000ms 的说明\nb')).not.toContain('10000');
    expect(cliE2eBudget.stripComments('const u = "http://example.com"; // t 10000')).toContain('http://example.com');
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

  it('push 触发保持原样，且 push.paths 与 GUI_PATHS 是同一份清单（防两侧相关性静默漂移）', () => {
    const { workflow } = readWorkflow('gui-test.yml');
    const { GUI_PATHS } = require(path.join(PROJECT_ROOT, 'scripts', 'ci-gui-relevance.js'));
    const pushPaths = (workflow.on.push.paths || []).slice().sort();
    const gui = GUI_PATHS.slice().sort();

    // 全集相等，而不是 arrayContaining 抽查：判据（PR 侧）与 push 触发用的是同一份相关性清单，
    // 有人只改一边就会在这里红 —— 轴 2 外部评审指出的漂移面（Warning，已采纳）。
    expect(pushPaths).toEqual(gui);
    expect(pushPaths.length).toBeGreaterThanOrEqual(5);
    // 注：不另钉"字面五项清单"——那会与「清单允许合法变长、只禁缩水」的设计意图对打（轴 2 的 Q1-b 因此不采纳）。
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
    // 步骤名自本轮起带 `, shard <i>/<n>` 后缀；精确等值会得到空集，
    // 而 `toHaveLength(1)` 会因此红得莫名其妙 —— 前缀匹配才是这条断言的本意。
    const testSteps = steps.filter((step) => String(step.name || '').startsWith('Unit tests (Vitest, non-Electron, single-worker deterministic'));

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
    const unitStep = findUnitTestStep(job);
    const diagnosticStep = steps.find((step) => step.name === 'Vitest failure diagnostics');

    expect(job.env).toMatchObject({ NODE_ENV: 'test' });
    expect(unitStep.run).toMatch(/BUDGET_SECONDS=\d+/);
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
   * #2458 + 2026-10-20 分片：**单片**串行单 worker 的步骤级预算。
   *
   * 依据只能取步骤级实测：`timeout(1)` 约束的就是这一步，而 job 级总时长还含两次
   * install / checkout / 冒烟，拿它当步骤基线会系统性高估（来龙去脉与两组数字见
   * docs/electron-ci-step-budget-baseline.md）：
   *   - 整轮步骤健康耗时 794 s（run 36380533567，main push `bef5fb72` 的自证行
   *     `[electron-ci-timeout-budget] elapsed=794s budget=2100s rc=0`）；
   *   - 被替换掉的旧墙 1200 s（`--kill-after=30s 20m`）。
   * 切成 N 片后，单片健康耗时 ≈ 794/N，所以基线也必须按片摊薄 —— 拿整轮 794 s
   * 去卡单片预算，会得出「必须 ≥1588 s」这种把分片的收益又吐回去的结论。
   */
  it('Electron CI 串行单测预算挂实测、超时可自证、且不与 job 级倒挂', () => {
    const { source, workflow } = readWorkflow('electron-ci.yml');
    const job = workflow.jobs['electron-tests'];
    const unitStep = findUnitTestStep(job);

    // 1) 预算挂在**单片**步骤级实测上（基线按片摊薄，见上面的注释）
    const shardSet = matrixShardSet(job);
    assert(shardSet.length > 0, 'matrix.shard 解析不出片数 ⇒ 分片已失效');
    const budgetSeconds = Number(unitStep.run.match(/BUDGET_SECONDS=(\d+)/)[1]);
    const measuredStepElapsedSeconds = 794; // 整轮自证行实测，不是 job 总时长
    const perShardHealthySeconds = measuredStepElapsedSeconds / shardSet.length;
    expect(budgetSeconds).toBeGreaterThanOrEqual(perShardHealthySeconds * 3);
    // 旧魔数不得复活（它的问题不是"比自然耗时只多 1 分钟"，而是既无实测依据、红时又不可归因）
    expect(unitStep.run).not.toMatch(/--kill-after=30s 20m/);

    // 2) 超时必须能自证，而不是让人再去下 7MB 日志反推
    expect(unitStep.run).toContain('TIMEOUT_BUDGET_EXCEEDED');
    expect(unitStep.run).toContain('elapsed=');
    // 输出被 tee 走之后，判成败只能读 PIPESTATUS：`cmd | tee` 的 $? 是 tee 的（恒 0）
    expect(unitStep.run).toContain('RC=${PIPESTATUS[0]}');
    expect(unitStep.run).toMatch(/exit "\$\{RC\}"/);

    // 2b) 光有这些行还不够 —— 必须确认 `set +e` 真的把它们从 `-e` 的手里救出来了。
    //     顺序错了（或漏了 set +e）时上面每一条 `toContain` 依然成立，而运行时一行都执行不到，
    //     这正是 #2525 到 2026-10-20 之间那段的真实状态。真正的行为验证在
    //     「自证块必须在 bash -e -o pipefail 下真能执行」那条里，这里只锁静态顺序作早期信号。
    const runText = String(unitStep.run);
    const idxSetPlusE = runText.indexOf('set +e');
    const idxPipeline = runText.indexOf('timeout --signal=TERM');
    const idxPipeStatus = runText.indexOf('RC=${PIPESTATUS[0]}');
    const idxSetMinusE = runText.indexOf('set -e', idxPipeStatus);
    expect(idxSetPlusE, '缺 set +e ⇒ -e 会在 timeout 返回 124 时直接退出步骤').toBeGreaterThan(-1);
    expect(idxSetPlusE).toBeLessThan(idxPipeline);
    expect(idxSetMinusE, 'set -e 必须恢复，否则本步骤后续失败会被吞').toBeGreaterThan(idxPipeStatus);

    // 3) 预算不得倒挂：job 级上限必须容得下「本步骤预算 + 其余显式 timeout-minutes 之和」，
    //    否则抬内层只是把不可归因的超时从 timeout(1) 换成 Actions 的 job killer。
    const otherCapsMinutes = job.steps.reduce(
      (sum, step) => sum + (typeof step['timeout-minutes'] === 'number' ? step['timeout-minutes'] : 0),
      0,
    );
    expect(job['timeout-minutes']).toBeGreaterThan(otherCapsMinutes + budgetSeconds / 60);
    expect(source).toContain('# 预算不得倒挂');
  });

  /**
   * #2525 的标题是「让超时失败能自证」，正文也写了 `RC=${PIPESTATUS[0]}` 与一整段
   * `TIMEOUT_BUDGET_EXCEEDED` 诊断。但 GitHub 给的 shell 是 `bash -e -o pipefail`：
   * `timeout` 返回 124 时 `-e` **立刻退出步骤**，其后每一行都不执行 —— 实测两次
   * 失败 attempt 的日志里都没有 `[electron-ci-timeout-budget] elapsed=… rc=…`。
   *
   * 旧锁的判据域是「这四行字符串在 YAML 里存在」，被测性质却是「这四行会在运行时执行」。
   * 两者不是一回事，于是锁一直是绿的、自证一直是死的。
   *
   * 本用例把判据域换成**真执行**：取该步骤 `run` 的原文，在同样的 `-e -o pipefail` 下跑一遍，
   * 只把两个量按题意替换（预算压到 1s 让 timeout 真的触发；`pnpm` 用函数桩接管，
   * 因为这里不该也不可能跑整套桌面测试），然后断言自证行真的打印出来。
   */
  it('自证块必须在 bash -e -o pipefail 下真能执行，而不是只在 YAML 里存在', () => {
    const { workflow } = readWorkflow('electron-ci.yml');
    const unitStep = findUnitTestStep(workflow.jobs['electron-tests']);

    // 只做两处按题意的替换，其余结构（timeout / tee / PIPESTATUS / 自证块）一字不动：
    //   ① 预算压到 1s，让 timeout(1) 必然触发；
    //   ② 内层命令换成必超时的 `sleep`。
    // ② 用**文本替换**而不是伪造 `pnpm` 可执行文件：`timeout` 是外部命令，
    // 既看不见 shell 函数表（函数桩会得到 exit 127），
    // 而靠 PATH 注入 stub 又会被本机含中文的用户名目录搅乱（实测 127）。
    const body = String(unitStep.run)
      .replace(/BUDGET_SECONDS=\d+/, 'BUDGET_SECONDS=1')
      .replace(/pnpm --filter[\s\S]*?2>&1 \| tee "\$LOG"/, 'sleep 2 2>&1 | tee "$LOG"');
    assert(body.includes('sleep 2 2>&1 | tee "$LOG"'), '内层命令替换失败 ⇒ 会真跑整套桌面测试');

    const bash = resolveGitBash();
    assert(bash, 'Git Bash 必须可解析：bash 步骤的语义只能用它复现');

    const res = spawnSync(bash, ['-e', '-o', 'pipefail', '-c', body], {
      cwd: fs.mkdtempSync(path.join(os.tmpdir(), 'electron-ci-budget-')),
      encoding: 'utf8',
      timeout: 60000,
      // PATH 必须显式给成 POSIX 形态：Node 直接 spawn MSYS 的 bash 时不会做
      // Windows→POSIX 转换，继承来的 `C:\…;C:\…` 会被按 ':' 切坏，
      // 连 `date` 都 command not found（实测 127，红得完全不是被测的性质）。
      // 这里只需要 coreutils：date / timeout / tee / grep / sed / tail / sleep。
      env: { ...process.env, PATH: '/usr/bin:/bin' },
    });
    const out = String(res.stdout || '') + String(res.stderr || '');

    // ① 成败形状：被步骤级 timeout 掐断，不是断言失败
    expect(res.status, 'exit 124 = 被 timeout(1) 掐断').toBe(124);
    // ② 自证行必须真的出现 —— #2525 承诺而从未兑现的那一半
    expect(out, '自证行缺席 ⇒ 自证块又被 -e 提前杀掉了').toContain('[electron-ci-timeout-budget] elapsed=');
    expect(out).toMatch(/rc=124/);
    expect(out).toContain('TIMEOUT_BUDGET_EXCEEDED');
    // ③ 覆盖到诊断尾部（对抗审查 i7）：`grep -c` 在空 log 上返回 1，若少了 `|| true`，
    //    恢复后的 `set -e` 会把步骤码改写成非 124，而 `status===124` 会红得指错根因。
    //    这一行证明控制流真的穿过了那条 grep 并走到 sed 输出。
    expect(out).toContain('已完成测试行数');
    // 显式放宽用例超时：`spawnSync` 阻塞事件循环，vitest 的 10s 默认值**无法中断**它 ——
    // 超时只会延后到子进程返回才报（实测报成 15s 的 "Test timed out in 10000ms"）。
    // 而 Git Bash 在 Windows 上每次起进程约 0.5s，本用例要起 bash + date×2 + grep/sed/tail×6。
  }, SHELL_HARNESS_TIMEOUT_MS);

  /**
   * 工作流自己的注释写着「根因修法是按 --shard 把这一轮切开（issue 档 2）」，
   * 并且明确「不是继续加大预算」。本用例锁的就是「真切开了」，而不是只把墙抬高。
   *
   * 699s~794s 的健康耗时对一整轮串行；切成 N 片后单片健康耗时约为 1/N，
   * 于是同样的 runner 负载放大不再撞墙，而 `--maxWorkers=1 --no-file-parallelism`
   * 的确定性语义与「main 侧第二次独立运行」的 flake 检出原意都不丢。
   */
  it('Electron CI 串行单测按 shard 切开，单片预算挂单片实测', () => {
    const { workflow } = readWorkflow('electron-ci.yml');
    const job = workflow.jobs['electron-tests'];
    const matrix = job.strategy && job.strategy.matrix;

    assert(matrix, '必须先有 matrix，才谈得上「切开」而不是「抬墙」');
    // matrix.shard 按事件分档（对抗审查 i2）：PR 上只 1 片 —— 本 job 的测试步骤由
    // `if: event_name != 'pull_request'` 跳过，而 checkout/install/electron runtime/冒烟
    // 这些**无 if** 的步骤照样跑，三片会把它们各跑三遍、零分片收益。
    const shardExpr = JSON.stringify(matrix.shard);
    assert(shardExpr.includes('pull_request'), '矩阵必须按事件分档，否则 PR 侧 setup 会白跑 N 遍');
    const fullSet = matrixShardSet(job); // 非 PR 那一档
    // 片数写死而不是 `>= 2`（对抗审查 i3）：下限若允许降到 2，则「2 片 + 单片预算 1191s」
    // 能同时满足 `budget >= 单片健康×3` 与 `budget < 20*60`，反向判据实质失效。
    assert(fullSet && fullSet.length === 3, '非 PR 档必须恰好 3 片，否则「减片 + 抬预算」可组合回退');

    // required context 名必须由本作业自己报出（2026-10-20 实测）：GitHub 的 ruleset
    // `main-ci-gate` 要求的 context 就是 `electron-tests`，而 matrix 默认报 `electron-tests (1)`
    // ⇒ 那个 context 永不出现、22 项全绿的 PR 也判 `base branch policy prohibits`。
    // 正解是给 matrix 作业一个**静态** `name`，让每一片都报同一个 check 名（分片全绿才算绿）。
    // 试过并**不可行**的两条，记在这里免得后人重走：① 另加一个 `name: electron-tests` 的汇入作业
    // —— 会把整个 workflow 判成不可解析（幻影 push run + 0 job，两次复现，`always()` 与
    // `always() && …` 两种写法都试过）；② 把两条条件用 `&&` 串在汇入作业的 `if` 上 —— 同上。
    expect(job.name, 'matrix 作业必须带静态 name: electron-tests').toBe('electron-tests');
    expect(workflow.jobs['electron-tests-summary'], '不该再有汇入作业（那条路会让 workflow 无法解析）').toBeUndefined();
    const unitStep = findUnitTestStep(job);
    const run = String(unitStep.run);

    // 每片真的只跑自己那一份，且总数取自 matrix 而非第二个魔数
    expect(run).toContain('--shard=${{ matrix.shard }}/${{ strategy.job-total }}');
    // 确定性语义不得因为分片而丢失
    expect(run).toContain('--maxWorkers=1');
    expect(run).toContain('--no-file-parallelism');

    // 单片预算：健康耗时按片数摊薄后仍要留 3 倍余量
    const measuredStepElapsedSeconds = 794; // 整轮自证行实测（bef5fb72）
    const perShardHealthySeconds = measuredStepElapsedSeconds / fullSet.length;
    const budgetSeconds = Number(run.match(/BUDGET_SECONDS=(\d+)/)[1]);
    expect(budgetSeconds).toBeGreaterThanOrEqual(perShardHealthySeconds * 3);
    // 关键的反向判据：切成 N 片之后，单片预算必须**低于**被替换掉的 20 分钟旧墙，
    // 否则说明只是把「抬预算」包装成「分片」，根因没动。
    expect(budgetSeconds).toBeLessThan(20 * 60);
    // 上界同时钉住现值（对抗审查 i3）：只写 `< 1200` 时 1191s 也能过，而这条判据要防的是
    // 「抬预算」而不是「比旧墙小一点」。要改这个数就必须同时改这里，改的人会看到这行注释。
    // TODO(校准)：3 片与 900s 都建立在整轮 794s 的**均值**假设上；`vitest --shard` 按文件切，
    // 各片时长未必均匀。接通自证之后取首轮逐片真实 elapsed，把 794 换成逐片实测最大值再复核。
    expect(budgetSeconds).toBeLessThanOrEqual(900);
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
