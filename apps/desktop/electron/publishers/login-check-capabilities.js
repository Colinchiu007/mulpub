/**
 * login-check-capabilities.js —— 账号「能力级授权」契约（2026-10-17）
 *
 * 为什么一维登录态不够：我们的账号模型只回答"登录了吗"，回答不了
 * "能读它的数据吗 / 能让它自动评论互动吗"。参考产品B（CEF 壳）把账号拆成
 * 「登录态 × 能力授权」两维：`im_flag`（私信授权）/ `sp_flag`（特定视频数据授权）/
 * `open_id`（授权 id）/ `im_supported` / `im_enterprise`，
 * 见 01-docs/REVERSE-REFERENCE-PRODUCT-B-CEF-ACCOUNT-2026-10-17.md §5.4。
 *
 * 三条不可破（否则会把"没证据"说成"没权限"，比现状更糟）：
 * ① **能力缺失永远是 unknown**：只有平台**明确**拒绝（错误码/接口字段）才判 revoked；
 *    取不到依据一律 unknown。与登录态三态同一原则：证据缺席时什么都不改。
 * ② **未授权不等于未登录**：能力被收回时登录态通常仍成立，两者必须分开展示。
 * ③ **不主动请求能力**：本模块只做状态容器与判定整理，不发任何平台请求。
 *
 * @typedef {'unknown'|'granted'|'revoked'} CapabilityState
 */

const CAPABILITY_IDS = Object.freeze([
  'dataRead',      // 读平台数据（粉丝/作品/统计）
  'commentInteract' // 评论/互动（自动回复、批量评论）
])

/** 平台明确"无权限"的错误码 → 能力（与参考产品B「100437=无法获取私密账号数据」同类语义） */
const CAPABILITY_DENY_SIGNALS = Object.freeze({
  dataRead: Object.freeze(['100437']),
  commentInteract: Object.freeze([])
})

/**
 * 从一次登录态检测的原始结果里提取能力状态。
 *
 * 只认三类证据（其余一律 unknown，不许猜）：
 *   1. `capabilities` 字段：上游已按平台接口明确判定（platform: Record<id, state>）
 *   2. `errorCode` 命中 CAPABILITY_DENY_SIGNALS → revoked
 *   3. 什么都没有 → unknown
 *
 * @param {{capabilities?:object, errorCode?:string|number, code?:string}} status
 * @returns {Record<string, CapabilityState>}
 */
function deriveCapabilities (status) {
  const out = {}
  for (const id of CAPABILITY_IDS) out[id] = 'unknown'
  if (!status || typeof status !== 'object') return out

  const raw = status.capabilities
  if (raw && typeof raw === 'object') {
    for (const id of CAPABILITY_IDS) {
      const v = raw[id]
      if (v === 'granted' || v === 'revoked' || v === 'unknown') out[id] = v
    }
  }

  const errno = status.errorCode !== undefined && status.errorCode !== null ? String(status.errorCode) : ''
  if (errno) {
    for (const id of CAPABILITY_IDS) {
      if (out[id] === 'unknown' && CAPABILITY_DENY_SIGNALS[id].includes(errno)) out[id] = 'revoked'
    }
  }
  return out
}

/** 是否需要在 UI 上展示能力行（有确定结论才展示，避免满屏 unknown 噪声） */
function hasActionableCapability (caps) {
  if (!caps || typeof caps !== 'object') return false
  for (const id of CAPABILITY_IDS) {
    if (caps[id] === 'granted' || caps[id] === 'revoked') return true
  }
  return false
}

module.exports = { CAPABILITY_IDS, CAPABILITY_DENY_SIGNALS, deriveCapabilities, hasActionableCapability }
