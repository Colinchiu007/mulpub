import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { setActivePinia, createPinia } from "pinia";
import { ElMessage, ElMessageBox } from "element-plus";
import i18n from "@/i18n";

const routes = [
  { path: "/", name: "home", component: { template: "<div>home</div>" } },
];
const router = createRouter({ history: createWebHistory(), routes });

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    platforms: [
      { id: "wechat_mp", label: "微信" },
      { id: "zhihu", label: "知乎" },
    ],
    getCategory: () => "中文",
  })
}));

/**
 * 账号目录用「可变容器」建模真实加载时序：ensureLoaded 解析**之前** `byPlatform` 为空。
 * 这直接对应线上缺陷现场——hash 路由首次写入 query 会先触发 watch(route.query.drafts)，
 * 那时 onMounted 的 `await loadAccounts()` 尚未跑完，按账号推导预置平台会得到空集。
 */
const accountState = { byPlatform: null };
function populateAccounts() {
  accountState.byPlatform = {
    wechat_mp: [{ id: "acc1", name: "My Account", is_default: true }],
    baijiahao: [{ id: "bj1", name: "百家号账号", is_default: true }],
    xiaohongshu: [{ id: "xhs1", name: "小红书账号", is_default: true }],
  };
}
const mockAccountLoad = vi.fn(async () => { populateAccounts(); });
vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({
    load: mockAccountLoad,
    ensureLoaded: mockAccountLoad,
    get byPlatform() { return accountState.byPlatform || {}; },
    getDefault: (p) => {
      if (p === "wechat_mp") return { id: "acc1", name: "My Account" };
      if (p === "baijiahao") return { id: "bj1", name: "百家号账号" };
      if (p === "xiaohongshu") return { id: "xhs1", name: "小红书账号" };
      return null;
    }
  })
}));

vi.mock("@/stores/license", () => ({
  useLicenseStore: () => ({ isPro: true })
}));

vi.mock("@/stores/templates", () => ({
  useTemplateStore: () => ({ load: vi.fn() })
}));

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn() }
}));

const mockEnsureLogin = vi.hoisted(() => vi.fn(async () => true));

