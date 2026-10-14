// @ts-check
/**
 * behavior-engine.test.js — 行为层纯算法契约（评审 H3：传输无关）
 *
 * 契约：
 * 1. **确定性**：同 seed 同输入 ⇒ 同轨迹（可回归锁）；异 seed 必有差异（防固化指纹）
 * 2. **几何不变量**：起终点命中、单调推进、步数有界、单步位移有上限（防瞬移=机器特征）
 * 3. **贝塞尔形态**：控制点垂直偏移 ≤0.3×dist（CloakBrowser 算法移植的形状保持）
 * 4. **事件序列完整性**：click = move…→down→up（social-auto-upload _native_click 的
 *    9 字段 pointer/mouse 全套，注释日期与来源保留）
 * 5. **节奏**：move 后有 pre-click sleep、click 后有 post-click sleep（真人节拍）
 */
import { describe, it, expect } from 'vitest'
const { planMove, planClickSequence, planType } = require('./behavior-engine.js')

describe('behavior-engine 几何不变量', () => {
  it('确定性：同 seed 同轨迹', () => {
    const a = planMove(0, 0, 300, 200, { seed: 42 })
    const b = planMove(0, 0, 300, 200, { seed: 42 })
    expect(a.points).toEqual(b.points)
  })

  it('异种子异轨迹（防固化指纹）', () => {
    const a = planMove(0, 0, 300, 200, { seed: 1 })
    const b = planMove(0, 0, 300, 200, { seed: 2 })
    expect(a.points).not.toEqual(b.points)
  })

  it('起终点命中（末点即目标点，首点即起点）', () => {
    const r = planMove(10, 20, 310, 220, { seed: 7 })
    expect(r.points[0]).toMatchObject({ x: 10, y: 20 })
    const last = r.points[r.points.length - 1]
    expect(Math.round(last.x)).toBe(310)
    expect(Math.round(last.y)).toBe(220)
  })

  it('步数有界且随距离增长', () => {
    const short = planMove(0, 0, 20, 0, { seed: 3 })
    const long = planMove(0, 0, 800, 0, { seed: 3 })
    expect(short.points.length).toBeGreaterThanOrEqual(5)
    expect(long.points.length).toBeGreaterThan(short.points.length)
    expect(long.points.length).toBeLessThanOrEqual(120) // min/max steps 夹紧
  })

  it('单步位移有上限（防瞬移=机器特征）', () => {
    const r = planMove(0, 0, 800, 600, { seed: 9 })
    const dist = Math.hypot(800, 600)
    const maxStep = dist * 0.25 // 任何一步不得超过全程 25%
    for (let i = 1; i < r.points.length; i++) {
      const d = Math.hypot(r.points[i].x - r.points[i - 1].x, r.points[i].y - r.points[i - 1].y)
      expect(d, `step ${i} 位移 ${d.toFixed(1)} 超限`).toBeLessThanOrEqual(maxStep + 0.001)
    }
  })

  it('零距离/负距离不产轨迹（防除零与反向）', () => {
    expect(planMove(5, 5, 5, 5, { seed: 1 }).points.length).toBe(0)
  })

  it('轨迹单调推进（不回折——真人鼠标不回走）', () => {
    const r = planMove(0, 0, 400, 0, { seed: 11 })
    for (let i = 1; i < r.points.length; i++) {
      expect(r.points[i].x).toBeGreaterThanOrEqual(r.points[i - 1].x - 0.001)
    }
  })

  it('曲率存在：轨迹偏离直线（抓「改线性」变异）', () => {
    const r = planMove(0, 0, 400, 300, { seed: 13 })
    const d = r.diagnostics
    let maxDev = 0
    for (let i = 1; i < r.points.length - 1; i++) {
      const p = r.points[i]
      const progress = i / d.steps
      // 点到直线的垂距（起点-终点）
      const num = Math.abs((d.end.y - d.start.y) * p.x - (d.end.x - d.start.x) * p.y + d.end.x * d.start.y - d.end.y * d.start.x)
      const dev = num / Math.hypot(d.end.x - d.start.x, d.end.y - d.start.y)
      maxDev = Math.max(maxDev, dev)
    }
    expect(maxDev, '轨迹必须偏离直线（贝塞尔曲率）').toBeGreaterThan(Math.hypot(400, 300) * 0.02)
  })

  it('微扰存在且不越界（抓「摘 wobble」变异）：点相对纯贝塞尔曲线的偏移 ∈ (0, wobbleAmp]', () => {
    const r = planMove(0, 0, 400, 300, { seed: 17 })
    const d = r.diagnostics
    const { cubicBezier, easeInOut } = require('./behavior-engine.js')._internals
    const perp = d.unitPerpendicular
    let maxWobble = 0
    for (let i = 0; i < r.points.length; i++) {
      const p = r.points[i]
      const progress = i / d.steps
      const pure = cubicBezier(d.start, d.cp1, d.cp2, d.end, easeInOut(progress))
      // 微扰沿垂直方向：偏移量 = 点积(Δp, 单位垂直向量)
      const w = (p.x - pure.x) * perp.px + (p.y - pure.y) * perp.py
      maxWobble = Math.max(maxWobble, Math.abs(w))
      expect(Math.abs(w), `点 ${i} 微扰越界`).toBeLessThanOrEqual(d.wobbleAmp + 0.001)
    }
    expect(maxWobble, '必须存在微扰（非零 wobble）').toBeGreaterThan(0.01)
  })
})

