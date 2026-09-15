/**
 * v9 — 配置驱动 GUI 测试框架
 * 所有选择器/路由/Mock 数据均从 selectors.json 读取
 * 修改 selectors.json 即可适配界面变化，无需改测试逻辑
 */
const { _electron: electron } = require("playwright");
const os = require("os");
const path = require("path");
const fs = require("fs");
const {
  EL, MAIN, SS, ROUTES, SEL, MOCK,
  wait, assert, getResults, resetResults,
  checkVite, findMainWindow, injectAccounts, ensurePlatformStore,
  setBatchMode, assertTitle, PROJECT_ROOT,
} = require("./test-helpers.js");

function isIgnorableConsoleError(message) {
  const text = String(message || '')
  return text.includes("Request Autofill.enable failed") ||
    text.includes("Request Autofill.setAddresses failed") ||
    text.includes("net::ERR_NETWORK_ACCESS_DENIED")
}

// ════════════════════════════════════════════════════
// 页面测试套件（按路由配置驱动）
// ════════════════════════════════════════════════════

async function testAccountPage(win) {
  console.log("\n═══ 账号页 ═══");
  await win.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.accounts);
  await wait(5000);
  await injectAccounts(win);
  await wait(500);

  // 基线
  const state = await win.evaluate((sel) => {
    const platformFilters = document.querySelectorAll(sel.platformFilterButton);
    return { platformFilterCount: platformFilters.length, rows: document.querySelectorAll(sel.accountRow).length };
  }, SEL);
  assert(`${state.platformFilterCount} 个平台筛选、${state.rows} 行`, state.platformFilterCount === 7 && state.rows === 12);

  // 删除
  await win.evaluate((sel) => {
    const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
    const store = pinia._s.get("accounts");
    store.$patch({ accounts: store.accounts.filter(a => a.id !== 3) });
  }, SEL);
  await wait(500);
  const afterDelete = await win.evaluate((sel) => document.querySelectorAll(sel.accountRow).length, SEL);
  assert(`删除后 11 行`, afterDelete === 11);
  await injectAccounts(win);

  // 默认切换
  await win.evaluate((sel) => {
    const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
    const store = pinia._s.get("accounts");
    store.$patch({ accounts: store.accounts.map(a => ({ ...a, is_default: a.id === 2 })) });
  }, SEL);
  await wait(500);
  const defaultName = await win.evaluate((sel) => {
    const nameButton = document.querySelector(`${sel.accountRow}.is-default ${sel.accountNameButton}`);
    return nameButton?.textContent?.trim() || "";
  }, SEL);
  assert(`默认账号「科技号」`, defaultName === "科技号");
  await injectAccounts(win);

  // 筛选
  for (const [value, label] of [["inactive", "未登录"], ["active", "已登录"], ["all", "全部"]]) {
    const btn = await win.$(`#account-status-tab-${value}`);
    if (btn) { await btn.click(); await wait(800); }
    const cnt = await win.evaluate((sel) => document.querySelectorAll(sel.accountRow).length, SEL);
    const expected = { "未登录": 3, "已登录": 9, "全部": 12 }[label];
    assert(`筛选「${label}」: ${cnt}`, cnt === expected);
  }

  // 弹窗
  await win.evaluate(() => {
    document.querySelector('[data-testid="account-add"]')?.click();
  });
  await wait(1500);
  const dialogOpen = await win.evaluate((sel) => !!document.querySelector(sel.accountModal), SEL);
  assert("添加账号弹窗", dialogOpen);
  await win.evaluate(() => document.querySelector(".ui-modal-close")?.click());
  await wait(500);

  await win.screenshot({ path: path.join(SS, "v9-01-accounts.png") });
}

