// 哔哩哔哩适配器 — Tier-A「Cookie + 官方创作者域名 HTTP API」上传发布（upos 链）
// 复刻自参考产品逆向 + 本地活体验证（2026-09-23 真实发布成功 bvid=BV1MahW6tE36）：
//   preupload(probe→args) → init upload_id → 8MiB 分片 PUT → complete → add/v3 投稿
// 合规：只直连 bilibili 官方域名，绝不调用任何第三方签名/远程服务。
const fs = require("fs");
const { BasePlatformAdapter } = require("../base-adapter");

const CHUNK = 8 * 1024 * 1024; // 8MiB
const UA = "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function pickCookieValue(cookie, key) {
  const m = String(cookie || "").match(new RegExp("(?:^|;\\s*)" + key + "=([^;]+)"));
  return m ? m[1] : "";
}

class BilibiliAdapter extends BasePlatformAdapter {
  constructor() {
    super("bilibili");
    this.apiBase = "https://member.bilibili.com";
  }
  getReferer() { return "https://member.bilibili.com/platform/upload/video/frame"; }
  getOrigin() { return "https://member.bilibili.com"; }

  // P3-7：拉取当前用户的合集/season 列表
  async listCollections(cookie) {
    const h = this.getHeaders(cookie, { Accept: "application/json" });
    const resp = await this.http.get(this.apiBase + "/x/vupre/web/archives/seasons", { headers: h, params: { pn: 1, ps: 50 } });
    const list = resp.data?.data?.items || resp.data?.data?.seasons || [];
    return (Array.isArray(list) ? list : []).map((s) => ({ id: s.season_id || s.id, name: s.title || s.name || "" })).filter((s) => s.id);
  }

  // 取一次上传 args（endpoint/upos_uri/auth/biz_id）；命中 601 抛风控错误
  async _getUploadArgs(cookie, fileName, size) {
    const h = { Cookie: cookie, Referer: this.getReferer(), "User-Agent": UA, Accept: "application/json, text/plain, */*" };
    const probe = (await this.http.get(this.apiBase + "/preupload?r=probe", { headers: h })).data;
    const lines = (probe && probe.lines) || [];
    for (const l of lines) {
      const url = `${this.apiBase}/preupload?${l.query}&r=${l.os}&name=${encodeURIComponent(fileName)}.mp4&size=${size}&profile=${encodeURIComponent("ugcupos/bup")}&ssl=0&version=2.7.1&build=2070100`;
      let a; try { a = (await this.http.get(url, { headers: h })).data; } catch (_) { continue; }
      if (a && a.code === 601) { const e = new Error("B站上传风控(601)：请先在创作者中心完成一次滑块验证后重试"); e.code = "BILI_RISK_601"; throw e; }
      if (a && a.auth && (a.endpoint || a.upos_uri)) return a;
    }
    const e = new Error("B站获取上传参数失败（可能被风控拦截或需重新登录）"); e.code = "BILI_ARGS_FAIL"; throw e;
  }

