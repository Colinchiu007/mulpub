/**
 * 抖音链活体裁决 —— 前置材料自检（只读诊断）
 *
 * 目的：在花掉一次真实发布之前，确认目标账号的会话里确实带着
 *       douyin-video.js Step 0 要求的四类签名材料。
 *       缺任何一个，Step 0 就会 fail-closed 抛「账号信息缺失，请重新授权此账号再试」——
 *       白跑一次活体。
 *
 * 安全约束（硬性）：
 *   - 只读：以 readonly 打开 SQLite，且先复制到临时目录避免锁冲突
 *   - 只输出 cookie 的「名称 / 域 / 过期时间 / 是否存在」，**绝不输出 value**
 *   - 不修改应用任何数据，不写回分区
 *
 * 用法：
 *   node diag-douyin-signing-materials.cjs [userDataDir]
 */
const fs = require("node:fs");
const path = require("node:path");
const os = require("node:os");

const USER_DATA = process.argv[2] ||
  path.join(os.homedir(), "AppData", "Roaming", "@multi-publish", "desktop");

// douyin-video.js Step 0 要求的四类材料
const REQUIRED = [
  { key: "security-sdk/s_sdk_crypt_sdk", why: "EC 私钥（ec_privateKey）→ clientSign 必需" },
  { key: "security-sdk/s_sdk_sign_data_key/web_protect", why: "ticket + ts_sign → 待签串必需" },
  { key: "bd_ticket_guard_client_data", why: "ree 公钥（明文版，优先）" },
  { key: "bd_ticket_guard_client_data_v2", why: "ree 公钥（v2 版，回落）" },
  { key: "sid_tt", why: "抖音登录票据 → 判定登录态" },
];

function loadSqlite() {
  // 优先 Node 22 内置 node:sqlite（无需任何依赖）
  try {
    const m = require("node:sqlite");
    if (m && typeof m.DatabaseSync === "function") {
      // 适配成 better-sqlite3 风格的极小子集
      return class {
        constructor(file) { this._db = new m.DatabaseSync(file, { readOnly: true }); }
        prepare(sql) { const st = this._db.prepare(sql); return { all: () => st.all() }; }
        close() { this._db.close(); }
      };
    }
  } catch (e) { /* fallthrough */ }
  for (const c of ["D:/Data/projects/mulpub/node_modules/better-sqlite3", "better-sqlite3"]) {
    try { return require(c); } catch (e) { /* next */ }
  }
  return null;
}

