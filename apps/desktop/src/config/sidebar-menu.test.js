/**
 * sidebar-menu 定义契约测试（2026-09-15）
 *
 * 为什么需要这个文件：
 * 菜单文案改为「labelI18nKey 动态取词」后，CI 的 check-locale-sync.js --keys 只扫描
 * 字面量 t('...') 调用，**无法覆盖动态 key**。本测试补上这一层，保证：
 * 1. 每个 labelI18nKey 在 zh 与 en 都存在且非空（否则 UI 会渲染出裸 key）
 * 2. 定义文件不含中文字面量（CI check-locale-sync.js --cjk 门禁的本地前哨）
 * 3. key 唯一、分组合法、强制项归属正确
 */
import { describe, expect, it } from 'vitest'
import zh from '@/locales/zh'
import en from '@/locales/en'
import {
  SIDEBAR_FORCED_VISIBLE_KEYS,
  SIDEBAR_MENU_DEFINITION,
  SIDEBAR_MENU_GROUPS,
  SIDEBAR_MENU_KEYS,
} from './sidebar-menu'

/** 按 'a.b.c' 路径取 locale 文案 */
function lookup (locale, keyPath) {
  return keyPath
    .split('.')
    .reduce((acc, part) => (acc && typeof acc === 'object' ? acc[part] : undefined), locale)
}

describe('SIDEBAR_MENU_DEFINITION 契约', () => {
  it('menu key 唯一', () => {
    expect(new Set(SIDEBAR_MENU_KEYS).size).toBe(SIDEBAR_MENU_KEYS.length)
  })

  it('每项分组合法且必填字段齐全', () => {
    for (const item of SIDEBAR_MENU_DEFINITION) {
      expect(SIDEBAR_MENU_GROUPS).toContain(item.group)
      expect(typeof item.key).toBe('string')
      expect(item.key.length).toBeGreaterThan(0)
      expect(typeof item.to).toBe('string')
      expect(item.icon).toBeTruthy()
      expect(typeof item.labelI18nKey).toBe('string')
    }
  })

  // 动态 key 覆盖检查（CI --keys 无法覆盖的部分）
  it.each(SIDEBAR_MENU_DEFINITION.map((item) => [item.key, item.labelI18nKey]))(
    '%s → %s 在 zh 与 en 均存在且非空',
    (_key, labelI18nKey) => {
      const zhText = lookup(zh, labelI18nKey)
      const enText = lookup(en, labelI18nKey)
      expect(typeof zhText).toBe('string')
      expect(String(zhText).length).toBeGreaterThan(0)
      expect(typeof enText).toBe('string')
      expect(String(enText).length).toBeGreaterThan(0)
    },
  )

  it('i18n key 与菜单 key 一一对应（无复用导致的文案错位）', () => {
    const i18nKeys = SIDEBAR_MENU_DEFINITION.map((item) => item.labelI18nKey)
    expect(new Set(i18nKeys).size).toBe(i18nKeys.length)
  })

  it('强制显示项都在定义中且都属于一级导航（primary）', () => {
    for (const key of SIDEBAR_FORCED_VISIBLE_KEYS) {
      const item = SIDEBAR_MENU_DEFINITION.find((i) => i.key === key)
      expect(item, `强制项 ${key} 必须存在于 SIDEBAR_MENU_DEFINITION`).toBeTruthy()
      expect(item.group).toBe('primary')
    }
  })

  it('定义中不含中文字面量（check-locale-sync.js --cjk 门禁的本地前哨）', () => {
    const serializable = SIDEBAR_MENU_DEFINITION.map(({ icon: _icon, ...rest }) => rest)
    const raw = JSON.stringify(serializable)
    expect(/[\u4e00-\u9fff]/.test(raw)).toBe(false)
  })
})
