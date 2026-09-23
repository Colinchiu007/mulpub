// @ts-check
/**
 * P2 技术债（audit-batch-4）：UrlCollector 浏览器采集的「脆弱等待」条件化
 *
 * 原实现：page.goto 之后固定 `await page.waitForTimeout(2000)`，注释却写着
 * 「等待内容容器出现（最多 10s）」。固定盲等两头都错——慢站点 2s 内正文没渲染完
 * （解析出空正文/短正文），快站点白等 2s。改为 waitForFunction 条件轮询：
 * 判据 = readyState 完成 + 候选正文容器（或 body）文本长度达标；
 * 上限 10s、间隔 250ms；超时仅告警并按当前 DOM 继续采集（不新增失败路径）。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";

const UrlCollector = (await import("./url-collector")).default;

// 注：vitest 转换后 import.meta.url 不是 file:  scheme，固定用 __dirname 取源码
const SRC = fs.readFileSync(path.resolve("./electron/services/url-collector.js"), "utf8");
const PAGE_WAIT_SRC = fs.readFileSync(
  path.resolve("./electron/services/url-collector-page-wait.js"),
  "utf8",
);

describe("UrlCollector._waitForContentReady —— 条件轮询替代固定 sleep", () => {
  let collector;
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();
    logger = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
    collector = new UrlCollector({ auditDir: null, log: logger });
  });

  it("条件命中时按上限/间隔参数调用 waitForFunction，并返回 true", async () => {
    const page = { waitForFunction: vi.fn(async () => undefined) };
    await expect(collector._waitForContentReady(page)).resolves.toBe(true);

    const call = page.waitForFunction.mock.calls[0];
    expect(typeof call[0]).toBe("function");
    expect(call[1]).toMatchObject({ minLen: 200 });
    expect(Array.isArray(call[1].selectors)).toBe(true);
    expect(call[1].selectors.length).toBeGreaterThan(0);
    expect(call[2]).toMatchObject({ timeout: 10000, polling: 250 });
    expect(logger.warn).not.toHaveBeenCalled();
  });

  it("等待超时：记一条含判据的 warn 并返回 false（采集不因等待加固而新增失败）", async () => {
    const page = { waitForFunction: vi.fn(async () => { throw new Error("TimeoutError") }) };
    await expect(collector._waitForContentReady(page)).resolves.toBe(false);
    expect(logger.warn).toHaveBeenCalledTimes(1);
    const [, msg] = logger.warn.mock.calls[0];
    expect(msg).toContain("content-ready 条件等待超时 10000ms");
  });

  it("page 不支持 waitForFunction 时静默降级（不抛，返回 false）", async () => {
    await expect(collector._waitForContentReady({})).resolves.toBe(false);
    await expect(collector._waitForContentReady(null)).resolves.toBe(false);
  });

  describe("就绪判据本身（在 Node 侧用假 document 执行浏览器探针函数）", () => {
    const originalDocument = globalThis.document;

    afterEach(() => {
      if (originalDocument === undefined) delete globalThis.document;
      else globalThis.document = originalDocument;
    });

    async function getProbe () {
      const page = { waitForFunction: vi.fn(async () => undefined) };
      await collector._waitForContentReady(page);
      const call = page.waitForFunction.mock.calls[0];
      return { probe: call[0], opts: { ...call[1], selectors: ["article"] } };
    }

    function fakeDoc ({ readyState = "complete", articleText = "", bodyText = "" } = {}) {
      return {
        readyState,
        body: { innerText: bodyText },
        querySelectorAll: (sel) => (sel === "article" && articleText ? [{ innerText: articleText }] : []),
      };
    }

    it("readyState 未完成一律判否", async () => {
      const { probe, opts } = await getProbe();
      globalThis.document = fakeDoc({ readyState: "loading", articleText: "x".repeat(500) });
      expect(probe(opts)).toBe(false);
    });

    it("正文容器文本达阈值判是（哪怕导航尚未完全静止）", async () => {
      const { probe, opts } = await getProbe();
      globalThis.document = fakeDoc({ articleText: "内".repeat(220) });
      expect(probe(opts)).toBe(true);
    });

    it("无匹配容器时退化用 body 长度（>=20 倍阈值）判定", async () => {
      const { probe, opts } = await getProbe();
      globalThis.document = fakeDoc({ bodyText: "长".repeat(4000) });
      expect(probe(opts)).toBe(true);
      const short = fakeDoc({ bodyText: "短".repeat(300) });
      globalThis.document = short;
      expect(probe(opts)).toBe(false);
    });
  });

  it("防复发静态不变量：浏览器采集路径不得再出现 page.waitForTimeout 盲等", () => {
    expect(SRC).not.toMatch(/page\.waitForTimeout\(/);
    expect(SRC).toMatch(/await this\._waitForContentReady\(page\)/);
    // 拆出去的等待实现同样不得回退成盲等
    expect(PAGE_WAIT_SRC).not.toMatch(/waitForTimeout\(/);
    // 拆分守护：主文件只保留委托入口，实现必须在独立模块里（守住逐文件行数门禁）
    expect(SRC).toMatch(/require\('\.\/url-collector-page-wait'\)/);
    expect(PAGE_WAIT_SRC).toMatch(/waitForFunction\(contentReadyProbe/);
  });
});
