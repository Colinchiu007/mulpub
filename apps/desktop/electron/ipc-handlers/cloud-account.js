// @ts-check
/**
 * 账号云镜像同步 IPC
 *
 * 通道全部以字面量出现在 ipcMain.handle( 中：本仓有 preload ↔ handler 静态合同扫描，
 * 循环变量注册不可见。
 *
 * @param {import('electron').IpcMain} ipcMain
 * @param {{
 *   app: { getPath: (name: string) => string },
 *   BrowserWindow: typeof import('electron').BrowserWindow,
 *   AccountManager: any,
 *   credentialStore: { loadCredential: Function, saveCredential: Function },
 *   identityService?: { getState: () => any, memberApiService?: any },
 *   log: { info: Function, warn: Function, error: Function },
 * }} deps
 */
function registerHandlers (ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { createCloudAccountSync } = require('../services/cloud-account-sync')
  const { fetchAccountInfoViaHttpApi, checkLoginViaHttpApi } = require('../publishers/http-login-checker')
  const { app, BrowserWindow, AccountManager, credentialStore, identityService, log } = deps

  function ipcLog (level, stage, detail) {
    const sink = log && log[level]
    if (typeof sink === 'function') sink('AccountIPC', `cloud-account ${stage}${detail ? ' :: ' + detail : ''}`)
  }

  /** 归属身份：只取本机已登录会话的 sub；取不到一律 fail closed */
  function ownerSubject () {
    if (!identityService) return undefined
    try {
      const state = identityService.getState()
      if (state && typeof state === 'object' && state.user && typeof state.user.sub === 'string' && state.user.sub.trim()) {
        return state.user.sub.trim()
      }
    } catch (_) { /* fail closed below */ }
    return null
  }

  const service = createCloudAccountSync({
    AccountManager,
    credentialStore,
    fetchAccountInfo: (platform, cookies) => fetchAccountInfoViaHttpApi(platform, cookies),
    // 冲突裁决的检测必须问平台，走既有 HTTP 检测链路；无定论由服务侧按单向证据规则处理
    checkLogin: (platform, cookies) => checkLoginViaHttpApi(platform, cookies),
    apiClient: identityService && identityService.memberApiService
      ? { request: (o) => identityService.memberApiService.request(o) }
      : null,
    userDataDir: (() => {
      try { return app.getPath('userData') } catch (e) { ipcLog('warn', 'userdata-path-failed', String(e && e.message || e)); return '' }
    })(),
    env: process.env,
    broadcast: (payload) => {
      try {
        const win = BrowserWindow.getAllWindows()[0]
        if (win && !win.isDestroyed()) win.webContents.send('accounts:cloud-sync-progress', payload)
      } catch (_) { /* 广播失败不阻断同步 */ }
    },
    log,
  })

  function guard (channel, handler) {
    return withSenderCheck(async (event, arg) => {
      const subject = ownerSubject()
      if (subject === null || subject === undefined) {
        ipcLog('warn', channel, 'auth-failed :: 无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: null }
      }
      try {
        return await handler(subject, arg)
      } catch (e) {
        ipcLog('error', channel, `exception :: ${e && e.message ? e.message : String(e)}`)
        return { code: EC.REQUEST_ERROR, message: e && e.message ? e.message : String(e), data: null }
      }
    })
  }

  ipcMain.handle('accounts:cloud-digest', guard('accounts:cloud-digest', async (subject) => {
    const res = await service.digest(subject)
    ipcLog('info', 'accounts:cloud-digest', `reachable=${res.data.reachable} total=${res.data.total} local=${res.data.localCount}`)
    return res
  }))

  ipcMain.handle('accounts:cloud-sync', guard('accounts:cloud-sync', async (subject) => {
    const res = await service.sync(subject)
    if (res.code === 0) {
      const d = res.data
      ipcLog('info', 'accounts:cloud-sync', `done :: created=${d.created} updated=${d.updated} unchanged=${d.unchanged} restored=${d.restored} skipped=${d.skipped} conflicts=${d.conflicts} invalid=${d.invalid} uidUnavailable=${d.uidUnavailable} failed=${d.failed} aborted=${d.aborted}`)
      return res
    }
    ipcLog('warn', 'accounts:cloud-sync', `not-done :: code=${res.errorCode}`)
    return res
  }))

  ipcMain.handle('accounts:cloud-disconnect', guard('accounts:cloud-disconnect', async (subject, arg) => {
    const confirm = arg && typeof arg.confirm === 'string' ? arg.confirm : ''
    const res = await service.disconnect(subject, confirm)
    ipcLog(res.code === 0 ? 'info' : 'warn', 'accounts:cloud-disconnect', `code=${res.code}${res.errorCode ? ' errorCode=' + res.errorCode : ''}`)
    return res
  }))

  ipcMain.handle('accounts:cloud-sync-abort', withSenderCheck(() => {
    const stopped = service.requestAbort()
    ipcLog('info', 'accounts:cloud-sync-abort', `stopped=${stopped}`)
    return { code: 0, data: { aborted: stopped } }
  }))
}

module.exports = registerHandlers
