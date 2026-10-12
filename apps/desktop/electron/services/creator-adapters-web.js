'use strict'

/**
 * creator-adapters-web.js — 抖音 / 小红书的博主监控适配器（PRD-CREATOR-MULTI-PLATFORM-2026-10-12）
 *
 * ## 分工（与 YouTube 版 creator-collector-runtime 同构）
 *
 *   · creator-platforms.js        三平台统一的输入解析（fail-closed，零请求）
 *   · creator-credential.js       YouTube API Key（既有）
 *   · creator-session-cookie.js   抖音/小红书的会话 Cookie 提供者（账号分区）
 *   · 本文件                      端点调用 + 签名 + 响应归一化
 *
 * ## 三条不可破的纪律（与 YouTube 版同族，全部来自真实事故形态）
 *
 *   1. 签名失败 / 风控 MUST NOT 静默降级为空列表（那是「监控看起来正常但永远采不到」）；
 *      统一抛 `creator:signature_failed`，由失败分级接管（Tier B → auto_paused）。
 *   2. 作品 external_id **只**取端点响应里的真 ID 字段（抖音 aweme_id、小红书 note_id），
 *      绝不拿列表项索引或分享链接凑数。
 *   3. 签名经 pythonBridge 调 `/api/creator/sign/*`（xhshow / abogus，MIT/Apache-2.0 纯算法）；
 *      桥不可用 = 明确失败，不是「跳过签名裸请求」。
 */

const { CREATOR_PLATFORM_ERRORS, CREATOR_PLATFORMS } = require('./creator-platforms')

const DOUYIN_WEB_BASE = 'https://www.douyin.com/aweme/v1/web'
const XHS_WEB_BASE = 'https://edith.xiaohongshu.com'
const DOUYIN_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36'

function fail (code, message) {
  const err = new Error(message)
  err.code = code
  return err
}

function isSignatureBlocked (status, bodyText) {
  if (status === 403 || status === 461 || status === 406) return true
  const t = String(bodyText || '')
  return t.includes('Signature') || t.includes('signature') || t.includes('verify_fp')
}

/** 把平台端点的原始响应归一化为与 YouTube listPosts 同形的 Post[] */
function toPost (platform, raw) {
  if (platform === CREATOR_PLATFORMS.DOUYIN) {
    const desc = String((raw && raw.desc) || '')
    const vid = String((raw && (raw.aweme_id || (raw.aweme_info && raw.aweme_info.aweme_id))) || '')
    if (!vid) return null
    const stats = (raw && raw.statistics) || {}
    return {
      externalId: vid,
      title: desc.slice(0, 200),
      url: `https://www.douyin.com/video/${vid}`,
      thumbnailUrl: String((raw && raw.video && raw.video.cover && (raw.video.cover.url_list || [])[0]) || ''),
      publishedAt: raw && raw.create_time ? new Date(Number(raw.create_time) * 1000).toISOString() : null,
      contentQuality: desc.length >= 200 ? 'partial' : 'stub',
      description: desc,
      stats: { likes: stats.digg_count, comments: stats.comment_count, shares: stats.share_count },
    }
  }
  // 小红书：user_posted 返回 notes[]（卡片形态，note 承载在 note_card）
  const card = (raw && raw.note_card) || raw || {}
  const noteId = String((raw && raw.note_id) || card.note_id || '')
  if (!noteId) return null
  const desc = String(card.display_title || card.title || '')
  const cover = (card.cover || {}).url_list || (card.cover || {}).info_list || []
  const coverUrl = (Array.isArray(cover) && cover.length && (cover[cover.length - 1].url || cover[0].url)) || ''
  return {
    externalId: noteId,
    title: desc.slice(0, 200),
    url: `https://www.xiaohongshu.com/explore/${noteId}`,
    thumbnailUrl: String(coverUrl || ''),
    publishedAt: card.time ? new Date(Number(card.time) * 1000).toISOString() : null,
    contentQuality: 'stub',
    description: desc,
    stats: { likes: (card.interact_info && Number(card.interact_info.liked_count)) || null },
  }
}

/**
 * 创建多平台采集器。
 * @param {object} deps
 *   - sessionProvider: async (platform) => { cookieString, a1, b1, msToken } | null
 *   - signBridge: async (platform, payload) => signing headers（pythonBridge /api/creator/sign/*）
 *   - httpGet/httpPost: 注入式网络层（测试替身 / 生产 https）
 */
