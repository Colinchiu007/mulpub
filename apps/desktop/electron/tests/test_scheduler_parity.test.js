// @ts-check
/**
 * test_scheduler_parity.js — 模拟器与真实 governor 对拍（spec: desktop/model-call-observability）
 * 运行脚本级对拍（Python 模拟器 + 桌面端真实自检），断言 6 组用例关键指标一致
 * （官方四组 + 5h 真实参数 + 慢调用并发推进；2026-08-13 模拟器并发推进升级后 quota-5h-real / concurrency-real 纳入 must-pass）；
 * 并断言「已知差异用例」（interval==duration 临界测量噪声）差异值存在（防漂移）。
 */
import { describe, it, expect } from 'vitest'

const { runParity, runKnownDiffs } = require('../../../../scripts/compare-scheduler-models')

describe('scheduler 模拟器与真实 governor 对拍', () => {
  it('六组固定输入关键指标一致（含 429 注入、5h 额度、真实参数、并发推进）', async () => {
    const results = await runParity(1500)
    for (const r of results) {
      // 每次跑都打印逐用例的「预测 / 实测 / 差值 / 生效容差」。调容差需要的是分布，
      // 而只在失败时才有的信息等于每三个月拿到一个孤立样本 —— 上一轮就是靠 1653/1640
      // 两个偶发样本才判出漂移是「常量 + 比例」，靠猜会把门禁调成既不灵敏也不稳定。
      console.log('[parity] ' + r.name
        + ' python=' + r.python.total_duration_ms
        + ' real=' + r.real.total_duration_ms
        + ' diff=' + r.diffTotalDurationMs
        + ' allowed=' + r.allowedTotalDurationMs
        + ' pass=' + r.pass)
      // 失败信息必须带上「实际生效容差」与「本次差值」：上一轮 main 红时只给了 python/real
      // 两个 JSON，看不出 1653ms 是超了 1500 还是超了比例，排障要回头翻脚本。
      expect(r.pass, r.name + ' ' + JSON.stringify(r.checks)
        + ' diffTotalDurationMs=' + r.diffTotalDurationMs
        + ' allowedTotalDurationMs=' + r.allowedTotalDurationMs
        + ' python=' + JSON.stringify(r.python) + ' real=' + JSON.stringify(r.real)).toBe(true)
    }
  }, 120000)

  it('已知差异用例差异值与记录一致（interval==duration 临界测量噪声，防漂移）', async () => {
    const known = await runKnownDiffs()
    const byName = Object.fromEntries(known.map((k) => [k.name, k]))
    // slow-call-concurrency：interval==duration 临界，真实 governor 定时器误差产生 1ms 级重叠 → maxc = 模拟器 + 1（噪声，非并发能力）
    expect(byName['slow-call-concurrency'].diff.max_concurrent_observed).toBe(1)
    expect(Math.abs(byName['slow-call-concurrency'].diff.total_duration_ms)).toBeLessThan(1500)
  }, 120000)
})
