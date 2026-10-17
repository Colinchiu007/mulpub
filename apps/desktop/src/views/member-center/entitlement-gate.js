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
 *
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
 * ⚠️ **这是体验分级，不是访问控制**（CCG 深度审查 i1/i4 要求显式声明，2026-10-17）
 *
 * 本模块只决定「渲染层要不要显示某块 UI / 要不要发某条 IPC」，它**拦不住**任何
 * 主动绕过：能自己调 `ipcRenderer.invoke` 的人照样能拿到数据 —— 因为支撑这些区块的
 * 主进程 handler（如 `performance:overview`）本来就不读套餐，只判身份。
 *
 * 本次改动**没有降低**任何安全性：改动前 free 用户同样能拿到这些数据，只是页面上
 * 没有显示。差别只在「看不看得见」，不在「拿不拿得到」。
 *
 * 真正的访问控制是另一件事，需要：
 *   ① `packages/api-publish-engine/src/auth/plan-matrix.js` 定义档位；
 *   ② 主进程 `CHANNEL_FEATURE_MAP` + `requireEntitlement` 在 handler 入口拒绝；
 *   ③ 同步更新 `01-docs/ACCESS-CONTROL-MATRIX.md`。
 * 那是独立任务，**不在本次范围内**（PRD §3.2.1 已记录）。
 *
 * 所以：本模块命名里的 "gate" 指的是「体验门槛」，不是「安全闸门」。若将来真要
 * 做访问控制，请直接改主进程，不要在这里加更多判断——那只会加深"已被保护"的误解。
 * ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
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
