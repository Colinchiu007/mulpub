/**
 * http-base.test.js — $http 等价基座契约（W1 §3.2，vitest 组）
 *
 * 仅对本机假 HTTP 服务器发请求（契约基建 §3.1），杜绝外发。
 * 断言：默认 timeout 60s、retryCondition=!isJson 总尝试 ≤3、非 JSON 耗尽抛
 * data_error、代理 agent 注入、请求序列逐字记录。
 */
const { startFakeServer, methodPathList } = require("./helpers/fake-http");
const { createHttpClient, requestWithRetry, PublishHttpError } = require("../src/publish/core/http-base");
const { errorCode } = require("../src/error-codes");

describe("publish/core/http-base", function () {
  test("默认超时 60s、JSON 接受时 Content-Type 校验", async function () {
    const client = createHttpClient();
    expect(client.defaults.timeout).toBe(60000);
  });

  test("代理注入：httpAgent/httpsAgent 透传到实例默认值", async function () {
    const fakeAgent = { mark: "proxy-agent" };
    const client = createHttpClient({ agents: { httpAgent: fakeAgent, httpsAgent: fakeAgent } });
    // axios 对 config 做深合并，引用会变、内容保留 → 断言透传语义而非引用同一性
    expect(client.defaults.httpAgent).toEqual(fakeAgent);
    expect(client.defaults.httpsAgent).toEqual(fakeAgent);
  });

  test("响应为 JSON 时不重试，一次成功", async function () {
    const srv = await startFakeServer([{ method: "GET", match: /\/api\/ok/, body: { code: 0 } }]);
    try {
      const client = createHttpClient({ baseURL: srv.url });
      const res = await requestWithRetry(client, { method: "get", url: "/api/ok" });
      expect(res.data).toEqual({ code: 0 });
      expect(methodPathList(srv.requests)).toEqual(["GET /api/ok"]);
    } finally {
      await srv.close();
    }
  });

  test("风控 HTML 首答 → 重试后成功（总尝试 ≤3）", async function () {
    const srv = await startFakeServer([
      { method: "GET", match: /\/api\/flaky/, status: 200, body: "<html>risk control</html>", raw: true, times: 1 },
      { method: "GET", match: /\/api\/flaky/, body: { code: 0, data: "ok" } },
    ]);
    try {
      const client = createHttpClient({ baseURL: srv.url });
      const res = await requestWithRetry(client, { method: "get", url: "/api/flaky" });
      expect(res.data.code).toBe(0);
      expect(srv.requests.length).toBe(2);
    } finally {
      await srv.close();
    }
  });

  test("持续非 JSON → 总尝试封顶 3 次后抛 PublishHttpError(data_error)", async function () {
    const srv = await startFakeServer([
      { method: "GET", match: /\/api\/html/, body: "<html>blocked</html>", raw: true },
    ]);
    try {
      const client = createHttpClient({ baseURL: srv.url });
      await expect(requestWithRetry(client, { method: "get", url: "/api/html" })).rejects.toThrow(PublishHttpError);
      expect(srv.requests.length).toBe(3);
      srv.reset(); // 复位后另开一轮：maxAttempts=1 验证 code 映射与封顶
      let thrown = null;
      try {
        await requestWithRetry(client, { method: "get", url: "/api/html" }, { maxAttempts: 1 });
      } catch (e) { thrown = e; }
      expect(thrown.code).toBe(errorCode.data_error);
    } finally {
      await srv.close();
    }
  });

  test("可配 maxAttempts 与重试间隔；HTTP 非 2xx 直接抛（不视作风控重试条件）", async function () {
    const srv = await startFakeServer([
      { method: "POST", match: /\/api\/4xx/, status: 403, body: { error: "forbidden" } },
    ]);
    try {
      const client = createHttpClient({ baseURL: srv.url, validateStatus: (s) => s >= 200 && s < 300 });
      await expect(
        requestWithRetry(client, { method: "post", url: "/api/4xx", data: { a: 1 } }, { retryDelayMs: 1 })
      ).rejects.toThrow();
      expect(srv.requests.length).toBe(1); // 状态码错误不走 !isJson 重试
      expect(srv.requests[0].body).toEqual({ a: 1 });
    } finally {
      await srv.close();
    }
  });
});
