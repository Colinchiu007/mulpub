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
import { setActivePinia, createPinia } from "pinia";

const mockStore = vi.hoisted(() => ({
  load: vi.fn(),
  byCategory: {}
}));

vi.mock("@/stores/templates", () => ({
  useTemplateStore: () => mockStore
}));

import TemplatePicker from "./TemplatePicker.vue";

describe("TemplatePicker", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {
      templateGetPresets: vi.fn(),
      templateAdd: vi.fn()
    };
    mockStore.byCategory = {};
    mockStore.load.mockReset();
  });

  it("shows loading state when store.load is pending", async () => {
    mockStore.load.mockImplementation(() => new Promise(() => {}));
    const w = mount(TemplatePicker);
    await nextTick();
    // 统一骨架屏：加载态改为骨架（文案只保留给辅助技术）
    expect(w.find('[data-testid="template-picker-loading"]').exists()).toBe(true);
    expect(w.findAll(".mp-skeleton-surface").length).toBeGreaterThan(0);
  });

  it("shows empty state after load when no templates", async () => {
    const w = mount(TemplatePicker);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("暂无模板");
    expect(w.text()).toContain("恢复默认模板");
  });

  it("displays templates by category", async () => {
    mockStore.byCategory = {
      social: [
        { id: 1, name: "微博短文", title: "测试标题", content: "正文", platforms: [], builtin: true },
        { id: 2, name: "知乎回答", title: "回答标题", content: "回答正文", platforms: ["zhihu"], builtin: false }
      ],
      report: [
        { id: 3, name: "周报", title: "周报标题", content: "周报正文", platforms: ["weixin"], builtin: true }
      ]
    };
    const w = mount(TemplatePicker);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("微博短文");
    expect(w.text()).toContain("知乎回答");
    expect(w.text()).toContain("周报");
    expect(w.text()).toContain("社交");
    expect(w.text()).toContain("报告");
    expect(w.text()).toContain("内置");
  });

  it("emits apply on template click", async () => {
    mockStore.byCategory = {
      social: [
        { id: 1, name: "微博短文", title: "测试标题", content: "测试正文", platforms: ["weibo"], tags: ["科技"], builtin: true }
      ]
    };
    const w = mount(TemplatePicker);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    const templateItem = w.find(".template-item");
    await templateItem.trigger("click");
    expect(w.emitted("apply")).toBeTruthy();
    expect(w.emitted("apply")[0][0]).toMatchObject({
      title: "测试标题",
      content: "测试正文"
    });
  });

  it("restores defaults on reset button click", async () => {
    window.electronAPI.templateGetPresets.mockResolvedValue({
      code: 0,
      data: [{ name: "新闻稿", content: "正文" }]
    });
    window.electronAPI.templateAdd.mockResolvedValue({ code: 0 });
    const w = mount(TemplatePicker);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    const resetBtn = w.findAll("button").filter(b => b.text().includes("恢复默认模板"));
    await resetBtn[0].trigger("click");
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(window.electronAPI.templateGetPresets).toHaveBeenCalled();
    expect(window.electronAPI.templateAdd).toHaveBeenCalled();
  });

  it("emits close on close button click", async () => {
    const w = mount(TemplatePicker);
    await nextTick();
    await w.find(".cohere-btn-ghost").trigger("click");
    expect(w.emitted("close")).toBeTruthy();
  });
});