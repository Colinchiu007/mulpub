// 渲染端使用的 ESM 平台定义。
// 主进程仍使用 platform-definitions.js（CommonJS），避免改变 Node 端契约。
export const PLATFORM_NAMES = {
  wechat_mp: '微信公众号',
  zhihu: '知乎',
  weibo: '微博',
  douyin: '抖音',
  xiaohongshu: '小红书',
  tencent_video: '视频号',
  kuaishou: '快手',
  toutiao: '今日头条',
  bilibili: 'Bilibili',
  baijiahao: '百家号',
  youtube: 'YouTube',
  tiktok: 'TikTok',
  twitter: 'Twitter/X',
  instagram: 'Instagram',
  facebook: 'Facebook',
}

export const PLATFORM_ICONS = {
  wechat_mp: '💬',
  zhihu: '❓',
  weibo: '✧',
  douyin: '🎵',
  xiaohongshu: '📕',
  tencent_video: '▶',
  kuaishou: '🎬',
  toutiao: '📰',
  bilibili: '📺',
  baijiahao: '📖',
  youtube: '▶',
  tiktok: '♪',
  twitter: '✕',
  instagram: '📷',
  facebook: '👍',
}

export const PLATFORM_SOURCE_URLS = {
  weibo: 'https://s.weibo.com/top/summary',
  zhihu: 'https://www.zhihu.com/hot',
  toutiao: 'https://www.toutiao.com/hot-event/hot-board/?origin=toutiao_pc',
}

/**
 * 已登录创作者首页（账号标签「创作者中心」开卡入口专用）
 *
 * 与 PLATFORM_DASHBOARD_URLS 是两张表，禁止合并；只登记「已登录首页 ≠ dashboard URL」
 * 的平台（未登记由调用方回退 dashboard URL）。完整理由、真机取证与契约锁位置见
 * CJS 孪生文件 platform-definitions.js 的 PLATFORM_CREATOR_HOME_URLS 注释。
 *
 * 2026-10-13（xhs-creator-home-url）：小红书 dashboard URL 是
 * `https://creator.xiaohongshu.com/`（该 SPA 的路由入口，已登录时先渲染登录路由
 * 约 1.2s 再跳 /new/home，即用户看到的「登录页闪动」），已登录首页是 `/new/home`。
 */
export const PLATFORM_CREATOR_HOME_URLS = {
  xiaohongshu: 'https://creator.xiaohongshu.com/new/home',
}

export const PLATFORM_LOGIN_URLS = {
  wechat_mp: 'https://mp.weixin.qq.com/',
  zhihu: 'https://www.zhihu.com/signin',
  weibo: 'https://weibo.com/login',
  douyin: 'https://creator.douyin.com/',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  tencent_video: 'https://channels.weixin.qq.com/',
  kuaishou: 'https://cp.kuaishou.com/',
  toutiao: 'https://mp.toutiao.com/',
  bilibili: 'https://passport.bilibili.com/login',
  baijiahao: 'https://baijiahao.baidu.com/',
  youtube: 'https://studio.youtube.com/',
  tiktok: 'https://www.tiktok.com/upload/',
  twitter: 'https://twitter.com/i/flow/login',
  instagram: 'https://www.instagram.com/accounts/login/',
  facebook: 'https://www.facebook.com/login/',
}

export const PLATFORM_DASHBOARD_URLS = {
  wechat_mp: 'https://mp.weixin.qq.com/',
  zhihu: 'https://www.zhihu.com/',
  weibo: 'https://weibo.com/',
  douyin: 'https://creator.douyin.com/',
  xiaohongshu: 'https://creator.xiaohongshu.com/',
  tencent_video: 'https://channels.weixin.qq.com/',
  kuaishou: 'https://cp.kuaishou.com/',
  toutiao: 'https://mp.toutiao.com/',
  bilibili: 'https://member.bilibili.com/',
  baijiahao: 'https://baijiahao.baidu.com/',
  youtube: 'https://studio.youtube.com/',
  tiktok: 'https://www.tiktok.com/',
  twitter: 'https://twitter.com/home',
  instagram: 'https://www.instagram.com/',
  facebook: 'https://www.facebook.com/',
}
