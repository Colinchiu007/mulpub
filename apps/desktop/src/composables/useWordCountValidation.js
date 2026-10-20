import { computed } from 'vue'
import { REWRITE_ENGINE_MAX_INPUT_CHARS, REWRITE_ENGINE_MAX_OUTPUT_CHARS } from '@/utils/rewrite-engine-limits'

/**
 * 字数区间校验（文案改写页 / 采集页共用）
 *
 * 契约（rewrite-limits-50000，2026-10-19）：min 0-49999 整数、max 1-50000 整数、
 * max >= min；默认 800-2000。上界单一真源 = 引擎 MAX_OUTPUT_CHARS（经
 * rewrite-engine-limits.js 的结构锁对齐），不在本文件写死数字。
 * 错误文案经 resolveError(key) 解析（调用方传入 locale/notify 适配器，
 * 兼容 vue-i18n 的 t() 与 notifyCore 的 resolveNotifyText().text 两种来源）。
 *
 * @param {import('vue').Ref<number|''>} minRef - 最小字数（v-model.number，清空时为 ''）
 * @param {import('vue').Ref<number|''>} maxRef - 最大字数
 * @param {(key: string) => string} resolveError - 错误文案解析器
 * @returns {{ error: import('vue').ComputedRef<string>, range: import('vue').ComputedRef<{min:number,max:number}|null> }}
 */
export function useWordCountValidation(minRef, maxRef, resolveError) {
  const error = computed(() => {
    const min = minRef.value
    const max = maxRef.value
    // v-model.number + type=number 清空时值为 ''（Number('')===0 会绕过，必须显式拦截）
    if (min === '' || min === null || min === undefined || !Number.isInteger(Number(min)) || Number(min) < 0 || Number(min) > REWRITE_ENGINE_MAX_INPUT_CHARS - 1) {
      return resolveError('wordCountMinInvalid')
    }
    if (max === '' || max === null || max === undefined || !Number.isInteger(Number(max)) || Number(max) < 1 || Number(max) > REWRITE_ENGINE_MAX_OUTPUT_CHARS) {
      return resolveError('wordCountMaxInvalid')
    }
    if (Number(max) < Number(min)) {
      return resolveError('wordCountMaxLtMin')
    }
    return ''
  })
  /**
   * 合法区间（collect-rewrite-wordcount，2026-10-20）。
   *
   * 为什么要有它：调用方此前要自己 `Number(min) || 800` 之类地把输入折成数字，
   * 于是「校验用的值」与「下发用的值」是两套口径——用户设的下限 0 会被 `|| 800` 吞掉
   * （0 是假值），而引擎因此收不到用户真正要的区间。
   * 这里把**可下发的值**与**校验结论**绑成同一份：error 非空 ⇒ range 为 null（调用方必须早退），
   * error 为空 ⇒ range 就是该下发的值。两处口径不可能再漂移。
   *
   * 注意 `Number('')` 是 0（不是 NaN），所以空值必须先判空再取数。
   */
  const range = computed(() => {
    if (error.value) return null
    return { min: Number(minRef.value), max: Number(maxRef.value) }
  })
  return { error, range }
}
