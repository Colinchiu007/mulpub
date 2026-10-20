// @ts-check
/**
 * useRewriteResultInvalidation.test.js — 改写结果变化时的作废契约（行为级，两条路径分别覆盖）。
 *
 * 这组用例守的是「手改 vs 程序赋值」这条**区分**——上一版把它埋在
 * `Collection.vue` 的内联 watch 里，两条路径都没有独立用例，于是「假归因」这条
 * 风险没有任何锁。抽成 composable 后，两条路径各自可判。
 */
import { describe, it, expect, vi } from 'vitest'
import { ref } from 'vue'
import { useRewriteResultInvalidation } from './useRewriteResultInvalidation'

function setup (initial = '') {
  const rewriteResult = ref(initial)
  const draftId = ref('draft-1')
  const lineageId = ref('rw-1')
  const invalidateDraftId = vi.fn(() => { draftId.value = null })
  const invalidateLineageId = vi.fn(() => { lineageId.value = null })
  const api = useRewriteResultInvalidation({ rewriteResult, invalidateDraftId, invalidateLineageId })
  return { rewriteResult, draftId, lineageId, invalidateDraftId, invalidateLineageId, ...api }
}

describe('useRewriteResultInvalidation — 改写结果变化时的作废契约', () => {
  it('程序赋值（新一轮改写）：草稿作废，但归因链保留（内容与 id 是一对）', () => {
    const s = setup()
    s.markProgrammaticAssignment('程序改写内容')
    s.rewriteResult.value = '程序改写内容'

    expect(s.invalidateDraftId).toHaveBeenCalledTimes(1)
    expect(s.draftId.value).toBe(null)
    // 程序赋值 ⇒ 归因链**不**作废（否则是假归因）
    expect(s.invalidateLineageId).not.toHaveBeenCalled()
    expect(s.lineageId.value).toBe('rw-1')
  })

  it('用户手改正文：草稿作废，归因链也作废（防假归因）', () => {
    const s = setup('程序改写内容')
    // 用户在 textarea 里手改（不经 markProgrammaticAssignment）
    s.rewriteResult.value = '用户手改后的内容'

    expect(s.invalidateDraftId).toHaveBeenCalledTimes(1)
    expect(s.draftId.value).toBe(null)
    expect(s.invalidateLineageId).toHaveBeenCalledTimes(1)
    expect(s.lineageId.value).toBe(null)
  })

  it('内容未变（赋同值）⇒ 两个作废都不触发', () => {
    const s = setup('同样的内容')
    s.rewriteResult.value = '同样的内容'
    expect(s.invalidateDraftId).not.toHaveBeenCalled()
    expect(s.invalidateLineageId).not.toHaveBeenCalled()
  })

  it('清空结果（clearRewriteResult）⇒ 草稿作废；归因链由调用方另行清空', () => {
    // 清空是「程序赋值」的一种（内容 = ''），若它被标成程序赋值，则归因链不作废——
    // 调用方在 clearRewriteResult 里已显式清归因链，两处各自负责，不互相依赖。
    const s = setup('旧内容')
    s.markProgrammaticAssignment('')
    s.rewriteResult.value = ''
    expect(s.invalidateDraftId).toHaveBeenCalledTimes(1)
  })
})
