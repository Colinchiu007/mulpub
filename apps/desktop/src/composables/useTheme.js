/**
 * useTheme — 暗色/亮色主题 composable（应用级单例）
 *
 * 为什么是单例：`data-theme` 挂在 `document.documentElement` 上，是**全局唯一**的界面状态。
 * 旧实现把 `theme` ref、`matchMedia` 监听、`applyTheme` 都放在函数体内 ⇒ 每个调用方各建一份：
 * A 处切色 B 处读数不变，且第二个调用方会再注册一个宿主监听（本仓「全局单例事件监听器生命周期」
 * 那条 QM 规则管的就是这个形状）。现在状态提到模块级，监听按引用计数注册/注销一次。
 *
 * 三态口径（闭合词表，真源是 electron store 的 `ui:theme`）：
 *   - `'light'` / `'dark'` —— 用户显式偏好，系统深浅色变化**不**得覆盖；
 *   - `'system'`           —— 无用户偏好，跟随 `prefers-color-scheme`；
 *   - 键缺失 / `null` / 空串 —— 与 `'system'` 等价（与旧实现逐字兼容，**零迁移**）；
 *   - 词表外的值 —— 归一为 `'system'` **并出声**（不得原样写入，也不得静默当成 light）。
 *
 * 首帧不闪：`applyKnownThemeBeforeMount()` 在 `mount()` 之前把**上次已知偏好**同步落到 DOM。
 * 那个镜像只是首帧缓存，不是第二份事实 —— `init()` 读回真源后一律以真源为准，
 * 两者不一致时改写界面并同步镜像。真源读失败 ≠ "偏好是浅色"：按 `'system'` 处理并留痕。
 *
 * 依赖:
 *   - electronAPI.storeGetSetting / storeSetSetting（preload 已暴露）
 *   - cohere-design-system.css 中 :root 和 [data-theme="dark"] 变量定义
 */

import { ref, computed, watch, onBeforeUnmount } from 'vue'
import { getApi } from '@/api/electron-bridge'

const THEME_KEY = 'ui:theme'
/** 首帧缓存：只存偏好三值，不参与判定，真源读到后必然被覆盖 */
const MIRROR_KEY = 'ui:theme:known'
const THEME_PREFERENCES = ['light', 'dark', 'system']

const preference = ref('system')
const systemTheme = ref(readSystemTheme())
const loaded = ref(false)

/** 生效主题 = 偏好为 system 时跟随系统，否则用用户偏好 */
const theme = computed(() => (preference.value === 'system' ? systemTheme.value : preference.value))
const isDark = computed(() => theme.value === 'dark')

function readSystemTheme () {
  try {
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  } catch (_) {
    // 宿主能力缺失时必须是确定状态，而不是 undefined
    return 'light'
  }
}

/**
 * 偏好取值归一（单一实现，调用方不得自带第二份判据）。
 * ⚠ 词表外值必须出声：静默归一会让"存储被写坏"与"用户从没设过"在日志里完全同形。
 */
export function normalizeThemePreference (raw) {
  if (raw === null || raw === undefined || raw === '') return 'system'
  if (THEME_PREFERENCES.includes(raw)) return raw
  console.warn(`[useTheme] unrecognized theme preference ${JSON.stringify(raw)} -> falling back to system (vocabulary: ${THEME_PREFERENCES.join('/')})`)
  return 'system'
}

function currentMirror () {
  try {
    return normalizeThemePreference(window.localStorage.getItem(MIRROR_KEY))
  } catch (_) {
    // localStorage 在个别宿主上下文里不可用；不可用 ≠ 用户偏好是 light
    return 'system'
  }
}

function writeMirror (value) {
  try { window.localStorage.setItem(MIRROR_KEY, value) } catch (_) { /* 缓存写失败不影响真源 */ }
}

function applyToDom (value) {
  document.documentElement.setAttribute('data-theme', value)
}

/**
 * 挂载前落色：只碰 DOM 属性与 localStorage，不得依赖应用上下文 / IPC。
 * 由 `main.js` 在 `createApp().mount()` 之前调用（接线锁见 useTheme.test.js）。
 */
export function applyKnownThemeBeforeMount () {
  const known = currentMirror()
  systemTheme.value = readSystemTheme()
  applyToDom(known === 'system' ? systemTheme.value : known)
  return known
}

// ── 宿主监听的引用计数（消费者增减不放大监听）──────────────────────────────
let consumers = 0
let mediaQuery = null
let onSystemChange = null

