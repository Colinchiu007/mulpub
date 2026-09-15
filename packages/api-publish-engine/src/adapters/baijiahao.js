const { BasePlatformAdapter } = require("../base-adapter");
const crypto = require("crypto");
const fs = require("fs");
const path = require("path");
const qs = require("querystring");
const logger = require("../logger");

// 百家号视频标题上限按 UTF-8 字节数校验（后端 /pcui/article/publish 用
// Math.floor(utf8Bytes/3) > 49 拒绝，即 utf8Bytes >= 150 时拒绝）。实测：
//   30~49 个中文字符（90~147 字节）成功；50 个中文字符（150 字节）被拒；
//   50 字符混合（45 中文+5 英文，140 字节）成功；49 中文+1 英文（148 字节）成功。
// 因此安全上限 = 149 字节。历史视频/一键发布预填文案可能超长，发布前按字节截断兜底。
const BAIJIAHAO_TITLE_MAX_BYTES = 149
/** 按 UTF-8 字节数截断字符串到 maxBytes 字节内，避免把代理对（emoji 等）切成半个字符。 */
function truncateTitle(value, maxBytes = BAIJIAHAO_TITLE_MAX_BYTES) {
  const text = String(value || "").trim()
  const chars = Array.from(text)
  let bytes = 0
  const out = []
  for (const ch of chars) {
    const b = Buffer.byteLength(ch, "utf8")
    if (bytes + b > maxBytes) break
    bytes += b
    out.push(ch)
  }
  return out.join("")
}

// 调试开关：BJ_DEBUG_TRACE=1 且 BJ_DEBUG_LOG=<路径> 时把每个 HTTP 请求/响应写入该文件
// （本机抓包用；默认关闭，不影响生产与测试）
const DEBUG_TRACE = process.env.BJ_DEBUG_TRACE === "1" && Boolean(process.env.BJ_DEBUG_LOG);
const DEBUG_LOG_PATH = process.env.BJ_DEBUG_LOG || "";
function debugLog(...parts) {
  if (!DEBUG_TRACE) return;
  try {
    require("fs").appendFileSync(DEBUG_LOG_PATH, parts.join(" ") + "\n");
  } catch (_) { /* 调试日志失败不阻断发布 */ }
}
function maskCookie(value) {
  if (!value) return "";
  return String(value).split(";").map((c) => {
    const eq = c.indexOf("=");
    if (eq < 0) return c.trim();
    return c.slice(0, eq).trim() + "=<" + c.slice(eq + 1).length + ">";
  }).join("; ");
}

/**
 * BaijiahaoAdapter — 百家号 API 发布（移植参考产品逆向分析实现）
 *
 * 发布链（参考 mp-extracted/packages/main/dist/index.cjs）：
 *  1. getBaseToken      GET /?source=inner → 正则提取 BJH__INIT__AUTH__
 *  2. getAppId          GET /builder/app/appinfo → data.user.app_id
 *  3. preuploadVideo    POST /builder/author/video/preuploadVideo?app_id → upload_key
 *  4. uploadVideoPart   POST rsbjh.baidu.com/.../uploadVideo（分片 multipart）
 *  5. completeUpload    POST /builder/author/video/compuploadVideo → mediaId
 *  6. waitVideoProcess  POST /pcui/video/process 轮询 → editVideo.coverImage
 *  7. publishVideo      POST /pcui/article/publish（postData 含位置/声明）
 *
 * 视频横版（width>=height）走 publishBaijiahaoVideo；竖版需另一接口。
 */
