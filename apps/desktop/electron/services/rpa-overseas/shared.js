// @ts-check
'use strict'
/**
 * rpa-overseas/shared.js — 海外平台「发布后回读核验」层
 *
 * ## 为什么必须有这一层（这是本仓此前全平台缺的能力）
 *
 * TikTok / YouTube / Pinterest 三个平台独立收敛到同一种失败形态：
 * **集成能跑通、返回成功、产出没人看得见的内容，而且不返回任何错误。**
 * 只断言 HTTP 状态码 / 只看「点了发布按钮」的测试会全绿；
 * 只有「用登出状态的客户端把内容取回来」才暴露问题。
 *
 * ⇒ 判据落在**平台侧可回读的事实**上（作品 URL / 作品 ID / 作者 ID / 正文），
 *   不落在「我调用了发布接口」上。
 *
 * ## 三态语义（不要压成两态）
 *
 *   { verified: true,  evidence }         已发布且已回读确认
 *   { verified: false, reason }           没核验到（可能已发，可能没发）
 *   { error }                            核验过程本身出错（页面结构变了 / 跳转失败）
 *
 * ⚠️ **「核验失败」不等于「发布失败」**：平台改版会让核验器失效，
 * 而此时内容可能已经发出去了。把两者混成一种，调用方就会把「发了但没确认」
 * 误报成「没发」⇒ 用户重发 ⇒ 重复内容。调用方必须自己决定如何归类。
 *
 * ## 诚实边界
 *
 * ① **本 PR 只有 youtube 分支在生产路径可达**（tiktok / instagram / twitter / facebook
 *    的核验分支是**真实实现但未接线** —— 各自的专属发布链尚未落地）。
 *    这与本仓既有惯例同型：真源选择器表覆盖 17 个平台，专属实现只覆盖 6 个。
 * ② 本模块**只产出证据，不做「期望值比对」**。「当前登录的是不是这个账号」需要
 *    账号元数据里存了平台身份锚点（IG 的 `ds_user_id`、YouTube 的 `/channel/<id>`…），
 *    那是账号管理侧的改动 ⇒ 本轮**不提供**该函数（零调用方的预留函数＝死代码）。
 */

const log = require('../logger')
const { getOverseasSelectors } = require('./selectors')

/**
 * 在页面里读一个 meta 标签的 content。
 * @param {any} win
 * @param {string} selector CSS 选择器（形如 'meta[property="og:url"]'）
 * @returns {Promise<string>} 取不到返回空串
 */
async function readMetaContent (win, selector) {
  const sel = JSON.stringify(selector)
  try {
    const v = await win.webContents.executeJavaScript(
      '(function(){var e=document.querySelector(' + sel + ');return e?(e.getAttribute("content")||""):""})()'
    )
    return typeof v === 'string' ? v : ''
  } catch (e) {
    return ''
  }
}

/**
 * 读一组选择器里第一个存在的元素的文本。
 * @param {any} win
 * @param {string[]} selectors
 * @returns {Promise<string>}
 */
async function readFirstText (win, selectors) {
  const list = Array.isArray(selectors) ? selectors : []
  for (const sel of list) {
    const q = JSON.stringify(sel)
    // ⚠️ executeJavaScript 抛错 = **页面执行失败**（窗口销毁/页面崩溃），
    //    不是「这个候选选择器没命中」⇒ 这里**不吞异常**，让它冒到调用方，
    //    由 verifyPublished 区分「没测成」(error) 与「测出不通过」(verified:false)。
    const v = await win.webContents.executeJavaScript(
      '(function(){var e=document.querySelector(' + q + ');return e?(e.innerText||e.textContent||"").trim():""})()'
    )
    if (typeof v === 'string' && v) return v
  }
  return ''
}

/**
 * 读一组选择器里第一个存在的元素的 href。
 * @param {any} win
 * @param {string[]} selectors
 * @returns {Promise<string>}
 */
async function readFirstHref (win, selectors) {
  const list = Array.isArray(selectors) ? selectors : []
  for (const sel of list) {
    const q = JSON.stringify(sel)
    // 同 readFirstText：执行失败不吞，冒给调用方区分「没测成」。
    const v = await win.webContents.executeJavaScript(
      '(function(){var e=document.querySelector(' + q + ');return e?(e.getAttribute("href")||""):""})()'
    )
    if (typeof v === 'string' && v) return v
  }
  return ''
}

/**
 * 解析 Instagram 作品深链里的数字作品 ID。
 * 形态：instagram://media?id=<数字ID>_<ownerId>
 * @param {string} deepLink
 * @returns {{contentId: string, ownerId: string}|null}
 */
function parseInstagramDeepLink (deepLink) {
  const s = String(deepLink || '')
  const m = /^instagram:\/\/media\?id=(\d+)_(\d+)$/.exec(s.trim())
  if (!m) return null
  return { contentId: m[1], ownerId: m[2] }
}

