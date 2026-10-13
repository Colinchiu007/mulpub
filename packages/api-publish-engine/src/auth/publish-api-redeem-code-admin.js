'use strict'

// 会员中心 A2：兑换码**运营查询与吊销**路由方法。
// 从 publish-api-server.js 按既有 mixin 范式拆出（与 publish-api-commerce.js 同构），
// 通过 applyRedeemCodeAdminHelpers 挂回原型；全部方法以 this 绑定访问实例成员
// （_json/_auditLog/_ownerSubject/_subscriptionService/_parseBody）。
//
// 为什么要拆：publish-api-server.js 有逐文件行数点名目标（1574 行），
// 新增路由若留在原地会触发 TARGET_GREW 门禁；且这段逻辑自成一块（运营兑换码），
// 独立成文件后边界更清楚。

class PublishApiRedeemCodeAdminHelpers {
  /**
   * /api/v1/admin/member/* 全部分支。返回 true 表示已处理（调用方应立即 return）。
   *
   * 鉴权守卫与它守护的 handler 刻意待在同一处：守卫一旦被移到别处，
   * 审查时就容易漏看「哪个端点被它覆盖」。
   */
  async _handleAdminMemberRoute(req, res, method, url) {
    if (url.indexOf("/api/v1/admin/member/") === 0) {
      // ⚠️ 已发出响应即算「已处理」，必须 return true。裸 return 会让调用方以为本块
      // 没管这件事而继续往下走，从而对同一个 req 发出**第二个**响应。
      // 运营端点会花钱/发权益：只认经 scope 校验的 logto 身份，拒绝静态主密钥（api_key 分支不校验 requiredScope）。
      if (!(req.auth && req.auth.authType === "logto")) { this._json(res, 403, { error: "AUTH_SCOPE_MISSING" }); return true; }
      if (!this._subscriptionService) { this._json(res, 503, { error: "SUBSCRIPTION_SERVICE_NOT_CONFIGURED" }); return true; }
      try {
        if (method === "POST" && url === "/api/v1/admin/member/grant") {
          var grantBody = await this._parseBody(req);
          if (!grantBody || typeof grantBody.userId !== "string" || !grantBody.userId) { this._json(res, 400, { error: "USER_ID_REQUIRED" }); return; }
          var grantResult = await this._subscriptionService.grant({
            userId: grantBody.userId,
            plan: grantBody.plan,
            durationDays: grantBody.durationDays,
            providerReference: grantBody.providerReference || null,
            operator: grantBody.operator || null,
          });
          this._json(res, 200, { success: true, ...grantResult });
          return true;
        }
        if (method === "POST" && url === "/api/v1/admin/member/redeem-codes") {
          var batchBody = await this._parseBody(req);
          var batchResult = await this._subscriptionService.createRedeemBatch({
            plan: batchBody && batchBody.plan,
            durationDays: batchBody && batchBody.durationDays,
            count: batchBody && batchBody.count,
            batch: batchBody && batchBody.batch || null,
            expiresAt: batchBody && batchBody.expiresAt || null,
          });
          this._json(res, 200, { success: true, ...batchResult });
          return true;
        }
        if (await this._handleAdminRedeemCodeList(req, res, method, url)) return true;
        if (await this._handleAdminRedeemCodeDisable(req, res, method, url)) return true;
        this._json(res, 404, { error: "ROUTE_NOT_FOUND" });
        return true;
      } catch (error) {
        if (this._handleAdminRedeemCodeError(req, res, error)) return true;
        this._commerceFailure(req, res, error); return true;
      }
    }
    return false;
  }

