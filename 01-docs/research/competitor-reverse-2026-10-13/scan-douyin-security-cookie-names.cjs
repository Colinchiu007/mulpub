/**
 * 全盘扫描：所有 Electron 应用分区里，抖音 security-sdk 相关 cookie 的真实命名
 * 只读，只输出 cookie 名/域/有效期，绝不输出 value
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");
const { DatabaseSync } = require("node:sqlite");

const ROOTS = [
  path.join(os.homedir(), "AppData", "Roaming", "@multi-publish", "desktop", "Partitions"),
  path.join(os.homedir(), "AppData", "Roaming", "Electron", "Partitions"),
  path.join(os.homedir(), "AppData", "Roaming", "参考产品4.0", "Partitions"),
];

// 关注的名字族
const PREFIXES = [
  "security-sdk/s_sdk_crypt_sdk",
  "security-sdk/s_sdk_sign_data_key/web_protect",
  "__security_mc_1_",
  "bd_ticket_guard_client_data",
  "sid_tt",
];

const CH = 11644473600;
const fmt = (v) => {
  const n = Number(v);
  if (!n) return "会话级";
  const d = new Date((n / 1e6 - CH) * 1000);
  const days = Math.round((d.getTime() - Date.now()) / 86400000);
  return d.toISOString().slice(0, 10) + (days >= 0 ? ` 剩 ${days} 天` : ` 已过期 ${-days} 天`);
};

const hits = [];       // 命中 security-sdk 相关
const creatorHits = []; // creator.douyin.com 域
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "dy-scan-"));

for (const root of ROOTS) {
  if (!fs.existsSync(root)) continue;
  const app = path.basename(path.dirname(root));
  for (const part of fs.readdirSync(root)) {
    const cf = path.join(root, part, "Network", "Cookies");
    if (!fs.existsSync(cf)) continue;
    const tmp = path.join(tmpDir, `${app}-${part}-${Date.now()}.Cookies`);
    try { fs.copyFileSync(cf, tmp); } catch (e) { continue; }
    let rows = [];
    try {
      const db = new DatabaseSync(tmp, { readOnly: true });
      rows = db.prepare(
        "SELECT name, host_key, CAST(expires_utc AS TEXT) e FROM cookies"
      ).all();
      db.close();
    } catch (e) { try { fs.unlinkSync(tmp); } catch (_) {} continue; }
    try { fs.unlinkSync(tmp); } catch (_) {}

    for (const r of rows) {
      const n = String(r.name);
      if (PREFIXES.some((p) => n.includes(p.replace(/^__security_mc_1_$/, "__security_mc_1_")))) {
        hits.push({ app, part, name: n, host: r.host_key, exp: fmt(r.e) });
      }
      if (/creator\.douyin\.com/.test(String(r.host_key))) {
        creatorHits.push({ app, part, name: n, host: r.host_key, exp: fmt(r.e) });
      }
    }
  }
}

console.log("=".repeat(78));
console.log("扫描结果（只读，仅名称/域/有效期）");
console.log("=".repeat(78));

console.log(`\n【A】命中 security-sdk 名字族的分区：${hits.length} 条 cookie`);
const byPart = new Map();
for (const h of hits) {
  const k = `${h.app}/${h.part}`;
  if (!byPart.has(k)) byPart.set(k, []);
  byPart.get(k).push(h);
}
if (byPart.size === 0) console.log("  (无)");
for (const [k, arr] of byPart) {
  console.log(`\n  [${k}]`);
  for (const h of arr) console.log(`    ${h.name.padEnd(50)} ${String(h.host).padEnd(22)} ${h.exp}`);
}

// 命名族统计
const fam = new Map();
for (const h of hits) {
  const f = h.name.startsWith("__security_mc_1_") ? "__security_mc_1_*"
    : h.name.startsWith("security-sdk/") ? "security-sdk/*"
      : "其他";
  fam.set(f, (fam.get(f) || 0) + 1);
}
console.log("\n【B】命名族统计");
for (const [f, n] of [...fam.entries()].sort((a, b) => b[1] - a[1])) {
  console.log(`  ${f.padEnd(28)} ${n}`);
}

console.log(`\n【C】creator.douyin.com 域的 cookie：${creatorHits.length} 条`);
if (creatorHits.length === 0) {
  console.log("  (无 —— 没有任何分区访问过 creator.douyin.com 并留下 cookie)");
} else {
  const cp = new Map();
  for (const h of creatorHits) {
    const k = `${h.app}/${h.part}`;
    if (!cp.has(k)) cp.set(k, []);
    cp.get(k).push(h);
  }
  for (const [k, arr] of cp) {
    console.log(`\n  [${k}]  ${arr.length} 条`);
    for (const h of arr.slice(0, 25)) console.log(`    ${h.name.padEnd(50)} ${h.exp}`);
  }
}

try {
  for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
  fs.rmdirSync(tmpDir);
} catch (e) { /* ignore */ }
