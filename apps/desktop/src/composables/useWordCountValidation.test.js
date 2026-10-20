/**
 * 字数区间校验 composable 单测（collect-rewrite-wordcount，2026-10-20）。
 *
 * 为什么要有这个文件：本次事故的根因之一是「**校验用的值**」与「**下发用的值**」分家——
 * 页面用 `Number(min) || 800` 自行折算，把合法下限 0 吞成 800。
 * `useWordCountValidation` 现在同时产出两者（`error` 与 `range`），
 * 这个文件锁住「两者永远同源」这条契约：error 非空 ⇒ range 必为 null（调用方必须早退）。
 */
import { describe, it, expect } from 'vitest'
import { ref } from 'vue'
import { useWordCountValidation } from './useWordCountValidation'

function setup (min, max) {
  const minRef = ref(min)
  const maxRef = ref(max)
  const { error, range } = useWordCountValidation(minRef, maxRef, (key) => 'ERR:' + key)
  return { minRef, maxRef, error, range }
}

describe('useWordCountValidation — 校验结论与可下发值同源', () => {
  it('默认 800-2000：error 为空，range 就是该下发的值', () => {
    const { error, range } = setup(800, 2000)
    expect(error.value).toBe('')
    expect(range.value).toEqual({ min: 800, max: 2000 })
  })

  it('合法下限 0 必须原样保留（不被吞成 800）', () => {
    const { error, range } = setup(0, 6000)
    expect(error.value).toBe('')
    expect(range.value).toEqual({ min: 0, max: 6000 })
  })

  it('空输入 ⇒ error 非空且 range 为 null（Number(空串)===0 的陷阱必须被拦）', () => {
    const { error, range } = setup('', 2000)
    expect(error.value).toBe('ERR:wordCountMinInvalid')
    expect(range.value).toBeNull()
  })

  it('浮点下限 1.5 ⇒ 判非法、range 为 null（不得进引擎）', () => {
    const { error, range } = setup(1.5, 6000)
    expect(error.value).toBe('ERR:wordCountMinInvalid')
    expect(range.value).toBeNull()
  })

  it('max < min ⇒ 判非法、range 为 null', () => {
    const { error, range } = setup(6000, 100)
    expect(error.value).toBe('ERR:wordCountMaxLtMin')
    expect(range.value).toBeNull()
  })

  it('max 越界（0 / 50001）⇒ 判非法、range 为 null', () => {
    expect(setup(0, 0).error.value).toBe('ERR:wordCountMaxInvalid')
    expect(setup(0, 50001).error.value).toBe('ERR:wordCountMaxInvalid')
    expect(setup(0, 0).range.value).toBeNull()
  })

  it('min 越界（-1 / 50000）⇒ 判非法、range 为 null', () => {
    expect(setup(-1, 2000).error.value).toBe('ERR:wordCountMinInvalid')
    expect(setup(50000, 50000).error.value).toBe('ERR:wordCountMinInvalid')
    expect(setup(-1, 2000).range.value).toBeNull()
  })

  it('改值后 error 与 range 同步跟随（同一判定源）', () => {
    const { minRef, error, range } = setup(800, 2000)
    expect(range.value).toEqual({ min: 800, max: 2000 })
    minRef.value = 0
    expect(error.value).toBe('')
    expect(range.value).toEqual({ min: 0, max: 2000 })
  })
})
