import { computed, ref } from 'vue'

/**
 * items 缺席时，汇总区兜底用的 counters 键 → outcome 标签映射（唯一一份，别处不得再抄）。
 *
 * 故意不含 `conflicts`：主进程把 conflict-resolved-local 与 conflict-resolved-cloud 合并成一个
 * conflicts 计数，没有逐条 items 就判定不出是哪一侧胜出。宁可少一枚 chip，也不给一条错标签
 * （与服务端 extractUidFromHtml 的「不确定就不给结论」同口径）。
 */
const COUNTER_TO_OUTCOME = Object.freeze([
  ['created', 'created'],
  ['updated', 'updated'],
  ['unchanged', 'unchanged'],
  ['restored', 'restored'],
  ['skipped', 'skipped-tombstone'],
  ['uidUnavailable', 'uid-unavailable'],
  ['invalid', 'invalid-credential'],
  ['failed', 'failed'],
])

/**
 * 「同步云端」弹窗的逐条行状态 + 终态汇总推导。
 *
 * 从组件里拆出来的原因不止是行数：这块逻辑有两条必须保持唯一的口径——
 *   1. 每行必须恰好经历 start（无 outcome）→ done（有 outcome）两次变化，
 *      进度语义才是「在途」而不是「已完成数」（见 AGENTS.md 批量 IPC 进度双边界）；
 *   2. 汇总区逐类计数优先按终态 items 统计，与逐条列表同源，避免出现两个口径。
 * 两者都只能有一个落点，抄进组件里就没法被单独验证。
 *
 * @param {object} deps
 * @param {(key:string, params?:object)=>string} deps.t            i18n
 * @param {(platform:string)=>string} deps.platformLabel           平台展示名（组件 props 注入）
 * @param {(outcome:string, code:string)=>string} deps.reasonFor   失败行的解释文字（结果模型提供）
 * @param {Record<string,string>} deps.OUTCOME_LABEL_KEYS          可展示 outcome 白名单（结果模型提供）
 */
