// 小红书适配器 — 基于参考产品逆向分析 COS 上传协议
const { BasePlatformAdapter } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");
const { getXiaohongshuSign } = require("../signer-local");

class XiaohongshuAdapter extends BasePlatformAdapter {
  constructor() {
    super("xiaohongshu");
    this.apiBase = "https://creator.xiaohongshu.com";
  }
  getReferer() { return "https://creator.xiaohongshu.com/"; }
  getOrigin() { return "https://creator.xiaohongshu.com"; }

  async uploadVideo(td, cookie) {
    const r = await upload({ ...td, platform: "xiaohongshu" }, cookie);
    return r?.video || null;
  }
  async uploadCover(td, cookie) {
    const r = await upload({ ...td, platform: "xiaohongshu" }, cookie);
    return r?.cover || null;
  }

  buildPostData(taskData) {
    const data = {
      title: taskData.title || "",
      content: taskData.content || "",
      tags: taskData.tags || [],
      type: taskData.video_path ? "video" : "dynamic",
    };
    // P3-1：商品（参考产品映射 shopping_cart）
    if (Array.isArray(taskData.goods) && taskData.goods.length > 0) {
      data.shopping_cart = { items: taskData.goods.map(function (g) { return { item_id: g.id, name: g.title } }) }
    }
    return data
  }

  async publish(cookie, postData) {
    const h = this.getHeaders(cookie, { "Content-Type": "application/json" });
    const sig = await getXiaohongshuSign("/api/publish", postData);
    const params = sig ? { sign: sig } : {};

    const resp = await this.http.post(this.apiBase + "/api/publish", postData, {
      headers: h, params,
    });
    if (resp.data?.code === 0 || resp.data?.success) {
      return { success: true, platform: "xiaohongshu", publishId: resp.data?.data?.id || resp.data?.id };
    }
    return { success: false, error: resp.data?.msg || resp.data?.error_msg || "Publish failed", platform: "xiaohongshu" };
  }
}
module.exports = XiaohongshuAdapter;
