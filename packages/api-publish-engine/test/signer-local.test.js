const assert = require("assert");
// getKuaishouSign 已于 2026-10-21 拆除（32 位假签名，被真实服务端否证）
const { getCsdnSign, getXiaohongshuSign, buildDouyinParams } = require("../src/signer-local");
const TEST_SECRET = "test-secret";

let passed = 0, failed = 0;
function test(name, fn) {
  try { fn(); passed++; console.log("  \u2705 " + name); }
  catch (e) { failed++; console.log("  \u274C " + name + ": " + e.message); }
}
function assertEqual(a, b) { assert.deepStrictEqual(a, b); }

console.log("--- getCsdnSign ---");
test("returns base64 string", () => {
  const s = getCsdnSign("/api/post", { title: "test" }, TEST_SECRET);
  assertEqual(typeof s, "string"); assertEqual(s.length > 0, true);
});
test("deterministic for same inputs", () => {
  assertEqual(getCsdnSign("/api/post", { title: "test" }, TEST_SECRET), getCsdnSign("/api/post", { title: "test" }, TEST_SECRET));
});
test("different bodies differ", () => {
  assertEqual(getCsdnSign("/api/post", { title: "a" }, TEST_SECRET) !== getCsdnSign("/api/post", { title: "b" }, TEST_SECRET), true);
});
test("without body", () => {
  assertEqual(typeof getCsdnSign("/api/post", {}, TEST_SECRET), "string");
});
test("rejects missing appSecret", () => {
  assert.throws(() => getCsdnSign("/api/post", { title: "test" }), /appSecret is required/);
});

console.log("\n--- getXiaohongshuSign ---");
// 该函数已切到真实 XYW_ 算法（不再是 md5 占位），a1 是签名必需输入。
// 生产发布链走 buildXiaohongshuSignHeaders（带真 cookie），
// 这里覆盖的是同一 fail-closed 契约：无 a1 必须抛错，绝不回落占位签名。
const TEST_A1 = "18f3a1c0d9e2b4f5a6c7d8e9f0a1b2c3";
test("returns X-s and X-t", () => {
  const s = getXiaohongshuSign("/api/path", { a1: TEST_A1 });
  assertEqual(typeof s["X-s"], "string"); assertEqual(typeof s["X-t"], "number");
  assertEqual(s["X-s"].length > 0, true);
});
test("X-t is recent", () => {
  const s = getXiaohongshuSign("/api/path", { a1: TEST_A1 });
  const now = Date.now();
  assertEqual(s["X-t"] > now - 5000 && s["X-t"] <= now, true);
});
test("without body", () => {
  assertEqual(typeof getXiaohongshuSign("/path", { a1: TEST_A1 })["X-s"], "string");
});
test("complex body", () => {
  assertEqual(typeof getXiaohongshuSign("/path", { a1: TEST_A1, a: [1,2,3], b: { c: "d" } })["X-s"], "string");
});
test("empty body", () => {
  assertEqual(typeof getXiaohongshuSign("/path", { a1: TEST_A1 })["X-s"], "string");
});
test("rejects missing a1 cookie (fail-closed, no placeholder fallback)", () => {
  assert.throws(() => getXiaohongshuSign("/path", {}), /a1 cookie is required/);
  assert.throws(() => getXiaohongshuSign("/path", null), /a1 cookie is required/);
});
test("different a1 yields different signature", () => {
  const a = getXiaohongshuSign("/path", { a1: TEST_A1 })["X-s"];
  const b = getXiaohongshuSign("/path", { a1: "0000000000000000000000000000000f" })["X-s"];
  assertEqual(a !== b, true);
});
test("absolute url path accepted", () => {
  assertEqual(typeof getXiaohongshuSign("https://edith.xiaohongshu.com/api/galaxy/user/info", { a1: TEST_A1 })["X-s"], "string");
});

console.log("\n--- buildDouyinParams ---");
test("required fields", () => {
  const p = buildDouyinParams("Mozilla/5.0 Chrome");
  assertEqual(typeof p._signature, "string"); assertEqual(p.aid, "1128");
  assertEqual(p.browser_language, "zh-CN"); assertEqual(p.timezone_name, "Asia/Shanghai");
});
test("includes UA as browser_version", () => {
  assertEqual(buildDouyinParams("Custom UA").browser_version, "Custom UA");
});
test("without UA", () => { assertEqual(buildDouyinParams().browser_version, ""); });
test("all expected keys present", () => {
  const p = buildDouyinParams("UA");
  const expected = ["cookie_enabled","screen_width","screen_height","browser_language","browser_platform","browser_name","browser_version","browser_online","timezone_name","aid","_signature"];
  expected.forEach(function(k){ assertEqual(k in p, true, "Missing key: " + k); });
});

// --- getKuaishouSign 段已移除（2026-10-21）：它测的是 32 位假签名，
// 该实现已被真实服务端否证并从导出面拆除；替代实现见 src/signer/kuaishou-sig3.js。

console.log("\n========== Result ==========");
console.log("  Passed: " + passed + " / " + (passed + failed));
console.log("  Failed: " + failed + " / " + (passed + failed));
if (failed > 0) process.exit(1);