class BaijiahaoAdapter extends BasePlatformAdapter {
  constructor() {
    super("baijiahao");
    this.apiBase = "https://baijiahao.baidu.com";
    // 请求/响应级抓包拦截器（BJ_DEBUG_TRACE=1 时生效）
    this.http.interceptors.request.use((config) => {
      debugLog("[REQ] " + String(config.method || "").toUpperCase() + " " + config.url);
      const h = config.headers || {};
      debugLog("[REQ-HDRS] " + JSON.stringify({
        UA: h["User-Agent"], Accept: h.Accept, CT: h["Content-Type"],
        Referer: h.Referer, Origin: h.Origin, token: h.token ? "<" + String(h.token).length + ">" : undefined,
        secCHUA: h["Sec-CH-UA"], secCHUAMobile: h["Sec-CH-UA-Mobile"], secCHUAPlatform: h["Sec-CH-UA-Platform"],
        SFDest: h["Sec-Fetch-Dest"], SFMode: h["Sec-Fetch-Mode"], SFSite: h["Sec-Fetch-Site"],
        AE: h["Accept-Encoding"], Conn: h.Connection, Cookie: maskCookie(h.Cookie),
      }));
      if (typeof config.data === "string" && config.data.length > 0) {
        debugLog("[REQ-BODY] " + config.data.slice(0, 1600));
      }
      return config;
    });
    this.http.interceptors.response.use((resp) => {
      debugLog("[RESP] status=" + resp.status + " url=" + String(resp.config && resp.config.url));
      const d = resp.data;
      if (typeof d === "string") debugLog("[RESP-BODY] " + d.slice(0, 1000));
      else if (d !== undefined && d !== null) debugLog("[RESP-BODY] " + JSON.stringify(d).slice(0, 1000));
      return resp;
    });
  }
  getReferer() { return "https://baijiahao.baidu.com/builder/rc/edit?type=videoV2"; }
  getOrigin() { return "https://baijiahao.baidu.com"; }

  // P3-7：拉取当前用户的合集列表（bjhtopic，参考产品 collection.sourceId 对应 bjhtopic_id）
  async listCollections(cookie) {
    const h = this.getHeaders(cookie, { Accept: "application/json" });
    const resp = await this.http.get(this.apiBase + "/pcui/topic/list", { headers: h, params: { pn: 1, rn: 50 } });
    const list = resp.data?.data?.list || resp.data?.data?.topics || [];
    return (Array.isArray(list) ? list : []).map(function (t) {
      return { id: t.topic_id || t.id, name: t.topic_name || t.name || "" };
    }).filter(function (t) { return t.id });
  }

  getHeaders(cookie, extra) {
    return super.getHeaders(cookie, {
      "Content-Type": "application/x-www-form-urlencoded",
      // 浏览器指纹头仅限百家号（同源 XHR 形态），不污染其他平台适配器（审查 W1）
      "Accept": "*/*",
      "Accept-Encoding": "gzip, deflate, br",
      "Connection": "keep-alive",
      "Sec-CH-UA": '"Not_A Brand";v="8", "Chromium";v="120", "Google Chrome";v="120"',
      "Sec-CH-UA-Mobile": "?0",
      "Sec-CH-UA-Platform": '"Windows"',
      "Sec-Fetch-Dest": "empty",
      "Sec-Fetch-Mode": "cors",
      "Sec-Fetch-Site": "same-origin",
      ...extra,
    });
  }

