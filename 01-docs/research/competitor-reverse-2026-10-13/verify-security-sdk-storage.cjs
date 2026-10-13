/**
 * 决定性验证：抖音 security-sdk 的材料到底在 cookie 还是 localStorage？
 *
 * 背景：参考产品 DouYinAuthorizeConfig 用 localStorage.getItem('security-sdk/s_sdk_crypt_sdk')
 *       但真实 cookie 库里是 __security_mc_1_s_sdk_crypt_sdk
 *       → 必须确认这两个名字分别出现在哪个存储里
 *
 * 只读：把 leveldb 文件按字节读入，用 latin1 解出可打印串做子串搜索。
 *       绝不输出任何 value（只输出「键是否出现」与出现位置附近的键名）。
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const ROOTS = [
  ["本项目", path.join(os.homedir(), "AppData", "Roaming", "@multi-publish", "desktop", "Partitions")],
  ["参考产品", path.join(os.homedir(), "AppData", "Roaming", "参考产品4.0", "Partitions")],
];

// 要搜的可疑键名族
const NEEDLES = [
  "security-sdk/s_sdk_crypt_sdk",
  "security-sdk/s_sdk_sign_data_key",
  "__security_mc_1_s_sdk_crypt_sdk",
  "__security_mc_1_s_sdk_sign_data_key_web_protect",
  "s_sdk_crypt_sdk",
  "s_sdk_sign_data_key",
  "bd_ticket_guard_client_data",
];

function scanDir(dir) {
  const out = { leveldbFiles: 0, hits: new Map() };
  if (!fs.existsSync(dir)) return out;
  for (const f of fs.readdirSync(dir)) {
    const fp = path.join(dir, f);
    let st;
    try { st = fs.statSync(fp); } catch (e) { continue; }
    if (!st.isFile()) continue;
    out.leveldbFiles++;
    let buf;
    try { buf = fs.readFileSync(fp); } catch (e) { continue; }
    const txt = buf.toString("latin1");
    for (const n of NEEDLES) {
      if (txt.includes(n)) {
        const c = out.hits.get(n) || { count: 0, files: new Set() };
        // 计数（可能有多次）
        let idx = 0, cnt = 0;
        while ((idx = txt.indexOf(n, idx)) !== -1) { cnt++; idx += n.length; }
        c.count += cnt;
        c.files.add(f);
        out.hits.set(n, c);
      }
    }
  }
  return out;
}

console.log("=".repeat(76));
console.log("决定性验证：security-sdk 材料在 cookie 还是 localStorage？");
console.log("=".repeat(76));

for (const [label, root] of ROOTS) {
  console.log(`\n${"█".repeat(3)} ${label}  (${root})`);
  if (!fs.existsSync(root)) { console.log("   (目录不存在)"); continue; }
  const parts = fs.readdirSync(root).filter((p) => /douyin|^auth-\d/.test(p));
  for (const p of parts) {
    const lsDir = path.join(root, p, "Local Storage", "leveldb");
    const r = scanDir(lsDir);
    if (r.leveldbFiles === 0) continue;
    console.log(`\n  [${p}]  leveldb 文件 ${r.leveldbFiles} 个`);
    if (r.hits.size === 0) {
      console.log("     ❌ 未命中任何 security-sdk 键");
    } else {
      for (const [n, c] of r.hits) {
        console.log(`     ✅ "${n}"  ×${c.count}  文件: ${[...c.files].join(", ")}`);
      }
    }
  }
}

// 也扫一下 session 级 Local Storage
console.log("\n" + "=".repeat(76));
console.log("补充：应用级 Local Storage（非分区）");
console.log("=".repeat(76));
for (const [label, root] of ROOTS) {
  const lsDir = path.join(root, "..", "Local Storage", "leveldb");
  const r = scanDir(lsDir);
  console.log(`  ${label}: leveldb ${r.leveldbFiles} 个, 命中 ${r.hits.size} 种`);
  for (const [n, c] of r.hits) console.log(`     ✅ "${n}" ×${c.count}`);
}
