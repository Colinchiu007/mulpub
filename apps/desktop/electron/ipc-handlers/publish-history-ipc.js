// @ts-check
/**
 * 发布历史 IPC（history:list / history:get / history:delete）
 *
 * 为什么单独成文件：`ipc-handlers/publish.js` 已顶到逐文件行数门禁的上限（500 行），
 * 把「发布历史的读与删」这条独立关注面拆出来，父文件回到限额内。三个 handler 的语义
 * **逐字未改**（归属校验 → 读/删 → 追加 `hasRepublishSnapshot` → 级联清快照）。
 *
 * 归属主体转发唯一实现（helpers.resolveIpcOwnerSubject，QM-6 后端轴 FB5），本文件不另抄一份。
 */
'use strict'

const { createRepublishSnapshotHandlers } = require('./publish-republish-ipc')

/**
 * @param {import('electron').IpcMain} ipcMain
 * @param {object} ctx
 * @param {Record<string, number>} ctx.EC error-codes
 * @param {(fn: Function) => Function} ctx.withSenderCheck
 * @param {() => (string|null|undefined)} ctx.getOwnerSubject
 * @param {(level: string, channel: string, step: string, message: string) => void} ctx.ipcLog
 * @param {object} ctx.history 发布历史服务
 * @param {object} ctx.store 存储依赖（owner 作用域 settings，快照用）
 */
function registerHistoryHandlers (ipcMain, ctx) {
  const { EC, withSenderCheck, getOwnerSubject, ipcLog, history, store } = ctx
  const { withRepublishFlag, withRepublishFlagOne, purgeSnapshots, registerGetSnapshot } =
    createRepublishSnapshotHandlers({ store, ipcLog })

  ipcMain.handle('history:list', withSenderCheck(async (event, opts) => {
    try {
      const owner = getOwnerSubject()
      if (owner === null) {
        ipcLog('warn', 'history:list', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户', data: { total: 0, records: [] } }
      }
      const result = history.listRecords(opts, owner)
      const enriched = { ...result, records: withRepublishFlag(result && result.records, owner) }
      ipcLog('info', 'history:list', 'ok', `owner=${owner} total=${result?.total} records=${Array.isArray(result?.records) ? result.records.length : '?'} page=${opts?.page} pageSize=${opts?.pageSize}`)
      return { code: 0, data: enriched }
    } catch (e) {
      ipcLog('error', 'history:list', 'error', `message=${e.message}`)
      return { code: EC.REQUEST_ERROR, message: e.message, data: { total: 0, records: [] } }
    }
  }))

  ipcMain.handle('history:get', withSenderCheck(async (event, id) => {
    try {
      const owner = getOwnerSubject()
      if (owner === null) {
        ipcLog('warn', 'history:get', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }
      const record = history.getRecord(id, owner)
      if (!record) {
        ipcLog('warn', 'history:get', 'not-found', `id=${id} owner=${owner}`)
        return { code: EC.NOT_FOUND, message: '记录不存在' }
      }
      ipcLog('info', 'history:get', 'ok', `id=${id} platform=${record?.platform} status=${record?.status}`)
      return { code: 0, data: withRepublishFlagOne(record, owner) }
    } catch (e) { ipcLog('error', 'history:get', 'error', `id=${id} message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('history:delete', withSenderCheck(async (event, payload) => {
    try {
      const owner = getOwnerSubject()
      if (owner === null) {
        ipcLog('warn', 'history:delete', 'auth-failed', '无法识别当前用户')
        return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      }

      const ids = Array.isArray(payload) ? payload : payload && payload.ids
      if (!Array.isArray(ids) || ids.length === 0 || ids.length > 100) {
        ipcLog('warn', 'history:delete', 'validation-failed', `ids=${JSON.stringify(ids)}`)
        return { code: EC.VALIDATION_ERROR, message: '记录 ID 列表无效' }
      }
      const normalizedIds = ids
        .filter(id => typeof id === 'string')
        .map(id => id.trim())
        .filter(Boolean)
      if (normalizedIds.length !== ids.length) {
        ipcLog('warn', 'history:delete', 'validation-failed', '记录 ID 格式无效')
        return { code: EC.VALIDATION_ERROR, message: '记录 ID 格式无效' }
      }

      const result = history.deleteRecords(normalizedIds, owner)
      if (!result || result.deleted === 0) {
        ipcLog('warn', 'history:delete', 'not-found', `ids=${normalizedIds.join(',')}`)
        return { code: EC.NOT_FOUND, data: { deleted: 0 }, message: '记录不存在' }
      }
      // 级联清理「再次发布」快照（旁路：失败只出声，记录已删不回滚）
      purgeSnapshots(normalizedIds, owner)
      ipcLog('info', 'history:delete', 'ok', `deleted=${result.deleted} ids=${normalizedIds.join(',')}`)
      return { code: 0, data: result, message: '发布记录已删除' }
    } catch (e) { ipcLog('error', 'history:delete', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  // 「再次发布」：按记录 id 取回该次发布的内容与选项快照（实现见 publish-republish-ipc.js）
  registerGetSnapshot(ipcMain, { withSenderCheck, EC, getOwnerSubject })
}

module.exports = { registerHistoryHandlers }
