/**
 * useQuickCollectCommands — 加载 / CRUD / 落盘
 *
 * 三条不可破：① 落盘只写自定义指令（内置不落盘）；② 读失败与"确实没有"必须区分；
 * ③ 内置指令的编辑/删除必须被拒绝（界面不渲染入口只是第一道，服务层也要挡住）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { flushPromises } from '@vue/test-utils'

vi.mock('@/api/publisher', () => ({
  storeGetSettingResult: vi.fn(),
  storeSetSetting: vi.fn(async () => ({ code: 0 })),
}))
vi.mock('@/api/quick-collect', () => ({
  quickCollectListPresets: vi.fn(),
  quickCollectRun: vi.fn(),
  onQuickCollectProgress: vi.fn(() => () => {}),
}))

const { storeGetSettingResult, storeSetSetting } = await import('@/api/publisher')
const { quickCollectListPresets } = await import('@/api/quick-collect')
const { useQuickCollectCommands, QUICK_COLLECT_COMMANDS_KEY } = {
  ...(await import('./useQuickCollectCommands')),
  QUICK_COLLECT_COMMANDS_KEY: (await import('./quick-collect-commands')).QUICK_COLLECT_COMMANDS_KEY,
}

const PRESETS = [
  { id: 'builtin-ai-trends', title: 'AI 领域动向', summary: 's', prompt: 'p'.repeat(20), keywords: ['AI'], windowHours: 48, sources: ['hackernews'], builtin: true },
  { id: 'builtin-hot-topics', title: '热点选题雷达', summary: 's', prompt: 'p'.repeat(20), keywords: [], windowHours: 48, sources: ['hackernews'], builtin: true },
]

const CUSTOM = {
  id: 'qc-1', title: '我的指令', summary: '', prompt: '请检索最近 48 小时的 AI 动态并输出三条建议。',
  keywords: ['AI'], windowHours: 48, sources: ['hackernews'], builtin: false,
  createdAt: '2026-10-01T00:00:00.000Z', updatedAt: '2026-10-10T00:00:00.000Z',
}

const FORM = { title: '新的指令', prompt: '请检索最近 24 小时的 AI 动态，输出三条建议关注。', keywords: 'AI, LLM', windowHours: 24 }

describe('useQuickCollectCommands', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    quickCollectListPresets.mockResolvedValue({ code: 0, data: PRESETS })
    storeGetSettingResult.mockResolvedValue({ code: 0, data: JSON.stringify({ version: 1, commands: [CUSTOM] }) })
  })

  it('load：内置来自主进程，自定义来自 store，脏数据计数', async () => {
    storeGetSettingResult.mockResolvedValue({
      code: 0,
      data: JSON.stringify({ version: 1, commands: [CUSTOM, { id: 'qc-bad', title: '' }] }),
    })
    const c = useQuickCollectCommands()
    await c.load()
    expect(c.presets.value).toHaveLength(2)
    expect(c.customs.value.map((x) => x.id)).toEqual(['qc-1'])
    expect(c.skipped.value).toBe(1)
    expect(c.readFailed.value).toBe(false)
    expect(c.allCommands.value.map((x) => x.id)).toEqual(['builtin-ai-trends', 'builtin-hot-topics', 'qc-1'])
  })

  it('load：内置目录读失败 → presetsFailed；读自定义失败 → readFailed（不冒充"没有数据"）', async () => {
    quickCollectListPresets.mockResolvedValue({ code: -1, message: 'QC_IPC_UNAVAILABLE', data: [] })
    storeGetSettingResult.mockResolvedValue({ code: -1, message: 'store unavailable' })
    const c = useQuickCollectCommands()
    await c.load()
    expect(c.presetsFailed.value).toBe(true)
    expect(c.readFailed.value).toBe(true)
    expect(c.customs.value).toEqual([])
  })

  it('addCommand：入列 + 落盘（键与版本），校验不通过不入列', async () => {
    const c = useQuickCollectCommands()
    await c.load()
    const bad = await c.addCommand({ ...FORM, title: '' })
    expect(bad.ok).toBe(false)
    expect(storeSetSetting).not.toHaveBeenCalled()

    const good = await c.addCommand(FORM)
    expect(good.ok).toBe(true)
    expect(c.customs.value.map((x) => x.title)).toContain('新的指令')
    expect(storeSetSetting).toHaveBeenCalledTimes(1)
    const [key, raw] = storeSetSetting.mock.calls[0]
    expect(key).toBe(QUICK_COLLECT_COMMANDS_KEY)
    const parsed = JSON.parse(raw)
    expect(parsed.version).toBe(1)
    expect(parsed.commands.every((x) => x.builtin === false)).toBe(true)
    expect(parsed.commands.some((x) => x.id.startsWith('builtin-'))).toBe(false)
  })

  it('updateCommand：保留 id/createdAt、更新 updatedAt；未知 id 拒绝', async () => {
    const c = useQuickCollectCommands()
    await c.load()
    const res = await c.updateCommand('qc-1', { ...FORM, title: '改名后的指令' })
    expect(res.ok).toBe(true)
    const updated = c.customs.value.find((x) => x.id === 'qc-1')
    expect(updated.title).toBe('改名后的指令')
    expect(updated.createdAt).toBe(CUSTOM.createdAt)
    expect(updated.updatedAt).not.toBe(CUSTOM.updatedAt)
    expect((await c.updateCommand('nope', FORM)).code).toBe('QC_NOT_FOUND')
  })

  it('内置指令不可编辑/删除（服务层拒绝，不只是界面不渲染）', async () => {
    const c = useQuickCollectCommands()
    await c.load()
    const upd = await c.updateCommand('builtin-ai-trends', FORM)
    expect(upd).toEqual({ ok: false, code: 'QC_BUILTIN_READONLY' })
    const del = await c.removeCommand('builtin-ai-trends')
    expect(del).toEqual({ ok: false, code: 'QC_BUILTIN_READONLY' })
    expect(c.customs.value.some((x) => x.id === 'builtin-ai-trends')).toBe(false)
  })

  it('removeCommand：删除并落盘；未知 id 拒绝', async () => {
    const c = useQuickCollectCommands()
    await c.load()
    expect((await c.removeCommand('qc-1')).ok).toBe(true)
    expect(c.customs.value).toEqual([])
    expect(storeSetSetting).toHaveBeenCalledTimes(1)
    expect((await c.removeCommand('qc-1')).code).toBe('QC_NOT_FOUND')
  })

  it('allCommands 内置在前、自定义按更新时间倒序', async () => {
    const older = { ...CUSTOM, id: 'qc-old', title: '旧', updatedAt: '2026-09-01T00:00:00.000Z' }
    storeGetSettingResult.mockResolvedValue({ code: 0, data: JSON.stringify({ version: 1, commands: [older, CUSTOM] }) })
    const c = useQuickCollectCommands()
    await c.load()
    await flushPromises()
    expect(c.allCommands.value.map((x) => x.id)).toEqual(['builtin-ai-trends', 'builtin-hot-topics', 'qc-1', 'qc-old'])
  })
})
