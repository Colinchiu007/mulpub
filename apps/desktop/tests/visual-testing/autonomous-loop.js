/**
 * 全自动 E2E 多轮循环测试
 * 运行: node tests/visual-testing/autonomous-loop.js [--max-rounds N]
 * 
 * 流程:
 * Round 1: 像素对比 + 功能测试 + 补充视图截图 → 生成报告
 * Round 2+: 复测失败项 → 对比改善 → 如果还有失败继续
 * 
 * 每轮产出:
 * - screenshots/ 当前截图
 * - reports/autonomous-loop-report-*.json 完整报告
 * - reports/autonomous-loop-summary-*.md Agent 可读摘要
 */

const { VisualTestRunner } = require('./test-runner');
const { ROUTE_READY_SELECTORS, navigateToReady, waitForCount } = require('./functional-test');
const fs = require('fs');
const path = require('path');

const REPORT_DIR = 'tests/visual-testing/reports';
const MAX_ROUNDS = parseInt(process.env.MAX_ROUNDS || '3', 10);
const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5174';
function hashUrl(route) { return route === '/' ? BASE_URL + '/' : BASE_URL + '/#' + route; }

const c = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", bold: "\x1b[1m"
};

function log(color, msg) { console.log(`${color}${msg}${c.reset}`); }

// ==================== 测试定义 ====================

const pixelTests = [
  { name: "home-baseline", route: "/" },
  { name: "accounts-list", route: "/accounts" },
  { name: "publish-form", route: "/publish" },
  { name: "analytics-overview", route: "/analytics" },
  { name: "settings-general", route: "/settings" },
  { name: "login-form", route: "/login" },
  { name: "create-editor", route: "/create" },
  { name: "model-providers", route: "/model-providers" },
  { name: "first-run", route: "/first-run" },
  { name: "dashboard", route: "/dashboard" },
  { name: "calendar", route: "/calendar" },
  { name: "cloud-publish", route: "/cloud-publish" },
  { name: "viral-analysis", route: "/viral-analysis" },
  { name: "create-result", route: "/create/result" },
  { name: "create-pipeline", route: "/create/pipeline", expectedRoute: "/create" },
  { name: "create-history", route: "/create/history" },
  { name: "intelligence", route: "/intelligence" },
  { name: "keyword-monitor", route: "/keywords" },
  { name: "collection", route: "/collection" },
  { name: "comments", route: "/comments" },
].map(test => ({
  ...test,
  waitFor: ROUTE_READY_SELECTORS[test.route] || '#app[data-v-app]',
}));

const functionalTestDefs = [
  { name: 'nav-routes', routes: ['/', '/accounts', '/publish', '/collection', '/monitor', '/comments', '/dashboard', '/create', '/calendar'] },
  { name: 'sidebar-platforms', selector: '.cohere-platform-item', minCount: 3 },
  { name: 'topnav-items', selector: '.nav-item', minCount: 5 },
  { name: 'model-provider-filter-chips', selector: '.filter-chip', minCount: 5, route: '/model-providers' },
  { name: 'calendar-grid-cells', selector: '.calendar-grid > div', minCount: 28, route: '/calendar' },
  { name: 'create-view-tabs', selector: '.view-tab', minCount: 3, route: '/create' },
];

const screenshotViewTests = [
  // 遗漏路由视图截图
  { name: 'first-run', route: '/first-run' },
  { name: 'dashboard', route: '/dashboard' },
  { name: 'calendar', route: '/calendar' },
  { name: 'cloud-publish', route: '/cloud-publish' },
  { name: 'viral-analysis', route: '/viral-analysis' },
  { name: 'create-result', route: '/create/result' },
  { name: 'create-pipeline', route: '/create/pipeline', expectedRoute: '/create' },
  { name: 'create-history', route: '/create/history' },
  { name: 'intelligence', route: '/intelligence' },
  { name: 'keyword-monitor', route: '/keywords' },
  { name: 'collection', route: '/collection' },
  { name: 'comments', route: '/comments' },
  // 弹窗/对话框截图
  {
    name: 'accounts-with-dialog',
    route: '/accounts',
    trigger: 'button:has-text("添加账号")',
    afterTrigger: '.ui-modal, .el-dialog, [role="dialog"]',
  },
  {
    name: 'model-providers-with-add',
    route: '/model-providers',
    trigger: 'button:has-text("添加服务商")',
    afterTrigger: '.el-dialog:has-text("添加服务商")',
  },
].map(test => ({
  ...test,
  waitFor: ROUTE_READY_SELECTORS[test.route] || '#app[data-v-app]',
}));

// ==================== 执行函数 ====================

async function runPixelTests(runner) {
  const results = [];
  for (const test of pixelTests) {
    try {
      await runner.pixelRegressionTest(test.name, test.route, {
        waitFor: test.waitFor,
        expectedRoute: test.expectedRoute,
      });
      results.push({ name: test.name, status: 'PASSED' });
    } catch (err) {
      results.push({ name: test.name, status: 'FAILED', error: err.message.split('\n')[0] });
    }
  }
  return results;
}

