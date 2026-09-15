/**
 * Signer TDD（本地化收口）
 */
const crypto = require("crypto");
const signer = require("../src/signer");

describe("Signer", function() {
  test("exports SIGNER_PORTS mapping（仅保留抖音远程验证端口）", function() {
    expect(signer.SIGNER_PORTS).toEqual({ douyin: 5042 });
  });

  test("getRemoteSign throws for unknown platform", async function() {
    await expect(signer.getRemoteSign("nonexistent")).rejects.toThrow("No signer port");
    // 快手已切本地直调，不再属于远程端口表
    await expect(signer.getRemoteSign("kuaishou")).rejects.toThrow("No signer port");
  });

  test("exports all functions（远程死代码已移除）", function() {
    expect(typeof signer.getRemoteSign).toBe("function");
    expect(typeof signer.getDouyinSignature).toBe("function");
    expect(typeof signer.getKuaishouSignature).toBe("function");
    expect(signer.getXiaohongshuToken).toBeUndefined();
    expect(signer.getBaijiahaoSignature).toBeUndefined();
  });

  test("getKuaishouSignature 本地计算：MD5(api_ph|body)，api_ph 取自 cookie", async function() {
    const cookie = "BUDSS=XYZ; kuaishou.web.cp.api_ph=PH123; other=1";
    const body = { caption: "hello", part: 1 };
    const expected = crypto
      .createHash("md5")
      .update("PH123|" + JSON.stringify(body))
      .digest("hex");

    const sig = await signer.getKuaishouSignature("/rest/cp/works/v2/video/pc/upload/finish", body, cookie);
    expect(sig.signature).toBe(expected);
    expect(sig.__NS_sig3).toBe(expected);
  });

  test("getKuaishouSignature 缺少 api_ph 时返回空签名且不抛错", async function() {
    const sig = await signer.getKuaishouSignature("/x", { a: 1 }, "BUDSS=XYZ");
    expect(sig.signature).toBe("");
    expect(sig.__NS_sig3).toBe("");
  });

  test("未设置 MP_SIGNER_BASE 时抖音走本地实现（不发外部请求）", async function() {
    delete process.env.MP_SIGNER_BASE;
    const sig = await signer.getDouyinSignature("https://www.douyin.com/web/api/media/aweme/post/");
    expect(sig._signature).toBe("_");
    expect(sig.cookie_enabled).toBe("true");
  });

  test("设置 MP_SIGNER_BASE 时远程优先、远程失败回退本地", async function() {
    const prev = process.env.MP_SIGNER_BASE;
    process.env.MP_SIGNER_BASE = "http://127.0.0.1:1"; // 连接拒绝 → 快速失败
    try {
      const sig = await signer.getDouyinSignature("https://www.douyin.com/web/api/media/aweme/post/");
      expect(sig._signature).toBe("_");
    } finally {
      if (prev === undefined) delete process.env.MP_SIGNER_BASE;
      else process.env.MP_SIGNER_BASE = prev;
    }
  });
});
