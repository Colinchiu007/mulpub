import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount, flushPromises } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
  ElDialog: {
    template: '<div class="el-dialog"><slot></slot></div>',
  },
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
import { messageIs, messageContains } from '../utils/toast-assert-helpers'

describe("CollectionView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  it("renders page title and buttons", async () => {
    const w = mountCollection();
    await nextTick();
    expect(w.text()).toContain("内容采集快捷采集草稿箱");
    expect(w.text()).toContain("新建草稿");
  });

  // 回归锁（CCG 评审 i6）：页签角标的模板引用 creatorPendingTotal，
  // 而它从未被定义过 —— `undefined > 0` 为 false，不抛错，角标**永远不显示**。
  // 这类「引用了但没定义」是静默失效，测试看不出来，只有肉眼对比才发现。
  it("博主监控页签的待采集角标：挂载时拉取并渲染", async () => {
    const creatorPendingTotal = vi.fn().mockResolvedValue({ code: 0, total: 7 });
    window.electronAPI = {
      creatorPendingTotal,
      storeGetSetting: vi.fn().mockResolvedValue("[]"),
      storeListSetting: vi.fn().mockResolvedValue("[]"),
      storeGet: vi.fn().mockResolvedValue(null),
      storeGetWithDefault: vi.fn().mockResolvedValue(null),
    };
    const w = mountCollection();
    await flushPromises();
    expect(creatorPendingTotal).toHaveBeenCalled();
    const badge = w.find('[data-testid="collection-tab-creator-badge"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toBe("7");
  });

  it("角标为 0 时不渲染徽标（不留空壳）", async () => {
    window.electronAPI = {
      creatorPendingTotal: vi.fn().mockResolvedValue({ code: 0, total: 0 }),
      storeGetSetting: vi.fn().mockResolvedValue("[]"),
      storeListSetting: vi.fn().mockResolvedValue("[]"),
      storeGet: vi.fn().mockResolvedValue(null),
      storeGetWithDefault: vi.fn().mockResolvedValue(null),
    };
    const w = mountCollection();
    await flushPromises();
    expect(w.find('[data-testid="collection-tab-creator-badge"]').exists()).toBe(false);
  });

  it("博主监控服务未就绪时不打断采集页", async () => {
    window.electronAPI = {
      creatorPendingTotal: vi.fn().mockRejectedValue(new Error("service-unavailable")),
      storeGetSetting: vi.fn().mockResolvedValue("[]"),
      storeListSetting: vi.fn().mockResolvedValue("[]"),
      storeGet: vi.fn().mockResolvedValue(null),
      storeGetWithDefault: vi.fn().mockResolvedValue(null),
    };
    const w = mountCollection();
    await flushPromises();
    expect(w.exists()).toBe(true);
    expect(w.find('[data-testid="collection-tab-creator-badge"]').exists()).toBe(false);
  });

  // 2026-10-12：草稿写入统一走 draftSave（与发布页同源，享受指纹幂等），
  // 不再用 storeGetSetting('drafts') 自己写一份（两套方言落同一行存储，互相污染）。
  it("drafts are persisted via draftSave, not storeSetSetting", async () => {
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "d-new" } });
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    await w.vm.createDraft();
    expect(draftSave).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith("/publish?draft=d-new");
  });

  it("createDraft tolerates missing draftSave API gracefully", async () => {
    window.electronAPI = {};
    const w = mountCollection();
    await nextTick();
    await w.vm.createDraft();
    expect(w.exists()).toBe(true);
  });

  it("creates a new draft and navigates", async () => {
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "d-manual" } });
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    await w.vm.createDraft();
    await nextTick();
    // 空白草稿也允许保存（allowEmpty），否则「新建草稿」永远跳不出第二份
    expect(draftSave).toHaveBeenCalledWith(expect.objectContaining({ source: "manual" }));
    expect(pushSpy).toHaveBeenCalledWith("/publish?draft=d-manual");
  });

  it("imports from clipboard", async () => {
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockResolvedValue("Title line\nContent here") },
      writable: true, configurable: true
    });
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "d-clip" } });
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    await w.vm.importFromClipboard();
    await nextTick();
    expect(draftSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "Title line",
      source: "clipboard",
    }));
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

  // 2026-10-12：素材来源入口改走 PLATFORM_SOURCE_URLS（语义「去哪找素材」），
  // 不再用 PLATFORM_DASHBOARD_URLS（创作者后台/发布目的地，且被登录态校验复用）。
  // 2026-10-17：知乎（强制登录）/ 头条（JSON 接口）两个入口换为免登录渲染页，
  // 断言改为对 baidu 取证，避免只测一条仍然通过而漏掉另一条的退化。
  it("openCollection opens a tab via pageManager with the SOURCE url", async () => {
    const { PLATFORM_SOURCE_URLS, PLATFORM_DASHBOARD_URLS } = await import("@multi-publish/shared-utils/src/platform-definitions");
    window.electronAPI = {
      pageManager: {
        createNewTabPage: vi.fn().mockResolvedValue({ code: 0, data: { tabId: "btab-1" } })
      }
    };
    const w = mountCollection();
    await nextTick();
    await w.vm.openCollection("baidu");
    expect(window.electronAPI.pageManager.createNewTabPage).toHaveBeenCalledWith(
      expect.objectContaining({ url: PLATFORM_SOURCE_URLS.baidu, platform: "baidu" })
    );
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
    // 语义独立锁：素材来源不得再指向创作者后台（头条那条曾是明确的分类错误）
    expect(PLATFORM_SOURCE_URLS.toutiao).not.toBe(PLATFORM_DASHBOARD_URLS.toutiao);
  });

  // 结构锁（2026-10-17）：模板里三张卡的来源 id 必须与 PLATFORM_SOURCE_URLS 的键逐一对齐。
  // 只改字典不改模板 = 死按钮；只改模板不改字典 = 点开即告警。两边一起看才锁得住。
  it("素材来源卡片与来源表逐一对齐（无知乎、无 JSON 入口）", async () => {
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/views/Collection.vue"), "utf8");
    for (const id of ["weibo", "baidu", "toutiao"]) {
      expect(src).toContain(`openCollection('${id}')`);
    }
    expect(src).not.toContain("openCollection('zhihu')");
    expect(src).not.toContain("sourceZhihu");
  });

  it("openCollection warns and skips when platform has no source URL", async () => {
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

  // S1c：均一的 editDraft / goPublish 两个入口已删除 ——
  // 它们实现完全相同（都 push `/publish?draft=<id>`），是规则 1 下的重复标签；
  // 收敛后由 /publish?tab=drafts 整页的单一「去发布」按钮承担。
  it("drafts 的编辑/发布入口不再存在于采集页（收敛到整页草稿箱）", async () => {
    const w = mountCollection();
    await nextTick();
    expect(w.vm.editDraft).toBeUndefined();
    expect(w.vm.goPublish).toBeUndefined();
  });

  // S1c：草稿删除能力随 CollectionDraftsPanel 一并迁到整页草稿箱，
  // 采集页不再有任何草稿删除入口。删除行为契约见
  // composables/useCollectionDrafts.test.js 的删除三例 + Publish.test.js 整页草稿箱。
  it("采集页不再有草稿删除入口", async () => {
    window.electronAPI = {
      draftDelete: vi.fn(),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "d1", title: "待删" }] }),
    };
    const w = mountCollection();
    await nextTick();
    await flushPromises();
    expect(w.find('[data-testid="draft-delete"]').exists()).toBe(false);
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
    expect(ElMessage.error).toHaveBeenCalledWith(messageIs("collection failed"));
  });

  // ── 结果区「点了没反应」修复（2026-10-17，change: collected-results-fix）──
  it("selectCollectedItem 选中该条并把详情框滚进视口（scrollIntoView + 高亮类）", async () => {
    window.electronAPI = {};
    const w = mountCollection();
    await nextTick();
    // 桩详情框锚（组件按 id 找；jsdom 无真实布局，断言 scrollIntoView 被调 + flash 类被加）
    const scrollSpy = vi.fn();
    const box = document.createElement("div");
    box.id = "collected-result-box";
    Object.defineProperty(box, "offsetWidth", { value: 10 });
    box.scrollIntoView = scrollSpy;
    document.body.appendChild(box);
    const item = { id: "x", title: "T", content: "c" };
    w.vm.selectCollectedItem(item);
    await nextTick();
    await nextTick();
    expect(w.vm.collectedResult).toStrictEqual(item);
    expect(scrollSpy).toHaveBeenCalled();
    expect(box.classList.contains("col-result-box--flash")).toBe(true);
    box.remove();
  });

  it("CollectedResultsList 的 @select 绑定的是 selectCollectedItem（不只是赋值）", async () => {
    // 结构锁：防止将来有人把 @select 改回 "collectedResult = $event" 而失去滚动反馈
    const { readFileSync } = await import("node:fs");
    const { join } = await import("node:path");
    const src = readFileSync(join(process.cwd(), "src/views/Collection.vue"), "utf8");
    expect(src).toContain('@select="selectCollectedItem"');
    expect(src).not.toContain('@select="collectedResult = $event"');
    expect(src).toContain('data-testid="collected-result-box"');
  });

  it("collectUrl 反爬安全验证页 → 回退 urlCollectFetch 而非误报成功", async () => {
    // 2026-09-29 起百家号链接先走视频通道（无视频回退 stealth），不再经聚合层；
    // 本回归用通用文章站点验证「安全验证页不得当成功」的语义仍然成立
    window.electronAPI = {
      aggregationCollect: vi.fn().mockResolvedValue({
        title: "百度安全验证",
        content: "网络不给力，请稍后重试",
        word_count: 0,
      }),
      urlCollectNeedsStealth: vi.fn().mockResolvedValue({ code: 0, data: { needsStealth: false } }),
      urlCollectFetch: vi.fn().mockResolvedValue({
        code: 0,
        data: { title: "真实文章标题", content: "真实正文内容" },
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://www.sohu.com/a/123";
    await w.vm.collectUrl();
    // 不应把「百度安全验证」当成功结果，而应回退到 Node 端 stealth 采集
    expect(window.electronAPI.urlCollectFetch).toHaveBeenCalledWith("https://www.sohu.com/a/123");
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
        // 2026-10-18：stealth 分支自动改写改走桌面改写引擎（读「模型设置」的默认文字推理模型），
        // 不再调 Python aggregationRewrite（它只读环境变量，必然误报 LLM_KEY_MISSING）。
        aiRewrite: vi.fn().mockResolvedValue({ code: 0, data: { success: true, result: "改写后的内容。" } }),
        aggregationRewrite: vi.fn(),
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

    it("collectAndRewrite：知乎链接采集走 stealth，改写走桌面引擎（读模型设置）", async () => {
      window.electronAPI = mockStealthApi();
      const w = mountCollection();
      await nextTick();
      w.vm.linkUrl = ZHIHU_ANSWER_URL;
      await w.vm.collectAndRewrite();
      expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
      expect(window.electronAPI.urlCollectFetch).toHaveBeenCalledWith(ZHIHU_ANSWER_URL);
      expect(w.vm.collectedResult.title).toBe("知乎回答标题");
      expect(w.vm.rewriteResult).toBe("改写后的内容。");
      // 回归锁（2026-10-18）：stealth 分支必须走读取「模型设置」的 aiRewrite，
      // 不得回退到只读环境变量的 Python aggregationRewrite。
      expect(window.electronAPI.aiRewrite).toHaveBeenCalledWith(
        expect.objectContaining({ content: expect.stringContaining("知乎回答正文内容") })
      );
      expect(window.electronAPI.aggregationRewrite).not.toHaveBeenCalled();
    });

    it("stealth 返回「百度安全验证」页 → 不入库、不触发改写、给出 security_challenge 文案", async () => {
      const api = mockStealthApi();
      api.urlCollectFetch = vi.fn().mockResolvedValue({
        code: 0,
        data: {
          title: "百度安全验证",
          content: "百度安全验证\n请完成下方验证后继续操作\n拖动左侧滑块使图片为正\n扫码验证| 意见反馈 |刷新",
        },
      });
      window.electronAPI = api;
      const w = mountCollection();
      await nextTick();
      w.vm.linkUrl = ZHIHU_ANSWER_URL;
      await w.vm.collectAndRewrite();
      // 验证页不是正文：绝不入库、绝不进入改写
      expect(w.vm.collectedResult).toBe(null);
      expect(w.vm.collectedItems.length).toBe(0);
      expect(w.vm.collectError.reason).toBe("security_challenge");
      expect(w.vm.collectErrorDetail).toContain("安全验证");
      expect(api.aiRewrite).not.toHaveBeenCalled();
      expect(api.aggregationRewrite).not.toHaveBeenCalled();
    });

    it("验证页文字命中 persistDraft 守卫 → 不创建草稿、不跳发布页", async () => {
      const draftSave = vi.fn();
      window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
      const w = mountCollection();
      await nextTick();
      const verificationItem = {
        id: "v1",
        title: "百度安全验证",
        content: "请完成下方验证后继续操作\n拖动左侧滑块使图片为正",
        source: "url",
      };
      await w.vm.goPublishFromItem(verificationItem);
      expect(draftSave).not.toHaveBeenCalled();
      expect(pushSpy).not.toHaveBeenCalled();
    });

    // ─── 2026-10-18 空正文改写守卫（fix-collect-rewrite-empty-content）───
    // 事故链：内容缓存命中返回空壳 {title:'',content:''}（url-collector.js cache_hit），
    // 「一键改写」拿空串当改写入参 → 旧后端 min_length=1 报 422「Python backend request
    // failed」，文案毫无指向性；新代码走桌面引擎虽不会 422，但同样会把空内容发出去。
    // 判据：改写漏斗 rewriteViaEngine 一律判空（trim），空内容返回稳定错误码
    // AGGREGATION_CONTENT_EMPTY，且绝不调用 aiRewrite。
    describe("空正文改写守卫（rewriteViaEngine 漏斗判空）", () => {
      it("空串 → 不调 aiRewrite，返回 AGGREGATION_CONTENT_EMPTY 错误信封", async () => {
        window.electronAPI = mockStealthApi();
        const w = mountCollection();
        await nextTick();
        const r = await w.vm.rewriteViaEngine("");
        expect(window.electronAPI.aiRewrite).not.toHaveBeenCalled();
        expect(r).not.toBe(null);
        expect(r.__error).toBeTruthy();
        expect(r.__error.errorCode).toBe("AGGREGATION_CONTENT_EMPTY");
        expect(r.__error.code).toBe(-400);
      });

      it("纯空白（空格/换行/制表）同样拦截 —— 不得把不可见字符当正文", async () => {
        window.electronAPI = mockStealthApi();
        const w = mountCollection();
        await nextTick();
        const r = await w.vm.rewriteViaEngine("  \n\t  ");
        expect(window.electronAPI.aiRewrite).not.toHaveBeenCalled();
        expect(r.__error.errorCode).toBe("AGGREGATION_CONTENT_EMPTY");
      });

      it("collectAndRewrite：缓存空壳（content 为空）→ 提示空内容文案，不改写", async () => {
        const api = mockStealthApi();
        // 复现事故形态：cache_hit 空壳 —— title/content 均为空串
        api.urlCollectFetch = vi.fn().mockResolvedValue({
          code: 0,
          data: { success: true, reason: "cache_hit", title: "", content: "" },
        });
        window.electronAPI = api;
        const w = mountCollection();
        await nextTick();
        w.vm.linkUrl = ZHIHU_ANSWER_URL;
        await w.vm.collectAndRewrite();
        expect(api.aiRewrite).not.toHaveBeenCalled();
        expect(api.aggregationRewrite).not.toHaveBeenCalled();
        expect(w.vm.rewriteResult).toBe("");
        expect(w.vm.rewriteError).toBeTruthy();
        expect(w.vm.rewriteError.message).toContain("采集");
        expect(w.vm.rewriteErrorDetail || w.vm.rewriteError.message).toContain("改写");
      });

      it("正常内容不受影响（回归：守卫不得误杀）", async () => {
        window.electronAPI = mockStealthApi();
        const w = mountCollection();
        await nextTick();
        const r = await w.vm.rewriteViaEngine("这是一段长度足够的正常正文内容。");
        expect(window.electronAPI.aiRewrite).toHaveBeenCalled();
        expect(r.result_content).toBe("改写后的内容。");
      });
    });

    // QM-6 外部评审 P3（2026-10-18）：abortIfVerificationPage 写入的 `reason` 必须被
    // collectErrorDetail/collectErrorRetryable 消费；否则分类器只拿到 message 字符串，
    // en 文案不含中文关键词时会退化为 collectErrors.unknown。
    it("collectErrorDetail 优先采信结构化 reason（message 不含中文关键词也不退化 unknown）", async () => {
      const w = mountCollection();
      await nextTick();
      w.vm.collectError = {
        code: -1,
        reason: "security_challenge",
        message: "The target page triggered a security check",
      };
      expect(w.vm.collectErrorDetail).toContain("安全验证");
      expect(w.vm.collectErrorDetail).not.toContain("原因未识别");
      expect(w.vm.collectErrorRetryable).toBe(true);
    });

    it("urlCollectFetch 失败信封的 data.reason 会进入 collectError（结构化分类不丢）", async () => {
      window.electronAPI = {
        urlCollectNeedsStealth: vi.fn().mockResolvedValue({ code: 0, data: { needsStealth: true } }),
        urlCollectFetch: vi.fn().mockResolvedValue({
          code: -1,
          message: "采集失败: 目标站点返回安全验证页",
          data: {
            success: false,
            reason: "security_challenge",
            error: "目标站点返回安全验证页（百度安全验证），请稍后再试或先在浏览器中完成验证",
          },
        }),
      };
      const w = mountCollection();
      await nextTick();
      // 用非视频平台 URL，避免先进入视频采集通道（百家号 /s 属视频平台路由）
      w.vm.linkUrl = "https://www.sohu.com/a/123";
      await w.vm.collectUrl();
      expect(w.vm.collectError.reason).toBe("security_challenge");
      expect(w.vm.collectedItems.length).toBe(0);
      expect(w.vm.collectErrorDetail).toContain("安全验证");
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

  // ── 六平台视频链接扩展 + 分享文本健壮解析（2026-09-29，collect-video-platforms） ──

  it("extractUrlFromShareText URL 与中文无空格粘连 → 不吞中文（CJK 排除字符类）", async () => {
    const w = mountCollection();
    expect(w.vm.extractUrlFromShareText("https://v.douyin.com/abc/复制此链接打开抖音")).toBe("https://v.douyin.com/abc/");
    expect(w.vm.extractUrlFromShareText("看这个https://www.xiaohongshu.com/explore/abc?xsec_token=x&xsec_source=app_share复制此链接")).toBe("https://www.xiaohongshu.com/explore/abc?xsec_token=x&xsec_source=app_share");
    expect(w.vm.extractUrlFromShareText("【标题】https://b23.tv/abc1234复制此链接，打开哔哩哔哩App观看")).toBe("https://b23.tv/abc1234");
  });

  it("extractUrlFromShareText 用户目标原文（抖音完整分享文本）→ 提取真实短链", async () => {
    const w = mountCollection();
    const text = "0.02 P@x.FH 05/09 :6pm ATl:/ 当你在2026年再次听到这首歌（第5集）# ladygaga # pokerface # 高中生 https://v.douyin.com/vknKdeN_naU/ 复制此链接，打开Dou音搜索，直接观看视频！";
    expect(w.vm.extractUrlFromShareText(text)).toBe("https://v.douyin.com/vknKdeN_naU/");
  });

  it("extractUrlFromShareText 百家号分享文本 → 提取百家号链接", async () => {
    const w = mountCollection();
    const text = "标题文字 https://baijiahao.baidu.com/s?id=1877446299628255783 复制此链接，打开百度App查看";
    expect(w.vm.extractUrlFromShareText(text)).toBe("https://baijiahao.baidu.com/s?id=1877446299628255783");
  });

  it("extractUrlFromShareText 尾部标点清理与多链接优先视频平台", async () => {
    const w = mountCollection();
    expect(w.vm.extractUrlFromShareText("https://example.com/page。")).toBe("https://example.com/page");
    // 多链接时优先视频平台域名
    expect(w.vm.extractUrlFromShareText("先看 https://example.com/a 再看 https://www.zhihu.com/zvideo/123。")).toBe("https://www.zhihu.com/zvideo/123");
    expect(w.vm.extractUrlFromShareText("先看 https://example.com/a 再看 https://b23.tv/xyz/。")).toBe("https://b23.tv/xyz/");
  });

  it("isVideoPlatformUrl 六平台矩阵（域名级 + 路径级）", async () => {
    const w = mountCollection();
    // 域名级（整站视频/短链）
    expect(w.vm.isVideoPlatformUrl("https://v.douyin.com/abc/")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://www.douyin.com/video/730")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://www.iesdouyin.com/share/video/123")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://www.xiaohongshu.com/explore/x")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://xhslink.com/x")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://b23.tv/abc123")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://channels.weixin.qq.com/web/shares/video/123")).toBe(true);
    // 路径级（域名下仅特定路径是视频页）
    expect(w.vm.isVideoPlatformUrl("https://www.bilibili.com/video/BV1GJ411x7h7")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://www.zhihu.com/zvideo/1342930761977176064")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://baijiahao.baidu.com/s?id=1877446299628255783")).toBe(true);
    expect(w.vm.isVideoPlatformUrl("https://mbd.baidu.com/newspage/data/xxx")).toBe(true);
    // 负向：非视频路径继续走图文链路（不破坏既有采集）
    expect(w.vm.isVideoPlatformUrl("https://www.zhihu.com/question/1")).toBe(false);
    expect(w.vm.isVideoPlatformUrl("https://zhuanlan.zhihu.com/p/123")).toBe(false);
    expect(w.vm.isVideoPlatformUrl("https://space.bilibili.com/12345")).toBe(false);
    expect(w.vm.isVideoPlatformUrl("https://example.com")).toBe(false);
    expect(w.vm.isVideoPlatformUrl("not a url")).toBe(false);
  });

  it("collectUrl B站视频链接 → 走视频通道（yt-dlp 原生支持）", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        title: "B站视频", content: "文案", transcript: "文案", word_count: 2,
        media_type: "video", duration: 212, metadata: { platform: "bilibili" },
      }),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://www.bilibili.com/video/BV1GJ411x7h7";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalledWith({ url: "https://www.bilibili.com/video/BV1GJ411x7h7" });
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
    expect(w.vm.collectedResult.platform).toBe("bilibili");
  });

  it("collectUrl 知乎 zvideo 链接 → 走视频通道", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        title: "知乎视频", content: "文案", media_type: "video", duration: 146, metadata: { platform: "zhihu" },
      }),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://www.zhihu.com/zvideo/1342930761977176064";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalledWith({ url: "https://www.zhihu.com/zvideo/1342930761977176064" });
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
  });

  it("collectUrl 百家号文章链接 → 走视频通道", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        title: "百家号视频", content: "文案", media_type: "video", duration: 100, metadata: { platform: "baijiahao" },
      }),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://baijiahao.baidu.com/s?id=1877446299628255783";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalledWith({ url: "https://baijiahao.baidu.com/s?id=1877446299628255783" });
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
  });

  it("collectUrl 百家号文章无视频（VIDEOCLONE_NO_VIDEO）→ 提示后回退图文采集链路", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        code: -422, status: 422,
        message: "VIDEOCLONE_NO_VIDEO: 该链接不含视频",
      }),
      urlCollectNeedsStealth: vi.fn().mockResolvedValue({ code: 0, data: { needsStealth: true } }),
      urlCollectFetch: vi.fn().mockResolvedValue({ code: 0, data: { title: "图文标题", content: "图文正文内容", word_count: 7 } }),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://baijiahao.baidu.com/s?id=123";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalled();
    // NO_VIDEO 不报错中断 → 落回 stealth 图文链路继续采集
    expect(window.electronAPI.urlCollectFetch).toHaveBeenCalledWith("https://baijiahao.baidu.com/s?id=123");
    expect(w.vm.collectError).toBeFalsy();
    expect(w.vm.collectedResult).toBeTruthy();
    expect(w.vm.collectedResult.title).toBe("图文标题");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.info).toHaveBeenCalled();
  });

  it("collectUrl 视频号链接 → 显示「暂不支持」明确错误（不落图文）", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      urlCollectFetch: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        code: -422, status: 422,
        message: "VIDEOCLONE_CHANNELS_UNSUPPORTED: 视频号视频需要微信登录态，暂不支持自动采集，请更换其他平台链接",
      }),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://channels.weixin.qq.com/web/shares/video/123";
    await w.vm.collectUrl();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalled();
    expect(w.vm.collectError).toBeTruthy();
    expect(w.vm.collectErrorDetail).toContain("视频号");
    expect(window.electronAPI.urlCollectFetch).not.toHaveBeenCalled();
  });

  it("collectAndRewrite B站视频链接 → 走视频通道并用转写文案改写", async () => {
    window.electronAPI = {
      aggregationCollect: vi.fn(),
      aggregationCollectVideo: vi.fn().mockResolvedValue({
        title: "B站视频", content: "转写文案内容", transcript: "转写文案内容", word_count: 6,
        media_type: "video", duration: 60, metadata: { platform: "bilibili" },
      }),
      aiRewrite: vi.fn().mockResolvedValue({ result_content: "改写结果", code: 0 }),
      storeSetSetting: vi.fn(),
    };
    const w = mountCollection();
    await nextTick();
    w.vm.linkUrl = "https://www.bilibili.com/video/BV1xx411c7mD";
    await w.vm.collectAndRewrite();
    expect(window.electronAPI.aggregationCollectVideo).toHaveBeenCalledWith({ url: "https://www.bilibili.com/video/BV1xx411c7mD" });
    expect(window.electronAPI.aggregationCollect).not.toHaveBeenCalled();
    expect(window.electronAPI.aiRewrite).toHaveBeenCalled();
  });

  it("platformLabel 六平台标签渲染", async () => {
    const w = mountCollection();
    expect(w.vm.platformLabel("douyin")).toBe("抖音");
    expect(w.vm.platformLabel("xiaohongshu")).toBe("小红书");
    expect(w.vm.platformLabel("bilibili")).toBe("哔哩哔哩");
    expect(w.vm.platformLabel("zhihu")).toBe("知乎");
    expect(w.vm.platformLabel("channels")).toBe("视频号");
    expect(w.vm.platformLabel("baijiahao")).toBe("百家号");
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
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "d-col" } });
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = { title: "Article", content: "Content", coverImage: "img.jpg", source: "url" };
    w.vm.linkUrl = "https://example.com/article";
    await w.vm.createFromCollected();
    expect(draftSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "Article",
      content: "Content",
      cover_url: "img.jpg",
    }));
    expect(w.vm.collectedResult).toBeNull();
    expect(w.vm.linkUrl).toBe("");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalled();
  });

  it("createFromCollected does nothing if no collected result", async () => {
    const draftSave = vi.fn();
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    w.vm.collectedResult = null;
    await w.vm.createFromCollected();
    expect(draftSave).not.toHaveBeenCalled();
  });

  // S1c：草稿箱整页迁出采集页。页内不再渲染草稿列表（第 4 处 UI 已删除），
  // 点击「草稿箱」页签改为 router.push('/publish?tab=drafts')。
  it("collect tab no longer renders any inline drafts section", async () => {
    const w = mountCollection();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.find('[data-testid="collection-drafts-empty"]').exists()).toBe(false);
    expect(w.find('[data-testid="collection-drafts-panel"]').exists()).toBe(false);
    expect(w.find('[data-testid="collection-drafts-list"]').exists()).toBe(false);
  });

  it("clicking the drafts tab navigates to the single whole-page drafts view", async () => {
    pushSpy.mockClear();
    const w = mountCollection();
    await nextTick();
    await w.find('[data-testid="collection-tab-drafts"]').trigger("click");
    await flushPromises();
    expect(pushSpy).toHaveBeenCalledWith("/publish?tab=drafts");
    // 不得在本页渲染列表（原 CollectionDraftsPanel 已删除）
    expect(w.find('[data-testid="collection-drafts-panel"]').exists()).toBe(false);
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
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "d-list" } });
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    const item = { id: "abc", title: "From List", content: "list content", source: "rss", sourceUrl: "https://ex.com" };
    await w.vm.createFromItem(item);
    expect(draftSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "From List",
      source: "rss",
      sourceUrl: "https://ex.com",
    }));
    expect(pushSpy).toHaveBeenCalledWith("/publish?draft=d-list");
  });

  it("sendItemToPipeline navigates to create", async () => {
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "d-pipe" } });
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    const item = { id: "abc", title: "Pipeline Item", content: "content", source: "url" };
    await w.vm.sendItemToPipeline(item);
    expect(draftSave).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith(expect.stringContaining("/create?draft=d-pipe"));
  });

  it("goPublishFromItem navigates to publish", async () => {
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "d-pub" } });
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    const item = { id: "abc", title: "Publish Item", content: "content", source: "url" };
    await w.vm.goPublishFromItem(item);
    expect(draftSave).toHaveBeenCalled();
    expect(pushSpy).toHaveBeenCalledWith(expect.stringContaining("/publish?draft=d-pub"));
  });

  it("collectedItems list renders in template", async () => {
    const w = mountCollection();
    await nextTick();
    w.vm.collectedItems = [
      { id: "i1", title: "Item 1", content: "c1", source: "url", wordCount: 100 },
      { id: "i2", title: "Item 2", content: "c2", source: "rss", wordCount: 200 },
    ];
    await nextTick();
    // collection-ui-refinement：渲染迁入 CollectedResultsList 子组件，计数标题与卡片照常渲染
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
    // Click clear button（清空按钮在 CollectedResultsList 标题行内）
    const btn = w.find(".cohere-section-title button");
    await btn.trigger("click");
    expect(w.vm.collectedItems.length).toBe(0);
    expect(w.vm.collectedResult).toBeNull();
  });

  it("renders one-click rewrite button", async () => {
    const w = mountCollection();
    await nextTick();
    expect(w.text()).toContain("一键改写");
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

  it("renders word count inputs EMPTY by default (no limit) and replaces length select", async () => {
    // 2026-10-20 collection-ux-step-flow：默认值由 800-2000 改为**留空**。
    // 用户诉求是「默认让改写引擎自由发挥，不给限制，除非用户自己填写数字」——
    // 预填 800-2000 等于每次改写都被强制压进一个窄区间。
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
    expect(w.vm.rewriteWordCountMin).toBe('');
    expect(w.vm.rewriteWordCountMax).toBe('');
    // 留空 = 不报错（allowEmpty 语义），且「AI 改写」按钮不被字数校验挡住
    expect(w.vm.rewriteWordCountError).toBe('');
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
    expect(w.text()).toContain("内容采集");
    expect(w.text()).toContain("文案库");
    // 默认在采集 tab
    expect(w.vm.activeTab).toBe("collect");
    // 切换到采集记录 tab
    await w.vm.switchTab("records");
    await nextTick();
    expect(w.vm.activeTab).toBe("records");
    expect(w.text()).toContain("暂无文案");
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
    const draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "d-rec" } });
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    const item = { id: "rec1", title: "Record Title", content: "record content", source: "rss", sourceUrl: "https://ex.com" };
    await w.vm.openRecordForEdit(item);
    expect(draftSave).toHaveBeenCalledWith(expect.objectContaining({ title: "Record Title" }));
    expect(pushSpy).toHaveBeenCalledWith("/publish?draft=d-rec");
  });

  it("openRecordForEdit does nothing for invalid item", async () => {
    const draftSave = vi.fn();
    window.electronAPI = { draftSave, draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
    const w = mountCollection();
    await nextTick();
    await w.vm.openRecordForEdit(null);
    expect(draftSave).not.toHaveBeenCalled();
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

  it("renders tabs and the copy library tab switches to records", async () => {
    const w = mountWithI18n();
    await nextTick();
    expect(w.find('[data-testid="collection-tab-library"]').exists()).toBe(true);
    expect(w.text()).toContain("文案库");
    // 原独立「文案库」第三个标签已移除（tabLibrary 不再出现在标签栏）
    // 采集页原有采集/文案库两个 tab，加博主监控三个、「快捷采集」四个；
    // 2026-10-12 加入「草稿箱」后共五个。断言数量是为了让「多加/少加 tab」
    // 必须显式改测试，不能悄悄发生。
    expect(w.findAll(".collection-tab-btn").length).toBe(5);
    await w.find('[data-testid="collection-tab-library"]').trigger("click");
    await nextTick();
    expect(w.vm.activeTab).toBe("records");
  });

  it("switches to the quick collect tab", async () => {
    const w = mountWithI18n();
    await nextTick();
    expect(w.find('[data-testid="collection-tab-quick-collect"]').exists()).toBe(true);
    await w.find('[data-testid="collection-tab-quick-collect"]').trigger("click");
    await nextTick();
    expect(w.vm.activeTab).toBe("quick");
    expect(w.find('[data-testid="quick-collect-panel"]').exists()).toBe(true);
  });

  it("onQuickCollected 入库并切回采集页签（与手动采集同一链路）", async () => {
    window.electronAPI = { storeSetSetting: vi.fn().mockResolvedValue(undefined) };
    const w = mountWithI18n();
    await nextTick();
    await w.vm.switchTab("quick");
    await nextTick();

    const item = {
      id: "qc-item-1",
      title: "AI 领域动向 · 2026-10-11",
      content: "本次检索到三条值得关注的消息。",
      source: "AI 领域动向",
      sourceUrl: "https://example.com/a",
      quickCollect: { commandId: "builtin-ai-trends", commandTitle: "AI 领域动向", materialCount: 3, retrieval: "ok" },
    };
    await w.findComponent({ name: "QuickCollectPanel" }).vm.$emit("collected", item);
    await nextTick();

    expect(w.vm.activeTab).toBe("collect");
    expect(w.vm.collectedItems.length).toBe(1);
    expect(w.vm.collectedItems[0].quickCollect.commandTitle).toBe("AI 领域动向");
    expect(w.vm.collectedResult.id).toBe("qc-item-1");
    expect(window.electronAPI.storeSetSetting).toHaveBeenCalledWith("collected_items", expect.any(String));
  });

  it("switches to the creator monitor tab", async () => {
    const w = mountWithI18n();
    await nextTick();
    expect(w.find('[data-testid="collection-tab-creator"]').exists()).toBe(true);
    await w.find('[data-testid="collection-tab-creator"]').trigger("click");
    await nextTick();
    expect(w.vm.activeTab).toBe("creator");
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

// ────────────────────────────────────────────────────────────────────────────
// M-16：卸载清理。Collection.vue 的 onUnmounted 此前漏了两处异步副作用：
//   ① 视频采集的阶段推进是一串 setTimeout（videoStageTimers），只在两处 finally
//      里停，用户在采集途中离开页面时它们继续对**已卸载组件**写 videoCollectStage；
//   ② ASR 安装成功后的 1200ms 自动重试计时器，从未被追踪过。
//
// 用「真实挂载 + 真实卸载 + 假定时器」验证：只看源码断言没用 —— 缺陷正是
// 「源码里有清理逻辑、只是漏了某几个」。
// ────────────────────────────────────────────────────────────────────────────
describe("M-16 CollectionView 卸载清理", () => {
  let timers;

  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
    timers = [];
    vi.spyOn(globalThis, "setTimeout").mockImplementation((fn, ms, ...rest) => {
      const handle = { fn, ms, cleared: false };
      timers.push(handle);
      return handle;
    });
    vi.spyOn(globalThis, "clearTimeout").mockImplementation((h) => {
      if (h && typeof h === "object") h.cleared = true;
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("卸载时必须停掉视频采集的阶段推进计时器", () => {
    const w = mountCollection();
    w.vm.startVideoStageProgression?.();
    expect(timers.length, "应排出阶段推进计时器").toBeGreaterThan(0);

    w.unmount();

    const pending = timers.filter((t) => !t.cleared);
    expect(pending.length, "卸载后仍有未取消的计时器，会对已卸载组件继续写状态").toBe(0);
  });

  it("ASR 安装后的自动重试计时器必须随卸载取消", async () => {
    const w = mountCollection();
    window.electronAPI.aggregationAsrInstall = vi.fn(async () => ({ code: 0 }));
    if (typeof w.vm.startAsrInstall === "function") {
      await w.vm.startAsrInstall();
      await Promise.resolve();
    }
    const retry = timers.find((t) => t.ms === 1200);
    expect(retry, "应排出一个 1200ms 的自动重试计时器").toBeTruthy();

    w.unmount();
    expect(retry.cleared, "卸载后仍会跑 → closeAsrInstallDialog + collectUrl 打到已卸载组件").toBe(true);
  });

  it("反向锁：清理不得把功能关掉（卸载后再调 stopVideoStageProgression 不抛）", () => {
    const w = mountCollection();
    expect(w.vm).toBeTruthy();
    w.unmount();
    expect(() => w.vm.stopVideoStageProgression?.()).not.toThrow();
  });
});
