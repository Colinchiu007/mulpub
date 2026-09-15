// CommentMessageService — 评论自动回复服务
// 基于参考产品 4.0 CommentMessageService 分析实现

// CommentProvider 基类 — 各平台需继承
class CommentProvider {
  async getCommentList(cookie, params) { throw new Error("subclass must implement getCommentList"); }
  /** @returns {Promise<{success: boolean, data?: any, error?: string}>} */
  async replyComment(cookie, commentId, content) { throw new Error("subclass must implement replyComment"); }
}

// EchoReplyGenerator — 简单回复生成器（回复原文+默认文本）
class EchoReplyGenerator {
  generateReply(comment) {
    return "感谢您的评论！回复: " + (comment.content || "");
  }
}

// TemplateReplyGenerator — 模板回复生成器
class TemplateReplyGenerator {
  constructor(opts) {
    this.template = (opts && opts.template) || "谢谢: {content}";
  }
  generateReply(comment) {
    return this.template.replace("{content}", comment.content || "").replace("{author}", comment.author || "");
  }
}

// CommentMessageService — 主服务
class CommentMessageService {
  constructor(account, opts) {
    opts = opts || {};
    this.account = account;
    this.interval = opts.interval || 30000;       // 轮询间隔 (ms)
    this.maxDays = opts.maxDays || 7;              // 评论内容最大天数
    this._polling = false;
    this._timer = null;
    this._lastTimestamp = 0;
    this._replyGen = opts.replyGenerator || new EchoReplyGenerator();
    this._provider = opts.provider || null;
    this._replyCallbacks = [];
  }

  // 注册回复回调
  onReply(cb) { this._replyCallbacks.push(cb); }

  // 设置自定义 provider（用于测试或平台适配）
  setProvider(provider) { this._provider = provider; }

  // 启动轮询
  async start(intervalOverride) {
    if (this._polling) return;
    this._polling = true;
    var intv = intervalOverride || this.interval;
    await this._poll(intv);
  }

  // 停止轮询
  async stop() {
    this._polling = false;
    if (this._timer) { clearTimeout(this._timer); this._timer = null; }
  }

  // 内部轮询循环
  async _poll(interval) {
    var self = this;
    async function tick() {
      if (!self._polling) return;
      try {
        var comments = await self._fetchComments();
        for (var i = 0; i < comments.length; i++) {
          var c = comments[i];
          if (c.timestamp > self._lastTimestamp) {
            var reply = self._replyGen.generateReply(c);
            var result = await self._reply(c, reply);
            if (result && result.success) {
              self._lastTimestamp = c.timestamp;
              self._emitReply(c, reply);
            }
          }
        }
      } catch(e) { console.warn("[CommentService] poll error:", e.message); }
      self._timer = setTimeout(tick, interval);
      // R28 修复：递归轮询定时器需 unref，不阻止进程退出
      if (self._timer && self._timer.unref) self._timer.unref();
    }
    tick();
  }

  // 获取评论列表 — 由 provider 或子类实现
  async _fetchComments() {
    if (this._provider) return this._provider.getCommentList(this.account.cookie, { maxDays: this.maxDays });
    return [];
  }

  // 回复评论 — 由 provider 或子类实现
  async _reply(comment, content) {
    if (this._provider) return this._provider.replyComment(this.account.cookie, comment.id, content);
    return { success: false, error: "no provider" };
  }

  // 触发回复回调
  _emitReply(comment, reply) {
    for (var i = 0; i < this._replyCallbacks.length; i++) {
      try { this._replyCallbacks[i](comment, reply); } catch(e) { /* ignore */ }
    }
  }
}

module.exports = { CommentMessageService, CommentProvider, EchoReplyGenerator, TemplateReplyGenerator };
