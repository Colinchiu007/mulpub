const { BasePlatformAdapter } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");
// 话题内联描述（publish-topic-inline-description）：微博是内联转换型平台——
// 描述里的 `#话题` 发布时隐性转换成微博双井号形态 `#话题#`（用户无感知）
const { convertInlineTopics, formatArticleBody } = require("../content-formatter");

class WeiboAdapter extends BasePlatformAdapter {
  constructor() {
    super("weibo");
    this.apiBase = "https://weibo.com";
  }
  getReferer() { return "https://weibo.com/upload/channel"; }
  getOrigin() { return "https://weibo.com"; }
  getHeaders(cookie, extra) {
    return super.getHeaders(cookie, { "Content-Type": "application/x-www-form-urlencoded", ...extra });
  }
  async uploadVideo(td, cookie) { const r = await upload({...td, platform: "weibo"}, cookie); return r?.video || null; }
  async uploadCover(td, cookie) { const r = await upload({...td, platform: "weibo"}, cookie); return r?.cover || null; }
  buildPostData(t) {
    // 微博是无标题平台（openspec/changes/publish-capability-registry）：发布面
    // 只有正文字段，发布页填写的标题必须作为正文首行插入（与 DOM RPA
    // _composeEditorCaption / 快手链 caption 语义对齐），否则标题被丢弃。
    const title = typeof t.title === "string" ? t.title.trim() : "";
    const content = t.content == null ? "" : String(t.content).trim();
    // 话题内联描述：已知话题（tags 含描述解析值）单井号 → 微博双井号形态
    const converted = convertInlineTopics("weibo", content, t.tags || []);
    // 顺序不变量：话题转换**先于**承载形态适配（反序会让 `(^|\s)#话题` 因井号前是 `>` 而失配）。
    // 微博是**纯文本承载平台**（无标题平台，标题合并进描述）⇒ 合并后的整段过 formatArticleBody，
    // 否则 HTML 会以字面量 `<p>` 出现在用户可见描述里（p3-residual-criteria，2026-10-16）。
    const composed = formatArticleBody("weibo", [title, converted].filter(part => part.length > 0).join("\n"));
    const postData = { title: t.title || "", content: composed, tags: (t.tags||[]).join(",") };
    // P1-5 可见性：微博发布体 visible（0 公开 / 1 仅自己 / 6 好友圈）。
    // 非法值不透传，交由平台默认（公开）——与 desktop resolver 的合法值集一致。
    const visible = Number(t.visible);
    if (visible === 0 || visible === 1 || visible === 6) postData.visible = visible;
    return postData;
  }
  async publish(cookie, postData) {
    const h = this.getHeaders(cookie);
    const resp = await this.http.post(this.apiBase + "/aj/v6/upload/upload_video", postData, { headers: h });
    if (resp.data?.code === 100000) return { success: true, platform: "weibo", publishId: resp.data?.data?.mid };
    return { success: false, error: resp.data?.msg || "Publish failed", platform: "weibo" };
  }
}
module.exports = WeiboAdapter;
