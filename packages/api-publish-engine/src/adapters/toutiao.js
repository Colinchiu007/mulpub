// 头条号适配器 — 基于参考产品逆向分析
//
// 2026-10-18（toutiao-video-api）：新增**视频 API 轨**。
// 此前本适配器只有图文（`/api/article/publish`），`uploadVideo` 是返回 null 的空壳，
// 导致头条视频任务只能走 DOM 轨。本轮按实网抓包（见 platforms/toutiao-video.js 头注释）
// 补齐视频链，并在此按内容类型分流：**有 video.path 走视频链，否则走原图文路径**。
const { BasePlatformAdapter, HttpConfig } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");
const { errorCode } = require("../error-codes");
const { ToutiaoVideoChain } = require("../publish/platforms/toutiao-video");
const __pkgLogger = require("../logger");
// 话题内联描述（publish-topic-inline-description）：头条是独立字段型平台——
// 话题从描述剥离进 tags 字段，剥离用 content-formatter 单一实现
// 正文承载形态：写 content 字段前必须过 formatArticleBody（单一实现）
const { stripTopicsFromContent, formatArticleBody } = require("../content-formatter");

const UA = HttpConfig.userAgent;

class ToutiaoAdapter extends BasePlatformAdapter {
  constructor() {
    super("toutiao");
    this.apiBase = "https://mp.toutiao.com";
  }
  getReferer() { return "https://mp.toutiao.com/profile_v4/"; }
  getOrigin() { return "https://mp.toutiao.com"; }

  async uploadVideo(td, cookie) {
    // 视频上传由 _videoChain().run() 内部编排（getAuthKey → apply → 分片 → commit），
    // 不走 granular 入口；此处保留契约形状（空任务返回 null、零请求）。
    if (!td || !td.video || !td.video.path) return null;
    return null;
  }
  async uploadCover(td, cookie) {
    const r = await upload({ ...td, platform: "toutiao" }, cookie);
    return r?.cover || null;
  }

  /** 构造视频链；测试可注入 _videoChainOverride（假链）或 clients 覆盖 base，零外发。 */
  _videoChain(cookie, clients, csrf, pagePost) {
    if (this._videoChainOverride) return this._videoChainOverride;
    return new ToutiaoVideoChain(Object.assign({ cookie, userAgent: this._ua || UA, logger: { log: function () { var a = [].slice.call(arguments); __pkgLogger.info.apply(__pkgLogger, ["toutiao-video"].concat(a)) } } }, clients || {}, csrf ? { csrf: csrf, pagePost: pagePost || null } : { pagePost: pagePost || null }));
  }

  /**
   * 按内容类型分流。
   * - 有 `video.path` ⇒ 视频 API 轨（单体 run，内部编排五步）
   * - 否则 ⇒ 原有图文路径（super.execute → uploadVideo(null) → publish('/api/article/publish')）
   */
  async execute(taskData, cookie, opts) {
    opts = opts || {};
    if (opts.dryRun) return { success: true, dryRun: true, platform: "toutiao" };
    const td = taskData || {};
    const hasVideo = Boolean(td.video && td.video.path);
    if (!hasVideo) return super.execute(taskData, cookie, opts);
    if (!cookie) {
      return { success: false, platform: "toutiao", code: errorCode.data_error, error: "toutiao: 账号信息缺失，请重新授权此账号再试" };
    }
    try {
      const chain = this._videoChain(cookie, opts.clients, opts.csrf, opts.pagePost);
      return await chain.run(td, { onProgress: opts.onProgress, draft: opts.draft });
    } catch (e) {
      return {
        success: false,
        platform: "toutiao",
        code: e && e.code,
        error: (e && e.message) || "toutiao: 视频发布失败",
      };
    }
  }

  buildPostData(taskData) {
    // 话题内联描述：描述里已知话题剥离（头条话题走 tags 字段，正文不重复携带）
    const stripped = stripTopicsFromContent(taskData.content || "", taskData.tags || []);
    return {
      title: taskData.title || "",
      // 顺序不变量：话题剥离**先于**承载形态适配
      // （p3-residual-criteria，2026-10-16：原实现直接写 stripped.content，绕过单一实现）
      //
      // ★ 头条是 **HTML 承载平台**——依据不是类比推测，有 PRD 级取证：
      //   01-docs/PRD-ARTICLE-BODY-FORMAT-2026-10-12.md §4「全平台审计矩阵」头条行记载
      //   正文字段 `content`（**内部名 `htmlContent`**）、承载形态 **HTML**，证据列为
      //   `packages/rpa-engine/src/toutiao-direct-bridge.js:33` 已 `<p>` 包装
      //   （该行同时标注它是「第二份实现，待收敛」——本处接入 formatArticleBody 正是收敛动作）。
      //   若按纯文本直写：平台按 HTML 解析、换行属可忽略空白 ⇒ 整篇塌成一个文本节点
      //   （2026-10-12 百家号同型事故：公开页正文 `<p>`=0）。
      content: formatArticleBody("toutiao", stripped.content),
      tags: taskData.tags || [],
      cover_type: taskData.cover_path ? 1 : 0,
    };
  }

  async publish(cookie, postData) {
    const h = this.getHeaders(cookie, { "Content-Type": "application/json" });
    const resp = await this.http.post(this.apiBase + "/api/article/publish", postData, { headers: h });
    if (resp.data?.data?.article_id || resp.data?.code === 0) {
      return { success: true, platform: "toutiao", publishId: resp.data?.data?.article_id };
    }
    return { success: false, error: resp.data?.message || "Publish failed", platform: "toutiao" };
  }
}
module.exports = ToutiaoAdapter;
