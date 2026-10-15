'use strict'
/**
 * zhihu-publish-state.js — 知乎图文发布终态判据（纯函数、零依赖、零副作用）
 *
 * ## 为什么单独成模块
 * 2026-10-15 用户报障：「知乎显示发布成功，但并没有真实发布」。
 * 根因是 `_publish_zhihu` 的成功判据用 `/\/p\/\d+/` 匹配当前 URL，而**草稿编辑页**
 * `https://zhuanlan.zhihu.com/p/<id>/edit` 同样命中该正则 ⇒ 稿子只落成草稿时
 * 界面照样报成功（真机日志 2026-10-15T12:40:19Z→12:40:22Z：
 * 点一次「发布」→ URL 变 `/p/2094165753981309631/edit` → 判成功）。
 * 判据写成纯函数后可以脱离 Electron/RPA 环境做穷举单测（含 `/edit` 反例），
 * 避免再次出现「夹具用了草稿 URL 却把成功断言写死」这类把缺陷锁成契约的测试。
 *
 * ## 判据（fail-closed）
 * - `isZhihuPublishedUrl(url)`：**只有**公开文章页 `https://zhuanlan.zhihu.com/p/<数字>`
 *   （可带查询串/锚点）才算发布成功；`/p/<id>/edit`（草稿编辑页）、`/write`（写作页）、
 *   其它任何路径一律**不算**。
 * - `isZhihuDraftEditorUrl(url)`：草稿编辑页 —— 命中它说明「首次点击只落了草稿」，
 *   必须再点一次「发布」才可能真正发布。
 * - `extractZhihuPostId(url)`：从上述两种 URL 提取文章 ID（记录/回查用）。
 *
 * 主域名同时接受 `zhuanlan.zhihu.com` 与 `www.zhihu.com`（同一文章 ID 的两个入口），
 * 但**路径必须严格等于 `/p/<数字>`**：宽判据（含子串 `/p/`）正是本次事故的引入点。
 */

/** 知乎文章页/编辑页的合法主机（同一 postId 的两种入口） */
const ZHIHU_ARTICLE_HOSTS = new Set(['zhuanlan.zhihu.com', 'www.zhihu.com'])

/** 公开文章页路径：`/p/<数字>`（无尾段） */
const ZHIHU_PUBLISHED_PATH_RE = /^\/p\/(\d+)\/?$/

/** 草稿编辑页路径：`/p/<数字>/edit` */
const ZHIHU_DRAFT_EDIT_PATH_RE = /^\/p\/(\d+)\/edit\/?$/

/**
 * 解析 URL（非法输入返回 null，绝不抛）。
 * @param {unknown} url
 * @returns {URL|null}
 */
function parseZhihuUrl (url) {
  if (typeof url !== 'string') return null
  const raw = url.trim()
  if (!raw) return null
  try {
    const parsed = new URL(raw)
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null
    return parsed
  } catch (_) {
    return null
  }
}

/**
 * 是否为知乎公开文章页（发布成功的唯一 URL 判据）。
 * @param {unknown} url
 * @returns {boolean}
 */
function isZhihuPublishedUrl (url) {
  const parsed = parseZhihuUrl(url)
  if (!parsed) return false
  if (!ZHIHU_ARTICLE_HOSTS.has(parsed.hostname.toLowerCase())) return false
  return ZHIHU_PUBLISHED_PATH_RE.test(parsed.pathname)
}

/**
 * 是否为知乎草稿编辑页（`/p/<id>/edit`）。命中即「只落了草稿、尚未发布」。
 * @param {unknown} url
 * @returns {boolean}
 */
function isZhihuDraftEditorUrl (url) {
  const parsed = parseZhihuUrl(url)
  if (!parsed) return false
  if (!ZHIHU_ARTICLE_HOSTS.has(parsed.hostname.toLowerCase())) return false
  return ZHIHU_DRAFT_EDIT_PATH_RE.test(parsed.pathname)
}

/**
 * 从公开文章页或草稿编辑页提取文章 ID；非知乎文章 URL 返回 ''。
 * @param {unknown} url
 * @returns {string}
 */
function extractZhihuPostId (url) {
  const parsed = parseZhihuUrl(url)
  if (!parsed) return ''
  if (!ZHIHU_ARTICLE_HOSTS.has(parsed.hostname.toLowerCase())) return ''
  const m = ZHIHU_PUBLISHED_PATH_RE.exec(parsed.pathname) ||
    ZHIHU_DRAFT_EDIT_PATH_RE.exec(parsed.pathname)
  return m ? m[1] : ''
}

/** 两段式确认的默认时限（毫秒）：首段等导航落定 / 次段等草稿页的「发布」按钮 / 再等发布跳转 */
const ZHIHU_CONFIRM_TIMINGS = Object.freeze({
  settleMs: 6000,
  waitButtonMs: 8000,
  secondSettleMs: 12000,
  pollMs: 500,
})

