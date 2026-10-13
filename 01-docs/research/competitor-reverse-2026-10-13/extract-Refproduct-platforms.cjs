/**
 * 参考产品 36 平台配置全量提取
 */
const fs = require("node:fs");

const MAIN = "D:\\Data\\projects\\rea\\analysis\\refproduct-asar\\packages\\main\\dist\\index.cjs";
const src = fs.readFileSync(MAIN, "utf8");
const OUT = "D:\\Data\\projects\\rea\\analysis\\refproduct-platforms.md";

// 压缩形态：class XxxAuthorizeConfig extends PlatformAuthorizeConfig{constructor(){super(...arguments);ht(this,"authorizeUrl","...");ht(this,"entryUrl","...")}}
const re = /class\s+(\w+AuthorizeConfig)\s+extends\s+PlatformAuthorizeConfig/g;
const out = [];
const w = (s) => out.push(s);

w("# 参考产品 36 平台配置全量");
w("");
w("> 来源：`packages/main/dist/index.cjs`（webpack bundle，已压缩）");
w("> 提取方式：定位每个 `class XxxAuthorizeConfig`，从其后 2500 字符内取 `authorizeUrl` / `entryUrl`");
w("");
w("---");
w("");
w("## 1. 平台配置表");
w("");
w("| # | 类名 | 平台名 | authorizeUrl（登录页）| entryUrl（登录后入口）|");
w("|---|---|---|---|---|");

const results = [];
let m;
while ((m = re.exec(src)) !== null) {
  const cls = m[1];
  const body = src.slice(m.index, m.index + 2500);
  const auth = (body.match(/ht\(this,"authorizeUrl","([^"]*)"/) || [])[1] || "—";
  const entry = (body.match(/ht\(this,"entryUrl","([^"]*)"/) || [])[1] || "—";
  const needCookie = /needHandleSessionCookie",!0/.test(body);
  // 是否有自定义 waitForLoginFinish
  const customWait = /waitForLoginFinish\s*\(/.test(body);
  results.push({ cls, auth, entry, needCookie, customWait });
}

results.sort((a, b) => a.cls.localeCompare(b.cls));
results.forEach((r, i) => {
  w(`| ${i + 1} | \`${r.cls}\` | ${r.cls.replace(/AuthorizeConfig$/, "")} | ${r.auth} | ${r.entry} |`);
});
w("");
w(`**共 ${results.length} 个平台。**`);
w("");
w("---");
w("");
w("## 2. 各平台是否有自定义登录判定");
w("");
w("| 平台 | 自定义 `waitForLoginFinish` | 需处理 session cookie |");
w("|---|---|---|");
for (const r of results) {
  w(`| ${r.cls.replace(/AuthorizeConfig$/, "")} | ${r.customWait ? "✅ 有" : "—"} | ${r.needCookie ? "✅ 是" : "—"} |`);
}
w("");
w("> 有自定义 `waitForLoginFinish` 的平台 = 该平台**不能**用通用 URL 判定登录，需要平台特定的探测逻辑。");
w("");

// 域名统计
w("---");
w("");
w("## 3. 平台域名分布");
w("");
const domains = new Map();
for (const r of results) {
  for (const u of [r.auth, r.entry]) {
    if (!u || u === "—") continue;
    try {
      const h = new URL(u).hostname;
      domains.set(h, (domains.get(h) || 0) + 1);
    } catch (e) { /* ignore */ }
  }
}
w("| 域名 | 出现次数 |");
w("|---|---:|");
for (const [d, n] of [...domains.entries()].sort((a, b) => b[1] - a[1])) {
  w(`| \`${d}\` | ${n} |`);
}
w("");

// 全部 URL 去重
w("---");
w("");
w("## 4. 全部 URL（去重）");
w("");
const allUrls = [...new Set(results.flatMap((r) => [r.auth, r.entry]).filter((u) => u && u !== "—"))].sort();
w(`共 **${allUrls.length}** 个唯一 URL：`);
w("");
w("```");
allUrls.forEach((u) => w(u));
w("```");
w("");

fs.writeFileSync(OUT, out.join("\n"), "utf8");
console.log("写入:", OUT, "行数:", out.length);
console.log("平台数:", results.length);
console.log("唯一 URL:", allUrls.length);
console.log("有自定义 waitForLoginFinish:", results.filter((r) => r.customWait).length);
