/**
 * publish-core.test.js — 分片器 + UploadEmitGate 节流契约（W1 §3.3，vitest 组）
 *
 * FileChunker：8MiB(8388608) 默认片长，三边界（整除/非整除/小于单片）；
 * UploadEmitGate：<100MB 每 10% 里程碑去重上报，>=100MB 每 5s 时间节流（虚拟时钟）。
 */
const { chunkTotal, DEFAULT_CHUNK_SIZE } = require("../src/publish/core/chunker");
const { createEmitGate, HUNDRED_MB } = require("../src/publish/core/emit-gate");

describe("FileChunker chunkTotal", function () {
  test("默认片长为 8MiB（8388608）", function () {
    expect(DEFAULT_CHUNK_SIZE).toBe(8388608);
  });

  test("整除边界：16MiB → 2 片，范围连续无重叠，Content-Range 逐字正确", function () {
    const parts = chunkTotal(16 * 1024 * 1024);
    expect(parts.length).toBe(2);
    expect(parts[0]).toEqual({ index: 0, start: 0, end: 8388607, size: 8388608, contentRange: "bytes 0-8388607/16777216" });
    expect(parts[1].start).toBe(8388608);
    expect(parts[1].end).toBe(16777215);
    expect(parts[1].contentRange).toBe("bytes 8388608-16777215/16777216");
  });

  test("非整除边界：10MiB → 2 片，末片 2MiB 余量", function () {
    const total = 10 * 1024 * 1024;
    const parts = chunkTotal(total);
    expect(parts.length).toBe(2);
    expect(parts[1].size).toBe(total - 8388608);
    expect(parts[parts.length - 1].end).toBe(total - 1);
  });

  test("小于单片边界：1KiB → 1 片覆盖全文件", function () {
    const parts = chunkTotal(1024);
    expect(parts.length).toBe(1);
    expect(parts[0].start).toBe(0);
    expect(parts[0].end).toBe(1023);
    expect(parts[0].contentRange).toBe("bytes 0-1023/1024");
  });

  test("0 字节非法（fail-closed），片长必须为正", function () {
    expect(() => chunkTotal(0)).toThrow();
    expect(() => chunkTotal(-1)).toThrow();
    expect(() => chunkTotal(100, { chunkSize: 0 })).toThrow();
  });

  test("自定义片长：100 字节 / 30 片长 → 4 片", function () {
    const parts = chunkTotal(100, { chunkSize: 30 });
    expect(parts.length).toBe(4);
    expect(parts[3].size).toBe(10);
  });
});

describe("UploadEmitGate 进度节流", function () {
  test("小文件（<100MB）：跨过 10% 里程碑才上报，重复/同档/回退吞掉", function () {
    const seen = [];
    const gate = createEmitGate({ totalBytes: 10 * 1024 * 1024, onProgress: (p) => seen.push(p) });
    gate.report(5 * 1024 * 1024); // 50% → 报 50
    gate.report(5.5 * 1024 * 1024); // 55% 同档（里程碑仍 50）→ 不报
    gate.report(5 * 1024 * 1024); // 回退 50% → 不报
    gate.report(2 * 1024 * 1024); // 回退 20% → 不报
    gate.report(10 * 1024 * 1024); // 100% → 报 100
    expect(seen).toEqual([50, 100]);
  });

  test("小文件里程碑取当前档（35% → 报 30，95% → 报 90）", function () {
    const seen = [];
    const gate = createEmitGate({ totalBytes: 100, onProgress: (p) => seen.push(p) });
    gate.report(35);
    gate.report(95);
    expect(seen).toEqual([30, 90]);
  });

  test("大文件（>=100MB）：每 5s 时间节流，虚拟时钟推进", function () {
    const seen = [];
    let now = 1000;
    const gate = createEmitGate({
      totalBytes: HUNDRED_MB,
      onProgress: (p) => seen.push(p),
      clock: () => now,
      intervalMs: 5000,
    });
    gate.report(1 * 1024 * 1024); // 首次立即上报
    gate.report(2 * 1024 * 1024); // 未到 5s → 吞掉
    now += 5000;
    gate.report(3 * 1024 * 1024); // 到 5s → 上报
    expect(seen.length).toBe(2);
    expect(seen[seen.length - 1]).toBeGreaterThan(seen[0]);
  });

  test("done() 强制补发 100% 且幂等", function () {
    const seen = [];
    const gate = createEmitGate({ totalBytes: 1024, onProgress: (p) => seen.push(p) });
    gate.done();
    gate.done();
    expect(seen).toEqual([100]);
  });

  test("percent 越界裁剪到 [0,100]", function () {
    const seen = [];
    const gate = createEmitGate({ totalBytes: 10, onProgress: (p) => seen.push(p) });
    gate.report(999999); // >100% → 按 100 处理
    expect(seen).toEqual([100]);
  });
});
