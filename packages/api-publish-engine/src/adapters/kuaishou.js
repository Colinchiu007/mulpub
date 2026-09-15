const { BasePlatformAdapter } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");
const { getKuaishouSignature } = require("../signer");

class KuaishouAdapter extends BasePlatformAdapter {
  constructor() {
    super("kuaishou");
    this.apiBase = "https://cp.kuaishou.com";
  }
  getReferer() { return "https://cp.kuaishou.com/"; }
  getOrigin() { return "https://cp.kuaishou.com"; }

  getHeaders(cookie, extra) {
    const h = super.getHeaders(cookie, { "Content-Type": "application/json", ...extra });
    const phMatch = cookie && cookie.match(/kuaishou\.web\.cp\.api_ph=([^;]+)/);
    if (phMatch) h["kuaishou.web.cp.api_ph"] = phMatch[1];
    return h;
  }

  async uploadVideo(td, cookie) { const r = await upload({...td, platform: "kuaishou"}, cookie); return r?.video || null; }
  async uploadCover(td, cookie) { const r = await upload({...td, platform: "kuaishou"}, cookie); return r?.cover || null; }

  buildPostData(taskData) {
    const data = {
      title: taskData.title || "",
      content: taskData.content || "",
      tags: taskData.tags || [],
    }
    // AI 生成内容声明：默认勾选「AI 生成内容」。
    // 快手平台要求内容创作声明如实选择，AI 生成内容必须勾选，否则违规。
    // taskData.aiGenerated === false 时显式不勾选（人工创作内容）。
    // 快手 API 字段：ai_generated (1=AI 生成, 0=人工创作)
    data.ai_generated = taskData.aiGenerated !== false ? 1 : 0
    return data
  }

  async publish(cookie, postData, opts = {}) {
    const h = this.getHeaders(cookie);
    // 本地计算 __NS_sig3（MD5(api_ph|body)，api_ph 取自登录 cookie；此前经第三方远程签名服务）
    const sig = await getKuaishouSignature("/rest/cp/works/v2/video/pc/upload/finish", postData, cookie);
    const params = sig ? { __NS_sig3: sig.signature || sig.__NS_sig3 || "" } : {};
    
    const resp = await this.http.post(this.apiBase + "/rest/cp/works/v2/video/pc/upload/finish", postData, {
      headers: h, params
    });
    if (resp.data?.result === 1 || resp.data?.code === 200) {
      return { success: true, platform: "kuaishou", publishId: resp.data?.id };
    }
    return { success: false, error: resp.data?.error_msg || resp.data?.msg || "Publish failed", platform: "kuaishou" };
  }
}
module.exports = KuaishouAdapter;