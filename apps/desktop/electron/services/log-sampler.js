'use strict'

/**
 * 日志风暴护栏采样器。
 *
 * 用于「重试 / 轮询」循环：在循环里每次想记一条日志时先问采样器是否放行，
 * 保证整体落盘条数有上限，同时首条与末条永远保留（便于排查起点与终点），
 * 中间按 `sampleEvery` 步长抽样。
 *
 * @param {{ sampleEvery?: number, maxBurst?: number }} [opts]
 *   - sampleEvery: 中间抽样步长（每第 N 次尝试才会被抽中），默认 10。
 *   - maxBurst: 单次循环内允许落盘的最大条数（硬上限），默认 50。
 * @returns {(attempt: number, opts?: { isLast?: boolean }) => boolean}
 *   传入当前尝试序号（从 1 开始）与是否已知为末次尝试；返回是否应当落盘。
 */
function createLogSampler({ sampleEvery = 10, maxBurst = 50 } = {}) {
  const step = Number.isFinite(sampleEvery) && sampleEvery > 0 ? Math.floor(sampleEvery) : 10
  const burst = Number.isFinite(maxBurst) && maxBurst >= 0 ? Math.floor(maxBurst) : 50
  // 为首条与末条预留预算，中间抽样硬上限 = max(0, burst - 2)，
  // 保证整体落盘条数 ≤ maxBurst，且首条/末条永远保留。
  const middleCap = Math.max(0, burst - 2)
  let middleLogged = 0

  return function shouldLog(attempt, opts = {}) {
    const isLast = !!opts.isLast
    // 首条（attempt===1）与末条（isLast）永远保留，不计入中间预算
    if (attempt === 1 || isLast) return true
    // 中间按步长抽样，受 middleCap 约束
    if (middleLogged >= middleCap) return false
    if (Number.isInteger(attempt) && attempt % step === 0) {
      middleLogged += 1
      return true
    }
    return false
  }
}

module.exports = { createLogSampler }
