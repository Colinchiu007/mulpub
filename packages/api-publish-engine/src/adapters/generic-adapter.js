const { BasePlatformAdapter } = require("../base-adapter");
const { upload } = require("../../upload/orchestrator");
const platformConfigs = require("./platform-configs");

/**
 * GenericPlatformAdapter - config-driven adapter for simple publish platforms.
 * Created during Phase 1.3 refactoring to eliminate ~20 boilerplate adapters.
 */
class GenericPlatformAdapter extends BasePlatformAdapter {
  constructor(name, config) {
    super(name);
    this.apiBase = config.apiBase;
    this._referer = config.referer;
    this._origin = config.origin;
    this._contentType = config.contentType;
    this._publishPath = config.publishPath;
    // orchestrator 的 upload() 一次就把「视频 + 封面」全传完，而基类发布流程会
    // 先调 uploadVideo() 再调 uploadCover()。此前两个方法各自跑一遍 upload()，
    // 同一任务的文件被重复上传两遍（带宽/配额翻倍、平台侧产生冗余素材、
    // 大视频场景直接翻倍耗时）。这里按任务指纹共享同一个 in-flight Promise。
    this._uploads = new Map();
  }

  _uploadKey(td, cookie) {
    const t = td || {};
    return [this.name, t.filePath, t.coverPath, t.taskId || t.id, cookie ? String(cookie).length : 0].join("|");
  }

  async _uploadOnce(td, cookie) {
    const key = this._uploadKey(td, cookie);
    const cached = this._uploads.get(key);
    if (cached) return cached;
    // 简单上限：跨任务复用同一 adapter 实例时不让缓存无限增长。
    if (this._uploads.size > 32) this._uploads.clear();
    const run = upload({ ...td, platform: this.name }, cookie).catch((e) => {
      // 失败不缓存，保留上层重试语义（缓存一个已 reject 的 Promise 会让重试永远失败）。
      this._uploads.delete(key);
      throw e;
    });
    this._uploads.set(key, run);
    return run;
  }

  getReferer() { return this._referer; }
  getOrigin() { return this._origin; }

  getHeaders(cookie, extra) {
    return super.getHeaders(cookie, { "Content-Type": this._contentType, ...extra });
  }

  async uploadVideo(td, cookie) {
    const r = await this._uploadOnce(td, cookie);
    return r?.video || null;
  }

  async uploadCover(td, cookie) {
    const r = await this._uploadOnce(td, cookie);
    return r?.cover || null;
  }

  buildPostData(t) {
    return { title: t.title || "", content: t.content || "", tags: t.tags || [] };
  }

  async publish(cookie, postData) {
    const h = this.getHeaders(cookie);
    const resp = await this.http.post(this.apiBase + this._publishPath, postData, { headers: h });
    if (resp.data?.code === 0 || resp.data?.ret === 0 || resp.data?.success)
      return { success: true, platform: this.name, publishId: resp.data?.data?.id || resp.data?.data?.post_id };
    return { success: false, error: resp.data?.msg || "Publish failed", platform: this.name };
  }
}

/**
 * Create a generic adapter instance for the given platform.
 */
function createAdapter(name) {
  const config = platformConfigs[name];
  if (!config) return null;
  return new GenericPlatformAdapter(name, config);
}

module.exports = { GenericPlatformAdapter, createAdapter };
