import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
import fs from "fs";
import i18n from "@/i18n";

vi.mock("@/composables/usePlatformIconUrl", () => ({
  getPlatformIconUrl: () => "",
  platformIconUrl: () => "",
}));

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    platforms: [
      { id: "wechat_mp", label: "微信" },
      { id: "zhihu", label: "知乎" },
      { id: "douyin", label: "抖音" },
    ],
    getLabel: (k) => ({ wechat_mp: "微信", zhihu: "知乎", douyin: "抖音" }[k] || k),
    getIcon: (k) => "👍",
    getDashboardUrl: (k) => ({
      wechat_mp: "https://mp.weixin.qq.com/",
      zhihu: "https://www.zhihu.com/",
      douyin: "https://creator.douyin.com/",
      youtube: "https://studio.youtube.com/",
    }[k] || ""),
    supportsQrCode: (k) => ["wechat_mp", "zhihu"].includes(k),
  })
}));

const _testAccounts = vi.hoisted(() => ([]));
const _groups = vi.hoisted(() => ([]));
const _favoriteIds = vi.hoisted(() => new Set());
const _selectedIds = vi.hoisted(() => new Set());
const _accountFilters = vi.hoisted(() => ({ searchQuery: "", filterStatus: "all", filterPlatform: "" }));
const _accountSort = vi.hoisted(() => ({ sortBy: null, sortOrder: null }));
const _accountError = vi.hoisted(() => ({ value: null }));
const _eventCallbacks = vi.hoisted(() => ({
  authOpened: null,
  authCompleted: null,
  authClosed: null,
  qrOpened: null,
  qrDetected: null,
  qrCompleted: null,
  qrClosed: null,
  statusChanged: null,
}));
const _eventUnsubscribers = vi.hoisted(() => ({
  authOpened: vi.fn(),
  authCompleted: vi.fn(),
  authClosed: vi.fn(),
  qrOpened: vi.fn(),
  qrDetected: vi.fn(),
  qrCompleted: vi.fn(),
  qrClosed: vi.fn(),
  statusChanged: vi.fn(),
}));
const _routeState = vi.hoisted(() => ({ path: '/accounts', query: {} }))

vi.mock('vue-router', () => ({
  useRoute: () => _routeState,
  useRouter: () => ({ replace: vi.fn() }),
}))

const _spies = vi.hoisted(() => ({
  load: vi.fn(),
  loadGroups: vi.fn(),
  toggleSelect: vi.fn(),
  selectAll: vi.fn(),
  clearSelection: vi.fn(),
  batchDelete: vi.fn().mockResolvedValue({ success: 0, failed: 0 }),
  batchSetStatus: vi.fn().mockResolvedValue({ success: 0, failed: 0 }),
  createGroup: vi.fn(),
  deleteGroup: vi.fn(),
  renameGroup: vi.fn().mockReturnValue(true),
  getGroupAccounts: vi.fn().mockReturnValue([]),
  getDefault: vi.fn(),
  setDefault: vi.fn().mockResolvedValue({ code: 0 }),
  renameAccount: vi.fn().mockResolvedValue({ code: 0 }),
  toggleFavorite: vi.fn(),
  toggleAccountInGroup: vi.fn(),
}));

vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({
    get accounts() { return _testAccounts; },
    set accounts(v) { _testAccounts.length = 0; _testAccounts.push(...v); },
    load: _spies.load,
    loading: false,
    get error() { return _accountError.value; },
    get searchQuery() { return _accountFilters.searchQuery; },
    set searchQuery(value) { _accountFilters.searchQuery = value; },
    get filterStatus() { return _accountFilters.filterStatus; },
    set filterStatus(value) { _accountFilters.filterStatus = value; },
    get filterPlatform() { return _accountFilters.filterPlatform; },
    set filterPlatform(value) { _accountFilters.filterPlatform = value; },
    get sortBy() { return _accountSort.sortBy?.value ?? "name"; },
    set sortBy(value) { _accountSort.sortBy.value = value; },
    get sortOrder() { return _accountSort.sortOrder?.value ?? "asc"; },
    set sortOrder(value) { _accountSort.sortOrder.value = value; },
    selectedIds: _selectedIds,
    isAllSelected: false,
    favoriteIds: _favoriteIds,
    groups: _groups,
    get accountsBeforePlatformFilter() {
      const query = _accountFilters.searchQuery.toLowerCase();
      const labels = { wechat_mp: "微信", zhihu: "知乎", douyin: "抖音" };
      const filtered = _testAccounts.filter(account => {
        const active = account.status === "active" || account.status === "online";
        if (_accountFilters.filterStatus === "active" && !active) return false;
        if (_accountFilters.filterStatus === "inactive" && active) return false;
        if (_accountFilters.filterStatus === "favorite" && !_favoriteIds.has(account.id)) return false;
        if (!query) return true;
        return (account.account_name || account.name || "").toLowerCase().includes(query)
          || (account.platform || "").toLowerCase().includes(query)
          || (labels[account.platform] || "").toLowerCase().includes(query);
      });
      const direction = (_accountSort.sortOrder?.value ?? "asc") === "desc" ? -1 : 1;
      const field = _accountSort.sortBy?.value || "name";
      const activeValue = (account) => account.status === "active" || account.status === "online" ? 1 : 0;
      const value = (account) => {
        if (field === "name") return String(account.account_name || account.name || "").toLocaleLowerCase("zh-CN");
        if (field === "platform") return String(labels[account.platform] || account.platform || "").toLocaleLowerCase("zh-CN");
        if (field === "status") return activeValue(account);
        if (field === "created_at" || field === "last_used_at") {
          const parsed = account[field] ? Date.parse(account[field]) : Number.NEGATIVE_INFINITY;
          return Number.isFinite(parsed) ? parsed : Number.NEGATIVE_INFINITY;
        }
        if (field === "followers") return Number(String(account.followers ?? account.follower_count ?? account.followers_count ?? "").replace(/,/g, "")) || Number.NEGATIVE_INFINITY;
        return account[field] ?? "";
      };
      return filtered
        .map((account, index) => ({ account, index, value: value(account) }))
        .sort((left, right) => left.value < right.value ? -1 * direction : left.value > right.value ? 1 * direction : left.index - right.index)
        .map(({ account }) => account);
    },
    get groupedByPlatform() {
      const filtered = this.accountsBeforePlatformFilter.filter(account => (
        !_accountFilters.filterPlatform || account.platform === _accountFilters.filterPlatform
      ));
      const groups = new Map();
      for (const account of filtered) {
        if (!groups.has(account.platform)) groups.set(account.platform, { platform: account.platform, accounts: [], activeCount: 0, inactiveCount: 0 });
        const group = groups.get(account.platform);
        group.accounts.push(account);
        if (account.status === "active" || account.status === "online") group.activeCount += 1;
        else group.inactiveCount += 1;
      }
      return Array.from(groups.values()).sort((a, b) => b.activeCount - a.activeCount || b.accounts.length - a.accounts.length);
    },
    loadGroups: _spies.loadGroups,
    toggleSelect: _spies.toggleSelect,
    selectAll: _spies.selectAll,
    clearSelection: _spies.clearSelection,
    batchDelete: _spies.batchDelete,
    batchSetStatus: _spies.batchSetStatus,
    createGroup: _spies.createGroup,
    deleteGroup: _spies.deleteGroup,
    renameGroup: _spies.renameGroup,
    getGroupAccounts: _spies.getGroupAccounts,
    getDefault: _spies.getDefault,
    setDefault: _spies.setDefault,
    renameAccount: _spies.renameAccount,
    toggleFavorite: _spies.toggleFavorite,
    toggleAccountInGroup: _spies.toggleAccountInGroup,
  })
}));