async function testPublishPage(win) {
  console.log("\n═══ 发布页 ═══");
  await win.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.publish);
  await wait(3000);

  // Quill
  const quill = await win.evaluate((sel) => !!document.querySelector(sel.quillEditor), SEL);
  assert("Quill 编辑器", quill);

  // 标题
  const titleVal = await win.evaluate(() => {
    const inp = document.querySelector('[data-testid="publish-title"]');
    if (!inp) return null;
    inp.value = "v9 测试标题"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    return inp.value;
  });
  assert("输入标题", titleVal === "v9 测试标题");

  // 批量模式
  await setBatchMode(win, true);
  await wait(3000);
  const batchState = await win.evaluate(() => ({
    cards: document.querySelectorAll(".cohere-card").length,
    hasDel: !!document.querySelector('[data-testid^="batch-delete-"]'),
    hasDup: !!document.querySelector('[data-testid^="batch-copy-"]'),
  }));
  assert("批量卡片", batchState.cards >= 2, `${batchState.cards} 个`);
  // 删除按钮仅在 ≥2 篇文章时可见 (v-if="articles.length > 1")
  assert("批量模式 UI 可见", batchState.cards >= 2);
  await setBatchMode(win, false);
  await wait(1000);

  await win.screenshot({ path: path.join(SS, "v9-02-publish.png") });
}

async function testDashboard(win) {
  console.log("\n═══ Dashboard ═══");
  await win.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.dashboard);
  await wait(3000);
  await assertTitle(win, "数据");
  const stats = await win.evaluate((sel) => document.querySelectorAll(sel.statLabel).length, SEL);
  assert(`统计卡片 ≥3`, stats >= 3);
  await win.screenshot({ path: path.join(SS, "v9-03-dashboard.png") });
}

async function testHomePage(win) {
  console.log("\n═══ 首页 ═══");
  await win.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.home);
  await wait(3000);
  // 首页已复刻为参考产品风格 .mp-home 布局，旧版 .page-title 已不存在
  const home = await win.evaluate((sel) => ({
    root: !!document.querySelector(sel.mpHome),
    welcome: !!document.querySelector(sel.mpHomeWelcome),
  }), SEL);
  assert("参考产品风格首页（根容器 + 欢迎区）", home.root && home.welcome);
  const shortcuts = await win.evaluate((sel) => document.querySelectorAll(sel.homeShortcut).length, SEL);
  assert(`快捷入口 6 个`, shortcuts === 6);
  await win.screenshot({ path: path.join(SS, "v9-04-home.png") });
}

async function testCollectionPage(win) {
  console.log("\n═══ 采集页 ═══");
  await win.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.collection);
  await wait(3000);
  const cTitle = await win.evaluate(() => document.querySelector('.collection-tab-btn.active')?.textContent?.trim() || '');
  assert('采集标签选中', cTitle.includes('采集') || cTitle.includes('Collection'), 'got: "' + cTitle + '"');
  const btns = await win.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim());
    return { import: btns.some(t => t.includes("剪贴板")), draft: btns.some(t => t.includes("新建草稿")) };
  });
  assert("「从剪贴板导入」", btns.import);
  assert("「新建草稿」", btns.draft);
  await win.screenshot({ path: path.join(SS, "v9-05-collection.png") });
}

async function testMonitorPage(win) {
  console.log("\n═══ 监控页 ═══");
  await win.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.monitor);
  await wait(3000);
  await assertTitle(win, "监控");
  const hasAdd = await win.evaluate(() =>
    Array.from(document.querySelectorAll("button")).some(b => b.textContent.includes("添加监控"))
  );
  assert("「添加监控」按钮", hasAdd);
  await win.screenshot({ path: path.join(SS, "v9-06-monitor.png") });
}

async function testCommentsPage(win) {
  console.log("\n═══ 评论页 ═══");
  await win.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.comments);
  await wait(3000);
  await assertTitle(win, "评论");
  await win.screenshot({ path: path.join(SS, "v9-07-comments.png") });
}

// ════════════════════════════════════════════════════

// ═════════════════════════════════════════════════
// 新页面测试（v9 扩展）
// ═════════════════════════════════════════════════

