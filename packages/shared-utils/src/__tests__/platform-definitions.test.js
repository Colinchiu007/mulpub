import { describe, expect, it } from 'vitest'

import {
  PLATFORM_CREATOR_HOME_URLS,
  PLATFORM_DASHBOARD_URLS,
  PLATFORM_LOGIN_URLS,
  PLATFORM_LOGIN_SUCCESS_PATTERNS,
  PLATFORM_SESSION_COOKIE_MARKERS,
  hasPlatformSessionCookie,
  hasPlatformSessionCookieMarkers,
  isPlatformCookieDomain,
  isPlatformLeftLoginPage,
  isPlatformLoginSuccessUrl,
  sessionCookieNames,
} from '../platform-definitions.js'

describe('platform authentication URL boundaries', () => {
  it('only accepts a success URL on the platform allowlist', () => {
    expect(isPlatformLoginSuccessUrl('wechat_mp', 'https://mp.weixin.qq.com/cgi-bin/home')).toBe(true)
    expect(isPlatformLoginSuccessUrl('wechat_mp', 'https://evil.example/?next=mp.weixin.qq.com/cgi-bin/home')).toBe(false)
    expect(isPlatformLoginSuccessUrl('wechat_mp', 'https://mp.weixin.qq.com.evil.example/cgi-bin/home')).toBe(false)
  })

  it('does not treat the initial Zhihu sign-in page as a completed login', () => {
    expect(isPlatformLoginSuccessUrl('zhihu', 'https://www.zhihu.com/signin')).toBe(false)
    expect(isPlatformLoginSuccessUrl('zhihu', 'https://www.zhihu.com/creator')).toBe(true)
  })

  it('never treats a configured initial login URL as completed authentication', () => {
    for (const [platform, loginUrl] of Object.entries(PLATFORM_LOGIN_URLS)) {
      expect(isPlatformLoginSuccessUrl(platform, loginUrl), platform).toBe(false)
    }
  })

  it('accepts bilibili member.bilibili.com as a login-success URL (2026-09-09 fix)', () => {
    // Bilibili 登录后重定向到 member.bilibili.com（创作者中心），原配置只信任
    // www.bilibili.com/bilibili.com，导致 URL 自动完成检测失效、用户必须手动点击
    // "我已完成登录"。修复后在 AUTH_HOSTS 和 SUCCESS_PATTERNS 中增加该子域。
    expect(isPlatformLoginSuccessUrl('bilibili', 'https://member.bilibili.com/')).toBe(true)
    expect(isPlatformLoginSuccessUrl('bilibili', 'https://member.bilibili.com/platform/home')).toBe(true)
    expect(isPlatformLoginSuccessUrl('bilibili', 'https://passport.bilibili.com/login')).toBe(false)
    expect(isPlatformLoginSuccessUrl('bilibili', 'https://www.bilibili.com/')).toBe(true)
    // 安全性：非 bilibili 域名即使包含 member.bilibili.com 关键词也不应通过
    expect(isPlatformLoginSuccessUrl('bilibili', 'https://evil.example/?next=member.bilibili.com')).toBe(false)
    expect(isPlatformLoginSuccessUrl('bilibili', 'https://member.bilibili.com.evil.example/')).toBe(false)
  })

  it('never auto-completes Baijiahao from URL alone (login page and creator home share the same host)', () => {
    // 2026-08-12 实测：未登录访问 https://baijiahao.baidu.com/ 会 302 到
    // /pcui/register/index，最终落在 /builder/theme/bjh/login（登录/注册页）。
    // 登录页与创作后台同域，URL 嗅探不可靠 → 百家号关闭 URL 自动完成（fail-closed），
    // 必须由用户点击“我已完成登录”并在提取到真实凭证后完成入库。
    expect(isPlatformLoginSuccessUrl('baijiahao', 'https://baijiahao.baidu.com/')).toBe(false)
    expect(isPlatformLoginSuccessUrl('baijiahao', 'http://baijiahao.baidu.com/pcui/register/index')).toBe(false)
    expect(isPlatformLoginSuccessUrl('baijiahao', 'https://baijiahao.baidu.com/builder/theme/bjh/login')).toBe(false)
    expect(isPlatformLoginSuccessUrl('baijiahao', 'https://baijiahao.baidu.com/bjh/author/index')).toBe(false)
  })

  it('never auto-completes Toutiao from the login page (login page and creator home share the same host)', () => {
    // 2026-09-13 实测：未登录访问 https://mp.toutiao.com/ 会 302 到 /login。
    // 登录页与创作后台同域，裸域名模式会把登录页误判为“登录成功”，
    // 导致登录视图提前关闭并保存无效账号。登录成功后的创作者中心路径为
    // /profile_v4/...，据此精确匹配。
    expect(isPlatformLoginSuccessUrl('toutiao', 'https://mp.toutiao.com/login')).toBe(false)
    expect(isPlatformLoginSuccessUrl('toutiao', 'https://mp.toutiao.com/login?redirect_url=...')).toBe(false)
    expect(isPlatformLoginSuccessUrl('toutiao', 'https://mp.toutiao.com/profile_v4/graphic/publish')).toBe(true)
    expect(isPlatformLoginSuccessUrl('toutiao', 'https://mp.toutiao.com/profile_v4/')).toBe(true)
    // 安全性：非 toutiao 域名即使包含 profile_v4 关键词也不应通过
    expect(isPlatformLoginSuccessUrl('toutiao', 'https://evil.example/?next=profile_v4')).toBe(false)
  })

  it('never auto-completes Tencent Video from the login page (login page and creator home share the same host)', () => {
    // 2026-09-14 实测：视频号登录页为 channels.weixin.qq.com/login.html（参考产品
    // authorizeUrl 同款），裸域名模式会把登录页误判为“登录成功”，导致登录视图
    // 提前关闭并保存只有预登录 localStorage 的无 Cookie 凭证（E2E 实测 cookies=0）。
    // 登录成功后的创作者后台路径为 /platform，据此精确匹配。
    expect(isPlatformLoginSuccessUrl('tencent_video', 'https://channels.weixin.qq.com/login.html')).toBe(false)
    expect(isPlatformLoginSuccessUrl('tencent_video', 'https://channels.weixin.qq.com/')).toBe(false)
    expect(isPlatformLoginSuccessUrl('tencent_video', 'https://channels.weixin.qq.com/platform')).toBe(true)
    expect(isPlatformLoginSuccessUrl('tencent_video', 'https://channels.weixin.qq.com/platform/post/create')).toBe(true)
    // 安全性：非 channels 域名即使包含 platform 关键词也不应通过
    expect(isPlatformLoginSuccessUrl('tencent_video', 'https://evil.example/?next=channels.weixin.qq.com/platform')).toBe(false)
  })

  it('never auto-completes Kuaishou from its passport login host (2026-09-25 实测)', () => {
    // 实测：登录视图打开 cp.kuaishou.com/ 后被前端带到
    // passport.kuaishou.com/pc/account/login/（该页 <title>「快手，记录世界 记录你」
    // 正是误入库账号名）。passport 是纯登录域，任何路径都不可能是登录成功信号；
    // 登录成功后平台自己的回调会把浏览器送回 cp.kuaishou.com。
    expect(isPlatformLoginSuccessUrl('kuaishou', 'https://passport.kuaishou.com/')).toBe(false)
    expect(isPlatformLoginSuccessUrl(
      'kuaishou',
      'https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api&callback=https%3A%2F%2Fcp.kuaishou.com%2Frest%2Finfra%2Fsts',
    )).toBe(false)
    // 回落创作者后台才算登录成功（真实会话凭证由 hasPlatformSessionCookie 把守）
    expect(isPlatformLoginSuccessUrl('kuaishou', 'https://cp.kuaishou.com/profile')).toBe(true)
    // 安全性：非 kuaishou 域名即使包含 passport 关键词也不应通过
    expect(isPlatformLoginSuccessUrl('kuaishou', 'https://evil.example/?next=passport.kuaishou.com')).toBe(false)
  })

  it('recognizes explicit YouTube OAuth completion and X success pages without accepting login pages', () => {
    expect(isPlatformLoginSuccessUrl('youtube', 'https://accounts.google.com/o/oauth2/approval?state=done')).toBe(true)
    expect(isPlatformLoginSuccessUrl('youtube', 'https://accounts.google.com/ServiceLogin?service=youtube')).toBe(false)
    expect(isPlatformLoginSuccessUrl('youtube', 'https://accounts.google.com.evil.example/o/oauth2/approval')).toBe(false)
    expect(isPlatformLoginSuccessUrl('twitter', 'https://x.com/home')).toBe(true)
    expect(isPlatformLoginSuccessUrl('twitter', 'https://x.com/explore')).toBe(true)
    expect(isPlatformLoginSuccessUrl('twitter', 'https://x.com/i/flow/login')).toBe(false)
  })

  it('only preserves cookies belonging to the selected platform', () => {
    expect(isPlatformCookieDomain('wechat_mp', '.mp.weixin.qq.com')).toBe(true)
    expect(isPlatformCookieDomain('wechat_mp', '.qq.com')).toBe(false)
    expect(isPlatformCookieDomain('tencent_video', '.qq.com')).toBe(false)
    expect(isPlatformCookieDomain('baijiahao', '.baidu.com')).toBe(true)
    expect(isPlatformCookieDomain('baijiahao', '.passport.baidu.com')).toBe(true)
    expect(isPlatformCookieDomain('baijiahao', '.evil.baidu.com')).toBe(false)
    expect(isPlatformCookieDomain('youtube', '.google.com')).toBe(false)
    expect(isPlatformCookieDomain('baijiahao', '.baijiahao.baidu.com')).toBe(true)
    expect(isPlatformCookieDomain('youtube', '.studio.youtube.com')).toBe(true)
    expect(isPlatformCookieDomain('youtube', '.accounts.google.com')).toBe(true)
    expect(isPlatformCookieDomain('wechat_mp', '.com')).toBe(false)
    expect(isPlatformCookieDomain('wechat_mp', '.evil.example')).toBe(false)
    expect(isPlatformCookieDomain('zhihu', '.weibo.com')).toBe(false)
  })

  it('requires real session cookies before completing a Kuaishou login (2026-09-25 实测)', () => {
    // 未登录访问 cp.kuaishou.com 时 DevTools 实际可见的 Cookie 名（登录页也有 9 个 Cookie，
    // 正是这批被误当凭证入库的埋点/风控标识）。
    const anonymous = ['did', 'wid', 'kwssectoken', 'kwpsecproductname', 'kwfv1', 'kwscode', '_did', 'divid']
      .map(name => ({ name, value: 'anon-value' }))
    expect(hasPlatformSessionCookie('kuaishou', anonymous)).toBe(false)

    // 登录成功后平台才写入的会话票据 / 身份标识
    expect(hasPlatformSessionCookie('kuaishou', [...anonymous, { name: 'kuaishou.web.cp.api_st', value: 'ST-123' }])).toBe(true)
    expect(hasPlatformSessionCookie('kuaishou', [{ name: 'userId', value: '1234567890' }])).toBe(true)

    // 空值/空白不算登录态：占位 Cookie 不得放行（正是"假成功"的形态）
    expect(hasPlatformSessionCookie('kuaishou', [{ name: 'userId', value: '' }])).toBe(false)
    expect(hasPlatformSessionCookie('kuaishou', [{ name: 'bUserId', value: '   ' }])).toBe(false)
    expect(hasPlatformSessionCookie('kuaishou', [])).toBe(false)
    expect(hasPlatformSessionCookie('kuaishou', undefined)).toBe(false)

    // 未声明标记的平台沿用既有行为，本次改动不扩大爆炸半径
    // 2026-09-27：douyin 已声明会话标记，不再是「沿用宽松行为」的代表；空集合必须判未登录
    expect(hasPlatformSessionCookie('douyin', [])).toBe(false)
    expect(hasPlatformSessionCookie('wechat_mp', [{ name: 'anything', value: 'v' }])).toBe(true)
  })

  // ─── 会话标记表自身的形态契约（PRD-CLOUD-ACCOUNT-SYNC §5.1 / adr/0004 前置）───
  // 快手的 platform_uid 只能来自「登录成功后才写入」的身份 Cookie，而这张表就是
  // 「登录成功后才出现」的唯一起点证据；表本身退化（混入埋点/设备标识）会让下游
  // 所有把守点（auth-view-manager / qrcode-login / credential-saver / account-manager
  // captureCookies，以及 http-login-checker 的 cookie 型 uid 提取）同时失效，
  // 所以这里锁的是表，不是某一个调用点。
  const DEVICE_OR_TRACKING_NAMES = [
    'did', '_did', 'wid', 'divid', 'uuid', 'guid', 'webId', 'gid', 'clientid',
    'kwssectoken', 'kwpsecproductname', 'kwfv1', 'kwscode',
  ]
  // 结构化正向契约（不是逐个坏值列举）：标记名必须显式承载「会话票据 / 用户身份」语义
  const SESSION_MARKER_SHAPE =
    /user[-_.]?id|(^|[._-])(st|sid|auth|token|tk)([._-]|$)|(^|[._-])sess|session_?id|(^|[._-])uid([._-]|$)/i

  it('会话标记表非空，且每个平台的每个标记名都承载「会话票据/用户身份」语义', () => {
    const platforms = Object.keys(PLATFORM_SESSION_COOKIE_MARKERS)
    // 规模下界：解析退化成空集合会让本锁假绿
    expect(platforms.length).toBeGreaterThanOrEqual(1)
    expect(PLATFORM_SESSION_COOKIE_MARKERS.kuaishou.length).toBeGreaterThanOrEqual(1)
    for (const platform of platforms) {
      const markers = PLATFORM_SESSION_COOKIE_MARKERS[platform]
      expect(Array.isArray(markers), platform + ' 标记表必须是数组').toBe(true)
      expect(markers.length, platform + ' 标记表不得为空').toBeGreaterThanOrEqual(1)
      for (const marker of markers) {
        expect(DEVICE_OR_TRACKING_NAMES, platform + ' 混入了设备/埋点标识: ' + marker).not.toContain(marker)
        expect(marker, platform + ' 的标记名不承载会话/身份语义: ' + marker).toMatch(SESSION_MARKER_SHAPE)
      }
    }
  })


  it('形态规则负控：设备/埋点标识一律不得匹配（泛化 uid/sess 后仍拒之）', () => {
    // 2026-09-27 为接纳 uid_tt / SESSDATA / x-user-id-* 泛化了形态规则，这里钉住泛化的边界：
    // uuid/guid 里的 "uid" 前面不是分隔符，buvid3 同理，故仍被拒绝。名单取自实测匿名基线。
    const rejected = ['did', '_did', 'wid', 'divid', 'uuid', 'guid', 'webId', 'gid', 'clientid',
      'ttwid', 's_v_web_id', 'buvid3', 'buvid4', 'buvid_fp', '_uuid', 'b_nut', 'odin_tt',
      'd_ticket', 'n_mh', 'acw_tc', 'ets', 'loadts', 'a1', 'xsecappid', 'websectiga',
      'sec_poison_id', 'gfkadpd', 'gd_random', 'bit_env', 'gulu_source_res', 'sdk_source_info',
      '_tea_utm_cache_2906', '__snaker__id', 'gdxidpyhxdE', 'captcha_ticket_v2', '_xsrf',
      'webBuild', 'b_lsid', 'biz_trace_id', 'bd_ticket_guard_client_data', 'home_feed_column',
      'bili_ticket', 'bili_ticket_expires']
    for (const name of rejected) {
      expect(SESSION_MARKER_SHAPE.test(name), name + ' 不得匹配会话形态').toBe(false)
    }
  })


  it('泛化 sess 前缀后放弃了尾部边界——这是有意的弱化，由 A−B 兜住', () => {
    // 旧规则要求 sess 后紧跟分隔符或串尾，为接纳 B 站 SESSDATA 去掉了该约束。
    // 代价是 _sessview 这类名字也能过形态检查：形态规则因此只是**必要条件**，
    // 充分性一律由「实测 A−B 差集 + 墓碑名单」承担。此断言锁的是这个已知弱化，不是回归。
    expect(SESSION_MARKER_SHAPE.test('_sessview')).toBe(true)
    expect(SESSION_MARKER_SHAPE.test('sess_context_abuse')).toBe(true)
    for (const markers of Object.values(PLATFORM_SESSION_COOKIE_MARKERS)) {
      expect(markers.some(n => /^_?sess(view|_context)/i.test(n))).toBe(false)
    }
  })
  it('形态规则只是必要条件：长得像票据但实测匿名也会种的键不得进表', () => {
    // passport_csrf_token / csrf_session_id / passport_auth_mix_state 在形态上会被
    // SESSION_MARKER_SHAPE 放过，但 2026-09-27 匿名基线实测证明它们在未登录时也存在。
    // 充分性由 A−B 实测差集承担，不靠形态猜——这一条就是那批「形态过、实测不过」的键的墓碑。
    const lookalikes = ['SESSIONID', 'passport_csrf_token', 'passport_csrf_token_default',
      'csrf_session_id', 'passport_auth_mix_state']
    for (const name of lookalikes) {
      expect(SESSION_MARKER_SHAPE.test(name), name + ' 形态上确实像票据').toBe(true)
      for (const markers of Object.values(PLATFORM_SESSION_COOKIE_MARKERS)) {
        expect(markers, name + ' 不得出现在任何平台的标记表里').not.toContain(name)
      }
    }
  })
  it('快手 uid 可用的身份标记就是表里那条 userId（与 CDP 实测同一份证据）', () => {
    // http-login-checker 的 kuaishou uid 来源（cookie `userId`）不得自立一套键名：
    // 该键必须同时是「登录态标记」，否则它随时可能变成又一个匿名设备标识。
    expect(PLATFORM_SESSION_COOKIE_MARKERS.kuaishou).toContain('userId')
    expect(hasPlatformSessionCookie('kuaishou', [{ name: 'userId', value: '5321009876543' }])).toBe(true)
  })

  it('快手登录页形态（cp 域同 URL + 只有埋点 Cookie）既不算登录成功，也凑不出任何会话标记', () => {
    // 2026-09-25 事故形态复现：登录视图停在 passport 登录域，或停在 cp.kuaishou.com/profile
    // 的营销壳上，此时 9 个 Cookie 全是匿名埋点。两个门禁必须同时拒绝。
    const anonymousLoginShell = ['did', 'wid', '_did', 'divid', 'kwssectoken', 'kwpsecproductname', 'kwfv1', 'kwscode']
      .map(name => ({ name, value: 'anon-value' }))
    expect(isPlatformLoginSuccessUrl('kuaishou', 'https://passport.kuaishou.com/pc/account/login/')).toBe(false)
    expect(hasPlatformSessionCookie('kuaishou', anonymousLoginShell)).toBe(false)
    // 只有 URL 到位（可被判「成功」）而标记缺失时，标记门禁仍是最后一道闸
    expect(isPlatformLoginSuccessUrl('kuaishou', 'https://cp.kuaishou.com/profile')).toBe(true)
    expect(hasPlatformSessionCookie('kuaishou', anonymousLoginShell)).toBe(false)
    // 埋点标识冒充身份：值再像 ID 也不算登录态
    expect(hasPlatformSessionCookie('kuaishou', [{ name: 'did', value: '5321009876543' }])).toBe(false)
    expect(hasPlatformSessionCookie('kuaishou', [{ name: 'divid', value: '5321009876543' }])).toBe(false)
  })
})

