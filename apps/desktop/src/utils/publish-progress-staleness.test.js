// @ts-check
/**
 * publish-progress-staleness 纯逻辑回归锁（ux-audit-progress-watchdog，阶段 1.8）
 *
 * 动因（审计 1.8）：`task.lastEventAt` 由 store 在三处写入（迟到非终态吸收、常规事件、
 * task-complete 兜底），但**渲染层没有任何读者** —— 一个"死观测字段"。后果是任务卡住
 * （主进程不再发事件）时面板永远显示「进行中」、关闭按钮永远 disabled，用户被自己的
 * 进度面板锁住，只能等或重开应用。
 *
 * 本文件锁的是判据本体（阈值 / 锚点 / 相位域 / 取数口径），全部按纯函数注入时钟测试，
 * 不依赖组件与计时器；计时器归组件所有（见 usePublishProgressAutoCollapse 的同源纪律）。
 */
import { describe, it, expect } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import {
  DEFAULT_STALE_AFTER_MS,
  computeStaleInfo,
} from './publish-progress-staleness.js'
import * as stalenessModule from './publish-progress-staleness.js'

const T0 = 1_700_000_000_000 // 固定基准时刻，避免用例受真实时钟影响

/** 构造一份最小会话形态：只声明判据真正读取的字段 */
function session(overrides = {}) {
  return {
    id: 's-1',
    status: 'running',
    createdAt: T0,
    tasks: {},
    ...overrides,
  }
}

function task(overrides = {}) {
  return {
    taskId: 't-1',
    phase: 'progress',
    lastEventAt: T0,
    ...overrides,
  }
}

function withTasks(tasks, overrides = {}) {
  const map = {}
  for (const t of tasks) map[t.taskId] = t
  return session({ tasks: map, ...overrides })
}

/** 判据本体源码（供「不得自带环境变量旋钮」这类结构锁使用） */
function stalenessModuleSource() {
  return fs.readFileSync(path.resolve(__dirname, 'publish-progress-staleness.js'), 'utf-8')
}

/**
 * 只取代码行：注释里允许（并且需要）原样写出「为什么不做什么」的理由，
 * 那是给读者的现场证据；结构锁若连注释一起扫，就会把说明本身判成违规（本仓反复踩过的自指形态）。
 */
function codeLines(src) {
  return src
    .split('\n')
    .filter((line) => !/^\s*(\/\/|\*|\/\*)/.test(line))
    .join('\n')
}

describe('阈值单一真源 + 非法阈值不得演成恒陈旧', () => {
  it('默认阈值 3 分钟（审计 1.8 给定的判据时长）', () => {
    expect(DEFAULT_STALE_AFTER_MS).toBe(180_000)
  })

  it('省略阈值参数即取默认（消费方不需要各自传一份）', () => {
    const sessions = [withTasks([task({ lastEventAt: T0 })])]
    expect(computeStaleInfo(sessions, T0 + 180_000).stale).toBe(true)
    expect(computeStaleInfo(sessions, T0 + 179_999).stale).toBe(false)
  })

  // 坏阈值若被当成「0」用，面板会从「永不解禁」翻成「恒解禁」——两个方向都不可接受，
  // 所以非法取值必须回落默认，而不是就近取一个边界值。
  it.each([NaN, -1, 0, 'abc', null, undefined, Infinity])('非法阈值 %p 回落默认', (bad) => {
    const sessions = [withTasks([task({ lastEventAt: T0 })])]
    expect(computeStaleInfo(sessions, T0 + 1000, bad).stale).toBe(false)
    expect(computeStaleInfo(sessions, T0 + 180_000, bad).stale).toBe(true)
  })

  it('显式合法阈值按配置生效（判据可被整体收紧/放宽而不改逻辑）', () => {
    const sessions = [withTasks([task({ lastEventAt: T0 })])]
    expect(computeStaleInfo(sessions, T0 + 60_000, 60_000).stale).toBe(true)
    expect(computeStaleInfo(sessions, T0 + 60_000, 120_000).stale).toBe(false)
  })

  // ⛔ 本条刻意不做环境变量覆盖：渲染进程没有可用的 env 通道（Vite 在产物里把 process.env
  // 打成空对象桩，实测 src 下只有被静态替换的 process.env.NODE_ENV 能成立）。
  // 名字用拼接构造，否则被禁字面量出现在本断言所在行会让这条锁自己恒红。
  const forbiddenEnv = 'MP_PUBLISH' + '_STALE' + '_MS'
  it('判据本体不得自带环境变量旋钮（避免无人能设的装饰性配置）', () => {
    const code = codeLines(stalenessModuleSource())
    expect(code).not.toContain(forbiddenEnv)
    expect(code).not.toContain('process.env')
  })

  // 本轮实测踩到：测试里 import 了一个不存在的导出名，Vite 转换后不报「没有这个导出」，
  // 只在用到的那一刻抛 ReferenceError。消费方（store/面板）若写错名字，症状会是
  // 「面板永远不陈旧」而不是「编译失败」—— 所以导出面本身必须是被测对象。
  it('导出面契约：消费方使用的两个名字都在，且类型正确', () => {
    expect(Object.keys(stalenessModule).sort()).toEqual([
      'DEFAULT_STALE_AFTER_MS',
      'computeStaleInfo',
    ])
    expect(typeof stalenessModule.computeStaleInfo).toBe('function')
  })
})

