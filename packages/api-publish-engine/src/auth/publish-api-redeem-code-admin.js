'use strict'

// 会员中心 A2：兑换码**运营查询与吊销**路由方法。
// 从 publish-api-server.js 按既有 mixin 范式拆出（与 publish-api-commerce.js 同构），
// 通过 applyRedeemCodeAdminHelpers 挂回原型；全部方法以 this 绑定访问实例成员
// （_json/_auditLog/_ownerSubject/_subscriptionService/_parseBody）。
//
// 为什么要拆：publish-api-server.js 有逐文件行数点名目标（1574 行），
// 新增路由若留在原地会触发 TARGET_GREW 门禁；且这段逻辑自成一块（运营兑换码），
// 独立成文件后边界更清楚。

/**
 * 一批码的**指纹**（不落码本身）。
 *
 * 为什么需要：审计里若只记 batch 标签，运营可以用同一个标签签发两批 ⇒ 事后无法区分；
 * 若把 500 个码原样写进审计，审计文件本身会变成新的泄漏面。
 * ⇒ 记一个可复算的指纹（码排序后的 sha256 前 16 位）：
 *   · 两次签发即便同标签，指纹也不同 ⇒ 可区分；
 *   · 泄漏后拿到码清单可自行算指纹比对 ⇒ 可判断「泄漏的码是不是这一批」。
 */
