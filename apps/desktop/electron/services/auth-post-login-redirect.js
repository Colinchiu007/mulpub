// @ts-check
/**
 * 二段式登录（主站会话补抓）——登录成功后、抓凭据快照前的自包含步骤。
 * 从 auth-view-manager 抽出（该文件在逐文件行数门禁挂账，膨胀超容差必须拆分）。
 *
 * 背景（xhs-note-align 执行记录遗留）：小红书登录窗 URL 是 creator.xiaohongshu.com，
 * 用户登录后主站 web_session cookie 从未被设置，凭据快照缺主站会话，
 * edith note API 判 code -100「无登录信息」。
 *
 * 机制：若平台配置了 PLATFORM_POST_LOGIN_REDIRECT，登录窗自动 loadURL 主站——
 * creator 父域 Cookie 随请求带上，主站识别已登录态后种下 web_session，
 * 随后抓的凭据快照才含完整主站会话。未配置的平台 no-op，零回归。
 *
 * 等待模型（统一预算窗口，总时长 ≤ POST_LOGIN_REDIRECT_WAIT_MS + 一次短重试）：
 * 发出 loadURL 后立即轮询凭证（r2-i1：就绪判据 =「凭证 Cookie 真出现」而非
 * did-finish-load——主站常在整页加载后才由 JS/XHR 异步种会话）；预算耗尽先
 * stop 在途导航（r1-i6 时序竞争防护），再做一次短重试（r2-i5：超时可能恰好
 * 撞上「会话差临门一脚」），仍缺则按当前快照继续。
 *
 * CCG 评审处置（两轮，.ccg/reviews/41638d81*.json 与 abc48f5f1*.json）：
 *   r1-i2/r2-i2 短路：会话已含有效凭证（名+值+域匹配）时不补跳，省一次整页往返；
 *   r2-i3 凭证校验核对 domain 落在平台 Cookie 域内，防残留/错域同名 cookie 误判；
 *   凭证缺失全程只留独立失败标记日志（snapshotWillMissMainSiteSession=true），
 *     绝不阻断登录；「-100 根因是否真闭合」以真机验证为准（执行记录 PENDING）。
 */
const {
  PLATFORM_POST_LOGIN_REDIRECT,
  PLATFORM_POST_LOGIN_PROOF_COOKIES,
  POST_LOGIN_REDIRECT_WAIT_MS,
  isPlatformCookieDomain,
} = require('@multi-publish/shared-utils/src/platform-definitions')

// 预算耗尽后的一次性短重试等待（r2-i5）
const PROOF_RETRY_DELAY_MS = 2500

// 凭证轮询间隔
const PROOF_POLL_INTERVAL_MS = 500

/**
 * 会话里是否已有该平台二段式补跳的有效凭证 Cookie。
 * 有效 = 名匹配 ∧ 值非空 ∧ domain 落在平台 Cookie 域内（r2-i3：防 creator 窗口里
 * 残留/错域的同名 cookie 误判成主站会话）。cookies.get 失败按「没有凭证」处理：
 * 走补跳主流程，不因诊断路径故障阻断登录。
 * @param {import('electron').WebContentsView} view
 * @param {string} platform
 * @returns {Promise<boolean>}
 */
async function hasPostLoginProofCookie (view, platform) {
  const proofNames = PLATFORM_POST_LOGIN_PROOF_COOKIES[platform]
  if (!Array.isArray(proofNames) || proofNames.length === 0) return false
  let cookies
  try {
    cookies = await view.webContents.session.cookies.get({})
  } catch (_e) {
    return false
  }
  return cookies.some(cookie => cookie &&
    proofNames.includes(cookie.name) &&
    typeof cookie.value === 'string' && cookie.value.trim().length > 0 &&
    isPlatformCookieDomain(platform, cookie.domain))
}

/**
 * 登录成功后、抓凭据快照前执行：补跳主站并等主站会话落地（或兜底）。
 * 未配置 redirect 的平台直接返回（零回归）；所有失败路径只留日志，绝不阻断登录。
 * 注意：未配置平台走同步 return（非 async await 链），保证调用方在「未配置平台」
 * 上的时序与引入本模块前完全一致（既有测试用同步 advanceTimersByTime 驱动，
 * 多一层无谓的 await 微任务会使其 Extract 断言空转——CI Gate 4 实测教训）。
 * @param {import('electron').WebContentsView} view
 * @param {string} platform
 * @param {{ log: { info: Function, warn: Function } }} deps
 * @returns {Promise<void>}
 */