/**
 * 轮询读 URL 直到「已是公开文章页」或时限用尽（返回最后一次观察到的 URL）。
 * 轮询超时**不当作失败信号**：只表示「在这段时限内没看到公开文章页」，由调用方判终态。
 * @param {{readUrl:()=>string, sleep:(ms:number)=>Promise<unknown>}} deps
 * @param {number} budgetMs
 * @param {number} pollMs
 * @returns {Promise<string>}
 */
async function waitZhihuUrlSettle (deps, budgetMs, pollMs) {
  const step = Math.max(100, Number(pollMs) || ZHIHU_CONFIRM_TIMINGS.pollMs)
  const deadline = Math.max(0, Number(budgetMs) || 0)
  let waited = 0
  let url = ''
  for (;;) {
    try { url = String(deps.readUrl() || '') } catch (_) { url = '' }
    if (isZhihuPublishedUrl(url)) return url
    if (waited >= deadline) return url
    await deps.sleep(Math.min(step, deadline - waited))
    waited += step
  }
}

/**
 * 知乎发布终态确认（两段式，fail-closed）。
 *
 * 真机流程（2026-10-15 日志取证）：点「发布」→ 平台把稿子落成**草稿**并跳到
 * `zhuanlan.zhihu.com/p/<id>/edit`；在该编辑页**再点一次「发布」**才会真正发布并
 * 跳到公开文章页 `zhuanlan.zhihu.com/p/<id>`。因此：
 *   ① 只有 `isZhihuPublishedUrl` 为真才返回 `published: true`；
 *   ② 仅当**确证当前停在草稿编辑页**时才补点第二次（避免在写作页重复点击造出两份草稿）；
 *   ③ 未确认为公开文章页时返回 `published: false` + 机器可读 `reason`，
 *      由上层报失败 —— 绝不把草稿当成功（本次报障的核心）。
 *
 * 依赖全部注入（读 URL / 等元素 / 点击 / 睡眠 / 日志），单测可完全脱机驱动。
 * @param {{readUrl:()=>string, waitForElement:(sel:string,ms:number)=>Promise<boolean>,
 *   click:(sel:string)=>Promise<unknown>, sleep:(ms:number)=>Promise<unknown>,
 *   publishButton:string, log?:{warn?:Function},
 *   settleMs?:number, waitButtonMs?:number, secondSettleMs?:number, pollMs?:number}} deps
 * @returns {Promise<{published:boolean, url:string, postId:string, reason:string, extraClicks:number}>}
 */
async function confirmZhihuPublished (deps) {
  const timings = Object.assign({}, ZHIHU_CONFIRM_TIMINGS, {
    settleMs: deps.settleMs === undefined ? ZHIHU_CONFIRM_TIMINGS.settleMs : deps.settleMs,
    waitButtonMs: deps.waitButtonMs === undefined ? ZHIHU_CONFIRM_TIMINGS.waitButtonMs : deps.waitButtonMs,
    secondSettleMs: deps.secondSettleMs === undefined ? ZHIHU_CONFIRM_TIMINGS.secondSettleMs : deps.secondSettleMs,
    pollMs: deps.pollMs === undefined ? ZHIHU_CONFIRM_TIMINGS.pollMs : deps.pollMs,
  })
  const publishButton = String(deps.publishButton || '')
  let url = await waitZhihuUrlSettle(deps, timings.settleMs, timings.pollMs)
  let extraClicks = 0
  let reason = 'not-confirmed'
  if (isZhihuPublishedUrl(url)) {
    return { published: true, url, postId: extractZhihuPostId(url), reason: 'published', extraClicks }
  }
  if (isZhihuDraftEditorUrl(url)) {
    // 停在草稿编辑页 ⇒ 首次点击只落了草稿，补点该页的「发布」。
    const ready = publishButton
      ? await deps.waitForElement(publishButton, timings.waitButtonMs)
      : false
    if (!ready) {
      reason = 'draft-editor-publish-button-missing'
    } else {
      await deps.click(publishButton)
      extraClicks += 1
      url = await waitZhihuUrlSettle(deps, timings.secondSettleMs, timings.pollMs)
      if (isZhihuPublishedUrl(url)) {
        return { published: true, url, postId: extractZhihuPostId(url), reason: 'published-after-second-click', extraClicks }
      }
      reason = 'draft-editor-still-not-published'
    }
  } else {
    // 既不是公开文章页也不是草稿编辑页（写作页/风控页/未知页）⇒ 不补点，直接如实失败。
    reason = 'unexpected-page'
  }
  if (deps.log && typeof deps.log.warn === 'function') {
    deps.log.warn('RpaView', '[zhihu] publish not confirmed reason=' + reason + ' url=' + url)
  }
  return { published: false, url, postId: extractZhihuPostId(url), reason, extraClicks }
}

module.exports = {
  ZHIHU_ARTICLE_HOSTS,
  ZHIHU_PUBLISHED_PATH_RE,
  ZHIHU_DRAFT_EDIT_PATH_RE,
  ZHIHU_CONFIRM_TIMINGS,
  parseZhihuUrl,
  isZhihuPublishedUrl,
  isZhihuDraftEditorUrl,
  extractZhihuPostId,
  waitZhihuUrlSettle,
  confirmZhihuPublished,
}
