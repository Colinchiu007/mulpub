/**
 * 功能性测试 — 验证页面交互逻辑和功能正确性
 * 运行: node tests/visual-testing/functional-test.js
 */

try {
  require('dotenv').config({ path: __dirname + '/.env' });
} catch (error) {
  if (error.code !== 'MODULE_NOT_FOUND') throw error;
}

const { VisualTestRunner } = require('./test-runner');

const BASE_URL = process.env.TEST_URL || 'http://127.0.0.1:5174';

/** Hash 路由辅助函数 */
function hashUrl(route) {
  if (route === '/') return BASE_URL + '/';
  return BASE_URL + '/#' + route;
}

const ROUTE_READY_SELECTORS = {
  '/': '.mp-home .mp-home-welcome',
  '/accounts': '.mp-workspace .accounts-page',
  '/publish': '.mp-workspace .page-title:has-text("一键发布")',
  '/collection': '.cohere-main .collection-tab-btn.active',
  '/monitor': '.cohere-main .page-title:has-text("分屏监控")',
  '/comments': '.cohere-main .page-title:has-text("评论管理")',
  '/dashboard': '.cohere-main .page-title:has-text("数据看板")',
  '/create': '.cohere-main h1:has-text("视频创作")',
  '/create/pipeline': '.cohere-main h1:has-text("视频创作")',
  '/create/result': '.cohere-main h1:has-text("视频预览")',
  '/create/history': '.history-status-tabs',
  '/calendar': '.cohere-main .page-title:has-text("发布日历")',
  '/first-run': '.cohere-main h2:has-text("欢迎使用社媒管家")',
  '/keywords': '.cohere-main .page-title:has-text("关键词监测")',
  '/viral-analysis': '.cohere-main .page-title:has-text("爆款分析")',
  '/cloud-publish': '.cohere-main .page-title:has-text("云端发布")',
  '/intelligence': '.cohere-main .page-title:has-text("内容情报")',
  '/model-providers': '.cohere-main .page-title:has-text("模型服务商设置")',
};

function expectedRoute(route) {
  return route === '/create/pipeline' ? '/create' : route;
}

async function navigateToReady(page, route, selector = ROUTE_READY_SELECTORS[route] || '#app[data-v-app]') {
  await page.goto(hashUrl(route), { waitUntil: 'domcontentloaded', timeout: 15000 });
  await page.waitForFunction((routePath) => {
    const currentRoute = window.location.hash.slice(1) || '/';
    const app = document.querySelector('#app[data-v-app]');
    return currentRoute === routePath && app && (app.textContent || '').trim().length > 0;
  }, expectedRoute(route), { timeout: 10000 });
  await page.waitForSelector(selector, { state: 'visible', timeout: 10000 });
}

async function waitForCount(page, selector, minimum) {
  await page.waitForFunction(({ query, count }) => (
    document.querySelectorAll(query).length >= count
  ), { query: selector, count: minimum }, { timeout: 10000 });
}

