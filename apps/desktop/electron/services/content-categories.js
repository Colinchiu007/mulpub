// @ts-check
/**
 * content-categories.js — 统一内容类别的归一化（主进程 / 渲染层共用单一实现）
 *
 * 为什么两份共用：热门选题分类、采集库类别标签、账号分组预设标签三处必须显示
 * 同一套类别。若各写一份 normalize，运营中心改名后必然出现「一处变了另一处没变」。
 *
 * 三条硬语义（对应 content-categories.test.js）：
 * ① **fail-open 回退内置 11 类**：运营中心没下发 / 下发为空 / 结构非法时，
 *    一律返回内置目录，不得让界面变成空分类（离线与旧版运营中心都要可用）。
 * ② **逐条归类出声，不静默丢**：非法项进 `dropped`（带 reason），调用方决定
 *    要不要出声；整包结构非法才走 `invalidShape`。
 * ③ **内置 11 类的 key 不得变动**：与 electron/services/hot-topics/classifier.js
 *    的 CATEGORY_KEYS 严格一致（顺序即默认排序）。运营可改 name / 停用 / 排序，
 *    但分类器的关键词规则只认这 11 个 key —— 自定义类只能作为「可打标签」出现，
 *    不会自动出现在抓取分类结果里。
 */

/** 内置目录：key + 默认显示名（顺序即默认排序，与 classifier.js CATEGORY_KEYS 一致） */
const DEFAULT_CONTENT_CATEGORIES = Object.freeze([
  { category_key: 'general', name: '综合' },
  { category_key: 'society', name: '社会' },
  { category_key: 'finance', name: '财经' },
  { category_key: 'tech', name: '科技' },
  { category_key: 'ai', name: 'AI' },
  { category_key: 'entertainment', name: '娱乐' },
  { category_key: 'sports', name: '体育' },
  { category_key: 'emotion', name: '情感' },
  { category_key: 'education', name: '教育' },
  { category_key: 'health', name: '健康' },
  { category_key: 'international', name: '国际' },
])

/** 类别标识规则：小写字母开头，仅小写字母/数字/下划线，长度 2-32 */
const CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/

/** 上限：防超大 payload 造成渲染 DoS（与运营中心 MAX_CATEGORIES 对齐） */
const MAX_CATEGORIES = 50

const DEFAULT_KEYS = Object.freeze(DEFAULT_CONTENT_CATEGORIES.map((c) => c.category_key))
const DEFAULT_NAME_MAP = Object.freeze(
  DEFAULT_CONTENT_CATEGORIES.reduce((acc, c) => {
    acc[c.category_key] = c.name
    return acc
  }, /** @type {Record<string,string>} */ ({})),
)

function defaultItems () {
  return DEFAULT_CONTENT_CATEGORIES.map((c, i) => ({ ...c, sort_order: i }))
}

/**
 * 归一化运营中心下发的 contentCategories。
 * @param {unknown} raw 下发值（形如 { items: [...] } 或数组）
 * @returns {{ items: Array<{category_key:string,name:string,sort_order:number}>,
 *             dropped: Array<{category_key:string|null,reason:string}>,
 *             invalidShape: boolean, usingDefault: boolean }}
 */
function normalizeContentCategories (raw) {
  const dropped = []

  // 结构非法（非对象 / 非数组 / items 非数组）→ 整体回退内置
  let list = null
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === 'object' && Array.isArray(raw.items)) list = raw.items

  if (!list) {
    return { items: defaultItems(), dropped, invalidShape: true, usingDefault: true }
  }

  // 空数组：运营中心把所有类别都停用了 —— 这也是合法状态，但为保证界面可用仍回退内置
  if (list.length === 0) {
    return { items: defaultItems(), dropped, invalidShape: false, usingDefault: true }
  }

  const seen = new Set()
  const items = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') {
      dropped.push({ category_key: null, reason: 'notObject' })
      continue
    }
    const key = typeof entry.category_key === 'string' ? entry.category_key.trim() : ''
    if (!key || !CATEGORY_KEY_RE.test(key)) {
      dropped.push({ category_key: key || null, reason: 'key' })
      continue
    }
    if (seen.has(key)) {
      dropped.push({ category_key: key, reason: 'duplicate' })
      continue
    }
    const name = typeof entry.name === 'string' && entry.name.trim()
      ? entry.name.trim().slice(0, 20)
      : (DEFAULT_NAME_MAP[key] || key)
    seen.add(key)
    items.push({ category_key: key, name, sort_order: Number(entry.sort_order) || 0 })
  }

  if (items.length === 0) {
    return { items: defaultItems(), dropped, invalidShape: false, usingDefault: true }
  }

  const limitReached = items.length > MAX_CATEGORIES
  if (limitReached) {
    for (const extra of items.slice(MAX_CATEGORIES)) {
      dropped.push({ category_key: extra.category_key, reason: 'limit' })
    }
  }

  const kept = limitReached ? items.slice(0, MAX_CATEGORIES) : items
  kept.sort((a, b) => a.sort_order - b.sort_order)
  // 排序后归一化 0..n-1，保证渲染顺序稳定（与运营中心 reorder 语义一致）
  kept.forEach((item, i) => { item.sort_order = i })

  return { items: kept, dropped, invalidShape: false, usingDefault: false }
}

/**
 * 取类别显示名：下发值优先 → 内置默认名 → key 本身。
 * 用于渲染端替换硬编码的 i18n 分类文案。
 * @param {string} key
 * @param {Array<{category_key:string,name:string}>|null|undefined} items
 */
function resolveCategoryLabel (key, items) {
  const k = String(key || '')
  if (Array.isArray(items)) {
    const hit = items.find((i) => i && i.category_key === k)
    if (hit && hit.name) return hit.name
  }
  return DEFAULT_NAME_MAP[k] || k
}

/** 内置类别 key 列表（抓取侧分类基准；分类器只认这些 key） */
function defaultCategoryKeys () {
  return [...DEFAULT_KEYS]
}

module.exports = {
  DEFAULT_CONTENT_CATEGORIES,
  DEFAULT_CATEGORY_KEYS: DEFAULT_KEYS,
  CATEGORY_KEY_RE,
  MAX_CATEGORIES,
  defaultCategoryKeys,
  defaultItems,
  normalizeContentCategories,
  resolveCategoryLabel,
}
