/**
 * quick-collect-command — 指令校验与归一
 *
 * 判据是唯一口径（表单 / IPC / 引擎三处共用），因此边界用例必须逐条钉死：
 * 40/41 字标题、9/10 字指令、4000/4001 字指令、5/6 个关键词、30/31 字关键词、
 * 时间窗口闭集、sources 白名单。
 */
import { describe, it, expect } from 'vitest'

const base = {
  id: 'qc-abc',
  title: 'AI 领域动向',
  prompt: '请检索过去 48 小时的 AI 动态，输出 3 条建议关注。',
  keywords: ['AI', 'LLM'],
  windowHours: 48,
  sources: ['reddit', 'hackernews'],
  builtin: false,
}

async function mod () {
  return import('../services/quick-collect-command')
}

describe('quick-collect-command/validateQuickCollectCommand', () => {
  it('合法指令通过', async () => {
    const { validateQuickCollectCommand } = await mod()
    expect(validateQuickCollectCommand(base)).toEqual({ ok: true, code: null, field: null })
  })

  it('非对象 / null → QC_COMMAND_REQUIRED', async () => {
    const { validateQuickCollectCommand } = await mod()
    for (const raw of [null, undefined, 'x', 42]) {
      const r = validateQuickCollectCommand(raw)
      expect(r.ok, String(raw)).toBe(false)
      expect(r.code).toBe('QC_COMMAND_REQUIRED')
    }
  })

  it('标题：缺失 / 纯空白 / 41 字分别被拒', async () => {
    const { validateQuickCollectCommand } = await mod()
    expect(validateQuickCollectCommand({ ...base, title: '' }).code).toBe('QC_TITLE_REQUIRED')
    expect(validateQuickCollectCommand({ ...base, title: '   ' }).code).toBe('QC_TITLE_REQUIRED')
    expect(validateQuickCollectCommand({ ...base, title: 'x'.repeat(40) }).ok).toBe(true)
    expect(validateQuickCollectCommand({ ...base, title: 'x'.repeat(41) }).code).toBe('QC_TITLE_TOO_LONG')
  })

  it('指令：缺失 / 9 字 / 10 字 / 4000 字 / 4001 字', async () => {
    const { validateQuickCollectCommand } = await mod()
    expect(validateQuickCollectCommand({ ...base, prompt: '' }).code).toBe('QC_PROMPT_REQUIRED')
    expect(validateQuickCollectCommand({ ...base, prompt: '一二三四五六七八九' }).code).toBe('QC_PROMPT_TOO_SHORT')
    expect(validateQuickCollectCommand({ ...base, prompt: '一'.repeat(10) }).ok).toBe(true)
    expect(validateQuickCollectCommand({ ...base, prompt: '一'.repeat(4000) }).ok).toBe(true)
    expect(validateQuickCollectCommand({ ...base, prompt: '一'.repeat(4001) }).code).toBe('QC_PROMPT_TOO_LONG')
  })

  it('关键词：5 个通过 / 6 个被拒 / 31 字被拒 / 30 字通过', async () => {
    const { validateQuickCollectCommand } = await mod()
    expect(validateQuickCollectCommand({ ...base, keywords: ['a', 'b', 'c', 'd', 'e'] }).ok).toBe(true)
    expect(validateQuickCollectCommand({ ...base, keywords: ['a', 'b', 'c', 'd', 'e', 'f'] }).code).toBe('QC_KEYWORDS_TOO_MANY')
    expect(validateQuickCollectCommand({ ...base, keywords: ['k'.repeat(30)] }).ok).toBe(true)
    expect(validateQuickCollectCommand({ ...base, keywords: ['k'.repeat(31)] }).code).toBe('QC_KEYWORD_TOO_LONG')
  })

  it('关键词字符串输入按 , ， 、 拆分；空串不计入', async () => {
    const { validateQuickCollectCommand, splitKeywords } = await mod()
    expect(splitKeywords('a, b，c、d ,, ')).toEqual(['a', 'b', 'c', 'd'])
    expect(validateQuickCollectCommand({ ...base, keywords: '' }).ok).toBe(true)
  })

  it('时间窗口只接受闭集 0/24/48/168', async () => {
    const { validateQuickCollectCommand, WINDOW_HOURS } = await mod()
    expect(WINDOW_HOURS).toEqual([0, 24, 48, 168])
    for (const h of WINDOW_HOURS) {
      expect(validateQuickCollectCommand({ ...base, windowHours: h }).ok, String(h)).toBe(true)
    }
    for (const h of [1, 12, 72, -1, 'x', null]) {
      expect(validateQuickCollectCommand({ ...base, windowHours: h }).code, String(h)).toBe('QC_WINDOW_INVALID')
    }
  })

  it('sources：缺省=全选；未知源/非数组被拒；空数组合法', async () => {
    const { validateQuickCollectCommand, ALLOWED_SOURCES } = await mod()
    expect(ALLOWED_SOURCES).toEqual(['reddit', 'hackernews', 'github'])
    expect(validateQuickCollectCommand({ ...base, sources: undefined }).ok).toBe(true)
    expect(validateQuickCollectCommand({ ...base, sources: [] }).ok).toBe(true)
    expect(validateQuickCollectCommand({ ...base, sources: ['weibo'] }).code).toBe('QC_SOURCES_INVALID')
    expect(validateQuickCollectCommand({ ...base, sources: 'reddit' }).code).toBe('QC_SOURCES_INVALID')
    expect(validateQuickCollectCommand({ ...base, sources: [1] }).code).toBe('QC_SOURCES_INVALID')
  })
})

