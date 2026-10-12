/**
 * content-categories.js — 统一内容类别归一化（渲染层 ESM 版）
 *
 * 与主进程 `electron/services/content-categories.js` 是同一份逻辑的两个模块格式
 * （主进程 CJS / 渲染层 ESM，同 platform-definitions、account-name-guard 先例）。
 * 判据口径必须一致：运营中心改一次名，主进程与渲染层必须同时看到新名字。
 * 任何一侧改判据，必须同步改另一侧并跑两侧测试。
 *
 * 三条硬语义：
 * ① fail-open 回退内置 11 类：没下发 / 空 / 结构非法 → 内置目录（离线可用）。
 * ② 逐条归类出声：非法项进 dropped（带 reason），不静默丢。
 * ③ 内置 11 类 key 与 classifier.js CATEGORY_KEYS 严格一致。
 */

/**
 * 内置目录（key + 默认名，顺序即默认排序）
 *
 * ⚠️ 这里的 name 是**回退默认名**，仅用于运营中心未下发/下发不可用时的 fail-open 场景。
 * 为了让 zh/en 都能显示正确语言，name 存的是 locale 键后缀，实际文案由
 * `resolveDefaultCategoryName(key, t)` 经 vue-i18n 解析（`contentCategories.*`）。
 * 归一化函数内部仍保留 name 字段（纯数据比对用），界面展示请用解析后的值。
 */
const DEFAULT_CATEGORY_KEYS_INTERNAL = [
  'general', 'society', 'finance', 'tech', 'ai', 'entertainment',
  'sports', 'emotion', 'education', 'health', 'international',
]

export const DEFAULT_CONTENT_CATEGORIES = Object.freeze(
  DEFAULT_CATEGORY_KEYS_INTERNAL.map((k) => ({ category_key: k, name: k })),
)

/**
 * 解析内置类别的本地化显示名。
 * @param {string} key 类别 key
 * @param {(key: string) => string} t vue-i18n 的 t 函数
 */
export function resolveDefaultCategoryName (key, t) {
  const resolved = t('contentCategories.' + key)
  // i18n 缺失时 vue-i18n 会回显键名，此时退回 key 本身（不让界面显示 "contentCategories.tech"）
  return resolved && !String(resolved).startsWith('contentCategories.') ? resolved : key
}

/** 类别标识规则：小写字母开头，仅小写字母/数字/下划线，长度 2-32 */
export const CATEGORY_KEY_RE = /^[a-z][a-z0-9_]{1,31}$/

export const MAX_CATEGORIES = 50

export const DEFAULT_CATEGORY_KEYS = Object.freeze(
  DEFAULT_CONTENT_CATEGORIES.map((c) => c.category_key),
)

const DEFAULT_NAME_MAP = Object.freeze(
  DEFAULT_CONTENT_CATEGORIES.reduce((acc, c) => {
    acc[c.category_key] = c.name
    return acc
  }, /** @type {Record<string,string>} */ ({})),
)

export function defaultItems () {
  return DEFAULT_CONTENT_CATEGORIES.map((c, i) => ({ ...c, sort_order: i }))
}

export function defaultCategoryKeys () {
  return [...DEFAULT_CATEGORY_KEYS]
}

/**
 * @param {unknown} raw 下发值（{ items: [...] } 或数组）
 * @returns {{ items: Array<{category_key:string,name:string,sort_order:number}>,
 *             dropped: Array<{category_key:string|null,reason:string}>,
 *             invalidShape: boolean, usingDefault: boolean }}
 */
export function normalizeContentCategories (raw) {
  const dropped = []

  let list = null
  if (Array.isArray(raw)) list = raw
  else if (raw && typeof raw === 'object' && Array.isArray(raw.items)) list = raw.items

  if (!list) return { items: defaultItems(), dropped, invalidShape: true, usingDefault: true }
  if (list.length === 0) return { items: defaultItems(), dropped, invalidShape: false, usingDefault: true }

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
  kept.forEach((item, i) => { item.sort_order = i })

  return { items: kept, dropped, invalidShape: false, usingDefault: false }
}

/** 类别显示名：下发值 → 内置默认名 → key 本身 */
export function resolveCategoryLabel (key, items) {
  const k = String(key || '')
  if (Array.isArray(items)) {
    const hit = items.find((i) => i && i.category_key === k)
    if (hit && hit.name) return hit.name
  }
  return DEFAULT_NAME_MAP[k] || k
}

/** 校验单个类别 key 是否合法（采集/账号标签写入前用） */
export function isValidCategoryKey (key) {
  return typeof key === 'string' && CATEGORY_KEY_RE.test(key)
}
