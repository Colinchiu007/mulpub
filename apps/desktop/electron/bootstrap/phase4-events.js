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
const { linkExistingTrackedContent, TRACKED_LINK_HISTORY_SCAN_LIMIT } = require('../services/tracked-content-link')
// 2026-10-12：发布记录封面字段的单一真源（历史页缩略图此前恒空 → 回退平台图标，
// 用户报障「历史记录页的缩略图不是发布的真实封面」）。
const { resolveRecordCover } = require('../services/publish-record-cover')

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
  // 存量关联回填每次接线只跑一次（成功后候选集为空，再跑也只是零写入，但没必要每次发布都读一遍历史）
  let backfillRan = false

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
      // 2026-10-12：本次发布**实际使用**的封面（无封面时写空串，不写 undefined——JSON 会丢键）。
      // 消费端 `PublishHistory.vue` 的 thumbnailUrl 正是读这两个键，缺了就是平台图标。
      ...resolveRecordCover(task.article),
      // 定时派发任务带 publishMode='scheduled'（scheduler/batch-manager 排期入队时标记），
      // 历史页「定时发布」过滤器与详情「发布模式」据此区分定时/立即发布。
      ...(task.publishMode ? { publishMode: task.publishMode } : {}),
    }, ownerSubject)
    try {
      const postId = task.result?.postId || task.result?.id
      // 草稿结果（小红书硬约束 2026-10-09，落地于 RPA 轨 draftOnly）：草稿不是已公开作品，
      // 平台内容列表里查不到 ⇒ 建监控任务只会得到恒定的「查无此作品」重试。
      // 因此草稿结果不建审核回查；历史行仍记 success（内容已确认写入平台草稿箱）。
      const isDraftResult = task.result?.draft === true
      if (postId && !isDraftResult) {
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

    // P2 效果闭环：发布成功登记 tracked_content（有 postId 或内容 URL → pending 回采；都没有 → untrackable 仅手动）
    try {
      if (store && typeof store.addTrackedContent === 'function') {
        const result = task.result || {}
        // 草稿（小红书）没有公开作品锚点：草稿 ID 不是可回采的作品 ID，
        // 强行登记 pending 会让回采器反复去平台找一篇「永远不会公开」的作品。
        const isDraftResult = result.draft === true
        const postId = isDraftResult ? '' : (result.postId || result.publishId || '')
        const url = isDraftResult ? '' : (safeHttpUrl(result.url) || '')
        const hasAnchor = Boolean(postId || url)
        store.addTrackedContent({
          platform: task.platform,
          postId: String(postId || ''),
          url,
          // 关联键的语义＝**发布任务 id**（读侧 PublishHistory.vue 按 record.taskId join 这一列）；
          // 存 addRecord() 返回的 entry.id 会让历史页表现列继续恒空。缺 id 就留 NULL，不猜。
          publishHistoryId: typeof task.id === 'string' && task.id.trim() ? task.id.trim() : null,
          rewriteHistoryId: task.rewriteHistoryId || task.article?.rewriteHistoryId || null,
          recrawlStatus: hasAnchor ? 'pending' : 'untrackable',
          nextRecrawlAt: hasAnchor ? new Date(Date.now() + 60 * 60 * 1000).toISOString() : null, // T+1h 首采
          ownerSubject,
        })
        if (!(typeof task.id === 'string' && task.id.trim())) {
          // messageKey 保留 unlinked 语义：phase4-events-tracked-content.test.js 断言
          // 「缺 id 必须留下未关联的现场」，靠的就是这个关键字（同时也是可读的日志契约）。
          log.notify('PerformanceLoop', 'tracked-content-unlinked', { level: 'WARN', params: { platform: task.platform } })
        }
      }
    } catch (e) {
      log.notify('PerformanceLoop', 'register-tracked-content-failed', { level: 'WARN', error: String(e.message) })
    }

    // P2-6b：本会话首次发布成功后补一次存量关联。放在这里而不是启动接线里，
    // 因为此刻 owner_subject 已由任务给出——启动时身份可能还没解析，拿不到归属就没法安全地配对。
    // 回填是旁路：幂等、候选空时零写入、任何异常只出声。
    // latch 只在**这轮真的跑完**之后置真（QM-6 后端轴 B2/W2）：读历史抛错时不 latch，
    // 否则一次抖动就把本会话剩下的存量全部放弃，而现场只留下一条 warn。
    if (!backfillRan) {
      try {
        const scanned = history && typeof history.listRecords === 'function'
          ? history.listRecords({ limit: TRACKED_LINK_HISTORY_SCAN_LIMIT }, ownerSubject)
          : null
        const outcome = linkExistingTrackedContent({
          store,
          historyRecords: (scanned && scanned.records) || [],
          historyTotal: scanned && scanned.total,
          ownerSubject,
          log,
        })
        if (outcome && outcome.ok) backfillRan = true
      } catch (e) {
        log.notify('PerformanceLoop', 'tracked-content-backfill-skipped', { level: 'WARN', error: String(e && e.message) })
      }
    }
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
      // 失败记录与成功记录**同源**取封面：用户恰恰要在失败记录里确认「当时用的是哪张封面」，
      // 两个落库点各写一份优先级，漂移的方向必然是失败记录没有封面。
      ...resolveRecordCover(task.article),
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

  taskQueue.on('publish:blocked', ({ task, remainingWait, bucket, reason, daily }) => {
    // v2：日配额用尽是「今天到此为止」而非「等一会儿」，remainingWait 恒为 0，
    // 故 stage 文案必须按 reason 分流；渲染端另按 reason 选择本地化文案（勿依赖这句中文）。
    const isDailyQuota = reason === 'daily_quota' || bucket === 'daily'
    const stage = isDailyQuota
      ? '⏳ 今日发布已达上限，明日 00:00 后自动继续'
      : '⏳ 发布间隔限制，等待 ' + Math.ceil(remainingWait / 60000) + ' 分钟后重试'
    emitter.emit(task.id, task.platform, 'blocked', {
      stage,
      remainingWait,
      bucket: bucket || null,
      reason: reason || null,
      daily: daily || null,
      batchId: task.batchId || null,
    })
  })

  // v2：未提交失败已回滚窗口（可立即重试）——必须可观测，否则「为什么这次不用等」无从解释
  taskQueue.on('publish:released', ({ task, reason, graceMs }) => {
    emitter.emit(task.id, task.platform, 'released', {
      stage: '↺ 未提交到平台，已恢复可发布',
      stageKey: 'released',
      releaseReason: reason || null,
      graceMs: graceMs || null,
      batchId: task.batchId || null,
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
