import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { mount } from "@vue/test-utils";
import { nextTick } from "vue";
import { setActivePinia, createPinia } from "pinia";
import fs from "node:fs";
import path from "node:path";

/** 出口链的顺序取证：`finishAndGo` 的契约是"先落标记、后导航"，
 *  只断言"标记调用过 1 次"证不出顺序（反序也满足那条断言）。 */
const { navOrder, navState } = vi.hoisted(() => ({ navOrder: [], navState: { fail: false } }));

vi.mock("vue-router", () => ({
  // FirstRun.vue 用 useRouter() 取导航器。不 stub 时它是 undefined，出口那句
  // `router.push(path)` 抛错并以 Unhandled Rejection 逃逸——四条断言全绿，
  // 只有全域跑的 `Errors` 行看得见（本仓同款坑第二次，见 learnings/记忆）。
  useRouter: () => ({
    push: (path) => {
      navOrder.push('push:' + path)
      return navState.fail ? Promise.reject(new Error('navigation guard rejected')) : Promise.resolve()
    },
  }),
}));

vi.mock("@/stores/license", () => ({
  useLicenseStore: () => ({ isPro: true })
}));

vi.mock("@/api/publisher", () => ({
  onFirstRunStatus: vi.fn(() => vi.fn()),
  firstRunCheck: vi.fn().mockResolvedValue({ code: 0, data: { setupDone: false } }),
  // ux-audit-first-run-launch：向导出口必须能落首启标记；抛错档留给"不产生未处理 rejection"那条用例
  firstRunComplete: vi.fn(async () => { navOrder.push("complete"); return { code: 0, data: { setupDone: true } }; }),
  authOpenLogin: vi.fn(),
  accountAdd: vi.fn(),
}));

