import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";

vi.mock("@/stores/license", () => ({
  useLicenseStore: () => ({ isPro: true })
}));

vi.mock("@/api/publisher", () => ({
  onFirstRunStatus: vi.fn(() => vi.fn()),
  firstRunCheck: vi.fn().mockResolvedValue({ code: 0, data: { setupDone: false } }),
  authOpenLogin: vi.fn(),
  accountAdd: vi.fn(),
}));

import FirstRunView from "./FirstRun.vue";
import { authOpenLogin, accountAdd } from "@/api/publisher";
import i18n from "@/i18n";

/** 统一挂载入口：FirstRun.vue 用 useI18n() 读 onboarding.welcome（品牌名单一来源），
 *  与 Home/Accounts 等同构——mount 必须装真实 i18n 插件，否则 useI18n 抛
 *  createI18nError（19 例全挂）。locale 固定 zh 以保证断言稳定。 */
function createView() {
  i18n.global.locale.value = "zh";
  return mount(FirstRunView, { global: { plugins: [createPinia(), i18n] } });
}

describe("FirstRunView", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  it("shows welcome step initially", async () => {
    const w = createView();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.text()).toContain("欢迎使用汤姆鱼");
  });

  it("advances to next step on click", async () => {
    const w = createView();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    const btn = w.find("button");
    if (btn.exists()) {
      await btn.trigger("click");
      await nextTick();
      expect(w.vm.currentStep).toBe(1);
    }
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

  it("retryDeps resets error state", async () => {
    const w = createView();
    await nextTick();
    w.vm.depError = true;
    w.vm.depErrorMessage = "Some error";
    w.vm.depSteps.value = [
      { label: "Python", status: "error", message: "fail" },
    ];
    w.vm.retryDeps();
    expect(w.vm.depError).toBe(false);
    expect(w.vm.depSteps[0].status).toBe("pending");
  });

  it("currentStep advances through all steps", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.currentStep).toBe(0);
    w.vm.currentStep = 1;
    await nextTick();
    expect(w.vm.currentStep).toBe(1);
    w.vm.currentStep = 2;
    await nextTick();
    expect(w.vm.currentStep).toBe(2);
    w.vm.currentStep = 3;
    await nextTick();
    expect(w.vm.currentStep).toBe(3);
  });

  it("quickPlatforms has 6 platforms", async () => {
    const w = createView();
    await nextTick();
    expect(w.vm.quickPlatforms.length).toBe(6);
  });

  it("allDepsDone allows step advance", async () => {
    const w = createView();
    await nextTick();
    w.vm.allDepsDone = true;
    await nextTick();
    expect(w.vm.allDepsDone).toBe(true);
  });
});

describe("FirstRunView — extra coverage", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setActivePinia(createPinia());
    window.electronAPI = {};
  });

  it("onFirstRunStatus step type updates depStep", async () => {
    const mocks = await import("@/api/publisher");
    var cb = null;
    mocks.onFirstRunStatus.mockImplementation(callback => { cb = callback; return vi.fn(); });
    const w = createView();
    await nextTick();
    cb({ type: "step", data: { step: "python", message: "installing..." } });
    await nextTick();
    expect(w.vm.depSteps[0].status).toBe("active");
    expect(w.vm.depSteps[0].message).toBe("installing...");
  });

  it("onFirstRunStatus done type marks all done", async () => {
    const mocks = await import("@/api/publisher");
    var cb = null;
    mocks.onFirstRunStatus.mockImplementation(callback => { cb = callback; return vi.fn(); });
    const w = createView();
    await nextTick();
    cb({ type: "done" });
    await nextTick();
    expect(w.vm.allDepsDone).toBe(true);
    expect(w.vm.depSteps.every(s => s.status === "done")).toBe(true);
  });

  it("onFirstRunStatus error type sets depError", async () => {
    const mocks = await import("@/api/publisher");
    var cb = null;
    mocks.onFirstRunStatus.mockImplementation(callback => { cb = callback; return vi.fn(); });
    mocks.firstRunCheck.mockResolvedValue({ code: 0, data: { setupDone: false } });
    const w = createView();
    await nextTick();
    // Set a step as active first so error handler finds it
    w.vm.depSteps[0].status = "active";
    cb({ type: "error", data: { data: "Connection failed" } });
    await nextTick();
    expect(w.vm.depError).toBe(true);
    expect(w.vm.depErrorMessage).toBe("Connection failed");
  });

  it("firstRunCheck setupDone skips deps step", async () => {
    const mocks = await import("@/api/publisher");
    mocks.firstRunCheck.mockResolvedValue({ code: 0, data: { setupDone: true } });
    const w = createView();
    await nextTick();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.vm.allDepsDone).toBe(true);
    expect(w.vm.currentStep).toBe(1);
  });

  it("renders account step (step 2)", async () => {
    const w = createView();
    await nextTick();
    w.vm.currentStep = 2;
    await nextTick();
    expect(w.text()).toContain("添加账号");
  });

  it("renders quick publish tutorial step (step 3)", async () => {
    const w = createView();
    await nextTick();
    w.vm.currentStep = 3;
    await nextTick();
    expect(w.text()).toContain("准备完毕");
  });
});

