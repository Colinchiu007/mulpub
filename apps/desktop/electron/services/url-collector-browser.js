// @ts-check
/**
 * url-collector-browser.js — 采集通道编排（stealth 浏览器 / HTTP 优先回退）
 *
 * 从 url-collector.js 拆出：
 *   1. `collectViaBrowser`：每个 attempt 都**换新 context**（清除上一次验证页写入的
 *      cookie / 指纹状态）→ 导航 → 等正文就绪 → 读 HTML → 判安全验证页；命中则重试，
 *      重试仍是验证页就返回 security_challenge 失败结构 —— 绝不把验证页正文当文章返回。
 *   2. `collectHttpFirst`：百家号 HTTP 优先 —— 直连成功且正文非空即返回；命中验证页 /
 *      正文为空 / 提取失败才回退浏览器（有界重试），避免每次采集都上浏览器。
 *
 * 拆出动机：url-collector.js 已贴着逐文件行数门禁（check-debt-budget 的 500 行红线）
 * 上限，通道生命周期与验证判定放这里，主文件只留装配。Playwright 的 Page 由调用方
 * 以依赖注入方式提供，测试用假 page 即可覆盖（不需要真实浏览器）。
 *
 * 文件位置: apps/desktop/electron/services/url-collector-browser.js
 */
'use strict'

const {
  isVerificationPage,
  securityChallengeFailure,
  SECURITY_CHALLENGE_ERROR,
} = require('./url-collector-antibot')

/**
 * 一次 attempt：新 context → 导航 → 等正文就绪并读 HTML（context 一定关闭）。
 * fetchPage 由调用方注入（内部先做正文就绪条件等待，再读 HTML，见 url-collector-page-wait.js）。
 * @param {{ browser: object, url: string, fetchPage: (page: object) => Promise<string> }} deps
 * @returns {Promise<{ html: string, finalUrl: string }>}
 */
async function fetchOnce ({ browser, url, fetchPage }) {
  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    locale: 'zh-CN',
  })
  try {
    const page = await context.newPage()
    // 知乎等 SPA 持续轮询，networkidle 可能永不满足（30s 超时后仍导航中），
    // 改用 load 事件确保首屏 DOM 就绪，避免 page.content() 在导航中抛
    // "Unable to retrieve content because the page is navigating"。
    await page.goto(url, { waitUntil: 'load', timeout: 30000 })
    return { html: await fetchPage(page), finalUrl: String(page.url ? page.url() : url) || url }
  } finally {
    await context.close()
  }
}

/**
 * 浏览器采集：按最终 URL + title + HTML 判验证页，命中则换新 context 重试（有界）。
 * 解析阶段（_parseHtml）同样会判验证页：命中同样按「验证页」重试/失败，不再返回正文。
 *
 * @param {{
 *   getBrowser: () => Promise<object>,
 *   parseHtml: (html: string, url: string) => object,
 *   log: { notify: Function },
 *   fetchPage: (page: object) => Promise<string>,
 * }} deps
 * @param {string} url
 * @param {number} [maxAttempts] - 最大 attempt 数（有界重试，默认 2）
 * @returns {Promise<object>} 采集结果（成功结构，或 security_challenge 失败结构）
 */
async function collectViaBrowser (deps, url, maxAttempts = 2) {
  const browser = await deps.getBrowser()
  const attempts = Math.max(1, Math.min(Number(maxAttempts) || 1, 5))
  for (let attempt = 1; attempt <= attempts; attempt++) {
    const { html, finalUrl } = await fetchOnce({
      browser,
      url,
      fetchPage: deps.fetchPage,
    })
    const challenge = isVerificationPage({ url: finalUrl, html })
    const parsed = challenge ? null : deps.parseHtml(html, finalUrl || url)
    if (parsed && parsed.reason !== 'security_challenge') return parsed
    deps.log.notify('url-collect', 'collect-challenge', {
      level: 'WARN',
      params: { url, finalUrl, attempt, maxAttempts: attempts },
    })
  }
  deps.log.notify('url-collect', 'collect-challenge-exhausted', {
    level: 'ERROR',
    params: { url, maxAttempts: attempts },
    error: SECURITY_CHALLENGE_ERROR,
  })
  return securityChallengeFailure()
}

/**
 * HTTP 优先通道（百家号）：直连成功且正文非空即返回；命中验证页 / 正文为空 /
 * 提取失败（抛错）才回退 stealth 浏览器（有界重试 ≤2 次）。
 * @param {{ http: () => Promise<object>, browser: () => Promise<object>, log: { notify: Function } }} deps
 * @param {string} url
 * @returns {Promise<object>}
 */
async function collectHttpFirst ({ http, browser, log }, url) {
  const result = await http().catch((e) => ({
    success: false,
    error: e && e.message ? e.message : String(e),
  }))
  if (result && result.success && String(result.content || '').trim()) return result
  log.notify('url-collect', 'collect-http-first-fallback', {
    level: 'WARN',
    params: { url, reason: (result && (result.reason || result.error)) || 'empty_content' },
  })
  return browser()
}

module.exports = { collectViaBrowser, collectHttpFirst }