describe('computeStaleInfo —— 「无事件即陈旧」的判据本体', () => {
  it('没有运行中的会话：不陈旧（无事可等）', () => {
    expect(computeStaleInfo([], T0 + 9e5, 180_000)).toEqual({
      stale: false, minutes: 0, lastEventAt: null,
    })
    expect(computeStaleInfo([session({ status: 'done' })], T0 + 9e5, 180_000)).toEqual({
      stale: false, minutes: 0, lastEventAt: null,
    })
  })

  it('边界：恰好等于阈值判陈旧，差 1ms 不判', () => {
    expect(computeStaleInfo([withTasks([task({ lastEventAt: T0 })])], T0 + 180_000, 180_000).stale).toBe(true)
    expect(computeStaleInfo([withTasks([task({ lastEventAt: T0 })])], T0 + 179_999, 180_000).stale).toBe(false)
  })

  it('跨任务取「最近一次事件」：任一任务刚有事件就不算无更新', () => {
    const sessions = [withTasks([
      task({ taskId: 't-old', lastEventAt: T0 }),
      task({ taskId: 't-fresh', lastEventAt: T0 + 170_000 }),
    ])]
    expect(computeStaleInfo(sessions, T0 + 185_000, 180_000).stale).toBe(false)
    // 新鲜任务进入终态后，剩下的停滞任务重新成为判据对象
    const afterTerminal = [withTasks([
      task({ taskId: 't-old', lastEventAt: T0 }),
      task({ taskId: 't-fresh', phase: 'success', lastEventAt: T0 + 170_000 }),
    ])]
    expect(computeStaleInfo(afterTerminal, T0 + 185_000, 180_000).stale).toBe(true)
  })

  it('终态任务与终态会话一律不参与判定（已结束的不再等更新）', () => {
    const phases = ['success', 'failed', 'cancelled']
    for (const phase of phases) {
      expect(computeStaleInfo([withTasks([task({ phase, lastEventAt: T0 })])], T0 + 9e5, 180_000).stale)
        .toBe(false)
    }
    // 会话已 done：即便内部还有非终态任务（异常形态）也不催更
    expect(computeStaleInfo([withTasks([task()], { status: 'done' })], T0 + 9e5, 180_000).stale).toBe(false)
  })

  it('非终态相位（queued/progress/start/blocked）都在射程内', () => {
    for (const phase of ['queued', 'progress', 'start', 'blocked']) {
      const info = computeStaleInfo([withTasks([task({ phase, lastEventAt: T0 })])], T0 + 300_000, 180_000)
      expect(info.stale, phase).toBe(true)
    }
  })

  it('lastEventAt 缺席（登记后尚未收到任何事件）回落会话登记时刻，不得当作「刚有事件」', () => {
    const sessions = [withTasks([task({ lastEventAt: null })], { createdAt: T0 })]
    expect(computeStaleInfo(sessions, T0 + 180_000, 180_000).stale).toBe(true)
    expect(computeStaleInfo(sessions, T0 + 179_000, 180_000).stale).toBe(false)
  })

  it('锚点完全取不到时不判陈旧（无判据即不产出结论，也不谎报）', () => {
    const sessions = [withTasks([task({ lastEventAt: null })], { createdAt: null })]
    expect(computeStaleInfo(sessions, T0 + 9e5, 180_000)).toEqual({
      stale: false, minutes: 0, lastEventAt: null,
    })
  })

  it('minutes 为「已过去的整分钟」且陈旧时至少为 1（不得显示「0 分钟无更新」）', () => {
    expect(computeStaleInfo([withTasks([task({ lastEventAt: T0 })])], T0 + 180_000, 180_000).minutes).toBe(3)
    expect(computeStaleInfo([withTasks([task({ lastEventAt: T0 })])], T0 + 185_000, 180_000).minutes).toBe(3)
    expect(computeStaleInfo([withTasks([task({ lastEventAt: T0 })])], T0 + 370_000, 180_000).minutes).toBe(6)
    // 自定义阈值下同样成立：60s 阈值、90s 无事件 ⇒ 陈旧且至少 1 分钟
    expect(computeStaleInfo([withTasks([task({ lastEventAt: T0 })])], T0 + 90_000, 60_000)).toEqual({
      stale: true, minutes: 1, lastEventAt: T0,
    })
    // 阈值小于 1 分钟时 elapsed 不足 60s：不钳位就会输出「已 0 分钟无更新」
    expect(computeStaleInfo([withTasks([task({ lastEventAt: T0 })])], T0 + 45_000, 30_000)).toEqual({
      stale: true, minutes: 1, lastEventAt: T0,
    })
  })

  it('lastEventAt 如实回显被采纳的锚点（现场取证用）', () => {
    const info = computeStaleInfo([
      withTasks([task({ taskId: 'a', lastEventAt: T0 + 1000 })], { id: 's-1' }),
      withTasks([task({ taskId: 'b', lastEventAt: T0 + 5000 })], { id: 's-2' }),
    ], T0 + 9e5, 180_000)
    expect(info.lastEventAt).toBe(T0 + 5000)
  })

  it('多会话取全局最近事件（面板整体只问「还有没有动静」）', () => {
    const sessions = [
      withTasks([task({ taskId: 'a', lastEventAt: T0 })], { id: 's-1' }),
      withTasks([task({ taskId: 'b', lastEventAt: T0 + 175_000 })], { id: 's-2' }),
    ]
    expect(computeStaleInfo(sessions, T0 + 180_000, 180_000).stale).toBe(false)
  })

  it('脏数据不抛错：非数组、null 会话、tasks 非对象一律按无结论处理', () => {
    expect(computeStaleInfo(null, T0, 180_000).stale).toBe(false)
    expect(computeStaleInfo([null, undefined], T0, 180_000).stale).toBe(false)
    expect(computeStaleInfo([session({ tasks: null })], T0 + 9e5, 180_000).stale).toBe(false)
    // 任务对象连 lastEventAt 这个键都没有：与「有键但为 null」同判（回落会话登记时刻），
    // 不得因为字段缺席就当「刚有事件」而永远不陈旧。
    expect(computeStaleInfo([withTasks([{ taskId: 'x', phase: 'progress' }])], T0 + 9e5, 180_000).stale).toBe(true)
  })

  it('时间跳变防御：锚点在未来（now < lastEventAt）不判陈旧也不给负分钟', () => {
    const info = computeStaleInfo([withTasks([task({ lastEventAt: T0 + 50_000 })])], T0, 180_000)
    expect(info.stale).toBe(false)
    expect(info.minutes).toBe(0)
    expect(info.lastEventAt).toBe(T0 + 50_000)
  })
})