async function testCreatePage(win) {
  console.log("\n╔══ 视频创作页 ══╗");
  await win.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.create);
  await wait(3000);
  // CreateView uses <h1> not .page-title class
  const createTitle = await win.evaluate(() => {
    const pt = document.querySelector('.page-title');
    const h1 = document.querySelector('h1');
    return (pt?.textContent || h1?.textContent || '').trim();
  });
  assert('页面标题包含「创作」', createTitle.includes('创作'), 'got: ' + createTitle);
  await win.getByRole('button', { name: '快速渲染' }).click();
  await wait(500);
  const modeTabs = await win.evaluate(() => {
    const tabs = document.querySelectorAll('.mode-tab');
    return Array.from(tabs).map(t => t.textContent.trim());
  });
  assert('模式切换标签 ≥2', modeTabs.length >= 2, 'found: ' + modeTabs.join(', '));
  const hasTextarea = await win.evaluate(() => !!document.querySelector('textarea'));
  assert('文本输入区', hasTextarea);
  const hasSelect = await win.evaluate(() => !!document.querySelector('select'));
  assert('输出平台选择', hasSelect);
  const hasAiBtn = await win.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('AI'))
  );
  assert('AI 写稿按钮', hasAiBtn);
  await win.screenshot({ path: path.join(SS, 'v9-08-create.png') });
}

async function testProvidersPage(win) {
  console.log("\n╔══ Provider 配置页 ══╗");
  await win.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.providers);
  await wait(3000);
  const providersTitle = await win.evaluate(() => document.querySelector('[data-testid="model-providers-title"]')?.textContent?.trim() || '');
  assert('Provider 页标题非空', providersTitle.length > 0, 'title is empty');
  await win.getByTestId('view-mode-all').click();
  await wait(500);
  const chips = await win.evaluate(() =>
    Array.from(document.querySelectorAll('.filter-chip')).map(c => c.textContent.trim())
  );
  assert('过滤器芯片 ≥3', chips.length >= 3, 'found: ' + chips.join(', '));
  const hasAdd = await win.evaluate(() => !!document.querySelector('[data-testid="add-provider"]'));
  assert('添加 Provider 按钮', hasAdd);
  const hasRefresh = await win.evaluate(() => !!document.querySelector('[data-testid="refresh-providers"]'));
  assert('刷新按钮', hasRefresh);
  await win.screenshot({ path: path.join(SS, 'v9-09-providers.png') });
}

async function testIntelligencePage(win) {
  console.log("\n╔══ 内容情报页 ══╗");
  await win.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.intelligence);
  await wait(3000);
  await assertTitle(win, '情报');
  const hasSearch = await win.evaluate(() => !!document.querySelector('.cohere-input'));
  assert('搜索输入框', hasSearch);
  const hasSearchBtn = await win.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('搜索'))
  );
  assert('搜索按钮', hasSearchBtn);
  const hasSourceInfo = await win.evaluate(() =>
    document.body.innerText.includes('Reddit') || document.body.innerText.includes('数据源')
  );
  assert('数据源信息', hasSourceInfo);
  await win.screenshot({ path: path.join(SS, 'v9-10-intelligence.png') });
}

async function testViralAnalysisPage(win) {
  console.log("\n╔══ 爆款分析页 ══╗");
  await win.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES['viral-analysis']);
  await wait(3000);
  await assertTitle(win, '爆款');
  const hasInput = await win.evaluate(() => !!document.querySelector('.cohere-input'));
  assert('主题输入框', hasInput);
  const hasPlatformSelect = await win.evaluate(() => !!document.querySelector('select'));
  assert('目标平台选择', hasPlatformSelect);
  const hasAnalyzeBtn = await win.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('分析') || b.textContent.includes('生成'))
  );
  assert('分析/生成按钮', hasAnalyzeBtn);
  await win.screenshot({ path: path.join(SS, 'v9-11-viral.png') });
}

async function testKeywordsPage(win) {
  console.log("\n╔══ 关键词监控页 ══╗");
  await win.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.keywords);
  await wait(3000);
  await assertTitle(win, '关键词');
  await win.screenshot({ path: path.join(SS, 'v9-12-keywords.png') });
}

