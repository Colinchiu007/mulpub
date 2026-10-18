import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/stores/license", () => ({
  useLicenseStore: () => ({ isPro: true })
}));

const routerPush = vi.fn();
vi.mock("vue-router", async (importOriginal) => ({
  ...(await importOriginal()),
  useRouter: () => ({ push: routerPush }),
}));

vi.mock("@/api/publisher", () => ({
  firstRunComplete: vi.fn(),
  authOpenLogin: vi.fn(),
  accountAdd: vi.fn(),
}));

import FirstRunView from "./FirstRun.vue";
import { authOpenLogin, accountAdd, firstRunComplete } from "@/api/publisher";
import i18n from "@/i18n";

/** 统一挂载入口：FirstRun.vue 用 useI18n() 读 onboarding.*（品牌名单一来源），
 *  与 Home/Accounts 等同构——mount 必须装真实 i18n 插件，否则 useI18n 抛
 *  createI18nError。locale 固定 zh 以保证断言稳定。 */
function createView() {
  i18n.global.locale.value = "zh";
  return mount(FirstRunView, { global: { plugins: [createPinia(), i18n] } });
}

/** 走完「欢迎 → 添加账号」：欢迎页唯一的按钮就是「开始配置」 */
async function toAccountStep() {
  const w = createView();
  await nextTick();
  await w.get("button").trigger("click");
  await nextTick();
  return w;
}

async function toTutorialStep() {
  const w = createView();
  await nextTick();
  w.vm.currentStep = 2;
  await nextTick();
  return w;
}

function ackOk() {
  firstRunComplete.mockResolvedValue({ code: 0, data: { setupDone: true } });
}

