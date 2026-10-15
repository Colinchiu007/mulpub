/**
 * 补充工作流测试：覆盖视频创作、日历、搜索和服务商管理等交互流程。
 * 运行: node tests/visual-testing/workflows/supplementary-workflows.visual.test.js
 */

const { VisualTestRunner } = require('../test-runner');

const supplementaryWorkflowTests = [
  {
    name: 'create-pipeline-select',
    route: '/create',
    steps: [
      { action: 'waitFor', selector: '.pipeline-card:first-child' },
      { action: 'screenshot', name: '流水线列表' },
      {
        action: 'click',
        selector: '.pipeline-card:first-child',
        name: '选择流水线',
        waitFor: { selector: '.pipeline-detail' },
      },
      { action: 'screenshot', name: '流水线详情' },
    ],
  },
  {
    name: 'create-quick-mode',
    route: '/create',
    steps: [
      { action: 'waitFor', selector: '.view-tab:has-text("快速渲染")' },
      {
        action: 'click',
        selector: '.view-tab:has-text("快速渲染")',
        name: '切换快速渲染',
        waitFor: { selector: '.view-tab.active:has-text("快速渲染")' },
      },
      { action: 'screenshot', name: '快速渲染模式' },
    ],
  },
  {
    name: 'create-history-tab',
    route: '/create',
    steps: [
      { action: 'waitFor', selector: '.view-tab:has-text("历史记录")' },
      {
        action: 'click',
        selector: '.view-tab:has-text("历史记录")',
        name: '切换历史记录',
        waitFor: { selector: '.view-tab.active:has-text("历史记录")' },
      },
      { action: 'screenshot', name: '历史记录' },
    ],
  },
  {
    name: 'create-pipeline-run',
    route: '/create',
    steps: [
      { action: 'waitFor', selector: '.pipeline-card:first-child' },
      {
        action: 'click',
        selector: '.pipeline-card:first-child',
        name: '选择流水线',
        waitFor: { selector: '.pipeline-detail' },
      },
      {
        action: 'click',
        selector: '.input-tab:has-text("文案")',
        name: '切换文案输入',
        waitFor: { selector: '.input-tab.active:has-text("文案")' },
      },
      { action: 'screenshot', name: '流水线配置' },
    ],
  },
  {
    name: 'calendar-navigate',
    route: '/calendar',
    steps: [
      { action: 'waitFor', selector: '.calendar-grid .cal-day' },
      { action: 'screenshot', name: '初始日历' },
      {
        action: 'click',
        selector: 'button:has-text("▶")',
        name: '下月',
        waitFor: { selector: '.cohere-page-header button + span', textChanged: true },
      },
      { action: 'screenshot', name: '下月日历' },
      {
        action: 'click',
        selector: 'button:has-text("◀")',
        name: '上月',
        waitFor: { selector: '.cohere-page-header button + span', textChanged: true },
      },
      { action: 'screenshot', name: '回到当月' },
    ],
  },
  {
    name: 'calendar-select-day',
    route: '/calendar',
    steps: [
      { action: 'waitFor', selector: '.calendar-grid .cal-day' },
      {
        action: 'click',
        selector: '.cal-day:nth-child(10)',
        name: '选择日期',
        waitFor: { selector: '.cal-day.selected' },
      },
      { action: 'screenshot', name: '选中日期详情' },
    ],
  },
  {
    name: 'calendar-today',
    route: '/calendar',
    steps: [
      { action: 'waitFor', selector: '.calendar-grid .cal-day' },
      {
        action: 'click',
        selector: 'button:has-text("▶")',
        name: '下月',
        waitFor: { selector: '.cohere-page-header button + span', textChanged: true },
      },
      {
        action: 'click',
        selector: 'button:has-text("今天")',
        name: '回到今天',
        waitFor: { selector: '.cal-day.today.selected' },
      },
      { action: 'screenshot', name: '今天高亮' },
    ],
  },
  {
    name: 'intelligence-search',
    route: '/intelligence',
    steps: [
      { action: 'waitFor', selector: 'input[placeholder*="输入关键词"]' },
      {
        action: 'fill',
        selector: 'input[placeholder*="输入关键词"]',
        value: 'AI工具',
        waitFor: { selector: 'input[placeholder*="输入关键词"]', value: 'AI工具' },
      },
      {
        action: 'click',
        selector: 'button:has-text("搜索")',
        name: '执行搜索',
        waitFor: { selector: '.cohere-card:has-text("搜索结果"), .cohere-card:has-text("暂无结果")' },
      },
      { action: 'screenshot', name: '搜索结果' },
    ],
  },
  {
    name: 'intelligence-source-filter',
    route: '/intelligence',
    steps: [
      { action: 'waitFor', selector: 'input[type="checkbox"]:checked' },
      { action: 'screenshot', name: '默认来源筛选' },
    ],
  },
  {
    name: 'model-provider-add-flow',
    route: '/model-providers',
    steps: [
      { action: 'waitFor', selector: '.page-title:has-text("模型服务商设置")' },
      { action: 'screenshot', name: '服务商列表' },
      {
        action: 'click',
        selector: 'button:has-text("添加服务商")',
        name: '点击添加',
        waitFor: { selector: '.el-dialog:has-text("添加服务商")' },
      },
      { action: 'screenshot', name: '添加对话框' },
    ],
  },
  {
    name: 'model-provider-category-filter',
    route: '/model-providers',
    steps: [
      { action: 'waitFor', selector: '.view-mode-tab:has-text("全部")' },
      {
        action: 'click',
        selector: '.view-mode-tab:has-text("全部")',
        name: '切换全部服务商',
        waitFor: { selector: '.cohere-filter-bar .filter-chip' },
      },
      { action: 'screenshot', name: '全部类别' },
      {
        action: 'click',
        selector: '.cohere-filter-bar .filter-chip:nth-child(2)',
        name: '点击第二个类别',
        waitFor: { selector: '.cohere-filter-bar .filter-chip:nth-child(2).active' },
      },
      { action: 'screenshot', name: '筛选后' },
    ],
  },
  {
    name: 'model-provider-card-actions',
    route: '/model-providers',
    steps: [
      { action: 'waitFor', selector: '.page-title:has-text("模型服务商设置")' },
      { action: 'screenshot', name: '服务商卡片操作' },
    ],
  },
  {
    name: 'cloud-publish-list',
    route: '/cloud-publish',
    steps: [
      { action: 'waitFor', selector: '.page-title:has-text("云端发布")' },
      { action: 'screenshot', name: '任务列表' },
    ],
  },
  {
    name: 'cloud-publish-create',
    route: '/cloud-publish',
    steps: [
      { action: 'waitFor', selector: '.cohere-form input[placeholder*="视频标题"]' },
      {
        action: 'fill',
        selector: '.cohere-form input[placeholder*="视频标题"]',
        value: '条件等待测试',
        waitFor: { selector: '.cohere-form input[placeholder*="视频标题"]', value: '条件等待测试' },
      },
      { action: 'screenshot', name: '新建任务' },
    ],
  },
  {
    name: 'viral-analysis-view',
    route: '/viral-analysis',
    steps: [
      { action: 'waitFor', selector: '.page-title:has-text("爆款分析")' },
      { action: 'screenshot', name: '爆文分析页面' },
    ],
  },
  {
    name: 'keyword-monitor-panel',
    route: '/keywords',
    steps: [
      { action: 'waitFor', selector: '.page-title:has-text("关键词监测")' },
      { action: 'screenshot', name: '监控面板' },
    ],
  },
  {
    name: 'first-run-flow',
    route: '/first-run',
    steps: [
      { action: 'waitFor', selector: 'h2:has-text("欢迎使用汤姆鱼")' },
      { action: 'screenshot', name: '首次运行引导' },
    ],
  },
  {
    name: 'dashboard-stats',
    route: '/dashboard',
    steps: [
      { action: 'waitFor', selector: '.page-title:has-text("数据看板")' },
      { action: 'screenshot', name: '数据看板' },
    ],
  },
];

