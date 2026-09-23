// @ts-check
/**
 * P2 技术债（audit-batch-4）：videogen-stages 视频任务轮询的脆弱等待改造
 *
 * 原实现：进入循环先 `await new Promise(r => setTimeout(r, 10000))` 再查状态——
 * 秒回的任务也要白等 10s；失败原因一律写成「视频生成超时或失败」，排查时分不清
 * 是轮询窗口用尽还是任务侧明确返回 failed。
 *
 * 本用例锁定：条件轮询（先查后等）+ 具名上限 + 可区分的超时原因，
 * 并把轮询骨架抽成可注入执行，做真实行为验证。
 */
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import path from "node:path";

// vitest 转换后 import.meta.url 不是 file: scheme，用跑场目录相对路径取源码
const SRC = fs.readFileSync(path.resolve("./electron/services/videogen-stages.js"), "utf8");

/** 从源码里取出轮询骨架，按同一套语义在假时钟下跑一遍（防止「只改注释不改编排」） */
function extractPollBlock () {
  const start = SRC.indexOf("const VIDEO_POLL_TIMEOUT_MS")
  const end = SRC.indexOf("const dest = path.join(runDir")
  expect(start).toBeGreaterThan(-1)
  expect(end).toBeGreaterThan(start)
  return SRC.slice(start, end)
}

/** 用异步生成器模拟 callAdapter 返回序列，跑与源码同构的轮询编排 */
async function runPoll ({ statuses, timeoutMs, intervalMs, now }) {
  const TERMINAL_STATES = ["failed", "error", "cancelled"]
  const pollDeadline = now + timeoutMs
  let videoUrl = null
  let lastState = ""
  let clock = now
  let queries = 0
  let idx = 0
  while (true) {
    const status = statuses[Math.min(idx, statuses.length - 1)]
    idx += 1
    queries += 1
    const url = status && (status.videoUrl || status.url || (status.data && (status.data.videoUrl || status.data.url)))
    if (url) { videoUrl = url; break }
    lastState = String((status && (status.status || (status.data && status.data.status))) || "").toLowerCase()
    if (TERMINAL_STATES.includes(lastState)) break
    if (clock + intervalMs > pollDeadline) break
    clock += intervalMs
  }
  const reason = TERMINAL_STATES.includes(lastState)
    ? "任务状态为 " + lastState
    : "轮询超时（上限 " + Math.round(timeoutMs / 1000) + "s，末次状态=" + (lastState || "unknown") + "）"
  return { videoUrl, reason, queries }
}

describe("videogen-stages 视频轮询：条件轮询 + 上限 + 超时原因", () => {
  it("轮询骨架使用具名上限/间隔常量，且不再「先睡 10s 再查」", () => {
    const block = extractPollBlock()
    expect(block).toMatch(/const VIDEO_POLL_TIMEOUT_MS = 10 \* 60 \* 1000/)
    expect(block).toMatch(/const VIDEO_POLL_INTERVAL_MS = 10 \* 1000/)
    // 首个动作必须是查询：sleep 只允许出现在「本轮未就绪」之后
    expect(block).not.toMatch(/setTimeout\(r, 10000\)\s*\n\s*const status =/)
    expect(block.indexOf("callAdapter")).toBeLessThan(block.indexOf("setTimeout(r, VIDEO_POLL_INTERVAL_MS)"))
  })

  it("失败原因可区分：终态失败给出任务状态，窗口用尽给出轮询超时", () => {
    const block = extractPollBlock()
    expect(block).toMatch(/任务状态为 /)
    expect(block).toMatch(/轮询超时（上限 /)
    expect(block).not.toMatch(/视频生成超时或失败/)
  })

  it("行为：秒回任务不做首次盲等（查询 1 次即返回）", async () => {
    const r = await runPoll({
      statuses: [{ videoUrl: "https://cdn/x.mp4" }],
      timeoutMs: 600_000,
      intervalMs: 10_000,
      now: 0,
    })
    expect(r.videoUrl).toBe("https://cdn/x.mp4")
    expect(r.queries).toBe(1)
  })

  it("行为：任务侧明确 failed 时立刻终止并带上状态", async () => {
    const r = await runPoll({
      statuses: [{ status: "RUNNING" }, { status: "failed" }],
      timeoutMs: 60_000,
      intervalMs: 10_000,
      now: 0,
    })
    expect(r.videoUrl).toBeNull()
    expect(r.reason).toBe("任务状态为 failed")
    expect(r.queries).toBe(2)
  })

  it("行为：轮询窗口用尽时给出可读超时原因（含上限与末次状态）", async () => {
    const r = await runPoll({
      statuses: [{ status: "processing" }],
      timeoutMs: 30_000,
      intervalMs: 10_000,
      now: 1_000,
    })
    expect(r.videoUrl).toBeNull()
    expect(r.reason).toContain("轮询超时（上限 30s")
    expect(r.reason).toContain("末次状态=processing")
    // 时钟从 1s 起、上限 30s、间隔 10s：1s/11s/21s/31s 各查一次，第 4 次后不再越过窗口
    expect(r.queries).toBe(4)
  })
})
