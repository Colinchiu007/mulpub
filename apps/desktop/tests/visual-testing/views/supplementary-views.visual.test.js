/**
 * 补充视觉测试：覆盖附加路由、弹窗和全局 UI 状态。
 * 运行: node tests/visual-testing/views/supplementary-views.visual.test.js
 */

const path = require('path');
const { VisualTestRunner } = require('../test-runner');

function check(name, selector, prompt) {
  return { name, selector, prompt };
}

const supplementaryViewTests = [
  {
    name: 'first-run',
    route: '/first-run',
    waitFor: 'h2:has-text("欢迎使用社媒管家")',
    checks: [
      check('欢迎页面', 'h2:has-text("欢迎使用社媒管家")', '显示首次运行欢迎页面'),
      check('开始按钮', 'button:has-text("开始配置")', '显示开始配置按钮'),
      check('步骤指示', '.cohere-card [style*="border-radius"]', '显示步骤进度指示器'),
    ],
  },
  {
    name: 'dashboard',
    route: '/dashboard',
    waitFor: '.page-title:has-text("数据看板")',
    checks: [
      check('数据卡片', '.cohere-stat-grid .cohere-stat-card', '显示数据统计卡片'),
      check('数据区域', '.cohere-section-title:has-text("各平台数据")', '显示平台数据区域'),
      check('刷新入口', 'button:has-text("刷新")', '显示数据刷新入口'),
    ],
  },
  {
    name: 'calendar',
    route: '/calendar',
    waitFor: '.calendar-grid .cal-day',
    checks: [
      check('日历网格', '.calendar-grid', '显示月度日历网格'),
      check('月份切换', 'button:has-text("▶")', '显示月份切换按钮'),
      check('今天按钮', 'button:has-text("今天")', '显示今天按钮'),
      check('日期选择', '.calendar-grid .cal-day', '显示可选择日期'),
    ],
  },
  {
    name: 'cloud-publish',
    route: '/cloud-publish',
    waitFor: '.page-title:has-text("云端发布")',
    checks: [
      check('云端发布表单', '.cohere-form', '显示云端发布表单'),
      check('平台选择', '.cohere-form select', '显示目标平台选择'),
    ],
  },
  {
    name: 'viral-analysis',
    route: '/viral-analysis',
    waitFor: '.page-title:has-text("爆款分析")',
    checks: [
      check('爆文分析', '.page-title:has-text("爆款分析")', '显示爆款分析页面'),
      check('数据输入', '.cohere-input', '显示分析数据输入区域'),
    ],
  },
  {
    name: 'create-view-default',
    route: '/create',
    waitFor: 'h1:has-text("视频创作")',
    checks: [
      check('视图切换', '.view-tabs .view-tab', '显示创作视图切换'),
      check('流水线状态', '.pipeline-grid, .loading-state, .error-state', '显示流水线列表或明确状态'),
    ],
  },
  {
    name: 'create-result',
    route: '/create/result',
    waitFor: 'h1:has-text("视频预览")',
    checks: [
      check('结果页面', 'h1:has-text("视频预览")', '显示创作结果页面'),
      check('预览区域', '.result-page', '显示内容预览区域'),
      check('操作按钮', '.result-page button, .result-page a', '显示结果操作入口'),
    ],
  },
  {
    name: 'create-pipeline',
    route: '/create/pipeline',
    expectedRoute: '/create',
    waitFor: 'h1:has-text("视频创作")',
    checks: [
      check('流水线视图', '.view-tab.active:has-text("流水线创作")', '显示创作流水线视图'),
      check('流水线状态', '.pipeline-grid, .loading-state, .error-state', '显示流水线加载结果'),
    ],
  },
  {
    name: 'create-history',
    route: '/create/history',
    waitFor: '.history-status-tabs',
    checks: [
      check('历史标签', '.create-view-history .history-status-tabs', '显示历史记录标签'),
      check('记录状态', '.history-list, .empty-state, .loading-state', '显示历史记录或明确空状态'),
    ],
  },
  {
    name: 'intelligence-main',
    route: '/intelligence',
    waitFor: '.page-title:has-text("内容情报")',
    checks: [
      check('搜索入口', 'input[placeholder*="输入关键词"]', '显示搜索输入框'),
      check('搜索按钮', 'button:has-text("搜索")', '显示搜索按钮'),
      check('来源筛选', 'input[type="checkbox"]', '显示数据来源筛选'),
    ],
  },
  {
    name: 'keyword-monitor',
    route: '/keywords',
    waitFor: '.page-title:has-text("关键词监测")',
    checks: [
      check('监控面板', '.page-title:has-text("关键词监测")', '显示关键词监控面板'),
      check('关键词入口', 'input, button:has-text("添加")', '显示关键词输入或添加入口'),
    ],
  },
  {
    // 2026-09-14：升级入口由侧边栏 footer 独立按钮迁入底部用户菜单，
    // 「点击后显示弹窗」的断言改由单测覆盖（ProfileMenu.test.js 断言 upgrade 事件 → 侧边栏打开 UpgradeModal），
    // 这里只验证「底部 banner 可展开且菜单内含升级入口」这一可稳定截图的中间态。
    name: 'user-menu-upgrade-entry',
    route: '/',
    waitFor: '[data-testid="yixiaoer-profile"]',
    trigger: '[data-testid="yixiaoer-profile"]',
    afterTrigger: '[data-testid="profile-menu-upgrade"]',
    checks: [
      check('底部用户 banner', '[data-testid="yixiaoer-profile"]', '左下角显示用户 banner'),
      check('升级入口', '[data-testid="profile-menu-upgrade"]', '展开菜单后显示升级 Pro 入口'),
    ],
  },
  {
    name: 'model-provider-add-dialog',
    route: '/model-providers',
    waitFor: 'button:has-text("添加服务商")',
    trigger: 'button:has-text("添加服务商")',
    afterTrigger: '.el-dialog:has-text("添加服务商")',
    checks: [
      check('添加按钮', 'button:has-text("添加服务商")', '显示添加服务商按钮'),
      check('弹窗交互', '.el-dialog .category-grid', '显示服务商类别选择'),
    ],
  },
  {
    name: 'model-provider-edit-dialog',
    route: '/model-providers',
    waitFor: '.provider-card:has-text("deepseek") button[aria-label="编辑"]',
    trigger: '.provider-card:has-text("deepseek") button[aria-label="编辑"]',
    afterTrigger: '.el-dialog:has-text("编辑服务商")',
    checks: [
      check('编辑按钮', '.provider-card:has-text("deepseek") button[aria-label="编辑"]', '显示编辑服务商按钮'),
      check('编辑弹窗', '.el-dialog:has-text("编辑服务商")', '点击后显示编辑弹窗'),
    ],
  },
  {
    name: 'model-provider-delete-dialog',
    route: '/model-providers',
    waitFor: '.provider-card:has-text("custom_visual") button[aria-label="删除"]',
    trigger: '.provider-card:has-text("custom_visual") button[aria-label="删除"]',
    afterTrigger: '.el-dialog:has-text("确认删除")',
    checks: [
      check('删除按钮', '.provider-card:has-text("custom_visual") button[aria-label="删除"]', '显示删除服务商按钮'),
      check('确认弹窗', '.el-dialog:has-text("确认删除")', '点击后显示删除确认弹窗'),
    ],
  },
  {
    name: 'monitor-settings-dialog',
    route: '/monitor',
    waitFor: '.page-title:has-text("分屏监控")',
    checks: [
      check('监控面板', '.page-title:has-text("分屏监控")', '显示监控页面'),
      check('设置入口', '.layout-toggle, button:has-text("添加监控")', '显示布局或监控配置入口'),
    ],
  },
  {
    name: 'collection-confirm-dialog',
    route: '/collection',
    waitFor: '.collection-tab-btn.active',
    checks: [
      check('收藏列表', '.cohere-section-title:has-text("草稿箱")', '显示草稿列表'),
      check('删除入口', '.cohere-card-grid button:has-text("删除"), .cohere-empty', '显示删除入口或明确空状态'),
    ],
  },
  {
    name: 'sidebar-platform-list',
    route: '/',
    waitFor: '.cohere-sidebar',
    checks: [
      check('侧边栏', '.cohere-sidebar', '显示平台账号侧边栏'),
      check('平台图标', '.cohere-platform-item .platform-icon', '显示平台图标'),
      check('搜索框', '.cohere-sidebar-search input', '显示平台搜索框'),
      check('状态指示', '.cohere-platform-item .platform-status', '显示平台状态'),
    ],
  },
  {
    name: 'nav-active-state',
    route: '/accounts',
    waitFor: '.nav-item.active:has-text("账号管理")',
    checks: [
      check('导航高亮', '.nav-item.active:has-text("账号管理")', '高亮当前导航'),
      check('侧边栏联动', '.cohere-sidebar', '账号页保留平台侧边栏'),
    ],
  },
  {
    name: 'app-header-status',
    route: '/',
    waitFor: '.cohere-topnav',
    checks: [
      check('品牌标识', '.cohere-topnav .brand', '显示品牌标识'),
      check('运行状态', '.cohere-topnav .status-indicator', '显示服务运行状态'),
      check('升级按钮', '.cohere-topnav .pro-btn', '非 Pro 用户显示升级按钮'),
    ],
  },
];

