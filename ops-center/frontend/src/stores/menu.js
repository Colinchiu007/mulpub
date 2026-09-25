import { computed, ref } from 'vue'
import { defineStore } from 'pinia'
import { DEFAULT_MENU_ORDER, MENU_ITEMS } from '../config/menuItems'

const STORAGE_KEY = 'ops_menu_order'

function readOrder() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (!Array.isArray(parsed)) return [...DEFAULT_MENU_ORDER]
    const known = new Set(DEFAULT_MENU_ORDER)
    const saved = parsed.filter((path) => known.has(path))
    const missing = DEFAULT_MENU_ORDER.filter((path) => !saved.includes(path))
    return [...saved, ...missing]
  } catch {
    return [...DEFAULT_MENU_ORDER]
  }
}

export const useMenuStore = defineStore('menu', () => {
  const order = ref(readOrder())
  const itemsByPath = new Map(MENU_ITEMS.map((item) => [item.path, item]))

  const orderedItems = computed(() => order.value
    .map((path) => itemsByPath.get(path))
    .filter(Boolean))

  // 菜单可见性的唯一口径（单一事实源）：侧边栏（App.vue）与菜单设置页（SettingsView.vue）共用。
  // 历史教训（2026-09-21）：SettingsView 曾各自硬编码 `!adminOnly` 过滤，
  // admin 登录时设置页比侧边栏少 5 个 adminOnly 项，两处规则漂移无人察觉。
  // 修改可见性规则只改这一处，消费方一律调用 visibleForRole(role)。
  function visibleForRole(role) {
    return orderedItems.value.filter((item) => !item.adminOnly || role === 'admin')
  }

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order.value))
  }

  function moveBefore(path, targetPath) {
    const from = order.value.indexOf(path)
    const target = order.value.indexOf(targetPath)
    if (from < 0 || target < 0 || from === target) return
    const next = [...order.value]
    const [item] = next.splice(from, 1)
    const adjustedTarget = from < target ? target - 1 : target
    next.splice(adjustedTarget, 0, item)
    order.value = next
    persist()
  }

  function reorder(from, to) {
    if (
      from < 0 || to < 0 ||
      from >= order.value.length || to >= order.value.length ||
      from === to
    ) return
    const next = [...order.value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    order.value = next
    persist()
  }

  // 拖拽排序专用：视图渲染的是 visibleForRole(role) 过滤后的可见列表，其下标与完整
  // order 的下标并不一致（非 admin 视角下 adminOnly 项会造成漂移），
  // 因此拖拽必须按 path 定位而非按下标。
  function reorderByPath(fromPath, toPath) {
    const from = order.value.indexOf(fromPath)
    const to = order.value.indexOf(toPath)
    if (from < 0 || to < 0 || from === to) return
    const next = [...order.value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    order.value = next
    persist()
  }

  // 「菜单设置」页的位移（⤒ 首位 / ↑ 上移 / ↓ 下移 / ⤓ 末位）必须按**可见序列**解析目标，
  // 再落到完整 order：视图渲染的是 visibleForRole 过滤后的列表，非 admin 视角下可见下标与
  // 完整 order 下标不一致（#1941 已把拖拽改为按 path 定位，箭头此前仍直改 order 会移动错项、
  // 或在用户看不见任何变化时悄悄改掉 admin 的顺序）。与 #2246「序列外的项不受影响」同一原则。
  function moveToVisibleEdge(path, edge, visiblePaths) {
    const vis = visiblePaths || order.value
    if (!vis.includes(path)) return
    const target = edge === 'top' ? vis[0] : edge === 'bottom' ? vis[vis.length - 1] : null
    if (!target || target === path) return
    reorderByPath(path, target)
  }

  function moveInVisible(path, offset, visiblePaths) {
    const vis = visiblePaths || order.value
    const at = vis.indexOf(path)
    if (at < 0) return
    const target = vis[at + offset]
    if (!target) return
    reorderByPath(path, target)
  }

  function reset() {
    order.value = [...DEFAULT_MENU_ORDER]
    persist()
  }

  return {
    order, orderedItems, visibleForRole, moveBefore, reorder,
    reorderByPath, moveToVisibleEdge, moveInVisible, reset,
  }
})
