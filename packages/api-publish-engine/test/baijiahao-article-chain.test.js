/**
 * baijiahao-article-chain.test.js — 百家号图文发布链契约（W1 §4.3 + §4.5，vitest 组）
 *
 * 仅对本机假 HTTP 服务器发请求（契约基建 §3.1），杜绝外发。
 * 覆盖：baseToken→publishToken→(uploadproxy)→save/publish 逐字请求序列、
 *       headers.token 传递白名单、私密优先走 save 端点、
 *       §4.5 fail-closed：缺 cookie/UA、baseToken 提取失败 → 零请求。
 */
const { startFakeServer, methodPathList } = require("./helpers/fake-http");
const { createHttpClient } = require("../src/publish/core/http-base");
const { BaijiahaoArticleChain, BaijiahaoArticleError, truncateTitle, TITLE_MAX_BYTES } = require("../src/publish/platforms/baijiahao-article");

const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function makeChain (srv, extra) {
  const http = createHttpClient({ baseURL: srv.url, timeout: 5000 });
  return new BaijiahaoArticleChain(Object.assign({ http, baseUrl: srv.url, userAgent: UA, cookie: "BAIDUID=abc; BIDUP=1" }, extra || {}));
}

function draftRoutes () {
  return [
    { method: "GET", match: /source=inner/, raw: true, body: '<html><script>var BJH__INIT__AUTH__ = "BASE_TOK";</script></html>' },
    { method: "GET", match: /\/pcui\/article\/edit/, headers: { token: "PUB_TOK" }, body: { status: 0 } },
    { method: "POST", match: /\/pcui\/article\/save/, body: { errno: 0, ret: { id: "DRAFT_9" } } },
    { method: "POST", match: /\/pcui\/article\/publish/, body: { errno: 0, ret: { id: "PUB_1" } } },
  ];
}