/**
 * 接线锁（真跑，不是「读一眼源码」）：判据必须被消费方实际调用。
 * 动因是本仓反复出现的「实现正确 + 单测全绿，但装配路径上没人调用」，
 * 以及本条要消灭的原状 —— `task.lastEventAt` 写了却没人读。
 */
describe('接线：判据只有一个真源，消费方不得各抄一份阈值', () => {
  it('组合式与面板都引用共享实现', () => {
    const composableSrc = fs.readFileSync(
      path.resolve(__dirname, '../composables/usePublishProgressStaleness.js'), 'utf-8')
    const panelSrc = fs.readFileSync(
      path.resolve(__dirname, '../components/PublishProgressPanel.vue'), 'utf-8')
    expect(composableSrc).toContain('publish-progress-staleness')
    expect(panelSrc).toContain('usePublishProgressStaleness')
  })

  // 阈值一旦在两个文件里各写一份，改一处就会静默漂移（面板显示 3 分钟、判据按别的分钟数走）
  it.each([
    ['组合式', '../composables/usePublishProgressStaleness.js'],
    ['面板', '../components/PublishProgressPanel.vue'],
    ['store', '../stores/publishProgress.js'],
  ])('%s 源码的代码行不得自带 180000 这个阈值字面量', (_label, rel) => {
    const code = codeLines(fs.readFileSync(path.resolve(__dirname, rel), 'utf-8'))
    expect(code).not.toMatch(/18[\s_]*0[\s_]*0[\s_]*0/)
  })
})
