// 视频号（微信 channels）视频发布适配器（W1 §4.4：变薄委托新链 ShipinhaoVideoChain）
// 外部接口不变（constructor 'tencent_video'、getReferer/getOrigin/getHeaders、
// uploadVideo/uploadCover/buildPostData/publish、继承 base-adapter 的 execute），
// HTTP/CDN 分片传输单一事实源在 src/publish/platforms/shipinhao-video.js。
// 合规：只直连 channels.weixin.qq.com / finderassistancea.video.qq.com 官方域名，无任何远程签名通道。
const fs = require("fs");
const { BasePlatformAdapter } = require("../base-adapter");
const { HttpConfig } = require("../base-adapter");
const {
  ShipinhaoVideoChain,
  buildShipinhaoPostData,
  getTimeStamp,
} = require("../publish/platforms/shipinhao-video");

const UA = HttpConfig.userAgent;

class ShipinhaoAdapter extends BasePlatformAdapter {
  constructor() {
    super("tencent_video"); // name 保持不变（adapters-interface 契约钉死）
    this.apiBase = "https://channels.weixin.qq.com";
  }
  getReferer() { return "https://channels.weixin.qq.com/platform/post/create"; }
  getOrigin() { return "https://channels.weixin.qq.com"; }
  getHeaders(cookie, extra) { return super.getHeaders(cookie, { "Content-Type": "application/json", ...extra }); }

  // 构造委托链；测试可注入 _chainOverride 或 clients 覆盖。
  // ids：{finderId, finderUin} 透传给链（_log_finder_id / weixinnum）。
  _chain(cookie, clients, ids) {
    if (this._chainOverride) return this._chainOverride;
    return new ShipinhaoVideoChain(Object.assign({ cookie, userAgent: UA, apiBase: this.apiBase }, ids || {}, clients || {}));
  }

  // 上传：authKey → applyuploaddfs → 逐片 uploadpartdfs → completepartuploaddfs，
  // 返回 {uploadId, videoInfo}（与原 orchestrator 契约对齐：execute 包装为 {video: 此返回}）。
  async uploadVideo(td, cookie, cancelToken) {
    if (!td) return null; // 空上传契约：无任务返回 null，不抛
    const video = td.video || {};
    const videoPath = video.path || video.localPath || td.videoPath || td.filePath;
    if (!videoPath) return null; // 空上传契约：无视频路径返回 null，不抛
    if (!fs.existsSync(videoPath)) { const e = new Error("视频号上传：视频文件不存在 " + videoPath); e.code = "SPH_NO_FILE"; throw e; }
    if (cancelToken && cancelToken.isCancelled) { const e = new Error("Cancelled"); e.code = "cancel"; throw e; }
    const chain = this._chain(cookie, null, { finderId: td.finderId, finderUin: td.finderUin || td.finderId });
    const filekey = videoPath.split(/[\\/]/).pop();
    const authKey = await chain.getUploadAuthKey();
    const meta = { authKey, filetype: video.filetype || "mp4", filekey, taskid: "T" + getTimeStamp(10) };
    if (cancelToken && cancelToken.isCancelled) { const e = new Error("Cancelled"); e.code = "cancel"; throw e; }
    return chain.uploadVideo(videoPath, meta);
  }

  async uploadCover() { return null; } // 视频号封面由视频抽帧，无独立封面上传链

  buildPostData(taskData, uploadResult) {
    const ids = { finderId: taskData && taskData.finderId, finderUin: taskData && (taskData.finderUin || taskData.finderId) };
    return buildShipinhaoPostData(taskData, (uploadResult && uploadResult.video) || {}, ids);
  }

  // 适配器对外为正式发布（post_create）；私密草稿由 §5 publishWithMode 服务层经链 draft 选项驱动。
  // 链返回 platform 'shipinhao' 映射回适配器外部名 'tencent_video'（保持对外契约）。
  async publish(cookie, postData) {
    const r = await this._chain(cookie).publish(postData, { draft: false });
    if (r && r.platform) r.platform = "tencent_video";
    return r;
  }
}
module.exports = ShipinhaoAdapter;
