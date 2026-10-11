/**
 * quick-collect-commands — 前端纯逻辑
 *
 * 两个平面（渲染端 ESM / 主进程 CJS）各有一份实现，**闭集必须一致**：
 * 本文件第一组用例直接 import 主进程模块逐项比对，任何一侧改了边界都会红。
 */
import { describe, it, expect } from 'vitest'
import {
  WINDOW_HOURS,
  ALLOWED_SOURCES,
  LIMITS,
  FORM_ERROR_KEYS,
  DOMAIN_CODE_TO_FORM_KEY,
  STORAGE_VERSION,
  splitKeywordsInput,
  formatKeywordsInput,
  dedupeKeywords,
  parseWindowHours,
  validateCommandForm,
  isDuplicateTitle,
  buildCommandFromForm,
  encodeCommands,
  decodeCommands,
  sortCustomCommands,
  mergeCommands,
  windowLabelKey,
  newCommandId,
} from './quick-collect-commands'

async function mainModule () {
  return import('../../../electron/services/quick-collect-command')
}

describe('前后端闭集对账（跨平面，防漂移）', () => {
  it('WINDOW_HOURS / ALLOWED_SOURCES / LIMITS 逐项相等', async () => {
    const main = await mainModule()
    expect([...WINDOW_HOURS]).toEqual([...main.WINDOW_HOURS])
    expect([...ALLOWED_SOURCES]).toEqual([...main.ALLOWED_SOURCES])
    expect({ ...LIMITS }).toEqual({ ...main.LIMITS })
  })

  it('关键词拆分口径一致（含 `,` `，` `、` 与数组形态）', async () => {
    const main = await mainModule()
    for (const input of ['a, b，c、d ,, ', ['a', ' b ', ''], '', null, 42]) {
      expect(splitKeywordsInput(input), JSON.stringify(input)).toEqual(main.splitKeywords(input))
    }
  })

  it('窗口解析口径一致（null / "" / true / 数字串都不得落到 0）', async () => {
    const main = await mainModule()
    for (const input of [null, undefined, '', '  ', true, false, 0, '0', 48, '48', 72, 'x', [], {}]) {
      const a = parseWindowHours(input)
      const b = main.parseWindowHours(input)
      expect(Number.isNaN(a) ? 'NaN' : a, JSON.stringify(input)).toBe(Number.isNaN(b) ? 'NaN' : b)
    }
  })

  it('关键词去重口径一致（不区分大小写，保留首次写法）', async () => {
    const main = await mainModule()
    for (const list of [['AI', 'ai', 'LLM'], ['a', 'A', 'b'], [], ['x']]) {
      expect(dedupeKeywords(list), JSON.stringify(list)).toEqual(main.dedupeKeywords(list))
    }
    expect(dedupeKeywords(['AI', 'ai', 'LLM'])).toEqual(['AI', 'LLM'])
  })

  it('查重口径一致（去空白 + 不区分大小写 + 排除自身）', async () => {
    const main = await mainModule()
    const list = [{ id: 'a', title: 'AI 领域动向' }, { id: 'b', title: 'Other' }]
    for (const [title, exclude] of [[' ai 领域动向 ', undefined], ['AI 领域动向', 'a'], ['other', undefined], ['', undefined]]) {
      expect(isDuplicateTitle(title, list, exclude), title + '/' + exclude).toBe(main.isDuplicateTitle(title, list, exclude))
    }
  })

  it('领域码 → 表单文案键的映射覆盖主进程全部领域码', async () => {
    const main = await mainModule()
    const codes = Object.values(main.QUICK_COLLECT_CODES)
    for (const code of codes) {
      expect(DOMAIN_CODE_TO_FORM_KEY[code], code).toBeTruthy()
      expect(FORM_ERROR_KEYS[DOMAIN_CODE_TO_FORM_KEY[code]], code).toBeTruthy()
    }
  })
})

