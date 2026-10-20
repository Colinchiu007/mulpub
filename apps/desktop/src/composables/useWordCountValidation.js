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
 * @returns {{ error: import('vue').ComputedRef<string> }}
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
  return { error }
}
