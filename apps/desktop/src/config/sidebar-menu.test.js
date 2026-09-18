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
import { ROUTE_REGISTRY } from './route-registry'

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

/**
 * 派生基线（2026-09-17，desktop-ui-consistency T0-5）
 *
 * SIDEBAR_MENU_DEFINITION 改为从 route-registry.js 派生后，运营中心「应用菜单」的种子
 * （ops-center/backend/services/app_menu_service.py CATALOG）就直接依赖派生结果。
 * 这里把派生前的 19 项逐条冻结：key / group / labelI18nKey / to 任一变化（含顺序变化）
 * 都会让本测试变红 —— 防止「顺手改路由表」把运营侧配置悄悄带偏。
 * 有意变更菜单时必须同步改本基线，并在 PR 说明中写明对运营中心种子的影响。
 */
const EXPECTED_DERIVED_MENU = Object.freeze([
  { key: 'home', group: 'primary', labelI18nKey: 'sidebar.nav.home', to: '/' },
  { key: 'publish', group: 'primary', labelI18nKey: 'sidebar.nav.publish', to: '/publish/history' },
  { key: 'accounts', group: 'primary', labelI18nKey: 'sidebar.nav.accounts', to: '/accounts' },
  { key: 'dashboard', group: 'primary', labelI18nKey: 'sidebar.nav.dashboard', to: '/dashboard' },
  { key: 'create', group: 'primary', labelI18nKey: 'sidebar.nav.create', to: '/create' },
  { key: 'collection', group: 'primary', labelI18nKey: 'sidebar.nav.collection', to: '/collection' },
  { key: 'copy-library', group: 'primary', labelI18nKey: 'sidebar.nav.copyLibrary', to: '/copy-library' },
  { key: 'rewrite', group: 'primary', labelI18nKey: 'sidebar.nav.rewrite', to: '/rewrite' },
  { key: 'calendar', group: 'more', labelI18nKey: 'sidebar.nav.calendar', to: '/calendar' },
  { key: 'comments', group: 'more', labelI18nKey: 'sidebar.nav.comments', to: '/comments' },
  { key: 'cloud-publish', group: 'more', labelI18nKey: 'sidebar.nav.cloudPublish', to: '/cloud-publish' },
  { key: 'library', group: 'more', labelI18nKey: 'sidebar.nav.library', to: '/library' },
  { key: 'keywords', group: 'more', labelI18nKey: 'sidebar.nav.keywords', to: '/keywords' },
  { key: 'viral', group: 'more', labelI18nKey: 'sidebar.nav.viral', to: '/viral-analysis' },
  { key: 'prompt-eval', group: 'more', labelI18nKey: 'sidebar.nav.promptEval', to: '/prompt-eval' },
  { key: 'hot-topics', group: 'more', labelI18nKey: 'hotTopics.menuLabel', to: '/hot-topics' },
  { key: 'model-providers', group: 'more', labelI18nKey: 'sidebar.nav.modelProviders', to: '/model-providers' },
  { key: 'knowledge-base', group: 'more', labelI18nKey: 'knowledgeBase.title', to: '/knowledge-base' },
  { key: 'performance-insights', group: 'more', labelI18nKey: 'perfInsights.title', to: '/performance-insights' },
  { key: 'member-center', group: 'more', labelI18nKey: 'memberCenter.menuEntry', to: '/member-center' },
])

describe('SIDEBAR_MENU_DEFINITION 派生基线（route-registry 派生化，2026-09-17）', () => {
  it('派生结果与冻结基线逐项相等（key/group/labelI18nKey/to + 顺序）', () => {
    const actual = SIDEBAR_MENU_DEFINITION.map(({ key, group, labelI18nKey, to }) => ({ key, group, labelI18nKey, to }))
    expect(actual).toEqual(EXPECTED_DERIVED_MENU)
  })

  it('派生结果每项都带图标组件（运营中心渲染依赖）', () => {
    for (const item of SIDEBAR_MENU_DEFINITION) {
      expect(item.icon, `菜单项 ${item.key} 缺少 icon`).toBeTruthy()
    }
  })

  it('派生 key 集合与路由登记表 navEntry key 集合一致（无静默丢失/多余）', () => {
    const registryKeys = ROUTE_REGISTRY.filter((entry) => entry.navEntry).map((entry) => entry.navEntry.key)
    expect([...SIDEBAR_MENU_KEYS].sort()).toEqual([...registryKeys].sort())
    expect(SIDEBAR_MENU_KEYS).toHaveLength(EXPECTED_DERIVED_MENU.length)
  })
})
