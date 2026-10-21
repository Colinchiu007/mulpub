const assert = require("assert");
const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { createRegistry } = require("../src/signer/registry");
const signerMod = require("../src/signer");
const local = require("../src/signer-local");

let passed = 0, failed = 0;
function test(name, fn) {
  try { const r = fn(); if (r && typeof r.then === "function") { return r.then(() => { passed++; console.log("  \u2705 " + name); }, (e) => { failed++; console.log("  \u274C " + name + ": " + e.message); }); } passed++; console.log("  \u2705 " + name); }
  catch (e) { failed++; console.log("  \u274C " + name + ": " + e.message); }
}
function assertEqual(a, b) { assert.deepStrictEqual(a, b); }

const queue = [];
function t(name, fn) { queue.push(() => test(name, fn)); }

t("未知 signCommand fail-closed（抛错，不静默返回）", async () => {
  const reg = createRegistry();
  await assert.rejects(() => reg.sign("does.not.exist", {}), /unknown signCommand/);
});

t("register 要求非空字符串 command", () => {
  const reg = createRegistry();
  assert.throws(() => reg.register("", () => "x"), /non-empty string/);
  assert.throws(() => reg.register(null, () => "x"), /non-empty string/);
});

t("register 要求函数实现", () => {
  const reg = createRegistry();
  assert.throws(() => reg.register("a.b", "not-a-fn"), /must be a function/);
});

t("注册后 sign 返回实现结果 + has/list", async () => {
  const reg = createRegistry();
  reg.register("foo.bar", (p) => "sig:" + p.k);
  assertEqual(reg.has("foo.bar"), true);
  assertEqual(await reg.sign("foo.bar", { k: 1 }), "sig:1");
  assertEqual(reg.list(), ["foo.bar"]);
});

t("unregister 后同名 command 再次 fail-closed", async () => {
  const reg = createRegistry();
  reg.register("tmp.cmd", () => "v");
  reg.unregister("tmp.cmd");
  await assert.rejects(() => reg.sign("tmp.cmd", {}), /unknown signCommand/);
});

t("默认注册表已收编 Tier-A 本地 command", () => {
  const list = signerMod.registry.list();
  ["kuaishou.ns-sig3", "douyin.browser-params", "xiaohongshu.x-s", "csdn.hmac-sha256", "shipinhao.content-md5"].forEach((c) => {
    assertEqual(list.includes(c), true, "missing default command: " + c);
  });
});

/*
 * 2026-10 契约变更（有意为之，非"改测试凑绿"）：
 *
 * 原断言是「registry.sign('kuaishou.ns-sig3') 与 signer-local.getKuaishouSign 逐字一致，
 * 且长度 32」。它锁的是 `MD5(api_ph + "|" + JSON(body))` 这个**近似式**。
 * 该近似式已被 2026-09-25 的 W3 spike S0 判定为结构上不等于真签名
 * （真 sig3 是 56 字符的 VM 产物），随后被 Tier-B 页面签名器取代。
 *
 * 2026-10 把竞品 VM 算法完整还原为纯 JS，并在真实服务端验证通过
 * （无签 500002 被拒 / 带签 result:1），因此 registry 改为产出真 sig3（56 hex）。
 *
 * 2026-10-21 收口（竞品逆向成果复用专项）：旧 `getKuaishouSign` **已从导出面拆除** ——
 * 它产出 32 位假签名，留着会让任何调用方误以为已具备签名能力。上面那段注释里的
 * "仍保留导出（避免破坏外部引用）"已过时，以本段为准。
 */
t("Tier-A：kuaishou.ns-sig3 产出真 sig3（56 hex，旧 MD5 近似式已作废）", async () => {
  const payload = { url: "/rest/v2/creator/pc/authority/account/current", type: "json", params: {} };
  const sig = await signerMod.registry.sign("kuaishou.ns-sig3", payload);
  assertEqual(typeof sig, "string");
  assertEqual(sig.length, 56);
  assertEqual(/^[0-9a-f]{56}$/.test(sig), true);
});

// 2026-10-21：旧近似式 `local.getKuaishouSign`（MD5(apiPh|body)，32 位）已从导出面
// 拆除（真实服务端否证 + 已被真 sig3 取代，留着会让调用方拿到 32 位假签名）。
// 断言改为**就地复算**历史近似值来证明二者不等，不再依赖那个已拆除的函数存在；
// 并钉住导出面已无该函数。
t("Tier-A：kuaishou.ns-sig3 不等于历史 32 位近似式（且旧函数已拆除）", async () => {
  const body = { caption: "hello", part: 1 };
  const legacyValue = crypto.createHash("md5")
    .update("PH123" + "|" + JSON.stringify(body)).digest("hex");
  assertEqual(legacyValue.length, 32); // 历史近似式确实是 32 位
  const sig = await signerMod.registry.sign("kuaishou.ns-sig3", { url: "/p", body });
  assertEqual(sig.length, 56);
  assertEqual(/^[0-9a-f]{56}$/.test(sig), true);
  assertEqual(sig === legacyValue, false);
  assertEqual(typeof local.getKuaishouSign, "undefined");
});

t("Tier-A 回归：shipinhao.content-md5 = base64(MD5(bytes))", async () => {
  const buf = Buffer.from("hello-bytes", "utf8");
  const expected = crypto.createHash("md5").update(buf).digest("base64");
  assertEqual(await signerMod.registry.sign("shipinhao.content-md5", { buffer: buf }), expected);
});

t("shipinhao.content-md5 空 buffer fail-closed", async () => {
  await assert.rejects(() => signerMod.registry.sign("shipinhao.content-md5", { buffer: Buffer.alloc(0) }), /non-empty buffer/);
});

t("合规红线：registry 与 signer 门面源码不含远程通道痕迹", () => {
  const regSrc = fs.readFileSync(path.join(__dirname, "..", "src", "signer", "registry.js"), "utf8");
  const idxSrc = fs.readFileSync(path.join(__dirname, "..", "src", "signer", "index.js"), "utf8");
  const facadeSrc = fs.readFileSync(path.join(__dirname, "..", "src", "signer.js"), "utf8"); const douyinGuardSrc = fs.readFileSync(path.join(__dirname, "..", "src", "signer", "douyin-ticket-guard.js"), "utf8");
  [regSrc, idxSrc, facadeSrc, douyinGuardSrc].forEach((src, i) => {
    assertEqual(/MP_SIGNER_BASE|getRemoteSign|SIGNER_PORTS|refpub|require\(["']axios["']\)|require\(["']http["']\)/.test(src), false, "file#" + i + " contains banned remote-channel token");
  });
});

(async () => {
  for (const fn of queue) { await fn(); }
  console.log("\n========== signer-registry Result ==========");
  console.log("  Passed: " + passed + " / " + (passed + failed));
  console.log("  Failed: " + failed + " / " + (passed + failed));
  if (failed > 0) process.exit(1);
})();
