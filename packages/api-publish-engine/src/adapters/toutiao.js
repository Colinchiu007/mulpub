// 头条号适配器 — 基于参考产品逆向分析
const { BasePlatformAdapter } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");
// 话题内联描述（publish-topic-inline-description）：头条是独立字段型平台——
// 话题从描述剥离进 tags 字段，剥离用 content-formatter 单一实现
// 正文承载形态：写 content 字段前必须过 formatArticleBody（单一实现）
const { stripTopicsFromContent, formatArticleBody } = require("../content-formatter");

class ToutiaoAdapter extends BasePlatformAdapter {
  constructor() {
    super("toutiao");
    this.apiBase = "https://mp.toutiao.com";
  }
  getReferer() { return "https://mp.toutiao.com/profile_v4/"; }
  getOrigin() { return "https://mp.toutiao.com"; }

  async uploadVideo(td, cookie) {
    const r = await upload({ ...td, platform: "toutiao" }, cookie);
    return r?.video || null;
  }
  async uploadCover(td, cookie) {
    const r = await upload({ ...td, platform: "toutiao" }, cookie);
    return r?.cover || null;
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
