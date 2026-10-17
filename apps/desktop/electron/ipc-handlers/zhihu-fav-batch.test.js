// @ts-check
/**
 * zhihu-fav-batch IPC handler 测试 — 「采集并改写」编排通道
 *
 * PRD-ZHIHU-FAV-BATCH-2026-10-03 §3.2/§6：
 *  - 参数校验（items/cap100/scope）→ code -2
 *  - 进度双边界：start（采集前）与 done（完成后）各恰一次（AGENTS.md 批量进度双边界契约）
 *  - 自动改写：采集成功→改写→rewrittenContent；改写失败→rewriteFailed 保原文（Q26C/D2）
 *  - 视频型/想法条目：跳过采集与改写（B3/B4）
 *  - 已采集条目默认跳过（duplicateSkipped），forceRecollect 重采（C2）
 *  - cache_hit（无 title/content）防空壳：计入失败（C2/摸底缺陷）
 *  - 内容完整性：无标题且无正文不入库（§2.3）
 *  - 任务互斥（-3）、取消、汇总事件
 *
 * ⚠ Mock 形状纪律（2026-10-03 P0 反哺）：urlCollector.collect 桩返回**真实 UrlCollector.collect
 * 的返回形状**（{success,title,content,coverImage,description,publishTime,source}），
 * 复制 zhihu-favlist.test.js 既有先例 + test-setup 的 Module._load axios 拦截，全程零真出站。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const registerHandlers = require("./zhihu-favlist");
const BatchRateController = require("../services/batch-rate-controller");

const axiosStub = { get: vi.fn(), post: vi.fn() };
global.__registerMock("axios", axiosStub);

/** 真实形状的成功采集结果（与 electron/services/url-collector.js collect() 契约一致） */
function realShapeCollectResult (over = {}) {
  return {
    success: true,
    title: "测试标题",
    content: "这是正文内容，长度必须足够。".repeat(3),
    coverImage: "https://picx.zhimg.com/cover.jpg",
    description: "描述",
    publishTime: "2026-10-03",
    source: "zhihu",
    ...over,
  };
}

function makeDeps (overrides = {}) {
  const handlers = {};
  const ipcMain = { handle: (ch, fn) => { handlers[ch] = fn } };
  const store = { getSetting: vi.fn(() => "test-secret") };
  const urlCollector = { collect: vi.fn(async () => realShapeCollectResult()) };
  const pythonBridge = { requestBackend: vi.fn(async () => ({ result_content: "改写后的正文" })) };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn(), notify: vi.fn() };
  const rateControllerFactory = (opts) => new BatchRateController({ sleepFn: async () => {}, baseIntervalMs: 1, jitterMs: 0, ...opts });
  return { ipcMain, handlers, deps: { store, urlCollector, pythonBridge, log, rateControllerFactory, ...overrides } };
}

/** 收集 webContents.send 推送 */
function makeEvent () {
  const sends = [];
  return { sender: { send: vi.fn((ch, payload) => sends.push({ ch, payload })) }, sends };
}

const ITEM = (url, kind) => ({ url, kind, title: `t-${url}`, favTime: 1 });

