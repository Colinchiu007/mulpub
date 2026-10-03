// @ts-check
/**
 * Phase 4: 事件总线接线
 *
 * 从 bootstrap.js 拆出：taskQueue 事件监听
 * - task:success → 发布成功通知 + 历史记录 + 发布监控 + 影响力追踪 + 回采登记
 * - task:failed → 发布失败通知（风控命中 → 同步登记挂起，§5 enforcement）
 * - publish:blocked → 发布间隔限制通知
 * - task:retry → 重试通知
 * - task:cancelled → 取消终态转发（publish-progress-panel-refine；不落历史不挂风控）
 *
 * 验收标准 BUGFIX-PLAN Bug-1: phase 文件 ≤ 80 行
 */
const log = require('../services/logger')
const { isRiskBlocked } = require('../services/publish-risk')
const { isRiskSuspendedMessage } = require('../services/risk-suspender-store')
const { createPublishProgressEmitter } = require('../services/publish-progress-events')
const { safeHttpUrl } = require('@multi-publish/shared-utils/src/safe-http-url')
// P0-1 审核状态：监控状态 → 审核状态的映射与落库补丁单一真源（shared-utils，渲染端走 ESM 孪生）。
const { buildAuditPatch } = require('@multi-publish/shared-utils/src/publish-audit-status')
// P0-1 第二切片：审核回查的凭证解析与能力分级（凭证恒空缺陷修复 + 端点未验证的诚实分级）。
const { resolveAuditRequeryCookies, decideAuditRequery } = require('../services/publish-audit-requery')

const defaultAuditRequery = {
  resolveCookies: (params) => resolveAuditRequeryCookies(params),
  decide: (params) => decideAuditRequery(params),
}

/**
 * 接线 taskQueue 事件监听
 * @param {object} deps
 * @param {object} deps.taskQueue
 * @param {object} deps.history
 * @param {object} deps.publishMonitor
 * @param {object} deps.publishImpactTracker
 * @param {object} [deps.store] - 效果闭环：tracked_content 登记（可选）
 * @param {Function} deps.getMainWin
 * @param {object} [deps.riskSuspender] - 风控挂起守卫（desktop-risk-suspender，可选）
 * @param {object} [deps.progressEmitter] - 进度事件发射器（可选，缺省自建；publish-progress-ux）
 * @param {object} [deps.failureDraftSaver] - 发布失败自动存草稿（publish-fail-draft-guard，可选）
 */
