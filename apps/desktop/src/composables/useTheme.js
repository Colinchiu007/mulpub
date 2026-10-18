/**
 * useTheme — 主题状态模块（UX-AUDIT 阶段 1.1 / audit-9）
 *
 * 为什么改成模块级单例：此前每次 `useTheme()` 都新建一份 `theme` ref，
 * 于是「两个消费者各调一次」时它们的状态互不同步（只有 DOM 属性恰好一致），
 * 而全仓实际调用方是 0 —— 「暗色主题」在应用里没有任何入口，
 * 之前所有暗色对比度修复都只发生在视觉测试手工注入 `data-theme` 的状态里，用户不可达。
 *
 * 现在的分工：
 *   - 状态（mode / theme / loaded / preferred 来源）住在模块作用域，全应用一份；
 *   - 持久化真源是 `ui:theme` 里的**模式**（`system|light|dark`），不是解析后的主题；
 *     「跟随系统」必须能被记住，否则用户每次改系统主题都会被覆盖成用户的"选择"；
 *   - 系统主题监听器只注册一次（模块生命周期 == 应用生命周期，没有实例可解绑）；
 *   - 读取幂等：`boot()` 只跑一次，重复 useTheme() 不再二次打 IPC。
 *
 * 依赖：
 *   - electronAPI.storeGetSetting / storeSetSetting（preload 已暴露）
 *   - cohere-design-system.css 的 :root 与 [data-theme="dark"] 变量定义
 */
import { computed, ref } from 'vue'
import { getApi } from '@/api/electron-bridge'

const THEME_KEY = 'ui:theme'
const LIGHT = 'light'
const DARK = 'dark'

/** 用户可选的模式；`system` 表示不设偏好、跟随 prefers-color-scheme。 */
export const THEME_MODES = ['system', LIGHT, DARK]

const mode = ref('system')
const theme = ref(LIGHT)
const loaded = ref(false)
const isDark = computed(() => theme.value === DARK)

let bootPromise = null
let systemQuery = null
let systemListenerRegistered = false

function readSystemTheme () {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return LIGHT
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? DARK : LIGHT
}

/** 把模式解析成实际主题；`system` 走当前系统偏好。 */
export function resolveTheme (nextMode, systemTheme = readSystemTheme()) {
  if (nextMode === DARK || nextMode === LIGHT) return nextMode
  return systemTheme
}

function applyTheme (value) {
  if (typeof document !== 'undefined') {
    document.documentElement.setAttribute('data-theme', value)
  }
  theme.value = value
}

/** 写入偏好；失败保持本地已生效的主题不回滚，只出声一次由调用方决定（此处静默，日志在主进程侧）。 */
async function persist (value) {
  try {
    const api = getApi()
    if (api && api.storeSetSetting) await api.storeSetSetting(THEME_KEY, value)
  } catch {
    // 静默：本地切换已生效，持久化不可用不得回滚用户看到的主题
  }
}

function normalizeStoredMode (stored) {
  if (typeof stored !== 'string') return null
  const value = stored.trim()
  return THEME_MODES.includes(value) ? value : null
}

function onSystemThemeChange (event) {
  // 只有「跟随系统」时系统偏好才算用户意图；用户显式选过 light/dark 后不得被覆盖
  if (mode.value === 'system') applyTheme(event.matches ? DARK : LIGHT)
}

function subscribeSystemTheme () {
  if (systemListenerRegistered) return
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return
  systemQuery = window.matchMedia('(prefers-color-scheme: dark)')
  systemQuery.addEventListener('change', onSystemThemeChange)
  systemListenerRegistered = true
}

async function init () {
  let preferred = null
  try {
    const api = getApi()
    if (api && api.storeGetSetting) {
      const res = await api.storeGetSetting(THEME_KEY)
      if (res && res.code === 0 && res.data) preferred = normalizeStoredMode(res.data)
    }
  } catch {
    preferred = null
  }
  if (preferred) mode.value = preferred
  applyTheme(resolveTheme(mode.value))
  loaded.value = true
  subscribeSystemTheme()
}

/** 读取一次持久化偏好（幂等）。 */
function boot () {
  if (!bootPromise) bootPromise = init()
  return bootPromise
}

/**
 * 设置模式：立即生效 + 持久化。非法值一律拒绝（不得把拼错的 mode 写进偏好，
 * 那会让下次启动读到一个解析不出来的值，而用户只看到"设置没保存"）。
 * @returns {boolean} 是否已接受
 */
export function setThemeMode (nextMode) {
  if (!THEME_MODES.includes(nextMode)) return false
  mode.value = nextMode
  applyTheme(resolveTheme(nextMode))
  boot()
  persist(nextMode)
  return true
}

/** 便捷开关：在 light/dark 之间切换（`system` 下按当前实际主题取反）。 */
export function toggleTheme () {
  return setThemeMode(theme.value === DARK ? LIGHT : DARK)
}

export function useTheme () {
  boot()
  return { mode, theme, isDark, loaded, setMode: setThemeMode, toggle: toggleTheme }
}

/**
 * 仅测试用：把模块态复位。单例若无复位口，用例之间会互相污染
 * （上一例写进 DOM 的 data-theme 与 bootPromise 会被下一例当成初始态）。
 */
export function __resetThemeStateForTest () {
  mode.value = 'system'
  theme.value = LIGHT
  loaded.value = false
  bootPromise = null
  if (systemQuery && systemListenerRegistered) {
    systemQuery.removeEventListener('change', onSystemThemeChange)
  }
  systemQuery = null
  systemListenerRegistered = false
  if (typeof document !== 'undefined') document.documentElement.removeAttribute('data-theme')
}
