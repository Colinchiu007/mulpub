import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/api/publisher", () => ({
  viralAnalyze: vi.fn().mockResolvedValue({ code: 0, data: { overall_score: 8.5, factors: [] } }),
  viralGenerate: vi.fn().mockResolvedValue({ code: 0, data: { task: "titles", data: { titles: [] } } }),
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
    expect(w.vm.trendIcon("rising")).toBe("\ud83d\udcc8");
    expect(w.vm.trendIcon("declining")).toBe("\ud83d\udcc9");
    expect(w.vm.trendIcon("stable")).toBe("\u27a1\ufe0f");
    expect(w.vm.trendIcon("unknown")).toBe("\u27a1\ufe0f");
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
    expect(w.vm.scoreColor(0.8)).toBe("#e74c3c");
    expect(w.vm.scoreColor(0.7)).toBe("#e74c3c");
    expect(w.vm.scoreColor(0.5)).toBe("#e67e22");
    expect(w.vm.scoreColor(0.4)).toBe("#e67e22");
    expect(w.vm.scoreColor(0.3)).toBe("#95a5a6");
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

  it("doGenerate skips setting genResult on API error", async () => {
    const { viralGenerate } = await import("@/api/publisher");
    viralGenerate.mockResolvedValue({ code: -1, message: "generate failed" });
    const w = createView();
    await nextTick();
    w.vm.topic = "AI";
    await w.vm.doGenerate();
    // genResult only set on success
    expect(w.vm.genResult).toBeNull();
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
}));

import { addViralToLibrary } from "@/api/knowledge-library";

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
    expect(item.source).toBe("manual");
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
