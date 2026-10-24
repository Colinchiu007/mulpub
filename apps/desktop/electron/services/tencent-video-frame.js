'use strict'

/**
 * tencent-video-frame — 视频号（channels.weixin.qq.com）的 **frame-aware** 填充
 *
 * ## 真因（2026-10-22 真机取证，round113）
 * 发布页有两个 frame：
 *   主 frame  `channels.weixin.qq.com/platform/post/create`        → ce=0 ta=0 inp=0，只有「视频号 · 助手 9」空壳
 *   子 iframe `channels.weixin.qq.com/micro/content/post/create`   → ce=1 ta=1 inp=22，真正的「视频描述 / 短标题 / 位置 / 合集」
 *
 * 通用链路 `_resolveSelector` / `_fillInput` 只在**主 frame** 搜索 ⇒ 必然 `editor 未命中`，
 * 标题与正文都写不进去；上传完成信号在主 frame 也永远读不到。
 *
 * ## 本模块职责
 * 找到子 frame，然后在**该 frame 内**完成：找编辑器 → 填标题/正文 → 回读校验。
 */

/** 子 frame 的 URL 片段（真机取证） */
const CONTENT_FRAME_HINT = '/micro/content/post/create'

/** 视频号短标题字数上限（真机实测：超过 16 字页面报「标题超过16字限制」） */
const SHORT_TITLE_MAX = 16

/**
 * 在 win 的所有 frame 里找内容 frame。
 * @param {object} win BrowserWindow
 * @returns {object|null} Electron WebFrameMain
 */
function findContentFrame (win) {
  try {
    const mf = win && win.webContents && win.webContents.mainFrame
    if (!mf) return null
    const frames = Array.isArray(mf.frames) ? mf.frames : []
    const hit = frames.find((f) => String(f.url || '').indexOf(CONTENT_FRAME_HINT) >= 0)
    return hit || null
  } catch (_e) { return null }
}

/**
 * 在内容 frame 内填标题与正文，并回读校验。
 * @param {object} win BrowserWindow
 * @param {{ title?: string, content?: string }} data
 * @param {{ log?: object, platform?: string }} [opts]
 * @returns {Promise<{ ok: boolean, step: string, title?: string, content?: string }>}
 */
async function fillTencentVideo (win, data, opts) {
  const o = opts || {}
  const log = o.log
  const platform = o.platform || 'tencent_video'
  const frame = findContentFrame(win)
  if (!frame) {
    if (log) log.warn('RpaView', '[' + platform + '] content frame not found (' + CONTENT_FRAME_HINT + ')')
    return { ok: false, step: 'no-frame' }
  }
  if (log) log.info('RpaView', '[' + platform + '] content frame found: ' + String(frame.url).slice(0, 80))

  const rawTitle = String((data && data.title) || '')
  // 视频号「短标题」上限 16 字（真机取证 2026-10-22：18 字标题会被页面红字拦下「标题超过16字限制」）
  const title = rawTitle.slice(0, SHORT_TITLE_MAX)
  // 超限时把完整标题并入正文首行，避免信息丢失
  const content0 = rawTitle.length > SHORT_TITLE_MAX && String((data && data.content) || '').indexOf(rawTitle) < 0
  const content = content0 ? (rawTitle + String.fromCharCode(10) + String((data && data.content) || '')) : String((data && data.content) || '')

  // 1) 填「视频描述」= textarea（真机 ta=1）；没有 textarea 时退回 contenteditable
  const descCode = '(function(){'
    + 'var ta=document.querySelector("textarea");'
    + 'var el=ta||document.querySelector("[contenteditable]");'
    + 'if(!el)return "NO_EDITOR";'
    + 'var v=' + JSON.stringify(content) + ';'
    + 'if(ta){el.focus();el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}))}'
    + 'else{el.focus();el.textContent=v;el.dispatchEvent(new InputEvent("input",{bubbles:true}))}'
    + 'return String(el.value!==undefined?el.value:el.textContent).length'
    + '})()'
  let descLen
  try { descLen = await frame.executeJavaScript(descCode) } catch (e) {
    if (log) log.warn('RpaView', '[' + platform + '] desc fill failed: ' + String(e && e.message).slice(0, 80))
    return { ok: false, step: 'desc-fill-failed' }
  }
  if (descLen === 'NO_EDITOR' || descLen < 0) {
    if (log) log.warn('RpaView', '[' + platform + '] desc editor not found inside content frame')
    return { ok: false, step: 'no-editor' }
  }
  if (log) log.info('RpaView', '[' + platform + '] desc filled, readback=' + descLen)

  // 2) 填「短标题」= 第一个可见 input（真机 inp=22，其余是话题/位置等）
  let titleOk = true
  if (title) {
    const titleCode = '(function(){'
      + 'var ins=[].slice.call(document.querySelectorAll("input")).filter(function(e){return e.getClientRects().length>0&&!e.disabled});'
      + 'var el=ins.filter(function(e){return (e.placeholder||"").indexOf("标题")>=0})[0]||ins[0];'
      + 'if(!el)return "NO_INPUT";'
      + 'var v=' + JSON.stringify(title) + ';'
      + 'el.focus();el.value=v;el.dispatchEvent(new Event("input",{bubbles:true}));el.dispatchEvent(new Event("change",{bubbles:true}));'
      + 'return String(el.value||"").length})()'
    try {
      const n = await frame.executeJavaScript(titleCode)
      titleOk = n !== 'NO_INPUT' && Number(n) > 0
      if (log) log.info('RpaView', '[' + platform + '] short title filled, readback=' + n)
    } catch (_e) { titleOk = false }
  }

  return { ok: true, step: 'done', title: titleOk ? 'ok' : 'skipped', content: String(descLen) }
}

module.exports = { CONTENT_FRAME_HINT, findContentFrame, fillTencentVideo }