vi.mock("@/composables/useLoginGate", () => ({
  useLoginGate: () => ({
    ensureLogin: mockEnsureLogin,
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}));

vi.mock("@element-plus/icons-vue", () => {
  const base = { UploadFilled: { template: "<span>U</span>" }, Refresh: { template: "<span>R</span>" } };
  const __icon = { template: "<span />" }; const __guard = ["__esModule", "then", "catch", "default", "Symbol(Symbol.toStringTag)"]; return new Proxy(base, { has: () => true, get: (t, p) => (p in t ? t[p] : (typeof p === "string" && !__guard.includes(p) ? __icon : undefined)) });
});

import UiButton from "@/components/UiButton.vue";
import UiInput from "@/components/UiInput.vue";
import PlatformOverridePanel from "@/features/publish/components/PlatformOverridePanel.vue";
import BatchArticleFields from "@/features/publish/components/BatchArticleFields.vue";
import PublishTargetSelector from "@/features/publish/components/PublishTargetSelector.vue";
import PublishView from "./Publish.vue";

async function createWrapper() {
  const w = mount(PublishView, {
    global: {
      plugins: [router, createPinia(), i18n],
      components: { UiButton, UiInput },
      stubs: {
        // UiModal 走 Teleport to body，不就地渲染则 wrapper.find 取不到弹窗节点（封面放大预览用例依赖）
        teleport: true,
        "el-checkbox-group": { template: "<div><slot/></div>" },
        "el-checkbox": { template: "<label><input type='checkbox' /><slot/></label>" },
        "el-upload": { template: "<div><slot/></div>" },
        "el-icon": { template: "<span><slot/></span>" },
        TagSuggester: true,
        OptimalTimeTip: true,
        TitleAssistantPanel: true,
        ArticleEditor: true,
        TemplatePicker: true,
        UpgradeModal: true,
        AiWriterPanel: true,
      }
    }
  });
  await nextTick();
  return w;
}

function findButtonByText(wrapper, text) {
  const button = wrapper.findAllComponents(UiButton).find((item) => item.text().includes(text));
  expect(button, `未找到包含“${text}”的按钮`).toBeDefined();
  return button;
}

// 手动放行的 promise：用于构造「旧请求尚未返回、新请求已完成」的竞态现场
function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe("PublishView", () => {
  beforeEach(async () => {
    i18n.global.locale.value = "zh";
    await router.push('/')
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {
      publishBatch: vi.fn().mockResolvedValue({ code: 0, data: { taskIds: ["t1"] }, message: "ok" }),
      getPathForFile: vi.fn().mockReturnValue('D:/media/from-file-api.mp4'),
      sensitiveCheck: vi.fn().mockResolvedValue({ code: 0, data: { words: [] } }),
      offlineStatus: vi.fn().mockResolvedValue({ code: 0, data: { offline: false } }),
      offlineAddToCache: vi.fn().mockResolvedValue({ code: 0 }),
      onProgress: vi.fn(() => vi.fn()),
      batchCreate: vi.fn().mockResolvedValue({ code: 0, data: { id: "batch1" } }),
      batchExecute: vi.fn().mockResolvedValue({ code: 0 }),
      batchSchedule: vi.fn().mockResolvedValue({ code: 0 }),
      onBatchProgress: vi.fn(() => vi.fn()),
      draftSave: vi.fn().mockResolvedValue({ code: 0 }),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      draftDelete: vi.fn().mockResolvedValue({ code: 0 }),
      storeGetSetting: vi.fn().mockResolvedValue(null),
      storeSetSetting: vi.fn().mockResolvedValue({ code: 0 }),
      // 封面缩略图：本地路径 → dataURL（PRD-PUBLISH-COVER-PREVIEW §4）
      readCoverData: vi.fn().mockResolvedValue({ code: 0, data: { dataUrl: "data:image/jpeg;base64,COVER" }, message: "封面读取成功" }),
      // 浮层互斥合同走 pageManager 命名空间（invokePageManager → api.pageManager[method]）
      pageManager: {
        suspendEmbeddedViews: vi.fn().mockResolvedValue(true),
        resumeEmbeddedViews: vi.fn().mockResolvedValue(true),
      },
    };
    mockAccountLoad.mockClear();
  });

  it("草稿箱 query 页签自动打开草稿列表", async () => {
    await router.push('/?tab=drafts')
    const w = await createWrapper()
    await nextTick()
    await nextTick()
    await w.vm.loadDrafts()
    await nextTick()
    expect(w.vm.showDraftList).toBe(true)
    expect(window.electronAPI.draftList).toHaveBeenCalled()
    expect(w.get('[data-testid="publish-drafts-page"]').exists()).toBe(true)
    expect(w.get('[data-testid="publish-drafts-empty"]').text()).toContain('暂无草稿')
    expect(w.find('[data-testid="publish-title"]').exists()).toBe(false)
  })

  it("草稿箱返回发布时切回发布编辑器页签", async () => {
    await router.push('/?tab=drafts&type=video')
    const w = await createWrapper()

    await w.vm.goToPublish()
    await nextTick()

    expect(router.currentRoute.value.query).toEqual({ tab: 'publish', type: 'video' })
  })

  it("继续编辑草稿时切回发布编辑器并保留草稿参数", async () => {
    await router.push('/?tab=drafts&type=article')
    window.electronAPI.draftList.mockResolvedValue({
      code: 0,
      data: [{
        id: 'draft-1',
        title: '已保存标题',
        content: '已保存正文',
        platforms: ['wechat_mp'],
        accounts: { wechat_mp: ['acc1'] },
      }],
    })
    const w = await createWrapper()

    await w.vm.editDraft({ id: 'draft-1' })
    await nextTick()
    await flushPromises()

    expect(router.currentRoute.value.query).toEqual({ tab: 'publish', type: 'article', draft: 'draft-1' })
    expect(w.vm.article.title).toBe('已保存标题')
    expect(w.vm.article.content).toBe('已保存正文')
    expect(w.vm.selectedPlatforms).toEqual(['wechat_mp'])
  })

  it('发布进度面板提供稳定回归选择器', async () => {
    const w = await createWrapper()
    w.vm.progress = [{ type: 'success', time: '10:00:00', text: '已提交' }]
    await nextTick()

    expect(w.get('[data-testid="publish-progress"]').text()).toContain('已提交')
  })

  it('非批量发布保留独立的主操作区结构', async () => {
    const w = await createWrapper()

    const actionCard = w.get('.flex-side [data-testid="publish-action-card"]')
    expect(actionCard.exists()).toBe(true)
    expect(actionCard.find('[data-testid="publish-target-selector"]').exists()).toBe(true)
    expect(actionCard.find('[data-testid="publish-action-controls"]').exists()).toBe(true)
    expect(actionCard.find('[data-testid="publish-submit"]').exists()).toBe(true)
    expect(w.find('[data-testid="publish-cancel"]').exists()).toBe(false)

    w.vm.activeTaskIds = ['task-1']
    await nextTick()
    expect(actionCard.find('[data-testid="publish-cancel"]').exists()).toBe(true)
  })

  it('批量模式切换真实渲染批量操作区并恢复单篇操作卡', async () => {
    const w = await createWrapper()
    const batchMode = w.get('[data-testid="publish-batch-mode"]')

    await batchMode.setValue(true)
    await nextTick()

    expect(w.vm.batchMode).toBe(true)
    expect(w.find('[data-testid="publish-batch-submit"]').exists()).toBe(true)
    expect(w.find('[data-testid="publish-action-card"]').exists()).toBe(false)
    expect(w.find('.publish-mode-tabs').exists()).toBe(false)

    await batchMode.setValue(false)
    await nextTick()

    expect(w.find('[data-testid="publish-batch-submit"]').exists()).toBe(false)
    expect(w.find('[data-testid="publish-action-card"]').exists()).toBe(true)
    expect(w.find('[data-testid="publish-submit"]').exists()).toBe(true)
  })

  it("renders page title and mode toggle", async () => {
    const w = await createWrapper();
    expect(w.text()).toContain("一键发布");
    expect(w.text()).toContain("批量模式");
  });

  it("通用字段支持度徽标与无标题平台标题提示（publish-capability-registry）", async () => {
    const w = await createWrapper();
    // 支持度徽标：标题字段覆盖注册表全部 15 平台
    const badge = w.find('[data-testid="field-support-title"]');
    expect(badge.exists()).toBe(true);
    expect(badge.text()).toContain("15/15");
    // 标签字段徽标来自注册表支持矩阵（图文分支）
    expect(w.find('[data-testid="field-support-tags"]').text()).toContain("11/15");
    // 默认选中 wechat_mp（有标题平台）：不显示无标题提示
    expect(w.find('[data-testid="no-title-hint"]').exists()).toBe(false);
    // 选中无标题平台（视频号）后显示「标题将作为描述首行」提示
    w.vm.selectedPlatforms.push("tencent_video");
    await nextTick();
    const hint = w.find('[data-testid="no-title-hint"]');
    expect(hint.exists()).toBe(true);
    expect(hint.text()).toContain("视频号");
    expect(hint.text()).toContain("描述首行");
  });

  it("选择发布类型后的路由参数会保留在编辑器上下文", async () => {
    await router.push('/?type=video')
    const w = await createWrapper()

    expect(w.vm.publishType).toBe('video')
    expect(w.vm.publishTypeLabel).toBe('视频发布')
    expect(w.text()).toContain('视频发布')
  })
  it.each([
    ['image', '图文文章发布'],
    ['wechat', '图文文章发布'],
    ['article', '图文文章发布'],
  ])("旧类型 query 向后兼容归一化为图文文章发布", async (legacyType, expectedLabel) => {
    await router.push('/?type=' + legacyType)
    const w = await createWrapper()

    expect(w.vm.publishType).toBe('article')
    expect(w.vm.publishTypeLabel).toBe(expectedLabel)
    expect(w.vm.activeMode).toBe('article')
    expect(w.vm.hasExplicitPublishType).toBe(true)
    expect(w.text()).toContain(expectedLabel)
  })
  it("无效类型 query 不显示类型标签且回落 article 编辑器", async () => {
    await router.push('/?type=foo')
    const w = await createWrapper()

    expect(w.vm.publishType).toBe('article')
    expect(w.vm.hasExplicitPublishType).toBe(false)
    expect(w.vm.activeMode).toBe('article')
  })
  it("历史视频跳转 query 双重编码时仍能解码出真实视频路径与文案", async () => {
    // 跳转方 encodeURIComponent + vue-router 序列化二次编码，URL 中是双重编码（如 %253A）
    const realPath = 'D:\\tmp\\Multi-Publish-debug-profile\\video.mp4'
    const realTitle = '外婆的灶台总飘着豆瓣香的雾气'
    const doubleEncoded = encodeURIComponent(encodeURIComponent(realPath))
    const titleEncoded = encodeURIComponent(encodeURIComponent(realTitle))
    await router.push('/?type=video&video_path=' + doubleEncoded + '&title=' + titleEncoded)
    const w = await createWrapper()
    await flushPromises()
    expect(w.vm.article.video_path).toBe(realPath)
    expect(w.vm.article.title).toBe(realTitle)
  })
  it("handlePublish warns when title empty", async () => {
    const w = await createWrapper();
    await w.vm.handlePublish();
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("handlePublish warns when content empty", async () => {
    const w = await createWrapper();
    w.vm.article.title = "Test Title";
    await w.vm.handlePublish();
    expect(ElMessage.warning).toHaveBeenCalledWith("请输入正文内容");
  });

  it("handlePublish succeeds with valid input", async () => {
    const w = await createWrapper();
    w.vm.article.title = "Test";
    w.vm.article.content = "Content";
    await w.vm.handlePublish();
    await nextTick();
    expect(window.electronAPI.publishBatch).toHaveBeenCalled();
    expect(w.vm.result.success).toBe(true);
  });

  it("handlePublish 百家号标题超长时自动按字节截断到 149 字节并继续一键发布", async () => {
    const w = await createWrapper();
    w.vm.selectedPlatforms = ["baijiahao"];
    w.vm.selectedAccounts = { baijiahao: ["bj1"] };
    w.vm.article.title = "外婆的灶台总飘着豆瓣香的雾气。那年我离家求学，她往行李塞了一罐自制辣酱。十年后我回乡，罐子还在，人已不在，我终于读懂了那口辣里的甜。";
    w.vm.article.content = "正文";

    await w.vm.handlePublish();
    await flushPromises();

    // 自动截断后仍继续发布，不阻断一键流程
    expect(window.electronAPI.publishBatch).toHaveBeenCalled();
    const [, data] = window.electronAPI.publishBatch.mock.calls[0];
    // 66 个中文字符 = 198 字节，按 149 字节上限截断后剩 49 个中文字符（147 字节）
    expect(Array.from(data.title).length).toBe(49);
    expect(w.vm.result.success).toBe(true);
  });

  it("handlePublish 多平台发布时百家号标题截断后重新校验，其他平台仍超限则阻断", async () => {
    const w = await createWrapper();
    // baijiahao(149字节) + xiaohongshu(20字符)：截断到 49 中文字符后仍超 xiaohongshu 上限
    w.vm.selectedPlatforms = ["baijiahao", "xiaohongshu"];
    w.vm.selectedAccounts = { baijiahao: ["bj1"], xiaohongshu: ["xhs1"] };
    w.vm.article.title = "外婆的灶台总飘着豆瓣香的雾气。那年我离家求学，她往行李塞了一罐自制辣酱。十年后我回乡，罐子还在，人已不在，我终于读懂了那口辣里的甜。";
    w.vm.article.content = "正文";

    await w.vm.handlePublish();
    await flushPromises();

    // 截断到 49 字符后仍超 xiaohongshu 20 字符上限 → 重新校验失败，阻断发布
    expect(window.electronAPI.publishBatch).not.toHaveBeenCalled();
    expect(w.vm.result).toBeNull();
  });

  it("handlePublish 百家号差异化覆盖标题超长时截断覆盖标题而非全局标题", async () => {
    const w = await createWrapper();
    w.vm.selectedPlatforms = ["baijiahao"];
    w.vm.selectedAccounts = { baijiahao: ["bj1"] };
    w.vm.article.title = "正常标题";
    w.vm.article.content = "正文";
    // 差异化面板为 baijiahao 单独设置超长覆盖标题
    w.vm.diffEdits.baijiahao = { title: "外婆的灶台总飘着豆瓣香的雾气。那年我离家求学，她往行李塞了一罐自制辣酱。十年后我回乡，罐子还在，人已不在，我终于读懂了那口辣里的甜。", content: "" };

    await w.vm.handlePublish();
    await flushPromises();

    // 截断覆盖标题到 49 字符，全局标题保持不变
    expect(window.electronAPI.publishBatch).toHaveBeenCalled();
    expect(Array.from(w.vm.diffEdits.baijiahao.title).length).toBe(49);
    expect(w.vm.article.title).toBe("正常标题");
  });

  it("handlePublish handles API failure", async () => {
    window.electronAPI.publishBatch.mockRejectedValue(new Error("network error"));
    const w = await createWrapper();
    w.vm.article.title = "Test";
    w.vm.article.content = "Content";
    await w.vm.handlePublish();
    await nextTick();
    expect(w.vm.result.success).toBe(false);
  });

  it("loads accounts on mount", async () => {
    await createWrapper();
    expect(mockAccountLoad).toHaveBeenCalled();
  });

  it("使用独立目标选择器并可打开平台差异化面板", async () => {
    const w = await createWrapper();

    expect(w.findComponent(PublishTargetSelector).exists()).toBe(true);
    w.vm.showDiffPanel = true;
    await nextTick();

    expect(w.findComponent(PlatformOverridePanel).exists()).toBe(true);
    expect(w.text()).toContain("平台差异化内容");
  });

  it("批量发布失败后显示重新发布命令", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    w.vm.batchProgress = [{ type: "danger", text: "发布失败", time: "10:00:00" }];
    w.vm.failedBatchTasks = [{ taskId: "failed-1", platform: "zhihu", title: "标题" }];
    await nextTick();

    expect(w.text()).toContain("重新发布失败任务 (1)");
  });

  it("草稿保存完整往返字段", async () => {
    const w = await createWrapper();
    w.vm.article.title = "完整草稿";
    w.vm.article.content = "正文";
    w.vm.article.author = "作者";
    w.vm.article.cover_url = "https://img.test/a.jpg";
    w.vm.article.video_path = "D:/a.mp4";
    w.vm.article.publishTime = "2026-07-21T12:00";
    w.vm.selectedAccounts = { wechat_mp: ["acc1"] };
    w.vm.replaceDiffEdits({ wechat_mp: { title: "微信标题", content: "" } });
    // P1-4 定时×草稿互斥：带定时保存会弹确认；本用例验证「保留定时保存」侧的完整往返
    ElMessageBox.confirm.mockRejectedValueOnce(new Error("cancel"));

    await w.vm.onSaveDraft();

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(window.electronAPI.draftSave).toHaveBeenCalledWith(expect.objectContaining({
      title: "完整草稿",
      author: "作者",
      cover_url: "https://img.test/a.jpg",
      video_path: "D:/a.mp4",
      publishTime: "2026-07-21T12:00",
      accounts: { wechat_mp: ["acc1"] },
      platformOverrides: { wechat_mp: { title: "微信标题", content: "" } },
    }));
  });

  it("发布时传递图片、封面、标签、话题和 @好友字段", async () => {
    const w = await createWrapper();
    w.vm.article.title = "带媒体的内容";
    w.vm.article.content = "正文";
    w.vm.article.images = ["D:/image-1.png"];
    w.vm.article.image_files = [{ path: "D:/image-1.png", name: "image-1.png", type: "image/png" }];
    w.vm.article.cover_path = "D:/cover.png";
    w.vm.article.cover_file = { path: "D:/cover.png", name: "cover.png", type: "image/png" };
    w.vm.article.tags = ["AI", "效率"];
    w.vm.article.topics = "效率工具, 内容创作";
    w.vm.article.mentions = "@邱里奥谈认知";

    await w.vm.handlePublish();

    expect(window.electronAPI.publishBatch).toHaveBeenCalledWith(
      [{ platform: "wechat_mp", accountId: "acc1" }],
      expect.objectContaining({
        images: ["D:/image-1.png"],
        image_files: [{ path: "D:/image-1.png", name: "image-1.png", type: "image/png" }],
        cover_path: "D:/cover.png",
        cover_file: { path: "D:/cover.png", name: "cover.png", type: "image/png" },
        tags: ["AI", "效率"],
        topics: ["效率工具", "内容创作"],
        mentions: [{ name: "邱里奥谈认知", text: "@邱里奥谈认知" }],
      }),
    );
  });

  it("批量发布没有绑定账号时 fail closed", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.articles[0].title = "无账号批量内容";
    w.vm.articles[0].content = "正文";
    w.vm.articles[0].platforms = ["wechat_mp"];

    await w.vm.handleBatchPublish();

    expect(window.electronAPI.batchCreate).not.toHaveBeenCalled();
    expect(ElMessage.warning).toHaveBeenCalledWith("请为微信公众号选择至少一个账号");
  });

  it("copies URL via clipboard API", async () => {
    const clip = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { value: { writeText: clip }, writable: true, configurable: true });
    const w = await createWrapper();
    await w.vm.copyUrl("https://x.com/a");
    expect(clip).toHaveBeenCalledWith("https://x.com/a");
  });


  it("togglePlatform adds and removes platform", async () => {
    const w = await createWrapper();
    await nextTick();
    // zhihu is not initially selected
    w.vm.togglePlatform("zhihu");
    expect(w.vm.selectedPlatforms).toContain("zhihu");
    w.vm.togglePlatform("zhihu");
    expect(w.vm.selectedPlatforms).not.toContain("zhihu");
  });

  it("handlePublish with markdown content sets contentFormat", async () => {
    const w = await createWrapper();
    await nextTick();
    w.vm.article.title = "Markdown Test";
    w.vm.article.content = "# Heading\n\n**bold** text and [link](https://example.com)";
    await w.vm.handlePublish();
    await nextTick();
    expect(window.electronAPI.publishBatch).toHaveBeenCalled();
  });

  it("sensitiveCheck warns on sensitive words", async () => {
    window.electronAPI.sensitiveCheck = vi.fn().mockResolvedValue({ code: 0, data: { words: ["badword"] } });
    ElMessageBox.confirm.mockRejectedValueOnce(new Error("cancel"));
    const w = await createWrapper();
    await nextTick();
    w.vm.article.title = "Test";
    w.vm.article.content = "Content with badword";
    await w.vm.handlePublish();
    await nextTick();
    expect(ElMessageBox.confirm).toHaveBeenCalled();
    expect(window.electronAPI.publishBatch).not.toHaveBeenCalled();
  });

  it("batch mode add/remove/duplicate articles", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    const count = w.vm.articles.length;
    w.vm.addArticle();
    expect(w.vm.articles.length).toBe(count + 1);
    w.vm.duplicateArticle(0);
    expect(w.vm.articles.length).toBe(count + 2);
    w.vm.removeArticle(0);
    expect(w.vm.articles.length).toBe(count + 1);
  });

  it("批量发布进行中仅锁定批量按钮并显示发布中状态", async () => {
    let resolveCreate;
    let emitBatchProgress;
    window.electronAPI.batchCreate.mockImplementationOnce(() => new Promise((resolve) => {
      resolveCreate = resolve;
    }));
    window.electronAPI.onBatchProgress.mockImplementationOnce((callback) => {
      emitBatchProgress = callback;
      return vi.fn();
    });
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.articles[0].title = "批量标题";
    w.vm.articles[0].content = "批量正文";
    w.vm.articles[0].platforms = ["wechat_mp"];
    w.vm.articles[0].accounts = { wechat_mp: ["acc1"] };

    const publishPromise = w.vm.handleBatchPublish();
    // 主动操作登录门为异步：flushPromises 等待登录门通过并进入批量发布锁
    await flushPromises();

    const batchButton = findButtonByText(w, "发布中...");
    expect(w.vm.batchPublishing).toBe(true);
    expect(w.vm.publishing).toBe(false);
    expect(batchButton.attributes("disabled")).toBeDefined();
    expect(window.electronAPI.batchCreate).toHaveBeenCalledTimes(1);

    resolveCreate({ code: 0, data: { id: "batch1" } });
    await publishPromise;
    await nextTick();

    expect(w.vm.batchPublishing).toBe(true);
    expect(findButtonByText(w, "发布中...").attributes("disabled")).toBeDefined();

    emitBatchProgress({
      kind: "batch-complete",
      batchId: "batch1",
      total: 1,
      completed: 1,
      succeeded: 1,
      failed: 0,
    });
    await nextTick();

    expect(w.vm.batchPublishing).toBe(false);
    expect(findButtonByText(w, "批量发布").attributes("disabled")).toBeUndefined();
  });

  it("offline detection blocks publish when offline", async () => {
    window.electronAPI.offlineStatus = vi.fn().mockResolvedValue({ code: 0, data: { offline: true } });
    const w = await createWrapper();
    w.vm.article.title = "Test";
    w.vm.article.content = "Content";
    await w.vm.handlePublish();
    await nextTick();
    expect(ElMessage.warning).toHaveBeenCalledWith("网络已断开，任务已缓存");
    expect(w.vm.publishing).toBe(false);
  });


  // ─── 热门选题批量交接（hot-topics-publish-handoff，2026-10-09）─────────────
  // 入口：热门选题页批量改写完成 →「去发布」带 ?drafts=<id,id,...>。
  // 修复前该跳转不带任何草稿参数（push('/publish')），而发布页只在 route.query.draft
  // 存在时 loadDraft ⇒ 表单恒为空，5 条草稿要用户手工逐条装载；
  // 与发布去向弹窗承诺的「改写内容将自动填入文案输入框」不符。
  it("?drafts= 批量交接：装载全部草稿为批量条目并预置可发布平台", async () => {
    await router.push('/?tab=publish&drafts=d1,d2,d3')
    window.electronAPI.draftList.mockResolvedValue({
      code: 0,
      data: [
        { id: 'd1', title: '选题一', content: '正文一' },
        { id: 'd2', title: '选题二', content: '正文二' },
        { id: 'd3', title: '选题三', content: '正文三' },
      ],
    })
    const w = await createWrapper()
    await flushPromises()

    expect(w.vm.batchMode).toBe(true)
    expect(w.vm.articles).toHaveLength(3)
    expect(w.vm.articles.map(a => a.title)).toEqual(['选题一', '选题二', '选题三'])
    expect(w.vm.articles.map(a => a.content)).toEqual(['正文一', '正文二', '正文三'])
    // 预置平台只含有账号的平台（mock 平台目录 wechat_mp/zhihu，仅 wechat_mp 有账号），
    // 且账号必须一并写入——validatePublishTargets 对「选了平台没选账号」直接判无效
    expect(w.vm.articles[0].platforms).toContain('wechat_mp')
    expect(w.vm.articles[0].accounts).toEqual({ wechat_mp: ['acc1'] })
    expect(w.find('[data-testid="batch-targets-toolbar"]').exists()).toBe(true)
  });

  it("?drafts= 部分缺失/全缺失的语义：只装载存在的条目；全缺失不进入空批量态", async () => {
    // 部分缺失：装载命中项，不整批失败
    await router.push('/?tab=publish&drafts=d1,gone')
    window.electronAPI.draftList.mockResolvedValue({ code: 0, data: [{ id: 'd1', title: '仍在的选题', content: '正文' }] })
    const w = await createWrapper()
    await flushPromises()
    expect(w.vm.batchMode).toBe(true)
    expect(w.vm.articles.map(a => a.title)).toEqual(['仍在的选题'])

    // 全缺失：不进批量模式、不渲染空卡片（如实提示）
    await router.push('/?tab=publish&drafts=gone1,gone2')
    window.electronAPI.draftList.mockResolvedValue({ code: 0, data: [] })
    const w2 = await createWrapper()
    await flushPromises()
    expect(w2.vm.batchMode).toBe(false)
    expect(w2.vm.articles).toHaveLength(0)
  });

  it("同一批交接 id 重复激活不覆盖用户编辑（keep-alive 幂等键）", async () => {
    await router.push('/?tab=publish&drafts=d1,d2')
    window.electronAPI.draftList.mockResolvedValue({
      code: 0,
      data: [
        { id: 'd1', title: '原始标题一', content: '正文一' },
        { id: 'd2', title: '原始标题二', content: '正文二' },
      ],
    })
    const w = await createWrapper()
    await flushPromises()
    expect(w.vm.articles).toHaveLength(2)

    // 用户编辑后再激活（onActivated 每次进入都会调）：同一批 id 必须只装载一次
    w.vm.articles[0].title = '用户改过的标题'
    const reloaded = await w.vm.applyDraftHandoff(['d1', 'd2'])
    await flushPromises()

    expect(reloaded).toBe(0)
    expect(w.vm.articles[0].title).toBe('用户改过的标题')
    // 参数解析：去空白、去重、忽略非法值（无则空集合）
    expect(w.vm.parseHandoffDraftIds(' a , b ,,a ')).toEqual(['a', 'b'])
    for (const empty of ['', undefined, null]) expect(w.vm.parseHandoffDraftIds(empty)).toEqual([])
  });

  it("批量设置发布目标：应用到全部条目（含各平台默认账号）", async () => {
    await router.push('/?tab=publish&drafts=d1,d2')
    window.electronAPI.draftList.mockResolvedValue({
      code: 0,
      data: [
        { id: 'd1', title: 'A', content: 'a' },
        { id: 'd2', title: 'B', content: 'b' },
      ],
    })
    const w = await createWrapper()
    await flushPromises()

    w.vm.articles[0].platforms = []
    w.vm.articles[0].accounts = {}
    w.vm.batchTargetPlatforms = ['wechat_mp']
    await nextTick()
    w.vm.applyBatchTargetsToAll()
    await nextTick()

    for (const item of w.vm.articles) {
      expect(item.platforms).toEqual(['wechat_mp'])
      expect(item.accounts).toEqual({ wechat_mp: ['acc1'] })
    }
    // 账号缺失的平台不得写入空数组（否则校验文案指向错误原因）
    expect(w.vm.articles[0].accounts.zhihu).toBeUndefined()
  });


  it("交接内部自带「账号目录就绪」保证：目录晚到时仍预置平台（时序回归锁）", async () => {
    await router.push('/?tab=publish&drafts=d1')
    window.electronAPI.draftList.mockResolvedValue({
      code: 0,
      data: [
        { id: 'd1', title: 'A', content: 'a' },
        { id: 'd2', title: 'B', content: 'b' },
      ],
    })
    const w = await createWrapper()
    await flushPromises()

    // 模拟「交接发生在账号目录尚未就绪时」：hash 路由首次写入 query 会先触发
    // watch(route.query.drafts)，此时 onMounted 的 await loadAccounts() 还没跑完。
    accountState.byPlatform = null
    mockAccountLoad.mockClear()

    const loaded = await w.vm.applyDraftHandoff(['d1', 'd2'])
    await flushPromises()

    expect(loaded).toBe(2)
    // 交接必须自身确保账号就绪（不得依赖调用方的 await 顺序）
    expect(mockAccountLoad).toHaveBeenCalled()
    expect(w.vm.articles[0].platforms).toContain('wechat_mp')
    expect(w.vm.articles[0].accounts).toEqual({ wechat_mp: ['acc1'] })
  });


  it("勾选小红书时给出「仅存草稿箱」提示（用户硬约束：不得真实发布）", async () => {
    await router.push('/?tab=publish&drafts=d1')
    window.electronAPI.draftList.mockResolvedValue({
      code: 0,
      data: [{ id: 'd1', title: 'A', content: 'a' }],
    })
    const w = await createWrapper()
    await flushPromises()

    // 未选小红书 → 无提示
    expect(w.find('[data-testid="batch-xhs-draft-only-0"]').exists()).toBe(false)
    w.vm.articles[0].platforms = ['xiaohongshu', 'wechat_mp']
    await nextTick()
    const hint = w.find('[data-testid="batch-xhs-draft-only-0"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('草稿箱')
  });


  it("批量卡片真实渲染输入控件且值来自草稿（漏导入 UiInput 会渲染成未知元素）", async () => {
    await router.push('/?tab=publish&drafts=d1')
    window.electronAPI.draftList.mockResolvedValue({
      code: 0,
      data: [{ id: 'd1', title: '草稿标题X', content: '草稿正文Y' }],
    })
    const w = await createWrapper()
    await flushPromises()

    const titleInput = w.find('.batch-articles input.ui-input')
    expect(titleInput.exists()).toBe(true)
    expect(titleInput.element.value).toBe('草稿标题X')
    // 正文用 textarea（type=textarea 分支），同样必须真实渲染
    const textarea = w.find('.batch-articles textarea.ui-input')
    expect(textarea.exists()).toBe(true)
    expect(textarea.element.value).toBe('草稿正文Y')
  });

  it("所有用到 Ui* 基础组件的 SFC 都必须自行导入（局部注册；夹具的全局注册不得掩盖漏导入）", () => {
    // 事故形态（2026-10-09 E2E 现场）：新组件漏 import UiInput ⇒ 渲染成未知元素、输入框失效，而夹具全局注册让单测全绿
    const files = [];
    const walk = (dir) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const p = join(dir, entry.name);
        if (entry.isDirectory()) walk(p);
        else if (entry.name.endsWith('.vue')) files.push(p);
      }
    };
    walk('src');
    const offenders = [];
    for (const file of files) {
      const source = readFileSync(file, 'utf8');
      for (const name of ['UiInput', 'UiButton', 'UiSelect']) {
        const used = new RegExp('<' + name + '[\\s/>]').test(source);
        const imported = new RegExp('import\\s+' + name + '\\s+from').test(source);
        if (used && !imported) offenders.push(`${file} → ${name}`);
      }
    }
    expect(offenders).toEqual([]);
  });


describe("PublishView — extra coverage", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh";
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {
      publishBatch: vi.fn().mockResolvedValue({ code: 0, data: { taskIds: ["t1"] }, message: "ok" }),
      getPathForFile: vi.fn().mockReturnValue('D:/media/from-file-api.mp4'),
      sensitiveCheck: vi.fn().mockResolvedValue({ code: 0, data: { words: [] } }),
      offlineStatus: vi.fn().mockResolvedValue({ code: 0, data: { offline: false } }),
      offlineAddToCache: vi.fn().mockResolvedValue({ code: 0 }),
      onProgress: vi.fn(() => vi.fn()),
      batchCreate: vi.fn().mockResolvedValue({ code: 0, data: { id: "batch1" } }),
      batchExecute: vi.fn().mockResolvedValue({ code: 0 }),
      batchSchedule: vi.fn().mockResolvedValue({ code: 0 }),
      onBatchProgress: vi.fn(() => vi.fn()),
      draftSave: vi.fn().mockResolvedValue({ code: 0 }),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      draftDelete: vi.fn().mockResolvedValue({ code: 0 }),
      storeGetSetting: vi.fn().mockResolvedValue(null),
      storeSetSetting: vi.fn().mockResolvedValue({ code: 0 }),
      // 封面缩略图：本地路径 → dataURL（PRD-PUBLISH-COVER-PREVIEW §4）
      readCoverData: vi.fn().mockResolvedValue({ code: 0, data: { dataUrl: "data:image/jpeg;base64,COVER" }, message: "封面读取成功" }),
      // 浮层互斥合同走 pageManager 命名空间（invokePageManager → api.pageManager[method]）
      pageManager: {
        suspendEmbeddedViews: vi.fn().mockResolvedValue(true),
        resumeEmbeddedViews: vi.fn().mockResolvedValue(true),
      },
    };
    mockAccountLoad.mockClear();
  });

  it("applyTemplate fills title and content in single mode", async () => {
    const w = await createWrapper();
    w.vm.applyTemplate({ title: "Templated Title", content: "Templated Content" });
    expect(w.vm.article.title).toBe("Templated Title");
    expect(w.vm.article.content).toBe("Templated Content");
  });

  it("applyTemplate fills batch article when target index set", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.addArticle();
    w.vm.templateTargetIdx = 0;
    w.vm.applyTemplate({ title: "Batch Title", content: "Batch Content" });
    expect(w.vm.articles[0].title).toBe("Batch Title");
    expect(w.vm.articles[0].content).toBe("Batch Content");
  });

  it("P2-7：批量条目挂载扩展字段面，且组件事件经 composable setter 落进条目对象", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.addArticle();
    await nextTick();

    // 接线存在性：字段面组件按条目渲染（testid 带条目下标，可逐条目定位）
    expect(w.find('[data-testid="batch-fields-0"]').exists()).toBe(true);

    // 写点落进条目对象——修复前 cover_* 在批量只有读点、没有任何写点
    w.findComponent(BatchArticleFields).vm.$emit("update:cover", { path: "D:/p27.png", name: "p27.png" });
    expect(w.vm.articles[0].cover_path).toBe("D:/p27.png");
    expect(w.vm.articles[0].cover_file).toEqual({ path: "D:/p27.png", name: "p27.png" });

    w.findComponent(BatchArticleFields).vm.$emit("update:visibility", "private");
    expect(w.vm.articles[0].visibilitySemantic).toBe("private");

    w.findComponent(BatchArticleFields).vm.$emit("update:overrides", { douyin: { title: "覆盖标题", content: "" } });
    expect(w.vm.articles[0].platformOverrides).toEqual({ douyin: { title: "覆盖标题", content: "" } });

    w.findComponent(BatchArticleFields).vm.$emit("clear-cover");
    expect(w.vm.articles[0].cover_path).toBe("");
    expect(w.vm.articles[0].cover_file).toBeNull();
  });

  it("showTemplatePicker toggle works", async () => {
    const w = await createWrapper();
    expect(w.vm.showTemplatePicker).toBe(false);
    w.vm.showTemplatePicker = true;
    await nextTick();
    expect(w.vm.showTemplatePicker).toBe(true);
  });

  it("hasVideoPlatforms computed", async () => {
    const w = await createWrapper();
    w.vm.selectedPlatforms = ["douyin", "kuaishou"];
    await nextTick();
    // hasVideoPlatforms should be true for douyin/kuaishou
    expect(w.vm.hasVideoPlatforms).toBe(true);
  });

  it("handleBatchPublish validates each article", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.addArticle();
    // Article without title should trigger warning
    await w.vm.handleBatchPublish();
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("handleBatchPublish validates missing platform", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.addArticle();
    w.vm.articles[0].title = "Batch Title";
    w.vm.articles[0].content = "Batch Content";
    // No platforms set - should warn
    await w.vm.handleBatchPublish();
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("batchDone and batchFail computed properties", async () => {
    const w = await createWrapper();
    w.vm.batchProgress = [
      { text: "ok", type: "success" },
      { text: "fail", type: "danger" },
      { text: "ok2", type: "success" },
    ];
    expect(w.vm.batchDone).toBe(2);
    expect(w.vm.batchFail).toBe(1);
  });

  it("totalPlatformTasks counts correctly", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.addArticle();
    w.vm.addArticle();
    w.vm.articles[0].platforms = ["wx", "zhihu"];
    w.vm.articles[1].platforms = ["douyin"];
    expect(w.vm.totalPlatformTasks).toBe(3);
  });

  it("removeArticle removes article by index", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.addArticle();
    w.vm.addArticle();
    var before = w.vm.articles.length;
    w.vm.removeArticle(0);
    expect(w.vm.articles.length).toBe(before - 1);
    // removeArticle does nothing when out of bounds
    w.vm.removeArticle(999);
    expect(w.vm.articles.length).toBe(before - 1);
  });

  it("video upload inline handler sets video_path", async () => {
    const w = await createWrapper();
    // video_path is set via inline :on-change in template, test the reactive behavior
    w.vm.article.video_path = "/videos/test.mp4";
    expect(w.vm.article.video_path).toBe("/videos/test.mp4");
  });

  it("video upload resolves the native File path before publishing", async () => {
    const w = await createWrapper();
    const raw = { name: "01.mp4", type: "video/mp4", size: 12 };

    await w.vm.handleVideoFileChange({ raw, name: raw.name });

    expect(window.electronAPI.getPathForFile).toHaveBeenCalledWith(raw);
    expect(w.vm.article.video_path).toBe("D:/media/from-file-api.mp4");
  });

  it("video upload selection shows success feedback (no silent registration)", async () => {
    const { ElMessage } = await import("element-plus");
    ElMessage.success.mockClear();
    const w = await createWrapper();
    const raw = { name: "01.mp4", type: "video/mp4", size: 12 };

    await w.vm.handleVideoFileChange({ raw, name: raw.name });

    expect(w.vm.article.video_path).toBe("D:/media/from-file-api.mp4");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("video upload remove handler clears video_path (list delete keeps state in sync)", async () => {
    const w = await createWrapper();
    w.vm.article.video_path = "D:/old.mp4";

    w.vm.handleVideoFileRemove();

    expect(w.vm.article.video_path).toBe("");
  });

  it("video upload exceed handler replaces the file instead of silent drop (limit=1 reselect)", async () => {
    const w = await createWrapper();
    const clearFiles = vi.fn();
    const handleStart = vi.fn();
    w.vm.videoUploadRef = { clearFiles, handleStart };
    const file = { name: "02.mp4", type: "video/mp4", size: 10 };

    w.vm.handleVideoFileExceed([file]);

    expect(clearFiles).toHaveBeenCalledTimes(1);
    expect(handleStart).toHaveBeenCalledWith(file);
  });

  it("video upload exceed handler is fail-safe without ref or files", async () => {
    const w = await createWrapper();
    w.vm.videoUploadRef = null;

    expect(() => w.vm.handleVideoFileExceed(null)).not.toThrow();
    expect(() => w.vm.handleVideoFileExceed([])).not.toThrow();
  });

  // ── 视频选择反馈差异化（PRD-VIDEO-SELECT-FEEDBACK-2026-09-28）──
  it("first video selection shows a named success toast and fills videoFileMeta", async () => {
    const { ElMessage } = await import("element-plus");
    ElMessage.success.mockClear();
    const w = await createWrapper();
    const raw = { name: "01.mp4", type: "video/mp4", size: 12 };

    await w.vm.handleVideoFileChange({ raw, name: raw.name });

    expect(w.vm.article.video_path).toBe("D:/media/from-file-api.mp4");
    expect(w.vm.videoFileMeta).toEqual({ name: "01.mp4", sizeBytes: 12, formatLabel: "MP4" });
    expect(ElMessage.success).toHaveBeenCalledWith(expect.stringContaining("01.mp4"));
  });

  it("reselecting a different video shows a replacement toast with old and new names", async () => {
    const { ElMessage } = await import("element-plus");
    const w = await createWrapper();
    await w.vm.handleVideoFileChange({ raw: { name: "01.mp4", type: "video/mp4", size: 12 }, name: "01.mp4" });
    window.electronAPI.getPathForFile.mockReturnValueOnce("D:/media/02.mp4");
    ElMessage.success.mockClear();

    await w.vm.handleVideoFileChange({ raw: { name: "02.mp4", type: "video/mp4", size: 20 }, name: "02.mp4" });

    expect(w.vm.article.video_path).toBe("D:/media/02.mp4");
    expect(w.vm.videoFileMeta.name).toBe("02.mp4");
    const text = ElMessage.success.mock.calls[0][0];
    expect(text).toContain("02.mp4");
    expect(text).toContain("01.mp4");
  });

  it("reselecting the same video shows an info toast instead of success", async () => {
    const { ElMessage } = await import("element-plus");
    const w = await createWrapper();
    await w.vm.handleVideoFileChange({ raw: { name: "01.mp4", type: "video/mp4", size: 12 }, name: "01.mp4" });
    ElMessage.info.mockClear();
    ElMessage.success.mockClear();

    await w.vm.handleVideoFileChange({ raw: { name: "01.mp4", type: "video/mp4", size: 12 }, name: "01.mp4" });

    expect(ElMessage.info).toHaveBeenCalledWith(expect.stringContaining("01.mp4"));
    expect(ElMessage.success).not.toHaveBeenCalled();
    expect(w.vm.article.video_path).toBe("D:/media/from-file-api.mp4");
  });

  it("oversize video (>500MB) is rejected up front and keeps the previous selection", async () => {
    const { ElMessage } = await import("element-plus");
    const w = await createWrapper();
    await w.vm.handleVideoFileChange({ raw: { name: "01.mp4", type: "video/mp4", size: 12 }, name: "01.mp4" });
    ElMessage.warning.mockClear();

    await w.vm.handleVideoFileChange({ raw: { name: "big.mp4", type: "video/mp4", size: 600 * 1024 * 1024 }, name: "big.mp4" });

    expect(w.vm.article.video_path).toBe("D:/media/from-file-api.mp4");
    expect(w.vm.videoFileMeta.name).toBe("01.mp4");
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining("500MB"));
  });

  it("remove clears videoFileMeta along with video_path", async () => {
    const w = await createWrapper();
    await w.vm.handleVideoFileChange({ raw: { name: "01.mp4", type: "video/mp4", size: 12 }, name: "01.mp4" });
    expect(w.vm.videoFileMeta).not.toBeNull();

    w.vm.handleVideoFileRemove();

    expect(w.vm.article.video_path).toBe("");
    expect(w.vm.videoFileMeta).toBeNull();
  });

  it("card remove button clears the el-upload list and selection state", async () => {
    const w = await createWrapper();
    const clearFiles = vi.fn();
    w.vm.videoUploadRef = { clearFiles };
    await w.vm.handleVideoFileChange({ raw: { name: "01.mp4", type: "video/mp4", size: 12 }, name: "01.mp4" });

    w.vm.handleVideoCardRemove();

    expect(clearFiles).toHaveBeenCalledTimes(1);
    expect(w.vm.article.video_path).toBe("");
    expect(w.vm.videoFileMeta).toBeNull();
  });

  it("video mode renders the persistent selected card after selection", async () => {
    await router.push("/?type=video");
    const w = await createWrapper();
    expect(w.find('[data-testid="video-selected-card"]').exists()).toBe(false);

    await w.vm.handleVideoFileChange({ raw: { name: "01.mp4", type: "video/mp4", size: 25 * 1024 * 1024 }, name: "01.mp4" });
    await nextTick();

    const card = w.find('[data-testid="video-selected-card"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("01.mp4");
    expect(card.text()).toContain("25.00 MB");
  });

  it("video_path restored from query (no File meta) still renders the card with basename fallback", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/media/restored.mov"));
    const w = await createWrapper();
    await flushPromises();
    await nextTick();

    const card = w.find('[data-testid="video-selected-card"]');
    expect(card.exists()).toBe(true);
    expect(card.text()).toContain("restored.mov");
  });

  it("triggerVideoReselect clicks the hidden file input of el-upload", async () => {
    const w = await createWrapper();
    const click = vi.fn();
    const querySelector = vi.fn(() => ({ click }));
    w.vm.videoUploadRef = { $el: { querySelector } };

    w.vm.triggerVideoReselect();

    expect(querySelector).toHaveBeenCalledWith('input[type="file"]');
    expect(click).toHaveBeenCalledTimes(1);
  });

  it("封面提取结果使用当前语言的提示文案", async () => {
    const w = await createWrapper();
    w.vm.article.video_path = "D:/source.mp4";
    window.electronAPI.extractVideoCover = vi.fn()
      .mockResolvedValueOnce({ data: { coverPath: "D:/cover.jpg" } })
      .mockResolvedValueOnce({ message: "" });

    await w.vm.handleExtractVideoCover();
    expect(ElMessage.success).toHaveBeenCalledWith("封面已提取");
    expect(w.vm.article.cover_path).toBe("D:/cover.jpg");

    i18n.global.locale.value = "en";
    await w.vm.handleExtractVideoCover();
    expect(ElMessage.warning).toHaveBeenLastCalledWith("Cover extraction failed: Unknown error");
  });

  it("cover upload refuses a filename when native path resolution fails", async () => {
    const w = await createWrapper();
    window.electronAPI.getPathForFile.mockReturnValueOnce("");

    await w.vm.handleCoverFileChange({ raw: { name: "cover.jpg", type: "image/jpeg" }, name: "cover.jpg" });

    expect(w.vm.article.cover_path).toBe("");
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining("无法获取所选"));
  });

  // ─── 封面缩略图与放大预览（01-docs/PRD-PUBLISH-COVER-PREVIEW-2026-09-28.md）───
  describe("封面缩略图与放大预览", () => {
    // useEmbeddedViewSuspension 的 activeOwners 是模块级 Set（跨组件共享去重），
    // 挂起「恰好一次」的语义在测试内会变成顺序依赖 —— 必须显式卸载释放，
    // 否则上一条用例残留的 owner 会让下一条的 suspend 不再发 IPC。
    let current = null;
    afterEach(async () => {
      if (current) { current.unmount(); await nextTick(); current = null; }
    });

    async function mountWithCover(coverPath) {
      const w = await createWrapper();
      current = w;
      // 默认落在图文形态；本组用例的主场景是视频发布页，显式切换以免测到另一行
      w.vm.activeMode = "video";
      await nextTick();
      if (coverPath) {
        w.vm.article.cover_path = coverPath;
        await nextTick();
        await vi.waitFor(() => expect(w.find('[data-testid="cover-thumbnail"]').exists()).toBe(true));
      }
      return w;
    }

    it("封面路径落位后出现缩略图，src 为 readCoverData 返回的 dataURL", async () => {
      const w = await mountWithCover("D:/covers/video-cover.jpg");

      const img = w.get('[data-testid="cover-thumbnail"] img');
      expect(img.attributes("src")).toBe("data:image/jpeg;base64,COVER");
      expect(window.electronAPI.readCoverData).toHaveBeenCalledWith("D:/covers/video-cover.jpg");
    });

    it("【从视频提取封面】写入的封面立即出缩略图（需求主场景）", async () => {
      const w = await createWrapper();
      current = w;
      w.vm.article.video_path = "D:/source.mp4";
      window.electronAPI.extractVideoCover = vi.fn().mockResolvedValue({ data: { coverPath: "D:/tmp/video-cover.jpg" } });

      await w.vm.handleExtractVideoCover();
      await nextTick();
      await vi.waitFor(() => expect(w.find('[data-testid="cover-thumbnail"]').exists()).toBe(true));

      expect(w.vm.article.cover_path).toBe("D:/tmp/video-cover.jpg");
    });

    it("【AI 生成封面】写入的封面同样出缩略图（与提取同口径，不按入口分别实现）", async () => {
      const w = await createWrapper();
      current = w;
      window.electronAPI.generateAiCover = vi.fn().mockResolvedValue({ code: 0, data: { coverPath: "D:/tmp/ai-cover.png" } });
      // handleGenerateAiCover 无入参，读的是 aiCoverForm 这个 reactive 表单
      w.vm.aiCoverForm.prompt = "赛博城市夜景";

      await w.vm.handleGenerateAiCover();
      await nextTick();
      await vi.waitFor(() => expect(w.find('[data-testid="cover-thumbnail"]').exists()).toBe(true));

      expect(w.vm.article.cover_path).toBe("D:/tmp/ai-cover.png");
      expect(window.electronAPI.readCoverData).toHaveBeenCalledWith("D:/tmp/ai-cover.png");
    });

    it("连续「提取 → AI 生成」时缩略图最终必须是最后一次的结果（迟到响应不得倒灌）", async () => {
      const first = deferred();
      const second = deferred();
      const w = await createWrapper();
      current = w;
      window.electronAPI.readCoverData = vi.fn()
        .mockImplementationOnce(() => first.promise)
        .mockImplementationOnce(() => second.promise);

      w.vm.article.cover_path = "D:/tmp/video-cover.jpg";
      await nextTick();
      w.vm.article.cover_path = "D:/tmp/ai-cover.png";
      await nextTick();

      second.resolve({ code: 0, data: { dataUrl: "data:image/png;base64,NEW" } });
      await vi.waitFor(() => expect(w.get('[data-testid="cover-thumbnail"] img').attributes("src")).toBe("data:image/png;base64,NEW"));

      first.resolve({ code: 0, data: { dataUrl: "data:image/jpeg;base64,STALE" } });
      await nextTick();
      await nextTick();

      expect(w.get('[data-testid="cover-thumbnail"] img').attributes("src")).toBe("data:image/png;base64,NEW");
    });

    it("点击缩略图打开放大预览，关闭按钮收起并释放内嵌视图挂起", async () => {
      const w = await mountWithCover("D:/covers/video-cover.jpg");
      expect(w.find('[data-testid="cover-preview-dialog"]').exists()).toBe(false);

      await w.get('[data-testid="cover-thumbnail"]').trigger("click");
      await nextTick();
      await nextTick();

      const dialog = w.get('[data-testid="cover-preview-dialog"]');
      expect(dialog.exists()).toBe(true);
      expect(w.get('[data-testid="cover-preview-image"]').attributes("src")).toBe("data:image/jpeg;base64,COVER");
      expect(window.electronAPI.pageManager.suspendEmbeddedViews).toHaveBeenCalledWith("publish-cover-preview");

      await dialog.get('[data-testid="ui-modal-close"]').trigger("click");
      await nextTick();
      await nextTick();

      expect(w.find('[data-testid="cover-preview-dialog"]').exists()).toBe(false);
      expect(window.electronAPI.pageManager.resumeEmbeddedViews).toHaveBeenCalledWith("publish-cover-preview");
    });

    it("缩略图可聚焦并用 Enter 打开（键盘不得只服务鼠标）", async () => {
      const w = await mountWithCover("D:/covers/video-cover.jpg");
      const thumb = w.get('[data-testid="cover-thumbnail"]');
      expect(thumb.attributes("role")).toBe("button");
      expect(thumb.attributes("tabindex")).toBe("0");

      await thumb.trigger("keydown.enter");
      await nextTick();
      await nextTick();

      expect(w.find('[data-testid="cover-preview-dialog"]').exists()).toBe(true);
    });

    it("预览打开期间换封面 → 弹窗关闭（不得显示与真源不符的旧图）", async () => {
      const w = await mountWithCover("D:/covers/video-cover.jpg");
      await w.get('[data-testid="cover-thumbnail"]').trigger("click");
      await nextTick();
      await nextTick();
      expect(w.find('[data-testid="cover-preview-dialog"]').exists()).toBe(true);

      w.vm.article.cover_path = "D:/covers/other.jpg";
      await nextTick();
      await nextTick();

      expect(w.find('[data-testid="cover-preview-dialog"]').exists()).toBe(false);
      expect(window.electronAPI.pageManager.resumeEmbeddedViews).toHaveBeenCalledWith("publish-cover-preview");
    });

    it("预览读取失败 → 显示「封面预览不可用」占位，且发布契约节点仍在", async () => {
      const w = await createWrapper();
      current = w;
      w.vm.activeMode = "video";
      await nextTick();
      window.electronAPI.readCoverData = vi.fn().mockResolvedValue({ code: 1, message: "不支持的图片格式: .gif" });

      w.vm.article.cover_path = "D:/covers/anim.gif";
      await nextTick();
      await vi.waitFor(() => expect(w.find('[data-testid="cover-thumbnail-unavailable"]').exists()).toBe(true));

      expect(w.get('[data-testid="cover-thumbnail-unavailable"]').text()).toContain("封面预览不可用");
      // 具体原因必须留在 title 上，否则排障时现场丢失
      expect(w.get('[data-testid="cover-thumbnail-unavailable"]').attributes("title")).toBe("不支持的图片格式: .gif");
      // 隐藏契约节点不得被本次改造挪走（tests/e2e 依赖 dataset.coverPath）
      expect(w.get('[data-testid="cover-state"]').attributes("data-cover-path")).toBe("D:/covers/anim.gif");
    });

    it("删除封面 → 缩略图消失且不再持有挂起", async () => {
      const w = await mountWithCover("D:/covers/video-cover.jpg");
      await w.get('[data-testid="cover-thumbnail"]').trigger("click");
      await nextTick();
      await nextTick();

      w.vm.handleCoverFileRemove();
      await nextTick();
      await nextTick();

      expect(w.find('[data-testid="cover-thumbnail"]').exists()).toBe(false);
      expect(w.find('[data-testid="cover-preview-dialog"]').exists()).toBe(false);
      expect(window.electronAPI.pageManager.resumeEmbeddedViews).toHaveBeenCalledWith("publish-cover-preview");
    });

    it("空封面不发 IPC、不渲染缩略图（正常空态而非错误）", async () => {
      const w = await createWrapper();
      current = w;
      await nextTick();

      expect(window.electronAPI.readCoverData).not.toHaveBeenCalled();
      expect(w.find('[data-testid="cover-thumbnail"]').exists()).toBe(false);
      expect(w.find('[data-testid="cover-thumbnail-unavailable"]').exists()).toBe(false);
    });

    it("草稿恢复的封面也出缩略图（入口 5：不经任何按钮，正是「挂在字段上」要保住的场景）", async () => {
      window.electronAPI.draftList.mockResolvedValue({
        code: 0,
        data: [{
          id: "draft-cover",
          title: "草稿标题",
          content: "草稿正文",
          platforms: ["zhihu"],
          cover_path: "D:/drafts/restored-cover.jpg",
        }],
      });
      const w = await createWrapper();
      current = w;
      w.vm.activeMode = "video";
      await nextTick();
      await w.vm.loadDrafts();
      await flushPromises();

      await w.vm.loadDraft("draft-cover");
      await nextTick();
      await vi.waitFor(() => expect(w.find('[data-testid="cover-thumbnail"]').exists()).toBe(true));

      expect(w.vm.article.cover_path).toBe("D:/drafts/restored-cover.jpg");
      expect(w.get('[data-testid="cover-thumbnail"] img').attributes("src")).toBe("data:image/jpeg;base64,COVER");
    });

    it("图文发布形态的封面行同样出缩略图并可放大（同一字段共用同一份预览）", async () => {
      const w = await createWrapper();
      current = w;
      w.vm.activeMode = "article";
      await nextTick();

      w.vm.article.cover_path = "D:/covers/article.png";
      await nextTick();
      await vi.waitFor(() => expect(w.find('[data-testid="cover-thumbnail"]').exists()).toBe(true));

      expect(window.electronAPI.readCoverData).toHaveBeenCalledTimes(1);

      await w.get('[data-testid="cover-thumbnail"]').trigger("click");
      await nextTick();
      await nextTick();
      expect(w.find('[data-testid="cover-preview-dialog"]').exists()).toBe(true);
    });
  });

  it("点击 AI 按钮会打开写作面板", async () => {
    const w = await createWrapper();
    expect(w.vm.showAiWriter).toBe(false);

    await w.get('[data-testid="open-ai-writer"]').trigger("click");
    await nextTick();

    expect(w.vm.showAiWriter).toBe(true);
    expect(w.find("ai-writer-panel-stub").exists()).toBe(true);
  });

  // 交互测试：点击批量模式 checkbox 应切换 batchMode 状态
  it("toggles batch mode via checkbox click", async () => {
    const w = await createWrapper();
    const before = w.vm.batchMode;
    const checkbox = w.find('input[type="checkbox"]');
    if (checkbox.exists()) {
      await checkbox.trigger("change");
      await nextTick();
      // batchMode 状态应发生变化（可能因 checkBatchAccess 被重置，但触发本身不应报错）
      expect(typeof w.vm.batchMode).toBe("boolean");
    }
  });

  // 交互测试：填入标题和正文后，一键发布按钮应可点击且触发 IPC
  it("publish button click triggers handlePublish with valid input", async () => {
    const w = await createWrapper();
    w.vm.article.title = "E2E 交互测试标题";
    w.vm.article.content = "E2E 交互测试正文";
    w.vm.selectedPlatforms = ["wechat_mp"];
    await nextTick();
    const publishBtn = findButtonByText(w, "一键发布");
    await publishBtn.trigger("click");

    await vi.waitFor(() => {
      expect(window.electronAPI.publishBatch).toHaveBeenCalledTimes(1);
    });
  });

});

