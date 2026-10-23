/**
 * http-profile-api.js — 账号资料来源（昵称 / 头像 / 粉丝数 / 平台ID）
 *
 * 从 http-login-checker.js 拆出（2026-10-22，PRD-ACCOUNT-PROFILE-AVATAR-2026-10-22）：
 *  1) **关注点不同**。登录判定回答「这批 Cookie 还活着吗」，账号资料回答「这个账号叫什么、
 *     长什么样、有多少粉丝」。合成一张表 ⇒ 登录判定端点被反向绑死成资料端点：抖音注册的
 *     `/aweme/v1/creator/pc/user/info/` 只回 `{status_code, uid}`（**没有 user 对象**），
 *     于是提取恒空、昵称永远回落成平台名；真正带 user 对象的 `/web/api/media/user/info/`
 *     反而没被登记。
 *  2) **逐文件行数门禁**（500 行阻断）：合在一起 http-login-checker.js 会超限。
 *     本仓既有先例同型：account-manager.js 拆出 account-profile-refresh.js 等四个模块。
 *
 * 依赖方向单一：http-login-checker.js require 本模块；本模块**不**反向 require
 * （否则成环）。契约：字段缺席 = 不修改；异常/非 2xx 只返回已合并到的部分；
 * 只读端点；凭据出口按目标主机过滤 + 平台域名闸门（见 scopedCookieHeader）。
 *
 * 拆分记录（2026-10-23）：本文件一度涨到 643 行，越过「逐文件行数门禁」的 500 行红线。
 * 拆出两块（依赖方向仍单向）：
 *   ./profile-value-rules      —— 通用形态规则（trimText / toCount / 头像 URL 归一 / 昵称白名单）
 *   ./wechat-mp-profile-parser —— 公众号登录页模板的身份解析（parseWechatMpIdentity）
 * 本文件保留的是「资料来源表 + 取数编排」—— 也就是与平台无关的那一半。
 */
const log = require('../services/logger')
const {
  PLATFORM_COOKIE_DOMAINS,
  hasPlatformSessionCookie,
} = require('@multi-publish/shared-utils/src/platform-definitions')
const { normalizeUid, cookieValue } = require('./platform-uid')
const {
  trimText,
  toCount,
  pickAvatarUrl,
} = require('./profile-value-rules')
const { parseWechatMpIdentity } = require('./wechat-mp-profile-parser')

/** HTTP 超时（毫秒）—— 登录判定与资料抓取共用同一常量（单一真源，不各写一份） */
const HTTP_TIMEOUT_MS = 8000

/**
 * 将 Cookie 数组转为请求头 Cookie 字符串。
 * 住在这里而不是 http-login-checker.js：两个模块都要用，而依赖方向是
 * 「http-login-checker → http-profile-api」单向 —— 反过来 require 会成环。
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {string}
 */
function cookiesToHeader (cookies) {
  if (!Array.isArray(cookies)) return ''
  return cookies.filter(c => c && c.name && c.value).map(c => c.name + '=' + c.value).join('; ')
}

/**
 * 平台原生 ID（platform_uid）的取值原语拆到 ./platform-uid —— 三条取数通道
 * （json / html / cookie）必须共用同一份形态白名单与唯一性守卫；各写一份会让云端
 * 合并键的判定漂移，并被两侧单测互相印证为正确。
 */

