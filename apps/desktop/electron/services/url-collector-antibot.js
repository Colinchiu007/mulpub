// @ts-check
/**
 * url-collector-antibot.js — 反爬安全验证页判定 / 采集路由 / 浏览器请求头（纯函数）
 *
 * 背景（2026-10-18 现场）：百家号单篇 URL 采集把「百度安全验证」滑块页当正文返回，
 * 用户侧表现为「采集成功」但正文只有一对验证文案。现场保存的 CHALLENGE 页
 * （D:\Temp\baijiahao-probe-out\*-CHALLENGE.html）解析正文均为 114 字且逐字一致：
 *   网络不给力，请稍后重试 返回首页 问题反馈 百度安全验证 请完成下方验证后继续操作
 *   正在验证... 验证通过 图片未转正 网络不给力，请刷新重试 加载中... 图片由AI生成
 *   拖动左侧滑块使图片为正 扫码验证| 意见反馈 |刷新
 * 同批 OK 页则一个标记都不含（正文 4000+ 字）。
 *
 * 判定取舍 —— **宁漏不误杀**：
 *   1. 结构性信号当场判真：最终 URL 落在 wappass 验证端点 / <title> 含「百度安全验证」；
 *   2. 正文只认强标记：≥2 个强标记，或「1 个强标记且正文 < SHORT_TEXT_LENGTH_LIMIT」；
 *   3. 弱标记（网络不给力 / 正在验证 / 验证通过 / 加载中 / 图片由AI生成）单独出现**不得**判真。
 *      误杀反例（回归锁在 url-collector-antibot.test.js）：《一次宽带 DNS 故障排查记录》这种
 *      合法长文里写着「页面老是提示『网络不给力，请刷新重试』」，绝不能判成验证页。
 *
 * 依赖约束：**不 require 任何第三方模块**（cheerio / axios / playwright 都不允许）——
 * 渲染层 src/utils/collected-content-guard.js 与本模块判据同源，两端必须能各自独立加载；
 * 同一输入两端必须同判（回归锁见 src/utils/collected-content-guard.test.js）。
 *
 * 文件位置: apps/desktop/electron/services/url-collector-antibot.js
 */
'use strict'

/** 强文本标记：滑块验证页的专属文案，合法文章正文不会（同时）出现 */
const STRONG_TEXT_MARKERS = Object.freeze([
  '请完成下方验证后继续操作',
  '拖动左侧滑块使图片为正',
  '图片未转正',
])

/**
 * 强文本正则：实测页脚把「扫码验证| 意见反馈 |刷新」拼成一行。
 * 这里整体算**一个**强标记（不再把「扫码验证」单列成标记，否则同一处页脚会被重复计数）
 */
const STRONG_TEXT_PATTERNS = Object.freeze([
  /扫码验证\s*[|｜]\s*意见反馈\s*[|｜]\s*刷新/,
])

/** 弱标记：可出现在正常页面（用户抱怨语 / 加载态 / 正文插图说明），单独出现不得判真 */
const WEAK_TEXT_MARKERS = Object.freeze([
  '网络不给力，请刷新重试',
  '正在验证',
  '验证通过',
  '加载中',
  '图片由AI生成',
])

/** 验证页 <title> 标记（实测 CHALLENGE 页 title 恰为这四个字） */
const VERIFICATION_TITLE_MARKER = '百度安全验证'
/** 百度验证页最终 URL（实测重定向落点 https://wappass.baidu.com/static/captcha/tuxing.html*） */
const CAPTCHA_URL_PATTERN = /wappass\.baidu\.com\/static\/captcha\//i
/** 强标记数量阈值：≥2 判真；1 个只有在正文很短时才算（宁漏不误杀） */
const MIN_STRONG_MARKERS = 2
const SHORT_TEXT_LENGTH_LIMIT = 300