function viewUrl(baseUrl, route, viewName) {
  const isolatedDocument = `visual-view=${encodeURIComponent(viewName)}`;
  return `${baseUrl.replace(/\/$/, '')}/?${isolatedDocument}#${route}`;
}

async function runViewTest(runner, test) {
  const consoleOffset = runner.consoleErrors.length;
  const pageOffset = runner.pageErrors.length;
  await runner._navigateToRoute(
    test.route,
    test.waitFor,
    test.expectedRoute || test.route,
    viewUrl(runner.url, test.route, test.name),
  );

  if (test.trigger) {
    await runner.page.click(test.trigger, { timeout: 5000 });
    await runner.page.waitForSelector(test.afterTrigger, { state: 'visible', timeout: 10000 });
  }

  const screenshotPath = path.join(runner.screenshotDir, `${test.name}.png`);
  await runner.page.screenshot({ path: screenshotPath, fullPage: true });

  const failedChecks = [];
  for (const item of test.checks) {
    const visible = await runner.page.locator(item.selector).first().isVisible();
    runner.results.push({
      test: test.name,
      check: item.name,
      status: visible ? 'PASSED' : 'FAILED',
      route: test.route,
      screenshotPath,
      prompt: item.prompt,
    });
    if (!visible) failedChecks.push(item.name);
  }

  runner._throwOnRuntimeErrors(test.name, consoleOffset, pageOffset);
  if (failedChecks.length > 0) {
    throw new Error(`${test.name} 断言失败: ${failedChecks.join(', ')}`);
  }
}

