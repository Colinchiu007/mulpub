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

t("Tier-A 回归：kuaishou.ns-sig3 与 signer-local 逐字一致", async () => {
  const body = { caption: "hello", part: 1 };
  const expected = local.getKuaishouSign(body, "PH123");
  assertEqual(await signerMod.registry.sign("kuaishou.ns-sig3", { body, apiPh: "PH123" }), expected);
  assertEqual(expected.length, 32);
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
  const facadeSrc = fs.readFileSync(path.join(__dirname, "..", "src", "signer.js"), "utf8");
  [regSrc, idxSrc, facadeSrc].forEach((src, i) => {
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