import FirstRunView from "./FirstRun.vue";
import { authOpenLogin, accountAdd, firstRunComplete, firstRunCheck, onFirstRunStatus } from "@/api/publisher";
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
    navOrder.length = 0;
    navState.fail = false;
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
    navOrder.length = 0;
    navState.fail = false;
    setActivePinia(createPinia());
    window.electronAPI = {};
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

  // ─── ux-audit-first-run-launch：首启向导的启动判定与出口契约 ───
  // 被删掉的 5 条用例守护的是「主进程推送 type:done 就把两项依赖点亮 ✅」，
  // 而 P2-E 之后主进程什么都不检测 —— 那是在把假证据钉成契约（AGENTS「测试断言不得反向固化错误行为」）。
  // 下面 10 条守护新契约：不显示未跑过的检测、步骤不被假状态锁死、出口必须落标记。

  it("向导不再显示任何从未跑过的检测结论", async () => {
    const w = createView();
    await nextTick();
    const html = w.html();
    expect(html).not.toContain("Python 依赖");
    expect(html).not.toContain("Playwright 浏览器");
    expect(html).not.toContain("自动安装");
  });

  it("主进程推送 done 也不得点亮任何检测状态（订阅已整条撤下）", async () => {
    const w = createView();
    await nextTick();
    expect(onFirstRunStatus).not.toHaveBeenCalled();
    expect(w.html()).not.toContain("环境检测");
  });

  it("步骤①始终可前进：不依赖任何 allDepsDone 之类的假门槛", async () => {
    const w = createView();
    await nextTick();
    w.vm.currentStep = 1;
    await nextTick();
    const btn = w.find('.fr-step-actions .cohere-btn-primary');
    expect(btn.exists()).toBe(true);
    await btn.trigger("click");
    expect(w.vm.currentStep).toBe(2);
  });

  it("点「开始发布」必须先落首启标记再导航", async () => {
    const w = createView();
    await nextTick();
    w.vm.currentStep = 3;
    await nextTick();
    await w.find('[data-testid="first-run-exit-publish"]').trigger("click");
    await new Promise(r => setTimeout(r, 0));
    expect(firstRunComplete).toHaveBeenCalledTimes(1);
    // 顺序契约：先落标记、后导航（只断"调用过一次"对反序完全免疫）
    expect(navOrder).toEqual(["complete", "push:/publish"]);
  });

  it("标记写失败（code!==0）仍放用户离开，并给出可归因提示", async () => {
    firstRunComplete.mockResolvedValueOnce({ code: -1, message: "EROFS" });
    const w = createView();
    await nextTick();
    w.vm.currentStep = 3;
    await nextTick();
    await w.find('[data-testid="first-run-exit-publish"]').trigger("click");
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.html()).toContain("首启状态未能保存");
    expect(w.vm.finishing).toBe(false);
    expect(navOrder.filter((x) => x.startsWith("push:"))).toEqual(["push:/publish"]);
  });

  it("标记写抛错不得变成未处理 rejection，也不得把人困在向导里", async () => {
    firstRunComplete.mockRejectedValueOnce(new Error("bridge gone"));
    const w = createView();
    await nextTick();
    w.vm.currentStep = 3;
    await nextTick();
    await expect(w.find('[data-testid="first-run-exit-publish"]').trigger("click")).resolves.not.toThrow();
    await new Promise(r => setTimeout(r, 0));
    await nextTick();
    expect(w.html()).toContain("首启状态未能保存");
    expect(navOrder.filter((x) => x.startsWith("push:"))).toEqual(["push:/publish"]);
  });


  it('导航被守卫拒绝时不得逃逸成未处理 rejection，且必须出声', async () => {
    // QM-6 i3：`router.push` 原先在 try/finally 之外 —— 与 finishAndGo 自己的注释第 3 条
    // （"异常必须自己收口：浮出去的 promise 会变成 Unhandled Rejection"）直接矛盾。
    // 这里让 stub 的 push 拒绝，断言：出口仍先落了标记、错误被收口并 console.warn 出声。
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    navState.fail = true
    const w = createView()
    await nextTick()
    w.vm.currentStep = 3
    await nextTick()
    await expect(
      w.find('[data-testid="first-run-exit-publish"]').trigger('click'),
    ).resolves.not.toThrow()
    await new Promise((r) => setTimeout(r, 0))
    expect(firstRunComplete).toHaveBeenCalledTimes(1)
    expect(navOrder).toEqual(['complete', 'push:/publish'])
    expect(warnSpy.mock.calls.some((c) => String(c[0]).includes('navigation after wizard exit failed')))
      .toBe(true)
    warnSpy.mockRestore()
  })

  it('出口按钮在落标记期间必须禁用（它与 finishAndGo 里的闩是两道独立的闸）', () => {
    // 反证逼出来的这条（F8 首跑 MISSED）：把 finishAndGo 的 `if (finishing.value) return` 摘掉后，
    // 「重复点击只落一次标记」仍然绿 —— 因为按钮上的 `:disabled="finishing"` 才是那条用例真正测到的闸。
    // 这说明闩不是多余的（它守非点击入口：键盘触发、程序化调用、disabled 被样式覆盖的宿主），
    // 但也说明**闩自己没有被任何锁守着**。所以这里按源码形状把 disabled 这一道钉住，
    // 驱动则改成「两道一起摘」才要求行为变红，另加 F9 只摘 disabled 来验这道新锁有牙。
    const src = fs.readFileSync(path.resolve(__dirname, 'FirstRun.vue'), 'utf8')
    for (const testid of ['first-run-exit-publish', 'first-run-exit-accounts']) {
      const line = src.split(/\r?\n/).find((l) => l.includes('data-testid="' + testid + '"'))
      expect(line, `出口按钮 ${testid} 必须存在`).toBeDefined()
      expect(line, `${testid} 必须在 finishing 期间禁用；否则连点会写两次标记、发两次导航`)
        .toMatch(/:disabled="finishing"/)
    }
  })
  it("重复点击出口只落一次标记（finishing 闩）", async () => {
    let release
    firstRunComplete.mockImplementationOnce(() => new Promise(resolve => { release = resolve }))
    const w = createView();
    await nextTick();
    w.vm.currentStep = 3;
    await nextTick();
    const btn = w.find('[data-testid="first-run-exit-publish"]')
    await btn.trigger("click");
    await btn.trigger("click");
    expect(firstRunComplete).toHaveBeenCalledTimes(1);
    release({ code: 0, data: { setupDone: true } });
    await new Promise(r => setTimeout(r, 0));
    expect(navOrder.filter((x) => x.startsWith("push:"))).toEqual(["push:/publish"]);
  });

  it("首启完成的唯一入口是向导出口：视图自己不再调用只读的 firstRunCheck 充当检测", async () => {
    firstRunCheck.mockClear();
    const w = createView();
    await nextTick();
    expect(firstRunCheck).not.toHaveBeenCalled();
  });
});

