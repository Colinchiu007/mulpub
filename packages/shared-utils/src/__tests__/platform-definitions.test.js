import { describe, expect, it } from 'vitest'

import {
  PLATFORM_LOGIN_URLS,
  PLATFORM_LOGIN_SUCCESS_PATTERNS,
  PLATFORM_SESSION_COOKIE_MARKERS,
  hasPlatformSessionCookie,
  hasPlatformSessionCookieMarkers,
  isPlatformCookieDomain,
  isPlatformLeftLoginPage,
  isPlatformLoginSuccessUrl,
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
    expect(hasPlatformSessionCookie('douyin', [])).toBe(true)
    expect(hasPlatformSessionCookie('wechat_mp', [{ name: 'anything', value: 'v' }])).toBe(true)
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
    expect(markerless).toEqual(['bilibili', 'douyin', 'facebook', 'instagram', 'xiaohongshu', 'youtube', 'zhihu'])
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
    expect(hasPlatformSessionCookieMarkers('douyin')).toBe(false)
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
