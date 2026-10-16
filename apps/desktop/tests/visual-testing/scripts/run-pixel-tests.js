/**
 * 浏览器可稳定渲染视图的像素门禁。
 * Electron 专属 WebContentsView 页面由真实 Electron E2E 覆盖，不在此处伪装为跳过成功。
 */

try { require('dotenv').config({ path: __dirname + '/../.env' }); } catch (_) {}

const { VisualTestRunner } = require('../test-runner');

const pixelTests = [
  // 首页已复刻为参考产品风格 .mp-home 布局，旧版 .cohere-main .page-title 选择器已不存在。
  { name: 'home-baseline', route: '/', waitFor: '.mp-home .mp-home-welcome' },
  { name: 'accounts-list', route: '/accounts', waitFor: '.mp-workspace .accounts-page' },
  // 账号云镜像入口的**开启态**（ADR-0006 默认关闭 + CI 无运营中心 ⇒ 上一行那条绿只证明"未开启态无回归"）。
  // 等待条件直接指向入口本身：渲染不出来就是这条失败，而不是"截一张没有按钮的图当基线"。
  // 本仓是 hash 路由，参数落在 fragment 内，由 useFeatureFlag 从 location.hash 的 query 段读取。
  // expectedRoute 先留空（= route）：本地实测一次，读 runner 报的 expectedHash vs hash，
  // 再决定是否需要写 vue-router 归一化后的形态（禁止凭猜测设值把就绪判定放宽）。
  { name: 'accounts-list-flag-on', route: '/accounts?mpFlag=account_cloud_sync=1',
    waitFor: '.mp-workspace .accounts-page [data-testid="account-cloud-sync"]' },
  // 发布目标由 IPC 异步加载；等待平台选项，避免在空列表状态截图。
  { name: 'publish-form', route: '/publish', waitFor: '.mp-workspace .target-selector [data-testid^="platform-"]' },
  { name: 'publish-history', route: '/publish/history', waitFor: '.mp-workspace .publish-history-page h1:has-text("发布记录")' },
  { name: 'create-editor', route: '/create', waitFor: '.cohere-main h1:has-text("视频创作")' },
  { name: 'model-providers', route: '/model-providers', waitFor: '.cohere-main .page-title:has-text("模型服务商设置")' },
  { name: 'first-run', route: '/first-run', waitFor: '.fullscreen-main h2:has-text("欢迎使用汤姆鱼")' },
  { name: 'dashboard', route: '/dashboard', waitFor: '.cohere-main .page-title:has-text("数据看板")' },
  { name: 'calendar', route: '/calendar', waitFor: '.cohere-main .page-title:has-text("发布日历")' },
  { name: 'cloud-publish', route: '/cloud-publish', waitFor: '.cohere-main .page-title:has-text("云端发布")' },
  { name: 'viral-analysis', route: '/viral-analysis', waitFor: '.cohere-main .page-title:has-text("爆款分析")' },
  { name: 'create-result', route: '/create/result', waitFor: '.cohere-main h1:has-text("视频预览")' },
  { name: 'create-pipeline', route: '/create/pipeline', expectedRoute: '/create', waitFor: '.cohere-main h1:has-text("视频创作")' },
  { name: 'create-history', route: '/create/history', expectedRoute: '/create?view=history', waitFor: '.history-status-tabs' },
  // 故事讲述详情页：selectedPipeline 由卡片点选写入组件态，无路由可直达，故需 prepare 交互链。
  // 等待 .s2v-config-section 保证四组配置面板已完整渲染后才截图（IPC 夹具提供流水线列表）。
  // 先显式切回「流水线创作」页签：hash 导航不重载文档，前序用例（create-history）会把
  // CreateView 留在 history 视图，不切回则卡片不存在，用例结果依赖执行顺序。
  {
    name: 'create-story2video-detail',
    route: '/create',
    expectedRoute: '/create',
    waitFor: '.cohere-main h1:has-text("视频创作")',
    prepare: async (page) => {
      await page.click('.view-tabs .view-tab:nth-child(1)');
      await page.waitForSelector('.pipeline-card[data-pipeline-id="story2video-compose"]', { timeout: 15000 });
      await page.click('.pipeline-card[data-pipeline-id="story2video-compose"]');
      await page.waitForSelector('.s2v-config-section', { timeout: 15000 });
    },
  },
  { name: 'intelligence', route: '/intelligence', waitFor: '.cohere-main .page-title:has-text("内容情报")' },
  { name: 'keyword-monitor', route: '/keywords', waitFor: '.cohere-main .page-title:has-text("关键词监测")' },
  { name: 'collection', route: '/collection', waitFor: '.cohere-main .collection-tab-btn.active' },
  // 播客频道（2026-10-09，ADR-0008 协议通道）：等待页面主标题本身，渲染不出来即本条失败。
  // route/waitFor 必须与 all-views 的 viewTests 逐字一致（visual-ci「双清单漂移」锁）。
  { name: 'podcast-channel', route: '/podcast', waitFor: '.podcast-channel-page [data-testid="podcast-page-title"]' },
];

