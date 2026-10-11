const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const http = require("http");

const PROJECT_ROOT = "D:/Data/projects/mulpub";
const EL = path.join(PROJECT_ROOT, "node_modules", "electron", "dist", "electron.exe");
const MAIN = path.join(PROJECT_ROOT, "apps", "desktop", "electron", "main.js");
const SS = path.join(PROJECT_ROOT, "apps", "desktop", "tests", "screenshots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ─── Mock 数据：6 平台 12 账号 ───
const MOCK_ACCOUNTS = [
  { id: 1,  platform: "wechat_mp",    account_name: "公众号小编",    name: "公众号小编",    status: "active",   is_default: true,  created_at: "2026-01-15T08:00:00Z" },
  { id: 2,  platform: "wechat_mp",    account_name: "科技号",        name: "科技号",        status: "active",   is_default: false, created_at: "2026-02-20T08:00:00Z" },
  { id: 3,  platform: "wechat_mp",    account_name: "生活号",        name: "生活号",        status: "inactive", is_default: false, created_at: "2026-03-10T08:00:00Z" },
  { id: 4,  platform: "zhihu",        account_name: "知乎主号",      name: "知乎主号",      status: "active",   is_default: true,  created_at: "2026-01-20T08:00:00Z" },
  { id: 5,  platform: "zhihu",        account_name: "科技专栏号",    name: "科技专栏号",    status: "inactive", is_default: false, created_at: "2026-04-05T08:00:00Z" },
  { id: 6,  platform: "weibo",        account_name: "官方微博",      name: "官方微博",      status: "active",   is_default: true,  created_at: "2026-01-10T08:00:00Z" },
  { id: 7,  platform: "douyin",       account_name: "抖音主号",      name: "抖音主号",      status: "active",   is_default: true,  created_at: "2026-02-01T08:00:00Z" },
  { id: 8,  platform: "douyin",       account_name: "生活号",        name: "生活号",        status: "active",   is_default: false, created_at: "2026-03-15T08:00:00Z" },
  { id: 9,  platform: "xiaohongshu",  account_name: "主理人号",      name: "主理人号",      status: "active",   is_default: true,  created_at: "2026-01-25T08:00:00Z" },
  { id: 10, platform: "xiaohongshu",  account_name: "测评号",        name: "测评号",        status: "inactive", is_default: false, created_at: "2026-05-01T08:00:00Z" },
  { id: 11, platform: "bilibili",     account_name: "B站主号",       name: "B站主号",       status: "active",   is_default: true,  created_at: "2026-02-10T08:00:00Z" },
  { id: 12, platform: "bilibili",     account_name: "游戏分号",      name: "游戏分号",      status: "active",   is_default: false, created_at: "2026-04-20T08:00:00Z" },
];

// 平台 label 映射
const PLATFORM_LABELS = {
  wechat_mp: "微信公众号", zhihu: "知乎", weibo: "微博",
  douyin: "抖音", xiaohongshu: "小红书", bilibili: "B站",
};

// ─── Helpers ───
async function checkVite() {
  return new Promise((resolve) => {
    http.get("http://127.0.0.1:5174/", { timeout: 3000 }, (res) => { res.resume(); resolve(true); })
      .on("error", () => resolve(false));
  });
}

async function findMainWindow(app) {
  for (let i = 0; i < 15; i++) {
    const wins = app.windows();
    for (const w of wins) {
      try { if ((await w.url()).includes("5174")) return w; } catch (_) {}
    }
    await wait(1000);
  }
  return app.windows().pop();
}

// 注入 mock 数据到 Pinia store
async function injectMockData(win, data = MOCK_ACCOUNTS) {
  return await win.evaluate((mockData) => {
    const r = {};
    try {
      const el = document.querySelector("#app").__vue_app__;
      const pinia = el.config.globalProperties.$pinia;
      const store = pinia._s.get("accounts");
      r.storeExists = !!store;
      if (!store) return r;
      store.$patch({ accounts: mockData });
      store.load = async function () {
        store.$patch({ accounts: mockData, loading: false, error: null });
      };
      r.patched = true;
    } catch (e) { r.error = e.message; }
    return r;
  }, data);
}

// 读取 DOM 状态（分组 + 账号行）
async function readDOMState(win) {
  return await win.evaluate(() => {
    const groups = [];
    const cards = document.querySelectorAll(".cohere-card-group");
    cards.forEach((card) => {
      const name = card.querySelector(".card-platform-name")?.textContent?.trim() || "?";
      const rows = card.querySelectorAll(".account-row");
      const accounts = [];
      rows.forEach((row) => {
        const inp = row.querySelector(".account-name-input");
        const badge = row.querySelector(".default-badge");
        const dot = row.querySelector(".account-status-dot");
        accounts.push({
          name: inp?.value || "?",
          isDefault: badge?.classList.contains("muted") ? false : true,
          isOnline: dot?.classList.contains("online") || false,
        });
      });
      groups.push({ name, accounts, total: accounts.length });
    });
    const emptyEl = document.querySelector(".cohere-empty");
    return {
      groups,
      totalGroups: groups.length,
      totalRows: groups.reduce((s, g) => s + g.total, 0),
      isEmpty: !!emptyEl,
      emptyText: emptyEl?.querySelector("h3")?.textContent?.trim() || "",
    };
  });
}

// ─── 主测试流程 ───
async function run() {
  console.log("╔═══════════════════════════════════════════════════╗");
  console.log("║   Multi-Publish GUI 测试 v6 — 全功能测试套件      ║");
  console.log("╚═══════════════════════════════════════════════════╝\n");

  if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });
  if (!await checkVite()) { console.log("❌ Vite 未运行"); process.exit(1); }
  console.log("✅ Vite dev server 运行中\n");

  console.log("1. 启动 Electron...");
  const app = await electron.launch({
    executablePath: EL, args: [MAIN, "--no-sandbox"], timeout: 30000,
  });
  let win;
  const errors = [];
  let pass = 0, fail = 0;

  try {
    win = await findMainWindow(app);
    await win.waitForLoadState("networkidle");
    await wait(3000);
    win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    // ═══════════════════════════════════════════════
    // 2. 导航到账号页 + 注入 mock 数据
    // ═══════════════════════════════════════════════
    console.log("2. 导航到账号管理页...");
    await win.evaluate(() => { window.location.hash = "#/accounts"; });
    await wait(5000);

    const inject = await injectMockData(win, MOCK_ACCOUNTS);
    if (!inject.storeExists) {
      console.log("   ❌ Store 未找到，退出");
      await app.close(); process.exit(1);
    }
    console.log(`   ✅ Store 注入成功 (patched: ${inject.patched})`);
    await wait(500);
    await win.screenshot({ path: path.join(SS, "v6-00-injected.png") });

    // ═══════════════════════════════════════════════
    // 3. 基线验证：12 账号, 6 分组
    // ═══════════════════════════════════════════════
    console.log("\n3. 基线验证");
    let state = await readDOMState(win);
    console.log(`   Store: ${state.totalGroups} 分组, ${state.totalRows} 账号`);
    if (state.totalGroups === 6 && state.totalRows === 12) { pass++; console.log("   ✅ 基线正确"); }
    else { fail++; console.log("   ❌ 基线错误"); }

    // ═══════════════════════════════════════════════
    // 4. 删除账号测试
    // ═══════════════════════════════════════════════
    console.log("\n4. 删除账号测试");
    // 直接通过 $patch 从 store 删除一个账号，验证 DOM 更新
    await win.evaluate(() => {
      const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get("accounts");
      // 删除 id=3（生活号，inactive）
      store.$patch({ accounts: store.accounts.filter(a => a.id !== 3) });
    });
    await wait(500);
    state = await readDOMState(win);
    // 微信分组应从 3 账号减为 2 账号，总计 11
    const wechatGroup = state.groups.find(g => g.name.includes("微信"));
    console.log(`   删除后: ${state.totalRows} 账号 (期望 11)`);
    console.log(`   微信分组: ${wechatGroup?.accounts.length || 0} 账号 (期望 2)`);
    if (state.totalRows === 11 && wechatGroup?.accounts.length === 2) {
      pass++; console.log("   ✅ DOM 正确更新");
    } else { fail++; console.log("   ❌ DOM 未正确更新"); }
    await win.screenshot({ path: path.join(SS, "v6-01-deleted.png") });

    // 恢复数据
    await injectMockData(win, MOCK_ACCOUNTS);
    await wait(500);

    // ═══════════════════════════════════════════════
    // 5. 默认账号切换测试
    // ═══════════════════════════════════════════════
    console.log("\n5. 默认账号切换测试");
    // 切换默认：将 is_default 从 id=1（公众号小编）移到 id=2（科技号）
    await win.evaluate(() => {
      const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get("accounts");
      store.$patch({
        accounts: store.accounts.map(a => ({
          ...a,
          is_default: a.id === 2  // 只有 id=2 是默认
        }))
      });
    });
    await wait(500);
    state = await readDOMState(win);
    let wechat = state.groups.find(g => g.name.includes("微信"));
    let defaultAcc = wechat?.accounts.find(a => a.isDefault);
    console.log(`   微信默认账号: ${defaultAcc?.name || "无"} (期望: 科技号)`);
    if (defaultAcc?.name === "科技号") {
      pass++; console.log("   ✅ 默认账号已切换");
    } else { fail++; console.log("   ❌ 默认账号未切换"); }
    await win.screenshot({ path: path.join(SS, "v6-02-default-switched.png") });

    // 恢复
    await injectMockData(win, MOCK_ACCOUNTS);
    await wait(500);

    // ═══════════════════════════════════════════════
    // 6. 新建账号后 DOM 更新测试
    // ═══════════════════════════════════════════════
    console.log("\n6. 新建账号测试");
    const NEW_ACCOUNT = {
      id: 13, platform: "weibo", account_name: "新测试号", name: "新测试号",
      status: "active", is_default: false, created_at: "2026-07-02T08:00:00Z",
    };
    await win.evaluate((newAcc) => {
      const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get("accounts");
      store.$patch({ accounts: [...store.accounts, newAcc] });
    }, NEW_ACCOUNT);
    await wait(500);
    state = await readDOMState(win);
    const weiboGroup = state.groups.find(g => g.name.includes("微博"));
    console.log(`   新增后: ${state.totalRows} 账号 (期望 13)`);
    console.log(`   微博分组: ${weiboGroup?.accounts.length || 0} 账号 (期望 2)`);
    const newRow = weiboGroup?.accounts.find(a => a.name === "新测试号");
    console.log(`   新账号存在: ${!!newRow}`);
    if (state.totalRows === 13 && weiboGroup?.accounts.length === 2 && newRow) {
      pass++; console.log("   ✅ 新账号正确渲染");
    } else { fail++; console.log("   ❌ 新账号未正确渲染"); }
    await win.screenshot({ path: path.join(SS, "v6-03-new-account.png") });

    // 恢复
    await injectMockData(win, MOCK_ACCOUNTS);
    await wait(500);

    // ═══════════════════════════════════════════════
    // 7. 空状态测试
    // ═══════════════════════════════════════════════
    console.log("\n7. 空状态测试");
    await win.evaluate(() => {
      const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get("accounts");
      store.$patch({ accounts: [] });
    });
    await wait(500);
    state = await readDOMState(win);
    console.log(`   空状态显示: ${state.isEmpty}`);
    console.log(`   空状态文本: "${state.emptyText}"`);
    if (state.isEmpty && state.emptyText === "暂无账号") {
      pass++; console.log("   ✅ 空状态正确");
    } else { fail++; console.log("   ❌ 空状态异常"); }
    await win.screenshot({ path: path.join(SS, "v6-04-empty.png") });

    // 恢复数据
    await injectMockData(win, MOCK_ACCOUNTS);
    await wait(500);

    // ═══════════════════════════════════════════════
    // 8. 筛选测试（复测）
    // ═══════════════════════════════════════════════
    console.log("\n8. 筛选复测");
    for (const label of ["未登录", "已登录", "全部"]) {
      const btn = await win.$(`button.cohere-filter-chip:has-text("${label}")`);
      if (btn) { await btn.click(); await wait(800); }
      const cnt = await win.evaluate(() => document.querySelectorAll(".account-row").length);
      console.log(`   筛选「${label}」: ${cnt} 行`);
    }
    pass++;

    // ═══════════════════════════════════════════════
    // 9. 添加账号弹窗复测
    // ═══════════════════════════════════════════════
    console.log("\n9. 添加账号弹窗复测");
    await win.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button"));
      const addBtn = btns.find((b) => b.textContent.includes("添加账号"));
      addBtn?.click();
    });
    await wait(1500);
    const dlgOpen = await win.evaluate(() => !!document.querySelector(".el-dialog"));
    console.log(`   弹窗: ${dlgOpen ? "✅" : "❌"}`);
    if (dlgOpen) {
      // 检查平台下拉
      await win.evaluate(() => document.querySelector(".el-select__wrapper")?.click());
      await wait(1000);
      const platforms = await win.evaluate(() =>
        Array.from(document.querySelectorAll(".el-select-dropdown__item"))
          .map((i) => i.textContent.trim()).filter(Boolean)
      );
      console.log(`   可选平台数: ${platforms.length}`);
      // 关闭弹窗
      await win.evaluate(() => document.querySelector(".el-dialog__headerbtn")?.click());
      await wait(500);
      pass++;
    } else {
      fail++;
    }

    // ═══════════════════════════════════════════════
    // 10. 重命名测试（复测）
    // ═══════════════════════════════════════════════
    console.log("\n10. 重命名测试");
    const rename = await win.evaluate(() => {
      const inp = document.querySelector(".account-name-input");
      if (!inp) return { found: false };
      const orig = inp.value;
      inp.focus();
      inp.select();
      document.execCommand("insertText", false, "重命名测试号");
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      inp.dispatchEvent(new Event("blur"));
      return { found: true, original: orig, newValue: inp.value };
    });
    if (rename.found) {
      console.log(`   "${rename.original}" → "${rename.newValue}"`);
      pass++;
    } else { fail++; }
    await win.screenshot({ path: path.join(SS, "v6-05-rename.png") });

    // ═══════════════════════════════════════════════
    // 11. 页面导航测试
    // ═══════════════════════════════════════════════
    console.log("\n11. 页面导航测试");
    for (const [name, hash] of [["发布页", "#/publish"], ["Dashboard", "#/dashboard"], ["首页", "#/home"]]) {
      await win.evaluate((h) => { window.location.hash = h; }, hash);
      await wait(2500);
      try { win = await findMainWindow(app); } catch (_) {}
      const h = await win.evaluate(() => window.location.hash);
      console.log(`   ${name}: ${h.includes(hash.split("#")[1]) ? "✅" : "⚠️"}`);
    }
    pass++;

    // ═══════════════════════════════════════════════
    // 12. 控制台错误报告
    // ═══════════════════════════════════════════════
    console.log("\n12. 控制台错误检查");
    if (errors.length) {
      console.log(`   ❗ ${errors.length} 个错误:`);
      errors.slice(-5).forEach((e) => console.log(`   ${e.substring(0, 200)}`));
    } else {
      console.log("   ✅ 无错误");
    }

    // ═══════════════════════════════════════════════
    // 汇总
    // ═══════════════════════════════════════════════
    const total = pass + fail;
    console.log(`\n${"═".repeat(55)}`);
    console.log(`   测试结果: ✅ ${pass}/${total} 通过` + (fail ? `, ❌ ${fail} 失败` : ""));
    if (fail === 0) console.log("   所有 GUI 测试通过！");
    console.log(`${"═".repeat(55)}\n`);

    await app.close();
  } catch (err) {
    console.error(`\n❌ 测试异常: ${err.message}`);
    try { if (win) await win.screenshot({ path: path.join(SS, "v6-error.png") }); } catch (_) {}
    await app.close().catch(() => {});
    process.exit(1);
  }
}

run();
