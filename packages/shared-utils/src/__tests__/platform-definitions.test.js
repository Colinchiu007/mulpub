import { describe, expect, it } from 'vitest'

import {
  PLATFORM_LOGIN_URLS,
  PLATFORM_SESSION_COOKIE_MARKERS,
  hasPlatformSessionCookie,
  isPlatformCookieDomain,
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
    /user_?id|(^|[._-])(st|sid|auth|token|tk)([._-]|$)|(^|[._-])(session|sess)([._-]|$)|session_?id/i

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