// ─── 账号资料来源（昵称/头像/粉丝数/平台ID）─────────────────────────────
//
// 为什么与 HTTP_CHECK_APIS 分表（2026-10-22，PRD-ACCOUNT-PROFILE-AVATAR-2026-10-22）：
// 1) **关注点不同**。登录态检测回答「这批 Cookie 还活着吗」，账号资料回答
//    「这个账号叫什么、长什么样、有多少粉丝」。把两者塞进同一张表，后果是
//    登录判定端点被反向绑死成资料端点：抖音注册的 `/aweme/v1/creator/pc/user/info/`
//    只回 `{status_code, uid}`（**没有 user 对象**），于是资料提取恒空、
//    昵称永远回落成平台名；而真正带 user 对象的 `/web/api/media/user/info/`
//    反而没被登记。
// 2) **一套端点不够**。粉丝数与昵称常在不同端点（小红书昵称在 `galaxy/user/info`、
//    粉丝在 `galaxy/creator/home/personal_info`；头条昵称头像在 `get_media_info`、
//    粉丝在 `statistic/v2/fans/latest_stat`），且后一条可能依赖前一条的结果
//    （B 站 `relation/stat` 需要 nav 给出的 mid）。
// 3) 与仓库既有先例同型（api-publish-engine 的 `CAPABILITY_MATRIX` 与
//    `LOGIN_DETECTION` 分表，且注释明确写了「把两种词汇塞进平台行会引入第二套口径」）。
//
// 字段路径全部来自 **2026-10-22 真实服务端只读端点实测**（不是静态 bundle 推断）：
// 见 openspec/records/fix-account-profile-avatar.md 的取证表。
// 静态推断出的字段名已被实测推翻三处（小红书 nickname→userName、抖音 avatar_life→
// avatar_larger.url_list、抖音 data.user→顶层 user），故本表只写实测值。
//
// 契约：
// - 每个来源产出**只含命中键**的对象；未命中 = 键缺席 = 写回时「不修改」。
// - `url` 可以是函数，参数是**前面来源已合并的结果**（用于 B 站 mid 依赖）；
//   返回 null 表示「前置数据不足，跳过本来源」。
// - 一律只读端点，不得引入有副作用的端点。

