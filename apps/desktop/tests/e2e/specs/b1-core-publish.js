/**
 * B1: 核心发布路径 functional E2E
 *
 * 覆盖：
 *   - Home: 加载、点导航卡片、统计显示
 *   - Publish: 单篇/批量切换、添加文章、平台勾选、发布按钮
 *   - Dashboard: 加载、刷新数据按钮、图表渲染
 *   - CloudPublish: 平台选择、表单、提交
 */

const { FunctionalRunner, assert } = require('../helpers/functional-runner');
const { fillPublishBody } = require('../helpers/route-functional-suite');

async function testHome(r) {
  console.log('\n=== Home ===');
  await r.goto('/');
  await r.expectText('汤姆鱼');
  await r.expectVisible('nav');
  await r.expectNoConsoleError();

  // 点击"内容采集"统计卡片（如果存在）
  const cards = await r.listButtons();
  console.log('  Home buttons:', cards.length);

  // 检查统计加载
  const stats = await r.page.evaluate(() => {
    const text = document.body.innerText;
    return {
      hasTotal: /总发布|发布|篇/.test(text),
      hasSuccess: /成功/.test(text),
      hasFailed: /失败/.test(text)
    };
  });
  console.log('  Stats visible:', JSON.stringify(stats));
  assert(stats.hasTotal, 'Home 应该显示发布统计');

  await r.screenshot('home-loaded');
}

function assertJsonSerializable(value) {
  try {
    const serialized = JSON.stringify(value);
    assert(typeof serialized === 'string', 'publishBatch IPC 载荷必须可 JSON 序列化');
    JSON.parse(serialized);
  } catch (error) {
    throw new Error('publishBatch IPC 载荷无法 JSON 序列化: ' + (error.message || String(error)));
  }
}

async function clickAndVerifyPublish(r, expectedFailure) {
  const beforeCalls = await r.getIpcCalls('publishBatch');
  const publishButton = r.page.locator('button:has-text("一键发布")').first();
  assert(await publishButton.count() > 0, '发布页必须存在一键发布按钮');

  await publishButton.click();
  await r.page.waitForFunction((previousCalls) => {
    return (window.__ipcCallsByMethod.publishBatch || 0) > previousCalls;
  }, beforeCalls, { timeout: 5000 });

  const afterCalls = await r.getIpcCalls('publishBatch');
  assert(afterCalls > beforeCalls, '点击发布后 publishBatch IPC 调用次数必须增加');

  const calls = await r.getIpcCalls();
  const publishCall = calls.slice().reverse().find((call) => call.method === 'publishBatch');
  assert(publishCall, '必须记录 publishBatch IPC 调用');
  assertJsonSerializable(publishCall.args);

  const resultSelector = expectedFailure
    ? '.cohere-tag-danger:has-text("发布失败")'
    : '.cohere-tag-success:has-text("发布成功")';
  await r.page.locator(resultSelector).first().waitFor({ state: 'visible', timeout: 5000 });
  await r.expectText(expectedFailure ? '发布失败' : '发布成功');
}
async function testPublish(r) {
  console.log('\n=== Publish ===');
  await r.goto('/publish');
  await r.expectText('一键发布');
  await r.page.waitForFunction(() => {
    return (window.__ipcCallsByMethod.getPlatformDefinitions || 0) > 0 &&
      (window.__ipcCallsByMethod.licenseInfo || 0) > 0 &&
      document.querySelectorAll('.target-selector [data-testid^="platform-"]').length > 0;
  }, null, { timeout: 5000 });

  // 切换批量模式
  const batchToggleSelector = 'label.cohere-toggle input[type="checkbox"]';
  const batchToggle = r.page.locator(batchToggleSelector).first();
  if (await batchToggle.count() > 0) {
    await batchToggle.click();
    await r.page.waitForFunction((selector) => {
      const checkbox = document.querySelector(selector);
      return checkbox && checkbox.checked;
    }, batchToggleSelector, { timeout: 3000 });
    await r.page.locator('button:has-text("添加文章")').waitFor({ state: 'visible', timeout: 3000 });
    await r.expectText('批量');
    await r.screenshot('publish-batch-mode');

    // 切换回单篇模式
    await batchToggle.click();
    await r.page.waitForFunction((selector) => {
      const checkbox = document.querySelector(selector);
      return checkbox && !checkbox.checked;
    }, batchToggleSelector, { timeout: 3000 });
    await r.page.locator('.cohere-main .target-selector__search').waitFor({ state: 'visible', timeout: 3000 });
  }

  const titleInput = r.page.locator('input[placeholder="请输入文章标题"]').first();
  await titleInput.fill('E2E 测试标题');

  assert(
    await fillPublishBody(r.page, 'E2E 测试正文，用于验证完整发布流程。'),
    '发布正文编辑器必须可填写',
  );

  const selectedPlatformSelector = '.cohere-main .target-selector input[data-testid^="platform-"]:checked';
  const selectedPlatformCount = await r.page.locator(selectedPlatformSelector).count();
  const platformOption = r.page.locator('.cohere-main .target-selector input[data-testid^="platform-"]:not(:disabled):not(:checked)').first();
  assert(await platformOption.count() > 0, '发布页必须存在可选平台');
  await platformOption.click();
  await r.page.waitForFunction(([selector, previousCount]) => {
    return document.querySelectorAll(selector).length > previousCount;
  }, [selectedPlatformSelector, selectedPlatformCount], { timeout: 3000 });

  await r.screenshot('publish-with-content');
  await clickAndVerifyPublish(r, false);

  await r.failNextIpc('publishBatch', 'B1 注入发布失败');
  await clickAndVerifyPublish(r, true);
  await r.expectText('B1 注入发布失败');
  await r.expectNoConsoleError();
}