describe("FirstRunView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
    ackOk();
  });

  it("shows welcome step initially", async () => {
    const w = createView();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.text()).toContain("欢迎使用汤姆鱼");
  });

  it("欢迎页只列两步：不再声称会自动安装 Python/Playwright（P2-E 已移除该检查）", async () => {
    const w = createView();
    await nextTick();
    const text = w.text();
    expect(text).toContain("添加账号");
    expect(text).toContain("发布内容");
    expect(text).not.toContain("环境检测");
    expect(text).not.toContain("Playwright");
    expect(w.findAll(".fr-step-item")).toHaveLength(2);
  });

  it("advances to next step on click", async () => {
    const w = await toAccountStep();
    expect(w.vm.currentStep).toBe(1);
  });

  it("notify shows notification and auto-hides", async () => {
    vi.useFakeTimers();
    const w = createView();
    await nextTick();
    w.vm.notify("Test message", "success");
    expect(w.vm.showNotification).toBe(true);
    expect(w.vm.notificationMsg).toBe("Test message");
    expect(w.vm.notificationType).toBe("success");
    vi.advanceTimersByTime(3000);
    expect(w.vm.showNotification).toBe(false);
    vi.useRealTimers();
  });

  it("notify defaults to success type", async () => {
    vi.useFakeTimers();
    const w = createView();
    await nextTick();
    w.vm.notify("Hello");
    expect(w.vm.notificationType).toBe("success");
    vi.useRealTimers();
  });

  it("addAccount opens auth login via electronAPI", async () => {
    // window.electronAPI.authOpenLogin 存在 → 走 if 分支调 import 的 authOpenLogin
    window.electronAPI.authOpenLogin = vi.fn();
    vi.mocked(authOpenLogin).mockResolvedValue({ code: 0 });
    const w = createView();
    await nextTick();
    await w.vm.addAccount("douyin");
    expect(authOpenLogin).toHaveBeenCalledWith("douyin");
    expect(w.vm.addingPlatform).toBe("");
  });

  it("addAccount handles authOpenLogin error", async () => {
    window.electronAPI.authOpenLogin = vi.fn();
    vi.mocked(authOpenLogin).mockResolvedValue({ code: 1, message: "login failed" });
    const spy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = createView();
    await nextTick();
    await w.vm.addAccount("douyin");
    expect(spy).toHaveBeenCalledWith("login failed");
    spy.mockRestore();
  });

  it("addAccount silently returns when login cancelled", async () => {
    window.electronAPI.authOpenLogin = vi.fn();
    vi.mocked(authOpenLogin).mockResolvedValue({ code: 0, cancelled: true });
    const spy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = createView();
    await nextTick();
    await w.vm.addAccount("douyin");
    expect(spy).not.toHaveBeenCalled();
    expect(w.vm.addingPlatform).toBe("");
    spy.mockRestore();
  });

  it("addAccount falls back to accountAdd when authOpenLogin missing", async () => {
    // window.electronAPI.authOpenLogin 不存在 → 走 else 分支调 import 的 accountAdd
    window.electronAPI.accountAdd = vi.fn();
    vi.mocked(accountAdd).mockResolvedValue({ code: 0 });
    const spy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = createView();
    await nextTick();
    await w.vm.addAccount("zhihu");
    expect(accountAdd).toHaveBeenCalledWith("zhihu");
    spy.mockRestore();
  });

  it("addAccount catches exception", async () => {
    window.electronAPI.authOpenLogin = vi.fn();
    vi.mocked(authOpenLogin).mockRejectedValue(new Error("network error"));
    const spy = vi.spyOn(window, "alert").mockImplementation(() => {});
    const w = createView();
    await nextTick();
    await w.vm.addAccount("douyin");
    expect(spy).toHaveBeenCalledWith("network error");
    spy.mockRestore();
  });

  it("引导收敛为三步，第 1 步必须有离开出口", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.currentStep).toBe(0);
    w.vm.currentStep = 1;
    await nextTick();
    // /first-run 是全屏路由（无侧栏无导航），没有出口就等于把人关在里面
    expect(w.find('[data-testid="fr-skip"]').exists()).toBe(true);
    w.vm.currentStep = 2;
    await nextTick();
    expect(w.text()).toContain("准备完毕");
  });

  it("quickPlatforms has 6 platforms", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.quickPlatforms.length).toBe(6);
  });

  // ─── 阶段 1.4：完成标记只由退出动作写（旧实现每次启动无条件写 ⇒ 向导永不可达）───
  it("退出向导会写完成标记并跳转", async () => {
    const w = await toTutorialStep();
    await w.get(".fr-final-actions .cohere-btn-primary").trigger("click");
    await nextTick();
    expect(firstRunComplete).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith("/publish");
  });

  it("写标记失败仍放行导航，但必须出声（不得静默把用户下次再拉回向导）", async () => {
    firstRunComplete.mockResolvedValue({ code: -1, message: "BRIDGE_UNAVAILABLE" });
    const w = await toTutorialStep();
    await w.get(".fr-final-actions .cohere-btn-primary").trigger("click");
    await nextTick();
    expect(routerPush).toHaveBeenCalledWith("/publish");
    expect(w.vm.showNotification).toBe(true);
    expect(w.vm.notificationType).toBe("error");
  });

  it("「跳过引导」同样记录完成状态", async () => {
    const w = await toAccountStep();
    await w.get('[data-testid="fr-skip"]').trigger("click");
    await nextTick();
    expect(firstRunComplete).toHaveBeenCalledTimes(1);
    expect(routerPush).toHaveBeenCalledWith("/");
  });
});

describe("FirstRunView — 步骤渲染", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
    ackOk();
  });

  it("renders account step (step 1)", async () => {
    const w = createView();
    await nextTick();
    w.vm.currentStep = 1;
    await nextTick();
    expect(w.text()).toContain("添加你的第一个账号");
  });

  it("renders quick publish tutorial step (step 2)", async () => {
    const w = createView();
    await nextTick();
    w.vm.currentStep = 2;
    await nextTick();
    expect(w.text()).toContain("准备完毕");
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });
});
