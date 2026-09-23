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

  test("getKuaishouSignature 本地计算：MD5(api_ph|body)，api_ph 取自 cookie", async function () {
    const cookie = "BUDSS=XYZ; kuaishou.web.cp.api_ph=PH123; other=1";
    const body = { caption: "hello", part: 1 };
    const expected = crypto.createHash("md5").update("PH123|" + JSON.stringify(body)).digest("hex");
    const sig = await signer.getKuaishouSignature("/rest/cp/works/v2/video/pc/upload/finish", body, cookie);
    expect(sig.signature).toBe(expected);
    expect(sig.__NS_sig3).toBe(expected);
  });

  test("getKuaishouSignature 缺 api_ph 返回空签名（由上层 fail-closed 校验拦截）", async function () {
    const sig = await signer.getKuaishouSignature("/x", { a: 1 }, "BUDSS=XYZ");
    expect(sig.signature).toBe("");
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
