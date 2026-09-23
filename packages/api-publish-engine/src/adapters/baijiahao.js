// 百家号发布适配器（W1 §4.4：由旧视频链改委托新文章链 BaijiahaoArticleChain）
// Q14 决策：百家号只发图文（文章），旧 457 行视频链（preupload/分片/complete/video-process）整体下线。
// HTTP/token/表单/提交逻辑单一事实源在 src/publish/platforms/baijiahao-article.js（§4.3）。
// 外部接口保持（constructor 'baijiahao'、getReferer/getOrigin、uploadVideo/uploadCover/buildPostData/execute），
// 基类 publishViaApi 经 execute() 进入。合规：只直连 baijiahao 官方域名，无任何远程签名；测试仅打本机假 HTTP 服务器。
const { BasePlatformAdapter, HttpConfig } = require("../base-adapter");
const { BaijiahaoArticleChain } = require("../publish/platforms/baijiahao-article");

const UA = HttpConfig.userAgent;

class BaijiahaoAdapter extends BasePlatformAdapter {
  constructor() {
    super("baijiahao");
    this.apiBase = "https://baijiahao.baidu.com";
  }
  getReferer() { return "https://baijiahao.baidu.com/builder/rc/edit?type=news"; }
  getOrigin() { return "https://baijiahao.baidu.com"; }

  // 构造委托链；测试可注入 _chainOverride（假 HTTP）或经 opts.http 传入 http/baseUrl 覆盖
  _chain(cookie, clients) {
    if (this._chainOverride) return this._chainOverride;
    return new BaijiahaoArticleChain(Object.assign({ cookie, userAgent: UA }, clients || {}));
  }

  // 图文无视频上传：保持基类 execute 契约的兼容桩（返回 null，不发起任何请求）
  async uploadVideo() { return null; }
  async uploadCover() { return null; }

  // buildPostData 兼容旧调用点/测试：直接返回文章链的表单构造结果（x-www-form-urlencoded）
  buildPostData(taskData) {
    return this._chain(null).buildArticleFormData(taskData);
  }

  /**
   * 完整执行：委托文章链 run()（baseToken → publishToken → (uploadImage) → submitArticle）。
   * 私密草稿优先（opts.draft !== false → 默认走 save?callback=bjhdraft），对齐 Q14 活体验收口径。
   * @returns {Promise<{success:boolean, platform:string, publishId?:string, error?:string, code?:number}>}
   */
  async execute(taskData, cookie, opts = {}) {
    try {
      if (!taskData || !taskData.title) {
        return { success: false, error: "缺少标题（百家号图文发布需 title）", platform: "baijiahao" };
      }
      const clients = opts.http || undefined;
      const chain = this._chain(cookie, clients);
      const draft = opts.draft !== false; // 私密草稿优先
      const result = await chain.run(taskData, { draft });
      if (!result || !result.success) {
        return {
          success: false,
          error: (result && result.error) || "百家号图文发布失败",
          code: result && result.code,
          platform: "baijiahao",
          raw: result && result.raw,
        };
      }
      return {
        success: true,
        platform: "baijiahao",
        draft: result.draft,
        publishId: result.publishId,
        url: result.publishId ? this.apiBase + "/pcui/article/" + result.publishId : undefined,
        raw: result.raw,
      };
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), platform: "baijiahao" };
    }
  }
}
module.exports = BaijiahaoAdapter;
