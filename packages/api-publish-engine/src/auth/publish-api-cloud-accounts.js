'use strict'

// 账号云镜像：PublishApiServer 的接线辅助。
// 按本仓既有 mixin 范式（见 publish-api-commerce.js）从 publish-api-server.js 拆出，
// 通过 applyCloudAccountHelpers 挂回原型，全部方法以 this 绑定访问实例成员。
//
// 为什么单独成文件：`publish-api-server.js` 是 1300+ 行的巨型 `_handle` if 链，
// 往里塞账号云镜像的组装逻辑会让本特性的可测试性与回滚面一起劣化。
const { createCloudAccountServices, createLocalKms } = require('../cloud-accounts')

class PublishApiCloudAccountHelpers {
  /** 该 URL 是否属于账号云镜像面（前缀匹配，含 digest/full/sync/disconnect）。 */
  _isCloudAccountsUrl(url) {
    if (typeof url !== 'string') return false
    const path = url.split('?')[0]
    return path === '/api/v1/me/accounts'
      || path === '/api/v1/me/accounts/sync'
      || path === '/api/v1/me/accounts/disconnect'
  }

  /**
   * 惰性组装云账号服务。连接池复用业务身份库的既有池（同一 Postgres、同一归属表），
   * 不另开第二个池——云账号与 identity_users 之间有外键，两个池就是两个事务域。
   *
   * KMS 缺失时 **fail closed**：createEnvelopeCrypto 在首次使用时抛 KMS_UNAVAILABLE。
   * 这里绝不做「没有 KMS 就明文入库」的降级，也绝不在构造期抛错——构造期抛错会让
   * 整个业务 API 起不来，而未配置本特性的部署不该被拖下水。
   */
  _cloudAccounts() {
    if (this.__cloudAccounts !== undefined) return this.__cloudAccounts
    const identityRepository = this._businessIdentityRepository
    const pool = identityRepository && identityRepository.pool
    if (!pool) {
      this.__cloudAccounts = null
      return null
    }
    let kms = null
    try {
      kms = createLocalKms({ env: process.env })
    } catch (error) {
      // 未配置/非法主密钥：记录一次，后续每次使用都由 crypto 抛 KMS_UNAVAILABLE
      this.__cloudAccountsKmsError = error && error.code ? error.code : 'KMS_CONFIG_INVALID'
      this._logWarn(this.__cloudAccountsKmsError, null, { module: 'cloud-accounts' })
      kms = null
    }
    this.__cloudAccounts = createCloudAccountServices({ pool, kms })
    return this.__cloudAccounts
  }

  /**
   * 云账号面的统一出口。返回 true 表示已应答（调用方必须 return），false 表示未命中本面、
   * 交回既有 if 链继续路由。
   *
   * 归属只认 `req.auth.businessUser.id`（服务端从已验签 token 解析），
   * 请求体里的任何 user/subject 字段一律不读——否则就是把「读别人的账号」变成一次请求体的事。
   */
  async _handleCloudAccounts(req, res, method, url) {
    const services = this._cloudAccounts()
    if (!services) {
      this._json(res, 503, { error: 'CLOUD_ACCOUNTS_NOT_CONFIGURED' })
      return true
    }
    const user = req.auth && req.auth.businessUser
    const userId = user && typeof user.id === 'string' ? user.id : null
    if (!userId) {
      this._json(res, 503, { error: 'BUSINESS_USER_REPOSITORY_NOT_CONFIGURED' })
      return true
    }
    const parsedBody = method === 'GET' ? null : await this._parseBody(req)
    await services.handle({
      method,
      url,
      req,
      auth: req.auth,
      // handlers 侧按 bodyParser 取体并自带解析失败收口（body 传进来会绕过它的错误语义）
      bodyParser: () => Promise.resolve(parsedBody),
      now: () => Date.now(),
      json: (status, body) => this._json(res, status, body),
    })
    return true
  }
}

function applyCloudAccountHelpers(Proto) {
  const names = Object.getOwnPropertyNames(PublishApiCloudAccountHelpers.prototype)
  for (const key of names) {
    if (key === 'constructor') continue
    Object.defineProperty(Proto.prototype, key, Object.getOwnPropertyDescriptor(PublishApiCloudAccountHelpers.prototype, key))
  }
}

module.exports = { applyCloudAccountHelpers }