const HTTP_PROFILE_APIS = {
  douyin: [
    {
      // 实测：顶层 `user` 对象（不是 data.user）。含 nickname / avatar_larger.url_list /
      // follower_count / uid。已登录时 status_code=0。
      url: 'https://creator.douyin.com/web/api/media/user/info/',
      headers: { Referer: 'https://creator.douyin.com/', Origin: 'https://creator.douyin.com' },
      extract: (d) => {
        const u = (d && d.user) || {}
        return {
          nickname: trimText(u.nickname),
          avatar: pickAvatarUrl(u.avatar_larger || u.avatar_medium || u.avatar_thumb),
          followers: toCount(u.follower_count),
          platformAccountId: normalizeUid(u.uid),
        }
      },
    },
  ],
  toutiao: [
    {
      // 实测：data.media.display_name（昵称）/ data.media.https_avatar_url（头像，
      // 注意字段名是「https_avatar_url」而不是「avatar_url」）/ data.media.id。
      url: 'https://mp.toutiao.com/mp/agw/media/get_media_info',
      headers: { Referer: 'https://mp.toutiao.com/profile_v4/graphic/publish' },
      extract: (d) => {
        const data = (d && d.data) || {}
        const m = data.media || {}
        const u = data.user || {}
        return {
          nickname: trimText(m.display_name || u.screen_name),
          avatar: trimText(m.https_avatar_url || m.https_display_avatar_url),
          // 与登录判定表同口径（data.user.id 已被生产真源证实存在），media.id 作为兜底。
          platformAccountId: normalizeUid(u.id || u.user_id || m.id || m.media_id),
        }
      },
    },
    {
      // 实测：粉丝数在另一个端点 —— data.fans_stat.total_fans_count。
      url: 'https://mp.toutiao.com/mp/agw/statistic/v2/fans/latest_stat',
      headers: { Referer: 'https://mp.toutiao.com/profile_v4/graphic/publish' },
      extract: (d) => {
        const s = (d && d.data && d.data.fans_stat) || {}
        return { followers: toCount(s.total_fans_count) }
      },
    },
  ],
  bilibili: [
    {
      // 实测：data.uname（昵称）/ data.face（头像）/ data.mid（平台ID）。
      // 注意 face 对「没设头像」的账号返回平台默认图 noface.jpg —— 那是该账号
      // 真实在用的头像，不当品牌图剔除（见 account-avatar-guard 的取舍说明）。
      url: 'https://api.bilibili.com/x/web-interface/nav',
      headers: { Referer: 'https://member.bilibili.com/' },
      precheck: (cookieHeader) => cookieHeader.includes('bili_jct='),
      extract: (d) => {
        const u = (d && d.data) || {}
        return {
          nickname: trimText(u.uname),
          avatar: trimText(u.face),
          platformAccountId: normalizeUid(u.mid),
        }
      },
    },
    {
      // 实测：粉丝数在 relation/stat，且必须带 vmid（= 上一个来源给出的 mid）。
      url: (resolved) => {
        const mid = resolved && resolved.platformAccountId
        if (!mid) return null
        return 'https://api.bilibili.com/x/relation/stat?vmid=' + encodeURIComponent(mid)
      },
      headers: { Referer: 'https://space.bilibili.com/' },
      extract: (d) => ({ followers: toCount(d && d.data && d.data.follower) }),
    },
  ],
  xiaohongshu: [
    {
      // 实测（B 阶段真实抓包 + 本轮实测互证）：data.userName（昵称）/
      // data.userAvatar（头像）/ data.redId（小红书号）。
      // ⚠️ 仓库里 xiaohongshu-capabilities.js 写的是 data.nickname / data.images，
      //    那是静态 bundle 推断，实测**不存在**（该模块的头像与昵称恒为空）。
      url: 'https://creator.xiaohongshu.com/api/galaxy/user/info',
      headers: { Referer: 'https://creator.xiaohongshu.com/creator/home' },
      extract: (d) => {
        const u = (d && d.data) || {}
        return {
          nickname: trimText(u.userName),
          avatar: trimText(u.userAvatar),
          // userId 是与 DOM 侧 data-account-id 同源的内部主键（保持既有 uid 语义），
          // redId 是用户面向的小红书号，作为兜底。
          platformAccountId: normalizeUid(u.userId || u.redId),
        }
      },
    },
    {
      // 实测：粉丝数在 personal_info —— data.fans_count（另有 follow_count / faved_count）。
      url: 'https://creator.xiaohongshu.com/api/galaxy/creator/home/personal_info',
      headers: { Referer: 'https://creator.xiaohongshu.com/creator/home' },
      extract: (d) => {
        const u = (d && d.data) || {}
        return { followers: toCount(u.fans_count) }
      },
    },
  ],
  zhihu: [
    {
      // 实测：/api/v4/me 是知乎自己的「当前登录用户」只读接口（200，含 name/avatar_url/
      // url_token/use_default_avatar）。⚠️ 仓库存量实现是从 SSR HTML 的
      // data-user-id 取 uid（那是内部 id），本表改用用户面向的 url_token。
      url: 'https://www.zhihu.com/api/v4/me',
      headers: { Referer: 'https://www.zhihu.com/', Accept: 'application/json' },
      extract: (d) => {
        const u = (d && typeof d === 'object' && !Array.isArray(d)) ? d : {}
        return {
          nickname: trimText(u.name),
          avatar: trimText(u.avatar_url || u.avatar_url_template),
          // id 是与 DOM 侧 data-user-id 同源的内部主键（保持既有 uid 语义），
          // url_token 是用户面向的短标识，作为兜底。
          platformAccountId: normalizeUid(u.id || u.url_token),
        }
      },
    },
  ],
  wechat_mp: [
    {
      // 公众号没有可用的 JSON user-info 端点（仓库既有结论，且本轮实测
      // cgi-bin/userinfo 返回 404）。昵称/头像/平台ID 全部取自**登录态同页**的
      // loginpage HTML：页面模板内嵌 `window.wx.commonData.data` 账号资料对象，
      // 字段含 `nick_name_decode` / `real_nick_name`（昵称）、`head_img` / `head_url`（头像）、
      // `uin`（平台ID）—— 2026-10-23 实测模板原文（见 parseWechatMpIdentity 的判据表）。
      //
      // ★ 头像**零新增请求**即可拿到：竞品逆向成果里的线索是另一个端点
      //   `misc/getheadimg?fakeid=`，但模板本身就带头像字段，用同一页更省且不引新端点。
      url: 'https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome',
      headers: { Referer: 'https://mp.weixin.qq.com/', Accept: 'text/html,application/xhtml+xml' },
      responseType: 'html',
      extract: (html) => {
        const id = parseWechatMpIdentity(html)
        // 解析器本身**无 logger**（同一段解析在登录判定侧也会被调用，副作用必须留在调用点）。
        // 告警只依赖 `id.reason`，**不再自己判登录页关键词**（CCG 评审 i5 / i7）：
        // ① 页面异常大 ⇒ 直接放弃解析，出声否则排查时看不到「为什么取不到」；
        // ② 页面**不像登录页**却一个身份字段都没解析出 ⇒ 多半是模板改版而非账号没登录，
        //    静默降级会让排查无从下手，故出声。
        //    「不像登录页」这件事由 reason 本身表达：登录页在解析器里短路成 reason='login_page'，
        //    走到这里的 identity_fields_* 只可能是「不是登录页却没解析出」。
        if (id.reason === 'page_too_large') {
          log.warn('HttpLoginChecker', 'wechat_mp: page too large, skip parse bytes=' + Buffer.byteLength(String(html || ''), 'utf8'))
        } else if (id.reason === 'identity_fields_missing' || id.reason === 'identity_fields_invalid') {
          log.warn('HttpLoginChecker', 'wechat_mp: loginpage looks signed-in but identity fields not parsed reason=' + id.reason + ' (template change?)')
        }
        const out = {}
        if (id.nickname) out.nickname = id.nickname
        if (id.avatar) out.avatar = id.avatar
        if (id.platformAccountId) out.platformAccountId = id.platformAccountId
        return out
      },
    },
  ],
  tencent_video: [
    {
      // 实测：data.finderUser.nickname（昵称）/ fansCount（粉丝）/ uniqId（平台ID）。
      // 该端点**不含头像** → 视频号头像仍来自 DOM。
      url: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data',
      headers: { Referer: 'https://channels.weixin.qq.com' },
      method: 'POST',
      contentType: 'application/json',
      body: () => JSON.stringify({ timestamp: Date.now().toString().substring(0, 13), _log_finder_uin: '', _log_finder_id: '', rawKeyBuff: null, pluginSessionId: null, scene: 7, reqScene: 7 }),
      extract: (d) => {
        const f = (d && d.data && d.data.finderUser) || {}
        return {
          nickname: trimText(f.nickname || f.finderUsername),
          followers: toCount(f.fansCount != null ? f.fansCount : f.fans_count),
          platformAccountId: normalizeUid(f.uniqId),
        }
      },
    },
  ],
  kuaishou: [
    {
      // 快手无可用的纯 HTTP 账号端点（数据端点需 __NS_sig3 签名，见 signer 目录），
      // 只登记 cookie 型平台ID来源；昵称/头像/粉丝仍走 DOM 采集。
      uidSource: 'cookie',
      extract: (_payload, cookies) => {
        if (!hasPlatformSessionCookie('kuaishou', cookies)) return {}
        const uid = normalizeUid(cookieValue(cookies, 'userId'))
        return uid ? { platformAccountId: uid } : {}
      },
    },
  ],
}

