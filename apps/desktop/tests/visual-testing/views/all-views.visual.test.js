/**
 * 真实路由单视图视觉门禁。
 * 运行: node tests/visual-testing/views/all-views.visual.test.js
 */

const { VisualTestRunner } = require('../test-runner');

function routeView(name, route, waitFor, checkName = '页面主标题', expectedRoute = route, checks) {
  return {
    name,
    route,
    expectedRoute,
    waitFor,
    checks: checks || [{ name: checkName, selector: waitFor }],
  };
}

const viewTests = [
  routeView('hot-topics', '/hot-topics', '.hot-topics-page .page-title:has-text("热门选题")'),
  routeView('prompt-eval', '/prompt-eval', '.prompt-eval-page h1:has-text("提示词优化效果评估")'),
  routeView('home-default', '/', '.mp-home .mp-home-welcome'),
  routeView('comments-list', '/comments', '.cohere-main .page-title:has-text("评论管理")'),
  routeView('first-run', '/first-run', '.cohere-main h2:has-text("欢迎使用社媒管家")'),
  routeView(
    'publish-form',
    '/publish',
    '.mp-workspace .target-selector [data-testid^="platform-"]',
    '发布目标平台已加载',
    '/publish',
    [
      { name: '页面主标题', selector: '.mp-workspace .page-title:has-text("一键发布")' },
      { name: '发布目标平台已加载', selector: '.mp-workspace .target-selector [data-testid^="platform-"]' },
    ],
  ),
  routeView(
    'publish-history',
    '/publish/history',
    '.mp-workspace .publish-history-page h1:has-text("发布记录")',
    '页面主标题',
    '/publish/history',
    [
      { name: '页面主标题', selector: '.mp-workspace .publish-history-page h1:has-text("发布记录")' },
      { name: '新建发布入口', selector: '.mp-workspace [data-testid="new-publish"]' },
    ],
  ),
  routeView('accounts-list', '/accounts', '.mp-workspace .accounts-page'),
  routeView('dashboard', '/dashboard', '.cohere-main .page-title:has-text("数据看板")'),
  routeView('collection', '/collection', '.cohere-main .collection-tab-btn.active'),
  routeView('copy-library', '/copy-library', '.copy-library-page [data-testid="copy-library-title"]'),
  routeView('keyword-monitor', '/keywords', '.cohere-main .page-title:has-text("关键词监测")'),
  routeView('viral-analysis', '/viral-analysis', '.cohere-main .page-title:has-text("爆款分析")'),
  routeView('rewrite', '/rewrite', '.cohere-main .page-title:has-text("文案改写")'),
  routeView('providers-redirect', '/providers', '.cohere-main .page-title:has-text("模型服务商设置")', '页面主标题', '/model-providers'),
  routeView('model-providers', '/model-providers', '.cohere-main .page-title:has-text("模型服务商设置")'),
  routeView('video-clone', '/video-clone', '.video-clone-view'),
  routeView('film-engineering', '/film-engineering', '.film-engineering-view'),
  routeView('create-editor', '/create', '.cohere-main h1:has-text("视频创作")'),
  routeView('create-pipeline-redirect', '/create/pipeline', '.cohere-main h1:has-text("视频创作")', '页面主标题', '/create'),
  routeView('create-result', '/create/result', '.cohere-main h1:has-text("视频预览")'),
  routeView('create-history', '/create/history', '.history-status-tabs', '历史记录标签', '/create?view=history'),
  routeView('cloud-publish', '/cloud-publish', '.cohere-main .page-title:has-text("云端发布")'),
  routeView('intelligence', '/intelligence', '.cohere-main .page-title:has-text("内容情报")'),
  routeView('calendar', '/calendar', '.cohere-main .page-title:has-text("发布日历")'),
  routeView('project-library', '/library', '.cohere-main h1:has-text("项目库")'),
  routeView('production-board', '/board/e2e-project', '.cohere-main .board-page .back-link:has-text("项目库")', '生产看板'),
  routeView('contact-sheet', '/board/e2e-project/contact-sheet', '.cohere-main .cs-title:has-text("场景审批")'),
  routeView('replay-timeline', '/replay/e2e-project', '.cohere-main .replay-title:has-text("生产回放")'),
  routeView('auto-pipeline', '/auto-pipeline', '.cohere-page-header .page-title:has-text("全自动内容生产与发布")'),
  routeView('knowledge-base', '/knowledge-base', '.cohere-page-header .page-title:has-text("知识库")'),
  routeView('performance-insights', '/performance-insights', '.cohere-page-header .page-title:has-text("效果洞察")'),
  routeView('member-center', '/member-center', '.member-center-view .page-title:has-text("会员中心")'),
];

function createRunner(options = {}) {
  return new VisualTestRunner({
    url: options.url || process.env.TEST_URL || 'http://127.0.0.1:5174',
    headless: options.headless ?? (process.env.HEADLESS !== 'false'),
  });
}

async function runViewSuite(tests = viewTests, options = {}) {
  const runner = options.runner || createRunner(options);
  const failures = [];
  let fatalError = null;

  try {
    await runner.launch();
    for (const test of tests) {
      console.log('视觉测试: ' + test.name);
      try {
        await runner.aiVisionTest(test.name, test.route, test.checks, {
          expectedRoute: test.expectedRoute,
          waitFor: test.waitFor,
        });
      } catch (error) {
        failures.push({ test: test.name, route: test.route, error });
        const alreadyRecorded = runner.results.some(result => (
          result.test === test.name
          && (result.status === 'FAILED' || result.status === 'ERROR')
        ));
        if (!alreadyRecorded) {
          runner.results.push({
            test: test.name,
            route: test.route,
            status: 'ERROR',
            error: error.message,
          });
        }
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
  }

  if (fatalError) throw fatalError;
  if (failures.length > 0) {
    const error = new Error(
      '单视图视觉门禁失败: '
      + failures.map(failure => failure.test + ': ' + failure.error.message).join(' | '),
    );
    error.code = 'ERR_VISUAL_SUITE_FAILED';
    error.failures = failures;
    throw error;
  }

  return {
    total: tests.length,
    passed: tests.length,
    results: runner.results,
  };
}

async function runAllViewTests(options = {}) {
  return runViewSuite(viewTests, options);
}

async function runSingleView(viewName, options = {}) {
  const test = viewTests.find(view => view.name === viewName);
  if (!test) {
    const error = new Error('未找到视图: ' + viewName);
    error.code = 'ERR_VISUAL_VIEW_NOT_FOUND';
    throw error;
  }
  return runViewSuite([test], options);
}

async function main(args = process.argv.slice(2)) {
  if (args[0] === '--list') {
    viewTests.forEach(view => console.log(view.name));
    return;
  }
  if (args[0] === '--single') {
    if (!args[1]) throw new Error('--single 缺少视图名称');
    await runSingleView(args[1]);
    return;
  }
  await runAllViewTests();
}

if (require.main === module) {
  main().catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}

module.exports = {
  viewTests,
  runViewSuite,
  runAllViewTests,
  runSingleView,
  main,
};
