import { describe, expect, it } from 'vitest'

import {
  PLATFORM_LOGIN_URLS,
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
})
