import { describe, expect, it } from 'vitest'

import {
  PLATFORM_LOGIN_URLS,
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
    // 2026-09-14 实测：视频号登录页为 channels.weixin.qq.com/login.html（蚁小二
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
})
