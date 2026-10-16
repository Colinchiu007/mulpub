'use strict'

/**
 * account-proxy.js — 账号代理状态的**按需读取**通道（2026-10-15，nav-perf-ux）
 *
 * ## 为什么单独开这个文件
 *
 * 两条原因，都是既有约定的延续：
 *  ① `account.js` 已在 `check-max-lines` 的行数挂账清单上（登记值 571，main 实测 728），
 *     继续往里堆会撞膨胀容差 —— `account-active.js` / `account-rename.js` 都是同因拆出的。
 *  ② 「读代理状态」与「写代理状态」是不同关注点：写是低频的用户动作，读是进弹窗的前置。
 *
 * ## 为什么需要这个通道（本通道存在的唯一理由）
 *
 * 改造前，`accounts:list` 会为**每个**账号附加 `proxy` 状态：逐账号调用
 * `getAccountProxyStatus()` → `loadCredential()` → `decryptData()` → `deriveKey()` →
 * `crypto.pbkdf2Sync(100000)`。同步 PBKDF2 阻塞主进程事件循环，N 个账号 = N×125ms
 * 串行（实测 8 账号 `accounts:list` 1451–1579ms），用户感知为「点左侧菜单『账号』
 * 好几秒才加载」。
 *
 * #3591 把它改成异步并行（wall-time 降 3.5–3.7x），但**总 CPU 一字未减**，而且
 * `listAccounts()` 每次进账号页都跑 ⇒ 复发性成本。本次（nav-perf-ux）改为：
 * 列表路径**根本不读取**代理状态（账号卡片上的代理行与列表徽标已移除），
 * 代理状态只在用户**打开代理设置弹窗**时经本通道按需读取一次。
 *
 * ## 契约
 *
 * 通道：`account:get-proxy`
 * 入参：`{ accountId: string, platform?: string }`
 * 出参：
 *  - 成功 → `{ code: 0, data: { configured, type?, hostMasked?, port?, hasAuthentication?, invalid? } }`
 *    其中 `hostMasked` 是**掩码后**的主机名，`username`/`password` 永不外传。
 *  - 未登录 / 入参非法 → `{ code: <AUTH_ERROR|VALIDATION_ERROR>, message }`
 *  - 旁路失败（密文损坏 / 主密钥不可用）→ 仍返回 `code: 0` 且 `configured: false`：
 *    弹窗必须能打开，用户仍可重新保存代理；把读取失败说成"打不开设置"是更差的选择。
 *
 * 入参必须是纯 JSON 对象（IPC 序列化约束），且 `accountId` 必须能安全用作路径片段。
 */

function registerAccountProxyReadHandler (ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { AccountManager, getOwnerSubject, ipcLog, isSafePathSegment } = deps

  ipcMain.handle('account:get-proxy', withSenderCheck(async (event, arg) => {
    const startedAt = Date.now()
    ipcLog('info', 'account:get-proxy', 'enter', `platform=${arg?.platform} accountId=${arg?.accountId}`)
    try {
      if (getOwnerSubject() === null) {
        ipcLog('warn', 'account:get-proxy', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      if (!arg || typeof arg !== 'object') {
        ipcLog('warn', 'account:get-proxy', 'validation-failed', '缺少参数对象')
        return { code: EC.VALIDATION_ERROR, message: '缺少参数对象' }
      }
      const { accountId, platform } = arg
      if (!isSafePathSegment(accountId)) {
        ipcLog('warn', 'account:get-proxy', 'validation-failed', `accountId=${accountId}`)
        return { code: EC.VALIDATION_ERROR, message: '缺少或非法 accountId 参数' }
      }
      // platform 在本通道只作合法性校验：代理配置按 accountId 存，读它不需要 platform。
      if (platform !== undefined && platform !== null && !isSafePathSegment(platform)) {
        ipcLog('warn', 'account:get-proxy', 'validation-failed', `platform=${platform}`)
        return { code: EC.VALIDATION_ERROR, message: '非法 platform 参数' }
      }
      if (typeof AccountManager.getAccountProxyStatusLazy !== 'function') {
        ipcLog('warn', 'account:get-proxy', 'unavailable', 'getAccountProxyStatusLazy 不可用')
        return { code: EC.REQUEST_ERROR, message: '代理状态读取不可用' }
      }
      const status = await AccountManager.getAccountProxyStatusLazy(accountId, platform || undefined)
      if (!status || typeof status !== 'object') {
        ipcLog('warn', 'account:get-proxy', 'invalid-status', `accountId=${accountId}`)
        return { code: EC.REQUEST_ERROR, message: '代理状态无效' }
      }
      // 耗时必打：本通道是「弹窗打开后要等多久」的唯一读数来源。
      // 账号页那条慢日志（account.js 的 accounts:list）给了对照基线，本通道对齐它。
      ipcLog('info', 'account:get-proxy', 'ok', `accountId=${accountId} configured=${status.configured === true} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: status }
    } catch (e) {
      ipcLog('error', 'account:get-proxy', 'error', `accountId=${arg?.accountId} message=${e instanceof Error ? e.message : String(e)}`)
      return { code: EC.REQUEST_ERROR, message: e instanceof Error ? e.message : String(e) }
    }
  }))
}

module.exports = { registerAccountProxyReadHandler }
