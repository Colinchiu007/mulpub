/**
 * card-paginator-core — 测量驱动贪心装箱分页引擎（**纯逻辑层，无 DOM**）
 *
 * ## 为什么拆成两层
 *
 * 分页引擎分两半：「**测量**」（必须 DOM）与「**决策**」（纯计算）。
 * 决策层可单测、可跨进程复用、可脱离 Electron 跑；混在一起会让 90% 的 bug
 * （边界、退化切分、残余阈值）**无法单测**。故本文件不 require 任何 DOM，
 * 测量经 `options.measure` **注入** —— 测试传假 measure 即可完整覆盖算法。
 *
 * 来源：参考产品 `view-xhs-template` 的分页器（报告 §9.1），但**修掉其 4 个已知缺陷**：
 *   ① 测量**必须计入 icon 高度**（`PaginateItem.iconHeight`）
 *   ② `noMarginTop` **渲染侧同样消费**（不只标记、还要真的少一份上边距）
 *   ③ `CLAUSE_ENDERS` **非空**（原实现是空数组 ⇒ 二级吸附永不生效）
 *   ④ **合并两套装箱循环**（原实现有重复实现，改一处漏一处）
 *
 * ## 三条不可破
 *
 *   ① **情况 0 必须有**：单条比整页还高 ⇒ 独占一页。原主循环缺这条 ⇒ **死循环**
 *      （放不下 → 剩得不够 → 收页 → 仍是同一条 → 放不下 ……）
 *   ② **拆完必须重测两段**：`substring + trim` 改变行数分布，且 `paddingBottom` /
 *      `marginBottom` 会被重复计算一次
 *   ③ **提前退出**：填到 `fillRatio` 就收页（产品取向：宁可少放）；`maxPages` 一到立刻停，
 *      **不是**事后截断（判据要求测量次数 < 全量 40%）
 */
'use strict'

const DEFAULT_MIN_REMAINDER_PX = 20
const DEFAULT_FILL_RATIO = 0.9
const DEFAULT_MIN_TAIL_CHARS = 5
const DEFAULT_MIN_SPLIT_CHARS = 10
const DEFAULT_MAX_PAGES = 100

/** 句末标点（优先级 1） */
const SENTENCE_ENDERS = ['。', '！', '？', '.', '!', '?']
/** 分句标点（优先级 2）—— ★ 修正③：原实现此表是**空数组** */
const CLAUSE_ENDERS = ['；', ';', '，', ',']
/** CJK 标点（优先级 3） */
const CJK_ENDERS = ['，', '。', '！', '？', '；']

const WARNINGS = Object.freeze({
  PAGE_LIMIT_REACHED: 'page-limit-reached',
  DEGENERATE_SPLIT_SKIPPED: 'degenerate-split-skipped',
  ITEM_EXCEEDS_PAGE: 'item-exceeds-page',
})

/**
 * 标点吸附：从 `targetIndex` **向前**回退，按 5 级优先级找语义边界。
 *
 * 返回值是**切点**（不是标点下标）—— 即「标点之后那个位置」，
 * 这样 `slice(0, cut)` 的结果**含**该标点。
 *
 * 5 级优先级（逐级回退，先命中者胜）：
 *   1. 句末 `SENTENCE_ENDERS`　2. 分句 `CLAUSE_ENDERS`　3. CJK `CJK_ENDERS`
 *   4. 空白　5. 都不命中 ⇒ **原样返回 `targetIndex`**（不强行吸附）
 *
 * @param {string} text
 * @param {number} targetIndex
 * @returns {number} 吸附后的切点（可等于 `targetIndex`）
 */
function snapToPunctuation (text, targetIndex) {
  const s = String(text == null ? '' : text)
  const target = Math.max(0, Math.min(Math.floor(Number(targetIndex) || 0), s.length))

  const levels = [SENTENCE_ENDERS, CLAUSE_ENDERS, CJK_ENDERS]
  for (const set of levels) {
    for (let i = target - 1; i >= 0; i--) {
      if (set.includes(s[i])) return i + 1
    }
  }
  // 4 级：空白（把切点放在空白**之后**，避免下一段以空格开头）
  for (let i = target - 1; i >= 0; i--) {
    if (/\s/.test(s[i])) return i + 1
  }
  // 5 级：不吸附
  return target
}

