const { BasePlatformAdapter } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");
const { getDouyinSignature } = require("../signer");

class DouyinAdapter extends BasePlatformAdapter {
  constructor() {
    super("douyin");
    this.apiBase = "https://creator.douyin.com";
  }
  getReferer() { return "https://creator.douyin.com/creator-micro/home"; }
  getOrigin() { return "https://creator.douyin.com"; }

  getHeaders(cookie, extra) {
    return super.getHeaders(cookie, {
      "Content-Type": "application/json",
      ...extra,
    });
  }

  async uploadVideo(td, cookie) { const r = await upload({...td, platform: "douyin"}, cookie); return r?.video || null; }
  async uploadCover(td, cookie) { const r = await upload({...td, platform: "douyin"}, cookie); return r?.cover || null; }

  buildPostData(taskData) {
    const data = {
      title: taskData.title || "",
      content: taskData.content || "",
      tags: taskData.tags || [],
    };
    // P3-1：商品橱窗（参考产品映射 shopping_cart → goodsInfoList）
    if (Array.isArray(taskData.goods) && taskData.goods.length > 0) {
      data.goodsInfoList = taskData.goods.map(function (g) { return { item_id: g.id, item_name: g.title } })
    }
    // P3-2：任务/活动（参考产品映射 hot_event → hot_sentence）
    if (taskData.taskId) data.hot_sentence = taskData.taskId
    return data
  }

  async publish(cookie, postData) {
    const h = this.getHeaders(cookie);
    // Step 1: Verify auth
    const userResp = await this.http.get(this.apiBase + "/aweme/v1/creator/user/info/", { headers: h });
    if (userResp.status !== 200) return { success: false, error: "Auth failed", platform: "douyin" };
    
    // Step 2: Get _signature from remote signer
    const sig = await getDouyinSignature(this.apiBase + "/web/api/media/aweme/post/");
    const params = sig ? { _signature: sig.signature || sig._signature || "" } : {};
    
    // Step 3: Publish
    const resp = await this.http.post(this.apiBase + "/web/api/media/aweme/post/", postData, {
      headers: h, params
    });
    if (resp.data?.code === 0 || resp.data?.status_code === 0) {
      return { success: true, platform: "douyin", publishId: resp.data?.aweme_id || resp.data?.item_id };
    }
    return { success: false, error: resp.data?.msg || resp.data?.status_msg || "Publish failed", platform: "douyin" };
  }
}
module.exports = DouyinAdapter;