function createRunner(options = {}) {
  const configuredThreshold = Number(process.env.PIXEL_THRESHOLD);
  return new VisualTestRunner({
    url: options.url || process.env.TEST_URL || 'http://127.0.0.1:5174',
    pixelThreshold: Number.isFinite(configuredThreshold) && configuredThreshold > 0
      ? configuredThreshold
      : undefined,
  });
}

/**
 * 解析本次跑的主题（批次 1：暗色基线通道）。
 * `THEME=dark` 跑暗色一遍（读 `<view>-dark.png` 基线）；其余/未设一律浅色，
 * 非法值不抛错也不产出第三套命名 —— 与 runner 侧 `_applyTheme` 的归一化保持同一口径。
 */
function resolveTheme(rawTheme = process.env.THEME) {
  return String(rawTheme || '').trim().toLowerCase() === 'dark' ? 'dark' : 'light';
}

async function runPixelSuite(tests = pixelTests, options = {}) {
  const runner = options.runner || createRunner(options);
  const theme = options.theme || resolveTheme();
  const themeLabel = theme === 'dark' ? 'dark（暗色）' : 'light（浅色）';
  const results = [];
  let fatalError = null;

  try {
    await runner.launch();
    for (const test of tests) {
      console.log(`[${theme}] ` + test.name + ' (' + test.route + ')...');
      try {
        const result = await runner.pixelRegressionTest(test.name, test.route, {
          expectedRoute: test.expectedRoute,
          waitFor: test.waitFor,
          prepare: test.prepare,
          theme,
        });
        const status = result && result.status === 'BASELINE_CREATED'
          ? 'BASELINE_CREATED'
          : 'PASSED';
        results.push({ test: test.name, route: test.route, theme, status, result });
        console.log('  ' + status);
      } catch (error) {
        results.push({
          test: test.name,
          route: test.route,
          theme,
          status: 'FAILED',
          error: error.message,
        });
        console.log('  FAILED: ' + error.message.split('\n')[0]);
      }
    }
  } catch (error) {
    fatalError = error;
  } finally {
    try {
      await runner.close();
    } catch (error) {
      fatalError ||= error;
    }
    try {
      runner.generateReport();
    } catch (error) {
      fatalError ||= error;
    }
  }

  if (fatalError) throw fatalError;

  const failed = results.filter(result => result.status === 'FAILED').length;
  const baselined = results.filter(result => result.status === 'BASELINE_CREATED').length;
  const passed = results.length - failed - baselined;
  return { results, failed, passed, baselined, theme, themeLabel };
}

/**
 * 按名称子集跑（PIXEL_ONLY=a,b）。
 * 用途：本地重生成基线时必须限定范围——全量 UPDATE_BASELINE 会把与本任务无关的
 * 环境差（字体/滚动条等）一并烘进基线，反而抬高 CI 误报风险。
 */
function selectPixelTests() {
  const only = String(process.env.PIXEL_ONLY || '')
    .split(',')
    .map((name) => name.trim())
    .filter(Boolean);
  if (only.length === 0) return pixelTests;
  const picked = pixelTests.filter((test) => only.includes(test.name));
  const unknown = only.filter((name) => !pixelTests.some((test) => test.name === name));
  if (unknown.length > 0) {
    throw new Error('PIXEL_ONLY 包含未知视图名: ' + unknown.join(', ') + '；可用: ' + pixelTests.map((t) => t.name).join(', '));
  }
  return picked;
}

/**
 * 视觉环境前置检查：把"这台机器渲染不了"与"UI 回归了"分成两类结论。
 *
 * 为什么必须单独成码：`chromium.launch()` 在缺浏览器的机器上抛的 Playwright 原文会被
 * `main().catch` 压成一句「像素门禁失败: …」+ exit 1，与真实回归**同形**。两种后果都发生过：
 * ① 把环境问题当回归去改代码；② 以"我跑了 test:visual:pixel 且它没报回归"当视觉中性证据
 * —— 而实际上一帧都没渲染。判据一律以 CI 的 `QG Visual` 为准，本机跑前先过这道检查。
 *
 * @param {{resolveExecutablePath?: () => string, existsSync?: (p: string) => boolean}} [options]
 */
const VISUAL_ENV_MISSING = 'ERR_VISUAL_ENV_MISSING'
const VISUAL_ENV_REMEDY = 'cd apps/desktop && PLAYWRIGHT_BROWSERS_PATH=.playwright-browsers pnpm exec playwright install chromium'

function preflightVisualEnvironment (options = {}) {
  const resolveExecutablePath = options.resolveExecutablePath || (() => require('playwright').chromium.executablePath())
  const existsSync = options.existsSync || require('fs').existsSync
  const fail = (detail) => {
    const error = new Error('视觉环境缺失：' + detail
      + '。这不是 UI 回归；未渲染任何一帧时不得据此声称"视觉无回归"（正解：' + VISUAL_ENV_REMEDY
      + '，或直接以 CI 的 QG Visual 结论为准）')
    error.code = VISUAL_ENV_MISSING
    throw error
  }
  let executablePath
  try {
    executablePath = String(resolveExecutablePath() || '')
  } catch (error) {
    fail('无法解析 Chromium 可执行路径（' + error.message + '）')
  }
  if (!existsSync(executablePath)) {
    fail('Chromium 可执行文件不存在：' + (executablePath || '(空路径)'))
  }
  return { executablePath }
}

