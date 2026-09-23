// @ts-check
/**
 * P2 技术债（audit-batch-4）：KnowledgeEvolutionScheduler 孤儿定时器
 *
 * _scheduleWeekly 用「先 setTimeout 到点、再 setInterval 周期」实现周任务，但外层
 * setTimeout 没进 _timers：stop() 之后它照样触发，并在回调里挂一个无人回收的
 * setInterval —— 周期任务停不掉，句柄一直挂在事件循环上。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { KnowledgeEvolutionScheduler } = await import("../src/knowledge-evolution-scheduler");

describe("KnowledgeEvolutionScheduler 定时器清理", () => {
  let store;
  let logger;

  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    // 真实进化函数作用在一个空仓库上（即使抛错也被 _safeRun 吞掉），
    // 本用例只关心定时器句柄生命周期，不依赖任务内容。
    store = { list: () => [], all: () => [] };
    logger = { info: vi.fn(), warn: vi.fn() };
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("start() 登记的句柄全部纳入 _timers（含两个周任务的首跳 setTimeout）", () => {
    const s = new KnowledgeEvolutionScheduler(store, logger);
    s.start();
    // 1 个 6h decay interval + 2 个周任务首跳 setTimeout = 3 个句柄，一个都不能漏
    expect(s._timers).toHaveLength(3);
    expect(vi.getTimerCount()).toBe(3);
  });

  it("stop() 之后不再有挂起句柄（回归：孤儿 setTimeout 停不掉）", () => {
    const s = new KnowledgeEvolutionScheduler(store, logger);
    s.start();
    s.stop();
    expect(s._timers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("stop() 后跨过原定触发时刻，也不会再拉起周期任务（回归：孤儿 setTimeout）", () => {
    const s = new KnowledgeEvolutionScheduler(store, logger);
    s.start();
    s.stop();
    vi.advanceTimersByTime(15 * 24 * 3600 * 1000);
    // 未修复时：两个首跳 setTimeout 不在 _timers 里 → 到点仍会执行，
    // 并在回调里各挂一个无人回收的 setInterval（句柄数 +2，挂起数 +2）。
    expect(s._timers).toHaveLength(0);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("未 stop 时，到点会拉起周任务并转入 7 天周期", () => {
    const s = new KnowledgeEvolutionScheduler(store, logger);
    s.start();
    // 推进 15 天：两个周任务首跳都已触发，并各自转入一个 7 天周期 interval
    vi.advanceTimersByTime(15 * 24 * 3600 * 1000);
    expect(s._timers.length).toBeGreaterThanOrEqual(5);
    // 挂起中的：1 个 6h decay interval + 2 个周任务 interval（两个 setTimeout 已消费）
    expect(vi.getTimerCount()).toBe(3);
    s.stop();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("防复发静态不变量：_scheduleWeekly 的 setTimeout 句柄必须入 _timers", async () => {
    const fs = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const src = fs.readFileSync(
      fileURLToPath(new URL("../src/knowledge-evolution-scheduler.js", import.meta.url)),
      "utf8",
    );
    const block = src.slice(src.indexOf("_scheduleWeekly("), src.indexOf("module.exports"));
    expect(block).toMatch(/const kickoff = setTimeout\(/);
    expect(block).toMatch(/this\._timers\.push\(kickoff\)/);
    expect(block).not.toMatch(/^\s*setTimeout\(/m);
  });
});
