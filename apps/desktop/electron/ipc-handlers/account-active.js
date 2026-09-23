/**
 * 账号「启用态」（is_active）写入通道 —— 从 ipc-handlers/account.js 拆出。
 *
 * 为什么单独成文件：
 * 1) 关注点不同：启用态回答「这个账号能不能用于发布」，登录态回答「现在还登得上吗」，
 *    两者正交、各有唯一写者，混在一个文件里容易被误读成同一条状态；
 * 2) 行数门禁：account.js 是已挂账的超大文件，新增能力不得继续往里堆。
 *
 * 身份解析 / 统一日志 / 路径段白名单一律由调用方（account.js）注入，
 * 避免在同一模块里出现第二份 `_isSafePathSegment` 或第二套日志前缀。
 *
 * @param {import('electron').IpcMain} ipcMain
 * @param {{
 *   AccountManager: any,
 *   getOwnerSubject: () => string | null | undefined,
 *   ipcLog: (level: string, channel: string, stage: string, detail?: string) => void,
 *   isSafePathSegment: (s: unknown) => boolean
 * }} deps
 */
function registerAccountActiveHandler (ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { AccountManager, getOwnerSubject, ipcLog, isSafePathSegment } = deps

  /**
   * 启用态写入通道：账号页「批量启用/停用」的唯一入口。
   * 与登录态严格正交 —— 本通道不触碰 status/last_validated，也不得被登录检测复用。
   */
  ipcMain.handle('account:set-active', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    ipcLog('info', 'account:set-active', 'enter', `platform=${arg?.platform} accountId=${arg?.accountId} isActive=${String(arg?.isActive)}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'account:set-active', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      if (!arg || typeof arg !== 'object') {
        ipcLog('warn', 'account:set-active', 'validation-failed', '缺少参数对象')
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const { accountId, platform, isActive } = arg
      if (!isSafePathSegment(accountId) || !isSafePathSegment(platform)) {
        ipcLog('warn', 'account:set-active', 'validation-failed', `platform=${platform} accountId=${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 accountId/platform 参数' }
      }
      // 必须是真布尔：字符串 'false' 在 JS 中为真值，宽松判断会把「停用」误写成「启用」。
      if (typeof isActive !== 'boolean') {
        ipcLog('warn', 'account:set-active', 'validation-failed', `accountId=${accountId} isActive=${String(isActive)}`)
        return { code: EC.VALIDATION_ERROR, message: 'isActive 必须为布尔值' }
      }
      if (typeof AccountManager.setAccountActive !== 'function') {
        ipcLog('warn', 'account:set-active', 'unavailable', `accountId=${accountId}`)
        return { code: EC.REQUEST_ERROR, message: 'setAccountActive-unavailable' }
      }
      const res = await AccountManager.setAccountActive(accountId, platform, isActive)
      if (!res || res.ok !== true) {
        const reason = (res && res.reason) || 'unknown'
        ipcLog('warn', 'account:set-active', 'failed', `platform=${platform} accountId=${accountId} isActive=${isActive} reason=${reason} code=${(res && res.code) || '-'}`)
        return { code: EC.REQUEST_ERROR, message: reason }
      }
      ipcLog('info', 'account:set-active', 'ok', `platform=${platform} accountId=${accountId} isActive=${isActive} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { accountId, is_active: isActive }, message: isActive ? '账号已启用' : '账号已停用' }
    } catch (e) {
      ipcLog('error', 'account:set-active', 'error', `platform=${arg?.platform} accountId=${arg?.accountId} message=${e instanceof Error ? e.message : String(e)}`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))
}

module.exports = { registerAccountActiveHandler }
