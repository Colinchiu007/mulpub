// 哔哩哔哩适配器 — 基于参考产品逆向分析
const { BasePlatformAdapter } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");

class BilibiliAdapter extends BasePlatformAdapter {
  constructor() {
    super("bilibili");
    this.apiBase = "https://member.bilibili.com";
  }
  getReferer() { return "https://member.bilibili.com/platform/upload/video/frame"; }
  getOrigin() { return "https://member.bilibili.com"; }

  // P3-7：拉取当前用户的合集/season 列表（arc/search API，参考产品 collection.sourceId 对应 season_id）
  async listCollections(cookie) {
    const h = this.getHeaders(cookie, { Accept: "application/json" });
    const resp = await this.http.get(this.apiBase + "/x/vupre/web/archives/seasons", { headers: h, params: { pn: 1, ps: 50 } });
    const list = resp.data?.data?.items || resp.data?.data?.seasons || [];
    return (Array.isArray(list) ? list : []).map(function (s) {
      return { id: s.season_id || s.id, name: s.title || s.name || "" };
    }).filter(function (s) { return s.id });
  }

  async uploadVideo(td, cookie) {
    const r = await upload({ ...td, platform: "bilibili" }, cookie);
    return r?.video || null;
  }
  async uploadCover(td, cookie) {
    const r = await upload({ ...td, platform: "bilibili" }, cookie);
    return r?.cover || null;
  }

  buildPostData(taskData) {
    const data = {
      title: taskData.title || "",
      desc: taskData.content || "",
      tag: (taskData.tags || []).join(","),
      copyright: taskData.copyright || 2,
      tid: taskData.category || 17,
    };
    // P2-1：合集（season_id，参考产品映射 collection.sourceId → season_id）
    const seasonId = Number(taskData.collectionId)
    if (Number.isInteger(seasonId) && seasonId > 0) {
      data.season_id = seasonId
      // 参考产品：加入合集默认同时开启「选集」
      data.new_draft = 1
    }
    return data
  }

  async publish(cookie, postData) {
    const h = this.getHeaders(cookie, { "Content-Type": "application/x-www-form-urlencoded" });
    const params = new URLSearchParams(postData);
    const resp = await this.http.post(this.apiBase + "/x/vu/client/web/add-archive", params.toString(), { headers: h });
    if (resp.data?.code === 0 || resp.data?.data?.aid) {
      return { success: true, platform: "bilibili", publishId: resp.data?.data?.aid };
    }
    return { success: false, error: resp.data?.message || "Publish failed", platform: "bilibili" };
  }
}
module.exports = BilibiliAdapter;
