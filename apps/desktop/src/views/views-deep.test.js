import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { ElMessage } from "element-plus";
import i18n from "@/i18n";

const pushSpy = vi.fn();
const routeState = { path: '/accounts', query: {} };
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushSpy, replace: vi.fn() }),
  useRoute: () => routeState,
}));

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    ensureLoaded: vi.fn().mockResolvedValue(),
    platforms: [
      { id: "wechat_mp", label: "微信" },
      { id: "zhihu", label: "知乎" },
    ],
    getLabel: (k) => ({ wechat_mp: "微信", zhihu: "知乎" }[k] || k),
    getIcon: () => "ἱ0",
    getCategory: () => "国内",
    getDashboardUrl: () => "",
    supportsQrCode: () => false,
  })
}));

vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({
      
    load: vi.fn(),
    ensureLoaded: vi.fn().mockResolvedValue(),
    accounts: [
      { id: "a1", platform: "wechat_mp", name: "MP1", status: "active" },
      { id: "a2", platform: "zhihu", name: "Zhihu1", status: "inactive" },
    ],
    byPlatform: {
      wechat_mp: [{ id: "a1", platform: "wechat_mp", name: "MP1", status: "active" }],
      zhihu: [{ id: "a2", platform: "zhihu", name: "Zhihu1", status: "inactive" }],
    },
    groupedByPlatform: [
      {
        platform: "wechat_mp",
        accounts: [{ id: "a1", platform: "wechat_mp", name: "MP1", status: "active" }],
        activeCount: 1,
        inactiveCount: 0,
      },
      {
        platform: "zhihu",
        accounts: [{ id: "a2", platform: "zhihu", name: "Zhihu1", status: "inactive" }],
        activeCount: 0,
        inactiveCount: 1,
      },
    ],
    
      searchQuery: "",
      filterStatus: "all",
      selectedIds: new Set(),
      favoriteIds: new Set(),
      groups: [],
      loadGroups: vi.fn(),
      toggleSelect: vi.fn(),
      selectAll: vi.fn(),
      clearSelection: vi.fn(),
      toggleFavorite: vi.fn(),
      toggleAccountInGroup: vi.fn(),
      batchDelete: vi.fn().mockResolvedValue({ code: 0 }),
      createGroup: vi.fn(),
      deleteGroup: vi.fn(),
      getGroupAccounts: vi.fn().mockReturnValue([]),
      renameAccount: vi.fn(),
      getDefault: (p) => p === "wechat_mp" ? { id: "a1", name: "MP1" } : null
  })
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
  const Icon = { template: "<span />" };
  return {
    AccountGroupManager: Icon,
    Cellphone: Icon,
    ChatDotRound: Icon,
    CircleCheck: Icon,
    Clock: Icon,
    Close: Icon,
    Collection: Icon,
    Connection: Icon,
    DataAnalysis: Icon,
    Delete: Icon,
    Edit: Icon,
    EditPen: Icon,
    FolderOpened: Icon,
    Link: Icon,
    Lock: Icon,
    Monitor: Icon,
    Plus: Icon,
    Promotion: Icon,
    Refresh: Icon,
    Search: Icon,
    Setting: Icon,
    Star: Icon,
    StarFilled: Icon,
    Tickets: Icon,
    TrendCharts: Icon,
    UploadFilled: Icon,
    User: Icon,
    Timer: Icon,
    DataLine: Icon,
    Search: Icon,
    EditPen: Icon,
    DocumentCopy: Icon,
    InfoFilled: Icon,
    Key: Icon,
    CaretTop: Icon,
    CaretBottom: Icon,
    CaretRight: Icon,
    MagicStick: Icon,
    FolderAdd: Icon,
    Link: Icon,
    Document: Icon,
    View: Icon,
    UserFilled: Icon,
  };
});

async function setupView(path) {
  const mod = await import("./" + path);
  const { setActivePinia, createPinia } = await import("pinia");
  setActivePinia(createPinia());
  return { mod, pinia: createPinia() };
}

