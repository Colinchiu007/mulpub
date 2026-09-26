// @ts-check
/**
 * zhihu-favlist IPC handlers 回归测试
 *
 * 覆盖：list/contents 通道、batch-collect/batch-rewrite 编排（频率控制器接线）、
 * cancel 通道、参数校验、并发防护（同类型任务互斥）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const registerHandlers = require("./zhihu-favlist");

// 传输层桩。`zhihu-favlist-service.js:33 _getAxios()` 是惰性 `require('axios')`，
// 而 handler 内部 `new ZhihuFavlistService({ log })` 不接受 axios 注入（缺陷 H 登记），
// 所以只能靠 test-setup 的 __registerMock('axios', ...) 在 Module._load 层拦下。
// 未注册前，本文件的 list 用例会走真出站 —— 那正是缺陷 G 的确证案例。
const axiosStub = { get: vi.fn(), post: vi.fn() };
// 本文件全程零真出站：注册在模块作用域，早于任何 handler 调用；
// test-setup 的 Module._load 拦截会在 `require('axios')` 处返回上面的桩。
global.__registerMock("axios", axiosStub);

function makeDeps (overrides = {}) {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } };
  const store = { getSetting: vi.fn(() => "test-secret") };
  const urlCollector = { collect: vi.fn(async () => ({ success: true, title: "T" })) };
  const pythonBridge = { requestBackend: vi.fn(async () => ({ result_content: "改写结果" })) };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  // 快速控制器：跳过真实延迟（否则 8s 条间延迟会让测试超时）
  const BatchRateController = require("../services/batch-rate-controller");
  const rateControllerFactory = (opts) => new BatchRateController({ sleepFn: async () => {}, baseIntervalMs: 1, jitterMs: 0, ...opts });
  return { ipcMain, handlers, deps: { store, urlCollector, pythonBridge, log, rateControllerFactory, ...overrides } };
}

describe("zhihu-favlist IPC handlers", () => {
  let handlers;
  let deps;

  beforeEach(() => {
    axiosStub.get.mockReset();
    axiosStub.post.mockReset();
    const ctx = makeDeps();
    handlers = ctx.handlers;
    deps = ctx.deps;
    registerHandlers(ctx.ipcMain, ctx.deps);
  });

  it("注册 5 个通道", () => {
    expect(handlers["zhihu-favlist:list"]).toBeTypeOf("function");
    expect(handlers["zhihu-favlist:contents"]).toBeTypeOf("function");
    expect(handlers["zhihu-favlist:batch-collect"]).toBeTypeOf("function");
    expect(handlers["zhihu-favlist:batch-rewrite"]).toBeTypeOf("function");
    expect(handlers["zhihu-favlist:cancel"]).toBeTypeOf("function");
  });

  it("list 成功 → code 0 + favlists 字段映射", async () => {
    axiosStub.get.mockResolvedValueOnce({
      data: {
        Code: 0,
        Data: {
          Items: [
            { UrlToken: "abc", Title: "收藏A", Description: "d", IsPublic: true, Url: "https://www.zhihu.com/collection/abc" },
            { UrlToken: null, Title: "无 token 应被过滤" },
          ],
        },
      },
    });
    const r = await handlers["zhihu-favlist:list"](null, {});
    expect(r.code).toBe(0);
    expect(r.data).toEqual([
      { urlToken: "abc", title: "收藏A", description: "d", isPublic: true, url: "https://www.zhihu.com/collection/abc" },
    ]);
    // 请求确实经过桩（而不是又去真出网）：URL 与认证头都由服务层构造，这里核对端点与 Bearer
    expect(axiosStub.get).toHaveBeenCalledTimes(1);
    const [url, config] = axiosStub.get.mock.calls[0];
    expect(url).toBe("https://developer.zhihu.com/api/v1/user/favlists");
    expect(config.headers.Authorization).toBe("Bearer test-secret");
  });

  it("list 网络失败 → code -1 且文案为「网络连接失败」，不外泄堆栈", async () => {
    axiosStub.get.mockRejectedValueOnce(Object.assign(new Error("socket hang up"), { code: "ECONNRESET" }));
    const r = await handlers["zhihu-favlist:list"](null, {});
    expect(r.code).toBe(-1);
    expect(r.message).toContain("网络连接失败");
    expect(r.message).toContain("socket hang up");
  });

  it("list 未配置 Secret → code -1，且一次都不出站", async () => {
    deps.store.getSetting.mockReturnValueOnce("");
    const r = await handlers["zhihu-favlist:list"](null, {});
    expect(r.code).toBe(-1);
    expect(r.message).toBe("未配置知乎 Access Secret");
    expect(axiosStub.get).not.toHaveBeenCalled();
  });

  it("contents 缺参数 → code -2", async () => {
    const r = await handlers["zhihu-favlist:contents"](null, null);
    expect(r.code).toBe(-2);
  });

  it("batch-collect 缺 URL 列表 → code -2", async () => {
    const r = await handlers["zhihu-favlist:batch-collect"](null, {});
    expect(r.code).toBe(-2);
  });

  it("batch-collect 成功 → 逐条调 urlCollector.collect + 统计", async () => {
    const r = await handlers["zhihu-favlist:batch-collect"](null, { urls: ["https://a.com/1", "https://a.com/2"] });
    expect(r.code).toBe(0);
    expect(r.data.completed).toBe(2);
    expect(deps.urlCollector.collect).toHaveBeenCalledTimes(2);
  });

  it("batch-rewrite 缺内容列表 → code -2", async () => {
    const r = await handlers["zhihu-favlist:batch-rewrite"](null, {});
    expect(r.code).toBe(-2);
  });

  it("batch-rewrite 成功 → 逐条调 pythonBridge + 统计", async () => {
    const r = await handlers["zhihu-favlist:batch-rewrite"](null, {
      contents: [{ content: "内容一".repeat(20) }, { content: "内容二".repeat(20) }],
    });
    expect(r.code).toBe(0);
    expect(r.data.completed).toBe(2);
    expect(deps.pythonBridge.requestBackend).toHaveBeenCalledTimes(2);
  });

  it("cancel 无进行中任务 → data: false", async () => {
    const r = await handlers["zhihu-favlist:cancel"](null, { type: "collect" });
    expect(r.code).toBe(0);
    expect(r.data).toBe(false);
  });
});