async function testDashboard(r) {
  console.log('\n=== Dashboard ===');
  await r.goto('/dashboard');
  await r.expectText('数据看板');
  await r.page.waitForFunction(() => {
    return (window.__ipcCallsByMethod.syncCached || 0) > 0 &&
      (window.__ipcCallsByMethod.dashboardStats || 0) > 0 &&
      (window.__ipcCallsByMethod.historyList || 0) > 0;
  }, null, { timeout: 5000 });

  // 检查平台数据卡片
  const platformCards = await r.page.$$eval('.cohere-card', els => els.length);
  console.log('  Platform cards:', platformCards);

  // 点击"刷新数据"按钮（如果存在）
  const refreshBtn = r.page.locator('button:has-text("刷新数据")').first();
  if (await refreshBtn.count() > 0) {
    const syncAllCalls = await r.getIpcCalls('syncAll');
    const syncCachedCalls = await r.getIpcCalls('syncCached');
    await refreshBtn.click({ timeout: 2000 });
    await r.page.waitForFunction(([previousSyncAll, previousSyncCached]) => {
      return (window.__ipcCallsByMethod.syncAll || 0) > previousSyncAll &&
        (window.__ipcCallsByMethod.syncCached || 0) > previousSyncCached;
    }, [syncAllCalls, syncCachedCalls], { timeout: 5000 });
    await r.page.locator('button:has-text("刷新数据")').waitFor({ state: 'visible', timeout: 3000 });
    console.log('  Refresh clicked');
  }

  // 填写基准比较输入
  const benchInput = await r.page.locator('input[placeholder*="基准"]').first();
  if (await benchInput.count() > 0) {
    await benchInput.fill('测试文章基准');
    const analyzeBtn = await r.page.locator('button:has-text("分析")').first();
    if (await analyzeBtn.count() > 0) {
      const benchmarkCalls = await r.getIpcCalls('intelligenceGetBenchmark');
      await analyzeBtn.click({ timeout: 2000 });
      await r.page.waitForFunction((previousCalls) => {
        return (window.__ipcCallsByMethod.intelligenceGetBenchmark || 0) > previousCalls;
      }, benchmarkCalls, { timeout: 5000 });
      await r.page.locator('text=/基于 \\d+ 条同类内容/').waitFor({ state: 'visible', timeout: 5000 });
      console.log('  Benchmark analyzed');
    }
  }

  await r.screenshot('dashboard-loaded');
  await r.expectNoConsoleError();
}

