/**
 * TikTok API Adapter (P0) ? TikTok Business API / Content Posting
 *
 * Requires TIKTOK_ACCESS_TOKEN in env.
 * Uses TikTok Business API for video posting and content publishing.
 */
const https = require("https");
// 正文承载形态单一实现（p3-residual-criteria，2026-10-16）
const { formatArticleBody } = require("../content-formatter");

class TikTokAdapter {
  constructor() { this.name = "tiktok"; }

  _getToken() {
    var token = process.env.TIKTOK_ACCESS_TOKEN;
    if (!token) throw new Error("TikTok: missing TIKTOK_ACCESS_TOKEN");
    return token;
  }

  async execute(taskData, cookie, opts) {
    opts = opts || {};
    // 2026-10-06 修复①：dryRun 此前被完全忽略。基类与全部新链都尊重 dryRun，
    // 只有本适配器会拿着没有的凭证真去外发。
    if (opts.dryRun) return { success: true, dryRun: true, platform: "tiktok" };
    try {
      var token = this._getToken();

      // Initialize upload
      var initRes = await this._apiPost("/video/init/", {
        access_token: token,
        upload_type: "FILE_UPLOAD",
        source_info: { source: "FILE_UPLOAD", video_size: taskData.videoSize || 0 },
      });

      var uploadUrl = initRes && initRes.data && initRes.data.upload_url;
      // 2026-10-06 修复②：此前在此 `return { success: true }` —— 既没有上传，也没有调用
      // /video/publish，却告诉调用方「发布成功」。调用方（publish-mode-runner 的
      // outcomeOfResult）只认 success 字段，于是这条分支会让上层把「什么都没发」
      // 记成一次成功发布并扣掉发布额度。
      // 本仓 01-docs/rpa-api-publish/evidence 下**没有任何 TikTok 上传协议切片**，
      // 无法在不编造端点的前提下补齐分片上传。因此这里如实报 unsupported：
      // publish-mode 的 api-then-dom 轨道会据此降级到 DOM 轨（RPA 走上传页），
      // 而不是伪造成功。
      if (!uploadUrl) {
        return {
          success: false,
          unsupported: true,
          platform: "tiktok",
          error: "TikTok API 未返回 upload_url，且本仓无 TikTok 上传协议取证，无法走 API 轨（已交由 DOM 轨兜底）",
        };
      }

      // Publish
      // TikTok 是无标题平台（openspec/changes/publish-capability-registry）：
      // DOM 上传页只有 caption（2200 含话题），发布页填写的标题必须作为
      // description 首行插入，否则标题被丢弃。
      // 承载形态：TikTok 是**纯文本承载平台** ⇒ 正文过 formatArticleBody 后（HTML→纯文本）
      // 再与标题合并（p3-residual-criteria，2026-10-16：原实现直接拼裸 content）。
      var composedDescription = [taskData.title, formatArticleBody("tiktok", taskData.content)]
        .map(function (part) { return typeof part === "string" ? part.trim() : ""; })
        .filter(function (part) { return part.length > 0; })
        .join("\n");
      var publishRes = await this._apiPost("/video/publish/", {
        access_token: token,
        post_info: {
          title: taskData.title || "",
          description: composedDescription,
          privacy_level: taskData.privacy || "PUBLIC",
        },
      });

      var publishId = publishRes && publishRes.data && publishRes.data.publish_id;
      // 2026-10-06 修复③：没有 publish_id 就不算发布成功（同②的口径，不能只认 HTTP 200）。
      if (!publishId) {
        return {
          success: false,
          platform: "tiktok",
          error: "TikTok /video/publish 未返回 publish_id，不计为发布成功",
        };
      }
      return { success: true, platform: "tiktok", publishId: publishId };
    } catch (e) {
      return { success: false, error: e.message, platform: "tiktok" };
    }
  }

  _apiPost(path, body) {
    return new Promise(function(resolve, reject) {
      var data = JSON.stringify(body);
      var req = https.request({
        hostname: "open.tiktokapis.com",
        path: "/v2" + path,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "Content-Length": Buffer.byteLength(data),
        },
      }, function(resp) {
        var d = "";
        resp.on("data", function(c) { d += c; });
        resp.on("end", function() {
          try { resolve(JSON.parse(d)); }
          catch(e) { reject(new Error("TikTok API: " + d)); }
        });
      });
      req.on("error", reject);
      req.write(data);
      req.end();
    });
  }
}

module.exports = TikTokAdapter;
