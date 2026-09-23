import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";

import { config as __vtuConfig } from '@vue/test-utils'
import { createI18n as __createI18n } from 'vue-i18n'
import __zhLocale from '@/locales/zh'
import __enLocale from '@/locales/en'
__vtuConfig.global.plugins = [
  ...(__vtuConfig.global.plugins || []),
  __createI18n({
    legacy: false,
    locale: 'zh',
    fallbackLocale: 'en',
    messages: { zh: __zhLocale, en: __enLocale },
  }),
]
import { nextTick } from "vue";

vi.mock("@/api/publisher", () => ({
  keywordStatus: vi.fn(),
  keywordStart: vi.fn(),
  keywordStop: vi.fn(),
  keywordHistory: vi.fn()
}));

vi.mock("../components/UiModal.vue", () => ({
  default: {
    name: "UiModal",
    template: '<div class="ui-modal-mock"><slot /></div>',
    props: ["visible", "title"]
  }
}));

vi.mock("element-plus", () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn() }
}));

import { keywordStatus, keywordStart, keywordHistory } from "@/api/publisher";
import KeywordMonitorPanel from "./KeywordMonitorPanel.vue";

describe("KeywordMonitorPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state", async () => {
    keywordStatus.mockImplementation(() => new Promise(() => {}));
    const w = mount(KeywordMonitorPanel);
    await nextTick();
    expect(w.text()).toContain("加载中");
  });

  it("shows empty state after load", async () => {
    keywordStatus.mockResolvedValue({ code: 0, data: [] });
    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("尚未添加监测关键词");
  });

  it("displays keywords after load", async () => {
    keywordStatus.mockResolvedValue({
      code: 0,
      data: [
        { keyword: "AI技术", lastChecked: "2026-07-04 10:00", samples: 120 },
        { keyword: "机器学习", lastChecked: "2026-07-04 09:00", samples: 85 }
      ]
    });
    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("AI技术");
    expect(w.text()).toContain("机器学习");
    expect(w.text()).toContain("监测中");
  });

  it("adds keyword via input and button", async () => {
    keywordStatus.mockResolvedValue({ code: 0, data: [] });
    keywordStart.mockResolvedValue({ code: 0 });

    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();

    const input = w.find("input");
    await input.setValue("新关键词");
    await nextTick();

    const addBtn = w.findAll("button").filter(b => b.text().includes("添加"));
    await addBtn[0].trigger("click");
    await new Promise(r => setTimeout(r, 10));
    await nextTick();

    expect(keywordStart).toHaveBeenCalledWith("新关键词", { interval: 6, threshold: 50 });
  });

  it("opens history modal on button click", async () => {
    keywordStatus.mockResolvedValue({
      code: 0,
      data: [{ keyword: "测试关键词", lastChecked: "2026-07-04", samples: 10 }]
    });
    keywordHistory.mockResolvedValue({
      code: 0,
      data: [{ checkedAt: "2026-07-04 10:00", totalMentions: 5, topEngagement: 100 }]
    });

    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();

    const historyBtns = w.findAll("button").filter(b => b.text().includes("查看历史"));
    await historyBtns[0].trigger("click");
    await new Promise(r => setTimeout(r, 10));
    await nextTick();

    expect(keywordHistory).toHaveBeenCalledWith("测试关键词");
  });


describe("KeywordMonitorPanel — extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("addKeyword warns on empty input", async () => {
    keywordStatus.mockResolvedValue({ code: 0, data: [] });
    const { ElMessage } = await import("element-plus");
    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    // Add empty keyword
    w.vm.addKeyword();
    expect(ElMessage.warning).toHaveBeenCalledWith("请输入关键词");
  });

  it("addKeyword warns on duplicate keyword", async () => {
    keywordStatus.mockResolvedValue({ code: 0, data: [{ keyword: "existing" }] });
    const { ElMessage } = await import("element-plus");
    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    w.vm.newKeyword = "existing";
    await w.vm.addKeyword();
    expect(ElMessage.warning).toHaveBeenCalledWith("该关键词已在监测列表中");
  });

  it("addKeyword warns when max 20 reached", async () => {
    const manyKeywords = Array.from({ length: 20 }, (_, i) => ({ keyword: "kw" + i }));
    keywordStatus.mockResolvedValue({ code: 0, data: manyKeywords });
    const { ElMessage } = await import("element-plus");
    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    w.vm.newKeyword = "overflow";
    await w.vm.addKeyword();
    expect(ElMessage.warning).toHaveBeenCalledWith("最多添加 20 个关键词");
  });

  it("addKeyword handles API error", async () => {
    keywordStatus.mockResolvedValue({ code: 0, data: [] });
    keywordStart.mockRejectedValue(new Error("API timeout"));
    const { ElMessage } = await import("element-plus");
    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    w.vm.newKeyword = "test";
    await w.vm.addKeyword();
    expect(ElMessage.error).toHaveBeenCalled();
  });

  it("stopKeyword calls keywordStop", async () => {
    keywordStatus.mockResolvedValue({ code: 0, data: [{ keyword: "test" }] });
    keywordStart.mockResolvedValue({ code: 0 });
    const mocks = await import("@/api/publisher");
    mocks.keywordStop.mockResolvedValue({ code: 0 });
    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    await w.vm.stopKeyword("test");
    expect(mocks.keywordStop).toHaveBeenCalledWith("test");
  });

  it("openHistory with empty result shows empty state", async () => {
    keywordStatus.mockResolvedValue({ code: 0, data: [{ keyword: "test" }] });
    keywordHistory.mockResolvedValue({ code: 0, data: [] });
    const w = mount(KeywordMonitorPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    await w.vm.openHistory("test");
    expect(w.vm.historyVisible).toBe(true);
    expect(w.vm.historyEntries).toEqual([]);
  });
});

});