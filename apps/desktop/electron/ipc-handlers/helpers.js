// @ts-check
/**
 * IPC Handler 高阶函数工具集
 * 统一 try-catch + 参数校验 + 错误日志，消除模板重复
 *
 * 用法：
 *   const { wrapIpcHandler, wrapIpcHandlerRaw } = require('./helpers')
 *   ipcMain.handle(channel, wrapIpcHandler(async (event, arg) => {
 *     return someService.doSomething(arg)
 *   }, { requireArgs: true, label: channel }))
 *
 * 错误码语义与 ../core/error-codes.js 保持一致（负数）。
 */
const log = require('../services/logger')
const { isTrustedSender } = require('../core/ipc-security')
const { app } = require('electron')

// 从 core/error-codes 获取错误码（项目统一负数语义）
let EC
try {
  EC = require('../core/error-codes').ERROR
} catch (_) {
  // 兜底错误码（与 core/error-codes.js 保持一致，仅在 error-codes 模块不可用时使用）
  EC = {
    SUCCESS: 0,
    REQUEST_ERROR: -1,
    VALIDATION_ERROR: -2,
    AUTH_ERROR: -3,
    NOT_FOUND: -10,
    TIMEOUT_ERROR: -11,
    NETWORK_ERROR: -12,
    IO_ERROR: -13,
    TASK_CANCELLED: -999,
    UNKNOWN_ERROR: -99,
  }
}

/**
 * 提取错误的字符串消息（兼容 Error 实例与非 Error 抛出值）
 * @param {unknown} e
 * @returns {string}
 */
function _errMsg(e) {
  return e instanceof Error ? e.message : String(e)
}

/**
 * 包装 IPC handler，统一 try-catch + 参数校验
 * 自动包裹 { code: 0, data: result } 响应格式
 *
 * 适用于 handler 只需返回数据、无需自定义 message 或 catch 兜底 data 的简单场景。
 *
 * @param {(event: import('electron').IpcMainInvokeEvent, args: any) => Promise<any> | any} fn - 原始 handler
 * @param {object} [opts] - 选项
 * @param {boolean} [opts.requireArgs=false] - 是否强制校验 args 为对象（非对象时返回 VALIDATION_ERROR）
 * @param {string} [opts.label] - 日志标签（用于识别 handler，建议传 channel 名）
 * @returns {(event: any, args: any) => Promise<{code: number, data?: any, message?: string}>}
 */
