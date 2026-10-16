// @ts-check
/**
 * wechat-mp-draft-mediaid.js — 公众号 DOM 轨「草稿保存后 mediaId 采集」与失败文案
 * （wxmp-draft-mediaid-fix，2026-10-12）
 *
 * ## 修的是什么
 *
 * 用户报障：发布图文到公众号报
 *   「微信公众号草稿保存结果无法验证：缺少媒体 ID（平台提示：从公众平台上传的非转载视频才能设置弹幕功能）」
 *
 * 两层原因，一层真因一层放大镜：
 *
 * ① **采集通道漏了一条（真因）**：保存成功后 mediaId 只从两处取——
 *    URL 的 `appmsgid`、保存 XHR 响应 URL 的 `appmsgid`。公众号新版后台
 *    （`appmsg_edit_v2` + `isNew=1`）保存草稿后 **URL 不跳转**（仍是编辑页），
 *    响应 URL 也不带 `appmsgid`；它只在**响应体 JSON** 里（`appMsgId`，
 *    与 API 轨 `wechat-mp/draft.js` 的 `createDraft` 同一字段名）。
 *    于是 `mediaId` 恒为 null —— 草稿其实存进去了，却被判「无法验证」。
 *
 * ② **「平台提示」读到了隐藏节点（放大镜）**：`readEditorToast` 用 `innerText`
 *    读 `.js_tips` / `[class*="tips"]` 等候选，而 `innerText` 对
 *    `display:none` / 离屏节点**照样返回文本**（2026-10-12 实测取证）。
 *    编辑器里那些与本次失败无关的常驻说明（如视频弹幕规则）因此被当成
 *    「平台提示」拼进 error，把一条**可自愈的重试类问题**伪装成平台业务错误。
 *
 * ## 判据
 *
 * - mediaId 三条通道，按证据强度降序：URL > XHR 响应 URL > **XHR 响应体**；
 * - 响应体通道复用 `rpa-publish-id-extract.js` 的 `normalizePublishId`
 *   （同一套形态校验：拒空、拒 `task_` 前缀、拒导航词、限长）——不另造第二份判据；
 * - 「平台提示」必须来自**可见**节点（`offsetParent || getClientRects().length`）；
 * - 三条通道全空 ⇒ 仍 fail-closed（判据不放宽），但文案必须**可操作**。
 */

const log = require('./logger')

/**
 * 从保存 XHR 响应体提取公众号草稿 ID。
 *
 * 公众号的字段名是 `appMsgId`（响应体顶层，偶见 `app_msg_id`），
 * 与 `packages/api-publish-engine/src/adapters/wechat-mp/draft.js` 的
 * `createDraft` 同口径。先按显式键名取（精确、可断言），取不到再走通用
 * publish-id 提取作为兜底。
 *
 * @param {string} body 响应体文本
 * @returns {string} 草稿 ID；取不到返回空串
 */
function extractAppMsgIdFromBody (body) {
  const raw = String(body == null ? '' : body).trim()
  if (!raw) return ''
  let parsed
  try { parsed = JSON.parse(raw) } catch (_) { /* 非 JSON：下方走通用提取兜底 */ }
  if (parsed && typeof parsed === 'object') {
    // 顶层优先：公众号把 appMsgId 放在根级；base_resp 里不放业务 ID
    for (const key of ['appMsgId', 'app_msg_id', 'appmsgid', 'appmsg_id']) {
      const v = parsed[key]
      if (v !== undefined && v !== null && String(v).trim() !== '' && String(v).trim() !== '0') {
        return String(v).trim()
      }
    }
  }
  // 非 JSON / 键名不在表内：走通用提取（与其它平台同一份实现）
  try {
    const { extractPublishIdsFromResponseBody, normalizePublishId } = require('./rpa-publish-id-extract')
    const ids = extractPublishIdsFromResponseBody(raw, { endpoint: 'https://mp.weixin.qq.com/cgi-bin/operate_appmsg' })
    for (const id of ids) {
      const normalized = normalizePublishId(id)
      if (normalized && /^\d{4,}$/.test(normalized)) return normalized
    }
  } catch (_) { /* 提取模块不可用时静默降级，由其它通道兜底 */ }
  return ''
}