describe('planClickSequence 事件序列（social-auto-upload _native_click 移植）', () => {
  it('完整序列：move* → pointerdown → pointerup（pointer/mouse 全套）', () => {
    const seq = planClickSequence(100, 100, { seed: 5 })
    const kinds = seq.events.map((e) => e.kind)
    expect(kinds.filter((k) => k === 'move').length).toBeGreaterThan(0)
    expect(kinds).toContain('pointerdown')
    expect(kinds).toContain('pointerup')
    // pointerdown 必须晚于所有 move，pointerup 必须晚于 pointerdown
    const lastMove = kinds.lastIndexOf('move')
    expect(kinds.indexOf('pointerdown')).toBeGreaterThan(lastMove)
    expect(kinds.indexOf('pointerup')).toBeGreaterThan(kinds.indexOf('pointerdown'))
    // 全套合成事件（抖音 uc_verification_component 只认这套）
    for (const k of ['pointerover', 'pointerenter', 'mousedown', 'mouseup', 'click']) {
      expect(kinds, `缺合成事件 ${k}`).toContain(k)
    }
  })

  it('pointerdown 事件带 9 关键字段（bubbles/cancelable/composed/clientX/clientY/pointerId/pointerType/isPrimary/button）', () => {
    const seq = planClickSequence(50, 60, { seed: 5 })
    const down = seq.events.find((e) => e.kind === 'pointerdown')
    for (const f of ['bubbles', 'cancelable', 'composed', 'clientX', 'clientY', 'pointerId', 'pointerType', 'isPrimary', 'button']) {
      expect(down, `pointerdown 缺字段 ${f}`).toHaveProperty(f)
    }
    expect(down.pointerType).toBe('mouse')
  })

  it('节奏：pre-click sleep 与 post-click sleep 都在（150ms/200ms 先例）', () => {
    const seq = planClickSequence(0, 0, { seed: 1 })
    expect(seq.preClickSleepMs).toBeGreaterThan(0)
    expect(seq.postClickSleepMs).toBeGreaterThan(0)
  })
})

describe('planType 键程节奏', () => {
  it('逐键事件 + 每键间隔有界（防零延迟 machine-typing）', () => {
    const r = planType('你好ab', { seed: 2 })
    expect(r.events.length).toBe(4)
    for (let i = 1; i < r.events.length; i++) {
      expect(r.events[i].delayMs).toBeGreaterThan(0)
      expect(r.events[i].delayMs).toBeLessThan(300)
    }
  })

  it('空文本不产事件', () => {
    expect(planType('', { seed: 1 }).events.length).toBe(0)
  })
})
