// @ts-check
/**
 * input-driver.js — 行为层 driver 选择点（PR-2 §7.3）
 *
 * design.md D2「传输无关接口先行」的落地：`cdp-input.js`（Electron debugger）与
 * `stealth-channel-camofox.js`（CDP-over-WebSocket）各实现一版同接口驱动，本模块是
 * 唯一的**选择点**——按有没有 sidecar endpoint 决定用哪个。
 *
 * 为什么需要这个文件（而不是在两个调用点各写 if）：
 *   1. depcheck 报警是准确的 —— pin 了 camofox 却没有任何代码 require 它。接上这一
 *      层后 camofox 真正进入 require 图，同时在 dep-audit 的 prod 扫描面内
 *      （若为过 depcheck 而把它加进 --ignores 或降级成 devDependencies，它的 CVE
 *       就会退出审计面 —— 那是用安全换绿灯）
 *   2. 选择逻辑只此一份。`_behaviorClick` / `_behaviorFill` 两处都要选 driver，
 *      各写一遍必然漂移
 *
 * 跨模块边界（尚未闭合的部分，如实记）：manager 层怎么拿到已启动 sidecar 的
 * endpoint 需真机联调后接线（tasks 7.3 遗留）。本模块只负责「有 endpoint 就用
 * camofox，没有就 Electron」，不负责启动 sidecar。
 */
const { createCdpInput } = require('./cdp-input')
const { createCamofoxInput, assertLoopbackEndpoint } = require('./stealth-channel-camofox')

/**
 * 选择行为层输入驱动。
 * @param {{webContents: any}} win Electron BrowserWindow（camofox 模式下不使用，
 *   但保留同签名，使调用点无需分支）
 * @param {string|null} [endpoint] sidecar 的 CDP WebSocket 端点（带一次性 token）；
 *   传了就走 camofox 驱动，否则走 Electron debugger 驱动
 * @returns {object} 同接口的输入驱动
 */
function resolveInputDriver (win, endpoint) {
  // 空串/undefined/null 一律按「无 endpoint」——它们不是「非回环」，是「没给」
  if (endpoint == null || endpoint === '') {
    return createCdpInput(win)
  }
  // 有 endpoint 就先校验回环（fail-closed）：非回环 WS 进来 = 把 CDP 暴露给同网段
  assertLoopbackEndpoint(endpoint)
  return createCamofoxInput({ endpoint })
}

module.exports = { resolveInputDriver }