describe('validateCommandForm', () => {
  const base = { title: 'AI 领域动向', prompt: '请检索过去 48 小时的 AI 动态并输出三条建议。', keywords: 'AI, LLM', windowHours: 48 }

  it('合法表单通过', () => {
    expect(validateCommandForm(base)).toEqual({ ok: true, errors: {} })
  })

  it('标题：空 / 41 字 / 重名', () => {
    expect(validateCommandForm({ ...base, title: '  ' }).errors.title).toBe('errTitleRequired')
    expect(validateCommandForm({ ...base, title: 'x'.repeat(41) }).errors.title).toBe('errTitleTooLong')
    expect(validateCommandForm({ ...base, title: 'OTHER' }, { existing: [{ id: 'b', title: 'other' }] }).errors.title).toBe('errTitleDuplicate')
    // 编辑自己时不算重名
    expect(validateCommandForm({ ...base, title: 'other' }, { existing: [{ id: 'b', title: 'other' }], excludeId: 'b' }).errors.title).toBeUndefined()
  })

  it('指令：空 / 9 字 / 4001 字', () => {
    expect(validateCommandForm({ ...base, prompt: '' }).errors.prompt).toBe('errPromptRequired')
    expect(validateCommandForm({ ...base, prompt: '一二三四五六七八九' }).errors.prompt).toBe('errPromptShort')
    expect(validateCommandForm({ ...base, prompt: '一'.repeat(4001) }).errors.prompt).toBe('errPromptTooLong')
    expect(validateCommandForm({ ...base, prompt: '一'.repeat(4000) }).ok).toBe(true)
  })

  it('关键词：6 个 / 31 字', () => {
    expect(validateCommandForm({ ...base, keywords: 'a,b,c,d,e,f' }).errors.keywords).toBe('errKeywordsTooMany')
    expect(validateCommandForm({ ...base, keywords: 'k'.repeat(31) }).errors.keywords).toBe('errKeywordTooLong')
    expect(validateCommandForm({ ...base, keywords: '' }).ok).toBe(true)
  })

  it('窗口不在闭集 → errWindowInvalid', () => {
    expect(validateCommandForm({ ...base, windowHours: 72 }).errors.windowHours).toBe('errWindowInvalid')
    expect(validateCommandForm({ ...base, windowHours: '' }).errors.windowHours).toBe('errWindowInvalid')
    expect(validateCommandForm({ ...base, windowHours: '168' }).ok).toBe(true)
  })

  it('多字段同时非法时逐个字段各报一条', () => {
    const r = validateCommandForm({ title: '', prompt: '', keywords: 'a,b,c,d,e,f', windowHours: 1 })
    expect(Object.keys(r.errors).sort()).toEqual(['keywords', 'prompt', 'title', 'windowHours'])
  })
})

describe('buildCommandFromForm', () => {
  it('校验不通过返回 null（调用方保留用户输入）', () => {
    expect(buildCommandFromForm({ title: '', prompt: 'x', keywords: '', windowHours: 48 })).toBeNull()
  })

  it('产出形状完整：关键词去重、sources 全选、custom id、时间戳注入', () => {
    const fixed = Date.parse('2026-10-11T04:00:00.000Z')
    const cmd = buildCommandFromForm(
      { title: ' 我的指令 ', prompt: '请检索最近 24 小时的 AI 动态，输出三条。', keywords: 'AI, ai , LLM', windowHours: 24 },
      { now: fixed },
    )
    expect(cmd.id).toMatch(/^qc-/)
    expect(cmd.title).toBe('我的指令')
    expect(cmd.keywords).toEqual(['AI', 'LLM'])
    expect(cmd.sources).toEqual([...ALLOWED_SOURCES])
    expect(cmd.builtin).toBe(false)
    expect(cmd.windowHours).toBe(24)
    expect(cmd.updatedAt).toBe('2026-10-11T04:00:00.000Z')
  })

  it('编辑时保留 id 与 createdAt', () => {
    const preset = { id: 'qc-old', createdAt: '2026-01-01T00:00:00.000Z' }
    const cmd = buildCommandFromForm(
      { title: '改名', prompt: '请检索最近 7 天的平台规则变化并列出三条。', keywords: '', windowHours: 168 },
      { preset, now: Date.parse('2026-10-11T04:00:00.000Z') },
    )
    expect(cmd.id).toBe('qc-old')
    expect(cmd.createdAt).toBe('2026-01-01T00:00:00.000Z')
  })
})

