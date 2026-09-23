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

// Mock @/api/publisher 模块（组件通过 import 调用，不再用全局注入）
vi.mock("@/api/publisher", () => ({
  intelligenceGetBenchmark: vi.fn()
}));

import { intelligenceGetBenchmark } from "@/api/publisher";
import BenchmarkChart from "./BenchmarkChart.vue";

const mockBenchmark = {
  benchmark: {
    sampleSize: 100,
    engagement: { avg: 75.3, median: 72.1, top10: 95.0, top25: 85.0 },
    upvotes: { avg: 120, median: 85, top10: 500, top25: 250 },
    comments: { avg: 30, median: 20, top10: 100, top25: 60 },
    topSources: ["\u77e5\u4e4e", "B\u7ad9", "\u5c0f\u7ea2\u4e66"],
    generatedAt: "2026-07-04T12:00:00Z"
  }
};

describe("BenchmarkChart", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(intelligenceGetBenchmark).mockResolvedValue({ code: 0, data: mockBenchmark });
  });

  it("renders loading state initially", async () => {
    vi.mocked(intelligenceGetBenchmark).mockImplementation(() => new Promise(function(r) { /* never resolve */ }));
    const w = mount(BenchmarkChart, { props: { title: "\u6d4b\u8bd5\u6587\u7ae0\u6807\u9898" } });
    await nextTick();
    await new Promise(function(r) { return setTimeout(r, 10); });
    expect(w.text()).toContain("\u52a0\u8f7d");
  });

  it("renders error for short title", async () => {
    const w = mount(BenchmarkChart, { props: { title: "AB" } });
    await nextTick();
    expect(w.text()).toContain("\u6807\u9898\u8fc7\u77ed");
  });

  it("renders benchmark data after fetch", async () => {
    const w = mount(BenchmarkChart, { props: { title: "\u5982\u4f55\u5199\u51fa\u7206\u6b3e\u6587\u7ae0" } });
    await nextTick();
    await new Promise(function(r) { return setTimeout(r, 50); });
    expect(w.text()).toContain("75.3");
    expect(w.text()).toContain("\u77e5\u4e4e");
  });

  it("renders error state when API returns error", async () => {
    vi.mocked(intelligenceGetBenchmark).mockResolvedValue({ code: -1, message: "API \u914d\u989d\u4e0d\u8db3" });
    const w = mount(BenchmarkChart, { props: { title: "\u6d4b\u8bd5\u6587\u7ae0\u6807\u9898" } });
    await nextTick();
    await new Promise(function(r) { return setTimeout(r, 50); });
    expect(w.text()).toContain("\u989d\u5ea6");
  });

  it("renders error state when API throws", async () => {
    vi.mocked(intelligenceGetBenchmark).mockRejectedValue(new Error("\u7f51\u7edc\u9519\u8bef"));
    const w = mount(BenchmarkChart, { props: { title: "\u6d4b\u8bd5\u6587\u7ae0\u6807\u9898" } });
    await nextTick();
    await new Promise(function(r) { return setTimeout(r, 50); });
    expect(w.text()).toContain("\u7f51\u7edc\u9519\u8bef");
  });

  it("renders insufficient data message", async () => {
    vi.mocked(intelligenceGetBenchmark).mockResolvedValue({ code: 0, data: { message: "\u6570\u636e\u4e0d\u8db3" } });
    const w = mount(BenchmarkChart, { props: { title: "\u6d4b\u8bd5\u6587\u7ae0\u6807\u9898" } });
    await nextTick();
    await new Promise(function(r) { return setTimeout(r, 50); });
    expect(w.text()).toContain("\u6570\u636e\u4e0d\u8db3");
  });
});
