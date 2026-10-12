/**
 * usePublishHistoryMetrics — 发布记录页的作品互动数据（唯一实现）
 *
 * 存在理由（PRD-PUBLISH-HISTORY-ENGAGEMENT-2026-10-12 §1.2 / §五）：
 * 五项互动列（播放/评论/点赞/收藏/分享）此前恒为 `-`，而修好数据源后仍有一半工作在渲染侧：
 *   ① 取数要按「发布任务 id 批量」而不是「拉前 100 条 tracked 自己配对」（D1/D2）；
 *   ② 空态必须能区分「尚未采集 / 平台不支持 / 需重新登录 / 采集失败」——一律显示 `-`
 *      会让用户以为功能坏了，而「该平台暂不支持」是产品上可接受的已知边界；
 *   ③ 数据非实时是明确取舍，界面必须如实说明「数据截至 <时刻>」，不能让用户以为是实时。
 *
 * 从 `PublishHistory.vue` 抽出的直接原因：该文件已被 `.github/scripts/check-max-lines.js`
 * 的 targets 点名（1394 行、零增长容差），任何新逻辑都必须落在 composable 里，
 * 否则「加功能」与「行数门禁」二者必有一失。
 *
 * 数据结构（IPC `performance:history-metrics` 的返回）：
 *   data.metrics[taskId] = { views, likes, comments, favorites, shares, capturedAt, source, postId }
 *   data.status         = 账号级采集状态（counts + accounts[]），用于空态归因
 */
import { computed, ref } from 'vue'
import { addManualSnapshot, historyMetrics, metricsSync, metricsSyncStatus } from '@/api/knowledge-library'

/** 指标为空时的取值：null/undefined 一律显示 '-'（不是 0 —— 0 是「平台说是 0」） */
export function displayMetric (value) {
  if (value === null || value === undefined || value === '') return '-'
  return value
}

/**
 * 把毫秒差格式化成「X 分钟前 / X 小时前 / X 天前」。>7 天直接给日期，避免「30 天前」失去信息量。
 * 时间不可解析时返回 ''（不伪造成「刚刚」）。
 */
export function relativeTime (iso, nowMs) {
  const ms = Date.parse(String(iso || ''))
  if (!Number.isFinite(ms)) return ''
  const diff = Math.max(0, (Number.isFinite(nowMs) ? nowMs : Date.now()) - ms)
  const minutes = Math.floor(diff / 60000)
  if (minutes < 1) return 'justNow'
  if (minutes < 60) return { key: 'minutes', value: minutes }
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return { key: 'hours', value: hours }
  const days = Math.floor(hours / 24)
  if (days <= 7) return { key: 'days', value: days }
  return { key: 'date', value: String(iso).slice(0, 10) }
}

/**
 * @param {object} deps
 * @param {(key: string, named?: object) => string} deps.t
 * @param {import('vue').Ref<Array<object>>} deps.records 列表数据源（本 composable 就地回填指标）
 */
