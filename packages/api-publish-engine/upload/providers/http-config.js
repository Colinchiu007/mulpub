// Platform-specific HTTP upload endpoint configurations
// Extracted from 参考产品 4.0 reverse engineering analysis
const PLATFORM_CONFIG = {
  douyin: {
    uploadType: "chunk",
    apiDomain: "creator.douyin.com",
    uploadPath: "/web/api/media/aweme/upload/",
    referer: "https://creator.douyin.com/creator-micro/home",
    contentType: "video/mp4",
    needsSigning: true,
    signType: "douyin_signature"
  },
  kuaishou: {
    uploadType: "chunk",
    apiDomain: "cp.kuaishou.com",
    uploadPath: "/rest/cp/works/v2/video/pc/upload/finish",
    referer: "https://cp.kuaishou.com/article/publish/video",
    contentType: "video/mp4",
    needsSigning: true,
    signType: "kuaishou_signature"
  },
  baijiahao: {
    uploadType: "form",
    apiDomain: "baijiahao.baidu.com",
    uploadPath: "/api/video/upload",
    referer: "https://baijiahao.baidu.com/builder/rc/edit",
    contentType: "multipart/form-data"
  },
  bilibili: {
    uploadType: "chunk",
    apiDomain: "member.bilibili.com",
    uploadPath: "/api/video/upload",
    referer: "https://member.bilibili.com/platform/upload/video/frame",
    contentType: "video/mp4"
  },
  weibo: {
    uploadType: "chunk",
    apiDomain: "weibo.com",
    uploadPath: "/upload/video",
    referer: "https://weibo.com/upload/channel",
    contentType: "video/mp4"
  },
  toutiao: {
    uploadType: "chunk",
    apiDomain: "mp.toutiao.com",
    uploadPath: "/profile_v4/xigua/upload-video",
    referer: "https://mp.toutiao.com/profile_v4/xigua/upload-video",
    contentType: "video/mp4"
  },
  wechat_mp: {
    uploadType: "form",
    apiDomain: "mp.weixin.qq.com",
    uploadPath: "/cgi-bin/fileupload",
    referer: "https://mp.weixin.qq.com/",
    contentType: "multipart/form-data"
  },
  aiqiyi: {
    uploadType: "chunk",
    apiDomain: "mp.iqiyi.com",
    uploadPath: "/wemedia/publish/video/upload",
    referer: "https://mp.iqiyi.com/wemedia/publish/video",
    contentType: "video/mp4"
  },
  dayu: {
    uploadType: "chunk",
    apiDomain: "mp.dayu.com",
    uploadPath: "/dashboard/video/upload",
    referer: "https://mp.dayu.com/dashboard/video/write",
    contentType: "video/mp4"
  },
  qiehao: {
    uploadType: "chunk",
    apiDomain: "om.qq.com",
    uploadPath: "/main/creation/video/upload",
    referer: "https://om.qq.com/main/creation/video",
    contentType: "video/mp4"
  },
  souhu: {
    uploadType: "chunk",
    apiDomain: "mp.sohu.com",
    uploadPath: "/mpfe/v4/content/uploadVideo",
    referer: "https://mp.sohu.com/mpfe/v4/contentManagement",
    contentType: "video/mp4"
  },
  wangyi: {
    uploadType: "chunk",
    apiDomain: "mp.163.com",
    uploadPath: "/subscribe_v4/video/upload",
    referer: "https://mp.163.com/subscribe_v4",
    contentType: "video/mp4"
  },
  tengxun_shipin: {
    uploadType: "chunk",
    apiDomain: "mp.v.qq.com",
    uploadPath: "/publishVideo/upload",
    referer: "https://mp.v.qq.com/publishVideo",
    contentType: "video/mp4"
  },
  weishi: {
    uploadType: "chunk",
    apiDomain: "media.weishi.qq.com",
    uploadPath: "/api/upload",
    referer: "https://media.weishi.qq.com",
    contentType: "video/mp4"
  },
  souhu_shipin: {
    uploadType: "chunk",
    apiDomain: "tv.sohu.com",
    uploadPath: "/api/upload/video",
    referer: "https://tv.sohu.com",
    contentType: "video/mp4"
  },
  pipixia: {
    uploadType: "chunk",
    apiDomain: "pipix.com",
    uploadPath: "/mp/upload/video",
    referer: "https://pipix.com/mp/upload",
    contentType: "video/mp4"
  },
  meipai: {
    uploadType: "chunk",
    apiDomain: "www.meipai.com",
    uploadPath: "/api/upload/video",
    referer: "https://www.meipai.com",
    contentType: "video/mp4"
  },
  acfun: {
    uploadType: "chunk",
    apiDomain: "member.acfun.cn",
    uploadPath: "/api/upload/video",
    referer: "https://member.acfun.cn",
    contentType: "video/mp4"
  },
  chejiahao: {
    uploadType: "chunk",
    apiDomain: "creator.autohome.com.cn",
    uploadPath: "/api/video/upload",
    referer: "https://creator.autohome.com.cn",
    contentType: "video/mp4"
  },
  yichehao: {
    uploadType: "chunk",
    apiDomain: "baa.yiche.com",
    uploadPath: "/api/video/upload",
    referer: "https://baa.yiche.com",
    contentType: "video/mp4"
  },
  meiyou: {
    uploadType: "chunk",
    apiDomain: "mp.meiyou.com",
    uploadPath: "/api/upload",
    referer: "https://mp.meiyou.com",
    contentType: "video/mp4"
  },
  xhs_shangjia: {
    uploadType: "chunk",
    apiDomain: "ark.xiaohongshu.com",
    uploadPath: "/api/upload/video",
    referer: "https://ark.xiaohongshu.com",
    contentType: "video/mp4"
  },
  xigua: {
    uploadType: "chunk",
    apiDomain: "ixigua.com",
    uploadPath: "/api/upload/video",
    referer: "https://ixigua.com",
    contentType: "video/mp4"
  },
  duoduo: {
    uploadType: "chunk",
    apiDomain: "live.pinduoduo.com",
    uploadPath: "/api/upload",
    referer: "https://live.pinduoduo.com",
    contentType: "video/mp4"
  }
};

function getPlatformConfig(platform) {
  return PLATFORM_CONFIG[platform] || null;
}

module.exports = { PLATFORM_CONFIG, getPlatformConfig };
