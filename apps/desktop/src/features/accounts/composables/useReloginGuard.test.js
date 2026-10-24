import { describe, it, expect, vi, beforeEach } from "vitest";
import { mount } from "@vue/test-utils";
import { defineComponent, h, ref } from "vue";
import i18n from "@/i18n";

vi.mock("element-plus", () => ({
  ElMessage: { success: vi.fn(), warning: vi.fn(), error: vi.fn(), info: vi.fn() },
  ElMessageBox: { confirm: vi.fn().mockResolvedValue(undefined) },
}));

// useAccountActions 从这个模块取全部发布侧 API，缺一个 import 就会炸 —— 这里给齐最小面
vi.mock("@/api/publisher", () => ({
  authOpenLogin: vi.fn().mockResolvedValue({ code: 0 }),
  authOpenQrCodeLogin: vi.fn().mockResolvedValue({ code: 0 }),
  authClose: vi.fn().mockResolvedValue({ code: 0 }),
  authQrCodeClose: vi.fn().mockResolvedValue({ code: 0 }),
  authCompleteLogin: vi.fn().mockResolvedValue({ code: 0, data: true }),
  accountCheckLogin: vi.fn().mockResolvedValue({ code: 0, data: { valid: true } }),
  accountDelete: vi.fn().mockResolvedValue({ code: 0 }),
  accountGetProxy: vi.fn().mockResolvedValue({ code: 0, data: {} }),
  accountSetProxy: vi.fn().mockResolvedValue({ code: 0 }),
}));

import { useReloginGuard } from "./useReloginGuard";
import { authOpenLogin } from "@/api/publisher";

/** 在真实 setup 上下文里跑 composable（useI18n 必须在 setup 内调用）。 */
function withSetup () {
  const pendingAuthAction = ref(null);
  const loginMode = ref(null);
  const checkedExpiredIds = ref(new Set());
  const platformLabel = (id) => ({ zhihu: "知乎", douyin: "抖音" }[id] || id);
  let guard = null;
  const wrapper = mount(
    defineComponent({
      setup () {
        guard = useReloginGuard({ pendingAuthAction, loginMode, checkedExpiredIds, platformLabel });
        return () => h("div");
      },
    }),
    { global: { plugins: [i18n] } },
  );
  return { guard, pendingAuthAction, loginMode, checkedExpiredIds, wrapper };
}

const onlineAccount = { id: "a1", platform: "zhihu", status: "active", account_name: "在线账号" };