async function testCloudPublish(r) {
  console.log('\n=== CloudPublish ===');
  await r.goto('/cloud-publish');
  await r.expectText('云发布');
  await r.page.waitForFunction(() => {
    const platformSelect = document.querySelector('select.cohere-input');
    return (window.__ipcCallsByMethod.cloudPublishPlatforms || 0) > 0 &&
      (window.__ipcCallsByMethod.cloudPublishListTasks || 0) > 0 &&
      platformSelect &&
      platformSelect.options.length > 0 &&
      !document.body.innerText.includes('加载中...');
  }, null, { timeout: 5000 });

  const buttons = await r.listButtons();
  console.log('  CloudPublish buttons:', buttons.length);
  const inputs = await r.listInputs();
  console.log('  CloudPublish inputs:', inputs.length);

  await r.screenshot('cloud-publish-loaded');
  await r.expectNoConsoleError();
}

const DEFAULT_SCENARIOS = [testHome, testPublish, testDashboard, testCloudPublish];

function reportHasFailures(report) {
  if (!report || !report.checks) return true;
  const checks = report.checks;
  const failedChecks = Number(checks.failed || 0);
  const incompleteChecks = Number(checks.passed || 0) < Number(checks.total || 0);
  return failedChecks > 0 ||
    incompleteChecks ||
    (report.consoleErrors || []).length > 0 ||
    (report.pageErrors || []).length > 0;
}

function logSummary(logger, report) {
  const checks = report.checks;
  logger.log('\n=== B1 Summary ===');
  logger.log('Checks:', checks.passed + '/' + checks.total);
  logger.log('Console errors:', report.consoleErrors.length);
  logger.log('Page errors:', report.pageErrors.length);
  report.consoleErrors.forEach((error) => logger.log('  console:', error.text.slice(0, 200)));
  report.pageErrors.forEach((error) => logger.log('  page:', error.message.slice(0, 200)));
}

function logFailure(logger, prefix, error) {
  const message = error && error.message ? error.message : String(error);
  logger.error(prefix + ':', message);
  if (error && error.stack) logger.error(error.stack);
}

async function run(options = {}) {
  const r = options.runner || new FunctionalRunner({ specName: 'b1-core-publish', initPro: true });
  const scenarios = options.scenarios || DEFAULT_SCENARIOS;
  const logger = options.logger || console;
  let exitCode = 0;

  try {
    await r.launch();
    for (const scenario of scenarios) {
      await scenario(r);
    }
  } catch (error) {
    exitCode = 1;
    logFailure(logger, 'B1 场景失败', error);
  } finally {
    try {
      const report = r.generateReport();
      logSummary(logger, report);
      if (reportHasFailures(report)) exitCode = 1;
    } catch (error) {
      exitCode = 1;
      logFailure(logger, '生成 B1 报告失败', error);
    }

    try {
      r.saveReport();
    } catch (error) {
      exitCode = 1;
      logFailure(logger, '保存 B1 报告失败', error);
    }

    try {
      await r.close();
    } catch (error) {
      exitCode = 1;
      logFailure(logger, '关闭 B1 runner 失败', error);
    }
  }

  return exitCode;
}

async function main(options = {}) {
  const exitCode = await run(options);
  const processRef = options.processRef || process;
  processRef.exitCode = exitCode;
  return exitCode;
}

if (require.main === module) {
  void main();
}

module.exports = { main, run, testPublish, testHome, testDashboard, testCloudPublish };