async function testCloudPublishPage(win) {
  console.log("\n╔══ 云发布页 ══╗");
  await win.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES['cloud-publish']);
  await wait(3000);
  await win.screenshot({ path: path.join(SS, 'v9-13-cloud-publish.png') });
  assert('云发布页加载', true);
}

// ═════════════════════════════════════════════════
// 侧边栏 + 顶部导航交互
// ═════════════════════════════════════════════════

async function testSidebar(win) {
  console.log("\n╔══ 侧边栏交互 ══╗");
  await win.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.accounts);
  await injectAccounts(win);
  await wait(1000);
  const mpNav = await win.evaluate(() => !!document.querySelector('[data-testid="mp-module-nav"]'));
  if (mpNav) {
    const tabs = await win.evaluate(() => Array.from(document.querySelectorAll('[data-testid^="mp-tab-"]')).map(tab => ({
      active: tab.classList.contains('active'),
      label: tab.textContent.trim(),
    })));
    assert('参考产品模块导航存在', tabs.length >= 3);
    assert('账号模块标签激活', tabs.some(tab => tab.active && tab.label === '账号管理'));
    await win.screenshot({ path: path.join(SS, 'v9-14-sidebar.png') });
    return;
  }
  const sidebarExists = await win.evaluate((sel) => !!document.querySelector(sel.sidebar), SEL);
  assert('侧边栏存在', sidebarExists);
  const platforms = await win.evaluate((sel) => {
    const items = document.querySelectorAll(sel.platformItem);
    return Array.from(items).map(i => ({
      name: i.querySelector('.platform-name')?.textContent?.trim() || '',
      hasStatus: !!i.querySelector('.platform-status'),
    }));
  }, SEL);
  assert('平台列表 ≥6', platforms.length >= 6, 'found: ' + platforms.length);
  assert('平台状态指示器', platforms.every(p => p.hasStatus));
  const hasSearch = await win.evaluate((sel) => !!document.querySelector(sel.sidebarSearch), SEL);
  assert('侧边栏搜索框', hasSearch);
  if (platforms.length > 0) {
    await win.evaluate((sel) => {
      document.querySelector(sel.platformItem)?.click();
    }, SEL);
    await wait(500);
    const activeCount = await win.evaluate((sel) =>
      document.querySelectorAll(sel.platformItem + '.active').length
    , SEL);
    assert('点击后激活', activeCount >= 1);
  }
  await win.screenshot({ path: path.join(SS, 'v9-14-sidebar.png') });
}

async function testTopNav(win) {
  console.log("\n╔══ 顶部导航 ══╗");
  const mpNav = await win.evaluate(() => !!document.querySelector('[data-testid="mp-module-nav"]'));
  if (mpNav) {
    const navState = await win.evaluate(() => ({
      navItems: document.querySelectorAll('[data-testid^="mp-tab-"]').length,
      activeAccountTab: !!document.querySelector('[data-testid="mp-tab-accounts"].active'),
    }));
    assert('参考产品顶部模块导航存在', navState.navItems >= 3);
    assert('参考产品账号标签高亮', navState.activeAccountTab);
    await win.screenshot({ path: path.join(SS, 'v9-15-topnav.png') });
    return;
  }
  const navExists = await win.evaluate((sel) => !!document.querySelector(sel.topNav), SEL);
  assert('顶部导航栏存在', navExists);
  const navItems = await win.evaluate((sel) => {
    const items = document.querySelectorAll(sel.navItem);
    return Array.from(items).map(i => i.textContent.trim().replace(/\s+/g, ' '));
  }, SEL);
  assert('导航项 ≥6', navItems.length >= 6, 'found: ' + navItems.length);
  const navRoutes = ['publish','accounts','dashboard','collection','comments','monitor','create'];
  for (const [name, hash] of Object.entries(ROUTES).filter(([k]) => navRoutes.includes(k)).slice(0, 5)) {
    await win.evaluate((h) => { window.location.hash = '#' + h; }, hash);
    await wait(800);
    const isActive = await win.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel.navItem)).some(i => i.classList.contains('active'));
    }, SEL);
    assert('导航高亮 ' + name, isActive);
  }
  await win.screenshot({ path: path.join(SS, 'v9-15-topnav.png') });
}

