/**
 * 登录门禁判定（渲染端共享）
 *
 * 主进程 license-access-control 对非公开通道返回 `{ code: -3, errorCode: 'AUTH_REQUIRED' }`
 * （未登录）或 `{ code: -3, errorCode: 'ENTITLEMENT_REQUIRED' }`（登录但权益不足）。
 * 两者同为 code:-3 —— 判定必须按 errorCode，数值码只在 errorCode 缺失时兜底（遗留形态）。
 * 权限拒绝 ≠ 传输故障，调用方必须分流展示，禁止把 AUTH_REQUIRED 写成「服务连接失败」。
 *
 * 范式来源：PR #1854（publish-history 登录引导门控，2026-09-15）。
 * 详细规格：01-docs/PRD-PUBLISH-HISTORY-LOGIN-GATE-2026-09-15.md
 */
export function isAuthGateResult (result) {
  if (!result || typeof result !== 'object') return false
  if (result.errorCode === 'AUTH_REQUIRED' || result.errorCode === 'NOT_SIGNED_IN') return true
  return result.errorCode == null && result.code === -3
}