/** 保存草稿的按钮候选（与调用方共用，抽成常量便于单测断言）。 */
const SAVE_BUTTON_SELECTOR = 'a#js_sync_save, a[data-action="save"], .weui-desktop-btn_primary:has-text("保存草稿"), .weui-desktop-btn_primary:has-text("保存"), button:has-text("保存草稿"), button:has-text("保存"), [class*="save_draft"], [class*="saveDraft"]'

/** 保存成功轮询条件：URL 出现 appmsgid，或页面出现「保存成功 / 已保存」。 */
const SAVE_SUCCESS_CONDITION = 'function(){' +
  'var u = location.href || "";' +
  'if (/appmsgid=\\d+/.test(u)) return true;' +
  'var t = (document.body && document.body.innerText) || "";' +
  'return /保存成功|已保存/.test(t);' +
'}'

/**
 * 保存 XHR 响应拦截脚本（wxmp-save-body-intercept，2026-10-16）。
 *
 * 为什么需要它：CDP `Network.getResponseBody`（rpa-view-helpers.js 的真实契约修复）
 * 依赖 debugger attach，页面销毁/attach 冲突时可能拿不到 body；这条**页面内拦截**
 * 是不依赖 CDP 的第二保险——保存点击前注入，包住 XHR 与 fetch 两条通道，把匹配
 * 保存端点的响应 url+body 存进 `window.__mpSaveResponses`，保存后主进程回读提取。
 *
 * 三条不可破：
 *  ① 匹配判据与 SAVE_RESPONSE_PATTERNS 同源（operate_appmsg / appmsg/save / oper=save）；
 *  ② 拦截必须**透传**（返回原响应，不得吞掉页面自身逻辑）；
 *  ③ 只存最近 5 条、每条 body 截断 200KB，防长会话内存堆积。
 */
const XHR_INTERCEPT_SCRIPT = '(function(){' +
  'if(window.__mpSaveIntercepted)return "already";window.__mpSaveIntercepted=true;' +
  'window.__mpSaveResponses=[];' +
  'var PATTERNS=["operate_appmsg","appmsg/save","oper=save"];' +
  'function hit(u){if(!u)return false;for(var i=0;i<PATTERNS.length;i++){if(String(u).indexOf(PATTERNS[i])>=0)return true}return false}' +
  'function record(u,b){try{window.__mpSaveResponses.push({url:String(u||""),body:String(b||"").slice(0,200*1024)});' +
  'if(window.__mpSaveResponses.length>5)window.__mpSaveResponses.shift()}catch(e){}}' +
  // fetch 通道：克隆响应读 text，再放行原响应
  'var of=window.fetch;' +
  'if(typeof of==="function"){window.fetch=function(){' +
  'var u=(arguments[0]&&arguments[0].url)||arguments[0];' +
  'return of.apply(this,arguments).then(function(r){' +
  'if(hit(r.url||u)){try{var c=r.clone();c.text().then(function(t){record(r.url||u,t)}).catch(function(){})}catch(e){}}' +
  'return r})}}' +
  // XHR 通道：open 记 url，load 事件读 responseText
  'var oo=XMLHttpRequest.prototype.open;' +
  'XMLHttpRequest.prototype.open=function(m,u){this.__mpUrl=u;return oo.apply(this,arguments)};' +
  'var os=XMLHttpRequest.prototype.send;' +
  'XMLHttpRequest.prototype.send=function(){' +
  'var self=this;' +
  'this.addEventListener("load",function(){if(hit(self.__mpUrl)){try{record(self.__mpUrl,self.responseText)}catch(e){}}});' +
  'return os.apply(this,arguments)};' +
  'return "ok"})()'

/** 从页面拦截结果提取 appMsgId：遍历 __mpSaveResponses，逐条走 extractAppMsgIdFromBody。 */
const READ_INTERCEPTED_SCRIPT = '(function(){' +
  'var arr=window.__mpSaveResponses||[];' +
  'return JSON.stringify(arr.map(function(r){return {url:r.url||"",body:(r.body||"").slice(0,4000)}}))})()'

/** 保存请求 URL 特征（用于响应体通道的日志判读）。 */
const SAVE_RESPONSE_PATTERNS = ['operate_appmsg', 'appmsg/save', 'oper=save']

