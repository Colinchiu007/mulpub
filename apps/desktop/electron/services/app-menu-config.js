// @ts-check
/**
 * app-menu-config.js — 运营中心「应用菜单」下发配置的结构净化（2026-09-15）
 *
 * 从 ops-center-sync.js 拆出（债务熔断：主文件需保持 < 500 行）。
 * 职责：把不可信的远端 payload 净化为渲染端可直接消费的形状。
 *
 * 与 ops-center-sync.js 内其它策略校验的语义差异：
 * 本模块对「结构非法」返回 **null** 而非空对象。
 * 渲染端（src/config/sidebar-menu-merge.js）把 null 解读为「本轮未取得有效配置」
 * → fail-open 回退本地默认菜单；而空 items 数组是合法配置
 * （等价于「全部按默认可见」）。
 *
 * 2026-09-21 契约修复：透传 group（primary|more）。后端 bootstrap 与渲染端
 * resolveSidebarMenu 均已支持跨组配置，此前本净化层丢字段，
 * 导致运营中心「一级导航 ↔ 更多」拖拽在应用端永远不生效。
 * 非法/缺失 group 归一化为 null，渲染端按本地定义分组兜底（fail-open）。
 */
'use strict'

/** 应用菜单配置允许的最大条目数（防超大 payload 造成渲染端 DoS） */
const MAX_APP_MENU_ITEMS = 200
/** sort_order 允许上限（与渲染端 src/config/sidebar-menu-merge.js 的 MAX_SORT_ORDER 对齐） */
const MAX_APP_MENU_SORT_ORDER = 9999
/** 合法分组白名单（与渲染端 sidebar-menu.js SIDEBAR_MENU_GROUPS、后端 MENU_GROUPS 对齐） */
const APP_MENU_GROUPS = ['primary', 'more']

/**
 * 应用菜单配置结构校验。
 *
 * config-hash-purity（2026-10-18）：**时间戳不再从块内取**。
 * `appMenu` 在 `RUNTIME_BLOCKS` 白名单内、参与 config_hash 计算，而服务端曾在这里下发
 * 块内 `synced_at: _now()` ⇒ 「运营没改菜单，hash 也每次都在变」——
 * config_version 每次 +1、生效看板「已确认率」永远上不去、版本表随请求数无限增长。
 * 因此服务端已把 `synced_at` 从本块移除，只保留在 bootstrap 信封顶层（顶层字段不参与 hash）。
 *
 * 读侧仍**向后兼容**：块内若还带着 synced_at（旧版本服务端 / 手工构造的测试数据），
 * 优先用它；否则回落到调用方传入的信封顶层 `fallbackSyncedAt`。这样「新旧服务端混跑」
 * 期间不会出现时间戳突然变空。
 *
 * @param {unknown} raw 下发原始值，期望 { items: [{ key, visible, sort_order, group }] }
 * @param {string} [fallbackSyncedAt] bootstrap 信封顶层的 synced_at（块内不再下发时的时间戳来源）
 * @returns {{items: Array<{key:string,visible:boolean,sort_order:number|null,group:string|null}>, syncedAt: string} | null}
 *          null 表示不可用，调用方（渲染端）应 fail-open 回退本地默认菜单
 */
function normalizeAppMenu(raw, fallbackSyncedAt) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const list = raw.items
  if (!Array.isArray(list)) return null
  if (list.length > MAX_APP_MENU_ITEMS) return null
  const items = []
  for (const entry of list) {
    if (!entry || typeof entry !== 'object') continue
    const key = typeof entry.key === 'string' ? entry.key.trim() : ''
    if (!key) continue
    // 原型污染防御：整条丢弃（与 ops-center-sync.js 的 normalizeFeatureFlags 同口径）
    if (key === '__proto__' || key === 'constructor' || key === 'prototype') continue
    const rawSort = Number(entry.sort_order)
    let sortOrder = null
    if (Number.isFinite(rawSort) && rawSort >= 0) {
      sortOrder = Math.min(Math.trunc(rawSort), MAX_APP_MENU_SORT_ORDER)
    }
    // group 白名单透传：仅接受 'primary' | 'more' 原文，其余（含大小写变体）归 null
    const group = APP_MENU_GROUPS.includes(entry.group) ? entry.group : null
    items.push({
      key,
      visible: entry.visible === true || entry.visible === 1 || entry.visible === '1' || entry.visible === 'true',
      sort_order: sortOrder,
      group,
    })
  }
  return {
    items,
    // 块内 synced_at 已不再下发（config-hash-purity）：优先兼容旧形态，回落信封顶层。
    syncedAt: (typeof raw.synced_at === 'string' && raw.synced_at)
      || (typeof fallbackSyncedAt === 'string' ? fallbackSyncedAt : ''),
  }
}

module.exports = { normalizeAppMenu, MAX_APP_MENU_ITEMS, MAX_APP_MENU_SORT_ORDER, APP_MENU_GROUPS }