describe("zhihu-fav-batch run 通道", () => {
  let handlers;
  let deps;
  let event;

  beforeEach(() => {
    axiosStub.get.mockReset();
    axiosStub.post.mockReset();
    registerHandlers._resetFavBatchStateForTest();
    const ctx = makeDeps();
    handlers = ctx.handlers;
    deps = ctx.deps;
    event = makeEvent();
    registerHandlers(ctx.ipcMain, ctx.deps);
  });

  it("注册 zhihu-fav-batch:run 与 cancel 通道", () => {
    expect(handlers["zhihu-fav-batch:run"]).toBeTypeOf("function");
    expect(handlers["zhihu-fav-batch:cancel"]).toBeTypeOf("function");
  });

  it("缺 items / items 非数组 / 空数组 → code -2", async () => {
    expect((await handlers["zhihu-fav-batch:run"](null, {})).code).toBe(-2);
    expect((await handlers["zhihu-fav-batch:run"](null, { items: "x" })).code).toBe(-2);
    expect((await handlers["zhihu-fav-batch:run"](null, { items: [] })).code).toBe(-2);
  });

  it("items 超 100 条 → code -2（PRD §2.3 勾选上限）", async () => {
    const items = Array.from({ length: 101 }, (_, i) => ITEM(`https://zhuanlan.zhihu.com/p/${i}`, "article"));
    const r = await handlers["zhihu-fav-batch:run"](null, { items });
    expect(r.code).toBe(-2);
  });

  it("采集+自动改写成功：start/done 双边界各恰一次，结果带 rewrittenContent", async () => {
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.code).toBe(0);
    expect(r.data.completed).toBe(1);
    expect(r.data.failed).toBe(0);
    expect(r.data.rewriteFailed).toBe(0);
    expect(r.data.duplicateSkipped).toBe(0);
    expect(r.data.items).toHaveLength(1);
    expect(r.data.items[0].rewrittenContent).toBe("改写后的正文");
    // 双边界：start 在采集前、done 在后，各恰一次
    const prog = event.sends.filter((s) => s.ch === "zhihu-fav-batch:progress");
    const phases = prog.map((s) => s.payload.phase);
    expect(phases.filter((p) => p === "start")).toHaveLength(1);
    expect(phases.filter((p) => p === "done")).toHaveLength(1);
    expect(phases.indexOf("start")).toBeLessThan(phases.indexOf("done"));
    expect(phases[phases.length - 1]).toBe("summary");
    // 改写请求确实发生且带风格
    expect(deps.pythonBridge.requestBackend).toHaveBeenCalledTimes(1);
    expect(deps.pythonBridge.requestBackend.mock.calls[0][2]).toMatchObject({ style: "轻松易懂", length: "keep" });
  });

  it("改写失败 → 条目保留原文 + rewriteFailed 计数（Q26C）", async () => {
    deps.pythonBridge.requestBackend.mockRejectedValueOnce(new Error("rewrite boom"));
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.code).toBe(0);
    expect(r.data.completed).toBe(1);
    expect(r.data.rewriteFailed).toBe(1);
    expect(r.data.items[0].content).toContain("正文内容");
    expect(r.data.items[0].rewrittenContent).toBeUndefined();
    expect(r.data.items[0].rewriteFailed).toBe(true);
  });

  it("改写返回空 result_content → 同样判失败保原文", async () => {
    deps.pythonBridge.requestBackend.mockResolvedValueOnce({ result_content: "" });
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.data.rewriteFailed).toBe(1);
    expect(r.data.items[0].rewriteFailed).toBe(true);
  });

  // ── 改写失败必须可诊断（2026-10-17，用户实测反馈「改写失败用原文」看不到原因）──
  // 旧实现 `catch {}` 把真实异常吞掉，用户只看到失败、不知道是后端没起还是接口报错。
  it("改写抛异常 → 原因摘要落在条目 rewriteError + done 事件带 rewriteError（Q26C-D）", async () => {
    deps.pythonBridge.requestBackend.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:8010"));
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.data.rewriteFailed).toBe(1);
    const item = r.data.items[0];
    expect(item.rewriteFailed).toBe(true);
    // 原因摘要必须落条目（截断到 200 字符以内），且包含真实错误关键字
    expect(typeof item.rewriteError).toBe("string");
    expect(item.rewriteError.length).toBeGreaterThan(0);
    expect(item.rewriteError.length).toBeLessThanOrEqual(200);
    expect(item.rewriteError).toContain("ECONNREFUSED");
    // done 事件同步带原因，进度行才显示得出来（进度事件经 event.sends 收集，与本文件其他用例同式）
    const prog = event.sends.filter((s) => s.ch === "zhihu-fav-batch:progress");
    const doneEv = prog.map((s) => s.payload).filter((p) => p.phase === "done").pop();
    expect(doneEv.result.rewriteFailed).toBe(true);
    expect(doneEv.result.rewriteError).toContain("ECONNREFUSED");
  });

  it("改写返回空 result_content → rewriteError 说明「空结果」而不是笼统失败", async () => {
    deps.pythonBridge.requestBackend.mockResolvedValueOnce({ result_content: "" });
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    const item = r.data.items[0];
    expect(item.rewriteFailed).toBe(true);
    expect(item.rewriteError).toContain("空");
  });

  it("改写成功 → 条目不得带 rewriteError 字段（避免旧数据误标）", async () => {
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.data.rewriteFailed).toBe(0);
    expect(r.data.items[0].rewriteError).toBeUndefined();
  });

  // ── QM-6 评审 #1/#6 回归锁（2026-10-17）：摘要脱敏 + 非 Error 抛出值可读 ──
  it("rewriteError 内网端点脱敏：127.*/localhost:port 替换为通用说法，原文只在日志", async () => {
    deps.pythonBridge.requestBackend.mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1:8010"));
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    const err = r.data.items[0].rewriteError;
    expect(err).not.toMatch(/127\.\d+\.\d+\.\d+/);
    expect(err).not.toMatch(/:\d{2,5}/);
    expect(err).toContain("后端服务");
    expect(deps.log.warn).toHaveBeenCalled(); // 完整原文保留在日志侧
  });

  it("非 Error 抛出值（对象/字符串）也能产出可读摘要，不出现 [object Object]", async () => {
    deps.pythonBridge.requestBackend.mockRejectedValueOnce({ code: -1, message: "后端返回错误码" });
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    const err = r.data.items[0].rewriteError;
    expect(err).not.toContain("[object Object]");
    expect(err).toContain("后端返回错误码");
  });

  it("视频型条目：跳过采集与改写，登记 kind=video（B4）", async () => {
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://www.zhihu.com/zvideo/1", "video")],
    });
    expect(r.code).toBe(0);
    expect(r.data.completed).toBe(1);
    expect(deps.urlCollector.collect).not.toHaveBeenCalled();
    expect(deps.pythonBridge.requestBackend).not.toHaveBeenCalled();
    expect(r.data.items[0]).toMatchObject({ kind: "video", title: "t-https://www.zhihu.com/zvideo/1" });
  });

  it("想法条目：仅登记不采集正文（B3）", async () => {
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://www.zhihu.com/pin/1", "pin")],
    });
    expect(r.data.completed).toBe(1);
    expect(deps.urlCollector.collect).not.toHaveBeenCalled();
    expect(r.data.items[0].kind).toBe("pin");
  });

  it("已采集条目默认跳过（duplicateSkipped）且 forceRecollect 重采（C2）", async () => {
    deps.urlCollector.collect
      .mockResolvedValueOnce(realShapeCollectResult())
      .mockResolvedValueOnce(realShapeCollectResult({ title: "重采标题" }));
    const item = ITEM("https://zhuanlan.zhihu.com/p/1", "article");
    const r1 = await handlers["zhihu-fav-batch:run"](event, { items: [item] });
    expect(r1.data.duplicateSkipped).toBe(0);
    const r2 = await handlers["zhihu-fav-batch:run"](event, { items: [item] });
    expect(r2.data.duplicateSkipped).toBe(1);
    expect(r2.data.completed).toBe(0);
    const r3 = await handlers["zhihu-fav-batch:run"](event, { items: [item], forceRecollect: true });
    expect(r3.data.duplicateSkipped).toBe(0);
    expect(r3.data.completed).toBe(1);
    expect(r3.data.items[0].title).toBe("重采标题");
    expect(r3.data.items[0].id).toBe(r1.data.items[0].id); // 覆盖保留原 id
  });

  it("cache_hit 防空壳：无 title 且无 content 的采集结果计入失败（C2/§2.3）", async () => {
    deps.urlCollector.collect.mockResolvedValueOnce({ success: true, reason: "cache_hit", title: "", content: "" });
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.data.failed).toBe(1);
    expect(r.data.completed).toBe(0);
    expect(r.data.items).toHaveLength(0);
  });

  it("任务互斥：进行中再发起 → code -3", async () => {
    let secondPromise = null;
    let releaseGate = null;
    const gate = new Promise((resolve) => { releaseGate = resolve; });
    deps.urlCollector.collect.mockImplementation(async () => {
      // 第一个任务挂起期间发起第二个任务，应立即被 -3 拒绝
      secondPromise = handlers["zhihu-fav-batch:run"](event, { items: [ITEM("https://zhuanlan.zhihu.com/p/2", "article")] });
      await gate;
      return realShapeCollectResult();
    });
    const firstPromise = handlers["zhihu-fav-batch:run"](event, { items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")] });
    const second = await secondPromise;
    expect(second.code).toBe(-3);
    releaseGate();
    const first = await firstPromise;
    expect(first.code).toBe(0);
  });

  it("cancel 通道：无任务 → data false", async () => {
    const r = await handlers["zhihu-fav-batch:cancel"](null, {});
    expect(r.code).toBe(0);
    expect(r.data).toBe(false);
  });

  it("取消：取消后汇总含 cancelled 标记", async () => {
    deps.urlCollector.collect.mockImplementation(async () => {
      await handlers["zhihu-fav-batch:cancel"](null, {});
      return realShapeCollectResult();
    });
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article"), ITEM("https://zhuanlan.zhihu.com/p/2", "article")],
    });
    expect(r.code).toBe(0);
    expect(r.data.cancelled).toBe(true);
  });

  it("图片本地化：成功时 images 为本地路径数组 + imageFallbacks 空（C1）", async () => {
    const imageLocalizer = { localize: vi.fn(async (u) => `D:\\tmp\\img-${u.slice(-6)}.jpg`) };
    const ctx = makeDeps({ imageLocalizer });
    registerHandlers(ctx.ipcMain, ctx.deps);
    ctx.deps.urlCollector.collect.mockResolvedValueOnce(realShapeCollectResult({
      imageUrls: ["https://pic1.zhimg.com/a.jpg", "https://pic2.zhimg.com/b.jpg"],
    }));
    const r = await ctx.handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(imageLocalizer.localize).toHaveBeenCalledTimes(2);
    expect(r.data.items[0].images).toHaveLength(2);
    expect(r.data.items[0].imageFallbacks).toEqual([]);
  });

  it("图片下载部分失败：失败图进 imageFallbacks 回退原链（C1）", async () => {
    const imageLocalizer = { localize: vi.fn(async (u) => u.includes("bad") ? null : "D:\\tmp\\img-ok.jpg") };
    const ctx = makeDeps({ imageLocalizer });
    registerHandlers(ctx.ipcMain, ctx.deps);
    ctx.deps.urlCollector.collect.mockResolvedValueOnce(realShapeCollectResult({
      imageUrls: ["https://pic1.zhimg.com/ok.jpg", "https://pic2.zhimg.com/bad.jpg"],
    }));
    const r = await ctx.handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.data.items[0].images).toEqual(["D:\\tmp\\img-ok.jpg"]);
    expect(r.data.items[0].imageFallbacks).toEqual(["https://pic2.zhimg.com/bad.jpg"]);
  });

  it("imageLocalization=false：不触发下载，images 为空数组", async () => {
    deps.urlCollector.collect.mockResolvedValueOnce(realShapeCollectResult({
      imageUrls: ["https://pic1.zhimg.com/a.jpg"],
    }));
    const imageLocalizer = { localize: vi.fn() };
    const ctx = makeDeps({ imageLocalizer });
    registerHandlers(ctx.ipcMain, ctx.deps);
    const r = await ctx.handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
      imageLocalization: false,
    });
    expect(imageLocalizer.localize).not.toHaveBeenCalled();
    expect(r.data.items[0].images).toEqual([]);
  });

  it("无 imageUrls 字段（默认图片关闭）→ images 空数组不报错", async () => {
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.data.items[0].images).toEqual([]);
    expect(r.data.items[0].imageFallbacks).toEqual([]);
  });

  it("未注入 imageLocalizer：默认图片关闭，imageUrls 被忽略", async () => {
    deps.urlCollector.collect.mockResolvedValueOnce(realShapeCollectResult({
      imageUrls: ["https://pic1.zhimg.com/a.jpg"],
    }));
    const r = await handlers["zhihu-fav-batch:run"](event, {
      items: [ITEM("https://zhuanlan.zhihu.com/p/1", "article")],
    });
    expect(r.data.items[0].images).toEqual([]);
  });

  it("unified-contents 通道：多收藏夹合并 + favlistsCapped 如实上报", async () => {
    axiosStub.get.mockImplementation(async (url, config) => {
      if (url.endsWith("/user/favlists")) {
        return { data: { Code: 0, Data: { Items: [
          { UrlToken: "f1", Title: "夹一", Url: "https://www.zhihu.com/collections/f1" },
          { UrlToken: "f2", Title: "夹二", Url: "https://www.zhihu.com/collections/f2" },
        ] } } };
      }
      if (url.includes("favlist_contents")) {
        // service 经 config.params 传 FavlistUrlToken（非 URL 查询串）
        const token = config && config.params && config.params.FavlistUrlToken;
        return { data: { Code: 0, Data: { Items: [
          { ContentType: "article", Url: `https://zhuanlan.zhihu.com/p/${token}-1`, Title: "T", FavTime: token === "f1" ? 200 : 300 },
        ], Paging: { IsEnd: true, Totals: 1 } } } };
      }
      throw new Error("unexpected url " + url);
    });
    const r = await handlers["zhihu-favlist:unified-contents"](null, { count: 50 });
    expect(r.code).toBe(0);
    expect(r.data.items).toHaveLength(2);
    // favTime 降序：f2(300) 在前
    expect(r.data.items[0].url).toContain("f2");
    expect(r.data.items[0].kind).toBe("article");
    expect(r.data.favlistsCapped).toBe(false);
    expect(r.data.truncated).toBe(false);
  });

  it("unified-contents：未配置 Secret → code -1 且不出站", async () => {
    deps.store.getSetting.mockReturnValueOnce("");
    const r = await handlers["zhihu-favlist:unified-contents"](null, {});
    expect(r.code).toBe(-1);
    expect(axiosStub.get).not.toHaveBeenCalled();
  });

  it("unified-contents：count 截断标记 truncated", async () => {
    axiosStub.get.mockImplementation(async (url) => {
      if (url.endsWith("/user/favlists")) {
        return { data: { Code: 0, Data: { Items: [
          { UrlToken: "g1", Title: "夹", Url: "https://www.zhihu.com/collections/g1" },
        ] } } };
      }
      if (url.includes("favlist_contents")) {
        return { data: { Code: 0, Data: { Items: [
          { ContentType: "article", Url: "https://zhuanlan.zhihu.com/p/a", Title: "a", FavTime: 3 },
          { ContentType: "article", Url: "https://zhuanlan.zhihu.com/p/b", Title: "b", FavTime: 2 },
          { ContentType: "article", Url: "https://zhuanlan.zhihu.com/p/c", Title: "c", FavTime: 1 },
        ], Paging: { IsEnd: true, Totals: 3 } } } };
      }
      throw new Error("unexpected url " + url);
    });
    const r = await handlers["zhihu-favlist:unified-contents"](null, { count: 2 });
    expect(r.data.items).toHaveLength(2);
    expect(r.data.truncated).toBe(true);
    expect(r.data.totalBeforeCut).toBe(3);
  });
});
