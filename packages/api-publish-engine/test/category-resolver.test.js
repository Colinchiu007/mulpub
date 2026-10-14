/**
 * category-resolver 测试。
 *
 * 被测：packages/api-publish-engine/src/publish/category-resolver.js
 *
 * ## 这一层为什么是「守卫」而不是「解析器」
 *
 * 本包是可独立打包的**零 workspace 依赖**运行时（先例：`cloud-accounts/validate-account.js:84-89`
 * 明写「因此不能 require('@multi-publish/shared-utils')」）。
 * 而「中文分类名 → 平台侧 ID」需要分类表 + 5 种失败原因语义，属 `shared-utils.platformTaxonomy`
 * 的职责、由**上游（桌面主进程）在组包前完成**。
 *
 * 故本层只做一件事：**给了值就必须是合法 ID，否则抛错**。这修掉了
 * `tid: Number(taskData.category || taskData.tid) || 21` 里
 * 「传中文名 ⇒ Number('动画')=NaN ⇒ 静默变 21」的洞。
 *
 * 用法: npx vitest run packages/api-publish-engine/test/category-resolver.test.js
 */
import { describe, expect, it } from 'vitest'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { resolvePublishCategory, isExplicitId, isBlockingReason } = require('../src/publish/category-resolver.js')

describe('isExplicitId —— 形态判据', () => {
  it('十进制非负整数（含前后空白）算 ID', () => {
    expect(isExplicitId('21')).toBe(true)
    expect(isExplicitId(' 160 ')).toBe(true)
    expect(isExplicitId(21)).toBe(true)
    expect(isExplicitId('0')).toBe(true)
    expect(isExplicitId('60101')).toBe(true)
  })

  it('中文名 / 空值 / 小数 / 十六进制 / 科学计数都不算', () => {
    expect(isExplicitId('日常')).toBe(false)
    expect(isExplicitId('')).toBe(false)
    expect(isExplicitId('   ')).toBe(false)
    expect(isExplicitId(null)).toBe(false)
    expect(isExplicitId(undefined)).toBe(false)
    expect(isExplicitId('21.5')).toBe(false)
    expect(isExplicitId('0x15')).toBe(false)
    expect(isExplicitId('2e1')).toBe(false)
    expect(isExplicitId('21abc')).toBe(false)
  })
})

describe('未提供分类 ⇒ 交回调用方（行为与改前一致）', () => {
  it('空值返回 not-provided，且不抛异常', () => {
    for (const v of [null, undefined, '', '   ']) {
      const r = resolvePublishCategory(v)
      expect(r.ok).toBe(false)
      expect(r.reason).toBe('not-provided')
    }
  })
})

describe('★ 核心：给了值就必须是合法 ID —— 中文名不再静默变成默认值', () => {
  it('合法 ID ⇒ 返回 number（不再是字符串，避免下游反复 Number() 转换）', () => {
    const r = resolvePublishCategory('21')
    expect(r).toMatchObject({ ok: true, id: 21, source: 'explicit-id' })
    expect(typeof r.id).toBe('number')
  })

  it('★★ 中文分类名 ⇒ **抛错**，绝不回落默认值', () => {
    // 这是本模块存在的理由：改前 `Number('动画') || 21` 会静默得到 21
    let caught = null
    try { resolvePublishCategory('动画') } catch (e) { caught = e }
    expect(caught, '传中文名必须抛错而不是静默回落').not.toBeNull()
    expect(caught.code).toBe('CATEGORY_UNRESOLVED')
    expect(caught.categoryReason).toBe('invalid-format')
    // 报错信息必须点明「该去哪儿解析」，否则使用者只看到「不是 ID」而不知怎么办
    expect(caught.message).toMatch(/resolveCategoryId|上游/)
  })

  it('其他非法形态（小数/十六进制/带字母）一律抛错', () => {
    for (const bad of ['21.5', '0x15', '2e1', '21abc', '二十一']) {
      expect(() => resolvePublishCategory(bad), `${bad} 应抛错`).toThrow()
    }
  })

  it('★ 数字 0 是合法 ID，不得被当成「空值」', () => {
    // `if (!raw)` 这种写法会把 0 误判成未提供 —— 本判据锁定这一点
    expect(resolvePublishCategory(0)).toMatchObject({ ok: true, id: 0 })
    expect(resolvePublishCategory('0')).toMatchObject({ ok: true, id: 0 })
  })
})

describe('阻塞语义', () => {
  it('invalid-format 是唯一的阻塞原因（not-provided 不是）', () => {
    expect(isBlockingReason('invalid-format')).toBe(true)
    expect(isBlockingReason('not-provided')).toBe(false)
  })
})

describe('★ 零 workspace 依赖（架构约束的机械锁）', () => {
  it('本模块不得 require @multi-publish/* （本包是可独立打包的运行时）', () => {
    const fs = require('node:fs')
    const path = require('node:path')
    const src = fs.readFileSync(path.join(__dirname, '../src/publish/category-resolver.js'), 'utf8')
    expect(src).not.toMatch(/require\(['"]@multi-publish\//)
    expect(src).not.toMatch(/require\(['"][^'"]*shared-utils/)
  })
})
