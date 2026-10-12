// @ts-check
/**
 * wechat-mp-cover.js — 微信公众号封面注入与生效判据（2026-10-12 修复）
 *
 * ## 修的是什么
 *
 * 用户报障：同一条文案发到快手有正文有封面，发到微信公众号草稿箱**只有标题**。
 * 封面这一半的根因是：`_publish_wechat_mp` **从头到尾没有封面上传这一步**
 * （对照 `_publish_generic` 第 354 行起有完整的 `article.cover_path` → `input[type=file]` 段）。
 * 公众号封面是必填项，所以现象不是「封面丢了」而是「草稿本身不完整」；而保存草稿只看
 * `appmsgid`，于是缺封面的草稿仍以 success 落库。
 *
 * ## 生效判据（按证据强度）
 *
 * ① 封面 CDN 链接出现（`.js_cover_preview_new` 的 `background-image` 或 `#js_cover_area`
 *    的 HTML 里出现 `mmbiz.qpic.cn`）
 * ② `.js_cover_preview_new` 存在**且**背景图非空、非 `data:`
 * ③ 容器内 `img` 数相对注入前基线递增（最弱，仅兜底）
 *
 * ⛔ **不得把 ③ 当主判据**：新版封面预览是 `background-image` 的 div，常常一个 `img` 都不加 ——
 * 用它会把上传成功判成失败，直接把公众号发布打死。
 * ⛔ **不得用「占位文案消失 / 容器变空」当判据**：有项目明确记录过「封面已设置但
 * `#js_cover_area` 仍显示占位文案」。
 *
 * ## 选择器来源与真机边界
 *
 * 微信后台 DOM 无第一手抓取条件，下列选择器取自多个第三方公众号自动化项目的一致用法：
 * 入口 `#js_cover_area`（内层可点 `.js_cover_btn_area`）→ 菜单 `#js_cover_null .js_imagedialog`
 * → 弹层文件框 `.weui-desktop-dialog__wrp input[type=file][name="file"]`
 * → 「下一步」→「确认」。这是**候选表**而非定论：每个候选按优先级尝试，
 * 返回值里带命中的是哪个候选，一次真机失败即可定位。
 */
const fs = require('fs')
const path = require('path')
const log = require('./logger')
// 「本地路径 vs 远程 URL」判据的单一真源（`publisher-router.js` 的 buildPublishArticle
// 写的是 `cover_path: cover_url || cover_path`，所以 `article.cover_path` **可能是 URL**）
const { isLocalImagePath } = require('./publish-record-cover')

/** 公众号媒体上传上限（与 `packages/python-backend/.../publishers/wechat_mp.py` 的 `_upload_image` 同口径） */
const MAX_COVER_BYTES = 2 * 1024 * 1024

const COVER_OPEN_SETTLE_MS = 1800
const COVER_CROP_SETTLE_MS = 900
const COVER_POLL_INTERVAL_MS = 500
const COVER_POLL_ROUNDS = 6
/** 封面「下一步 → 确认」最多点几次（各版本步骤数不同） */
const COVER_CONFIRM_STEPS = 4

/** 封面入口（点它打开封面选择菜单）。顺序按第三方项目的一致用法排。 */
const COVER_ENTRY_SELECTORS = [
  '#js_cover_area .js_cover_btn_area',
  '#js_cover_area',
  '.select-cover__btn',
  '.appmsg_cover',
  '.cover_ct',
]

/** 封面容器（读生效状态的根节点候选） */
const COVER_CONTAINER_SELECTORS = ['#js_cover_area', '.js_cover_area', '.cover_ct', '.appmsg_cover']

/** 封面预览节点候选（生效证据） */
const COVER_PREVIEW_SELECTORS = ['.js_cover_preview_new', '.select-cover__preview', '.weui-desktop-publish__cover__thumb']

/** 封面弹层内文件框候选（按第三方项目的一致顺序） */
const COVER_FILE_INPUT_SELECTORS = [
  '.weui-desktop-dialog__wrp input[type="file"][name="file"]',
  '.weui-desktop-dialog__wrp input[type="file"]',
  '#js_cover_area input[type="file"][name="file"]',
  '#js_cover_area input[type="file"]',
  'input[type="file"][name="file"]',
  'input[type="file"][accept*="image"]',
]

