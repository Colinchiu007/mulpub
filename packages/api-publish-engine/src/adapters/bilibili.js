// B站视频发布适配器（W1 §4.4：变薄委托新链 BilibiliVideoChain）
// 外部接口不变（constructor 'bilibili'、getReferer/getOrigin、uploadVideo/uploadCover/
// buildPostData/publish/execute、listCollections），HTTP/upos 逻辑单一事实源在
// src/publish/platforms/bilibili-video.js。合规：只直连 bilibili 官方域名，无任何远程签名。
const fs = require("fs");
const { BasePlatformAdapter } = require("../base-adapter");
const { HttpConfig } = require("../base-adapter");
const {
  BilibiliVideoChain,
  buildUposTarget,
  buildBilibiliPostData,
  pickCookieValue,
} = require("../publish/platforms/bilibili-video");

const UA = HttpConfig.userAgent;

class BilibiliAdapter extends BasePlatformAdapter {
  constructor() {
    super("bilibili");
    this.apiBase = "https://member.bilibili.com";
  }
  getReferer() { return "https://member.bilibili.com/platform/upload/video/frame"; }
  getOrigin() { return "https://member.bilibili.com"; }

  // 构造委托链；测试可注入 _chainOverride 或 clients 覆盖
  _chain(cookie, clients) {
    if (this._chainOverride) return this._chainOverride;
    return new BilibiliVideoChain(Object.assign({ cookie, userAgent: UA }, clients || {}));
  }

  // P3-7：拉取当前用户的合集/season 列表（只读，保留本适配器直连）
  async listCollections(cookie) {
    const h = this.getHeaders(cookie, { Accept: "application/json" });
    const resp = await this.http.get(this.apiBase + "/x/vupre/web/archives/seasons", { headers: h, params: { pn: 1, ps: 50 } });
    const list = resp.data?.data?.items || resp.data?.data?.seasons || [];
    return (Array.isArray(list) ? list : []).map((s) => ({ id: s.season_id || s.id, name: s.title || s.name || "" })).filter((s) => s.id);
  }

  // 向后兼容：upos 目标解析（委托链的 buildUposTarget 纯函数）
  _buildBase(args) {
    const { host, objectPath } = buildUposTarget(args);
    return { base: host ? "https://" + host + objectPath : objectPath, objectPath };
  }

  // 上传：取 args → 分片 upos → complete，返回 {objBase, bizId, size}
  async uploadVideo(td, cookie, cancelToken) {
    const videoPath = td.video && (td.video.path || td.video.localPath) || td.videoPath || td.filePath;
    if (!videoPath) return null; // 空上传契约：无视频返回 null，不抛异常
    if (!fs.existsSync(videoPath)) { const e = new Error("B站上传：视频文件不存在 " + videoPath); e.code = "BILI_NO_FILE"; throw e; }
    const size = fs.statSync(videoPath).size;
    const mid = pickCookieValue(cookie, "DedeUserID");
    const ts = String(Date.now());
    const fileName = `${mid}_${ts}_${ts.substring(9, 12)}`;
    const chain = this._chain(cookie);
    const args = await chain.getUploadArgs(fileName, size);
    if (cancelToken && cancelToken.isCancelled) { const e = new Error("Cancelled"); e.code = "cancel"; throw e; }
    return chain.uploadVideo(videoPath, fileName, args);
  }

  async uploadCover() { return null; } // 留空 cover，B站自动截帧封面

  buildPostData(taskData, uploadResult) {
    return buildBilibiliPostData(taskData, (uploadResult && uploadResult.video) || {});
  }

  // 适配器对外为正式发布（add/v3）；私密草稿由 §5 publishWithMode 服务层经链 draft 选项驱动
  async publish(cookie, postData) {
    return this._chain(cookie).publish(postData, { draft: false });
  }
}
module.exports = BilibiliAdapter;
