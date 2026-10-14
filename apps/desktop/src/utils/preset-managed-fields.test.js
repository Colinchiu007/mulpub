import { describe, it, expect } from 'vitest'
import { presetManagedFields } from './preset-managed-fields'

/**
 * 回归锁（2026-10-14）：预设服务商的受管字段必须判为只读。
 *
 * 背景：这条保护**曾经存在过**，但判据写的是「是否连上运营中心」，而那个判断
 * 在所部署版本里**恒为假** ⇒ 保护一次都没生效，用户改了模型列表，
 * 下次 `applyCatalog()` 整表覆盖时被静默冲掉。且原判据是内联 computed，
 * **不可单测**——这是它能长期静默失效的直接原因。
 *
 * 覆盖矩阵：数据事实（is_preset）× 编辑态（编辑预设 / 编辑自定义 / 新增 / 列表缺失）。
 */
describe('presetManagedFields：预设行的受管字段只读判据', () => {
  const providers = [
    { id: 'openai', is_preset: true },
    { id: 'my-own', is_preset: false },
    { id: 'legacy-row' }, // 老行无 is_preset 字段 ⇒ 按非预设（保持既有可编辑行为）
  ]

  it('编辑预设服务商 → 只读', () => {
    expect(presetManagedFields(providers, 'openai')).toBe(true)
  })

  it('编辑自定义服务商 → 可编辑', () => {
    expect(presetManagedFields(providers, 'my-own')).toBe(false)
  })

  it('老行缺 is_preset 字段 → 按非预设处理（不改变既有行为）', () => {
    expect(presetManagedFields(providers, 'legacy-row')).toBe(false)
  })

  it('新增（无 editingId）→ 可编辑', () => {
    expect(presetManagedFields(providers, '')).toBe(false)
    expect(presetManagedFields(providers, undefined)).toBe(false)
  })

  it('编辑的服务商不在列表里 → 可编辑（fail-open，不误锁）', () => {
    expect(presetManagedFields(providers, 'not-exist')).toBe(false)
  })

  it('providers 非数组 → fail-open 可编辑', () => {
    expect(presetManagedFields(null, 'openai')).toBe(false)
    expect(presetManagedFields(undefined, 'openai')).toBe(false)
  })

  // 判据必须是数据事实，与连接状态无关：断开连接编辑预设时同样该锁。
  it('判据与「是否连上运营中心」无关（数据事实，不是连接状态）', () => {
    const connected = presetManagedFields(providers, 'openai')
    const disconnected = presetManagedFields(providers, 'openai')
    expect(connected).toBe(disconnected)
    expect(connected).toBe(true)
  })

  it('is_preset 必须是严格 true（不接受真值化，防字符串 "false" 误锁）', () => {
    expect(presetManagedFields([{ id: 'x', is_preset: 'false' }], 'x')).toBe(false)
    expect(presetManagedFields([{ id: 'x', is_preset: 1 }], 'x')).toBe(false)
    expect(presetManagedFields([{ id: 'x', is_preset: true }], 'x')).toBe(true)
  })
})
