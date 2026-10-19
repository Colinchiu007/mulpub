// @ts-check
/**
 * toast-policy 合同（UX 审计 §16.2 的口径 ①②）。
 *
 * 每条都对应一个"如果写反就会静默改变用户可见行为"的落点：
 *  ① 0 必须被当合法值（element-plus 文档：duration=0 即常驻）—— 当成非法就会把
 *     "要常驻"静默变成 3 秒消失，而且没有任何报错；
 *  ② 上限只夹显式请求，默认值不再夹一次 —— 否则"默认 6000"与"上限"互相定义，
 *     改一个数会同时改变两件事；
 *  ③ 非法值必须回落 + 出声（fellBack=true），不得静默 —— 静默等于"我传的时长没生效"永远不被知道；
 *  ④ 未知 level 不得抛错（toast 是旁路，策略层抛错会让一次通知打挂调用方流程）。
 */
import { describe, it, expect } from 'vitest'
import {
  TOAST_DEFAULT_DURATION_MS,
  TOAST_MAX_DURATION_MS,
  resolveToastDuration,
  resolveToastGrouping,
  resolveToastType,
  TOAST_TYPE_BY_LEVEL,
} from './toast-policy'

describe('toast-policy：默认档位', () => {
  it('四档 + warn 别名的默认时长是精确表，不是"大约"', () => {
    expect(TOAST_DEFAULT_DURATION_MS).toEqual({
      success: 2000, info: 3000, warning: 4000, warn: 4000, error: 6000,
    })
  })
  it('默认表被冻结（防运行时被某个调用点顺手改掉）', () => {
    expect(Object.isFrozen(TOAST_DEFAULT_DURATION_MS)).toBe(true)
  })
  it('上限必须大于所有默认档（否则默认值自己会被夹）', () => {
    for (const v of Object.values(TOAST_DEFAULT_DURATION_MS)) {
      expect(TOAST_MAX_DURATION_MS).toBeGreaterThan(v)
    }
  })
})

describe('toast-policy：resolveToastDuration', () => {
  it('缺省请求 ⇒ 用该档默认，且不算回落', () => {
    for (const [level, ms] of Object.entries(TOAST_DEFAULT_DURATION_MS)) {
      const r = resolveToastDuration(level, undefined)
      expect(r.ms, level).toBe(ms)
      expect(r.fellBack, level).toBe(false)
    }
  })

  it('0 是合法值（常驻），并如实标 reason=PERSISTENT、不出声', () => {
    expect(resolveToastDuration('error', 0)).toEqual({ ms: 0, fellBack: false, reason: 'PERSISTENT' })
  })

  it('显式且在区间内 ⇒ 原样采纳', () => {
    expect(resolveToastDuration('success', 2500).ms).toBe(2500)
    expect(resolveToastDuration('success', TOAST_MAX_DURATION_MS).ms).toBe(TOAST_MAX_DURATION_MS)
  })

  it('超过上限 ⇒ 夹到上限并标 CLAMPED_TO_MAX（这是回落，必须能被判红）', () => {
    const r = resolveToastDuration('info', TOAST_MAX_DURATION_MS + 1)
    expect(r).toEqual({ ms: TOAST_MAX_DURATION_MS, fellBack: true, reason: 'CLAMPED_TO_MAX' })
  })

  it('非数值 / 负数 / NaN / Infinity 一律回落默认并出声', () => {
    for (const bad of [-1, -0.5, 'soon', NaN, Infinity, -Infinity, {}, [], true]) {
      const r = resolveToastDuration('warning', bad)
      expect(r.ms, JSON.stringify(bad)).toBe(4000)
      expect(r.fellBack, JSON.stringify(bad)).toBe(true)
    }
  })

  it('未知 level 不抛错，落 info 档；0 仍然被尊重', () => {
    expect(resolveToastDuration('huh', undefined).ms).toBe(TOAST_DEFAULT_DURATION_MS.info)
    expect(resolveToastDuration('huh', 5000).ms).toBe(5000)
    expect(resolveToastDuration('huh', 0).ms).toBe(0)
  })
})

describe('toast-policy：resolveToastGrouping', () => {
  it('默认开（审计现场的"刷屏"就是同一句话堆成一片）', () => {
    expect(resolveToastGrouping(undefined)).toBe(true)
    expect(resolveToastGrouping(null)).toBe(true)
    expect(resolveToastGrouping('anything-not-false')).toBe(true)
  })
  it('只有显式 false 才关（保留"必须各弹一次"的场景）', () => {
    expect(resolveToastGrouping(false)).toBe(false)
    expect(resolveToastGrouping(true)).toBe(true)
  })
})

describe('toast-policy：resolveToastType（档位词表的唯一落点）', () => {
  // 这一族是本批实测过的一处收窄：出口原先自己列了 `['success','info','warning','error']`，
  // 而 `warn` 是 useNotify JSDoc 承认的合法 level（也是本仓历史别名）⇒ `level:'warn'` 静默变 info。
  it('warn 是 warning 的历史别名，必须映射到 warning 而不是掉成 info', () => {
    expect(resolveToastType('warn')).toBe('warning')
    expect(resolveToastType('warning')).toBe('warning')
  })
  it('四档原样映射，未知 level 落 info（与时长口径一致：不抛错）', () => {
    expect(resolveToastType('success')).toBe('success')
    expect(resolveToastType('info')).toBe('info')
    expect(resolveToastType('error')).toBe('error')
    expect(resolveToastType('huh')).toBe('info')
    expect(resolveToastType(undefined)).toBe('info')
  })
  it('词表键集必须与默认时长表逐字相同（两张表各存一份必漂移，这是那条防漂移的锁）', () => {
    expect(Object.keys(TOAST_TYPE_BY_LEVEL).sort()).toEqual(Object.keys(TOAST_DEFAULT_DURATION_MS).sort())
  })
  it('词表被冻结（防运行时被某个调用点顺手改掉）', () => {
    expect(Object.isFrozen(TOAST_TYPE_BY_LEVEL)).toBe(true)
  })
})
