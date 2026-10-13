/**
 * account-metrics/capability 的测试（P1-2 验收判据 ①②③）。
 *
 * 被测：apps/desktop/electron/services/account-metrics/capability.js
 * 数据：config/platform-metric-matrix.json（P1-1 产物）
 *
 * 这个模块存在的**唯一理由**：把界面上的 `-` 拆成三种不同的东西 ——
 *   ① 平台根本没这指标（该说「平台不支持」）
 *   ② 平台有、这次没采到（该说「暂无」）
 *   ③ 我们压根不认识这个平台（该说「未知平台」）
 * 所以本文件的断言全部围绕「三者不许被合并」。
 */
import { describe, it, expect } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const cap = require('./capability')

describe('capability — 三态不许被合并', () => {
  it('① 已知平台：state=known，且**不支持列表非空**（否则 UI 说不出「平台没有这个指标」）', () => {
    const b = cap.buildPlatformCapability('kuaishou')
    expect(b.state).toBe('known')
    // kuaishou 的源数据只声明了 6,7,8,9,10,11（内容）+ 3,4,5,6,7（趋势），**不含 income**
    expect(b.unsupportedMetricKeys).toContain('income')
    expect(b.availableMetricKeys.length).toBeGreaterThan(0)
    // 两个列表必须互斥
    const both = b.unsupportedMetricKeys.filter((k) => b.availableMetricKeys.includes(k))
    expect(both, '一个指标不能同时既可用又不支持').toEqual([])
  })

  it('② 未知平台 ≠ 全不支持：state=unknown-platform 且 metrics 为空', () => {
    const u = cap.buildPlatformCapability('not-a-platform')
    expect(u.state).toBe('unknown-platform')
    expect(u.metrics).toEqual([])
    expect(u.availableMetricKeys).toEqual([])
    expect(u.unsupportedMetricKeys).toEqual([])
  })

  it('③ 每个指标的 support 都取自 P1-1 的白名单，不自己造词', () => {
    const b = cap.buildPlatformCapability('baijiahao')
    const allowed = ['declared-available', 'declared-unavailable', 'unknown-platform', 'unknown-metric']
    for (const m of b.metrics) expect(allowed).toContain(m.support)
    // 已知平台的指标里不应出现 unknown-platform（那是平台级的结论）
    expect(b.metrics.some((m) => m.support === 'unknown-platform')).toBe(false)
  })

  it('覆盖全矩阵指标并集（含各平台标签），不是只看该平台声明过的', () => {
    const all = cap.allMetricKeys()
    const b = cap.buildPlatformCapability('baijiahao')
    // baijiahao 声明了 11+7=18 个 raw id，映射到并集里的 17 个 key（impressions 未声明）
    expect(all.length).toBeGreaterThanOrEqual(17)
    expect(b.metrics.length).toBe(all.length)
  })

  it('平台 slug 大小写不敏感', () => {
    expect(cap.buildPlatformCapability('BAIJIAHAO').state).toBe('known')
    expect(cap.buildPlatformCapability('Kuaishou').unsupportedMetricKeys).toContain('income')
  })
})

describe('capability — checkMetrics（验收判据③：声明有而实测 null 必须被命中）', () => {
  it('★ 适配器解析了该键但值全空 ⇒ declared-but-null 必须命中', () => {
    const r = cap.checkMetrics('baijiahao', [{ metrics: { income: null } }])
    expect(r).toHaveLength(1)
    expect(r[0].metricKey).toBe('income')
    expect(r[0].verdict).toBe('declared-but-null')
    expect(r[0].note).toBeTruthy()
  })

  it('★ 只校验适配器**碰过**的键 —— 否则十几个未实现的指标会淹没真信号', () => {
    // 适配器只碰 income，矩阵里 baijiahao 声明了 18 个 ⇒ 结果必须只有 1 条
    const r = cap.checkMetrics('baijiahao', [{ metrics: { income: null } }])
    expect(r.length, '噪声必须被压到只有真信号').toBe(1)
  })

  it('有值时不报 declared-but-null', () => {
    expect(cap.checkMetrics('baijiahao', [{ metrics: { income: 12 } }])).toEqual([])
  })

  it('未声明但有值 ⇒ undeclared-but-present，且 note 明说这不是错误', () => {
    const r = cap.checkMetrics('kuaishou', [{ metrics: { income: 5 } }])
    expect(r).toHaveLength(1)
    expect(r[0].verdict).toBe('undeclared-but-present')
    expect(r[0].note).toContain('不是错误')
  })

  it('空列表 / 无 metrics 字段都不抛，返回空数组', () => {
    expect(cap.checkMetrics('baijiahao', [])).toEqual([])
    expect(cap.checkMetrics('baijiahao', null)).toEqual([])
    expect(cap.checkMetrics('baijiahao', [{ title: 'x' }])).toEqual([])
    expect(cap.checkMetrics('baijiahao', [{ metrics: {} }])).toEqual([])
  })

  it('多条作品里只要有一条有值就不算 declared-but-null', () => {
    const r = cap.checkMetrics('baijiahao', [{ metrics: { income: null } }, { metrics: { income: 3 } }])
    expect(r).toEqual([])
  })

  it('未知平台的校验不抛（返回空）', () => {
    expect(cap.checkMetrics('not-a-platform', [{ metrics: { income: 1 } }])).toEqual([])
  })
})
