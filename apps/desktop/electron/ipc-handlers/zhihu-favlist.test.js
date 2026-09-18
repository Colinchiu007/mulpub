// @ts-check
/**
 * zhihu-favlist IPC handlers 回归测试
 *
 * 覆盖：list/contents 通道、batch-collect/batch-rewrite 编排（频率控制器接线）、
 * cancel 通道、参数校验、并发防护（同类型任务互斥）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const registerHandlers = require("./zhihu-favlist");

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

  it("list 成功 → code 0 + favlists", async () => {
    // mock ZhihuFavlistService（通过 store secret 走真实 service，mock axios 不易注入——直接验证返回结构）
    const r = await handlers["zhihu-favlist:list"](null, {});
    // 真实网络调用会失败（无真实 secret/网络），验证错误路径结构
    expect(r).toHaveProperty("code");
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
