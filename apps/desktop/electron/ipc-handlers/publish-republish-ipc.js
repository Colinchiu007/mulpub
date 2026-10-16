// @ts-check
/**
 * 「再次发布」快照 IPC（PRD-PUBLISH-RECORD-REPUBLISH-2026-10-15）
 *
 * 为什么单独成文件：`ipc-handlers/publish.js` 已是本仓逐文件行数门禁点名的超大文件
 * （`.github/scripts/check-max-lines.js` 的 NEW_OVER_LIMIT），把「快照」这一条独立关注面
 * （存在性标志现算 / 惰性读 / 级联清理）从这里拆出去，既让父文件回到限额内，也让
 * 快照语义有单一归属 —— 它和历史读写的生命周期不同（快照可被淘汰，历史行不会）。
 *
 * 三条语义（改动前先读，容易踩）：
 *   ① `hasRepublishSnapshot` **不落库**，每次由索引现算 ⇒ 淘汰/删除后自动变 false，
 *      不存在「标志说有、实际读不到」的漂移；代价是列表只读一次索引（O(1)），
 *      绝不 N 条记录读 N 次（见 `readSnapshotIdSet`）。
 *   ② 读快照返回 `{ snapshot: null }` 而**不是** NOT_FOUND ——「这条记录没有快照」
 *      （早期记录 / 已按上限淘汰）是正常业务态，前端据此提示而不是走错误分支。
 *   ③ 级联清理是**旁路**：记录已删的事实不回滚（回滚等于把用户删掉的记录找回来），
 *      清理失败只出声。
 */
'use strict'

const republishSnapshot = require('../services/publish-republish-snapshot')

/**
 * @param {object} deps
 * @param {object} deps.store 存储依赖（owner 作用域 settings）
 * @param {(level: string, channel: string, step: string, message: string) => void} deps.ipcLog
 */
function createRepublishSnapshotHandlers (deps) {
  const { store, ipcLog } = deps || {}

  /**
   * 给历史记录附加 `hasRepublishSnapshot`（列表：一次索引读覆盖整页）
   * @param {unknown} records
   * @param {string|undefined} owner
   */
  const withRepublishFlag = (records, owner) => {
    if (!Array.isArray(records) || records.length === 0) return records
    const ids = republishSnapshot.readSnapshotIdSet(owner, { store })
    return records.map(record => (record && typeof record === 'object' && !Array.isArray(record)
      ? { ...record, hasRepublishSnapshot: ids.has(String(record.id || '')) }
      : record))
  }

  /** @param {unknown} record @param {string|undefined} owner */
  const withRepublishFlagOne = (record, owner) => {
    if (!record || typeof record !== 'object') return record
    const ids = republishSnapshot.readSnapshotIdSet(owner, { store })
    return { ...record, hasRepublishSnapshot: ids.has(String(record.id || '')) }
  }

  /**
   * 删除历史记录后级联清快照（孤儿键在 settings 里只增不减）。
   * 失败只出声：记录已删的事实不回滚。
   * @param {string[]} ids
   * @param {string|undefined} owner
   */
  const purgeSnapshots = (ids, owner) => {
    try {
      const purged = republishSnapshot.deleteSnapshots(ids, owner, { store })
      if (purged && purged.deleted > 0) {
        ipcLog('info', 'history:delete', 'snapshots-purged', `count=${purged.deleted}`)
      }
    } catch (e) {
      ipcLog('warn', 'history:delete', 'snapshot-purge-failed', `message=${e && e.message}`)
    }
  }

  /**
   * 注册 `history:get-republish-snapshot`。
   * @param {import('electron').IpcMain} ipcMain
   * @param {object} ctx
   * @param {(fn: Function) => Function} ctx.withSenderCheck
   * @param {Record<string, number>} ctx.EC error-codes
   * @param {() => (string|null|undefined)} ctx.getOwnerSubject
   */
  function registerGetSnapshot (ipcMain, ctx) {
    const { withSenderCheck, EC, getOwnerSubject } = ctx
    ipcMain.handle('history:get-republish-snapshot', withSenderCheck(async (event, recordId) => {
      try {
        const owner = getOwnerSubject()
        if (owner === null) {
          ipcLog('warn', 'history:get-republish-snapshot', 'auth-failed', '无法识别当前用户')
          return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
        }
        if (typeof recordId !== 'string' || !recordId.trim()) {
          ipcLog('warn', 'history:get-republish-snapshot', 'validation-failed', `recordId=${String(recordId)}`)
          return { code: EC.VALIDATION_ERROR, message: '记录 ID 无效' }
        }
        const snapshot = republishSnapshot.readSnapshot(recordId.trim(), owner, { store })
        ipcLog('info', 'history:get-republish-snapshot', 'ok', `recordId=${recordId.trim()} hit=${Boolean(snapshot)}`)
        return { code: 0, data: { snapshot: snapshot || null } }
      } catch (e) {
        ipcLog('error', 'history:get-republish-snapshot', 'error', `message=${e.message}`)
        return { code: EC.REQUEST_ERROR, message: e.message, data: { snapshot: null } }
      }
    }))
  }

  return { withRepublishFlag, withRepublishFlagOne, purgeSnapshots, registerGetSnapshot }
}

module.exports = { createRepublishSnapshotHandlers }
