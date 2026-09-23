'use strict'
/**
 * 访问级别读取缓存（preload 侧，审计 P2·性能税）
 *
 * 背景：preload 把 getAccessLevel 挂在**每个受限 API 的调用路径**上
 * （见 ./access-control.js createDynamicAccessApi：受限方法每次 invoke 前都要判权限），
 * 而原实现每次都 `ipcRenderer.sendSync` —— 同步 IPC 会阻塞渲染进程直到主进程事件循环
 * 排空该请求。列表轮询、进度回调这类高频调用等于每次多交一份性能税。
 *
 * 策略：带两级失效的缓存，语义仍然是「不重载窗口也能立即生效」：
 *   ① 主进程推送 ACCESS_LEVEL_INVALIDATE_EVENT → 立即失效（许可证激活/注销/试用、身份登录/登出）；
 *   ② TTL 兜底 → 即使漏收推送，最长一个 TTL 后回源一次，不会永久停留在旧级别。
 *
 * 失败关闭语义原样保留：读不到合法级别（IPC 未注册、抛异常、被伪造值污染）一律按 'public'。
 * 权威判定始终在主进程（controlledIpcMain 每个 handler 再校验一次），缓存不可能提权。
 */
const {
  ACCESS_LEVEL_TTL_MS,
  isAccessLevel,
} = require('../core/access-level')

/**
 * @param {object} options
 * @param {() => unknown} options.read 回源函数（同步读主进程，返回可能是非法值）
 * @param {number} [options.ttlMs] 兜底 TTL
 * @param {() => number} [options.now] 时钟注入（用例用假时钟，避免依赖真实时间）
 */
function createAccessLevelCache ({ read, ttlMs = ACCESS_LEVEL_TTL_MS, now = Date.now } = {}) {
  let cached = null
  let expiresAt = 0

  function invalidate () {
    cached = null
    expiresAt = 0
  }

  function get () {
    if (cached !== null && now() < expiresAt) return cached
    let level = 'public'
    try {
      const fresh = typeof read === 'function' ? read() : null
      if (isAccessLevel(fresh)) level = fresh
    } catch (_) {
      // 同步权限 IPC 不可用时按最低权限处理。
      void _
    }
    cached = level
    expiresAt = now() + ttlMs
    return level
  }

  /** 仅用例与诊断使用：当前是否命中缓存（不触发回源）。 */
  function isFresh () {
    return cached !== null && now() < expiresAt
  }

  return { get, invalidate, isFresh }
}

module.exports = { createAccessLevelCache }