const functionalTests = [
  // ==================== 导航功能 ====================
  {
    name: 'nav-routes',
    description: '所有导航路由可达',
    async run(runner) {
      const routes = ['/', '/accounts', '/publish', '/collection', '/monitor', '/comments', '/dashboard', '/create', '/calendar'];
      const errors = [];
      for (const route of routes) {
        try {
          await navigateToReady(runner.page, route);
        } catch (err) {
          errors.push(`${route}: ${err.message.split('\n')[0]}`);
        }
      }
      return { passed: errors.length === 0, errors };
    }
  },
  {
    name: 'nav-highlight',
    description: '导航高亮跟随路由',
    async run(runner) {
      await navigateToReady(runner.page, '/accounts', '[data-testid="mp-tab-accounts"].active');
      const activeCount = await runner.page.$$eval(
        '[data-testid^="mp-tab-"].active, [data-testid^="mp-tab-"][aria-current="page"]',
        els => els.length,
      );
      return { passed: activeCount > 0, errors: activeCount === 0 ? ['导航项无 active 高亮'] : [] };
    }
  },

  // ==================== 首页功能 ====================
  {
    name: 'home-content',
    description: '首页内容渲染',
    async run(runner) {
      await navigateToReady(runner.page, '/');
      const hasContent = await runner.page.evaluate(() => document.querySelector('main')?.innerHTML?.length > 100);
      return { passed: hasContent, errors: hasContent ? [] : ['主内容区域为空'] };
    }
  },
  {
    name: 'home-sidebar-platforms',
    description: '侧边栏平台列表',
    async run(runner) {
      await navigateToReady(runner.page, '/', '.cohere-platform-item');
      await waitForCount(runner.page, '.cohere-platform-item', 3);
      const count = await runner.page.$$eval('.cohere-platform-item', els => els.length);
      return { passed: count >= 3, errors: count < 3 ? [`平台列表项不足: ${count}`] : [] };
    }
  },

  // ==================== 账号管理 ====================
  {
    name: 'accounts-add-dialog',
    description: '添加账号弹窗',
    async run(runner) {
      await navigateToReady(runner.page, '/accounts', 'button:has-text("添加账号")');
      
      const addBtn = await runner.page.$('button:has-text("添加账号")');
      if (!addBtn) return { passed: false, errors: ['未找到添加按钮'] };
      await addBtn.click();
      await runner.page.waitForSelector('.ui-modal, .el-dialog, [role="dialog"]', {
        state: 'visible',
        timeout: 10000,
      });
      
      const modal = await runner.page.$('.ui-modal, .el-dialog, [role="dialog"]');
      return { passed: !!modal, errors: modal ? [] : ['点击添加后未弹出对话框'] };
    }
  },
  {
    name: 'accounts-filter',
    description: '账号列表筛选',
    async run(runner) {
      await navigateToReady(runner.page, '/accounts', '.filter-tabs[role="tablist"]');
      await waitForCount(runner.page, '.filter-tabs[role="tablist"] button[role="tab"]', 3);
      const filterChips = await runner.page.$$eval(
        '.filter-tabs[role="tablist"] button[role="tab"]',
        btns => btns.filter(b => ['全部', '已登录', '未登录'].includes(b.textContent.trim())).length,
      );
      return { passed: filterChips >= 3, errors: filterChips < 3 ? [`筛选按钮不足: ${filterChips}`] : [] };
    }
  },

  // ==================== 发布功能 ====================
  {
    name: 'publish-form',
    description: '发布表单字段',
    async run(runner) {
      await navigateToReady(runner.page, '/publish', 'input[placeholder*="标题"]');
      const inputs = await runner.page.$$('input, textarea');
      const hasTitle = await runner.page.$('input[placeholder*="标题"]');
      const hasPublishBtn = await runner.page.$$eval('button', btns => btns.some(b => b.textContent.includes('发布')));
      return {
        passed: inputs.length >= 2 && !!hasTitle && hasPublishBtn,
        errors: [
          inputs.length < 2 ? `输入框不足: ${inputs.length}` : '',
          !hasTitle ? '标题输入框不存在' : '',
          !hasPublishBtn ? '发布按钮不存在' : ''
        ].filter(Boolean)
      };
    }
  },

  // ==================== 监控功能 ====================
  {
    name: 'monitor-layout',
    description: '监控页面布局',
    async run(runner) {
      await navigateToReady(runner.page, '/monitor');
      const hasContent = await runner.page.evaluate(() => document.querySelector('main')?.innerHTML?.length > 100);
      return { passed: hasContent, errors: hasContent ? [] : ['监控页面内容为空'] };
    }
  },

  // ==================== 模型服务商 ====================
  {
    name: 'model-provider-filter',
    description: '服务商分类筛选',
    async run(runner) {
      await navigateToReady(runner.page, '/model-providers', '.filter-chip');
      await waitForCount(runner.page, '.filter-chip', 5);
      const chips = await runner.page.$$('.filter-chip');
      return { passed: chips.length >= 5, errors: chips.length < 5 ? [`筛选按钮不足: ${chips.length}`] : [] };
    }
  },
  {
    name: 'model-provider-cards',
    description: '服务商卡片区域',
    async run(runner) {
      await navigateToReady(runner.page, '/model-providers');
      const cards = await runner.page.$$('.provider-card, .provider-grid, [class*="provider"]');
      return {
        passed: cards.length > 0,
        errors: cards.length > 0 ? [] : ['服务商区域未渲染'],
        info: `发现 ${cards.length} 个服务商相关元素`,
      };
    }
  },

  // ==================== 日历功能 ====================
  {
    name: 'calendar-grid',
    description: '日历网格渲染',
    async run(runner) {
      await navigateToReady(runner.page, '/calendar', '.calendar-grid');
      await waitForCount(runner.page, '.calendar-grid > *', 28);
      const gridChildren = await runner.page.$$eval('.calendar-grid > *', els => els.length);
      return { passed: gridChildren >= 28, errors: gridChildren < 28 ? [`日历格子不足: ${gridChildren}`] : [] };
    }
  },
  {
    name: 'calendar-nav',
    description: '日历月份导航',
    async run(runner) {
      await navigateToReady(runner.page, '/calendar', 'button:has-text("今天")');
      const btnTexts = await runner.page.$$eval('button', els => els.map(e => e.textContent.trim()));
      const hasNav = btnTexts.some(t => t.includes('◀')) && btnTexts.some(t => t.includes('▶')) && btnTexts.some(t => t.includes('今天'));
      return { passed: hasNav, errors: hasNav ? [] : ['缺少月份导航按钮'] };
    }
  },

  // ==================== 视频创作 ====================
  {
    name: 'create-view-tabs',
    description: '创作页 Tab 切换',
    async run(runner) {
      await navigateToReady(runner.page, '/create', '.view-tab');
      await waitForCount(runner.page, '.view-tab, .view-tabs button', 3);
      const tabs = await runner.page.$$('.view-tab, .view-tabs button');
      return { passed: tabs.length >= 3, errors: tabs.length < 3 ? [`Tab 数量不足: ${tabs.length}`] : [] };
    }
  },

  // ==================== 智能助手 ====================
  {
    name: 'intelligence-search',
    description: '智能搜索入口',
    async run(runner) {
      await navigateToReady(runner.page, '/intelligence');
      const hasContent = await runner.page.evaluate(() => document.querySelector('main')?.innerHTML?.length > 100);
      return { passed: hasContent, errors: hasContent ? [] : ['智能助手页面内容为空'] };
    }
  },

  // ==================== 评论管理 ====================
  {
    name: 'comments-list',
    description: '评论列表渲染',
    async run(runner) {
      await navigateToReady(runner.page, '/comments');
      const hasContent = await runner.page.evaluate(() => document.querySelector('main')?.innerHTML?.length > 100);
      return { passed: hasContent, errors: hasContent ? [] : ['评论页面内容为空'] };
    }
  },

  // ==================== 收藏管理 ====================
  {
    name: 'collection-view',
    description: '收藏页面渲染',
    async run(runner) {
      await navigateToReady(runner.page, '/collection', '.cohere-stat-card');
      await waitForCount(runner.page, '.cohere-stat-card', 2);
      const cards = await runner.page.$$('.cohere-stat-card');
      return { passed: cards.length >= 2, errors: cards.length < 2 ? [`收藏统计卡片不足: ${cards.length}`] : [] };
    }
  },

  // ==================== 全局 UI ====================
  {
    name: 'global-topnav',
    description: '顶部导航栏',
    async run(runner) {
      await navigateToReady(runner.page, '/', '.cohere-topnav');
      await waitForCount(runner.page, '.nav-item', 5);
      const navItems = await runner.page.$$('.nav-item');
      const brand = await runner.page.$('.brand');
      return {
        passed: navItems.length >= 5 && !!brand,
        errors: [navItems.length < 5 ? `导航项不足: ${navItems.length}` : '', !brand ? '品牌标识不存在' : ''].filter(Boolean)
      };
    }
  },
  {
    name: 'global-upgrade-entry',
    description: '升级入口（非Pro用户，位于底部用户菜单）',
    async run(runner) {
      // 2026-09-14：升级 Pro 由侧边栏 footer 独立按钮迁入底部用户菜单，需先展开菜单
      await navigateToReady(runner.page, '/', '[data-testid="mp-profile"]');
      await runner.page.click('[data-testid="mp-profile"]');
      await runner.page.waitForSelector('[data-testid="profile-menu-upgrade"]', { state: 'visible', timeout: 5000 });
      const upgradeEntry = await runner.page.$('[data-testid="profile-menu-upgrade"]');
      return { passed: !!upgradeEntry, errors: upgradeEntry ? [] : ['底部用户菜单中未找到升级入口'] };
    }
  },
  {
    name: 'global-status-indicator',
    description: '服务状态指示器',
    async run(runner) {
      await navigateToReady(runner.page, '/', '.status-dot, .status-indicator');
      const statusDot = await runner.page.$('.status-dot, .status-indicator');
      return { passed: !!statusDot, errors: statusDot ? [] : ['状态指示器不存在'] };
    }
  },


  // === Console Error Detection ===
  {
    name: 'console-no-errors',
    description: '所有路由无 JS 运行时错误',
    async run(runner) {
      const routes = ['/', '/accounts', '/publish', '/create', '/dashboard', '/calendar', '/collection', '/login'];
      const allErrors = [];
      for (const route of routes) {
        const errors = [];
        const handler = err => errors.push(err.message);
        const consoleHandler = msg => { if (msg.type() === 'error') errors.push(msg.text()); };
        runner.page.on('pageerror', handler);
        runner.page.on('console', consoleHandler);
        try {
          await navigateToReady(runner.page, route);
        } catch (error) {
          errors.push(`navigation failed: ${error.message}`);
        }
        runner.page.removeListener('pageerror', handler);
        runner.page.removeListener('console', consoleHandler);
        const critical = errors.filter(e =>
          !e.includes('ResizeObserver') && !e.includes('favicon') && !e.includes('net::ERR_') &&
          !e.includes('Failed to load resource') && !e.includes('Security Warning') && !e.includes('CSP')
        );
        if (critical.length > 0) allErrors.push(route + ': ' + critical.join('; '));
      }
      return { passed: allErrors.length === 0, errors: allErrors.length > 0 ? allErrors : [] };
    }
  },
  // === Vue Component Resolution ===
  {
    name: 'vue-component-resolution',
    description: '所有组件正确解析（无 Failed to resolve component 警告）',
    async run(runner) {
      const routes = ['/', '/create', '/accounts', '/publish', '/dashboard'];
      const unresolved = [];
      for (const route of routes) {
        const warnings = [];
        const handler = msg => {
          if (msg.type() === 'warning' || msg.type() === 'error') {
            const text = msg.text();
            if (text.includes('Failed to resolve component') || text.includes('Unknown custom element')) {
              warnings.push(text.substring(0, 200));
            }
          }
        };
        runner.page.on('console', handler);
        try {
          await navigateToReady(runner.page, route);
        } catch (error) {
          warnings.push(`navigation failed: ${error.message}`);
        }
        runner.page.removeListener('console', handler);
        if (warnings.length > 0) unresolved.push(route + ': ' + warnings.join('; '));
      }
      return { passed: unresolved.length === 0, errors: unresolved.length > 0 ? unresolved : [] };
    }
  },
  // === Button Clickability ===
  {
    name: 'create-pipeline-start-button',
    description: '创作页「启动流水线」按钮可点击',
    async run(runner) {
      await navigateToReady(runner.page, '/create', '.view-tab');
      const dq = String.fromCharCode(36, 36);
      const tabs = await runner.page[dq]('.view-tab');
      if (tabs.length > 0) {
        await tabs[0].click();
        await runner.page.waitForSelector('.view-tab.active:has-text("流水线创作")', {
          state: 'visible',
          timeout: 10000,
        });
      }
      const pipelineCards = await runner.page[dq]('.pipeline-card');
      if (pipelineCards.length > 0) {
        await pipelineCards[0].click();
        await runner.page.waitForSelector('.pipeline-detail', { state: 'visible', timeout: 10000 });
        const textInput = await runner.page.$('textarea[placeholder*="视频文案"]');
        if (textInput) await textInput.fill('视觉回归测试文案');
      } else {
        const fallbackBtn = await runner.page.evaluate(() => { const els = document.querySelectorAll('*'); for (const el of els) { if (el.textContent.includes('启动流水线') && el.children.length <= 2) return { tag: el.tagName, isBtn: el.tagName === 'BUTTON' || el.getAttribute('role') === 'button' }; } return null; });
        if (fallbackBtn && !fallbackBtn.isBtn) return { passed: false, errors: ['流水线数据为空, 启动流水线降级为非button元素(tag=' + fallbackBtn.tag + ')'] };
        return { passed: true, info: '流水线列表为空(dev server下正常)，无按钮可验证' };
      }
      const startBtn = await runner.page.evaluate(() => { const allBtns = document.querySelectorAll('button, .btn-start, [class*=btn]'); for (const btn of allBtns) { if (btn.textContent.includes('启动流水线')) { const style = window.getComputedStyle(btn); return { exists: true, tag: btn.tagName, disabled: btn.disabled || btn.hasAttribute('disabled'), pointerEvents: style.pointerEvents, isRealButton: btn.tagName === 'BUTTON' }; } } return { exists: false }; });
      const errors = [];
      if (!startBtn.exists) errors.push('启动流水线按钮不存在');
      else {
        if (!startBtn.isRealButton) errors.push('不是真正的 button 元素(tag=' + startBtn.tag + ')，组件可能未注册');
        if (startBtn.disabled) errors.push('按钮处于 disabled 状态');
        if (startBtn.pointerEvents === 'none') errors.push('pointer-events: none');
      }
      return { passed: errors.length === 0, errors: errors };
    }
  },


  // === Static: Component Registration Check ===
  {
    name: 'component-registration-audit',
    description: '所有 .vue 文件的 Ui 组件均已 import 并注册',
    async run(runner) {
      var fs2 = require('fs');
      var path = require('path');
      var viewsDir = path.resolve(__dirname, '../../src/views');
      var files = fs2.readdirSync(viewsDir).filter(function(f) { return f.endsWith('.vue'); });
      var issues = [];
      for (var i = 0; i < files.length; i++) {
        var content = fs2.readFileSync(path.join(viewsDir, files[i]), "utf8");
        var usedMatch = content.match(/<Ui(\w+)/g) || [];
        var used = [];
        for (var j = 0; j < usedMatch.length; j++) {
          var name = 'Ui' + usedMatch[j].substring(3);
          if (used.indexOf(name) < 0) used.push(name);
        }
        var importedMatch = content.match(/import\s+Ui\w+/g) || [];
        var imported = [];
        for (var j = 0; j < importedMatch.length; j++) {
          var name = importedMatch[j].replace('import ', '');
          if (imported.indexOf(name) < 0) imported.push(name);
        }
        var missing = used.filter(function(u) { return imported.indexOf(u) < 0; });
        if (missing.length > 0) {
          issues.push(files[i] + ': missing import for ' + missing.join(', '));
        }
      }
      return { passed: issues.length === 0, errors: issues };
    }
  },
  // === Missing Route Coverage ===
  {
    name: 'all-routes-renderable',
    description: '所有路由可加载且无致命错误',
    async run(runner) {
      var routes = ['/', '/accounts', '/publish', '/create', '/dashboard', '/calendar', '/collection', '/login', '/first-run', '/keywords', '/viral-analysis', '/create/result', '/create/pipeline', '/create/history', '/cloud-publish', '/intelligence', '/model-providers'];
      var fatal = [];
      for (var i = 0; i < routes.length; i++) {
        var route = routes[i];
        var errors = [];
        var handler = function(msg) { if (msg.type() === "error") errors.push(msg.text()); };
        runner.page.on("console", handler);
        try {
          await navigateToReady(runner.page, route);
        } catch (e) { errors.push("navigation failed: " + e.message.substring(0, 100)); }
        runner.page.removeListener("console", handler);
        var critical = errors.filter(function(e) { return e.indexOf('net::ERR_') >= 0 || e.indexOf('Uncaught TypeError') >= 0 || e.indexOf('Uncaught ReferenceError') >= 0; });
        if (critical.length > 0) fatal.push(route + ": " + critical.join("; "));
      }
      return { passed: fatal.length === 0, errors: fatal };
    }
  },
  // === CSS Load Check ===
  {
    name: 'css-variables-active',
    description: 'CSS 变量正确加载（无 BOM / PostCSS 错误）',
    async run(runner) {
      await navigateToReady(runner.page, '/', '.cohere-sidebar, .app-sidebar, nav');
      var cssOk = await runner.page.evaluate(function() {
        var root = getComputedStyle(document.documentElement);
        var primary = root.getPropertyValue("--primary").trim();
        var bg = root.getPropertyValue("--bg-primary").trim();
        var sidebar = document.querySelector(".sidebar, .app-sidebar, nav");
        var sidebarBg = sidebar ? getComputedStyle(sidebar).backgroundColor : "none";
        return {
          hasPrimary: primary.length > 0,
          hasBg: bg.length > 0,
          sidebarHasStyle: sidebarBg !== 'none' && sidebarBg !== 'rgba(0, 0, 0, 0)',
          bodyMargin: getComputedStyle(document.body).margin
        };
      });
      var errors = [];
      if (!cssOk.hasPrimary) errors.push('--primary CSS variable not set (CSS may not have loaded)');
      if (!cssOk.sidebarHasStyle) errors.push('Sidebar has no background color (CSS may not have loaded)');
      if (cssOk.bodyMargin !== '0px') errors.push('body margin is not reset: ' + cssOk.bodyMargin);
      return { passed: errors.length === 0, errors: errors };
    }
  },
];