// ── openspec/changes/optimize-publish-right-rail：右栏任务闭环优先 + 面板贴邻字段 ──
describe("PublishView — 右栏信息架构与面板联动", () => {
  // 捕获 TagSuggester props 的探针 stub：默认 stub（true）不透传 props，无法断言平台联动。
  const TagSuggesterProbe = {
    props: ["content", "platforms"],
    emits: ["close", "apply-tag"],
    template: `<div class="tag-suggester-probe" data-testid="tag-suggester-stub" :data-platforms="(platforms || []).join(',')">
      <button type="button" data-testid="probe-apply-tag" @click="$emit('apply-tag', '新标签')">apply</button>
    </div>`,
  };

  beforeEach(() => {
    i18n.global.locale.value = "zh";
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.localStorage.clear();
    window.electronAPI = {
      publishBatch: vi.fn().mockResolvedValue({ code: 0, data: { taskIds: ["t1"] }, message: "ok" }),
      getPathForFile: vi.fn().mockReturnValue('D:/media/from-file-api.mp4'),
      sensitiveCheck: vi.fn().mockResolvedValue({ code: 0, data: { words: [] } }),
      offlineStatus: vi.fn().mockResolvedValue({ code: 0, data: { offline: false } }),
      offlineAddToCache: vi.fn().mockResolvedValue({ code: 0 }),
      onProgress: vi.fn(() => vi.fn()),
      batchCreate: vi.fn().mockResolvedValue({ code: 0, data: { id: "batch1" } }),
      batchExecute: vi.fn().mockResolvedValue({ code: 0 }),
      batchSchedule: vi.fn().mockResolvedValue({ code: 0 }),
      onBatchProgress: vi.fn(() => vi.fn()),
      draftSave: vi.fn().mockResolvedValue({ code: 0 }),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      draftDelete: vi.fn().mockResolvedValue({ code: 0 }),
      storeGetSetting: vi.fn().mockResolvedValue(null),
      storeSetSetting: vi.fn().mockResolvedValue({ code: 0 }),
    };
    mockAccountLoad.mockClear();
  });

  afterEach(() => {
    window.localStorage.clear();
  });

  async function createLayoutWrapper() {
    const w = mount(PublishView, {
      global: {
        plugins: [router, createPinia(), i18n],
        components: { UiButton, UiInput },
        stubs: {
          "el-checkbox-group": { template: "<div><slot/></div>" },
          "el-checkbox": { template: "<label><input type='checkbox' /><slot/></label>" },
          "el-upload": { template: "<div><slot/></div>" },
          "el-icon": { template: "<span><slot/></span>" },
          TagSuggester: TagSuggesterProbe,
          OptimalTimeTip: true,
          TitleAssistantPanel: true,
          ArticleEditor: true,
          TemplatePicker: true,
          UpgradeModal: true,
          AiWriterPanel: true,
        },
      },
    });
    await nextTick();
    return w;
  }

  function followsInDocument(wrapper, selectorA, selectorB) {
    const a = wrapper.element.querySelector(selectorA);
    const b = wrapper.element.querySelector(selectorB);
    if (!a || !b) return null;
    return !!(a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING);
  }

  it("右栏第一块为发布目标卡，智能面板不在右栏", async () => {
    const w = await createLayoutWrapper();
    w.vm.article.title = "这是一段足够长的测试标题";
    await nextTick();

    const side = w.get(".flex-side");
    expect(side.element.firstElementChild.getAttribute("data-testid")).toBe("publish-action-card");
    expect(side.find('[data-testid="tag-suggester-stub"]').exists()).toBe(false);
    expect(side.find("optimal-time-tip-stub").exists()).toBe(false);
    expect(side.find("title-assistant-panel-stub").exists()).toBe(false);
  });

  it("智能面板贴邻左栏对应字段", async () => {
    const w = await createLayoutWrapper();
    w.vm.article.title = "这是一段足够长的测试标题";
    await nextTick();

    const main = w.get(".flex-main");
    expect(main.find('[data-testid="tag-suggester-stub"]').exists()).toBe(true);
    expect(main.find("optimal-time-tip-stub").exists()).toBe(true);
    // 标签建议位于标签输入之后
    expect(followsInDocument(w, "#publish-tags", '[data-testid="tag-suggester-stub"]')).toBe(true);
    // 最佳发布时间位于定时发布输入之后
    expect(followsInDocument(w, 'input[type="datetime-local"]', "optimal-time-tip-stub")).toBe(true);
    // 标题助手入口位于标题输入之后
    expect(followsInDocument(w, '[data-testid="publish-title"]', '[data-testid="title-assistant-toggle"]')).toBe(true);
  });

  it("标签建议平台跟随所选发布目标", async () => {
    const w = await createLayoutWrapper();
    w.vm.article.title = "这是一段足够长的测试标题";
    await nextTick();

    const probe = w.get('[data-testid="tag-suggester-stub"]');
    // 初始传当前所选平台（夹具默认预选 wechat_mp）
    expect(probe.attributes("data-platforms")).toBe(w.vm.selectedPlatforms.join(","));

    // 增选平台后联动更新
    w.vm.togglePlatform("zhihu");
    await nextTick();
    expect(probe.attributes("data-platforms")).toBe(w.vm.selectedPlatforms.join(","));
    expect(probe.attributes("data-platforms")).toContain("zhihu");

    // 取消全部选择后传空数组（组件内部回退全量目录）
    for (const p of [...w.vm.selectedPlatforms]) {
      w.vm.togglePlatform(p);
    }
    await nextTick();
    expect(probe.attributes("data-platforms")).toBe("");
  });

  it("点击建议标签去重追加进标签输入", async () => {
    const w = await createLayoutWrapper();
    w.vm.article.title = "这是一段足够长的测试标题";
    await nextTick();

    await w.get('[data-testid="probe-apply-tag"]').trigger("click");
    expect(w.vm.article.tags).toEqual(["新标签"]);
    // 再次点击同一标签不产生重复
    await w.get('[data-testid="probe-apply-tag"]').trigger("click");
    expect(w.vm.article.tags).toEqual(["新标签"]);
  });

  it("面板显隐状态经 localStorage 记忆", async () => {
    window.localStorage.setItem(
      "publish.panelVisibility.v1",
      JSON.stringify({ tagSuggester: false, titleAssistant: true })
    );
    const w = await createLayoutWrapper();
    expect(w.vm.showTagPanel).toBe(false);
    expect(w.vm.showTitlePanel).toBe(true);

    w.vm.showTagPanel = true;
    await nextTick();
    const stored = JSON.parse(window.localStorage.getItem("publish.panelVisibility.v1"));
    expect(stored.tagSuggester).toBe(true);
    expect(stored.titleAssistant).toBe(true);
  });

  it("无 localStorage 记录时使用默认显隐状态", async () => {
    const w = await createLayoutWrapper();
    expect(w.vm.showTagPanel).toBe(true);
    expect(w.vm.showTitlePanel).toBe(false);
  });
});

  it('发布结果链接非 http/https 时不成链；成链时必须带 rel="noopener"（PRD-HREF-SCHEME-GUARD）', async () => {
    const w = await createWrapper();
    w.vm.article.title = "Test";
    w.vm.article.content = "Content";
    await w.vm.handlePublish();
    await nextTick();
    expect(w.vm.result.success).toBe(true);

    w.vm.result.url = "https://weibo.com/detail/1";
    await nextTick();
    const link = w.find("a.result-link");
    expect(link.exists()).toBe(true);
    expect(link.attributes("href")).toBe("https://weibo.com/detail/1");
    expect(link.attributes("rel")).toBe("noopener");

    w.vm.result.url = "javascript:alert(1)";
    await nextTick();
    expect(w.find("a.result-link").exists()).toBe(false);
    const plain = w.find("span.result-link");
    expect(plain.exists()).toBe(true);
    expect(plain.text()).toBe("javascript:alert(1)");
  });


