// @ts-check
/**
 * URL 采集 —— 浏览器 Page 层等待与容错读取（自 url-collector.js 拆出）
 *
 * 拆分动因：本批把 url-collector.js 的固定盲等改成条件等待后，文件从 488 行涨到
 * 547 行，越过逐文件行数门禁的 500 阈值（check-debt-budget 棘轮 FILES_OVER_500 上升）。
 * 处置口径是「拆文件」而不是「放宽基线」——新代码必须先满足自己立的新门禁。
 *
 * 这里两个职责都只依赖 Playwright Page 对象，与采集策略（限流/熔断/缓存/审计）无关，
 * 因此是内聚的一层：
 *   1. waitForContentReady     —— SPA 正文就绪的条件等待（替代固定 sleep）
 *   2. readPageContentWithRetry —— page.content() 导航竞态的重试读取
 *
 * 文件位置: apps/desktop/electron/services/url-collector-page-wait.js
 */

// SPA 正文就绪的条件等待参数：
//   上限 CONTENT_READY_TIMEOUT_MS，轮询间隔 CONTENT_READY_POLL_MS，
//   命中判据 = readyState 完成 且 候选正文容器（或 body）内文本长度达标。
const CONTENT_READY_TIMEOUT_MS = 10000
const CONTENT_READY_POLL_MS = 250
const CONTENT_MIN_TEXT_LEN = 200
const CONTENT_READY_SELECTORS = Object.freeze([
  'article', 'main', '[class*="article"]', '[class*="content"]',
  '[id*="content"]', '[class*="post"]', '[class*="detail"]',
])
// 无匹配容器时的 body 兜底倍数：长文站点整页文本通常 >= 容器阈值的 20 倍
const BODY_TEXT_MULTIPLIER = 20
// 导航竞态重试的基础退避（毫秒），第 n 次失败后等待 RETRY_BASE_MS * n
const RETRY_BASE_MS = 1500

/**
 * 浏览器内执行的就绪探针。
 *
 * 必须是纯函数：Playwright 会把它序列化后注入页面上下文，闭包引用 Node 侧变量
 * 会静默拿到 undefined，因此阈值与选择器一律经 waitForFunction 的 arg 传入。
 * 函数体内只用 ES2015 语法（目标页为 Chromium，不依赖转译）。
 *
 * @param {{minLen: number, selectors: string[], bodyMultiplier?: number}} opts
 * @returns {boolean}
 */
function contentReadyProbe (opts) {
  if (document.readyState !== 'complete') return false
  let best = 0
  for (let i = 0; i < opts.selectors.length; i++) {
    const nodes = document.querySelectorAll(opts.selectors[i])
    for (let j = 0; j < nodes.length; j++) {
      const len = ((nodes[j] && nodes[j].innerText) || '').trim().length
      if (len > best) best = len
    }
  }
  if (best >= opts.minLen) return true
  const multiplier = opts.bodyMultiplier || 20
  const bodyLen = (document.body && document.body.innerText ? document.body.innerText.trim().length : 0)
  return bodyLen >= opts.minLen * multiplier
}

/**
 * 条件等待正文就绪，替代固定 sleep。
 *
 * 原来是固定盲等 2 秒，注释却写着「等待内容容器出现（最多 10s）」——
 * 固定盲等两头都错：慢站点 2s 内正文没渲染完（解析成空正文），快站点白等 2s。
 *
 * 超时处置：选择器是通用启发式，无法覆盖任意站点结构，「等不到」不代表「采不到」，
 * 因此超时仅 warn 一条带上限/判据的日志并继续按当前 DOM 采集（保持原「拿到什么算
 * 什么」语义，不因加固等待而新增失败路径）。page 不支持 waitForFunction 时同样静默降级。
 *
 * @param {object} page - Playwright Page
 * @param {object} [opts]
 * @param {object} [opts.log] - 应用日志实例（info/warn/error），缺省则超时不留痕
 * @param {string} [opts.label] - 日志 tag，默认 'UrlCollector'
 * @returns {Promise<boolean>} 是否在时限内命中就绪条件
 */
async function waitForContentReady (page, opts = {}) {
  if (!page || typeof page.waitForFunction !== 'function') return false
  try {
    await page.waitForFunction(contentReadyProbe, {
      minLen: CONTENT_MIN_TEXT_LEN,
      selectors: CONTENT_READY_SELECTORS.slice(),
      bodyMultiplier: BODY_TEXT_MULTIPLIER,
    }, {
      timeout: CONTENT_READY_TIMEOUT_MS,
      polling: CONTENT_READY_POLL_MS,
    })
    return true
  } catch {
    if (opts.log && typeof opts.log.warn === 'function') {
      opts.log.warn(opts.label || 'UrlCollector', 'content-ready 条件等待超时 ' + CONTENT_READY_TIMEOUT_MS + 'ms（判据：正文容器 innerText>=' + CONTENT_MIN_TEXT_LEN + '），按当前 DOM 继续采集')
    }
    return false
  }
}

/**
 * 读取页面 HTML，导航竞态（page.content 在导航中抛错）时等待后重试。
 * 知乎 SPA 首次加载后可能仍有延迟导航，直接 page.content() 偶发抛
 * "Unable to retrieve content because the page is navigating and changing the content"，
 * 该错误消息不含已知分类关键词，会被 classifyCollectError 判为 unknown（原因未识别）。
 *
 * 只对导航竞态重试：其余错误（连接重置、超时等）直接上抛，交给上层的错误分类与
 * 熔断/冷却逻辑，避免重试放大对目标站点的请求量。
 *
 * @param {object} page - Playwright Page
 * @param {number} [maxAttempts] - 最大尝试次数
 * @returns {Promise<string>}
 */
async function readPageContentWithRetry (page, maxAttempts = 3) {
  let lastError
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await page.content()
    } catch (e) {
      lastError = e
      const msg = e && e.message ? String(e.message) : ''
      const isNavigationRace = /navigating/.test(msg) || /navigation/i.test(msg)
      if (!isNavigationRace || attempt === maxAttempts) break
      // 导航竞态：等待导航稳定后重试
      await new Promise((resolve) => setTimeout(resolve, RETRY_BASE_MS * attempt))
    }
  }
  throw lastError
}

module.exports = {
  CONTENT_READY_TIMEOUT_MS,
  CONTENT_READY_POLL_MS,
  CONTENT_MIN_TEXT_LEN,
  CONTENT_READY_SELECTORS,
  BODY_TEXT_MULTIPLIER,
  contentReadyProbe,
  waitForContentReady,
  readPageContentWithRetry,
}
