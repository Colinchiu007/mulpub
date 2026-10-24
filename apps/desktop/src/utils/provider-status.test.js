import { describe, it, expect } from 'vitest'
import { PROVIDER_STATUS, providerStatus, providerHasUsableApiKey } from './provider-status'

/**
 * provider-status 三态判定契约
 *
 * 这条判据的由来：卡片上的状态标签此前直接翻译数据库的 `enabled` 布尔位
 * （`p.enabled ? 已启用 : 已禁用`）。但 `enabled` 在本仓**不是**「用户手动禁用」的开关，
 * 而是「有没有可用 API Key」的派生位（预设种子行写死 enabled=0；存了 Key 才置 1）。
 * UI 上根本没有启用/禁用的开关（toggleEnabled 未接线到任何元素），
 * 于是「从没配过」的卡片被贴上「已禁用」—— 把内部派生位当成了用户意图。
 *
 * 三态：
 *   enabled         已启用   已配置且会被实际调用（运行时按 enabled=1 过滤）
 *   disabled        已停用   配置还在（Key 仍在），但显式不参与调用
 *   not_configured  未配置   从没填过 Key，不会被调用
 */
describe('providerStatus 三态判定', () => {
  it('已配置（is_configured=true）⇒ 已启用', () => {
    const p = { id: 'openai', enabled: true, is_configured: true, api_key_masked: 'sk-***' }
    expect(providerStatus(p)).toBe(PROVIDER_STATUS.ENABLED)
  })

  it('本地免 Key 的服务商：is_configured 由 enabled 决定，仍为 true 时算已启用', () => {
    // piper / local-diffusion / comfyui 属本地免 Key，is_configured 不依赖 API Key
    const p = { id: 'piper', enabled: true, is_configured: true, api_key_masked: '' }
    expect(providerStatus(p)).toBe(PROVIDER_STATUS.ENABLED)
  })

  it('没填过 Key（enabled=0、无掩码）⇒ 未配置，而不是「已禁用」', () => {
    // 预设种子行就是这个形态：enabled 硬编码 0，用户从没碰过
    const p = { id: 'anthropic', enabled: false, is_configured: false, api_key_masked: '' }
    expect(providerStatus(p)).toBe(PROVIDER_STATUS.NOT_CONFIGURED)
  })

  it('Key 还在但 enabled=0 ⇒ 已停用（配置在，只是不参与调用）', () => {
    const p = { id: 'openai', enabled: false, is_configured: false, api_key_masked: 'sk-***' }
    expect(providerStatus(p)).toBe(PROVIDER_STATUS.DISABLED)
  })

  it('空输入 / 脏输入 ⇒ 未配置（不得抛错）', () => {
    expect(providerStatus(null)).toBe(PROVIDER_STATUS.NOT_CONFIGURED)
    expect(providerStatus(undefined)).toBe(PROVIDER_STATUS.NOT_CONFIGURED)
    expect(providerStatus({})).toBe(PROVIDER_STATUS.NOT_CONFIGURED)
  })

  it('is_configured 只认严格 true，不认真值字符串（"true" 不算已配置）', () => {
    const p = { id: 'openai', enabled: 1, is_configured: 'true', api_key_masked: '' }
    expect(providerStatus(p)).toBe(PROVIDER_STATUS.NOT_CONFIGURED)
  })

  it('hasUsableApiKey 只认非空掩码串；空白串不算有 Key', () => {
    expect(providerHasUsableApiKey({ api_key_masked: 'sk-***' })).toBe(true)
    expect(providerHasUsableApiKey({ api_key_masked: '   ' })).toBe(false)
    expect(providerHasUsableApiKey({ api_key_masked: '' })).toBe(false)
    expect(providerHasUsableApiKey({})).toBe(false)
    expect(providerHasUsableApiKey(null)).toBe(false)
  })

  it('本地免 Key 的服务商（piper 等）处于 enabled=0 ⇒ 未配置（已知边界，登记在案）', () => {
    // 这条形态今天无入口（toggleEnabled 未接线），但**新引入的「点卡片→编辑」入口会走到它**，
    // 所以把判据钉住：它没有 Key 可填 ⇒ 不是「已停用」。
    const p = { id: 'piper', enabled: false, is_configured: false, api_key_masked: '' }
    expect(providerStatus(p)).toBe(PROVIDER_STATUS.NOT_CONFIGURED)
  })
})