/** 从平台头像字段里取第一个可用的 URL（兼容 string / {url_list:[]} 两种形态） */

function scopedCookieHeader (platform, cookies, url) {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch (_) {
    return ''
  }
  if (!host) return ''
  const allowed = PLATFORM_COOKIE_DOMAINS[platform] || []
  const hostAllowed = allowed.some(domain => {
    const d = String(domain).toLowerCase()
    // baidu.com 父域条目只允许精确匹配（与 isPlatformCookieDomain 同一口径）
    if (d === 'baidu.com') return host === 'baidu.com'
    return host === d || host.endsWith('.' + d)
  })
  if (!hostAllowed) return ''
  const parts = []
  for (const c of cookies) {
    if (!c || !c.name || !c.value) continue
    const domain = String(c.domain || '').replace(/^\./, '').toLowerCase()
    // 无 domain 的 Cookie：**保留**。上游（getAccountPartitionCookies / 凭证快照）已按平台
    // 过滤过，缺 domain 只意味着这条记录没带域信息，不构成跨域风险；
    // 而在这里丢掉它会让真实请求拿不到会话 ⇒ 资料取不到。
    // 跨域泄露的主防线是上面的**平台域名闸门**（URL 主机不在平台域内 ⇒ 一个 Cookie 都不发）。
    if (!domain) { parts.push(c.name + '=' + c.value); continue }
    if (host === domain || host.endsWith('.' + domain)) parts.push(c.name + '=' + c.value)
  }
  return parts.join('; ')
}

