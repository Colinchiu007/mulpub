/**
 * useNotify 的 toast 规范单点化（UX 审计 2.7 首批）
 *
 * 本文件只锁"调用方传了但过去被静默丢掉"的那几格：
 *   - duration：过去整条链路无人消费，调用方写 `{duration: 8000}` 与不写完全同形
 *   - grouping：过去从不传 ⇒ 同一句文案连发会堆成一片
 *   - 未知 level：过去 `if (show) show()` 静默 no-op，**却照样 reportNotify 并返回文案**
 *     —— 日志说"已通知"，屏幕上什么都没有，这是本文件要钉死的主形态
 *   - 非 error 级 key 未命中：过去 return '' 且零痕迹，调用方拼错 key 后永久静默
 *
 * ⛔ 本文件不复用 useNotify.test.js 的 mock 形状：那份的 `elMessage` 只挂了四个糖方法，
 * 而 element-plus 的 `ElMessage.success(params)` 允许对象形态，夹具必须能记下整个实参。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  elMessage: {
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
    error: vi.fn(),
  },
  elMessageBox: { confirm: vi.fn() },
}))

vi.mock('element-plus', () => ({
  ElMessage: mocks.elMessage,
  ElMessageBox: mocks.elMessageBox,
}))

vi.mock('@/api/electron-bridge', () => ({
  invoke: vi.fn(),
}))

import { ElMessage } from 'element-plus'
import { invoke } from '@/api/electron-bridge'
import { useNotify } from './useNotify'

// 取真实存在的文案 key（不硬编码中文，避免 locale 文案调整时假红）
const KEY_SUCCESS = 'story2video.export_completed'
const KEY_INFO = 'story2video.path_copied'
// 坏 key 必须逐用例唯一：未命中留痕按 key 去重（模块级 Set 跨用例存活），
// 复用同一个 key 会让"必须留痕"与"只出一次"两条用例互相抵消 —— 那测的是执行顺序，不是行为。
let missingSeq = 0
const missingToastKey = () => 'no.such.key.for.toast.spec-' + (++missingSeq)

/** 把 objectContaining 的断言收敛成一个读取器：实参可能是字符串（旧形态）或对象（新形态） */
function lastCall (fn) {
  const args = fn.mock.calls[fn.mock.calls.length - 1]
  if (!args) throw new Error('该 ElMessage 方法一次都没被调用 —— 用户什么都没看到')
  const arg = args[0]
  return typeof arg === 'string' ? { message: arg } : arg
}

describe('useNotify — toast 规范单点化（duration / grouping / level / 未命中）', () => {
  let warn
  let n

  beforeEach(() => {
    vi.clearAllMocks()
    invoke.mockResolvedValue({ code: 0, data: true })
    warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    n = useNotify()
  })

  afterEach(() => {
    warn.mockRestore()
  })

  it('调用方给的 duration 必须真的到达 ElMessage（过去被整条丢掉）', () => {
    n.notify(KEY_INFO, { level: 'info', duration: 1500 })
    const call = lastCall(ElMessage.info)
    expect(typeof call.message).toBe('string')
    expect(call.message.length, '文案本身不得在改造实参形态时丢掉').toBeGreaterThan(0)
    expect(call.duration, 'duration 被丢掉时用户看到的仍是默认 3s，而调用方以为生效了').toBe(1500)
  })

  it('duration 超上限时夹到上限并出声（不静默采纳，也不静默丢弃）', () => {
    n.notify(KEY_INFO, { level: 'info', duration: 99999 })
    const call = lastCall(ElMessage.info)
    expect(call.duration).toBeLessThanOrEqual(8000)
    expect(call.duration).toBeGreaterThan(0)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('duration'))
  })

  it('duration 是非法值（NaN / 负数 / 字符串）时回落默认 3000 并出声，不得当成"未指定"静默通过', () => {
    for (const bad of [NaN, -5, 'fast']) {
      ElMessage.info.mockClear()
      warn.mockClear()
      n.notify(KEY_INFO, { level: 'info', duration: bad })
      const call = lastCall(ElMessage.info)
      expect(call.duration, `非法值 ${String(bad)} 不得被静默采纳`).toBe(3000)
      expect(warn).toHaveBeenCalledWith(expect.stringContaining('duration'))
    }
  })

  it('每条 toast 都开 grouping（同一句连发不得堆成一片）', () => {
    n.notifySuccess(KEY_SUCCESS)
    n.notify(KEY_INFO, { level: 'warning' })
    n.notify(KEY_INFO, { level: 'error' })
    expect(ElMessage.success).toHaveBeenCalledTimes(1)
    expect(lastCall(ElMessage.warning).grouping, 'grouping 缺省时 element-plus 默认 false，同一句会叠三条').toBe(true)
    expect(lastCall(ElMessage.error).grouping).toBe(true)
    expect(lastCall(ElMessage.success).grouping).toBe(true)
  })

  it('未知 level 必须出声并按 info 展示 —— 禁止"日志说报了、屏幕上什么都没有"', () => {
    const text = n.notify(KEY_INFO, { level: 'notif' })
    expect(ElMessage.info, '未知 level 过去走 if (show) show() 的静默 no-op').toHaveBeenCalledTimes(1)
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('notif'))
    expect(typeof text).toBe('string')
  })

  it('非 error 级 key 未命中时返回空串但必须留痕（过去完全静默）', () => {
    const badKey = missingToastKey()
    const text = n.notify(badKey, { level: 'info' })
    expect(text).toBe('')
    expect(ElMessage.info).not.toHaveBeenCalled()
    expect(warn, '拼错 key 的调用点过去在运行日志里零痕迹，只能靠用户报"哪里没提示"').toHaveBeenCalledWith(
      expect.stringContaining(badKey)
    )
  })

  it('未命中留痕按 key 去重：同一个坏 key 刷屏时只出声一次，不同 key 各出一次', () => {
    const dupKey = missingToastKey()
    warn.mockClear()
    n.notify(dupKey, { level: 'info' })
    n.notify(dupKey, { level: 'info' })
    expect(warn).toHaveBeenCalledTimes(1)
    n.notify(missingToastKey(), { level: 'info' })
    expect(warn).toHaveBeenCalledTimes(2)
  })

  it('环境变量可覆盖上限，非法覆盖值回落默认并出声（对齐仓内频控/队列的 env 纪律）', async () => {
    const prev = process.env.MP_NOTIFY_MAX_DURATION_MS
    process.env.MP_NOTIFY_MAX_DURATION_MS = '12000'
    ElMessage.info.mockClear()
    n.notify(KEY_INFO, { level: 'info', duration: 20000 })
    expect(lastCall(ElMessage.info).duration).toBe(12000)
    process.env.MP_NOTIFY_MAX_DURATION_MS = 'abc'
    ElMessage.info.mockClear()
    warn.mockClear()
    n.notify(KEY_INFO, { level: 'info', duration: 20000 })
    expect(lastCall(ElMessage.info).duration, '非法上限不得变成 NaN 或 0').toBeLessThanOrEqual(8000)
    expect(warn).toHaveBeenCalled()
    if (prev === undefined) delete process.env.MP_NOTIFY_MAX_DURATION_MS
    else process.env.MP_NOTIFY_MAX_DURATION_MS = prev
  })
})
