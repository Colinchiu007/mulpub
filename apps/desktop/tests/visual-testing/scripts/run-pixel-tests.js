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
  // 发布目标由 IPC 异步加载；等待平台选项，避免在空列表状态截图。
  { name: 'publish-form', route: '/publish', waitFor: '.mp-workspace .target-selector [data-testid^="platform-"]' },
  { name: 'publish-history', route: '/publish/history', waitFor: '.mp-workspace .publish-history-page h1:has-text("发布记录")' },
  { name: 'create-editor', route: '/create', waitFor: '.cohere-main h1:has-text("视频创作")' },
  { name: 'model-providers', route: '/model-providers', waitFor: '.cohere-main .page-title:has-text("模型服务商设置")' },
  { name: 'first-run', route: '/first-run', waitFor: '.fullscreen-main h2:has-text("欢迎使用社媒管家")' },
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

async function runPixelSuite(tests = pixelTests, options = {}) {
  const runner = options.runner || createRunner(options);
  const results = [];
  let fatalError = null;

  try {
    await runner.launch();
    for (const test of tests) {
      console.log(test.name + ' (' + test.route + ')...');
      try {
        const result = await runner.pixelRegressionTest(test.name, test.route, {
          expectedRoute: test.expectedRoute,
          waitFor: test.waitFor,
          prepare: test.prepare,
        });
        const status = result && result.status === 'BASELINE_CREATED'
          ? 'BASELINE_CREATED'
          : 'PASSED';
        results.push({ test: test.name, route: test.route, status, result });
        console.log('  ' + status);
      } catch (error) {
        results.push({
          test: test.name,
          route: test.route,
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
  return { results, failed, passed, baselined };
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

async function main() {
  console.log('像素视觉门禁');
  console.log('目标: ' + (process.env.TEST_URL || 'http://127.0.0.1:5174'));
  const tests = selectPixelTests();
  if (tests.length !== pixelTests.length) {
    console.log('子集: ' + tests.map((test) => test.name).join(', '));
  }
  const summary = await runPixelSuite(tests);
  console.log(
    '像素结果: '
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
};
