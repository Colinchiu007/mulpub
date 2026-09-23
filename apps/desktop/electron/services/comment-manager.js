// @ts-check
/**
 * CommentManager — 评论管理服务 (PRD F13)
 *
 * 桥接渲染进程 ↔ CommentMessageService（来自 @multi-publish/api-publish-engine）
 *
 * 功能：
 *   1. comment:list          — 一次性拉取平台评论
 *   2. comment:reply         — 一次性回复指定评论
 *   3. comment:start-polling — 启动后台轮询（CommentMessageService）
 *   4. comment:stop-polling  — 停止轮询
 *   5. comment:status        — 列出活跃轮询
 *
 * Provider 实现：
 *   OrchestratorCommentProvider — 调用 orchestrator API（/api/comments/:platform）
 *   当 ORCHESTRATOR_URL 未配置时，list 返回空数组、reply 返回明确错误
 */
const path = require('path')
const os = require('os')
const { app } = require('electron')
const log = require('./logger')
const credentialStore = require('./credential-store')
const {
  CommentMessageService,
  CommentProvider,
  EchoReplyGenerator,
  TemplateReplyGenerator,
} = require('@multi-publish/api-publish-engine/src/comment-service')
const EC = require('../core/error-codes').ERROR
const { withSenderCheck } = require('../ipc-handlers/helpers')

