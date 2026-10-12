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
