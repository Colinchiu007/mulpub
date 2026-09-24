import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

describe("http-login-checker fetchAccountInfoViaHttpApi", () => {
  let checker;
  beforeEach(async () => {
    vi.resetModules();
    global.__enableElectronMock();
    global.__resetElectronMock();
    __registerMock("./logger", { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() });
    checker = await import("./http-login-checker.js");
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("未注册平台（kuaishou 需签名，未接 API）返回 supported:false", async () => {
    expect(
      await checker.fetchAccountInfoViaHttpApi("kuaishou", [{ name: "a", value: "b" }]),
    ).toEqual({ supported: false });
  });
  it("无 cookie 返回 supported:true 无字段（不发请求）", async () => {
    expect(await checker.fetchAccountInfoViaHttpApi("douyin", [])).toEqual({ supported: true });
  });
  it("douyin 提取昵称与平台ID（无粉丝字段则省略键）", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: () => Promise.resolve({ status_code: 0, data: { uid: "u1", nickname: "抖昵称" } }),
        }),
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("douyin", [{ name: "sessionid", value: "x" }]),
    ).toEqual({ supported: true, nickname: "抖昵称", platformAccountId: "u1" });
  });
  it("tencent_video 提取昵称与粉丝 fansCount（对齐蚁小二 finderUser）", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              errCode: 0,
              data: { finderUser: { uniqId: "wx1", nickname: "视昵称", fansCount: 12345 } },
            }),
        }),
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("tencent_video", [{ name: "x", value: "y" }]),
    ).toEqual({ supported: true, nickname: "视昵称", followers: 12345, platformAccountId: "wx1" });
  });
  it("toutiao 从 data.user 提取昵称与粉丝", async () => {
    vi.stubGlobal(
      "fetch",
      vi
        .fn()
        .mockResolvedValue({
          ok: true,
          status: 200,
          json: () =>
            Promise.resolve({
              code: 0,
              data: { user: { id: "t1", name: "条昵称", fans_count: 66 } },
            }),
        }),
    );
    expect(
      await checker.fetchAccountInfoViaHttpApi("toutiao", [{ name: "x", value: "y" }]),
    ).toEqual({ supported: true, nickname: "条昵称", followers: 66, platformAccountId: "t1" });
  });
  it("bilibili 缺 bili_jct 时 precheck 拦截、不发请求", async () => {
    const f = vi.fn();
    vi.stubGlobal("fetch", f);
    expect(
      await checker.fetchAccountInfoViaHttpApi("bilibili", [{ name: "SESSDATA", value: "x" }]),
    ).toEqual({ supported: true });
    expect(f).not.toHaveBeenCalled();
  });
});