async function runFunctionalTests(runner) {
  const results = [];
  for (const test of functionalTestDefs) {
    try {
      if (test.routes) {
        // 导航测试
        const errors = [];
        for (const route of test.routes) {
          try {
            await navigateToReady(runner.page, route);
          } catch (e) {
            errors.push(`${route}: ${e.message}`);
          }
        }
        results.push({ name: test.name, status: errors.length === 0 ? 'PASSED' : 'FAILED', errors });
      } else {
        // 选择器测试
        const route = test.route || '/';
        await navigateToReady(runner.page, route, test.selector);
        await waitForCount(runner.page, test.selector, test.minCount);
        const items = await runner.page.$$(test.selector);
        results.push({
          name: test.name,
          status: items.length >= test.minCount ? 'PASSED' : 'FAILED',
          count: items.length,
          minRequired: test.minCount,
          errors: items.length < test.minCount ? [`数量不足: ${items.length}/${test.minCount}`] : []
        });
      }
    } catch (err) {
      results.push({ name: test.name, status: 'ERROR', error: err.message.split('\n')[0] });
    }
  }
  return results;
}

async function runScreenshotCaptures(runner) {
  const results = [];
  for (const test of screenshotViewTests) {
    try {
      await navigateToReady(runner.page, test.route, test.waitFor);

      if (test.trigger) {
        await runner.page.click(test.trigger, { timeout: 5000 });
        await runner.page.waitForSelector(test.afterTrigger, { state: 'visible', timeout: 10000 });
        await runner.page.screenshot({
          path: path.join(runner.screenshotDir, `${test.name}.png`),
          fullPage: true,
        });
      } else {
        await runner.aiVisionTest(
          test.name,
          test.route,
          [{ name: '页面就绪', selector: test.waitFor }],
          { waitFor: test.waitFor, expectedRoute: test.expectedRoute },
        );
      }
      results.push({ name: test.name, status: 'CAPTURED' });
    } catch (err) {
      results.push({ name: test.name, status: 'ERROR', error: err.message.split('\n')[0] });
    }
  }
  return results;
}

// ==================== 主循环 ====================

async function autonomousLoop() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║        全自动 E2E 多轮循环测试 (autonomous-loop.js)          ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  // 连接检查
log(c.blue, '检查 dev server...');
const http = require('http');
const checkServer = () => new Promise(resolve => {
  http.get(BASE_URL, () => resolve(true)).on('error', () => resolve(false));
});
if (!(await checkServer())) {
  log(c.red, '❌ Dev server 未运行! 请先启动: cd apps/desktop && npx vite --port 5174');
  process.exit(1);
}
log(c.green, '✅ Dev server 就绪');

