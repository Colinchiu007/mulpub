import { createApiClient } from './http'

const api = createApiClient()

/**
 * 批量签发兑换码（转发 api-publish-engine）。
 *
 * 签发真源已收敛到服务端 `identity_redeem_codes`，ops 不再落库。
 * 列表 / 吊销于 A2 恢复——服务端补齐了对应能力，本层只做转发，不改语义。
 */
export function createRedemptionBatch(data) {
  return api.post('/redemption-codes/batch', data).then(r => r.data)
}

/**
 * 运营列表。
 *
 * ⚠️ `reveal` 默认 **false**：服务端此时只返回掩码（`ABCD-****-****`）。
 * 传 true 才会拿完整码，且服务端会把该次操作写入审计日志。
 * 前端不要「为了显示方便」默认传 true——那等于绕过掩码的意义。
 *
 * status 沿用旧契约的 `revoked`，后端负责映射到服务端的 `disabled`。
 */
export function listRedemptionCodes(params = {}) {
  return api.get('/redemption-codes', { params }).then(r => r.data)
}

/** 吊销兑换码。重复吊销返回 idempotent:true；已兑换返回 409；不存在返回 404。 */
export function disableRedemptionCode(code) {
  return api.post('/redemption-codes/disable', { code }).then(r => r.data)
}