  /** 从首页 HTML 提取 BJH__INIT__AUTH__ token（参考产品 getBaijiahaoBaseToken） */
  async getBaseToken(cookie, opts = {}) {
    const stepStart = Date.now()
    const resp = await this.http.get("https://baijiahao.baidu.com/?source=inner", {
      headers: this.getHeaders(cookie, { host: "baijiahao.baidu.com" }),
      ...opts,
    })
    const html = String(resp && resp.data || "")
    const m = /BJH__INIT__AUTH__\s*=\s*(['"])([^'"]+)/.exec(html)
    logger.info("BaijiahaoAdapter", "step=getBaseToken ok=" + Boolean(m) + " cost=" + (Date.now() - stepStart) + "ms")
    return m ? m[2] : ""
  }

  /** appinfo → data.user.app_id（参考产品 getBaijiahaoUserInfoAsync） */
  async getAppId(cookie, opts = {}) {
    const stepStart = Date.now()
    const resp = await this.http.get(this.apiBase + "/builder/app/appinfo", {
      headers: this.getHeaders(cookie, { Referer: "https://baijiahao.baidu.com/", host: "baijiahao.baidu.com" }),
      ...opts,
    })
    const d = resp && resp.data
    const appId = d && d.data && d.data.user ? d.data.user.app_id : ""
    logger.info("BaijiahaoAdapter", "step=getAppId appId=" + String(appId).slice(0, 24) + " cost=" + (Date.now() - stepStart) + "ms")
    return appId
  }

  /** 预上传：拿 upload_key（参考产品 getUploadArgsResponse$6；横版视频 video_type=short） */
  async preuploadVideo(cookie, appId, token, md5, videoType = "short") {
    const body = qs.stringify({ app_id: appId, md5, is_pay_column: 0, video_type: videoType })
    const stepStart = Date.now()
    const resp = await this.http.post(this.apiBase + "/builder/author/video/preuploadVideo?app_id=" + appId, body, {
      headers: this.getHeaders(cookie, { token }),
    })
    const data = (resp && resp.data) || {}
    logger.info("BaijiahaoAdapter", "step=preuploadVideo uploadKey=" + (data.upload_key ? "yes" : "no") + " cost=" + (Date.now() - stepStart) + "ms")
    return data
  }

  /** 分片上传（参考产品 uploadVideoPart） */
  async uploadVideoPart(cookie, buffer, chunkIndex, uploadKey, appId, md5, size, name, chunks, chunk, videoType = "mp4") {
    const FormData = require("form-data")
    const fd = new FormData()
    fd.append("app_id", appId)
    fd.append("md5", md5)
    fd.append("id", "WU_FILE_0")
    fd.append("type", "video/" + videoType)
    fd.append("lastModifiedDate", new Date().toString())
    fd.append("size", String(size))
    fd.append("name", name)
    fd.append("upload_key", uploadKey)
    fd.append("file", buffer, { filename: name, contentType: "application/octet-stream" })
    if (chunks > 1) {
      fd.append("chunks", String(chunks))
      fd.append("chunk", String(chunk))
    }
    let url = "https://rsbjh.baidu.com/builder/author/video/uploadVideo?app_id=" + appId
    const stepStart = Date.now()
    let resp = await this.http.post(url, fd, { headers: { ...this.getHeaders(cookie, { Referer: "https://baijiahao.baidu.com" }), ...fd.getHeaders() } })
    // 存储服务异常时换 rsbjh10/11/12 重试（参考产品 uploadVideoPart 原样逻辑）
    if (resp && resp.data && String(resp.data.error_msg || "").includes("存储服务异常")) {
      for (let i = 0; i < 3; i++) {
        url = "https://rsbjh1" + (i % 3) + ".baidu.com/materialui/video/uploadvideo?app_id=" + appId
        resp = await this.http.post(url, fd, { headers: { ...this.getHeaders(cookie, { Referer: "https://baijiahao.baidu.com" }), ...fd.getHeaders() } })
        if (!String(resp && resp.data && resp.data.error_msg || "").includes("存储服务异常")) break
      }
    }
    const data = (resp && resp.data) || {}
    logger.info("BaijiahaoAdapter", "step=uploadVideoPart chunk=" + chunk + "/" + chunks + " uploadId=" + (data.uploadId ? "yes" : "no") + " cost=" + (Date.now() - stepStart) + "ms")
    return data
  }

  /** 上传完成：拿 mediaId/bos_url（参考产品 uploadCompleteResponse；横版 video_type=short） */
  async completeUpload(cookie, appId, token, uploadKey, chunks, name, size, videoType = "short") {
    const body = qs.stringify({
      upload_key: uploadKey,
      chunks: String(chunks),
      name,
      size: String(size),
      is_pay_column: 0,
      column_videotype: "",
      type: "video",
      video_type: videoType,
    })
    const stepStart = Date.now()
    const resp = await this.http.post(this.apiBase + "/builder/author/video/compuploadVideo?app_id=" + appId, body, {
      headers: this.getHeaders(cookie, { token, Referer: this.getReferer() }),
    })
    const data = (resp && resp.data) || {}
    logger.info("BaijiahaoAdapter", "step=completeUpload mediaId=" + (data.mediaId ? "yes" : "no") + " bos=" + (data.bos_url ? "yes" : "no") + " cost=" + (Date.now() - stepStart) + "ms")
    return data
  }

  /** 轮询视频处理直到 editVideo.coverImage 出现（参考产品 getVideoCover）；deadline/signal 支持任务级超时与取消 */
  async waitVideoProcess(cookie, token, mediaId, maxAttempts = 180, delayMs = 1500, deadline = 0, signal = null) {
    let errorStreak = 0
    for (let i = 0; i < maxAttempts; i++) {
      if (deadline && Date.now() >= deadline) break
      if (signal && signal.aborted) break
      try {
        const attemptStart = Date.now()
        const resp = await this.http.post(this.apiBase + "/pcui/video/process", "mediaId=" + encodeURIComponent(mediaId), {
          headers: this.getHeaders(cookie, { token, Referer: "https://baijiahao.baidu.com" }),
        })
        const editVideo = resp && resp.data && resp.data.data && resp.data.data.editVideo
        const cover = editVideo && editVideo.coverImage
        if (typeof cover === "string" && cover.startsWith("http")) {
          errorStreak = 0
          logger.info("BaijiahaoAdapter", "step=videoProcess cover=ok attempt=" + (i + 1) + " cost=" + (Date.now() - attemptStart) + "ms")
          return cover
        }
        if (i === 0 || (i + 1) % 10 === 0) {
          logger.info("BaijiahaoAdapter", "step=videoProcess waiting attempt=" + (i + 1) + "/" + maxAttempts)
        }
      } catch (_) {
        // 连续异常视为服务不可用，提前止损（避免空转整个轮询预算）
        errorStreak++
        if (errorStreak >= 10) break
      }
      await new Promise((r) => setTimeout(r, delayMs))
    }
    return null
  }

  /** 视频发布 postData（参考产品 buildPostData$r；位置可选，无则空对象） */
  buildVideoPostData(taskData, uploadResult, verticalCover = "", videoName = "", draftId = "") {
    const parts = []
    // 百家号标题上限按 UTF-8 字节数校验（后端 /pcui/article/publish 用
    // Math.floor(utf8Bytes/3) > 49 拒绝，安全上限 149 字节）。
    // 历史视频/一键发布预填的文案可能超长，这里按字节截断兜底，保证发布不因标题超长失败。
    // 用 Array.from 按 Unicode 码点遍历，避免把代理对（emoji 等）切成半个字符。
    const title = truncateTitle(taskData.title)
    const rawDuration = taskData.video && Number(taskData.video.duration) > 0 ? Number(taskData.video.duration) : 0
    const duration = Math.round(rawDuration)
    parts.push("video_duration=" + duration)
    parts.push("type=video")
    parts.push("usingImgFilter=false&source_reprinted_allow=0&nryx_mount_list=&is_consultant_card=")
    parts.push("image_edit_point=&ducut_info=&cover_source=upload&bjhmt=&aigc_rebuild=")
    parts.push("title=" + encodeURIComponent(title))
    // desc：纯文本（剥离 HTML）
    let desc = String(taskData.content || "")
    desc = desc.replace(/<[^>]+>/g, "").trim()
    const mediaId = (uploadResult && uploadResult.mediaId) || (taskData.mediaId) || ""
    const finalName = (videoName && String(videoName).length > 2) ? videoName : (title || "video") + ".mp4"
    const content = JSON.stringify([{ title, desc: desc.length > 2 ? desc : title, mediaId, videoName: finalName, local: 1 }])
    parts.push("content=" + encodeURIComponent(content))
    parts.push("desc=" + encodeURIComponent(desc.length > 2 ? desc : ""))
    const fingerprint = JSON.stringify({ s2l: null, s2game: null, bjh: { duration } })
    parts.push("bjh_video_finger_printing=" + encodeURIComponent(fingerprint))
    const tags = Array.isArray(taskData.tags) ? taskData.tags : []
    parts.push("tag=" + encodeURIComponent(tags.join(",")))
    // 位置：可选，无 location 传空对象（position_lat_lng={}）
    const loc = taskData.location
    if (loc && loc.uid) {
      const pos = {
        addr: loc.addr || "", city: loc.city_name || "", poi_type: "life", type: 0,
        city_id: loc.city_id || "", lng: 0, lat: 0, name: loc.name || "",
        pid: loc.street_id || loc.uid, tag: "",
      }
      if (Array.isArray(loc.cla)) pos.tag = loc.cla.map((c) => c[1]).join(",")
      parts.push("position_lat_lng=" + encodeURIComponent(JSON.stringify(pos)))
    } else {
      parts.push("position_lat_lng=%7B%7D")
    }
    // 封面（参考产品格式：cover_layout/cover_images/_cover_images_map）
    if (uploadResult && uploadResult.coverUrl) {
      const cover = { src: uploadResult.coverUrl, cropData: { x: 0, y: 0, width: 0, height: 0 }, machine_chooseimg: 0, isLegal: 1 }
      parts.push("cover_layout=one")
      parts.push("cover_images=" + encodeURIComponent(JSON.stringify([cover])))
      parts.push("_cover_images_map=" + encodeURIComponent(JSON.stringify([{ src: uploadResult.coverUrl, origin_src: uploadResult.coverUrl }])))
    } else {
      parts.push("_cover_images_map=")
    }
    parts.push("vertical_cover=" + (verticalCover ? encodeURIComponent(verticalCover) : ""))
    // 常驻字段（参考产品 buildPostData$r 尾部）
    parts.push("isBeautify=false")
    // AI 生成内容声明（aigc_bjh_status）：默认勾选「AI 生成内容」。
    // 平台要求内容创作声明如实选择，AI 生成内容必须勾选，否则违规。
    // taskData.aiGenerated === false 时显式不勾选（人工创作内容）。
    const aiGenerated = taskData.aiGenerated !== false
    parts.push("activity_list%5B0%5D%5Bid%5D=aigc_bjh_status&activity_list%5B0%5D%5Bis_checked%5D=" + (aiGenerated ? 1 : 0))
    parts.push("fe_from=BJH_CMS_PC")
    // P2-1：合集（bjhtopic_info/bjhtopic_id，参考产品映射 collection → {id, name}）
    const collection = taskData.collection
    if (collection && (collection.id || collection.sourceId)) {
      const topicId = String(collection.id || collection.sourceId)
      const topicInfo = JSON.stringify({ topic_id: topicId, topic_name: collection.name || collection.sourceName || "" })
      parts.push("bjhtopic_info=" + encodeURIComponent(topicInfo))
      parts.push("bjhtopic_id=" + encodeURIComponent(topicId))
    } else {
      parts.push("bjhtopic_info=&bjhtopic_id=")
    }
    // 原创声明（参考产品 original_status：original → 2）
    parts.push("original_status=" + (taskData.original ? 2 : 0))
    if (taskData.original) {
      parts.push("announce_id=0")
      const announce = { first_publish: 1 }
      if (taskData.original.originalAuthorName) {
        announce.tp_author = taskData.original.originalAuthorName
        announce.tp_url = taskData.original.originalUrl || ""
      }
      parts.push("announce_info=" + encodeURIComponent(JSON.stringify(announce)))
    }
    const resolvedDraftId = draftId || taskData.draftId || ""
    if (resolvedDraftId) parts.push("draft_id=" + encodeURIComponent(resolvedDraftId))
    return parts.join("&")
  }

  /** 发布（参考产品 publish$9：pcui/article/publish 或 save） */
  async publishVideo(cookie, token, postData, opts = {}) {
    const isDraft = opts.draft === true
    const url = this.apiBase + "/pcui/article/" + (isDraft ? "save" : "publish")
    const stepStart = Date.now()
    const resp = await this.http.post(url, postData, {
      headers: this.getHeaders(cookie, { token, Referer: this.getReferer() }),
    })
    const d = resp && resp.data
    logger.info("BaijiahaoAdapter", "step=publishVideo endpoint=" + (isDraft ? "save" : "publish") + " errno=" + (d && d.errno) + " errmsg=" + String((d && d.errmsg) || "").slice(0, 100) + " cost=" + (Date.now() - stepStart) + "ms")
    if (d && (d.errno === 0 || d.errno === "0") && (d.ret && (d.ret.id || d.ret.article_id))) {
      return { success: true, platform: "baijiahao", publishId: d.ret.id || d.ret.article_id, raw: d }
    }
    // errno 10000015：百家号账号风控弹码（如“30天内注册的百家号作者弹码”），
    // 需在浏览器内完成手机/人脸验证后账号级别放行，请求头无法绕开。
    // 给出可操作提示，避免用户被“网络环境异常”误导。
    if (d && (d.errno === 10000015 || d.errno === "10000015")) {
      const hitRule = d.data && d.data.hit_rule ? String(d.data.hit_rule) : ""
      const scenes = Array.isArray(d.data && d.data.pass_auth)
        ? d.data.pass_auth.map((a) => a && a.auth_scene).filter(Boolean).join("/")
        : ""
      const hint = "百家号发布被风控拦截（" + (hitRule || "需完成身份验证") + "）。"
        + "请先在浏览器中登录百家号完成验证（" + (scenes || "手机号/身份验证") + "），验证通过后重新发布。"
      return { success: false, error: hint, code: d.errno, platform: "baijiahao", raw: d }
    }
    return { success: false, error: (d && d.errmsg) || "Publish failed", code: d && d.errno, platform: "baijiahao", raw: d }
  }

  /** 错误消息脱敏：只回显 errmsg/errno，避免 upload_key/mediaId 等半敏感瞬时值进入用户可见错误 */
  errSummary(data) {
    if (!data || typeof data !== "object") return "无响应"
    if (data.errmsg) return String(data.errmsg).slice(0, 200)
    if (data.error_msg) return String(data.error_msg).slice(0, 200)
    return "errno=" + (data.errno !== undefined ? data.errno : "未知")
  }

  async uploadVideo(td, cookie, opts = {}) {
    // 空上传契约：无视频信息返回 null（不抛错）
    if (!td || !td.video) return null
    const videoPath = td.video && (td.video.path || td.video.localPath)
    if (!videoPath || !fs.existsSync(videoPath)) return null
    const chainStart = Date.now()
    logger.info("BaijiahaoAdapter", "step=uploadVideo start path=" + videoPath + " size=" + (fs.statSync(videoPath).size || 0))
    const stat = fs.statSync(videoPath)
    const buffer = fs.readFileSync(videoPath)
    const md5 = crypto.createHash("md5").update(buffer).digest("hex")
    const name = path.basename(videoPath)
    const appId = await this.getAppId(cookie, opts.httpOptions)
    if (!appId) throw new Error("getAppId 返回空（Cookie 无效或接口变更）")
    const token = await this.getBaseToken(cookie, opts.httpOptions)
    if (!token) throw new Error("getBaseToken 返回空（Cookie 无效或页面结构变更）")
    const pre = await this.preuploadVideo(cookie, appId, token, md5, "short")
    if (!pre || !pre.upload_key) throw new Error("preuploadVideo 失败: " + this.errSummary(pre))
    // 分片上传（参考产品 2MB/片，Oe=2097152；每片响应需含 uploadId）
    const CHUNK = 2097152
    const chunks = Math.max(1, Math.ceil(stat.size / CHUNK))
    for (let i = 0; i < chunks; i++) {
      if (opts.signal && opts.signal.aborted) throw new Error("任务已取消")
      const start = i * CHUNK
      const end = Math.min(start + CHUNK, stat.size)
      const chunkBuf = buffer.slice(start, end)
      const part = await this.uploadVideoPart(cookie, chunkBuf, i, pre.upload_key, appId, md5, stat.size, name, chunks, i, "mp4")
      if (!part || !part.uploadId) throw new Error("uploadVideoPart 分片 " + (i + 1) + "/" + chunks + " 失败: " + this.errSummary(part))
    }
    const complete = await this.completeUpload(cookie, appId, token, pre.upload_key, chunks, name, stat.size, "short")
    if (!complete || !complete.bos_url) throw new Error("compuploadVideo 失败: " + this.errSummary(complete))
    return {
      mediaId: complete.mediaId,
      uploadKey: pre.upload_key,
      appId,
      token,
      duration: td.video && td.video.duration ? Math.round(Number(td.video.duration)) : 0,
    }
  }

  async uploadCover(td, cookie, opts = {}) {
    if (!td || !td.cover) return null
    return { path: td.cover }
  }

  buildPostData(taskData, uploadResult) {
    return this.buildVideoPostData(taskData, uploadResult)
  }

  async publish(cookie, postData, opts = {}) {
    // 基类契约第 3 参是 cancelToken；本适配器要求 opts.token（经 execute/publishViaApi 进入）。
    // 直调发现 cancelToken 形态（无 token）时显式报错，避免带空 token 发布。
    if (opts && typeof opts === "object" && "isCancelled" in opts && opts.token === undefined) {
      throw new Error("BaijiahaoAdapter.publish 需要 opts.token（请经 publishViaApi/execute 发布）")
    }
    const token = opts.token || ""
    return this.publishVideo(cookie, token, postData, opts)
  }

  /** 完整执行：上传 → 处理轮询 → 发布 */
  async execute(taskData, cookie, opts = {}) {
    try {
      if (!taskData.video) throw new Error("缺少视频信息")
      if (!taskData.video.width || !taskData.video.height) {
        // 未提供宽高时尝试 ffprobe 探测；失败则报错（参考产品要求必填）
        throw new Error("视频宽高不能为空（需先探测视频宽高）")
      }
      if (taskData.video.width < taskData.video.height) {
        throw new Error("竖版视频，请使用竖版接口发布")
      }
      if (taskData.cover) {
        // 封面上传链为后续迭代；显式拒绝而非静默忽略用户选择
        return { success: false, error: "API 发布暂不支持自定义封面（仅视频首帧封面），请移除封面后重试", platform: "baijiahao" }
      }
      const deadline = Number(opts.timeout) > 0 ? Date.now() + Number(opts.timeout) : 0
      const signal = opts.signal || null
      const upload = await this.uploadVideo(taskData, cookie, opts)
      if (!upload) throw new Error("视频文件缺失或无法读取（请检查视频路径）")
      const token = upload.token
      const cover = await this.waitVideoProcess(cookie, token, upload.mediaId, 180, 1500, deadline, signal)
      if (deadline && Date.now() >= deadline) {
        return { success: false, error: "任务级超时（" + Number(opts.timeout) + "ms 内未完成发布）", platform: "baijiahao" }
      }
      if (signal && signal.aborted) return { success: false, error: "任务已取消", platform: "baijiahao" }
      // 封面降级：video/process 超时/未返回时不阻断发布（封面字段为空，走 _cover_images_map=）
      const postData = this.buildVideoPostData(taskData, { mediaId: upload.mediaId, coverUrl: cover }, "", path.basename(taskData.video.path || ""))
      const result = await this.publishVideo(cookie, token, postData, opts)
      if (!result.success) return result
      return { success: true, platform: "baijiahao", publishId: result.publishId, url: "https://baijiahao.baidu.com/pcui/article/" + result.publishId }
    } catch (e) {
      return { success: false, error: e instanceof Error ? e.message : String(e), platform: "baijiahao" }
    }
  }
}
module.exports = BaijiahaoAdapter;