function workflowUrl(baseUrl, route, workflowName) {
  const isolatedDocument = `visual-workflow=${encodeURIComponent(workflowName)}`;
  return `${baseUrl.replace(/\/$/, '')}/?${isolatedDocument}#${route}`;
}

async function waitForCondition(page, condition, previousText) {
  const timeout = condition.timeout || 10000;

  if (condition.textChanged) {
    await page.waitForFunction(({ selector, previous }) => {
      const element = document.querySelector(selector);
      return element && (element.textContent || '').trim() !== previous;
    }, { selector: condition.selector, previous: previousText }, { timeout });
    return;
  }

  if (Object.prototype.hasOwnProperty.call(condition, 'value')) {
    await page.waitForFunction(({ selector, value }) => {
      const element = document.querySelector(selector);
      return element && element.value === value;
    }, { selector: condition.selector, value: condition.value }, { timeout });
    return;
  }

  await page.waitForSelector(condition.selector, { state: condition.state || 'visible', timeout });
}

async function executeStep(page, step) {
  switch (step.action) {
    case 'click': {
      let previousText;
      if (step.waitFor?.textChanged) {
        previousText = await page.locator(step.waitFor.selector).first().textContent();
        previousText = (previousText || '').trim();
      }
      await page.click(step.selector, { timeout: 5000 });
      await waitForCondition(page, step.waitFor, previousText);
      if (step.name) console.log(`   → ${step.name}`);
      return;
    }
    case 'fill':
      await page.fill(step.selector, step.value, { timeout: 5000 });
      await waitForCondition(page, step.waitFor);
      return;
    case 'waitFor':
      await waitForCondition(page, step);
      return;
    case 'screenshot':
      return;
    case 'press':
      await page.keyboard.press(step.key);
      if (step.waitFor) await waitForCondition(page, step.waitFor);
      return;
    default:
      throw new Error(`未知工作流动作: ${step.action}`);
  }
}