describe("useReloginGuard — 重新登录守卫（2026-10-24）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // clearAllMocks 只清调用记录、**不清实现** ⇒ 上一条用例留下的
    // mockResolvedValue({cancelled:true}) 会漏到下一条（实测踩过：pendingAuthAction 断言读到 null）。
    // 默认实现必须每条用例重新钉一遍。
    authOpenLogin.mockResolvedValue({ code: 0 });
    i18n.global.locale.value = "zh";
  });

  it("非「已登录」态直接放行，不弹确认框", async () => {
    const { guard } = withSetup();
    const { ElMessageBox } = await import("element-plus");

    for (const status of ["expired", "unverified", "error", undefined]) {
      expect(await guard.confirmRelogin({ id: "a1", platform: "zhihu", status })).toBe(true);
    }
    expect(ElMessageBox.confirm).not.toHaveBeenCalled();
  });

  it("「已登录」态必须先确认，确认框带账号名、平台与最近检测时间", async () => {
    const { guard } = withSetup();
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue("confirm");

    const account = { ...onlineAccount, last_validated: "2026-10-20T08:00:00.000Z" };
    expect(await guard.confirmRelogin(account)).toBe(true);

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    const [message, title] = ElMessageBox.confirm.mock.calls[0];
    expect(title).toBe("重新登录");
    expect(message).toContain("在线账号");
    expect(message).toContain("知乎");
    expect(message).toContain("已登录");
    expect(message).toContain("覆盖");
    // 最近检测时间必须给出来 —— 「已登录」这条结论可能陈旧，用户自己判断它有多新
    expect(message).toMatch(/最近检测/);
  });

  it("没有检测记录时不输出「最近检测」段（不能编一个时间出来）", async () => {
    const { guard } = withSetup();
    const { ElMessageBox } = await import("element-plus");
    ElMessageBox.confirm.mockResolvedValue("confirm");

    await guard.confirmRelogin({ ...onlineAccount, last_validated: null });

    const message = ElMessageBox.confirm.mock.calls[0][0];
    expect(message).not.toContain("最近检测");
    expect(message).toContain("在线账号");
  });

  it("登录页被关闭（cancelled）⇒ 账号仍留在失效集合里（取消 ≠ 恢复登录）", async () => {
    const { guard, pendingAuthAction, checkedExpiredIds } = withSetup();
    const { ElMessageBox } = await import("element-plus");
    const { authOpenLogin } = await import("@/api/publisher");
    ElMessageBox.confirm.mockResolvedValue("confirm");
    authOpenLogin.mockResolvedValue({ code: 0, cancelled: true });
    checkedExpiredIds.value = new Set(["a1"]);

    await guard.reloginAccount({ id: "a1", platform: "zhihu", status: "expired" });

    // 失效态不弹确认，直接开登录页；用户随后关掉了登录页
    expect(ElMessageBox.confirm).not.toHaveBeenCalled();
    expect(authOpenLogin).toHaveBeenCalledWith("zhihu", "a1");
    expect(pendingAuthAction.value).toBeNull();
    // 账号**仍然失效** ⇒ 失效结论必须保留（删了就会带旧凭证进平台页，
    // 撞上 2026-09-16 公众号「二维码加载失败」事故路径）
    expect(checkedExpiredIds.value.has("a1")).toBe(true);
  });

  it("已登录态取消 ⇒ 不打开登录页、不改任何状态（含失效集合）", async () => {
    const { guard, pendingAuthAction, checkedExpiredIds } = withSetup();
    const { ElMessageBox } = await import("element-plus");
    const { authOpenLogin } = await import("@/api/publisher");
    ElMessageBox.confirm.mockRejectedValue("cancel");

    await guard.reloginAccount(onlineAccount);

    expect(ElMessageBox.confirm).toHaveBeenCalledTimes(1);
    expect(authOpenLogin).not.toHaveBeenCalled();
    expect(pendingAuthAction.value).toBeNull();
    expect(checkedExpiredIds.value.has("a1")).toBe(false);
  });

  it("确认后进入重新登录链路，等待登录完成事件", async () => {
    const { guard, pendingAuthAction, loginMode } = withSetup();
    const { ElMessageBox } = await import("element-plus");
    const { authOpenLogin } = await import("@/api/publisher");
    ElMessageBox.confirm.mockResolvedValue("confirm");

    await guard.reloginAccount(onlineAccount);

    expect(authOpenLogin).toHaveBeenCalledWith("zhihu", "a1");
    expect(pendingAuthAction.value).toBe("relogin");
    expect(loginMode.value).toBe("browser");
  });

  it("失效态直接进登录链路（没有可用会话要保护 ⇒ 不打扰）", async () => {
    const { guard, pendingAuthAction } = withSetup();
    const { ElMessageBox } = await import("element-plus");
    const { authOpenLogin } = await import("@/api/publisher");
    ElMessageBox.confirm.mockResolvedValue("confirm");

    await guard.reloginAccount({ id: "a1", platform: "zhihu", status: "expired" });

    expect(ElMessageBox.confirm).not.toHaveBeenCalled();
    expect(authOpenLogin).toHaveBeenCalledWith("zhihu", "a1");
    expect(pendingAuthAction.value).toBe("relogin");
  });

  it("平台缺失时直接返回，不发起任何登录请求", async () => {
    const { guard } = withSetup();
    const { authOpenLogin } = await import("@/api/publisher");

    await guard.reloginAccount({ id: "a1" });

    expect(authOpenLogin).not.toHaveBeenCalled();
  });
});
