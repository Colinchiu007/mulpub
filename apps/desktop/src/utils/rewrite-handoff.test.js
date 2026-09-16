import { describe, it, expect, beforeEach } from 'vitest'
import { setRewriteHandoff, takeRewriteHandoff, clearRewriteHandoff } from './rewrite-handoff'

describe('rewrite-handoff', () => {
  beforeEach(() => {
    clearRewriteHandoff()
    sessionStorage.clear()
  })

  it('set → take 返回同一载荷且读后即焚', () => {
    const payload = { content: '正文内容', title: '标题', fromKey: 'collect:c1' }
    expect(setRewriteHandoff(payload)).toBe(true)
    expect(takeRewriteHandoff()).toEqual(payload)
    expect(takeRewriteHandoff()).toBeNull()
  })

  it('content 为空时拒绝写入', () => {
    expect(setRewriteHandoff({ content: '   ' })).toBe(false)
    expect(setRewriteHandoff(null)).toBe(false)
    expect(takeRewriteHandoff()).toBeNull()
  })

  it('无载荷时返回 null（不抛异常）', () => {
    expect(takeRewriteHandoff()).toBeNull()
  })

  it('载荷损坏时返回 null 且清除残留', () => {
    sessionStorage.setItem('rewrite_handoff_v1', '{not-json')
    expect(takeRewriteHandoff()).toBeNull()
  })
})
