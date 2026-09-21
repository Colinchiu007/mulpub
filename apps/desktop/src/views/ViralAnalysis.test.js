import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/api/publisher", () => ({
  viralAnalyze: vi.fn().mockResolvedValue({ code: 0, data: { overall_score: 8.5, factors: [] } }),
  viralGenerate: vi.fn().mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [] } } }),
  viralTrending: vi.fn().mockResolvedValue({ code: 0, data: { keywords: [] } }),
  getRecentImpactSnapshots: vi.fn().mockResolvedValue({ code: 0, data: [] }),
}));

import ViralAnalysisView from "./ViralAnalysis.vue";
import zhMessages from "@/locales/zh";

// 按点路径解析 zh 文案；未命中回退 key（手动数据示例需真实 JSON，不能只拿 key）
function tZh(key) {
  const v = String(key).split(".").reduce((o, k) => (o && typeof o === "object" && o[k] !== undefined) ? o[k] : undefined, zhMessages);
  return typeof v === "string" ? v : key;
}

describe("ViralAnalysisView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  function createView() {
    return mount(ViralAnalysisView, {
      global: {
        plugins: [createPinia()],
        // viral-rewrite-integration 新模板段使用 $t；未装 i18n 插件的旧用例以 mock 兜底避免渲染报错
        mocks: { $t: (key) => tZh(key) },
      },
    });
  }

  it("renders page title", async () => {
    const w = createView();
    await nextTick();
    expect(w.text()).toContain("\u7206\u6b3e\u5206\u6790");
  });

  it("trendIcon returns correct icon for each direction", async () => {
    const w = createView();
    await nextTick();
    // T1-5：趋势图标改为返回 @element-plus/icons-vue 组件对象（模板 <component :is> 渲染）
    expect(typeof w.vm.trendIcon("rising")).toBe("object");
    expect(w.vm.trendIcon("rising")).not.toBe(w.vm.trendIcon("declining"));
    expect(w.vm.trendIcon("unknown")).toBeTruthy();
  });

  it("trendLabel returns correct label for each direction", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.trendLabel("rising")).toBe("\u4e0a\u5347\u4e2d");
    expect(w.vm.trendLabel("declining")).toBe("\u4e0b\u964d\u4e2d");
    expect(w.vm.trendLabel("stable")).toBe("\u5e73\u7a33");
    expect(w.vm.trendLabel("unknown")).toBe("unknown");
  });

  it("scoreColor returns color based on score threshold", async () => {
    const w = createView();
    await nextTick();
    // T1-3a：分值色收编 tokens.css（--color-score-*），方法返回变量引用
    expect(w.vm.scoreColor(0.8)).toBe("var(--color-score-high)");
    expect(w.vm.scoreColor(0.7)).toBe("var(--color-score-high)");
    expect(w.vm.scoreColor(0.5)).toBe("var(--color-score-mid)");
    expect(w.vm.scoreColor(0.4)).toBe("var(--color-score-mid)");
    expect(w.vm.scoreColor(0.3)).toBe("var(--color-score-low)");
  });

  it("doAnalyze validates non-empty topic", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    const w = createView();
    await nextTick();
    w.vm.topic = "";
    await w.vm.doAnalyze();
    expect(viralAnalyze).not.toHaveBeenCalled();
  });

  it("doAnalyze calls viralAnalyze with articles", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    viralAnalyze.mockResolvedValue({ code: 0, data: { overall_score: 8.5, factors: [{ name: "test", label: "Test", score: 0.8 }] } });
    const w = createView();
    await nextTick();
    w.vm.topic = "AI trends";
    await w.vm.doAnalyze();
    expect(viralAnalyze).toHaveBeenCalled();
    expect(w.vm.result.overall_score).toBe(8.5);
    expect(w.vm.loading).toBe(false);
  });

  it("doAnalyze parses custom article data", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    w.vm.articleData = '[{"title":"AI","like_count":500,"comment_count":30}]';
    await w.vm.doAnalyze();
    expect(viralAnalyze).toHaveBeenCalledWith(
      [{ title: "AI", like_count: 500, comment_count: 30 }],
      "AI"
    );
  });

  it("doAnalyze handles API error", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    viralAnalyze.mockResolvedValue({ code: -1, message: "analysis failed" });
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doAnalyze();
    expect(w.vm.result.error).toBe("analysis failed");
  });

  it("doAnalyze catches exception", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    viralAnalyze.mockRejectedValue(new Error("network error"));
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doAnalyze();
    expect(w.vm.result.error).toEqual(expect.stringContaining("\u7f51\u7edc"));
  });

  it("doGenerate validates non-empty topic", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    const w = createView();
    await nextTick();
    w.vm.topic = "";
    await w.vm.doGenerate();
    expect(viralGenerate).not.toHaveBeenCalled();
  });

  it("doGenerate calls viralGenerate with options", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [{ title: "Test Title", structure: "list", emotion: "curiosity" }] } } });
    const w = createView();
    await nextTick();
    w.vm.topic = "AI tools";
    w.vm.platform = "\u5c0f\u7ea2\u4e66";
    await w.vm.doGenerate();
    expect(viralGenerate).toHaveBeenCalledWith({
      topic: "AI tools",
      platform: "\u5c0f\u7ea2\u4e66",
      task: "titles",
      count: 5,
    });
    expect(w.vm.genResult).toBeTruthy();
    expect(w.vm.loading).toBe(false);
  });

  it("doGenerate surfaces API error in genResult.error instead of swallowing", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: -1, message: "generate failed" });
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    // 回归（2026-09-21）：旧行为非 0 code 静默丢弃，用户看不到任何反馈
    expect(w.vm.genResult).toBeTruthy();
    expect(w.vm.genResult.error).toContain("generate failed");
    await nextTick();
    expect(w.find("[data-testid='viral-generate-error']").exists()).toBe(true);
  });

  it("generate result renders independently without prior analysis", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [{ title: "独立生成标题", structure: "悬念式提问" }] } } });
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    // 回归：旧模板 genResult 嵌在 v-if="result" 内，只点「生成文案」不点「爆款分析」时永不展示
    expect(w.vm.result).toBeNull();
    await nextTick();
    expect(w.text()).toContain("独立生成标题");
    expect(w.find("[data-testid='viral-analysis-empty']").exists()).toBe(false);
  });

  it("analyze error renders visible error banner, not bare zero score", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    viralAnalyze.mockResolvedValue({ code: -3, errorCode: "AUTH_REQUIRED", message: "当前许可证无权访问该功能，请先登录并确认账号已开通所需权益后重试。" });
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doAnalyze();
    await nextTick();
    // 回归（本次 CDP e2e 实测根因）：AUTH_REQUIRED 必须以友好文案可见，不再只剩裸 0 分
    const banner = w.find("[data-testid='viral-analyze-error']");
    expect(banner.exists()).toBe(true);
    expect(banner.text().length).toBeGreaterThan(0);
    expect(w.text()).not.toContain("0 爆款潜力分");
  });

  it("titleText/factorPct/fmtScore tolerate malformed payloads", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.titleText("纯字符串")).toBe("纯字符串");
    expect(w.vm.titleText({ title: "对象标题" })).toBe("对象标题");
    expect(w.vm.titleText(null)).toBe("");
    expect(w.vm.factorPct({ score: 0.75 })).toBe(75);
    expect(w.vm.factorPct({ score: 66 })).toBe(66);
    expect(w.vm.factorPct({ score: "abc" })).toBe(0);
    expect(w.vm.factorPct({})).toBe(0);
    expect(w.vm.factorPct({ score: 5 })).toBe(5);
    expect(w.vm.factorPct({ score: 150 })).toBe(100);
    expect(w.vm.fmtScore(88.86)).toBe("88.9");
    expect(w.vm.fmtScore(88.8)).toBe("88.8");
    expect(w.vm.fmtScore("x")).toBe("-");
    expect(w.vm.fmtScore(undefined)).toBe("-");
  });

  it("string-array titles (legacy local fallback shape) still render", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: ["旧契约字符串标题"] } } });
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    await nextTick();
    expect(w.text()).toContain("旧契约字符串标题");
  });

  it("doGenerate catches exception", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockRejectedValue(new Error("network error"));
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    expect(w.vm.genResult.error).toEqual(expect.stringContaining("\u7f51\u7edc"));
  });

  it("initial data values are correct", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.topic).toBe("");
    expect(w.vm.platform).toBe("\u901a\u7528");
    expect(w.vm.loading).toBe(false);
    expect(w.vm.result).toBeNull();
    expect(w.vm.genResult).toBeNull();
    expect(w.vm.articleDataError).toBe("");
  });

  // ── 手动文章数据 UX 优化（2026-09-21）：示例填入 + 格式错误可见化 ──

  it("manual data section exposes a fill-sample button", async () => {
    const w = createView();
    await nextTick();
    expect(w.find("[data-testid='viral-fill-sample']").exists()).toBe(true);
  });

  it("fillSampleData inserts realistic multi-article JSON sample", async () => {
    const w = createView();
    await nextTick();
    w.vm.fillSampleData();
    const parsed = JSON.parse(w.vm.articleData);
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBeGreaterThanOrEqual(3);
    for (const a of parsed) {
      expect(typeof a.title).toBe("string");
      expect(a.title.length).toBeGreaterThan(4);
      expect(typeof a.like_count).toBe("number");
      expect(typeof a.comment_count).toBe("number");
    }
    // 预设示例必须是模拟真实内容，不得残留占位测试文本
    expect(w.vm.articleData).not.toMatch(/test topic|alpha|beta/i);
  });

  it("doAnalyze surfaces malformed article data instead of silently ignoring", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    w.vm.articleData = "{bad json";
    await w.vm.doAnalyze();
    // 回归：旧行为静默吞掉格式错误，用户以为在用真实数据分析
    expect(viralAnalyze).not.toHaveBeenCalled();
    expect(w.vm.articleDataError).toBeTruthy();
    expect(w.vm.loading).toBe(false);
    await nextTick();
    expect(w.find("[data-testid='viral-article-data-error']").exists()).toBe(true);
  });

  it("doAnalyze rejects non-array JSON and empty array", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    w.vm.articleData = '{"title":"x"}';
    await w.vm.doAnalyze();
    expect(viralAnalyze).not.toHaveBeenCalled();
    expect(w.vm.articleDataError).toBeTruthy();
    w.vm.articleData = "[]";
    await w.vm.doAnalyze();
    expect(viralAnalyze).not.toHaveBeenCalled();
    expect(w.vm.articleDataError).toBeTruthy();
  });

  it("article data error clears after fixing input", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    w.vm.articleData = "{bad";
    await w.vm.doAnalyze();
    expect(w.vm.articleDataError).toBeTruthy();
    w.vm.articleData = '[{"title":"AI","like_count":5,"comment_count":1}]';
    await w.vm.doAnalyze();
    expect(w.vm.articleDataError).toBe("");
    expect(viralAnalyze).toHaveBeenCalled();
  });

  it("fillSampleData output passes validation and reaches analyze", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    const w = createView();
    await nextTick();
    w.vm.topic = "AI工具";
    w.vm.fillSampleData();
    await w.vm.doAnalyze();
    expect(w.vm.articleDataError).toBe("");
    expect(viralAnalyze).toHaveBeenCalled();
    const sent = viralAnalyze.mock.calls[0][0];
    expect(Array.isArray(sent)).toBe(true);
    expect(sent.length).toBeGreaterThanOrEqual(3);
  });
});

