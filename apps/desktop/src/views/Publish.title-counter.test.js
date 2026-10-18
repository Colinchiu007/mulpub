/**
 * Publish 标题实时字数与 20 字上限（2026-10-18）。
 *
 * 为什么独立成文件：`Publish.test.js` 在主干上已顶到 `check-max-lines` 的存量容差线
 * （登记 1735 + 容差 200 = 1935，main 实测正好 1935），再往里堆只会把它推过红线。
 * 本文件同时承接两条从 `Publish.test.js` **迁移**过来的用例 —— 它们断言「平台字节截断到 49 字」，
 * 而应用层 20 字上限让该形态不可达，故按新契约重写；迁移而非删除，是为保住
 * 「提交前的平台级校验仍生效」这条覆盖。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { flushPromises, mount } from "@vue/test-utils";
import { ref, nextTick } from "vue";
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

// 容器内必须是 ref：真实 Pinia store 的 byPlatform 是对 accounts 派生的 computed，
// 「账号到了 ⇒ 界面跟着变」靠响应式保证；用普通对象会让 handlePublish 认为无账号而静默不发布。
const accountState = { byPlatform: ref(null) };
function populateAccounts() {
  accountState.byPlatform.value = {
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
    get byPlatform() { return accountState.byPlatform.value || {}; },
    getDefault: (p) => {
      if (p === "wechat_mp") return { id: "acc1", name: "My Account" };
      if (p === "baijiahao") return { id: "bj1", name: "百家号账号" };
      if (p === "xiaohongshu") return { id: "xhs1", name: "小红书账号" };
      return null;
    },
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

/** 标题计数的渲染形态：UiInput 的 hint（形如 `3/20`），不是额外 <p> 节点。 */
function counterTexts(w) {
  return w.findAll(".ui-input-hint").map(h => h.text()).filter(t => /^\d+\/\d+/.test(t));
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

  it("视频模式：空标题计数为 0/20，且渲染在标题输入框的 hint 上", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();
    expect(w.vm.article.title).toBe("");
    expect(w.vm.titleHint).toBe(`0/${PUBLISH_TITLE_MAX}`);
    expect(counterTexts(w)).toContain(`0/${PUBLISH_TITLE_MAX}`);
  });

  it("标题变化时计数实时跟随（码点口径）", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();

    w.vm.article.title = "打工人";
    await nextTick();
    expect(w.vm.titleHint).toBe(`3/${PUBLISH_TITLE_MAX}`);

    // emoji 按 1 个字计（String.length 会算 2）
    w.vm.article.title = "打工人🎬";
    await nextTick();
    expect(w.vm.titleHint).toBe(`4/${PUBLISH_TITLE_MAX}`);
  });

  it("超过 20 字时被截断到 20（计数与截断同口径）", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();

    w.vm.article.title = "字".repeat(50);
    await nextTick();
    await nextTick();

    expect(w.vm.titleHint).toBe(`${PUBLISH_TITLE_MAX}/${PUBLISH_TITLE_MAX}`);
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
    expect(w.vm.titleHint).toBe(`${PUBLISH_TITLE_MAX}/${PUBLISH_TITLE_MAX}`);
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
    expect(w.vm.titleHint).toBe(`${PUBLISH_TITLE_MAX}/${PUBLISH_TITLE_MAX}`);
  });

  it("标题输入框带 maxlength=20（原生兜底；主拦截是按码点的 watcher）", async () => {
    await router.push("/?type=video&video_path=" + encodeURIComponent("D:/v/a.mp4"));
    const w = await createWrapper();
    await flushPromises();
    const input = w.find('[data-testid="publish-title"] input');
    expect(input.exists()).toBe(true);
    expect(input.attributes("maxlength")).toBe(String(PUBLISH_TITLE_MAX));
  });

  // ── 以下两条从 Publish.test.js 迁移并改写为新契约（20 字上限让旧的「截到 49 字」不可达）──

  it("handlePublish 标题被应用层 20 字上限截断后，百家号字节上限不再触发且继续一键发布", async () => {
    const w = await createWrapper();
    w.vm.selectedPlatforms = ["baijiahao"];
    w.vm.selectedAccounts = { baijiahao: ["bj1"] };
    // 20 中文字符 = 60 字节 < 百家号 149 字节上限 ⇒ 平台级字节截断那条安全网不再被触发
    w.vm.article.title = "外婆的灶台总飘着豆瓣香的雾气。那年我离家求学，她往行李塞了一罐自制辣酱。十年后我回乡。";
    w.vm.article.content = "正文";

    await w.vm.handlePublish();
    await flushPromises();

    expect(window.electronAPI.publishBatch).toHaveBeenCalled();
    const [, data] = window.electronAPI.publishBatch.mock.calls[0];
    expect(Array.from(data.title).length).toBe(PUBLISH_TITLE_MAX);
    expect(Buffer.byteLength(data.title, "utf8")).toBeLessThanOrEqual(149);
    expect(w.vm.result.success).toBe(true);
  });

  it("handlePublish 20 字标题同时满足百家号(149字节)与小红书(20字符)上限，不阻断", async () => {
    const w = await createWrapper();
    w.vm.selectedPlatforms = ["baijiahao", "xiaohongshu"];
    w.vm.selectedAccounts = { baijiahao: ["bj1"], xiaohongshu: ["xhs1"] };
    w.vm.article.title = "外婆的灶台总飘着豆瓣香的雾气。那年我离家求学。";
    w.vm.article.content = "正文";

    await w.vm.handlePublish();
    await flushPromises();

    expect(window.electronAPI.publishBatch).toHaveBeenCalled();
    const [, data] = window.electronAPI.publishBatch.mock.calls[0];
    expect(Array.from(data.title).length).toBe(PUBLISH_TITLE_MAX);
    expect(w.vm.result.success).toBe(true);
  });
});