function wireTaskQueueEvents({ taskQueue, history, publishMonitor, publishImpactTracker, getMainWin, store, riskSuspender, progressEmitter, auditRequery, failureDraftSaver }) {
  // publish-progress-ux：四事件统一走富化 emitter（phase/stageKey/percent/batchId/timestamp），
  // 既有字段（platform/taskId/stage/result/error/remainingWait）原样保留，向后兼容加法。
  const emitter = progressEmitter || createPublishProgressEmitter({ getMainWin })
  // P0-1 第二切片：审核回查的策略层（凭证解析 + 能力分级）；测试可注入替身。
  const requery = auditRequery || defaultAuditRequery

  /**
   * 审核回查启动门：解析凭证 → 能力分级 → 通过才建监控任务。
   * 任何失败只 warn（旁路绝不冒泡影响发布主流程）。
   */
  async function startAuditRequery (task, postId, ownerSubject) {
    let resolved
    try {
      resolved = await requery.resolveCookies({
        platform: task.platform,
        accountId: task.article?.accountId || task.accountId || null,
        providedCookies: task.article?.cookies || '',
      })
    } catch (e) {
      // 凭证解析属旁路：失败按「拿不到」处理，绝不冒泡（发布主流程不受影响）
      log.notify('PublishMonitor', 'audit-requery-cookie-resolution-failed', { level: 'WARN', error: String(e && e.message) })
      return
    }
    const cookies = (resolved && typeof resolved.cookies === 'string') ? resolved.cookies : ''
    const source = (resolved && resolved.source) || 'none'
    const decision = requery.decide({ platform: task.platform, cookies })
    if (!decision.start) {
      // 凭证缺失/端点未验证/探索开关关闭 —— 一律不建任务，避免「必然失败的重试风暴」
      log.notify('PublishMonitor', 'audit-requery-skipped', { level: 'INFO', params: { platform: task.platform, reason: decision.reason, source } })
      return
    }
    publishMonitor.createMonitorTask({
      postId, platform: task.platform, cookies,
      callback: (monitorResult) => {
        log.notify('PublishMonitor', 'monitor-result', { level: 'INFO', params: { platform: task.platform, postId, status: monitorResult.status } })
        // P0-1 第一切片：审核结论**回写原记录**，不再 addRecord 追加第二条
        // （旧形态让同一次发布在历史里出现两行，且原 success 行与审核结论无法关联）。
        // buildAuditPatch 只在平台给出**明确结论**时产出补丁（无定论/error/timeout/
        // skipped 返回 null）——「没拿到新证据」不是反证，不得抹掉既有审核结论。
        const patch = buildAuditPatch(monitorResult)
        if (!patch) {
          log.notify('PublishMonitor', 'audit-status-inconclusive', { level: 'INFO', params: { platform: task.platform, postId, status: monitorResult.status } })
          return
        }
        try {
          const { updated } = history.updateRecordAudit(task.id, patch, ownerSubject)
          if (!updated) {
            log.notify('PublishMonitor', 'audit-update-skipped', { level: 'WARN', params: { taskId: task.id } })
          }
        } catch (e) {
          log.notify('PublishMonitor', 'audit-update-failed', { level: 'WARN', error: String(e.message) })
        }
      },
    })
  }
  taskQueue.on('task:success', (task) => {
    emitter.emit(task.id, task.platform, 'success', {
      stage: '✓ 发布成功', percent: 100, result: task.result, batchId: task.batchId || null,
    })
    const ownerSubject = task.owner_subject
    history.addRecord({
      platform: task.platform, title: task.article?.title || '', taskId: task.id,
      status: 'success', result: task.result,
      // 定时派发任务带 publishMode='scheduled'（scheduler/batch-manager 排期入队时标记），
      // 历史页「定时发布」过滤器与详情「发布模式」据此区分定时/立即发布。
      ...(task.publishMode ? { publishMode: task.publishMode } : {}),
    }, ownerSubject)
    try {
      const postId = task.result?.postId || task.result?.id
      if (postId) {
        // P0-1 第二切片：先解析凭证（任务自带→auth 分区只读补齐）再决定是否回查。
        // 凭证拿不到就**不建监控任务**——旧形态传 `article.cookies`（全仓从未写入）导致
        // 每次发布都发 12 次必然失败的请求后再 timeout。异步门不阻塞发布主流程；
        // `.catch` 必须挂（策略层抛错不得变成 unhandledRejection）。
        void startAuditRequery(task, postId, ownerSubject).catch((e) => {
          log.notify('PublishMonitor', 'audit-requery-gating-failed', { level: 'WARN', error: String(e && e.message) })
        })
      }
    } catch (e) { log.notify('PublishMonitor', 'monitor-start-failed', { level: 'WARN', error: String(e.message) }) }
    try {
      const title = task.article?.title
      const content = task.article?.content || title
      if (title && content) {
        // 2026-09-28 活体残余②修复：真实类方法是 scheduleImpactTracking
        // （publish-impact-tracker.js），旧调用 addTracking 不存在——
        // TypeError 被下方 catch 吞成 warn（产线日志「addTracking is not a function」）。
        publishImpactTracker.scheduleImpactTracking({
          articleId: task.id, title, keywords: task.article?.keywords || [title],
          platform: task.platform,
        })
        log.notify('ImpactTracker', 'impact-tracking-started', { level: 'INFO', params: { title } })
      }
    } catch (e) { log.notify('ImpactTracker', 'impact-tracking-start-failed', { level: 'WARN', error: String(e.message) }) }

    // P2 效果闭环：发布成功登记 tracked_content（有 postId 或内容 URL → pending 排期回采；都没有 → untrackable 仅手动）
    try {
      if (store && typeof store.addTrackedContent === 'function') {
        const result = task.result || {}
        const postId = result.postId || result.publishId || ''
        const url = safeHttpUrl(result.url) || ''
        const hasAnchor = Boolean(postId || url)
        store.addTrackedContent({
          platform: task.platform,
          postId: String(postId || ''),
          url,
          rewriteHistoryId: task.rewriteHistoryId || task.article?.rewriteHistoryId || null,
          recrawlStatus: hasAnchor ? 'pending' : 'untrackable',
          nextRecrawlAt: hasAnchor ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null, // T+1h 首采
          ownerSubject,
        })
      }
    } catch (e) { log.notify('PerformanceLoop', 'register-tracked-content-failed', { level: 'WARN', error: String(e.message) }) }
  })

  taskQueue.on('task:failed', (task) => {
    emitter.emit(task.id, task.platform, 'failed', {
      stage: '✗ 发布失败: ' + task.error, percent: 100, error: task.error, batchId: task.batchId || null,
    })
    // publish-progress-ux（G8 修复）：失败必须落发布历史——此前 task:failed 只发事件不落库，
    // 失败结果在任何页面都查不到（历史页 failed 过滤器实际只匹配监控回调写入的记录）。
    // addRecord 内建 try/catch，写入失败不阻塞发布主流程。
    history.addRecord({
      platform: task.platform, title: task.article?.title || '', taskId: task.id,
      status: 'failed', result: null, error: task.error,
      ...(task.publishMode ? { publishMode: task.publishMode } : {}),
    }, task.owner_subject)
    // publish-fail-draft-guard：媒体内容（视频/图文）发布失败 → 自动回存草稿防丢失。
    // 旁路红线：saver 内建全量 try/catch（资格判定不过跳过、写入失败只 warn），
    // 同步/异步失败都不冒泡，绝不影响失败主流程（历史落库/失败通知/风控挂起）。
    if (failureDraftSaver && typeof failureDraftSaver.saveFailureDraft === 'function') {
      try {
        const saved = failureDraftSaver.saveFailureDraft(task)
        if (saved && typeof saved.catch === 'function') {
          saved.catch((e) => log.notify('FailureDraftSaver', 'auto-draft-save-rejected', { level: 'WARN', error: String(e && e.message) }))
        }
      } catch (e) {
        log.notify('FailureDraftSaver', 'auto-draft-save-failed', { level: 'WARN', error: String(e && e.message) })
      }
    }
    const win = getMainWin()
    if (win && !win.isDestroyed()) {
      if (isRiskBlocked(task.error) && !isRiskSuspendedMessage(task.error)) {
        const accountId = (task.article && task.article.accountId) || null
        // §5 enforcement：风控命中 → 平台/账号即时挂起（resume 仅显式），并广播全量挂起清单供前端刷新
        if (riskSuspender) {
          try {
            riskSuspender.suspend(task.platform, accountId, { reason: 'risk_blocked', error: task.error })
            win.webContents.send('publish:risk-suspended', { suspended: riskSuspender.listSuspended() })
          } catch (e) { log.notify('RiskSuspender', 'suspend-failed', { level: 'WARN', error: String(e.message) }) }
        }
        win.webContents.send('publish:risk-hold', {
          platform: task.platform, accountId, taskId: task.id, error: task.error,
        })
      }
    }
  })

  taskQueue.on('publish:blocked', ({ task, remainingWait }) => {
    emitter.emit(task.id, task.platform, 'blocked', {
      stage: '⏳ 发布间隔限制，等待 ' + Math.ceil(remainingWait / 60000) + ' 分钟后重试',
      remainingWait, batchId: task.batchId || null,
    })
  })

  taskQueue.on('task:retry', (task) => {
    emitter.emit(task.id, task.platform, 'retry', {
      stage: '⟳ 重试中... (剩余 ' + task.retriesLeft + ' 次)',
      retriesLeft: task.retriesLeft, batchId: task.batchId || null,
    })
  })

  // publish-progress-panel-refine：取消终态转发——TaskQueue cancel()（pending 移除与
  // running 协作中止两路径）都发 task:cancelled，但此前无人转发到渲染层：页面级取消后
  // 全局面板永远显示「进行中」。取消不是失败：不落发布历史、不触发风控挂起。
  taskQueue.on('task:cancelled', (task) => {
    emitter.emit(task.id, task.platform, 'cancelled', {
      stage: '⊘ 已取消', batchId: task.batchId || null,
    })
  })
}

module.exports = { wireTaskQueueEvents }
