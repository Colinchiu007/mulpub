// @ts-check
/**
 * 热门选题流水线选择器的跨实例共享状态（2026-10-17）。
 *
 * 为什么要单独成模块：`<script setup>` 的顶层代码会随每个组件实例重新执行，
 * 在其中声明的 `ref` 是「每实例一份」的，用来做「同一时刻只开一个面板」会失效
 * （实测：两行同时打开）。模块作用域的 ref 才是真正的单例。
 * 只存一个「当前展开的实例 uid」，不持有任何业务数据。
 */
import { ref } from 'vue'

let pickerSequence = 0

/** 当前展开的 picker 实例 uid；null = 全部收起。 */
export const activePickerUid = ref(null)

/** 分配稳定的实例 uid（跨挂载只增不减，避免卸载重挂后 uid 复用导致误关）。 */
export function nextPickerUid() {
  pickerSequence += 1
  return pickerSequence
}

/** 面板与按钮之间的固定间距（px），与 CSS `calc(100% + 6px)` 保持一致。 */
export const PICKER_MENU_GAP = 6

/** 面板理想最大高度（px），与 CSS `max-height: 320px` 保持一致。 */
export const PICKER_MENU_MAX_HEIGHT = 320

/**
 * 计算下拉面板的展开方向（纯函数，便于在无布局的 jsdom 外单独验证）。
 *
 * 为什么需要翻转：面板绝对定位在行内，行下方空间不足时会被页面滚动容器裁掉
 * （2026-10-17 实测：`.cohere-content` overflow:auto，只有 408px 高，14 项面板高 320px
 * 却被裁到 139px，用户看不到其余流水线）。规则：下方放得下就向下；
 * 放不下且上方空间更大就向上；两边都不够时仍取空间更大的一侧，避免面板消失。
 *
 * @param {{buttonRect?: {top:number,bottom:number}, menuHeight?: number, viewportTop?: number, viewportBottom?: number, gap?: number}} [input]
 * @returns {'bottom'|'top'}
 */
export function computeGenVideoPickerPlacement(input = {}) {
  const { buttonRect, menuHeight, viewportTop = 0, viewportBottom = 0, gap = PICKER_MENU_GAP } = input
  if (!buttonRect || !Number.isFinite(menuHeight) || !Number.isFinite(viewportTop) || !Number.isFinite(viewportBottom)) {
    return 'bottom'
  }
  const spaceBelow = viewportBottom - buttonRect.bottom
  const spaceAbove = buttonRect.top - viewportTop
  if (spaceBelow >= menuHeight + gap) return 'bottom'
  return spaceAbove > spaceBelow ? 'top' : 'bottom'
}

/** 面板高度下限：空间再小也保留可滚动的最小高度，避免面板退化成一个不可用的细条。 */
export const PICKER_MENU_MIN_HEIGHT = 160

/**
 * 计算面板实际可用高度（px）。两侧空间都不足菜单理想高度时，取较大一侧并夹在
 * [PICKER_MENU_MIN_HEIGHT, maxHeight] 之间，配合 `overflow-y:auto` 保证整块面板可见、
 * 内容可滚动（2026-10-17 实测：`.cohere-content` 只有 342px 高，320px 面板翻上后
 * 仍被裁掉 120px，前 4 项不可见）。
 *
 * @param {{placement?: 'top'|'bottom', buttonRect?: {top:number,bottom:number}, viewportTop?: number, viewportBottom?: number, gap?: number, maxHeight?: number}} [input]
 * @returns {number}
 */
export function computeGenVideoPickerMenuSize(input = {}) {
  const {
    placement = 'bottom',
    buttonRect,
    viewportTop = 0,
    viewportBottom = 0,
    gap = PICKER_MENU_GAP,
    maxHeight = PICKER_MENU_MAX_HEIGHT,
  } = input
  if (!buttonRect || !Number.isFinite(viewportTop) || !Number.isFinite(viewportBottom)) return maxHeight
  const raw = placement === 'top'
    ? buttonRect.top - viewportTop - gap
    : viewportBottom - buttonRect.bottom - gap
  if (!Number.isFinite(raw)) return maxHeight
  return Math.max(PICKER_MENU_MIN_HEIGHT, Math.min(maxHeight, Math.floor(raw)))
}
