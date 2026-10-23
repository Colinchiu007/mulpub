// @ts-check
/**
 * digital-human-provider.test.js — 数字人 provider 能力解析（change: digital-human-multiprovider）
 *
 * 锁定三件事：
 *  1. **不再硬编码 heygen**：provider 从 capabilities 里解析，加第三家不改代码
 *  2. **优先级**：显式 params.videoProvider > 唯一 capability 命中 > 多家时取模型设置默认
 *  3. **fail closed**：manager 不可用 / 一家都没配 ⇒ 返回 null，不臆造 provider
 *
 * 与 resolveDigitalHumanProvider 的关系：本模块是它的能力解析内核，
 * 抽出以便独立测（videogen-stages.digital-human.test.js 仍测外层行为）。
 */

// @vitest-environment node
const {
  resolveDigitalHumanProviderId,
  listDigitalHumanProviders,
  DIGITAL_HUMAN_CAPABILITY,
} = require('./digital-human-provider')

function makeManager ({ providers = {}, defaults = {}, listProviders } = {}) {
  const all = Object.values(providers)
  return {
    getProvider: (id) => providers[id] || null,
    listProviders: typeof listProviders === 'function'
      ? listProviders
      : () => all.map((p) => ({ ...p })),
    getDefault: (cap) => (defaults[cap] ? { id: defaults[cap] } : null),
    _ready: true,
  }
}

/** 带 digital_human capability 的 provider 形态 */
function dh (id, extra = {}) {
  return { id, category: 'video', capabilities: ['video', 'digital_human'], models: [id + '-video'], ...extra }
}

describe('数字人 provider 能力解析', () => {
  it('导出 capability 常量', () => {
    expect(DIGITAL_HUMAN_CAPABILITY).toBe('digital_human')
  })

  describe('listDigitalHumanProviders', () => {
    it('只返回声明了 digital_human 的 provider', () => {
      const manager = makeManager({
        providers: {
          heygen: dh('heygen'),
          kling: { id: 'kling', category: 'video', capabilities: ['video'], models: ['kling-v1'] },
        },
      })
      expect(listDigitalHumanProviders(manager).map((p) => p.id)).toEqual(['heygen'])
    })

    it('manager 不支持 listProviders 时返回空数组（不猜）', () => {
      const manager = { getProvider: () => null }
      expect(listDigitalHumanProviders(manager)).toEqual([])
    })

    it('多家都声明时全部返回（顺序稳定）', () => {
      const manager = makeManager({
        providers: { heygen: dh('heygen'), hifly: dh('hifly') },
      })
      expect(listDigitalHumanProviders(manager).map((p) => p.id).sort()).toEqual(['heygen', 'hifly'])
    })
  })

  describe('resolveDigitalHumanProviderId', () => {
    it('显式 videoProvider 优先（人工指向其他数字人服务的口子）', () => {
      const manager = makeManager({
        providers: { heygen: dh('heygen'), hifly: dh('hifly') },
        defaults: { video: 'heygen' },
      })
      expect(resolveDigitalHumanProviderId(manager, { videoProvider: 'hifly' })).toBe('hifly')
    })

    it('只有一家时直接命中（无需默认 provider）', () => {
      const manager = makeManager({ providers: { heygen: dh('heygen') } })
      expect(resolveDigitalHumanProviderId(manager, {})).toBe('heygen')
    })

    it('多家时取模型设置里 video 能力的默认 provider', () => {
      const manager = makeManager({
        providers: { heygen: dh('heygen'), hifly: dh('hifly') },
        defaults: { video: 'hifly' },
      })
      expect(resolveDigitalHumanProviderId(manager, {})).toBe('hifly')
    })

    it('多家且默认 provider 不是数字人 ⇒ 取第一家（稳定，不随机）', () => {
      const manager = makeManager({
        providers: { heygen: dh('heygen'), hifly: dh('hifly') },
        defaults: { video: 'kling' },
      })
      const resolved = resolveDigitalHumanProviderId(manager, {})
      expect(['heygen', 'hifly']).toContain(resolved)
      // 连续两次解析结果一致（不得因对象顺序漂移而变）
      expect(resolveDigitalHumanProviderId(manager, {})).toBe(resolved)
    })

    it('一家都没配 ⇒ null（fail closed，不回落 getDefault(video)）', () => {
      const manager = makeManager({
        providers: { kling: { id: 'kling', category: 'video', capabilities: ['video'] } },
        defaults: { video: 'kling' },
      })
      expect(resolveDigitalHumanProviderId(manager, {})).toBeNull()
    })

    it('manager 不可用 ⇒ null（不臆造 provider 可用性）', () => {
      expect(resolveDigitalHumanProviderId(null, {})).toBeNull()
      expect(resolveDigitalHumanProviderId({}, {})).toBeNull()
    })

    it('显式 videoProvider 未配置 capability 也放行（人工覆盖的语义）', () => {
      const manager = makeManager({
        providers: { 'other-dh': { id: 'other-dh', category: 'video', capabilities: ['video'] } },
      })
      expect(resolveDigitalHumanProviderId(manager, { videoProvider: 'other-dh' })).toBe('other-dh')
    })
  })
})
