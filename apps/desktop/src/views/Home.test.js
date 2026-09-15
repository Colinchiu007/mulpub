import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import i18n from "@/i18n";

const pushSpy = vi.fn();
vi.mock("vue-router", () => ({
  useRouter: () => ({ push: pushSpy }),
}));

vi.mock("@/stores/identity", () => ({
  useIdentityStore: () => ({ displayName: "测试用户" }),
}));

const platformStoreMock = {
  platforms: [],
  load: vi.fn(),
  getIcon: vi.fn().mockReturnValue(""),
  getLabel: vi.fn().mockImplementation((id) => id),
};
vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => platformStoreMock,
}));

const accountStoreMock = {
  accounts: [],
  ensureLoaded: vi.fn().mockResolvedValue(undefined),
  load: vi.fn().mockResolvedValue(undefined),
};
vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => accountStoreMock,
}));

const tabStoreMock = {
  createTab: vi.fn().mockResolvedValue("tab-1"),
};
vi.mock("@/stores/tab", () => ({
  useTabStore: () => tabStoreMock,
}));

const accountBatchOpenLoginMock = vi.fn();
const accountBatchCheckLoginMock = vi.fn();
const onAuthCompletedMock = vi.fn(() => vi.fn());
const onAccountStatusChangedMock = vi.fn(() => vi.fn());
vi.mock("@/api/publisher", () => ({
  accountBatchOpenLogin: (...args) => accountBatchOpenLoginMock(...args),
  accountBatchCheckLogin: (...args) => accountBatchCheckLoginMock(...args),
  onAuthCompleted: (...args) => onAuthCompletedMock(...args),
  onAccountStatusChanged: (...args) => onAccountStatusChangedMock(...args),
}));

import HomeView from "./Home.vue";

async function flushMounted(w) {
  await nextTick();
  await new Promise((r) => setTimeout(r, 0));
  await nextTick();
  return w;
}

function mountHome() {
  return mount(HomeView, { global: { plugins: [i18n] } });
}

