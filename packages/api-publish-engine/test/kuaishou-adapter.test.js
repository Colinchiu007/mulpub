// kuaishou-adapter.test.js — W3 §5.3 KuaishouAdapter 变薄委托契约（对齐 W2 douyin-adapter 形态）
// 覆盖：execute → chain.run 单体委托（granular 空安全契约：uploadVideo/uploadCover 空任务返回 null 零请求）、
// buildPostData 委托纯函数、无 cookie fail-closed、链结果归一（platform/code 补齐）、风控与登录失效透传。
const KuaishouAdapter = require("../src/adapters/kuaishou");
const { errorCode } = require("../src/error-codes");

function makeChain (result, spies) {
  return {
    run: async (td, opts) => { spies && spies.push(["run", td, opts]); return result; },
    buildPostData: (td, ctx) => ({ delegated: true, td, ctx }),
  };
}

describe("KuaishouAdapter 变薄委托（W3 §5.3）", () => {
  it("granular 空安全契约：无 video.path → null 且零副作用", async () => {
    const a = new KuaishouAdapter();
    await expect(a.uploadVideo(null)).resolves.toBeNull();
    await expect(a.uploadVideo({})).resolves.toBeNull();
    await expect(a.uploadCover()).resolves.toBeNull();
  });

  it("execute：缺 cookie → data_error 停报（不进链）", async () => {
    const a = new KuaishouAdapter();
    const spies = [];
    a._chainOverride = makeChain({ success: true }, spies);
    const r = await a.execute({ title: "T", video: { path: "D:\\x.mp4" } }, "", {});
    expect(r.success).toBe(false);
    expect(r.code).toBe(errorCode.data_error);
    expect(spies).toHaveLength(0);
  });

  it("execute：dryRun 直通不调链", async () => {
    const a = new KuaishouAdapter();
    const spies = [];
    a._chainOverride = makeChain({ success: true }, spies);
    const r = await a.execute({ title: "T" }, "cookie=1", { dryRun: true });
    expect(r).toMatchObject({ success: true, dryRun: true, platform: "kuaishou" });
    expect(spies).toHaveLength(0);
  });

  it("execute：委托 chain.run 并归一（platform/code 补齐、success→0）", async () => {
    const a = new KuaishouAdapter();
    const spies = [];
    a._chainOverride = makeChain({ success: true, publishId: "P1", mode: "api" }, spies);
    const r = await a.execute({ title: "T", video: { path: "D:\\x.mp4" } }, "kuaishou.web.cp.api_ph=ph", { accountId: "a1" });
    expect(r.success).toBe(true);
    expect(r.platform).toBe("kuaishou");
    expect(r.code).toBe(errorCode.success);
    expect(spies[0][2]).toMatchObject({ accountId: "a1" });
  });

  it("execute：链返回 risk_blocked → 透传（outcome 归一为风控）", async () => {
    const a = new KuaishouAdapter();
    a._chainOverride = makeChain({ success: false, risk_blocked: true, error: "快手返回验证页" });
    const r = await a.execute({ title: "T", video: { path: "D:\\x.mp4" } }, "cookie=1", {});
    expect(r.risk_blocked).toBe(true);
  });

  it("execute：链抛 login_expired → 结果带 login_expired 语义", async () => {
    const a = new KuaishouAdapter();
    const err = new Error("kuaishou-video: result=109 login_expired");
    err.login_expired = true;
    a._chainOverride = { run: async () => { throw err; }, buildPostData: () => ({}) };
    const r = await a.execute({ title: "T", video: { path: "D:\\x.mp4" } }, "cookie=1", {});
    expect(r.success).toBe(false);
    expect(r.login_expired).toBe(true);
  });

  it("execute：签名页未就绪抛错 → unsupported 透传（api-then-dom 可降级）", async () => {
    const a = new KuaishouAdapter();
    a._chainOverride = { run: async () => ({ success: false, unsupported: true, error: "签名页未就绪" }), buildPostData: () => ({}) };
    const r = await a.execute({ title: "T", video: { path: "D:\\x.mp4" } }, "cookie=1", {});
    expect(r.unsupported).toBe(true);
  });

  it("buildPostData 委托链模块（uploadResult 取 fileId/coverKey，api_ph 从 cookie 提取）", () => {
    const a = new KuaishouAdapter();
    a._chainOverride = makeChain({});
    const data = a.buildPostData({ title: "T" }, { video: { fileId: "F1" }, cover: { coverKey: "C1" } }, "kuaishou.web.cp.api_ph=PH; x=1");
    expect(data.delegated).toBe(true);
    expect(data.ctx).toMatchObject({ fileId: "F1", coverKey: "C1", apiPh: "PH" });
  });

  it("旧骨架远程签名拼参路径已下线：adapter 不再自定义 publish（旧骨架方法已删除，仅继承 base 抽象）", () => {
    expect(Object.prototype.hasOwnProperty.call(KuaishouAdapter.prototype, "publish")).toBe(false);
  });
});
