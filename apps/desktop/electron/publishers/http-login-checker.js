// @ts-check
/**
 * HTTP API 登录检测 — 用保存的 Cookie 直接调用平台内部 API 判断登录态
 *
 * 参考同类产品 checkAccountAlive 逆向：不打开浏览器窗口，纯 HTTP 请求，
 * 每次检测 <1 秒（浏览器窗口方案需 4-8 秒/平台）。
 *
 * API 端点来源：参考产品 4.0 逆向（packages/main/dist/index.cjs）。
 * 各平台判断逻辑采用黑名单语义：仅平台明确告知未登录才判失效；
 * 其余不确定响应（风控页/结构变更/非预期状态码）返回 undefined，
 * 由调用方（account-manager.checkLoginStatus）降级到浏览器检测，
 * 避免平台风控拦截检测请求时把有效 Cookie 误判为已失效（假阳性）。
 * - douyin: GET /aweme/v1/creator/pc/user/info/ → status_code === 0 且有 user
 *   数据判有效；status_code === 8 或 status_msg/msg 含「未登录」判失效
 *   （对齐参考产品 checkAccountAlive）；其余一切 → 不确定，降级
 * - toutiao: GET /mp/agw/media/get_media_info → code === 0 且有 user.id
 *
 * platform_uid（云端账号合并键，docs/adr/0004、PRD-CLOUD-ACCOUNT-SYNC §5.1）：
 * 账号管理的八个平台（douyin/toutiao/wechat_mp/tencent_video/bilibili/kuaishou/
 * xiaohongshu/zhihu）都必须在 HTTP_CHECK_APIS 里登记 extract；取不到 uid 时一律
 * 「不产出该键」，绝不用昵称或页面标题派生。覆盖完整性由结构锁
 * http-login-checker-uid-coverage.test.js 拦截（新增平台未补 uid 即红）。
 */
const log = require('../services/logger')
const {
  PLATFORM_DASHBOARD_URLS,
  hasPlatformSessionCookie,
} = require('@multi-publish/shared-utils/src/platform-definitions')

/**
 * @typedef {Object} HttpCheckApi
 * @property {string} [url] - 端点地址；只有 uid 提取通道（uidSource:'cookie'）可省略
 * @property {Record<string,string>} headers
 * @property {'GET'|'POST'} [method] - 默认 GET
 * @property {string|(() => string)} [body] - POST JSON body（视频号 auth_data）；
 *               函数形态在每次发请求时求值，含 timestamp 的接口必须用函数形态，
 *               否则时间戳会被模块加载时刻冻结（进程存活越久偏差越大，平台按
 *               时间戳校验失败 → 检测结论失真）
 * @property {string} [contentType] - POST Content-Type（默认 application/json）
 * @property {(data:any)=>boolean|undefined} [check] - JSON 响应判定；undefined=不确定（降级浏览器检测）；check 与 checkHtml 互斥
 * @property {(html:string)=>boolean|undefined} [checkHtml] - HTML 响应判定（公众号 loginpage 正则）；undefined=不确定（降级浏览器检测）
 * @property {(cookieHeader:string)=>boolean} [precheck] - 请求前 cookie 预检（如 bilibili 必须含 bili_jct）
 * @property {'json'|'html'|'cookie'} [uidSource] - extract 的取数来源（默认 json）：
 *               json=JSON 响应；html=HTML 响应文本（须与 checkHtml 同页，不另造端点）；
 *               cookie=不发请求，只从已保存凭证派生（云端同步合并键 platform_uid 用）
 * @property {(payload:any, cookies?:Array<{name:string,value:string}>)=>{nickname?:string,followers?:number,platformAccountId?:string,avatar?:string}} [extract]
 *               uid/资料提取器；取不到一律不产出键（禁止用昵称、页面标题等派生值冒充 platform_uid）
 */

/** 从平台响应字段安全取正整数计数（取不到返回 undefined，让调用方保持原值） */
function toCount (v) {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && v.trim() ? Number(v) : NaN)
  if (!Number.isFinite(n) || n < 0) return undefined
  return Math.round(n)
}

/**
 * 公众号 loginpage HTML 的身份解析 —— **唯一实现**。
 * 登录判定表（uid 提取）与账号资料表（昵称 + uid）读的是同一页，
 * 各写一份正则必然漂移（昵称抽到了但 uid 没抽到这类半命中最难查）。
 * @param {unknown} html
 * @returns {{nickname: string, platformAccountId: string}}
 */
