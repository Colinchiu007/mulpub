import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import { ElMessage } from "element-plus";

const pushSpy = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushSpy }),
  useRoute: () => ({ query: {} }),
}));

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    platforms: [{ id: "wechat_mp", label: "微信" }, { id: "zhihu", label: "知乎" }],
    getLabel: (k) => ({ wechat_mp: "微信", zhihu: "知乎" }[k] || k),
    getIcon: () => "ἱ0",
    getCategory: () => "国内",
  })
}));

vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({ load: vi.fn(), ensureLoaded: vi.fn(), loadGroups: vi.fn(), accounts: [], byPlatform: {}, getDefault: () => null })
}));

vi.mock("@/stores/license", () => ({
  useLicenseStore: () => ({ isPro: true })
}));

vi.mock("@/stores/templates", () => ({
  useTemplateStore: () => ({ load: vi.fn() })
}));

vi.mock("element-plus", () => ({
  ElMessage: { warning: vi.fn(), success: vi.fn(), error: vi.fn() },
  ElMessageBox: { confirm: vi.fn() }
}));

vi.mock("@element-plus/icons-vue", () => {
  const base = { UploadFilled: { template: "<span>U</span>" } };
  const __icon = { template: "<span />" }; const __guard = ["__esModule", "then", "catch", "default", "Symbol(Symbol.toStringTag)"]; return new Proxy(base, { has: () => true, get: (t, p) => (p in t ? t[p] : (typeof p === "string" && !__guard.includes(p) ? __icon : undefined)) });
});
vi.mock("@/components/TagSuggester.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/components/OptimalTimeTip.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/components/TitleAssistantPanel.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/components/ArticleEditor.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/components/TemplatePicker.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/components/UpgradeModal.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/components/AiWriterPanel.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/features/publish/components/PlatformOverridePanel.vue", () => ({ default: { template: "<div/>" } }));
vi.mock("@/features/publish/components/PublishTargetSelector.vue", () => ({ default: { template: "<div/>" } }));

vi.mock("@/api/publisher", () => ({
  renderStart: vi.fn(),
  renderCancel: vi.fn(),
  renderGetStatus: vi.fn().mockResolvedValue({ code: 0, data: { ready: true } }),
  renderInstallDeps: vi.fn(),
  onRenderProgress: vi.fn(() => vi.fn()),
  onRenderComplete: vi.fn(() => vi.fn()),
  onRenderError: vi.fn(() => vi.fn()),
  onRenderInstallProgress: vi.fn(() => vi.fn()),
  onPipelineUpdate: vi.fn(() => vi.fn()),
  publishBatch: vi.fn(),
  onProgress: vi.fn(() => vi.fn()),
  onPipelineUpdate: vi.fn(() => vi.fn()),
  sensitiveCheck: vi.fn().mockResolvedValue({ code: 0, data: { words: [] } }),
  batchCreate: vi.fn(),
  storeGetSetting: vi.fn(),
  offlineStatus: vi.fn().mockResolvedValue({ code: 0, data: { offline: false } }),
  offlineAddToCache: vi.fn(),
  // P0-1 修复后契约：响应字段 content，provider 由 modelProviderGetDefault 查询
  modelProviderGetDefault: vi.fn().mockResolvedValue({ code: 0, data: { id: "openai" } }),
  aiGenerate: vi.fn().mockResolvedValue({ code: 0, data: { content: "AI生成文案内容" } }),
  pipelineList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  pipelineStart: vi.fn(),
  pipelinePause: vi.fn(),
  pipelineResume: vi.fn(),
  pipelineCancel: vi.fn(),
  pipelineStatus: vi.fn(),
  pipelineAdvance: vi.fn(),
  pipelineHistory: vi.fn().mockResolvedValue({ code: 0, data: [] }),
}));
import i18n from "@/i18n";
import PublishView from "./Publish.vue";
import CreateView from "./CreateView.vue";
import ResultView from "./ResultView.vue";

// Publish.vue
describe("PublishView (deep)", () => {
  beforeEach(() => { i18n.global.locale.value = "zh"; vi.clearAllMocks(); setActivePinia(createPinia()); });

  function mountPublish() {
    return mount(PublishView, {
      global: { plugins: [createPinia(), i18n],
        components: { UiButton: { template: "<button><slot/></button>" }, UiInput: { template: "<input/>" } },
        stubs: { "el-checkbox-group": true, "el-checkbox": true, "el-upload": true, "el-icon": true, TagSuggester: true, OptimalTimeTip: true, TitleAssistantPanel: true, ArticleEditor: true, TemplatePicker: true, UpgradeModal: true, AiWriterPanel: true }
      }
    });
  }

  it("shows page title", async () => {
    const w = await mountPublish();
    expect(w.text()).toContain("一键发布");
  });

  it("shows batch mode toggle", async () => {
    const w = await mountPublish();
    expect(w.text()).toContain("批量模式");
  });

  it("validates empty title", async () => {
    const w = await mountPublish();
    await w.vm.handlePublish();
    expect(ElMessage.warning).toHaveBeenCalled();
  });
});

// CreateView.vue
describe("CreateView (deep)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  function mountCreate() {
    return mount(CreateView, {
      global: {
        components: {
          UiButton: { template: "<button><slot/></button>" },
          UiSelect: { props: ["modelValue", "options"], template: "<div><slot/></div>" },
        },
      },
    });
  }

  it("shows mode tabs", async () => {
    const w = await mountCreate();
    w.vm.view = 'quick';
    await nextTick();
    const tabs = w.findAll(".mode-tab");
    expect(tabs.length).toBe(2);
  });

  it("canQuickRender changes with quickText", async () => {
    const w = await mountCreate();
    w.vm.view = 'quick';
    await nextTick();
    expect(w.vm.canQuickRender).toBe(false);
    w.vm.quickText = "hello";
    await nextTick();
    expect(w.vm.canQuickRender).toBe(true);
  });

  it("aiWrite generates content", async () => {
    const w = await mountCreate();
    w.vm.view = 'quick';
    await nextTick();
    w.vm.aiWrite();
    await new Promise(r => setTimeout(r, 1100));
    await nextTick();
    expect(w.vm.quickText.length).toBeGreaterThan(0);
  });
});

// ResultView.vue
describe("ResultView (deep)", () => {
  it("shows empty state", async () => {
    const w = mount(ResultView, {
      global: { components: { UiButton: { template: "<button><slot/></button>" } } }
    });
    await nextTick();
    expect(w.text()).toContain("没有可预览的视频");
  });
});
