/**
 * useRewriteWordCount 单测（rewrite-view-decompose，2026-10-21）。
 *
 * 为什么要有这个文件：字数区间从 RewriteView.vue 拆成独立 composable 后，
 * 「用户手动改过的记忆位」与「按输入形态自适应」这两条规则就离开了视图的视线。
 * 视图里它们只表现为「输入框里的数字变了」，**没有任何测试锁住「手动值不被自适应覆盖」**
 * —— 这条一旦失效，用户设的 3000 字上限会被改写前的一次推导悄悄改回 2000。
 *
 * 本文件锁住三条契约：
 *   ① 默认区间 800-2000 且校验通过；
 *   ② 手动置位后，自适应推导**不得**再覆盖用户值；
 *   ③ 未手动置位时，自适应推导**必须**生效（否则长文又被硬截 60%）。
 */
import { describe, it, expect } from 'vitest'
import { useRewriteWordCount } from './useRewriteWordCount'

/** 错误文案解析器：与视图同形（视图传 t('rewritePage.' + key)） */
const resolveError = (key) => 'ERR:' + key

/** 一段长成稿（超过 2000 字 ⇒ 触发自适应分支） */
const LONG_DRAFT = '这是一段足够长的成稿内容。'.repeat(200)

describe('useRewriteWordCount — 默认值与校验', () => {
  it('默认 800-2000，且校验通过（error 为空串）', () => {
    const { wordCountMin, wordCountMax, wordCountError } = useRewriteWordCount(resolveError)
    expect(wordCountMin.value).toBe(800)
    expect(wordCountMax.value).toBe(2000)
    expect(wordCountError.value).toBe('')
  })

  it('max < min ⇒ 报 wordCountMaxLtMin（错误文案由调用方的 resolveError 决定）', () => {
    const { wordCountMin, wordCountMax, wordCountError } = useRewriteWordCount(resolveError)
    wordCountMin.value = 2000
    wordCountMax.value = 100
    expect(wordCountError.value).toBe('ERR:wordCountMaxLtMin')
  })

  it('两侧留空 ⇒ 改写页严格语义下判非法（不得借采集页的 allowEmpty 语义放行）', () => {
    const { wordCountMin, wordCountMax, wordCountError } = useRewriteWordCount(resolveError)
    wordCountMin.value = ''
    wordCountMax.value = ''
    expect(wordCountError.value).toBe('ERR:wordCountMinInvalid')
  })
})

describe('useRewriteWordCount — 手动值优先于自适应', () => {
  it('未手动置位时，长文按原文长度自适应（上限被抬高，不再硬截 60%）', () => {
    const { wordCountMin, wordCountMax, applyWordCountDefaults } = useRewriteWordCount(resolveError)
    applyWordCountDefaults(LONG_DRAFT)
    expect(wordCountMax.value).toBeGreaterThan(2000)
    expect(wordCountMin.value).toBeLessThanOrEqual(wordCountMax.value)
  })

  it('手动置位后，自适应推导不得覆盖用户值（这条一旦失效，用户设的上限会被悄悄改回）', () => {
    const { wordCountMin, wordCountMax, markWordCountManuallySet, applyWordCountDefaults } = useRewriteWordCount(resolveError)
    wordCountMin.value = 3000
    wordCountMax.value = 5000
    markWordCountManuallySet()
    applyWordCountDefaults(LONG_DRAFT)
    expect(wordCountMin.value).toBe(3000)
    expect(wordCountMax.value).toBe(5000)
  })

  it('手动置位只影响「是否被推导覆盖」，不影响用户后续继续改值', () => {
    const { wordCountMin, wordCountMax, markWordCountManuallySet, applyWordCountDefaults } = useRewriteWordCount(resolveError)
    markWordCountManuallySet()
    applyWordCountDefaults(LONG_DRAFT)
    // 用户之后手动改成 1200-1500：必须原样保留
    wordCountMin.value = 1200
    wordCountMax.value = 1500
    applyWordCountDefaults(LONG_DRAFT)
    expect(wordCountMin.value).toBe(1200)
    expect(wordCountMax.value).toBe(1500)
  })

  it('短文走固定默认区间 800-2000（低于自适应阈值的形态不参与自适应）', () => {
    const { wordCountMin, wordCountMax, applyWordCountDefaults } = useRewriteWordCount(resolveError)
    applyWordCountDefaults('短文。')
    expect(wordCountMin.value).toBe(800)
    expect(wordCountMax.value).toBe(2000)
  })
})
