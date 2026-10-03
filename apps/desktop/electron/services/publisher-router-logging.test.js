import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// Mock PlatformConfig（与回归套件一致的只读桩）
class MockPlatformConfig {
  getPlatform(p) {
    if (p === "unknown") return null;
    return { type: "video", publish_url: "https://example.com" };
  }
  listPlatforms() {
    return [{ id: "wechat_mp", name: "微信" }, { id: "bilibili", name: "B站" }];
  }
}

vi.mock("@multi-publish/shared-utils/src/platform-config", () => ({
  default: MockPlatformConfig,
}));

// findFfprobe 桩（避免真实 ffprobe 探测）
vi.mock("./media-tool-paths", () => ({
  findFfprobe: vi.fn(() => "ffprobe"),
}));

// 录制真实 logger.notify 调用（repo 约定：不 mock logger，使用真实模块 + spy）。
// publisher-router 通过 require('./logger').notify(...) 在调用点取属性，
// 因此对真实 logger 对象 spyOn 可拦截全部 notify 调用。
const realLogger = require("../services/logger");
const { PublisherRouter, ROUTE_TABLE } = require("../services/publisher-router");

// notify 录制器（由 beforeEach 注入 spy）
let notifySpy;

// 在 notify 调用中按 messageKey 查找调用
function findNotify(key) {
  return notifySpy.mock.calls.find((c) => c[1] === key);
}
function allNotifyKeys() {
  return notifySpy.mock.calls.map((c) => c[1]);
}

const store = {
  getAccount: vi.fn(() => null),
  getDefaultAccount: vi.fn(() => null),
};
const accountManager = {
  loadSavedCredentials: vi.fn(() => ({ platform: "x", cookies: [], localStorage: {} })),
};

