/**
 * publish-gate-help.js — 发布前闸门的「解法链接」单一真源（CJS，主进程 / 引擎侧）
 *
 * ## 为什么要这个模块
 *
 * 有些平台的发布失败**不是技术上能绕过去的**，而是账号状态本身不满足（例如头条
 * 「账号信息未完善」）。这种失败对用户唯一有用的信息不是错误码，而是**去哪里把它解决掉**。
 * 所以「失败码 → 平台官方解法入口」这张表必须存在，且**只能存在一份**：
 *
 *   - 引擎侧（`packages/api-publish-engine`）用它填 `helpUrl`，随失败结果一起返回；
 *   - 渲染层用它从稳定 `code` 反查链接，**不依赖 IPC 是否透传了 helpUrl 字段**
 *     （结果收敛器 `publish-mode-runner` 用 `Object.assign(base, {...})` 重建对象，
 *      只挑 error/code 等少数字段往下传，新增字段默认不保证透出）。
 *
 * 两处读同一张表 ⇒ 不会出现「引擎说是 A 页，界面跳 B 页」的分裂。
 *
 * ## 链接从哪来（不是猜的）
 *
 * 头条那条是 2026-10-19 真机录到的：发布页点「发布」→ 模态框「账号信息未完善」→
 * 点弹窗里的「去完善」，实测弹出目标即 `ACCOUNT_FIX_URL`。也就是说这是**平台自己
 * 给用户的入口**，比自建说明页更直接（用户点进去就能改，不用读教程）。
 *
 * ## 为什么不写「未实名」
 *
 * 弹窗原文用的是更宽的「账号信息未完善」。把 `IsIdentifyAuth=false` 直接翻译成
 * 「未实名」是过度断言（未单独证实），所以标签文案统一写「完善账号信息」。
 */

/**
 * 闸门失败码 → 官方解法入口。
 *
 * 字段约定：
 *   - `url`：平台官方入口（必须是 http/https，渲染层还会过 `safeHttpUrl` 再验一次）
 *   - `labelKey`：渲染层 i18n key（zh/en 成对维护）
 *   - `fallbackLabel`：i18n 未命中时的兜底标签（中文，与仓内其它兜底同风格）
 */
const PUBLISH_GATE_HELP = Object.freeze({
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
 *
 * @param {string} code 发布失败码（如 `ACCOUNT_NOT_VERIFIED`）
 * @returns {{url: string, labelKey: string, fallbackLabel: string}|null} 无对应入口时返回 null
 */
function helpForCode (code) {
  if (!code || typeof code !== 'string') return null
  return PUBLISH_GATE_HELP[code] || null
}

module.exports = { PUBLISH_GATE_HELP, helpForCode }
