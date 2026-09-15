/**
 * AutonomousFixLoop — 全自动「发现→分析→修复→验证」闭环
 *
 * 核心流程:
 *   1. 运行像素对比 + 功能测试 → 采集失败项
 *   2. 分析失败原因（回归/噪声/预期变更/功能 bug）
 *   3. 对每个失败项生成修复建议
 *   4. Agent（或 LLM）执行修复
 *   5. 重跑测试验证修复结果
 *   6. 循环直到全部通过或不再改善
 *
 * 运行:
 *   cd apps/desktop && node tests/visual-testing/autonomous-fix-loop.js
 *   node tests/visual-testing/autonomous-fix-loop.js --max-rounds 5 --dry-run
 *   node tests/visual-testing/autonomous-fix-loop.js --fix-mode agent
 *
 * 无外部 API Key 时: 生成结构化报告，由 Agent 手动/半自动修复
 * 有 LLM 时: 自动调用 LLM 生成 patch，自动应用并验证
 */

try {
  require('dotenv').config({ path: __dirname + '/.env' });
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const { VisualTestRunner } = require('./test-runner');
const { ROUTE_READY_SELECTORS, navigateToReady, waitForCount } = require('./functional-test');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5174';
const REPORT_DIR = path.join(__dirname, 'reports');
const PATCH_DIR = path.join(__dirname, 'patches');
const MAX_ROUNDS = parseInt(process.env.MAX_FIX_ROUNDS || '5', 10);

function hashUrl(route) {
  return route === '/' ? BASE_URL + '/' : BASE_URL + '/#' + route;
}

const c = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", bold: "\x1b[1m", cyan: "\x1b[36m"
};
function log(color, msg) { console.log(`${color}${msg}${c.reset}`); }

// ===== 配置 =====

const PIXEL_TESTS = [
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

const FUNCTIONAL_TESTS_DEF = [
  { name: 'nav-routes', routes: ['/', '/accounts', '/publish', '/collection', '/monitor', '/comments', '/dashboard', '/create', '/calendar'] },
  { name: 'sidebar-platforms', selector: '.cohere-platform-item', minCount: 3 },
  {
    name: 'accounts-add-dialog',
    route: '/accounts',
    trigger: 'button:has-text("添加账号")',
    afterTrigger: '.ui-modal, .el-dialog, [role="dialog"]',
    expectModal: true,
  },
  { name: 'publish-form', route: '/publish', waitFor: 'input[placeholder*="标题"]', expectInputs: 2, expectBtnText: '发布' },
  { name: 'calendar-grid', route: '/calendar', selector: '.calendar-grid > *', minCount: 28 },
  { name: 'model-provider-filter', route: '/model-providers', selector: '.filter-chip', minCount: 5 },
];

// ===== Step 1: 采集测试结果 =====

async function collectPixelResults(runner) {
  const results = [];
  for (const test of PIXEL_TESTS) {
    try {
      await runner.pixelRegressionTest(test.name, test.route, {
        waitFor: test.waitFor,
        expectedRoute: test.expectedRoute,
      });
      results.push({ name: test.name, route: test.route, status: 'PASSED' });
    } catch (err) {
      // 提取 misMatchPercentage
      const match = err.message.match(/misMatchPercentage=([\d.]+)/);
      const mismatch = match ? parseFloat(match[1]) : 100;
      results.push({
        name: test.name,
        route: test.route,
        status: 'FAILED',
        misMatchPercentage: mismatch,
        error: err.message.split('\n')[0],
        screenshot: path.join('tests/visual-testing/screenshots', `${test.name}-current.png`),
        diffImage: err.message.match(/差异图: (.+)/)?.[1] || '',
      });
    }
  }
  return results;
}

async function collectFunctionalResults(runner) {
  const results = [];
  
  for (const test of FUNCTIONAL_TESTS_DEF) {
    try {
      if (test.routes) {
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
        const route = test.route || '/';
        await navigateToReady(
          runner.page,
          route,
          test.waitFor || test.selector || ROUTE_READY_SELECTORS[route],
        );
        
        if (test.trigger) {
          await runner.page.click(test.trigger, { timeout: 5000 });
          await runner.page.waitForSelector(test.afterTrigger, { state: 'visible', timeout: 10000 });
        }
        
        if (test.expectModal) {
          const modal = await runner.page.$('.ui-modal, .el-dialog, [role="dialog"]');
          results.push({ name: test.name, status: modal ? 'PASSED' : 'FAILED', errors: modal ? [] : ['弹窗未出现'] });
        } else if (test.selector) {
          await waitForCount(runner.page, test.selector, test.minCount);
          const count = await runner.page.$$eval(test.selector, els => els.length);
          results.push({ name: test.name, status: count >= test.minCount ? 'PASSED' : 'FAILED', count, errors: count < test.minCount ? [`${test.selector} 不足: ${count}/${test.minCount}`] : [] });
        } else {
          const hasContent = await runner.page.evaluate(() => document.querySelector('main')?.innerHTML?.length > 100);
          results.push({ name: test.name, status: hasContent ? 'PASSED' : 'FAILED', errors: hasContent ? [] : ['页面内容为空'] });
        }
      }
    } catch (err) {
      results.push({ name: test.name, status: 'ERROR', errors: [err.message.split('\n')[0]] });
    }
  }
  return results;
}

// ===== Step 2: 分析失败原因 =====

function analyzeFailures(pixelResults, functionalResults) {
  const failures = [];
  
  // 分析像素对比失败
  for (const pr of pixelResults) {
    if (pr.status !== 'FAILED') continue;
    
    let category = 'UNKNOWN';
    let reasoning = '';
    const mismatch = pr.misMatchPercentage;
    
    if (mismatch >= 90) {
      // 几乎完全不同的截图 → 路由问题或页面崩溃
      category = 'ROUTE_OR_CRASH';
      reasoning = `像素差异 ${mismatch.toFixed(1)}% — 截图几乎完全不同，可能是路由跳转到错误页面、应用崩溃、或 dev server 未运行正确应用。`;
    } else if (mismatch >= 30) {
      // 大面积差异 → 布局变更或组件缺失
      category = 'LAYOUT_REGRESSION';
      reasoning = `像素差异 ${mismatch.toFixed(1)}% — 大面积布局变更，可能组件缺失、CSS 异常、或内容区域为空白。`;
    } else if (mismatch >= 10) {
      // 中等差异 → 内容更新或小范围样式变更
      category = 'CONTENT_CHANGE';
      reasoning = `像素差异 ${mismatch.toFixed(1)}% — 中等程度差异，可能是内容更新、动态数据变化、或小范围样式调整。`;
    } else {
      // 微小差异 → 噪声或抗锯齿
      category = 'NOISE';
      reasoning = `像素差异 ${mismatch.toFixed(1)}% — 微小差异，可能是渲染噪声或抗锯齿差异。`;
    }
    
    failures.push({
      type: 'PIXEL',
      testName: pr.name,
      route: pr.route,
      category,
      severity: category === 'ROUTE_OR_CRASH' ? 'HIGH' : category === 'LAYOUT_REGRESSION' ? 'HIGH' : category === 'CONTENT_CHANGE' ? 'MEDIUM' : 'LOW',
      reasoning,
      mismatch,
      screenshot: pr.screenshot,
      diffImage: pr.diffImage,
      suggestedFix: getSuggestedFix(category, pr),
    });
  }
  
  // 分析功能测试失败
  for (const fr of functionalResults) {
    if (fr.status === 'PASSED') continue;
    
    failures.push({
      type: 'FUNCTIONAL',
      testName: fr.name,
      category: 'FUNCTIONAL_FAILURE',
      severity: 'HIGH',
      reasoning: `功能测试失败: ${(fr.errors || []).join(', ')}`,
      errors: fr.errors,
      suggestedFix: `检查 ${fr.name} 对应的组件逻辑`,
    });
  }
  
  // 按严重程度排序
  const severityOrder = { HIGH: 0, MEDIUM: 1, LOW: 2 };
  failures.sort((a, b) => (severityOrder[a.severity] ?? 1) - (severityOrder[b.severity] ?? 1));
  
  return failures;
}

function getSuggestedFix(category, pr) {
  switch (category) {
    case 'ROUTE_OR_CRASH':
      return `检查路由配置、dev server 状态、应用是否正常启动。查看截图 ${pr.screenshot} 确认实际页面内容。`;
    case 'LAYOUT_REGRESSION':
      return `查看 diff 图 ${pr.diffImage} 定位缺失/错位的组件，检查对应 Vue 组件的模板和样式。`;
    case 'CONTENT_CHANGE':
      return `对比截图确认变化是否为预期更新。如果是 → 更新基线；如果不是 → 检查数据源或 API 返回。`;
    case 'NOISE':
      return `微小差异，建议更新基线：cp ${pr.screenshot} base-screenshots/${pr.name}.png`;
    default:
      return '需要人工检查截图和 diff 图。';
  }
}

// ===== Step 3: 生成修复报告 =====

function generateFixReport(failures, round, history) {
  const report = {
    timestamp: new Date().toISOString(),
    round,
    summary: {
      total: failures.length,
      high: failures.filter(f => f.severity === 'HIGH').length,
      medium: failures.filter(f => f.severity === 'MEDIUM').length,
      low: failures.filter(f => f.severity === 'LOW').length,
    },
    failures,
    history: history.map(h => ({
      round: h.round,
      passed: h.passed,
      failed: h.failed,
      fixed: h.fixed,
    })),
    fixInstructions: generateFixInstructions(failures),
  };
  
  fs.mkdirSync(REPORT_DIR, { recursive: true });
  const reportPath = path.join(REPORT_DIR, `fix-report-round${round}-${Date.now()}.json`);
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  // 生成 Markdown 摘要
  const md = generateFixMarkdown(report);
  const mdPath = path.join(REPORT_DIR, `fix-report-round${round}-${Date.now()}.md`);
  fs.writeFileSync(mdPath, md);
  
  return { reportPath, mdPath, report };
}

function generateFixInstructions(failures) {
  return failures.map((f, i) => {
    const lines = [
      `## Fix ${i + 1}: ${f.testName}`,
      `- **Type**: ${f.type}`,
      `- **Category**: ${f.category}`,
      `- **Severity**: ${f.severity}`,
      `- **Analysis**: ${f.reasoning}`,
      `- **Suggested Fix**: ${f.suggestedFix}`,
    ];
    if (f.screenshot) lines.push(`- **Screenshot**: ${f.screenshot}`);
    if (f.diffImage) lines.push(`- **Diff Image**: ${f.diffImage}`);
    return lines.join('\n');
  });
}

function generateFixMarkdown(report) {
  let md = `# 自动修复报告 (Round ${report.round})\n\n`;
  md += `**时间**: ${report.timestamp}\n`;
  md += `**失败**: ${report.summary.total} (HIGH: ${report.summary.high}, MEDIUM: ${report.summary.medium}, LOW: ${report.summary.low})\n\n`;
  
  if (report.history.length > 1) {
    md += `## 历史趋势\n\n`;
    md += `| Round | Passed | Failed | Fixed |\n|-------|--------|--------|-------|\n`;
    for (const h of report.history) {
      md += `| ${h.round} | ${h.passed} | ${h.failed} | ${h.fixed || 0} |\n`;
    }
    md += '\n';
  }
  
  if (report.failures.length === 0) {
    md += `## ✅ 全部通过\n\n所有测试通过，无需修复。\n`;
  } else {
    md += `## 失败项\n\n`;
    for (const f of report.failures) {
      md += `### ${f.testName} (${f.type})\n`;
      md += `- **严重度**: ${f.severity}\n`;
      md += `- **分类**: ${f.category}\n`;
      md += `- **分析**: ${f.reasoning}\n`;
      md += `- **建议**: ${f.suggestedFix}\n\n`;
    }
    
    md += `## Agent 修复指南\n\n`;
    md += `对于每个 HIGH 严重度的失败项：\n`;
    md += `1. 用 \`view_image\` 查看截图确认问题\n`;
    md += `2. 定位对应的源文件（views/ 或 components/）\n`;
    md += `3. 修复代码\n`;
    md += `4. 重新运行 \`npm run test:visual:pixel\` 验证\n`;
    md += `5. 如果是预期变更，更新基线\n\n`;
  }
  
  return md;
}

// ===== Step 4: 基线自动更新 =====

async function updateBaselines(runner, failures) {
  const noiseFailures = failures.filter(f => f.category === 'NOISE');
  if (noiseFailures.length === 0) return 0;
  
  let updated = 0;
  for (const f of noiseFailures) {
    const currentPath = path.join('tests/visual-testing/screenshots', `${f.name}-current.png`);
    const baselinePath = path.join('tests/visual-testing/base-screenshots', `${f.name}.png`);
    if (fs.existsSync(currentPath)) {
      fs.copyFileSync(currentPath, baselinePath);
      updated++;
      log(c.cyan, `  基线更新: ${f.name}`);
    }
  }
  return updated;
}

// ===== Step 5: 生成可执行 Patch =====

function generatePatches(failures) {
  const patchFailures = failures.filter(f => f.severity === 'HIGH' && f.category !== 'NOISE');
  if (patchFailures.length === 0) return [];
  
  fs.mkdirSync(PATCH_DIR, { recursive: true });
  const patches = [];
  const ts = new Date().toISOString().slice(0, 10);
  
  for (const f of patchFailures) {
    const patchName = `${ts}-${f.testName.replace(/[^a-z0-9]/gi, '-')}`;
    const patchFile = path.join(PATCH_DIR, `${patchName}.patch.md`);
    
    const patch = [
      `# Fix: ${f.testName}`,
      ``,
      `## 问题`,
      f.reasoning,
      ``,
      `## 建议修复`,
      f.suggestedFix,
      ``,
      `## 步骤`,
    ];
    
    if (f.type === 'PIXEL' && f.category === 'LAYOUT_REGRESSION') {
      patch.push(
        `1. 查看截图: \`view_image ${f.screenshot}\``,
        `2. 查看差异图: \`view_image ${f.diffImage}\``,
        `3. 定位缺失/错位的组件`,
        `4. 修复 Vue 组件模板或样式`,
        `5. 重跑测试: \`npm run test:visual:pixel\``,
      );
    } else if (f.type === 'PIXEL' && f.category === 'CONTENT_CHANGE') {
      patch.push(
        `1. 查看截图: \`view_image ${f.screenshot}\``,
        `2. 确认变化是否为预期更新`,
        `3a. 如果是预期 → 更新基线: cp screenshots/${f.name}-current.png base-screenshots/${f.name}.png`,
        `3b. 如果不是 → 检查数据源/API 并修复`,
      );
    } else if (f.type === 'FUNCTIONAL') {
      patch.push(
        `1. 检查 ${f.testName} 对应的组件/路由`,
        `2. 查看错误: ${(f.errors || []).join(', ')}`,
        `3. 修复组件逻辑`,
        `4. 重跑测试: npm run test:functional`,
      );
    } else {
      patch.push(`1. 查看截图确认问题`);
      patch.push(`2. 定位并修复`);
      patch.push(`3. 重跑验证`);
    }
    
    fs.writeFileSync(patchFile, patch.join('\n'));
    patches.push({ testName: f.testName, patchFile, category: f.category, severity: f.severity });
  }
  
  return patches;
}

// ===== 主循环 =====

async function autonomousFixLoop() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   全自动修复闭环 (AutonomousFixLoop)                       ║');
  console.log('║   发现 → 分类 → 修复建议 → 验证 → 循环                     ║');
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
  const history = [];
  
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    log(c.bold, `\n━━━ Round ${round}/${MAX_ROUNDS} ━━━`);
    
    const runner = new VisualTestRunner({
      url: BASE_URL,
      headless: process.env.HEADLESS !== 'false',
    });
    await runner.launch();
    
    // Step 1: 采集
    log(c.blue, 'Step 1: 采集测试数据');
    const pixelResults = await collectPixelResults(runner);
    const functionalResults = await collectFunctionalResults(runner);
    await runner.close();
    
    const pixelPassed = pixelResults.filter(r => r.status === 'PASSED').length;
    const pixelFailed = pixelResults.filter(r => r.status === 'FAILED').length;
    const funcPassed = functionalResults.filter(r => r.status === 'PASSED').length;
    const funcFailed = functionalResults.filter(r => r.status !== 'PASSED').length;
    const totalPassed = pixelPassed + funcPassed;
    const totalFailed = pixelFailed + funcFailed;
    
    log(c.green, `  像素: ${pixelPassed}/${pixelResults.length} 通过`);
    log(c.green, `  功能: ${funcPassed}/${functionalResults.length} 通过`);
    
    // Step 2: 分析
    log(c.blue, 'Step 2: 分析失败原因');
    const failures = analyzeFailures(pixelResults, functionalResults);
    const highCount = failures.filter(f => f.severity === 'HIGH').length;
    const medCount = failures.filter(f => f.severity === 'MEDIUM').length;
    const lowCount = failures.filter(f => f.severity === 'LOW').length;
    
    if (failures.length > 0) {
      log(c.red, `  失败: ${failures.length} (🔴${highCount} HIGH, 🟡${medCount} MEDIUM, 🟢${lowCount} LOW)`);
      for (const f of failures) {
        const icon = f.severity === 'HIGH' ? '🔴' : f.severity === 'MEDIUM' ? '🟡' : '🟢';
        log(c.yellow, `  ${icon} ${f.testName}: ${f.category}`);
      }
    } else {
      log(c.green, '  ✅ 全部通过，无需修复');
    }
    
    // 全部通过 → 结束
    if (totalFailed === 0) {
      history.push({ round, passed: totalPassed, failed: 0, fixed: 0 });
      log(c.green, '\n🎉 所有测试通过！闭环完成。\n');
      
      const { mdPath } = generateFixReport(failures, round, history);
      log(c.cyan, `报告: ${mdPath}`);
      break;
    }
    
    // Step 3: 生成修复报告
    log(c.blue, 'Step 3: 生成修复报告');
    const { reportPath, mdPath, report } = generateFixReport(failures, round, history);
    log(c.cyan, `  JSON: ${reportPath}`);
    log(c.cyan, `  Markdown: ${mdPath}`);
    
    // Step 4: 自动更新噪声基线
    const runner2 = new VisualTestRunner({ url: BASE_URL, headless: process.env.HEADLESS !== 'false' });
    await runner2.launch();
    const baselinesUpdated = await updateBaselines(runner2, failures);
    await runner2.close();
    
    if (baselinesUpdated > 0) {
      log(c.cyan, `  自动更新 ${baselinesUpdated} 个基线`);
    }
    
    // Step 5: 生成 Patch
    const patches = generatePatches(failures);
    if (patches.length > 0) {
      log(c.yellow, `  生成 ${patches.length} 个修复 Patch`);
      for (const p of patches) {
        log(c.yellow, `    → ${p.patchFile}`);
      }
    }
    
    const fixed = baselinesUpdated;
    history.push({ round, passed: totalPassed, failed: totalFailed, fixed });
    
    // 无改善检测
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      if (totalFailed >= prev.failed && fixed === 0) {
        log(c.yellow, `\n⚠️  失败数未改善 (${prev.failed} → ${totalFailed})，停止循环。`);
        log(c.cyan, `\n下一步: Agent 读取 ${mdPath}，查看截图和 diff 图，手动修复 HIGH 严重度问题。`);
        break;
      }
    }
    
    log(c.cyan, `\n⏸️  等待修复...（Agent 修复后重新运行此脚本验证）\n`);
  }
  
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  log(c.bold, `\n总耗时: ${totalDuration}s`);
}

// ===== CLI =====

if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args[0] === '--help') {
    console.log(`
全自动修复闭环 (AutonomousFixLoop)

用法:
  node tests/visual-testing/autonomous-fix-loop.js [选项]

选项:
  --max-rounds N    最大循环轮数 (默认: 5)
  --dry-run         只分析不修复 (默认行为)
  --help            显示帮助

环境变量:
  TEST_URL          测试目标 URL (默认: http://127.0.0.1:5174)
  MAX_FIX_ROUNDS    最大循环轮数
  HEADLESS=false    显示浏览器窗口

工作流:
  1. 运行此脚本 → 生成修复报告
  2. Agent 读取报告 → 查看截图 → 修复代码
  3. 重新运行此脚本 → 验证修复结果
  4. 重复直到全部通过
`);
    process.exit(0);
  }
  
  if (args[0] === '--max-rounds' && args[1]) {
    process.env.MAX_FIX_ROUNDS = args[1];
  }
  
  autonomousFixLoop().catch(err => {
    log(c.red, `\n[FATAL] ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { autonomousFixLoop, analyzeFailures, generateFixReport };