describe('quick-collect-command/normalizeQuickCollectCommand', () => {
  it('trim 标题与指令，关键词去空去重（保留首次出现顺序）', async () => {
    const { normalizeQuickCollectCommand } = await mod()
    const out = normalizeQuickCollectCommand({ ...base, title: '  标题  ', prompt: '  一二三四五六七八九十  ', keywords: ['AI', ' AI ', 'LLM'] })
    expect(out.title).toBe('标题')
    expect(out.prompt).toBe('一二三四五六七八九十')
    expect(out.keywords).toEqual(['AI', 'LLM'])
  })

  it('sources 缺省补全为全选并按闭集顺序排序', async () => {
    const { normalizeQuickCollectCommand } = await mod()
    expect(normalizeQuickCollectCommand({ ...base, sources: ['github', 'reddit'] }).sources).toEqual(['reddit', 'github'])
    expect(normalizeQuickCollectCommand({ ...base, sources: undefined }).sources).toEqual(['reddit', 'hackernews', 'github'])
    expect(normalizeQuickCollectCommand({ ...base, sources: [] }).sources).toEqual([])
  })

  it('非法输入返回 null（不抛错、不静默截断）', async () => {
    const { normalizeQuickCollectCommand } = await mod()
    expect(normalizeQuickCollectCommand({ ...base, title: 'x'.repeat(41) })).toBeNull()
    expect(normalizeQuickCollectCommand(null)).toBeNull()
  })

  it('缺 id 时用注入的 idFactory，且 createdAt/updatedAt 取自注入时钟', async () => {
    const { normalizeQuickCollectCommand } = await mod()
    const fixed = Date.parse('2026-10-11T04:00:00.000Z')
    const out = normalizeQuickCollectCommand({ ...base, id: undefined, createdAt: undefined, updatedAt: undefined }, { now: fixed, idFactory: () => 'qc-fixed' })
    expect(out.id).toBe('qc-fixed')
    expect(out.createdAt).toBe('2026-10-11T04:00:00.000Z')
    expect(out.updatedAt).toBe('2026-10-11T04:00:00.000Z')
  })

  it('summary 截断 80 字；builtin 只认严格 true', async () => {
    const { normalizeQuickCollectCommand } = await mod()
    const out = normalizeQuickCollectCommand({ ...base, summary: 'x'.repeat(200), builtin: 'yes' })
    expect(out.summary.length).toBe(80)
    expect(out.builtin).toBe(false)
  })
})

describe('quick-collect-command/isDuplicateTitle', () => {
  it('去首尾空白且不区分大小写；排除自身 id', async () => {
    const { isDuplicateTitle } = await mod()
    const list = [{ id: 'a', title: 'AI 领域动向' }]
    expect(isDuplicateTitle(' ai 领域动向 ', list)).toBe(true)
    expect(isDuplicateTitle('AI 领域动向', list, 'a')).toBe(false)
    expect(isDuplicateTitle('AI 领域动向', list, 'b')).toBe(true)
    expect(isDuplicateTitle('', list)).toBe(false)
  })
})

describe('quick-collect-command/newCustomCommandId', () => {
  it('形状为 qc- 前缀且两次调用不重复', async () => {
    const { newCustomCommandId } = await mod()
    const a = newCustomCommandId()
    const b = newCustomCommandId()
    expect(a).toMatch(/^qc-[a-z0-9]+$/)
    expect(a).not.toBe(b)
  })
})
