import { beforeEach, describe, expect, it, vi } from "vitest";
import { createPinia, setActivePinia } from "pinia";

// 捕获订阅回调，便于在测试内模拟主进程广播
let capturedCb = null
vi.mock("@/api/publisher", () => ({
  onRiskSuspended: vi.fn((cb) => { capturedCb = cb; return () => { capturedCb = null } }),
  listSuspendedRisk: vi.fn(async () => ({ code: 0, data: [] })),
  resumeRisk: vi.fn(async () => ({ code: 0, data: { changed: true, suspended: [] } })),
}));

import { useRiskStore } from "./risk.js";
import { onRiskSuspended, listSuspendedRisk, resumeRisk } from "@/api/publisher";

describe("useRiskStore", () => {
  beforeEach(() => {
    setActivePinia(createPinia());
    vi.restoreAllMocks();
    vi.resetAllMocks();
    capturedCb = null;
    onRiskSuspended.mockImplementation((cb) => { capturedCb = cb; return () => { capturedCb = null } });
    listSuspendedRisk.mockResolvedValue({ code: 0, data: [] });
    resumeRisk.mockResolvedValue({ code: 0, data: { changed: true, suspended: [] } });
  });

  it("初始为空、未挂起", () => {
    const s = useRiskStore();
    expect(s.suspended).toEqual([]);
    expect(s.isSuspended("weixin", "a1")).toBe(false);
    expect(s.count()).toBe(0);
  });

  it("start 初次 refresh 拉取权威清单", async () => {
    listSuspendedRisk.mockResolvedValue({ code: 0, data: [{ platform: "bilibili", accountId: "b1" }] });
    const s = useRiskStore();
    s.start();
    await vi.waitFor(() => expect(s.isSuspended("bilibili", "b1")).toBe(true));
  });

  it("广播整体替换响应式清单并回调 notify", () => {
    const notify = vi.fn();
    const s = useRiskStore();
    s.start({ notify });
    capturedCb({ suspended: [{ platform: "weixin", accountId: "a1" }, { platform: "weixin", accountId: "a2" }] });
    expect(s.suspended).toHaveLength(2);
    expect(s.isSuspended("weixin", "a1")).toBe(true);
    expect(notify).toHaveBeenCalledWith(expect.objectContaining({ kind: "suspended", count: 2 }));
  });

  it("平台级挂起覆盖该平台上所有账号", () => {
    const s = useRiskStore();
    s.setSuspended([{ platform: "weixin", accountId: null }]);
    expect(s.isSuspended("weixin", "any")).toBe(true);
    expect(s.isSuspended("weixin")).toBe(true);
    expect(s.isSuspended("bilibili", "any")).toBe(false);
  });

  it("resume 未 start 时返回 not-started", async () => {
    const s = useRiskStore();
    expect(await s.resume("weixin", "a1")).toEqual({ ok: false, reason: "not-started" });
  });

  it("resume 经确认后调用 resumeRisk 并同步清单", async () => {
    const s = useRiskStore();
    s.start({ confirm: async () => true });
    await vi.waitFor(() => expect(listSuspendedRisk).toHaveBeenCalled());
    capturedCb({ suspended: [{ platform: "weixin", accountId: "a1" }] });
    expect(s.isSuspended("weixin", "a1")).toBe(true);
    const res = await s.resume("weixin", "a1");
    expect(res.ok).toBe(true);
    expect(resumeRisk).toHaveBeenCalledWith({ platform: "weixin", accountId: "a1" });
    expect(s.suspended).toEqual([]);
  });

  it("未确认时保持挂起（合规红线：不自动恢复）", async () => {
    const s = useRiskStore();
    s.start({ confirm: async () => false });
    // 先让 start 初次 refresh（返回空）落定，避免与后续广播竞态
    await vi.waitFor(() => expect(listSuspendedRisk).toHaveBeenCalled());
    capturedCb({ suspended: [{ platform: "weixin", accountId: "a1" }] });
    const res = await s.resume("weixin", "a1");
    expect(res).toEqual({ ok: false, reason: "cancelled" });
    expect(resumeRisk).not.toHaveBeenCalled();
    expect(s.isSuspended("weixin", "a1")).toBe(true);
  });

  it("stop 后取消订阅", () => {
    const s = useRiskStore();
    s.start();
    expect(typeof capturedCb).toBe("function");
    s.stop();
    expect(capturedCb).toBeNull();
  });
});
