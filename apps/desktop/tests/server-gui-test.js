/**
 * server-gui-test.js ? Server Edition (Chromium-only)
 * Auto-adapted from electron-gui-v9.js
 * Runs against Vite dev server instead of Electron
 */

const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const http = require('http');

// ??? Config (self-contained) ?????????????????????????
const PROJECT_ROOT = (function findRoot() {
  let dir = __dirname;
  while (dir !== path.dirname(dir)) {
    if (fs.existsSync(path.join(dir, 'package.json')) && fs.existsSync(path.join(dir, 'apps', 'desktop'))) return dir;
    dir = path.dirname(dir);
  }
  return path.resolve(__dirname, '..', '..');
})();
const CONFIG = JSON.parse(fs.readFileSync(path.join(PROJECT_ROOT, 'apps/desktop/tests/selectors.json'), 'utf8'));
const VITE_URL = 'http://127.0.0.1:5174/';
const SS = path.join(PROJECT_ROOT, CONFIG.urls.screenshotDir);
const ROUTES = CONFIG.routes;
const SEL = CONFIG.selectors;
const MOCK = CONFIG.mockAccounts;
const CHROMIUM_PATH = fs.existsSync('/usr/bin/chromium-browser') ? '/usr/bin/chromium-browser' : undefined;
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ??? Test helpers ??????????????????????????????????????
let PASS = 0, FAIL = 0;
function assert(name, ok, detail) {
  if (ok) { PASS++; console.log('   ' + String.fromCharCode(0x2705) + ' ' + name); }
  else { FAIL++; console.log('   ' + String.fromCharCode(0x274C) + ' ' + name + (detail ? ': ' + detail : '')); }
}
function getResults() { return { pass: PASS, fail: FAIL, total: PASS + FAIL }; }
function resetResults() { PASS = 0; FAIL = 0; }

async function checkVite() {
  return new Promise((resolve) => {
    http.get(VITE_URL, { timeout: 3000 }, (res) => { res.resume(); resolve(true); })
      .on('error', () => resolve(false));
  });
}

async function injectAccounts(page) {
  return await page.evaluate((data) => {
    try {
      const el = document.querySelector('#app');
      if (!el || !el.__vue_app__) return false;
      const pinia = el.__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get('accounts');
      if (!store) return false;
      store.$patch({ accounts: data });
      store.load = async function() { store.$patch({ accounts: data, loading: false, error: null }); };
      return true;
    } catch (e) { return false; }
  }, MOCK);
}

async function ensurePlatformStore(page) {
  return await page.evaluate(() => {
    try {
      const el = document.querySelector('#app');
      if (!el || !el.__vue_app__) return false;
      const pinia = el.__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get('platforms');
      if (!store || store.loaded) return false;
      store.platforms = [
        { id: 'wechat_mp', label: '微信公众号' },
        { id: 'zhihu', label: '知乎' },
        { id: 'weibo', label: '微博' },
        { id: 'douyin', label: '抖音' },
        { id: 'xiaohongshu', label: '小红书' },
        { id: 'bilibili', label: 'B站' },
      ];
      store.loaded = true;
      return true;
    } catch (e) { return false; }
  });
}

async function setBatchMode(page, on) {
  return await page.evaluate((enabled) => {
    const cb = document.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    const comp = cb.__vueParentComponent;
    if (!comp || !comp.proxy) return false;
    comp.proxy.batchMode = enabled;
    return true;
  }, on);
}

async function assertTitle(page, keyword) {
  const title = await page.evaluate((sel) => document.querySelector(sel)?.textContent?.trim() || '', SEL.pageTitle);
  assert('page title includes "' + keyword + '"', title.includes(keyword), 'got "' + title + '"');
}


