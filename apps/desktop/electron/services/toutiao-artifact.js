'use strict'

/**
 * toutiao-artifact — 今日头条「发布后是否真的进入作品列表」的判据
 *
 * ## 为什么需要它（真机取证 2026-10-22）
 * 头条发布后页面**不跳转、也没有成功文案**（publish verify snapshot 实测：仍停在发布表单）。
 * 因此三种内置判据全都不可用：
 *   - `url`  ：页面不跳转 ⇒ 必然超时（当前默认，缺陷根源）
 *   - `api`  ：`rp` 只在 API 轨非空（rpa-view-platforms L478），头条走 RPA 轨 ⇒ `rp === null`
 *   - `dom`  ：页面无任何成功提示
 *
 * ## 唯一可行路径：查作品列表
 * 参考产品（逆向成果 `01-analysis/mtm-platform-apis.md` 端点清单）用的就是作品列表：
 *   - `mp.toutiao.com/mp/agw/creator_center/list`
 *   - `mp.toutiao.com/mp/agw/creator_center/list/v2`
 *   - `mp.toutiao.com/mp/agw/statistic/v2/item/list`
 * 判定：列表里出现标题等于本次标题的条目 ⇒ 提交成功（审核中同样算成功）。
 *
 * ## 实现取舍
 * 不猜响应体结构（字段名会变）。改为：**在页面内直接请求这些端点，把返回体当文本搜标题**。
 * 这样即使后端改字段也能命中；命中不到就判失败（不假成功）。
 */

/** 作品列表候选端点（相对 mp.toutiao.com，逆向成果给出的三个） */
const LIST_ENDPOINTS = Object.freeze([
  '/mp/agw/creator_center/list/v2',
  '/mp/agw/creator_center/list',
  '/mp/agw/statistic/v2/item/list',
])

/** 作品管理页（兜底：端点都不可用时看页面 DOM） */
const WORKS_PAGE = 'https://mp.toutiao.com/profile_v4/graphic/articles'

/**
 * 在页面内请求作品列表端点并按文本搜标题。
 * @param {object} win BrowserWindow
 * @param {string} title
 * @returns {Promise<{ok: boolean, hitEndpoint?: string, detail?: string}>}
 */
async function probeEndpoints (win, title) {
  const code = '(async function(){'
    + 'var want=' + JSON.stringify(String(title || '').trim()) + ';'
    + 'if(!want)return {ok:false,detail:"empty-title"};'
    + 'var eps=' + JSON.stringify(LIST_ENDPOINTS) + ';'
    + 'for(var i=0;i<eps.length;i++){'
    + '  try{'
    + '    var r=await fetch(eps[i],{credentials:"include",headers:{"Accept":"application/json"}});'
    + '    if(!r.ok)continue;'
    + '    var t=await r.text();'
    + '    if(t&&t.indexOf(want)>=0)return {ok:true,hitEndpoint:eps[i],detail:"len="+t.length};'
    + '  }catch(e){}'
    + '}'
    + 'return {ok:false,detail:"no-endpoint-hit"}'
    + '})()'
  try {
    return await win.webContents.executeJavaScript(code, true)
  } catch (e) {
    return { ok: false, detail: 'exec-failed:' + String(e && e.message).slice(0, 80) }
  }
}

/**
 * 兜底：打开作品管理页，在 DOM 文本里搜标题。
 * @param {object} win BrowserWindow
 * @param {string} title
 * @param {{timeoutMs?: number, intervalMs?: number, host?: object}} [opts]
 * @returns {Promise<{ok: boolean, detail?: string}>}
 */
async function probeWorksPage (win, title, opts) {
  const o = opts || {}
  const want = String(title || '').trim()
  if (!want) return { ok: false, detail: 'empty-title' }
  try {
    if (o.host && typeof o.host._navigateAndWait === 'function') {
      await o.host._navigateAndWait(win, WORKS_PAGE, 1500)
    } else {
      await win.webContents.loadURL(WORKS_PAGE)
    }
  } catch (e) {
    return { ok: false, detail: 'navigate-failed:' + String(e && e.message).slice(0, 60) }
  }
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : 20000
  const intervalMs = Number(o.intervalMs) > 0 ? Number(o.intervalMs) : 2000
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    await new Promise((r) => setTimeout(r, intervalMs))
    try {
      const hit = await win.webContents.executeJavaScript(
        '(function(){var t=(document.body&&document.body.innerText)||"";return t.indexOf(' + JSON.stringify(want) + ')>=0})()', true)
      if (hit) return { ok: true, detail: 'works-page-hit' }
    } catch (_e) { /* 继续轮询 */ }
  }
  return { ok: false, detail: 'works-page-timeout' }
}

/**
 * 头条发布成功判定：先查作品列表端点，再兜底查作品管理页。
 * @param {object} win BrowserWindow
 * @param {string} title
 * @param {{timeoutMs?: number, intervalMs?: number, host?: object, log?: object}} [opts]
 * @returns {Promise<{ok: boolean, evidence: string, detail?: string}>}
 */
async function confirmPublished (win, title, opts) {
  const o = opts || {}
  const log = o.log
  const ep = await probeEndpoints(win, title)
  if (ep.ok) {
    if (log) log.info('RpaView', '[toutiao] artifact 命中 ' + ep.hitEndpoint + ' ' + String(ep.detail))
    return { ok: true, evidence: 'artifact-endpoint:' + ep.hitEndpoint, detail: ep.detail }
  }
  const dom = await probeWorksPage(win, title, o)
  if (dom.ok) {
    if (log) log.info('RpaView', '[toutiao] artifact 命中作品管理页 DOM')
    return { ok: true, evidence: 'works-page-dom' }
  }
  if (log) log.warn('RpaView', '[toutiao] artifact 未命中：' + String(ep.detail) + ' / ' + String(dom.detail))
  return { ok: false, evidence: 'not-found', detail: String(ep.detail) + '|' + String(dom.detail) }
}

module.exports = { LIST_ENDPOINTS, WORKS_PAGE, probeEndpoints, probeWorksPage, confirmPublished }
