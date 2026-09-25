// 抖音视频发布适配器（W2 §4.1/§4.4：变薄委托新链 DouyinVideoChain）
// 外部接口不变（constructor 'douyin'、getReferer/getOrigin/getHeaders、execute），
// HTTP/CDN/vod-imagex 上传/签名单一事实源在 src/publish/platforms/douyin-video.js。
// 旧 `web/api/media/aweme/post` 发布链与远程 `_signature` 消费点整体下线（W2 §4.2）。
// 合规：只直连 creator.douyin.com 官方域名；clientSign 进程内本地签名，无任何远程签名通道。
const { BasePlatformAdapter } = require("../base-adapter");
const { HttpConfig } = require("../base-adapter");
const { formatContent } = require("../content-formatter");
const { errorCode } = require("../error-codes");
const logger = require("../logger");
const { DouyinVideoChain } = require("../publish/platforms/douyin-video");

const UA = HttpConfig.userAgent;

class DouyinAdapter extends BasePlatformAdapter {
  constructor() {
    super("douyin");
    this.apiBase = "https://creator.douyin.com";
  }
  getReferer() { return "https://creator.douyin.com/creator-micro/content/upload"; }
  getOrigin() { return "https://creator.douyin.com"; }
  getHeaders(cookie, extra) { return super.getHeaders(cookie, { "Content-Type": "application/json", ...extra }); }

  // 抖音为单体链发布（execute → chain.run 内部编排 csrf→auth→upload→cover→create_v2），
  // 故 granular 步骤不作为独立发布路径；仅满足统一入口（upload-orchestrator）契约：空任务返回 null、零请求。
  async uploadVideo(taskData) {
    if (!taskData || !taskData.video || !taskData.video.path) return null;
    return null;
  }
  async uploadCover() { return null; }

  // 构造委托链；测试可注入 _chainOverride（假链）或 clients（四类 base）覆盖，零外发。
  _chain(cookie, clients) {
    if (this._chainOverride) return this._chainOverride;
    return new DouyinVideoChain(Object.assign({ cookie, userAgent: this._ua || UA }, clients || {}));
  }

  // buildPostData 委托链模块纯函数（供薄适配器/服务层复用，非主发布路径必经）。
  buildPostData(taskData, uploadResult) {
    return this._chain().buildPostData(taskData, {
      videoId: (uploadResult && uploadResult.video && uploadResult.video.videoId) || "",
      coverPoster: (uploadResult && uploadResult.cover && uploadResult.cover.poster) || "",
      visibilityType: Number(taskData && taskData.visibility_type != null ? taskData.visibility_type : 0),
    });
  }

  // 抖音链为单体 run()（csrf→auth→upload→cover→create_v2 内部编排），
  // 故 override execute 直接委托链，保留 base 的 dryRun/错误归一契约。
  async execute(taskData, cookie, opts) {
    opts = opts || {};
    if (opts.dryRun) return { success: true, dryRun: true, platform: "douyin" };
    if (!cookie) return { success: false, error: "douyin: 账号信息缺失，请重新授权此账号再试", code: errorCode.data_error, platform: "douyin" };
    if (!taskData || !taskData.video || !taskData.video.path) {
      return { success: false, error: "douyin: taskData.video.path required", code: errorCode.data_error, platform: "douyin" };
    }
    const td = formatContent(this.name, taskData);
    try {
      const chain = this._chain(cookie, opts.clients);
      const r = await chain.run(td, opts);
      if (r && typeof r === "object" && !r.platform) r.platform = "douyin";
      if (r && !r.success && r.code === undefined) r.code = errorCode.request_error;
      if (r && r.success && r.code === undefined) r.code = errorCode.success;
      return r;
    } catch (err) {
      // fail-closed（签名材料缺失/文件不存在）在此透传，链已保证零网络请求
      logger.error("adapter:douyin", "execute failed", {
        error: err.message, code: err.code || errorCode.unknown_error,
        stack: String(err.stack || "").split("\n").slice(0, 3).join(" <- "),
      });
      return { success: false, error: err.message, code: err.code || errorCode.unknown_error, platform: "douyin", risk_blocked: !!err.risk_blocked };
    }
  }
}
module.exports = DouyinAdapter;