/** 封面裁剪/确认按钮文案候选（各版本步骤名不同） */
const COVER_NEXT_LABELS = ['下一步', '确定', '确认', '完成', '使用', '保存']

const MARKER = {
  coverEntry: '/*mpwc-cover-entry*/',
  coverMenu: '/*mpwc-cover-menu*/',
  coverInputs: '/*mpwc-cover-inputs*/',
  coverInject: '/*mpwc-cover-inject*/',
  coverNext: '/*mpwc-cover-next*/',
  coverState: '/*mpwc-cover-state*/',
}

function jsString (value) {
  return JSON.stringify(value == null ? '' : String(value))
}

/** 封面入口（在页面内按文案兜底打开封面菜单） */
function openCoverEntryScript () {
  return '(function(){' + MARKER.coverEntry
    + 'var el=document.querySelector("#js_cover_area .js_cover_btn_area")||document.querySelector("#js_cover_area");'
    + 'if(el){try{el.dispatchEvent(new MouseEvent("mouseover",{bubbles:true}))}catch(e){};el.click();return {ok:true,how:"cover-area"}}'
    + 'var hit=[...document.querySelectorAll("a,button,div,span,label,li")].filter(function(e){'
    + 'var t=(e.innerText||"").trim();var r=e.getBoundingClientRect();'
    + 'return /^(设置封面|编辑封面|上传封面|选择封面)$/.test(t)&&r.width>0&&r.height>0});'
    + 'if(hit.length){hit[0].click();return {ok:true,how:"by-text"}}return {ok:false,detail:"no-entry"}})()'
}

/** 封面菜单项（「从图片库选择 / 上传图片」） */
function openCoverMenuScript () {
  return '(function(){' + MARKER.coverMenu
    + 'var sel=["#js_cover_null .js_imagedialog","#js_cover_area .js_imagedialog","#js_cover_null .js_selectCoverFromContent"];'
    + 'for(var i=0;i<sel.length;i++){var el=document.querySelector(sel[i]);'
    + 'if(el){el.click();return {ok:true,how:sel[i]}}}'
    + 'var items=[...document.querySelectorAll("#js_cover_null a,#js_cover_null li,.weui-desktop-dropdown__list a")];'
    + 'var hit=items.filter(function(e){return /从(?:图片|素材)库选择|图片库|素材库|上传图片|从正文(?:中)?选择/.test(e.innerText||"")});'
    + 'if(hit.length){hit[0].click();return {ok:true,how:"by-text"}}return {ok:false,detail:"no-menu-item"}})()'
}

/** 封面弹层内文件框数量 */
function coverFileInputCountScript () {
  return '(function(){' + MARKER.coverInputs
    + 'var sels=' + JSON.stringify(COVER_FILE_INPUT_SELECTORS) + ';'
    + 'for(var i=0;i<sels.length;i++){if(document.querySelector(sels[i]))return document.querySelectorAll(\'input[type="file"]\').length}'
    + 'return 0})()'
}

/**
 * 向第 index 个 `input[type=file]` 注入封面（DataTransfer + change/input 事件）。
 * 通道与 `_uploadToutiaoCover` 一致：CDP `DOM.setFileInputFiles` 在 React 受控组件上
 * 会**静默清空文件**，纯页面内 DataTransfer 是实测可用的那条路。
 */
function injectCoverScript (index, base64, fileName, mimeType) {
  return '(function(){' + MARKER.coverInject
    + 'var ins=document.querySelectorAll(\'input[type="file"]\');'
    + 'var el=ins[' + Number(index) + '];if(!el)return false;'
    + 'var b64=' + jsString(base64) + ';var bin=atob(b64);var n=bin.length;'
    + 'var bytes=new Uint8Array(n);for(var k=0;k<n;k++)bytes[k]=bin.charCodeAt(k);'
    + 'var f=new File([bytes],' + jsString(fileName) + ',{type:' + jsString(mimeType) + '});'
    + 'var dt=new DataTransfer();dt.items.add(f);el.files=dt.files;'
    + 'el.dispatchEvent(new Event(\'change\',{bubbles:true}));'
    + 'el.dispatchEvent(new Event(\'input\',{bubbles:true}));return true})()'
}

