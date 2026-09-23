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

vi.mock("../components/UiModal.vue", () => ({
  default: {
    name: "UiModal",
    template: '<div class="ui-modal-mock"><slot /></div>',
    props: ["visible", "title", "width", "closeOnClickModal", "destroyOnClose"]
  }
}));

// Mock @/api/publisher 模块（组件通过 import 调用，不再用全局注入）
vi.mock("@/api/publisher", () => ({
  intelligenceFindReferences: vi.fn()
}));

import { intelligenceFindReferences } from "@/api/publisher";
import ReferenceFinder from "./ReferenceFinder.vue";

describe("ReferenceFinder", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows initial empty state", async () => {
    const w = mount(ReferenceFinder, {
      props: { visible: true, searchText: "" }
    });
    await nextTick();
    expect(w.text()).toContain("\u8f93\u5165\u5173\u952e\u8bcd\u641c\u7d22\u6743\u5a01\u6765\u6e90");
  });

  it("shows searching state", async () => {
    vi.mocked(intelligenceFindReferences).mockImplementation(() => new Promise(() => {}));
    const w = mount(ReferenceFinder, {
      props: { visible: true, searchText: "" }
    });
    await nextTick();
    const input = w.find("input");
    await input.setValue("AI\u6280\u672f");
    await nextTick();
    const searchBtn = w.findAll("button").filter(b => b.text().includes("\u641c\u7d22"));
    await searchBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("\u641c\u7d22\u4e2d");
  });

  it("shows no results state", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({ code: 0, data: { references: [] } });
    const w = mount(ReferenceFinder, {
      props: { visible: true, searchText: "" }
    });
    await nextTick();
    const input = w.find("input");
    await input.setValue("\u4e0d\u5b58\u5728\u7684\u5173\u952e\u8bcd");
    await nextTick();
    const searchBtn = w.findAll("button").filter(b => b.text().includes("\u641c\u7d22"));
    await searchBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("\u672a\u627e\u5230\u76f8\u5173\u6765\u6e90");
  });

  it("shows results after search", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({
      code: 0,
      data: {
        references: [
          { title: "AI\u6280\u672f\u53d1\u5c55\u8d8b\u52bf", url: "https://example.com/ai", source: "\u77e5\u4e4e", engagement: "1.2k", snippet: "\u4eba\u5de5\u667a\u80fd\u6280\u672f\u6b63\u5728\u5feb\u901f\u53d1\u5c55...", relevance: 45 },
          { title: "\u6df1\u5ea6\u5b66\u4e60\u5165\u95e8", url: "https://example.com/dl", source: "CSDN", engagement: "856", snippet: "\u6df1\u5ea6\u5b66\u4e60\u662f\u673a\u5668\u5b66\u4e60\u7684\u4e00\u4e2a\u5206\u652f...", relevance: 30 },
        ]
      }
    });
    const w = mount(ReferenceFinder, {
      props: { visible: true, searchText: "" }
    });
    await nextTick();
    const input = w.find("input");
    await input.setValue("AI\u6280\u672f");
    await nextTick();
    const searchBtn = w.findAll("button").filter(b => b.text().includes("\u641c\u7d22"));
    await searchBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("AI\u6280\u672f\u53d1\u5c55\u8d8b\u52bf");
    expect(w.text()).toContain("\u6df1\u5ea6\u5b66\u4e60\u5165\u95e8");
    expect(w.text()).toContain("\u77e5\u4e4e");
    expect(w.text()).toContain("CSDN");
  });

  it("auto-searches when visible flips to true with searchText", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({
      code: 0,
      data: {
        references: [
          { title: "\u673a\u5668\u5b66\u4e60", url: "https://example.com/ml", source: "\u77e5\u4e4e", engagement: "2k", snippet: "\u673a\u5668\u5b66\u4e60\u6982\u8ff0...", relevance: 50 }
        ]
      }
    });
    // Mount not visible first, then flip to visible
    const w = mount(ReferenceFinder, {
      props: { visible: false, searchText: "\u673a\u5668\u5b66\u4e60" }
    });
    await nextTick();
    await w.setProps({ visible: true });
    await nextTick();
    expect(intelligenceFindReferences).toHaveBeenCalledWith("\u673a\u5668\u5b66\u4e60", { limit: 5 });
  });

  it("emits insert-reference on insert button click", async () => {
    vi.mocked(intelligenceFindReferences).mockResolvedValue({
      code: 0,
      data: {
        references: [
          { title: "\u6d4b\u8bd5\u6587\u7ae0", url: "https://example.com/test", source: "\u77e5\u4e4e", engagement: "100", snippet: "\u6d4b\u8bd5\u5185\u5bb9", relevance: 40 }
        ]
      }
    });
    const w = mount(ReferenceFinder, {
      props: { visible: false, searchText: "\u6d4b\u8bd5" }
    });
    await nextTick();
    await w.setProps({ visible: true });
    await nextTick();
    // Wait for async search to complete
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    const insertBtn = w.findAll("button").filter(b => b.text().includes("\u63d2\u5165"));
    expect(insertBtn.length).toBeGreaterThan(0);
    await insertBtn[0].trigger("click");
    expect(w.emitted("insert-reference")).toBeTruthy();
    expect(w.emitted("insert-reference")[0][0]).toMatchObject({
      title: "\u6d4b\u8bd5\u6587\u7ae0",
      url: "https://example.com/test"
    });
  });
});