describe("PublisherRouter 三条发布轨结构化生命周期日志（QM-3）", () => {
  beforeEach(() => {
    notifySpy = vi.spyOn(realLogger, "notify").mockImplementation(() => {});
  });
  afterEach(() => {
    notifySpy.mockRestore();
  });

  describe("route-selected（路由选择记录）", () => {
    it("createPublisher(bilibili, api 模式) 落 route-selected 含 platform/mode", () => {
      const r = new PublisherRouter();
      r.createPublisher("bilibili", { store, accountManager });
      const call = findNotify("route-selected");
      expect(call, "route-selected 应被记录").toBeTruthy();
      expect(call[0]).toBe("PublisherRouter");
      expect(call[2].params).toMatchObject({ platform: "bilibili", mode: "api" });
    });
  });

  describe("RpaVmPublisher 成功路径", () => {
    it("rpa 发布成功落 rpa-publish-ok（dom 模式 + url + durationMs）", async () => {
      const rpaViewManager = {
        publish: vi.fn().mockResolvedValue({
          success: true,
          url: "https://mp.weixin.qq.com/s/post/1",
          postId: "POST1",
        }),
        cancel: vi.fn(),
      };
      const r = new PublisherRouter();
      const p = r.createPublisher("wechat_mp", { store, accountManager, rpaViewManager });
      const task = {
        id: "t-rpa",
        platform: "wechat_mp",
        article: { accountId: "acc-rpa", title: "标题", content: "正文" },
      };
      const result = await p.publish(task);
      expect(result.success).toBe(true);
      expect(result.mode).toBe("dom");

      const call = findNotify("rpa-publish-ok");
      expect(call, "rpa-publish-ok 应被记录").toBeTruthy();
      expect(call[0]).toBe("PublisherRouter");
      expect(call[2].level).toBe("INFO");
      expect(call[2].params).toMatchObject({
        platform: "wechat_mp",
        accountId: "acc-rpa",
        mode: "dom",
        url: "https://mp.weixin.qq.com/s/post/1",
      });
      // durationMs 必须为数字且非负
      expect(typeof call[2].params.durationMs).toBe("number");
      expect(call[2].params.durationMs).toBeGreaterThanOrEqual(0);
      // url 不含控制字符（经 sanitizePublishResultUrl 消毒）
      expect(call[2].params.url).not.toMatch(/[\x00-\x1f]/);
    });
  });

  describe("ApiPublisher Cookie 缺失失败路径", () => {
    it("cookies 为空落 api-publish-error（auth_missing + 错误文案）", async () => {
      const r = new PublisherRouter();
      const p = r.createPublisher("bilibili", { store, accountManager });
      const task = {
        id: "t-api",
        platform: "bilibili",
        article: { accountId: "acc-api", title: "标题", content: "正文" },
      };
      await expect(p.publish(task)).rejects.toThrow(/平台 Cookie 缺失/);

      const call = findNotify("api-publish-error");
      expect(call, "api-publish-error 应被记录").toBeTruthy();
      expect(call[0]).toBe("PublisherRouter");
      expect(call[2].level).toBe("ERROR");
      expect(call[2].errorCategory).toBe("auth_missing");
      expect(call[2].error).toMatch(/平台 Cookie 缺失/);
      expect(call[2].params).toMatchObject({
        platform: "bilibili",
        accountId: "acc-api",
        mode: "api",
      });
    });
  });

  describe("BackendPublisher 失败路径", () => {
    const platform = "wechat_mp";
    let savedMode;
    beforeEach(() => {
      savedMode = ROUTE_TABLE[platform].mode;
      ROUTE_TABLE[platform].mode = "backend";
    });
    afterEach(() => {
      ROUTE_TABLE[platform].mode = savedMode;
    });
    it("后端 code != 0 落 backend-publish-error（backend_error）", async () => {
      const pythonBridge = {
        requestBackend: vi.fn().mockResolvedValue({ code: 1, message: "后端服务异常" }),
      };
      const r = new PublisherRouter();
      const p = r.createPublisher(platform, { store, accountManager, pythonBridge });
      const task = {
        id: "t-be",
        platform,
        article: { accountId: "acc-be", title: "标题", content: "正文" },
      };
      await expect(p.publish(task)).rejects.toThrow("后端服务异常");

      const call = findNotify("backend-publish-error");
      expect(call, "backend-publish-error 应被记录").toBeTruthy();
      expect(call[0]).toBe("PublisherRouter");
      expect(call[2].level).toBe("ERROR");
      expect(call[2].errorCategory).toBe("backend_error");
      expect(call[2].error).toBe("后端服务异常");
      expect(call[2].params).toMatchObject({ platform });
    });
  });

  describe("publish-cancelled（取消信号中止）", () => {
    it("RpaVm 在 await 前 signal.aborted 落 publish-cancelled(WARN) 且未调用 rpaViewManager.publish", async () => {
      const rpaViewManager = { publish: vi.fn(), cancel: vi.fn() };
      const r = new PublisherRouter();
      const p = r.createPublisher("wechat_mp", { store, accountManager, rpaViewManager });
      const task = {
        id: "t-cancel",
        platform: "wechat_mp",
        article: { accountId: "acc-cancel", title: "标题", content: "正文" },
      };
      await expect(p.publish(task, { signal: { aborted: true } })).rejects.toThrow("任务已取消");
      expect(rpaViewManager.publish).not.toHaveBeenCalled();

      const call = findNotify("publish-cancelled");
      expect(call, "publish-cancelled 应被记录").toBeTruthy();
      expect(call[0]).toBe("PublisherRouter");
      expect(call[2].level).toBe("WARN");
      expect(call[2].params).toMatchObject({ platform: "wechat_mp", accountId: "acc-cancel" });
    });

    it("Api 在 await 前 signal.aborted 落 publish-cancelled(WARN)", async () => {
      // Api 轨在取消检查前先校验 Cookie 凭证（auth_missing 守卫）：
      // 只有凭证有效时才会走到取消分支，因此本用例需注入合法 Cookie。
      const apiAccountManager = {
        loadSavedCredentials: vi.fn(() => ({
          platform: "bilibili",
          cookies: [{ name: "SESSDATA", value: "valid", domain: "bilibili.com" }],
          localStorage: {},
        })),
      };
      const r = new PublisherRouter();
      const p = r.createPublisher("bilibili", { store, accountManager: apiAccountManager });
      const task = {
        id: "t-cancel-api",
        platform: "bilibili",
        article: { accountId: "acc-cancel-api", title: "标题", content: "正文" },
      };
      await expect(p.publish(task, { signal: { aborted: true } })).rejects.toThrow("任务已取消");

      const call = findNotify("publish-cancelled");
      expect(call, "publish-cancelled 应被记录").toBeTruthy();
      expect(call[2].level).toBe("WARN");
      expect(call[2].params).toMatchObject({ platform: "bilibili", accountId: "acc-cancel-api" });
    });
  });

  it("生命周期日志不污染既有路由选择（route-selected 与 rpa-publish-ok 同时出现）", async () => {
    const rpaViewManager = {
      publish: vi.fn().mockResolvedValue({ success: true, url: "https://example.com/p/9", postId: "P9" }),
      cancel: vi.fn(),
    };
    const r = new PublisherRouter();
    const p = r.createPublisher("wechat_mp", { store, accountManager, rpaViewManager });
    await p.publish({ id: "t-both", platform: "wechat_mp", article: { accountId: "a", title: "t", content: "c" } });

    expect(allNotifyKeys()).toContain("route-selected");
    expect(allNotifyKeys()).toContain("rpa-publish-ok");
  });
});
