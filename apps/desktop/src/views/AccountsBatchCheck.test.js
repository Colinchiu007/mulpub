import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
import fs from "fs";
import i18n from "@/i18n";

vi.mock("@/composables/usePlatformIconUrl", async (importOriginal) => ({
  ...(await importOriginal()),
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
const _accountErrorCode = vi.hoisted(() => ({ value: null }));
const _identityState = vi.hoisted(() => ({ isAuthenticated: false }));
const _ensureLogin = vi.hoisted(() => vi.fn(async () => false));
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
// PRD-UI-FLOW-CLARITY S1a：页内模块 tab 通过 router.push 切换。
// 原 mock 每次调用都返回新的 { replace: vi.fn() }，既无 push 也无法断言，
// 故改为共享对象；调用方需在 beforeEach 里清空调用记录。
const _routerState = vi.hoisted(() => ({ push: vi.fn(), replace: vi.fn() }))

vi.mock('vue-router', () => ({
  useRoute: () => _routeState,
  useRouter: () => _routerState,
}))

vi.mock('@/stores/identity', () => ({
  useIdentityStore: () => ({
    get isAuthenticated() { return _identityState.isAuthenticated; },
    status: 'signed_out',
    signInOrSwitch: vi.fn(),
  }),
}));

vi.mock('@/composables/useLoginGate', () => ({
  useLoginGate: () => ({ ensureLogin: _ensureLogin }),
}));

const _spies = vi.hoisted(() => ({
  load: vi.fn(),
  loadGroups: vi.fn(),
  toggleSelect: vi.fn(),
  selectAll: vi.fn(),
  clearSelection: vi.fn(),
  batchDelete: vi.fn().mockResolvedValue({ success: 0, failed: 0 }),
  batchSetActive: vi.fn().mockResolvedValue({ success: 0, failed: 0 }),
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
    get errorCode() { return _accountErrorCode.value; },
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
    batchSetActive: _spies.batchSetActive,
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
  // 账号云镜像同步（AccountCloudSyncDialog 真实调用的四个方法；默认 code:-1 = 摘要失败态）
  accountsCloudDigest: vi.fn().mockResolvedValue({ code: -1, message: 'stub' }),
  accountsCloudSync: vi.fn().mockResolvedValue({ code: -1, message: 'stub' }),
  accountsCloudDisconnect: vi.fn().mockResolvedValue({ code: -1, message: 'stub' }),
  onAccountsCloudSyncProgress: vi.fn(() => () => {}),
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
import AccountCloudSyncDialog from "@/features/accounts/components/AccountCloudSyncDialog.vue";

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

/**
 * 「一键检测」（batchCheckAllLogins）专属测试文件。
 *
 * 为什么从 Accounts.test.js 拆出来：Accounts.test.js 在 check-max-lines 点名还账清单上
 * （登记值 2029 行、零增长容差），而一键检测是账号页最重的单一特性域：
 * 进度可见性 / 三态契约 / 提示统一 / 卡片刷新兜底 / 事件订阅与定时器生命周期。
 * 按被测模块分文件是门禁给出的正解，不是为拆而拆。
 *
 * 2026-10-22 fix-batch-check-toast-unify：随本次修复一并落地，
 * 含新增的「提示统一为一条汇总」「卡片登录态刷新兜底」两个 describe。
 */
describe("AccountsView — 一键检测 batchCheckAllLogins", () => {
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
    _spies.batchSetActive.mockResolvedValue({ success: 0, failed: 0 });
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

  it("batchCheckAllLogins 一键检测全部账号并按结果更新本地状态", async () => {
    const { accountBatchCheckLogin, accountUpdate } = await import("@/api/publisher");
    accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        results: [
          { accountId: "a1", platform: "douyin", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: "active", statusChanged: true },
          { accountId: "a2", platform: "zhihu", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED", loginStatus: "expired", statusChanged: true },
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
    // 登录态持久化是主进程单一写者的职责（AccountManager.persistLoginState → 后端 accounts.json）。
    // 渲染层绝不能再写 status：accountUpdate 走 store:update-account，写的是 Electron 本地 SQLite，
    // 而读取端是后端 accounts.json —— 双写不同库正是「一键检测后重进又显示已登录」的根因。
    expect(accountUpdate).not.toHaveBeenCalled();
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
          { accountId: "b1", platform: "douyin", valid: true, loginStatus: "active", statusChanged: true },
          { accountId: "b2", platform: "zhihu", valid: true, loginStatus: "active", statusChanged: true },
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

  // ── 登录态固化与三态回归 ──

  it("batchCheckAllLogins 未取到定论（valid 缺失）不计入失效，且保持真源原状态", async () => {
    const { accountBatchCheckLogin, accountUpdate } = await import("@/api/publisher");
    accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        results: [
          // 单向证据规则：u1 无定论 → 真源不动，主进程回传保持后的 active（statusChanged=false）
          { accountId: "u1", platform: "tencent_video", code: "CHECK_LOGIN_INCONCLUSIVE", loginStatus: "active", statusChanged: false, persisted: { ok: true, kept: true } },
          { accountId: "u2", platform: "toutiao", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED", loginStatus: "expired", statusChanged: true, persisted: { ok: true, status: "expired" } },
        ],
        checkedAt: "2026-09-11T08:00:00Z",
      },
    });
    _testAccounts.push(
      { id: "u1", platform: "tencent_video", status: "active", account_name: "视频号" },
      { id: "u2", platform: "toutiao", status: "active", account_name: "头条号" },
    );
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    // 无定论不得把已登录渲染成未确认（此前正是这里造成徽章来回跳）
    expect(_testAccounts.find(a => a.id === "u1").status).toBe("active");
    expect(_testAccounts.find(a => a.id === "u1").last_validated, "未改写就不该有更新的定论时间").toBeUndefined();
    expect(_testAccounts.find(a => a.id === "u2").status).toBe("expired");
    expect(w.vm.checkedExpiredIds.has("u1")).toBe(false);
    expect(w.vm.checkedExpiredIds.has("u2")).toBe(true);
    expect(accountUpdate).not.toHaveBeenCalled();
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalled();
    // 未确认不等于失效：不得出现「全部正常」的成功提示
    expect(ElMessage.success).not.toHaveBeenCalled();
  });

  // 2026-10-22 fix-batch-check-toast-unify 改写：固化失败从「独立红色 error」降级为
  // 「汇总句尾段」。原断言是 `ElMessage.error` 被调用，那正是用户报「一键检测功能坏了」的来源 ——
  // 它的真实语义只是「部分账号的结论没落库」，下次进页面会回退到旧状态，不是整个操作失败。
  // 新契约：仍然**必须可见**（不静默），但级别跟着它所在的那句走；本条 fixture 有失效 ⇒ warning。
  it("batchCheckAllLogins 主进程固化失败仍然可见，但降级为汇总尾段（不再是红色 error）", async () => {
    const { accountBatchCheckLogin } = await import("@/api/publisher");
    accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        results: [
          { accountId: "p1", platform: "toutiao", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED", loginStatus: "expired", persisted: { ok: false, reason: "backend-error" } },
        ],
        checkedAt: "2026-09-11T08:00:00Z",
      },
    });
    _testAccounts.push({ id: "p1", platform: "toutiao", status: "active", account_name: "头条号" });
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    const { ElMessage } = await import("element-plus");
    expect(ElMessage.error, "固化失败不得再弹红色 error（那是整个操作失败的级别）").not.toHaveBeenCalled();
    // 可见性不降：文案里必须点名「未能保存到服务端」
    const shown = ElMessage.warning.mock.calls.map(c => c[0]).join('\n');
    expect(shown).toContain("未能保存到服务端");
    expect(w.vm.batchCheckAllBusy).toBe(false);
  });

  // ── 提示统一（2026-10-22，fix-batch-check-toast-unify）──
  // 缺陷：一次点击弹 4 条 toast（开始检测 / 汇总 / 后续操作建议 / 固化失败），
  // 且「0 个失效」与「5 个账号需要重新登录」同屏出现，用户读成自相矛盾。
  // 目标：结果侧只有 1 条汇总 toast（报数 + 下一步 + 固化失败三段拼成一句），
  // 固化失败降级为汇总尾段（不再单独红色 error），开始检测的进度 toast 删除。
  describe("batchCheckAllLogins 提示统一为一条汇总", () => {
    /** 取本轮所有 toast 的文案（按调用顺序） */
    async function toastTexts () {
      const { ElMessage } = await import("element-plus");
      return {
        info: ElMessage.info.mock.calls.map(c => c[0]),
        success: ElMessage.success.mock.calls.map(c => c[0]),
        warning: ElMessage.warning.mock.calls.map(c => c[0]),
        error: ElMessage.error.mock.calls.map(c => c[0]),
      };
    }

    it("最坏形态（有失效 + 有重试 + 有固化失败）也只弹 1 条结果 toast", async () => {
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockResolvedValue({
        code: 0,
        data: {
          results: [
            { accountId: "w1", platform: "toutiao", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: "active", statusChanged: true },
            { accountId: "w2", platform: "zhihu", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED", loginStatus: "expired", statusChanged: true },
            { accountId: "w3", platform: "tencent_video", valid: undefined, code: "CHECK_LOGIN_INCONCLUSIVE", reason: "no-cookie", loginStatus: "active", statusChanged: false, hint: { key: "accountsPage.checkHints.noCookie", action: "relogin" } },
            { accountId: "w4", platform: "bilibili", valid: undefined, code: "CHECK_LOGIN_INCONCLUSIVE", reason: "http-check-inconclusive", loginStatus: "active", statusChanged: false, hint: { key: "accountsPage.checkHints.httpCheckInconclusive", action: "retry" } },
            { accountId: "w5", platform: "douyin", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED", loginStatus: "expired", statusChanged: false, persisted: { ok: false, reason: "backend-error" } },
          ],
          checkedAt: "2026-10-22T00:00:00Z",
        },
      });
      _testAccounts.push(
        { id: "w1", platform: "toutiao", status: "expired", account_name: "头条号" },
        { id: "w2", platform: "zhihu", status: "active", account_name: "知乎号" },
        { id: "w3", platform: "tencent_video", status: "active", account_name: "视频号" },
        { id: "w4", platform: "bilibili", status: "active", account_name: "B站号" },
        { id: "w5", platform: "douyin", status: "active", account_name: "抖音号" },
      );
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      const t = await toastTexts();
      const all = [...t.info, ...t.success, ...t.warning, ...t.error];
      // 结果侧必须只有 1 条：不再有独立的「后续操作建议」与「固化失败」两条
      expect(all.length, "结果侧 toast 数量必须为 1").toBe(1);
      expect(t.error, "固化失败降级为汇总尾段，不得再弹红色 error").toEqual([]);
      expect(t.info, "不再有 info 级结果提示（进度 toast 已删、下一步已并入）").toEqual([]);
      // 一条里同时含三段：计数 / 下一步 / 固化失败
      expect(t.warning[0]).toContain("检测完成");
      expect(t.warning[0]).toContain("其中 1 个建议重新登录");
      expect(t.warning[0]).toContain("1 个建议稍后重试");
      expect(t.warning[0]).toContain("未能保存到服务端");
    });

    it("开始检测不再弹 info toast（进度由全屏遮罩承载，冗余且被遮住不可读）", async () => {
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockResolvedValue({
        code: 0,
        data: { results: [{ accountId: "s1", platform: "zhihu", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: "active", statusChanged: true }], checkedAt: "2026-10-22T00:00:00Z" },
      });
      _testAccounts.push({ id: "s1", platform: "zhihu", status: "active", account_name: "知乎号" });
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      const { ElMessage } = await import("element-plus");
      expect(ElMessage.info, "开始检测的 toast 必须删除").not.toHaveBeenCalled();
      // 终态仍要有一条
      expect(ElMessage.success).toHaveBeenCalledTimes(1);
    });

    it("全部正常时仍是 1 条 success，且不带任何附加段", async () => {
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockResolvedValue({
        code: 0,
        data: {
          results: [
            { accountId: "k1", platform: "zhihu", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: "active", statusChanged: true },
            { accountId: "k2", platform: "douyin", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: "active", statusChanged: true },
          ],
          checkedAt: "2026-10-22T00:00:00Z",
        },
      });
      _testAccounts.push(
        { id: "k1", platform: "zhihu", status: "active", account_name: "知乎号" },
        { id: "k2", platform: "douyin", status: "active", account_name: "抖音号" },
      );
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      const { ElMessage } = await import("element-plus");
      expect(ElMessage.success).toHaveBeenCalledTimes(1);
      expect(ElMessage.success.mock.calls[0][0]).toContain("2");
      expect(ElMessage.warning).not.toHaveBeenCalled();
      expect(ElMessage.error).not.toHaveBeenCalled();
    });

    it("IPC 整体失败时仍是独立 error toast（那才是「整个操作失败」）", async () => {
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockRejectedValue(new Error("主进程崩了"));
      _testAccounts.push({ id: "e1", platform: "zhihu", status: "active", account_name: "知乎号" });
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      const { ElMessage } = await import("element-plus");
      expect(ElMessage.error).toHaveBeenCalled();
      expect(w.vm.batchCheckAllBusy).toBe(false);
    });
  });

  // ── 卡片登录态刷新兜底（2026-10-22，fix-batch-check-toast-unify）──
  // 缺陷：主进程读不到真源现状时回传 loginStatus=null，渲染层 `if (item.loginStatus)`
  // 整段跳过 → 卡片徽章一动不动，用户以为"检测了什么都没发生"。
  //
  // ⚠️ 2026-10-22 CCG 深度评审 i1（Critical，auth 域）后**收窄契约**：
  // 兜底的门控条件是 `statusChanged === true`（主进程本轮确实改写了真源），
  // **不是**"loginStatus 为 null"。理由：`statusChanged` 来自主进程 persistCheckOutcome 的
  // `changed`，它表示真源已被改写；只有"真源确实被改成某结论、而回传的 loginStatus 却缺失"时，
  // 用 valid 兜底才是等价的（展示值 == 刚落盘的值）。若 statusChanged 为 false（无定论 /
  // 结论未变 / 读不到现状），一律不碰卡片 —— 那正是"用可能过期的 valid 覆盖真源"的风险路径。
  describe("batchCheckAllLogins 卡片登录态刷新兜底", () => {
    it("loginStatus 缺失但主进程已改写真源（statusChanged=true）时，按三态结论刷新卡片", async () => {
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockResolvedValue({
        code: 0,
        data: {
          results: [
            // 主进程 readAccountSnapshot 读不到 → loginStatus 为 null，但真源已被改写
            { accountId: "n1", platform: "zhihu", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: null, statusChanged: true },
            { accountId: "n2", platform: "toutiao", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED", loginStatus: null, statusChanged: true },
          ],
          checkedAt: "2026-10-22T00:00:00Z",
        },
      });
      _testAccounts.push(
        { id: "n1", platform: "zhihu", status: "expired", account_name: "知乎号" },
        { id: "n2", platform: "toutiao", status: "active", account_name: "头条号" },
      );
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      expect(_testAccounts.find(a => a.id === "n1").status, "有效结论必须让卡片从失效翻回已登录").toBe("active");
      expect(_testAccounts.find(a => a.id === "n2").status, "失效结论必须让卡片翻到已失效").toBe("expired");
    });

    it("回归锁（CCG i1）：statusChanged=false 时即使 valid 有结论也不得兜底刷新", async () => {
      // 这条是评审 i1 的回归锁。风险场景：主进程 readAccountSnapshot 读不到真源现状
      // （null = 读取失败，不是"没有现状"），此时若还用本轮 valid 覆盖卡片，
      // 展示层就会盖掉另一写者刚落盘的结论 —— 用户看到的是过期证据。
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockResolvedValue({
        code: 0,
        data: {
          results: [
            { accountId: "g1", platform: "zhihu", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: null, statusChanged: false },
            { accountId: "g2", platform: "toutiao", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED", loginStatus: null, statusChanged: false },
          ],
          checkedAt: "2026-10-22T00:00:00Z",
        },
      });
      _testAccounts.push(
        { id: "g1", platform: "zhihu", status: "unverified", account_name: "知乎号" },
        { id: "g2", platform: "toutiao", status: "unverified", account_name: "头条号" },
      );
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      expect(_testAccounts.find(a => a.id === "g1").status, "真源未被改写，valid 不得覆盖卡片").toBe("unverified");
      expect(_testAccounts.find(a => a.id === "g2").status, "同上，负向结论同样不得覆盖").toBe("unverified");
      expect(_testAccounts.find(a => a.id === "g1").last_validated, "未改写就不该伪造定论时间").toBeUndefined();
    });

    it("回归锁（CCG i4）：loginStatus 为空字符串时按「没有真源现状」处理，不被误送进兜底", async () => {
      // i4：truthy 判断会把 '' 判成 falsy 从而落进 valid 兜底分支。空串同样是"没有现状"，
      // 但它同样不该触发兜底 —— 契约由 statusChanged 决定，与 loginStatus 的形态无关。
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockResolvedValue({
        code: 0,
        data: {
          results: [
            { accountId: "e1", platform: "zhihu", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: "", statusChanged: false },
          ],
          checkedAt: "2026-10-22T00:00:00Z",
        },
      });
      _testAccounts.push({ id: "e1", platform: "zhihu", status: "unverified", account_name: "知乎号" });
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      expect(_testAccounts.find(a => a.id === "e1").status, "空串 loginStatus + statusChanged=false ⇒ 不碰卡片").toBe("unverified");
    });

    it("loginStatus 缺失且检测也无定论时，卡片保持原状（不得凭空造结论）", async () => {
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockResolvedValue({
        code: 0,
        data: {
          results: [
            { accountId: "m1", platform: "tencent_video", valid: undefined, code: "CHECK_LOGIN_INCONCLUSIVE", loginStatus: null, statusChanged: false },
          ],
          checkedAt: "2026-10-22T00:00:00Z",
        },
      });
      _testAccounts.push({ id: "m1", platform: "tencent_video", status: "active", account_name: "视频号" });
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      // 单向证据规则：无定论既不改写真源，也不在展示层伪造结论
      expect(_testAccounts.find(a => a.id === "m1").status).toBe("active");
      expect(_testAccounts.find(a => a.id === "m1").last_validated, "未改写就不该伪造定论时间").toBeUndefined();
    });

    it("loginStatus 有值时仍以主进程真源结论优先（兜底不得反超真源）", async () => {
      const { accountBatchCheckLogin } = await import("@/api/publisher");
      accountBatchCheckLogin.mockResolvedValue({
        code: 0,
        data: {
          results: [
            // 检测有效，但真源此刻是 unverified（另一写者刚改）→ 展示层跟随真源
            { accountId: "t1", platform: "zhihu", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: "unverified", statusChanged: false },
          ],
          checkedAt: "2026-10-22T00:00:00Z",
        },
      });
      _testAccounts.push({ id: "t1", platform: "zhihu", status: "active", account_name: "知乎号" });
      const w = await mountView();

      await w.vm.batchCheckAllLogins();

      expect(_testAccounts.find(a => a.id === "t1").status).toBe("unverified");
    });
  });


  // ── 一键检测进度可见性回归（进度卡顿修复 2026-09-22）──
  // 缺陷：进度只在「账号完成」边界更新，单个耗时账号（浏览器降级检测）
  // 期间遮罩计数完全静止，用户看到的是“检测中 0/7 一直不动”。
  it("batchCheckAllLogins 收到 start 事件时立即展示正在检测的平台，不等账号完成", async () => {
    const publisher = await import("@/api/publisher");
    let resolveBatch;
    publisher.accountBatchCheckLogin.mockReturnValue(new Promise(r => { resolveBatch = r }));
    let emit = null;
    window.electronAPI = {
      onAccountsBatchCheckProgress: (cb) => { emit = cb; return () => { emit = null } },
    };
    _testAccounts.push(
      { id: "p1", platform: "zhihu", status: "active", account_name: "知乎号" },
      { id: "p2", platform: "douyin", status: "active", account_name: "抖音号" },
    );
    const w = await mountView();

    const running = w.vm.batchCheckAllLogins();
    await nextTick();

    expect(emit, "未订阅进度事件").toBeTruthy();
    // 该账号尚未完成（batch 仍在进行中）时只发 start
    emit({ phase: "start", checked: 0, total: 2, platform: "zhihu", accountId: "p1" });
    await nextTick();

    expect(w.vm.batchCheckProgress.current).toContain("zhihu");
    expect(w.vm.batchCheckProgress.checked).toBe(0);
    expect(w.vm.batchCheckAllDetailText).toContain("正在检测");
    expect(w.vm.batchCheckAllDetailText).toContain("知乎");

    emit({ phase: "done", checked: 1, total: 2, platform: "zhihu", accountId: "p1", valid: true, code: "CHECK_LOGIN_SUCCESS", elapsedMs: 4200 });
    await nextTick();
    expect(w.vm.batchCheckProgress.checked).toBe(1);
    expect(w.vm.batchCheckProgress.current).not.toContain("zhihu");
    expect(w.vm.batchCheckAllDetailText).not.toContain("知乎");

    resolveBatch({ code: 0, data: { results: [{ accountId: "p1", platform: "zhihu", valid: true }], checkedAt: "2026-09-22T00:00:00Z" } });
    await running;
  });

  // 回归保护：检测中按钮只显示短标签。命令栏是 flex:0 0 auto 不参与收缩，
  // 长进度文案（含平台名）会撑宽它并把整条工具栏挤到换行（实测高 63px→91px、状态切换器换位），
  // 而详细进度本就由同一 v-if 条件的全屏遮罩承载，按钮上的长文案被遮罩盖住根本不可读。
  it("batchCheckAllLogins 检测中按钮文案保持短标签，不随进度增长", async () => {
    const publisher = await import("@/api/publisher");
    let resolveBatch;
    publisher.accountBatchCheckLogin.mockReturnValue(new Promise(r => { resolveBatch = r }));
    let emit = null;
    window.electronAPI = {
      onAccountsBatchCheckProgress: (cb) => { emit = cb; return () => { emit = null } },
    };
    _testAccounts.push({ id: "s1", platform: "zhihu", status: "active", account_name: "知乎号" });
    const w = await mountView();

    const running = w.vm.batchCheckAllLogins();
    await nextTick();
    emit({ phase: "start", checked: 0, total: 1, platform: "zhihu", accountId: "s1" });
    await nextTick();

    const btn = w.find('[data-testid="account-batch-check-all"]');
    expect(btn.text()).toBe(i18n.global.t("accountsPage.batchCheckAllBusy"));
    expect(btn.text()).not.toContain("/");

    const overlay = w.find('[data-testid="batch-check-overlay"]');
    expect(overlay.exists()).toBe(true);
    expect(overlay.find(".batch-check-progress").text()).toContain("0/1");

    resolveBatch({ code: 0, data: { results: [{ accountId: "s1", platform: "zhihu", valid: true }], checkedAt: "2026-09-22T00:00:00Z" } });
    await running;
  });

  it("batchCheckAllLogins 遮罩展示递增的已耗时秒数，让等待可感知", async () => {
    const publisher = await import("@/api/publisher");
    let resolveBatch;
    publisher.accountBatchCheckLogin.mockReturnValue(new Promise(r => { resolveBatch = r }));
    let emit = null;
    window.electronAPI = {
      onAccountsBatchCheckProgress: (cb) => { emit = cb; return () => { emit = null } },
    };
    _testAccounts.push({ id: "t1", platform: "zhihu", status: "active", account_name: "知乎" });
    const w = await mountView();

    // 秒表用 setInterval + Date.now()，fake timers 必须在启动前安装：
    // 否则已注册的真实定时器不会被 advanceTimersByTimeAsync 触发。
    vi.useFakeTimers();
    const running = w.vm.batchCheckAllLogins();
    await nextTick();
    emit({ phase: "start", checked: 0, total: 1, platform: "zhihu", accountId: "t1" });
    await nextTick();

    try {
      await vi.advanceTimersByTimeAsync(5000);
      expect(w.vm.batchCheckElapsedSec).toBe(5);
      expect(w.vm.batchCheckAllDetailText).toContain("已耗时");
      expect(w.vm.batchCheckAllDetailText).toContain("5");
      // 进度条按“已完成/总数”推进，有真实反馈而不是死在 0%
      expect(w.vm.batchCheckPercent).toBe(0);
    } finally {
      vi.useRealTimers();
    }

    resolveBatch({ code: 0, data: { results: [{ accountId: "t1", platform: "zhihu", valid: true }], checkedAt: "2026-09-22T00:00:00Z" } });
    await running;
    expect(w.vm.batchCheckElapsedSec).toBe(0);
    expect(w.vm.batchCheckAllBusy).toBe(false);
  });

  it("batchCheckAllLogins 结束后取消事件订阅且不泄漏定时器", async () => {
    const publisher = await import("@/api/publisher");
    publisher.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: { results: [{ accountId: "q1", platform: "douyin", valid: false, code: "CHECK_LOGIN_COOKIE_EXPIRED" }], checkedAt: "2026-09-22T00:00:00Z" },
    });
    let unsubscribed = 0;
    window.electronAPI = {
      onAccountsBatchCheckProgress: () => () => { unsubscribed += 1 },
    };
    _testAccounts.push({ id: "q1", platform: "douyin", status: "active", account_name: "抖音" });
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    expect(unsubscribed).toBe(1);
    expect(w.vm.batchCheckProgress.checked).toBe(0);
    expect(w.vm.batchCheckProgress.total).toBe(0);
    expect(w.vm.batchCheckProgress.current).toEqual([]);
    vi.useFakeTimers();
    try {
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it("batchCheckAllLogins 超时账号保持原状态：不计入失效、不回写 expired", async () => {
    // 原用例把超时 mock 成 valid:false 并断言渲染成「已失效」+ 计入失效集合，
    // 那是三态契约之前的形状：主进程对超时返回 valid:undefined 且不改写真源，
    // 回传的 loginStatus 是「保持后的原状态」。断言的是这条真实合同，不是渲染层的推导。
    const publisher = await import("@/api/publisher");
    publisher.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        results: [
          { accountId: "s1", platform: "douyin", valid: undefined, code: "CHECK_LOGIN_TIMEOUT", error: "检测超时（>60000ms）", loginStatus: "active", statusChanged: false },
          { accountId: "s2", platform: "zhihu", valid: true, code: "CHECK_LOGIN_SUCCESS", loginStatus: "active", statusChanged: true },
        ],
        checkedAt: "2026-09-22T00:00:00Z",
      },
    });
    _testAccounts.push(
      { id: "s1", platform: "douyin", status: "active", account_name: "抖音" },
      { id: "s2", platform: "zhihu", status: "active", account_name: "知乎" },
    );
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    expect(_testAccounts.find(a => a.id === "s1").status).toBe("active");
    expect(_testAccounts.find(a => a.id === "s2").status).toBe("active");
    expect(w.vm.checkedExpiredIds.has("s1"), "未取到定论不得计入失效集合").toBe(false);
    const { ElMessage } = await import("element-plus");
    expect(ElMessage.warning).toHaveBeenCalledWith(expect.stringContaining("1"));
  });

  it("batchCheckAllLogins 登录态缺席时保持原徽章，不从 valid 反推", async () => {
    // 主进程在「现状读不到」时本轮不写真源并回传 loginStatus=null；渲染层此时必须什么都不改。
    // 若这里退回按 item.valid 三元推导，单向证据规则就在展示层被绕开了一次。
    const publisher = await import("@/api/publisher");
    publisher.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: {
        results: [
          { accountId: "n1", platform: "douyin", valid: undefined, code: "CHECK_LOGIN_INCONCLUSIVE", loginStatus: null, statusChanged: false },
        ],
        checkedAt: "2026-09-26T00:00:00Z",
      },
    });
    _testAccounts.push({ id: "n1", platform: "douyin", status: "active", account_name: "抖音" });
    const w = await mountView();

    await w.vm.batchCheckAllLogins();

    expect(_testAccounts.find(a => a.id === "n1").status).toBe("active");
    expect(w.vm.checkedExpiredIds.has("n1")).toBe(false);
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
});
