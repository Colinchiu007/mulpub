// @ts-check
/**
 * wechat-mp-dom-guard.js — 微信公众号 DOM 轨的两处补强（PRD §F5 / §F6 / §T 组）
 *
 * 为什么要独立成文件：`rpa-view-platforms.js` 是被行数门禁**点名还账**的文件
 * （targets=1476，当前 1469），只允许极少量接线；逻辑放这里，那边只留几行调用。
 *
 * 两条纪律：
 *  ① 群发保护预检只在**本次要群发**时执行，且预检自身失败一律**放行**（fail-open）：
 *     它是增益而不是正确性依据；把它变成硬阻断会让「未开通安全中心」的账号无法发布。
 *  ② 原文链接是**非关键字段**：填不上必须静默跳过，绝不允许为它让发布失败。
 */

/** 群发保护的可操作文案（与 API 轨同一口径，见 PRD §7.2）。 */
const MASS_SEND_PROTECTED_MESSAGE = '发布失败：账号开启了群发保护。请前往「微信公众平台 → 设置与开发 → 安全中心 → 风险操作保护」，关闭「群发消息」保护后重试'

const PROTECTION_PATH = '/cgi-bin/safecenterstatus?action=protect&t=setting/safe-protect&lang=zh_CN'

/**
 * 「原文链接」输入框候选选择器。
 * ⚠️ 真机未取证（本机无可用公众号会话），因此这是**候选表**而非定论；
 *    全部未命中时按 T3 静默跳过，不影响发布。
 */
const SOURCE_URL_SELECTORS = [
  'input#js_source_url',
  'input[name="sourceurl"]',
  'input.js_source_url',
  '.js_original_url input',
  '.original_url input',
  'input[placeholder*="原文链接"]',
  'input[placeholder*="原文"]',
]

const TOAST_SELECTORS = [
  '.weui-desktop-toast',
  '.weui-desktop-msgbox',
  '.js_tips',
  '[class*="toast"]',
  '[class*="Toast"]',
  '[class*="tips"]',
]

function isHttpUrl (v) {
  return /^https?:\/\//i.test(String(v == null ? '' : v))
}

/** 从当前页面 URL 提取 token（公众号后台所有 cgi-bin 页面都要求会话 token）。 */
function pickTokenFromUrl (url) {
  const m = /token=(\d+)/.exec(String(url || ''))
  return m ? m[1] : ''
}

/**
 * 群发保护判据：页面里出现 `wx.cgiData` **且** `"protect_status":1` 才算开启
 * （安全中心未开通的账号返回的页面不含 `wx.cgiData` ⇒ 放行）。
 */
function parseProtectionHtml (html) {
  const s = String(html == null ? '' : html)
  if (!s.includes('wx.cgiData')) return false
  return /"protect_status"\s*:\s*1/.test(s)
}

/**
 * 群发前置预检。
 * @param {{webContents: {getURL: Function, executeJavaScript: Function}}} win
 * @param {{massSend?: boolean}} article
 * @returns {Promise<{ok: boolean, skipped?: boolean, degraded?: boolean, reason?: string, code?: string, error?: string}>}
 */
async function checkMassSendProtection (win, article) {
  const a = article || {}
  if (!a.massSend) return { ok: true, skipped: true }
  const currentUrl = win && win.webContents && typeof win.webContents.getURL === 'function' ? win.webContents.getURL() : ''
  const token = pickTokenFromUrl(currentUrl)
  if (!token) return { ok: true, degraded: true, reason: 'no-token' }
  // 同源 fetch：cookie 由渲染上下文自动携带，不必（也不该）在主进程搬运凭证
  const script = 'fetch(' + JSON.stringify(PROTECTION_PATH + '&token=' + token) +
    ',{credentials:"include"}).then(function(r){return r.text()}).catch(function(){return ""})'
  let html
  try {
    html = await win.webContents.executeJavaScript(script)
  } catch (e) {
    // T2：预检失败放行（fail-open），真正的失败仍由群发失败路径报告
    return { ok: true, degraded: true, reason: (e && e.message) || 'probe-error' }
  }
  if (!parseProtectionHtml(html)) return { ok: true }
  return { ok: false, code: 'mass-send-protected', error: MASS_SEND_PROTECTED_MESSAGE }
}

/**
 * 原文链接尽力透传（T3/T4）。
 * @returns {Promise<{filled: boolean, selector?: string, reason?: string}>}
 */
async function fillSourceUrl (win, url) {
  if (!isHttpUrl(url)) return { filled: false, reason: 'not-http' }
  const script = '(function(){var sels=' + JSON.stringify(SOURCE_URL_SELECTORS) +
    ';for(var i=0;i<sels.length;i++){var el=document.querySelector(sels[i]);' +
    'if(!el)continue;var tag=(el.tagName||"").toUpperCase();if(tag!=="INPUT"&&tag!=="TEXTAREA")continue;' +
    'try{el.focus()}catch(e){}el.value=' + JSON.stringify(String(url)) + ';' +
    'el.dispatchEvent(new Event("input",{bubbles:true}));' +
    'el.dispatchEvent(new Event("change",{bubbles:true}));return sels[i]}return ""})()'
  try {
    const hit = await win.webContents.executeJavaScript(script)
    return hit ? { filled: true, selector: String(hit) } : { filled: false, reason: 'no-selector' }
  } catch (e) {
    return { filled: false, reason: 'error', error: (e && e.message) || '' }
  }
}

/** 读编辑器当前可见提示（失败时用于把平台原文带给用户）。 */
async function readEditorToast (win) {
  const script = '(function(){var sels=' + JSON.stringify(TOAST_SELECTORS) +
    ';for(var i=0;i<sels.length;i++){var els=document.querySelectorAll(sels[i]);' +
    'for(var j=els.length-1;j>=0;j--){var t=(els[j].innerText||"").trim();if(t)return t.slice(0,200)}}return ""})()'
  try {
    const t = await win.webContents.executeJavaScript(script)
    return String(t == null ? '' : t)
  } catch (e) {
    return ''
  }
}

/**
 * 草稿保存失败文案映射（PRD §F7）。
 * @param {string} raw 平台/页面原文（可为空）
 * @param {string} [fallback] 无法识别时的兜底文案
 */
function mapSaveFailureMessage (raw, fallback) {
  const text = String(raw == null ? '' : raw)
  if (/64714|原创/.test(text)) {
    return '文章保存失败：请检查文章原创性（该内容可能已被其他账号声明原创）'
  }
  if (/protect_status|群发保护|风险操作/.test(text)) return MASS_SEND_PROTECTED_MESSAGE
  const fb = fallback || '微信公众号草稿保存失败'
  return text ? fb + '（平台提示：' + text.slice(0, 120) + '）' : fb
}

module.exports = {
  MASS_SEND_PROTECTED_MESSAGE,
  PROTECTION_PATH,
  SOURCE_URL_SELECTORS,
  TOAST_SELECTORS,
  isHttpUrl,
  pickTokenFromUrl,
  parseProtectionHtml,
  checkMassSendProtection,
  fillSourceUrl,
  readEditorToast,
  mapSaveFailureMessage,
}
