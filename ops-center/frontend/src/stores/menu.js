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

  function persist() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(order.value))
  }

  function move(path, offset) {
    const from = order.value.indexOf(path)
    const to = from + offset
    if (from < 0 || to < 0 || to >= order.value.length) return
    const next = [...order.value]
    const [item] = next.splice(from, 1)
    next.splice(to, 0, item)
    order.value = next
    persist()
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

  function reset() {
    order.value = [...DEFAULT_MENU_ORDER]
    persist()
  }

  return { order, orderedItems, move, moveBefore, reorder, reset }
})