/** 拦截结果 url 也按这套特征匹配（同一判据，不另造第二份）。 */
function isSaveResponseUrl (url) {
  const u = String(url || '')
  return SAVE_RESPONSE_PATTERNS.some(p => u.includes(p))
}

/**
 * 平台提示读取脚本：只收**可见**提示节点的文本。
 *
 * 为什么必须判可见：`innerText` 对 `display:none` / 离屏节点照样返回文本
 * （2026-10-12 实测），编辑器里的常驻说明会被误当成「平台提示」。
 * 判据用 `offsetParent || getClientRects().length > 0`：前者对 `position:fixed`
 * 为 null（Toast 常是 fixed），故两者取或。
 *
 * @param {string[]} selectors 候选选择器
 */
function buildVisibleToastScript (selectors) {
  return '(function(){var sels=' + JSON.stringify(selectors) + ';' +
    'for(var i=0;i<sels.length;i++){var els=document.querySelectorAll(sels[i]);' +
    'for(var j=els.length-1;j>=0;j--){var el=els[j];' +
    'var visible=false;' +
    'try{visible=!!el.offsetParent||el.getClientRects().length>0}catch(e){visible=false}' +
    'if(!visible)continue;' +
    'var t=(el.innerText||"").trim();if(t)return t.slice(0,200)}}' +
    'return ""})()'
}

/**
 * 点「保存草稿」并采集 mediaId。
 *
 * 四条采集通道（按证据强度降序）：
 *   ① 保存后页面 URL 的 `appmsgid`
 *   ② 保存 XHR **响应 URL** 的 `appmsgid`
 *   ③ 保存 XHR **响应体** 的 `appMsgId`（两条来源：CDP getResponseBody 真实契约 + 页面内拦截）
 *   ④ 页面内拦截结果（`window.__mpSaveResponses`，不依赖 debugger，第二保险）
 *
 * @param {object} host RpaViewManager 混入对象（`_click` / `_waitForCondition` / `_waitForResponse` / `_sleep`）
 * @param {object} win BrowserWindow
 * @returns {Promise<{ok: boolean, mediaId?: string, saved?: boolean, detail?: string, error?: string}>}
 */
async function saveWechatMpDraft (host, win) {
  // 保存前注入页面内拦截（幂等：重复注入返回 "already"，不重置既有缓存）
  try {
    await win.webContents.executeJavaScript(XHR_INTERCEPT_SCRIPT)
  } catch (e) {
    log.warn('RpaView', '[wechat_mp] save intercept inject failed: ' + e.message)
  }
  const saveResponse = host._waitForResponse(win, SAVE_RESPONSE_PATTERNS, 30000)
  const saveClicked = await host._click(win, SAVE_BUTTON_SELECTOR)
  if (!saveClicked) {
    log.warn('RpaView', '[wechat_mp] save draft failed: save button unavailable url=' + win.webContents.getURL())
    return { ok: false, detail: 'save-button-unavailable', error: '微信公众号草稿保存失败：保存按钮不可用' }
  }
  const saved = await host._waitForCondition(win, SAVE_SUCCESS_CONDITION, 30000, 800)
  const saveResp = await saveResponse
  const finalUrl = String(win.webContents.getURL() || '')

  // 通道 ①：URL
  let mediaId = ''
  const urlMatch = finalUrl.match(/appmsgid=(\d+)/)
  if (urlMatch) mediaId = urlMatch[1]

  // 通道 ②：XHR 响应 URL
  if (!mediaId && saveResp && saveResp.url) {
    const respMatch = String(saveResp.url).match(/appmsgid=(\d+)/)
    if (respMatch) mediaId = respMatch[1]
  }

  // 通道 ③：XHR 响应体（新版后台 URL 不跳转时的唯一通道）
  if (!mediaId && saveResp) {
    mediaId = extractAppMsgIdFromBody(saveResp.body)
    if (mediaId) {
      log.info('RpaView', '[wechat_mp] mediaId from save response body appMsgId=' + mediaId
        + ' (url 未跳转，走响应体通道)')
    }
  }

  // 通道 ④：页面内拦截结果（wxmp-save-body-intercept，不依赖 debugger 的第二保险）
  if (!mediaId) {
    try {
      const raw = await win.webContents.executeJavaScript(READ_INTERCEPTED_SCRIPT)
      const list = JSON.parse(String(raw || '[]'))
      for (const item of Array.isArray(list) ? list : []) {
        if (!isSaveResponseUrl(item && item.url)) continue
        const id = extractAppMsgIdFromBody(item && item.body)
        if (id) {
          mediaId = id
          log.info('RpaView', '[wechat_mp] mediaId from in-page intercept appMsgId=' + mediaId
            + ' (CDP body 不可用，走页面内拦截通道)')
          break
        }
      }
    } catch (_) { /* 拦截不可用时静默降级，老通道仍可用 */ }
  }

  if (!mediaId) {
    log.warn('RpaView', '[wechat_mp] save done without mediaId (saved=' + saved + ' url=' + finalUrl
      + ' xhr=' + (saveResp ? String(saveResp.statusCode || '') : 'none') + ')')
  }
  return { ok: true, mediaId, saved: Boolean(saved) }
}

