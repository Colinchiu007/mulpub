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

// ─────────────────────────────────────────────────────────────────────────────
// 滚动高亮（2026-10-20 PRD-S2V-RESULT-UX-POLISH §3.5）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 求「当前所在分段」：遍历已挂 DOM ref，取顶部最接近视口顶部阈值的那个。
 *
 * 两个关键点（都来自实测缺陷，不要"优化"掉）：
 * 1. **必须遍历 Object.keys(refs)**：refs 是按全量下标寻址的**稀疏数组**
 *    （点名段并入首屏后中间全是空洞），用 `refs.length` 当连续上界会把高亮设到
 *    「有 ref 的最大位次」，与用户实际看到的段脱节。
 * 2. **读到视口下方的卡片即 break**：卡片按 DOM 顺序纵向堆叠 ⇒ `top` 单调递增 ⇒
 *    后面的都在更下方，无需再读。这一条把单帧 `getBoundingClientRect`（强制重排）
 *    从「已渲染段数」降到「视口内段数 + 1」——169 段全展开时是 169 → ~20。
 */
export function computeActiveSegmentIndex (vm) {
  const refs = Array.isArray(vm.segmentItemRefs) ? vm.segmentItemRefs : []
  if (!refs.length || !Array.isArray(vm.segments) || !vm.segments.length) return
  const raw = Number(vm.segmentScrollThreshold)
  const threshold = raw >= 0 ? raw : 120
  const viewportBottom = typeof window !== 'undefined' && Number(window.innerHeight) > 0
    ? Number(window.innerHeight) + threshold
    : 0
  let current = -1
  let bestTop = -Infinity
  for (const key of Object.keys(refs)) {
    const index = Number(key)
    if (!Number.isInteger(index) || index < 0) continue
    const el = refs[index]
    if (!el || typeof el.getBoundingClientRect !== 'function') continue
    const rect = el.getBoundingClientRect()
    if (viewportBottom > 0 && rect && typeof rect.top === 'number' && rect.top > viewportBottom) break
    if (rect && typeof rect.top === 'number' && rect.top <= threshold && rect.top > bestTop) {
      bestTop = rect.top
      current = index
    }
  }
  if (current >= 0) vm.activeSegmentIndex = current
}

/** 取消待执行的滚动帧（rAF 与 setTimeout 两种回退都要能取消）。 */
export function cancelScrollFrame (vm) {
  const handle = vm._segmentScrollFrame
  vm._segmentScrollFrame = null
  if (!handle || typeof window === 'undefined') return
  if (typeof window.cancelAnimationFrame === 'function' && typeof handle === 'number') {
    window.cancelAnimationFrame(handle)
  } else if (typeof handle === 'object' && typeof window.clearTimeout === 'function') {
    window.clearTimeout(handle)
  }
}

/**
 * 滚动事件入口：**前沿节流**（leading-edge）。
 *
 * 本帧第一次滚动立即算一次（保证高亮跟手，也让同步断言成立），同帧后续事件只等
 * 帧标记被清掉。选前沿而非 trailing 的依据：trailing 会让程序化重算（删除/移动后）
 * 被同一帧吞掉，高亮滞留在**被删掉的那一段**上。
 */
export function tickSegmentScroll (vm) {
  if (typeof window === 'undefined') return
  if (vm._segmentScrollFrame) return
  computeActiveSegmentIndex(vm)
  const raf = typeof window.requestAnimationFrame === 'function'
    ? window.requestAnimationFrame.bind(window)
    : (cb) => setTimeout(cb, 16)
  vm._segmentScrollFrame = raf(() => {
    vm._segmentScrollFrame = null
  })
}

/** 程序化重算（删除/移动/新增分段后、跳转后）：不受滚动节流影响。 */
export function recalcSegmentHighlight (vm) {
  cancelScrollFrame(vm)
  computeActiveSegmentIndex(vm)
}
