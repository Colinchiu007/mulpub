// @ts-check
/**
 * ZhihuFavlistService 回归测试 — 知乎官方收藏夹 API 客户端
 *
 * 覆盖：列表/内容获取、分页遍历、错误码归一化（30001/30002）、
 * 网络异常、数据校验（空 secret/空 token/Url 缺失跳过）、headers 构造。
 * axios 经构造函数注入 mock（vi.mock 拦不住 CJS require，依赖注入是唯一可靠方式）。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const ZhihuFavlistService = require("./zhihu-favlist-service");

function makeMockAxios (responses) {
  // responses: 数组，每次 get 依次消费一项；单项可为 { data } 或抛错
  const calls = [];
  const axios = {
    get: vi.fn(async (url, config) => {
      calls.push({ url, config });
      const next = responses.shift();
      if (!next) throw new Error("no more mock responses");
      if (next instanceof Error) throw next;
      return next;
    }),
  };
  return { axios, calls };
}

function okBody (items, paging) {
  return { data: { Code: 0, Message: "", Data: { Items: items, ...(paging ? { Paging: paging } : {}) } } };
}

describe("ZhihuFavlistService", () => {
  let svc;
  let log;

  beforeEach(() => {
    log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  });

  describe("listFavlists", () => {
    it("成功：Code=0 + Items 2 条 → favlists 映射正确", async () => {
      const { axios } = makeMockAxios([okBody([
        { UrlToken: 111, Title: "收藏夹A", Description: "描述A", IsPublic: true, Url: "https://www.zhihu.com/collections/111" },
        { UrlToken: 222, Title: "收藏夹B", Description: "", IsPublic: false, Url: "https://www.zhihu.com/collections/222" },
      ])]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.listFavlists("secret-xxx");
      expect(r.success).toBe(true);
      expect(r.favlists).toHaveLength(2);
      expect(r.favlists[0]).toMatchObject({ urlToken: 111, title: "收藏夹A", isPublic: true });
      expect(r.favlists[1]).toMatchObject({ urlToken: 222, title: "收藏夹B", isPublic: false });
    });

    it("Code!=0 → success: false", async () => {
      const { axios } = makeMockAxios([{ data: { Code: 500, Message: "internal error" } }]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.listFavlists("secret");
      expect(r.success).toBe(false);
      expect(r.error).toContain("500");
    });

    it("无 secret → 友好错误", async () => {
      svc = new ZhihuFavlistService({ log });
      const r = await svc.listFavlists("");
      expect(r.success).toBe(false);
      expect(r.error).toContain("Access Secret");
    });

    it("空列表 → success: true + favlists: []", async () => {
      const { axios } = makeMockAxios([okBody([])]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.listFavlists("secret");
      expect(r.success).toBe(true);
      expect(r.favlists).toEqual([]);
    });
  });

  describe("getFavlistContents", () => {
    it("单页（IsEnd=true）→ items 正确", async () => {
      const { axios } = makeMockAxios([okBody([
        { ContentType: "article", Url: "https://zhuanlan.zhihu.com/p/1", Title: "文章1", Summary: "摘要", FavTime: 1700000000, LikeCount: 10 },
        { ContentType: "answer", Url: "https://www.zhihu.com/question/1/answer/2", Title: "回答1", FavTime: 1700000001, LikeCount: 5 },
      ], { IsEnd: true, NextOffset: "2", Totals: 2 })]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.getFavlistContents("secret", "111");
      expect(r.success).toBe(true);
      expect(r.items).toHaveLength(2);
      expect(r.items[0]).toMatchObject({ contentType: "article", url: "https://zhuanlan.zhihu.com/p/1" });
      expect(r.totals).toBe(2);
    });

    it("多页（3 页翻页）→ 累计正确 + onProgress 被调 3 次", async () => {
      const mk = (n, isEnd) => okBody(
        Array.from({ length: n }, (_, i) => ({ ContentType: "article", Url: `https://zhuanlan.zhihu.com/p/${i}-${Date.now()}`, Title: "T" })),
        { IsEnd: isEnd, NextOffset: String(n), Totals: n * 3 }
      );
      const { axios } = makeMockAxios([mk(2, false), mk(2, false), mk(2, true)]);
      svc = new ZhihuFavlistService({ axios, log });
      const onProgress = vi.fn();
      const r = await svc.getFavlistContents("secret", "111", { onProgress });
      expect(r.success).toBe(true);
      expect(r.items).toHaveLength(6);
      expect(onProgress).toHaveBeenCalledTimes(3);
    });

    it("30001 频率限制 → retryable: true", async () => {
      const { axios } = makeMockAxios([{ data: { Code: 30001, Message: "rate limited" } }]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.getFavlistContents("secret", "111");
      expect(r.success).toBe(false);
      expect(r.retryable).toBe(true);
      expect(r.error).toContain("频率限制");
    });

    it("30002 配额 → 配额提示", async () => {
      const { axios } = makeMockAxios([{ data: { Code: 30002, Message: "quota exceeded" } }]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.getFavlistContents("secret", "111");
      expect(r.success).toBe(false);
      expect(r.error).toContain("配额");
    });

    it("网络异常 → 网络错误", async () => {
      const { axios } = makeMockAxios([new Error("connect ECONNREFUSED")]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.getFavlistContents("secret", "111");
      expect(r.success).toBe(false);
      expect(r.error).toContain("网络连接失败");
    });

    it("maxPages 保护（设 2，模拟 3 页数据）→ 只取 2 页", async () => {
      const mk = (n, isEnd) => okBody(
        Array.from({ length: n }, (_, i) => ({ ContentType: "article", Url: `https://zhuanlan.zhihu.com/p/mp${i}${Math.random()}`, Title: "T" })),
        { IsEnd: isEnd, NextOffset: String(n), Totals: 99 }
      );
      const { axios } = makeMockAxios([mk(2, false), mk(2, false), mk(2, true)]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.getFavlistContents("secret", "111", { maxPages: 2 });
      expect(r.success).toBe(true);
      expect(r.items).toHaveLength(4); // 2 页 × 2 条
    });

    it("item Url 缺失 → 跳过该条不中断", async () => {
      const { axios } = makeMockAxios([okBody([
        { ContentType: "article", Url: "https://zhuanlan.zhihu.com/p/ok1", Title: "有URL" },
        { ContentType: "article", Title: "无URL应跳过" },
        { ContentType: "article", Url: "https://zhuanlan.zhihu.com/p/ok2", Title: "有URL2" },
      ], { IsEnd: true, Totals: 3 })]);
      svc = new ZhihuFavlistService({ axios, log });
      const r = await svc.getFavlistContents("secret", "111");
      expect(r.success).toBe(true);
      expect(r.items).toHaveLength(2);
    });

    it("空 token → 缺少收藏夹标识", async () => {
      svc = new ZhihuFavlistService({ log });
      const r = await svc.getFavlistContents("secret", "");
      expect(r.success).toBe(false);
      expect(r.error).toContain("收藏夹标识");
    });
  });

  describe("headers 构造", () => {
    it("Bearer + 秒级时间戳 + Content-Type", () => {
      svc = new ZhihuFavlistService({ log });
      const h = svc._buildHeaders("my-secret");
      expect(h.Authorization).toBe("Bearer my-secret");
      expect(h["Content-Type"]).toBe("application/json");
      const ts = Number(h["X-Request-Timestamp"]);
      expect(Number.isFinite(ts)).toBe(true);
      expect(Math.abs(ts - Math.floor(Date.now() / 1000))).toBeLessThan(5);
    });
  });
});
