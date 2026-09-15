import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
import i18n from "@/i18n";

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    getLabel: (k) => ({ wechat_mp: "微信", zhihu: "知乎" }[k] || k),
    getIcon: (k) => "📱",
  })
}));

vi.mock("@/api/publisher", () => ({
  syncAll: vi.fn().mockResolvedValue(undefined),
  syncPlatform: vi.fn(),
}));

// Dashboard 自 2026-09-15 起消费 useIdentity（登录门禁范式）；
// 文件级 mock 让既有用例与门禁用例都不依赖真实 identity store / pinia 装配。
const identityAuthenticatedRef = ref(false);
const identitySignInMock = vi.fn(async () => true);
vi.mock("@/composables/useIdentity", () => ({
  useIdentity: () => ({
    isAuthenticated: identityAuthenticatedRef,
    signIn: (...args) => identitySignInMock(...args),
  }),
}));

import DashboardView from "./Dashboard.vue";

describe("DashboardView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    identityAuthenticatedRef.value = false;
    setActivePinia(createPinia());
    window.electronAPI = {
      dashboardStats: vi.fn().mockResolvedValue({
        code: 0,
        data: { total: 42, success: 38, failed: 4, successRate: 90.5, perPlatform: { wechat_mp: { total: 20 }, zhihu: { total: 22 } }, daily: [{ date: "2026-06-20", total: 3 }, { date: "2026-06-21", total: 5 }] }
      }),
      historyList: vi.fn().mockResolvedValue({ code: 0, data: { records: [{ id: "r1", title: "Test", platform: "wechat_mp", status: "success" }] } }),
      syncCached: vi.fn().mockResolvedValue({ code: 0, data: [{ id: "p1", articles: 10, views: 500, comments: 20, followers: 100 }] }),
    };
  });

  it("renders page title", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.text()).toContain("数据看板");
  });

  it("loads and displays stats on mount", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    const text = w.text();
    expect(text).toContain("500");
    expect(text).toContain("42");
    expect(text).toContain("90.5");
  });

  it("shows recent publishes", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("Test");
  });

  it("benchmark button allows analysis input", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    w.vm.benchmarkTitle = "My Article";
    w.vm.doBenchmark();
    expect(w.vm.benchmarkActiveTitle).toBe("My Article");
  });

  it("shows TrialBanner component", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    expect(w.findComponent({ name: "TrialBanner" }).exists()).toBe(true);
  });

  it("refresh button calls syncAll and updates data", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    const btn = w.find(".cohere-btn-secondary");
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    const { syncAll } = await import("@/api/publisher");
    expect(syncAll).toHaveBeenCalled();
  });

  it("handles syncCached failure gracefully", async () => {
    window.electronAPI.syncCached = vi.fn().mockRejectedValue(new Error("Network error"));
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(warnSpy).toHaveBeenCalledWith("Load cached failed:", "Network error");
    warnSpy.mockRestore();
  });

  it("shows trend chart when stats daily data is available", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(w.text()).toContain("发布趋势");
  });

  it("benchmark button disabled when input is empty", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    w.vm.benchmarkTitle = "";
    w.vm.doBenchmark();
    expect(w.vm.benchmarkActiveTitle).toBe("");
  });
});

// ─── 未登录门禁（auth-gate 范式，2026-09-15）────────────────────────
// dashboard:stats / history:list 要求登录；AUTH_REQUIRED 不得静默吞掉，
// 也不得与 ENTITLEMENT_REQUIRED（同为 code:-3）混淆。
describe("Dashboard 未登录门禁（auth-gate 范式）", () => {
  const AUTH_GATE = { code: -3, errorCode: "AUTH_REQUIRED", message: "请先登录" };
  const ENTITLEMENT_GATE = { code: -3, errorCode: "ENTITLEMENT_REQUIRED", message: "无权益" };

  beforeEach(() => {
    vi.clearAllMocks();
    identityAuthenticatedRef.value = false;
    window.electronAPI = {
      dashboardStats: vi.fn().mockResolvedValue({ code: 0, data: { total: 3, success: 2, failed: 1, daily: [] } }),
      historyList: vi.fn().mockResolvedValue({ code: 0, data: { total: 0, records: [] } }),
      syncCached: vi.fn().mockResolvedValue({ code: 0, data: [] }),
    };
  });

  function mountGate () {
    return mount(DashboardView, { global: { plugins: [i18n] } });
  }

  async function settle (w) {
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    return w;
  }

  it("已登录（正常返回）不显示登录引导", async () => {
    const w = await settle(mountGate());
    expect(w.find('[data-testid="dashboard-login-gate"]').exists()).toBe(false);
    expect(w.text()).not.toContain("登录后可查看发布统计");
    w.unmount();
  });

  it("未登录被门禁拒绝时显示登录引导而非静默空数据", async () => {
    window.electronAPI.dashboardStats = vi.fn().mockResolvedValue(AUTH_GATE);
    window.electronAPI.historyList = vi.fn().mockResolvedValue(AUTH_GATE);
    const w = await settle(mountGate());
    expect(w.find('[data-testid="dashboard-login-gate"]').exists()).toBe(true);
    expect(w.text()).toContain("登录后可查看发布统计与最近发布。");
    expect(w.get('[data-testid="dashboard-sign-in"]').text()).toBe("去登录");
    w.unmount();
  });

  it("点击去登录触发 identity.signIn，登录成功后自动重载统计数据", async () => {
    window.electronAPI.dashboardStats = vi.fn().mockResolvedValueOnce(AUTH_GATE);
    window.electronAPI.historyList = vi.fn().mockResolvedValueOnce(AUTH_GATE);
    const w = await settle(mountGate());
    expect(w.find('[data-testid="dashboard-login-gate"]').exists()).toBe(true);

    await w.get('[data-testid="dashboard-sign-in"]').trigger("click");
    expect(identitySignInMock).toHaveBeenCalledTimes(1);

    identityAuthenticatedRef.value = true;
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    await new Promise(r => setTimeout(r, 10));
    await nextTick();
    expect(window.electronAPI.dashboardStats).toHaveBeenCalledTimes(2);
    expect(window.electronAPI.historyList).toHaveBeenCalledTimes(2);
    expect(w.find('[data-testid="dashboard-login-gate"]').exists()).toBe(false);
    w.unmount();
  });

  it("权益不足（ENTITLEMENT_REQUIRED）不误判为登录门禁，保持既有静默/错误路径", async () => {
    window.electronAPI.dashboardStats = vi.fn().mockResolvedValue(ENTITLEMENT_GATE);
    const w = await settle(mountGate());
    expect(w.find('[data-testid="dashboard-login-gate"]').exists()).toBe(false);
    expect(identitySignInMock).not.toHaveBeenCalled();
    w.unmount();
  });
});
