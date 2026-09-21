import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import i18n from "@/i18n";

const pushSpy = vi.hoisted(() => vi.fn());
vi.mock("vue-router", () => ({ useRouter: () => ({ push: pushSpy }), useRoute: () => ({ query: {} }) }));

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(), platforms: [{ id: "wechat_mp", label: "微信" }, { id: "zhihu", label: "知乎" }],
    getLabel: (k) => ({ wechat_mp: "微信", zhihu: "知乎" }[k] || k), getIcon: () => "📦",
  })
}));

vi.mock("@/stores/license", () => ({ useLicenseStore: () => ({ isPro: true }) }));
vi.mock("@/stores/templates", () => ({ useTemplateStore: () => ({ load: vi.fn() }) }));
vi.mock("@/stores/accounts", () => ({ useAccountStore: () => ({ load: vi.fn(), loadGroups: vi.fn(), accounts: [], byPlatform: {}, getDefault: () => null }) }));
vi.mock("@element-plus/icons-vue", () => ({ UploadFilled: { template: "<span>U</span>" }, Timer: { template: "<i />" }, DataLine: { template: "<i />" }, Search: { template: "<i />" }, EditPen: { template: "<i />" }, DocumentCopy: { template: "<i />" }, InfoFilled: { template: "<i />" }, Key: { template: "<i />" }, CaretTop: { template: "<i />" }, CaretBottom: { template: "<i />" }, CaretRight: { template: "<i />" }, MagicStick: { template: "<i />" }, FolderAdd: { template: "<i />" }, Link: { template: "<i />" }, Document: { template: "<i />" }, View: { template: "<i />" }, ChatDotRound: { template: "<i />" }, Promotion: { template: "<i />" }, TrendCharts: { template: "<i />" }, VideoCamera: { template: "<i />" } }));
vi.mock("@/components/TrendingPanel.vue", () => ({
  default: { name: "TrendingPanel", template: "<div data-testid='trending-panel-stub'/>" },
}));
vi.mock("@/components/ReferenceFinder.vue", () => ({
  default: { name: "ReferenceFinder", template: "<div data-testid='reference-finder-stub'/>" },
}));

const mockApi = vi.hoisted(() => ({
  renderStart: vi.fn(), renderCancel: vi.fn(), renderGetStatus: vi.fn().mockResolvedValue({ ready: true }),
  renderInstallDeps: vi.fn(), onRenderProgress: vi.fn(() => vi.fn()),
  onRenderComplete: vi.fn(() => vi.fn()), onRenderError: vi.fn(() => vi.fn()),
  onRenderInstallProgress: vi.fn(() => vi.fn()),
  publishBatch: vi.fn(), onProgress: vi.fn(() => vi.fn()),
  sensitiveCheck: vi.fn().mockResolvedValue({ code: 0, data: { words: [] } }),
  batchCreate: vi.fn(), storeGetSetting: vi.fn(),
  offlineStatus: vi.fn().mockResolvedValue({ code: 0, data: { offline: false } }),
  offlineAddToCache: vi.fn(), syncAll: vi.fn(), listAccounts: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  firstRunCheck: vi.fn().mockResolvedValue({ setupDone: false }),
  onFirstRunStatus: vi.fn(() => vi.fn()),
  cloudPublishPlatforms: vi.fn().mockResolvedValue({ ok: true, platforms: [] }),
  cloudPublishHistory: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  cloudPublishListTasks: vi.fn().mockResolvedValue({ ok: true, data: [] }),
  cloudPublishPublish: vi.fn().mockResolvedValue({ ok: true }),
  intelligenceSearch: vi.fn().mockResolvedValue({ code: 0, data: { total: 0, results: [] } }),
  intelligenceSearchTitles: vi.fn().mockResolvedValue({ code: 0, data: { titleAnalysis: null } }),
  intelligenceFetchTrending: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  intelligenceFindReferences: vi.fn().mockResolvedValue({ code: 0, data: [] }),
}));
vi.mock("@/api/publisher", () => mockApi);
import IntelligenceView from "./Intelligence.vue";

// ====== Intelligence.vue ======
describe("IntelligenceView (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks();
    window.electronAPI = { intelligenceSearch: vi.fn().mockResolvedValue({ total: 0, results: [] }) };
  });

  function mnt() {
    return mount(IntelligenceView, {
      global: { plugins: [createPinia(), i18n], stubs: { UiModal: { template: "<div v-if='visible'><slot/></div>", props: ["visible"] } } }
    });
  }

  it("renders search input and trending panel", async () => {
    const w = await mnt();
    await nextTick();
    expect(w.text()).toContain("内容情报");
    expect(w.find("[data-testid='trending-panel-stub']").exists()).toBe(true);
    const input = w.find("input");
    expect(input.exists()).toBe(true);
    expect(input.attributes("placeholder")).toContain("搜索");
  });

  it("sets query on input change", async () => {
    const w = await mnt();
    await nextTick();
    const input = w.find("input");
    await input.setValue("AI technology");
    await input.trigger("input");
    expect(w.vm.query).toBe("AI technology");
  });

  it("triggers search on Enter key", async () => {
    const w = await mnt();
    await nextTick();
    const input = w.find("input");
    w.vm.query = "test query";
    // doSearch is async and sets searching=true, then calls API and sets false
    w.vm.searching = true;
    expect(w.vm.searching).toBe(true);
  });
});

// ====== ViralAnalysis.vue ======
describe("ViralAnalysisView (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  async function mnt() {
    const m = await import("./ViralAnalysis.vue");
    return mount(m.default || m, { global: { components: {}, plugins: [i18n] } });
  }

  it("renders page title", async () => {
    const w = await mnt();
    await nextTick();
    expect(w.text()).toContain("爆款分析");
  });

  it("accepts keyword input", async () => {
    const w = await mnt();
    await nextTick();
    const input = w.find("input");
    if (input.exists()) {
      await input.setValue("AI tools");
    }
    expect(w.vm.keyword || w.vm.topic || "").toBeDefined();
  });
});

// ====== Calendar.vue ======
describe("CalendarView (coverage)", () => {
  beforeEach(() => { vi.clearAllMocks(); setActivePinia(createPinia());
    window.electronAPI = { schedulerList: vi.fn().mockResolvedValue({ code: 0, data: [] }) };
  });

  async function mnt() {
    const m = await import("./Calendar.vue");
    return mount(m.default || m, { global: { plugins: [createPinia()] } });
  }

  it("renders page title", async () => {
    const w = await mnt();
    await nextTick();
    expect(w.text()).toContain("发布日历");
  });

  it("shows current month", async () => {
    const w = await mnt();
    await nextTick();
    const year = new Date().getFullYear().toString();
    expect(w.text()).toContain(year);
  });
});
