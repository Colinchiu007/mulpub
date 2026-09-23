'use strict'

// 会员中心 P1：PublishApiServer 的商务/设备辅助方法。
// 从 publish-api-server.js 按既有 mixin 范式拆出，通过 applyCommerceHelpers 挂回原型；
// 全部方法以 this 绑定访问实例成员（_json/_logError/_ctx/_subscriptionService/
// _businessIdentityRepository），拆分后调用方语义与对外 HTTP 契约完全不变。
const { safeErrorCode } = require('./safe-error-code')

class PublishApiCommerceHelpers {
  /** CommerceError{code,status} 直接映射 HTTP；>=500 记 error 日志，业务错误不污染 error 日志。 */
  _commerceFailure(req, res, error) {
    // status 夹紧：只接受 [400,599] 的整数，否则一律 500（防止服务层 bug 把内部失败伪装成 200，或 status 越界触发 writeHead RangeError 丢失原错误码）。
    const rawStatus = error && error.status
    const status = Number.isInteger(rawStatus) && rawStatus >= 400 && rawStatus <= 599 ? rawStatus : 500
    // code 形状校验：必须是语义码（^[A-Z][A-Z0-9_]{2,63}$），否则换兜底码，绝不外泄 SQLSTATE 等内部原文。
    const code = safeErrorCode(error, "COMMERCE_INTERNAL_ERROR")
    if (status >= 500) this._logError(code, error, this._ctx(req))
    this._json(res, status, { error: code, message: status >= 500 ? "服务暂时不可用" : (error && error.message) || "请求未生效" })
  }

  _memberUserId(req) {
    const user = req.auth && req.auth.businessUser
    return user && typeof user.id === "string" ? user.id : null
  }

  /** X-Device-ID 合同与快照签发一致（^[A-Za-z0-9._:-]{16,128}$）；不合法返回 null 而非抛错（会话登记是尽力而为）。 */
  _deviceIdFrom(req) {
    const deviceId = req.headers && req.headers["x-device-id"]
    return typeof deviceId === "string" && /^[A-Za-z0-9._:-]{16,128}$/.test(deviceId) ? deviceId : null
  }

  /** X-Device-Name 入库前清洗：设备名是尽力而为的画像数据，含控制字符或尖括号（存储型 XSS 载荷）一律丢弃为 null，不阻断请求；与 avatarUrl/displayName 守卫对称。 */
  _deviceNameFrom(req) {
    const raw = req.headers && req.headers["x-device-name"]
    if (typeof raw !== "string") return null
    const name = raw.slice(0, 100)
    if (/[\u0000-\u001f\u007f<>]/.test(name)) return null
    return name.length ? name : null
  }

  _commerceRepository() {
    const repository = (this._subscriptionService && this._subscriptionService.repository) || this._businessIdentityRepository
    return repository && typeof repository.listOrders === "function" ? repository : null
  }
}

function applyCommerceHelpers(Proto) {
  const names = Object.getOwnPropertyNames(PublishApiCommerceHelpers.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(PublishApiCommerceHelpers.prototype, key))
  }
}

module.exports = { applyCommerceHelpers };