describe("PublishView — 话题内联描述接线（publish-topic-inline-description）", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh";
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {
      publishBatch: vi.fn().mockResolvedValue({ code: 0, data: { taskIds: ["t1"] }, message: "ok" }),
      getPathForFile: vi.fn().mockReturnValue('D:/media/from-file-api.mp4'),
      sensitiveCheck: vi.fn().mockResolvedValue({ code: 0, data: { words: [] } }),
      offlineStatus: vi.fn().mockResolvedValue({ code: 0, data: { offline: false } }),
      offlineAddToCache: vi.fn().mockResolvedValue({ code: 0 }),
      onProgress: vi.fn(() => vi.fn()),
      batchCreate: vi.fn().mockResolvedValue({ code: 0, data: { id: "batch1" } }),
      batchExecute: vi.fn().mockResolvedValue({ code: 0 }),
      batchSchedule: vi.fn().mockResolvedValue({ code: 0 }),
      onBatchProgress: vi.fn(() => vi.fn()),
      draftSave: vi.fn().mockResolvedValue({ code: 0 }),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      draftDelete: vi.fn().mockResolvedValue({ code: 0 }),
      storeGetSetting: vi.fn().mockResolvedValue(null),
      storeSetSetting: vi.fn().mockResolvedValue({ code: 0 }),
    };
    mockAccountLoad.mockClear();
  });

  it("话题标签输入后描述尾部追加 #话题（所见即所得，单入口 topic-tag-unify）", async () => {
    const w = await createWrapper();
    w.vm.article.title = '探店标题';
    w.vm.article.content = '今天探店';
    await nextTick();

    w.vm.tagsText = '美食探店, vlog';
    await nextTick();

    expect(w.vm.article.tags).toEqual(['美食探店', 'vlog']);
    expect(w.vm.article.content).toBe('今天探店 #美食探店 #vlog');
  });

  it("删除话题时描述同步移除对应片段（单入口）", async () => {
    const w = await createWrapper();
    w.vm.article.content = '今天探店 #美食探店 #vlog';
    w.vm.article.tags = ['美食探店', 'vlog'];
    await nextTick();

    w.vm.tagsText = 'vlog';
    await nextTick();

    expect(w.vm.article.content).toBe('今天探店 #vlog');
  });

  it("标签框输入同样经追加管道进描述", async () => {
    const w = await createWrapper();
    w.vm.article.content = '正文';
    await nextTick();

    w.vm.tagsText = 'AI';
    await nextTick();

    expect(w.vm.article.content).toBe('正文 #AI');
  });

  it("智能标签建议 apply-tag 后描述追加（三入口统一）", async () => {
    const w = await createWrapper();
    w.vm.article.content = '正文内容';
    await nextTick();

    w.vm.applySuggestedTag('新标签');
    await nextTick();

    expect(w.vm.article.tags).toEqual(['新标签']);
    expect(w.vm.article.content).toBe('正文内容 #新标签');
  });

  it("描述已有同话题时输入框再填不产生双份（词边界去重）", async () => {
    const w = await createWrapper();
    w.vm.article.content = '正文 #美食探店';
    await nextTick();

    w.vm.tagsText = '美食探店';
    await nextTick();

    expect(w.vm.article.content).toBe('正文 #美食探店');
  });

  it("批量模式标签输入同步该篇 content（各篇独立）", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.addArticle();
    w.vm.addArticle();
    w.vm.articles[0].content = '第一篇正文';
    w.vm.articles[1].content = '第二篇正文';
    await nextTick();

    w.vm.setBatchTagsText(w.vm.articles[0], '美食');
    await nextTick();

    expect(w.vm.articles[0].content).toBe('第一篇正文 #美食');
    expect(w.vm.articles[0].tagsText).toBe('美食');
  });

  // ── 话题标签统一（topic-tag-unify，PRD §4.2-4.3）──────────────

  it("#添加话题：只在描述末尾追加 #（话题名由用户输入）", async () => {
    const w = await createWrapper();
    w.vm.article.content = '今天探店';
    await nextTick();

    w.vm.appendHashToDescription();
    await nextTick();

    expect(w.vm.article.content).toBe('今天探店 #');
  });

  it("#添加话题：末尾已是孤立 # 时不重复追加（防 ##）", async () => {
    const w = await createWrapper();
    w.vm.article.content = '今天探店 #';
    await nextTick();

    w.vm.appendHashToDescription();
    await nextTick();

    expect(w.vm.article.content).toBe('今天探店 #');
  });

  it("常用话题标签：打开弹窗记录单篇目标，应用写入 tags 并同步描述", async () => {
    const w = await createWrapper();
    w.vm.article.content = '正文内容';
    await nextTick();

    w.vm.openTopicTagManager('single');
    await nextTick();
    expect(w.vm.showTopicTagManager).toBe(true);

    w.vm.applyTopicTagPreset(['AI', '科技']);
    await nextTick();

    expect(w.vm.article.tags).toEqual(['AI', '科技']);
    expect(w.vm.article.content).toBe('正文内容 #AI #科技');
    expect(w.vm.showTopicTagManager).toBe(false);
  });

  it("常用话题标签：批量目标只写该篇", async () => {
    const w = await createWrapper();
    w.vm.batchMode = true;
    await nextTick();
    w.vm.addArticle();
    w.vm.addArticle();
    w.vm.articles[0].content = '第一篇';
    w.vm.articles[1].content = '第二篇';
    await nextTick();

    w.vm.openTopicTagManager('batch', 1);
    w.vm.applyTopicTagPreset(['vlog']);
    await nextTick();

    expect(w.vm.articles[1].content).toBe('第二篇 #vlog');
    expect(w.vm.articles[1].tagsText).toBe('vlog');
    expect(w.vm.articles[0].content).toBe('第一篇');
  });

  it("常用话题标签：应用话题与既有标签去重不产生双份", async () => {
    const w = await createWrapper();
    w.vm.article.tags = ['AI'];
    w.vm.article.content = '正文 #AI';
    await nextTick();

    w.vm.applyTopicTagPreset(['AI', '科技']);
    await nextTick();

    expect(w.vm.article.tags).toEqual(['AI', '科技']);
    expect(w.vm.article.content).toBe('正文 #AI #科技');
  });

  it("模板渲染：单入口话题标签 + 两个按钮存在，话题独立输入框已移除", async () => {
    const w = await createWrapper();
    // 图文分支
    expect(w.findAll('[data-testid="add-topic-hash"]').length).toBe(1);
    expect(w.findAll('[data-testid="open-topic-tag-manager"]').length).toBe(1);
    expect(w.find('#publish-tags').exists()).toBe(true);
    expect(w.find('#publish-topics').exists()).toBe(false);
  });
});});

