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
  intelligenceFetchTrending: vi.fn()
}));

import { intelligenceFetchTrending } from "@/api/publisher";
import TrendingPanel from "./TrendingPanel.vue";

describe("TrendingPanel", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("shows loading state", async () => {
    vi.mocked(intelligenceFetchTrending).mockImplementation(() => new Promise(() => {}));
    const w = mount(TrendingPanel);
    await nextTick();
    expect(w.text()).toContain("\u52a0\u8f7d\u4e2d");
  });

  it("shows error state with retry", async () => {
    vi.mocked(intelligenceFetchTrending).mockRejectedValue(new Error("\u7f51\u7edc\u9519\u8bef"));
    const w = mount(TrendingPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("\u7f51\u7edc\u9519\u8bef");
    expect(w.text()).toContain("\u91cd\u65b0\u52a0\u8f7d");
  });

  it("retries on reload button click", async () => {
    vi.mocked(intelligenceFetchTrending).mockRejectedValueOnce(new Error("\u9996\u6b21\u5931\u8d25"));
    vi.mocked(intelligenceFetchTrending).mockResolvedValueOnce([]);
    const w = mount(TrendingPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    // Click retry button
    const retryBtn = w.findAll("button").filter(b => b.text().includes("\u91cd\u65b0\u52a0\u8f7d"));
    await retryBtn[0].trigger("click");
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(intelligenceFetchTrending).toHaveBeenCalledTimes(2);
  });

  it("shows empty state", async () => {
    vi.mocked(intelligenceFetchTrending).mockResolvedValue([]);
    const w = mount(TrendingPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("\u6682\u65e0\u70ed\u95e8\u5185\u5bb9");
  });

  it("displays trending items", async () => {
    vi.mocked(intelligenceFetchTrending).mockResolvedValue([
      { title: "AI breakthrough", source: "reddit", url: "https://reddit.com/r/ai", upvotes: 1200, comments: 340, engagementScore: 4.5 },
      { title: "New JS framework", source: "github", url: "https://github.com/test", upvotes: 800, comments: 50, engagementScore: 2.3 },
    ]);
    const w = mount(TrendingPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("AI breakthrough");
    expect(w.text()).toContain("New JS framework");
    expect(w.text()).toContain("reddit");
    expect(w.text()).toContain("github");
    expect(w.text()).toContain("1200");
    expect(w.text()).toContain("800");
  });

  it("filters by source tab", async () => {
    vi.mocked(intelligenceFetchTrending).mockResolvedValue([
      { title: "Reddit post", source: "reddit", url: "https://reddit.com/r/test", upvotes: 100, comments: 10, engagementScore: 1.0 },
      { title: "HN post", source: "hackernews", url: "https://news.ycombinator.com/item?id=1", upvotes: 200, comments: 20, engagementScore: 2.0 },
    ]);
    const w = mount(TrendingPanel);
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("Reddit post");
    expect(w.text()).toContain("HN post");
    // Click HN filter tab
    const hnBtn = w.findAll("button").filter(b => b.text().includes("HN"));
    await hnBtn[0].trigger("click");
    await nextTick();
    expect(w.text()).toContain("HN post");
    expect(w.text()).not.toContain("Reddit post");
  });
});