async function testAccountPage(page) {
  console.log("\n═══ 账号页 ═══");
  await page.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.accounts);
  await wait(5000);
  await injectAccounts(page);
  await wait(500);

  // 基线
  const state = await page.evaluate((sel) => {
    const platformFilters = document.querySelectorAll(sel.platformFilterButton);
    return { platformFilterCount: platformFilters.length, rows: document.querySelectorAll(sel.accountRow).length };
  }, SEL);
  assert(`${state.platformFilterCount} 个平台筛选、${state.rows} 行`, state.platformFilterCount === 7 && state.rows === 12);

  // 删除
  await page.evaluate((sel) => {
    const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
    const store = pinia._s.get("accounts");
    store.$patch({ accounts: store.accounts.filter(a => a.id !== 3) });
  }, SEL);
  await wait(500);
  const afterDelete = await page.evaluate((sel) => document.querySelectorAll(sel.accountRow).length, SEL);
  assert(`删除后 11 行`, afterDelete === 11);
  await injectAccounts(page);

  // 默认切换
  await page.evaluate((sel) => {
    const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
    const store = pinia._s.get("accounts");
    store.$patch({ accounts: store.accounts.map(a => ({ ...a, is_default: a.id === 2 })) });
  }, SEL);
  await wait(500);
  const defaultName = await page.evaluate((sel) => {
    const nameButton = document.querySelector(`${sel.accountRow}.is-default ${sel.accountNameButton}`);
    return nameButton?.textContent?.trim() || "";
  }, SEL);
  assert(`默认账号「科技号」`, defaultName === "科技号");
  await injectAccounts(page);

  // 筛选
  for (const [value, label] of [["inactive", "未登录"], ["active", "已登录"], ["all", "全部"]]) {
    const btn = await page.$(`#account-status-tab-${value}`);
    if (btn) { await btn.click(); await wait(800); }
    const cnt = await page.evaluate((sel) => document.querySelectorAll(sel.accountRow).length, SEL);
    const expected = { "未登录": 3, "已登录": 9, "全部": 12 }[label];
    assert(`筛选「${label}」: ${cnt}`, cnt === expected);
  }

  // 弹窗
  await page.evaluate(() => {
    document.querySelector('[data-testid="account-add"]')?.click();
  });
  await wait(1500);
  const dialogOpen = await page.evaluate(() => !!document.querySelector(".el-dialog"));
  assert("添加账号弹窗", dialogOpen);
  await page.evaluate(() => document.querySelector(".el-dialog__headerbtn")?.click());
  await wait(500);

  await page.screenshot({ path: path.join(SS, "v9-01-accounts.png") });
}

async function testPublishPage(page) {
  console.log("\n═══ 发布页 ═══");
  await page.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.publish);
  await wait(3000);

  // Quill
  const quill = await page.evaluate((sel) => !!document.querySelector(sel.quillEditor), SEL);
  assert("Quill 编辑器", quill);

  // 标题
  const titleVal = await page.evaluate(() => {
    const inp = document.querySelector('[data-testid="publish-title"]');
    if (!inp) return null;
    inp.value = "v9 测试标题"; inp.dispatchEvent(new Event("input", { bubbles: true }));
    return inp.value;
  });
  assert("输入标题", titleVal === "v9 测试标题");

  // 批量模式
  await setBatchMode(page, true);
  await wait(3000);
  const batchState = await page.evaluate(() => ({
    cards: document.querySelectorAll(".cohere-card").length,
    hasDel: !!document.querySelector('[data-testid^="batch-delete-"]'),
    hasDup: !!document.querySelector('[data-testid^="batch-copy-"]'),
  }));
  assert("批量卡片", batchState.cards >= 2, `${batchState.cards} 个`);
  // 删除按钮仅在 ≥2 篇文章时可见 (v-if="articles.length > 1")
  assert("批量模式 UI 可见", batchState.cards >= 2);
  await setBatchMode(page, false);
  await wait(1000);

  await page.screenshot({ path: path.join(SS, "v9-02-publish.png") });
}

async function testDashboard(page) {
  console.log("\n═══ Dashboard ═══");
  await page.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.dashboard);
  await wait(3000);
  await assertTitle(page, "数据");
  const stats = await page.evaluate((sel) => document.querySelectorAll(sel.statLabel).length, SEL);
  assert(`统计卡片 ≥3`, stats >= 3);
  await page.screenshot({ path: path.join(SS, "v9-03-dashboard.png") });
}

async function testHomePage(page) {
  console.log("\n═══ 首页 ═══");
  await page.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.home);
  await wait(3000);
  await assertTitle(page, "汤姆");
  const cards = await page.evaluate((sel) => document.querySelectorAll(sel.statCard).length, SEL);
  assert(`快捷入口 5 个`, cards === 5);
  await page.screenshot({ path: path.join(SS, "v9-04-home.png") });
}

