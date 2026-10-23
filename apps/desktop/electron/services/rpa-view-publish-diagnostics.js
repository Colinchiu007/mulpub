// @ts-check
'use strict'
/**
 * rpa-view-publish-diagnostics —— 平台发布的**诊断取证纯函数**（从 rpa-view-platforms.js 拆出）。
 *
 * 拆分动因：`.github/scripts/check-max-lines.js` 的**点名还账**机制把
 * `rpa-view-platforms.js` 列入 targets（目标 1484 行，容差 0）——「谁被点名，
 * 谁从今天起一行都不能再涨」。而 2026-10 的 #4276（toutiao 点击「添加视频」）
 * 给该文件加了 14 行 ⇒ 它越过了点名目标 ⇒ **债务熔断检查在所有后续 PR 上转红**
 * （含与该改动完全无关的 PR）。
 *
 * 本模块沿用该文件既有的拆分范式（前两次：`rpa-publish-id-extract.js`、
 * `rpa-view-navigation-helpers.js`），**只搬移、不删逻辑、不改行为**：
 * 三个函数此前是 mixin 私有（未导出），故无任何外部调用点受影响。
 */

const {
  normalizePublishId,
  extractPublishIdsFromResponseBody,
  sanitizeDiagnosticEndpoint,
} = require('./rpa-publish-id-extract')

async function readVisibleEditorToast (win) {
  const { buildVisibleToastScript } = require('./wechat-mp-draft-mediaid')
  const { TOAST_SELECTORS } = require('./wechat-mp-dom-guard')
  try {
    const t = await win.webContents.executeJavaScript(buildVisibleToastScript(TOAST_SELECTORS))
    return String(t == null ? '' : t)
  } catch (_) {
    return ''
  }
}

function summarizePublishDiagnostics (records, artifact) {
  const source = Array.isArray(records) ? records : []
  const responses = source.slice(-20).map(record => ({
    endpoint: sanitizeDiagnosticEndpoint(record?.endpoint || record?.url),
    status: Number.isFinite(Number(record?.status)) ? Number(record.status) : 0,
    mimeType: String(record?.mimeType || '').split(';')[0].slice(0, 160),
  }))
  return {
    responseCount: source.length,
    responses,
    artifactFound: Boolean(artifact && normalizePublishId(artifact.postId)),
  }
}

function parsePublishResponseEvidence (body, response) {
  const status = Number(response?.status)
  if (!Number.isFinite(status) || status < 200 || status >= 300) return null
  if (!/(?:publish|submit|create|commit|release)/i.test(String(response?.endpoint || ''))) return null
  const publishIds = extractPublishIdsFromResponseBody(body, { endpoint: String(response?.url || response?.endpoint || '') })
  return publishIds.length > 0 ? { publishIds } : null
}

module.exports = {
  readVisibleEditorToast,
  summarizePublishDiagnostics,
  parsePublishResponseEvidence,
}