const startTime = Date.now();
  const allRoundResults = [];
  let previousFailed = 0;
  
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    log(c.bold, `\n━━━ Round ${round}/${MAX_ROUNDS} ━━━`);
    
    const roundStart = Date.now();
    const runner = new VisualTestRunner({
      url: process.env.TEST_URL || 'http://127.0.0.1:5174',
      headless: process.env.HEADLESS !== 'false'
    });
    
    await runner.launch();
    
    // Step 1: 像素对比
    log(c.blue, 'Step 1: 像素对比测试');
    const pixelResults = await runPixelTests(runner);
    const pixelPassed = pixelResults.filter(r => r.status === 'PASSED').length;
    const pixelFailed = pixelResults.filter(r => r.status === 'FAILED').length;
    log(pixelFailed === 0 ? c.green : c.red, `  像素: ${pixelPassed}/${pixelResults.length} 通过, ${pixelFailed} 失败`);
    
    // Step 2: 功能测试
    log(c.blue, 'Step 2: 功能性测试');
    const funcResults = await runFunctionalTests(runner);
    const funcPassed = funcResults.filter(r => r.status === 'PASSED').length;
    const funcFailed = funcResults.filter(r => r.status === 'FAILED' || r.status === 'ERROR').length;
    log(funcFailed === 0 ? c.green : c.red, `  功能: ${funcPassed}/${funcResults.length} 通过, ${funcFailed} 失败`);
    
    // Step 3: 补充视图截图
    if (round === 1) {
      log(c.blue, 'Step 3: 补充视图 + 弹窗截图');
      const screenshotResults = await runScreenshotCaptures(runner);
      const captured = screenshotResults.filter(r => r.status === 'CAPTURED').length;
      log(c.green, `  截图: ${captured}/${screenshotResults.length} 已采集`);
      allRoundResults.push({ step: 'screenshots', results: screenshotResults });
    }
    
    await runner.close();
    
    const roundDuration = ((Date.now() - roundStart) / 1000).toFixed(1);
    const totalFailed = pixelFailed + funcFailed;
    
    const roundResult = {
      round,
      duration: `${roundDuration}s`,
      pixel: { passed: pixelPassed, failed: pixelFailed, total: pixelResults.length },
      functional: { passed: funcPassed, failed: funcFailed, total: funcResults.length },
      totalFailed,
      details: { pixel: pixelResults, functional: funcResults }
    };
    allRoundResults.push({ step: `round-${round}`, ...roundResult });
    
    log(c.bold, `\n  Round ${round} 结果: ${totalFailed === 0 ? c.green + '✅ 全部通过' : c.red + `${totalFailed} 项失败`} (${roundDuration}s)`);
    
    // 如果全部通过，结束循环
    if (totalFailed === 0) {
      log(c.green, '\n🎉 所有测试通过！循环结束。\n');
      break;
    }
    
    // 如果失败没有改善，也结束
    if (previousFailed > 0 && totalFailed >= previousFailed) {
      log(c.yellow, `\n⚠️  失败数未改善 (${previousFailed} → ${totalFailed})，停止循环。\n`);
      break;
    }
    
    previousFailed = totalFailed;
  }
  
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // 生成报告
  const report = {
    timestamp: new Date().toISOString(),
    duration: `${totalDuration}s`,
    maxRounds: MAX_ROUNDS,
    rounds: allRoundResults
  };
  
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const reportPath = path.join(REPORT_DIR, `autonomous-loop-report-${ts}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // 生成 Agent 可读摘要
  const summary = generateSummary(allRoundResults, totalDuration);
  const summaryPath = path.join(REPORT_DIR, `autonomous-loop-summary-${ts}.md`);
  fs.writeFileSync(summaryPath, summary);
  
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  总耗时: ${totalDuration}s`);
  console.log(`  报告: ${reportPath}`);
  console.log(`  摘要: ${summaryPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

function generateSummary(results, duration) {
  const rounds = results.filter(r => r.step && r.step.startsWith('round-'));
  const lastRound = rounds[rounds.length - 1];
  
  let md = `# E2E 自动循环测试报告\n\n`;
  md += `**时间**: ${new Date().toISOString()}\n`;
  md += `**耗时**: ${duration}s\n`;
  md += `**轮次**: ${rounds.length}/${MAX_ROUNDS}\n\n`;
  
  if (lastRound) {
    const allPassed = lastRound.totalFailed === 0;
    md += `## 结果: ${allPassed ? '✅ 全部通过' : `❌ ${lastRound.totalFailed} 项失败`}\n\n`;
    
    md += `### 像素对比\n`;
    md += `| 指标 | 值 |\n|------|----|\n`;
    md += `| 通过 | ${lastRound.pixel.passed} |\n`;
    md += `| 失败 | ${lastRound.pixel.failed} |\n`;
    md += `| 总计 | ${lastRound.pixel.total} |\n\n`;
    
    md += `### 功能测试\n`;
    md += `| 指标 | 值 |\n|------|----|\n`;
    md += `| 通过 | ${lastRound.functional.passed} |\n`;
    md += `| 失败 | ${lastRound.functional.failed} |\n`;
    md += `| 总计 | ${lastRound.functional.total} |\n\n`;
    
    // 失败项详情
    if (!allPassed) {
      md += `## 失败详情\n\n`;
      const failedPixel = lastRound.details.pixel.filter(r => r.status === 'FAILED');
      const failedFunc = lastRound.details.functional.filter(r => r.status !== 'PASSED');
      
      if (failedPixel.length > 0) {
        md += `### 像素对比失败\n`;
        failedPixel.forEach(f => {
          md += `- **${f.name}**: ${f.error}\n`;
        });
        md += '\n';
      }
      
      if (failedFunc.length > 0) {
        md += `### 功能测试失败\n`;
        failedFunc.forEach(f => {
          md += `- **${f.name}**: ${f.errors ? f.errors.join(', ') : f.error}\n`;
        });
        md += '\n';
      }
    }
  }
  
  md += `## 处理建议\n\n`;
  md += `1. 查看 \`reports/\` 目录下的详细 JSON 报告\n`;
  md += `2. 查看 \`screenshots/\` 目录下的当前截图\n`;
  md += `3. 像素失败 → 查看 \`reports/pixel-diff/\` 下的差异图\n`;
  md += `4. 功能失败 → 检查对应路由的组件交互逻辑\n`;
  md += `5. Agent 读取本摘要后，使用 \`view_image\` 查看截图判断\n`;
  
  return md;
}

// ==================== CLI ====================

if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args[0] === '--help') {
    console.log(`
全自动 E2E 多轮循环测试

用法:
  node tests/visual-testing/autonomous-loop.js [选项]

选项:
  --max-rounds N    最大循环轮数 (默认: 3)
  --help            显示帮助

环境变量:
  TEST_URL          测试目标 URL (默认: http://localhost:5173)
  MAX_ROUNDS        最大循环轮数
  HEADLESS=false    显示浏览器窗口

示例:
  node tests/visual-testing/autonomous-loop.js
  node tests/visual-testing/autonomous-loop.js --max-rounds 5
  MAX_ROUNDS=5 node tests/visual-testing/autonomous-loop.js
`);
    process.exit(0);
  }
  
  if (args[0] === '--max-rounds' && args[1]) {
    process.env.MAX_ROUNDS = args[1];
  }
  
  autonomousLoop().catch(err => {
    console.error(`\n${c.red}[FATAL]${c.reset} ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { autonomousLoop };