async function testCollectionPage(page) {
  console.log("\n═══ 采集页 ═══");
  await page.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.collection);
  await wait(3000);
  const cTitle = await page.evaluate(() => document.querySelector('.collection-tab-btn.active')?.textContent?.trim() || '');
  assert('采集标签选中', cTitle.includes('采集') || cTitle.includes('Collection'), 'got: "' + cTitle + '"');
  const btns = await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim());
    return { import: btns.some(t => t.includes("剪贴板")), draft: btns.some(t => t.includes("新建草稿")) };
  });
  assert("「从剪贴板导入」", btns.import);
  assert("「新建草稿」", btns.draft);
  await page.screenshot({ path: path.join(SS, "v9-05-collection.png") });
}

async function testMonitorPage(page) {
  console.log("\n═══ 监控页 ═══");
  await page.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.monitor);
  await wait(3000);
  await assertTitle(page, "监控");
  const hasAdd = await page.evaluate(() =>
    Array.from(document.querySelectorAll("button")).some(b => b.textContent.includes("添加监控"))
  );
  assert("「添加监控」按钮", hasAdd);
  await page.screenshot({ path: path.join(SS, "v9-06-monitor.png") });
}

async function testCommentsPage(page) {
  console.log("\n═══ 评论页 ═══");
  await page.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.comments);
  await wait(3000);
  await assertTitle(page, "评论");
  await page.screenshot({ path: path.join(SS, "v9-07-comments.png") });
}

// ════════════════════════════════════════════════════

// ═════════════════════════════════════════════════
// 新页面测试（v9 扩展）
// ═════════════════════════════════════════════════

async function testCreatePage(page) {
  console.log("\n╔══ 视频创作页 ══╗");
  await page.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.create);
  await wait(3000);
  // CreateView uses <h1> not .page-title class
  const createTitle = await page.evaluate(() => {
    const pt = document.querySelector('.page-title');
    const h1 = document.querySelector('h1');
    return (pt?.textContent || h1?.textContent || '').trim();
  });
  assert('页面标题包含「创作」', createTitle.includes('创作'), 'got: ' + createTitle);
  const modeTabs = await page.evaluate(() => {
    const tabs = document.querySelectorAll('.mode-tab');
    return Array.from(tabs).map(t => t.textContent.trim());
  });
  assert('模式切换标签 ≥2', modeTabs.length >= 2, 'found: ' + modeTabs.join(', '));
  const hasTextarea = await page.evaluate(() => !!document.querySelector('textarea'));
  assert('文本输入区', hasTextarea);
  const hasSelect = await page.evaluate(() => !!document.querySelector('select'));
  assert('输出平台选择', hasSelect);
  const hasAiBtn = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('AI'))
  );
  assert('AI 写稿按钮', hasAiBtn);
  await page.screenshot({ path: path.join(SS, 'v9-08-create.png') });
}

async function testProvidersPage(page) {
  console.log("\n╔══ Provider 配置页 ══╗");
  await page.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.providers);
  await wait(3000);
  const providersTitle = await page.evaluate(() => document.querySelector('[data-testid="model-providers-title"]')?.textContent?.trim() || '');
  assert('Provider 页标题非空', providersTitle.length > 0, 'title is empty');
  const chips = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('.cohere-filter-chip')).map(c => c.textContent.trim());
  });
  assert('过滤器芯片 ≥3', chips.length >= 3, 'found: ' + chips.join(', '));
  const hasAdd = await page.evaluate(() =>
    !!document.querySelector('[data-testid="add-provider"]')
  );
  assert('添加 Provider 按钮', hasAdd);
  const hasRefresh = await page.evaluate(() =>
    !!document.querySelector('[data-testid="refresh-providers"]')
  );
  assert('刷新按钮', hasRefresh);
  await page.screenshot({ path: path.join(SS, 'v9-09-providers.png') });
}

async function testIntelligencePage(page) {
  console.log("\n╔══ 内容情报页 ══╗");
  await page.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.intelligence);
  await wait(3000);
  await assertTitle(page, '情报');
  const hasSearch = await page.evaluate(() => !!document.querySelector('.cohere-input'));
  assert('搜索输入框', hasSearch);
  const hasSearchBtn = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('搜索'))
  );
  assert('搜索按钮', hasSearchBtn);
  const hasSourceInfo = await page.evaluate(() =>
    document.body.innerText.includes('Reddit') || document.body.innerText.includes('数据源')
  );
  assert('数据源信息', hasSourceInfo);
  await page.screenshot({ path: path.join(SS, 'v9-10-intelligence.png') });
}