/**
 * 把 extract 结果收口成 IPC/写回可用的对象：字段缺席 = 不修改（buildProfilePatch 语义）。
 * 空串昵称、空串 uid 一律不进结果，避免把上一次的真值反向清空。
 * @param {{nickname?:string,followers?:number,platformAccountId?:string,avatar?:string}} [info]
 * @returns {{supported: boolean, nickname?: string, followers?: number, platformAccountId?: string, avatar?: string}}
 */

function shapeInfoResult (info) {
  const out = { supported: true }
  if (!info || typeof info !== 'object') return out
  if (typeof info.nickname === 'string' && info.nickname.trim()) out.nickname = info.nickname.trim()
  // 粉丝数：必须是**有限非负数**（CCG 评审 i6）。`typeof === 'number'` 不够 ——
  // NaN 也是 number，写回后端会得到一个永远显示不出来的粉丝数。
  if (typeof info.followers === 'number' && Number.isFinite(info.followers) && info.followers >= 0) out.followers = info.followers
  if (typeof info.platformAccountId === 'string' && info.platformAccountId) out.platformAccountId = info.platformAccountId
  // 头像：2026-10-22 起纳入契约。此前 HTTP 通道**根本没有头像的位置**，
  // 于是所有走 HTTP 快速路径的平台（抖音/头条/B站/知乎/小红书）头像恒为空，
  // 账号卡上只能显示灰色通用头像。
  if (typeof info.avatar === 'string' && info.avatar.trim()) out.avatar = info.avatar.trim()
  return out
}

/**
 * 合并多个来源的资料结果：**先到先得**（先命中的字段不再被后一个来源覆盖）。
 * 先到先得而不是后者覆盖：不同来源覆盖的是**不同字段**（昵称/头像/粉丝各在一处），
 * 若让后到的空值覆盖先到的真值，就会把「有昵称」打回「无昵称」。
 * @param {object} acc
 * @param {object} next
 */

function mergeProfileFields (acc, next) {
  if (!next || typeof next !== 'object') return acc
  for (const key of ['nickname', 'avatar', 'followers', 'platformAccountId']) {
    if (acc[key] !== undefined) continue
    const value = next[key]
    if (value === undefined || value === null || value === '') continue
    acc[key] = value
  }
  return acc
}

/**
 * 用保存的 Cookie 调平台**只读**创作者 API 提取账号资料（昵称/头像/粉丝/平台ID）。
 *
 * 资料来源表是 `HTTP_PROFILE_APIS`（与登录判定表分表，理由见该表上方注释）：
 * 登录判定回答「Cookie 还活着吗」，资料提取回答「这个账号叫什么/长什么样/多少粉丝」，
 * 两者需要的端点与字段本就不同。
 *
 * 契约：
 * - 字段缺席 = 不修改（buildProfilePatch 语义），空值一律不产出；
 * - 任何异常/非 2xx/非对象响应 → 只返回已合并到的部分，不抛错；
 * - 只读端点，不引入有副作用的端点。
 *
 * 时延（CCG 评审 i7）：**互不依赖的来源并发取**，只有 `url` 是函数（依赖前序结果，
 * 例：B 站 relation/stat 需要 nav 给出的 mid）的来源才串行。
 * 串行取时最坏是「来源数 × 8s」线性累加（头条/小红书/B 站各 2 个来源），
 * 在批量检测里会明显拖慢；并发后最坏只剩「依赖链长度 × 8s」。
 * 合并顺序按**来源声明顺序**（Promise.all 保序），不按完成顺序 ——
 * 「先到先得」的语义必须与来源顺序一致，否则结果随网络抖动漂移。
 *
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {Promise<{supported: boolean, nickname?: string, followers?: number, platformAccountId?: string, avatar?: string}>}
 */