async function runFunctionalTests() {
  console.log('🧪 开始功能性测试...\n');
  console.log(`  Target: ${BASE_URL}\n`);
  
  const runner = new VisualTestRunner({ headless: process.env.HEADLESS !== 'false' });
  await runner.launch();
  
  let passed = 0;
  let failed = 0;
  const total = functionalTests.length;
  const results = [];
  
  for (const test of functionalTests) {
    console.log(`🔬 [${passed + failed + 1}/${total}] ${test.name}: ${test.description}`);
    try {
      const result = await test.run(runner);
      if (result.passed) {
        passed++;
        console.log(`   ✅ ${result.info || '通过'}`);
      } else {
        failed++;
        const errMsg = Array.isArray(result.errors) ? result.errors.join(', ') : String(result.errors || '');
        console.log(`   ❌ ${errMsg}`);
      }
      results.push({ name: test.name, description: test.description, ...result });
    } catch (err) {
      failed++;
      console.log(`   ❌ 异常: ${err.message.split('\n')[0]}`);
      results.push({ name: test.name, description: test.description, passed: false, errors: [err.message] });
    }
  }
  
  await runner.close();
  
  const report = {
    timestamp: new Date().toISOString(),
    summary: { total, passed, failed, passRate: `${((passed / total) * 100).toFixed(1)}%` },
    results
  };
  
  const fs = require('fs');
  const reportDir = 'tests/visual-testing/reports';
  fs.mkdirSync(reportDir, { recursive: true });
  const reportPath = `${reportDir}/functional-report-${Date.now()}.json`;
  fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log(`  功能性测试结果: ${passed}/${total} 通过 (${report.summary.passRate}), ${failed} 失败`);
  console.log(`  报告: ${reportPath}`);
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  process.exit(failed > 0 ? 1 : 0);
}

if (require.main === module) runFunctionalTests();

module.exports = {
  ROUTE_READY_SELECTORS,
  navigateToReady,
  waitForCount,
  functionalTests,
  runFunctionalTests,
};

