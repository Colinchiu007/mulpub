// @ts-check
/**
 * app-menu-config.test.js — 运营中心「应用菜单」下发配置净化（主进程）
 *
 * 重点契约（2026-09-21 修复）：bootstrap 下发的 group（primary|more）必须透传给渲染端，
 * 否则运营中心「一级导航 ↔ 更多」跨组配置会在净化层被静默吞掉
 * （渲染端 src/config/sidebar-menu-merge.js 的 resolveSidebarMenu 支持 group，
 * 后端 ops-center app_menu_service 也已在下发载荷中携带 group —— 三端契约必须一致）。
 */
import { describe, it, expect } from 'vitest'

const { normalizeAppMenu, MAX_APP_MENU_ITEMS, MAX_APP_MENU_SORT_ORDER } = require('./app-menu-config')

describe('normalizeAppMenu — group 字段透传（跨组配置契约）', () => {
  it('合法 group（primary / more）原样透传', () => {
    const out = normalizeAppMenu({
      items: [
        { key: 'calendar', visible: true, sort_order: 0, group: 'primary' },
        { key: 'rewrite', visible: true, sort_order: 3, group: 'more' },
      ],
      synced_at: '2026-09-21T00:00:00Z',
    })
    expect(out.items).toEqual([
      { key: 'calendar', visible: true, sort_order: 0, group: 'primary' },
      { key: 'rewrite', visible: true, sort_order: 3, group: 'more' },
    ])
  })

  it('非法/缺失 group → null（渲染端 fail-open 回退本地定义分组）', () => {
    const out = normalizeAppMenu({
      items: [
        { key: 'home', visible: true, sort_order: 0 },
        { key: 'publish', visible: true, sort_order: 1, group: 'side' },
        { key: 'accounts', visible: true, sort_order: 2, group: 42 },
        { key: 'create', visible: true, sort_order: 3, group: null },
      ],
    })
    expect(out.items.map((i) => i.group)).toEqual([null, null, null, null])
  })

  it('大小写敏感的分组值不放行（仅接受白名单原文）', () => {
    const out = normalizeAppMenu({
      items: [{ key: 'home', visible: true, sort_order: 0, group: 'PRIMARY' }],
    })
    expect(out.items[0].group).toBeNull()
  })

  it('既有净化语义不回归：visible 白名单 / sort 截断 / 原型污染 key 丢弃 / 超限整体拒绝', () => {
    expect(MAX_APP_MENU_ITEMS).toBe(200)
    expect(MAX_APP_MENU_SORT_ORDER).toBe(9999)
    const out = normalizeAppMenu({
      items: [
        { key: '__proto__', visible: true, group: 'primary' },
        { key: 'publish', visible: 'false', sort_order: 1e12, group: 'more' },
        { key: 'library', visible: '1', sort_order: '3', group: 'primary' },
      ],
    })
    expect(out.items).toEqual([
      // 'false' 不在白名单 → 隐藏；1e12 截断；合法 group（more/primary）原样透传
      { key: 'publish', visible: false, sort_order: 9999, group: 'more' },
      { key: 'library', visible: true, sort_order: 3, group: 'primary' },
    ])
    expect(Object.prototype.polluted).toBeUndefined()
    expect(normalizeAppMenu({ items: Array.from({ length: 201 }, (_, i) => ({ key: 'k' + i })) })).toBeNull()
  })
})

describe('normalizeAppMenu — 时间戳来源（config-hash-purity，2026-10-18）', () => {
  /**
   * 背景：appMenu 在 RUNTIME_BLOCKS 白名单内、参与 config_hash 计算。
   * 服务端曾下发块内 synced_at: _now()，导致「运营没改菜单，hash 也每次都在变」
   * ⇒ config_version 每次 +1、生效看板「已确认率」永远上不去、版本表无限增长。
   * 修复后服务端只在 bootstrap 信封顶层带 synced_at，块内不再有该键。
   * 回归锁在服务端 tests/test_config_hash_stability.py（不变量：同库连构两次 hash 相等）。
   */
  const ITEMS = [{ key: 'home', visible: true, sort_order: 0, group: 'primary' }]

  it('新形态：块内无 synced_at ⇒ 从信封顶层 fallbackSyncedAt 取', () => {
    const out = normalizeAppMenu({ items: ITEMS }, '2026-10-18T09:00:00Z')
    expect(out.syncedAt).toBe('2026-10-18T09:00:00Z')
    expect(out.items).toEqual([{ key: 'home', visible: true, sort_order: 0, group: 'primary' }])
  })

  it('新形态且信封顶层也没有 ⇒ 空串（不得凭空造时间，渲染端仅用于展示）', () => {
    const out = normalizeAppMenu({ items: ITEMS })
    expect(out.syncedAt).toBe('')
    const out2 = normalizeAppMenu({ items: ITEMS }, undefined)
    expect(out2.syncedAt).toBe('')
    const out3 = normalizeAppMenu({ items: ITEMS }, 12345)
    expect(out3.syncedAt).toBe('')
  })

  it('向后兼容：旧形态块内仍带 synced_at ⇒ 优先用它（新旧服务端混跑不出现空时间戳）', () => {
    const out = normalizeAppMenu({ items: ITEMS, synced_at: '2026-09-21T00:00:00Z' }, '2026-10-18T09:00:00Z')
    expect(out.syncedAt).toBe('2026-09-21T00:00:00Z')
  })

  it('块内 synced_at 不是字符串时不得透传（回落顶层或空串）', () => {
    expect(normalizeAppMenu({ items: ITEMS, synced_at: 123 }, '2026-10-18T09:00:00Z').syncedAt)
      .toBe('2026-10-18T09:00:00Z')
    expect(normalizeAppMenu({ items: ITEMS, synced_at: null }).syncedAt).toBe('')
  })
})