describe("publish/platforms/baijiahao-article", function () {
  test("私密优先：草稿链走 save?callback=bjhdraft，token 逐级传递", async function () {
    const srv = await startFakeServer(draftRoutes());
    try {
      const chain = makeChain(srv);
      const result = await chain.run({ title: "测试标题", content: "<p>正文内容</p>" }, { draft: true });
      expect(result.success).toBe(true);
      expect(result.draft).toBe(true);
      expect(result.publishId).toBe("DRAFT_9");
      expect(result.platform).toBe("baijiahao");
      const seq = methodPathList(srv.requests);
      expect(seq).toEqual(["GET /", "GET /pcui/article/edit", "POST /pcui/article/save"]);
      // edit 请求带 baseToken，save 请求带 publishToken
      const editReq = srv.requestsFor(/\/pcui\/article\/edit/)[0];
      expect(editReq.headers.token).toBe("BASE_TOK");
      const saveReq = srv.requestsFor(/\/pcui\/article\/save/)[0];
      expect(saveReq.headers.token).toBe("PUB_TOK");
      expect(saveReq.url).toContain("callback=bjhdraft");
      const body = saveReq.rawBody.toString("utf8");
      expect(body).toContain("title=");
      expect(body).toContain("content=");
      expect(body).toContain("type=news");
    } finally { await srv.close(); }
  });

  test("正式发布链走 publish?type=news&callback=bjhpublish", async function () {
    const srv = await startFakeServer(draftRoutes());
    try {
      const chain = makeChain(srv);
      const result = await chain.run({ title: "T", content: "C" }, { draft: false });
      expect(result.success).toBe(true);
      expect(result.draft).toBe(false);
      expect(result.publishId).toBe("PUB_1");
      const pub = srv.requestsFor(/\/pcui\/article\/publish/)[0];
      expect(pub).toBeTruthy();
      expect(pub.url).toContain("type=news");
      expect(pub.url).toContain("callback=bjhpublish");
      expect(srv.requestsFor(/\/pcui\/article\/save/).length).toBe(0);
    } finally { await srv.close(); }
  });

  test("headers 白名单：UA/Cookie 透传，无远程签名通道残留", async function () {
    const srv = await startFakeServer(draftRoutes());
    try {
      const chain = makeChain(srv);
      await chain.run({ title: "T", content: "C" }, { draft: true });
      const saveReq = srv.requestsFor(/\/pcui\/article\/save/)[0];
      expect(saveReq.headers["user-agent"]).toBe(UA);
      expect(saveReq.headers.cookie).toContain("BAIDUID=abc");
      // 逐字请求全部落在本机假服务器（无第三方域名外发）：仅预期的三段本地路径序列
      expect(methodPathList(srv.requests)).toEqual(["GET /", "GET /pcui/article/edit", "POST /pcui/article/save"]);
    } finally { await srv.close(); }
  });

  test("§4.5 fail-closed：缺 cookie → 抛错且零请求", async function () {
    const srv = await startFakeServer(draftRoutes());
    try {
      const chain = makeChain(srv, { cookie: "" });
      await expect(chain.run({ title: "T", content: "C" }, { draft: true })).rejects.toThrow(BaijiahaoArticleError);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("§4.5 fail-closed：缺 User-Agent → 抛错且零请求", async function () {
    const srv = await startFakeServer(draftRoutes());
    try {
      const chain = makeChain(srv, { userAgent: "" });
      await expect(chain.run({ title: "T", content: "C" }, { draft: true })).rejects.toThrow(BaijiahaoArticleError);
      expect(srv.requests.length).toBe(0);
    } finally { await srv.close(); }
  });

  test("§4.5 fail-closed：baseToken 提取失败 → 不发起任何写请求", async function () {
    const srv = await startFakeServer([
      { method: "GET", match: /source=inner/, raw: true, body: "<html>no token here</html>" },
      { method: "GET", match: /\/pcui\/article\/edit/, headers: { token: "PUB_TOK" }, body: {} },
      { method: "POST", match: /\/pcui\/article\/save/, body: { errno: 0 } },
    ]);
    try {
      const chain = makeChain(srv);
      await expect(chain.run({ title: "T", content: "C" }, { draft: true })).rejects.toThrow(/baseToken/);
      // 仅发生一次读请求，绝不触达写端点
      expect(methodPathList(srv.requests)).toEqual(["GET /"]);
      expect(srv.requestsFor(/\/pcui\/article\/(save|publish)/).length).toBe(0);
    } finally { await srv.close(); }
  });

  test("风控 10000015 返回可操作提示（不静默吞错）", async function () {
    const srv = await startFakeServer([
      { method: "GET", match: /source=inner/, raw: true, body: 'BJH__INIT__AUTH__ = "BASE_TOK"' },
      { method: "GET", match: /\/pcui\/article\/edit/, headers: { token: "PUB_TOK" }, body: {} },
      { method: "POST", match: /\/pcui\/article\/save/, body: { errno: 10000015, errmsg: "您所在网络环境异常，请完成验证", data: { hit_rule: "30天内注册的百家号作者弹码" } } },
    ]);
    try {
      const chain = makeChain(srv);
      const result = await chain.run({ title: "T", content: "C" }, { draft: true });
      expect(result.success).toBe(false);
      expect(result.code).toBe(10000015);
      expect(result.error).toContain("风控拦截");
      expect(result.error).toContain("30天内注册的百家号作者弹码");
      expect(result.error).toContain("请先在浏览器中登录百家号完成验证");
    } finally { await srv.close(); }
  });

  test("truncateTitle 按 UTF-8 字节截断到 149 上限（不切多字节字符）", function () {
    const t = truncateTitle("外".repeat(50));
    expect(Array.from(t).length).toBe(49);
    expect(Buffer.byteLength(t, "utf8")).toBeLessThanOrEqual(TITLE_MAX_BYTES);
    expect(truncateTitle("短标题")).toBe("短标题");
  });

  test("AI 声明：buildArticleFormData 默认勾选 aigc_bjh_status is_checked=1", function () {
    const chain = new BaijiahaoArticleChain({ userAgent: UA, cookie: "c" });
    const fd = chain.buildArticleFormData({ title: "T", content: "C" });
    expect(fd).toContain("activity_list%5B0%5D%5Bid%5D=aigc_bjh_status");
    expect(fd).toContain("activity_list%5B0%5D%5Bis_checked%5D=1");
  });

  test("AI 声明：aiGenerated=false → is_checked=0（人工创作如实取消）", function () {
    const chain = new BaijiahaoArticleChain({ userAgent: UA, cookie: "c" });
    const fd = chain.buildArticleFormData({ title: "T", content: "C", aiGenerated: false });
    expect(fd).toContain("activity_list%5B0%5D%5Bid%5D=aigc_bjh_status");
    expect(fd).toContain("activity_list%5B0%5D%5Bis_checked%5D=0");
  });
});
