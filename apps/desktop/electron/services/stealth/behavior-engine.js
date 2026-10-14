/**
 * behavior-engine.js — 行为层纯算法（传输无关，评审 H3）
 *
 * 来源与许可：
 * - 贝塞尔轨迹 = CloakBrowser `cloakbrowser/human/mouse.py` 算法移植（MIT wrapper 源码，
 *   2026-10-14 提取：三次贝塞尔 + 垂直随机控制点 + ease-in-out + burst + sin wobble）
 * - 事件序列 = social-auto-upload `_native_click` 移植（MIT，源码实证：抖音身份验证组件
 *   只认 pointer/mouse 全套合成事件，注释与节拍 150/200ms 保留）
 *
 * 设计约束：
 * - **零宿主依赖**：不 import electron/playwright；输入起点终点+seed，输出点序列与
 *   事件序列。驱动（cdp-input / camofox driver）负责把序列翻译成 CDP/浏览器调用
 * - **确定性可测**：同 seed 同轨迹（回归锁），异 seed 异轨迹（防固化指纹）
 * - **几何不变量**：起终点命中/单调推进/步数有界/单步位移 ≤25% 全程（防瞬移）
 */
'use strict'

/** 确定性 PRNG（mulberry32）：同 seed 同序列 */
function makeRng (seed) {
  let a = (seed >>> 0) || 1
  return function () {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function easeInOut (t) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2
}

function cubicBezier (p0, p1, p2, p3, t) {
  const u = 1 - t
  const uu = u * u
  const uuu = uu * u
  const tt = t * t
  const ttt = tt * t
  return {
    x: uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x,
    y: uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y,
  }
}

const DEFAULTS = {
  minSteps: 5,
  maxSteps: 120,
  stepsDivisor: 25, // 每 25px 一步
  controlBias: 0.3, // 控制点垂直偏移 ≤0.3×dist
  wobbleAmp: 0.6, // sin 微颤幅度（px）
  preClickSleepMs: 150,
  postClickSleepMs: 200,
  jitterRatio: 0.2,
}

/**
 * 计划一次移动：起终点 → 点序列（含每点 delayMs，burst 节奏）
 * @returns {{points: Array<{x:number,y:number,delayMs:number}>}}
 */
function planMove (fromX, fromY, toX, toY, options = {}) {
  const cfg = { ...DEFAULTS, ...(options.cfg || {}) }
  const rng = makeRng(options.seed)
  const dist = Math.hypot(toX - fromX, toY - fromY)
  if (dist < 1) return { points: [] }

  const steps = Math.max(cfg.minSteps, Math.min(cfg.maxSteps, Math.round(dist / cfg.stepsDivisor)))
  const start = { x: fromX, y: fromY }
  const end = { x: toX, y: toY }
  // 垂直方向的随机控制点（CloakBrowser：±0.3×dist 偏置，落在 25%/75% 处）
  const px = -(toY - fromY) / dist
  const py = (toX - fromX) / dist
  const bias1 = (rng() * 2 - 1) * cfg.controlBias * dist
  const bias2 = (rng() * 2 - 1) * cfg.controlBias * dist
  const cp1 = { x: start.x + (end.x - start.x) * 0.25 + px * bias1, y: start.y + (end.y - start.y) * 0.25 + py * bias1 }
  const cp2 = { x: start.x + (end.x - start.x) * 0.75 + px * bias2, y: start.y + (end.y - start.y) * 0.75 + py * bias2 }

  // burst 节奏：随机大小的连发段，段内快、段间慢（CloakBrowser burst 思想）
  let burstLeft = 2 + Math.floor(rng() * 4)
  let inBurst = true

  const points = []
  for (let i = 0; i <= steps; i++) {
    const progress = i / steps
    const pt = cubicBezier(start, cp1, cp2, end, easeInOut(progress))
    // sin 微颤：中段最大、两端为零（不破坏起终点）
    const wobble = Math.sin(Math.PI * progress) * cfg.wobbleAmp * (rng() * 2 - 1)
    const x = pt.x + px * wobble
    const y = pt.y + py * wobble
    // 末点强制命中（微扰不得破坏终点）
    const fx = i === steps ? end.x : x
    const fy = i === steps ? end.y : y
    let delayMs
    if (inBurst) {
      delayMs = 4 + rng() * 6 // 段内 4-10ms
      burstLeft--
      if (burstLeft <= 0) { inBurst = false; burstLeft = 1 + Math.floor(rng() * 3) }
    } else {
      delayMs = 20 + rng() * 40 // 段间 20-60ms
      burstLeft--
      if (burstLeft <= 0) { inBurst = true; burstLeft = 2 + Math.floor(rng() * 4) }
    }
    points.push({ x: fx, y: fy, delayMs: Math.round(delayMs) })
  }
  return { points, diagnostics: { start, end, cp1, cp2, steps, wobbleAmp: cfg.wobbleAmp, unitPerpendicular: { px, py } } }
}

function jitter (base, ratio, rng) {
  return Math.round(base * (1 + (rng() * 2 - 1) * ratio))
}

function baseEvent (kind, x, y) {
  return {
    kind,
    bubbles: true,
    cancelable: true,
    composed: true,
    clientX: Math.round(x),
    clientY: Math.round(y),
    pointerId: 1,
    pointerType: 'mouse',
    isPrimary: true,
    button: 0,
  }
}

/**
 * 计划一次点击：接近移动 + 节拍 + pointer/mouse 全套合成事件
 * （social-auto-upload _native_click 移植：抖音 uc_verification_component 只认全套）
 */
function planClickSequence (toX, toY, options = {}) {
  const cfg = { ...DEFAULTS, ...(options.cfg || {}) }
  const rng = makeRng(options.seed)
  const fromX = (options.fromX != null ? options.fromX : toX - 40)
  const fromY = (options.fromY != null ? options.fromY : toY - 30)
  const move = planMove(fromX, fromY, toX, toY, { seed: options.seed, cfg })
  const events = []
  for (const p of move.points) events.push({ kind: 'move', x: p.x, y: p.y, delayMs: p.delayMs })
  const x = toX
  const y = toY
  events.push({ ...baseEvent('pointerover', x, y), delayMs: jitter(8, cfg.jitterRatio, rng) })
  events.push({ ...baseEvent('pointerenter', x, y), delayMs: jitter(8, cfg.jitterRatio, rng) })
  events.push({ ...baseEvent('pointerdown', x, y), delayMs: jitter(10, cfg.jitterRatio, rng) })
  events.push({ ...baseEvent('mousedown', x, y), delayMs: jitter(10, cfg.jitterRatio, rng) })
  events.push({ ...baseEvent('pointerup', x, y), delayMs: jitter(10, cfg.jitterRatio, rng) })
  events.push({ ...baseEvent('mouseup', x, y), delayMs: jitter(10, cfg.jitterRatio, rng) })
  events.push({ ...baseEvent('click', x, y), delayMs: 0 })
  return {
    events,
    preClickSleepMs: jitter(cfg.preClickSleepMs, cfg.jitterRatio, rng),
    postClickSleepMs: jitter(cfg.postClickSleepMs, cfg.jitterRatio, rng),
  }
}

/** 计划打字：逐键 + 间隔抖动（禁零延迟 machine-typing） */
function planType (text, options = {}) {
  const cfg = { ...DEFAULTS, ...(options.cfg || {}) }
  const rng = makeRng(options.seed)
  const s = String(text == null ? '' : text)
  const events = []
  // 先聚集的字符间隔短、思考区长（真人节奏）
  for (let i = 0; i < s.length; i++) {
    const think = (i > 0 && i % 7 === 0) ? 200 + rng() * 300 : 0
    events.push({ kind: 'char', char: s[i], delayMs: Math.round(30 + rng() * 90 + think) })
  }
  return { events, avgDelayMs: events.length ? Math.round(events.reduce((a, e) => a + e.delayMs, 0) / events.length) : 0 }
}

module.exports = { planMove, planClickSequence, planType, DEFAULTS, _internals: { makeRng, easeInOut, cubicBezier } }