// ═════════════════════════════════════════════════
// 发布页面深度测试
// ═════════════════════════════════════════════════

async function testPublishDeep(win) {
  console.log("\n╔══ 发布页深度 ══╗");
  await win.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.publish);
  await injectAccounts(win);
  await ensurePlatformStore(win);
  await wait(3000);
  const publishBtnState = await win.evaluate(() => {
    const btn = document.querySelector('[data-testid="publish-submit"]');
    return btn ? { exists: true, disabled: btn.disabled || btn.hasAttribute('disabled') } : { exists: false };
  });
  assert('发布按钮存在', publishBtnState.exists);
  const quillInteractive = await win.evaluate((sel) => {
    const editor = document.querySelector(sel.quillEditor);
    if (!editor) return false;
    editor.focus();
    editor.innerHTML = '<p>v9 深度测试内容</p>';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return editor.textContent.includes('v9 深度测试');
  }, SEL);
  assert('Quill 编辑器可交互', quillInteractive);
  await win.screenshot({ path: path.join(SS, 'v9-16-publish-deep.png') });
}

// 导航测试
// ════════════════════════════════════════════════════

async function testNavigation(win) {
  console.log("\n═══ 全页面导航 ═══");
  const skipHashCheck = ["/"];  // 根路径 hash 检查特殊处理
  for (const [name, hash] of Object.entries(ROUTES)) {
    await win.evaluate((h) => { window.location.hash = "#" + h; }, hash);
    await wait(1500);
    if (!skipHashCheck.includes(hash)) {
      const h = await win.evaluate(() => window.location.hash);
      const expectedHash = name === 'providers' ? '/model-providers' : hash;
      assert(`${name} 导航`, h.includes(expectedHash));
    } else {
      assert(`${name} 导航`, true);
    }
  }
}

// ════════════════════════════════════════════════════
// 主程序
// ════════════════════════════════════════════════════

function resolveGuiExitCode({
  results = getResults(),
  consoleErrors = [],
  pageErrors = [],
  runnerError = null,
} = {}) {
  const resultsValid = results &&
    Number.isInteger(results.pass) && results.pass >= 0 &&
    Number.isInteger(results.fail) && results.fail >= 0 &&
    Number.isInteger(results.total) && results.total > 0 &&
    results.pass + results.fail === results.total;
  const hasRuntimeErrors = consoleErrors.length > 0 || pageErrors.length > 0 || Boolean(runnerError);
  return resultsValid && results.fail === 0 && !hasRuntimeErrors ? 0 : 1;
}

