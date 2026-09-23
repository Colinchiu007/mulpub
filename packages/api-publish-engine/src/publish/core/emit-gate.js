'use strict'
/**
 * emit-gate.js — UploadEmitGate 进度节流等价物（W1 §3.3）
 *
 * 参考产品行为：大文件（>=100MB）按时间节流（默认每 5s 一报），
 * 小文件按百分比里程碑节流（每 10% 一报，向下取整、逐级去重、回退吞掉），
 * done() 幂等补发 100%。clock 可注入便于虚拟时钟单测。
 */
const HUNDRED_MB = 100 * 1024 * 1024

function createEmitGate (opts = {}) {
  const totalBytes = opts.totalBytes
  if (!Number.isFinite(totalBytes) || totalBytes <= 0) {
    throw new Error('emit-gate: totalBytes must be a positive number')
  }
  const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : () => {}
  const clock = opts.clock || Date.now
  const intervalMs = opts.intervalMs || 5000
  const isLarge = totalBytes >= HUNDRED_MB
  let lastEmitted = -1
  let lastEmitAt = -Infinity
  let finished = false

  function emit (percent) {
    lastEmitted = percent
    lastEmitAt = clock()
    onProgress(percent)
  }

  /** @param {number} transferredBytes 已上传字节（可越界，按 [0,total] 裁剪） */
  function report (transferredBytes) {
    if (finished) return
    const clamped = Math.max(0, Math.min(totalBytes, transferredBytes))
    const percent = Math.min(100, Math.floor((clamped / totalBytes) * 100))
    if (isLarge) {
      if (lastEmitted === -1 || clock() - lastEmitAt >= intervalMs) emit(percent)
      return
    }
    const milestone = Math.min(100, Math.floor(percent / 10) * 10)
    if (percent >= 100) {
      emit(100)
      return
    }
    if (milestone > lastEmitted && milestone > 0) emit(milestone)
  }

  function done () {
    if (finished) return
    finished = true
    emit(100)
  }

  return { report, done, getLastEmitted: () => lastEmitted }
}

module.exports = { createEmitGate, HUNDRED_MB }
