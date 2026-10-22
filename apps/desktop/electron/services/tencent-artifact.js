'use strict'

/**
 * tencent-artifact — 视频号「发布后作品是否真的出现在作品列表」的判据
 *
 * ## 为什么需要它（真机 2026-10-23）
 * 视频号发布后 `publish verify snapshot` 只会看到壳页文本
 * `视频号 · 助手 9 退出登录`，页面被重置 ⇒ 原有的「等 URL/成功文案变化」判据
 * **必然 timeout**，但那次发布全程**零报错**且表单已重置，很可能已经成功。
 *
 * ⇒ 判据应改为：**作品列表里出现本次标题**（与头条 toutiao-artifact 同构）。
 *
 * ## 实现
 * 打开发布者中心的视频管理页，轮询页面文本里是否出现标题。
 * 不猜接口字段（后端会变），只看用户可见结果。
 */

/** 视频号作品管理页（发布者中心 → 视频管理） */
const POST_LIST_URL = 'https://channels.weixin.qq.com/platform/post/list'

/**
 * 判定作品是否出现在作品列表。
 * @param {object} win BrowserWindow
 * @param {string} title 作品标题（真文案，用于精确匹配）
 * @param {{timeoutMs?: number, intervalMs?: number, host?: object, log?: object}} [opts]
 * @returns {Promise<{ok: boolean, evidence: string, detail?: string}>}
 */
async function confirmPublished (win, title, opts) {
  const o = opts || {}
  const log = o.log
  const want = String(title || '').trim()
  if (!want) return { ok: false, evidence: 'empty-title' }

  try {
    if (o.host && typeof o.host._navigateAndWait === 'function') {
      await o.host._navigateAndWait(win, POST_LIST_URL, 1500)
    } else {
      await win.webContents.loadURL(POST_LIST_URL)
    }
  } catch (e) {
    const detail = 'navigate-failed:' + String(e && e.message).slice(0, 60)
    if (log) log.warn('RpaView', '[tencent_video] artifact ' + detail)
    return { ok: false, evidence: 'not-found', detail }
  }

  // 2026-10-23 真机：post-list-timeout textLen=15 —— 先放宽到 45s 排除首屏慢
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : 45000
  const intervalMs = Number(o.intervalMs) > 0 ? Number(o.intervalMs) : 2500
  const deadline = Date.now() + timeoutMs
  let lastLen = 0
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    try {
      const probe = await win.webContents.executeJavaScript(
        '(function(){var t=((document.body&&document.body.innerText)||"").replace(/\\s+/g," ");'
        + 'return {hit:t.indexOf(' + JSON.stringify(want) + ')>=0, len:t.length}})()', true)
      lastLen = probe && probe.len ? probe.len : lastLen
      if (probe && probe.hit) {
        if (log) log.info('RpaView', '[tencent_video] artifact 命中作品列表 title=' + want.slice(0, 30))
        return { ok: true, evidence: 'post-list-dom' }
      }
    } catch (_e) { /* 页面切换中继续轮询 */ }
  }
  let diag = 'url=? readyState=?'
  try {
    diag = await win.webContents.executeJavaScript('(function(){return "url="+location.href+" readyState="+document.readyState+" text="+((document.body&&document.body.innerText)||"").replace(/\\s+/g," ").slice(0,80)})()', true)
  } catch (_e) {}
  if (log) log.warn('RpaView', '[tencent_video] artifact 诊断 ' + diag)
  const detail = 'post-list-timeout:textLen=' + lastLen
  if (log) log.warn('RpaView', '[tencent_video] artifact 未命中（' + detail + '）')
  return { ok: false, evidence: 'not-found', detail }
}

module.exports = { POST_LIST_URL, confirmPublished }