function waitForPostLoginSession (view, platform, { log }) {
  const redirectUrl = /** @type {Record<string, string>} */ (PLATFORM_POST_LOGIN_REDIRECT)[platform]
  // 未配置平台：同步路径，无微任务延迟，零回归
  if (!redirectUrl) return Promise.resolve()
  // 配置了 redirect 的平台才走真正的异步流程
  return waitForPostLoginSessionAsync(view, platform, redirectUrl, { log })
}

/**
 * 二段式主流程（仅配置了 redirect 的平台会进入）。
 * @param {import('electron').WebContentsView} view
 * @param {string} platform
 * @param {string} redirectUrl
 * @param {{ log: { info: Function, warn: Function } }} deps
 * @returns {Promise<void>}
 */
async function waitForPostLoginSessionAsync (view, platform, redirectUrl, { log }) {
  // 短路：会话已含有效凭证（如早前登录过主站）不再补跳
  if (await hasPostLoginProofCookie(view, platform)) return

  log.info('AuthView', `post-login redirect to main site: ${platform} ${redirectUrl}`)
  // loadURL 只发起不等待（catch 兜 rejection）：就绪判据不是页面加载完成，
  // 而是下面的凭证轮询——主站 JS/XHR 种会话可能早于也可能晚于 did-finish-load。
  // 视图可能已被关闭（用户 ESC / 超时 settle 竞争），webContents 求值须防同步抛
  //（r3-i4：view 销毁后访问 view.webContents 会 throw，违反「绝不阻断登录」不变式）。
  try {
    view.webContents.loadURL(redirectUrl).catch(e => {
      log.warn('AuthView', `post-login redirect load failed: ${e instanceof Error ? e.message : String(e)}`)
    })
  } catch (e) {
    log.warn('AuthView', `post-login redirect aborted (view gone): ${e instanceof Error ? e.message : String(e)}`)
    return
  }
  // 轮询凭证直到出现或预算耗尽。退出后无论预算定时器是否已跑，都无条件进入
  // stop+短重试降级路径（r3-i2：budgetExhausted 标志与 deadline 是两个独立时钟，
  // 末次续体可能先于定时器回调跑完——「没等到凭证」本身即降级条件，不依赖标志）。
  const deadline = Date.now() + POST_LOGIN_REDIRECT_WAIT_MS
  let proofFound = false
  while (!proofFound && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, PROOF_POLL_INTERVAL_MS))
    proofFound = await hasPostLoginProofCookie(view, platform)
  }
  if (!proofFound) {
    // 预算耗尽：stop 在途导航（时序竞争防护）后短重试（r2-i5：会话可能刚好
    // 差临门一脚——stop 停的是导航与资源加载，已种下的 cookie 不受影响）。
    try { view.webContents.stop() } catch (_e) { /* 视图可能已销毁 */ }
    log.info('AuthView', `post-login proof retry in ${PROOF_RETRY_DELAY_MS}ms: ${platform}`)
    await new Promise(resolve => setTimeout(resolve, PROOF_RETRY_DELAY_MS))
    proofFound = await hasPostLoginProofCookie(view, platform)
  }
  // 最终校验：仍缺失则留独立失败标记（不阻断）——「二段式是否真生效」可观测，
  // 该降级路径抓到的快照仍缺主站会话，由真机验证圈定实际发生率。
  if (!proofFound) {
    log.warn('AuthView', `post-login redirect proof cookie missing: ${platform} ` +
      `proof=${(PLATFORM_POST_LOGIN_PROOF_COOKIES[platform] || []).join(',')} ` +
      `snapshotWillMissMainSiteSession=true`)
  }
}

module.exports = {
  POST_LOGIN_REDIRECT_WAIT_MS,
  PROOF_RETRY_DELAY_MS,
  hasPostLoginProofCookie,
  waitForPostLoginSession,
}
