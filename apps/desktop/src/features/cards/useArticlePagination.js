/**
 * useArticlePagination — 把编辑器正文切成「分页器的 items」（P2-6 上游一环）
 *
 * ## 为什么需要这一层
 *
 * P2-1 的 `paginate(items, options)` 吃的是 `{ id, value }` 数组，不是一段正文字符串。
 * 编辑器给的是纯文本。中间这一跳（正文 → items）看起来只是 `split('\n')`，
 * 但有三个决定会影响分页结果，必须显式：
 *
 * 1. **空段要不要丢**：连续换行会产生空串。空串高度为 0，但它仍占一个 `item`，
 *    会让「每页条数」虚高，也会让 `item-exceeds-page` 的判定出现高度 0 的噪声。
 * 2. **段要不要 trim**：首尾空白不改变视觉高度（HTML 折叠空白），但会改变
 *    `minTailChars` / `minSplitChars` 这些**按字符数**的判据。故 trim 后再入队。
 * 3. **id 用什么**：`paginate` 的 `measuredHeights` 以 `id` 为键。用数组下标做 id
 *    足够（同一批 items 内唯一），但**不要用内容哈希** —— 内容相同的高度也相同，
 *    哈希会让两条一样的段共享缓存，切分探针按 id 取高度时拿到错的值。
 *
 * ## measure 是注入的
 *
 * 分页器（P2-1）刻意不碰 DOM：`measure: (text, item) => Promise<number>` 由调用方给。
 * 本 composable 只负责造 items 与**转发**调用方给的 measure，
 * 真实 DOM 测量在渲染层（offscreen 窗口）做，测试里传假的即可完整覆盖算法。
 *
 * 契约来源：`packages/shared-utils/src/card-paginator-core.js` 的 JSDoc（逐字读过）：
 *   availableHeightPx 必填且 fail-closed；measure 必填且必须返回**数字**。
 */
import { ref } from 'vue'
import { cardPaginatorCore } from '@multi-publish/shared-utils/src/index.js'

/** 默认页高（px）：与 P2-3 的 DEFAULT_HEIGHT_PX 对齐 */
const DEFAULT_AVAILABLE_HEIGHT_PX = 1440

export function useArticlePagination () {
  /** @type {import('vue').Ref<object[][]>} 分页结果（每页是 item 数组） */
  const pages = ref([])
  const pageCount = ref(0)
  /** @type {import('vue').Ref<string[]>} 分页器 warnings（**非空即必须展示**，与 useCardsRender 同契约） */
  const warnings = ref([])
  const paginating = ref(false)
  const failure = ref(null)

  /**
   * 正文 → 分页器的 items。
   *
   * @param {string} text 编辑器正文（纯文本，段落以换行分隔）
   * @returns {object[]} `{ id, value }` 数组
   */
  function buildItems (text) {
    const src = typeof text === 'string' ? text : ''
    return src
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter((s) => s.length > 0) // ① 丢空段（见文件头第 1 条）
      .map((value, i) => ({ id: 'p' + i, value })) // ③ 下标做 id（见文件头第 3 条）
  }

  /**
   * 执行分页。
   *
   * @param {object} args
   * @param {string} args.text 正文
   * @param {(text: string, item: object) => Promise<number>} args.measure 高度测量（注入）
   * @param {number} [args.availableHeightPx] 页高
   * @param {number} [args.maxPages]
   * @returns {Promise<boolean>} 是否成功
   */
  async function paginate (args) {
    const { text, measure } = args || {}
    paginating.value = true
    failure.value = null
    pages.value = []
    pageCount.value = 0
    warnings.value = []
    try {
      const items = buildItems(text)
      if (items.length === 0) {
        failure.value = { key: 'empty' }
        return false
      }
      // ⚠️ 不能用 `args.availableHeightPx || DEFAULT` —— 那会把 0（以及负数/NaN 之外的
      //   合法 falsy）静默回落成默认值，分页器就永远拿不到调用方的 0，fail-closed 被绕过。
      //   `undefined` 才用默认；给了任何值都原样透传，让分页器自己判。
      const availableHeightPx = args.availableHeightPx === undefined
        ? DEFAULT_AVAILABLE_HEIGHT_PX
        : args.availableHeightPx
      const r = await cardPaginatorCore.paginate(items, {
        availableHeightPx,
        measure,
        ...(args.maxPages === undefined ? {} : { maxPages: args.maxPages }),
      })
      pages.value = r.pages
      pageCount.value = r.pageCount
      // ★ warnings 必须透出（与 useCardsRender 同契约：不得静默丢弃）
      warnings.value = Array.isArray(r.warnings) ? r.warnings.slice() : []
      return true
    } catch (e) {
      // 分页器对 availableHeightPx / measure 是 fail-closed（抛 TypeError）；
      // 这里接住并映射，不让它变成 unhandled rejection
      failure.value = { key: 'failed', message: (e && e.message) || String(e) }
      return false
    } finally {
      paginating.value = false
    }
  }

  function reset () {
    paginating.value = false
    pages.value = []
    pageCount.value = 0
    warnings.value = []
    failure.value = null
  }

  return {
    pages,
    pageCount,
    warnings,
    failure,
    paginating,
    buildItems,
    paginate,
    reset,
  }
}