async function fetchAccountInfoViaHttpApi (platform, cookies) {
  const sources = HTTP_PROFILE_APIS[platform]
  if (!Array.isArray(sources) || sources.length === 0) return { supported: false }
  const cookieHeader = cookiesToHeader(cookies)
  if (!cookieHeader) return { supported: true }

  /** @type {{nickname?:string, avatar?:string, followers?:number, platformAccountId?:string}} */
  const merged = {}

  /** 取一个来源的字段（不发请求的 cookie 型来源直接本地派生） */
  const runSource = async (source) => {
    if (!source || typeof source.extract !== 'function') return {}
    // cookie 型来源（快手）：纯本地派生，绝不发网络请求
    if (source.uidSource === 'cookie') {
      return source.extract(null, Array.isArray(cookies) ? cookies : [])
    }
    if (typeof source.precheck === 'function' && !source.precheck(cookieHeader)) return {}
    // url 可以是函数：拿到前面来源的结果再决定（例如 B 站 relation/stat 需要 mid）
    const url = typeof source.url === 'function' ? source.url(merged) : source.url
    if (!url) return {}
    // 凭据出口：按目标主机过滤 + 平台域名闸门（详见 scopedCookieHeader 的注释）
    const scopedHeader = scopedCookieHeader(platform, cookies, url)
    if (!scopedHeader) {
      log.warn('HttpLoginChecker', 'profile source host not allowed, skip (no cookie sent): platform=' + platform + ' url=' + String(url).slice(0, 120))
      return {}
    }
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
    try {
      const fetchOptions = {
        method: source.method || 'GET',
        headers: {
          ...(source.headers || {}),
          Cookie: scopedHeader,
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
        },
        signal: controller.signal,
        redirect: 'manual'
      }
      if (source.method === 'POST') {
        fetchOptions.headers['Content-Type'] = source.contentType || 'application/json'
        fetchOptions.body = typeof source.body === 'function' ? source.body() : (source.body || '{}')
      }
      const response = await fetch(url, fetchOptions)
      clearTimeout(timer)
      // redirect:'manual' 下 3xx 的 ok 为 false → 与既有行为一致：不产出、不判失效
      if (!response.ok) return {}
      if (source.responseType === 'html') {
        const html = await response.text().catch(() => '')
        return source.extract(html)
      }
      const data = await response.json().catch(() => null)
      if (!data || typeof data !== 'object') return {}
      return source.extract(data)
    } catch (e) {
      clearTimeout(timer)
      // 单个来源失败不影响其它来源（粉丝数取不到不该把昵称一起丢掉）
      return {}
    }
  }

  // 按来源顺序切段：连续的「静态 url」来源合成一段并发跑；
  // 「动态 url」来源（依赖前序结果）单独一段，等前面的段合并完再跑。
  for (let i = 0; i < sources.length;) {
    if (typeof sources[i].url === 'function') {
      mergeProfileFields(merged, await runSource(sources[i]))
      i += 1
      continue
    }
    let end = i
    while (end < sources.length && typeof sources[end].url !== 'function') end += 1
    const group = sources.slice(i, end)
    const results = await Promise.all(group.map(runSource))
    for (const result of results) mergeProfileFields(merged, result)
    i = end
  }
  return shapeInfoResult(merged)
}


module.exports = {
  HTTP_PROFILE_APIS,
  fetchAccountInfoViaHttpApi,
  // 下面两个是**转出**（实现已搬到 ./profile-value-rules 与 ./wechat-mp-profile-parser）：
  // http-login-checker.js 一直从这里取，导出面保持不变 ⇒ 消费方零改动。
  parseWechatMpIdentity,
  toCount,
  cookiesToHeader,
  HTTP_TIMEOUT_MS,
}
