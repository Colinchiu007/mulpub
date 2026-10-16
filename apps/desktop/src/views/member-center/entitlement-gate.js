/**
 * 渲染层权益判定单一真源（dash-full-entitlement，2026-10-17）。
 *
 * 为什么需要一个新文件，而不是沿用既有写法：
 * - 渲染层此前**没有**任何「按 feature 决定是否显示某块 UI」的工具函数。
 * - 既有两套范式都不适用：
 *   ① `entitlement.plan !== 'pro'`（MemberCenter）—— 按档位名硬判，新 feature
 *      每加一个就要到处加 `|| plan === 'standard'`；
 *   ② `licenseStore.isPro`（ProfileMenu / useBatchPublish）—— 本地二值，
 *      **不认三档**，standard 档会被误判成免费（本次要消灭的误判）。
 * - 主进程有 `hasFeature()`（electron/services/identity/entitlement-service.js:295），
 *   但它在主进程，渲染层**拿不到**，不可复用。
 *
 * 因此这里按服务端下发的 feature 名判定，且是唯一出口。
 *
 * 未登录/未取到时 `entitlement === null`（identity.js:89 初值 ref(null)，
 * 不会退化成空对象）——所有函数都必须先判空，否则未登录直接崩。
 */

/** 完整数据看板权益：free 档无，standard / pro 档有（plan-matrix.js:153 派生）。 */
export const DASHBOARD_FULL_FEATURE = 'dashboard_full'

/**
 * 判定服务端权益快照是否包含某个 feature。
 *
 * @param {object|null|undefined} entitlement identityStore.entitlement
 * @param {string} feature 服务端下发的 feature 名
 * @returns {boolean} 未登录 / 未取到 / 脏数据一律 false（降级，不抛异常）
 */
export function hasFeatureOf(entitlement, feature) {
  if (!entitlement || typeof entitlement !== 'object') return false
  if (!Array.isArray(entitlement.features)) return false
  return entitlement.features.includes(feature)
}
