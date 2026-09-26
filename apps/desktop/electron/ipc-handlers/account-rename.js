/**
 * 账号「显示名」写入通道 —— 用户显式改名的唯一入口。
 *
 * 为什么单独成文件（对齐 ./account-active.js 的同一决定）：account.js 是已挂账的超大文件，
 * 新增能力不得继续往里堆。
 *
 * 为什么必须新开通道而不是复用 `accountUpdate`：`accountUpdate` → `store:update-account`
 * 写的是 **Electron SQLite**，而账号列表读的是 **python-backend `accounts.json`**
 * （`src/api/publisher.js:103` 已有明文注释「写了也不显示」）。于是改名此前是空操作 ——
 * 用户输入的名字从来没有到达被读取的那份真源。这是本仓「装饰性链路」的第四次复发，
 * 详见 openspec change: add-account-name-source。
 *
 * 写入语义：改名即用户显式意图，故同时把 `name_source` 置为 `manual`。展示层据此
 * 跳过噪声过滤（否则含 ` - ` / ` · ` / `…` 的正常昵称会被当成抓取错误藏掉）。
 *
 * @param {import('electron').IpcMain} ipcMain
 * @param {{
 *   AccountManager: any,
 *   getOwnerSubject: () => string | null | undefined,
 *   ipcLog: (level: string, channel: string, stage: string, detail?: string) => void,
 *   isSafePathSegment: (s: unknown) => boolean
 * }} deps
 */
function registerAccountRenameHandler (ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { AccountManager, getOwnerSubject, ipcLog, isSafePathSegment } = deps

  ipcMain.handle('account:rename', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    ipcLog('info', 'account:rename', 'enter', `accountId=${arg?.accountId} nameLen=${typeof arg?.name === 'string' ? arg.name.length : '-'}`)
    try {
      const ownerSubject = getOwnerSubject()
      if (!ownerSubject) {
        ipcLog('warn', 'account:rename', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '请先登录' }
      }
      if (!arg || typeof arg !== 'object') {
        ipcLog('warn', 'account:rename', 'validation-failed', '缺少参数对象')
        return { code: EC.VALIDATION_ERROR, message: '缺少参数' }
      }
      const { accountId, platform } = arg
      if (!accountId || !isSafePathSegment(String(accountId)) || !platform || !isSafePathSegment(String(platform))) {
        ipcLog('warn', 'account:rename', 'validation-failed', `platform=${platform} accountId=${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '账号标识不合法' }
      }
      const name = typeof arg.name === 'string' ? arg.name.trim() : ''
      // 空串不写：后端 PATCH 里空串是「显式清空」而不是「不修改」，会把昵称抹成空白。
      if (!name || name.length > 100) {
        ipcLog('warn', 'account:rename', 'validation-failed', `accountId=${accountId} nameLen=${name.length}`)
        return { code: EC.VALIDATION_ERROR, message: '账号名称不能为空且不超过 100 字' }
      }
      const res = await AccountManager.renameAccount(accountId, platform, name)
      if (!res || res.ok !== true) {
        const reason = (res && res.reason) || 'unknown'
        ipcLog('warn', 'account:rename', 'failed', `platform=${platform} accountId=${accountId} reason=${reason} code=${(res && res.code) || '-'}`)
        return { code: (res && res.code) || EC.REQUEST_ERROR, message: (res && res.message) || '改名失败' }
      }
      ipcLog('info', 'account:rename', 'ok', `platform=${platform} accountId=${accountId} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: res.account }
    } catch (e) {
      ipcLog('error', 'account:rename', 'error', `accountId=${arg?.accountId} message=${e instanceof Error ? e.message : String(e)}`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))
}

module.exports = { registerAccountRenameHandler }