// ── viral-rewrite-integration：分析结果落库 + 生成标题去改写 ──
vi.mock("@/api/knowledge-library", () => ({
  addViralToLibrary: vi.fn().mockResolvedValue({ code: 0, data: { id: "v1" } }),
  listViralItems: vi.fn().mockResolvedValue({ code: 0, data: { items: [], total: 0 } }),
  searchViralItems: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  listPatternCards: vi.fn().mockResolvedValue({ code: 0, data: { items: [], total: 0 } }),
  listPatternPerformance: vi.fn().mockResolvedValue({ code: 0, data: { items: [] } }),
}));

import { addViralToLibrary, listViralItems } from "@/api/knowledge-library";

describe("ViralAnalysisView viral integration", () => {
  const pushMock = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  function createView2() {
    return mount(ViralAnalysisView, {
      global: {
        plugins: [createPinia()],
        mocks: {
          $t: (key, params) => key + (params ? JSON.stringify(params) : ""),
          $router: { push: pushMock },
        },
      },
    });
  }

  it("saveToLibrary builds item and calls addViralToLibrary", async () => {
    const w = createView2();
    await nextTick();
    w.vm.topic = "AI 工具";
    w.vm.analyzedTopic = "AI 工具";
    w.vm.platform = "小红书";
    w.vm.result = {
      overall_score: 72,
      trend_direction: "rising",
      suggested_angles: ["深度解析", "避坑指南"],
      rising_keywords: [{ word: "AI" }, { word: "效率" }],
      factors: [{ name: "engagement", label: "互动热度", score: 0.7 }],
    };
    await w.vm.saveToLibrary();
    expect(addViralToLibrary).toHaveBeenCalledTimes(1);
    const item = addViralToLibrary.mock.calls[0][0];
    expect(item.title).toBe("AI 工具");
    expect(item.source).toBe("analysis");
    expect(item.platform).toBe("小红书");
    expect(item.content).toContain("AI 工具");
    expect(item.content.length).toBeGreaterThan(0);
    expect(item.tags).toEqual(expect.arrayContaining(["小红书", "深度解析", "避坑指南", "AI", "效率"]));
    expect(w.vm.savedToLibrary).toBe(true);
    expect(w.vm.savingLibrary).toBe(false);
  });

  it("saveToLibrary skips when no result", async () => {
    const w = createView2();
    await nextTick();
    await w.vm.saveToLibrary();
    expect(addViralToLibrary).not.toHaveBeenCalled();
  });

  it("saveToLibrary skips when analyzedTopic empty (topic edited after analyze)", async () => {
    const w = createView2();
    await nextTick();
    w.vm.result = { overall_score: 60 };
    w.vm.analyzedTopic = "";
    await w.vm.saveToLibrary();
    expect(addViralToLibrary).not.toHaveBeenCalled();
  });

  it("saveToLibrary skips when already saved", async () => {
    const w = createView2();
    await nextTick();
    w.vm.result = { overall_score: 60 };
    w.vm.savedToLibrary = true;
    await w.vm.saveToLibrary();
    expect(addViralToLibrary).not.toHaveBeenCalled();
  });

  it("saveToLibrary shows failure message on API error", async () => {
    addViralToLibrary.mockResolvedValueOnce({ code: -1, message: "db locked" });
    const w = createView2();
    await nextTick();
    w.vm.topic = "AI";
    w.vm.analyzedTopic = "AI";
    w.vm.result = { overall_score: 60 };
    await w.vm.saveToLibrary();
    expect(w.vm.savedToLibrary).toBe(false);
    expect(w.vm.libraryMessage).toBe("db locked");
  });

  it("saveToLibrary shows fallback message on exception", async () => {
    addViralToLibrary.mockRejectedValueOnce(new Error("network down"));
    const w = createView2();
    await nextTick();
    w.vm.topic = "AI";
    w.vm.analyzedTopic = "AI";
    w.vm.result = { overall_score: 60 };
    await w.vm.saveToLibrary();
    expect(w.vm.savedToLibrary).toBe(false);
    expect(w.vm.libraryMessage).toContain("network down");
  });

  it("doAnalyze resets library save state", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    viralAnalyze.mockResolvedValue({ code: 0, data: { overall_score: 50 } });
    const w = createView2();
    await nextTick();
    w.vm.savedToLibrary = true;
    w.vm.libraryMessage = "old message";
    w.vm.topic = "AI";
    await w.vm.doAnalyze();
    expect(w.vm.savedToLibrary).toBe(false);
    expect(w.vm.libraryMessage).toBe("");
  });

  it("goRewrite pushes /rewrite with titleHint query", () => {
    const w = createView2();
    w.vm.goRewrite("AI 工具推荐 TOP5");
    expect(pushMock).toHaveBeenCalledWith({
      path: "/rewrite",
      query: { titleHint: "AI 工具推荐 TOP5" },
    });
  });

  it("goRewrite truncates titleHint over 200 chars", () => {
    const w = createView2();
    w.vm.goRewrite("x".repeat(300));
    expect(pushMock).toHaveBeenCalledWith({
      path: "/rewrite",
      query: { titleHint: "x".repeat(200) },
    });
  });

  it("goRewrite ignores empty/invalid title", () => {
    const w = createView2();
    w.vm.goRewrite("");
    w.vm.goRewrite("   ");
    w.vm.goRewrite(42);
    expect(pushMock).not.toHaveBeenCalled();
  });
});