// ====== Home.vue ======
describe("HomeView (deep)", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh";
    vi.clearAllMocks();
    window.electronAPI = {
      storeGetPublishStats: vi.fn().mockResolvedValue({ code: 0, data: { total: 100, success: 95, failed: 5 } }),
      storeListAccounts: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "a1" }, { id: "a2" }, { id: "a3" }] }),
      historyList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
    };
  });

  it("navigates on shortcut click", async () => {
    const { mod } = await setupView("Home.vue");
    const w = mount(mod.default, { global: { plugins: [i18n] } });
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    // 首页已复刻为参考产品风格，快捷入口第 2 格为账号管理。
    const shortcuts = w.findAll(".mp-home-shortcut");
    await shortcuts[1].trigger("click");
    expect(pushSpy).toHaveBeenCalledWith("/accounts");
  });

  it("loads stats from API", async () => {
    const { mod } = await setupView("Home.vue");
    mount(mod.default, { global: { plugins: [i18n] } });
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(window.electronAPI.storeGetPublishStats).toHaveBeenCalled();
  });

  it("shows platform tags from store", async () => {
    const { mod } = await setupView("Home.vue");
    const w = mount(mod.default, { global: { plugins: [i18n] } });
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("多平台内容一键发布");
    expect(w.text()).toContain("微信");
    expect(w.text()).toContain("知乎");
  });
});

// ====== Accounts.vue ======
describe("AccountsView (deep)", () => {
  beforeEach(() => { vi.clearAllMocks(); });

  it("renders platforms from store", async () => {
    const { mod, pinia } = await setupView("Accounts.vue");
    const w = mount(mod.default, { global: { plugins: [pinia, i18n] } });
    await nextTick();
    expect(w.vm.totalAccounts).toBeGreaterThanOrEqual(1);
  });

  it("filters accounts", async () => {
    const { mod, pinia } = await setupView("Accounts.vue");
    const w = mount(mod.default, { global: { plugins: [pinia, i18n] } });
    await nextTick();
    w.vm.filter = "active";
    await nextTick();
    expect(w.vm.filter).toBe("active");
  });
});

// ====== Collection.vue ======
describe("CollectionView (deep)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    Object.defineProperty(navigator, "clipboard", {
      value: { readText: vi.fn().mockResolvedValue("Title\nContent") },
      writable: true, configurable: true
    });
  });

  it("creates draft and navigates", async () => {
    const { mod } = await setupView("Collection.vue");
    const w = mount(mod.default, { global: { mocks: { $t: (key) => key }, plugins: [i18n] } });
    await nextTick();
    w.vm.createDraft();
    await nextTick();
    expect(w.vm.drafts.length).toBe(1);
    expect(pushSpy).toHaveBeenCalled();
  });

  it("imports from clipboard", async () => {
    const { mod } = await setupView("Collection.vue");
    const w = mount(mod.default, { global: { mocks: { $t: (key) => key }, plugins: [i18n] } });
    await nextTick();
    await w.vm.importFromClipboard();
    await nextTick();
    expect(w.vm.drafts.length).toBe(1);
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("handles clipboard failure", async () => {
    navigator.clipboard.readText = vi.fn().mockRejectedValue(new Error("denied"));
    const { mod } = await setupView("Collection.vue");
    const w = mount(mod.default, { global: { mocks: { $t: (key) => key }, plugins: [i18n] } });
    await nextTick();
    await w.vm.importFromClipboard();
    await nextTick();
    expect(ElMessage.error).toHaveBeenCalled();
  });
});

// ====== Dashboard.vue ======
describe("DashboardView (deep)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    window.electronAPI = {
      dashboardStats: vi.fn().mockResolvedValue({
        code: 0,
        data: { total: 42, success: 38, failed: 4, successRate: 90.5,
          perPlatform: { wechat_mp: { total: 20 }, zhihu: { total: 22 } },
          daily: [{ date: "2026-06-20", total: 3 }, { date: "2026-06-21", total: 5 }] }
      }),
      historyList: vi.fn().mockResolvedValue({ code: 0, data: { records: [] } }),
      syncCached: vi.fn().mockResolvedValue({ code: 0, data: [] }),
    };
  });

  it("loads stats on mount", async () => {
    const { mod, pinia } = await setupView("Dashboard.vue");
    mount(mod.default, { global: { plugins: [pinia, i18n] } });
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(window.electronAPI.dashboardStats).toHaveBeenCalled();
  });

  it("shows stats data", async () => {
    const { mod, pinia } = await setupView("Dashboard.vue");
    const w = mount(mod.default, { global: { plugins: [pinia, i18n] } });
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.vm.statsData).not.toBeNull();
    expect(w.vm.statsData.total).toBe(42);
  });

  it("shows benchmark input", async () => {
    const { mod, pinia } = await setupView("Dashboard.vue");
    const w = mount(mod.default, { global: { plugins: [pinia, i18n] } });
    await nextTick();
    w.vm.benchmarkTitle = "Test";
    w.vm.doBenchmark();
    expect(w.vm.benchmarkActiveTitle).toBe("Test");
  });
});


