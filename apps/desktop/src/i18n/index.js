import { createI18n } from 'vue-i18n'
import zh from '../locales/zh'
import en from '../locales/en'

// 静态消息统一转换为 vue-i18n Message Function，避免运行时编译（new Function）
// 被 Electron CSP（script-src 'self'）以 'unsafe-eval' 拦截。
// 否则包含动态翻译的页面（如视频创作/图片轮播）会在渲染时抛出 EvalError 导致白屏。
//
// ⚠️ 2026-09-16 修复（BUGFIX-REWRITE-QUALITY-UX）：
// 旧实现把**所有**字符串叶子都包成 `() => source`，会丢弃 vue-i18n 传入的插值参数，
// 于是 `t('rewritePage.metaLength', { original: 8, result: 720 })` 原样输出
// `{original} 字 → {result} 字`——界面上直接泄漏未渲染的模板占位符。
// 经全仓扫描，locales 中共有 68 条「普通字符串 + {param}」叶子、16 处 `t(key, params)` 调用点
// 受同一缺陷影响（如 memberCenter.daysRemaining、accountsPage.creatorTabTitle、
// story2video.sceneMaterial.*、knowledgeBase.importResult 等）。
//
// 现改为：含 `{param}` 的字符串编译为命名插值 Message Function（纯正则替换，**仍不使用
// new Function**，保持 CSP 安全）；无占位符的字符串维持常量函数（零额外开销）。
// 插值语义与 utils/notifyCore.js 的 interpolateMessage 完全对齐（缺参回退空串）。
// 两种写法均受支持：普通字符串 `'已选 {count} 条'` 与显式函数 `(ctx) => ctx.named('count')`。
//
// 注：占位符正则**内联在 replace 调用点**，不提取为模块级常量——带 `g` 标志的 RegExp 对象
// 持有可变的 `lastIndex`，共享同一实例时若被 `.test()` / `.exec()` 调用会因状态残留产生
// 间歇性误判（经典陷阱）。每次调用新建正则，彻底消除共享状态（零额外成本）。
function toMessageFunctions (value) {
  if (typeof value === 'string') {
    const source = value
    if (!source.includes('{')) return () => source
    return (ctx) => source.replace(/\{([^{}]+)\}/g, (_token, name) => {
      const raw = ctx && typeof ctx.named === 'function' ? ctx.named(name) : undefined
      return raw == null ? '' : String(raw)
    })
  }
  if (Array.isArray(value)) {
    return value.map(toMessageFunctions)
  }
  if (typeof value !== 'object' || value === null) {
    return value
  }
  const output = {}
  for (const [key, child] of Object.entries(value)) {
    output[key] = toMessageFunctions(child)
  }
  return output
}

export const SUPPORTED_LOCALES = Object.freeze(['zh', 'en'])

/**
 * 系统语言自动检测（user-facing-messages 规范）：
 * zh* → zh，en* → en，其余 → en（与 fallbackLocale 一致）；无 navigator 时回退 zh。
 */
export function detectSystemLocale () {
  if (typeof navigator === 'undefined' || !navigator.language) return 'zh'
  const lang = String(navigator.language || '').toLowerCase()
  if (lang.startsWith('zh')) return 'zh'
  if (lang.startsWith('en')) return 'en'
  return 'en'
}

/** 语言解析优先级：显式设置（localStorage locale）→ 系统语言 → 默认 zh。 */
export function resolveAppLocale () {
  const stored = typeof localStorage === 'undefined' ? null : localStorage.getItem('locale')
  if (stored === 'en' || stored === 'zh') return stored
  return detectSystemLocale()
}

/** 读取当前生效语言（已解析，zh/en）。 */
export function getAppLocale () {
  const current = i18n.global.locale.value
  return current === 'en' ? 'en' : 'zh'
}

/**
 * 切换应用语言：持久化（localStorage）并即时生效。
 * @param {'zh'|'en'} locale
 */
export function setAppLocale (locale) {
  const normalized = locale === 'en' ? 'en' : 'zh'
  try {
    if (typeof localStorage !== 'undefined') localStorage.setItem('locale', normalized)
  } catch (_) {
    // localStorage 不可用时仅内存生效
  }
  i18n.global.locale.value = normalized
  return normalized
}

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: resolveAppLocale(),
  fallbackLocale: 'en',
  messages: { zh: toMessageFunctions(zh), en: toMessageFunctions(en) },
})

export default i18n