const TARGET_REACHABILITY_TIMEOUT_MS = Number(process.env.VISUAL_TARGET_TIMEOUT_MS) || 3000

function defaultOpenConnection (host, port, timeoutMs) {
  const net = require('net')
  return new Promise((resolve, reject) => {
    const socket = net.createConnection({ host, port })
    const timer = setTimeout(() => {
      socket.destroy()
      reject(new Error('connect ETIMEDOUT ' + host + ':' + port))
    }, timeoutMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
    socket.once('connect', () => {
      clearTimeout(timer)
      socket.destroy()
      resolve()
    })
    socket.once('error', (error) => {
      clearTimeout(timer)
      reject(error)
    })
  })
}

/**
 * 目标可达性前置检查：dev server 没起时，每个视图都会死在 `page.goto: ERR_CONNECTION_REFUSED`，
 * 汇总成「像素视觉门禁存在 N 个失败」—— 与真实回归在退出码与文案上**完全同形**（本机实测过）。
 * 另一条更隐蔽的后果：TEST_URL 若指向并发会话在跑的 dev server，会**拿到别人构建的截图当自己的证据**，
 * 那种跑法一帧都不报错却全是假绿，所以文案必须把"是不是本 worktree 的构建"点名出来。
 *
 * @param {{url?: string, openConnection?: (host: string, port: number, timeoutMs: number) => Promise<void>}} [options]
 */
async function preflightVisualTarget (options = {}) {
  const rawUrl = options.url || process.env.TEST_URL || 'http://127.0.0.1:5174'
  let host
  let port
  try {
    const parsed = new URL(rawUrl)
    host = parsed.hostname
    port = Number(parsed.port) || (parsed.protocol === 'https:' ? 443 : 80)
  } catch (error) {
    const invalid = new Error('视觉环境缺失：TEST_URL 无法解析（' + rawUrl + '）。这不是 UI 回归')
    invalid.code = VISUAL_ENV_MISSING
    throw invalid
  }
  const openConnection = options.openConnection || defaultOpenConnection
  try {
    await openConnection(host, port, TARGET_REACHABILITY_TIMEOUT_MS)
  } catch (error) {
    const unreachable = new Error('视觉环境缺失：dev server 不可达 ' + host + ':' + port
      + '（' + error.message + '）。这不是 UI 回归 —— 缺宿主时每个视图都会死在 page.goto，'
      + '并被汇总成"N 个失败"，与真实回归同形。先起**本 worktree 自己的** dev server'
      + '（pnpm exec vite --port <独占端口>），或核对 TEST_URL 指向的是不是本 worktree 的构建'
      + '（并发会话共用同一端口会把别人的界面当自己的证据）；拿不到正确渲染时不得声称视觉无回归，'
      + '正解是以 CI 的 QG Visual 结论为准')
    unreachable.code = VISUAL_ENV_MISSING
    throw unreachable
  }
  return { host, port }
}

async function main(options = {}) {
  const envCheck = options.envCheck || preflightVisualEnvironment
  const targetCheck = options.targetCheck || preflightVisualTarget
  // 两项都必须前置于 launch：环境缺失时既不该启动浏览器，也不该留下一份"部分产物"被读成结论
  envCheck()
  await targetCheck({ url: options.url })
  const theme = options.theme || resolveTheme();
  console.log('像素视觉门禁');
  console.log('主题: ' + theme + (theme === 'dark' ? '（读 <view>-dark.png 基线）' : ''));
  console.log('目标: ' + (process.env.TEST_URL || 'http://127.0.0.1:5174'));
  const tests = selectPixelTests();
  if (tests.length !== pixelTests.length) {
    console.log('子集: ' + tests.map((test) => test.name).join(', '));
  }
  const summary = await runPixelSuite(tests, { theme, runner: options.runner });
  console.log(
    '像素结果[' + theme + ']: '
    + (summary.passed + summary.baselined)
    + '/' + summary.results.length
    + ' 通过，' + summary.failed + ' 失败',
  );
  if (summary.failed > 0) {
    const error = new Error('像素视觉门禁存在 ' + summary.failed + ' 个失败');
    error.code = 'ERR_PIXEL_GATE_FAILED';
    throw error;
  }
  return summary;
}

if (require.main === module) {
  main().catch(error => {
    console.error('像素门禁失败: ' + error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  pixelTests,
  runPixelSuite,
  selectPixelTests,
  main,
  preflightVisualEnvironment,
  preflightVisualTarget,
  TARGET_REACHABILITY_TIMEOUT_MS,
  VISUAL_ENV_MISSING,
  VISUAL_ENV_REMEDY,
  resolveTheme,
  main,
};
