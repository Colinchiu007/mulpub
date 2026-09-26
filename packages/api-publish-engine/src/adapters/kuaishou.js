// 快手视频发布适配器（W3 §5.3：变薄委托新链 KuaishouVideoChain，对齐 W2 douyin.js 形态）
// 外部接口不变（constructor 'kuaishou'、getReferer/getOrigin/getHeaders、execute），
// HTTP/分片上传/求签单一事实源在 src/publish/platforms/kuaishou-video.js。
// 旧骨架（远程签名拼参 + 单步 upload/finish）整体下线（W3 §5）：
// __NS_sig3 仅经进程内注册表 command `kuaishou.ns-sig3-browser`（W3 签名页基建，S2b Tier-A GO）。
// 合规：只直连 cp.kuaishou.com 官方域；本文件不存在任何第三方签名服务调用路径（legacy-chain-gate grep 门禁）。
const { BasePlatformAdapter } = require("../base-adapter");
const { HttpConfig } = require("../base-adapter");
const { formatContent } = require("../content-formatter");
const { errorCode } = require("../error-codes");
const logger = require("../logger");
const { KuaishouVideoChain, cookieValue } = require("../publish/platforms/kuaishou-video");

const UA = HttpConfig.userAgent;
const API_PH_KEY = "kuaishou.web.cp.api_ph";

class KuaishouAdapter extends BasePlatformAdapter {
  constructor() {
    super("kuaishou");
    this.apiBase = "https://cp.kuaishou.com";
  }
  getReferer() { return "https://cp.kuaishou.com/article/publish/video?tabType=1"; }
  getOrigin() { return "https://cp.kuaishou.com"; }

  getHeaders(cookie, extra) {
    const h = super.getHeaders(cookie, { "Content-Type": "application/json", ...extra });
    const ph = cookieValue(cookie, API_PH_KEY);
    if (ph) h[API_PH_KEY] = ph;
    return h;
  }

  // 快手为单体链发布（execute → chain.run 内部编排 pre→fragment→complete→finish→cover→submit→回查），
  // 故 granular 步骤不作为独立发布路径；仅满足统一入口（upload-orchestrator）契约：空任务返回 null、零请求。
  async uploadVideo(taskData) {
    if (!taskData || !taskData.video || !taskData.video.path) return null;
    return null;
  }
  async uploadCover() { return null; }

  // 构造委托链；测试可注入 _chainOverride（假链）或 opts.clients/signer 覆盖，零外发。
  _chain(cookie, clients) {
    if (this._chainOverride) return this._chainOverride;
    return new KuaishouVideoChain(Object.assign({ cookie, userAgent: this._ua || UA }, clients || {}));
  }

  // buildPostData 委托链模块纯函数（供薄适配器/服务层复用，非主发布路径必经）。
  // uploadResult 形如 { video: { fileId }, cover: { coverKey } }；api_ph 从 cookie 提取。
  buildPostData(taskData, uploadResult, cookie) {
    const ctx = {
      fileId: (uploadResult && uploadResult.video && uploadResult.video.fileId) || "",
      coverKey: (uploadResult && uploadResult.cover && uploadResult.cover.coverKey) || "",
      apiPh: cookieValue(cookie, API_PH_KEY),
    };
    return this._chain().buildPostData(taskData, ctx);
  }

  // 快手链为单体 run()（pre→…→submit→回查 内部编排），
  // 故 override execute 直接委托链，保留 base 的 dryRun/错误归一契约。
  async execute(taskData, cookie, opts) {
    opts = opts || {};
    if (opts.dryRun) return { success: true, dryRun: true, platform: "kuaishou" };
    if (!cookie) return { success: false, error: "kuaishou: 账号信息缺失，请重新授权此账号再试", code: errorCode.data_error, platform: "kuaishou" };
    if (!taskData || !taskData.video || !taskData.video.path) {
      return { success: false, error: "kuaishou: taskData.video.path required", code: errorCode.data_error, platform: "kuaishou" };
    }
    const td = formatContent(this.name, taskData);
    try {
      const clients = Object.assign({}, opts.clients);
      if (opts.signer) clients.signer = opts.signer;
      const chain = this._chain(cookie, clients);
      const r = await chain.run(td, opts);
      if (r && typeof r === "object" && !r.platform) r.platform = "kuaishou";
      if (r && !r.success && r.code === undefined) r.code = errorCode.request_error;
      if (r && r.success && r.code === undefined) r.code = errorCode.success;
      return r;
    } catch (err) {
      // fail-closed（api_ph 缺失/文件不存在/签名非法）在此透传，链已保证零网络请求
      logger.error("adapter:kuaishou", "execute failed", {
        error: err.message, code: err.code || errorCode.unknown_error,
        stack: String(err.stack || "").split("\n").slice(0, 3).join(" <- "),
      });
      return {
        success: false, error: err.message, code: err.code || errorCode.unknown_error, platform: "kuaishou",
        risk_blocked: !!err.risk_blocked, login_expired: !!err.login_expired,
      };
    }
  }
}
module.exports = KuaishouAdapter;