const ORCHESTRATOR_BASE = process.env.ORCHESTRATOR_URL || ''
const SAFE_IDENTIFIER = /^[a-zA-Z0-9_-]+$/
const SAFE_COOKIE_NAME = /^[!#$%&'*+\-.^_`|~0-9A-Za-z]+$/

function getUserDataDir () {
  try { return app.getPath('userData') } catch { return path.join(os.homedir(), '.multi-publish') }
}

function serializeCookieHeader (cookies) {
  if (!Array.isArray(cookies)) return ''
  return cookies
    .filter(cookie => (
      cookie &&
      typeof cookie.name === 'string' &&
      typeof cookie.value === 'string' &&
      SAFE_COOKIE_NAME.test(cookie.name) &&
      !/[\r\n;]/.test(cookie.value)
    ))
    .map(cookie => `${cookie.name}=${cookie.value}`)
    .join('; ')
}

/**
 * OrchestratorCommentProvider — 通过 orchestrator API 拉取/回复评论
 * 遵循 CommentProvider 基类契约
 */
class OrchestratorCommentProvider extends CommentProvider {
  constructor (platform) {
    super()
    // R14 输入校验：platform 拼入 URL 路径（/api/comments/:platform），必须限定安全字符集
    // 防止 platform 含 /、..、?、# 等操纵 URL 路径（URL 路径穿越）
    if (typeof platform !== 'string' || !/^[a-zA-Z0-9_-]+$/.test(platform)) {
      throw new Error('Invalid platform: ' + platform + ' (only [a-zA-Z0-9_-] allowed)')
    }
    this._platform = platform
    this._axios = null
  }

  _getAxios () {
    if (!this._axios) this._axios = require('axios')
    return this._axios
  }

  async getCommentList (cookie, params) {
    if (!ORCHESTRATOR_BASE) {
      log.warn('CommentManager', 'ORCHESTRATOR_URL 未配置，返回空评论列表')
      return []
    }
    const axios = this._getAxios()
    try {
      const resp = await axios({
        method: 'GET',
        url: ORCHESTRATOR_BASE + '/api/comments/' + this._platform,
        headers: { Cookie: cookie || '' },
        params: { max_days: (params && params.maxDays) || 7 },
        timeout: 30000,
      })
      return Array.isArray(resp.data) ? resp.data : (resp.data && resp.data.comments) || []
    } catch (e) {
      log.error('CommentManager', 'getCommentList(' + this._platform + ') failed: ' + e.message)
      return []
    }
  }

  /** @returns {Promise<{success: boolean, data?: any, error?: string}>} */
  async replyComment (cookie, commentId, content) {
    if (!ORCHESTRATOR_BASE) {
      return { success: false, error: 'ORCHESTRATOR_URL 未配置，无法回复评论' }
    }
    const axios = this._getAxios()
    try {
      const resp = await axios({
        method: 'POST',
        url: ORCHESTRATOR_BASE + '/api/comments/' + this._platform + '/reply',
        headers: { Cookie: cookie || '', 'Content-Type': 'application/json' },
        data: { comment_id: commentId, content: content },
        timeout: 30000,
      })
      return { success: true, data: resp.data }
    } catch (e) {
      const detail = e.response && e.response.data && e.response.data.detail
      log.error('CommentManager', 'replyComment(' + this._platform + ') failed: ' + (detail || e.message))
      return { success: false, error: detail || e.message }
    }
  }
}

class CommentManager {
  constructor () {
    /** @type {Map<string, CommentMessageService>} */
    this._services = new Map()
    this._getMainWin = null
    this._ownerSubjectProvider = null
  }

  setGetMainWin (fn) { this._getMainWin = fn }

  setOwnerSubjectProvider (provider) {
    if (provider !== null && provider !== undefined && typeof provider !== 'function') {
      throw new TypeError('ownerSubjectProvider 必须是函数或 null')
    }
    this._ownerSubjectProvider = provider || null
  }

  _resolveOwnerSubject () {
    if (!this._ownerSubjectProvider) return undefined
    const ownerSubject = this._ownerSubjectProvider()
    if (typeof ownerSubject !== 'string' || !ownerSubject.trim()) {
      throw new Error('登录会话缺少用户标识')
    }
    return ownerSubject.trim()
  }

  /**
   * 仅在主进程中把加密 Cookie 转成 HTTP 请求头。
   * @param {string} accountId
   */
  resolveCookieHeader (accountId, ownerSubject = this._resolveOwnerSubject()) {
    if (typeof accountId !== 'string' || !SAFE_IDENTIFIER.test(accountId)) {
      throw new Error('缺少或非法账号 ID')
    }
    const userDataDir = getUserDataDir()
    const credentials = ownerSubject === undefined
      ? credentialStore.loadCredential(accountId, userDataDir)
      : credentialStore.loadCredential(accountId, userDataDir, ownerSubject)
    const cookieHeader = serializeCookieHeader(credentials && credentials.cookies)
    if (!cookieHeader) throw new Error('未找到账号登录凭证')
    return cookieHeader
  }

  _emit (channel, data) {
    const win = this._getMainWin && this._getMainWin()
    if (win && !win.isDestroyed()) {
      try { win.webContents.send(channel, data) } catch (e) { /* ignore */ }
    }
  }

  /**
   * 一次性拉取评论
   * @param {string} platform
   * @param {string} accountId
   * @param {{maxDays?: number}} [opts]
   */
  async listComments (platform, accountId, opts) {
    const cookie = this.resolveCookieHeader(accountId)
    const provider = new OrchestratorCommentProvider(platform)
    const list = await provider.getCommentList(cookie, { maxDays: (opts && opts.maxDays) || 7 })
    return list
  }

  /**
   * 一次性回复评论
   * @param {string} platform
   * @param {string} accountId
   * @param {string} commentId
   * @param {string} content
   */
  async replyComment (platform, accountId, commentId, content) {
    const cookie = this.resolveCookieHeader(accountId)
    const provider = new OrchestratorCommentProvider(platform)
    return provider.replyComment(cookie, commentId, content)
  }

  /**
   * 启动后台轮询
   * @param {{platform: string, accountId: string, interval?: number, maxDays?: number, template?: string}} opts
   * @returns {Promise<{key: string, started: boolean, message?: string}>}
   */
  async startPolling (opts) {
    const platform = opts.platform
    const accountId = opts.accountId
    if (typeof platform !== 'string' || !SAFE_IDENTIFIER.test(platform)) throw new Error('缺少或非法平台')
    const cookie = this.resolveCookieHeader(accountId)
    const key = platform + ':' + accountId
    if (this._services.has(key)) {
      return { key: key, started: false, message: 'already running' }
    }
    const replyGen = opts.template
      ? new TemplateReplyGenerator({ template: opts.template })
      : new EchoReplyGenerator()
    const service = new CommentMessageService(
      { platform: platform, cookie: cookie },
      {
        interval: opts.interval || 30000,
        maxDays: opts.maxDays || 7,
        replyGenerator: replyGen,
      }
    )
    service.setProvider(new OrchestratorCommentProvider(platform))
    service.onReply((comment, reply) => {
      this._emit('comment:replied', { platform: platform, accountId: accountId, comment: comment, reply: reply })
    })
    // M-4 修复：TOCTOU 竞态——先占位再 await start()，避免并发调用导致 service 孤立泄漏
    this._services.set(key, service)
    try {
      await service.start()
    } catch (e) {
      this._services.delete(key)
      throw e
    }
    log.info('CommentManager', 'Started polling for ' + key)
    return { key: key, started: true }
  }

  /**
   * 停止后台轮询
   * @param {string} key  形如 "platform:accountId"
   */
  async stopPolling (key) {
    const service = this._services.get(key)
    if (!service) return { stopped: false, message: 'not running' }
    await service.stop()
    this._services.delete(key)
    log.info('CommentManager', 'Stopped polling for ' + key)
    return { stopped: true }
  }

  /**
   * 停止所有轮询（应用退出时调用）
   */
  async stopAll () {
    const keys = Array.from(this._services.keys())
    for (const k of keys) {
      const s = this._services.get(k)
      try { await s.stop() } catch (e) { /* ignore */ }
      this._services.delete(k)
    }
    log.info('CommentManager', 'Stopped all polling (' + keys.length + ')')
  }

  /**
   * 列出活跃轮询
   */
  getStatus () {
    const result = []
    for (const [key, service] of this._services) {
      result.push({
        key: key,
        platform: service.account && service.account.platform,
        interval: service.interval,
        maxDays: service.maxDays,
        lastTimestamp: service._lastTimestamp,
        polling: service._polling,
      })
    }
    return result
  }

  registerIpcHandlers (injectedIpcMain) {
    // P1-14：必须注入 access-controlled ipcMain（createAccessControlledIpcMain）。
    // 禁止回退全局 ipcMain —— 那会同时绕过 isTrustedSender 来源校验与许可证/权益门禁，
    // 且在纯 Node（单测）下退化成无信息量的 TypeError。未注入即 fail-closed 抛错。
    if (!injectedIpcMain) {
      throw new Error('[IPC] comment-manager registerIpcHandlers 需要注入受控 ipcMain（禁止使用全局 ipcMain）');
    }
    const ipcMain = injectedIpcMain;
    ipcMain.handle('comment:list', withSenderCheck(async (_event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { platform, accountId, maxDays } = arg
      try {
        const data = await this.listComments(platform, accountId, { maxDays: maxDays })
        return { code: 0, data: data }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
      }
    }))

    ipcMain.handle('comment:reply', withSenderCheck(async (_event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { platform, accountId, commentId, content } = arg
      try {
        const result = await this.replyComment(platform, accountId, commentId, content)
        if (result && result.success) return { code: 0, data: result.data }
        return { code: EC.REQUEST_ERROR, message: (result && result.error) || '回复失败' }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('comment:start-polling', withSenderCheck(async (_event, opts) => {
      try {
        const result = await this.startPolling(opts || {})
        return { code: 0, data: result }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('comment:stop-polling', withSenderCheck(async (_event, arg) => {
      if (!arg || typeof arg !== 'object') return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      const { key } = arg
      try {
        const result = await this.stopPolling(key)
        return { code: 0, data: result }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message }
      }
    }))

    ipcMain.handle('comment:status', withSenderCheck(async () => {
      try {
        return { code: 0, data: this.getStatus() }
      } catch (e) {
        return { code: EC.REQUEST_ERROR, message: e.message, data: [] }
      }
    }))
  }
}

module.exports = CommentManager