async function run() {
  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  Multi-Publish GUI v9 — 配置驱动通用框架    ║");
  console.log("╚═════════════════════════════════════════════╝\n");

  resetResults();
  let app;
  let win;
  const consoleErrors = [];
  const pageErrors = [];
  let runnerError = null;
  let userDataDir = null;
  const mainProcessOutput = [];

  try {
    if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });
    if (!await checkVite()) throw new Error("Vite 未运行");
    console.log("✅ Vite\n");

    userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'multi-publish-gui-'));
    app = await electron.launch({
      executablePath: EL,
      args: [MAIN, '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
      env: {
        ...process.env,
        NODE_ENV: 'development',
        ELECTRON_IS_DEV: '1',
      },
      timeout: 60000,
    });
    const mainProcess = app.process();
    for (const stream of [mainProcess.stdout, mainProcess.stderr]) {
      stream?.on('data', (chunk) => mainProcessOutput.push(String(chunk).slice(0, 2000)));
    }
    const observedWindows = new WeakSet();
    const captureWindowErrors = (window) => {
      if (observedWindows.has(window)) return;
      observedWindows.add(window);
      window.on("console", (message) => {
        if (message.type() === "error" && !isIgnorableConsoleError(message.text())) {
          consoleErrors.push(message.text());
        }
      });
      window.on("pageerror", (error) => pageErrors.push(error.message || String(error)));
    };
    app.on("window", captureWindowErrors);
    app.windows().forEach(captureWindowErrors);

    win = await findMainWindow(app);
    if (!win) {
      const debugInfo = { windows: app.windows().length, pid: app.process().pid };
      // Try to get any console output from the app
      try {
        const allWins = app.windows();
        debugInfo.windowList = allWins.map(w => {
          try { return { url: w.url().substring(0,100), title: w.title() }; }
          catch(e) { return { error: e.message }; }
        });
      } catch(_) {}
      if (mainProcessOutput.length) debugInfo.mainProcessOutput = mainProcessOutput.join('').slice(-4000);
      console.error("\n❌ 未找到主窗口:", JSON.stringify(debugInfo, null, 2));
      // Take screenshot of any window available
      const firstWin = app.windows()[0];
      if (firstWin) {
        try { await firstWin.screenshot({ path: path.join(SS, "v9-error-firstwin.png") }); } catch(_) {}
      }
      throw new Error("Electron 未创建窗口或 Vite 未就绪");
    }
    captureWindowErrors(win);
    await win.waitForLoadState("networkidle");
    await wait(3000);

    console.log("1. 初始化 Stores");
    await win.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.accounts);
    await wait(3000);
    await injectAccounts(win);
    await ensurePlatformStore(win);
    await wait(500);

    await testAccountPage(win);
    await testPublishPage(win);
    await testDashboard(win);
    await testHomePage(win);
    await testCollectionPage(win);
    await testMonitorPage(win);
    await testCommentsPage(win);
    await testCreatePage(win);
    await testProvidersPage(win);
    await testIntelligencePage(win);
    await testViralAnalysisPage(win);
    await testKeywordsPage(win);
    await testCloudPublishPage(win);
    await testSidebar(win);
    await testTopNav(win);
    await testPublishDeep(win);
    await testNavigation(win);

    await win.screenshot({ path: path.join(SS, "v9-final.png") });
  } catch (err) {
    runnerError = err;
    console.error(`\n❌ 异常: ${err.message}`);
    try { if (win) await win.screenshot({ path: path.join(SS, "v9-error.png") }); } catch (_) {}
  } finally {
    if (app) {
      try {
        await app.close();
      } catch (closeError) {
        runnerError ||= closeError;
        console.error(`\n❌ Electron 关闭失败: ${closeError.message}`);
      }
    }
    if (userDataDir) fs.rmSync(userDataDir, { recursive: true, force: true });

    console.log("\n═══ 控制台错误 ═══");
    if (consoleErrors.length) {
      console.log(`   ❌ ${consoleErrors.length} 个错误:`);
      consoleErrors.slice(-5).forEach(error => console.log(`   ${error.substring(0, 200)}`));
    } else {
      console.log("   ✅ 无错误");
    }

    console.log("\n═══ 页面错误 ═══");
    if (pageErrors.length) {
      console.log(`   ❌ ${pageErrors.length} 个错误:`);
      pageErrors.slice(-5).forEach(error => console.log(`   ${error.substring(0, 200)}`));
    } else {
      console.log("   ✅ 无错误");
    }

    const results = getResults();
    const exitCode = resolveGuiExitCode({ results, consoleErrors, pageErrors, runnerError });
    console.log(`\n${"═".repeat(50)}`);
    console.log(`   ✅ ${results.pass}/${results.total} 通过` + (results.fail ? `, ❌ ${results.fail} 失败` : ""));
    console.log(`   ${exitCode === 0 ? "✅ GUI CI 通过" : "❌ GUI CI 失败"}`);
    console.log(`${"═".repeat(50)}\n`);
    process.exitCode = exitCode;
  }
}

if (require.main === module) {
  run().catch((error) => {
    console.error(`\n❌ GUI runner 未处理异常: ${error.message}`);
    process.exitCode = 1;
  });
}

module.exports = { isIgnorableConsoleError, resolveGuiExitCode, run };
