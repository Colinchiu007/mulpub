/**
 * publish-gate-help.browser.js — 发布前闸门「解法链接」单一真源（ESM，渲染进程）
 *
 * 与 `publish-gate-help.js`（CJS，主进程/引擎侧）**必须保持内容一致**：
 * 浏览器不能执行 CommonJS 的 `module.exports`，所以照本仓既有先例
 * （`platform-definitions` / `account-name-guard` / `publish-capabilities`）出两份。
 *
 * 一致性由 `packages/shared-utils/test/publish-gate-help-parity.test.js` 机械锁住
 * （逐条比对两份的码集合、url、labelKey），**不靠人记得同步**。
 *
 * 为什么不直接把链接写在渲染层：引擎侧也要用同一个链接填 `helpUrl`，
 * 两处各写一份必然漂移（实测教训：文档与代码各存一份判据，最终对不上）。
 */

export const PUBLISH_GATE_HELP = Object.freeze({
  ACCOUNT_NOT_VERIFIED: Object.freeze({
    url: 'https://mp.toutiao.com/profile_v4/personal/landing-type',
    labelKey: 'publishPage.publishFlow.gateHelp.accountNotVerified',
    fallbackLabel: '去头条号完善账号信息',
  }),
  NO_PUBLISH_PERMISSION: Object.freeze({
    url: 'https://mp.toutiao.com/profile_v4/personal/landing-type',
    labelKey: 'publishPage.publishFlow.gateHelp.noPublishPermission',
    fallbackLabel: '去头条号完善账号信息',
  }),
})

/**
 * 按失败码取解法入口。
 * @param {string} code
 * @returns {{url: string, labelKey: string, fallbackLabel: string}|null}
 */
export function helpForCode (code) {
  if (!code || typeof code !== 'string') return null
  return PUBLISH_GATE_HELP[code] || null
}