/** 失败结构文案：classifyCollectError 靠「安全验证」命中 security_challenge */
const SECURITY_CHALLENGE_ERROR =
  '目标站点返回安全验证页（百度安全验证），请稍后再试或先在浏览器中完成验证'

/** 反爬站点（浏览器优先）：裸 HTTP 直连触发风控/403，必须走 stealth 浏览器 */
const ANTI_CRAWL_HOSTNAMES = Object.freeze(new Set([
  'zhuanlan.zhihu.com',
  'www.zhihu.com',
  'zhihu.com',
]))

/** HTTP 优先站点（百家号）：先轻量直连，命中验证页/正文为空/提取失败才回退 stealth 浏览器 */
const NODE_HTTP_FIRST_HOSTNAMES = Object.freeze(new Set([
  'baijiahao.baidu.com',
  'mbd.baidu.com',
]))

/** 归一化空白：判据与「正文长度 < 300」都基于归一化文本 */
function normalizeText (v) {
  return String(v == null ? '' : v).replace(/\s+/g, ' ').trim()
}

/**
 * HTML → 纯文本（无依赖实现）。
 * 剔除 script/style/noscript：合法页面内联脚本可能出现「正在验证」等词，不能当正文证据。
 * @param {string|null|undefined} html
 * @returns {string}
 */
function htmlToText (html) {
  const s = String(html == null ? '' : html)
  if (!s) return ''
  return normalizeText(
    s
      .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<[^>]+>/g, ' ')
      .replace(/&nbsp;/gi, ' ')
      .replace(/&lt;/gi, '<')
      .replace(/&gt;/gi, '>')
      .replace(/&quot;/gi, '"')
      .replace(/&#39;/gi, "'")
      .replace(/&amp;/gi, '&'),
  )
}

/**
 * 从 HTML 取 <title> 文本。
 * @param {string|null|undefined} html
 * @returns {string}
 */
function extractTitle (html) {
  const m = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(String(html == null ? '' : html))
  return m ? normalizeText(m[1]) : ''
}

/**
 * 验证页判定明细（供日志/测试观察判据命中情况）。
 * @param {{ url?: string|null, title?: string|null, html?: string|null, text?: string|null }} [input]
 * @returns {{ verification: boolean, urlHit: boolean, titleHit: boolean, textHits: string[], weakHits: string[], textLength: number }}
 */
function evaluateVerification ({ url, title, html, text } = {}) {
  const finalUrl = String(url == null ? '' : url)
  // title 未显式传入时从 HTML 提取（浏览器通道只传 { url, html }，title 信号不能丢）
  const pageTitle = normalizeText(title) || extractTitle(html)
  const bodyText = normalizeText(text) ? normalizeText(text) : htmlToText(html)

  const urlHit = CAPTCHA_URL_PATTERN.test(finalUrl)
  const titleHit = pageTitle.includes(VERIFICATION_TITLE_MARKER)
  const textHits = []
  for (const marker of STRONG_TEXT_MARKERS) {
    if (bodyText.includes(marker)) textHits.push(marker)
  }
  for (const pattern of STRONG_TEXT_PATTERNS) {
    if (pattern.test(bodyText)) textHits.push(pattern.source)
  }
  const weakHits = WEAK_TEXT_MARKERS.filter((m) => bodyText.includes(m))

  const verification = urlHit || titleHit ||
    textHits.length >= MIN_STRONG_MARKERS ||
    (textHits.length === 1 && bodyText.length < SHORT_TEXT_LENGTH_LIMIT)
  return { verification, urlHit, titleHit, textHits, weakHits, textLength: bodyText.length }
}

/**
 * 是否安全验证页（主判据）。
 * @param {{ url?: string|null, title?: string|null, html?: string|null, text?: string|null }} [input]
 * @returns {boolean}
 */
function isVerificationPage (input) {
  return evaluateVerification(input).verification
}

