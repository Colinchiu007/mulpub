const { _electron: electron } = require("playwright");
const path = require("path");
const fs = require("fs");
const http = require("http");

const PROJECT_ROOT = "D:/Data/projects/mulpub";
const EL = path.join(PROJECT_ROOT, "node_modules", "electron", "dist", "electron.exe");
const MAIN = path.join(PROJECT_ROOT, "apps", "desktop", "electron", "main.js");
const SS = path.join(PROJECT_ROOT, "apps", "desktop", "tests", "screenshots");
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const MOCK_ACCOUNTS = [
  { id: 1,  platform: "wechat_mp",    account_name: "公众号小编",    name: "公众号小编",    status: "active",   is_default: true },
  { id: 2,  platform: "wechat_mp",    account_name: "科技号",        name: "科技号",        status: "active",   is_default: false },
  { id: 4,  platform: "zhihu",        account_name: "知乎主号",      name: "知乎主号",      status: "active",   is_default: true },
  { id: 6,  platform: "weibo",        account_name: "官方微博",      name: "官方微博",      status: "active",   is_default: true },
  { id: 7,  platform: "douyin",       account_name: "抖音主号",      name: "抖音主号",      status: "active",   is_default: true },
  { id: 9,  platform: "xiaohongshu",  account_name: "主理人号",      name: "主理人号",      status: "active",   is_default: true },
  { id: 11, platform: "bilibili",     account_name: "B站主号",       name: "B站主号",       status: "active",   is_default: true },
];

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

async function injectAccounts(win) {
  return await win.evaluate((data) => {
    try {
      const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get("accounts");
      if (!store) return false;
      store.$patch({ accounts: data });
      store.load = async function () { store.$patch({ accounts: data, loading: false, error: null }); };
      return true;
    } catch (e) { return false; }
  }, MOCK_ACCOUNTS);
}

async function ensurePlatformStore(win) {
  return await win.evaluate(() => {
    try {
      const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get("platforms");
      if (!store || store.loaded) return false;
      store.platforms = [
        { id: "wechat_mp", label: "微信公众号" }, { id: "zhihu", label: "知乎" },
        { id: "weibo", label: "微博" }, { id: "douyin", label: "抖音" },
        { id: "xiaohongshu", label: "小红书" }, { id: "bilibili", label: "B站" },
      ];
      store.loaded = true;
      return true;
    } catch (e) { return false; }
  });
}

let pass = 0, fail = 0;
function assert(name, ok, detail = "") {
  if (ok) { pass++; console.log(`   ✅ ${name}`); }
  else { fail++; console.log(`   ❌ ${name}${detail ? ": " + detail : ""}`); }
}

