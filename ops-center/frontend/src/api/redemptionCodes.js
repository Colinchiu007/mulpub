import { createApiClient } from './http'

const api = createApiClient()

/**
 * 批量签发兑换码（转发 api-publish-engine）。
 *
 * ⚠️ 收敛说明（2026-10-12）：原有的 list / revoke / delete 三个方法随本地 HMAC
 * 兑换码体系一起下线——签发真源已收敛到服务端，ops 不再落库，状态一律以
 * 服务端 `identity_redeem_codes` 为准，而服务端尚未开放查询/吊销接口。
 * 补齐后会在本文件恢复对应方法。
 */
export function createRedemptionBatch(data) {
  return api.post('/redemption-codes/batch', data).then(r => r.data)
}
