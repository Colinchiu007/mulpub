// @ts-check
/**
 * plan-limits.js — 档位 `entitlement.limits` 的客户端判定（纯函数，可单测）。
 *
 * 真源是服务端 `packages/api-publish-engine/src/auth/plan-matrix.js` 下发的
 * `entitlement.limits`（经签名快照 → `normalizeEntitlement` 透传）。
 *
 * 三条纪律（v2.0 机制 C1.3 / C7 C 批）：
 * 1. **只读不改**：本模块不兜底、不缓存、不推算出比服务端更严的限制。
 * 2. **缺失即放行**：字段缺失/非法一律返回 `null` 并按「无限制」处理。反过来
 *    （缺失即拦截）会让一次快照字段漂移把付费用户整片拦死，而且表现为「功能消失」
 *    这种最难归因的故障。
 * 3. **-1 是不限**：与 plan-matrix 的 `UNLIMITED_ALLOWED` 语义一致，不得当成
 *    「-1 个」参与任何加法/减法。
 *
 * ⚠ 接线状态（CCG i6，别误读为已生效能力）：**已接线**的是 `maxPlatformsOf` / `canAddPlatform` /
 * `platformLimitState`（发布页平台选择）；其余导出（`canBatchSize` / `canPublishToday` /
 * `concurrentTasksOf` / `maxDevicesOf` / `maxCloudAccountsOf`）**尚未接线**——它们缺数据源
 * （今日已发条数、批量入口、设备/云账号管理页），按 PRD §12 N5/N1/N2 排期。在接线前，
 * 这些函数只是一份可单测的判据，不构成任何运行时限制。
 */

/** plan-matrix 的「不限」哨兵值。 */
export const UNLIMITED = -1

/**
 * 从 limits 读一个数值键。
 * @param {object|null|undefined} limits
 * @param {string} key
 * @returns {number|null} 非有限数（含 undefined/字符串/NaN）一律 null
 */
export function readLimit(limits, key) {
  if (!limits || typeof limits !== 'object') return null
  const raw = limits[key]
  // 只接受 number 与「非空数字字符串」：`Number('') === 0` 会把缺失值读成「零额度」，
  // 那正好是「缺失即拦截」这个反方向的静默故障。
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : null
  if (typeof raw === 'string' && raw.trim() !== '') {
    const value = Number(raw)
    return Number.isFinite(value) ? value : null
  }
  return null
}

/** 支持的平台数上限；null 表示无信息（放行），-1 表示不限。 */
export function maxPlatformsOf(entitlement) {
  return readLimit(entitlement && entitlement.limits, 'max_platforms')
}

/** 每日发布条数上限；null 表示无信息（放行）。 */
export function dailyPublishOf(entitlement) {
  return readLimit(entitlement && entitlement.limits, 'daily_publish')
}

/** 单次批量发布条数上限；null 表示无信息（放行），-1 表示不限。 */
export function batchSizePerRunOf(entitlement) {
  return readLimit(entitlement && entitlement.limits, 'batch_size_per_run')
}

/** 并发任务数；null 表示无信息（放行）。 */
export function concurrentTasksOf(entitlement) {
  return readLimit(entitlement && entitlement.limits, 'concurrent_tasks')
}

/** 设备数上限；null 表示无信息（放行），-1 表示不限。 */
export function maxDevicesOf(entitlement) {
  return readLimit(entitlement && entitlement.limits, 'max_devices')
}

/** 云端同步账号数上限；0 表示本档不提供云同步，-1 表示不限。 */
export function maxCloudAccountsOf(entitlement) {
  return readLimit(entitlement && entitlement.limits, 'max_cloud_accounts')
}

/**
 * 是否还能再选一个平台。
 * @param {object|null|undefined} entitlement
 * @param {number} selectedCount 当前已选平台数（**不含**待新增的那个）
 * @returns {boolean} 无限制信息或 -1 时恒 true
 */
export function canAddPlatform(entitlement, selectedCount) {
  const limit = maxPlatformsOf(entitlement)
  if (limit === null || limit < 0) return true
  // selectedCount 非有限数（undefined/NaN）时按「无限制信息」放行：
  // 否则 `NaN < 5` 恒 false，会把调用方漏传参数静默变成「一律拦截」，与缺失即放行相反（CCG i7）。
  const count = Number(selectedCount)
  if (!Number.isFinite(count)) return true
  return count < limit
}

/**
 * 单次批量条数是否在档位允许范围内。
 * @param {object|null|undefined} entitlement
 * @param {number} size 本次批量条数
 * @returns {boolean}
 */
export function canBatchSize(entitlement, size) {
  const limit = batchSizePerRunOf(entitlement)
  if (limit === null || limit < 0) return true
  return Number(size) <= limit
}

/**
 * 今日发布数是否仍在档位允许范围内。
 * @param {object|null|undefined} entitlement
 * @param {number} todayCount 今日已发布条数
 * @param {number} [pending] 本次将要提交的条数，默认 1
 * @returns {boolean}
 */
export function canPublishToday(entitlement, todayCount, pending = 1) {
  const limit = dailyPublishOf(entitlement)
  if (limit === null || limit < 0) return true
  return Number(todayCount) + Number(pending) <= limit
}

/**
 * 升级引导文案的参数：给出「本档上限」与「当前已选」。
 * 不生成自然语言（文案在 locales），只产出可填进 i18n 的值，避免两处各写一遍口径。
 * @param {object|null|undefined} entitlement
 * @param {number} selectedCount
 * @returns {{limit: number|null, selected: number, atLimit: boolean}}
 */
export function platformLimitState(entitlement, selectedCount) {
  const limit = maxPlatformsOf(entitlement)
  const selected = Number(selectedCount) || 0
  const unlimited = limit === null || limit < 0
  return { limit: unlimited ? null : limit, selected, atLimit: !unlimited && selected >= limit }
}
/**
 * 降级裁剪（PRD N7 后半）：档位上限变小后，把已选平台裁到上限内。
 *
 * 纯函数、不读时钟：给定 entitlement 与已选列表，返回**应保留**的列表。
 * 三条纪律与其余判据一致：
 * - 无上限信息 / `-1` ⇒ 原样返回（缺失即放行，绝不因「读不到」而清空用户配置）；
 * - 上限为 0 ⇒ 返回空数组（本档不提供，不是不限）；
 * - 保留**原顺序的前 N 个**，不重排（用户昨天的选择顺序是有意义的）。
 *
 * @param {object|null|undefined} entitlement
 * @param {string[]} selected
 * @returns {{kept: string[], removed: string[]}}
 */
export function trimSelection(entitlement, selected) {
  const list = Array.isArray(selected) ? selected.filter((id) => typeof id === 'string' && id) : []
  const limit = maxPlatformsOf(entitlement)
  if (limit === null || limit < 0) return { kept: list.slice(), removed: [] }
  if (list.length <= limit) return { kept: list.slice(), removed: [] }
  return { kept: list.slice(0, limit), removed: list.slice(limit) }
}