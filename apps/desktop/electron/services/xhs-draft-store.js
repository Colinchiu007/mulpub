'use strict'

/**
 * xhs-draft-store — 小红书草稿的**强判据**读取与确认（真机取证 2026-10-22）
 *
 * ## 为什么需要它
 * 小红书草稿**不存在服务端**，也不是网络请求，而是**浏览器本地 IndexedDB**：
 *   IndexedDB `draft-database-v1`
 *     ├─ article-draft / audio-draft / image-draft / video-draft
 *     └─ keyPath = draftId，index = uid
 * 记录形态：`{ draftId, uid, timeStamp, content: { contextStore, draftStore, ... } }`
 *   标题在 `content.draftStore.title`，正文在 `content.draftStore.desc`。
 *
 * ⇒ 因此原先基于「草稿箱计数变化」或「保存接口响应」的判据都不可靠：
 *   - 本地写入没有网络请求（我们实测 200s 全窗口零保存请求）
 *   - 页面上的 `草稿箱(N)` 计数会滞后/被占位节点误导（曾出现 saved=true 但列表为空）
 *
 * ## 本模块提供的判据
 * **草稿列表里出现标题等于本次标题的条目** ⇒ 才算保存成功。
 * 这是唯一在真机上被证实与用户可见结果一致的判据。
 *
 * ## 真机验证记录
 * 2026-10-22：上传 dy-small.mp4 + 填标题后离开页面，草稿箱弹层出现
 * `0:12  被误解的明朝：西方史料里的另一个大明   保存于 2026-10-22 15:33:51   [编辑] [删除]`
 */

/** IndexedDB 库名 */
const DB_NAME = 'draft-database-v1'

/** 内容类型 → 对象仓库名 */
const STORE_BY_KIND = Object.freeze({
  video: 'video-draft',
  image: 'image-draft',
  article: 'article-draft',
  audio: 'audio-draft',
})

/**
 * 在页面内读取草稿列表（标题 + draftId + 时间戳）。
 * @param {object} win BrowserWindow
 * @param {string} [kind] video|image|article|audio，默认 video
 * @returns {Promise<Array<{draftId: string, title: string, timeStamp: number}>>}
 */
async function readDrafts (win, kind) {
  const store = STORE_BY_KIND[kind || 'video'] || STORE_BY_KIND.video
  const code = '(async function(){'
    + 'try{'
    + 'var db=await new Promise(function(res,rej){var q=indexedDB.open(' + JSON.stringify(DB_NAME) + ');q.onsuccess=function(){res(q.result)};q.onerror=function(){rej(q.error)}});'
    + 'if(!db.objectStoreNames.contains(' + JSON.stringify(store) + ')){db.close();return []}'
    + 'var st=db.transaction(' + JSON.stringify(store) + ',"readonly").objectStore(' + JSON.stringify(store) + ');'
    + 'var all=await new Promise(function(res,rej){var q=st.getAll();q.onsuccess=function(){res(q.result||[])};q.onerror=function(){rej(q.error)}});'
    + 'db.close();'
    + 'return all.map(function(x){var d=(x&&x.content&&x.content.draftStore)||{};'
    + 'return {draftId:String(x&&x.draftId||""),title:String(d.title||""),timeStamp:Number(x&&x.timeStamp||0)}})'
    + '}catch(e){return {__err:String(e&&e.message||e)}}'
    + '})()'
  return win.webContents.executeJavaScript(code, true)
}

/**
 * 判定：草稿列表里是否已有标题等于 title 的条目（强判据）。
 * @param {object} win BrowserWindow
 * @param {string} title 期望标题（空标题时退化为「任意新增草稿」）
 * @param {{kind?: string, baselineIds?: string[]}} [opts]
 * @returns {Promise<{ok: boolean, draftId?: string, total: number, reason?: string}>}
 */
async function findDraftByTitle (win, title, opts) {
  const o = opts || {}
  const list = await readDrafts(win, o.kind)
  if (!Array.isArray(list)) {
    return { ok: false, total: 0, reason: 'idb-unreadable:' + String(list && list.__err).slice(0, 80) }
  }
  const want = String(title || '').trim()
  const minTs = Number(o.minTimeStamp) > 0 ? Number(o.minTimeStamp) : 0
  if (want) {
    const hit = list.find((d) => String(d.title || '').trim() === want && Number(d.timeStamp || 0) >= minTs)
    return hit
      ? { ok: true, draftId: hit.draftId, total: list.length }
      : { ok: false, total: list.length, reason: 'title-not-found' }
  }
  // 无标题场景：看是否有基线之外的新条目
  const base = new Set((o.baselineIds || []).map(String))
  const fresh = list.find((d) => !base.has(String(d.draftId)) && Number(d.timeStamp || 0) >= minTs)
  return fresh
    ? { ok: true, draftId: fresh.draftId, total: list.length }
    : { ok: false, total: list.length, reason: 'no-new-draft' }
}

/**
 * 轮询等待草稿落库（用于发布流程里「填完内容后等页面自动保存」）。
 * @param {object} win BrowserWindow
 * @param {string} title
 * @param {{kind?: string, baselineIds?: string[], timeoutMs?: number, intervalMs?: number, log?: object, platform?: string}} [opts]
 * @returns {Promise<{ok: boolean, draftId?: string, total: number, reason?: string, waitedMs: number}>}
 */
async function waitForDraft (win, title, opts) {
  const o = opts || {}
  const timeoutMs = Number(o.timeoutMs) > 0 ? Number(o.timeoutMs) : 30000
  const intervalMs = Number(o.intervalMs) > 0 ? Number(o.intervalMs) : 2000
  const started = Date.now()
  let last = { ok: false, total: 0, reason: 'not-polled' }
  while (Date.now() - started < timeoutMs) {
    last = await findDraftByTitle(win, title, { kind: o.kind, baselineIds: o.baselineIds })
    if (last.ok) {
      if (o.log) o.log.info('RpaView', '[' + (o.platform || 'xiaohongshu') + '] draft confirmed title="' + String(title).slice(0, 40) + '" total=' + last.total + ' waited=' + (Date.now() - started) + 'ms')
      return { ...last, waitedMs: Date.now() - started }
    }
    await new Promise((r) => setTimeout(r, intervalMs))
  }
  if (o.log) o.log.warn('RpaView', '[' + (o.platform || 'xiaohongshu') + '] draft not confirmed: ' + last.reason + ' total=' + last.total + ' waited=' + (Date.now() - started) + 'ms')
  return { ...last, waitedMs: Date.now() - started }
}

module.exports = { DB_NAME, STORE_BY_KIND, readDrafts, findDraftByTitle, waitForDraft }
