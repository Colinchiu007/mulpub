// @ts-check
/**
 * 账号云同步的共用底层：结果枚举、云端路径、超时/并发原语与汇总收口。
 *
 * 从 cloud-account-sync.js 拆出是**语义边界**而非行数妥协：这些是与依赖注入无关的纯函数，
 * `finishSummary` 这类「终态计数必须从逐条结果反推」的口径若散落在编排器里，
 * 很容易在新增分支时漏加计数、汇出一个「全部成功」的假事实。
 */

const OUTCOME = {
  CREATED: 'created',
  UPDATED: 'updated',
  UNCHANGED: 'unchanged',
  RESTORED: 'restored',
  SKIPPED_TOMBSTONE: 'skipped-tombstone',
  CONFLICT_LOCAL: 'conflict-resolved-local',
  CONFLICT_CLOUD: 'conflict-resolved-cloud',
  CONFLICT_UNRESOLVED: 'conflict-unresolved',
  INVALID_CREDENTIAL: 'invalid-credential',
  UID_UNAVAILABLE: 'uid-unavailable',
  FAILED: 'failed',
}

const ACCOUNT_PATH = '/api/v1/me/accounts'
const SYNC_PATH = `${ACCOUNT_PATH}/sync`
const DISCONNECT_PATH = `${ACCOUNT_PATH}/disconnect`
const DIGEST_TIMEOUT_MS = 10000

const TIMEOUT_SENTINEL = Symbol('cloudSyncTimeout')

function resolveInt (raw, fallback, min, max) {
  const n = Number.parseInt(String(raw ?? ''), 10)
  if (!Number.isFinite(n) || n < min || n > max) return fallback
  return n
}

function errorMessage (e) { return String((e && (/** @type {any} */ (e).code || /** @type {any} */ (e).message)) || e || 'unknown') }

function keyOf (platform, uid) { return `${String(platform || '')}|${String(uid == null ? '' : uid)}` }

/**
 * 硬超时：超时后原 promise 的 reject 必须就地吃掉，否则变成 unhandledRejection
 * （AGENTS.md「批量 IPC 进度双边界与超时预算契约」的回归要求）。
 */
function raceWithTimeout (promiseOrValue, timeoutMs, timeoutValue) {
  const guarded = promiseOrValue instanceof Promise ? promiseOrValue : Promise.resolve(promiseOrValue)
  const settled = guarded.catch((e) => ({ __cloudSyncError: errorMessage(e) }))
  let timer = null
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(TIMEOUT_SENTINEL), timeoutMs)
    if (timer && typeof timer.unref === 'function') timer.unref()
  })
  return Promise.race([settled, timeout]).then((value) => {
    if (timer) clearTimeout(timer)
    return value
  }, (e) => { if (timer) clearTimeout(timer); throw e })
}

function isTimeout (v) { return v === TIMEOUT_SENTINEL }

/** 固定并发映射；结果落位由调用方按 index 处理，完成顺序不影响结果集 */
async function mapWithConcurrency (items, limit, worker) {
  const size = Math.max(1, Math.min(limit, items.length || 1))
  let cursor = 0
  const runners = new Array(size).fill(null).map(async () => {
    while (cursor < items.length) {
      const index = cursor++
      await worker(items[index], index)
    }
  })
  await Promise.all(runners)
}

function emptySummary () {
  return {
    created: 0, updated: 0, unchanged: 0, restored: 0, skipped: 0,
    conflicts: 0, invalid: 0, uidUnavailable: 0, failed: 0,
    items: [], queuedCheck: 0, elapsedMs: 0, aborted: false, errorCode: null,
  }
}

/**
 * 从逐条结果重新推导聚合计数。冲突/失效/身份不明三类必须在终态收口时按 items 结算，
 * 否则中途分支少加一次计数就会汇出一个「全部成功」的假事实。
 */
function finishSummary (summary) {
  summary.conflicts = summary.items.filter((i) => String(i.outcome || '').startsWith('conflict-')).length
  summary.invalid = summary.items.filter((i) => i.outcome === OUTCOME.INVALID_CREDENTIAL).length
  summary.uidUnavailable = summary.items.filter((i) => i.outcome === OUTCOME.UID_UNAVAILABLE).length
  return summary
}

module.exports = {
  ACCOUNT_PATH,
  DIGEST_TIMEOUT_MS,
  DISCONNECT_PATH,
  OUTCOME,
  SYNC_PATH,
  TIMEOUT_SENTINEL,
  emptySummary,
  errorMessage,
  finishSummary,
  isTimeout,
  keyOf,
  mapWithConcurrency,
  raceWithTimeout,
  resolveInt,
}
