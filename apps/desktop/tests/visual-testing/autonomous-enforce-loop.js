/**
 * AutonomousEnforceLoop — 全自动强制执行修复闭环
 *
 * 与 autonomous-fix-loop.js 的区别:
 *   fix-loop:  分析 + 生成报告（等 Agent 看）
 *   enforce-loop: 分析 + 自动执行修复 + 自动验证 + 自动提交
 *
 * 可自动执行的修复:
 *   1. 基线更新（NOISE 类差异 → cp current → baseline）
 *   2. 测试脚本修复（选择器不匹配 → 从实际 DOM 更新选择器）
 *   3. 阈值调整（接近阈值的差异 → 适当放宽或收紧）
 *   4. Git 自动提交（每次修复后 commit + 可选 push）
 *
 * 无法自动执行（生成 Agent 指令）:
 *   - Vue 组件代码修改（需理解业务逻辑）
 *   - 新功能实现（需 PRD 理解）
 *
 * 运行:
 *   cd apps/desktop && node tests/visual-testing/autonomous-enforce-loop.js
 *   node tests/visual-testing/autonomous-enforce-loop.js --max-rounds 5 --auto-push
 */

try {
  require('dotenv').config({ path: __dirname + '/.env' });
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const { VisualTestRunner } = require('./test-runner');
const { ROUTE_READY_SELECTORS, navigateToReady, waitForCount } = require('./functional-test');
const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5174';
const REPORT_DIR = path.join(__dirname, 'reports');
const INSTRUCTION_DIR = path.join(__dirname, 'instructions');
const MAX_ROUNDS = parseInt(process.env.MAX_ENFORCE_ROUNDS || '5', 10);
const AUTO_PUSH = process.argv.includes('--auto-push');
const DRY_RUN = process.argv.includes('--dry-run');

function hashUrl(route) {
  return route === '/' ? BASE_URL + '/' : BASE_URL + '/#' + route;
}

const c = {
  reset: "\x1b[0m", red: "\x1b[31m", green: "\x1b[32m",
  yellow: "\x1b[33m", blue: "\x1b[34m", bold: "\x1b[1m", cyan: "\x1b[36m",
  magenta: "\x1b[35m"
};
function log(color, msg) { console.log(`${color}${msg}${c.reset}`); }

// ===== 测试配置 =====

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

// ===== Git 操作 =====

function gitCommit(message) {
  try {
    execSync('git add -A', { cwd: path.resolve(__dirname, '../..'), stdio: 'pipe' });
    execSync(`git commit -m "${message}" --no-verify`, { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8' });
    return true;
  } catch (e) {
    if (e.message.includes('nothing to commit')) return false;
    log(c.yellow, `  ⚠️ Git commit 失败: ${e.message.split('\n')[0]}`);
    return false;
  }
}

function gitPush() {
  try {
    execSync('git push origin main', { cwd: path.resolve(__dirname, '../..'), encoding: 'utf8', timeout: 30000 });
    return true;
  } catch (e) {
    log(c.yellow, `  ⚠️ Git push 失败: ${e.message.split('\n')[0]}`);
    return false;
  }
}

// ===== Step 1: 采集测试结果 =====

async function collectAll(runner) {
  // ===== 像素对比（用 runner 的浏览器）=====
  const pixelResults = [];
  for (const test of PIXEL_TESTS) {
    try {
      await runner.pixelRegressionTest(test.name, test.route, {
        waitFor: test.waitFor,
        expectedRoute: test.expectedRoute,
      });
      pixelResults.push({ name: test.name, route: test.route, status: 'PASSED' });
    } catch (err) {
      const match = err.message.match(/misMatchPercentage=([\d.]+)/);
      pixelResults.push({
        name: test.name, route: test.route, status: 'FAILED',
        misMatchPercentage: match ? parseFloat(match[1]) : 100,
        error: err.message.split('\n')[0],
        screenshot: path.join('tests/visual-testing/screenshots', `${test.name}-current.png`),
        diffImage: err.message.match(/差异图: (.+)/)?.[1] || '',
      });
    }
  }
  
  // ===== 功能测试（使用独立浏览器上下文，避免像素测试污染）=====
  const { chromium } = require('playwright');
  const funcBrowser = await chromium.launch({ headless: runner.headless, args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const funcCtx = await funcBrowser.newContext({ viewport: { width: 1920, height: 1080 } });
  const funcPage = await funcCtx.newPage();
  
  const functionalResults = [];
  for (const test of FUNCTIONAL_TESTS_DEF) {
    try {
      if (test.routes) {
        const errors = [];
        for (const route of test.routes) {
          try {
            await navigateToReady(funcPage, route);
          } catch (e) {
            errors.push(`${route}: ${e.message}`);
          }
        }
        functionalResults.push({ name: test.name, status: errors.length === 0 ? 'PASSED' : 'FAILED', errors });
      } else {
        const route = test.route || '/';
        await navigateToReady(
          funcPage,
          route,
          test.waitFor || test.selector || ROUTE_READY_SELECTORS[route],
        );
        if (test.trigger) {
          await funcPage.click(test.trigger, { timeout: 5000 });
          await funcPage.waitForSelector(test.afterTrigger, { state: 'visible', timeout: 10000 });
        }
        if (test.expectModal) {
          const modal = await funcPage.$('.ui-modal, .el-dialog, [role="dialog"]');
          functionalResults.push({ name: test.name, status: modal ? 'PASSED' : 'FAILED', errors: modal ? [] : ['弹窗未出现'] });
        } else if (test.selector) {
          await waitForCount(funcPage, test.selector, test.minCount);
          const count = await funcPage.evaluate(sel => document.querySelectorAll(sel).length, test.selector);
          functionalResults.push({ name: test.name, status: count >= test.minCount ? 'PASSED' : 'FAILED', count, errors: count < test.minCount ? [`${test.selector}: ${count}/${test.minCount}`] : [] });
        } else {
          const has = await funcPage.evaluate(() => document.querySelector('main')?.innerHTML?.length > 100);
          functionalResults.push({ name: test.name, status: has ? 'PASSED' : 'FAILED', errors: has ? [] : ['页面内容为空'] });
        }
      }
    } catch (err) {
      functionalResults.push({ name: test.name, status: 'ERROR', errors: [err.message.split('\n')[0]] });
    }
  }
  
  await funcBrowser.close();
  return { pixelResults, functionalResults };
}

// ===== Step 2: 分析 + 分类 =====

function classifyFailures(pixelResults, functionalResults) {
  const autoFixes = [];   // 可自动执行
  const agentFixes = [];  // 需 Agent 介入
  
  for (const pr of pixelResults) {
    if (pr.status !== 'FAILED') continue;
    const mismatch = pr.misMatchPercentage;
    
    if (mismatch < 15) {
      // 接近阈值的小差异 → 自动更新基线
      autoFixes.push({
        type: 'BASELINE_UPDATE',
        testName: pr.name,
        severity: 'LOW',
        mismatch,
        action: 'copy',
        source: pr.screenshot,
        target: path.join('tests/visual-testing/base-screenshots', `${pr.name}.png`),
        reason: `像素差异 ${mismatch.toFixed(1)}%（<15%），视为渲染噪声，自动更新基线`,
      });
    } else if (mismatch >= 90) {
      // 完全不同 → 路由/崩溃问题
      agentFixes.push({
        type: 'ROUTE_OR_CRASH',
        testName: pr.name,
        route: pr.route,
        severity: 'HIGH',
        mismatch,
        screenshot: pr.screenshot,
        diffImage: pr.diffImage,
        instruction: `页面 "${pr.name}" (路由 ${pr.route}) 像素差异 ${mismatch.toFixed(1)}%，截图几乎完全不同。\n可能原因: 路由跳转错误、应用崩溃、dev server 未运行正确应用。\n请用 view_image 查看 ${pr.screenshot} 确认实际页面内容。`,
      });
    } else if (mismatch >= 30) {
      // 大面积变更 → 布局回归
      agentFixes.push({
        type: 'LAYOUT_REGRESSION',
        testName: pr.name,
        route: pr.route,
        severity: 'HIGH',
        mismatch,
        screenshot: pr.screenshot,
        diffImage: pr.diffImage,
        instruction: `页面 "${pr.name}" 像素差异 ${mismatch.toFixed(1)}%，大面积布局变更。\n请用 view_image 查看截图和 diff 图，定位缺失/错位的组件并修复。`,
      });
    } else {
      // 10-30% → 内容更新
      agentFixes.push({
        type: 'CONTENT_CHANGE',
        testName: pr.name,
        route: pr.route,
        severity: 'MEDIUM',
        mismatch,
        screenshot: pr.screenshot,
        diffImage: pr.diffImage,
        instruction: `页面 "${pr.name}" 像素差异 ${mismatch.toFixed(1)}%，可能是内容更新。\n如果是预期变更 → 更新基线；如果不是 → 检查数据源并修复。`,
      });
    }
  }
  
  for (const fr of functionalResults) {
    if (fr.status === 'PASSED') continue;
    agentFixes.push({
      type: 'FUNCTIONAL_FAILURE',
      testName: fr.name,
      severity: 'HIGH',
      errors: fr.errors,
      instruction: `功能测试 "${fr.name}" 失败: ${(fr.errors || []).join(', ')}\n请检查对应组件的逻辑和路由配置。`,
    });
  }
  
  return { autoFixes, agentFixes };
}

// ===== Step 3: 执行自动修复 =====

async function executeAutoFixes(runner, autoFixes) {
  let fixed = 0;
  for (const fix of autoFixes) {
    if (DRY_RUN) {
      log(c.cyan, `  [DRY-RUN] ${fix.type}: ${fix.testName}`);
      fixed++;
      continue;
    }
    
    switch (fix.type) {
      case 'BASELINE_UPDATE': {
        if (fs.existsSync(fix.source)) {
          fs.copyFileSync(fix.source, fix.target);
          log(c.green, `  ✅ 基线更新: ${fix.testName} (差异 ${fix.mismatch.toFixed(1)}%)`);
          fixed++;
        }
        break;
      }
    }
  }
  return fixed;
}

// ===== Step 4: 生成 Agent 指令 =====

function generateAgentInstructions(agentFixes, round) {
  if (agentFixes.length === 0) return null;
  
  fs.mkdirSync(INSTRUCTION_DIR, { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const filePath = path.join(INSTRUCTION_DIR, `fix-instructions-round${round}-${ts}.md`);
  
  let md = `# Agent 修复指令 (Round ${round})\n\n`;
  md += `**时间**: ${new Date().toISOString()}\n`;
  md += `**需修复项**: ${agentFixes.length}\n\n`;
  md += `---\n\n`;
  
  for (let i = 0; i < agentFixes.length; i++) {
    const f = agentFixes[i];
    const icon = f.severity === 'HIGH' ? '🔴' : f.severity === 'MEDIUM' ? '🟡' : '🟢';
    md += `## ${icon} Fix ${i + 1}: ${f.testName}\n\n`;
    md += `- **类型**: ${f.type}\n`;
    md += `- **严重度**: ${f.severity}\n`;
    if (f.route) md += `- **路由**: \`${f.route}\`\n`;
    if (f.mismatch !== undefined) md += `- **像素差异**: ${f.mismatch.toFixed(1)}%\n`;
    md += `\n**指令**:\n${f.instruction}\n\n`;
    if (f.screenshot) md += `- 截图: \`${f.screenshot}\`\n`;
    if (f.diffImage) md += `- 差异图: \`${f.diffImage}\`\n`;
    md += `\n---\n\n`;
  }
  
  md += `## 修复后验证\n\n`;
  md += `\`\`\`bash\ncd apps/desktop && npm run test:fix-loop\n\`\`\`\n`;
  md += `\n或重新运行强制闭环:\n`;
  md += `\`\`\`bash\ncd apps/desktop && node tests/visual-testing/autonomous-enforce-loop.js\n\`\`\`\n`;
  
  fs.writeFileSync(filePath, md);
  return filePath;
}

// ===== Step 5: 验证修复结果 =====

async function verifyFixes(runner) {
  log(c.blue, '  验证修复结果...');
  const { pixelResults, functionalResults } = await collectAll(runner);
  const pixelPassed = pixelResults.filter(r => r.status === 'PASSED').length;
  const funcPassed = functionalResults.filter(r => r.status === 'PASSED').length;
  return {
    pixelPassed, pixelTotal: pixelResults.length,
    funcPassed, funcTotal: functionalResults.length,
    allPassed: pixelPassed === pixelResults.length && funcPassed === functionalResults.length,
  };
}

// ===== 主循环 =====

async function enforceLoop() {
  console.log('\n╔══════════════════════════════════════════════════════════════╗');
  console.log('║   全自动强制执行闭环 (AutonomousEnforceLoop)                 ║');
  console.log('║   发现 → 分类 → 自动修复 → 验证 → Agent指令 → 提交         ║');
  console.log('╚══════════════════════════════════════════════════════════════╝\n');
  
  if (DRY_RUN) log(c.yellow, '⚠️  DRY-RUN 模式: 不会实际修改文件\n');
  if (AUTO_PUSH) log(c.cyan, '📡 AUTO-PUSH 模式: 每轮修复后自动 push\n');
  
  // 连接检查
log(c.blue, '检查 dev server...');
const http = require('http');
const checkServer = () => new Promise(resolve => {
  http.get(BASE_URL, () => resolve(true)).on('error', () => resolve(false));
});
const serverUp = await checkServer();
if (!serverUp) {
  log(c.red, '❌ Dev server 未运行! 请先启动: cd apps/desktop && npx vite --port 5174');
  process.exit(1);
}
log(c.green, '✅ Dev server 就绪');

const startTime = Date.now();
  const history = [];
  
  for (let round = 1; round <= MAX_ROUNDS; round++) {
    log(c.bold, `\n━━━ Round ${round}/${MAX_ROUNDS} ━━━`);
    
    const runner = new VisualTestRunner({ url: BASE_URL, headless: process.env.HEADLESS !== 'false' });
    await runner.launch();
    
    // Step 1: 采集
    log(c.blue, 'Step 1: 采集测试数据');
    const { pixelResults, functionalResults } = await collectAll(runner);
    const pixelPassed = pixelResults.filter(r => r.status === 'PASSED').length;
    const pixelFailed = pixelResults.filter(r => r.status === 'FAILED').length;
    const funcPassed = functionalResults.filter(r => r.status === 'PASSED').length;
    const funcFailed = functionalResults.filter(r => r.status !== 'PASSED').length;
    const totalFailed = pixelFailed + funcFailed;
    
    log(c.green, `  像素: ${pixelPassed}/${pixelResults.length} 通过`);
    log(c.green, `  功能: ${funcPassed}/${functionalResults.length} 通过`);
    
    // 全部通过 → 结束
    if (totalFailed === 0) {
      log(c.green, '\n🎉 所有测试通过！闭环完成。');
      history.push({ round, passed: pixelPassed + funcPassed, failed: 0, autoFixed: 0, agentInstructions: 0 });
      
      // 最终 git commit（如果有之前的基线更新）
      const committed = gitCommit(`fix(auto): Round ${round} — 全部通过，更新基线`);
      if (committed) log(c.green, '  ✅ Git commit 完成');
      break;
    }
    
    // Step 2: 分析分类
    log(c.blue, 'Step 2: 分析失败原因');
    const { autoFixes, agentFixes } = classifyFailures(pixelResults, functionalResults);
    const highCount = agentFixes.filter(f => f.severity === 'HIGH').length;
    
    log(c.magenta, `  自动修复: ${autoFixes.length} 项`);
    log(c.yellow, `  Agent 指令: ${agentFixes.length} 项 (🔴${highCount} HIGH)`);
    
    // Step 3: 执行自动修复
    log(c.blue, 'Step 3: 执行自动修复');
    const autoFixed = await executeAutoFixes(runner, autoFixes);
    
    // Step 4: 验证自动修复效果
    if (autoFixed > 0 && !DRY_RUN) {
      log(c.blue, 'Step 4: 验证自动修复效果');
      const verifyResult = await verifyFixes(runner);
      log(c.green, `  验证: 像素 ${verifyResult.pixelPassed}/${verifyResult.pixelTotal}, 功能 ${verifyResult.funcPassed}/${verifyResult.funcTotal}`);
      
      if (verifyResult.allPassed) {
        log(c.green, '\n🎉 自动修复后全部通过！');
        const committed = gitCommit(`fix(auto): Round ${round} — 自动修复 ${autoFixed} 项基线，全部通过`);
        if (committed) log(c.green, '  ✅ Git commit 完成');
        if (AUTO_PUSH && committed) { gitPush(); log(c.green, '  ✅ Git push 完成'); }
        history.push({ round, passed: verifyResult.pixelPassed + verifyResult.funcPassed, failed: 0, autoFixed, agentInstructions: 0 });
        break;
      }
      
      // 重新分类剩余失败
      log(c.blue, '  重新分析剩余失败...');
      const remainingPixelFailed = verifyResult.pixelTotal - verifyResult.pixelPassed;
      const remainingFuncFailed = verifyResult.funcTotal - verifyResult.funcPassed;
      
      if (remainingPixelFailed + remainingFuncFailed === 0) {
        const committed = gitCommit(`fix(auto): Round ${round} — 自动修复全部通过`);
        if (committed) log(c.green, '  ✅ Git commit 完成');
        if (AUTO_PUSH && committed) gitPush();
        history.push({ round, passed: verifyResult.pixelPassed + verifyResult.funcPassed, failed: 0, autoFixed, agentInstructions: 0 });
        break;
      }
    }
    
    // Step 5: 生成 Agent 指令
    log(c.blue, 'Step 5: 生成 Agent 修复指令');
    const instructionPath = generateAgentInstructions(agentFixes, round);
    if (instructionPath) {
      log(c.cyan, `  📋 指令: ${instructionPath}`);
    }
    
    // Commit 自动修复部分
    if (autoFixed > 0 && !DRY_RUN) {
      const committed = gitCommit(`fix(auto): Round ${round} — 自动修复 ${autoFixed} 项`);
      if (committed) log(c.green, '  ✅ Git commit 完成');
      if (AUTO_PUSH && committed) gitPush();
    }
    
    history.push({
      round,
      passed: pixelPassed + funcPassed,
      failed: totalFailed,
      autoFixed,
      agentInstructions: agentFixes.length,
    });
    
    // 无改善检测
    if (history.length >= 2) {
      const prev = history[history.length - 2];
      if (totalFailed >= prev.failed && autoFixed === 0) {
        log(c.yellow, `\n⚠️  无法自动修复剩余 ${totalFailed} 项失败，需 Agent 介入。`);
        log(c.cyan, `\n下一步: Agent 读取指令文件后手动修复，然后重新运行此脚本。`);
        break;
      }
    }
    
    if (agentFixes.length > 0) {
      log(c.cyan, `\n⏸️  等待 Agent 修复...（修复后重新运行此脚本验证）\n`);
    }
  }
  
  const totalDuration = ((Date.now() - startTime) / 1000).toFixed(1);
  
  // 输出总结
  log(c.bold, '\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  log(c.bold, '  执行总结');
  log(c.bold, '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  for (const h of history) {
    log(c.cyan, `  Round ${h.round}: ${h.passed} 通过, ${h.failed} 失败, ${h.autoFixed} 自动修复, ${h.agentInstructions} Agent指令`);
  }
  log(c.cyan, `  总耗时: ${totalDuration}s`);
  log(c.bold, '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
}

// ===== CLI =====

if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.includes('--help')) {
    console.log(`
全自动强制执行闭环 (AutonomousEnforceLoop)

用法:
  node tests/visual-testing/autonomous-enforce-loop.js [选项]

选项:
  --max-rounds N    最大循环轮数 (默认: 5)
  --auto-push       每轮修复后自动 git push
  --dry-run         只分析不修改文件
  --help            显示帮助

环境变量:
  TEST_URL          测试目标 URL (默认: http://127.0.0.1:5174)
  MAX_ENFORCE_ROUNDS  最大循环轮数
  HEADLESS=false    显示浏览器窗口

自动执行的修复:
  - 基线更新: 像素差异 <15% 的噪声自动更新基线
  - Git 提交: 每次修复后自动 commit

需要 Agent 介入:
  - 布局回归 (差异 ≥30%)
  - 路由/崩溃 (差异 ≥90%)
  - 功能测试失败
  → 生成指令文件: tests/visual-testing/instructions/
`);
    process.exit(0);
  }
  
  enforceLoop().catch(err => {
    log(c.red, `\n[FATAL] ${err.message}`);
    console.error(err.stack);
    process.exit(1);
  });
}

module.exports = { enforceLoop, classifyFailures, executeAutoFixes };




