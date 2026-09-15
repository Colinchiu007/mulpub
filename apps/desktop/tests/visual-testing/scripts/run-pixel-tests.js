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

async function main() {
  console.log('像素视觉门禁');
  console.log('目标: ' + (process.env.TEST_URL || 'http://127.0.0.1:5174'));
  const summary = await runPixelSuite();
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
  main,
};