export function usePublishHistoryMetrics ({ t, records }) {
  /** taskId → 指标；仅内存态，不持久化（持久化在 performance_snapshot） */
  const metricsByTask = ref({})
  const syncStatus = ref(null)
  const syncing = ref(false)
  const metricsError = ref('')
  /** 最近一次「手动触发」的结果：日上限判据只认它（见 dailyCapReached 的注释） */
  const lastRound = ref(null)

  /**
   * 把「数据截至」渲染成一句人话。时间不可解析返回 ''（不伪造「刚刚」）。
   * 放在 composable 里而不是视图里：卡片级新鲜度提示与总览行用的是**同一句**，
   * 两处各写一份必然漂移。
   */
  function captionFor (iso) {
    const rel = relativeTime(iso)
    if (!rel) return ''
    if (rel === 'justNow') return t('historyPage.metricsJustNow')
    const label = rel.key === 'minutes' ? t('historyPage.metricsAgoMinutes', { n: rel.value })
      : rel.key === 'hours' ? t('historyPage.metricsAgoHours', { n: rel.value })
        : rel.key === 'days' ? t('historyPage.metricsAgoDays', { n: rel.value })
          : rel.value
    return t('historyPage.metricsAsOf', { time: label })
  }

  /** 平台 → 该平台最近一次采集结果（用于把「没数据」归因到具体原因） */
  const platformStatus = computed(() => {
    const map = new Map()
    const accounts = (syncStatus.value && Array.isArray(syncStatus.value.accounts)) ? syncStatus.value.accounts : []
    for (const a of accounts) {
      const p = String((a && a.platform) || '').toLowerCase()
      if (!p) continue
      // 同一平台多账号时取「最需要用户处理」的那个。
      // rank 表必须显式覆盖**全部**会产生状态的值：漏项的后果是它落进 `?? 9` 而被判为
      // 「最不需要处理」，于是 `unsupported` / `failed` 会把 `needs_login` 盖掉，用户看不到该去登录。
      const rank = { needs_login: 0, failed: 1, unsupported: 2, skipped_daily_cap: 3, ok: 4 }
      const prev = map.get(p)
      if (!prev || (rank[a.status] ?? 9) < (rank[prev] ?? 9)) map.set(p, a.status)
    }
    return map
  })

  function capReachedIn (round) {
    if (!round) return false
    const accounts = Array.isArray(round.accounts) ? round.accounts : []
    const counts = round.counts || {}
    return accounts.length > 0 &&
      accounts.every(a => a && a.status === 'skipped_daily_cap') &&
      Number(counts.synced || 0) === 0
  }

  /**
   * 今日是否已达采集上限（按钮据此提示「明天再试」而不是让用户反复点一个必然被拒的按钮）。
   *
   * 两档判据，缺一都会错：
   *   ① **本轮**结果优先 —— 用户刚点完就立刻知道能不能再点（只看持久化状态会漏掉这一次）；
   *   ② 回落持久化状态时**只认当日**（按 UTC 日）—— 持久化的是**上一轮**快照，
   *      昨日末轮全 `skipped_daily_cap` 时进程内 throttle 已随 UTC 日复位，不加这条会把按钮灰锁一整天。
   */
  const dailyCapReached = computed(() => {
    if (lastRound.value) return capReachedIn(lastRound.value)
    const st = syncStatus.value
    if (!st || !st.lastRunAt) return false
    const today = new Date().toISOString().slice(0, 10)
    if (String(st.lastRunAt).slice(0, 10) !== today) return false
    return capReachedIn({ accounts: st.accounts, counts: st.counts })
  })

  /** 是否有任意一条记录拿到了真实数据（决定是否显示「数据截至」行） */
  const latestCapturedAt = computed(() => {
    let latest = ''
    for (const m of Object.values(metricsByTask.value)) {
      const at = String((m && m.capturedAt) || '')
      if (at && at > latest) latest = at
    }
    return latest
  })

  const hasAnyMetrics = computed(() => Object.keys(metricsByTask.value).length > 0)

  function metricFor (record) {
    if (!record) return null
    return metricsByTask.value[String(record.taskId || record.id || '')] || null
  }

  /**
   * 空态归因提示（互斥）：
   *   有数据且新鲜 → ''（不显示提示）
   *   有数据但超过 STALE_HINT_MS → 「数据截至 X 前」（**按卡片**提示，否则一条新鲜记录会把
   *     整页陈旧记录漂白成「刚刚」——评审 MAJOR-7 实测路径）
   *   需登录 / 不支持 / 失败 / 达日上限 → 点名原因
   *   其余 → 「尚未采集」
   */
  function metricHint (record) {
    if (!record) return ''
    const m = metricFor(record)
    if (m) return staleHint(m.capturedAt)
    const platform = String(record.platform || '').toLowerCase()
    const status = platformStatus.value.get(platform)
    if (status === 'needs_login') return t('historyPage.metricsNeedsLogin')
    if (status === 'unsupported') return t('historyPage.metricsUnsupported')
    if (status === 'failed') return t('historyPage.metricsFailed')
    if (status === 'skipped_daily_cap') return t('historyPage.metricsDailyCapReached')
    return t('historyPage.metricsNeverCollected')
  }

  /** 卡片级新鲜度提示：超过 24h 才出声（当日采集不啰嗦） */
  function staleHint (capturedAt) {
    const ms = Date.parse(String(capturedAt || ''))
    if (!Number.isFinite(ms)) return ''
    const hours = Math.floor((Date.now() - ms) / 3600000)
    if (hours < 24) return ''
    return t('historyPage.metricsStale', { time: captionFor(capturedAt) })
  }

  /**
   * 把指标就地写回 record（模板直接读 record.views 等，与既有结构保持兼容）。
   *
   * 三个非指标字段同样必须回填，否则下游能力全部落空：
   *   - `platformWorkId` ← 账号级采集回填的**真实作品 ID**：这是「整卡可点」从 10/68 提升的
   *     唯一兑现路径（评审 CRITICAL-2 实测：漏了它，卡片永久不可点、title 恒「暂无平台公开链接」）；
   *   - `trackedContentId` ← 手动录入兜底需要追踪 id（评审 CRITICAL-1）；
   *   - `metricsCapturedAt` ← 卡片级新鲜度（评审 MAJOR-7）。
   * **只补空值**：既有 `platformWorkId` 可能来自审核回写，强度更高，不得覆盖。
   */
  function applyMetrics () {
    for (const record of records.value || []) {
      const m = metricFor(record)
      if (!m) continue
      record.views = m.views
      record.comments = m.comments
      record.likes = m.likes
      record.favorites = m.favorites
      record.shares = m.shares
      record.metricsCapturedAt = m.capturedAt
      record.trackedContentId = m.trackedId || record.trackedContentId
      if (m.postId && !record.platformWorkId) record.platformWorkId = m.postId
    }
  }

  /** 单次 IPC 的 id 上限，与 store 侧 `getHistoryMetricsByTaskIds` 的默认 cap 同值 */
  const IDS_PER_REQUEST = 500

  /** 并发守卫：筛选态补页会连续触发多次 loadMetrics，旧响应晚到会把新数据整体覆盖掉 */
  let _loadSeq = 0

  /**
   * 拉取当前列表的指标并回填。
   * 只对**已加载的记录**取数（不是全表）：列表有多少条就查多少条，主进程按 taskId 批量 join。
   * 超过单次上限时分批——**不得**把第 501 条起静默丢掉（评审 MAJOR-6：静默截断会让那些记录
   * 永远显示「尚未采集」，而这正是本仓反复出现过的「把没取到渲染成没有」同族错误）。
   */
  async function loadMetrics () {
    const seq = ++_loadSeq
    const ids = []
    for (const record of records.value || []) {
      const key = String(record?.taskId || record?.id || '')
      if (key) ids.push(key)
    }
    if (ids.length === 0) {
      metricsByTask.value = {}
      // 列表为空时仍拉一次状态：否则总览行的「数据截至」与空态归因会引用与当前列表无关的旧状态
      try {
        const st = await metricsSyncStatus()
        if (seq !== _loadSeq) return
        if (st && st.code === 0) syncStatus.value = (st.data && st.data.status) || null
      } catch (_) { /* 状态拉取失败不影响列表主流程 */ }
      return
    }
    const merged = {}
    let status = null
    let failed = ''
    try {
      for (let i = 0; i < ids.length; i += IDS_PER_REQUEST) {
        const res = await historyMetrics({ taskIds: ids.slice(i, i + IDS_PER_REQUEST) })
        if (seq !== _loadSeq) return // 过期响应：丢弃，不覆盖新数据
        if (res && res.code === 0 && res.data) {
          Object.assign(merged, res.data.metrics || {})
          if (res.data.status) status = res.data.status
        } else {
          failed = (res && res.message) || ''
        }
      }
    } catch (e) {
      failed = (e && e.message) || ''
    }
    if (seq !== _loadSeq) return
    if (Object.keys(merged).length > 0 || !failed) {
      // 成功路径（或「查询成功但没有数据」）：整体替换，避免已删除记录的快照残留
      metricsByTask.value = merged
      if (status) syncStatus.value = status
      metricsError.value = ''
    } else {
      // 全部失败：保留上一次数据（把「刷新失败」渲染成「没有数据」是更差的结果），但要出声
      metricsError.value = failed
    }
    applyMetrics()
  }

  /** 手动触发一轮账号级采集，完成后重取当前列表的指标 */
  async function refreshMetrics () {
    if (syncing.value) return null
    syncing.value = true
    metricsError.value = ''
    try {
      const res = await metricsSync({ force: true })
      if (res && res.code === 0) {
        lastRound.value = res.data || null
        await loadMetrics()
        return res.data || null
      }
      metricsError.value = (res && res.message) || ''
      return null
    } catch (e) {
      metricsError.value = (e && e.message) || ''
      return null
    } finally {
      syncing.value = false
    }
  }

  /**
   * 手动录入兜底（平台不支持自动采集时用户可自己填）。
   * 与自动采集共用同一张 performance_snapshot（source='manual'），因此「数据截至」对两种来源一视同仁。
   */
  const manualDialogVisible = ref(false)
  const manualTarget = ref(null)
  const manualMetrics = ref({ views: null, likes: null, comments: null, favorites: null, shares: null })
  const manualSaving = ref(false)

  function openManualEntry (record) {
    manualTarget.value = record
    manualMetrics.value = { views: null, likes: null, comments: null, favorites: null, shares: null }
    manualDialogVisible.value = true
  }

  async function submitManualSnapshot () {
    // trackedId 有两个合法来源，按强度递减：
    //   ① 已合并的指标对象（`metricFor`）；
    //   ② `record.trackedContentId` —— applyMetrics 回填的追踪 id。
    // 两者都没有时**静默返回**，不拿 record.id 去试：记录主键不是追踪 id，
    // 拿它去写会落到一个不存在的键上（本仓历史上正是这一类「键的语义被顾名思义」的坑）。
    const trackedId = metricFor(manualTarget.value)?.trackedId || manualTarget.value?.trackedContentId
    if (!trackedId) return
    manualSaving.value = true
    try {
      const res = await addManualSnapshot(trackedId, {
        views: Number(manualMetrics.value.views) || 0,
        likes: Number(manualMetrics.value.likes) || 0,
        comments: Number(manualMetrics.value.comments) || 0,
        favorites: Number(manualMetrics.value.favorites) || 0,
        shares: Number(manualMetrics.value.shares) || 0,
      })
      if (res && res.code === 0) {
        manualDialogVisible.value = false
        await loadMetrics()
      } else {
        metricsError.value = (res && res.message) || ''
      }
    } catch (e) {
      metricsError.value = (e && e.message) || ''
    } finally {
      manualSaving.value = false
    }
  }

  return {
    metricsByTask,
    syncStatus,
    syncing,
    metricsError,
    lastRound,
    dailyCapReached,
    latestCapturedAt,
    hasAnyMetrics,
    captionFor,
    metricFor,
    metricHint,
    loadMetrics,
    refreshMetrics,
    manualDialogVisible,
    manualTarget,
    manualMetrics,
    manualSaving,
    openManualEntry,
    submitManualSnapshot,
  }
}
