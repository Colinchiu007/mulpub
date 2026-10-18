// @ts-check
/**
 * notify.js — 通知日志 IPC handler（notify:log）
 *
 * 职责（对应 01-docs/ARCH-notify-log-standard.md §3.5）：
 *   - 接收 renderer notify() 上报的通知，写结构化日志行
 *   - C2 修复：主进程侧强制校验（不信任 renderer）
 *       1. sender 校验：由 controlledIpcMain 自动包装（isTrustedSender）
 *       2. messageKey 服务端白名单：仅接受已知 key，未知 key 静默 drop + 计数
 *       3. level 白名单：仅 {info, warn, error}
 *       4. params 值级 deny-list：类型约束（仅 string/number/boolean）+ 长度截断
 *       5. 速率限制：每窗口/每 key 计数，超限降级为聚合计数日志
 *   - 所有字段经 logger.notify() 统一 JSON.stringify 进 meta 段（换行消毒）
 */
const { ERROR } = require('../core/error-codes')

// messageKey 白名单前缀（主进程侧，与 renderer 契约层同步）。
// 主进程不 import renderer ESM（@ 别名），维护轻量前缀白名单：
//   - 通用域：operation_failed / renderer.uncaught_error
//   - userErrors.*（IPC 错误码）
//   - story2video.*（Story2Video 通知）
//   - publish.* / account.* / collection.* / batch.*（渐进补充的通用域）
const KNOWN_MESSAGE_KEY_PREFIXES = [
  'operation_failed',
  'renderer.',
  'userErrors.',
  'story2video.',
  'publish.',
  'account.',
  'collection.',
  'batch.',
]

const ALLOWED_LEVELS = new Set(['info', 'warn', 'error'])

// 速率限制：每窗口（10s）/每 messageKey 计数，超限降级为聚合计数日志
const RATE_WINDOW_MS = 10_000
const RATE_MAX_PER_KEY = 20
// 有意只增（R11 审计面的人工复核结论：key 空间有界且过期即覆盖，详见 openspec/records/risk-closeout.md）：key 由调用方传入的消息键决定，须通过下方
// isKnownMessageKey 的前缀白名单；**同一 key 的过期窗口在 checkRateLimit 里被原地覆盖**
// （`set` 换新对象，见 checkRateLimit 首分支）⇒ 单 key 只保留一个 bucket，不会累积成泄漏。
// 因此这里不需要也不能靠 clear() 控制基数：真正的上限是「每窗口每 key 允许 20 次」，
// 不是表大小。若将来改成「不校验 messageKey 白名单」，本注释与豁免须同时失效并改回清理。
const rateBuckets = new Map() // key -> { count, windowStart }

function isKnownMessageKey(messageKey) {
  if (typeof messageKey !== 'string' || !messageKey) return false
  return KNOWN_MESSAGE_KEY_PREFIXES.some((prefix) => messageKey === prefix || messageKey.startsWith(prefix))
}

function sanitizeParams(params) {
  // 值级 deny-list：仅接受 string/number/boolean，拒绝嵌套 object/array
  const out = {}
  if (!params || typeof params !== 'object' || Array.isArray(params)) return out
  for (const [key, value] of Object.entries(params)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      out[key] = typeof value === 'string' ? value.slice(0, 2000) : value
    }
  }
  return out
}

function checkRateLimit(messageKey) {
  const now = Date.now()
  const bucket = rateBuckets.get(messageKey)
  if (!bucket || now - bucket.windowStart >= RATE_WINDOW_MS) {
    rateBuckets.set(messageKey, { count: 1, windowStart: now })
    return { allowed: true, count: 1 }
  }
  bucket.count += 1
  if (bucket.count > RATE_MAX_PER_KEY) {
    return { allowed: false, count: bucket.count }
  }
  return { allowed: true, count: bucket.count }
}

function registerHandlers(ipcMain, deps) {
  const { log } = deps

  ipcMain.handle('notify:log', (_event, payload) => {
    try {
      const data = payload && typeof payload === 'object' ? payload : {}
      const { messageKey, module, level, params, errorCategory, error } = data

      // 1. messageKey 服务端白名单
      if (!isKnownMessageKey(messageKey)) {
        log.info('Notify', 'drop unknown messageKey', { messageKey: String(messageKey || '').slice(0, 200) })
        return { code: 0, data: { dropped: true } }
      }

      // 2. level 白名单
      const safeLevel = ALLOWED_LEVELS.has(level) ? level : 'info'

      // 3. params 值级 deny-list
      const safeParams = sanitizeParams(params)

      // 4. 速率限制
      const rate = checkRateLimit(messageKey)
      if (!rate.allowed) {
        log.info('Notify', 'rate limited aggregated', { messageKey, count: rate.count })
        return { code: 0, data: { rateLimited: true } }
      }

      // 5. 写结构化日志行（logger.notify 内部统一 JSON.stringify 进 meta 段 + 脱敏）
      log.notify(String(module || 'renderer'), messageKey, {
        errorCategory,
        level: safeLevel,
        params: safeParams,
        error,
      })
      return { code: 0, data: true }
    } catch (e) {
      // 日志失败不得影响 renderer 主流程
      return { code: ERROR.REQUEST_ERROR, message: e.message }
    }
  })
}

module.exports = registerHandlers
module.exports.isKnownMessageKey = isKnownMessageKey
module.exports.sanitizeParams = sanitizeParams
module.exports.checkRateLimit = checkRateLimit
module.exports.KNOWN_MESSAGE_KEY_PREFIXES = KNOWN_MESSAGE_KEY_PREFIXES
module.exports.ALLOWED_LEVELS = ALLOWED_LEVELS