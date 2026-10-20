/**
 * Signer 门面 TDD（W1 §2：进程内注册表收口，远程通道已拆除）
 */
const crypto = require("crypto");
const signer = require("../src/signer");

describe("Signer (registry facade)", function () {
  test("远程通道已物理拆除（导出不再包含后门符号）", function () {
    expect(signer.getRemoteSign).toBeUndefined();
    expect(signer.SIGNER_PORTS).toBeUndefined();
  });

  test("对外保留 registry / getDouyinSignature / getKuaishouSignature", function () {
    expect(typeof signer.getDouyinSignature).toBe("function");
    expect(typeof signer.getKuaishouSignature).toBe("function");
    expect(signer.registry && typeof signer.registry.sign).toBe("function");
  });

  /*
   * 2026-10 契约变更（有意为之，非"改测试凑绿"）：
   *
   * 原断言是「getKuaishouSignature == MD5(api_ph + "|" + body)，缺 api_ph 返回空串」。
   * 它锁的是那个**从未与真签名对拍过**的近似式（32 位裸 MD5；真 sig3 是 56 字符 VM 产物）。
   * 该近似式已被 W3 spike S0 判定作废；2026-10 把竞品 VM 算法完整还原为纯 JS 后 Tier-A 重新可用。
   * 新输入**不含 api_ph**：真 sig3 = sig3( md5(按 key 排序的 query 串 + JSON.stringify(body)) )。
   * 因此「缺 api_ph」的拦截点在发布链前置校验（_assertPreconditions），不在签名函数里。
   */
  test("getKuaishouSignature 产出真 sig3（56 hex）", async function () {
    const body = { caption: "hello", part: 1 };
    const cookie = "BUDSS=XYZ; kuaishou.web.cp.api_ph=PH123; other=1";
    const sig = await signer.getKuaishouSignature("/rest/cp/works/v2/video/pc/upload/finish", body, cookie);
    expect(typeof sig.signature).toBe("string");
    expect(sig.signature).toHaveLength(56);
    expect(sig.signature).toMatch(/^[0-9a-f]{56}$/);
    expect(sig.__NS_sig3).toBe(sig.signature);
  });

  test("api_ph 不参与 sig3 计算（同输入同 state ⇒ 同签名）", async function () {
    const args = { url: "/x", type: "json", params: { a: 1 }, startupRandom: 1750000000, count: 100 };
    const a = await signer.registry.sign("kuaishou.ns-sig3", args);
    const b = await signer.registry.sign("kuaishou.ns-sig3", args);
    expect(a).toBe(b);
    expect(a).toHaveLength(56);
    // 缺 api_ph 也能算出有效签名；拦截点在发布链前置校验
    const noPh = await signer.getKuaishouSignature("/x", { a: 1 }, "BUDSS=XYZ");
    expect(noPh.signature).toMatch(/^[0-9a-f]{56}$/);
  });

  test("getDouyinSignature 纯本地，即使设置远程后门环境变量也不发外部请求", async function () {
    const prev = process.env.MP_SIGNER_BASE;
    process.env.MP_SIGNER_BASE = "http://127.0.0.1:1"; // 若仍被读取会尝试连接 → 现应被完全忽略
    try {
      const sig = await signer.getDouyinSignature("https://www.douyin.com/web/api/media/aweme/post/", "Mozilla/5.0");
      expect(sig._signature).toBe("_");
      expect(sig.cookie_enabled).toBe("true");
      expect(sig.browser_version).toBe("Mozilla/5.0");
    } finally {
      if (prev === undefined) delete process.env.MP_SIGNER_BASE;
      else process.env.MP_SIGNER_BASE = prev;
    }
  });

  test("未知 signCommand 经门面 registry 仍 fail-closed", async function () {
    await expect(signer.registry.sign("nope.unknown", {})).rejects.toThrow(/unknown signCommand/);
  });
});
