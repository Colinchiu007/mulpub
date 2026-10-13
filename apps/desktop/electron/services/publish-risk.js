'use strict'
/**
 * publish-risk.js — 桌面侧风控命中判定（W1 §5.4 生产端）
 *
 * 命中后由 phase4-events 决定「通知 / 挂起」，供渲染层通知中心与派发前置守卫消费。
 * 合规红线：风控即停、绝不自动换号绕过——本模块只做识别，不含任何自动恢复逻辑。
 *
 * 2026-10-08 P0-2 词表增强（参考产品 4.13.19 逆向取证）：补 canvas illegal
 * （抖音/西瓜风控特征串）与「账号存在风险」（参考产品风控提示原文）。
 *
 * 2026-10-13 fix-risk-hold-false-positive：**词表与判定逻辑整体收敛到引擎单一真源**
 * `@multi-publish/api-publish-engine/src/publish/core/risk-signals`。
 * 收敛前本文件与引擎 `publish-mode-runner.js` 各有一份 `RISK_RE`，注释都写「保持同义」，
 * 实际内容已漂移（本文件多 安全验证/操作频繁/captcha）——同一个错误文本在两处能得到不同结论。
 * 现在两处 require 同一模块；本文件只保留桌面侧的历史调用签名。
 *
 * ⚠️ 调用约定（本次修复的要点）：**不要用 isRiskBlocked 决定「是否挂起」**。
 * 它回答的是「像不像风控」（强弱并集）；「能不能挂起」的判据是
 * `classifyRisk(...).suspends` —— 弱信号（裸 验证/risk/frequent/verify/601）一律不挂起，
 * 因为实测这些词会把 `身份验证失败`、`status code 601`、`infrequent`、`id 6019`
 * 这类普通失败误判成风控，而挂起的代价是把账号（无账号时是整个平台）冻结到人工解封。
 */
const {
  classifyRisk,
  isRiskText,
  isRiskCode,
  attachRiskSignals,
  RISK_ANY_RE,
  RISK_STRONG_RE,
  RISK_WEAK_RE,
  RISK_CODES,
} = require('@multi-publish/api-publish-engine/src/publish/core/risk-signals')

/**
 * 兼容签名：错误文本是否命中风控词表（**强弱并集**）。
 * @param {unknown} errorMessage - 发布失败的错误文本（task.error）
 * @returns {boolean} true 表示疑似风控命中
 */
function isRiskBlocked (errorMessage) {
  return isRiskText(errorMessage)
}

// attachRiskSignals 不在本文件实现：它已收敛到引擎单一真源 risk-signals.js。
// 为什么必须收敛（CCG 深度审查 i4）：此前引擎 publishViaApi 内联一份、本文件另有一份，
// 且**内容不同**（引擎那份只认 `loginExpired`、不认下划线的 `login_expired`）——
// 这正是本次修掉的 RISK_RE 双份同类的漂移形态。本文件只做**转发**，不做第二实现。

module.exports = {
  isRiskBlocked,
  classifyRisk,
  isRiskText,
  isRiskCode,
  attachRiskSignals,
  RISK_ANY_RE,
  RISK_STRONG_RE,
  RISK_WEAK_RE,
  RISK_CODES,
}
