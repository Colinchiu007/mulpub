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

/**
 * element-plus 默认 3000；上限 8000 是"用户来得及读完并行动"的经验值。
 * ⛔ 这里**没有** env 覆盖通道（QM-6 critic 轴 i1 实测否证了上一版）：`useNotify.js` 在渲染进程，
 * 打包产物里 Vite 把 `process.env.X` 注成空对象桩 —— 现场证据：`dist/assets/index-*.js` 里是
 * `var lK={}` + `const e=lK.MP_NOTIFY_MAX_DURATION_MS` ⇒ 运行时恒 undefined ⇒ 「可由环境变量放宽」
 * 在生产里是**假的**，而"可覆盖是假的"正是本单元要消灭的形态。
 * 要改上限走代码 + 评审；真要给用户可调的，那是设置项（产品决策），不是环境变量。
 * 回归锁：`useNotify.toast-spec.test.js` 断言本模块源码不得再出现 `process.env`。
 */
const DEFAULT_DURATION_MS = 3000
const MAX_DURATION_MS = 8000

/** 调用方给的 duration 必须真的到达 ElMessage：非法值回落默认、超上限夹到上限，两种都出声 */
function resolveDuration (requested) {
  if (requested === undefined || requested === null) return Math.min(DEFAULT_DURATION_MS, MAX_DURATION_MS)
  const value = Number(requested)
  if (!Number.isFinite(value) || value <= 0) {
    console.warn(`[useNotify] invalid duration (${String(requested)}) => fallback ${DEFAULT_DURATION_MS}ms`)
    return Math.min(DEFAULT_DURATION_MS, MAX_DURATION_MS)
  }
  if (value > MAX_DURATION_MS) {
    console.warn(`[useNotify] duration ${value}ms exceeds ceiling, clamped to ${MAX_DURATION_MS}ms`)
    return MAX_DURATION_MS
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

/**
 * 「没有展示任何东西」的三类成因必须分开归因（QM-6 critic 轴 i2），并按 `成因|键` 去重：
 *   - key-miss    ：messageKey 在 locales 里没命中
 *   - leak-blocked：调用方直传的 `options.message` 仍是 i18n 原始 key 形态，被防泄漏守卫拦下
 *   - empty-text  ：调用方给了空串
 * 只按 messageKey 去重会把后两种也记进"该 key 未命中"的账上 —— 归因错，而且这个键被永久记住，
 * 之后同一 key 的**真未命中**反而静默。
 * 去重集合还必须有上界（i3）：本模块明面支持动态文案/动态 key，用未登记 key 刷屏时
 * 「只增不清」的 Set 会在应用生命周期内无界增长 —— 那正是本单元要防的东西。
 */
const WARN_DEDUP_CAP = 200
const warnedCases = new Set()
let dedupCapAnnounced = false

function warnNoShow (cause, messageKey, level) {
  const dedupKey = `${cause}|${cause === 'key-miss' ? String(messageKey) : ''}`
  if (warnedCases.has(dedupKey)) return
  if (warnedCases.size >= WARN_DEDUP_CAP) {
    if (!dedupCapAnnounced) {
      dedupCapAnnounced = true
      console.warn(`[useNotify] diagnostics dedup set reached ${WARN_DEDUP_CAP} => further one-off warnings suppressed`)
    }
    return
  }
  warnedCases.add(dedupKey)
  const reason = cause === 'leak-blocked'
    ? 'options.message is still an i18n key shape (leak guard)'
    : cause === 'empty-text' ? 'empty text' : 'messageKey not found in locales'
  console.warn(`[useNotify] nothing shown (${reason}) key=${String(messageKey)} level=${String(level)}`)
}

/** 供测试复位模块级去重状态（不清就会让"第二次同样失败必须再次出声"这类判据不可写） */
export function __resetNotifyDiagnostics () {
  warnedCases.clear()
  dedupCapAnnounced = false
}

/**
 * 统一通知入口。
 * @param {string} messageKey - 如 'story2video.quota_exceeded' / 'operation_failed'
 * @param {object} [options]
 * @param {object} [options.params] - 插值参数
 * @param {string} [options.module]
 * @param {'success'|'info'|'warning'|'warn'|'error'} [options.level] - ⛔ 不含 `confirm`：确认弹窗只走 `notifyConfirm()`（QM-6 critic 轴 i5）。上一版文档把 `confirm` 列为合法值，而 LEVEL_BY_ALIAS 里没有它 ⇒ 真传 `level:'confirm'` 的调用点会得到"info toast + 一条告警"，与文档宣称的合法值相悖。现场清点：全仓无 `notify(..., {level:'confirm'})` 调用点（`confirm` 只出现在 `notifyConfirm` 内部与 `reportNotify` 的 level 字段），所以这是文档修正，不是行为变更。
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
      console.warn(`[useNotify] unknown level "${String(level)}" => shown as info (fix the call site)`)
    }
    ElMessage[type || 'info']({ message: text, duration: resolveDuration(options.duration), grouping: true })
  }

  function notify (messageKey, options = {}) {
    const level = options.level || 'info'
    // 支持直接传文案（options.message 优先于 messageKey 解析），用于动态/运行时拼接文案
    const directMessage = typeof options.message === 'string' && options.message.length > 0
    const rawText = directMessage ? options.message : notifyText(messageKey, options)
    // 防泄漏守卫：直接传文案若仍是 i18n 原始 key 形态，拦截并回退（i18n-user-facing-messages）
    const blocked = !!rawText && looksLikeI18nKey(rawText)
    const text = blocked ? '' : rawText
    if (!text) {
      // 未命中 key：error 级用 fallback 兜底，其余不展示但必须留痕
      if (level === 'error' && options.fallback) {
        reportNotify(messageKey, { ...options, level: 'error', error: options.fallback })
        showMessage('error', options.fallback, options)
        return options.fallback
      }
      warnNoShow(blocked ? 'leak-blocked' : 'key-miss', messageKey, level)
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
    const directMessage = typeof options.message === 'string' && options.message.length > 0
    const rawText = directMessage ? options.message : notifyText(messageKey, options)
    // 防泄漏守卫：直接传文案若仍是 i18n 原始 key 形态，拦截（i18n-user-facing-messages）
    const blocked = !!rawText && looksLikeI18nKey(rawText)
    const text = blocked ? '' : rawText
    // 这里返回 false 的语义是「用户根本没看到确认框」——与"用户点了取消"完全不同，
    // 静默会让调用方以为走了确认流程（过去就是这样：文案未命中 ⇒ 直接 return false，日志零痕迹）
    if (!text) { warnNoShow(blocked ? 'leak-blocked' : 'key-miss', messageKey, 'confirm'); return false }
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
