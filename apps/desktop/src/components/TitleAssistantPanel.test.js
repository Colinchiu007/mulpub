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
  intelligenceSearchTitles: vi.fn()
}));

import { intelligenceSearchTitles } from "@/api/publisher";
import TitleAssistantPanel from "./TitleAssistantPanel.vue";

describe("TitleAssistantPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows empty state when not visible", () => {
    const w = mount(TitleAssistantPanel, { props: { visible: false, title: "" } });
    expect(w.find(".title-assistant").exists()).toBe(false);
  });

  it("shows waiting state when visible but no title", async () => {
    const w = mount(TitleAssistantPanel, { props: { visible: true, title: "" } });
    await nextTick();
    expect(w.text()).toContain("输入标题后自动分析");
  });

  it("shows loading state", async () => {
    intelligenceSearchTitles.mockImplementation(() => new Promise(() => {}));
    const w = mount(TitleAssistantPanel, { props: { visible: true, title: "" } });
    await nextTick();
    await w.setProps({ title: "测试标题内容" });
    await new Promise(r => setTimeout(r, 900));
    await nextTick();
    expect(w.text()).toContain("正在分析同类标题");
  });

  it("shows error state", async () => {
    intelligenceSearchTitles.mockRejectedValue(new Error("网络错误"));
    const w = mount(TitleAssistantPanel, { props: { visible: true, title: "" } });
    await nextTick();
    await w.setProps({ title: "测试标题内容" });
    await new Promise(r => setTimeout(r, 900));
    await nextTick();
    expect(w.text()).toContain("搜索失败");
  });

  it("displays title analysis results", async () => {
    intelligenceSearchTitles.mockResolvedValue({
      code: 0,
      data: {
        titleAnalysis: {
          patterns: [["AI", 4], ["技术", 3]],
          suggestion: { tip: "建议使用数字增强吸引力" }
        },
        results: [
          { id: 1, title: "2024 AI发展趋势", engagement: 3.2, source: "reddit" },
          { id: 2, title: "深度学习入门指南", engagement: 1.5, source: "github" }
        ]
      }
    });
    const w = mount(TitleAssistantPanel, { props: { visible: true, title: "" } });
    await nextTick();
    await w.setProps({ title: "AI技术" });
    await new Promise(r => setTimeout(r, 900));
    await nextTick();
    expect(w.text()).toContain("建议使用数字增强吸引力");
    expect(w.text()).toContain("AI");
    expect(w.text()).toContain("2024 AI发展趋势");
    expect(w.text()).toContain("深度学习入门指南");
    expect(w.text()).toContain("Reddit");
    expect(w.text()).toContain("GitHub");
  });

  it("emits close on close button click", async () => {
    const w = mount(TitleAssistantPanel, { props: { visible: true, title: "测试" } });
    await nextTick();
    await w.find(".cohere-btn-ghost").trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });

  it("clears data when visible becomes false", async () => {
    intelligenceSearchTitles.mockResolvedValue({
      code: 0,
      data: {
        titleAnalysis: { patterns: [], suggestion: { tip: "测试" } },
        results: [{ id: 1, title: "测试标题", engagement: 1.0, source: "reddit" }]
      }
    });
    const w = mount(TitleAssistantPanel, { props: { visible: true, title: "" } });
    await nextTick();
    await w.setProps({ title: "测试标题" });
    await new Promise(r => setTimeout(r, 900));
    await nextTick();
    expect(w.text()).toContain("测试标题");
    await w.setProps({ visible: false });
    await nextTick();
    expect(w.find(".title-assistant").exists()).toBe(false);
  });
});