// @ts-check
/**
 * BatchRateController 回归测试 — 批量任务频率控制器
 *
 * 覆盖：串行执行、条间延迟、指数退避、熔断、取消、统计。
 * sleepFn 注入 fake sleep（记录调用立即 resolve），避免真实 8s 等待。
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const BatchRateController = require("./batch-rate-controller");

function makeController (overrides = {}) {
  const sleepCalls = [];
  const sleepFn = async (ms) => { sleepCalls.push(ms) };
  const log = { info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  const ctrl = new BatchRateController({ sleepFn, log, ...overrides });
  return { ctrl, sleepCalls, log };
}

describe("BatchRateController", () => {
  it("空数组 → 立即返回 completed:0", async () => {
    const { ctrl } = makeController();
    const r = await ctrl.run([], async () => ({ ok: true }));
    expect(r.completed).toBe(0);
    expect(r.cancelled).toBe(false);
  });

  it("3 条全部成功 → completed:3 + onProgress 调 3 次 + 条间延迟 2 次", async () => {
    const { ctrl, sleepCalls } = makeController({ baseIntervalMs: 100, jitterMs: 50 });
    const onProgress = vi.fn();
    const r = await ctrl.run([1, 2, 3], async (item) => ({ ok: true, item }), { onProgress });
    expect(r.completed).toBe(3);
    expect(r.failed).toBe(0);
    expect(onProgress).toHaveBeenCalledTimes(3);
    // 3 条只有 2 个间隔
    expect(sleepCalls).toHaveLength(2);
    // 延迟在 [100, 150) 范围
    for (const ms of sleepCalls) {
      expect(ms).toBeGreaterThanOrEqual(100);
      expect(ms).toBeLessThan(150);
    }
  });

  it("1 条失败（不可重试）→ failed:1 + 继续处理后续", async () => {
    const { ctrl } = makeController({ baseIntervalMs: 10, jitterMs: 0 });
    const r = await ctrl.run(["a", "b", "c"], async (item) => {
      if (item === "b") return { ok: false, error: "not found" };
      return { ok: true };
    });
    expect(r.completed).toBe(2);
    expect(r.failed).toBe(1);
    expect(r.results).toHaveLength(3);
  });

  it("1 条失败（retryable）→ 触发退避 + backoffCount:1", async () => {
    const { ctrl, sleepCalls, log } = makeController({ baseIntervalMs: 10, jitterMs: 0, backoffBaseMs: 500 });
    const r = await ctrl.run(["a", "b"], async (item) => {
      if (item === "a") return { ok: false, retryable: true, error: "429" };
      return { ok: true };
    });
    expect(r.failed).toBe(1);
    expect(r.completed).toBe(1);
    expect(r.backoffCount).toBe(1);
    // 退避 500ms + 条间延迟 10ms
    expect(sleepCalls).toContain(500);
    expect(log.warn).toHaveBeenCalled();
  });

  it("连续 3 次 retryable 失败 → 熔断 circuitBroken:true + 剩余不处理", async () => {
    const { ctrl } = makeController({ baseIntervalMs: 10, jitterMs: 0, backoffBaseMs: 100, maxBackoffs: 3 });
    const processed = [];
    const r = await ctrl.run([1, 2, 3, 4, 5], async (item) => {
      processed.push(item);
      return { ok: false, retryable: true, error: "429" };
    });
    expect(r.circuitBroken).toBe(true);
    expect(r.backoffCount).toBe(4); // 第 4 次超过 maxBackoffs=3
    // 熔断发生在第 4 条（前 3 条退避后继续，第 4 条触发熔断停止）
    expect(processed).toHaveLength(4);
  });

  it("signal.cancelled → cancelled:true + 停止", async () => {
    const { ctrl } = makeController({ baseIntervalMs: 10, jitterMs: 0 });
    const signal = { cancelled: false };
    const processed = [];
    const r = await ctrl.run([1, 2, 3], async (item) => {
      processed.push(item);
      if (item === 2) signal.cancelled = true; // 第 2 条后取消
      return { ok: true };
    }, { signal });
    expect(r.cancelled).toBe(true);
    expect(processed).toHaveLength(2); // 第 3 条不处理
  });

  it("延迟计算：base=100, jitter=50 → 延迟在 [100, 150) 范围", () => {
    const { ctrl } = makeController({ baseIntervalMs: 100, jitterMs: 50 });
    for (let i = 0; i < 20; i++) {
      const d = ctrl._computeInterval();
      expect(d).toBeGreaterThanOrEqual(100);
      expect(d).toBeLessThan(150);
    }
  });

  it("jitterMs=0 → 无抖动，延迟恒等于 base", () => {
    const { ctrl } = makeController({ baseIntervalMs: 200, jitterMs: 0 });
    for (let i = 0; i < 10; i++) {
      expect(ctrl._computeInterval()).toBe(200);
    }
  });

  it("items 非数组抛 TypeError", async () => {
    const { ctrl } = makeController();
    await expect(ctrl.run("not-array", async () => ({ ok: true }))).rejects.toThrow(TypeError);
  });

  it("taskFn 非函数抛 TypeError", async () => {
    const { ctrl } = makeController();
    await expect(ctrl.run([1], "not-fn")).rejects.toThrow(TypeError);
  });

  it("taskFn 抛异常 → 记为失败不中断", async () => {
    const { ctrl } = makeController({ baseIntervalMs: 10, jitterMs: 0 });
    const r = await ctrl.run([1, 2], async (item) => {
      if (item === 1) throw new Error("boom");
      return { ok: true };
    });
    expect(r.failed).toBe(1);
    expect(r.completed).toBe(1);
  });

  it("getStats 返回当前统计", async () => {
    const { ctrl } = makeController({ baseIntervalMs: 10, jitterMs: 0 });
    await ctrl.run([1, 2], async () => ({ ok: true }));
    const s = ctrl.getStats();
    expect(s.completed).toBe(2);
    expect(s.circuitBroken).toBe(false);
  });
});