function codeDigest(codes) {
  try {
    const crypto = require('crypto')
    const list = Array.isArray(codes) ? codes.filter((c) => typeof c === 'string' && c).sort() : []
    if (!list.length) return null
    return crypto.createHash('sha256').update(list.join('\n')).digest('hex').slice(0, 16)
  } catch (error) {
    return null
  }
}

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
          if (!grantBody || typeof grantBody.userId !== "string" || !grantBody.userId) {
            // 失败也要留痕：被拒绝的开通尝试是「有人在反复试」的信号。
            this._auditAdminFailure(req, this._adminActionType(url, method), "USER_ID_REQUIRED", 400);
            this._json(res, 400, { error: "USER_ID_REQUIRED" }); return true;
          }
          var grantResult = await this._subscriptionService.grant({
            userId: grantBody.userId,
            plan: grantBody.plan,
            durationDays: grantBody.durationDays,
            providerReference: grantBody.providerReference || null,
            operator: grantBody.operator || null,
          });
          // 审计：手动开通是**直接发放权益**的花钱动作，必须留痕（谁、何时、给谁、什么档、几天）。
          // 范式同既有 redeem_code_reveal。
          // ⚠️ 业务字段装在 details 里：`AuditLog.log` 只认固定字段表，
          // 直接传 userId/plan/durationDays 会被静默丢弃。
          this._auditLog.log({
            ownerSubject: this._ownerSubject(req),
            type: "member_grant",
            status: "success",
            title: `开通 ${grantBody.plan} ${grantBody.durationDays} 天`,
            details: {
              // actor = **token subject**（权威）；operator 是请求体自称（可伪造，仅作备注）
              actor: this._ownerSubject(req),
              userId: grantBody.userId,
              plan: grantBody.plan,
              durationDays: grantBody.durationDays,
              operator: grantBody.operator || null,
            },
          });
          this._json(res, 200, { success: true, ...grantResult });
          return true;
        }
        if (method === "POST" && url === "/api/v1/admin/member/redeem-codes") {
          var batchBody = await this._parseBody(req);
          // ⚠️ fail-closed：engine 只认 camelCase 的 issuedTo。若调用方发的是 snake 的
          // issued_to，**静默忽略**会让「发放对象」看起来填了、其实没落库
          // ⇒ 泄漏后无从追查是哪一批。宁可 400，也不让它悄悄消失。
          if (batchBody && batchBody.issued_to !== undefined && batchBody.issuedTo === undefined) {
            this._auditAdminFailure(req, this._adminActionType(url, method), "ISSUED_TO_KEY_INVALID", 400);
            this._json(res, 400, { error: "ISSUED_TO_KEY_INVALID", message: "字段名必须是 issuedTo" }); return true;
          }
          var batchResult = await this._subscriptionService.createRedeemBatch({
            plan: batchBody && batchBody.plan,
            durationDays: batchBody && batchBody.durationDays,
            count: batchBody && batchBody.count,
            batch: batchBody && batchBody.batch || null,
            expiresAt: batchBody && batchBody.expiresAt || null,
            issuedTo: batchBody && batchBody.issuedTo || null,
          });
          // 审计：批量签发 = 一次性制造 N 张可兑的资产，**等价于放出一笔等值的钱**。
          // 不留痕的话，泄漏后连「这批码是谁签的」都查不到。
          // ⚠️ 业务字段装在 details 里（AuditLog.log 的固定字段表会静默丢弃其余字段）。
          this._auditLog.log({
            ownerSubject: this._ownerSubject(req),
            type: "redeem_code_batch_issued",
            status: "success",
            title: `批量签发 ${batchResult.generated} 个 ${batchResult.plan} · ${batchResult.durationDays} 天`,
            details: {
              actor: this._ownerSubject(req),
              batch: batchResult.batch,
              plan: batchResult.plan,
              durationDays: batchResult.durationDays,
              issuedTo: batchResult.issuedTo || null,
              count: batchResult.generated,
              // 批次指纹：同标签的两次签发可区分；泄漏清单可自行算指纹比对
              codeDigest: codeDigest(batchResult.codes),
            },
          });
          this._json(res, 200, { success: true, ...batchResult });
          return true;
        }
        if (await this._handleAdminRedeemCodeList(req, res, method, url)) return true;
        if (await this._handleAdminRedeemCodeDisable(req, res, method, url)) return true;
        this._json(res, 404, { error: "ROUTE_NOT_FOUND" });
        return true;
      } catch (error) {
        // ⚠️ 失败路径也要留痕：否则「操作没生效」在审计上与「什么都没发生」同形，
        // 且 stats.failed 恒为 0 ⇒ 运营反复试错 / 被参数拒绝完全隐形。
        // 只对**会改变状态**的运营动作留痕（读操作的失败不记，避免噪音）。
        const actionType = this._adminActionType(url, method);
        if (actionType) this._auditAdminFailure(req, actionType, error && error.code, error && error.status);
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
      //
      // ⚠️ 业务字段必须装在 `details` 里：`AuditLog.log` 只认一组**固定字段**
      // （id/ownerSubject/type/platform/title/status/error/publishId/details/createdAt），
      // 直接传 count/plan/status/batch 会被**静默丢弃**——审计里只剩「发生过」，
      // 看不到「导出了什么」⇒ 追查时等于没留痕。
      this._auditLog.log({
        ownerSubject: this._ownerSubject(req),
        type: "redeem_code_reveal",
        status: "success",
        title: `导出未兑换码 ${listResult.codes.length} 个`,
        details: {
          actor: this._ownerSubject(req),
          count: listResult.codes.length,
          plan: listQuery.plan || null,
          status: listQuery.status || null,
          batch: listQuery.batch || null,
          // 导出的是**仍可兑**的码 ⇒ 记指纹（不记码本身）：泄漏后可用清单比对
          codeDigest: codeDigest(listResult.codes),
        },
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
    // 审计：作废 = 权益收回。必须能回答「谁在何时作废了哪个码」。
    // ⚠️ 业务字段装在 details 里（AuditLog.log 的固定字段表会静默丢弃其余字段）。
    this._auditLog.log({
      ownerSubject: this._ownerSubject(req),
      type: "redeem_code_disabled",
      status: "success",
      title: `作废兑换码 ${disableBody && disableBody.code}`,
      details: {
        actor: this._ownerSubject(req),
        code: disableBody && disableBody.code,
        idempotent: disableResult.idempotent === true,
      },
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

  /**
   * 这个 URL 对应的是哪个**会改变状态**的运营动作（读操作返回 null）。
   * 失败审计用它来决定「记不记、记成哪一类」。
   */
  _adminActionType(url, method) {
    if (method === "POST" && url === "/api/v1/admin/member/grant") return "member_grant";
    if (method === "POST" && url === "/api/v1/admin/member/redeem-codes") return "redeem_code_batch_issued";
    if (method === "POST" && url === "/api/v1/admin/member/redeem-codes/disable") return "redeem_code_disabled";
    return null;
  }

  /**
   * 失败审计：运营动作没生效时留一条 status=failed 的条目。
   *
   * ⚠️ 业务字段必须装在 details 里（AuditLog.log 只认固定字段表，其余静默丢弃）。
   * ⚠️ 鉴权失败（401/403）**不**在这里记：未通过鉴权的请求还没进入运营动作域，
   *    且未鉴权流量会把它灌成噪音（那是限流/访问日志该管的事）。
   */
  _auditAdminFailure(req, actionType, errorCode, httpStatus, extra) {
    const code = typeof errorCode === "string" && /^[A-Z][A-Z0-9_]{2,63}$/.test(errorCode)
      ? errorCode
      : "COMMERCE_INTERNAL_ERROR";
    const status = Number.isInteger(httpStatus) && httpStatus >= 400 && httpStatus <= 599 ? httpStatus : 500;
    this._auditLog.log({
      ownerSubject: this._ownerSubject(req),
      type: actionType || "member_admin_action",
      status: "failed",
      title: `运营动作失败 ${code}`,
      error: code,
      details: Object.assign({
        actor: this._ownerSubject(req),
        action: actionType || null,
        errorCode: code,
        httpStatus: status,
      }, extra || {}),
    });
  }

  _redeemBatchIncomplete(req, res, error) {
    // ⚠️ 业务字段必须装在 `details` 里：`AuditLog.log` 只认一组**固定字段**
    // （id/ownerSubject/type/platform/title/status/error/publishId/details/createdAt），
    // 直接传 requested/generated/rounds 会被**静默丢弃** ⇒ 审计条目 details=null、
    // status="unknown" ⇒ 与「什么都没发生」在数据上完全一样。
    this._auditLog.log({
      ownerSubject: this._ownerSubject(req),
      type: "redeem_code_batch_incomplete",
      status: "failed",
      title: `批量签发未补足 ${error.generated}/${error.requested}`,
      error: error.code || "REDEEM_BATCH_INCOMPLETE",
      details: {
        actor: this._ownerSubject(req),
        requested: error.requested,
        generated: error.generated,
        rounds: error.rounds,
        // ⚠️ batch 必须进审计（也在响应体里）：**已签发出去、仍可兑**的那些码
        // 既不在审计的码列表里、也不知道属于哪一批 ⇒ 泄漏后无从定位。
        batch: error.batch || null,
        issuedTo: error.issuedTo || null,
      },
    });
    this._json(res, 409, {
      error: "REDEEM_BATCH_INCOMPLETE",
      message: error.message,
      requested: error.requested,
      generated: error.generated,
      rounds: error.rounds,
      batch: error.batch || null,
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
