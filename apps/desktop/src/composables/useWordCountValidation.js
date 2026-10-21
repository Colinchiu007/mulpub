import { computed } from 'vue'
import { REWRITE_ENGINE_MAX_INPUT_CHARS, REWRITE_ENGINE_MAX_OUTPUT_CHARS } from '@/utils/rewrite-engine-limits'

/**
 * 字数区间校验（文案改写页 / 采集页共用）
 *
 * 契约（rewrite-limits-50000，2026-10-19）：min 0-49999 整数、max 1-50000 整数、
 * max >= min。上界单一真源 = 引擎 MAX_OUTPUT_CHARS（经 rewrite-engine-limits.js 的
 * 结构锁对齐），不在本文件写死数字。
 * 错误文案经 resolveError(key) 解析（调用方传入 locale/notify 适配器，
 * 兼容 vue-i18n 的 t() 与 notifyCore 的 resolveNotifyText().text 两种来源）。
 *
 * allowEmpty（2026-10-20 collection-ux-step-flow）：采集页把两个输入框**默认留空**，
 * 空值语义 = 「这一侧不设限」，不是非法输入。默认 false = 既有严格语义（改写页不变）。
 *   · 两边都空 → 合法（不限字数，由引擎自由发挥）
 *   · 只填一侧 → 合法（另一侧不设限）
 *   · 都填     → 走区间顺序校验
 *
 * @param {import('vue').Ref<number|''>} minRef - 最小字数（v-model.number，清空时为 ''）
 * @param {import('vue').Ref<number|''>} maxRef - 最大字数
 * @param {(key: string) => string} resolveError - 错误文案解析器
 * @param {{ allowEmpty?: boolean }} [options] - allowEmpty=true 时空值不算非法
 * @returns {{ error: import('vue').ComputedRef<string>, range: import('vue').ComputedRef<{min:number,max:number}|null> }}
 */
export function useWordCountValidation (minRef, maxRef, resolveError, options = {}) {
  const allowEmpty = options.allowEmpty === true
  const error = computed(() => {
    const min = minRef.value
    const max = maxRef.value
    // v-model.number + type=number 清空时值为 ''（Number('')===0 会绕过，必须显式拦截）
    const minBlank = min === '' || min === null || min === undefined
    const maxBlank = max === '' || max === null || max === undefined
    if (!allowEmpty) {
      // 严格模式（改写页）：任一为空即非法（保持既有语义不变）
      if (minBlank) return resolveError('wordCountMinInvalid')
      if (maxBlank) return resolveError('wordCountMaxInvalid')
    } else if (minBlank && maxBlank) {
      // 允许留空：两侧都不设限 ⇒ 无任何错误
      return ''
    }
    if (!minBlank && (!Number.isInteger(Number(min)) || Number(min) < 0 || Number(min) > REWRITE_ENGINE_MAX_INPUT_CHARS - 1)) {
      return resolveError('wordCountMinInvalid')
    }
    if (!maxBlank && (!Number.isInteger(Number(max)) || Number(max) < 1 || Number(max) > REWRITE_ENGINE_MAX_OUTPUT_CHARS)) {
      return resolveError('wordCountMaxInvalid')
    }
    // 区间顺序：两侧都填时才校验（只填一侧时另一侧不设限，不存在大小关系）
    if (!minBlank && !maxBlank && Number(max) < Number(min)) {
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
   *
   * allowEmpty 模式下的三条补充（collection-ux-step-flow，2026-10-20）：
   *   · 两侧都空 ⇒ range = null（**没有**可下发的区间；调用方据此走「不设限」路径，
   *     而不是把 '' 折成 0/0 变成「0 字上限」——那正是 `|| 800` 那类假值兜底的同型坑）；
   *   · 只填一侧 ⇒ 另一侧补齐：缺下限补 0，缺上限补统一上限 MAX_OUTPUT_CHARS；
   *   · 严格模式（allowEmpty=false）行为与 collect-rewrite-wordcount 完全一致。
   */
  const range = computed(() => {
    if (error.value) return null
    const min = minRef.value
    const max = maxRef.value
    const minBlank = min === '' || min === null || min === undefined
    const maxBlank = max === '' || max === null || max === undefined
    if (allowEmpty) {
      if (minBlank && maxBlank) return null
      return {
        min: minBlank ? 0 : Number(min),
        max: maxBlank ? REWRITE_ENGINE_MAX_OUTPUT_CHARS : Number(max),
      }
    }
    return { min: Number(min), max: Number(max) }
  })
  return { error, range }
}