function main() {
  console.log("=".repeat(72));
  console.log("抖音链活体裁决 —— 前置材料自检（只读）");
  console.log("=".repeat(72));
  console.log("userData:", USER_DATA);
  console.log("");

  const partDir = path.join(USER_DATA, "Partitions");
  if (!fs.existsSync(partDir)) {
    console.log("[中止] 找不到 Partitions 目录");
    process.exitCode = 2;
    return;
  }

  // 找所有 douyin 分区
  const douyin = fs.readdirSync(partDir)
    .filter((n) => /douyin/i.test(n))
    .map((n) => {
      const cookieFile = path.join(partDir, n, "Network", "Cookies");
      return { name: n, cookieFile, exists: fs.existsSync(cookieFile) };
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  console.log(`发现 ${douyin.length} 个 douyin 分区\n`);
  if (douyin.length === 0) {
    console.log("[中止] 没有任何 douyin 分区 → 需要先在应用里登录一个抖音账号");
    process.exitCode = 3;
    return;
  }

  const Database = loadSqlite();
  if (!Database) {
    console.log("[中止] 找不到 better-sqlite3（只读诊断需要它）");
    process.exitCode = 4;
    return;
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "rea-cookie-diag-"));
  const rows = [];

  for (const p of douyin) {
    if (!p.exists) {
      rows.push({ part: p.name, ok: false, reason: "无 Network/Cookies" });
      continue;
    }
    // 复制到临时目录再以 readonly 打开（避免锁 + 绝不触碰原文件）
    const tmp = path.join(tmpDir, p.name + ".Cookies");
    try {
      fs.copyFileSync(p.cookieFile, tmp);
    } catch (e) {
      rows.push({ part: p.name, ok: false, reason: "复制失败: " + e.message });
      continue;
    }

    let found = [];
    let allNames = 0;
    try {
      const db = new Database(tmp);
      // expires_utc 是 1601 起算的微秒，可能超出 Number.MAX_SAFE_INTEGER
      // → CAST 成 TEXT 读取，避免 node:sqlite 的 BigInt 溢出报错
      const all = db.prepare(
        "SELECT name, host_key, CAST(expires_utc AS TEXT) AS expires_utc FROM cookies"
      ).all();
      allNames = all.length;
      for (const r of all) {
        for (const req of REQUIRED) {
          if (r.name === req.key) found.push({ ...req, host: r.host_key, exp: r.expires_utc });
        }
      }
      db.close();
    } catch (e) {
      rows.push({ part: p.name, ok: false, reason: "读取失败: " + e.message });
      continue;
    }

    // Chromium expires_utc：1601-01-01 起的微秒
    const CHROME_EPOCH_OFFSET = 11644473600; // 秒
    const fmtExp = (v) => {
      if (!v) return "会话级(session)";
      const unix = Number(v) / 1e6 - CHROME_EPOCH_OFFSET;
      const d = new Date(unix * 1000);
      if (isNaN(d.getTime())) return "?";
      const days = Math.round((d.getTime() - Date.now()) / 86400000);
      return `${d.toISOString().slice(0, 10)} (${days >= 0 ? "剩 " + days + " 天" : "已过期 " + -days + " 天"})`;
    };

    const stat = fs.statSync(p.cookieFile);
    rows.push({
      part: p.name,
      ok: true,
      mtime: stat.mtime.toISOString().slice(0, 10),
      cookieCount: allNames,
      found,
      fmtExp,
      missing: REQUIRED.filter((r) => !found.some((f) => f.key === r.key)),
    });
  }

  // ═══ 报告 ═══
  console.log("-".repeat(72));
  console.log("各分区材料齐备情况");
  console.log("-".repeat(72));
  for (const r of rows) {
    if (!r.ok) { console.log(`\n[${r.part}]  ${r.reason}`); continue; }
    const hasRee = r.found.some((f) => f.key === "bd_ticket_guard_client_data" || f.key === "bd_ticket_guard_client_data_v2");
    const hasCrypt = r.found.some((f) => f.key === "security-sdk/s_sdk_crypt_sdk");
    const hasSign = r.found.some((f) => f.key === "security-sdk/s_sdk_sign_data_key/web_protect");
    const hasSid = r.found.some((f) => f.key === "sid_tt");
    const verdict = (hasCrypt && hasSign && hasRee && hasSid) ? "✅ Step 0 可通过" : "❌ Step 0 会 fail-closed";
    console.log(`\n[${r.part}]`);
    console.log(`  cookie 总数: ${r.cookieCount}   分区最后写入: ${r.mtime}`);
    console.log(`  ${verdict}`);
    console.log(`    crypt_sdk (EC 私钥) : ${hasCrypt ? "✅ 有" : "❌ 缺"}`);
    console.log(`    web_protect(ticket) : ${hasSign ? "✅ 有" : "❌ 缺"}`);
    console.log(`    ree 公钥(plain/v2)  : ${hasRee ? "✅ 有" : "❌ 缺"}`);
    console.log(`    sid_tt (登录票据)   : ${hasSid ? "✅ 有" : "❌ 缺"}`);
    if (r.missing.length) {
      console.log(`    ⚠️ 缺失项: ${r.missing.map((m) => m.key).join(", ")}`);
    }
  }

  // ═══ 汇总 ═══
  const ready = rows.filter((r) => r.ok &&
    r.found.some((f) => f.key === "security-sdk/s_sdk_crypt_sdk") &&
    r.found.some((f) => f.key === "security-sdk/s_sdk_sign_data_key/web_protect") &&
    r.found.some((f) => f.key === "bd_ticket_guard_client_data" || f.key === "bd_ticket_guard_client_data_v2") &&
    r.found.some((f) => f.key === "sid_tt"));

  console.log("\n" + "=".repeat(72));
  console.log("结论");
  console.log("=".repeat(72));
  if (ready.length === 0) {
    console.log("❌ 没有任何 douyin 分区四类材料齐备。");
    console.log("");
    console.log("下一步：在应用里重新登录一个抖音账号（走一次正常登录流程），");
    console.log("       登录后 security-sdk 会注入密钥材料，再重跑本脚本。");
    process.exitCode = 10;
  } else {
    console.log(`✅ ${ready.length} 个分区材料齐备，可进入活体裁决：`);
    for (const r of ready) console.log(`   - ${r.part}  (最后写入 ${r.mtime})`);
    console.log("");
    console.log("⚠️ 注意：材料齐备 ≠ 会话有效。登录态可能已过期，");
    console.log("   活体时应先做一次「前台回查」确认账号仍登录。");
    process.exitCode = 0;
  }

  // 清理临时副本
  try {
    for (const f of fs.readdirSync(tmpDir)) fs.unlinkSync(path.join(tmpDir, f));
    fs.rmdirSync(tmpDir);
  } catch (e) { /* 忽略 */ }
}

main();