/**
 * 提示文本是否像「真实错误」：不含错误信号关键词的可见文案
 * （如编辑器常驻设置项「水印：xxx」、说明性文字）一律视为**非错误内容**，
 * 不得拼进失败文案——那是把可自愈问题伪装成平台业务错误的第二例
 * （2026-10-16：「平台提示：水印：数字生命丘丘」）。
 *
 * 判据（保守白名单，宁缺勿滥）：错误/失败/异常/警告/重试/请/无法/不能/超时/繁忙/
 * 网络/保护/限制/原创/审核/敏感/违规/超过/不足/缺少/无效/过期/失效。
 * 平台真实错误提示几乎必然含其中之一；不含时按「非错误内容」丢弃（用兜底文案）。
 */
const ERROR_SIGNAL_RE = /错误|失败|异常|警告|重试|请|无法|不能|超时|繁忙|网络|保护|限制|原创|审核|敏感|违规|超过|不足|缺少|无效|过期|失效/

function looksLikeErrorText (text) {
  return ERROR_SIGNAL_RE.test(String(text == null ? '' : text).trim())
}

/**
 * 保存失败文案：把「平台原文」与「我们自己的判据」分开呈现。
 *
 * 四条不可破：
 *  ① 原创性（64714）/ 群发保护两类已知业务错误 → 直接换成可操作文案（既有行为，不回归）；
 *  ② 其它原文 → 原样带上，但**必须同时给出用户下一步**（去哪看、能不能重试）；
 *  ③ 无原文 → 只用兜底文案，不得编造平台提示；
 *  ④ **原文必须像错误**（looksLikeErrorText）——可见但非错误的常驻设置文案
 *     （水印标签、说明文字）不得进 error 文案（wxmp-save-body-intercept 第二例）。
 *
 * @param {string} raw 平台/页面可见提示（可为空）
 * @param {string} [fallback] 无法识别时的兜底文案
 * @returns {string}
 */
function describeSaveFailure (raw, fallback) {
  const text = String(raw == null ? '' : raw).trim()
  if (/64714|原创/.test(text)) {
    return '文章保存失败：请检查文章原创性（该内容可能已被其他账号声明原创）'
  }
  if (/protect_status|群发保护|风险操作/.test(text)) {
    return '发布失败：账号开启了群发保护。请前往「微信公众平台 → 设置与开发 → 安全中心 → 风险操作保护」，关闭「群发消息」保护后重试'
  }
  const fb = fallback || '微信公众号草稿保存结果无法验证：缺少媒体 ID'
  // ④ 错误信号守卫：非错误内容一律退回兜底文案（关键信息仍在前 40 字内）
  if (!text || !looksLikeErrorText(text)) return fb + '，请稍后重试；若反复失败请到公众号后台草稿箱核对'
  return fb + '（平台提示：' + text.slice(0, 120) + '），请稍后重试；若反复失败请到公众号后台草稿箱核对'
}

module.exports = {
  SAVE_BUTTON_SELECTOR,
  SAVE_SUCCESS_CONDITION,
  SAVE_RESPONSE_PATTERNS,
  XHR_INTERCEPT_SCRIPT,
  READ_INTERCEPTED_SCRIPT,
  buildVisibleToastScript,
  extractAppMsgIdFromBody,
  isSaveResponseUrl,
  looksLikeErrorText,
  saveWechatMpDraft,
  describeSaveFailure,
}
