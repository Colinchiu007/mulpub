import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick, ref } from "vue";
import { setActivePinia, createPinia } from "pinia";
import fs from "node:fs";
import path from "node:path";
import i18n from "@/i18n";

vi.mock("@/stores/platforms", () => ({
  usePlatformStore: () => ({
    load: vi.fn(),
    getLabel: (k) => ({ wechat_mp: "微信", zhihu: "知乎" }[k] || k),
    getIcon: (k) => "📱",
  })
}));

// 三个新区块的 API（dash-full-entitlement）。用 vi.hoisted 声明，
// 才能被上面的 vi.mock 工厂引用（vi.mock 会被提升到文件顶部提升执行）。
const newPanelApis = vi.hoisted(() => ({
  accountBatchCheckLogin: vi.fn(),
  getQueueStatus: vi.fn(),
  getQueueHistory: vi.fn(),
  listPatternPerformance: vi.fn(),
}));

vi.mock("@/api/publisher", () => ({
  syncAll: vi.fn().mockResolvedValue(undefined),
  syncPlatform: vi.fn(),
  accountBatchCheckLogin: newPanelApis.accountBatchCheckLogin,
  getQueueStatus: newPanelApis.getQueueStatus,
  getQueueHistory: newPanelApis.getQueueHistory,
}));

// 只覆盖题材榜这一个函数，**保留**模块其余导出 ——
// PerformanceFlowPanel 也要从这个模块取 performanceOverview，整模块替换会把它遮掉
// （实测症状：回流面板取数全部报 "No performanceOverview export is defined"）。
vi.mock("@/api/knowledge-library", async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, listPatternPerformance: newPanelApis.listPatternPerformance }
});

// 权益分级走 useIdentityStore（不是 useIdentity —— 后者不导出 entitlement）。
// 默认 null（未登录/未取到），个别用例覆写为含 dashboard_full 的快照。
const entitlementRef = ref(null);
vi.mock("@/stores/identity", () => ({
  useIdentityStore: () => ({ entitlement: entitlementRef.value }),
}));