describe("HomeView", () => {
  beforeEach(() => {
    i18n.global.locale.value = "zh";
    vi.clearAllMocks();
    platformStoreMock.platforms = [];
    accountStoreMock.accounts = [];
    accountStoreMock.ensureLoaded.mockResolvedValue(undefined);
    tabStoreMock.createTab.mockResolvedValue("tab-1");
    accountBatchOpenLoginMock.mockResolvedValue({
      code: 0,
      data: {
        items: [
          { accountId: "a1", platform: "weibo", name: "微博账号", loginUrl: "https://weibo.com/login" },
          { accountId: "a2", platform: "douyin", name: "抖音账号", loginUrl: "https://creator.douyin.com/" },
        ],
      },
    });
    window.electronAPI = {
      storeGetPublishStats: vi.fn().mockResolvedValue({ code: 0, data: { total: 42, success: 38, failed: 4 } }),
      storeListAccounts: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "a1" }, { id: "a2" }] }),
      historyList: vi.fn().mockResolvedValue({ code: 0, data: [] }),
    };
  });

  it("renders welcome section with greeting and static subtitle", async () => {
    const w = await flushMounted(mountHome());
    const text = w.text();
    expect(text).toContain("多平台内容一键发布");
    expect(text).toContain("测试用户");
    expect(text).toMatch(/夜深了|早上好|中午好|下午好|晚上好/);
  });

  it("shows six shortcut entries", async () => {
    const w = await flushMounted(mountHome());
    const shortcuts = w.findAll(".mp-home-shortcut");
    expect(shortcuts.length).toBe(6);
    expect(w.text()).toContain("一键发布");
    expect(w.text()).toContain("账号管理");
    expect(w.text()).toContain("私信评论");
  });

  it("falls back to built-in platform tags when platform store is empty", async () => {
    const w = await flushMounted(mountHome());
    const tags = w.findAll(".mp-home-platform-tag");
    expect(tags.length).toBeGreaterThan(0);
    expect(w.text()).toContain("微信公众号");
  });

  it("uses platform store entries when available", async () => {
    platformStoreMock.platforms = [{ id: "weibo", label: "微博" }];
    platformStoreMock.getIcon.mockImplementation((id) => (id === "weibo" ? "✧" : ""));
    const w = await flushMounted(mountHome());
    const tags = w.findAll(".mp-home-platform-tag");
    expect(tags.length).toBe(1);
    expect(tags[0].text()).toContain("微博");
  });

  it("loads and displays stats, account count and recent activity on mount", async () => {
    window.electronAPI.historyList = vi.fn().mockResolvedValue({
      code: 0,
      data: [{ id: "h1", title: "测试文章", platform: "weibo", status: "success", created_at: "2026-08-10T00:00:00Z" }],
    });
    const w = await flushMounted(mountHome());
    const text = w.text();
    expect(text).toContain("42");
    expect(text).toContain("38");
    expect(text).toContain("4");
    expect(text).toContain("测试文章");
    expect(text).toContain("成功");
    expect(window.electronAPI.storeGetPublishStats).toHaveBeenCalled();
    expect(window.electronAPI.storeListAccounts).toHaveBeenCalled();
    expect(platformStoreMock.load).toHaveBeenCalled();
  });

  it("shows empty recent state when there is no history", async () => {
    const w = await flushMounted(mountHome());
    expect(w.text()).toContain("暂无发布记录，开始你的第一次发布吧！");
  });

  it("navigates on shortcut and quick action click", async () => {
    const w = await flushMounted(mountHome());
    await w.findAll(".mp-home-shortcut")[0].trigger("click");
    expect(pushSpy).toHaveBeenCalledWith("/publish");
    await w.get('[data-testid="home-add-account"]').trigger("click");
    expect(pushSpy).toHaveBeenCalledWith("/accounts");
  });

  it("handles missing electronAPI gracefully", async () => {
    delete window.electronAPI;
    const w = await flushMounted(mountHome());
    expect(w.find(".mp-home").exists()).toBe(true);
    expect(w.text()).toContain("暂无发布记录，开始你的第一次发布吧！");
  });

  it("renders English copy when locale is en", async () => {
    i18n.global.locale.value = "en";
    try {
      const w = await flushMounted(mountHome());
      const text = w.text();
      expect(text).toContain("Publish everywhere with one click");
      expect(text).toContain("New Publish");
      expect(text).toContain("Add Account");
      expect(text).toContain("Total Published");
      expect(text).toContain("Shortcuts");
      expect(text).toContain("Recent Activity");
      expect(text).toContain("No publish records yet. Start your first one!");
      expect(text).toMatch(/Late night|Good morning|Good noon|Good afternoon|Good evening/);
    } finally {
      i18n.global.locale.value = "zh";
    }
  });

  it("renders English platform fallback labels when locale is en", async () => {
    i18n.global.locale.value = "en";
    try {
      const w = await flushMounted(mountHome());
      expect(w.text()).toContain("WeChat Official Account");
      expect(w.text()).toContain("WeChat Channels");
    } finally {
      i18n.global.locale.value = "zh";
    }
  });

  // expired banner 的失效判定由 accountBatchCheckLogin 的真正结果控制，不再读 status 字段
  function mockCheckResult(map) {
    accountBatchCheckLoginMock.mockResolvedValue({
      code: 0,
      data: {
        results: Object.entries(map).map(([id, valid]) => ({ accountId: id, valid, code: valid ? "CHECK_LOGIN_SUCCESS" : "CHECK_LOGIN_COOKIE_EXPIRED" })),
      },
    });
  }

  it("shows login expired banner when check results validate expired accounts", async () => {
    accountStoreMock.accounts = [
      { id: "a1", platform: "weibo", status: "active" },
      { id: "a2", platform: "douyin", status: "active" },
      { id: "a3", platform: "zhihu", status: "active" },
    ];
    // 后两个账号检查返回 false → 判别失效
    mockCheckResult({ a1: true, a2: false, a3: false });
    const w = await flushMounted(mountHome());
    expect(accountStoreMock.ensureLoaded).toHaveBeenCalled();
    expect(accountBatchCheckLoginMock).toHaveBeenCalled();
    const banner = w.find(".login-expired-banner");
    expect(banner.exists()).toBe(true);
    expect(w.text()).toContain("登录失效提醒");
    expect(w.text()).toContain("2 个账号待处理");
    expect(w.text()).toContain("批量登录");
  });

  it("hides login expired banner when all check results report valid", async () => {
    accountStoreMock.accounts = [
      { id: "a1", platform: "weibo", status: "active" },
      { id: "a2", platform: "douyin", status: "active" },
    ];
    mockCheckResult({ a1: true, a2: true });
    const w = await flushMounted(mountHome());
    expect(w.find(".login-expired-banner").exists()).toBe(false);
  });

  it("opens login tabs for all expired accounts on batch login", async () => {
    accountStoreMock.accounts = [
      { id: "a1", platform: "weibo", status: "active" },
      { id: "a2", platform: "douyin", status: "active" },
    ];
    // 两个都判失效 → expiredAccounts 包含它们
    mockCheckResult({ a1: false, a2: false });
    const w = await flushMounted(mountHome());
    await w.find(".banner-btn").trigger("click");
    expect(accountBatchOpenLoginMock).toHaveBeenCalledWith(["a1", "a2"]);
    expect(tabStoreMock.createTab).toHaveBeenCalledTimes(2);
    expect(tabStoreMock.createTab).toHaveBeenCalledWith(expect.objectContaining({ url: "https://weibo.com/login", platform: "weibo", accountId: "a1" }));
    expect(tabStoreMock.createTab).toHaveBeenCalledWith(expect.objectContaining({ url: "https://creator.douyin.com/", platform: "douyin", accountId: "a2" }));
  });

  it("dismisses login expired banner", async () => {
    accountStoreMock.accounts = [{ id: "a1", platform: "weibo", status: "active" }];
    mockCheckResult({ a1: false });
    const w = await flushMounted(mountHome());
    expect(w.find(".login-expired-banner").exists()).toBe(true);
    await w.find(".banner-close").trigger("click");
    await nextTick();
    expect(w.find(".login-expired-banner").exists()).toBe(false);
  });
});
