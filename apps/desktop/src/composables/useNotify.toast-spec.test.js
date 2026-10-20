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
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

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
import { useNotify, __resetNotifyDiagnostics } from './useNotify'

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
    // 去重集合是模块级状态：不复位，"撞过上限"的那条用例会把它的影响漏给后面每一条
    // （实测：上限用例之后，notifyConfirm 的未命中留痕再也打不出来 —— 红的还是别的用例）。
    __resetNotifyDiagnostics()
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

  it('上限是代码常量，渲染进程**没有** env 覆盖通道（QM-6 critic 轴 i1：可覆盖是假的）', async () => {
    // 现场取证（不是推演）：`npx vite build` 后 `dist/assets/index-*.js` 里是 `var lK={}`
    // 与 `const e=lK.MP_NOTIFY_MAX_DURATION_MS` —— Vite 把渲染进程的 `process.env.X` 注成**空对象桩**，
    // 所以"用环境变量放宽上限"在生产里永远读到 undefined ⇒ 一条假的功能比没有功能更坏，
    // 因为测试环境（node）里它可覆盖、可断言，全绿。锁的口径因此打在**源码**上。
    const raw = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'useNotify.js'), 'utf8')
    // 只量**代码**：解释性注释里必须原样引用 `process.env` 这个被禁写法，否则说不清为什么禁
    // （按整份文件匹配会把自己解释洞的那段注释打成违规 —— 同族坑已在仓内出现三次）。
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
    expect(code, 'useNotify 一旦被改回读 process.env，就是重新制造"vitest 里真、生产里假"的那一格')
      .not.toMatch(/process\s*\.\s*env/)
    // 常量语义仍在：超上限夹到 8000 并出声，且不因"没有 env"而退化成不夹
    ElMessage.info.mockClear()
    warn.mockClear()
    n.notify(KEY_INFO, { level: 'info', duration: 20000 })
    expect(lastCall(ElMessage.info).duration, '无 env 通道时上限必须仍是硬夹住，而不是放任不消失').toBe(8000)
    expect(warn, '夹住必须出声').toHaveBeenCalled()
  })

  it('「没展示东西」的两种成因必须分别归因，且去重键不得互相污染（critic 轴 i2）', () => {
    // ① key 未命中 ② 调用方直传的 message 仍是 i18n key 形态被守卫拦下。
    // 过去两者都报「messageKey 未命中」⇒ 归因错，且按 key 记进去重集合后，
    // 同一个 key 的**真未命中**会被这次误报永久静默。
    const leakedKey = 'operation_failed'
    warn.mockClear()
    const t1 = n.notify(leakedKey, { level: 'info', message: 'some.nother.raw_key' })
    expect(t1).toBe('')
    const blockedMsg = warn.mock.calls.map((c) => String(c[0])).find((s) => s.includes('i18n key shape'))
    expect(blockedMsg, '被守卫拦下必须写成"leak guard"，不得谎报成 locales 未命中').toBeTruthy()
    expect(blockedMsg).not.toContain('not found in locales')
    // ② 之后同一 key 走真未命中路径，必须还能出声（证明两种成因没共用一个去重桶）
    warn.mockClear()
    const badKey = missingToastKey()
    n.notify(badKey, { level: 'info' })
    const missMsg = warn.mock.calls.map((c) => String(c[0])).find((s) => s.includes('not found in locales'))
    expect(missMsg, '真未命中必须单独成一条，且带上那个 key').toContain(badKey)
  })

  it('去重集合有上界：动态 key 刷屏时不得无界增长（critic 轴 i3）', () => {
    warn.mockClear()
    const before = warn.mock.calls.length
    for (let i = 0; i < 260; i++) n.notify('dyn.missing.key.' + i, { level: 'info' })
    const after = warn.mock.calls.length
    const announced = warn.mock.calls.map((c) => String(c[0])).some((s) => s.includes('dedup set reached'))
    expect(announced, '撞到上界必须出声一次，不得静默变成"再也不报"').toBe(true)
    expect(after - before, `去重集合上界 200，实测新增了 ${after - before} 条出声`).toBeLessThanOrEqual(201)
    // 上界之后再来一个**已记过**的 key 仍不得出声（这是去重在起作用，不是全局静音）
    warn.mockClear()
    n.notify('dyn.missing.key.0', { level: 'info' })
    expect(warn).not.toHaveBeenCalled()
  })

  it('notifyConfirm 文案未命中时必须留痕——「用户没看到确认框」不等于「用户点了取消」', async () => {
    warn.mockClear()
    const badKey = missingToastKey()
    const r = await n.notifyConfirm(badKey)
    expect(r).toBe(false)
    expect(warn, '过去这里直接 return false、日志零痕迹').toHaveBeenCalledWith(expect.stringContaining(badKey))
    expect(ElMessageBoxConfirmCalls(), '未命中不得真的弹出确认框').toBe(0)
  })
})

function ElMessageBoxConfirmCalls () {
  return mocks.elMessageBox.confirm.mock.calls.length
}