// 登录页指纹否决层：成功模式为裸域名（host-only）的平台，URL 判定本质上把「该平台的
// 任意页面」都当成登录成功，登录页自身也不例外。百家号/头条/视频号/快手此前是逐个手工
// 收紧的，本 describe 锁的是泛化形态规则（路径含 login/passport/sso 等登录页指纹即否决）。
describe('login-page fingerprint deny (裸域名成功平台的登录页不算成功)', () => {
  // 逐平台负例：AGENTS.md「平台登录成功判定合同」要求改任一平台判定必须留一条负例。
  // 地址来源见每条注释，未实测的只用作形态负例（断言的是「含登录页指纹即否决」这条规则）。
  it('xiaohongshu: 登录页不算成功（2026-09-26 用户实测 creator.xiaohongshu.com/login）', () => {
    expect(isPlatformLoginSuccessUrl('xiaohongshu', 'https://creator.xiaohongshu.com/login')).toBe(false)
    expect(isPlatformLoginSuccessUrl('xiaohongshu', 'https://creator.xiaohongshu.com/login/?from=creator')).toBe(false)
    // 登录成功后的创作页不受影响
    expect(isPlatformLoginSuccessUrl('xiaohongshu', 'https://creator.xiaohongshu.com/new/home')).toBe(true)
  })

  it('douyin: 登录页与 passport 跳板不算成功（形态负例，2026-09-26 curl 确认可达）', () => {
    expect(isPlatformLoginSuccessUrl('douyin', 'https://www.douyin.com/login/')).toBe(false)
    expect(isPlatformLoginSuccessUrl('douyin', 'https://creator.douyin.com/passport/page_login/')).toBe(false)
    expect(isPlatformLoginSuccessUrl('douyin', 'https://creator.douyin.com/creator-micro/home')).toBe(true)
  })

  it('instagram: 登录页及其任意变体不算成功（裸模式 instagram.com/ 曾命中所有路径）', () => {
    expect(isPlatformLoginSuccessUrl('instagram', 'https://www.instagram.com/accounts/login/')).toBe(false)
    expect(isPlatformLoginSuccessUrl('instagram', 'https://www.instagram.com/accounts/login/?next=%2F')).toBe(false)
    expect(isPlatformLoginSuccessUrl('instagram', 'https://www.instagram.com/')).toBe(true)
  })

  it('facebook: 登录页及其设备分支跳转不算成功（裸模式 facebook.com/ 曾命中所有路径）', () => {
    expect(isPlatformLoginSuccessUrl('facebook', 'https://www.facebook.com/login/')).toBe(false)
    expect(isPlatformLoginSuccessUrl('facebook', 'https://www.facebook.com/login/device-based/regular/login/')).toBe(false)
    expect(isPlatformLoginSuccessUrl('facebook', 'https://www.facebook.com/')).toBe(true)
  })

  it('youtube: Google 登录页不再被当成登录成功（2026-09-26 实测未登录 302 到 v3/signin/identifier）', () => {
    expect(isPlatformLoginSuccessUrl('youtube',
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fstudio.youtube.com%2F&flowEntry=ServiceLogin')).toBe(false)
    // 已声明为成功模式的 OAuth 授权页不得被否决层误杀（登录成功回跳点）
    expect(isPlatformLoginSuccessUrl('youtube', 'https://accounts.google.com/o/oauth2/approval?state=done')).toBe(true)
  })

  it('否决层不吞掉非登录路径，也不放宽域名边界', () => {
    expect(isPlatformLoginSuccessUrl('bilibili', 'https://www.bilibili.com/')).toBe(true)
    expect(isPlatformLoginSuccessUrl('xiaohongshu', 'https://creator.xiaohongshu.com.evil.example/login')).toBe(false)
    expect(isPlatformLoginSuccessUrl('xiaohongshu', 'https://evil.example/?next=creator.xiaohongshu.com/login')).toBe(false)
    // 否决只看路径，query 里出现 login 不足以判成登录页（OAuth 回跳常把登录地址放在参数里）
    expect(isPlatformLoginSuccessUrl('instagram', 'https://www.instagram.com/?next=%2Faccounts%2Flogin%2F')).toBe(true)
    // 反之 query 不能把非可信域洗成成功
    expect(isPlatformLoginSuccessUrl('instagram', 'https://evil.example/?next=www.instagram.com%2F')).toBe(false)
  })

  it('全部平台的配置登录页一律不算登录成功（含否决层生效对照）', () => {
    for (const [platform, loginUrl] of Object.entries(PLATFORM_LOGIN_URLS)) {
      expect(isPlatformLoginSuccessUrl(platform, loginUrl), platform).toBe(false)
    }
  })
})

// 采集侧（Playwright captureCookies「方式 2」）判据：离开登录页 ≠ 已登录，
// 必须落在平台可信域且不是登录/passport 页，才允许结束等待。
describe('isPlatformLeftLoginPage (captureCookies 方式2 判据)', () => {
  it('rejects navigating onto a pure login host (2026-09-26 快手事故形态)', () => {
    // 快手：cp.kuaishou.com/ → passport.kuaishou.com/pc/account/login 是「正在登录」，
    // 旧判据只看 host 变化，点一下登录按钮即满足并采到全是埋点 Cookie。
    expect(isPlatformLeftLoginPage('kuaishou',
      'https://passport.kuaishou.com/pc/account/login/?sid=kuaishou.web.cp.api&callback=https%3A%2F%2Fcp.kuaishou.com%2Frest%2Finfra%2Fsts')).toBe(false)
    // 同域内导航（含登录成功后的 /profile）不算「离开」，交给选择器与会话标记判定
    expect(isPlatformLeftLoginPage('kuaishou', 'https://cp.kuaishou.com/profile')).toBe(false)
  })

  it('rejects login pages on trusted hosts', () => {
    expect(isPlatformLeftLoginPage('youtube',
      'https://accounts.google.com/v3/signin/identifier?continue=https%3A%2F%2Fstudio.youtube.com%2F')).toBe(false)
    expect(isPlatformLeftLoginPage('bilibili', 'https://passport.bilibili.com/login')).toBe(false)
    expect(isPlatformLeftLoginPage('twitter', 'https://twitter.com/i/flow/login')).toBe(false)
  })

  it('accepts a real navigation to another trusted platform host', () => {
    expect(isPlatformLeftLoginPage('bilibili', 'https://www.bilibili.com/')).toBe(true)
    expect(isPlatformLeftLoginPage('twitter', 'https://x.com/home')).toBe(true)
    expect(isPlatformLeftLoginPage('weibo', 'https://www.weibo.com/hot')).toBe(true)
  })

  it('rejects untrusted hosts and garbage input', () => {
    expect(isPlatformLeftLoginPage('kuaishou', 'https://evil.example/done')).toBe(false)
    expect(isPlatformLeftLoginPage('kuaishou', 'not a url')).toBe(false)
    expect(isPlatformLeftLoginPage('kuaishou', '')).toBe(false)
    expect(isPlatformLeftLoginPage('kuaishou', undefined)).toBe(false)
    expect(isPlatformLeftLoginPage('unknown_platform', 'https://x.com/home')).toBe(false)
    expect(isPlatformLeftLoginPage('kuaishou', 'javascript:alert(1)')).toBe(false)
  })
})

// 会话标记的取证契约：标记必须「真实登录视图里有、匿名基线里没有」。
// 两侧夹具都不是手抄的：A 取自本机登录视图分区（只读 node:sqlite，SELECT 列表不含值列），
// B 由同版本 electron.exe 在全新隔离分区匿名访问「登录页 + 创作者首页」实测（UA 复刻
// startup-compat.configureUserAgentFallback 的净化口径）。任何一侧漂移——平台改了埋点、
// 或有人把标记换成匿名也会种的键（B 站 bili_ticket 正是这种陷阱）——都会在这里变红。
describe('session-marker evidence contract (实测 A/B 夹具)', () => {

  describe('douyin', () => {
    // A = 本机登录视图分区 auth-auth-douyin-1790348243918（只读采集，不含值列）；B = 本机匿名实测基线
    const A = ['__security_mc_1_s_sdk_cert_key', '__security_mc_1_s_sdk_crypt_sdk',
      '__security_mc_1_s_sdk_sign_data_key_web_protect', '__security_server_data_status',
      '_bd_ticket_crypt_cookie', '_bd_ticket_crypt_doamin', '_tea_utm_cache_2906',
      'bd_ticket_guard_client_data', 'bd_ticket_guard_client_web_domain',
      'bd_ticket_guard_regenerate_keys_time', 'bit_env', 'd_ticket', 'gd_random', 'gfkadpd',
      'gulu_source_res', 'has_biz_token', 'is_dbsc', 'is_staff_user', 'n_mh', 'odin_tt',
      'passport_assist_user', 'passport_auth_mix_state', 'passport_auth_status',
      'passport_auth_status_ss', 'passport_csrf_token', 'passport_csrf_token_default',
      'passport_mfa_token', 's_v_web_id', 'sdk_source_info', 'session_tlb_tag', 'sessionid',
      'sessionid_ss', 'sid_guard', 'sid_tt', 'sid_ucp_v1', 'ssid_ucp_v1', 'ttwid', 'uid_tt',
      'uid_tt_ss', 'x_tt_token']
    const B = ['__security_mc_1_s_sdk_crypt_sdk', '_tea_utm_cache_2906',
      'bd_ticket_guard_client_data', 'bd_ticket_guard_client_web_domain',
      'bd_ticket_guard_regenerate_keys_time', 'bit_env', 'biz_trace_id', 'csrf_session_id',
      'gd_random', 'gfkadpd', 'gulu_source_res', 'passport_auth_mix_state',
      'passport_csrf_token', 'passport_csrf_token_default', 's_v_web_id', 'sdk_source_info',
      'ttwid']
    it('实测差集 A−B 逐字钉住（平台改埋点即红）', () => {
      expect(A.filter(n => !B.includes(n))).toEqual(["__security_mc_1_s_sdk_cert_key","__security_mc_1_s_sdk_sign_data_key_web_protect","__security_server_data_status","_bd_ticket_crypt_cookie","_bd_ticket_crypt_doamin","d_ticket","has_biz_token","is_dbsc","is_staff_user","n_mh","odin_tt","passport_assist_user","passport_auth_status","passport_auth_status_ss","passport_mfa_token","session_tlb_tag","sessionid","sessionid_ss","sid_guard","sid_tt","sid_ucp_v1","ssid_ucp_v1","uid_tt","uid_tt_ss","x_tt_token"])
    })
    it('声明的每个标记都 ∈A 且 ∉B', () => {
      for (const k of ["sessionid","sessionid_ss","sid_tt","uid_tt"]) {
        expect(A.includes(k)).toBe(true)
        expect(B.includes(k)).toBe(false)
      }
    })
    it('匿名基线不得判为已登录', () => {
      expect(hasPlatformSessionCookie('douyin', B.map(name => ({ name, value: 'v' })))).toBe(false)
    })
    it('真实登录视图必须判为已登录', () => {
      expect(hasPlatformSessionCookie('douyin', A.map(name => ({ name, value: 'v' })))).toBe(true)
    })
  })

  describe('bilibili', () => {
    // A = 本机登录视图分区 auth-auth-bilibili-1790348729411（只读采集，不含值列）；B = 本机匿名实测基线
    const A = ['DedeUserID', 'DedeUserID__ckMd5', 'SESSDATA', '_uuid', 'b_nut', 'bili_jct',
      'bili_ticket', 'bili_ticket_expires', 'browser_resolution', 'buvid3', 'buvid4',
      'buvid_fp', 'home_feed_column', 'sid']
    const B = ['_uuid', 'b_lsid', 'b_nut', 'bili_ticket', 'bili_ticket_expires', 'bmg_af_sc',
      'bmg_af_switch', 'bmg_src_def_domain', 'browser_resolution', 'buvid3', 'buvid4',
      'buvid_fp', 'home_feed_column']
    it('实测差集 A−B 逐字钉住（平台改埋点即红）', () => {
      expect(A.filter(n => !B.includes(n))).toEqual(["DedeUserID","DedeUserID__ckMd5","SESSDATA","bili_jct","sid"])
    })
    it('声明的每个标记都 ∈A 且 ∉B', () => {
      for (const k of ["SESSDATA","DedeUserID"]) {
        expect(A.includes(k)).toBe(true)
        expect(B.includes(k)).toBe(false)
      }
    })
    it('匿名基线不得判为已登录', () => {
      expect(hasPlatformSessionCookie('bilibili', B.map(name => ({ name, value: 'v' })))).toBe(false)
    })
    it('真实登录视图必须判为已登录', () => {
      expect(hasPlatformSessionCookie('bilibili', A.map(name => ({ name, value: 'v' })))).toBe(true)
    })
  })

  describe('xiaohongshu', () => {
    // A = 本机登录视图分区 auth-auth-xiaohongshu-1790348418152（只读采集，不含值列）；B = 本机匿名实测基线
    const A = ['_gray_did', 'a1', 'access-token-creator.xiaohongshu.com', 'acw_tc',
      'customer-sso-sid', 'customerClientId', 'ets', 'galaxy.creator.beaker.session.id',
      'galaxy_creator_session_id', 'gid', 'loadts', 'sec_poison_id', 'webId', 'websectiga',
      'x-user-id-creator.xiaohongshu.com', 'xsecappid']
    const B = ['_gray_did', 'a1', 'acw_tc', 'ets', 'gid', 'loadts', 'sec_poison_id',
      'webBuild', 'webId', 'websectiga', 'xsecappid']
    it('实测差集 A−B 逐字钉住（平台改埋点即红）', () => {
      expect(A.filter(n => !B.includes(n))).toEqual(["access-token-creator.xiaohongshu.com","customer-sso-sid","customerClientId","galaxy.creator.beaker.session.id","galaxy_creator_session_id","x-user-id-creator.xiaohongshu.com"])
    })
    it('声明的每个标记都 ∈A 且 ∉B', () => {
      for (const k of ["access-token-creator.xiaohongshu.com","x-user-id-creator.xiaohongshu.com"]) {
        expect(A.includes(k)).toBe(true)
        expect(B.includes(k)).toBe(false)
      }
    })
    it('匿名基线不得判为已登录', () => {
      expect(hasPlatformSessionCookie('xiaohongshu', B.map(name => ({ name, value: 'v' })))).toBe(false)
    })
    it('真实登录视图必须判为已登录', () => {
      expect(hasPlatformSessionCookie('xiaohongshu', A.map(name => ({ name, value: 'v' })))).toBe(true)
    })
  })

  describe('zhihu', () => {
    // A = 本机登录视图分区 auth-auth-zhihu-1790352605579（只读采集，不含值列）；B = 本机匿名实测基线
    const A = ['BEC', 'Hm_lvt_98beee57fd2ef70ccdd5ca52b9740c49', '__snaker__id', '_zap',
      'captcha_session_v2', 'captcha_ticket_v2', 'd_c0', 'gdxidpyhxdE']
    const B = ['BEC', 'HMACCOUNT', 'Hm_lpvt_98beee57fd2ef70ccdd5ca52b9740c49',
      'Hm_lvt_98beee57fd2ef70ccdd5ca52b9740c49', 'JOID', 'SESSIONID', '__snaker__id', '_xsrf',
      '_zap', 'captcha_session_v2', 'd_c0', 'gdxidpyhxdE', 'osd']
    it('实测差集 A−B 逐字钉住（平台改埋点即红）', () => {
      expect(A.filter(n => !B.includes(n))).toEqual(["captcha_ticket_v2"])
    })
    it('未声明 Cookie 标记（Cookie 侧无可钉的会话凭证）', () => {
      expect(hasPlatformSessionCookieMarkers('zhihu')).toBe(false)
      expect(A.some(n => /z_c0|sessionid|^sid$/i.test(n))).toBe(false)
    })
  })



  it('sessionCookieNames 只出名字、去重、限量，且对非数组安全', () => {
    // 它是四处 reject 日志共用的名字投影：值一旦漏进日志就是凭证外泄，故这里锁「只出名字」。
    expect(sessionCookieNames([{ name: 'b' }, { name: 'a' }, { name: 'b' }])).toEqual(['b', 'a'])
    expect(sessionCookieNames([{ name: 'x', value: 'SECRET-DO-NOT-LEAK' }]).join(',')).not.toContain('SECRET')
    expect(sessionCookieNames(undefined)).toEqual([])
    expect(sessionCookieNames('not-an-array')).toEqual([])
    expect(sessionCookieNames([{ name: '' }, { name: null }, {}])).toEqual([])
    const many = Array.from({ length: 60 }, (_, i) => ({ name: 'n' + i }))
    expect(sessionCookieNames(many)).toHaveLength(40)
  })
  it('标记值为空白/缺席时不构成会话证据（同名空值 Cookie 不算登录）', () => {
    expect(hasPlatformSessionCookie('douyin', [{ name: 'sessionid', value: '  ' }])).toBe(false)
    expect(hasPlatformSessionCookie('bilibili', [{ name: 'SESSDATA', value: '' }])).toBe(false)
    expect(hasPlatformSessionCookie('xiaohongshu', [{ name: 'customerClientId' }])).toBe(false)
  })
})

// 棘轮锁：把「URL 单独判成登录成功、但没有任何会话凭证把守」的平台钉成显式清单。
// 新增平台若用裸域名成功模式又不声明会话标记 → 立刻变红；补上标记 → 必须同步从清单删除。
describe('session-evidence gap ratchet (裸域名成功模式必须配会话标记)', () => {
  const hostOnlyPattern = pattern => /^[a-z0-9.-]+$/i.test(String(pattern).replace(/\/+$/, ''))

  const bareHostPlatforms = Object.keys(PLATFORM_LOGIN_SUCCESS_PATTERNS)
    .filter(p => (PLATFORM_LOGIN_SUCCESS_PATTERNS[p] || []).some(hostOnlyPattern))
    .sort()

  it('每个裸域名成功模式平台要么声明会话标记、要么留在待取证清单内', () => {
    const markerless = bareHostPlatforms
      .filter(p => !Array.isArray(PLATFORM_SESSION_COOKIE_MARKERS[p]) || PLATFORM_SESSION_COOKIE_MARKERS[p].length === 0)
      .sort()
    // 2026-09-26 实测：这些平台的未登录落地页与登录成功页在 URL 上无法区分
    // （小红书/抖音 creator 根路径 200 无 HTTP 跳转；Instagram/Facebook 裸模式命中任意路径；
    //  YouTube/Bilibili 根路径匿名可达；知乎的 zhuanlan.zhihu.com 是匿名可读裸域名，
    //  由本锁自身首次扫出）。补标记需逐平台 DevTools/CDP 真实登录态取证，禁止猜测。
    // 2026-09-27 更新：bilibili/douyin/xiaohongshu 已按「匿名基线实测 + 登录视图分区差集」
    // 补上标记并移出本清单（夹具见 session-marker evidence contract）。剩下 4 个里，
    // 知乎实测确认 Cookie 侧无会话凭证可钉（见其 zhihu 段），只能走 localStorage 取证；
    // instagram/facebook/youtube 本机无账号，A 侧不存在，仍需真实登录一次才能补标记。
    expect(markerless).toEqual(['facebook', 'instagram', 'youtube', 'zhihu'])
    // 快手是「裸域名 + 已声明标记」的合规先例，不得出现在缺口清单里
    expect(markerless).not.toContain('kuaishou')
  })

  it('裸域名判据本身按形态工作，不靠枚举平台名', () => {
    // host-only（判定为「裸域名」）：真正的裸 host，含尾斜杠变体
    expect(['instagram.com/', 'facebook.com/', 'cp.kuaishou.com', 'www.bilibili.com/', 'douyin.com', 'creator.xiaohongshu.com']
      .filter(hostOnlyPattern).sort())
      .toEqual(['cp.kuaishou.com', 'creator.xiaohongshu.com', 'douyin.com', 'facebook.com/', 'instagram.com/', 'www.bilibili.com/'])
    // 带路径/非 host 形态（判定为「不裸」）：这些模式即使无标记也不进缺口清单
    expect(['profile_v4', 'cgi-bin/home', 'weibo.com/home', 'accounts.google.com/o/oauth2/approval', 'zhihu.com/people', 'tiktok.com/upload', 'channels.weixin.qq.com/platform']
      .filter(hostOnlyPattern))
      .toEqual([])
  })

  it('hasPlatformSessionCookieMarkers 如实反映门禁是否真在把关', () => {
    expect(hasPlatformSessionCookieMarkers('kuaishou')).toBe(true)
    expect(hasPlatformSessionCookieMarkers('douyin')).toBe(true)
    // 知乎刻意保持 false：登录视图实测无任何会话 Cookie，声明即锁死登录
    expect(hasPlatformSessionCookieMarkers('zhihu')).toBe(false)
    expect(hasPlatformSessionCookieMarkers('unknown_platform')).toBe(false)
    // 声明成空数组等于没声明：不得被误判为「已有会话凭证门禁」
    PLATFORM_SESSION_COOKIE_MARKERS.__probe_empty__ = []
    try {
      expect(hasPlatformSessionCookieMarkers('__probe_empty__')).toBe(false)
      expect(hasPlatformSessionCookie('__probe_empty__', [])).toBe(true)
    } finally {
      delete PLATFORM_SESSION_COOKIE_MARKERS.__probe_empty__
    }
  })
})

/**
 * 创作者中心开卡 URL 契约锁（2026-10-13，xhs-creator-home-url）。
 *
 * 事故：小红书账号卡片「创作者中心」用 PLATFORM_DASHBOARD_URLS 开卡，而该值
 * （`https://creator.xiaohongshu.com/`）是平台的**路由入口**而非**已登录首页**。
 * 已登录账号从 `/` 启动时，平台 SPA 先渲染登录路由、待内部鉴权（无主站
 * web_session 时为 401）返回后才跳 `/new/home`——真机 CDP 实测这段登录路由
 * 持续约 1.2s（`/` → `/login` → `/new/home`），即用户看到的「登录页闪动」。
 * 对照实验：同一分区、同一 Cookie 集合（登录态 6/7、LS 3 个用户态 key）下，
 * 直接开 `/new/home` 全程不出现 `/login`；未登录干净分区开 `/new/home` 会
 * 被平台重定向到 `/login?redirectReason=401`，无死路。
 *
 * 本锁的判据是「语义」不是「看着像」：登记值必须①是 https 绝对 URL；
 * ②与同平台登录 URL **同 host**（防跨域误配把用户开到错误站点）。
 * 删掉登记项 / 改回 `/` / 改成空串 / 改成跨域 host 都必须变红。
 */
describe('PLATFORM_CREATOR_HOME_URLS（已登录创作者首页）契约', () => {
  it('是独立于 PLATFORM_DASHBOARD_URLS 的第二份真源，不得合并', () => {
    // 合并会同时改动 http-login-checker（用 DASHBOARD 值抓 HTML 提 uid）与
    // checkLoginStatus 的 hostname 兜底判定——影响面远超开卡动作。
    expect(PLATFORM_CREATOR_HOME_URLS).not.toBe(PLATFORM_DASHBOARD_URLS)
    expect(Array.isArray(PLATFORM_CREATOR_HOME_URLS)).toBe(false)
    expect(Object.keys(PLATFORM_CREATOR_HOME_URLS).length).toBeGreaterThan(0)
  })

  it('每个登记值都是 https 绝对 URL，且与同平台登录 URL 同 host', () => {
    for (const [platform, url] of Object.entries(PLATFORM_CREATOR_HOME_URLS)) {
      expect(typeof url, `${platform} 的值必须是字符串`).toBe('string')
      expect(url.length, `${platform} 的值不得为空串`).toBeGreaterThan(0)
      const parsed = new URL(url)
      expect(parsed.protocol, `${platform} 必须是 https`).toBe('https:')
      // 同 host：跨域即等于把用户开到另一个站点，必须当场红
      const loginHost = new URL(PLATFORM_LOGIN_URLS[platform]).host
      expect(parsed.host, `${platform} 的 host 必须与 PLATFORM_LOGIN_URLS 同源`).toBe(loginHost)
    }
  })

  it('小红书登记为已登录首页 /new/home，而不是会闪登录页的路由入口 /', () => {
    expect(PLATFORM_CREATOR_HOME_URLS.xiaohongshu).toBe('https://creator.xiaohongshu.com/new/home')
    // 反证：旧值（= PLATFORM_DASHBOARD_URLS.xiaohongshu）正是闪登录页的那个 URL
    expect(PLATFORM_DASHBOARD_URLS.xiaohongshu).toBe('https://creator.xiaohongshu.com/')
    expect(PLATFORM_CREATOR_HOME_URLS.xiaohongshu).not.toBe(PLATFORM_DASHBOARD_URLS.xiaohongshu)
  })

  it('未登记平台不出现该键，由调用方回退 PLATFORM_DASHBOARD_URLS', () => {
    // 键存在但值为 undefined/空串会让调用方的 `||` 回退失效，createTab 收到空 URL
    for (const platform of Object.keys(PLATFORM_LOGIN_URLS)) {
      if (!(platform in PLATFORM_CREATOR_HOME_URLS)) continue
      expect(PLATFORM_CREATOR_HOME_URLS[platform], platform).toBeTruthy()
    }
    expect('wechat_mp' in PLATFORM_CREATOR_HOME_URLS).toBe(false)
  })
})
