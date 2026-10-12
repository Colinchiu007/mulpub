// @ts-check
/**
 * 效果闭环 IPC handlers — 表现数据查询 / 手动录入 / 归因重算 / 追踪列表
 */
function registerHandlers(ipcMain, deps) {
  const { withSenderCheck, resolveIpcOwnerSubject } = require('./helpers')
  const EC = require('../core/error-codes').ERROR
  const log = require('../services/logger')
  const { buildPerformanceOverview } = require('../services/performance-overview')
  const { store, patternAttributionService, performanceRecrawlService, accountMetricsService, identityService } = deps

  if (!store) return

  /**
   * 表现数据页的追踪清单。
   *
   * ⛔ 本通道原为**无归属过滤的全表读**（`SELECT * FROM tracked_content` + 每行取最新快照），
   * 且不带 `withSenderCheck`；它经 `createKnowledgeLibraryApi` 的 `...spread` 暴露在渲染端顶层，
   * 于是任意渲染脚本都能拿到**所有归属**的 tracked_content（post_id / url / publish_history_id）
   * 与互动快照。本次交付新增的 `performance:history-metrics` 已经按归属过滤，
   * 但旧通道没跟着修 —— 只修新口不修旧口等于没修（QM-6 后端轴 MAJOR）。
   * 现在补上归属过滤（与 performance:overview 同口径）与显式 sender 守卫。
   */
  ipcMain.handle('performance:list-tracked', withSenderCheck(async (_event, params) => {
    try {
      const owner = resolveIpcOwnerSubject(identityService)
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const page = Math.max(1, Number(params && params.page) || 1)
      const pageSize = Math.min(100, Math.max(1, Number(params && params.pageSize) || 20))
      const read = typeof store.listTrackedForAccountSync === 'function'
        ? store.listTrackedForAccountSync(owner)
        : { rows: [], total: 0 }
      if (read && read.error) return { code: EC.REQUEST_ERROR, message: read.error }
      const all = Array.isArray(read.rows) ? read.rows : []
      const start = (page - 1) * pageSize
      const rows = all.slice(start, start + pageSize)
      // 附带最新快照（快照读同样按归属收口，避免用别人的 tracked id 反查）
      const batch = typeof store.getLatestSnapshotsForTrackedIds === 'function'
        ? store.getLatestSnapshotsForTrackedIds(rows.map(r => String(r.id)), owner)
        : { rows: [] }
      const byId = new Map((batch.rows || []).map(s => [String(s.trackedContentId), s]))
      const items = rows.map(r => ({ ...r, latest_snapshot: byId.get(String(r.id)) || null }))
      return { code: EC.SUCCESS, data: { items, total: Number(read.total) || all.length } }
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('performance:add-manual-snapshot', withSenderCheck(async (_event, trackedContentId, metrics) => {
    try {
      if (!trackedContentId) return { code: EC.VALIDATION_ERROR, message: '缺少追踪条目 ID' }
      if (!metrics || typeof metrics !== 'object') return { code: EC.VALIDATION_ERROR, message: '参数无效' }
      const snapId = store.addPerformanceSnapshot({
        trackedContentId: String(trackedContentId),
        source: 'manual',
        views: metrics.views, likes: metrics.likes, comments: metrics.comments,
        favorites: metrics.favorites, shares: metrics.shares,
        raw: { manual: true },
      })
      if (!snapId) return { code: EC.REQUEST_ERROR, message: '保存失败' }
      // 手动录入后更新追踪状态（manual/unsupported → ok，继续自动节奏）
      store.updateTrackedContent(String(trackedContentId), { recrawlStatus: 'ok' })
      return { code: EC.SUCCESS, data: { id: snapId } }
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  ipcMain.handle('performance:recompute-attribution', withSenderCheck(async () => {
    try {
      if (!patternAttributionService) return { code: EC.REQUEST_ERROR, message: '归因服务未就绪' }
      return patternAttributionService.recomputeAll()
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  /**
   * 归因榜读侧：必须按归属筛（P2-6d）。
   * 门禁与 performance:overview / dashboard:stats 同口径：认不出是谁 = AUTH_ERROR，
   * 而不是「0 条数据」——把「没验出身份」渲染成空榜单，用户会以为这个功能坏了。
   * 身份服务缺席（undefined）走 legacy 桶，不是报错。
   */
  ipcMain.handle('performance:list-pattern-performance', withSenderCheck(async (_event, params) => {
    try {
      const owner = resolveIpcOwnerSubject(identityService)
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const read = store.listPatternPerformance(params || {}, owner)
      // 查询失败/表缺失不得翻成空榜单：那会把 schema 漂移伪装成"还没有归因数据"
      // （前端此时展示合法空态，用户不会报障）。口径与本文件 performance:overview 一致。
      if (read && read.error) return { code: EC.REQUEST_ERROR, message: read.error }
      return { code: EC.SUCCESS, data: { items: (read && read.items) || [] } }
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  /**
   * P2-6c 数据看板：作品互动回流总量 / 日增趋势 / 平台分布 / 回采健康度。
   * 口径只在 services/performance-overview.js 一处，本 handler 不得自己求和。
   * 门禁与 dashboard:stats 同口径：认不出是谁 = AUTH_ERROR，而不是「0 条数据」。
   */
  ipcMain.handle('performance:overview', withSenderCheck(async (_event, params) => {
    try {
      const owner = resolveIpcOwnerSubject(identityService)
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const tracked = store.listTrackedForOverview(owner)
      const snapshots = store.listSnapshotsForOverview(owner)
      // store 的读侧把 SQL 故障吞成空行是既有风格；这里必须把它翻成错误信封，
      // 否则「查询失败」会被渲染成「从未发布」这块空态（QM-6 后端轴 FB7）
      const storeError = tracked && tracked.error ? tracked.error : (snapshots && snapshots.error ? snapshots.error : null)
      if (storeError) return { code: EC.REQUEST_ERROR, message: storeError }
      const overview = buildPerformanceOverview({
        trackedRows: tracked.rows,
        snapshotRows: snapshots.rows,
        windowDays: params && params.windowDays,
        nowMs: Date.now(),
        trackedTruncated: tracked.truncated,
        snapshotTruncated: snapshots.truncated,
      })
      // 库级孤儿计数与聚合层孤儿是两回事：前者是「关联不到任何作品」的完整性信号，
      // 后者只看到本次入参里的行。两者都如实给出，排障时才能分辨是数据坏了还是被归属过滤挡了。
      overview.diagnostics.orphanSnapshotsDb = snapshots.orphanTotal
      log.info('[ipc:performance]', 'overview owner=' + (owner === undefined ? 'legacy' : owner) +
        ' tracked=' + tracked.total + ' covered=' + overview.health.covered +
        ' snapshots=' + snapshots.total + ' interactions=' + overview.totals.interactions +
        ' truncated=' + (tracked.truncated || snapshots.truncated) + ' orphanDb=' + snapshots.orphanTotal)
      return { code: EC.SUCCESS, data: overview }
    } catch (e) { log.warn('[ipc:performance]', ((e && e.message) || String(e))); return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  // 立即回采调试入口：真正触发一轮巡检（此前为空壳只 return supported）。
  // force=true 忽略 T+1h 排期纳入窗口内全部可回采条目，用于当场观测「回采→爆款库写回」闭环。
  ipcMain.handle('performance:trigger-recrawl', withSenderCheck(async (_event, opts) => {
    try {
      const { supportedPlatforms } = require('../services/platform-metrics')
      const supported = supportedPlatforms()
      const force = Boolean(opts && opts.force)
      let ran = false
      if (performanceRecrawlService && typeof performanceRecrawlService.processRound === 'function') {
        await performanceRecrawlService.processRound({ force })
        ran = true
      }
      return { code: EC.SUCCESS, data: { supported, ran, force } }
    } catch (e) { return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  /**
   * 发布记录页的**唯一**指标读口（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §1.2 D1/D2）。
   *
   * 为什么把 join 收回主进程：原实现是「渲染端拉前 100 条 tracked 自己在内存里配对」，
   * ① `performance:list-tracked` 不按归属过滤且只取第一页 ⇒ 历史早于第 100 条的作品永远恒空；
   * ② 归属过滤写在渲染端等于没有。现在一次 SQL 完成
   * 「发布任务 id → tracked 行 → 每行最新一份快照」，渲染端只消费结果。
   *
   * 信封里带 `status`（采集状态），让界面能区分四类空态：尚未采集 / 平台不支持 / 需重新登录 / 采集失败。
   * 认不出身份 = AUTH_ERROR，**不是**「0 条数据」——把「没登录」渲染成空数据，用户会以为功能坏了
   * （与 performance:overview / dashboard:stats 同口径）。
   */
  ipcMain.handle('performance:history-metrics', withSenderCheck(async (_event, params) => {
    try {
      const owner = resolveIpcOwnerSubject(identityService)
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const taskIds = (params && Array.isArray(params.taskIds)) ? params.taskIds : []
      const read = typeof store.getHistoryMetricsByTaskIds === 'function'
        ? store.getHistoryMetricsByTaskIds(taskIds, owner)
        : { metrics: {}, missing: taskIds, error: 'store method missing: getHistoryMetricsByTaskIds' }
      // 查询失败不得吞成空结果：那会把「没拿到数据」渲染成「从未采集」的空态（与看板 FB7 同因）
      if (read && read.error) return { code: EC.REQUEST_ERROR, message: read.error }
      const status = typeof store.getAccountSyncState === 'function' ? store.getAccountSyncState(owner) : null
      return { code: EC.SUCCESS, data: { metrics: read.metrics || {}, missing: read.missing || [], status } }
    } catch (e) { return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  /**
   * 手动触发一轮账号级采集。低频是产品契约（用户已明确接受非实时）：
   * 服务侧仍守「每账号每天最多 N 轮」与「页间随机抖动」，按钮只是把**时机**交给用户，
   * 不改变请求密度上限。force 仅为接口对称保留——采集本来就按需跑，没有 24h 轮次门。
   */
  ipcMain.handle('metrics:sync', withSenderCheck(async (_event, opts) => {
    try {
      const owner = resolveIpcOwnerSubject(identityService)
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      if (!accountMetricsService || typeof accountMetricsService.runRound !== 'function') {
        return { code: EC.REQUEST_ERROR, message: '账号级采集服务未就绪' }
      }
      const result = await accountMetricsService.runRound({
        reason: 'manual',
        ownerSubject: owner,
        force: Boolean(opts && opts.force),
      })
      return { code: EC.SUCCESS, data: result }
    } catch (e) { return { code: EC.REQUEST_ERROR, message: e.message } }
  }))

  /** 读采集状态（未登录 = AUTH_ERROR，与 performance:history-metrics 同门禁）。 */
  ipcMain.handle('metrics:sync-status', withSenderCheck(async () => {
    try {
      const owner = resolveIpcOwnerSubject(identityService)
      if (owner === null) return { code: EC.AUTH_ERROR, message: '无法识别当前用户' }
      const status = typeof store.getAccountSyncState === 'function' ? store.getAccountSyncState(owner) : null
      return { code: EC.SUCCESS, data: { status } }
    } catch (e) { return { code: EC.REQUEST_ERROR, message: e.message } }
  }))
}

module.exports = registerHandlers