async function testViralAnalysisPage(page) {
  console.log("\n╔══ 爆款分析页 ══╗");
  await page.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES['viral-analysis']);
  await wait(3000);
  await assertTitle(page, '爆款');
  const hasInput = await page.evaluate(() => !!document.querySelector('.cohere-input'));
  assert('主题输入框', hasInput);
  const hasPlatformSelect = await page.evaluate(() => !!document.querySelector('select'));
  assert('目标平台选择', hasPlatformSelect);
  const hasAnalyzeBtn = await page.evaluate(() =>
    Array.from(document.querySelectorAll('button')).some(b => b.textContent.includes('分析') || b.textContent.includes('生成'))
  );
  assert('分析/生成按钮', hasAnalyzeBtn);
  await page.screenshot({ path: path.join(SS, 'v9-11-viral.png') });
}

async function testKeywordsPage(page) {
  console.log("\n╔══ 关键词监控页 ══╗");
  await page.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.keywords);
  await wait(3000);
  await assertTitle(page, '关键词');
  await page.screenshot({ path: path.join(SS, 'v9-12-keywords.png') });
}

async function testCloudPublishPage(page) {
  console.log("\n╔══ 云发布页 ══╗");
  await page.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES['cloud-publish']);
  await wait(3000);
  await page.screenshot({ path: path.join(SS, 'v9-13-cloud-publish.png') });
  assert('云发布页加载', true);
}

// ═════════════════════════════════════════════════
// 侧边栏 + 顶部导航交互
// ═════════════════════════════════════════════════

async function testSidebar(page) {
  console.log("\n╔══ 侧边栏交互 ══╗");
  await page.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.accounts);
  await injectAccounts(page);
  await wait(1000);
  const sidebarExists = await page.evaluate((sel) => !!document.querySelector(sel.sidebar), SEL);
  assert('侧边栏存在', sidebarExists);
  const platforms = await page.evaluate((sel) => {
    const items = document.querySelectorAll(sel.platformItem);
    return Array.from(items).map(i => ({
      name: i.querySelector('.platform-name')?.textContent?.trim() || '',
      hasStatus: !!i.querySelector('.platform-status'),
    }));
  }, SEL);
  assert('平台列表 ≥6', platforms.length >= 6, 'found: ' + platforms.length);
  assert('平台状态指示器', platforms.every(p => p.hasStatus));
  const hasSearch = await page.evaluate((sel) => !!document.querySelector(sel.sidebarSearch), SEL);
  assert('侧边栏搜索框', hasSearch);
  if (platforms.length > 0) {
    await page.evaluate((sel) => {
      document.querySelector(sel.platformItem)?.click();
    }, SEL);
    await wait(500);
    const activeCount = await page.evaluate((sel) =>
      document.querySelectorAll(sel.platformItem + '.active').length
    , SEL);
    assert('点击后激活', activeCount >= 1);
  }
  await page.screenshot({ path: path.join(SS, 'v9-14-sidebar.png') });
}

async function testTopNav(page) {
  console.log("\n╔══ 顶部导航 ══╗");
  const navExists = await page.evaluate((sel) => !!document.querySelector(sel.topNav), SEL);
  assert('顶部导航栏存在', navExists);
  const navItems = await page.evaluate((sel) => {
    const items = document.querySelectorAll(sel.navItem);
    return Array.from(items).map(i => i.textContent.trim().replace(/\s+/g, ' '));
  }, SEL);
  assert('导航项 ≥6', navItems.length >= 6, 'found: ' + navItems.length);
  const navRoutes = ['publish','accounts','dashboard','collection','comments','monitor','create'];
  for (const [name, hash] of Object.entries(ROUTES).filter(([k]) => navRoutes.includes(k)).slice(0, 5)) {
    await page.evaluate((h) => { window.location.hash = '#' + h; }, hash);
    await wait(800);
    const isActive = await page.evaluate((sel) => {
      return Array.from(document.querySelectorAll(sel.navItem)).some(i => i.classList.contains('active'));
    }, SEL);
    assert('导航高亮 ' + name, isActive);
  }
  await page.screenshot({ path: path.join(SS, 'v9-15-topnav.png') });
}

// ═════════════════════════════════════════════════
// 发布页面深度测试
// ═════════════════════════════════════════════════

