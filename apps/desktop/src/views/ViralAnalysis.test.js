import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/api/publisher", () => ({
  viralAnalyze: vi.fn().mockResolvedValue({ code: 0, data: { overall_score: 8.5, factors: [] } }),
  viralGenerate: vi.fn().mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [] } } }),
  viralTrending: vi.fn().mockResolvedValue({ code: 0, data: { keywords: [] } }),
}));

import ViralAnalysisView from "./ViralAnalysis.vue";

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
        mocks: { $t: (key) => key },
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
  });
});

// ── viral-rewrite-integration：分析结果落库 + 生成标题去改写 ──
vi.mock("@/api/knowledge-library", () => ({
  addViralToLibrary: vi.fn().mockResolvedValue({ code: 0, data: { id: "v1" } }),
  listViralItems: vi.fn().mockResolvedValue({ code: 0, data: { items: [], total: 0 } }),
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
