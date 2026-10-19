// @ts-check
/**
 * plan-limits.test.js — 档位 limits 客户端判定（v2.0 机制 C1.3 / C7 C 批）
 *
 * 这组测试锁的是三条纪律：缺失即放行、-1 表示不限、非法值不产生比服务端更严的限制。
 * 它们全部是「反方向会静默拦死付费用户」的那类错误，因此在纯函数层钉死。
 */
import { describe, it, expect } from 'vitest'
import {
  UNLIMITED,
  readLimit,
  maxPlatformsOf,
  dailyPublishOf,
  batchSizePerRunOf,
  concurrentTasksOf,
  maxDevicesOf,
  maxCloudAccountsOf,
  canAddPlatform,
  canBatchSize,
  canPublishToday,
  platformLimitState,
} from './plan-limits'

const FREE = {
  plan: 'free',
  limits: {
    max_platforms: 5, daily_publish: 5, concurrent_tasks: 1,
    max_devices: 2, max_cloud_accounts: 0, batch_size_per_run: 1, model_tier: 0, plan_rank: 0,
  },
}
const STANDARD = {
  plan: 'standard',
  limits: {
    max_platforms: 15, daily_publish: 50, concurrent_tasks: 3,
    max_devices: 3, max_cloud_accounts: 20, batch_size_per_run: 10, model_tier: 1, plan_rank: 1,
  },
}
const PRO = {
  plan: 'pro',
  limits: {
    max_platforms: -1, daily_publish: 1000, concurrent_tasks: 10,
    max_devices: -1, max_cloud_accounts: -1, batch_size_per_run: -1, model_tier: 2, plan_rank: 2,
  },
}

describe('plan-limits — 读取', () => {
  it('按档位返回服务端下发的数值', () => {
    expect(maxPlatformsOf(FREE)).toBe(5)
    expect(maxPlatformsOf(STANDARD)).toBe(15)
    expect(maxPlatformsOf(PRO)).toBe(UNLIMITED)
    expect(dailyPublishOf(STANDARD)).toBe(50)
    expect(concurrentTasksOf(STANDARD)).toBe(3)
    expect(maxDevicesOf(FREE)).toBe(2)
    expect(maxCloudAccountsOf(FREE)).toBe(0)
    expect(batchSizePerRunOf(STANDARD)).toBe(10)
  })

  it('entitlement / limits 缺失一律返回 null（缺失即放行，不推算出更严的限制）', () => {
    for (const input of [null, undefined, {}, { plan: 'free' }, { limits: null }, { limits: 'oops' }]) {
      expect(maxPlatformsOf(input)).toBeNull()
      expect(canAddPlatform(input, 999)).toBe(true)
      expect(canBatchSize(input, 999)).toBe(true)
      expect(canPublishToday(input, 999)).toBe(true)
    }
  })

  it('非法值不参与判定：NaN / 非数字 / 空串按缺失处理', () => {
    const bad = { limits: { max_platforms: 'many', daily_publish: NaN, batch_size_per_run: '' } }
    expect(readLimit(bad.limits, 'max_platforms')).toBeNull()
    expect(maxPlatformsOf(bad)).toBeNull()
    expect(dailyPublishOf(bad)).toBeNull()
    expect(canBatchSize(bad, 100)).toBe(true)
  })
})

describe('plan-limits — 平台数', () => {
  it('免费档第 6 个平台被拒绝，第 5 个仍允许', () => {
    expect(canAddPlatform(FREE, 4)).toBe(true)
    expect(canAddPlatform(FREE, 5)).toBe(false)
    expect(canAddPlatform(FREE, 6)).toBe(false)
  })

  it('-1 表示不限（pro 永不拒绝）', () => {
    expect(canAddPlatform(PRO, 0)).toBe(true)
    expect(canAddPlatform(PRO, 999)).toBe(true)
  })

  it('selectedCount 非有限数时放行（undefined/NaN 不得变成「一律拦截」，CCG i7）', () => {
    expect(canAddPlatform(FREE, undefined)).toBe(true)
    expect(canAddPlatform(FREE, NaN)).toBe(true)
    expect(canAddPlatform(FREE, 'many')).toBe(true)
    // 数字字符串仍按数值判定（兼容 IPC/JSON 序列化）
    expect(canAddPlatform(FREE, '5')).toBe(false)
    expect(canAddPlatform(FREE, '4')).toBe(true)
  })

  it('platformLimitState 给出可填进 i18n 的参数', () => {
    expect(platformLimitState(FREE, 3)).toEqual({ limit: 5, selected: 3, atLimit: false })
    expect(platformLimitState(FREE, 5)).toEqual({ limit: 5, selected: 5, atLimit: true })
    expect(platformLimitState(PRO, 99)).toEqual({ limit: null, selected: 99, atLimit: false })
    expect(platformLimitState(null, 2)).toEqual({ limit: null, selected: 2, atLimit: false })
  })
})

describe('plan-limits — 批量与日发', () => {
  it('单次批量条数按档位上限判定（免费档只能单篇）', () => {
    expect(canBatchSize(FREE, 1)).toBe(true)
    expect(canBatchSize(FREE, 2)).toBe(false)
    expect(canBatchSize(STANDARD, 10)).toBe(true)
    expect(canBatchSize(STANDARD, 11)).toBe(false)
    expect(canBatchSize(PRO, 500)).toBe(true)
  })

  it('日发布按「已发 + 本次」合计判定（边界为闭区间）', () => {
    expect(canPublishToday(FREE, 4, 1)).toBe(true)
    expect(canPublishToday(FREE, 5, 1)).toBe(false)
    expect(canPublishToday(FREE, 3, 2)).toBe(true)
    expect(canPublishToday(FREE, 4, 2)).toBe(false)
    expect(canPublishToday(PRO, 999, 1)).toBe(true)
    // pro 的日发是有限高值 1000（防除零），不是 -1 无限
    expect(canPublishToday(PRO, 1000, 1)).toBe(false)
  })
})