/** 点封面弹层/裁剪页里的「下一步 / 确认」（各版本步骤名不同，按文案找可见按钮） */
function clickCoverNextScript () {
  return '(function(){' + MARKER.coverNext
    + 'var labels=' + JSON.stringify(COVER_NEXT_LABELS) + ';'
    + 'var roots=["#js_cover_area",".weui-desktop-dialog__wrp","body"];'
    + 'for(var r=0;r<roots.length;r++){var root=document.querySelector(roots[r]);if(!root)continue;'
    + 'var btns=[...root.querySelectorAll("a,button,.weui-desktop-btn")].filter(function(b){'
    + 'var t=(b.innerText||"").trim();var rc=b.getBoundingClientRect();'
    + 'return labels.indexOf(t)>=0&&rc.width>0&&rc.height>0'
    + '&&!(b.classList&&b.classList.contains("weui-desktop-btn_disabled"))});'
    + 'if(btns.length){var label=(btns[0].innerText||"").trim();btns[0].click();return {ok:true,label:label}}}'
    + 'return {ok:false}})()'
}

/** 封面生效状态：CDN 链接 / 预览节点背景图 / img 计数（三条证据一起回传，由调用方判） */
function coverStateScript () {
  return '(function(){' + MARKER.coverState
    + 'var root=null;var cs=' + JSON.stringify(COVER_CONTAINER_SELECTORS) + ';'
    + 'for(var i=0;i<cs.length;i++){root=document.querySelector(cs[i]);if(root)break}'
    + 'var ps=' + JSON.stringify(COVER_PREVIEW_SELECTORS) + ';var preview=null;'
    + 'for(var j=0;j<ps.length;j++){preview=document.querySelector(ps[j]);if(preview)break}'
    + 'var bg="";try{bg=preview?String(getComputedStyle(preview).backgroundImage||""):""}catch(e){}'
    + 'var scope=root||document.body;var html=String(scope.innerHTML||"");'
    + 'var hasCdn=/mmbiz\\.qpic\\.cn/.test(bg)||/mmbiz\\.qpic\\.cn/.test(html);'
    + 'var bgUsable=!!bg&&bg!=="none"&&bg.indexOf("data:")!==0;'
    + 'return {preview:!!preview,hasCdn:hasCdn,bgUsable:bgUsable,'
    + 'imgCount:scope.querySelectorAll("img").length}})()'
}

function guessMimeType (fileName) {
  if (/\.jpe?g$/i.test(fileName)) return 'image/jpeg'
  if (/\.webp$/i.test(fileName)) return 'image/webp'
  if (/\.gif$/i.test(fileName)) return 'image/gif'
  return 'image/png'
}

async function safeExec (win, script, fallback = null) {
  try {
    const r = await win.webContents.executeJavaScript(script)
    return r === undefined ? fallback : r
  } catch (e) {
    log.warn('RpaView', '[wechat_mp] exec failed: ' + (e && e.message))
    return fallback
  }
}

async function readCoverState (win) {
  const s = await safeExec(win, coverStateScript(), null)
  return s && typeof s === 'object' ? s : { preview: false, hasCdn: false, bgUsable: false, imgCount: -1 }
}

/** 生效判据：封面 CDN 链接 > 预览节点有可用背景图 > img 数相对基线递增（最弱，仅兜底） */
function isCoverApplied (state, baselineImgCount) {
  if (state.hasCdn === true) return 'cdn'
  if (state.preview === true && state.bgUsable === true) return 'preview-bg'
  const baseline = Number.isFinite(baselineImgCount) && baselineImgCount >= 0 ? baselineImgCount : 0
  if (Number.isFinite(state.imgCount) && state.imgCount > baseline) return 'img-delta'
  return ''
}

async function clickCoverNext (win) {
  const r = await safeExec(win, clickCoverNextScript(), { ok: false })
  return r && r.ok === true ? String(r.label || '') : ''
}