describe('encodeCommands / decodeCommands', () => {
  const custom = {
    id: 'qc-1', title: '我的指令', summary: '', prompt: '请检索最近 48 小时的 AI 动态并输出三条建议。',
    keywords: ['AI'], windowHours: 48, sources: ['hackernews'], builtin: false, createdAt: '', updatedAt: '2026-10-11T04:00:00.000Z',
  }

  it('编码只写自定义指令（内置不落盘）', () => {
    const raw = encodeCommands([{ ...custom, id: 'builtin-ai-trends', builtin: true }, custom])
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(STORAGE_VERSION)
    expect(parsed.commands.map((c) => c.id)).toEqual(['qc-1'])
  })

  it('v1 往返一致', () => {
    const decoded = decodeCommands(encodeCommands([custom]))
    expect(decoded.commands).toHaveLength(1)
    expect(decoded.commands[0].title).toBe('我的指令')
    expect(decoded.skipped).toBe(0)
    expect(decoded.version).toBe(1)
  })

  it('v0 裸数组按历史形态读取', () => {
    const decoded = decodeCommands(JSON.stringify([custom]))
    expect(decoded.version).toBe(0)
    expect(decoded.commands).toHaveLength(1)
  })

  it('脏数据逐条丢弃并计数，不整表消失', () => {
    const decoded = decodeCommands(JSON.stringify({
      version: 1,
      commands: [
        custom,
        { ...custom, id: 'qc-bad', title: '' },            // 标题缺失
        { ...custom, id: 'qc-bad2', prompt: 'x' },          // 指令过短
        { ...custom, id: 'builtin-x', builtin: true },      // 内置残留
        null,
      ],
    }))
    expect(decoded.commands.map((c) => c.id)).toEqual(['qc-1'])
    expect(decoded.skipped).toBe(4)
  })

  it('无法解析的字符串 / null / 数字 → 空列表且不抛错', () => {
    for (const raw of ['not json', '', '   ', null, undefined, 42]) {
      const decoded = decodeCommands(raw)
      expect(decoded.commands, String(raw)).toEqual([])
      expect(decoded.skipped).toBe(0)
    }
  })

  it('对象里 commands 非数组 → 空列表', () => {
    expect(decodeCommands(JSON.stringify({ version: 1, commands: 'nope' })).commands).toEqual([])
  })
})

describe('sortCustomCommands / mergeCommands / windowLabelKey', () => {
  it('按 updatedAt 倒序；同时间按标题字典序', () => {
    const sorted = sortCustomCommands([
      { id: 'a', title: 'B', updatedAt: '2026-10-10T00:00:00.000Z' },
      { id: 'b', title: 'A', updatedAt: '2026-10-11T00:00:00.000Z' },
      { id: 'c', title: 'A', updatedAt: '2026-10-10T00:00:00.000Z' },
    ])
    expect(sorted.map((c) => c.id)).toEqual(['b', 'c', 'a'])
  })

  it('内置在前；自定义与内置同 id 时以内置为准', () => {
    const presets = [{ id: 'builtin-ai-trends', title: '内置', builtin: true }]
    const customs = [{ id: 'builtin-ai-trends', title: '伪造' }, { id: 'qc-1', title: '自定义' }]
    const merged = mergeCommands(presets, customs)
    expect(merged.map((c) => c.title)).toEqual(['内置', '自定义'])
    expect(merged[0].builtin).toBe(true)
  })

  it('窗口 → locale 键', () => {
    expect(windowLabelKey(24)).toBe('window24')
    expect(windowLabelKey('48')).toBe('window48')
    expect(windowLabelKey(168)).toBe('window168')
    expect(windowLabelKey(0)).toBe('window0')
    expect(windowLabelKey(999)).toBe('window0')
  })

  it('newCommandId 形状与唯一性', () => {
    const a = newCommandId()
    expect(a).toMatch(/^qc-[a-z0-9]+$/)
    expect(a).not.toBe(newCommandId())
  })
})
