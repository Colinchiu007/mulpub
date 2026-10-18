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

describe("PublishView — 视频模式标题来源提示（fix-hot-topics-genvideo-title）", () => {
  beforeEach(async () => {
    i18n.global.locale.value = "zh";
    await router.push("/")
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
      readCoverData: vi.fn().mockResolvedValue({ code: 0, data: { dataUrl: "data:image/jpeg;base64,COVER" } }),
      pageManager: {
        suspendEmbeddedViews: vi.fn().mockResolvedValue(true),
        resumeEmbeddedViews: vi.fn().mockResolvedValue(true),
      },
    };
    mockAccountLoad.mockClear();
  });

  // ─── 标题来源提示（fix-hot-topics-genvideo-title，2026-10-17）─────────────
  // 热门选题「生成视频 → 去发布」带入标题时，query 带 title_source/title_reason 说明标题怎么来的。
  // 三态：ai / topic+no-model / topic+failed；无 title_source 一律不渲染（不污染其它入口）。
  it("P1 title_source=ai → 标题下方显示 AI 来源提示", async () => {
    await router.push('/?type=video&video_path=' + encodeURIComponent('D:/v/a.mp4') +
      '&title=' + encodeURIComponent('打工人醒醒！AI又抢活了') + '&title_source=ai')
    const w = await createWrapper()
    await flushPromises()
    const hint = w.find('[data-testid="video-title-source-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('标题由 AI 按爆款元素生成')
  })

  it("P2 title_source=topic&title_reason=no-model → 显示未配置模型提示", async () => {
    await router.push('/?type=video&video_path=' + encodeURIComponent('D:/v/b.mp4') +
      '&title=' + encodeURIComponent('AI大模型最新突破进展') + '&title_source=topic&title_reason=no-model')
    const w = await createWrapper()
    await flushPromises()
    const hint = w.find('[data-testid="video-title-source-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('未配置文字推理模型，标题已使用原始选题')
  })

  it("P3 title_source=topic&title_reason=failed → 显示生成失败提示", async () => {
    await router.push('/?type=video&video_path=' + encodeURIComponent('D:/v/c.mp4') +
      '&title=' + encodeURIComponent('AI大模型最新突破进展') + '&title_source=topic&title_reason=failed')
    const w = await createWrapper()
    await flushPromises()
    const hint = w.find('[data-testid="video-title-source-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('AI 标题生成失败，标题已使用原始选题')
  })

  it("P4 无 title_source → 不渲染任何来源提示（不污染既有入口）", async () => {
    await router.push('/?type=video&video_path=' + encodeURIComponent('D:/v/d.mp4') +
      '&title=' + encodeURIComponent('普通标题'))
    const w = await createWrapper()
    await flushPromises()
    expect(w.find('[data-testid="video-title-source-hint"]').exists()).toBe(false)
  })

  it("P5 图文模式带 title_source 也不渲染（防御性）", async () => {
    await router.push('/?type=article&title=' + encodeURIComponent('图文标题') + '&title_source=ai')
    const w = await createWrapper()
    await flushPromises()
    expect(w.vm.activeMode).toBe('article')
    expect(w.find('[data-testid="video-title-source-hint"]').exists()).toBe(false)
    // 变异反证：直接断言 computed 值 —— 否则「模板本就不渲染」会让这条对
    // 「删掉 activeMode 判据」的变异免疫（实测 M5 删判据后 DOM 断言仍绿）。
    expect(w.vm.videoTitleSourceHint).toBe('')
  })

  it("P6 title_source=topic 但缺 title_reason → 按失败态提示，不静默", async () => {
    await router.push('/?type=video&video_path=' + encodeURIComponent('D:/v/e.mp4') +
      '&title=' + encodeURIComponent('原始选题') + '&title_source=topic')
    const w = await createWrapper()
    await flushPromises()
    const hint = w.find('[data-testid="video-title-source-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toBe('AI 标题生成失败，标题已使用原始选题')
  })
})