/**
 * 上传公众号封面。
 *
 * @param {object} host RpaViewManager 混入对象（`_click` / `_sleep` / `_setFileInput`）
 * @param {object} win BrowserWindow
 * @param {string} coverPath 本地封面绝对路径
 * @returns {Promise<{ok: boolean, skipped?: boolean, detail?: string, baseline?: number, applied?: number, evidence?: string, fileName?: string, sizeBytes?: number}>}
 */
async function uploadWechatMpCover (host, win, coverPath) {
  const filePath = typeof coverPath === 'string' ? coverPath.trim() : ''
  if (!filePath) return { ok: true, skipped: true, detail: 'no-cover' }

  const fileName = path.basename(filePath)
  // `publisher-router.js` 的 buildPublishArticle 取 `cover_url || cover_path`，故这里可能是
  // 网络地址。DOM 轨只能通过 `input[type=file]` 注入**本地文件**，必须显式区分，
  // 否则会退化成「文件不存在」这种误导性原因。
  if (!isLocalImagePath(filePath)) return { ok: false, detail: 'not-a-local-file', fileName }

  let sizeBytes
  try {
    if (!fs.existsSync(filePath)) return { ok: false, detail: 'not-found', fileName }
    sizeBytes = fs.statSync(filePath).size
  } catch (e) {
    return { ok: false, detail: 'stat-failed', fileName }
  }
  if (!(sizeBytes > 0)) return { ok: false, detail: 'empty-file', fileName }
  if (sizeBytes > MAX_COVER_BYTES) return { ok: false, detail: 'too-large', fileName, sizeBytes }

  let base64
  try {
    base64 = fs.readFileSync(filePath).toString('base64')
  } catch (e) {
    return { ok: false, detail: 'read-failed', fileName }
  }
  if (!base64) return { ok: false, detail: 'read-failed', fileName }

  try { if (host._emitProgress) host._emitProgress('wechat_mp', 'uploading cover...', 55) } catch (_) { /* 旁路 */ }

  // 注入前基线（img 数）——只在「CDN 链接 / 预览背景图」两条强判据都拿不到时才用它
  const baselineState = await readCoverState(win)
  const baselineImg = Number.isFinite(baselineState.imgCount) ? baselineState.imgCount : -1
  log.info('RpaView', '[wechat_mp cover] baseline img=' + baselineImg + ' file=' + fileName + ' bytes=' + sizeBytes)

  // 1) 打开封面入口：先按选择器点，再按文案兜底
  let opened = false
  for (const selector of COVER_ENTRY_SELECTORS) {
    try {
      if (await host._click(win, selector) === true) { opened = true; log.info('RpaView', '[wechat_mp cover] entry=' + selector); break }
    } catch (_) { /* 候选失配即下一个 */ }
  }
  if (!opened) {
    const byText = await safeExec(win, openCoverEntryScript(), { ok: false })
    opened = Boolean(byText && byText.ok === true)
    if (opened) log.info('RpaView', '[wechat_mp cover] entry=IN-PAGE(' + String(byText.how || '') + ')')
  }
  if (!opened) return { ok: false, detail: 'entry-not-found', baseline: baselineImg }

  await host._sleep(COVER_OPEN_SETTLE_MS)

  // 2) 菜单项「从图片库选择 / 上传图片」
  const menu = await safeExec(win, openCoverMenuScript(), { ok: false })
  if (menu && menu.ok === true) log.info('RpaView', '[wechat_mp cover] menu=' + String(menu.how || ''))
  await host._sleep(COVER_OPEN_SETTLE_MS)

  // 3) 注入文件 → 「下一步」→「确认」→ 校验
  const total = Math.max(1, Number(await safeExec(win, coverFileInputCountScript(), 1)) || 1)
  const mimeType = guessMimeType(fileName)
  const evidenceLog = []

  for (let index = 0; index < total; index += 1) {
    const injected = await safeExec(win, injectCoverScript(index, base64, fileName, mimeType), false)
    if (injected !== true && typeof host._setFileInput === 'function') {
      // DataTransfer 被受控组件拒绝时回退 CDP 通道（逐个候选）
      for (const inputSelector of COVER_FILE_INPUT_SELECTORS) {
        try { await host._setFileInput(win, filePath, inputSelector); break } catch (_) { /* 下一个候选 */ }
      }
    }
    await host._sleep(COVER_OPEN_SETTLE_MS)

    // 上传后通常进入裁剪页：点「下一步」→「确认」，最多 COVER_CONFIRM_STEPS 次
    for (let step = 0; step < COVER_CONFIRM_STEPS; step += 1) {
      const label = await clickCoverNext(win)
      if (!label) break
      log.info('RpaView', '[wechat_mp cover] clicked "' + label + '" step=' + step)
      await host._sleep(COVER_CROP_SETTLE_MS)
      const state = await readCoverState(win)
      const evidence = isCoverApplied(state, baselineImg)
      if (evidence) return coverApplied(index, evidence, state, baselineImg)
      evidenceLog.push('step:' + step)
    }

    // 无裁剪步骤的版本：直接轮询生效状态
    for (let round = 0; round < COVER_POLL_ROUNDS; round += 1) {
      await host._sleep(COVER_POLL_INTERVAL_MS)
      const state = await readCoverState(win)
      const evidence = isCoverApplied(state, baselineImg)
      if (evidence) return coverApplied(index, evidence, state, baselineImg)
      evidenceLog.push('poll:' + round)
    }
    log.warn('RpaView', '[wechat_mp cover] input#' + index + ' 注入后未取得生效证据（baseline img=' + baselineImg + '）')
  }

  return { ok: false, detail: 'cover-not-applied', baseline: baselineImg, evidence: evidenceLog[evidenceLog.length - 1] || '' }
}

