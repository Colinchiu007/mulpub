import { describe, it, expect } from 'vitest'
import { reduceAggregate } from './publish-progress-aggregate'

const TERMINAL = new Set(['success', 'failed', 'cancelled'])

// 纯函数夹具：只给 reduceAggregate 真正消费的字段（phase / percent），
// 不复制 store 的任务全形状——那会让"字段缺席"这一类缺陷对测试免疫。
function session (tasks) {
  return { tasks }
}

function task (phase, percent) {
  return { phase, percent }
}

describe('reduceAggregate — 软权重口径（阶段 2.5 / audit-14）', () => {
  it('空输入：全 0，绝不 NaN / 除零', () => {
    const r = reduceAggregate([], { terminalPhases: TERMINAL })
    expect(r).toMatchObject({ total: 0, done: 0, running: 0, step: 0, progressPercent: 0 })
    expect(Number.isFinite(r.softDone)).toBe(true)
  })

  it('权重表：终态 1 / 在跑按 percent / 无 percent 给最小可见量 / 排队 0', () => {
    const cases = [
      [task('success', 100), 1],
      [task('failed', 12), 1],
      [task('cancelled', 0), 1],
      [task('progress', 40), 0.4],
      [task('progress', 95), 0.95],
      [task('progress', 100), 0.95],
      [task('progress', null), 0.05],
      [task('progress', -5), 0.05],
      [task('start', 0), 0.05],
      [task('queued', null), 0]
    ]
    for (const [t, want] of cases) {
      const r = reduceAggregate([session({ 't-1': t })], { terminalPhases: TERMINAL })
      expect(r.softDone, JSON.stringify(t)).toBeCloseTo(want, 5)
    }
  })

  it('done 只数终态：在跑 99% 也不进 done（"已完成"必须是真完成数）', () => {
    const r = reduceAggregate([session({ a: task('progress', 99) })], { terminalPhases: TERMINAL })
    expect(r.done).toBe(0)
    expect(r.running).toBe(1)
    expect(r.step).toBe(1)
    // 99% 也被压到 95：上限是"没落终态就不许贴满"，不是按 percent 原样透传
    expect(r.progressPercent).toBe(95)
  })

  it('step：有在跑的是"当前这一项"，全终态时收口到 total', () => {
    const mixed = reduceAggregate([session({ a: task('success', 100), b: task('progress', 50), c: task('queued', null), d: task('queued', null) })], { terminalPhases: TERMINAL })
    expect(mixed).toMatchObject({ total: 4, done: 1, running: 1, step: 2 })
    expect(mixed.progressPercent).toBe(38) // (1 + 0.5)/4 = 37.5 → 38，排队两条各 0
    const allDone = reduceAggregate([session({ a: task('success', 100), b: task('cancelled', 30) })], { terminalPhases: TERMINAL })
    expect(allDone).toMatchObject({ running: 0, step: 2, progressPercent: 100 })
  })

  it('percent 是字符串数字也按数值处理，但非法串不产生 NaN', () => {
    const r = reduceAggregate([session({ a: task('progress', '50') })], { terminalPhases: TERMINAL })
    expect(r.progressPercent).toBe(50)
    const bad = reduceAggregate([session({ a: task('progress', 'abc') })], { terminalPhases: TERMINAL })
    expect(Number.isFinite(bad.softDone)).toBe(true)
    expect(bad.softDone).toBeCloseTo(0.05, 5)
  })

  it('terminalPhases 必须与内部计数用的三个终态串同集（已知耦合，写成断言而不是注释）', () => {
    const phases = ['success', 'failed', 'cancelled']
    for (const p of phases) {
      const r = reduceAggregate([session({ a: task(p, 30) })], { terminalPhases: new Set(phases) })
      expect(r.done, p + ' 应计入 done').toBe(1)
      expect(r.softDone, p + ' 权重应为 1').toBeCloseTo(1, 5)
      expect(r.progressPercent).toBe(100)
    }
    // 传一个**不含**这三个串的集合会造出 done=1 而权重 0.95 的自相矛盾。
    // 生产不可达（store 传的就是 TERMINAL_PHASES = 这三个），所以这里把它锁成
    // "调用方不得缩集"的现场证据，而不是把它当可配置行为。
    const bad = reduceAggregate([session({ a: task('success', 30) })], { terminalPhases: new Set() })
    expect(bad.done).toBe(1)
    expect(bad.softDone).toBeCloseTo(0.3, 5)
  })

  it('跨会话累加（多个批量会话共用一条总进度）', () => {
    const r = reduceAggregate(
      [session({ a: task('success', 100) }), session({ b: task('progress', 20) })],
      { terminalPhases: TERMINAL }
    )
    expect(r).toMatchObject({ total: 2, done: 1, running: 1, step: 2 })
    expect(r.progressPercent).toBe(60)
  })
})

// 装配锁：抽出后必须真的被 store 消费。"文件存在 + 单测绿"不等于接了线——
// 本仓把这一类记作「注册≠注入≠生效」，反例是同一份纯函数被抄回视图里继续用。
describe('reduceAggregate — 接线锁', () => {
  it('store 通过 reduceAggregate 计算 aggregate，且把自己那份终态集合传进来', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/stores/publishProgress.js'), 'utf8')
    expect(src).toMatch(/import \{ reduceAggregate \} from '\.\/publish-progress-aggregate'/)
    expect(src).toMatch(/const aggregate = computed\(\(\) => reduceAggregate\(sessions\.value, \{ terminalPhases: TERMINAL_PHASES \}\)\)/)
    // store 内不得再自带第二份权重实现（软权重常量只允许住在本模块）
    expect(src).not.toMatch(/RUNNING_WEIGHT_CAP/)
    expect(src).not.toMatch(/STARTED_WEIGHT/)
  })
})