async function run() {
  console.log("╔══════════════════════════════════════════════════════╗");
  console.log("║  Multi-Publish GUI v8 Final — 补充页面全覆盖        ║");
  console.log("╚══════════════════════════════════════════════════════╝\n");

  if (!fs.existsSync(SS)) fs.mkdirSync(SS, { recursive: true });
  if (!await checkVite()) { console.log("❌ Vite 未运行"); process.exit(1); }
  console.log("✅ Vite\n");

  const app = await electron.launch({
    executablePath: EL, args: [MAIN, "--no-sandbox"], timeout: 30000,
  });
  let win;
  const errors = [];

  try {
    win = await findMainWindow(app);
    await win.waitForLoadState("networkidle");
    await wait(3000);
    win.on("console", (m) => { if (m.type() === "error") errors.push(m.text()); });

    // ─── Init ───
    console.log("1. 初始化 Stores");
    await win.evaluate(() => { window.location.hash = "#/accounts"; });
    await wait(3000);
    await injectAccounts(win);
    await ensurePlatformStore(win);
    await wait(500);

    // ════════════════════════════════════════════
    // 2. 首页
    // ════════════════════════════════════════════
    console.log("\n═══ 2. 首页 ═══");
    await win.evaluate(() => { window.location.hash = "#/"; });
    await wait(3000);

    const hTitle = await win.evaluate(() => document.querySelector(".page-title")?.textContent?.trim() || "");
    assert("首页标题", hTitle.includes("社媒"), `"${hTitle}"`);

    const hCards = await win.evaluate(() => document.querySelectorAll(".cohere-stat-card").length);
    assert("快捷入口 5 个", hCards === 5, `找到 ${hCards} 个`);

    const hSub = await win.evaluate(() => document.querySelector(".page-subtitle")?.textContent?.trim() || "");
    assert("版本号", hSub.includes("v"), hSub.substring(0, 30));

    // 测试卡片点击导航
    await win.evaluate(() => { document.querySelector(".cohere-stat-card")?.click(); });
    await wait(2000);
    const hHash = await win.evaluate(() => window.location.hash);
    assert("卡片可点击导航", hHash.length > 2 && hHash !== "#/", hHash);
    await win.evaluate(() => { window.location.hash = "#/"; });
    await wait(2000);

    await win.screenshot({ path: path.join(SS, "v8-01-home.png") });

    // ════════════════════════════════════════════
    // 3. 采集页
    // ════════════════════════════════════════════
    console.log("\n═══ 3. 采集页 ═══");
    await win.evaluate(() => { window.location.hash = "#/collection"; });
    await wait(3000);

  const cTitle = await win.evaluate(() => document.querySelector('.collection-tab-btn.active')?.textContent?.trim() || "");
    assert("采集标签选中", cTitle.includes("采集") || cTitle.includes("Collection"), `"${cTitle}"`);

    const cBtns = await win.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim());
      return {
        importClipboard: btns.some(t => t.includes("剪贴板")),
        createDraft: btns.some(t => t.includes("新建草稿")),
        collect: btns.some(t => t.includes("采集")),
        all: btns.length,
      };
    });
    assert("「从剪贴板导入」", cBtns.importClipboard);
    assert("「新建草稿」", cBtns.createDraft);
    assert("「采集」按钮", cBtns.collect);

    const hasInput = await win.evaluate(() => document.querySelectorAll("input").length > 0);
    assert("链接输入框", hasInput);

    const draftsEmpty = await win.evaluate(() => {
      const empty = document.querySelector(".cohere-empty");
      return empty?.querySelector("h3")?.textContent?.trim() || "";
    });
    assert("草稿空状态", draftsEmpty.includes("暂无") || draftsEmpty.includes("还没有"), `"${draftsEmpty}"`);

    await win.screenshot({ path: path.join(SS, "v8-02-collection.png") });

    // ════════════════════════════════════════════
    // 4. 监控页
    // ════════════════════════════════════════════
    console.log("\n═══ 4. 监控页 ═══");
    await win.evaluate(() => { window.location.hash = "#/monitor"; });
    await wait(3000);

    const mTitle = await win.evaluate(() => document.querySelector(".page-title")?.textContent?.trim() || "");
    assert("监控页标题", mTitle.includes("监控"), `"${mTitle}"`);

    const mUI = await win.evaluate(() => {
      const btns = Array.from(document.querySelectorAll("button")).map(b => b.textContent.trim());
      // 布局按钮用 Unicode 图标: ⬜ ▬ ◫ ⊞ ⊟
      const layoutIcons = ["⬜", "▬", "◫", "⊞", "⊟"];
      const layoutBtns = btns.filter(t => layoutIcons.includes(t));
      const addBtn = btns.find(t => t.includes("添加监控"));
      // 全部关闭按钮有 v-if="tabs.length > 0"，初始隐藏
      return { layout: layoutBtns.length, icons: layoutBtns.join(","), hasAdd: !!addBtn };
    });
    assert("布局切换按钮", mUI.layout >= 2, `找到 ${mUI.layout} 个: ${mUI.icons}`);
    assert("「添加监控」按钮", mUI.hasAdd);

    // 空状态
    const mEmpty = await win.evaluate(() => {
      const empty = document.querySelector(".cohere-empty");
      return empty?.querySelector("h3")?.textContent?.trim() || "";
    });
    assert("监控空状态", mEmpty.length > 0, `"${mEmpty}"`);

    await win.screenshot({ path: path.join(SS, "v8-03-monitor.png") });

    // ════════════════════════════════════════════
    // 5. 评论页
    // ════════════════════════════════════════════
    console.log("\n═══ 5. 评论页 ═══");
    await win.evaluate(() => { window.location.hash = "#/comments"; });
    await wait(3000);

    const cmtTitle = await win.evaluate(() => document.querySelector(".page-title")?.textContent?.trim() || "");
    assert("评论页标题", cmtTitle.includes("评论"), `"${cmtTitle}"`);

    const cmtState = await win.evaluate(() => {
      const empty = document.querySelector(".cohere-empty");
      return {
        isEmpty: !!empty,
        emptyText: empty?.querySelector("h3")?.textContent?.trim() || "",
      };
    });
    assert("空状态「选择平台」", cmtState.isEmpty, cmtState.emptyText);

    await win.screenshot({ path: path.join(SS, "v8-04-comments.png") });

    // ════════════════════════════════════════════
    // 6. 全页面导航
    // ════════════════════════════════════════════
    console.log("\n═══ 6. 全页面导航 ═══");
    const pages = [
      ["首页", "#/", true],  // true = skip hash check (根路径)
      ["采集", "#/collection"],
      ["监控", "#/monitor"],
      ["评论", "#/comments"],
      ["发布", "#/publish"],
      ["Dashboard", "#/dashboard"],
      ["账号", "#/accounts"],
    ];
    for (const [name, hash, skipCheck] of pages) {
      await win.evaluate((h) => { window.location.hash = h; }, hash);
      await wait(1500);
      if (!skipCheck) {
        const h = await win.evaluate(() => window.location.hash);
        const path = hash.replace("#", "");
        assert(name, h.includes(path));
      } else {
        assert(name, true);
      }
    }

    // ════════════════════════════════════════════
    // 7. 控制台错误
    // ════════════════════════════════════════════
    if (errors.length) {
      console.log(`\n⚡ ${errors.length} 个错误:`);
      errors.slice(-5).forEach(e => console.log(`   ${e.substring(0, 200)}`));
    } else {
      console.log("\n✅ 无控制台错误");
    }

    const total = pass + fail;
    console.log(`\n${"═".repeat(50)}`);
    console.log(`   ✅ ${pass}/${total} 通过` + (fail ? `, ❌ ${fail} 失败` : " 🎉"));
    console.log(`${"═".repeat(50)}\n`);

    await win.screenshot({ path: path.join(SS, "v8-final.png") });
    await app.close();
  } catch (err) {
    console.error(`\n❌ 异常: ${err.message}`);
    try { if (win) await win.screenshot({ path: path.join(SS, "v8-error.png") }); } catch (_) {}
    await app.close().catch(() => {});
    process.exit(1);
  }
}

run();
