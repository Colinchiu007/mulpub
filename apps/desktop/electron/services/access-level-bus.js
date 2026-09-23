'use strict'
/**
 * 访问级别失效广播总线（主进程侧，审计 P2·性能税的配套件）
 *
 * preload 对访问级别做了 TTL+推送缓存（见 ../preload/access-level-cache.js），
 * 因此**任何会改变级别的动因动作**都必须显式广播失效，否则最长要等一个 TTL 才生效：
 *   - 许可证激活 / 注销 / 试用激活（ipc-handlers/license.js）
 *   - 身份登录 / 登出 / 状态漂移（services/identity/identity-service-factory.js）
 *
 * 为什么走总线而不是层层传 BrowserWindow：两个触发点分处 ipc-handlers 与 services，
 * 而 BrowserWindow 只在 bootstrap 注入（bootstrap/phase5-ipc.js 的 registerAllIpcHandlers
 * 参数）。业务模块顶层 require('electron') 在单测里会拿到指向二进制路径的字符串而不是
 * 模块，故由 bootstrap 绑定一次实现，调用方只发信号。
 *
 * 失败语义：广播失败**绝不抛出**给调用方（许可证已激活成功，不能因推送失败回滚），
 * 退化为「仅 TTL 兜底」，但必须经 logger 留痕 —— 有意降级 ≠ 静默。
 */
const { ACCESS_LEVEL_INVALIDATE_EVENT } = require('../core/access-level')

let invalidator = null

function warn (logger, msg) {
  if (logger && typeof logger.warn === 'function') {
    try { logger.warn('[access-level] ' + msg); return } catch (_) { void _ /* 日志器异常不得影响主流程 */ }
  }
  // 无 logger（或 logger 自身异常）时退到 console：降级必须有留痕，不允许静默。
  if (typeof console !== 'undefined' && typeof console.warn === 'function') console.warn('[access-level] ' + msg)
}

/**
 * 生成「向所有存活窗口投递失效推送」的函数。
 * @param {{ getAllWindows?: () => Array<{webContents?: object, isDestroyed?: () => boolean}> }} BrowserWindow
 * @param {{ warn?: (msg: string) => void }} [logger]
 * @returns {(reason?: string) => number} 返回成功投递的窗口数
 */
function createAccessLevelInvalidator (BrowserWindow, logger) {
  return function broadcastAccessLevelInvalidated (reason) {
    let windows
    try {
      windows = (BrowserWindow && typeof BrowserWindow.getAllWindows === 'function')
        ? (BrowserWindow.getAllWindows() || [])
        : []
    } catch (e) {
      warn(logger, '枚举窗口失败，本轮降级为仅 TTL 兜底: ' + ((e && e.message) || e))
      return 0
    }
    let sent = 0
    for (const win of windows) {
      try {
        if (!win || (typeof win.isDestroyed === 'function' && win.isDestroyed())) continue
        const wc = win.webContents
        if (!wc || (typeof wc.isDestroyed === 'function' && wc.isDestroyed())) continue
        wc.send(ACCESS_LEVEL_INVALIDATE_EVENT, { reason: reason || 'unspecified' })
        sent += 1
      } catch (e) {
        // 单窗口投递失败（窗口正在销毁等）不得影响其他窗口，但必须留痕。
        warn(logger, '失效推送投递失败: ' + ((e && e.message) || e))
      }
    }
    return sent
  }
}

/**
 * 由 bootstrap 绑定广播实现。
 * @param {(reason?: string) => number} fn
 * @returns {() => void} 解绑函数
 */
function bindAccessLevelInvalidator (fn) {
  if (typeof fn !== 'function') throw new TypeError('bindAccessLevelInvalidator 需要一个函数')
  invalidator = fn
  return function unbind () { if (invalidator === fn) invalidator = null }
}

/**
 * 通知所有窗口：访问级别可能已变化，请丢弃缓存。
 * @param {string} [reason] 诊断用（不参与任何权限判定）
 * @returns {number} 成功投递的窗口数；未绑定实现时返回 -1（此时仅剩 TTL 兜底）
 */
function emitAccessLevelInvalidated (reason) {
  if (typeof invalidator !== 'function') return -1
  try {
    return Number(invalidator(reason)) || 0
  } catch (e) {
    warn(null, '失效广播异常，本轮降级为仅 TTL 兜底: ' + ((e && e.message) || e))
    return -1
  }
}

/** 测试复位用。 */
function _resetAccessLevelInvalidator () { invalidator = null }

module.exports = {
  createAccessLevelInvalidator,
  bindAccessLevelInvalidator,
  emitAccessLevelInvalidated,
  _resetAccessLevelInvalidator,
}
