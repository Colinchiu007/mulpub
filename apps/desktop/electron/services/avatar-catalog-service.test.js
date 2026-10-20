// @ts-check
/**
 * avatar-catalog-service.test.js — 数字人形象/音色目录服务测试
 *
 * 覆盖（PRD-AVATAR-SPOKESPERSON-HEYGEN-WIRING-2026-10-19 §4、§7）：
 *  - 缓存命中 / refresh 强制刷新 / TTL 过期
 *  - providerId 非法（空、超长、含非法字符）→ INVALID_ARGUMENTS
 *  - adapter 未实现方法 → UNSUPPORTED_PROVIDER（不抛异常）
 *  - callAdapter 二层失败（code:0 + data.code:-1）不被吞成成功
 *  - invalidate 清理缓存
 */

import { describe, it, expect, vi } from 'vitest'
const { AvatarCatalogService, DEFAULT_TTL_MS } = require('./avatar-catalog-service')

function makeManager (impl = {}) {
  const calls = []
  return {
    calls,
    getProvider: vi.fn((id) => (impl.provider === false ? null : { listAvatars: () => {}, listVoices: () => {} })),
    callAdapter: vi.fn(async (providerId, method) => {
      calls.push({ providerId, method })
      if (impl.error) throw new Error(impl.error)
      if (impl.failMessage) return { code: -1, message: impl.failMessage }
      if (impl.twoLayerFail) return { code: 0, data: { code: -1, message: 'boom-inner' } }
      return { code: 0, data: impl.data !== undefined ? impl.data : [] }
    }),
  }
}

describe('AvatarCatalogService', () => {
  it('默认 TTL 为 5 分钟', () => {
    expect(DEFAULT_TTL_MS).toBe(5 * 60 * 1000)
  })

  describe('listAvatars', () => {
    it('首次调用走 adapter 并缓存结果', async () => {
      const manager = makeManager({ data: [{ id: 'a1', name: '形象A' }] })
      const service = new AvatarCatalogService({ modelProviderManager: manager })

      const first = await service.listAvatars({ providerId: 'heygen' })
      expect(first.code).toBe(0)
      expect(first.data).toEqual([{ id: 'a1', name: '形象A' }])
      expect(manager.calls).toHaveLength(1)

      const second = await service.listAvatars({ providerId: 'heygen' })
      expect(second.code).toBe(0)
      expect(second.data).toEqual([{ id: 'a1', name: '形象A' }])
      // 第二次命中缓存，不再打 adapter
      expect(manager.calls).toHaveLength(1)
    })

    it('refresh=true 强制跳过缓存', async () => {
      const manager = makeManager({ data: [] })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      await service.listAvatars({ providerId: 'heygen' })
      await service.listAvatars({ providerId: 'heygen', refresh: true })
      expect(manager.calls).toHaveLength(2)
    })

    it('TTL 过期后重新拉取', async () => {
      const manager = makeManager({ data: [] })
      const service = new AvatarCatalogService({ modelProviderManager: manager, ttlMs: 0 })
      await service.listAvatars({ providerId: 'heygen' })
      await service.listAvatars({ providerId: 'heygen' })
      expect(manager.calls).toHaveLength(2)
    })

    it('失败结果不写入缓存（下次仍会重试）', async () => {
      const manager = makeManager({ failMessage: 'AVATAR_CATALOG_UNAVAILABLE' })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      const first = await service.listAvatars({ providerId: 'heygen' })
      expect(first.code).toBe(-1)
      await service.listAvatars({ providerId: 'heygen' })
      expect(manager.calls).toHaveLength(2)
    })

    it('二层失败（code:0 + data.code:-1）不被吞成成功', async () => {
      const manager = makeManager({ twoLayerFail: true })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      const result = await service.listAvatars({ providerId: 'heygen' })
      expect(result.code).toBe(-1)
      expect(result.message).toBe('boom-inner')
    })

    it('adapter 抛异常被转为结构化失败，不冒泡', async () => {
      const manager = makeManager({ error: 'ECONNREFUSED' })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      const result = await service.listAvatars({ providerId: 'heygen' })
      expect(result.code).toBe(-1)
      expect(result.message).toContain('ECONNREFUSED')
    })
  })

  describe('listVoices', () => {
    it('调用 adapter 的 listVoices 方法', async () => {
      const manager = makeManager({ data: [{ id: 'v1', name: '音色A' }] })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      const result = await service.listVoices({ providerId: 'heygen' })
      expect(result.code).toBe(0)
      expect(manager.calls[0]).toEqual({ providerId: 'heygen', method: 'listVoices' })
    })

    it('音色与形象缓存互相独立', async () => {
      const manager = makeManager({ data: [] })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      await service.listAvatars({ providerId: 'heygen' })
      await service.listVoices({ providerId: 'heygen' })
      expect(manager.calls.map(c => c.method)).toEqual(['listAvatars', 'listVoices'])
    })
  })

  describe('入参校验', () => {
    const cases = [
      ['空字符串', ''],
      ['纯空格', '   '],
      ['含斜杠', 'hey/gen'],
      ['含空格', 'hey gen'],
      ['非字符串', 123],
      ['超长', 'a'.repeat(200)],
    ]
    for (const [label, providerId] of cases) {
      it(`${label} → AVATAR_CATALOG_INVALID_ARGUMENTS`, async () => {
        const manager = makeManager()
        const service = new AvatarCatalogService({ modelProviderManager: manager })
        const result = await service.listAvatars({ providerId })
        expect(result.code).toBe(-1)
        expect(result.message).toBe('AVATAR_CATALOG_INVALID_ARGUMENTS')
        expect(manager.calls).toHaveLength(0)
      })
    }

    it('provider 不存在（adapter 未实现方法）→ UNSUPPORTED_PROVIDER', async () => {
      const manager = makeManager({ provider: false })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      const result = await service.listAvatars({ providerId: 'kling' })
      expect(result.code).toBe(-1)
      expect(result.message).toBe('AVATAR_CATALOG_UNSUPPORTED_PROVIDER')
    })

    it('manager 缺失 → UNAVAILABLE', async () => {
      const service = new AvatarCatalogService({ modelProviderManager: null })
      const result = await service.listAvatars({ providerId: 'heygen' })
      expect(result.code).toBe(-1)
      expect(result.message).toBe('AVATAR_CATALOG_UNAVAILABLE')
    })
  })

  describe('invalidate', () => {
    it('清理指定 provider 的缓存', async () => {
      const manager = makeManager({ data: [] })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      await service.listAvatars({ providerId: 'heygen' })
      expect(manager.calls).toHaveLength(1)
      service.invalidate('heygen')
      await service.listAvatars({ providerId: 'heygen' })
      expect(manager.calls).toHaveLength(2)
    })

    it('不传 providerId 时清空全部', async () => {
      const manager = makeManager({ data: [] })
      const service = new AvatarCatalogService({ modelProviderManager: manager })
      await service.listAvatars({ providerId: 'heygen' })
      await service.listVoices({ providerId: 'other' })
      service.invalidate()
      await service.listAvatars({ providerId: 'heygen' })
      await service.listVoices({ providerId: 'other' })
      expect(manager.calls).toHaveLength(4)
    })
  })
})
