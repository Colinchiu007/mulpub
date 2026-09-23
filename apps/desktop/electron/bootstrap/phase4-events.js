// @ts-check
/**
 * Phase 4: 事件总线接线
 *
 * 从 bootstrap.js 拆出：taskQueue 事件监听
 * - task:success → 发布成功通知 + 历史记录 + 发布监控 + 影响力追踪 + 回采登记
 * - task:failed → 发布失败通知
 * - publish:blocked → 发布间隔限制通知
 * - task:retry → 重试通知
 *
 * 验收标准 BUGFIX-PLAN Bug-1: phase 文件 ≤ 80 行
 */
const log = require('../services/logger')
const { isRiskBlocked } = require('../services/publish-risk')

/**
 * 接线 taskQueue 事件监听
 * @param {object} deps
 * @param {object} deps.taskQueue
 * @param {object} deps.history
 * @param {object} deps.publishMonitor
 * @param {object} deps.publishImpactTracker
 * @param {object} [deps.store] - 效果闭环：tracked_content 登记（可选）
 * @param {Function} deps.getMainWin
 */
function wireTaskQueueEvents({ taskQueue, history, publishMonitor, publishImpactTracker, getMainWin, store }) {
  taskQueue.on('task:success', (task) => {
    const win = getMainWin()
    if (win && !win.isDestroyed()) {
      win.webContents.send('publish:progress', {
        platform: task.platform, stage: '✓ 发布成功', taskId: task.id, result: task.result,
      })
    }
    const ownerSubject = task.owner_subject
    history.addRecord({
      platform: task.platform, title: task.article?.title || '', taskId: task.id,
      status: 'success', result: task.result,
    }, ownerSubject)
    try {
      const postId = task.result?.postId || task.result?.id
      if (postId) {
        publishMonitor.createMonitorTask({
          postId, platform: task.platform, cookies: task.article?.cookies || '',
          callback: (monitorResult) => {
            log.info('PublishMonitor', 'Monitor result for ' + task.platform + ':' + postId + ': ' + monitorResult.status)
            history.addRecord({
              platform: task.platform, title: task.article?.title || '',
              taskId: task.id, status: monitorResult.status, result: monitorResult,
            }, ownerSubject)
          },
        })
      }
    } catch (e) { log.warn('PublishMonitor', 'Failed to start monitor: ' + e.message) }
    try {
      const title = task.article?.title
      const content = task.article?.content || title
      if (title && content) {
        publishImpactTracker.addTracking({
          articleId: task.id, title, keywords: task.article?.keywords || [title],
        })
        log.info('ImpactTracker', 'Started tracking "' + title + '"')
      }
    } catch (e) { log.warn('ImpactTracker', 'Failed to start impact tracking: ' + e.message) }

    // P2 效果闭环：发布成功登记 tracked_content（有 postId 或内容 URL → pending 排期回采；都没有 → untrackable 仅手动）
    try {
      if (store && typeof store.addTrackedContent === 'function') {
        const result = task.result || {}
        const postId = result.postId || result.publishId || ''
        const url = typeof result.url === 'string' && /^https?:\/\//.test(result.url) ? result.url : ''
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
    } catch (e) { log.warn('PerformanceLoop', 'Failed to register tracked content: ' + e.message) }
  })

  taskQueue.on('task:failed', (task) => {
    const win = getMainWin()
    if (win && !win.isDestroyed()) {
      win.webContents.send('publish:progress', {
        platform: task.platform, stage: '✗ 发布失败: ' + task.error, taskId: task.id, error: task.error,
      })
      if (isRiskBlocked(task.error)) {
        win.webContents.send('publish:risk-hold', {
          platform: task.platform, accountId: (task.article && task.article.accountId) || null, taskId: task.id, error: task.error,
        })
      }
    }
  })

  taskQueue.on('publish:blocked', ({ task, remainingWait }) => {
    const win = getMainWin()
    if (win && !win.isDestroyed()) {
      const minutes = Math.ceil(remainingWait / 60000)
      win.webContents.send('publish:progress', {
        platform: task.platform, stage: '⏳ 发布间隔限制，等待 ' + minutes + ' 分钟后重试',
        taskId: task.id, remainingWait,
      })
    }
  })

  taskQueue.on('task:retry', (task) => {
    const win = getMainWin()
    if (win && !win.isDestroyed()) {
      win.webContents.send('publish:progress', {
        platform: task.platform, stage: '⟳ 重试中... (剩余 ' + task.retriesLeft + ' 次)', taskId: task.id,
      })
    }
  })
}

module.exports = { wireTaskQueueEvents }