// ── PR-1 爆款页充分利用：F1 task 分段 / F3 热门选题 / F9 生成区模式徽标 ──
describe("ViralAnalysisView PR-1 (task segment / trending / mode badge)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  function createView3() {
    return mount(ViralAnalysisView, {
      global: {
        plugins: [createPinia()],
        mocks: { $t: (key) => key, $router: { push: vi.fn() } },
      },
    });
  }

  it("F1: setGenTask('hooks') 切 task 并清空旧 genResult（AC1.2）", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", mode: "local-fallback", data: { titles: [] } } });
    const w = createView3();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    expect(w.vm.genResult).toBeTruthy();
    w.vm.setGenTask("hooks");
    expect(w.vm.genTask).toBe("hooks");
    expect(w.vm.genResult).toBeNull();
  });

  it("F1: setGenTask 相同 task 不切换", async () => {
    const w = createView3();
    await nextTick();
    w.vm.genResult = { task: "titles" };
    w.vm.setGenTask("titles");
    expect(w.vm.genTask).toBe("titles");
    expect(w.vm.genResult).toBeTruthy();
  });

  it("F1: setGenTask 拒绝非法 task", async () => {
    const w = createView3();
    await nextTick();
    w.vm.setGenTask("rewrite");
    expect(w.vm.genTask).toBe("titles");
  });

  it("F1: doGenerate 按 genTask=hooks 传参（AC1.1）", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "hooks", data: { hooks: [] } } });
    const w = createView3();
    await nextTick();
    w.vm.topic = "AI tools";
    w.vm.setGenTask("hooks");
    await w.vm.doGenerate();
    expect(viralGenerate).toHaveBeenCalledWith(expect.objectContaining({ task: "hooks" }));
  });

  it("F3: pickTrending 回填 topic，不自动分析", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    const w = createView3();
    await nextTick();
    w.vm.pickTrending("  露营装备  ");
    expect(w.vm.topic).toBe("露营装备");
    expect(viralAnalyze).not.toHaveBeenCalled();
  });

  it("F3: pickTrending 忽略空/非法词", async () => {
    const w = createView3();
    await nextTick();
    w.vm.topic = "原主题";
    w.vm.pickTrending("");
    w.vm.pickTrending("   ");
    w.vm.pickTrending(42);
    expect(w.vm.topic).toBe("原主题");
  });

  it("F3: loadTrending 有数据时填充 trendingKeywords（AC3.1）", async () => {
    const { viralTrending } = await import("@/api/publisher");
    viralTrending.mockResolvedValue({ code: 0, data: { keywords: [{ word: "AI", count: 5 }, { word: "工具", count: 3 }] } });
    listViralItems.mockResolvedValue({ code: 0, data: { items: [{ title: "爆款一", likes: 100, comments: 5, platform: "小红书" }], total: 1 } });
    const w = createView3();
    await w.vm.loadTrending();
    expect(w.vm.trendingKeywords.length).toBe(2);
    expect(w.vm.trendingKeywords[0].word).toBe("AI");
  });

  it("F3: loadTrending 无数据源时静默隐藏（AC3.2）", async () => {
    listViralItems.mockResolvedValue({ code: 0, data: { items: [], total: 0 } });
    const w = createView3();
    w.vm.articleData = "";
    await w.vm.loadTrending();
    expect(w.vm.trendingKeywords).toEqual([]);
  });

  it("F3: loadTrending trending 调用失败静默降级", async () => {
    const { viralTrending } = await import("@/api/publisher");
    viralTrending.mockRejectedValue(new Error("boom"));
    listViralItems.mockResolvedValue({ code: 0, data: { items: [{ title: "x", likes: 1 }], total: 1 } });
    const w = createView3();
    await w.vm.loadTrending();
    expect(w.vm.trendingKeywords).toEqual([]);
  });

  it("F9: 本地兜底生成时渲染模式徽标（AC9.1）", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", mode: "local-fallback", data: { titles: [{ title: "T1", structure: "s" }] } } });
    const w = createView3();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    await nextTick();
    expect(w.find("[data-testid='viral-generate-mode']").exists()).toBe(true);
  });

  it("F9: orchestrator 模式不渲染本地徽标", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", mode: "orchestrator", data: { titles: [{ title: "T1", structure: "s" }] } } });
    const w = createView3();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    await nextTick();
    expect(w.find("[data-testid='viral-generate-mode']").exists()).toBe(false);
  });

  it("F1: 分段控件渲染两个 task 按钮", async () => {
    const w = createView3();
    await nextTick();
    expect(w.find("[data-testid='viral-task-titles']").exists()).toBe(true);
    expect(w.find("[data-testid='viral-task-hooks']").exists()).toBe(true);
  });
});