export function createCloudSyncRows ({ t, platformLabel, reasonFor, OUTCOME_LABEL_KEYS }) {
  const rows = ref([])
  const inflight = ref([])
  const progressTotal = ref(0)
  const summary = ref(null)

  /**
   * 行键 MUST 只由 payload 自身决定：start 与 done 是两次独立回调，键必须相同，
   * 否则一条账号会裂成两行（done 带 accountId、start 还没有时最容易发生——恢复阶段正是这种形状）。
   * 主进程每个 send 都带 rowKey（结构锁见 cloud-account-sync.test.js「进度事件 rowKey 结构锁」）；
   * 末位的 platform 兜底是「同平台合并成一行」而非「凭空多一行」——宁可少一行，也不让 doneCount/百分比失真。
   */
  function rowKeyOf (payload) {
    const rowKey = payload.rowKey == null ? '' : String(payload.rowKey)
    if (rowKey) return rowKey
    const accountId = payload.accountId == null ? '' : String(payload.accountId)
    if (accountId) return accountId
    if (payload.index != null) return `${payload.platform || 'account'}-${payload.index}`
    return payload.platform || 'account'
  }

  function upsertRow (payload, outcome) {
    const key = rowKeyOf(payload)
    const existing = rows.value.find(row => row.key === key)
    const next = {
      key,
      platform: String(payload.platform || existing?.platform || ''),
      name: payload.name != null ? String(payload.name) : (existing?.name ?? ''),
      outcome: outcome == null ? (existing?.outcome ?? '') : outcome,
      // code 只进 data-error-code 属性（开发者侧），不进文字；
      // 空串按「本次没带码」处理，不得抹掉 done 事件已落地的码（终态 items 常带空 code）
      code: (payload.code == null ? '' : String(payload.code)) || (existing?.code ?? ''),
    }
    next.reason = reasonFor(next.outcome, next.code)
    next.label = platformLabel(next.platform) || next.platform
    if (existing) {
      rows.value = rows.value.map(row => (row.key === key ? next : row))
    } else {
      rows.value = [...rows.value, next]
    }
  }

  const doneCount = computed(() => rows.value.filter(row => row.outcome).length)
  const syncPercent = computed(() => {
    const total = Number(progressTotal.value) || 0
    if (!total) return 0
    return Math.min(100, Math.round((doneCount.value / total) * 100))
  })
  const inflightLabels = computed(() => [...new Set(inflight.value)].map(id => platformLabel(id) || id))

  function handleProgressEvent (payload) {
    if (!payload || typeof payload !== 'object') return
    const total = Number(payload.total) || 0
    if (total) progressTotal.value = total
    const platform = String(payload.platform || '')
    if (payload.phase === 'done') {
      upsertRow(payload, payload.outcome == null ? 'failed' : String(payload.outcome))
      if (platform) {
        const at = inflight.value.indexOf(platform)
        const next = inflight.value.slice()
        if (at !== -1) next.splice(at, 1)
        inflight.value = next
      }
      return
    }
    // start 边界（执行前）：先落一行「已发起」，让每条账号都有可观察的 start→done 两次变化
    upsertRow(payload, null)
    if (platform && !inflight.value.includes(platform)) inflight.value = [...inflight.value, platform]
  }

  /** 批次开跑前复位：total 由调用方给（本机待同步账号数），0 表示尚未知 */
  function resetRows (total = 0) {
    rows.value = []
    inflight.value = []
    progressTotal.value = Number(total) || 0
    summary.value = null
  }

  // ─── 终态汇总 ──────────────────────────────────
  const counters = computed(() => {
    const data = summary.value
    if (!data) return null
    const pick = key => Number(data[key]) || 0
    const created = pick('created')
    const updated = pick('updated')
    const unchanged = pick('unchanged')
    const restored = pick('restored')
    const skipped = pick('skipped')
    const conflicts = pick('conflicts')
    const invalid = pick('invalid')
    const failed = pick('failed')
    return {
      created,
      updated,
      unchanged,
      restored,
      skipped,
      conflicts,
      invalid,
      failed,
      uidUnavailable: pick('uidUnavailable'),
      ok: created + updated + unchanged + restored + conflicts,
      fail: invalid + failed,
    }
  })

  const summaryText = computed(() => {
    const c = counters.value
    if (!c) return ''
    if (c.ok === 0 && c.fail > 0) return t('accountsPage.cloudSyncAllFailed', { fail: c.fail })
    if (c.fail > 0) return t('accountsPage.cloudSyncPartial', { ok: c.ok, fail: c.fail })
    return t('accountsPage.cloudSyncDone', { created: c.created, updated: c.updated, restored: c.restored })
  })

  /** 汇总区逐类计数：优先按 items 的终态统计（与逐条列表同源，不会出现两个口径） */
  const summaryStats = computed(() => {
    const items = Array.isArray(summary.value?.items) ? summary.value.items : []
    if (items.length) {
      const counts = new Map()
      for (const item of items) {
        const outcome = String(item?.outcome || 'failed')
        counts.set(outcome, (counts.get(outcome) || 0) + 1)
      }
      return [...counts.entries()]
        .filter(([outcome]) => OUTCOME_LABEL_KEYS[outcome])
        .map(([outcome, count]) => ({ outcome, count }))
    }
    const c = counters.value
    if (!c) return []
    return COUNTER_TO_OUTCOME
      .map(([counterKey, outcome]) => ({ outcome, count: Number(c[counterKey]) || 0 }))
      .filter(item => item.count > 0)
  })

  return {
    rows,
    inflight,
    progressTotal,
    summary,
    rowKeyOf,
    upsertRow,
    doneCount,
    syncPercent,
    inflightLabels,
    handleProgressEvent,
    resetRows,
    counters,
    summaryText,
    summaryStats,
  }
}