  /**
   * 解析 query string 为纯对象（同名参数取最后一个）。
   * 与 requestPath 同层：后者剥 path，前者取参数。非法转义一律交给 service 层校验，
   * 不在路由层静默吞掉——吞掉会让「筛选没生效」表现为「筛选结果为空」，极难排查。
   */
  _queryParams(req) {
    const raw = String(req && req.url ? req.url : "")
    const qs = raw.indexOf("?")
    if (qs === -1) return {}
    const out = {}
    for (const pair of raw.slice(qs + 1).split("&")) {
      if (!pair) continue
      const eq = pair.indexOf("=")
      const key = eq === -1 ? pair : pair.slice(0, eq)
      const value = eq === -1 ? "" : pair.slice(eq + 1)
      if (key) out[decodeURIComponent(key)] = decodeURIComponent(value)
    }
    return out
  }

  /** GET /api/v1/admin/member/redeem-codes —— 运营列表，默认掩码。 */
  async _handleAdminRedeemCodeList(req, res, method, url) {
    if (method !== "GET" || url !== "/api/v1/admin/member/redeem-codes") return false;
    const listQuery = this._queryParams(req);
    const listResult = await this._subscriptionService.listRedeemCodes({
      plan: listQuery.plan || null,
      status: listQuery.status || null,
      batch: listQuery.batch || null,
      limit: listQuery.limit === undefined ? 20 : Number(listQuery.limit),
      offset: listQuery.offset === undefined ? 0 : Number(listQuery.offset),
      // 只有字符串 "true" 放行；"1"/"yes" 都按掩码处理，避免调用方误判已开启
      reveal: listQuery.reveal === "true",
    });
    if (listResult.revealed) {
      // 「导出全部未兑换码」若无归属，泄漏就无从追查——显式 reveal 必须留痕。
      this._auditLog.log({
        ownerSubject: this._ownerSubject(req),
        type: "redeem_code_reveal",
        count: listResult.codes.length,
        plan: listQuery.plan || null,
        status: listQuery.status || null,
        batch: listQuery.batch || null,
      });
    }
    this._json(res, 200, { success: true, ...listResult });
    return true;
  }

  /** POST /api/v1/admin/member/redeem-codes/disable —— 吊销（禁用）单个码。 */
  async _handleAdminRedeemCodeDisable(req, res, method, url) {
    if (method !== "POST" || url !== "/api/v1/admin/member/redeem-codes/disable") return false;
    const disableBody = await this._parseBody(req);
    const disableResult = await this._subscriptionService.disableRedeemCode({
      code: disableBody && disableBody.code,
    });
    this._json(res, 200, { success: true, ...disableResult });
    return true;
  }

  /**
   * 碰撞补足失败的专用错误出口（409）。
   *
   * _commerceFailure 只回 {error, message}，会把服务层挂在异常上的**已签发码**丢掉——
   * 调用方既不知道拿到了多少、也拿不到可交付的那部分，等于让运营重签。
   * 这是本仓库唯一需要携带业务载荷的 commerce 错误，故单独出口。
   */
  /** 只处理碰撞补足失败；其余 commerce 错误交回调用方走 _commerceFailure。 */
  _handleAdminRedeemCodeError(req, res, error) {
    if (!error || error.code !== "REDEEM_BATCH_INCOMPLETE") return false;
    this._redeemBatchIncomplete(req, res, error);
    return true;
  }

  _redeemBatchIncomplete(req, res, error) {
    this._auditLog.log({
      ownerSubject: this._ownerSubject(req),
      type: "redeem_code_batch_incomplete",
      requested: error.requested,
      generated: error.generated,
      rounds: error.rounds,
    });
    this._json(res, 409, {
      error: "REDEEM_BATCH_INCOMPLETE",
      message: error.message,
      requested: error.requested,
      generated: error.generated,
      rounds: error.rounds,
      codes: error.created,
    });
  }
}

function applyRedeemCodeAdminHelpers(Proto) {
  const names = Object.getOwnPropertyNames(PublishApiRedeemCodeAdminHelpers.prototype);
  for (const key of names) {
    if (key === "constructor") continue;
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(PublishApiRedeemCodeAdminHelpers.prototype, key));
  }
}

module.exports = { applyRedeemCodeAdminHelpers };