function coverApplied (index, evidence, state, baselineImg) {
  log.info('RpaView', '[wechat_mp cover] OK input#' + index + ' evidence=' + evidence
    + ' hasCdn=' + state.hasCdn + ' bgUsable=' + state.bgUsable + ' img=' + baselineImg + '→' + state.imgCount)
  return { ok: true, detail: 'OK_' + index, baseline: baselineImg, applied: state.imgCount, evidence }
}

/** 失败原因 → 用户可见文案（单行、关键信息在前 40 字内，历史页「失败原因」行直接渲染它） */
function describeCoverFailure (detail, fileName) {
  if (detail === 'not-a-local-file') return '封面图需为本地图片文件（当前是网络地址，DOM 轨道无法直接使用）'
  if (detail === 'not-found') return '封面图文件不存在（' + (fileName || '') + '）'
  if (detail === 'too-large') return '封面图不能超过 2MB'
  if (detail === 'entry-not-found') return '封面入口未找到'
  if (detail === 'read-failed' || detail === 'stat-failed' || detail === 'empty-file') return '封面图文件不可读'
  return '封面图上传未取得生效证据'
}

/**
 * 平台分支调用口：把「进度 + 失败文案」也收在这里，使 `rpa-view-platforms.js`
 * （逐文件行数门禁点名还账、零增长容差）只留两行接线。无封面时 `{ ok: true, skipped: true }`。
 *
 * @returns {Promise<{ok: boolean, skipped?: boolean, error?: string, detail?: string}>}
 */
async function applyWechatMpCover (host, win, coverPath) {
  const filePath = typeof coverPath === 'string' ? coverPath.trim() : ''
  if (!filePath) return { ok: true, skipped: true }
  const result = await uploadWechatMpCover(host, win, filePath)
  if (result.ok) return result
  log.warn('RpaView', 'wechat_mp cover not applied detail=' + result.detail + ' file=' + (result.fileName || '')
    + ' baseline=' + String(result.baseline) + ' evidence=' + String(result.evidence || ''))
  return { ok: false, detail: result.detail, error: '微信公众号' + describeCoverFailure(result.detail, result.fileName) + '，已中止保存' }
}

module.exports = {
  uploadWechatMpCover,
  applyWechatMpCover,
  isCoverApplied,
  describeCoverFailure,
  MAX_COVER_BYTES,
  COVER_ENTRY_SELECTORS,
  COVER_CONTAINER_SELECTORS,
  COVER_PREVIEW_SELECTORS,
  COVER_FILE_INPUT_SELECTORS,
  COVER_NEXT_LABELS,
  MARKER,
}
