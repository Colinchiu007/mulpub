'use strict'
/**
 * article → API taskData 形状翻译（单一实现·权威源）
 *
 * 消费方（三路）：
 *   - apps/desktop publisher-router（API 直调）
 *   - apps/desktop rpa-view-manager（API-first 分支）
 *   - 本包 publish-api-server（HTTP /api/v1/publish、/api/v1/batch-publish）
 *
 * 根因（2026-09-28 活体取证，live-acceptance-pass-20260928.md 残余①）：
 * RpaView 的 API-first 分支曾把裸 article 直接传给 publishViaApi——适配器
 * 契约要求 taskData.video.path（嵌套对象）而 article 是扁平 video_path 字段，
 * kuaishou/bilibili 等视频平台 API 轨全部 fail-closed
 * （`taskData.video.path required`）并回退 DOM 轨。publisher-router 一直
 * 正确构造 taskData（内联映射），本模块把该映射提取为多路共用的单一实现。
 *
 * 2026-10-06 本实现由 apps/desktop/electron/services/api-task-data.js 下沉至此
 * （该文件改为薄转发）。理由：HTTP 服务端是**第三条**喂 taskData 的路径，
 * 若在服务端另写一份映射即等于埋下第三份实现，重复放大上面那次形状漂移事故的
 * 风险。引擎不依赖 desktop、desktop 依赖引擎，故权威实现只可能且应该在引擎侧。
 *
 * 形状契约（与适配器校验对齐）：
 * - 视频模式（article.video_path 存在）：taskData.video.path 必填；
 *   duration/width/height 可选（快手/B站链实测只消费 path），缺省 0。
 * - 图文模式：images/author 透传（百家号/头条文章链消费）。
 * - 平台特有字段透传清单与 publisher-router 既有清单逐项一致。
 */

/** 平台特有字段透传清单（adapter 按需消费；B站 tid/copyright、YouTube
 *  categoryId/privacy、TikTok privacy_level、百家号 original/location）。
 * P2-1 合集/播放列表、P3-1/P3-2/P3-4 商品/任务透传。 */
const PASSTHROUGH_KEYS = [
  'category', 'copyright', 'categoryId', 'privacy', 'privacyLevel',
  'original', 'location',
  'collectionId', 'playlistId', 'collection',
  'goods', 'taskId',
  // 公众号 API 轨（wechat-mp-api-publish-track）消费：图文封面/摘要/原文链接/评论开关/原创声明。
  // 形状为扁平 snake_case，适配器按需读取；对其他适配器惰性（它们读的是 taskData.cover，
  // 不是 cover_path），因此不改变任何既有平台的行为。
  'cover_path', 'digest', 'content_source_url', 'comment_setting', 'is_original',
  // 公众号发布方式（wechat-mp-publish-track）：mass_send（群发，推送粉丝）/ free_publish（发布，不推送）/ publish_time（定时）。
  // 兼容 camelCase 入参（article.massSend/freePublish 由 router 归一成 snake_case 后也接受原样）。
  'mass_send', 'free_publish', 'publish_time', 'sex', 'group_id', 'country', 'province', 'city',
]

/**
 * 把扁平的 article 形状翻译为适配器要求的嵌套 taskData。
 *
 * @param {object} article  扁平内容对象（video_path / cover_path / images / ...）
 * @param {object|null} [videoInfo]  视频探测结果（duration/width/height）
 * @returns {object} 适配器消费的 taskData
 */
function buildApiTaskData (article, videoInfo) {
  article = article || {}
  videoInfo = videoInfo || null

  const taskData = {
    title: article.title,
    content: article.content,
    tags: article.tags,
    draft: article.draft === true,
    // AI 生成内容声明：默认勾选（AI 生成内容），仅显式 false 时取消勾选
    aiGenerated: article.aiGenerated !== false,
  }

  const videoPath = article.video_path
  if (videoPath) {
    taskData.video = {
      path: videoPath,
      duration: Number(videoInfo && videoInfo.duration) || 0,
      width: Number(videoInfo && videoInfo.width) || 0,
      height: Number(videoInfo && videoInfo.height) || 0,
    }
    if (article.cover_path) taskData.cover = article.cover_path
  } else {
    // 图文：正文内联图片与作者透传给文章链消费
    if (Array.isArray(article.images) && article.images.length) taskData.images = article.images
    if (article.author) taskData.author = article.author
  }

  for (const key of PASSTHROUGH_KEYS) {
    if (article[key] !== undefined) taskData[key] = article[key]
  }

  // wechat-mp-publish-track：camelCase 入参（router 的 massSend/freePublish）归一为
  // 适配器消费的 snake_case（mass_send/free_publish）。只做别名映射，不改变未传字段的形状。
  if (article.massSend !== undefined && taskData.mass_send === undefined) taskData.mass_send = article.massSend
  if (article.freePublish !== undefined && taskData.free_publish === undefined) taskData.free_publish = article.freePublish

  return taskData
}

module.exports = { buildApiTaskData, PASSTHROUGH_KEYS }