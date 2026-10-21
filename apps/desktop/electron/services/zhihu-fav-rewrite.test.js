// @ts-check
/**
 * zhihu-fav-rewrite 字数区间纯函数单测（feat-zhihu-fav-batch-wordcount，2026-10-21）
 *
 * 这个模块是主进程侧「用户字数区间 → Python /aggregation/rewrite 请求字段」的**唯一归一入口**。
 * 它独立成模块而不是塞进 zhihu-favlist.js，是因为后者已 498 行、距 500 行天花板只剩 2 行。
 *
 * 三条契约：
 *  ① 合法区间 ⇒ 归一为 {min, max} 并产出 Python 字段；
 *  ② 缺省/非法 ⇒ 归一为 null ⇒ **不带** Python 字段 ⇒ Python 回落 length 三档（旧行为不变）；
 *  ③ 超限判定是纯比较，且**不截断**（截断 = 静默丢内容；本仓理念是可见化而非静默）。
 */
import { describe, it, expect } from 'vitest'

const {
  normalizeRewriteWordCountRange,
  buildRewriteRangeFields,
  isOverWordCountLimit,
} = require('./zhihu-fav-rewrite')

describe('normalizeRewriteWordCountRange — 区间归一', () => {
  it('合法区间原样保留（min=0 合法：它是「不设下限」）', () => {
    expect(normalizeRewriteWordCountRange({ min: 0, max: 6000 })).toEqual({ min: 0, max: 6000 })
    expect(normalizeRewriteWordCountRange({ min: 800, max: 2000 })).toEqual({ min: 800, max: 2000 })
  })

  it('字符串数字按数值归一（IPC 传参可能是字符串）', () => {
    expect(normalizeRewriteWordCountRange({ min: '0', max: '6000' })).toEqual({ min: 0, max: 6000 })
  })

  it('缺省 / null / undefined ⇒ null（⇒ 不带字段 ⇒ 旧行为）', () => {
    expect(normalizeRewriteWordCountRange(undefined)).toBeNull()
    expect(normalizeRewriteWordCountRange(null)).toBeNull()
    expect(normalizeRewriteWordCountRange({})).toBeNull()
  })

  it('非整数（浮点）⇒ null', () => {
    expect(normalizeRewriteWordCountRange({ min: 1.5, max: 6000 })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: 0, max: 6000.5 })).toBeNull()
  })

  it('越界 ⇒ null（min 0-49999 / max 1-50000）', () => {
    expect(normalizeRewriteWordCountRange({ min: -1, max: 6000 })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: 50000, max: 50000 })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: 0, max: 0 })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: 0, max: 50001 })).toBeNull()
  })

  it('max < min ⇒ null', () => {
    expect(normalizeRewriteWordCountRange({ min: 6000, max: 100 })).toBeNull()
  })

  it('NaN / Infinity ⇒ null', () => {
    expect(normalizeRewriteWordCountRange({ min: NaN, max: 6000 })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: 0, max: Infinity })).toBeNull()
  })

  it('空值（空串 / null / undefined）⇒ null，不是「合法的下限 0」（外部评审 i2）', () => {
    // Number('') === 0、Number(null) === 0 —— 不先判空就会把「清空」误读成「不设下限」，
    // 而渲染层的语义是「清空 = 非法 + 禁用按钮」，两者含义相反。
    expect(normalizeRewriteWordCountRange({ min: '', max: 6000 })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: null, max: 6000 })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: undefined, max: 6000 })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: 0, max: '' })).toBeNull()
    expect(normalizeRewriteWordCountRange({ min: 0, max: null })).toBeNull()
  })
})

describe('buildRewriteRangeFields — 转 Python 请求字段', () => {
  it('合法区间 ⇒ {min_word_count, max_word_count}', () => {
    expect(buildRewriteRangeFields({ min: 0, max: 6000 })).toEqual({ min_word_count: 0, max_word_count: 6000 })
  })

  it('null ⇒ null（调用方据此「不带字段」，让 Python 回落 length 三档）', () => {
    expect(buildRewriteRangeFields(null)).toBeNull()
    expect(buildRewriteRangeFields(undefined)).toBeNull()
  })
})

describe('isOverWordCountLimit — 超限判定（只判定，不截断）', () => {
  it('无上限（null/undefined）⇒ 永不算超限', () => {
    expect(isOverWordCountLimit(9000, null)).toBe(false)
    expect(isOverWordCountLimit(9000, undefined)).toBe(false)
  })

  it('wordCount > max ⇒ 超限；等于上限不算', () => {
    expect(isOverWordCountLimit(6001, 6000)).toBe(true)
    expect(isOverWordCountLimit(6000, 6000)).toBe(false)
    expect(isOverWordCountLimit(100, 6000)).toBe(false)
  })

  it('非法字数（NaN / 负数）⇒ 不算超限（不凭空造一条告警）', () => {
    expect(isOverWordCountLimit(NaN, 6000)).toBe(false)
    expect(isOverWordCountLimit(-1, 6000)).toBe(false)
  })
})

describe('rewriteOne — 改写稿实际字数（码点口径）', () => {
  const { rewriteOne } = require('./zhihu-fav-rewrite')

  it('Python 回传 word_count ⇒ 直接采用（码点口径）', async () => {
    const bridge = { requestBackend: async () => ({ result_content: '改写正文', word_count: 4 }) }
    const r = await rewriteOne(bridge, '原文', '轻松易懂', null, null)
    expect(r.text).toBe('改写正文')
    expect(r.wordCount).toBe(4)
  })

  it('Python 未回传 word_count ⇒ 兜底按**码点**计（外部评审 i4：emoji 不能按 UTF-16 算）', async () => {
    // '😀' 是 1 个码点、2 个 UTF-16 码元 ⇒ .length 会算成 2
    const bridge = { requestBackend: async () => ({ result_content: '😀' }) }
    const r = await rewriteOne(bridge, '原文', '轻松易懂', null, null)
    expect(r.wordCount).toBe(1)
  })

  it('空结果 ⇒ 返回 error（不产出字数）', async () => {
    const bridge = { requestBackend: async () => ({ result_content: '' }) }
    const r = await rewriteOne(bridge, '原文', '轻松易懂', null, null)
    expect(r.error).toBeTruthy()
    expect(r.text).toBeUndefined()
  })
})