function acquireSystemListener () {
  consumers += 1
  if (mediaQuery) return
  try {
    mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
  } catch (_) {
    mediaQuery = null
    return
  }
  onSystemChange = (e) => {
    systemTheme.value = e && e.matches ? 'dark' : 'light'
  }
  mediaQuery.addEventListener('change', onSystemChange)
}

function releaseSystemListener () {
  consumers = Math.max(0, consumers - 1)
  if (consumers === 0 && mediaQuery && onSystemChange) {
    mediaQuery.removeEventListener('change', onSystemChange)
    mediaQuery = null
    onSystemChange = null
  }
}

function commit () {
  applyToDom(theme.value)
  writeMirror(preference.value)
}

// 生效值变化即写 DOM + 镜像；界面颜色只有这一个写入点。
// ⚠ 刻意**不带 immediate**：模块被 import 就写 DOM 会让"谁在写主题"不可追溯
//   （测试里只要 import 到本文件就改了 jsdom 的根属性）。首帧落色由
//   `applyKnownThemeBeforeMount()` 负责，终值落色由 `init()` 里的 `commit()` 负责。
watch([preference, systemTheme], commit)

let initToken = 0
async function init () {
  const token = ++initToken
  let raw = null
  let readFailed = false
  try {
    const api = getApi()
    if (api && api.storeGetSetting) {
      const res = await api.storeGetSetting(THEME_KEY)
      if (res && res.code === 0) raw = res.data
      else readFailed = true
    } else {
      readFailed = true
    }
  } catch (e) {
    readFailed = true
    console.warn('[useTheme] failed to read theme preference -> using system: ' + (e && e.message))
  }
  // 更晚发起的 init 才认（组件反复挂载时旧回包不得覆盖新状态）
  if (token !== initToken) return
  // ⚠ 「没读到」不等于「读到空偏好」：两者都归 system，但只有真出错会留下上面那条 warn。
  //   这里不因为读失败就退回镜像 —— 镜像是首帧缓存，终值必须由真源决定。
  const resolved = normalizeThemePreference(readFailed ? null : raw)
  systemTheme.value = readSystemTheme()
  const unchanged = resolved === preference.value
  preference.value = resolved
  loaded.value = true
  // 必须显式 commit，不能只依赖上面的 watch：首帧镜像可能落过**别的**颜色
  // （例：镜像写着 dark，而真源其实已是 system 且系统当前是 light）。
  // 此时 preference 没有变化 ⇒ watch 不触发 ⇒ 界面会**永久停在过期的镜像色**上。
  // 这是"缓存赢了真源"的真实形态，不是理论担忧。
  if (unchanged) commit()
}

/**
 * @returns {{ theme, isDark, loaded, preference, setPreference, resetToSystem, toggle }}
 *   `theme`/`isDark`/`loaded`/`preference` 是**所有消费者共享的同一份**（computed / 模块级 ref）。
 */
export function useTheme () {
  acquireSystemListener()
  init()
  onBeforeUnmount(() => { releaseSystemListener() })

  return { theme, isDark, loaded, preference, setPreference, resetToSystem, toggle }
}

/** 写入显式偏好（light/dark）。`system` 请用 `resetToSystem()`。 */
export function setPreference (next) {
  if (next === 'system') { resetToSystem(); return theme.value }
  const validated = normalizeThemePreference(next)
  preference.value = validated
  persist(validated)
  return theme.value
}

/**
 * 退回「跟随系统」。必须是一个**可写的值**而不是"删除键"：
 * 删除在存储面上与"从未设置"不可区分，界面就无法把这一态表达给用户。
 */
export function resetToSystem () {
  preference.value = 'system'
  persist('system')
  return theme.value
}

/** 兼容旧 API：在 light/dark 之间切换，并落为**显式**偏好（不再是"跟随系统"） */
export function toggle () {
  return setPreference(theme.value === 'dark' ? 'light' : 'dark')
}

async function persist (value) {
  try {
    const api = getApi()
    if (api && api.storeSetSetting) await api.storeSetSetting(THEME_KEY, value)
  } catch (e) {
    // 真源写失败不得回滚已经生效的界面（本地状态是用户刚做的那个决定）
    console.warn('[useTheme] failed to persist theme preference; local value kept: ' + (e && e.message))
  }
}

export { THEME_KEY, MIRROR_KEY, THEME_PREFERENCES }