// accountStore：提供账号 id 列表供批量检测
vi.mock("@/stores/accounts", () => ({
  useAccountStore: () => ({ accounts: [{ id: "acc-1" }, { id: "acc-2" }] }),
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
    // 默认未取到权益（null）→ 锁区块；需要完整看板的用例自行覆写
    entitlementRef.value = null;
    // 默认无数据，个别用例覆写
    newPanelApis.accountBatchCheckLogin.mockResolvedValue({ code: 0, data: [] });
    newPanelApis.getQueueStatus.mockResolvedValue({ code: 0, data: { running: 0, pending: 0 } });
    newPanelApis.getQueueHistory.mockResolvedValue({ code: 0, data: [] });
    newPanelApis.listPatternPerformance.mockResolvedValue({ code: 0, data: { items: [] } });
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

  // 2026-10-17（dash-full-entitlement，用户决策方案 C）：横幅**已撤下**。
  // 原断言「存在 TrialBanner」被反转，理由写在 Dashboard.vue 模板注释里：
  // 该横幅文案「当前为免费版，部分功能受限」在本页是误导 —— 本页三个数据源
  // 的门禁都是登录而非套餐，没有任何一项内容因套餐受限。
  // 套餐差异改由「锁区块占位」真实体现（见下方分级用例）。
  it("no longer shows TrialBanner（误导文案已撤下）", async () => {
    const w = mount(DashboardView, { global: { plugins: [createPinia(), i18n] } });
    await nextTick();
    expect(w.findComponent({ name: "TrialBanner" }).exists()).toBe(false);
    expect(w.find(".trial-banner").exists()).toBe(false);
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

/**
 * P2-6c 数据看板：作品互动回流面板接线 + 假数字撤除锁。
 *
 * 结构锁的存在理由：本页曾把 +8.5% / +23% / -2.1% / locale 里的「较上周 +12%」当数据展示。
 * 这些数字没有任何数据源（`sync:cached` 只留每平台一份最新值、没有时间序列），
 * 组件级断言只能证明「今天这几处删了」，证明不了「不会再写回去」，所以必须扫源码。
 */
describe("DashboardView 作品互动回流（P2-6c）", () => {
  function overviewPayload (overrides = {}) {
    return {
      code: 0,
      data: {
        hasData: true,
        windowDays: 30,
        totals: { views: 123, likes: 45, comments: 7, favorites: 3, shares: 1, interactions: 56 },
        trend: Array.from({ length: 30 }, (_, i) => ({
          date: "2026-10-" + String(i + 1).padStart(2, "0"),
          views: 0, likes: 0, comments: 0, favorites: 0, shares: 0, interactions: 0,
        })),
        byPlatform: [{ platform: "zhihu", contents: 1, views: 123, likes: 45, comments: 7, favorites: 3, shares: 1, interactions: 56 }],
        health: {
          trackedTotal: 1, covered: 1, coverage: 100,
          byStatus: { pending: 0, ok: 1, failed: 0, unsupported: 0, untrackable: 0, manual: 0, other: 0 },
          lastCapturedAt: "2026-10-03T09:12:00.000Z", neverRecrawled: false,
        },
        weekChange: null,
        truncated: { tracked: false, snapshot: false },
        limits: { tracked: 2000, snapshot: 20000 },
        diagnostics: { orphanSnapshots: 0, orphanSnapshotsDb: 0, retreats: 0, invalidMetrics: 0, droppedUndated: 0, invalidTrackedRows: 0 },
        ...overrides,
      },
    }
  }

  // 这三条既有用例断言的是「回流面板渲染出真实数字」，而该面板自
  // dash-full-entitlement 起受 dashboard_full 门控，因此必须显式给一份
  // 含该 feature 的权益快照，否则渲染的是锁区块占位（下方另有分级用例覆盖）。
  // entitlement 按 plan-matrix.js 真源写（不沿用 e2e 里已漂移的旧键名）。
  function grantFullDashboard () {
    entitlementRef.value = {
      plan: "standard",
      features: ["cloud_publish", "ai_write", "video_create", "schedule_batch", "dashboard_full"],
      source: "online",
    }
  }

  async function settle (w) {
    for (let i = 0; i < 4; i++) {
      await nextTick()
      await new Promise(r => setTimeout(r, 5))
    }
    await nextTick()
    return w
  }

  function mountDashboard () {
    grantFullDashboard()
    setActivePinia(createPinia())
    window.electronAPI = {
      dashboardStats: vi.fn().mockResolvedValue({ code: 0, data: { total: 4, success: 3, failed: 1, successRate: 75, perPlatform: {}, daily: [] } }),
      historyList: vi.fn().mockResolvedValue({ code: 0, data: { records: [] } }),
      syncCached: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      syncAll: vi.fn().mockResolvedValue({ code: 0 }),
      performanceOverview: vi.fn().mockResolvedValue(overviewPayload()),
    }
    return mount(DashboardView, { global: { plugins: [createPinia(), i18n] } })
  }

  it("回流面板随页面挂载，并把 IPC 数字渲染出来（链未断的证据）", async () => {
    const w = await settle(mountDashboard())
    expect(window.electronAPI.performanceOverview).toHaveBeenCalled()
    expect(w.find('[data-testid="perf-flow-panel"]').exists()).toBe(true)
    expect(w.get('[data-testid="perf-metric-views"]').text()).toBe("123")
    expect(w.get('[data-testid="perf-metric-likes"]').text()).toBe("45")
    w.unmount()
  })

  it("未登录时面板显示登录引导，而不是渲染一排 0", async () => {
    grantFullDashboard()
    setActivePinia(createPinia())
    window.electronAPI = {
      dashboardStats: vi.fn().mockResolvedValue({ code: -3, errorCode: "AUTH_REQUIRED" }),
      historyList: vi.fn().mockResolvedValue({ code: -3, errorCode: "AUTH_REQUIRED" }),
      syncCached: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      syncAll: vi.fn().mockResolvedValue({ code: 0 }),
      performanceOverview: vi.fn().mockResolvedValue({ code: -3, errorCode: "AUTH_REQUIRED" }),
    }
    const w = await settle(mount(DashboardView, { global: { plugins: [createPinia(), i18n] } }))
    expect(w.get('[data-testid="perf-flow-auth"]').text()).toBe(i18n.global.t("dashboard.metrics.loginRequired"))
    expect(w.find('[data-testid="perf-flow-metrics"]').exists()).toBe(false)
    w.unmount()
  })

  it("页面刷新按钮带动面板重新取数（一个刷新入口，两套数字）", async () => {
    const w = await settle(mountDashboard())
    const before = window.electronAPI.performanceOverview.mock.calls.length
    await w.get('[data-testid="dashboard-refresh-btn"]').trigger("click")
    await settle(w)
    expect(window.electronAPI.performanceOverview.mock.calls.length).toBeGreaterThan(before)
    w.unmount()
  })

  it("模板里不得再出现「±数字%」这类无数据源的变化量，且测量域非空（防自锁失明）", () => {
    const src = fs.readFileSync(path.resolve(__dirname, "Dashboard.vue"), "utf8")
    const template = src.slice(src.indexOf("<template>"), src.indexOf("</template>"))
    // 反失明：测量域本身必须有内容，否则"0 命中"可能只是解析退化成了空串
    expect(template.length).toBeGreaterThan(2000)
    expect((src.match(/stat-value/g) || []).length).toBeGreaterThanOrEqual(6)
    const fabricated = template.match(/[+\u2212-]\d+(?:\.\d+)?%/g) || []
    expect(fabricated, "假百分比字面量: " + fabricated.join(", ")).toEqual([])
    expect(src).not.toContain("dashboard.weekChange")
    expect(src).not.toContain("stat-change")
  })

  it("回流面板的文案全部走 locale（zh/en 成对），模板除注释外不得有中文", () => {
    const panel = fs.readFileSync(path.resolve(__dirname, "../features/dashboard/PerformanceFlowPanel.vue"), "utf8")
    expect(panel.length).toBeGreaterThan(1000)
    const template = panel.slice(0, panel.indexOf("<script"))
    expect(template.length).toBeGreaterThan(500)
    // HTML 注释不渲染（本仓 .vue 模板普遍带中文注释），判据只针对会进包体的字面量
    const visible = template.replace(/<!--[\s\S]*?-->/g, "")
    expect(visible.match(/[\u4e00-\u9fa5]/g) || [], "模板内残留中文字面量").toEqual([])
    for (const key of ["title", "views", "likes", "comments", "favorites", "shares", "trendTitle", "platformTitle", "healthTitle", "loginRequired", "emptyTitle"]) {
      expect(i18n.global.te("dashboard.metrics." + key), "缺键 dashboard.metrics." + key).toBe(true)
    }
  })
})

// ──────────────────────────────────────────────────────────────────────
// 套餐分级（dash-full-entitlement）验收用例，对应 PRD §八 验收标准
// ──────────────────────────────────────────────────────────────────────
describe("DashboardView 套餐分级（dash-full-entitlement）", () => {
  const FREE = { plan: "free", features: ["cloud_publish", "ai_write"], source: "online" }
  // standard 不是 pro，但**有** dashboard_full —— 这条正是防 isPro 二值误判的用例
  const STANDARD = { plan: "standard", features: ["cloud_publish", "ai_write", "dashboard_full"], source: "online" }

  function baseElectronApi (overrides = {}) {
    return {
      dashboardStats: vi.fn().mockResolvedValue({
        code: 0,
        data: { total: 4, success: 3, failed: 1, successRate: 75, perPlatform: { wechat_mp: { total: 4 } }, daily: [{ date: "2026-10-01", total: 2 }] },
      }),
      historyList: vi.fn().mockResolvedValue({ code: 0, data: { records: [] } }),
      syncCached: vi.fn().mockResolvedValue({ code: 0, data: [] }),
      syncAll: vi.fn().mockResolvedValue({ code: 0 }),
      performanceOverview: vi.fn().mockResolvedValue({ code: 0, data: { totals: {}, trend: [], byPlatform: [], health: { trackedTotal: 0, covered: 0, coverage: 0, byStatus: {}, lastCapturedAt: null } } }),
      ...overrides,
    }
  }

  async function settle (w) {
    for (let i = 0; i < 4; i++) {
      await nextTick()
      await new Promise(r => setTimeout(r, 5))
    }
    await nextTick()
    return w
  }

  function mountWith (entitlement) {
    // 必须在此清空计数：外层 beforeEach 的 clearAllMocks 属于另一个 describe，
    // 而本块的用例各自断言调用次数，跨用例累积会让"零调用"恒假（实测 5 次）。
    vi.clearAllMocks()
    entitlementRef.value = entitlement
    setActivePinia(createPinia())
    window.electronAPI = baseElectronApi()
    return mount(DashboardView, { global: { plugins: [createPinia(), i18n] } })
  }

  // 验收 2：free → 四个锁区块占位 + 升级 CTA
  it("free 档：四个锁区块渲染占位，且不渲染真实内容", async () => {
    const w = await settle(mountWith(FREE))
    for (const name of ["trend", "platform", "perf", "pattern"]) {
      expect(w.find(`[data-testid="dashboard-locked-${name}"]`).exists(), `缺锁区块 ${name}`).toBe(true)
    }
    expect(w.find('[data-testid="perf-flow-panel"]').exists()).toBe(false)
    expect(w.text()).toContain(i18n.global.t("dashboard.lockedCta"))
    w.unmount()
  })

  // 验收 3：full → 锁区块消失，真实面板渲染
  it("full 档：锁区块消失，回流面板真实渲染", async () => {
    const w = await settle(mountWith(STANDARD))
    for (const name of ["trend", "platform", "perf", "pattern"]) {
      expect(w.find(`[data-testid="dashboard-locked-${name}"]`).exists(), `锁区块未消失 ${name}`).toBe(false)
    }
    expect(w.find('[data-testid="perf-flow-panel"]').exists()).toBe(true)
    w.unmount()
  })

  // 验收 5：standard 不得被误判为 free（licenseStore.isPro 二值陷阱的回归）
  it("standard 档（非 pro）不被误判为免费", async () => {
    const w = await settle(mountWith(STANDARD))
    expect(w.find('[data-testid="dashboard-locked-trend"]').exists()).toBe(false)
    w.unmount()
  })

  // 验收 4：entitlement 为 null（未登录/未取到）不崩，降级为 basic
  it("entitlement 为 null 时不崩，降级 basic", async () => {
    const w = await settle(mountWith(null))
    expect(w.find('[data-testid="dashboard-locked-trend"]').exists()).toBe(true)
    expect(w.text()).toContain("数据看板")
    w.unmount()
  })

  // 验收 10：未解锁时题材榜**根本不发请求**（PRD §3.2.1）
  it("未解锁时题材榜 IPC 零调用", async () => {
    const w = await settle(mountWith(FREE))
    expect(newPanelApis.listPatternPerformance).not.toHaveBeenCalled()
    w.unmount()
  })

  // 反向：解锁后才发请求
  it("解锁后题材榜发起一次请求", async () => {
    const w = await settle(mountWith(STANDARD))
    expect(newPanelApis.listPatternPerformance).toHaveBeenCalled()
    w.unmount()
  })

  // 验收 6：三新区块 ready 态渲染真实数字
  it("三新区块 ready 态渲染真实数字", async () => {
    newPanelApis.accountBatchCheckLogin.mockResolvedValue({
      code: 0,
      data: [{ accountId: "acc-1", status: "ok" }, { accountId: "acc-2", status: "failed" }],
    })
    newPanelApis.getQueueStatus.mockResolvedValue({ code: 0, data: { running: 1, pending: 2 } })
    newPanelApis.getQueueHistory.mockResolvedValue({ code: 0, data: [{ id: 1, status: "failed", title: "崩了的一篇" }] })
    newPanelApis.listPatternPerformance.mockResolvedValue({ code: 0, data: { items: [{ value: "悬念开头", engagement_score: 88 }] } })
    const w = await settle(mountWith(STANDARD))
    expect(w.find('[data-testid="dashboard-account-health"]').exists()).toBe(true)
    expect(w.find('[data-testid="dashboard-queue-status"]').exists()).toBe(true)
    expect(w.text()).toContain("崩了的一篇")
    expect(w.text()).toContain("悬念开头")
    w.unmount()
  })

  // 验收 6：错误态不得渲染成 0（否则用户读成"全都正常"）
  it("账号健康度取数失败显示失败文案，不渲染成全正常", async () => {
    newPanelApis.accountBatchCheckLogin.mockResolvedValue({ code: -1, message: "boom" })
    const w = await settle(mountWith(FREE))
    expect(w.find('[data-testid="account-health-error"]').exists()).toBe(true)
    expect(w.find('[data-testid="account-health-error"]').text()).toBe(i18n.global.t("dashboard.accountHealthLoadFailed"))
    w.unmount()
  })

  // 未登录门禁不得渲染成 0
  it("账号健康度未登录显示登录引导，不显示计数", async () => {
    newPanelApis.accountBatchCheckLogin.mockResolvedValue({ code: -3, errorCode: "AUTH_REQUIRED" })
    const w = await settle(mountWith(FREE))
    expect(w.find('[data-testid="account-health-auth"]').exists()).toBe(true)
    w.unmount()
  })

  // 新增文案键必须在 zh/en 都成对存在（CI Gate 7 --keys 的前端侧）
  it("新增文案键 zh/en 成对存在", () => {
    for (const key of [
      "lockedCta", "accountHealthTitle", "accountHealthEmpty", "accountHealthMore", "accountHealthLoadFailed",
      "queueTitle", "queueEmpty", "queueLoadFailed", "patternTitle", "patternEmpty", "patternLoadFailed",
    ]) {
      expect(i18n.global.te("dashboard." + key), "缺键 dashboard." + key).toBe(true)
    }
  })
})
