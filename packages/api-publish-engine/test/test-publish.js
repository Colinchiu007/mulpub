// API Publish Engine — 端到端集成测试
// 打开 Playwright 浏览器让用户扫码登录，然后通过 API 发布草稿
// 使用: node test/test-publish.js [platform]

const { chromium } = require("playwright");
const { publishViaApi, supportsApi } = require("../src/index");

// 29 平台完整登录 URL 映射（来自参考产品 4.0 分析）
const LOGIN_URLS = {
  zhihu: "https://www.zhihu.com/signin",
  douyin: "https://creator.douyin.com/",
  xiaohongshu: "https://creator.xiaohongshu.com/login",
  tencent_video: "https://channels.weixin.qq.com/login.html",
  kuaishou: "https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api",
  baijiahao: "https://baijiahao.baidu.com/",
  bilibili: "https://member.bilibili.com/platform/home",
  weibo: "https://weibo.com/login.php",
  toutiao: "https://mp.toutiao.com/profile_v4/",
  wechat_mp: "https://mp.weixin.qq.com/",
  aiqiyi: "https://mp.iqiyi.com/",
  dayu: "https://mp.dayu.com/",
  qiehao: "https://om.qq.com/",
  souhu: "https://mp.sohu.com/",
  wangyi: "https://mp.163.com/",
  tengxun_shipin: "https://mp.v.qq.com/",
  weishi: "https://media.weishi.qq.com/",
  yidianhao: "https://mp.yidianzixun.com/",
  souhu_shipin: "https://tv.sohu.com/",
  pipixia: "https://pipix.com/mp/upload",
  meipai: "https://www.meipai.com/",
  acfun: "https://member.acfun.cn/",
  dewu: "https://creator.dewu.com/",
  chejiahao: "https://creator.autohome.com.cn/",
  yichehao: "https://baa.yiche.com/",
  meiyou: "https://mp.meiyou.com/",
  xhs_shangjia: "https://ark.xiaohongshu.com/",
  xigua: "https://ixigua.com/",
  duoduo: "https://live.pinduoduo.com/",
};

// CLI options
if (process.argv[2] === "--list") {
  console.log("Supported platforms (" + Object.keys(LOGIN_URLS).length + "):");
  Object.keys(LOGIN_URLS).sort().forEach(function(p) { console.log("  " + p + " (API: " + supportsApi(p) + ")"); });
  process.exit(0);
}
if (process.argv[2] === "--dry-run") {
  console.log("=== API Publish Engine — Dry Run ===\n");
  Object.keys(LOGIN_URLS).sort().forEach(function(p) { console.log("  [" + (supportsApi(p) ? "API" : "RPA") + "] " + p + " -> " + LOGIN_URLS[p].substring(0, 50)); });
  console.log("\nAll " + Object.keys(LOGIN_URLS).length + " platforms ready for testing.");
  process.exit(0);
}


const platform = process.argv[2] || "zhihu";
if (!LOGIN_URLS[platform]) {
  console.error("Unknown platform: " + platform);
  console.error("Supported: " + Object.keys(LOGIN_URLS).join(", "));
  process.exit(1);
}



console.log("=== API Publish Engine — E2E Test ===");
console.log("Platform: " + platform);
console.log("API supported: " + supportsApi(platform));
console.log("Login URL: " + LOGIN_URLS[platform]);
console.log("Browser opens for login. Scan QR code if needed.");
console.log("After login, a draft will be published via API.\n");

(async () => {
  const browser = await chromium.launch({ headless: false });
  const ctx = await browser.newContext({ locale: "zh-CN" });
  const page = await ctx.newPage();

  await page.goto(LOGIN_URLS[platform], { waitUntil: "domcontentloaded", timeout: 30000 }).catch(function(e) {});
  console.log("Waiting up to 120s for login...");
  var loggedIn = false;
  for (var i = 0; i < 40; i++) {
    await page.waitForTimeout(3000);
    var cur = page.url() || "";
    var skipPatterns = ["signin", "login", "passport", "oauth"];
    var isLoginPage = skipPatterns.some(function(p) { return cur.includes(p); });
    if (!isLoginPage && i > 2) { loggedIn = true; console.log("  Login detected: " + cur.substring(0, 80)); break; }
    if (i % 5 === 4) console.log("  [" + ((i + 1) * 3) + "s] waiting... " + cur.substring(0, 60));
  }

  if (!loggedIn) { console.log("  Continuing anyway with current cookies..."); }

  var cookies = await ctx.cookies();
  var cookieStr = cookies.map(function(c) { return c.name + "=" + c.value; }).join("; ");
  console.log("Cookies captured: " + cookies.length + " items");

  var article = {
    title: "API测试 " + new Date().toISOString().slice(0, 19).replace("T", " "),
    content: "<p>Multi-Publish API 引擎自动发布测试</p>",
    tags: ["测试"],
    draft: true,
  };

  console.log("\n--- Publishing via API ---");
  console.log("Title: " + article.title);

  try {
    var result = await publishViaApi(platform, article, cookieStr, {
      onProgress: function(pct, msg) { console.log("  [" + pct + "%] " + msg); }
    });
    console.log("\nResult: " + JSON.stringify(result, null, 2));
  } catch (e) {
    console.log("\nAPI publish failed: " + e.message);
    console.log("(RPA fallback would activate at this point)");
  }

  console.log("\nBrowser stays open 15s for inspection...");
  await page.waitForTimeout(15000);
  await browser.close();
})().catch(function(e) { console.error("Error:", e.message); process.exit(1); });
