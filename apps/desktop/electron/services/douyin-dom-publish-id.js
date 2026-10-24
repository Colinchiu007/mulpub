#!/usr/bin/env node
'use strict'

/**
 * douyin-dom-publish-id.js —— 抖音 DOM 轨成功时的产物 ID 提取（2026-10-21）
 *
 * ── 为什么独立成文件 ────────────────────────────────────────
 * `rpa-view-platforms.js` 是 check-max-lines 的**点名还账**文件（零增长容差，
 * 目标 1484 行）。往它里面加任何逻辑都会顶爆门禁。
 *
 * 而动因是真实的：抖音 E2E 首次成功（PRD §16.22）时 `result` 里**没有任何平台侧 ID**，
 * "成功"缺少可核对的硬证据。根因是原 L1050 只 `return { success:true }`，
 * 把 `_waitForResponse` 已 resolve 的 `resp`（含 CDP 采集的 body）整个丢掉。
 *
 * ⇒ 本模块只做一件事：从那个 body 里解出产物 ID。
 *
 * ── 纪律 ────────────────────────────────────────────────────
 * 1. **复用仓库既有单一真源** `extractPublishIdsFromResponseBody` / `normalizePublishId`
 *    （来自 rpa-view-platforms.js 顶部引入），不自造第二套字段枚举；
 * 2. 取不到就返回空串 —— **绝不编造 ID**（假 ID 比没 ID 更糟：它会被当成证据引用）；
 * 3. body 非 JSON / 空串时静默返回空串，**不抛错**（发布已成功，
 *    不能因为取 ID 失败把成功改成失败）。
 *
 * @param {*} body `_waitForResponse` resolve 对象里的 `body` 字段
 * @param {string} [endpoint] 响应 URL（用于让既有工具按 endpoint 精确判定）
 * @returns {string} 产物 ID；取不到为 ''
 */

'use strict'

const { extractPublishIdsFromResponseBody, normalizePublishId } = require('./rpa-publish-id-extract')

function extractDouyinPublishId (body, endpoint) {
  if (!body) return ''
  let ids
  try {
    ids = extractPublishIdsFromResponseBody(body, { endpoint: String(endpoint || '') }) || []
  } catch (_e) {
    return '' // 解析失败不得把成功改成失败
  }
  return normalizePublishId(ids[0]) || ''
}

module.exports = { extractDouyinPublishId }