async function runViewSuite(tests, options = {}) {
  const runner = options.runner || new VisualTestRunner({
    url: options.url || process.env.TEST_URL || 'http://127.0.0.1:5174',
    headless: options.headless ?? (process.env.HEADLESS !== 'false'),
  });
  const failures = [];

  try {
    await runner.launch();
    for (const test of tests) {
      try {
        await runViewTest(runner, test);
      } catch (error) {
        failures.push({ test: test.name, error });
      }
    }
  } finally {
    await runner.close();
  }

  if (failures.length > 0) {
    const error = new Error(
      `补充视图失败: ${failures.map(item => `${item.test}: ${item.error.message}`).join(' | ')}`,
    );
    error.failures = failures;
    throw error;
  }

  return { total: tests.length, passed: tests.length };
}

async function runSupplementaryTests(options = {}) {
  return runViewSuite(supplementaryViewTests, options);
}

async function runSingle(name, options = {}) {
  const test = supplementaryViewTests.find(view => view.name === name);
  if (!test) throw new Error(`未找到补充视图: ${name}`);
  return runViewSuite([test], options);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--list') {
    supplementaryViewTests.forEach(view => console.log(view.name));
  } else {
    const run = args[0] === '--single'
      ? () => runSingle(args[1])
      : runSupplementaryTests;
    run().catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  supplementaryViewTests,
  viewUrl,
  runViewTest,
  runViewSuite,
  runSupplementaryTests,
  runSingle,
};