/**
 * 仅凭 HTML（+ 可选最终 URL）判验证页：title 从 HTML 提取，正文从 HTML 文本提取。
 * @param {string|null|undefined} html
 * @param {string|null|undefined} [finalUrl]
 * @returns {boolean}
 */
function isVerificationHtml (html, finalUrl) {
  return isVerificationPage({ url: finalUrl, title: extractTitle(html), html })
}

/**
 * 渲染层同源判据：已提取的 { title, content }（与主进程判据同源，两端必须同判）。
 * @param {{ title?: string|null, content?: string|null }} [input]
 * @returns {boolean}
 */
function isVerificationContent ({ title, content } = {}) {
  return isVerificationPage({ title, text: content })
}

/**
 * 验证页失败结构：reason=security_challenge 供渲染层 classifyCollectError 命中。
 * @returns {{ success: false, error: string, reason: 'security_challenge' }}
 */
function securityChallengeFailure () {
  return { success: false, error: SECURITY_CHALLENGE_ERROR, reason: 'security_challenge' }
}

/**
 * 完整浏览器请求头 —— **防御性加固**，不是本次挑战的已证原因。
 *
 * 证据口径（2026-10-18 校正，勿再写成「UA 是根因」）：
 *   - 普通 HTTP 通道探测百家号文章页 20/20 成功，与 UA 完整/截断**无关**；
 *     截断 UA 4/4 成功、完整 UA 16/16 成功 —— 所以 HTTP 优先通道是成立的。
 *   - 挑战只出现在 headless 浏览器通道，且是**概率性**的：同 URL、同 UA 覆盖逻辑下，
 *     6 份 stealth 落盘 HTML 里 desktop 2/3 挑战、mobile 1/3 挑战。
 *   - 因此修复靠「HTTP 优先 + 验证页识别 fail-closed + 有界重试」，
 *     不能宣称某个请求头能永远规避；这里保留完整头 + Sec-Fetch-* 只为降低
 *     被识别为脚本的概率（成本为零的加固）。
 * @returns {Record<string, string>}
 */
function buildBrowserHeaders () {
  return {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,image/apng,*/*;q=0.8',
    'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Upgrade-Insecure-Requests': '1',
    'Sec-Fetch-Dest': 'document',
    'Sec-Fetch-Mode': 'navigate',
    'Sec-Fetch-Site': 'none',
    'Sec-Fetch-User': '?1',
    'Cache-Control': 'max-age=0',
  }
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isAntiCrawlHost (hostname) {
  return ANTI_CRAWL_HOSTNAMES.has(String(hostname || '').toLowerCase())
}

/**
 * @param {string} hostname
 * @returns {boolean}
 */
function isHttpFirstHost (hostname) {
  return NODE_HTTP_FIRST_HOSTNAMES.has(String(hostname || '').toLowerCase())
}

/**
 * 采集路由：browser（浏览器优先）/ http-first（HTTP 优先）/ http（其余）。
 * @param {string} hostname
 * @returns {'browser'|'http-first'|'http'}
 */
function routeFor (hostname) {
  if (isAntiCrawlHost(hostname)) return 'browser'
  if (isHttpFirstHost(hostname)) return 'http-first'
  return 'http'
}

module.exports = {
  STRONG_TEXT_MARKERS,
  STRONG_TEXT_PATTERNS,
  WEAK_TEXT_MARKERS,
  VERIFICATION_TITLE_MARKER,
  CAPTCHA_URL_PATTERN,
  MIN_STRONG_MARKERS,
  SHORT_TEXT_LENGTH_LIMIT,
  SECURITY_CHALLENGE_ERROR,
  ANTI_CRAWL_HOSTNAMES,
  NODE_HTTP_FIRST_HOSTNAMES,
  evaluateVerification,
  isVerificationPage,
  isVerificationHtml,
  isVerificationContent,
  securityChallengeFailure,
  buildBrowserHeaders,
  isAntiCrawlHost,
  isHttpFirstHost,
  routeFor,
}