function wrapIpcHandler(fn, opts = {}) {
  return async (event, args) => {
    try {
      if (opts.requireArgs && (!args || typeof args !== 'object')) {
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const result = await fn(event, args)
      return { code: 0, data: result }
    } catch (e) {
      const msg = _errMsg(e)
      log.error('[IPC] ' + (opts.label || ''), msg)
      return { code: EC.REQUEST_ERROR, message: msg }
    }
  }
}

/**
 * 包装 IPC handler 但不包裹 { code: 0, data } 响应格式
 *
 * 用于 handler 自己返回完整响应对象的场景（含 message 字段等）。
 * 仅统一 try-catch + 参数校验 + 错误日志。
 *
 * @param {(event: import('electron').IpcMainInvokeEvent, args: any) => Promise<object> | object} fn - 原始 handler，需自行返回 { code, data, message } 对象
 * @param {object} [opts] - 选项
 * @param {boolean} [opts.requireArgs=false] - 是否强制校验 args 为对象
 * @param {string} [opts.label] - 日志标签
 * @param {unknown} [opts.catchData] - catch 时的兜底 data（如 []、{} ），未提供则不附加 data 字段
 * @returns {(event: any, args: any) => Promise<{code: number, data?: unknown, message?: string}>}
 */
function wrapIpcHandlerRaw(fn, opts = {}) {
  return async (event, args) => {
    try {
      if (opts.requireArgs && (!args || typeof args !== 'object')) {
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      return await fn(event, args)
    } catch (e) {
      const msg = _errMsg(e)
      log.error('[IPC] ' + (opts.label || ''), msg)
      // 保留原有 handler 在 catch 时的兜底 data 语义（如 list 失败返回空数组）
      return opts.catchData !== undefined
        ? { code: EC.REQUEST_ERROR, message: msg, data: opts.catchData }
        : { code: EC.REQUEST_ERROR, message: msg }
    }
  }
}

/**
 * 检测当前是否为测试环境
 * Vitest 运行时设置 process.env.VITEST 或 NODE_ENV=test
 */
function _isTestEnv() {
  return process.env.NODE_ENV === 'test' ||
         process.env.VITEST === 'true' ||
         (typeof globalThis !== 'undefined' && 'vitest' in globalThis) ||
         (typeof global !== 'undefined' && global.__VITEST__)
}

/**
 * 包装 IPC handler，添加 sender 来源验证
 * 用于敏感操作和包含私有数据的查询，防止恶意页面通过 DOM 注入调用。
 *
 * 测试环境兼容：仅未打包应用放行没有 senderFrame 的旧 mock；
 * 已打包应用或已提供 senderFrame 时始终执行真实来源校验。
 *
 * @param {(event: import('electron').IpcMainInvokeEvent, ...args: any[]) => Promise<any> | any} fn - 原始 handler（通常已用 wrapIpcHandlerRaw 包装）
 * @param {object} [opts]
 * @param {(event: import('electron').IpcMainInvokeEvent) => void} [opts.onUntrusted] - 来源不可信时的回调
 *   （**给需要留痕的通道用**：来源门禁在 handler **之前**拦截 ⇒ handler 里的代码根本不会执行
 *   ⇒ 未授权调用若要进审计，只能由这一格回调补写）
 * @returns {(event: import('electron').IpcMainInvokeEvent, ...args: any[]) => Promise<any>} 包装后的 handler，先校验 sender 可信再执行原逻辑
 */
function withSenderCheck(fn, opts) {
  const isTest = _isTestEnv()
  const onUntrusted = opts && typeof opts.onUntrusted === 'function' ? opts.onUntrusted : null
  return async (event, ...args) => {
    // 仅兼容未打包应用中没有 senderFrame 的旧测试 mock。
    if (isTest && app && app.isPackaged === false && (!event || !event.senderFrame)) {
      return fn(event, ...args)
    }
    if (!isTrustedSender(event, app)) {
      log.warn('[IPC] 未授权的调用来源:', event && event.senderFrame && event.senderFrame.url)
      // ⚠ 回调**不得抛**（它在这里执行 ⇒ 抛了会把「未授权」变成「内部错误」）
      if (onUntrusted) {
        try { onUntrusted(event) } catch (e) { log.warn('[IPC] 未授权来源留痕失败:', e && e.message) }
      }
      return { code: EC.AUTH_ERROR, message: '未授权的调用来源' }
    }
    return fn(event, ...args)
  }
}

/**
 * IPC 读侧的归属三态（判据的唯一实现；publish.js / account.js / performance-loop.js 里的
 * `getOwnerSubject()` 只是转发别名，不构成第二份实现）：
 *   - `undefined` → 身份服务缺席（legacy 档）：调用方应取「无归属桶」，不是报错；
 *   - `null`      → 身份服务在但没有可用 sub：**必须** fail closed，
 *                    把「认不出是谁」渲染成「0 条数据」会让用户以为功能坏了（与 dashboard:stats 同口径）；
 *   - 非空串      → 已去空白的 subject。
 *
 * ⛔ 本函数**没有**收敛全仓：另有四份同型的私有取 sub 实现，改这里不会改到它们，
 * 且其中两份与上面的三态**不一致**（逐文件实测，详见
 * 01-docs/PRD-PUBLISH-METRICS-DASHBOARD-2026-10-04.md §十 第 11 条）：
 *   - `cloud-account.js:31` `ownerSubject()`、`store.js:35` `_getOwnerSubject()` —— 三态与本函数等价，属纯重复；
 *   - `hot-topics.js:19` `_getOwnerSubject()` —— 身份服务缺席时回 **null** 而不是 `undefined`，
 *     即 legacy 档在这里被当成「认不出是谁」fail closed，与本函数的口径相反；
 *   - `scheduler.js:7` `currentOwnerSubject()` —— sub 缺失时 **throw** 而不是回 null（调度器要求必须有身份，属有意设计）。
 * 收敛成一处（逐个决定 legacy 档语义 + 配回归锁）属独立切片，不在本次范围。
 *
 * @param {{getState: () => any}|null|undefined} identityService
 * @returns {string|null|undefined}
 */
function resolveIpcOwnerSubject (identityService) {
  if (!identityService) return undefined
  try {
    const state = identityService.getState()
    if (state && typeof state === 'object' && state.user && typeof state.user.sub === 'string' && state.user.sub.trim()) {
      return state.user.sub.trim()
    }
  } catch (_) { /* fail closed below */ }
  return null
}

module.exports = { wrapIpcHandler, wrapIpcHandlerRaw, withSenderCheck, resolveIpcOwnerSubject, EC }
