'use strict'
/**
 * index.js — 账号云镜像服务端的聚合出口（供 `publish-api-server.js` require）。
 *
 * 接线只做一件事：把注入依赖收拢成 `createCloudAccountServices({ pool, kms })`，
 * 让 HTTP 入口拿到 `{ repository, crypto, handle }` 就能工作，不需要知道各模块的拼装顺序。
 * 本文件不 require `publish-api-server.js`，避免循环依赖（服务端反过来 require 本模块）。
 *
 * 用法（后续接线方，本 PR 不改 `publish-api-server.js`）：
 *   const cloudAccounts = require('./cloud-accounts')
 *   const services = cloudAccounts.createCloudAccountServices({ pool, kms: cloudAccounts.createLocalKms() })
 *   // 路径前缀命中 ACCOUNTS_PATH / SYNC_PATH 时：
 *   const { status, body } = await services.handle({ method, url, req, auth: req.auth })
 *   this._json(res, status, body)
 */

const credentialDigestModule = require('./credential-digest')
const envelopeModule = require('./envelope-crypto')
const repositoryModule = require('./cloud-account-repository')
const handlersModule = require('./handlers')
const validateModule = require('./validate-account')

const { createEnvelopeCrypto, createLocalKms } = envelopeModule
const { createCloudAccountRepository } = repositoryModule
const { handleCloudAccountsRequest } = handlersModule

/**
 * 组装一套可用的云账号服务。任一侧已构造好时可整体注入（`repository` / `crypto`），
 * 便于测试与「连接池复用既有业务库」的部署形态。
 * KMS 缺失时**不**降级：`createEnvelopeCrypto` 会在首次使用时抛 KMS_UNAVAILABLE。
 */
function createCloudAccountServices(options = {}) {
  const crypto = options.crypto || createEnvelopeCrypto({ kms: options.kms })
  const repository = options.repository
    || (options.pool ? createCloudAccountRepository({ pool: options.pool }) : null)
  return {
    repository,
    crypto,
    /** 与 `handleCloudAccountsRequest` 同契约，只是预注入了 repository / crypto。 */
    handle: (context = {}) => handleCloudAccountsRequest(Object.assign({ repository, crypto }, context)),
    routes: handlersModule.CLOUD_ACCOUNTS_ROUTES,
  }
}

module.exports = Object.assign(
  { createCloudAccountServices },
  credentialDigestModule,
  envelopeModule,
  repositoryModule,
  validateModule,
  handlersModule,
)
