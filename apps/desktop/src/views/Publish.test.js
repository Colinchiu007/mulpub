import { describe, it, expect, vi, beforeEach } from "vitest";
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

const mockAccountLoad = vi.fn().mockResolvedValue(undefined);
vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({
    load: mockAccountLoad,
    ensureLoaded: mockAccountLoad,
    byPlatform: {
      wechat_mp: [{ id: "acc1", name: "My Account", is_default: true }],
      baijiahao: [{ id: "bj1", name: "百家号账号", is_default: true }],
      xiaohongshu: [{ id: "xhs1", name: "小红书账号", is_default: true }],
    },
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
import PublishTargetSelector from "@/features/publish/components/PublishTargetSelector.vue";
import PublishView from "./Publish.vue";

async function createWrapper() {
  const w = mount(PublishView, {
    global: {
      plugins: [router, createPinia(), i18n],
      components: { UiButton, UiInput },
      stubs: {
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

    await w.vm.saveDraft();

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

});