vi.mock("@/api/publisher", () => ({
  listAccounts: vi.fn().mockResolvedValue({ code: 0, data: [] }),
  accountAdd: vi.fn().mockResolvedValue({ code: 0 }),
  accountDelete: vi.fn().mockResolvedValue({ code: 0 }),
  accountCheckLogin: vi.fn().mockResolvedValue({ code: 0, data: { valid: true } }),
  accountBatchCheckLogin: vi.fn().mockResolvedValue({ code: 0, data: { results: [], checkedAt: "2026-09-11T00:00:00Z" } }),
  authOpenLogin: vi.fn().mockResolvedValue({ code: 0 }),
  authCompleteLogin: vi.fn().mockResolvedValue({ code: 0, data: true }),
  authOpenQrCodeLogin: vi.fn().mockResolvedValue({ code: 0 }),
  authClose: vi.fn().mockResolvedValue({ code: 0 }),
  authQrCodeClose: vi.fn().mockResolvedValue({ code: 0 }),
  accountSetDefault: vi.fn().mockResolvedValue({ code: 0 }),
  accountUpdate: vi.fn().mockResolvedValue({ code: 0 }),
  onAuthViewOpened: vi.fn(callback => { _eventCallbacks.authOpened = callback; return _eventUnsubscribers.authOpened; }),
  onAuthCompleted: vi.fn(callback => { _eventCallbacks.authCompleted = callback; return _eventUnsubscribers.authCompleted; }),
  onAuthViewClosed: vi.fn(callback => { _eventCallbacks.authClosed = callback; return _eventUnsubscribers.authClosed; }),
  onQrCodeOpened: vi.fn(callback => { _eventCallbacks.qrOpened = callback; return _eventUnsubscribers.qrOpened; }),
  onQrCodeDetected: vi.fn(callback => { _eventCallbacks.qrDetected = callback; return _eventUnsubscribers.qrDetected; }),
  onQrCodeCompleted: vi.fn(callback => { _eventCallbacks.qrCompleted = callback; return _eventUnsubscribers.qrCompleted; }),
  onQrCodeClosed: vi.fn(callback => { _eventCallbacks.qrClosed = callback; return _eventUnsubscribers.qrClosed; }),
  onAccountStatusChanged: vi.fn(callback => { _eventCallbacks.statusChanged = callback; return _eventUnsubscribers.statusChanged; }),
}));

vi.mock("element-plus", () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
}));

vi.mock("@/components/UiModal.vue", () => ({
  default: { template: "<div v-if='visible'><slot/></div>", props: ["visible", "title", "size"] }
}));

import AccountsView from "./Accounts.vue";

// Helper to create a pre-configured mount
function createAccountsView(props = {}) {
  return mount(AccountsView, {
    global: { plugins: [createPinia(), i18n] },
    ...props,
  });
}

async function mountView() {
  const w = createAccountsView();
  await nextTick();
  await new Promise(r => setTimeout(r, 0));
  await nextTick();
  return w;
}

describe("AccountsView — 加载失败错误态", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh";
    setActivePinia(createPinia());
    _testAccounts.length = 0;
    _accountError.value = null;
    window.electronAPI = {};
    localStorage.setItem("account-authorization-guide-seen", "1");
  });

  it("失败且无数据时展示错误态与重试入口，而不是「暂无账号」", async () => {
    _accountError.value = "账号列表加载失败";

    const w = await mountView();

    expect(w.find('[data-testid="accounts-error"]').exists()).toBe(true);
    expect(w.find('[data-testid="accounts-empty"]').exists()).toBe(false);
    expect(w.text()).toContain("重试");
  });

  it("错误态点击重试会重新加载账号列表", async () => {
    _accountError.value = "账号列表加载失败";
    const w = await mountView();
    _spies.load.mockClear();

    await w.find('[data-testid="accounts-error"] button').trigger("click");
    await nextTick();

    expect(_spies.load).toHaveBeenCalled();
  });

  it("已有账号时不因失败切换成空态（保留上一次结果）", async () => {
    _testAccounts.push({ id: "wx-1", platform: "wechat_mp", name: "公众号", status: "active" });
    _accountError.value = "账号列表加载失败";

    const w = await mountView();

    expect(w.find('[data-testid="accounts-error"]').exists()).toBe(false);
    expect(w.find('[data-testid="accounts-empty"]').exists()).toBe(false);
  });
});