function parseWechatMpIdentity (html) {
  if (!html || typeof html !== 'string') return { nickname: '', platformAccountId: '' }
  // 明确登录页形态优先短路：即便页面内出现示例 uin / nick_name 也不产出
  // （与 checkHtml 同一黑名单口径）
  if (/扫码登录|请使用微信扫码|请登录|welcome_login/.test(html)) return { nickname: '', platformAccountId: '' }
  const uinMatch = /uin:\s{0,}"([0-9]{3,})"/.exec(html)
  const uid = normalizeUid(uinMatch && uinMatch[1])
  const nickMatch = /nick_name\s*[:=]\s*"([^"]{1,40})"/.exec(html)
  const nickname = trimText(nickMatch && nickMatch[1])
  return { nickname, platformAccountId: uid }
}

/**
 * 平台原生 ID（platform_uid）的取值原语拆到 ./platform-uid —— 三条取数通道
 * （json / html / cookie）必须共用同一份形态白名单与唯一性守卫；各写一份会让云端
 * 合并键的判定漂移，并被两侧单测互相印证为正确。
 */
const { normalizeUid, cookieValue, extractUidFromHtml } = require('./platform-uid')
/** @type {Record<string, HttpCheckApi>} */
const HTTP_CHECK_APIS = {
  douyin: {
    url: 'https://creator.douyin.com/aweme/v1/creator/pc/user/info/',
    headers: {
      Referer: 'https://creator.douyin.com/creator-micro/home',
      Origin: 'https://creator.douyin.com'
    },
    check: (data) => {
      // 黑名单语义（对齐参考产品 checkAccountAlive）：只有平台明确告知
      // 未登录才判失效；风控拦截/结构变更/其他状态码一律返回 undefined
      // 交由调用方降级浏览器检测，避免把有效 Cookie 误判为已失效。
      if (!data || typeof data !== 'object') return undefined // 风控页/非 JSON → 不确定，降级
      // ⚠️ 断言变更（2026-10-22，带证据）：该端点的真实响应是**顶层** uid
      //    （实测 `{"status_code":0,"uid":"2232445177172442","…"}`），**没有 data 包装**。
      //    原实现只认 data.data.* ⇒ 恒返回 undefined ⇒ 抖音的 HTTP 快速路径恒不成立，
      //    永远降级浏览器检测（连带资料回填也从不触发）。此处补上顶层 uid 口径。
      if (data.status_code === 0 && (data.uid || (data.data && (data.data.uid || data.data.user_id || data.data.nickname !== undefined)))) return true
      if (data.status_code === 8) return false // 对齐参考产品 checkAccountAlive：8=明确未登录
      const msg = data.status_msg || data.msg || data.message
      if (typeof msg === 'string' && msg.includes('未登录')) return false
      return undefined // 其余一切（其他码/缺字段/结构变更）→ 不确定，降级
    },
    extract: (d) => {
      // 平台ID：与登录判定同源（顶层 uid）。
      const uid = normalizeUid(d && d.uid)
      return uid ? { platformAccountId: uid } : {}
    }
  },
  toutiao: {
    url: 'https://mp.toutiao.com/mp/agw/media/get_media_info',
    headers: {
      Referer: 'https://mp.toutiao.com/profile_v4/graphic/publish'
    },
    check: (data) => {
      // 黑名单语义：仅明确成功/明确未登录文案才给结论，其余降级浏览器检测
      if (!data || typeof data !== 'object') return undefined
      if (data.code === 0 && data.data && data.data.user && (data.data.user.id || data.data.user.user_id)) return true
      const msg = data.message || data.msg || data.status_msg
      if (typeof msg === 'string' && /未登录|请先登录|登录过期|重新登录/.test(msg)) return false
      return undefined
    },
    extract: (d) => {
      const u = (d && d.data && d.data.user) || {}
      return { nickname: u.name || u.screen_name || '', followers: toCount(u.fans_count != null ? u.fans_count : u.follower_count), platformAccountId: String(u.id || u.user_id || '') }
    }
  },
  // 公众号：对齐参考产品 getWeixingongzhonghaoUserInfo —— GET loginpage 页（带 cookie），
  // 登录态由 HTML 内嵌的 token=/uin:/nick_name 正则体现；未登录时这些字段缺失。
  // 这比「访问后台首页看是否 302」更可靠：Cookie（slave_sid）过期后访问 cgi-bin/home
  // 仍可能返回 200 渲染骨架，但 loginpage 页面未登录时不会内嵌 token。
  wechat_mp: {
    url: 'https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome',
    headers: {
      Referer: 'https://mp.weixin.qq.com/',
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    checkHtml: (html) => {
      // 黑名单语义：token+uin 同时存在判有效；明确登录页文案判失效；
      // 空响应/风控页/结构变更（无 token 也无登录特征）→ 不确定，降级浏览器检测
      if (!html || typeof html !== 'string') return undefined
      // 对齐参考产品正则：&token=[0-9a-zA-Z]{3,} 与 uin:"[0-9]{3,}" 同时存在 → 已登录
      const hasToken = /&token=[0-9a-zA-Z]{3,}/.test(html) || /token=[0-9a-zA-Z]{3,}/.test(html)
      const hasUin = /uin:\s{0,}"[0-9]{3,}"/.test(html)
      if (hasToken && hasUin) return true
      if (/扫码登录|请使用微信扫码|请登录|welcome_login/.test(html)) return false
      return undefined
    },
    // platform_uid（云端合并键）来源与登录判定**同源同页**：登录态页面才会内嵌
    // `uin:"<数字>"`（公众号账号原生 ID），未登录时该字段缺失——这正是 checkHtml
    // 用来判有效的同一份证据，因此不新增任何端点 URL。
    // 仓库内取证结论：没有可靠证据支撑一个 JSON user-info 端点（`cgi-bin/home` 类
    // 接口在 Cookie 过期后仍可能返回 200 渲染骨架，见上方注释；仓内亦无该端点的
    // 响应字段证据），故不编造 URL，改为读已注册 loginpage 的 HTML。
    // 可靠性等级：中高 —— uin 由平台自身写入、同一公众号在多设备/多次登录下稳定；
    // 尚未做真凭证线级取证（openspec add-cloud-account-sync tasks 3.6），且只覆盖
    // 「当前登录的这一个号」，取不到时如实走 uid 缺失分支（同步侧判 uid-unavailable）。
    uidSource: 'html',
    extract: (html) => {
      const id = parseWechatMpIdentity(html)
      return id.platformAccountId ? { platformAccountId: id.platformAccountId } : {}
    }
  },
  // 视频号：对齐参考产品 getShipinhaoUserInfo —— POST auth_data 接口（带 cookie），
  // errCode 300333/300334 判失效，data.finderUser 存在判有效。
  // 这比「访问后台首页看 302」更可靠，且渲染崩溃保护下视频号只能走 HTTP 检测。
  tencent_video: {
    url: 'https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data',
    headers: {
      Referer: 'https://channels.weixin.qq.com'
    },
    method: 'POST',
    contentType: 'application/json',
    // 必须是函数：HTTP_CHECK_APIS 是模块级常量，直接写 JSON.stringify(Date.now())
    // 只会在 require 时求值一次，之后所有检测都带着同一个陈旧 timestamp。
    body: () => JSON.stringify({ timestamp: Date.now().toString().substring(0, 13), _log_finder_uin: '', _log_finder_id: '', rawKeyBuff: null, pluginSessionId: null, scene: 7, reqScene: 7 }),
    check: (data) => {
      // 黑名单语义：errCode 300333/300334 = 登录失效（参考产品判定）；
      // finderUser 存在判有效；其余结构（接口变更/风控）→ 不确定，降级
      if (!data || typeof data !== 'object') return undefined
      if (data.errCode === 300333 || data.errCode === 300334) return false
      if (data.errCode === 0 && data.data && data.data.finderUser) return true
      return undefined
    },
    extract: (d) => {
      const f = (d && d.data && d.data.finderUser) || {}
      return { nickname: f.nickname || f.finderUsername || '', followers: toCount(f.fansCount != null ? f.fansCount : f.fans_count), platformAccountId: String(f.uniqId || '') }
    }
  },
  // bilibili：对齐参考产品 getBilibiliUserInfo —— GET nav 接口（带 cookie + Referer），
  // code === -101 判失效，data.mid 存在判有效；cookie 必须含 bili_jct（缺失即失效）。
  bilibili: {
    url: 'https://api.bilibili.com/x/web-interface/nav',
    headers: {
      Referer: 'https://member.bilibili.com/'
    },
    precheck: (cookieHeader) => cookieHeader.includes('bili_jct='),
    check: (data) => {
      // 黑名单语义：code -101 = 明确未登录；code 0 且有 mid 判有效；
      // 其余状态码（风控 -352 等/结构变更）→ 不确定，降级
      if (!data || typeof data !== 'object') return undefined
      if (data.code === -101) return false
      if (data.code === 0 && data.data && data.data.mid) return true
      return undefined
    },
    extract: (d) => {
      const u = (d && d.data) || {}
      return { nickname: u.uname || '', followers: toCount(u.fans), platformAccountId: String(u.mid || '') }
    }
  },
  // 快手：雷区平台（AGENTS.md 记录 2026-09-25 事故）。未登录与登录后都落在
  // cp.kuaishou.com/profile，URL 判定本质不可区分；数据端点 cp.kuaishou.com/graphql
  // （publish-monitor.js:22）与 __NS_sig3 签名绑定（signer-assembly.js:183、
  // api-publish-engine/src/signer-local.js getKuaishouSign），纯 HTTP 通道取不到，
  // 所以本平台**不注册登录检测端点**（无 url → hasLoginCheck 为 false，检测行为不变），
  // 只登记 cookie 型 uid 来源。
  // uid 取 `userId`：CDP 实测「登录成功后才写入」的身份 Cookie
  // （platform-definitions.js PLATFORM_SESSION_COOKIE_MARKERS 注释；learnings.md
  // 2026-09-25 条目同名取证）。先过 hasPlatformSessionCookie 门禁——未登录形态只有
  // did/wid/_did/divid/kwssectoken 这类埋点/设备标识，「有 Cookie」不等于「已登录」，
  // 一律不产出。可靠性等级：中高（键名有实测证据；其值是否严格等于平台原生主键
  // 仍待 tasks 3.6 线级取证，取不到时同步侧判 uid-unavailable 整体跳过上行）。
  kuaishou: {
    headers: {},
    uidSource: 'cookie',
    extract: (_payload, cookies) => {
      if (!hasPlatformSessionCookie('kuaishou', cookies)) return {}
      const uid = normalizeUid(cookieValue(cookies, 'userId'))
      return uid ? { platformAccountId: uid } : {}
    }
  },
  // 小红书：走平台自己的只读 user-info 接口（B 阶段真实抓包 + 2026-10-22 实测互证）。
  //
  // 断言/行为变更（2026-10-22，带证据）：此前本条**没有 check/checkHtml**，
  // 即 `hasLoginCheck` 为 false ⇒ 小红书永远走浏览器检测，而浏览器的昵称选择器
  // （`.user-name`）在创作后台 SPA 里不存在 ⇒ 昵称恒为空、恒回落成平台名「小红书」，
  // 资料回填也从不触发。改为登记 JSON 接口后：已登录时给出确定结论（快路径），
  // 资料回填随之生效；未登录/风控/结构变更一律返回 undefined（降级浏览器检测），
  // 绝不把不确定当失效。
  xiaohongshu: {
    url: 'https://creator.xiaohongshu.com/api/galaxy/user/info',
    headers: {
      Referer: 'https://creator.xiaohongshu.com/creator/home',
      Accept: 'application/json'
    },
    check: (d) => {
      if (!d || typeof d !== 'object') return undefined
      // 已登录：该接口回 success=true 且带身份字段（B 阶段 16 个只读端点全部 200 success=true）
      if (d.success === true && d.data && (d.data.userId || d.data.userName || d.data.redId)) return true
      // 其余一切（未登录页/风控/结构变更/非 JSON）→ 不确定，降级浏览器检测（黑名单语义）
      return undefined
    },
    uidSource: 'json',
    extract: (d) => {
      const u = (d && d.data) || {}
      // userId 是与 DOM 侧 data-account-id 同源的内部主键（保持既有 uid 语义）
      const uid = normalizeUid(u.userId || u.redId)
      return uid ? { platformAccountId: uid } : {}
    }
  },
  // 知乎：与小红书同走 HTML 身份属性通道（无仓库内取证的 JSON user-info 端点），
  // 端点用已注册主页 PLATFORM_DASHBOARD_URLS.zhihu。⛔ 禁止 document.title/og:title/
  // 昵称/头像等派生值冒充身份字段（PRD-CLOUD-ACCOUNT-SYNC §5.1），extract 缺席即不修改。
  zhihu: {
    url: PLATFORM_DASHBOARD_URLS.zhihu,
    headers: {
      Referer: PLATFORM_DASHBOARD_URLS.zhihu,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
    },
    // 2026-10-16 追加（渲染崩溃保护配套）：zhihu HTTP 检测此前恒 inconclusive ⇒ 启动批量
    // 校验降级到隐藏 sandbox 窗口加载 www.zhihu.com/signin ⇒ 原生渲染崩溃（exit 0xC0000409）；
    // account-manager 已把 zhihu 纳入渲染崩溃白名单，本判定让 HTTP 快速路径给出确定结论。
    // 判据（无 Cookie GET 实测）：登录容器 SignFlow/signqrcode/扫码登录/密码登录（未登录形态
    // 26 处命中）vs 已登录身份导航 AppHeader-profileAvatar/ProfileHeader（未登录形态 0 命中）。
    // 黑名单语义：明确未登录 false、明确已登录 true、其余/两者并存 → undefined（降级=白名单判未确认，绝不开窗）。行为向量见 account-manager-zhihu-render-crash.test.js。
    checkHtml: (html) => {
      if (!html || typeof html !== 'string') return undefined
      const hasLoginBox = /SignFlow|signqrcode|扫码登录|密码登录/.test(html)
      const hasIdentityNav = /AppHeader-profileAvatar|ProfileHeader/.test(html)
      if (hasLoginBox && hasIdentityNav) return undefined
      if (hasLoginBox) return false
      if (hasIdentityNav) return true
      return undefined
    },
    uidSource: 'html',
    extract: (html) => {
      const uid = extractUidFromHtml(html)
      return uid ? { platformAccountId: uid } : {}
    }
  }
}

/** 超时（毫秒）——HTTP API 检测应远快于浏览器窗口 */
const HTTP_CHECK_TIMEOUT_MS = 8000

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
      // cgi-bin/userinfo 返回 404）。昵称取自**登录态同页**的 loginpage HTML：
      // 页面模板内嵌 `nick_name`（见 mp.weixin.qq.com 自身模板与仓库既有夹具）。
      // 头像该页不提供 → 仍走 DOM 采集（img.user_avatar）。
      url: 'https://mp.weixin.qq.com/cgi-bin/loginpage?url=%2Fcgi-bin%2Fhome',
      headers: { Referer: 'https://mp.weixin.qq.com/', Accept: 'text/html,application/xhtml+xml' },
      responseType: 'html',
      extract: (html) => {
        const id = parseWechatMpIdentity(html)
        const out = {}
        if (id.nickname) out.nickname = id.nickname
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
function pickAvatarUrl (value) {
  if (typeof value === 'string') return trimText(value)
  if (!value || typeof value !== 'object') return ''
  const list = Array.isArray(value.url_list) ? value.url_list : null
  if (list) {
    for (const item of list) {
      const url = trimText(item)
      if (url) return url
    }
  }
  return trimText(value.url || value.uri || '')
}

/** 去掉首尾空白；非字符串一律返回空串（与 account-profile.trimText 同口径） */
function trimText (v) {
  return typeof v === 'string' ? v.trim() : ''
}

/**
 * 条目是否具备「登录检测」能力：必须有端点 URL 和一种判定函数。
 * 只有 uid 提取来源（uidSource:'cookie'，如快手）没有端点，不得被当成登录检测支持，
 * 否则 tryHttpLoginCheck 会对一个不存在的 URL 发请求并污染登录态结论。
 * @param {HttpCheckApi|undefined} api
 * @returns {boolean}
 */
function hasLoginCheck (api) {
  return Boolean(api && api.url && (typeof api.check === 'function' || typeof api.checkHtml === 'function'))
}

/**
 * 将 Cookie 数组转为请求头 Cookie 字符串
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {string}
 */
function cookiesToHeader (cookies) {
  if (!Array.isArray(cookies)) return ''
  return cookies.filter(c => c && c.name && c.value).map(c => c.name + '=' + c.value).join('; ')
}

/**
 * HTTP API 检测平台登录态（仅支持 HTTP_CHECK_APIS 中注册的平台）
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @returns {Promise<{supported: boolean, valid?: boolean, code?: string, error?: string}>}
 */
async function checkLoginViaHttpApi (platform, cookies) {
  const api = HTTP_CHECK_APIS[platform]
  if (!hasLoginCheck(api)) return { supported: false }

  const cookieHeader = cookiesToHeader(cookies)
  if (!cookieHeader) return { supported: true, valid: false, code: 'CHECK_LOGIN_NO_CREDENTIAL' }
  if (typeof api.precheck === 'function' && !api.precheck(cookieHeader)) {
    log.info('HttpLoginChecker', platform + ': cookie precheck failed (missing required key) → expired')
    return { supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS)
  try {
    const fetchOptions = {
      method: api.method || 'GET',
      headers: {
        ...api.headers,
        Cookie: cookieHeader,
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      },
      signal: controller.signal,
      redirect: 'manual'
    }
    if (api.method === 'POST') {
      fetchOptions.headers['Content-Type'] = api.contentType || 'application/json'
      fetchOptions.body = typeof api.body === 'function' ? api.body() : (api.body || '{}')
    }
    const response = await fetch(api.url, fetchOptions)
    clearTimeout(timer)

    // 3xx：Location 指向登录页 = Cookie 失效；其他重定向（含拿不到 Location）
    // 可能是风控跳转，不判失效 → 不确定，降级浏览器检测（黑名单语义）
    if (response.status === 301 || response.status === 302 || response.status === 303 || response.status === 307) {
      const location = response.headers.get('location') || ''
      if (/login|passport|signin|sso/i.test(location)) {
        log.info('HttpLoginChecker', platform + ': redirect to ' + location.slice(0, 80) + ' → expired')
        return { supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
      }
      log.info('HttpLoginChecker', platform + ': redirect to ' + location.slice(0, 80) + ' → inconclusive → fallback')
      return { supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
    }

    if (!response.ok) {
      // 401/403 = 平台明确未授权 → Cookie 失效；其余非 2xx（404/429/5xx 等）
      // 可能是风控/临时故障，不判失效 → 不确定，降级浏览器检测
      if (response.status === 401 || response.status === 403) {
        log.info('HttpLoginChecker', platform + ': HTTP ' + response.status + ' → expired')
        return { supported: true, valid: false, code: 'CHECK_LOGIN_COOKIE_EXPIRED' }
      }
      log.info('HttpLoginChecker', platform + ': HTTP ' + response.status + ' → inconclusive → fallback')
      return { supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
    }

    // HTML 响应判定（公众号 loginpage 正则）
    if (typeof api.checkHtml === 'function') {
      const html = await response.text().catch(() => '')
      const valid = api.checkHtml(html)
      if (valid === undefined) {
        // 判定不确定（风控页/结构变更/空响应）→ 不判失效，降级浏览器检测
        log.info('HttpLoginChecker', platform + ': HTML check → inconclusive (html len=' + html.length + ') → fallback')
        return { supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
      }
      log.info('HttpLoginChecker', platform + ': HTML check → ' + (valid ? 'valid' : 'expired') + ' (html len=' + html.length + ')')
      return { supported: true, valid, code: valid ? 'CHECK_LOGIN_SUCCESS_HTTP_API' : 'CHECK_LOGIN_COOKIE_EXPIRED' }
    }

    // JSON 响应判定
    const data = await response.json().catch(() => null)
    const valid = typeof api.check === 'function' ? api.check(data) : false
    if (valid === undefined) {
      // 判定不确定（风控页/结构变更/非预期状态码）→ 不判失效，降级浏览器检测
      log.info('HttpLoginChecker', platform + ': API check → inconclusive (data keys: ' + (data ? Object.keys(data).slice(0, 5).join(',') : 'null') + ')')
      return { supported: true, valid: undefined, code: 'CHECK_LOGIN_INCONCLUSIVE' }
    }
    log.info('HttpLoginChecker', platform + ': API check → ' + (valid ? 'valid' : 'expired') + ' (data keys: ' + (data ? Object.keys(data).slice(0, 5).join(',') : 'null') + ')')
    return { supported: true, valid, code: valid ? 'CHECK_LOGIN_SUCCESS_HTTP_API' : 'CHECK_LOGIN_COOKIE_EXPIRED' }
  } catch (e) {
    clearTimeout(timer)
    const isAbort = e && (e.name === 'AbortError' || e.name === 'TimeoutError')
    log.warn('HttpLoginChecker', platform + ': ' + (isAbort ? 'timeout' : 'error') + ' → ' + (e && e.message ? e.message : String(e)))
    // 网络错误不判失效，返回 unknown 让调用方降级到浏览器检测
    return { supported: true, valid: undefined, code: isAbort ? 'CHECK_LOGIN_HTTP_TIMEOUT' : 'CHECK_LOGIN_HTTP_ERROR', error: e && e.message }
  }
}

/**
 * 检查平台是否支持 HTTP API 检测
 * 注意：只登记了 uid 提取来源（无端点 URL）的平台（快手）在此返回 false，
 * 登录检测行为与登记 uid 之前完全一致。
 * @param {string} platform
 * @returns {boolean}
 */
function isHttpCheckSupported (platform) {
  return hasLoginCheck(HTTP_CHECK_APIS[platform])
}

/**
 * HTTP API 快速路径入口（供 checkLoginStatus 调用）。
 * 有 Cookie 且平台已注册时尝试 HTTP API 检测；返回 null 表示不适用
 * （无 Cookie/未注册）或结果不确定（网络错误），调用方降级到浏览器检测。
 * @param {string} platform
 * @param {Array<{name:string, value:string}>} cookies
 * @param {string} accountId
 * @returns {Promise<{valid:boolean, code:string}|null>}
 */
async function tryHttpLoginCheck (platform, cookies, accountId) {
  if (!cookies || cookies.length === 0 || !isHttpCheckSupported(platform)) return null
  const httpResult = await checkLoginViaHttpApi(platform, cookies)
  if (httpResult.valid === undefined) {
    log.info('HttpLoginChecker', 'inconclusive ' + platform + ':' + accountId + ' → falling back to browser check')
    return null
  }
  log.info('HttpLoginChecker', 'fast-path ' + platform + ':' + accountId + ' valid=' + httpResult.valid + ' code=' + httpResult.code)
  return { valid: httpResult.valid, code: httpResult.code }
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
  if (typeof info.followers === 'number') out.followers = info.followers
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
  for (const source of sources) {
    if (!source || typeof source.extract !== 'function') continue
    // cookie 型来源（快手）：纯本地派生，绝不发网络请求
    if (source.uidSource === 'cookie') {
      mergeProfileFields(merged, source.extract(null, Array.isArray(cookies) ? cookies : []))
      continue
    }
    if (typeof source.precheck === 'function' && !source.precheck(cookieHeader)) continue
    // url 可以是函数：拿到前面来源的结果再决定（例如 B 站 relation/stat 需要 mid）
    const url = typeof source.url === 'function' ? source.url(merged) : source.url
    if (!url) continue
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), HTTP_CHECK_TIMEOUT_MS)
    try {
      const fetchOptions = {
        method: source.method || 'GET',
        headers: {
          ...(source.headers || {}),
          Cookie: cookieHeader,
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
      if (!response.ok) continue
      if (source.responseType === 'html') {
        const html = await response.text().catch(() => '')
        mergeProfileFields(merged, source.extract(html))
        continue
      }
      const data = await response.json().catch(() => null)
      if (!data || typeof data !== 'object') continue
      mergeProfileFields(merged, source.extract(data))
    } catch (e) {
      clearTimeout(timer)
      // 单个来源失败不影响其它来源（粉丝数取不到不该把昵称一起丢掉）
    }
  }
  return shapeInfoResult(merged)
}

module.exports = {
  checkLoginViaHttpApi,
  isHttpCheckSupported,
  cookiesToHeader,
  tryHttpLoginCheck,
  fetchAccountInfoViaHttpApi,
  // 结构锁（http-login-checker-uid-coverage.test.js）需要遍历登记表本身；
  // uid 契约常量由 ./platform-uid 自己导出，锁直接指向那个模块，不在此转出口。
  HTTP_CHECK_APIS,
  HTTP_PROFILE_APIS,
}