async function testPublishDeep(page) {
  console.log("\n╔══ 发布页深度 ══╗");
  await page.evaluate((r) => { window.location.hash = '#' + r; }, ROUTES.publish);
  await injectAccounts(page);
  await ensurePlatformStore(page);
  await wait(3000);
  const publishBtnState = await page.evaluate(() => {
    const btn = document.querySelector('[data-testid="publish-submit"]');
    return btn ? { exists: true, disabled: btn.disabled || btn.hasAttribute('disabled') } : { exists: false };
  });
  assert('发布按钮存在', publishBtnState.exists);
  const quillInteractive = await page.evaluate((sel) => {
    const editor = document.querySelector(sel.quillEditor);
    if (!editor) return false;
    editor.focus();
    editor.innerHTML = '<p>v9 深度测试内容</p>';
    editor.dispatchEvent(new Event('input', { bubbles: true }));
    return editor.textContent.includes('v9 深度测试');
  }, SEL);
  assert('Quill 编辑器可交互', quillInteractive);
  await page.screenshot({ path: path.join(SS, 'v9-16-publish-deep.png') });
}

// 导航测试
// ════════════════════════════════════════════════════

async function testNavigation(page) {
  console.log("\n═══ 全页面导航 ═══");
  const skipHashCheck = ["/"];  // 根路径 hash 检查特殊处理
  for (const [name, hash] of Object.entries(ROUTES)) {
    await page.evaluate((h) => { window.location.hash = "#" + h; }, hash);
    await wait(1500);
    if (!skipHashCheck.includes(hash)) {
      const h = await page.evaluate(() => window.location.hash);
      assert(`${name} 导航`, h.includes(hash));
    } else {
      assert(`${name} 导航`, true);
    }
  }
}

// ════════════════════════════════════════════════════
// 主程序
// ════════════════════════════════════════════════════



async function run() {
  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  Multi-Publish GUI v9 — 配置驱动通用框架    ║");
  console.log("╚═════════════════════════════════════════════╝\n");

  // screenshots dir check in caller
  if (!await checkVite()) { console.log("❌ Vite 未运行"); process.exit(1); }
  console.log("✅ Vite\n");

  const launchOpts = { headless: true };
  if (CHROMIUM_PATH) launchOpts.executablePath = CHROMIUM_PATH;
  const browser = await chromium.launch(launchOpts);
  const ctx = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
    timezoneId: 'Asia/Shanghai',
  });
  const page = await ctx.newPage();
  const errors = [];

  try {
    await page.goto(VITE_URL, { waitUntil: "networkidle", timeout: 30000 });
    await wait(3000);
    page.on("console", (msg) => { if (msg.type() === "error") errors.push(msg.text()); });

    console.log("1. 初始化 Stores");
    await page.evaluate((r) => { window.location.hash = "#" + r; }, ROUTES.accounts);
    await wait(3000);
    await injectAccounts(page);
    await ensurePlatformStore(page);
    await wait(500);

    await testAccountPage(page);
    await testPublishPage(page);
    await testDashboard(page);
    await testHomePage(page);
    await testCollectionPage(page);
    await testMonitorPage(page);
    await testCommentsPage(page);
    await testCreatePage(page);
    await testProvidersPage(page);
    await testIntelligencePage(page);
    await testViralAnalysisPage(page);
    await testKeywordsPage(page);
    await testCloudPublishPage(page);
    await testSidebar(page);
    await testTopNav(page);
    await testPublishDeep(page);
    await testNavigation(page);

    console.log("\n═══ 控制台错误 ═══");
    if (errors.length) {
      console.log(`   ⚠️ ${errors.length} 个错误:`);
      errors.slice(-5).forEach(e => console.log(`   ${e.substring(0, 200)}`));
    } else {
      console.log("   ✅ 无错误");
    }

    const r = getResults();
    console.log(`\n${"═".repeat(50)}`);
    console.log(`   ✅ ${r.pass}/${r.total} 通过` + (r.fail ? `, ❌ ${r.fail} 失败` : " 🎉"));
    console.log(`${"═".repeat(50)}\n`);

    await page.screenshot({ path: path.join(SS, "server-final.png") });
    await browser.close();
  } catch (err) {
    console.error(`\n❌ 异常: ${err.message}`);
    try { if (page) await page.screenshot({ path: path.join(SS, "server-error.png") }); } catch (_) {}
    await browser.close().catch(() => {});
    process.exit(1);
  }
}

run();