  // upos_uri 新式 "upos://bucket/object" + endpoint "//host" → base(https://host/bucket/object) 与 objectPath(/bucket/object)
  _buildBase(args) {
    const uposUri = args.upos_uri || "";
    const endpoint = args.endpoint || "";
    const epHost = String(endpoint).replace(/^https?:/, "").replace(/^\/\//, "").replace(/\/$/, "");
    if (uposUri.startsWith("upos://")) {
      const after = uposUri.slice("upos://".length);
      return { base: "https://" + epHost + "/" + after, objectPath: "/" + after };
    }
    if (uposUri.startsWith("//")) return { base: "https:" + uposUri, objectPath: "/" + uposUri.replace(/^\/\//, "").split("/").slice(1).join("/") };
    if (uposUri.startsWith("/")) return { base: (epHost ? "https://" + epHost : "") + uposUri, objectPath: uposUri };
    return { base: "https://" + uposUri, objectPath: "/" + uposUri.split("/").slice(1).join("/") };
  }

  async uploadVideo(td, cookie, cancelToken) {
    const videoPath = td.video && (td.video.path || td.video.localPath) || td.videoPath || td.filePath;
    // 空上传契约：与同级适配器一致返回 null（不抛异常）；仅当给了路径却文件缺失才报错
    if (!videoPath) return null;
    if (!fs.existsSync(videoPath)) { const e = new Error("B站上传：视频文件不存在 " + videoPath); e.code = "BILI_NO_FILE"; throw e; }
    const size = fs.statSync(videoPath).size;
    const mid = pickCookieValue(cookie, "DedeUserID");
    const ts = String(Date.now());
    const fileName = `${mid}_${ts}_${ts.substring(9, 12)}`;
    const args = await this._getUploadArgs(cookie, fileName, size);
    if (cancelToken && cancelToken.isCancelled) { const e = new Error("Cancelled"); e.code = "cancel"; throw e; }
    const { base, objectPath } = this._buildBase(args);
    const uph = { Referer: "https://member.bilibili.com/", "X-Upos-Auth": args.auth, "User-Agent": UA };

    // init
    const init = (await this.http.post(base + "?uploads&output=json", "", { headers: uph })).data;
    const uploadId = init && init.upload_id;
    if (!uploadId) { const e = new Error("B站上传：未获取 upload_id"); e.code = "BILI_INIT_FAIL"; throw e; }

    // parts
    const count = Math.ceil(size / CHUNK);
    const fh = fs.openSync(videoPath, "r");
    const parts = [];
    try {
      for (let i = 1; i <= count; i++) {
        if (cancelToken && cancelToken.isCancelled) { const e = new Error("Cancelled"); e.code = "cancel"; throw e; }
        const start = (i - 1) * CHUNK;
        const len = Math.min(CHUNK, size - start);
        const buf = Buffer.alloc(len);
        fs.readSync(fh, buf, 0, len, start);
        const q = `partNumber=${i}&uploadId=${uploadId}&chunk=${i - 1}&chunks=${count}&size=${len}&start=${start}&end=${start + len}&total=${size}`;
        const r = await this.http.put(base + "?" + q, buf, { headers: { ...uph, "Content-Type": "application/octet-stream" }, maxBodyLength: Infinity, maxContentLength: Infinity });
        if (r.status > 204) { const e = new Error("B站分片上传失败 status=" + r.status); e.code = "BILI_PART_FAIL"; throw e; }
        const etag = String(r.headers["etag"] || r.headers["ETag"] || "etag").replace(/"/g, "");
        parts.push({ partNumber: i, size: len, eTag: etag });
      }
    } finally { fs.closeSync(fh); }

    // complete
    const compQ = `output=json&name=${encodeURIComponent(fileName + ".mp4")}&profile=${encodeURIComponent("ugcupos/bup")}&uploadId=${uploadId}&biz_id=${args.biz_id || 0}`;
    const comp = (await this.http.post(base + "?" + compQ, { parts: parts.map((p) => ({ partNumber: p.partNumber, eTag: p.eTag })) }, { headers: { ...uph, "Content-Type": "application/json" } })).data;
    const location = (comp && comp.location) || objectPath.replace(/^\//, "");
    // add/v3 videos[].filename = location 去扩展名、去 bucket 段（复刻 bundle: P.split(".")[0].split("/")[1]）
    const objBase = String(location).split(".")[0].split("/").slice(1).join("/") || String(location).split("/").pop().replace(/\.[^.]+$/, "");
    return { objBase, bizId: args.biz_id != null ? args.biz_id : 0, size };
  }

  async uploadCover() { return null; } // 留空 cover，B站自动截帧封面

  // 去除标题/简介中的「自动发布」水印（括号包裹的整段 boilerplate）及其残留换行
  _cleanText(t) {
    if (t == null) return "";
    return String(t)
      .replace(/[（(][^（()）]*?(自动发布|一键发布工具|由多平台)[^（()）]*?[)）]/g, "")
      .replace(/\s*\n\s*$/g, "")
      .trim();
  }

  buildPostData(taskData, uploadResult) {
    const video = (uploadResult && uploadResult.video) || {};
    const tags = (taskData.tags || []).map((t) => (typeof t === "string" ? t : t.name)).filter(Boolean);
    // 内容纯净：简介/标题绝不允许携带「自动发布」类水印 boilerplate（用户硬要求）
    const title = this._cleanText(taskData.title);
    const desc = this._cleanText(taskData.content || taskData.desc);
    const tid = Number(taskData.category || taskData.tid) || 21; // 默认「日常」综合分区
    return {
      copyright: 1, source: "", tid, title,
      desc, desc_format_id: 0,
      tag: tags.join(","), dynamic: "", cover: taskData.coverUrl || "",
      no_reprint: 1, act_reserve_create: 0, lossless_music: 0, no_disturbance: 0,
      recreate: -1, web_os: 1, interactive: 0, open_elec: 0,
      subtitle: { lan: "", open: 0 },
      videos: [{ cid: video.bizId || 0, desc: "", title: taskData.title || "", filename: video.objBase || "" }],
    };
  }

  async publish(cookie, postData) {
    const csrf = pickCookieValue(cookie, "bili_jct");
    const h = { Cookie: cookie, Referer: this.getReferer(), "Content-Type": "application/json;charset=UTF-8", "User-Agent": UA };
    const body = { ...postData, csrf };
    const resp = await this.http.post(`${this.apiBase}/x/vu/web/add/v3?t=${Date.now()}&csrf=${csrf}`, body, { headers: h, maxBodyLength: Infinity });
    const d = resp.data || {};
    if (d.code === 0 && d.data && d.data.bvid) {
      return { success: true, platform: "bilibili", publishId: d.data.bvid, aid: d.data.aid, url: "https://www.bilibili.com/video/" + d.data.bvid };
    }
    if (d.code === -1025 || d.code === -1026) { // Cookie 过期 / 未登录
      return { success: false, code: -1025, error: "B站登录态失效，请重新登录", cookieExpired: true, platform: "bilibili" };
    }
    if (d.code === 601) { return { success: false, code: "BILI_RISK_601", error: "B站风控(601)：请先在创作者中心完成滑块验证后重试", platform: "bilibili" }; }
    return { success: false, code: d.code, error: d.message || "B站发布失败", platform: "bilibili" };
  }
}
module.exports = BilibiliAdapter;