function createMultiPlatformCollector (deps = {}) {
  const {
    sessionProvider,
    signBridge,
    httpGet,
    _httpPost,       // 预留：单作品详情 POST（本期未用）
    listPostsImpl,   // 测试覆盖口
    _log,
  } = deps

  async function requireSession (platform) {
    const s = typeof sessionProvider === 'function' ? await sessionProvider(platform) : null
    if (!s || !s.cookieString) {
      throw fail(CREATOR_PLATFORM_ERRORS.CREDENTIAL_MISSING, `未登录${platform === 'douyin' ? '抖音' : '小红书'}账号`)
    }
    return s
  }

  /** 平台是否有可用会话（探测用，零网络请求，不抛错） */
  async function hasSession (platform) {
    try { return !!(await requireSession(platform)) } catch (_) { return false }
  }

  async function signedGet (platform, uri, params) {
    const session = await requireSession(platform)
    // 签名对 query_str 的形态有约定（abogus 上游注释：已排序查询串）——按 key 排序后再签，
    // 否则「参与签名的串」与「实际发出的串」不一致，抖音腿会恒失败（QM-6 后端评审 W2）。
    const orderedEntries = Object.entries(params || {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    const qs = orderedEntries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&')
    let signature
    try {
      signature = await signBridge(platform, { uri, query_str: qs, cookie_string: session.cookieString, method: 'GET', a1: session.a1 })
    } catch (e) {
      throw fail(CREATOR_PLATFORM_ERRORS.SIGNATURE_FAILED, '签名服务不可用: ' + ((e && e.message) || e))
    }
    // 签名头全空 = 桥/算法异常。**绝不裸请求**：裸发必 403，会被误判成风控而非「签名链路坏了」。
    if (platform === CREATOR_PLATFORMS.DOUYIN && !signature.a_bogus) {
      throw fail(CREATOR_PLATFORM_ERRORS.SIGNATURE_FAILED, '抖音签名结果为空（a_bogus 缺失）')
    }
    if (platform === CREATOR_PLATFORMS.XIAOHONGSHU && !signature.x_s) {
      throw fail(CREATOR_PLATFORM_ERRORS.SIGNATURE_FAILED, '小红书签名结果为空（x-s 缺失）')
    }
    const url = `${platform === 'douyin' ? DOUYIN_WEB_BASE : XHS_WEB_BASE}${uri}?${qs}${signature.a_bogus ? `&a_bogus=${encodeURIComponent(signature.a_bogus)}` : ''}`
    const headers = buildHeaders(platform, session, signature)
    let res
    try {
      res = await httpGet(url, { headers }, { returnFullResponse: true })
    } catch (e) {
      const status = e && e.response && e.response.status
      if (isSignatureBlocked(status, e && e.message)) {
        throw fail(CREATOR_PLATFORM_ERRORS.SIGNATURE_FAILED, `端点拒绝（HTTP ${status || 'err'}），登录态或签名已失效`)
      }
      throw e
    }
    const status = res && res.status
    const text = typeof res === 'string' ? res : (res.body || '')
    // 签名/风控判定对**任意状态码**评估 body（QM-6 后端评审 W1：抖音风控常以 HTTP 200 +
    // 业务错误形态出现，只在 >=400 分支判定会让「签名失效」静默降级成空列表）
    if ((status && status >= 400 && isSignatureBlocked(status, text)) || (!status || status < 400) && isSignatureBlocked(200, text) && text && !looksLikeJson(text)) {
      throw fail(CREATOR_PLATFORM_ERRORS.SIGNATURE_FAILED, `端点拒绝（HTTP ${status || 'err'}），登录态或签名已失效`)
    }
    let json
    try { json = JSON.parse(text) } catch (_) { json = null }
    if (platform === CREATOR_PLATFORMS.XIAOHONGSHU && json && json.code !== undefined && Number(json.code) !== 0) {
      // xhs 业务错误码分因（PRD §6）：-100 = 登录态失效（重新登录），其余 = 签名/风控
      if (Number(json.code) === -100) {
        throw fail(CREATOR_PLATFORM_ERRORS.CREDENTIAL_MISSING, '小红书登录态已失效，请重新登录')
      }
      throw fail(CREATOR_PLATFORM_ERRORS.SIGNATURE_FAILED, `小红书返回 code=${json.code}`)
    }
    if (platform === CREATOR_PLATFORMS.DOUYIN && json && json.status_code !== undefined && Number(json.status_code) !== 0) {
      // 抖音业务错误码（QM-6 W1）：HTTP 200 + status_code!=0 是 a_bogus 失效/风控的常见形态，
      // 此时不拦截就会静默降级成空列表 —— 正是本文件宣称要防的「看似正常但永远采不到」。
      throw fail(CREATOR_PLATFORM_ERRORS.SIGNATURE_FAILED, `抖音返回 status_code=${json.status_code}${json.status_msg ? ' (' + json.status_msg + ')' : ''}`)
    }
    return json
  }

  /** 是否像 JSON 响应（签名失败页通常是 HTML/纯文本） */
  function looksLikeJson (text) {
    const s = String(text || '').trim()
    return s.startsWith('{') || s.startsWith('[')
  }

  function buildHeaders (platform, session, signature) {
    if (platform === CREATOR_PLATFORMS.DOUYIN) {
      return {
        'User-Agent': DOUYIN_UA,
        Cookie: session.cookieString,
        Referer: 'https://www.douyin.com/',
      }
    }
    return {
      'User-Agent': DOUYIN_UA,
      Cookie: session.cookieString,
      'X-S': signature.x_s || '',
      'X-T': signature.x_t || '',
      'X-S-Common': signature.x_s_common || '',
      'X-B3-Traceid': signature.x_b3_traceid || '',
      Origin: 'https://www.xiaohongshu.com',
      Referer: 'https://www.xiaohongshu.com/',
    }
  }

  /** 抖音：web 端点作品枚举（PRD §5.2）。返回 {items, cursor, hasMore} */
  async function listDouyinPosts (creatorId, { cursor = 0, count = 20 } = {}) {
    const params = {
      device_platform: 'webapp', aid: '6383', channel: 'channel_pc_web',
      sec_user_id: creatorId, max_cursor: String(cursor), locate_mode: 'False',
      count: String(count), version_code: '170400', version_name: '17.4.0',
    }
    const json = await signedGet(CREATOR_PLATFORMS.DOUYIN, '/aweme/v1/web/aweme/post', params)
    const list = (json && Array.isArray(json.aweme_list)) ? json.aweme_list : []
    const items = list.map((x) => toPost(CREATOR_PLATFORMS.DOUYIN, x)).filter(Boolean)
    return { items, cursor: (json && json.next_max_cursor) || 0, hasMore: !!(json && json.has_more) }
  }

  /** 小红书：user_posted 端点。返回 {items, cursor, hasMore} */
  async function listXhsPosts (creatorId, { cursor = '' } = {}) {
    const params = { user_id: creatorId, cursor: cursor || '', num: '20', image_scenes: 'FD_PRV_WEBP' }
    const json = await signedGet(CREATOR_PLATFORMS.XIAOHONGSHU, '/api/sns/web/v1/user_posted', params)
    const data = (json && json.data) || {}
    const list = Array.isArray(data.notes) ? data.notes : []
    const items = list.map((x) => toPost(CREATOR_PLATFORMS.XIAOHONGSHU, x)).filter(Boolean)
    return { items, cursor: data.cursor || '', hasMore: !!data.has_more }
  }

  return {
    /** 平台是否有可用会话（探测用，零网络请求，不抛错） */
    hasSession,
    /** 平台分发：与 YouTube listPosts 同形。 */
    async listPosts (platform, creatorId, opts) {
      if (typeof listPostsImpl === 'function') return listPostsImpl(platform, creatorId, opts)
      if (platform === CREATOR_PLATFORMS.DOUYIN) return listDouyinPosts(creatorId, opts)
      if (platform === CREATOR_PLATFORMS.XIAOHONGSHU) return listXhsPosts(creatorId, opts)
      throw fail(CREATOR_PLATFORM_ERRORS.UNSUPPORTED_PLATFORM, `平台 ${platform} 无采集实现`)
    },
    /** 正文采集：抖音/小红书本期描述即正文（PRD §5.3，quality=stub/partial） */
    async collectBody (_platform, _externalId) {
      // 本期正文随列表返回（desc/display_title），不二次请求；保留口子给后续「单作品详情」
      return { content: '', transcriptSource: 'description', contentQuality: 'stub' }
    },
    /** 单作品详情（采集正文时用，抖音 web detail / xhs feed）——本期由 runtime 消费列表内字段 */
    _internals: { signedGet, toPost, listDouyinPosts, listXhsPosts },
  }
}

module.exports = { createMultiPlatformCollector, toPost, isSignatureBlocked, DOUYIN_UA }
