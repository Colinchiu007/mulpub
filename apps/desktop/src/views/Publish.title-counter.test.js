/**
 * Publish 标题实时字数与 20 字上限（2026-10-18 用户要求）。
 *
 * 为什么独立成文件：`Publish.test.js` 已顶到 `check-max-lines` 的存量容差线
 * （登记 1735 + 容差 200 = 1935，实测 1935），再往里堆只会把它推过红线。
 * 本文件只守一条契约：标题输入框旁边的计数显示与「实际能输入的长度」一致。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { createRouter, createWebHistory } from "vue-router";
import { setActivePinia, createPinia } from "pinia";
import i18n from "@/i18n";

const routes = [{ path: "/", name: "home", component: { template: "<div>home</div>" } }];
const router = createRouter({ history: createWebHistory(), routes });

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    platforms: [{ id: "wechat_mp", label: "微信" }, { id: "zhihu", label: "知乎" }],
    getCategory: () => "中文",
  }),
}));

const accountState = { byPlatform: null };
const mockAccountLoad = vi.fn(async () => {
  accountState.byPlatform = { wechat_mp: [{ id: "acc1", name: "My Account", is_default: true }] };
});
vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({
    load: mockAccountLoad,
    ensureLoaded: mockAccountLoad,
    get byPlatform() { return accountState.byPlatform || {}; },
    getDefault: () => ({ id: "acc1", name: "My Account" }),
  }),
}));

vi.mock("@/stores/license", () => ({ useLicenseStore: () => ({ isPro: true }) }));
vi.mock("@/stores/templates", () => ({ useTemplateStore: () => ({ load: vi.fn() }) }));
vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn() },
}));
vi.mock("@/composables/useLoginGate", () => ({
  useLoginGate: () => ({
    ensureLogin: vi.fn(async () => true),
    requireLogin: vi.fn(async (fn) => fn()),
    openSignIn: vi.fn(async () => true),
  }),
}));
vi.mock("@element-plus/icons-vue", () => {
  const icon = { template: "<span />" };
  return new Proxy({}, { has: () => true, get: () => icon });
});

import UiButton from "@/components/UiButton.vue";
import UiInput from "@/components/UiInput.vue";
import PublishView from "./Publish.vue";
import { PUBLISH_TITLE_MAX } from "@/features/publish/title-limits";

async function createWrapper() {
  const w = mount(PublishView, {
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
  await nextTick();
  return w;
}

function titleCountEl() {
  return document.body.querySelector('[data-testid="publish-title-count"]')
    || document.querySelector('[data-testid="publish-title-count"]');
}

describe("Publish 标题实时字数（2026-10-18）", () => {
  beforeEach(async () => {
    i18n.global.locale.value = "zh";
    await router.push("/");
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {
      publishBatch: vi.fn().mockResolvedValue({ code: 0, data: { taskIds: ["t1"] }, message: "ok" }),
      sensitiveCheck: vi.fn().mockResolvedValue({ code: 0, data: { words: [] } }),
      offlineStatus: vi.fn().mockResolvedValue({ code: 0, data: { offline: false } }),
      offlineAddToCache: vi.fn().mockResolvedValue({ code: 0 }),
      onProgress: vi.fn(() => vi.fn()),
      draftSave: vi.fn().mockResolvedValue({ code: 0 }),
      draftList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      storeGetSetting: vi.fn().mockResolvedValue(null),
      readCoverData: vi.fn().mockResolvedValue({ code: 0, data: { dataUrl: "data:image/jpeg;base64,C" } }),
      pageManager: {
        suspendEmbeddedViews: vi.fn().mockResolvedValue(true),
        resumeEmbeddedViews: vi.fn().mockResolvedValue(true),
      },
    };
    mockAccountLoad.mockClear();
  });

  it("视频模式：空标题显示 0/20", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();
    expect(w.vm.article.title).toBe("");
    expect(w.vm.titleCharCount).toBe(0);
    expect(w.vm.titleMaxLength).toBe(PUBLISH_TITLE_MAX);
  });

  it("标题变化时计数实时跟随（码点口径）", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();

    w.vm.article.title = "打工人";
    await nextTick();
    expect(w.vm.titleCharCount).toBe(3);

    // emoji 按 1 个字计（String.length 会算 2）
    w.vm.article.title = "打工人🎬";
    await nextTick();
    expect(w.vm.titleCharCount).toBe(4);
  });

  it("超过 20 字时被截断到 20（计数与截断同口径）", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();

    w.vm.article.title = "字".repeat(50);
    await nextTick();
    await nextTick();

    expect(w.vm.titleCharCount).toBe(PUBLISH_TITLE_MAX);
    expect([...w.vm.article.title].length).toBe(PUBLISH_TITLE_MAX);
    expect(w.vm.article.title).toBe("字".repeat(PUBLISH_TITLE_MAX));
  });

  it("恰好 20 字不被截断（边界不误伤）", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();

    const exactly = "一二三四五六七八九十壹贰叁肆伍陆柒捌玖拾";
    expect([...exactly].length).toBe(PUBLISH_TITLE_MAX);
    w.vm.article.title = exactly;
    await nextTick();
    await nextTick();

    expect(w.vm.article.title).toBe(exactly);
    expect(w.vm.titleCharCount).toBe(PUBLISH_TITLE_MAX);
  });

  it("图文模式同样有 20 字上限与计数", async () => {
    await router.push("/?type=article");
    const w = await createWrapper();
    await flushPromises();
    expect(w.vm.activeMode).toBe("article");

    w.vm.article.title = "字".repeat(30);
    await nextTick();
    await nextTick();

    expect([...w.vm.article.title].length).toBe(PUBLISH_TITLE_MAX);
    expect(w.vm.titleCharCount).toBe(PUBLISH_TITLE_MAX);
  });

  it("输入框本身渲染计数节点（DOM 可观测，不只是 computed）", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();
    const counters = w.findAll('[data-testid="publish-title-count"]');
    expect(counters.length).toBeGreaterThan(0);
    expect(counters[0].text()).toBe(`0/${PUBLISH_TITLE_MAX}`);
  });
});
