/**
 * 侧边栏菜单合并算法 —— 运营中心下发配置 × 应用端本地菜单定义。
 *
 * 纯函数、零副作用、不依赖 Vue，便于精确单测（见 ./sidebar-menu-merge.test.js）。
 *
 * ── 契约（详见 01-docs/PRD.md「应用菜单」章节）────────────────────────
 * C1 fail-open：未下发 / 结构非法 / 项数超限 → 返回本地默认（全部可见 + 定义顺序）。
 *    理由：运营侧配置异常绝不能让用户失去导航能力。
 * C2 强制项保护：SIDEBAR_FORCED_VISIBLE_KEYS 中的项永远 visible=true，
 *    无论下发值是什么（防御纵深：即使运营中心被绕过或被篡改）。
 * C3 未知 key 忽略：下发配置里出现本地定义没有的 key 时静默丢弃（不新增菜单项）。
 * C4 缺失 key 兜底：本地定义有、下发配置没有的项按「可见 + 定义顺序靠后」处理，
 *    保证应用端新增菜单项不会因运营中心未同步而消失。
 * C5 组内排序：primary 组与 more 组各自排序。跨组归属以下发 group 为准（见下），
 *    排序规则：sort_order 升序 → sort_order 相同按定义顺序 → 无 sort_order 的排在最后并保持定义顺序。
 * C6 输入不可变：不修改传入的 definition 与 rawConfig。
 */

import {
  SIDEBAR_FORCED_VISIBLE_KEYS,
  SIDEBAR_GROUP_PRIMARY,
  SIDEBAR_MENU_GROUPS,
  isForcedVisibleKey,
} from './sidebar-menu'

/** 单次下发允许的最大菜单项数（防超大 payload 造成渲染 DoS） */
export const MAX_APP_MENU_ITEMS = 200

/** sort_order 允许的最大值（防超大数值造成排序异常） */
export const MAX_SORT_ORDER = 9999

/** 原型污染敏感 key —— 直接丢弃，避免 Object 原型被写坏 */
const UNSAFE_KEYS = Object.freeze(['__proto__', 'constructor', 'prototype'])

/**
 * 把任意输入解析为合法的 sort_order。
 * @returns {number|null} 非负整数（截断）；非法值返回 null
 */
export function normalizeSortOrder (value) {
  if (value === null || value === undefined || value === '') return null
  const num = Number(value)
  if (!Number.isFinite(num)) return null
  if (num < 0) return null
  if (num > MAX_SORT_ORDER) return MAX_SORT_ORDER
  return Math.trunc(num)
}

/**
 * 把任意输入解析为合法的 visible 布尔值。
 * 采用「白名单为真」策略：只有明确的真值才算可见，其余（含字符串 'false'、对象、null）视为隐藏。
 * @returns {boolean}
 */
export function normalizeVisible (value) {
  return value === true || value === 1 || value === '1' || value === 'true'
}

/**
 * 把任意输入解析为合法的 group（'primary' | 'more'）。
 * @returns {string|null} 非法或缺失值返回 null（调用方 fail-open 回退本地定义）
 */
export function normalizeGroup (value) {
  return SIDEBAR_MENU_GROUPS.includes(value) ? value : null
}

/**
 * 规范化运营中心下发的 appMenu 配置。
 *
 * @param {unknown} raw 下发原始值，期望形如 { items: [{ key, visible, sort_order }], synced_at }
 * @returns {{ map: Record<string, {visible:boolean, sortOrder:number|null}> } | null}
 *          null 表示「不可用」，调用方应降级为本地默认（C1）
 */
export function normalizeAppMenuConfig (raw) {
  if (!raw || typeof raw !== 'object') return null
  const list = raw.items
  if (!Array.isArray(list)) return null
  // 超量直接整体拒绝（C1）而非截断：截断会导致「部分配置生效」的不可预期状态
  if (list.length > MAX_APP_MENU_ITEMS) return null

  const map = Object.create(null)
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (!key) continue
    if (UNSAFE_KEYS.includes(key)) continue
    map[key] = {
      visible: normalizeVisible(entry.visible),
      sortOrder: normalizeSortOrder(entry.sort_order),
      group: normalizeGroup(entry.group),
    }
  }
  return { map }
}

/** 组内比较器：sort_order 升序 → 定义顺序；无 sort_order 的排最后 */
function compareBySortOrder (a, b) {
  const av = a.sortOrder
  const bv = b.sortOrder
  if (av === null && bv === null) return a.index - b.index
  if (av === null) return 1
  if (bv === null) return -1
  if (av !== bv) return av - bv
  return a.index - b.index
}

/**
 * 合并「本地菜单定义」与「运营中心下发配置」。
 *
 * @param {Array<{key:string, group:string}>} definition 本地菜单定义（SIDEBAR_MENU_DEFINITION）
 * @param {unknown} rawConfig 运营中心下发的 appMenu 配置（可为 null / 非法值）
 * @returns {{ primary: Array<object>, more: Array<object> }} 每组内元素为
 *          { key, group, label, labelI18nKey?, to, icon, visible, forcedVisible, sortOrder }
 *          —— 包含被隐藏项（visible=false），由调用方决定是否渲染。
 *          其中 group 以「下发值优先、本地定义兜底」解析（fail-open，C1）。
 */
export function resolveSidebarMenu (definition, rawConfig) {
  const config = normalizeAppMenuConfig(rawConfig)
  const result = {}
  for (const group of SIDEBAR_MENU_GROUPS) result[group] = []

  const items = Array.isArray(definition) ? definition : []
  items.forEach((item, index) => {
    if (!item || typeof item !== 'object') return
    const localGroup = SIDEBAR_MENU_GROUPS.includes(item.group) ? item.group : null
    if (!localGroup) return

    const forcedVisible = isForcedVisibleKey(item.key)
    const entry = config ? config.map[item.key] : undefined
    // C2 强制项无条件可见；C4 未配置项默认可见
    const visible = forcedVisible ? true : (entry ? entry.visible : true)
    const sortOrder = entry ? entry.sortOrder : null

    // 跨组归属：下发 group 有效时覆盖本地定义；强制项锁定一级导航；配置异常回退本地（fail-open）。
    const deliveredGroup = entry ? entry.group : undefined
    const resolvedGroup = forcedVisible
      ? SIDEBAR_GROUP_PRIMARY
      : (deliveredGroup && SIDEBAR_MENU_GROUPS.includes(deliveredGroup) ? deliveredGroup : localGroup)

    result[resolvedGroup].push({
      key: item.key,
      group: resolvedGroup,
      label: item.label,
      labelI18nKey: item.labelI18nKey,
      to: item.to,
      icon: item.icon,
      visible,
      forcedVisible,
      sortOrder,
      index,
    })
  })

  // C5 组内排序
  for (const group of SIDEBAR_MENU_GROUPS) {
    result[group].sort(compareBySortOrder)
    result[group] = result[group].map(({ index: _index, ...rest }) => rest)
  }
  return result
}

/**
 * 便捷封装：从合并结果里取出某组的可见项（渲染用）。
 * @returns {Array<object>}
 */
export function visibleItemsOf (resolved, group) {
  if (!resolved || !Array.isArray(resolved[group])) return []
  return resolved[group].filter((item) => item.visible)
}

/** 常量再导出，方便调用方只 import 本文件 */
export { SIDEBAR_FORCED_VISIBLE_KEYS, SIDEBAR_MENU_GROUPS }
