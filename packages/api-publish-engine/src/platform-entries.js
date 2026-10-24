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
  // 2026-10-20（fix-publish-failures）：图文入口**不是**视频频道。
  // `weibo.com/upload/channel`（见上方 videoPublishUrls.weibo）是视频上传页，该页没有
  // `.publisher_text textarea` / `.W_input` / `textarea[node-type="textEl"]`（PLATFORM_PUBLISH_SELECTORS.weibo
  // 只登记了这三条正文候选），走它必然报「content editor not found」。图文走首页发布框。
  weibo: "https://weibo.com/",
  // 2026-09-30 补：头条「图文」= 文章编辑器（graphic/publish）。
  // 此前该键缺失 ⇒ getPublishUrl('toutiao','image') 返回 null ⇒ RPA 回退到
  // config.publish_url 的根地址 https://mp.toutiao.com/（首页），
  // 于是标题/正文/发布按钮全找不到（日志 publish btn not found url=）。
  toutiao: "https://mp.toutiao.com/profile_v4/graphic/publish",
  // 2026-09-30 补：B站「图文」= 专栏编辑器。B站视频走 upload/video/frame，
  // 图文必须用专栏入口，否则会落进视频上传页（无标题/正文/发布按钮）。
  bilibili: "https://member.bilibili.com/platform/upload/text/edit",
};

function getPublishUrl(platform, type) {
  if (type === "video") return videoPublishUrls[platform] || null;
  if (type === "image") return imagePublishUrls[platform] || null;
  return null;
}

module.exports = { videoPublishUrls, imagePublishUrls, getPublishUrl };