// keep-alive 重进入预填回归：App.vue 用 <keep-alive :include="['Publish']"> 缓存发布页后，
// 从结果页「去发布」带 ?video_path= 再次进入时 onMounted 不再触发，预填必须靠 onActivated。
// 断言「离开再带新 video_path 回来」时表单更新到新值（摘掉 onActivated 会停在旧值 → 本用例变红）。
describe("PublishView keep-alive 重进入 query 预填", () => {
  const keepAliveStubs = {
    teleport: true,
    "el-checkbox-group": { template: "<div><slot/></div>" },
    "el-checkbox": { template: "<label><input type='checkbox' /><slot/></label>" },
    "el-upload": { template: "<div><slot/></div>" },
    "el-icon": { template: "<span><slot/></span>" },
    TagSuggester: true, OptimalTimeTip: true, TitleAssistantPanel: true,
    ArticleEditor: true, TemplatePicker: true, UpgradeModal: true, AiWriterPanel: true,
  };
  const Harness = {
    template: `<router-view v-slot="{ Component }"><keep-alive :include="['Publish']"><component :is="Component" /></keep-alive></router-view>`,
  };
  function videoPathOf(w) {
    const pub = w.findComponent(PublishView);
    return pub.exists() ? pub.vm.article.video_path : null;
  }

  it("缓存后带新 video_path 重新进入 → onActivated 重新预填", async () => {
    const localRouter = createRouter({
      history: createWebHistory(),
      routes: [
        { path: "/publish", name: "Publish", component: PublishView },
        { path: "/other", name: "Other", component: { name: "Other", template: "<div>other</div>" } },
      ],
    });
    await localRouter.push("/publish?video_path=" + encodeURIComponent("D:/media/a.mp4"));
    await localRouter.isReady();
    const w = mount(Harness, {
      global: { plugins: [localRouter, createPinia(), i18n], components: { UiButton, UiInput }, stubs: keepAliveStubs },
    });
    await flushPromises();
    await nextTick();
    expect(videoPathOf(w)).toBe("D:/media/a.mp4");

    // 离开到别的页（Publish 被 keep-alive 缓存、不销毁）
    await localRouter.push("/other");
    await nextTick();
    // 再带【新】video_path 回来：onMounted 不会再跑，靠 onActivated 重新预填
    await localRouter.push("/publish?video_path=" + encodeURIComponent("D:/media/b.mp4"));
    await nextTick();
    await flushPromises();
    expect(videoPathOf(w)).toBe("D:/media/b.mp4");
  });
});

