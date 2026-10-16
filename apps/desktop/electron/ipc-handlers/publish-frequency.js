// @ts-check
/**
 * 发布频率策略 IPC handlers（publish-frequency-policy-v2）
 *
 * 从 ipc-handlers/publish.js 外移而来 —— 该文件被本次变更推到 645 行，
 * 触到「新代码不得引入超大文件」的逐文件行数门禁（limit=500）。
 * 外移是门禁给的正解（按既有 mixin/composable 范式拆分），不是把门禁调宽。
 *
 * 通道：publishFreq:getPolicy / setPolicy / emergencyRelease / emergencyStatus
 * 约定与 publishRisk:* 一致：withSenderCheck + 入参白名单校验 + EC 错误码 + ipcLog。
 */

function registerPublishFrequencyHandlers (ipcMain, deps) {
  const EC = require('../core/error-codes').ERROR
  const { withSenderCheck } = require('./helpers')
  const { createPublishHelpers } = require('./publish-helpers')
  const { isSafePathSegment, ipcLog } = createPublishHelpers({ log: deps.log })
  const { taskQueue, BrowserWindow, publishIntervalGuard, store } = deps
  // ─── publish-frequency-policy-v2：策略读取 / 覆盖写入 / 紧急放行 ───
  // 与 publishRisk:* 同约定：withSenderCheck + 入参白名单校验 + EC 错误码 + ipcLog。
  const policyModule = require('@multi-publish/shared-utils/src/publish-frequency-policy')

  ipcMain.handle('publishFreq:getPolicy', withSenderCheck(async () => {
    try {
      if (!publishIntervalGuard) return { code: EC.REQUEST_ERROR, message: '发布频率守卫未初始化' }
      const platforms = {}
      for (const p of policyModule.SUPPORTED_PLATFORMS) {
        platforms[p] = publishIntervalGuard._intervals(p)
      }
      let overrides = null
      try {
        overrides = store && typeof store.getSettingObject === 'function'
          ? store.getSettingObject('publishFrequencyPolicy', null)
          : null
      } catch (e) { ipcLog('warn', 'publishFreq:getPolicy', 'overrides-read-failed', e.message) }

      return {
        code: 0,
        data: {
          platforms,
          overrides,
          jitterRatio: publishIntervalGuard.jitterRatio,
          releaseGraceMs: publishIntervalGuard.releaseGraceMs,
          emergencyCooldownHint: 10 * 60 * 1000,
          // 合法域上界由策略模块单一持有，这里只**下发**，渲染层不得再抄一份数字
          // （change: publish-frequency-unwired-surfaces：此前模板里硬编码 :max="999" /
          //  :max="10080"，与主进程 env / 覆盖两条路径的实际合法域不同步）
          dailyMaxUpperBound: policyModule.MAX_DAILY_QUOTA,
          intervalMaxMinutes: policyModule.MAX_INTERVAL_MS / 60000,
        },
      }
    } catch (e) { ipcLog('error', 'publishFreq:getPolicy', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('publishFreq:setPolicy', withSenderCheck(async (event, payload) => {
    const startedAt = Date.now()
    try {
      if (!publishIntervalGuard) return { code: EC.REQUEST_ERROR, message: '发布频率守卫未初始化' }
      if (!store || typeof store.setSetting !== 'function') {
        return { code: EC.REQUEST_ERROR, message: '存储不可用，策略未保存' }
      }
      const raw = payload && payload.policy !== undefined ? payload.policy : null
      // 全有或全无：任一字段非法 ⇒ 整体丢弃。这里必须**在写库前**判定并如实回报，
      // 否则界面会显示「已保存」而实际策略没变（半生效态不可解释）。
      const validated = policyModule.resolvePolicyOverrides(raw, {
        warn: (m) => ipcLog('warn', 'publishFreq:setPolicy', 'overrides-invalid', m),
      })
      if (raw && validated === null) {
        return { code: EC.VALIDATION_ERROR, message: '策略配置非法：已整体拒绝（未保存任何字段）' }
      }
      store.setSetting('publishFrequencyPolicy', validated)
      // 抖动/退避是守卫构造期标量，需要显式下发才即时生效（间隔与日配额是每次现取，无需下发）
      if (validated) {
        if (validated.jitterRatio !== undefined) publishIntervalGuard.setJitterRatio(validated.jitterRatio)
        if (validated.releaseGraceMs !== undefined) publishIntervalGuard.setReleaseGraceMs(validated.releaseGraceMs)
      }
      ipcLog('info', 'publishFreq:setPolicy', 'ok', `fields=${validated ? Object.keys(validated).join(',') : 'cleared'} 耗时=${Date.now() - startedAt}ms`)
      return { code: 0, data: { saved: true, policy: validated } }
    } catch (e) { ipcLog('error', 'publishFreq:setPolicy', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('publishFreq:emergencyRelease', withSenderCheck(async (event, payload) => {
    const startedAt = Date.now()
    ipcLog('info', 'publishFreq:emergencyRelease', 'enter', `payload=${JSON.stringify(payload)}`)
    try {
      const svc = deps.publishEmergencyRelease
      if (!svc) return { code: EC.REQUEST_ERROR, message: '紧急放行服务未初始化' }
      const platform = payload && payload.platform
      const rawAccountId = payload && payload.accountId
      if (!isSafePathSegment(platform)) {
        ipcLog('warn', 'publishFreq:emergencyRelease', 'validation-failed', 'platform 格式无效')
        return { code: EC.VALIDATION_ERROR, message: 'platform 必须为合法平台标识' }
      }
      if (rawAccountId != null && !isSafePathSegment(String(rawAccountId))) {
        ipcLog('warn', 'publishFreq:emergencyRelease', 'validation-failed', 'accountId 格式无效')
        return { code: EC.VALIDATION_ERROR, message: 'accountId 格式无效' }
      }
      const accountId = rawAccountId == null ? null : String(rawAccountId)

      // ① 策略闸：每日上限 / 冷却 / 已关闭 —— 未过闸时**如实回报原因**，不是错误码
      const verdict = svc.check(platform, accountId)
      if (!verdict.allowed) {
        ipcLog('warn', 'publishFreq:emergencyRelease', 'blocked-by-policy', `reason=${verdict.code} used=${verdict.used}/${verdict.max}`)
        return {
          code: 0,
          data: {
            released: false,
            reason: verdict.code,
            used: verdict.used,
            max: verdict.max,
            retryAfterMs: verdict.retryAfterMs || 0,
          },
        }
      }

      // ② 机制可用性：到这一步才检查（策略已放行才需要队列能力；
      //    提前检查会把「已用尽」这类真实原因遮蔽成「队列不可用」）
      if (!taskQueue || typeof taskQueue.emergencyRelease !== 'function') {
        ipcLog('error', 'publishFreq:emergencyRelease', 'queue-unavailable', '任务队列不支持紧急放行')
        return { code: EC.REQUEST_ERROR, message: '任务队列不可用' }
      }

      // ③ 执行：取消防守定时器 → 清窗 → 重新入队（no_waiting_window 属正常结果，不是错误）
      // operator 由服务内部从 identityService 解析，不接受渲染层自报（自报可伪造操作者）
      const r = taskQueue.emergencyRelease(platform, accountId, {
        reason: payload && payload.reason ? String(payload.reason) : undefined,
      })
      if (!r.ok) {
        ipcLog('info', 'publishFreq:emergencyRelease', 'no-op', `reason=${r.code}`)
        return { code: 0, data: { released: false, reason: r.code, used: verdict.used, max: verdict.max } }
      }

      // ③ 记账 + 追加式审计
      const recorded = svc.record(platform, accountId, {
        result: 'ok',
        reason: payload && payload.reason ? String(payload.reason) : undefined,
        clearedKeys: r.clearedKeys,
      })

      try {
        for (const win of BrowserWindow.getAllWindows()) {
          if (win && !win.isDestroyed()) {
            win.webContents.send('publish:emergencyReleased', { platform, accountId, taskId: r.taskId, at: recorded.at })
          }
        }
      } catch (e) { ipcLog('warn', 'publishFreq:emergencyRelease', 'broadcast-failed', e.message) }

      ipcLog('info', 'publishFreq:emergencyRelease', 'ok', `platform=${platform} accountId=${accountId ?? '-'} taskId=${r.taskId} audited=${recorded.audited} 耗时=${Date.now() - startedAt}ms`)
      return {
        code: 0,
        data: {
          released: true,
          taskId: r.taskId,
          clearedKeys: r.clearedKeys,
          used: verdict.used + 1,
          max: verdict.max,
          audited: recorded.audited,
        },
      }
    } catch (e) { ipcLog('error', 'publishFreq:emergencyRelease', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('publishFreq:emergencyStatus', withSenderCheck(async () => {
    try {
      const svc = deps.publishEmergencyRelease
      if (!svc) return { code: EC.REQUEST_ERROR, message: '紧急放行服务未初始化' }
      return { code: 0, data: svc.getStatus() }
    } catch (e) { ipcLog('error', 'publishFreq:emergencyStatus', 'error', `message=${e.message}`); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

}

module.exports = registerPublishFrequencyHandlers