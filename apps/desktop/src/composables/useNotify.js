// @ts-check
/**
 * useNotify.js — 通知 composable（统一通知通道，D1 决策）
 *
 * 职责（对应 01-docs/ARCH-notify-log-standard.md §3.3）：
 *   - 统一入口：notify / notifyError / notifySuccess / notifyWarning / notifyConfirm
 *   - 内部：notifyCore 解析文案 + 日志上报 → ElMessage/ElMessageBox 展示
 *   - 未命中 messageKey 时：error 级用 fallback 兜底，其余静默（避免空白 toast）
 *
 * 依赖（薄封装）：
 *   - notifyCore：文案解析 + notify:log 上报
 *   - element-plus：ElMessage / ElMessageBox 展示
 */
import { ElMessage, ElMessageBox } from 'element-plus'
import i18n from '@/i18n'
import { notifyText, reportNotify } from '@/utils/notifyCore'
import { looksLikeI18nKey } from '@/utils/message-contract'

/** element-plus 默认 3000；上限是"用户来得及读完并行动"的经验值，可由环境变量放宽用于排障 */
const DEFAULT_DURATION_MS = 3000
const MAX_DURATION_MS = 8000

/**
 * 上限允许 `MP_NOTIFY_MAX_DURATION_MS` 覆盖（对齐仓内频控/队列的 env 纪律）：
 * 非法值一律回落默认并出声，禁止静默变成 NaN/0 把所有 toast 变成"不消失"或"看不见"。
 */
function maxDurationMs () {
  const raw = process.env.MP_NOTIFY_MAX_DURATION_MS
  if (raw === undefined || raw === '') return MAX_DURATION_MS
  const parsed = Number(raw)
  if (!Number.isFinite(parsed) || parsed < DEFAULT_DURATION_MS) {
    console.warn(`[useNotify] MP_NOTIFY_MAX_DURATION_MS 非法（${raw}），回落默认上限 ${MAX_DURATION_MS}ms`)
    return MAX_DURATION_MS
  }
  return parsed
}

/** 调用方给的 duration 必须真的到达 ElMessage：非法值回落默认、超上限夹到上限，两种都出声 */
function resolveDuration (requested) {
  const ceiling = maxDurationMs()
  if (requested === undefined || requested === null) return Math.min(DEFAULT_DURATION_MS, ceiling)
  const value = Number(requested)
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`[useNotify] 非法 duration（${String(requested)}），回落默认 ${DEFAULT_DURATION_MS}ms`)
    return Math.min(DEFAULT_DURATION_MS, ceiling)
  }
  if (value > ceiling) {
    console.warn(`[useNotify] duration ${value}ms 超过上限，已夹到 ${ceiling}ms`)
    return ceiling
  }
  return value
}

/** 文案级（toast 类型）映射；未知值不得静默 no-op —— 见 showMessage() 内的兜底 */
const LEVEL_BY_ALIAS = {
  success: 'success',
  info: 'info',
  warning: 'warning',
  warn: 'warning',
  error: 'error',
}

/** 未命中的 messageKey 按 key 去重出声（调用点拼错 key 过去在日志里零痕迹） */
const warnedMissingKeys = new Set()

function warnMissingKey (messageKey, level) {
  if (warnedMissingKeys.has(messageKey)) return
  warnedMissingKeys.add(messageKey)
  console.warn(`[useNotify] messageKey 未命中：${messageKey}（level=${level}）⇒ 未展示任何提示`)
}

/**
 * 统一通知入口。
 * @param {string} messageKey - 如 'story2video.quota_exceeded' / 'operation_failed'
 * @param {object} [options]
 * @param {object} [options.params] - 插值参数
 * @param {string} [options.module]
 * @param {'success'|'info'|'warning'|'warn'|'error'|'confirm'} [options.level]
 * @param {string} [options.fallback] - 未命中 key 时的兜底文案（error 级）
 * @param {number} [options.duration] - 展示时长（毫秒），非法回落 3000，超上限夹住
 * @returns {string} 展示的文案（未命中且无 fallback 返回 ''）
 */
