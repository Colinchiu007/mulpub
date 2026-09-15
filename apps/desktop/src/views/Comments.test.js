import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    getLabel: (k) => k,
  })
}));

import CommentsView from "./Comments.vue";
import i18n from "@/i18n";

describe("CommentsView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  function createView() {
    return mount(CommentsView, { global: { plugins: [createPinia(), i18n] } });
  }

  it("renders page title", async () => {
    const w = createView();
    await nextTick();
    expect(w.text()).toContain("\u8bc4\u8bba\u7ba1\u7406");
  });

  it("shows select platform hint when no platform selected", async () => {
    const w = createView();
    await nextTick();
    expect(w.text()).toContain("\u9009\u62e9\u5e73\u53f0");
  });

  it("platformName returns correct name for known platforms", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.platformName("wechat_mp")).toBe("\u5fae\u4fe1\u516c\u4f17\u53f7");
    expect(w.vm.platformName("zhihu")).toBe("\u77e5\u4e4e");
    expect(w.vm.platformName("douyin")).toBe("\u6296\u97f3");
    expect(w.vm.platformName("youtube")).toBe("YouTube");
  });

  it("platformName returns id for unknown platform", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.platformName("unknown_platform")).toBe("unknown_platform");
  });

  it("loadPlatforms loads platforms from electronAPI", async () => {
    window.electronAPI.platformList = vi.fn().mockResolvedValue({
      code: 0,
      data: [
        { id: "zhihu", name: "\u77e5\u4e4e", comment_url: "https://zhihu.com/comments" },
        { id: "weibo", name: "\u5fae\u535a", comment_url: null },
      ]
    });
    const w = createView();
    await nextTick();
    await w.vm.loadPlatforms();
    // Only platforms with comment_url are included
    expect(w.vm.platforms.length).toBe(1);
    expect(w.vm.platforms[0].id).toBe("zhihu");
  });

  it("loadPlatforms handles missing API gracefully", async () => {
    window.electronAPI = {};
    const w = createView();
    await nextTick();
    await w.vm.loadPlatforms();
    expect(w.vm.platforms).toEqual([]);
  });

  it("loadPlatforms ignores API errors", async () => {
    window.electronAPI.platformList = vi.fn().mockRejectedValue(new Error("fail"));
    const w = createView();
    await nextTick();
    await w.vm.loadPlatforms();
    expect(w.vm.platforms).toEqual([]);
  });

  it("openPlatform sets activePlatform and opens a tab via pageManager", async () => {
    window.electronAPI = {
      pageManager: {
        createNewTabPage: vi.fn().mockResolvedValue({ code: 0, data: { tabId: "btab-1" } })
      }
    };
    const w = createView();
    await nextTick();
    const platform = { id: "zhihu", name: "\u77e5\u4e4e", comment_url: "https://zhihu.com/comments" };
    await w.vm.openPlatform(platform);
    expect(w.vm.activePlatform).toBe("zhihu");
    expect(w.vm.commentUrl).toBe("https://zhihu.com/comments");
    expect(window.electronAPI.pageManager.createNewTabPage).toHaveBeenCalledWith(
      expect.objectContaining({ platform: "zhihu", url: "https://zhihu.com/comments" })
    );
    expect(w.vm.currentTabId).toBe("btab-1");
  });

  it("openPlatform closes previous tab before opening new one", async () => {
    window.electronAPI = {
      pageManager: {
        closeTab: vi.fn().mockResolvedValue({ code: 0 }),
        createNewTabPage: vi.fn().mockResolvedValue({ code: 0, data: { tabId: "btab-2" } })
      }
    };
    const w = createView();
    await nextTick();
    w.vm.currentTabId = "btab-1";
    const platform = { id: "weibo", name: "\u5fae\u535a", comment_url: "https://weibo.com/comments" };
    await w.vm.openPlatform(platform);
    expect(window.electronAPI.pageManager.closeTab).toHaveBeenCalledWith("btab-1");
    expect(window.electronAPI.pageManager.createNewTabPage).toHaveBeenCalled();
  });

  it("openPlatform handles platform without comment_url", async () => {
    window.electronAPI = {
      pageManager: {
        createNewTabPage: vi.fn().mockResolvedValue({ code: 0, data: { tabId: "t1" } })
      }
    };
    const w = createView();
    await nextTick();
    const platform = { id: "weibo", name: "\u5fae\u535a", comment_url: null };
    await w.vm.openPlatform(platform);
    expect(w.vm.activePlatform).toBe("weibo");
    expect(w.vm.commentUrl).toBe("");
    expect(window.electronAPI.pageManager.createNewTabPage).not.toHaveBeenCalled();
  });

  it("openPlatform handles unavailable pageManager gracefully", async () => {
    window.electronAPI = {};
    const w = createView();
    await nextTick();
    await w.vm.openPlatform({ id: "test", name: "Test", comment_url: "https://x.com/comments" });
    expect(w.vm.activePlatform).toBe("test");
    expect(w.vm.currentTabId).toBeNull();
  });
});
