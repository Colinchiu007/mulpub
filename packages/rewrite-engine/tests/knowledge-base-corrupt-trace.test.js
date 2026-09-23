/**
 * 审计 P2·静默 catch 收口（rewrite-engine 知识库存量数据损坏）回归保护。
 *
 * 被保护的行为：存储里的知识库 JSON 不可解析时仍回退默认值（不阻断启动），
 * 但这等价于「用户既有偏好静默清零」——属数据丢失级事件，必须留一条 warn。
 */
import { describe, it, expect, vi } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'

const { KnowledgeBase } = await import("../src/knowledge-base")

function makeStorage(payload) {
  return { get: () => payload, set: () => {} }
}

describe('KnowledgeBase.init 数据损坏降级留痕', () => {
  it('不可解析的存量数据 → 回退默认值并 warn 一次（含"偏好丢失"口径）', () => {
    const warns = []
    const kb = new KnowledgeBase({
      storage: makeStorage('{不是合法 JSON'),
      logger: { info: () => {}, warn: (tag, msg) => warns.push([tag, msg]) },
    })
    kb.init()
    expect(warns).toHaveLength(1)
    expect(warns[0][0]).toBe('KnowledgeBase')
    expect(warns[0][1]).toContain('用户既有偏好丢失')
    expect(kb._data).toBeTruthy()
  })

  it('合法存量数据 → 不产生 warn（留痕不得变成噪音）', () => {
    const warns = []
    const kb = new KnowledgeBase({
      storage: makeStorage(JSON.stringify({ entries: [], version: 1 })),
      logger: { info: () => {}, warn: (tag, msg) => warns.push([tag, msg]) },
    })
    kb.init()
    expect(warns).toEqual([])
  })

  it('未注入 logger 时走 console fallback（不外抛、不静默）', () => {
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      const kb = new KnowledgeBase({ storage: makeStorage('null-or-broken[') })
      kb.init()
      expect(spy).toHaveBeenCalled()
      expect(String(spy.mock.calls[0][0])).toContain('KnowledgeBase')
    } finally {
      spy.mockRestore()
    }
  })

  it('防复发静态不变量：knowledge-base.js 不再有无留痕的空 catch', () => {
    const src = fs.readFileSync(path.resolve(process.cwd(), 'src/knowledge-base.js'), 'utf8')
    const silent = src.match(/catch\s*\{\s*(\/\*[^*]*\*\/|\/\/[^\n]*)?\s*\}/g) || []
    expect(silent).toEqual([])
  })
})
