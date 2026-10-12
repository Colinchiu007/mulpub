import { describe, it, expect, vi, beforeEach } from "vitest";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { createRouter, createWebHistory } from "vue-router";
import { mount } from "@vue/test-utils";
import i18n from "@/i18n";
import PublishView from "./Publish.vue";
import UiButton from "@/components/UiButton.vue";
import UiInput from "@/components/UiInput.vue";

// 话题标签统一（topic-tag-unify，PRD §4.2-4.3）：#添加话题 与 常用话题标签弹窗接线。
// 从 Publish.test.js 拆出（逐文件行数门禁：测试文件按被测场景分文件）。

const routes = [{ path: "/", name: "home", component: { template: "<div>home</div>" } }];
const router = createRouter({ history: createWebHistory(), routes });

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({ load: vi.fn(), platforms: [{ id: "wechat_mp", label: "微信" }], getCategory: () => "中文" }),
}));
vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({ load: vi.fn(async () => {}), ensureLoaded: vi.fn(async () => {}), byPlatform: {}, getDefault: () => null }),
}));
vi.mock("@/stores/license", () => ({ useLicenseStore: () => ({ isPro: true }) }));
vi.mock("@/stores/templates", () => ({ useTemplateStore: () => ({ load: vi.fn() }) }));
vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}));
vi.mock("@element-plus/icons-vue", () => {
  const base = { UploadFilled: { template: "<span>U</span>" }, Refresh: { template: "<span>R</span>" } };
  const __icon = { template: "<span />" }; const __guard = ["__esModule", "then", "catch", "default", "Symbol(Symbol.toStringTag)"];
  return new Proxy(base, { has: () => true, get: (t, p) => (p in t ? t[p] : (typeof p === "string" && !__guard.includes(p) ? __icon : undefined)) });
});

async function createWrapper() {
  const w = mountView();
  await nextTick();
  return w;
}

function mountView() {
  // stub 集与 Publish.test.js 同口径
  return mount(PublishView, {
    global: {
      plugins: [router, createPinia(), i18n],
      components: { UiButton, UiInput },
      stubs: {
        teleport: true,
        "el-checkbox-group": { template: "<div><slot/></div>" },
        "el-checkbox": { template: "<label><input type='checkbox' /><slot/></label>" },
        "el-upload": { template: "<div><slot/></div>" },
        "el-icon": { template: "<span><slot/></span>" },
        TagSuggester: true, OptimalTimeTip: true, TitleAssistantPanel: true,
        ArticleEditor: true, TemplatePicker: true, UpgradeModal: true, AiWriterPanel: true,
      },
    },
  });
}

beforeEach(() => {
  i18n.global.locale.value = "zh";
  vi.clearAllMocks();
  setActivePinia(createPinia());
  window.electronAPI = {
    publishBatch: vi.fn().mockResolvedValue({ code: 0, data: { taskIds: ["t1"] }, message: "ok" }),
    getPathForFile: vi.fn().mockReturnValue("D:/media/x.mp4"),
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
    readCoverData: vi.fn().mockResolvedValue({ code: 0, data: { dataUrl: "data:image/jpeg;base64,C" } }),
    pageManager: { suspendEmbeddedViews: vi.fn().mockResolvedValue(true), resumeEmbeddedViews: vi.fn().mockResolvedValue(true) },
  };
});
describe("PublishView — 话题标签统一（topic-tag-unify）", () => {
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
});