// ── PR-2：F6 模式命中套用 / F7 爆款库回读 / F8 实测角标 ──
describe("ViralAnalysisView PR-2 (pattern hits / library picker / measured badge)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  function createView4() {
    return mount(ViralAnalysisView, {
      global: {
        plugins: [createPinia()],
        mocks: { $t: (key) => key, $router: { push: vi.fn() } },
      },
    });
  }

  // ── F6 ──

  it("F6: loadPatternHits 取 narrative_structure 维度 top3（AC6.1 数据面）", async () => {
    const { listPatternPerformance, listPatternCards } = await import("@/api/knowledge-library");
    listPatternPerformance.mockResolvedValue({
      code: 0,
      data: { items: [
        { dimension: "narrative_structure", value: "list", sample_count: 8, engagement_score: 72 },
        { dimension: "narrative_structure", value: "contrast", sample_count: 3, engagement_score: 61 },
        { dimension: "narrative_structure", value: "problem_solution", sample_count: 2, engagement_score: 55 },
        { dimension: "narrative_structure", value: "story_lesson", sample_count: 1, engagement_score: 40 },
      ] },
    });
    listPatternCards.mockResolvedValue({ code: 0, data: { items: [{ narrative_structure: "list" }], total: 1 } });
    const w = createView4();
    await w.vm.loadPatternHits();
    expect(listPatternPerformance).toHaveBeenCalledWith(expect.objectContaining({ dimension: "narrative_structure" }));
    expect(w.vm.patternHits.length).toBe(3);
    expect(w.vm.patternHits[0].value).toBe("list");
    expect(w.vm.patternHits[0].sampleCount).toBe(8);
    await nextTick();
    expect(w.findAll("[data-testid='viral-pattern-hit']").length).toBe(3);
  });

  it("F6: 无数据/未登录（code -1）时区块隐藏（AC6.1/Q1 游客闭环）", async () => {
    const { listPatternPerformance } = await import("@/api/knowledge-library");
    listPatternPerformance.mockResolvedValue({ code: -1, data: { items: [] } });
    const w = createView4();
    await w.vm.loadPatternHits();
    expect(w.vm.patternHits).toEqual([]);
    await nextTick();
    expect(w.find("[data-testid='viral-pattern-hits']").exists()).toBe(false);
  });

  it("F6: applyPattern 写入 appliedStructure，doGenerate 携带 structure 枚举（AC6.2）", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [] } } });
    const w = createView4();
    await nextTick();
    w.vm.topic = "AI";
    w.vm.applyPattern({ value: "list", label: "viralAnalysis.narrative.list" });
    expect(w.vm.appliedStructure.value).toBe("list");
    await w.vm.doGenerate();
    expect(viralGenerate).toHaveBeenCalledWith(expect.objectContaining({ structure: "list" }));
  });

  it("F6: 再次点击已套用模式 = 取消，doGenerate 不携带 structure", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [] } } });
    const w = createView4();
    await nextTick();
    w.vm.topic = "AI";
    w.vm.applyPattern({ value: "list" });
    w.vm.applyPattern({ value: "list" });
    expect(w.vm.appliedStructure).toBeNull();
    await w.vm.doGenerate();
    const opts = viralGenerate.mock.calls[0][0];
    expect(opts.structure).toBeUndefined();
  });

  // ── F7 ──

  it("F7: 打开对话框加载爆款库列表（AC7.2 入口）", async () => {
    const { listViralItems } = await import("@/api/knowledge-library");
    listViralItems.mockResolvedValue({ code: 0, data: { items: [{ id: "v1", title: "爆款一", likes: 100, comments: 10, platform: "小红书" }], total: 1 } });
    const w = createView4();
    await w.vm.openLibraryDialog();
    await nextTick();
    expect(w.vm.showLibraryDialog).toBe(true);
    expect(w.vm.libItems.length).toBe(1);
    expect(w.find("[data-testid='viral-lib-item']").exists()).toBe(true);
  });

  it("F7: 选中条目回填 topic 并附加进文章数据（AC7.2）", async () => {
    const { viralAnalyze } = await import("@/api/publisher");
    const w = createView4();
    await nextTick();
    w.vm.articleData = '[{"title":"已有文章","like_count":1,"comment_count":1}]';
    w.vm.pickLibraryItem({ title: "爆款一", likes: 100, comments: 10, platform: "小红书" });
    expect(w.vm.topic).toBe("爆款一");
    expect(w.vm.showLibraryDialog).toBe(false);
    const arts = JSON.parse(w.vm.articleData);
    expect(arts.length).toBe(2);
    expect(arts[1]).toEqual({ title: "爆款一", like_count: 100, comment_count: 10, platform_code: "小红书" });
    viralAnalyze.mockResolvedValue({ code: 0, data: { overall_score: 1 } });
    await w.vm.doAnalyze();
    const sent = viralAnalyze.mock.calls[0][0];
    expect(sent.some(a => a.title === "爆款一")).toBe(true);
  });

  it("F7: 空库时对话框展示引导空态（AC7.1）", async () => {
    const { listViralItems } = await import("@/api/knowledge-library");
    listViralItems.mockResolvedValue({ code: 0, data: { items: [], total: 0 } });
    const w = createView4();
    await w.vm.openLibraryDialog();
    await nextTick();
    expect(w.find("[data-testid='viral-lib-empty']").exists()).toBe(true);
  });

  it("F7: 搜索调用 searchViralItems，选中后清空搜索态", async () => {
    const { searchViralItems } = await import("@/api/knowledge-library");
    searchViralItems.mockResolvedValue({ code: 0, data: [{ id: "v2", title: "搜索结果", likes: 5, comments: 1, platform: "抖音" }] });
    const w = createView4();
    await w.vm.openLibraryDialog();
    w.vm.libQuery = "搜索";
    await w.vm.searchLibrary();
    expect(searchViralItems).toHaveBeenCalledWith("搜索", 30);
    expect(w.vm.libItems.length).toBe(1);
  });

  // ── F8 ──

  it("F8: 生成标题命中实测快照时展示「实测」角标（AC8.1）", async () => {
    const { getRecentImpactSnapshots, viralGenerate } = await import("@/api/publisher");
    getRecentImpactSnapshots.mockResolvedValue({ code: 0, data: [{ title: "AI工具实测标题", total_mentions: 12, top_engagement: 3456 }] });
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [{ title: "AI工具实测标题", structure: "s" }, { title: "无实测的标题", structure: "s" }] } } });
    const w = createView4();
    await w.vm.loadMeasured();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    await nextTick();
    const badges = w.findAll("[data-testid='viral-measured-badge']");
    expect(badges.length).toBe(1);
    expect(w.vm.measuredInfo("AI工具实测标题").topEngagement).toBe(3456);
  });

  it("F8: 无回采数据/未登录（code -1）时零开销隐藏（AC8.2）", async () => {
    const { getRecentImpactSnapshots, viralGenerate } = await import("@/api/publisher");
    getRecentImpactSnapshots.mockResolvedValue({ code: -1, data: [] });
    viralGenerate.mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [{ title: "任意标题", structure: "s" }] } } });
    const w = createView4();
    await w.vm.loadMeasured();
    expect(w.vm.measuredInfo("任意标题")).toBeNull();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    await nextTick();
    expect(w.findAll("[data-testid='viral-measured-badge']").length).toBe(0);
  });

  it("F8: 快照接口抛错静默降级，不炸页面加载", async () => {
    const { getRecentImpactSnapshots } = await import("@/api/publisher");
    getRecentImpactSnapshots.mockRejectedValue(new Error("boom"));
    const w = createView4();
    await expect(w.vm.loadMeasured()).resolves.toBeUndefined();
    expect(w.vm.measuredInfo("x")).toBeNull();
  });
});
