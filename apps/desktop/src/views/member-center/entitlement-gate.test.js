/**
 * 权益判定纯函数锁（dash-full-entitlement）。
 *
 * 背景（为什么必须有这个文件）：渲染层此前**没有**任何按 feature 门控 UI 的
 * 工具函数，只有两套各自为政的范式：
 *   ① 按 entitlement.plan（MemberCenter，服务端真源）
 *   ② 按 licenseStore.isPro（ProfileMenu / useBatchPublish，本地旧范式）
 * 范式 ② 是二值 isPro，**不认三档**：standard 档用户在它下面会被判成「非 Pro」
 * 而看不到付费内容 —— 这正是本次要消灭的误判。
 *
 * 本文件是全仓第一个「按服务端 feature 判定」的渲染层单一真源。
 */
import { describe, it, expect } from 'vitest'
import { hasFeatureOf, DASHBOARD_FULL_FEATURE } from './entitlement-gate'

describe('hasFeatureOf（服务端权益单一真源）', () => {
  it('true：features 含目标 feature', () => {
    expect(hasFeatureOf({ plan: 'standard', features: ['cloud_publish', 'dashboard_full'] }, DASHBOARD_FULL_FEATURE)).toBe(true)
  })

  it('false：features 不含目标 feature（free 档）', () => {
    expect(hasFeatureOf({ plan: 'free', features: ['cloud_publish', 'ai_write'] }, DASHBOARD_FULL_FEATURE)).toBe(false)
  })

  it('false：entitlement 为 null（未登录 / 未取到），不得抛异常', () => {
    // null 是真实形态：identity.js:89 初值 ref(null)，未登录时不会退化成空对象
    expect(hasFeatureOf(null, DASHBOARD_FULL_FEATURE)).toBe(false)
  })

  it('false：entitlement 为 undefined', () => {
    expect(hasFeatureOf(undefined, DASHBOARD_FULL_FEATURE)).toBe(false)
  })

  it('false：features 缺失（对象存在但无 features 字段）', () => {
    expect(hasFeatureOf({ plan: 'pro' }, DASHBOARD_FULL_FEATURE)).toBe(false)
  })

  it('false：features 非数组（脏数据不得崩）', () => {
    expect(hasFeatureOf({ plan: 'pro', features: 'dashboard_full' }, DASHBOARD_FULL_FEATURE)).toBe(false)
  })

  it('false：features 含非字符串元素时仍按严格相等判定', () => {
    expect(hasFeatureOf({ plan: 'pro', features: [1, null, {}] }, DASHBOARD_FULL_FEATURE)).toBe(false)
  })

  it('standard 档不得被误判为 free（回归：licenseStore.isPro 二值陷阱）', () => {
    // 这条是本次的核心回归：standard 不是 pro，但它**有** dashboard_full。
    // 用 isPro 判会把 standard 当成免费档。
    const standard = { plan: 'standard', features: ['cloud_publish', 'ai_write', 'video_create', 'schedule_batch', 'dashboard_full'] }
    expect(standard.plan === 'pro').toBe(false) // 若用 isPro 判，这里就错了
    expect(hasFeatureOf(standard, DASHBOARD_FULL_FEATURE)).toBe(true) // 正解
  })

  it('feature 常量与服务端真源一致（plan-matrix.js 派生名）', () => {
    expect(DASHBOARD_FULL_FEATURE).toBe('dashboard_full')
  })
})