async function executeWorkflow(runner, test) {
  await runner.page.goto(workflowUrl(runner.url, test.route, test.name), {
    waitUntil: 'domcontentloaded',
    timeout: 15000,
  });
  for (const step of test.steps) await executeStep(runner.page, step);
}

async function runSupplementaryWorkflows() {
  console.log('开始补充工作流视觉测试...\n');
  const runner = new VisualTestRunner({
    url: process.env.TEST_URL || 'http://127.0.0.1:5174',
    headless: process.env.HEADLESS !== 'false',
  });
  const failures = [];

  try {
    await runner.launch();
    for (const test of supplementaryWorkflowTests) {
      console.log(`工作流: ${test.name}`);
      try {
        await executeWorkflow(runner, test);
        runner.results.push({ test: test.name, status: 'PASSED' });
      } catch (error) {
        failures.push({ test: test.name, error });
        runner.results.push({ test: test.name, status: 'FAILED', error: error.message });
      }
    }
  } finally {
    await runner.close();
  }

  if (failures.length > 0) {
    const error = new Error(
      `补充工作流失败: ${failures.map(item => `${item.test}: ${item.error.message}`).join(' | ')}`,
    );
    error.failures = failures;
    throw error;
  }

  return { total: supplementaryWorkflowTests.length, passed: supplementaryWorkflowTests.length };
}

async function runSingle(name) {
  const test = supplementaryWorkflowTests.find(workflow => workflow.name === name);
  if (!test) throw new Error(`未找到补充工作流: ${name}`);

  const runner = new VisualTestRunner();
  try {
    await runner.launch();
    await executeWorkflow(runner, test);
    runner.results.push({ test: test.name, status: 'PASSED' });
  } finally {
    await runner.close();
  }
}

if (require.main === module) {
  const args = process.argv.slice(2);
  if (args[0] === '--list') {
    supplementaryWorkflowTests.forEach(workflow => console.log(workflow.name));
  } else {
    const run = args[0] === '--single'
      ? () => runSingle(args[1])
      : runSupplementaryWorkflows;
    run().catch(error => {
      console.error(error.message);
      process.exitCode = 1;
    });
  }
}

module.exports = {
  supplementaryWorkflowTests,
  workflowUrl,
  waitForCondition,
  executeStep,
  executeWorkflow,
  runSupplementaryWorkflows,
  runSingle,
};
