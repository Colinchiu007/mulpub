/**
 * 改写页字数区间控制（composable）——rewrite-view-decompose（2026-10-21）。
 *
 * 为什么独立：`RewriteView.vue` 触到 max-lines 登记容差（1430/1630），再增 200 行即红。
 * 字数区间是**一个自洽的子系统**：两份输入 + 一份校验结论 + 一个「用户是否手动改过」的
 * 记忆位 + 一条按输入形态自适应的推导。它既不渲染，也不关心改写请求的其它字段。
 *
 * 语义边界（务必保持，拆出去不等于可以改）：
 * - **校验与下发同源**：error 来自 `useWordCountValidation`（共享实现，与采集页一致），
 *   改写请求下发的 `wordCountRange` 取的是**同一对 ref** ⇒ 不会出现「校验用的值」与
 *   「下发用的值」是两套口径（collect-rewrite-wordcount 的同型教训：用户设的下限 0 被
 *   `|| 800` 这类假值兜底吞掉，引擎收不到用户真正要的区间）。
 * - **手动值优先于自适应**：`wordCountManuallySet` 一旦置位，改写前的按形态推导不再覆盖它。
 *   用户显式选择永远优先于启发式——这是本文件的边界，不得反过来。
 * - **空串即非法**（改写页严格语义）：两侧都必须有值。采集页的 allowEmpty 模式（留空 =
 *   「这一侧不设限」）**不适用于**本文件，调用方不要顺手传 allowEmpty。
 */
import { ref } from 'vue'
import { useWordCountValidation } from '@/composables/useWordCountValidation'
import { deriveWordCountRange } from '@/utils/rewrite-defaults'

/**
 * @param {(key: string) => string} resolveError - 错误文案解析器（调用方传 t('rewritePage.' + key)）
 * @returns {{
 *   wordCountMin: import('vue').Ref<number>,
 *   wordCountMax: import('vue').Ref<number>,
 *   wordCountError: import('vue').ComputedRef<string>,
 *   markWordCountManuallySet: () => void,
 *   applyWordCountDefaults: (trimmed: string) => void,
 * }}
 */
export function useRewriteWordCount (resolveError) {
  // 字数区间控制（默认 800-2000；长文成稿在改写前按原文长度自适应，避免被硬截断）
  const wordCountMin = ref(800)
  const wordCountMax = ref(2000)
  // 字数区间是否已被用户手动编辑：手动值优先于自适应推导
  let wordCountManuallySet = false

  // 字数区间校验（共享 composable，与 Collection 页一致）
  const { error: wordCountError } = useWordCountValidation(wordCountMin, wordCountMax, resolveError)

  /**
   * 字数区间被用户编辑：置位「已手动」标志，此后不再自适应覆盖。
   */
  function markWordCountManuallySet () {
    wordCountManuallySet = true
  }

  /**
   * 改写前按当前正文自适应字数区间（仅当用户未手动设置时）。
   *
   * 长文按原文长度自适应，避免硬截 60%（rewrite-default-strategy-fix）。
   * 推导结果恒满足 min <= max（`deriveWordCountRange` 内部夹取保证），
   * 因此推导后不会引入非法区间。
   *
   * @param {string} trimmed - 已 trim 的待改写正文
   */
  function applyWordCountDefaults (trimmed) {
    if (wordCountManuallySet) return
    const range = deriveWordCountRange(trimmed)
    wordCountMin.value = range.min
    wordCountMax.value = range.max
  }

  return { wordCountMin, wordCountMax, wordCountError, markWordCountManuallySet, applyWordCountDefaults }
}
