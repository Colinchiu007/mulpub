/**
 * 只读诊断：应用账号库里的抖音账号与其 cookie 快照材料齐备情况
 * 只输出 cookie 名称/数量，绝不输出 value
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const DB = path.join(os.homedir(), "AppData", "Roaming", "@multi-publish", "desktop", "multi-publish.db");
const { DatabaseSync } = require("node:sqlite");

const db = new DatabaseSync(DB, { readOnly: true });

console.log("=== 表清单 ===");
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all();
console.log("  " + tables.map((t) => t.name).join(", "));

// 找可能存账号的表
const cand = tables.map((t) => t.name).filter((n) => /account|platform|auth/i.test(n));
console.log("\n=== 账号相关表 ===");
for (const t of cand) {
  try {
    const cols = db.prepare(`PRAGMA table_info(${t})`).all().map((c) => c.name);
    const cnt = db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get().n;
    console.log(`  ${t}  行数=${cnt}`);
    console.log(`    列: ${cols.join(", ")}`);
  } catch (e) {
    console.log(`  ${t}  读取失败: ${e.message}`);
  }
}

// 若有 accounts 表，列出 douyin 账号
const accTable = tables.map((t) => t.name).find((n) => n === "accounts" || n === "account");
if (accTable) {
  console.log(`\n=== ${accTable} 中的 douyin 账号 ===`);
  const cols = db.prepare(`PRAGMA table_info(${accTable})`).all().map((c) => c.name);
  const sel = cols.filter((c) => /id|platform|name|nick|status|updated|created/i.test(c)).join(", ");
  const rows = db.prepare(`SELECT ${sel} FROM ${accTable} WHERE platform LIKE '%douyin%'`).all();
  if (rows.length === 0) console.log("  (无 douyin 账号)");
  for (const r of rows) console.log("  " + JSON.stringify(r));

  // 看该账号的 cookie 快照里有哪些 cookie 名
  if (cols.includes("cookies")) {
    console.log(`\n=== douyin 账号 cookie 快照材料检查 ===`);
    const REQUIRED = ["security-sdk/s_sdk_crypt_sdk", "security-sdk/s_sdk_sign_data_key/web_protect",
      "bd_ticket_guard_client_data", "bd_ticket_guard_client_data_v2", "sid_tt"];
    const full = db.prepare(
      `SELECT id, ${cols.includes("nickname") ? "nickname" : "id AS nickname"}, cookies FROM ${accTable} WHERE platform LIKE '%douyin%'`
    ).all();
    for (const r of full) {
      let arr = [];
      try { arr = JSON.parse(r.cookies || "[]"); } catch (e) { /* ignore */ }
      const names = arr.map((c) => c && c.name).filter(Boolean);
      console.log(`\n  [account ${r.id}]  cookie 数=${names.length}`);
      for (const req of REQUIRED) {
        console.log(`    ${names.includes(req) ? "✅ 有" : "❌ 缺"}  ${req}`);
      }
    }
  } else {
    console.log("  (该表无 cookies 列 → 账号快照可能存在别处)");
  }
}

db.close();