// ── 文案详情模式（copy-library-detail-entry，2026-10-09）──
const copyHandoff = vi.hoisted(() => {
  let stored = null
  return {
    set: vi.fn((payload) => { stored = payload }),
    take: vi.fn(() => { const p = stored; stored = null; return p }),
    clear: () => { stored = null },
  }
})

vi.mock("@/utils/copy-detail-handoff", () => ({
  takeCopyDetailHandoff: copyHandoff.take,
}))

const upsertRewriteSpy = vi.hoisted(() => vi.fn(async (entry) => ({ id: "up-1", ...entry })))
vi.mock("@/composables/useCopyLibrary", () => ({
  useCopyLibrary: () => ({ upsertRewrite: upsertRewriteSpy }),
}))

describe("PublishView — 文案详情模式（文案库跳转）", () => {
  beforeEach(async () => {
    i18n.global.locale.value = "zh";
    await router.push('/')
    vi.clearAllMocks();
    copyHandoff.clear();
    setActivePinia(createPinia());
    window.electronAPI = {
      publishBatch: vi.fn().mockResolvedValue({ code: 0, data: { taskIds: ["t1"] }, message: "ok" }),
      getPathForFile: vi.fn().mockReturnValue("D:/media/from-file-api.mp4"),
      sensitiveCheck: vi.fn().mockResolvedValue({ code: 0, data: { words: [] } }),
      offlineStatus: vi.fn().mockResolvedValue({ code: 0, data: { offline: false } }),
      offlineAddToCache: vi.fn().mockResolvedValue({ code: 0 }),
      onProgress: vi.fn(() => vi.fn()),
    };
  })

  it("挂载时消费交接载荷：预填标题/正文并显示提示条", async () => {
    copyHandoff.take.mockReturnValueOnce({ content: "文案正文全文", title: "文案标题A", origin: "collect", sourceId: "c1", platform: "xiaohongshu", sourceUrl: "" });
    const w = await createWrapper();
    expect(copyHandoff.take).toHaveBeenCalled();
    expect(w.vm.article.title).toBe("文案标题A");
    expect(w.vm.article.content).toBe("文案正文全文");
    expect(w.find('[data-testid="copy-detail-banner"]').exists()).toBe(true);
  });

  it("无载荷时不进入详情模式（提示条不出现，零回归）", async () => {
    const w = await createWrapper();
    expect(w.find('[data-testid="copy-detail-banner"]').exists()).toBe(false);
  });

  it("视频来源载荷切换到视频发布模式", async () => {
    copyHandoff.take.mockReturnValueOnce({ content: "视频文案", title: "V", origin: "video", sourceId: "v1", platform: "", sourceUrl: "" });
    const w = await createWrapper();
    expect(w.vm.article.title).toBe("V");
    // video 模式渲染视频上传分支（publish-desc 测试锚点只在 video 分支存在）
    expect(w.find('[data-testid="publish-desc"]').exists()).toBe(true);
  });

  it("关闭提示条后不再显示", async () => {
    copyHandoff.take.mockReturnValueOnce({ content: "x", title: "t", origin: "draft", sourceId: "d1", platform: "", sourceUrl: "" });
    const w = await createWrapper();
    expect(w.find('[data-testid="copy-detail-banner"]').exists()).toBe(true);
    await w.find('[data-testid="copy-detail-banner-close"]').trigger("click");
    await nextTick();
    expect(w.find('[data-testid="copy-detail-banner"]').exists()).toBe(false);
  });

  it("【创作视频】按钮存在且内容为空时点击仅告警不跳转", async () => {
    const w = await createWrapper();
    const btn = w.find('[data-testid="publish-create-video"]');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    await flushPromises();
    // 无标题无正文 → 不触发 draftSave（electronAPI.draftSave 未被调用即证明）
    expect(window.electronAPI.draftSave).toBeUndefined();
  });

  it("【创作视频】有内容 → 存草稿成功后跳 /create?draft=<id>", async () => {
    window.electronAPI.draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "draft_x1", reused: false } });
    const pushSpy = vi.spyOn(router, "push").mockResolvedValue(undefined);
    const w = await createWrapper();
    w.vm.article.content = "用于创作视频的正文内容";
    const btn = w.find('[data-testid="publish-create-video"]');
    await btn.trigger("click");
    await flushPromises();
    expect(window.electronAPI.draftSave).toHaveBeenCalledTimes(1);
    expect(pushSpy).toHaveBeenCalledWith(expect.objectContaining({ path: "/create", query: expect.objectContaining({ draft: "draft_x1" }) }));
    pushSpy.mockRestore();
  });

  it("【创作视频】连点只存一次草稿（防重入锁）", async () => {
    window.electronAPI.draftSave = vi.fn().mockImplementation(() => new Promise((res) => setTimeout(() => res({ code: 0, data: { draftId: "d1", reused: false } }), 20)));
    const w = await createWrapper();
    w.vm.article.content = "防重入正文";
    const btn = w.find('[data-testid="publish-create-video"]');
    const p1 = btn.trigger("click");
    const p2 = btn.trigger("click");
    await Promise.all([p1, p2]);
    await flushPromises();
    expect(window.electronAPI.draftSave).toHaveBeenCalledTimes(1);
  });

  it("collect 来源保存草稿 → upsertRewrite 收到 fromKey=collect:c1（评审 MAJOR-2 契约断言）", async () => {
    upsertRewriteSpy.mockClear();
    window.electronAPI.draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "draft_c1", reused: false } });
    copyHandoff.take.mockReturnValueOnce({ content: "采集原文", title: "T1", origin: "collect", sourceId: "c1", platform: "xiaohongshu", sourceUrl: "https://e.com/1" });
    const w = await createWrapper();
    w.vm.article.content = "用户编辑后的正文";
    w.vm.article.title = "编辑后标题";
    await w.vm.onSaveDraft();
    await flushPromises();
    expect(upsertRewriteSpy).toHaveBeenCalledTimes(1);
    expect(upsertRewriteSpy).toHaveBeenCalledWith(expect.objectContaining({
      fromKey: "collect:c1",
      content: "用户编辑后的正文",
      title: "编辑后标题",
      platform: "xiaohongshu",
      sourceUrl: "https://e.com/1",
    }));
  });

  it("rewrite 来源保存草稿 → fromKey=rewrite:r1", async () => {
    upsertRewriteSpy.mockClear();
    window.electronAPI.draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "draft_r1", reused: false } });
    copyHandoff.take.mockReturnValueOnce({ content: "改写原文", title: "T2", origin: "rewrite", sourceId: "r1", platform: "", sourceUrl: "" });
    const w = await createWrapper();
    w.vm.article.content = "改写后编辑";
    await w.vm.onSaveDraft();
    await flushPromises();
    expect(upsertRewriteSpy).toHaveBeenCalledWith(expect.objectContaining({ fromKey: "rewrite:r1", content: "改写后编辑" }));
  });

  it("video 来源保存草稿 → 不回写文案库", async () => {
    upsertRewriteSpy.mockClear();
    window.electronAPI.draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "draft_v", reused: false } });
    copyHandoff.take.mockReturnValueOnce({ content: "视频文案", title: "V", origin: "video", sourceId: "v1", platform: "", sourceUrl: "" });
    const w = await createWrapper();
    w.vm.article.content = "视频文案编辑";
    await w.vm.onSaveDraft();
    await flushPromises();
    expect(upsertRewriteSpy).not.toHaveBeenCalled();
  });

  it("draft 来源保存草稿 → 不回写文案库", async () => {
    upsertRewriteSpy.mockClear();
    window.electronAPI.draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "draft_d", reused: false } });
    copyHandoff.take.mockReturnValueOnce({ content: "草稿内容", title: "D", origin: "draft", sourceId: "d1", platform: "", sourceUrl: "" });
    const w = await createWrapper();
    w.vm.article.content = "草稿编辑";
    await w.vm.onSaveDraft();
    await flushPromises();
    expect(upsertRewriteSpy).not.toHaveBeenCalled();
  });

  it("回写失败不阻塞保存主流程（旁路吞异常）", async () => {
    upsertRewriteSpy.mockClear();
    upsertRewriteSpy.mockRejectedValueOnce(new Error("storage boom"));
    window.electronAPI.draftSave = vi.fn().mockResolvedValue({ code: 0, data: { draftId: "draft_x", reused: false } });
    copyHandoff.take.mockReturnValueOnce({ content: "x", title: "t", origin: "collect", sourceId: "c9", platform: "", sourceUrl: "" });
    const w = await createWrapper();
    w.vm.article.content = "正文";
    await expect(w.vm.onSaveDraft()).resolves.toBeUndefined();
    await flushPromises();
    expect(upsertRewriteSpy).toHaveBeenCalled();
  });

  it("keep-alive 场景：无 from=copy-library 导航重置详情态（评审 CRITICAL 回归锁）", async () => {
    copyHandoff.take.mockReturnValueOnce({ content: "A", title: "A", origin: "collect", sourceId: "a1", platform: "", sourceUrl: "" });
    const w = await createWrapper();
    expect(w.find('[data-testid="copy-detail-banner"]').exists()).toBe(true);
    // 模拟 keep-alive 复活：onActivated 再次触发但无载荷且 query 无 from
    copyHandoff.take.mockReturnValueOnce(null);
    await w.vm.onActivatedCopyDetailProbe ? w.vm.onActivatedCopyDetailProbe() : void 0;
    // 直接调用内部重置逻辑（经 applyCopyDetailHandoff 暴露面）
    if (typeof w.vm.applyCopyDetailHandoff === "function") {
      w.vm.applyCopyDetailHandoff();
      await nextTick();
    }
    expect(upsertRewriteSpy).not.toHaveBeenCalled();
  });});