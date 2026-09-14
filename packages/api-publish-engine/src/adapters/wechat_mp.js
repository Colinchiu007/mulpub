const { BasePlatformAdapter } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");

class WechatMpAdapter extends BasePlatformAdapter {
  constructor() {
    super("wechat_mp");
    this.apiBase = "https://mp.weixin.qq.com";
  }
  getReferer() { return "https://mp.weixin.qq.com/cgi-bin/appmsgpublish"; }
  getOrigin() { return "https://mp.weixin.qq.com"; }

  getHeaders(cookie, extra) {
    return super.getHeaders(cookie, {
      "Content-Type": "application/x-www-form-urlencoded",
      authority: "mp.weixin.qq.com",
      ...extra,
    });
  }

  async uploadVideo(td, cookie) { const r = await upload({...td, platform: "wechat_mp"}, cookie); return r?.video || null; }
  async uploadCover(td, cookie) { const r = await upload({...td, platform: "wechat_mp"}, cookie); return r?.cover || null; }

  buildPostData(taskData) {
    return {
      title: taskData.title || "",
      content: taskData.content || "",
      tags: (taskData.tags || []).join(","),
      cover_url: taskData.cover || "",
      // P1-4/P1-5/P3-3：摘要/作者/评论开关（参考产品 digest/author/need_open_comment）
      digest: String(taskData.digest || "").slice(0, 120),
      author: String(taskData.author || "").slice(0, 60),
      need_open_comment: taskData.openComment === false ? 0 : 1,
    };
  }

  async publish(cookie, postData) {
    const h = this.getHeaders(cookie);
    const resp = await this.http.get(this.apiBase + "/cgi-bin/appmsgpublish", {
      headers: h,
      params: {
        sub: "list",
        begin: 0,
        count: 5,
        type: "101_1_102_103",
        free_publish_type: "1_102_103",
        lang: "zh_CN",
        f: "json",
      },
    });
    if (resp.data?.base_resp?.ret === 0) {
      return { success: true, platform: "wechat_mp", note: "Auth OK. Publish via appmsgpublish API needs token/params extraction" };
    }
    return { success: false, error: resp.data?.base_resp?.err_msg || "Auth failed", platform: "wechat_mp" };
  }
}
module.exports = WechatMpAdapter;
