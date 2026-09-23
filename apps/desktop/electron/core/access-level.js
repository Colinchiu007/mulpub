'use strict'
/**
 * 访问级别协议常量（主进程 ↔ preload 共享，单一来源）
 *
 * 审计 P2·性能税：受限 API 的鉴权级别原先每次调用都走一次同步 IPC 往返，
 * 这里把「查询通道 / 失效推送事件 / 合法级别集合」收成一个常量模块，两侧各自
 * require，杜绝字面量各写一份导致的漂移（ipc-handlers/license-access-control.js 的
 * 服务端判定与 preload/access-control.js 的客户端判定必须使用同一级别全集）。
 *
 * 本文件必须是纯常量（不 require electron）：preload 侧经 esbuild 打进
 * index.bundle.js，在 sandbox renderer 里加载，引入 electron 之外的主进程依赖会炸。
 */

/** 合法访问级别，按权限从低到高排列。 */
const ACCESS_LEVELS = Object.freeze(['public', 'authenticated', 'admin'])

/** preload → 主进程：同步查询当前访问级别。 */
const ACCESS_LEVEL_CHANNEL = 'auth:get-access-level'

/**
 * 主进程 → preload：访问级别可能已变化，请丢弃缓存。
 * 刻意只推「失效」而不推「级别」——级别判定含 sender 可信度，服务端才是权威；
 * 推信号不扩大敏感信息暴露面，也避免两侧各算一份级别。
 */
const ACCESS_LEVEL_INVALIDATE_EVENT = 'auth:access-level-invalidated'

/**
 * 失效推送的兜底 TTL：即使漏收推送（试用到期由墙钟决定、或将来新增变更点忘记广播），
 * 最长一个 TTL 后也会回源一次，不会永久停留在旧级别。
 */
const ACCESS_LEVEL_TTL_MS = 2000

/** @param {unknown} value */
function isAccessLevel (value) {
  return ACCESS_LEVELS.includes(value)
}

module.exports = {
  ACCESS_LEVELS,
  ACCESS_LEVEL_CHANNEL,
  ACCESS_LEVEL_INVALIDATE_EVENT,
  ACCESS_LEVEL_TTL_MS,
  isAccessLevel,
}
