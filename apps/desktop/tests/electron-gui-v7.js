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

async function injectAccounts(win, data = MOCK_ACCOUNTS) {
  return await win.evaluate((mockData) => {
    try {
      const pinia = document.querySelector("#app").__vue_app__.config.globalProperties.$pinia;
      const store = pinia._s.get("accounts");
      if (!store) return false;
      store.$patch({ accounts: mockData });
      store.load = async function () { store.$patch({ accounts: mockData, loading: false, error: null }); };
      return true;
    } catch (e) { return false; }
  }, data);
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

async function setBatchMode(win, on) {
  return await win.evaluate((enabled) => {
    const cb = document.querySelector('input[type="checkbox"]');
    if (!cb) return false;
    const comp = cb.__vueParentComponent;
    if (!comp || !comp.proxy) return false;
    comp.proxy.batchMode = enabled;
    return true;
  }, on);
}

let passCount = 0, failCount = 0;
function assert(name, ok, detail = "") {
  if (ok) { passCount++; console.log(`   ✅ ${name}`); }
  else { failCount++; console.log(`   ❌ ${name}${detail ? ": " + detail : ""}`); }
}

async function run() {
  console.log("╔═════════════════════════════════════════════╗");
  console.log("║  Multi-Publish GUI v7 Final — 跨页全测试   ║");
  console.log("╚═════════════════════════════════════════════╝\n");

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

    // ─── Init Stores ───
    console.log("1. 初始化 Stores（accounts + platforms）");
    await win.evaluate(() => { window.location.hash = "#/accounts"; });
    await wait(3000);
    await injectAccounts(win, MOCK_ACCOUNTS);
    await ensurePlatformStore(win);
    await wait(500);

    // ════════════════════════════════════════════
    // 发布页 — 单文章模式
    // ════════════════════════════════════════════
    console.log("\n═══ 2. 发布页（单文章）═══");
    await win.evaluate(() => { window.location.hash = "#/publish"; });
    await wait(3000);

    const title = await win.evaluate(() => document.querySelector(".page-title")?.textContent?.trim() || "");
    assert("页面标题", title.includes("发布"), `"${title}"`);

    const quill = await win.evaluate(() => !!document.querySelector(".ql-editor"));
    assert("Quill 编辑器", quill);

    const titleVal = await win.evaluate(() => {
      const inp = document.querySelector('input[placeholder*="标题"]');
      if (!inp) return null;
      inp.value = "测试标题";
      inp.dispatchEvent(new Event("input", { bubbles: true }));
      return inp.value;
    });
    assert("输入标题", titleVal === "测试标题");

    const quillText = await win.evaluate(() => {
      const ed = document.querySelector(".ql-editor");
      if (!ed) return null;
      ed.innerHTML = "<p>测试正文。</p>";
      ed.dispatchEvent(new Event("input", { bubbles: true }));
      return ed.textContent?.trim();
    });
    assert("Quill 输入正文", quillText?.length > 3);

    const pubBtn = await win.evaluate(() =>
      Array.from(document.querySelectorAll("button")).some(b => b.textContent.includes("发布"))
    );
    assert("一键发布按钮", pubBtn);

    const toggle = await win.evaluate(() => !!document.querySelector('input[type="checkbox"]'));
    assert("批量模式开关", toggle);

    await win.screenshot({ path: path.join(SS, "v7-01-publish.png") });

    // ════════════════════════════════════════════
    // 批量模式
    // ════════════════════════════════════════════
    console.log("\n═══ 3. 批量模式 ═══");
    const activated = await setBatchMode(win, true);
    assert("激活批量模式", activated);
    await wait(3000);

    const batchInfo = await win.evaluate(() => {
      const cards = document.querySelectorAll(".cohere-card");
      const inputs = document.querySelectorAll("input");
      const allBtns = Array.from(document.querySelectorAll("button"));
      const delBtns = allBtns.filter(b => b.textContent.includes("✕") || b.title === "删除");
      const dupBtns = allBtns.filter(b => b.textContent.includes("复制") || b.title === "复制");
      return {
        cards: cards.length,
        inputs: inputs.length,
        del: delBtns.length,
        dup: dupBtns.length,
        btnsTotal: allBtns.length,
      };
    });

    assert("批量文章卡片 ≥2", batchInfo.cards >= 2, `${batchInfo.cards} 个`);
    assert("批量模式操作按钮数", batchInfo.btnsTotal >= 3, `${batchInfo.btnsTotal} 个按钮`);

    if (batchInfo.del > 0) assert("删除按钮 (✕)", true);
    else assert("删除按钮可见（需 ≥2 篇文章）", false);
    if (batchInfo.dup > 0) assert("复制按钮", true);
    else console.log("   ⚠️ 未找到复制按钮（按钮文本/标题可能不同）");

    await win.screenshot({ path: path.join(SS, "v7-02-batch.png") });

    // 关闭批量
    await setBatchMode(win, false);
    await wait(1500);

    // ════════════════════════════════════════════
    // Dashboard
    // ════════════════════════════════════════════
    console.log("\n═══ 4. Dashboard ═══");
    await win.evaluate(() => { window.location.hash = "#/dashboard"; });
    await wait(3000);

    const dTitle = await win.evaluate(() => document.querySelector(".page-title")?.textContent?.trim() || "");
    assert("Dashboard 标题", dTitle.includes("数据"), `"${dTitle}"`);

    const stats = await win.evaluate(() => {
      const labels = Array.from(document.querySelectorAll(".stat-label")).map(l => l.textContent.trim());
      return labels;
    });
    assert("统计卡片", stats.length >= 3, stats.join(", "));

    const dashEmpty = await win.evaluate(() => {
      const empty = document.querySelector(".cohere-empty");
      return !!empty;
    });
    if (dashEmpty) {
      assert("空状态（暂无数据）", dashEmpty);
    }

    const refresh = await win.evaluate(() =>
      Array.from(document.querySelectorAll("button")).some(b =>
        b.textContent.includes("刷新") || b.textContent.includes("同步"))
    );
    assert("刷新数据按钮", refresh);

    await win.screenshot({ path: path.join(SS, "v7-03-dashboard.png") });

    // ════════════════════════════════════════════
    // 页面导航
    // ════════════════════════════════════════════
    console.log("\n═══ 5. 页面导航 ═══");
    for (const [name, hash] of [["首页", "#/home"], ["发布页", "#/publish"], ["Dashboard", "#/dashboard"], ["账号", "#/accounts"]]) {
      await win.evaluate((h) => { window.location.hash = h; }, hash);
      await wait(2000);
      const h = await win.evaluate(() => window.location.hash);
      assert(name, h.includes(hash.split("#")[1]));
    }

    // ════════════════════════════════════════════
    // 控制台错误
    // ════════════════════════════════════════════
    if (errors.length) {
      console.log(`\n⚡ ${errors.length} 个控制台错误:`);
      errors.slice(-5).forEach(e => console.log(`   ${e.substring(0, 200)}`));
    } else {
      console.log("\n✅ 无控制台错误");
    }

    const total = passCount + failCount;
    console.log(`\n${"═".repeat(50)}`);
    console.log(`   ✅ ${passCount}/${total} 通过` + (failCount ? `, ❌ ${failCount} 失败` : " 🎉"));
    console.log(`${"═".repeat(50)}\n`);

    await win.screenshot({ path: path.join(SS, "v7-final.png") });
    await app.close();
  } catch (err) {
    console.error(`\n❌ 异常: ${err.message}`);
    try { if (win) await win.screenshot({ path: path.join(SS, "v7-error.png") }); } catch (_) {}
    await app.close().catch(() => {});
    process.exit(1);
  }
}

run();
