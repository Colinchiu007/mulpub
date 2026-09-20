import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
}));

const pushSpy = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushSpy })
}));


function mountCollection(options) {
  return mount(CollectionView, {
    global: { plugins: [createPinia(), i18n] },
    ...options,
  });
}

import CollectionView from "./Collection.vue";
import i18n from "@/i18n";

describe("CollectionView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  it("renders page title and buttons", async () => {
    const w = mountCollection();
    await nextTick();
    expect(w.text()).toContain("collection.tabCollect");
    expect(w.text()).toContain("新建草稿");
  });

  it("loadDrafts reads from electronAPI on mount", async () => {
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue(JSON.stringify([
        { id: "d1", title: "Saved", content: "hello", source: "manual", created_at: "2026-07-05" }
      ]))
    };
    const w = mountCollection();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(window.electronAPI.storeGetSetting).toHaveBeenCalledWith("drafts");
    expect(w.vm.drafts.length).toBe(1);
    expect(w.vm.drafts[0].title).toBe("Saved");
  });

  it("loadDrafts handles missing API gracefully", async () => {
    window.electronAPI = {};
    const w = mountCollection();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.vm.drafts).toEqual([]);
  });

  it("loadDrafts handles JSON parse failure", async () => {
    window.electronAPI = {
      storeGetSetting: vi.fn().mockResolvedValue("invalid json{{{")
    };
    const w = mountCollection();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.vm.drafts).toEqual([]);
  });

  it("saveDrafts calls electronAPI.storeSetSetting", async () => {
    window.electronAPI = {
      storeSetSetting: vi.fn().mockResolvedValue(undefined)
    };
    const w = mountCollection();
    await nextTick();
    w.vm.drafts = [{ id: "d1", title: "Test" }];
    await w.vm.saveDrafts();
    expect(window.electronAPI.storeSetSetting).toHaveBeenCalledWith("drafts", JSON.stringify([{ id: "d1", title: "Test" }]));
  });

  it("saveDrafts handles missing API gracefully", async () => {
    window.electronAPI = {};
    const w = mountCollection();
    await nextTick();
    w.vm.drafts = [{ id: "d1" }];
    await w.vm.saveDrafts();
    expect(w.vm.drafts.length).toBe(1);
  });

  it("creates a new draft and navigates", async () => {
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    w.vm.createDraft();
    await nextTick();
    expect(w.vm.drafts.length).toBe(1);
    expect(w.vm.drafts[0].source).toBe("manual");
    expect(pushSpy).toHaveBeenCalledWith("/publish?draft=" + w.vm.drafts[0].id);
  });

  it("imports from clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockResolvedValue("Title line\nContent here") },
      writable: true, configurable: true
    });
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    await w.vm.importFromClipboard();
    await nextTick();
    expect(w.vm.drafts.length).toBe(1);
    expect(w.vm.drafts[0].title).toBe("Title line");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("handles clipboard read failure", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockRejectedValue(new Error("denied")) },
      writable: true, configurable: true
    });
    const w = mountCollection();
    await nextTick();
    await w.vm.importFromClipboard();
    await nextTick();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalled();
  });

  it("handles empty clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockResolvedValue("") },
      writable: true, configurable: true
    });
    const w = mountCollection();
    await nextTick();
    await w.vm.importFromClipboard();
    await nextTick();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("openCollection opens a tab via pageManager when dashboard URL is available", async () => {
    const { PLATFORM_DASHBOARD_URLS } = await import("@multi-publish/shared-utils/src/platform-definitions");
    window.electronAPI = {
      pageManager: {
        createNewTabPage: vi.fn().mockResolvedValue({ code: 0, data: { tabId: "btab-1" } })
      }
    };
    const w = mountCollection();
    await nextTick();
    await w.vm.openCollection("weibo");
    expect(window.electronAPI.pageManager.createNewTabPage).toHaveBeenCalledWith(
      expect.objectContaining({ url: PLATFORM_DASHBOARD_URLS.weibo, platform: "weibo" })
    );
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("openCollection warns and skips when platform has no dashboard URL", async () => {
    window.electronAPI = {
      pageManager: {
        createNewTabPage: vi.fn()
      }
    };
    const w = mountCollection();
    await nextTick();
    await w.vm.openCollection("unknown_platform");
    expect(window.electronAPI.pageManager.createNewTabPage).not.toHaveBeenCalled();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("editDraft navigates to publish", async () => {
    const w = mountCollection();
    await nextTick();
    await w.vm.editDraft({ id: "d1" });
    expect(pushSpy).toHaveBeenCalledWith("/publish?draft=d1");
  });

  it("goPublish navigates to publish", async () => {
    const w = mountCollection();
    await nextTick();
    await w.vm.goPublish({ id: "d2" });
    expect(pushSpy).toHaveBeenCalledWith("/publish?draft=d2");
  });

  it("deleteDraft confirms and removes draft", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue(undefined);
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    w.vm.drafts = [{ id: "d1" }, { id: "d2" }];
    await w.vm.deleteDraft({ id: "d1" });
    expect(w.vm.drafts.length).toBe(1);
    expect(w.vm.drafts[0].id).toBe("d2");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("deleteDraft does nothing on cancel", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockRejectedValue(new Error("canceled"));
    const w = mountCollection();
    await nextTick();
    w.vm.drafts = [{ id: "d1" }];
    await w.vm.deleteDraft({ id: "d1" });
    expect(w.vm.drafts.length).toBe(1);
  });

  it("collectUrl warns if no urlCollectFetch API", async () => {
    window.electronAPI = {};
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com";
    await w.vm.collectUrl();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("collectUrl warns if URL is empty", async () => {
    window.electronAPI = {
      urlCollectFetch: vi.fn()
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "";
    await w.vm.collectUrl();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("collectUrl succeeds with API", async () => {
    window.electronAPI = {
      urlCollectFetch: vi.fn().mockResolvedValue({ code: 0, data: { title: "Article", description: "Desc", coverImage: "img.jpg" } })
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/article";
    await w.vm.collectUrl();
    expect(window.electronAPI.urlCollectFetch).toHaveBeenCalledWith("https://example.com/article");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
    expect(w.vm.collectedResult).toBeTruthy();
    expect(w.vm.collectedResult.title).toBe("Article");
  });

  it("collectUrl shows error on API failure", async () => {
    window.electronAPI = {
      urlCollectFetch: vi.fn().mockResolvedValue({ code: 1, message: "collection failed" })
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/fail";
    await w.vm.collectUrl();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith("collection failed");
  });

  it("collectUrl 反爬安全验证页 → 回退 urlCollectFetch 而非误报成功", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({
        title: "百度安全验证",
        content: "网络不给力，请稍后重试",
        word_count: 0,
      }),
      urlCollectFetch: vi.fn().mockResolvedValue({
        code: 0,
        data: { title: "真实文章标题", content: "真实正文内容" },
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://baijiahao.baidu.com/s?id=123";
    await w.vm.collectUrl();
    // 不应把「百度安全验证」当成功结果，而应回退到 Node 端 stealth 采集
    expect(window.electronAPI.urlCollectFetch).toHaveBeenCalledWith("https://baijiahao.baidu.com/s?id=123");
    expect(w.vm.collectedResult).toBeTruthy();
    expect(w.vm.collectedResult.title).toBe("真实文章标题");
  });

  // 回归保护：知乎链接一键改写报 rate_limited（2026-09-13）。
  // 根因：先走 Python 聚合层 trafilatura 裸连知乎触发反爬 → 失败回退 stealth。
  // 每次点击都先白挨一次反爬检测（封 IP 风险）。修复：反爬站点直接走 stealth 通道。
  describe("反爬站点直连 stealth 通道（回归：知乎先裸连触发风控）", () => {
    const ZHIHU_ANSWER_URL = "https://www.zhihu.com/question/20255485/answer/2021183938203263464";

    function mockStealthApi() {
      return {
        aggregationCollect: vi.fn(), // 必须未被调用（裸连会触发风控）
        aggregationRewrite: vi.fn().mockResolvedValue({ result_content: "改写后的内容。" }),
        urlCollectNeedsStealth: vi.fn().mockResolvedValue({
          code: 0,
          data: { needsStealth: true },
        }),
        urlCollectFetch: vi.fn().mockResolvedValue({
          code: 0,
          data: { title: "知乎回答标题", content: "知乎回答正文内容，长度超过二十个字。", coverImage: "" },
        }),
      };
    }

    it("collectUrl：知乎链接跳过 aggregationCollect，直接 urlCollectFetch", async () => {
      window.electronAPI = mockStealthApi();
      const w = mountCollection();
      await nextTick();
      w.vm.linkUrl = ZHIHU_ANSWER_URL;
      await w.vm.collectUrl();
      // 核心：不得调用 Python 聚合层裸连（每次裸连都触发一次反爬检测）
      expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
      expect(window.electronAPI.urlCollectNeedsStealth).toHaveBeenCalledWith(ZHIHU_ANSWER_URL);
      expect(window.electronAPI.urlCollectFetch).toHaveBeenCalledWith(ZHIHU_ANSWER_URL);
      expect(w.vm.collectedResult.title).toBe("知乎回答标题");
    });

    it("collectAndRewrite：知乎链接采集走 stealth，改写正常触发", async () => {
      window.electronAPI = mockStealthApi();
      const w = mountCollection();
      await nextTick();
      w.vm.linkUrl = ZHIHU_ANSWER_URL;
      await w.vm.collectAndRewrite();
      expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
      expect(window.electronAPI.urlCollectFetch).toHaveBeenCalledWith(ZHIHU_ANSWER_URL);
      expect(w.vm.collectedResult.title).toBe("知乎回答标题");
      expect(w.vm.rewriteResult).toBe("改写后的内容。");
      expect(window.electronAPI.aggregationRewrite).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("知乎回答正文内容") })
      );
    });

    it("stealth 采集失败 → 显示错误，不回退裸连", async () => {
      const api = mockStealthApi();
      api.urlCollectFetch = vi.fn().mockResolvedValue({ code: -1, message: "采集失败: timeout" });
      window.electronAPI = api;
      const w = mountCollection();
      await nextTick();
      w.vm.linkUrl = ZHIHU_ANSWER_URL;
      await w.vm.collectUrl();
      // 失败也不回退到 Python 裸连（避免二次触发风控）
      expect(api.aggregationCollect).not.toHaveBeenCalled();
      expect(w.vm.collectError).toBeTruthy();
    });

    it("普通站点 → needsStealth false，走默认聚合路径", async () => {
      const api = {
        aggregationCollect: vi.fn().mockResolvedValue({
          title: "聚合标题", content: "聚合正文内容，长度超过二十个字。", word_count: 15,
        }),
        urlCollectNeedsStealth: vi.fn().mockResolvedValue({ code: 0, data: { needsStealth: false } }),
        urlCollectFetch: vi.fn(),
      };
      window.electronAPI = api;
      const w = mountCollection();
      await nextTick();
      w.vm.linkUrl = "https://example.com/article";
      await w.vm.collectUrl();
      expect(api.aggregationCollect).toHaveBeenCalled();
      expect(api.urlCollectFetch).not.toHaveBeenCalled();
      expect(w.vm.collectedResult.title).toBe("聚合标题");
    });

    it("needsStealth 查询失败 → 降级走默认聚合路径（不阻塞采集）", async () => {
      const api = {
        aggregationCollect: vi.fn().mockResolvedValue({
          title: "降级标题", content: "降级正文内容。", word_count: 7,
        }),
        urlCollectNeedsStealth: vi.fn().mockRejectedValue(new Error("ipc error")),
        urlCollectFetch: vi.fn(),
      };
      window.electronAPI = api;
      const w = mountCollection();
      await nextTick();
      w.vm.linkUrl = ZHIHU_ANSWER_URL;
      await w.vm.collectUrl();
      expect(api.aggregationCollect).toHaveBeenCalled();
    });
  });

  it("collectUrl catches exception", async () => {
    window.electronAPI = {
      urlCollectFetch: vi.fn().mockRejectedValue(new Error("network error"))
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/error";
    await w.vm.collectUrl();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalled();
  });

  it("collectUrl 抖音链接 → 走 aggregationCollectVideo 视频通道", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        title: "抖音测试视频",
        content: "这是口播文案",
        transcript: "这是口播文案",
        word_count: 6,
        media_type: "video",
        video_url: "https://v.douyin.com/abc/",
        duration: 125.5,
        metadata: { platform: "douyin", asr_engine: "faster_whisper" },
      }),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://v.douyin.com/abc123/";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalledWith({ url: "https://v.douyin.com/abc123/" });
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
    expect(w.vm.collectedResult).toBeTruthy();
    expect(w.vm.collectedResult.mediaType).toBe("video");
    expect(w.vm.collectedResult.content).toBe("这是口播文案");
    expect(w.vm.collectedResult.duration).toBe(125.5);
    expect(w.vm.collectedResult.platform).toBe("douyin");
    expect(w.vm.collectedItems.length).toBe(1);
  });

  it("collectUrl 小红书链接 → 走视频通道", async () => {
    window.electronAPI = {
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        title: "小红书视频", content: "文案", transcript: "文案", word_count: 2,
        media_type: "video", duration: 60, metadata: { platform: "xiaohongshu" },
      }),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://xhslink.com/xyz";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalledWith({ url: "https://xhslink.com/xyz" });
  });

  it("collectUrl 普通网页链接 → 不走视频通道（回归保护）", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({ title: "文章", content: "正文", word_count: 2 }),
      aggregationCollectVideo: vi.fn(),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://www.zhihu.com/question/123";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollectVideo).not.toHaveBeenCalled();
    expect(window.electronAPI.aggregationCollect).toHaveBeenCalled();
  });

  it("collectUrl 视频通道失败（-6 引擎不可用）→ 弹出安装引导弹窗不回退图文", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        code: -6, message: "语音转写引擎不可用，请安装 faster-whisper：pip install faster-whisper",
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://v.douyin.com/abc/";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
    // 2026-09-19 行为变更：-6 触发 ASR 依赖安装引导弹窗（自动 pip 安装 + 模型下载），而非错误横幅
    expect(w.vm.asrInstallVisible).toBe(true);
    expect(w.vm.asrInstallPendingUrl).toBe("https://v.douyin.com/abc/");
    expect(w.vm.collectError).toBeFalsy();
  });

  it("collectUrl 视频通道失败（-8 无音轨）→ 显示错误", async () => {
    window.electronAPI = {
      aggregationCollectVideo: vi.fn().mockResolvedValue({ code: -8, message: "该视频无音轨，无法进行语音转写" }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://www.xiaohongshu.com/explore/x";
    await w.vm.collectUrl();
    expect(w.vm.collectError.code).toBe(-8);
    expect(w.vm.collectError.message).toContain("无音轨");
  });

  it("collectUrl 视频通道不可用 → 提示且不回退图文采集", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      urlCollectFetch: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://v.douyin.com/abc/";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
    expect(window.electronAPI.urlCollectFetch).not.toHaveBeenCalled();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("isVideoPlatformUrl 域名检测", async () => {
    const w = mountCollection();
    expect(w.vm.isVideoPlatformUrl("https://v.douyin.com/abc/")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://www.douyin.com/video/730")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://www.xiaohongshu.com/explore/x")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://xhslink.com/x")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://www.zhihu.com/question/1")).toBe(false);
    expect(w.vm.isVideoPlatformUrl("https://example.com")).toBe(false);
    expect(w.vm.isVideoPlatformUrl("not a url")).toBe(false);
  });

  it("collectAndRewrite 抖音链接 → 走视频通道并用转写文案改写", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        title: "抖音视频", content: "转写文案内容足够长可以改写", transcript: "转写文案内容足够长可以改写",
        word_count: 13, media_type: "video", duration: 90, metadata: { platform: "douyin" },
      }),
      aiRewrite: vi.fn().mockResolvedValue({ code: 0, data: { success: true, result: "改写后的文案" } }),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://v.douyin.com/abc/";
    await w.vm.collectAndRewrite();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalledWith({ url: "https://v.douyin.com/abc/" });
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
    expect(window.electronAPI.aiRewrite).toHaveBeenCalledWith(
      expect.objectContaining({ content: "转写文案内容足够长可以改写" })
    );
    expect(w.vm.collectedResult.mediaType).toBe("video");
    expect(w.vm.rewriteResult).toBe("改写后的文案");
  });

  it("formatVideoDuration 时长格式化", async () => {
    const w = mountCollection();
    expect(w.vm.formatVideoDuration(0)).toBe("");
    expect(w.vm.formatVideoDuration(65)).toBe("1:05");
    expect(w.vm.formatVideoDuration(185)).toBe("3:05");  });

  it("rewriteViaEngine 策略传参契约：手动传所选 id，自动/未选传 null（2026-09-15 补齐）", async () => {
    window.electronAPI = {
      aiRewrite: vi.fn().mockResolvedValue({ code: 0, data: { success: true, result: "改写后的文案" } }),
    };
    const w = mountCollection();
    await nextTick();
    // 自动模式 → strategyId = null（引擎 _resolveStrategy 自动匹配）
    await w.vm.rewriteViaEngine("测试内容足够长");
    expect(window.electronAPI.aiRewrite).toHaveBeenCalledWith(
      expect.objectContaining({ strategyId: null })
    );
    // 手动模式 → strategyId = 所选 id
    w.vm.strategyMode = "manual";
    w.vm.rewriteStrategyId = "strategy-douyin-viral";
    await w.vm.rewriteViaEngine("测试内容足够长");
    expect(window.electronAPI.aiRewrite).toHaveBeenLastCalledWith(
      expect.objectContaining({ strategyId: "strategy-douyin-viral" })
    );
    // 手动模式未选择 → 降级 null
    w.vm.rewriteStrategyId = "";
    await w.vm.rewriteViaEngine("测试内容足够长");
    expect(window.electronAPI.aiRewrite).toHaveBeenLastCalledWith(
      expect.objectContaining({ strategyId: null })
    );
  });

  it("collectUrl 失败时错误横幅显示细分文案（安全验证类）", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({ code: -99, message: "URL 触发安全验证，请尝试在浏览器环境采集" }),
      urlCollectFetch: vi.fn().mockResolvedValue({ code: 1, message: "采集失败: 目标页面触发了安全验证" }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://zhuanlan.zhihu.com/p/123";
    await w.vm.collectUrl();
    // 错误横幅应显示 security_challenge 细分文案（含建议），而非笼统「采集失败」
    expect(w.vm.collectErrorDetail).toContain("安全验证");
    expect(w.vm.collectErrorRetryable).toBe(true);
  });

  it("collectUrl 失败时错误横幅显示细分文案（超时类）", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({ code: -1, message: "请求超时，请稍后重试" }),
      urlCollectFetch: vi.fn().mockResolvedValue({ code: 1, message: "采集失败: timeout of 30000ms exceeded" }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/slow";
    await w.vm.collectUrl();
    expect(w.vm.collectErrorDetail).toContain("超时");
    expect(w.vm.collectErrorRetryable).toBe(true);
  });

  it("collectUrl 失败时输入类错误不显示重试按钮", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({ code: -99, message: "URL 格式不正确" }),
      urlCollectFetch: vi.fn().mockResolvedValue({ code: 1, message: "无效的 URL" }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "not-a-url";
    await w.vm.collectUrl();
    // 2026-09-19 行为变更：非 URL 输入且提取不到链接 → 分享文本解析提前拦截（shareLinkNone 提示），不再进入图文链路
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
    expect(w.vm.collectError).toBeFalsy();
  });

  it("collectUrl 粘贴抖音分享混合文本 → 提取真实链接后走视频通道", async () => {
    window.electronAPI = {
      aggregationCollectVideo: vi.fn().mockResolvedValue({ title: "t", content: "c", media_type: "video" }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "0.02 P@x.FH 05/09 :6pm ATl:/ 当你在2026年再次听到这首歌 #ladygaga https://v.douyin.com/vknKdeN_naU/ 复制此链接，打开Dou音搜索，直接观看视频！";
    await w.vm.collectUrl();
    expect(w.vm.linkUrl).toBe("https://v.douyin.com/vknKdeN_naU/");
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalledWith({ url: "https://v.douyin.com/vknKdeN_naU/" });
  });

  it("collectUrl 分享文本无任何链接 → 提示未找到链接不发起采集", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "这是一段没有任何链接的纯文本分享内容";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
    expect(window.electronAPI.aggregationCollectVideo).not.toHaveBeenCalled();
  });

  // ── 视频采集错误细分提示（回归：具体提示曾被 unknown 通用文案吞掉） ──

  it("视频 >10 分钟拒绝 → 显示「视频过长（含实际时长）+ 上限」而非通用失败", async () => {
    window.electronAPI = {
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        code: -422, status: 422,
        message: "VIDEOCLONE_FILE_TOO_LARGE: 视频过长（15:32），采集仅支持 10 分钟内的短视频",
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://v.douyin.com/too-long/";
    await w.vm.collectUrl();
    expect(w.vm.collectErrorDetail).toContain("视频过长");
    expect(w.vm.collectErrorDetail).toContain("15:32");
    expect(w.vm.collectErrorDetail).toContain("10 分钟");
    expect(w.vm.collectErrorRetryable).toBe(false);
  });

  it("视频无音轨 → 显示「无音轨，无法转写」提示", async () => {
    window.electronAPI = {
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        code: -422, status: 422,
        message: "-8: 该视频无音轨，无法进行语音转写",
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://v.douyin.com/no-audio/";
    await w.vm.collectUrl();
    expect(w.vm.collectErrorDetail).toContain("无音轨");
    expect(w.vm.collectErrorRetryable).toBe(false);
  });

  it("ASR 引擎缺失 → 显示安装指引（pip install faster-whisper）", async () => {
    window.electronAPI = {
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        code: -422, status: 422,
        message: "-6: 语音转写引擎不可用，请安装 faster-whisper：pip install faster-whisper（国内可设 HF_ENDPOINT=https://hf-mirror.com）",
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://v.douyin.com/abc/";
    await w.vm.collectUrl();
    expect(w.vm.collectErrorDetail).toContain("pip install faster-whisper");
    expect(w.vm.collectErrorRetryable).toBe(false);
  });

  it("转写超时 → 显示「转写超时 + 建议较短视频」且可重试", async () => {
    window.electronAPI = {
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        code: -422, status: 422,
        message: "-7: 转写超时（300 秒），请尝试较短的短视频",
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://v.douyin.com/slow/";
    await w.vm.collectUrl();
    expect(w.vm.collectErrorDetail).toContain("转写超时");
    expect(w.vm.collectErrorDetail).toContain("较短的短视频");
    expect(w.vm.collectErrorRetryable).toBe(true);
  });

  it("creates draft from collected result", async () => {
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { title: "Article", content: "Content", coverImage: "img.jpg", source: "url" };
    w.vm.linkUrl = "https://example.com/article";
    await w.vm.createFromCollected();
    expect(w.vm.drafts.length).toBe(1);
    expect(w.vm.drafts[0].title).toBe("Article");
    expect(w.vm.drafts[0].content).toBe("Content");
    expect(w.vm.drafts[0].coverImage).toBe("img.jpg");
    expect(w.vm.collectedResult).toBeNull();
    expect(w.vm.linkUrl).toBe("");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalled();
  });

  it("createFromCollected does nothing if no collected result", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = null;
    w.vm.drafts = [];
    await w.vm.createFromCollected();
    expect(w.vm.drafts.length).toBe(0);
  });

  it("shows empty state when no drafts", async () => {
    const w = mountCollection();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    // 空态统一走 EmptyState（T0-3）：文案全部来自 i18n key（$t 在测试中返回 key 本身）
    const empty = w.get('[data-testid="collection-drafts-empty"]');
    expect(empty.classes()).toContain("mp-empty-state");
    expect(empty.text()).toContain("collection.draftsEmptyTitle");
    expect(empty.get("button.mp-empty-state__action").text()).toBe("collection.draftsEmptyAction");
  });

  it("shows drafts list", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.drafts = [{ id: "d1", title: "Saved Draft", content: "hello", source: "manual", created_at: "2026-07-05" }];
    await nextTick();
    expect(w.text()).toContain("Saved Draft");
  });

  it("collectedItems accumulates after collectUrl", async () => {
    window.electronAPI = {
      urlCollectFetch: vi.fn().mockResolvedValue({ code: 0, data: { title: "A1", content: "c1" } }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/1";
    await w.vm.collectUrl();
    expect(w.vm.collectedItems.length).toBe(1);
    expect(w.vm.collectedItems[0].title).toBe("A1");
    w.vm.linkUrl = "https://example.com/2";
    await w.vm.collectUrl();
    expect(w.vm.collectedItems.length).toBe(2);
    expect(w.vm.collectedItems[0].title).toBe("A1"); // newest first
    expect(w.vm.collectedItems[0].id).toBeDefined();
  });

  it("createFromItem creates draft from list item", async () => {
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    w.vm.drafts = [];
    const item = { id: "abc", title: "From List", content: "list content", source: "rss", sourceUrl: "https://ex.com" };
    await w.vm.createFromItem(item);
    expect(w.vm.drafts.length).toBe(1);
    expect(w.vm.drafts[0].title).toBe("From List");
    expect(w.vm.drafts[0].source).toBe("rss");
    expect(pushSpy).toHaveBeenCalled();
  });

  it("sendItemToPipeline navigates to create", async () => {
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    const item = { id: "abc", title: "Pipeline Item", content: "content", source: "url" };
    await w.vm.sendItemToPipeline(item);
    expect(w.vm.drafts.length).toBe(1);
    expect(pushSpy).toHaveBeenCalledWith(expect.stringContaining("/create?draft="));
  });

  it("goPublishFromItem navigates to publish", async () => {
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    const item = { id: "abc", title: "Publish Item", content: "content", source: "url" };
    await w.vm.goPublishFromItem(item);
    expect(w.vm.drafts.length).toBe(1);
    expect(pushSpy).toHaveBeenCalledWith(expect.stringContaining("/publish?draft="));
  });

  it("collectedItems list renders in template", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.collectedItems = [
      { id: "i1", title: "Item 1", content: "c1", source: "url", wordCount: 100 },
      { id: "i2", title: "Item 2", content: "c2", source: "rss", wordCount: 200 },
    ];
    await nextTick();
    expect(w.text()).toContain("采集结果（2 篇）");
    expect(w.text()).toContain("Item 1");
    expect(w.text()).toContain("Item 2");
    expect(w.text()).toContain("视频创作");
    expect(w.text()).toContain("发布");
  });

  it("clear button removes collectedItems", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.collectedItems = [{ id: "i1", title: "Item", content: "c", source: "url" }];
    w.vm.collectedResult = { id: "i1", title: "Item" };
    await nextTick();
    expect(w.vm.collectedItems.length).toBe(1);
    // Click clear button
    const btn = w.find(".cohere-section-title button");
    await btn.trigger("click");
    expect(w.vm.collectedItems.length).toBe(0);
    expect(w.vm.collectedResult).toBeNull();
  });

  it("renders one-click rewrite button", async () => {
    const w = mountCollection();
    await nextTick();
    expect(w.text()).toContain("oneClickRewrite");
  });

  it("collectAndRewrite warns if URL is empty", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aiRewrite: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "";
    await w.vm.collectAndRewrite();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
  });

  it("collectAndRewrite warns if aggregation API unavailable", async () => {
    window.electronAPI = {};
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/article";
    await w.vm.collectAndRewrite();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("collectAndRewrite collects and rewrites in one action", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({
        title: "原始文章标题",
        content: "这是采集到的原文内容，长度超过二十个字，用于测试一键改写流程。",
        word_count: 30,
      }),
      aiRewrite: vi.fn().mockResolvedValue({
        code: 0, data: { success: true, result: "这是改写后的内容，与原文不同。" },
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/article";
    await w.vm.collectAndRewrite();
    expect(window.electronAPI.aggregationCollect).toHaveBeenCalledWith({
      url: "https://example.com/article",
      source_type: "url",
      rewrite: false,
    });
    expect(window.electronAPI.aiRewrite).toHaveBeenCalledWith(
      expect.objectContaining({ content: "这是采集到的原文内容，长度超过二十个字，用于测试一键改写流程。" })
    );
    expect(w.vm.collectedResult).toBeTruthy();
    expect(w.vm.collectedResult.content).toContain("这是采集到的原文内容");
    expect(w.vm.rewriteResult).toBe("这是改写后的内容，与原文不同。");
    expect(w.vm.collectedItems.length).toBe(1);
    expect(w.vm.oneClickRewriting).toBe(false);
    expect(w.vm.collecting).toBe(false);
  });

  // ── 字数区间控制（2026-09-12）──

  it("renders word count inputs with default 800-2000 and replaces length select", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationRewrite: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { title: "T", content: "C", description: "" };
    await nextTick();
    const inputs = w.findAll('input[type="number"]');
    expect(inputs.length).toBeGreaterThanOrEqual(2);
    expect(w.vm.rewriteWordCountMin).toBe(800);
    expect(w.vm.rewriteWordCountMax).toBe(2000);
    // 三档 length 下拉已移除
    const selects = w.findAll("select");
    const lengthOptions = selects.flatMap((s) => s.findAll("option").map((o) => o.text()));
    expect(lengthOptions).not.toContain("保持原文");
  });

  it("rewriteCollected blocked when max < min", async () => {
    window.electronAPI = {
      aggregationRewrite: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { title: "T", content: "原始正文内容。", description: "" };
    w.vm.rewriteWordCountMin = 2000;
    w.vm.rewriteWordCountMax = 100;
    await nextTick();
    await w.vm.rewriteCollected();
    expect(w.vm.rewriteWordCountError).toContain("最大字数不能小于最小字数");
    expect(window.electronAPI.aggregationRewrite).not.toHaveBeenCalled();
  });

  // ── 回归：AI 改写无密钥错误必须渲染 locale 友好文案（2026-09-12）──
  // 曾泄漏原始技术消息「未配置 LLM API Key，请在环境变量中设置 LLM_API_KEY 或 PO_OPENAI_API_KEY 后再改写」到 UI。
  it("rewriteCollected 无密钥错误 → 显示友好文案，不暴露环境变量名", async () => {
    window.electronAPI = {
      aiRewrite: vi.fn().mockResolvedValue({
        code: -400, status: 400, errorCode: "LLM_KEY_MISSING",
        message: "AI 改写服务尚未配置访问密钥",
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { title: "T", content: "原始正文内容，长度超过二十个字用于测试。", description: "" };
    await w.vm.rewriteCollected();
    expect(w.vm.rewriteError).toBeTruthy();
    // 友好文案来自 locale（含具体指引），不含环境变量名/技术细节
    expect(w.vm.rewriteError.message).toContain("模型设置");
    expect(w.vm.rewriteError.message).not.toContain("LLM_API_KEY");
    expect(w.vm.rewriteError.message).not.toContain("PO_OPENAI_API_KEY");
    expect(w.vm.rewriteError.message).not.toContain("环境变量");
  });

  it("rewriteCollected 旧版后端（无 errorCode，仅原始中文消息）→ pattern 兜底也不直出技术细节", async () => {
    window.electronAPI = {
      aiRewrite: vi.fn().mockResolvedValue({
        code: -400, status: 400,
        message: "未配置 LLM API Key，请在环境变量中设置 LLM_API_KEY 或 PO_OPENAI_API_KEY 后再改写",
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { title: "T", content: "原始正文内容，长度超过二十个字用于测试。", description: "" };
    await w.vm.rewriteCollected();
    expect(w.vm.rewriteError).toBeTruthy();
    expect(w.vm.rewriteError.message).not.toContain("LLM_API_KEY");
    expect(w.vm.rewriteError.message).not.toContain("PO_OPENAI_API_KEY");
    expect(w.vm.rewriteError.message).not.toContain("环境变量");
  });

  it("collectAndRewrite keeps original content when rewrite fails", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({
        title: "原始文章标题",
        content: "这是采集到的原文内容，长度超过二十个字，用于测试一键改写流程。",
        word_count: 30,
      }),
      aiRewrite: vi.fn().mockResolvedValue({ code: -99, message: "改写服务不可用" }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/article";
    await w.vm.collectAndRewrite();
    expect(w.vm.collectedResult).toBeTruthy();
    expect(w.vm.collectedResult.content).toContain("这是采集到的原文内容");
    expect(w.vm.rewriteResult).toBe("");
    expect(w.vm.rewriteError).toBeTruthy();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
    expect(ElMessage.error).toHaveBeenCalled();
  });

  it("collectAndRewrite falls back to urlCollectFetch", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({ code: -4, message: "CONTENT_UNEXTRACTABLE" }),
      aiRewrite: vi.fn().mockResolvedValue({
        code: 0, data: { success: true, result: "回退采集后改写成功。" },
      }),
      urlCollectFetch: vi.fn().mockResolvedValue({
        code: 0,
        data: { title: "回退标题", content: "回退采集到的正文内容，长度超过二十个字。", coverImage: "" },
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/article";
    await w.vm.collectAndRewrite();
    expect(window.electronAPI.urlCollectFetch).toHaveBeenCalledWith("https://example.com/article");
    expect(w.vm.collectedResult.title).toBe("回退标题");
    expect(w.vm.rewriteResult).toBe("回退采集后改写成功。");
  });

  it("rewriteCollected no longer overwrites original content", async () => {
    window.electronAPI = {
      aiRewrite: vi.fn().mockResolvedValue({
        code: 0, data: { success: true, result: "改写后的内容。" },
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { title: "T", content: "原始正文内容，长度超过二十个字用于测试。", description: "" };
    await w.vm.rewriteCollected();
    expect(w.vm.collectedResult.content).toBe("原始正文内容，长度超过二十个字用于测试。");
    expect(w.vm.rewriteResult).toBe("改写后的内容。");
  });

  it("clearResult resets collectedResult and rewriteResult", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { id: "i1", title: "T", content: "C" };
    w.vm.rewriteResult = "R";
    w.vm.rewriteError = { code: -99, message: "e" };
    w.vm.collectError = { code: -99, message: "e" };
    w.vm.clearResult();
    expect(w.vm.collectedResult).toBeNull();
    expect(w.vm.rewriteResult).toBe("");
    expect(w.vm.rewriteError).toBeNull();
    expect(w.vm.collectError).toBeNull();
  });

  it("renders collection tabs and switches to records tab", async () => {
    const w = mountCollection();
    await nextTick();
    expect(w.text()).toContain("collection.tabCollect");
    expect(w.text()).toContain("collection.tabRecords");
    // 默认在采集 tab
    expect(w.vm.activeTab).toBe("collect");
    // 切换到采集记录 tab
    await w.vm.switchTab("records");
    await nextTick();
    expect(w.vm.activeTab).toBe("records");
    expect(w.text()).toContain("collection.recordsEmptyTitle");
  });

  it("switchTab ignores invalid tab", async () => {
    const w = mountCollection();
    await nextTick();
    await w.vm.switchTab("invalid");
    expect(w.vm.activeTab).toBe("collect");
  });

  it("loadCollectedItems reads persisted records on mount", async () => {
    window.electronAPI = {
      storeGetSetting: vi.fn().mockImplementation(async (key) => {
        if (key === "collected_items") return JSON.stringify([
          { id: "c1", title: "Record A", content: "hello", source: "url" }
        ]);
        return null;
      })
    };
    const w = mountCollection();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.vm.collectedItems.length).toBe(1);
    expect(w.vm.collectedItems[0].title).toBe("Record A");
  });

  it("loadCollectedItems handles parse failure", async () => {
    window.electronAPI = {
      storeGetSetting: vi.fn().mockImplementation(async (key) => {
        if (key === "collected_items") return "not-json{{{";
        return null;
      })
    };
    const w = mountCollection();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.vm.collectedItems).toEqual([]);
  });

  it("openRecordForEdit creates draft and navigates to publish", async () => {
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    w.vm.drafts = [];
    const item = { id: "rec1", title: "Record Title", content: "record content", source: "rss", sourceUrl: "https://ex.com" };
    await w.vm.openRecordForEdit(item);
    expect(w.vm.drafts.length).toBe(1);
    expect(w.vm.drafts[0].title).toBe("Record Title");
    expect(pushSpy).toHaveBeenCalledWith("/publish?draft=" + w.vm.drafts[0].id);
  });

  it("openRecordForEdit does nothing for invalid item", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.drafts = [];
    await w.vm.openRecordForEdit(null);
    expect(w.vm.drafts.length).toBe(0);
  });

  it("deleteRecord confirms and removes record", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue(undefined);
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedItems = [{ id: "r1" }, { id: "r2" }];
    await w.vm.deleteRecord({ id: "r1" });
    expect(w.vm.collectedItems.length).toBe(1);
    expect(w.vm.collectedItems[0].id).toBe("r2");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("deleteRecord does nothing on cancel", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockRejectedValue(new Error("canceled"));
    const w = mountCollection();
    await nextTick();
    w.vm.collectedItems = [{ id: "r1" }];
    await w.vm.deleteRecord({ id: "r1" });
    expect(w.vm.collectedItems.length).toBe(1);
  });

  it("clearAllRecords clears list after confirm", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue(undefined);
    window.electronAPI = { storeSetSetting: vi.fn() };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedItems = [{ id: "r1" }, { id: "r2" }];
    w.vm.collectedResult = { id: "r1" };
    await w.vm.clearAllRecords();
    expect(w.vm.collectedItems.length).toBe(0);
    expect(w.vm.collectedResult).toBeNull();
  });

  it("collectUrl persists collected items to store", async () => {
    const storeSet = vi.fn().mockResolvedValue(undefined);
    window.electronAPI = {
      urlCollectFetch: vi.fn().mockResolvedValue({ code: 0, data: { title: "Persisted", content: "body" } }),
      storeSetSetting: storeSet,
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://example.com/persist";
    await w.vm.collectUrl();
    expect(storeSet).toHaveBeenCalledWith("collected_items", expect.stringContaining("Persisted"));
  });
});

describe("CollectionView 知乎收藏夹批量采集/改写", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = {};
  });

  it("loadZhihuFavlists 无 secret → 显示必填提示", async () => {
    window.electronAPI = { zhihuFavlistList: vi.fn() };
    const w = mountCollection();
    await nextTick();
    w.vm.zhihuAccessSecret = "";
    await w.vm.loadZhihuFavlists();
    expect(w.vm.zhihuFavlistError).toContain("Access Secret");
    expect(window.electronAPI.zhihuFavlistList).not.toHaveBeenCalled();
  });

  it("loadZhihuFavlists 成功 → 下拉数据填充", async () => {
    window.electronAPI = {
      zhihuFavlistList: vi.fn().mockResolvedValue({ code: 0, data: [
        { urlToken: 111, title: "收藏夹A", isPublic: true },
        { urlToken: 222, title: "收藏夹B", isPublic: false },
      ] }),
      storeSetSetting: vi.fn().mockResolvedValue(true),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.zhihuAccessSecret = "my-secret";
    await w.vm.loadZhihuFavlists();
    expect(w.vm.zhihuFavlists).toHaveLength(2);
    expect(w.vm.zhihuFavlists[0].title).toBe("收藏夹A");
    expect(w.vm.zhihuFavlistError).toBe("");
  });

  it("loadZhihuFavlists 失败 → 错误提示", async () => {
    window.electronAPI = {
      zhihuFavlistList: vi.fn().mockResolvedValue({ code: -1, message: "网络连接失败" }),
      storeSetSetting: vi.fn().mockResolvedValue(true),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.zhihuAccessSecret = "secret";
    await w.vm.loadZhihuFavlists();
    expect(w.vm.zhihuFavlistError).toContain("网络连接失败");
  });

  it("zhihuFavlistBatchCollect 空收藏夹 → 提示无内容", async () => {
    window.electronAPI = {
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [], totals: 0 } }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.zhihuSelectedFavlist = "111";
    await w.vm.zhihuFavlistBatchCollect();
    expect(w.vm.zhihuFavlistError).toContain("没有内容");
  });

  it("zhihuFavlistBatchCollect 成功 → 结果入列表", async () => {
    window.electronAPI = {
      zhihuFavlistContents: vi.fn().mockResolvedValue({ code: 0, data: { items: [
        { url: "https://zhuanlan.zhihu.com/p/1", title: "文章1" },
      ], totals: 1 } }),
      zhihuFavlistBatchCollect: vi.fn().mockResolvedValue({ code: 0, data: {
        completed: 1, failed: 0, cancelled: false, circuitBroken: false,
        results: [{ index: 0, ok: true, data: { success: true, title: "文章1", content: "正文" } }],
      } }),
      storeGetSetting: vi.fn().mockResolvedValue("[]"),
      storeSetSetting: vi.fn().mockResolvedValue(true),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.zhihuSelectedFavlist = "111";
    await w.vm.zhihuFavlistBatchCollect();
    expect(w.vm.zhihuFavlistResults).toHaveLength(1);
    expect(w.vm.zhihuFavlistProgress).toContain("成功 1");
  });

  it("zhihuFavlistBatchRewrite 无可改写内容 → 提示", async () => {
    window.electronAPI = {};
    const w = mountCollection();
    await nextTick();
    w.vm.zhihuFavlistResults = [];
    w.vm.collectedItems = [];
    await w.vm.zhihuFavlistBatchRewrite();
    expect(w.vm.zhihuFavlistError).toContain("可改写");
  });
});

// ── 文案库合并标签（2026-09-16）：采集记录 + 文案库两标签合一，以采集记录卡片为准 ──
describe("CollectionView 文案库合并标签", () => {
  const RW = {
    id: "rw1",
    fromKey: "collect:c1",
    fromTitle: "原标题",
    title: "改写稿标题",
    content: "改写后的正文内容",
    wordCount: 8,
    platform: "",
    sourceUrl: "",
    createdAt: "2026-09-16T03:00:00.000Z",
  };

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
    i18n.global.locale.value = "zh";
    sessionStorage.clear();
  });

  function mountWithI18n() {
    return mount(CollectionView, { global: { plugins: [i18n, createPinia()] } });
  }

  it("renders two tabs only and the copy library tab switches to records", async () => {
    const w = mountWithI18n();
    await nextTick();
    expect(w.find('[data-testid="collection-tab-library"]').exists()).toBe(true);
    expect(w.text()).toContain("文案库");
    // 原独立「文案库」第三个标签已移除（tabLibrary 不再出现在标签栏）
    expect(w.findAll(".collection-tab-btn").length).toBe(2);
    await w.find('[data-testid="collection-tab-library"]').trigger("click");
    await nextTick();
    expect(w.vm.activeTab).toBe("records");
  });

  it("keeps ignoring invalid tab names after merge", async () => {
    const w = mountWithI18n();
    await nextTick();
    await w.vm.switchTab("records");
    await w.vm.switchTab("library");
    await w.vm.switchTab("unknown");
    expect(w.vm.activeTab).toBe("records");
  });

  it("merges collect items and rewrite records in one list with origin badges", async () => {
    const w = mountWithI18n();
    await nextTick();
    w.vm.collectedItems = [{ id: "c1", title: "采集标题", content: "采集正文", source: "url", createdAt: "2026-09-16T01:00:00.000Z" }];
    w.vm.rewrites = [RW];
    await w.vm.switchTab("records");
    await nextTick();
    const list = w.find('[data-testid="copy-library-list"]');
    expect(list.exists()).toBe(true);
    // 采集卡与改写卡同网格展示
    expect(w.find('[data-testid="copy-library-item-rw1"]').exists()).toBe(true);
    expect(list.findAll(".collection-record-card").length).toBe(2);
    expect(w.find('[data-testid="copy-library-badge-rw1"]').text()).toBe("改写");
    // 采集卡带完整操作（含新增改写按钮），改写卡带查看/改写/删除
    expect(w.find('[data-testid="copy-library-rewrite-c1"]').exists()).toBe(true);
    expect(w.find('[data-testid="copy-library-rewrite-rrw1"]').exists()).toBe(true);
  });

  it("origin filter narrows the merged list", async () => {
    const w = mountWithI18n();
    await nextTick();
    w.vm.collectedItems = [{ id: "c1", title: "采集标题", content: "采集正文", source: "url" }];
    w.vm.rewrites = [RW];
    await w.vm.switchTab("records");
    await nextTick();
    await w.find('[data-testid="copy-library-filter-rewrite"]').trigger("click");
    await nextTick();
    const cards = w.findAll('[data-testid="copy-library-list"] .collection-record-card');
    expect(cards.length).toBe(1);
    expect(w.find('[data-testid="copy-library-item-rw1"]').exists()).toBe(true);
  });

  it("rewrite button on collect card hands off via sessionStorage and jumps to rewrite page", async () => {
    const w = mountWithI18n();
    await nextTick();
    w.vm.collectedItems = [{ id: "c1", title: "采集标题", content: "要改写的正文", source: "url", platform: "douyin" }];
    await w.vm.switchTab("records");
    await nextTick();
    await w.find('[data-testid="copy-library-rewrite-c1"]').trigger("click");
    const handoff = JSON.parse(sessionStorage.getItem("rewrite_handoff_v1"));
    expect(handoff).toMatchObject({ content: "要改写的正文", fromKey: "collect:c1", platform: "douyin", title: "采集标题" });
    expect(pushSpy).toHaveBeenCalledWith("/rewrite?from=collection");
  });

  it("rewrite button on rewrite card chains via rewrite:<id> fromKey", async () => {
    const w = mountWithI18n();
    await nextTick();
    w.vm.rewrites = [RW];
    await w.vm.switchTab("records");
    await nextTick();
    await w.find('[data-testid="copy-library-rewrite-rrw1"]').trigger("click");
    const handoff = JSON.parse(sessionStorage.getItem("rewrite_handoff_v1"));
    expect(handoff).toMatchObject({ content: "改写后的正文内容", fromKey: "rewrite:rw1" });
    expect(pushSpy).toHaveBeenCalledWith("/rewrite?from=collection");
  });

  it("rewrite button warns instead of navigating when content is empty", async () => {
    const w = mountWithI18n();
    await nextTick();
    w.vm.collectedItems = [{ id: "c1", title: "无正文", content: "" }];
    await w.vm.switchTab("records");
    await nextTick();
    await w.vm.rewriteFromLibrary({ origin: "collect", item: w.vm.collectedItems[0] });
    expect(sessionStorage.getItem("rewrite_handoff_v1")).toBeNull();
    expect(pushSpy).not.toHaveBeenCalledWith("/rewrite?from=collection");
  });

  it("deleteLibraryRewrite removes the rewrite record only", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue(undefined);
    const storeSet = vi.fn().mockResolvedValue(undefined);
    window.electronAPI = { storeSetSetting: storeSet };
    const w = mountWithI18n();
    await nextTick();
    w.vm.rewrites = [RW];
    await w.vm.deleteLibraryRewrite(RW);
    const entry = storeSet.mock.calls.find((c) => c[0] === "copy_library_rewrites");
    expect(entry).toBeTruthy();
    expect(JSON.parse(entry[1]).find((it) => it.id === "rw1")).toBeUndefined();
  });

  it("writes in-page rewrite result into the copy library", async () => {
    const storeSet = vi.fn().mockResolvedValue(undefined);
    window.electronAPI = {
      aiRewrite: vi.fn().mockResolvedValue({ code: 0, data: { success: true, result: "改写结果正文" } }),
      storeSetSetting: storeSet,
    };
    const w = mountWithI18n();
    await nextTick();
    w.vm.collectedResult = { id: "c1", title: "标题", content: "原始正文内容，长度足够用于改写。", description: "" };
    await w.vm.rewriteCollected();
    await new Promise((r) => setTimeout(r, 0));
    const entry = storeSet.mock.calls.find((c) => c[0] === "copy_library_rewrites");
    expect(entry).toBeTruthy();
    expect(JSON.parse(entry[1])[0]).toMatchObject({ fromKey: "collect:c1", content: "改写结果正文" });
  });
});