/**
 * 测量驱动贪心装箱分页。
 *
 * @param {Array<{id: string, type?: string, value: string, noMarginTop?: boolean, iconHeight?: number}>} items
 * @param {{
 *   availableHeightPx: number,
 *   measure: (text: string, item: object) => Promise<number>,
 *   minRemainderPx?: number, fillRatio?: number, minTailChars?: number,
 *   minSplitChars?: number, maxPages?: number
 * }} options
 * @returns {Promise<{pages: Array<Array<object>>, pageCount: number, measuredHeights: Map<string, number>, warnings: string[]}>}
 * @throws {TypeError} `availableHeightPx` 非有限正数 / `measure` 非函数（**fail-closed**）
 */
async function paginate (items, options) {
  const opts = options || {}
  const list = Array.isArray(items) ? items : []

  // ── 0. 参数校验（fail-closed）────────────────────────────────────
  if (!Number.isFinite(opts.availableHeightPx) || opts.availableHeightPx <= 0) {
    throw new TypeError('paginate: availableHeightPx 必须是有限正数，收到 ' + JSON.stringify(opts.availableHeightPx))
  }
  if (typeof opts.measure !== 'function') {
    throw new TypeError('paginate: measure 必须是函数，收到 ' + typeof opts.measure)
  }

  const availableHeightPx = opts.availableHeightPx
  const measure = opts.measure
  const minRemainderPx = Number.isFinite(opts.minRemainderPx) ? opts.minRemainderPx : DEFAULT_MIN_REMAINDER_PX
  const fillRatio = Number.isFinite(opts.fillRatio) ? opts.fillRatio : DEFAULT_FILL_RATIO
  const minTailChars = Number.isFinite(opts.minTailChars) ? opts.minTailChars : DEFAULT_MIN_TAIL_CHARS
  const minSplitChars = Number.isFinite(opts.minSplitChars) ? opts.minSplitChars : DEFAULT_MIN_SPLIT_CHARS
  const maxPages = Number.isInteger(opts.maxPages) && opts.maxPages > 0 ? opts.maxPages : DEFAULT_MAX_PAGES

  const warnings = []
  const measuredHeights = new Map()
  const pages = []

  /**
   * 直接测一段文本（**不走 id 缓存**）。
   *
   * ★ 切分探针必须用这个，不能用 `rawHeight` —— `rawHeight` 按 `id` 缓存，
   *   而切分探针是「同一个 id、不断变化的文本片段」，用缓存会让每次探针都返回
   *   **原始条目**的高度（实测：二分查找一次都没真跑，直接判成退化切分）。
   *   这是「缓存键选错」的典型形态：键必须覆盖**会影响结果的全部输入**，这里含文本。
   */
  const measureText = async (text, it) => {
    const h = await measure(String(text == null ? '' : text), it)
    const icon = Number.isFinite(it.iconHeight) ? it.iconHeight : 0
    return (Number.isFinite(h) ? h : 0) + icon
  }

  /**
   * 测量原始高度（含 icon —— 修正①）。
   *
   * ★ **惰性 + 按 id 缓存**：不在主循环之前把全部条目测一遍。
   *   理由是判据③要求 `maxPages` 受限时测量次数 **< 全量 40%** —— 先全测再提前退出
   *   会让那条判据**数学上不可能成立**（60 条先测 60 次，后面再怎么提前退出也是 60）。
   *   惰性化同时还有个实际好处：轮不到装箱的条目**一次都不测**（DOM 测量是最贵的操作）。
   *
   * ⚠️ 缓存键是 `id` —— 只对**条目本身**成立。切分探针请用 `measureText`。
   */
  const rawHeight = async (it) => {
    if (measuredHeights.has(it.id)) return measuredHeights.get(it.id)
    const total = await measureText(it.value, it)
    measuredHeights.set(it.id, total)
    return total
  }

  if (list.length === 0) {
    return { pages: [], pageCount: 0, measuredHeights, warnings }
  }
  const heightOf = (it) => {
    if (!measuredHeights.has(it.id)) {
      throw new Error('paginate: 条目 ' + it.id + ' 尚未测量（heightOf 只能用于已测量的条目）')
    }
    return measuredHeights.get(it.id)
  }

  const queue = list.map((it) => ({ ...it }))
  let currentPage = []
  let currentHeight = 0
  const flush = () => {
    if (currentPage.length > 0) pages.push(currentPage)
    currentPage = []
    currentHeight = 0
  }

  // ── 3. 二分切分（在 2 之前声明，主循环要用）──────────────────────
  const splitAndMeasure = async (item, budgetPx) => {
    const text = String(item.value == null ? '' : item.value)
    let low = minSplitChars
    let high = text.length - minTailChars
    if (high <= low) return null // 拒绝退化切分
    let best = -1
    while (low <= high) {
      const mid = Math.floor((low + high) / 2)
      // ★ 必须用 measureText（不走 id 缓存），否则每次探针都返回原始高度
      const h = await measureText(text.slice(0, mid).trim(), item)
      if (h <= budgetPx) { best = mid; low = mid + 1 } else { high = mid - 1 }
    }
    if (best <= 0) return null

    const cut = snapToPunctuation(text, best)
    // 吸附后可能越界或退化：再校一次
    if (cut <= 0 || cut >= text.length) return null

    const part1Text = text.slice(0, cut)
    const part2Text = text.slice(cut)
    const base = { ...item }
    // ★ 拆完必须重测两段（修正②：part2 带 noMarginTop）—— 同样用 measureText
    const h1 = await measureText(part1Text, { ...base, noMarginTop: base.noMarginTop === true })
    const h2 = await measureText(part2Text, { ...base, noMarginTop: true })
    measuredHeights.set(item.id + '_p1', h1)
    measuredHeights.set(item.id + '_p2', h2)

    return {
      part1: {
        ...base, id: item.id + '_p1', value: part1Text, isSplit: true,
        partIndex: 1, totalParts: 2, noMarginTop: base.noMarginTop === true,
      },
      part2: {
        ...base, id: item.id + '_p2', value: part2Text, isSplit: true,
        partIndex: 2, totalParts: 2, noMarginTop: true,
      },
    }
  }

  // ── 2. 主循环（**单份实现** —— 修正④）───────────────────────────
  while (queue.length > 0) {
    if (pages.length >= maxPages) {
      warnings.push(WARNINGS.PAGE_LIMIT_REACHED)
      break
    }
    const item = queue[0]
    // 惰性测量（带缓存）：只有真的轮到装箱的条目才测
    const h = await rawHeight(item)

    // 情况 0：单条比整页还高 ⇒ 独占一页（原主循环缺这条 ⇒ 死循环）
    if (currentPage.length === 0 && h > availableHeightPx) {
      currentPage.push(item)
      queue.shift()
      warnings.push(WARNINGS.ITEM_EXCEEDS_PAGE)
      flush()
      continue
    }

    // 情况 1：放得下
    if (currentHeight + h <= availableHeightPx) {
      currentPage.push({ ...item, isSplit: false })
      currentHeight += h
      queue.shift()
    // 情况 2：放不下且剩得够多 ⇒ 二分切分
    } else if (availableHeightPx - currentHeight > minRemainderPx) {
      const split = await splitAndMeasure(item, availableHeightPx - currentHeight)
      if (!split) {
        warnings.push(WARNINGS.DEGENERATE_SPLIT_SKIPPED)
        flush()
        continue
      }
      currentPage.push(split.part1)
      queue[0] = split.part2
      measuredHeights.delete(item.id) // 原条目已被拆掉，避免下次误命中
      flush() // ★ 拆完必须收页
      continue
    // 情况 3：剩得太少 ⇒ 收页
    } else {
      flush()
      continue
    }

    // 提前收页：填到 fillRatio 就收（产品取向，宁可少放）
    if (currentHeight >= availableHeightPx * fillRatio) flush()
  }
  flush()

  return { pages, pageCount: pages.length, measuredHeights, warnings }
}

module.exports = {
  paginate,
  snapToPunctuation,
  SENTENCE_ENDERS,
  CLAUSE_ENDERS,
  CJK_ENDERS,
  WARNINGS,
  DEFAULT_MIN_REMAINDER_PX,
  DEFAULT_FILL_RATIO,
  DEFAULT_MIN_TAIL_CHARS,
  DEFAULT_MIN_SPLIT_CHARS,
  DEFAULT_MAX_PAGES,
}
