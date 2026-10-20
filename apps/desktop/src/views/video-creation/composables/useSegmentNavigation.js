/**
 * 分段导航（2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.3–§3.6）。
 *
 * 为什么单独拆出来：`ResultView.vue` 是 `.github/scripts/max-lines-baseline.json`
 * 里 **targets 点名还账对象**（零增长容差），而这一批交互（大跨度跳转、展开全部、
 * 回到顶部、数字导航的键盘移动）本身就是纯流程逻辑，与页面其余部分无关。
 *
 * 设计约束：
 * - 这些函数接收宿主实例 `vm`（Options API 组件），不做闭包捕获，便于单测直接传桩对象；
 * - 跳转的「要不要扩窗 / 扩到哪 / 只解析哪一段」由 `resolveSegmentJumpPlan`（composable）
 *   统一判定，本文件只执行它的结论——不允许在这里再算一次步长（那正是首轮
 *   「首批被重复解析」的结构成因）。
 */

import { resolveSegmentJumpPlan } from './useResultPreviewMedia'

/**
 * 数字导航的键盘移动目标（roving tabindex）。
 *
 * 只认四个方向键 + Home/End；其余键返回 null（调用方不得 preventDefault，Tab 必须能出去）。
 *
 * @param {{key?:string, current?:number, total?:number}} options
 * @returns {number|null} 目标下标；无动作时 null
 */
export function resolveJumpFocusTarget ({ key, current = 0, total = 0 } = {}) {
  const totalCount = Number.isFinite(Number(total)) ? Math.max(0, Math.floor(Number(total))) : 0
  if (totalCount <= 0) return null
  const from = Number.isInteger(current) ? Math.min(totalCount - 1, Math.max(0, current)) : 0
  const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[key]
  if (step) return Math.min(totalCount - 1, Math.max(0, from + step))
  if (key === 'Home') return 0
  if (key === 'End') return totalCount - 1
  return null
}

/**
 * 跳转到指定分段（含大跨度扩窗 + 跳转中反馈 + 只解析新增段）。
 *
 * 流程：
 * 1. `resolveSegmentJumpPlan` 判定是否需要扩窗、扩到哪、只解析哪一段区间；
 * 2. 需要扩窗时先置 `jumpPendingIndex`（渲染「正在展开到第 N 段…」），再渲染新卡 + 解析 URL；
 * 3. `$nextTick` 等 DOM 落地后滚动（否则目标元素还不存在，等于静默无响应）。
 *
 * @param {object} vm 宿主组件实例
 * @param {number} index 目标全量下标
 * @returns {Promise<boolean>} 是否发生了动作（false = 越界/已失效，调用方可忽略）
 */
export async function jumpToSegmentIndex (vm, index) {
  const segments = Array.isArray(vm.segments) ? vm.segments : []
  const plan = resolveSegmentJumpPlan({
    index,
    total: segments.length,
    renderedTo: vm.previewLayout.renderWindow.to,
  })
  if (!plan.needsScroll) return false
  vm.activeSegmentIndex = index

  if (plan.needsExpand) {
    // 大跳：先给反馈再做重活（渲染新卡 + 解析 URL 可能 1–2 秒）
    vm.jumpPendingIndex = index
    try {
      const batch = segments.slice(plan.batch.from, plan.batch.to)
      vm.segmentRenderCount = plan.expandTo
      if (batch.length) await vm.refreshSegmentImageUrls(batch)
      await vm.$nextTick()
    } finally {
      vm.jumpPendingIndex = -1
    }
  } else {
    await vm.$nextTick()
  }

  const refs = Array.isArray(vm.segmentItemRefs) ? vm.segmentItemRefs : []
  const el = refs[index]
  if (el && typeof el.scrollIntoView === 'function') {
    el.scrollIntoView({ behavior: 'smooth', block: 'start' })
  }
  return true
}

/**
 * 展开全部分段。
 *
 * 169 段要点 8 次「显示更多分段」，这里给一次性出口；一次性渲染全部卡片在超大任务上
 * 可能短暂卡顿，所以先向用户确认（`window.confirm` 不可用时视为已确认，便于测试）。
 *
 * @param {object} vm 宿主组件实例
 * @param {{confirm?: function}} [host] 可注入 confirm 以便测试
 * @returns {Promise<boolean>} 是否真的展开了
 */
export async function expandAllSegments (vm, host = {}) {
  const segments = Array.isArray(vm.segments) ? vm.segments : []
  const total = segments.length
  const renderedTo = vm.previewLayout.renderWindow.to
  if (renderedTo >= total) return false

  const confirmFn = host.confirm
    || (typeof vm.$confirm === 'function' ? vm.$confirm : null)
    || (typeof window !== 'undefined' && typeof window.confirm === 'function' ? window.confirm.bind(window) : null)
  if (confirmFn) {
    const ok = confirmFn(vm.tOrKey('story2video.sceneMaterial.expandAllConfirm', { total }))
    if (!ok) return false
  }

  vm.jumpPendingIndex = total - 1
  try {
    const batch = segments.slice(renderedTo, total)
    vm.segmentRenderCount = total
    if (batch.length) await vm.refreshSegmentImageUrls(batch)
  } finally {
    vm.jumpPendingIndex = -1
  }
  return true
}

/** 回到页面顶部（169 段滚到底后回顶很痛苦）。 */
export function backToTop (vm) {
  if (typeof window === 'undefined') return
  const root = vm && vm.$el && typeof vm.$el.scrollIntoView === 'function' ? vm.$el : null
  if (root) root.scrollIntoView({ behavior: 'smooth', block: 'start' })
  else window.scrollTo({ top: 0, behavior: 'smooth' })
}