/**
 * 解析 Instagram 作品短码（从规范链接 /p/<短码>/ 或 /reel/<短码>/）。
 * @param {string} url
 * @returns {string} 取不到返回空串
 */
function parseInstagramShortcode (url) {
  const s = String(url || '')
  let parsed
  try { parsed = new URL(s) } catch (e) { return '' }
  if (parsed.protocol !== 'https:') return ''
  if (parsed.hostname !== 'www.instagram.com' && parsed.hostname !== 'instagram.com') return ''
  const m = /^\/(?:[A-Za-z0-9_.]+\/)?(?:p|reel)\/([A-Za-z0-9_-]+)\/?$/.exec(parsed.pathname)
  return m ? m[1] : ''
}

/**
 * 按平台回读核验「内容是否真的发出去了」。
 * @param {any} win
 * @param {string} platform
 * @param {{expectedText?: string, accountId?: string}} [opts]
 * @returns {Promise<{verified: boolean, evidence?: object, reason?: string, error?: string}>}
 */
async function verifyPublished (win, platform, opts) {
  const options = opts || {}
  const sel = getOverseasSelectors(platform)

  try {
    if (platform === 'youtube') {
      const href = await readFirstHref(win, sel.published_link || [])
      if (!href) {
        return { verified: false, reason: 'youtube 未回读到作品链接（可能未发布成功，也可能页面结构变化）' }
      }
      return { verified: true, evidence: { videoUrl: href } }
    }

    if (platform === 'tiktok') {
      const marker = await readFirstText(win, sel.published_marker || [])
      if (!marker) {
        return { verified: false, reason: 'tiktok 未回读到发布完成标记' }
      }
      return { verified: true, evidence: { marker } }
    }

    if (platform === 'twitter') {
      // X 的正证据在 API 返回的 tweet id 上（由 adapters/twitter.js 负责），
      // 网页轨只能回读到「已发布」文案，**不能证明内容公开可见** ⇒ 不在此处声称已核验。
      // ⚠️ 刻意不读 published_marker：那个键在本仓尚无消费方（X 专属链未落地），
      //    且「读到发布提示」也不构成核验证据 ⇒ 读它只会让文案随页面状态漂移。
      return {
        verified: false,
        reason: 'X 网页轨无法证明内容公开可见（正证据在官方 API 返回的 tweet id 上）',
      }
    }

    if (platform === 'instagram') {
      const canonical = await readMetaContent(win, 'meta[property="og:url"]')
      const owner = await readMetaContent(win, 'meta[property="instapp:owner_user_id"]')
      const description = await readMetaContent(win, 'meta[name="description"]')
      const deepLink = await readMetaContent(win, 'meta[property="al:ios:url"]')

      if (!canonical && !deepLink) {
        return { verified: false, reason: 'instagram 未回读到作品元数据（可能未跳转到作品详情页）' }
      }
      const shortcode = parseInstagramShortcode(canonical)
      const media = parseInstagramDeepLink(deepLink)
      if (!shortcode || !media) {
        return {
          verified: false,
          reason: 'instagram 作品元数据不完整（缺规范链接或深链）',
          evidence: { canonical, deepLink },
        }
      }
      const expectedText = String(options.expectedText || '').trim()
      if (expectedText && !String(description || '').includes(expectedText)) {
        // 双重核对：正文元数据不含预期文字 ⇒ 不能算已核验（可能发到了别处）
        return {
          verified: false,
          reason: 'instagram 作品正文与预期不符',
          evidence: { canonical, owner, description: String(description || '').slice(0, 120) },
        }
      }
      return {
        verified: true,
        evidence: { canonical, owner, contentId: media.contentId, ownerId: media.ownerId, shortcode },
      }
    }

    if (platform === 'facebook') {
      // Facebook 的作品页没有稳定的作品级 meta 标识（[参考] 实现里也只用 DOM 判据），
      // 因此这里只产出「发布后页面出现作品痕迹」的弱证据，并如实标注。
      const marker = await readFirstText(win, ['[data-pagelet*="composer"]', '[role="feed"]'])
      if (!marker) {
        return { verified: false, reason: 'facebook 未回读到作品痕迹（Facebook 无稳定作品级标识，弱证据）' }
      }
      return { verified: true, evidence: { marker: String(marker).slice(0, 120), weak: true } }
    }

    return { verified: false, reason: '未实现的核验平台: ' + platform }
  } catch (e) {
    const msg = e && e.message ? e.message : String(e)
    log.warn('RpaView', '[verify] ' + platform + ' 核验过程出错: ' + msg)
    return { error: msg }
  }
}

module.exports = {
  readMetaContent,
  readFirstText,
  readFirstHref,
  parseInstagramDeepLink,
  parseInstagramShortcode,
  verifyPublished,
}