export function useNotify () {
  /** 唯一展示出口：duration / grouping 只能从这里出去，禁止再新增第二份 ElMessage 调用形态 */
  function showMessage (level, text, options) {
    const type = LEVEL_BY_ALIAS[level]
    if (!type) {
      // 未知 level 过去是 `if (show) show()` 的静默 no-op，却照样 reportNotify 并返回文案
      // ⇒ 日志说"已通知"、屏幕上什么都没有。改为按 info 展示 + 出声，宁可类型不对也不让它隐形。
      console.warn(`[useNotify] 未知 level「${String(level)}」，已按 info 展示（请修正调用点）`)
    }
    ElMessage[type || 'info']({ message: text, duration: resolveDuration(options.duration), grouping: true })
  }

  function notify (messageKey, options = {}) {
    const level = options.level || 'info'
    // 支持直接传文案（options.message 优先于 messageKey 解析），用于动态/运行时拼接文案
    const rawText = typeof options.message === 'string' && options.message
      ? options.message
      : notifyText(messageKey, options)
    // 防泄漏守卫：直接传文案若仍是 i18n 原始 key 形态，拦截并回退（i18n-user-facing-messages）
    const text = rawText && looksLikeI18nKey(rawText) ? '' : rawText
    if (!text) {
      // 未命中 key：error 级用 fallback 兜底，其余不展示但必须留痕
      if (level === 'error' && options.fallback) {
        reportNotify(messageKey, { ...options, level: 'error', error: options.fallback })
        showMessage('error', options.fallback, options)
        return options.fallback
      }
      warnMissingKey(messageKey, level)
      return ''
    }
    showMessage(level, text, options)
    // P1 可观测性：把用户实际看到的文案作为 error 字段上报（此前只报 messageKey，
    // 主进程日志无法得知用户看到了什么内容；error 字段经 notify:log 脱敏后落盘）
    reportNotify(messageKey, { ...options, level, error: text })
    return text
  }

  function notifyError (messageKey, options = {}) {
    return notify(messageKey, { ...options, level: 'error' })
  }

  function notifySuccess (messageKey, options = {}) {
    return notify(messageKey, { ...options, level: 'success' })
  }

  function notifyWarning (messageKey, options = {}) {
    return notify(messageKey, { ...options, level: 'warning' })
  }

  function notifyInfo (messageKey, options = {}) {
    return notify(messageKey, { ...options, level: 'info' })
  }

  /**
   * 确认弹窗（confirm 级）。
   * @param {string} messageKey
   * @param {object} [options]
   * @param {object} [options.params]
   * @param {string} [options.module]
   * @param {string} [options.title] - 弹窗标题（缺省用 messageKey 文案）
   * @param {string} [options.confirmButtonText]
   * @param {string} [options.cancelButtonText]
   * @param {'warning'|'error'|'info'} [options.type]
   * @returns {Promise<boolean>} 用户确认返回 true，取消返回 false
   */
  async function notifyConfirm (messageKey, options = {}) {
    // options.message 直接传文案（动态/运行时拼接），否则用 messageKey 解析
    const rawText = typeof options.message === 'string' && options.message
      ? options.message
      : notifyText(messageKey, options)
    // 防泄漏守卫：直接传文案若仍是 i18n 原始 key 形态，拦截（i18n-user-facing-messages）
    const text = rawText && looksLikeI18nKey(rawText) ? '' : rawText
    if (!text) return false
    // 标题/按钮同样拦截原始 key 泄漏
    const title = options.title && looksLikeI18nKey(options.title) ? '' : options.title
    const confirmButtonText = options.confirmButtonText && looksLikeI18nKey(options.confirmButtonText)
      ? i18n.global.t('common.confirm')
      : options.confirmButtonText
    const cancelButtonText = options.cancelButtonText && looksLikeI18nKey(options.cancelButtonText)
      ? i18n.global.t('common.cancel')
      : options.cancelButtonText
    reportNotify(messageKey, { ...options, level: 'confirm' })
    try {
      await ElMessageBox.confirm(text, title || '', {
        confirmButtonText: confirmButtonText || i18n.global.t('common.confirm'),
        cancelButtonText: cancelButtonText || i18n.global.t('common.cancel'),
        type: options.type || 'warning',
      })
      return true
    } catch (_) {
      return false
    }
  }

  return {
    notify,
    notifyError,
    notifySuccess,
    notifyWarning,
    notifyInfo,
    notifyConfirm,
  }
}