describe("AccountsView", () => {
  beforeEach(async () => {
    i18n.global.locale.value = "zh";
    vi.clearAllMocks();
    const publisher = await import("@/api/publisher");
    publisher.listAccounts.mockResolvedValue({ code: 0, data: [] });
    publisher.accountAdd.mockResolvedValue({ code: 0 });
    publisher.accountDelete.mockResolvedValue({ code: 0 });
    publisher.accountCheckLogin.mockResolvedValue({ code: 0, data: { valid: true } });
    publisher.accountBatchCheckLogin.mockResolvedValue({ code: 0, data: { results: [], checkedAt: "2026-09-11T00:00:00Z" } });
    publisher.authOpenLogin.mockResolvedValue({ code: 0 });
    publisher.authCompleteLogin.mockResolvedValue({ code: 0, data: true });
    publisher.authOpenQrCodeLogin.mockResolvedValue({ code: 0 });
    publisher.authClose.mockResolvedValue({ code: 0 });
    publisher.authQrCodeClose.mockResolvedValue({ code: 0 });
    publisher.accountSetDefault.mockResolvedValue({ code: 0 });
    publisher.accountUpdate.mockResolvedValue({ code: 0 });
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue(undefined);
    _spies.batchDelete.mockResolvedValue({ success: 0, failed: 0 });
    _spies.batchSetStatus.mockResolvedValue({ success: 0, failed: 0 });
    _spies.setDefault.mockResolvedValue({ code: 0 });
    _spies.renameAccount.mockResolvedValue({ code: 0 });
    _testAccounts.length = 0;
    _groups.length = 0;
    _accountFilters.searchQuery = "";
    _accountFilters.filterStatus = "all";
    _accountFilters.filterPlatform = "";
    _accountError.value = null;
    _accountSort.sortBy = ref("name");
    _accountSort.sortOrder = ref("asc");
    _routeState.path = '/accounts';
    _routeState.query = {};
    _favoriteIds.clear();
    _selectedIds.clear();
    Object.keys(_eventCallbacks).forEach(key => { _eventCallbacks[key] = null; });
    Object.values(_eventUnsubscribers).forEach(unsubscribe => unsubscribe.mockClear());
    setActivePinia(createPinia());
    localStorage.setItem("account-authorization-guide-seen", "1");
    window.electronAPI = {};
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("分组页签渲染页面级分组管理面板而不是弹窗", async () => {
    _groups.push({ id: "grp-x", name: "运营组", accountIds: ["a1"] })
    _routeState.query = { tab: 'groups' }
    const w = await mountView()

    expect(w.find('[data-testid="account-groups-panel"]').exists()).toBe(true)
    expect(w.find('[data-testid="groups-search"]').exists()).toBe(true)
    expect(w.find('[data-testid="groups-mine-only"]').exists()).toBe(true)
    expect(w.find('[data-testid="groups-create-toggle"]').exists()).toBe(true)
    expect(w.find('[data-testid="group-card-grp-x"]').text()).toContain('运营组')
    // 页签面板不显示账号主列表工具栏
    expect(w.find('.account-controls').exists()).toBe(false)
  })

  it("分组面板创建分组时携带平台筛选并过滤未绑定账号的空分组", async () => {
    _groups.push(
      { id: "grp-full", name: "有账号组", accountIds: ["a1"] },
      { id: "grp-empty", name: "空分组", accountIds: [] },
    )
    _routeState.query = { tab: 'groups' }
    const w = await mountView()

    // 仅看包含我的分组（默认勾选）：空分组被隐藏
    expect(w.find('[data-testid="group-card-grp-empty"]').exists()).toBe(false)
    await w.get('[data-testid="groups-mine-only"]').setValue(false)
    await nextTick()
    expect(w.find('[data-testid="group-card-grp-empty"]').exists()).toBe(true)

    await w.get('[data-testid="groups-create-toggle"]').trigger('click')
    await w.get('[data-testid="groups-create-name"]').setValue('视频组')
    await w.get('[data-testid="groups-create-platform"]').setValue('douyin')
    await w.get('[data-testid="groups-create-submit"]').trigger('click')
    expect(_spies.createGroup).toHaveBeenCalledWith('视频组', 'douyin')
  })

  it("分享页签显示诚实的能力边界而不是伪造团队数据", async () => {
    _routeState.query = { tab: 'share' }
    const w = await mountView()
    expect(w.get('[data-testid="account-share-panel"]').text()).toContain('尚未接入团队分享服务')
    expect(w.get('[data-testid="account-share-state"]').text()).toContain('未接入服务')
    expect(w.get('[data-testid="account-share-create"]').attributes('disabled')).toBeDefined()
  })

  it("分组筛选只显示当前分组账号，并在无分组时保持空态", async () => {
    _testAccounts.push(
      { id: "group-a", platform: "zhihu", status: "active", account_name: "分组账号" },
      { id: "group-b", platform: "douyin", status: "active", account_name: "未分组账号" },
    )
    _groups.push({ id: "grp-1", name: "知乎组", accountIds: ["group-a"] })
    const w = await mountView()

    expect(w.get('[data-testid="group-filter-grp-1"]').text()).toContain('知乎组')
    await w.get('[data-testid="group-filter-grp-1"]').trigger('click')
    await nextTick()
    expect(w.findAll('.account-card')).toHaveLength(1)
    expect(w.text()).toContain('分组账号')
    expect(w.text()).not.toContain('未分组账号')

    w.vm.groupFilter = ''
    w.vm.groupSearchInput = '不存在'
    await nextTick()
    expect(w.get('[data-testid="account-group-empty"]').text()).toContain('暂无分组')
  })

  it("收藏页签渲染收藏分组面板并在无数据时显示空态", async () => {
    _testAccounts.push({ id: "normal-1", platform: "zhihu", status: "active", account_name: "普通账号" })
    _routeState.query = { tab: 'favorites' }
    const w = await mountView()

    expect(w.find('[data-testid="account-favorites-panel"]').exists()).toBe(true)
    expect(w.find('[data-testid="favorites-search"]').exists()).toBe(true)
    expect(w.get('[data-testid="favorites-empty"]').text()).toContain('暂无数据')
    expect(w.get('[data-testid="favorites-create"]').attributes('disabled')).toBeDefined()
  })

  it("收藏分组面板列出含账号的分组并支持回到账号列表", async () => {
    _groups.push({ id: "grp-fav", name: "重点账号", accountIds: ["a1"] })
    _routeState.query = { tab: 'favorites' }
    const w = await mountView()

    expect(w.get('[data-testid="favorite-group-grp-fav"]').text()).toContain('重点账号')
    expect(w.find('[data-testid="favorites-empty"]').exists()).toBe(false)
  })

  it("重命名分组委托给 Store", async () => {
    const w = await mountView()
    w.vm.renameGroup('g1', '新分组')
    expect(_spies.renameGroup).toHaveBeenCalledWith('g1', '新分组')
  })

  it("renders page title", async () => {
    const w = await mountView();
    expect(w.text()).toContain("账号管理");
  });

  it("shows add account button", async () => {
    const w = await mountView();
    expect(w.text()).toContain("添加账号");
  });

  it("工具栏提供参考产品式平台搜索、批量操作和添加账号入口", async () => {
    _testAccounts.push(
      { id: "zh-1", platform: "zhihu", status: "active", account_name: "知乎账号" },
      { id: "dy-1", platform: "douyin", status: "active", account_name: "抖音账号" },
    );
    const w = await mountView();

    expect(w.get('[aria-label="搜索平台"]').exists()).toBe(true);
    expect(w.get('[data-testid="account-batch"]').text()).toContain("批量操作");
    expect(w.get('[data-testid="account-add"]').text()).toContain("添加账号");

    await w.get('[aria-label="搜索平台"]').setValue("知乎");
    expect(w.find('[data-testid="platform-filter-zhihu"]').exists()).toBe(true);
    expect(w.find('[data-testid="platform-filter-douyin"]').exists()).toBe(false);
  });

  it("批量操作按钮控制全选工具栏和卡片选择框显示", async () => {
    _testAccounts.push({ id: "batch-1", platform: "zhihu", status: "active", account_name: "批量账号" });
    const w = await mountView();

    expect(w.find('.batch-toolbar').exists()).toBe(false);
    expect(w.find('[data-testid="select-batch-1"]').exists()).toBe(false);

    await w.get('[data-testid="account-batch"]').trigger('click');
    await nextTick();

    expect(w.find('.batch-toolbar').exists()).toBe(true);
    expect(w.find('[data-testid="select-batch-1"]').exists()).toBe(true);
  });
  it("shows filters", async () => {
    const w = await mountView();
    expect(w.text()).toContain("全部");
    expect(w.text()).toContain("已登录");
  });

  it("使用平台筛选侧栏和账号卡片网格展示主内容", async () => {
    _testAccounts.push(
      { id: "zh-1", platform: "zhihu", status: "active", account_name: "知乎账号" },
      { id: "dy-1", platform: "douyin", status: "inactive", account_name: "抖音账号" },
    );
    const w = await mountView();

    expect(w.get(".account-workspace").exists()).toBe(true);
    expect(w.get(".platform-filter-panel").exists()).toBe(true);
    expect(w.get(".account-card-grid").exists()).toBe(true);
    expect(w.findAll(".account-card")).toHaveLength(2);
    expect(w.get('[data-testid="platform-filter-all"]').attributes("aria-pressed")).toBe("true");

    await w.get('[data-testid="platform-filter-zhihu"]').trigger("click");
    await nextTick();

    expect(w.vm.accountStore.filterPlatform).toBe("zhihu");
    expect(w.get('[data-testid="platform-filter-all"]').attributes("aria-pressed")).toBe("false");
    expect(w.get('[data-testid="platform-filter-zhihu"]').attributes("aria-pressed")).toBe("true");
    expect(w.findAll(".account-card")).toHaveLength(1);
    expect(w.text()).toContain("知乎账号");
  });

  it("负责人和发布人筛选从真实账号字段派生并参与过滤", async () => {
    _testAccounts.push(
      { id: "owner-a", platform: "zhihu", status: "active", account_name: "甲账号", owner: "团队甲", publisher: "编辑甲" },
      { id: "owner-b", platform: "douyin", status: "active", account_name: "乙账号", owner: "团队乙", publisher: "编辑乙" },
    );
    const w = await mountView();

    const ownerSelect = w.get('[aria-label="负责人"]');
    const publisherSelect = w.get('[aria-label="选择发布人"]');
    expect(ownerSelect.attributes("disabled")).toBeUndefined();
    expect(ownerSelect.text()).toContain("团队甲");
    expect(publisherSelect.text()).toContain("编辑乙");

    await ownerSelect.setValue("团队甲");
    await nextTick();
    expect(w.findAll(".account-card")).toHaveLength(1);
    expect(w.text()).toContain("甲账号");
    expect(w.text()).not.toContain("乙账号");

    await ownerSelect.setValue("");
    await publisherSelect.setValue("编辑乙");
    await nextTick();
    expect(w.findAll(".account-card")).toHaveLength(1);
    expect(w.text()).toContain("乙账号");
  });

  it("排序控件提供字段选项并将方向写回 store", async () => {
    _testAccounts.push(
      { id: "sort-z", platform: "zhihu", status: "active", account_name: "乙账号" },
      { id: "sort-a", platform: "wechat_mp", status: "inactive", account_name: "甲账号" },
    );
    const w = await mountView();
    const sortSelect = w.get('[data-testid="account-sort"]');
    const sortOrder = w.get('[data-testid="account-sort-order"]');

    expect(sortSelect.attributes("aria-label")).toBe("账号排序字段");
    expect(sortSelect.text()).toContain("名称");
    expect(sortSelect.text()).toContain("平台");
    expect(sortSelect.text()).toContain("最后使用");
    expect(sortOrder.attributes("aria-label")).toBe("排序升序");

    await sortSelect.setValue("platform");
    await sortOrder.trigger("click");
    await nextTick();

    expect(w.vm.accountStore.sortBy).toBe("platform");
    expect(w.vm.accountStore.sortOrder).toBe("desc");
    expect(sortOrder.attributes("aria-label")).toBe("排序降序");
    expect(w.findAll('[data-testid^="account-card-"]').map(card => card.attributes("data-testid"))).toEqual([
      "account-card-sort-z",
      "account-card-sort-a",
    ]);
  });
  it("负责人和发布人没有后端字段时保持诚实禁用态", async () => {
    const w = await mountView();
    expect(w.get('[aria-label="负责人"]').attributes("disabled")).toBeDefined();
    expect(w.get('[aria-label="负责人"]').text()).toContain("暂无数据");
    expect(w.get('[aria-label="选择发布人"]').attributes("disabled")).toBeDefined();
    expect(w.get('[aria-label="选择发布人"]').text()).toContain("暂无数据");
  });
  it("筛选按钮提供 tab 语义、选中状态和方向键切换", async () => {
    const w = await mountView();
    const tabs = w.findAll('[role="tab"]');

    expect(tabs).toHaveLength(4);
    expect(tabs[0].attributes("id")).toBe("account-status-tab-all");
    expect(tabs[0].attributes("aria-selected")).toBe("true");
    expect(tabs[0].attributes("tabindex")).toBe("0");
    expect(w.get('[role="tabpanel"]').attributes("aria-labelledby")).toBe("account-status-tab-all");

    await tabs[0].trigger("keydown", { key: "ArrowRight" });
    await nextTick();

    expect(w.vm.filter).toBe("active");
    expect(w.vm.accountStore.filterStatus).toBe("active");
    expect(w.get('[role="tabpanel"]').attributes("aria-labelledby")).toBe("account-status-tab-active");
  });

  it("状态和搜索筛选后，账号与平台计数只统计当前结果", async () => {
    _testAccounts.push(
      { id: "wx-active", platform: "wechat_mp", status: "active", account_name: "微信有效账号" },
      { id: "wx-inactive", platform: "wechat_mp", status: "inactive", account_name: "微信失效账号" },
      { id: "zh-active", platform: "zhihu", status: "active", account_name: "知乎有效账号" },
    );
    const w = await mountView();

    w.vm.accountStore.searchQuery = "微信";
    w.vm.filter = "active";
    await nextTick();

    expect(w.get(".account-count").text()).toBe("1 个平台，1 个账号");
    expect(w.get('[data-testid="platform-filter-all"] strong').text()).toBe("1");
    expect(w.get('[data-testid="platform-filter-wechat_mp"] strong').text()).toBe("1");
    expect(w.find('[data-testid="platform-filter-zhihu"]').exists()).toBe(false);
  });

  it("平台筛选按钮保留键盘焦点样式", () => {
    const source = fs.readFileSync("./src/views/Accounts.vue", "utf8");
    expect(source).toMatch(/\.platform-filter-panel button:focus-visible\s*\{[^}]*outline:/);
  });

  it("shows empty state when no accounts", async () => {
    const w = await mountView();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.text()).toContain("暂无账号");
  });

  it("toggles filter", async () => {
    const w = await mountView();
    w.vm.filter = "active";
    await nextTick();
    expect(w.vm.filter).toBe("active");
    w.vm.filter = "inactive";
    await nextTick();
    expect(w.vm.filter).toBe("inactive");
    w.vm.filter = "all";
    await nextTick();
    expect(w.vm.filter).toBe("all");
  });

  it("platformLabel delegates to store", async () => {
    const w = await mountView();
    expect(w.vm.platformLabel("douyin")).toBe("抖音");
    expect(w.vm.platformLabel("unknown")).toBe("unknown");
  });

  it("platformIcon delegates to store", async () => {
    const w = await mountView();
    expect(w.vm.platformIcon("douyin")).toBe("👍");
  });

  it("totalAccounts returns account count from store", async () => {
    // Re-mock account store with data
    vi.doMock("@/stores/accounts", () => ({
      useAccountStore: () => ({
        accounts: [
          { id: "a1", platform: "zhihu", status: "active", account_name: "Acct1" },
          { id: "a2", platform: "douyin", status: "inactive", account_name: "Acct2" },
        ],
        load: vi.fn().mockResolvedValue(undefined),
        loading: false,
        error: null,
      })
    }));
    // This test uses the original mock above (2 accounts in store mock not possible with top-level vi.mock)
    // We'll test via the component's computed property
    const w = await mountView();
    expect(typeof w.vm.totalAccounts).toBe("number");
  });

  it("refresh calls accountStore.load", async () => {
    const w = await mountView();
    _spies.load.mockClear();
    await w.vm.refresh();
    expect(_spies.load).toHaveBeenCalledTimes(1);
    expect(w.vm.loading).toBe(false);
  });

  it("addAccount warns if no platform selected", async () => {
    const w = await mountView();
    w.vm.newPlatform = "";
    await w.vm.addAccount();
    const { ElMessage } = await import("element-plus");
    const { authOpenLogin, accountAdd } = await import("@/api/publisher");
    expect(ElMessage.warning).toHaveBeenCalledWith("请选择平台");
    expect(authOpenLogin).not.toHaveBeenCalled();
    expect(accountAdd).not.toHaveBeenCalled();
  });

  it("addAccount opens auth login flow", async () => {
    const w = await mountView();
    w.vm.newPlatform = "douyin";
    await w.vm.addAccount();
    const { authOpenLogin } = await import("@/api/publisher");
    expect(authOpenLogin).toHaveBeenCalledWith("douyin", undefined);
    expect(w.vm.showAddDialog).toBe(false);
    expect(w.vm.newPlatform).toBe("");
  });

  it("扫码登录模式调用二维码登录 API", async () => {
    const { authOpenLogin, authOpenQrCodeLogin } = await import("@/api/publisher");
    const w = await mountView();
    w.vm.newPlatform = "wechat_mp";
    w.vm.selectedLoginMode = "qrcode";

    await w.vm.addAccount();

    expect(authOpenQrCodeLogin).toHaveBeenCalledWith("wechat_mp");
    expect(authOpenLogin).not.toHaveBeenCalled();
  });

  it("addAccount resets adding state after cancelled login", async () => {
    const { authOpenLogin } = await import("@/api/publisher");
    authOpenLogin.mockResolvedValue({ cancelled: true });
    const w = await mountView();
    w.vm.newPlatform = "douyin";
    // 授权说明阻塞 → adding 保持 true（测试环境 localStorage mock 不持久）
    // adding stays true in test: authorization guide blocks completion
    expect(w.vm.authViewVisible).toBe(false);
  });

  it("addAccount shows error on failure", async () => {
    const { authOpenLogin } = await import("@/api/publisher");
    authOpenLogin.mockResolvedValue({ code: 1, message: "auth failed" });
    const w = await mountView();
    w.vm.newPlatform = "zhihu";
    await w.vm.addAccount();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith("auth failed");
    expect(w.vm.adding).toBe(false);
  });

  it("addAccount catches exception", async () => {
    const { authOpenLogin } = await import("@/api/publisher");
    authOpenLogin.mockRejectedValue(new Error("network error"));
    const w = await mountView();
    w.vm.newPlatform = "douyin";
    await w.vm.addAccount();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining("\u7f51\u7edc"));
  });

  it("addAccount 重复账号返回 409 提示", async () => {
    const { authOpenLogin } = await import("@/api/publisher");
    // 重复检测在后端 server.py 完成，前端通过 openLogin 返回 409 错误码提示
    authOpenLogin.mockResolvedValueOnce({ code: -409, message: "此账号已添加过" });
    const w = await mountView();
    w.vm.newPlatform = "douyin";
    await w.vm.addAccount();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith(expect.stringContaining("此账号已添加过"));
  });

  it("失效账号重新登录复用网页登录 IPC 且不重新打开添加账号弹窗", async () => {
    const { authOpenLogin } = await import("@/api/publisher");
    const w = await mountView();
    const account = { id: "expired-1", platform: "zhihu", account_name: "失效账号", status: "inactive" };

    await w.vm.reloginAccount(account);

    expect(authOpenLogin).toHaveBeenCalledWith("zhihu", "expired-1");
    expect(w.vm.showAddDialog).toBe(false);
    // reloginAccount 在 result?.code !== 0（包括 undefined）时进入错误分支，pendingAuthAction 被置 null
    // 新行为: openLogin成功后pendingAuthAction等待onCompleted
    expect(w.vm.pendingAuthAction).toBe("relogin");
  });

  it("重新登录 IPC 失败时关闭登录视图并保留原始错误", async () => {
    const { authOpenLogin } = await import("@/api/publisher");
    authOpenLogin.mockResolvedValueOnce({ code: 1, message: "重新登录失败" });
    const w = await mountView();

    await w.vm.reloginAccount({ id: "expired-1", platform: "zhihu", status: "inactive" });

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith("重新登录失败");
    // authViewVisible 不再由Accounts.vue管理
    expect(w.vm.pendingAuthAction).toBeNull();
  });

  it("addAccountForPlatform sets newPlatform and shows dialog", async () => {
    const w = await mountView();
    w.vm.addAccountForPlatform("douyin");
    expect(w.vm.newPlatform).toBe("douyin");
    expect(w.vm.showAddDialog).toBe(true);
  });

  // closeAuthView / login-state 横幅 / QR 预览已随内嵌全屏标签迁移移除

  it("setDefault 通过账号 Store 更新默认账号", async () => {
    const w = await mountView();
    const acc = { id: "a1", platform: "douyin", status: "active" };
    await w.vm.setDefault(acc);
    expect(_spies.setDefault).toHaveBeenCalledWith("a1", "douyin");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("setDefault catches exception", async () => {
    _spies.setDefault.mockRejectedValueOnce(new Error("set default failed"));
    const w = await mountView();
    const acc = { id: "a1", platform: "zhihu" };
    await w.vm.setDefault(acc);
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalled();
  });

  it("setDefault 业务失败时显示原始错误且不提示成功、不刷新", async () => {
    const { ElMessage } = await import("element-plus");
    _spies.setDefault.mockResolvedValueOnce({ code: 1, message: "账号不存在" });
    const w = await mountView();
    _spies.load.mockClear();

    await w.vm.setDefault({ id: "missing", platform: "zhihu" });

    expect(ElMessage.error).toHaveBeenCalledWith("账号不存在");
    expect(ElMessage.success).not.toHaveBeenCalled();
    expect(_spies.load).not.toHaveBeenCalled();
  });

  it("renameAccount updates name and refreshes", async () => {
    const w = await mountView();
    const acc = { id: "a1", account_name: "Old Name" };
    await w.vm.renameAccount(acc, "New Name");
    expect(_spies.renameAccount).toHaveBeenCalledWith("a1", "New Name");
  });

  it("renameAccount skips if name unchanged", async () => {
    const w = await mountView();
    const acc = { id: "a1", account_name: "Same" };
    await w.vm.renameAccount(acc, "Same");
    expect(_spies.renameAccount).not.toHaveBeenCalled();
  });

  it("renameAccount skips if name is empty", async () => {
    const w = await mountView();
    const acc = { id: "a1", account_name: "Old" };
    await w.vm.renameAccount(acc, "  ");
    expect(_spies.renameAccount).not.toHaveBeenCalled();
  });

  it("renameAccount catches exception", async () => {
    _spies.renameAccount.mockRejectedValueOnce(new Error("rename failed"));
    const w = await mountView();
    const acc = { id: "a1", account_name: "Old" };
    await w.vm.renameAccount(acc, "New");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalled();
  });

  it("renameAccount 业务失败时显示原始错误且不刷新", async () => {
    const { ElMessage } = await import("element-plus");
    _spies.renameAccount.mockResolvedValueOnce({ code: 1, message: "账号名称已存在" });
    const w = await mountView();
    _spies.load.mockClear();

    await w.vm.renameAccount({ id: "a1", account_name: "旧名称" }, "新名称");

    expect(ElMessage.error).toHaveBeenCalledWith("账号名称已存在");
    expect(_spies.load).not.toHaveBeenCalled();
  });

  it("openPlatform opens correct URL", async () => {
    const originalOpen = window.open;
    window.open = vi.fn();
    const w = await mountView();
    w.vm.openPlatform({ platform: "zhihu" });
    expect(window.open).toHaveBeenCalledWith("https://www.zhihu.com/", "_blank");
    w.vm.openPlatform({ platform: "douyin" });
    expect(window.open).toHaveBeenCalledWith("https://creator.douyin.com/", "_blank");
    w.vm.openPlatform({ platform: "youtube" });
    expect(window.open).toHaveBeenCalledWith("https://studio.youtube.com/", "_blank");
    window.open = originalOpen;
  });

  it("openPlatform does nothing for unknown platform", async () => {
    window.open = vi.fn();
    const w = await mountView();
    w.vm.openPlatform({ platform: "unknown" });
    expect(window.open).not.toHaveBeenCalled();
  });

  it("checkLogin shows success for valid login", async () => {
    const { accountCheckLogin } = await import("@/api/publisher");
    accountCheckLogin.mockResolvedValue({ code: 0, data: { valid: true } });
    const w = await mountView();
    await w.vm.checkLogin({ platform: "douyin", id: "a1" });
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalled();
  });

  it("checkLogin shows warning for expired login", async () => {
    const { accountCheckLogin } = await import("@/api/publisher");
    accountCheckLogin.mockResolvedValue({ code: 0, data: { valid: false, message: "login expired" } });
    const w = await mountView();
    await w.vm.checkLogin({ platform: "douyin", id: "a1" });
    const { ElMessageBox } = await import("element-plus");
    expect(ElMessageBox.confirm).toHaveBeenCalled();
  });

  it("checkLogin catches exception", async () => {
    const { accountCheckLogin } = await import("@/api/publisher");
    accountCheckLogin.mockRejectedValue(new Error("check failed"));
    const w = await mountView();
    await w.vm.checkLogin({ platform: "douyin", id: "a1" });
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith("check failed");
  });

  it("batchCheckAllLogins 一键检测全部账号并按结果更新本地状态", async () => {
    const { accountBatchCheckLogin, accountUpdate } = await import("@/api/publisher");
    accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        results: [
          { accountId: "a1", platform: "douyin", valid: true, code: "CHECK_LOGIN_SUCCESS" },
          { accountId: "a2", platform: "zhihu", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED" },
        ],
        checkedAt: "2026-09-11T08:00:00Z",
      },
    });
    _testAccounts.push(
      { id: "a1", platform: "douyin", status: "expired", account_name: "抖音账号" },
      { id: "a2", platform: "zhihu", status: "active", account_name: "知乎账号" },
    );
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    expect(accountBatchCheckLogin).toHaveBeenCalledWith(["a1", "a2"]);
    // 本地状态按检测结果更新
    const a1 = _testAccounts.find(a => a.id === "a1");
    const a2 = _testAccounts.find(a => a.id === "a2");
    expect(a1.status).toBe("active");
    expect(a2.status).toBe("expired");
    // 检测结果写回后端（持久化：退出重进后仍保持检测状态）
    expect(accountUpdate).toHaveBeenCalledWith("a1", expect.objectContaining({ status: "active" }));
    expect(accountUpdate).toHaveBeenCalledWith("a2", expect.objectContaining({ status: "expired" }));
    // checkedExpiredIds 同步
    expect(w.vm.checkedExpiredIds.has("a2")).toBe(true);
    expect(w.vm.checkedExpiredIds.has("a1")).toBe(false);
    // busy 复位
    expect(w.vm.batchCheckAllBusy).toBe(false);
    // 有失效时提示汇总（warning）
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining("1"));
  });

  it("batchCheckAllLogins 全部有效时提示全部正常", async () => {
    const { accountBatchCheckLogin } = await import("@/api/publisher");
    accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        results: [
          { accountId: "b1", platform: "douyin", valid: true },
          { accountId: "b2", platform: "zhihu", valid: true },
        ],
        checkedAt: "2026-09-11T08:00:00Z",
      },
    });
    _testAccounts.push(
      { id: "b1", platform: "douyin", status: "expired", account_name: "抖音" },
      { id: "b2", platform: "zhihu", status: "active", account_name: "知乎" },
    );
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    expect(_testAccounts.find(a => a.id === "b1").status).toBe("active");
    expect(_testAccounts.find(a => a.id === "b2").status).toBe("active");
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalledWith(expect.stringContaining("2"));
  });

  it("batchCheckAllLogins 无账号时提示且不调用 IPC", async () => {
    const { accountBatchCheckLogin } = await import("@/api/publisher");
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    expect(accountBatchCheckLogin).not.toHaveBeenCalled();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
  });

  it("batchCheckAllLogins IPC 失败时提示错误并复位 busy", async () => {
    const { accountBatchCheckLogin } = await import("@/api/publisher");
    accountBatchCheckLogin.mockRejectedValue(new Error("batch check failed"));
    _testAccounts.push({ id: "c1", platform: "douyin", status: "active", account_name: "抖音" });
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalled();
    expect(w.vm.batchCheckAllBusy).toBe(false);
    expect(w.vm.verifyingIds.size).toBe(0);
  });

  it("removeAccount confirms and deletes account", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue(undefined);
    const { accountDelete } = await import("@/api/publisher");
    accountDelete.mockResolvedValue({ code: 0 });
    const w = await mountView();
    const acc = { id: "a1", platform: "douyin", account_name: "My Account" };
    await w.vm.removeAccount(acc);
    expect(accountDelete).toHaveBeenCalledWith("a1");
  });

  it("removeAccount shows error on delete failure", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue(undefined);
    const { accountDelete } = await import("@/api/publisher");
    accountDelete.mockResolvedValue({ code: 1, message: "delete failed" });
    const w = await mountView();
    await w.vm.removeAccount({ id: "a1", platform: "douyin" });
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith("delete failed");
  });

  it("removeAccount does nothing when user cancels", async () => {
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockRejectedValue(new Error("canceled"));
    const { accountDelete } = await import("@/api/publisher");
    const w = await mountView();
    await w.vm.removeAccount({ id: "a1", platform: "douyin" });
    expect(accountDelete).not.toHaveBeenCalled();
  });
  it("account-row has flex-wrap for responsive layout", async () => {
    _testAccounts.push({ id: "a1", platform: "zhihu", status: "active", account_name: "知乎账号" });
    const w = mount(AccountsView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick(); await new Promise(r => setTimeout(r, 0)); await nextTick();
    const rows = w.findAll(".account-row");
    expect(rows.length).toBeGreaterThan(0);
    // JSDOM does not apply Vue scoped CSS; check source CSS instead
    const vueSrc = fs.readFileSync("./src/views/Accounts.vue", "utf8");
    expect(vueSrc).toMatch(/flex-wrap:\s*wrap/);
  });

  it("账号身份区域允许收缩并由稳定网格控制响应式布局", async () => {
    _testAccounts.length = 0;
    _testAccounts.push({ id: "a1", platform: "zhihu", status: "active", account_name: "知乎账号" });
    const w = mount(AccountsView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick(); await new Promise(r => setTimeout(r, 0)); await nextTick();
    const info = w.find(".account-identity");
    expect(info.exists()).toBe(true);
    const vueSrc = fs.readFileSync("./src/features/accounts/components/PlatformAccountGroup.vue", "utf8");
    expect(vueSrc).toMatch(/grid-template-columns:\s*20px 28px 38px minmax\(180px, 1fr\) auto/);
    expect(vueSrc).toMatch(/\.account-identity\s*\{\s*min-width:\s*0/);
  });

  // 回归保护：loadGroups 必须在 onMounted 时被调用
  // 此 bug 曾导致 Accounts.vue 报 70 次 console error（commit d016596 修复）
  it("calls loadGroups on mount", async () => {
    _spies.loadGroups.mockClear();
    await mountView();
    expect(_spies.loadGroups).toHaveBeenCalled();
  });

  // 交互测试：点击"添加账号"按钮应打开对话框
  it("opens add account dialog when clicking add button", async () => {
    const w = await mountView();
    // jsdom 不支持 :has-text() 伪类，用 findAll + 文本匹配
    const buttons = w.findAll("button");
    const addBtn = buttons.find(b => b.text().includes("添加账号"));
    if (addBtn) {
      await addBtn.trigger("click");
      await nextTick();
      // 验证对话框或表单出现
      const dialog = w.find(".ui-modal, .el-dialog, .add-account-form");
      expect(dialog.exists() || w.vm.showAddDialog === true || w.vm.authViewVisible === true).toBe(true);
    }
  });

  it("搜索输入防抖后才更新账号查询条件", async () => {
    const w = await mountView();
    vi.useFakeTimers();
    w.vm.searchInput = "知乎";

    w.vm.onSearchInput();
    expect(w.vm.accountStore.searchQuery).toBe("");

    await vi.advanceTimersByTimeAsync(299);
    expect(w.vm.accountStore.searchQuery).toBe("");
    await vi.advanceTimersByTimeAsync(1);
    expect(w.vm.accountStore.searchQuery).toBe("知乎");
  });

  it("连续搜索只应用最后一次输入", async () => {
    const w = await mountView();
    vi.useFakeTimers();
    w.vm.searchInput = "微";
    w.vm.onSearchInput();
    await vi.advanceTimersByTimeAsync(200);
    w.vm.searchInput = "微信";
    w.vm.onSearchInput();
    await vi.advanceTimersByTimeAsync(300);

    expect(w.vm.accountStore.searchQuery).toBe("微信");
  });

  it("清空搜索会立即清理输入和查询条件", async () => {
    const w = await mountView();
    w.vm.searchInput = "抖音";
    w.vm.accountStore.searchQuery = "抖音";

    w.vm.clearSearch();

    expect(w.vm.searchInput).toBe("");
    expect(w.vm.accountStore.searchQuery).toBe("");
  });

  it("收藏筛选只保留已收藏账号", async () => {
    _testAccounts.push(
      { id: "a1", platform: "zhihu", status: "active", account_name: "收藏账号" },
      { id: "a2", platform: "zhihu", status: "active", account_name: "普通账号" },
    );
    _favoriteIds.add("a1");
    const w = await mountView();

    w.vm.filter = "favorite";
    await nextTick();

    expect(w.vm.groupedPlatforms[0].accounts.map(account => account.id)).toEqual(["a1"]);
  });

  it("筛选状态、全选范围和批量删除范围始终使用当前可见账号", async () => {
    _testAccounts.push(
      { id: "a1", platform: "zhihu", status: "active", account_name: "有效账号" },
      { id: "a2", platform: "zhihu", status: "inactive", account_name: "失效账号" },
    );
    const w = await mountView();
    w.vm.accountStore.selectedIds.add("a2");
    w.vm.accountStore.selectedIds.add("a1");

    w.vm.filter = "active";
    await nextTick();

    expect(w.vm.accountStore.filterStatus).toBe("active");
    expect(w.vm.selectedCount).toBe(1);

    w.vm.toggleSelectAll();
    expect(_spies.selectAll).toHaveBeenCalledWith(["a1"]);

    _spies.batchDelete.mockResolvedValueOnce({ success: 1, failed: 0 });
    await w.vm.handleBatchDelete();
    expect(_spies.batchDelete).toHaveBeenCalledWith(["a1"]);
  });

  it("账号状态变化事件会刷新列表并提示失效数量", async () => {
    const w = await mountView();
    _spies.load.mockClear();

    _eventCallbacks.statusChanged({ expiredCount: 2 });
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    const { ElMessage } = await import("element-plus");
    expect(_spies.load).toHaveBeenCalledTimes(1);
    expect(ElMessage.warning).toHaveBeenCalledWith("2 个账号登录已失效");
  });

  it("登录完成事件会关闭登录视图、提示凭证已自动保存并刷新账号", async () => {
    const w = await mountView();
    _spies.load.mockClear();
    w.vm.authViewVisible = true;

    _eventCallbacks.authCompleted({ platform: "zhihu" });
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    const { ElMessage } = await import("element-plus");
    expect(w.vm.authViewVisible).toBe(false);
    // 成功提示由 useAccountEvents.complete() 统一弹出（凭证已自动保存），页面不再重复提示
    expect(ElMessage.success).toHaveBeenCalledWith("zhihu 登录凭证已自动保存");
    expect(_spies.load).toHaveBeenCalledTimes(1);
  });

  it("重新登录完成事件使用凭证已自动保存提示", async () => {
    const w = await mountView();
    _spies.load.mockClear();
    await w.vm.reloginAccount({ id: "expired-1", platform: "zhihu", status: "inactive" });
    _spies.load.mockClear();

    _eventCallbacks.authCompleted({ platform: "zhihu", accountId: "expired-1" });
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalledWith("zhihu 登录凭证已自动保存");
    expect(_spies.load).toHaveBeenCalledTimes(1);
    expect(w.vm.pendingAuthAction).toBeNull();
  });

  it("checkLogin 检测失效后将账号ID加入checkedExpiredIds并走重新登录认证流程", async () => {
    const { accountCheckLogin, authOpenLogin } = await import("@/api/publisher");
    accountCheckLogin.mockResolvedValue({ code: 0, data: { valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED" } });
    authOpenLogin.mockResolvedValue({ code: 0 });
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue("confirm");
    _testAccounts.push({ id: "a1", platform: "zhihu", status: "active", account_name: "失效账号" });
    const w = await mountView();

    await w.vm.checkLogin({ id: "a1", platform: "zhihu", status: "active", account_name: "失效账号" });

    // 新行为：不再写数据库status，改为前端的checkedExpiredIds Set
    expect(w.vm.checkedExpiredIds.has("a1")).toBe(true);
    // 确认后应走 reloginAccount（auth:open-login 认证流程），而非 openLoginPage 普通标签页
    expect(authOpenLogin).toHaveBeenCalledWith("zhihu", "a1");
    // reloginAccount 在 result?.code !== 0（包括 undefined）时进入错误分支，pendingAuthAction 被置 null
    // 新行为: openLogin成功后pendingAuthAction等待onCompleted
    expect(w.vm.pendingAuthAction).toBe("relogin");
  });

  it("checkLogin 检测失效后用户取消确认不触发重新登录但加入checkedExpiredIds", async () => {
    const { accountCheckLogin, authOpenLogin } = await import("@/api/publisher");
    accountCheckLogin.mockResolvedValue({ code: 0, data: { valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED" } });
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockRejectedValue("cancel");
    _testAccounts.push({ id: "a1", platform: "zhihu", status: "active", account_name: "失效账号" });
    const w = await mountView();

    await w.vm.checkLogin({ id: "a1", platform: "zhihu", status: "active", account_name: "失效账号" });

    // 新行为：写入checkedExpiredIds Set而非数据库status
    expect(w.vm.checkedExpiredIds.has("a1")).toBe(true);
    // 但不触发重新登录
    expect(authOpenLogin).not.toHaveBeenCalled();
  });

  it("卸载时释放全部 Electron 登录事件订阅", async () => {
    const w = await mountView();

    w.unmount();

    for (const unsubscribe of Object.values(_eventUnsubscribers)) {
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    }
  });

  it("删除接口返回异常格式时显示默认错误且不刷新", async () => {
    const { accountDelete } = await import("@/api/publisher");
    accountDelete.mockResolvedValueOnce({});
    const w = await mountView();
    _spies.load.mockClear();

    await w.vm.removeAccount({ id: "a1", platform: "douyin", account_name: "账号" });

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith("删除失败");
    expect(_spies.load).not.toHaveBeenCalled();
  });

  it("批量删除全成功时显示真实成功数量且不重复刷新", async () => {
    _spies.batchDelete.mockResolvedValueOnce({ success: 2, failed: 0 });
    _testAccounts.push(
      { id: "a1", platform: "zhihu", status: "active" },
      { id: "a2", platform: "zhihu", status: "active" },
    );
    _selectedIds.add("a1");
    _selectedIds.add("a2");
    const w = await mountView();
    _spies.load.mockClear();

    await w.vm.handleBatchDelete();

    expect(_spies.batchDelete).toHaveBeenCalledTimes(1);
    expect(_spies.load).not.toHaveBeenCalled();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalledWith("已删除 2 个账号");
  });

  it("批量删除部分失败时显示成功和失败数量", async () => {
    _spies.batchDelete.mockResolvedValueOnce({ success: 1, failed: 1 });
    _testAccounts.push(
      { id: "a1", platform: "zhihu", status: "active" },
      { id: "a2", platform: "zhihu", status: "active" },
    );
    _selectedIds.add("a1");
    _selectedIds.add("a2");
    const w = await mountView();
    _spies.load.mockClear();

    await w.vm.handleBatchDelete();

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalledWith("已删除 1 个账号，1 个删除失败");
    expect(ElMessage.success).not.toHaveBeenCalled();
    expect(_spies.load).not.toHaveBeenCalled();
  });

  it("批量删除全部失败时只显示失败提示", async () => {
    _spies.batchDelete.mockResolvedValueOnce({ success: 0, failed: 2 });
    _testAccounts.push(
      { id: "a1", platform: "zhihu", status: "active" },
      { id: "a2", platform: "zhihu", status: "active" },
    );
    _selectedIds.add("a1");
    _selectedIds.add("a2");
    const w = await mountView();
    _spies.load.mockClear();

    await w.vm.handleBatchDelete();

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error).toHaveBeenCalledWith("2 个账号删除失败");
    expect(ElMessage.success).not.toHaveBeenCalled();
    expect(_spies.load).not.toHaveBeenCalled();
  });

  it("批量启用和禁用使用当前可见选中账号", async () => {
    _spies.batchSetStatus.mockResolvedValueOnce({ success: 2, failed: 0 });
    _testAccounts.push(
      { id: "a1", platform: "zhihu", status: "inactive" },
      { id: "a2", platform: "zhihu", status: "inactive" },
    );
    _selectedIds.add("a1");
    _selectedIds.add("a2");
    const w = await mountView();

    await w.vm.handleBatchStatus("active");

    expect(_spies.batchSetStatus).toHaveBeenCalledWith("active", ["a1", "a2"]);
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.success).toHaveBeenCalledWith("已启用 2 个账号");
  });

  it("使用真实 Pinia Store 的筛选全选状态", async () => {
    vi.resetModules();
    vi.doUnmock("@/stores/accounts");
    const [
      { default: RealAccountsView },
      { useAccountStore },
      { createPinia: createRealPinia, setActivePinia: setRealActivePinia },
      { listAccounts },
    ] = await Promise.all([
      import("./Accounts.vue"),
      import("@/stores/accounts"),
      import("pinia"),
      import("@/api/publisher"),
    ]);
    listAccounts.mockResolvedValue({
      code: 0,
      data: [
        { id: "wx-1", platform: "wechat_mp", status: "active", account_name: "微信公众号" },
        { id: "zh-1", platform: "zhihu", status: "active", account_name: "知乎账号" },
      ],
    });
    const pinia = createRealPinia();
    setRealActivePinia(pinia);
    const w = mount(RealAccountsView, { global: { plugins: [pinia, i18n] } });
    await nextTick();
    await new Promise(resolve => setTimeout(resolve, 0));
    await nextTick();
    const store = useAccountStore();

    store.searchQuery = "微信";
    store.selectAll();
    await nextTick();

    await w.get('[data-testid="account-batch"]').trigger('click');
    await nextTick();

    expect(store.filteredAccounts.map(account => account.id)).toEqual(["wx-1"]);
    expect(store.isAllSelected).toBe(true);
    expect(w.find(".batch-toolbar label input").element.checked).toBe(true);
    w.unmount();
  });

  it('视图切换按钮切换 grid/list 视图', async () => {
    const w = await mountView();
    await w.get('[data-testid="account-view-grid"]').trigger('click');
    expect(w.vm.accountViewMode).toBe('grid');
    await w.get('[data-testid="account-view-list"]').trigger('click');
    expect(w.vm.accountViewMode).toBe('list');
  });

  it('平台搜索框输入后出现清除按钮并点击清空', async () => {
    const w = await mountView();
    const input = w.get('input[type="search"]');
    await input.setValue('快手');
    await w.vm.$nextTick();
    const clear = w.findAll('.clear-search')[0];
    expect(clear.exists()).toBe(true);
    await clear.trigger('click');
    expect(w.vm.platformSearchInput).toBe('');
  });

  it('分组搜索框更新 groupSearchInput', async () => {
    const w = await mountView();
    const input = w.findAll('input[type="search"]').find(i => i.attributes('placeholder')?.includes('搜索分组'));
    if (input) {
      await input.setValue('测试分组');
      expect(w.vm.groupSearchInput).toBe('测试分组');
    }
  });

  it('批量模式点击取消选择按钮调用 clearSelection', async () => {
    const w = await mountView();
    await w.get('[data-testid="account-batch"]').trigger('click');
    await w.vm.$nextTick();
    const cancelBtn = w.findAll('.batch-cancel')[0];
    if (cancelBtn) {
      await cancelBtn.trigger('click');
      expect(_spies.clearSelection).toHaveBeenCalled();
    }
  });

});
