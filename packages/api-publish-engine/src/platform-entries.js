// 双入口映射 — 视频/图文分离发布入口 (提取自参考产品 videoPublishUrls/imagePublishUrls)

const videoPublishUrls = {
  douyin: "https://creator.douyin.com/creator-micro/content/upload",
  kuaishou: "https://cp.kuaishou.com/article/publish/video?tabType=1",
  xiaohongshu: "https://creator.xiaohongshu.com/publish/publish?from=menu&target=video",
  bilibili: "https://member.bilibili.com/platform/upload/video/frame",
  weibo: "https://weibo.com/upload/channel",
  zhihu: "https://www.zhihu.com/zvideo/upload-video",
  tencent_video: "https://channels.weixin.qq.com/platform/post/create",
  baijiahao: "https://baijiahao.baidu.com/builder/rc/edit",
  toutiao: "https://mp.toutiao.com/profile_v4/xigua/upload-video",
  aiqiyi: "https://mp.iqiyi.com/wemedia/publish/video",
};

const imagePublishUrls = {
  douyin: "https://creator.douyin.com/creator-micro/content/upload?default-tab=3",
  kuaishou: "https://cp.kuaishou.com/article/publish/video?tabType=2",
  xiaohongshu: "https://creator.xiaohongshu.com/publish/publish?from=menu",
  zhihu: "https://zhuanlan.zhihu.com/write",
  weibo: "https://weibo.com/upload/channel",
};

function getPublishUrl(platform, type) {
  if (type === "video") return videoPublishUrls[platform] || null;
  if (type === "image") return imagePublishUrls[platform] || null;
  return null;
}

module.exports = { videoPublishUrls, imagePublishUrls, getPublishUrl };