/**
 * QuickCollectPanel — 面板行为
 *
 * 六条不可省：① 内置卡不渲染编辑/删除；② 执行成功 emit 结果条目（交给采集页统一落地）；
 * ③ 失败按领域码出文案且不 emit；④ 运行中其它执行/管理入口禁用；⑤ 新增/删除落到存储键；
 * ⑥ 无关键词的指令照常可执行（retrieval=skipped 的路径不阻塞）。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

vi.mock('@/api/publisher', () => ({
  storeGetSettingResult: vi.fn(async () => ({ code: 0, data: JSON.stringify({ version: 1, commands: [] }) })),
  storeSetSetting: vi.fn(async () => ({ code: 0 })),
}))
vi.mock('@/api/quick-collect', () => ({
  quickCollectListPresets: vi.fn(),
  quickCollectRun: vi.fn(),
  onQuickCollectProgress: vi.fn(() => () => {}),
}))
// 通知 spy 必须**跨调用稳定**：每次 useNotify() 都新建 vi.fn() 会让测试拿到与组件不同的对象，
// 断言恒 0 次调用（本仓 learnings 里"mock 对象身份跨用例稳定"的同族坑）。
const notifySpies = vi.hoisted(() => ({
  notify: vi.fn(),
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
  notifyWarning: vi.fn(),
  notifyInfo: vi.fn(),
  notifyConfirm: vi.fn(async () => true),
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => notifySpies,
}))

const { storeSetSetting } = await import('@/api/publisher')
const { quickCollectListPresets, quickCollectRun } = await import('@/api/quick-collect')
const QuickCollectPanel = (await import('./QuickCollectPanel.vue')).default

const messages = {
  zh: {
    collection: {
      quickCollectTab: '快捷采集',
      quickCollect: {
        title: '快捷采集',
        intro: '点一条指令即按固定提示词采集。',
        builtinSection: '官方内置',
        builtinBadge: '内置',
        customSection: '我的自定义',
        customHint: '自定义指令保存在本机。',
        run: '立即采集',
        running: '采集中…',
        stageRetrieving: '正在检索最近素材…',
        stageSummarizing: '正在生成摘要…',
        stageDone: '已完成',
        runSuccess: '快捷采集完成，已切换到采集结果（素材 {count} 条）',
        runSuccessNoMaterial: '快捷采集完成，但未检索到可用素材',
        viewPrompt: '查看指令',
        hidePrompt: '收起指令',
        keywordsLabel: '检索关键词：',
        noKeywords: '未配置关键词（不联网检索）',
        windowLabel: '素材时间范围：',
        window24: '最近 24 小时',
        window48: '最近 48 小时',
        window168: '最近 7 天',
        window0: '不限时间',
        add: '新增自定义指令',
        edit: '编辑',
        delete: '删除',
        emptyTitle: '还没有自定义指令',
        emptyDesc: '把常用的检索方向存成指令。',
        emptyAction: '新增指令',
        dialogAddTitle: '新增快捷采集指令',
        dialogEditTitle: '编辑快捷采集指令',
        dialogIntro: '标题用于区分指令。',
        titleLabel: '标题',
        titleHint: '起个名字',
        titlePlaceholder: '例如：AI 领域动向',
        titleCounter: '{count} / 40',
        promptLabel: '快捷采集内容（AI 指令）',
        promptHint: '写清要检索什么',
        promptPlaceholder: '例如：请检索…',
        promptCounter: '{count} / 4000',
        keywordsFieldLabel: '检索关键词（可选）',
        keywordsHint: '逗号分隔',
        keywordsPlaceholder: '例如：AI, 大模型',
        windowFieldLabel: '素材时间范围',
        sourcesLabel: '素材来源：Reddit · Hacker News · GitHub',
        save: '保存',
        cancel: '取消',
        saved: '指令已保存',
        deleted: '指令已删除',
        deleteConfirm: '删除快捷采集指令「{title}」？',
        confirmTitle: '确认',
        skippedWarning: '有 {count} 条自定义指令数据不完整，已忽略。',
        presetsFailed: '内置指令目录读取失败',
        readFailed: '自定义指令读取失败',
        errTitleRequired: '请填写标题',
        errTitleTooLong: '标题最多 40 字',
        errTitleDuplicate: '已存在同名指令',
        errPromptRequired: '请填写快捷采集内容',
        errPromptShort: '指令太短了',
        errPromptTooLong: '指令最多 4000 字',
        errKeywordsTooMany: '最多 5 个关键词',
        errKeywordTooLong: '单个关键词最多 30 字',
        errWindowInvalid: '请选择素材时间范围',
        errorLlmNotConfigured: '未配置默认大模型，无法执行快捷采集',
        errorLlmFailed: '大模型调用失败：{message}',
        errorLlmEmpty: '大模型返回空内容',
        errorValidation: '指令参数不合法：{message}',
        errorIpcUnavailable: '快捷采集服务不可用',
        errorUnknown: '快捷采集失败：{message}',
      },
    },
  },
  en: { collection: { quickCollect: {} } },
}

const PRESETS = [
  { id: 'builtin-ai-trends', icon: '🤖', title: 'AI 领域动向', summary: '过去 48 小时 AI 动态', prompt: '请检索过去48小时…', keywords: ['LLM release'], windowHours: 48, sources: ['hackernews'], builtin: true },
  { id: 'builtin-risk-alert', icon: '⚠️', title: '舆情风险与避雷', summary: '风险信号', prompt: '请检索风险事件…', keywords: [], windowHours: 168, sources: ['hackernews'], builtin: true },
]

const CUSTOM = {
  id: 'qc-1', title: '我的指令', summary: '', prompt: '请检索最近 24 小时的 AI 动态并输出三条建议。',
  keywords: ['AI'], windowHours: 24, sources: ['hackernews'], builtin: false,
  createdAt: '', updatedAt: '2026-10-10T00:00:00.000Z',
}

function makeI18n () {
  return createI18n({ legacy: false, locale: 'zh', messages })
}

async function mountPanel (customCommands = []) {
  const { storeGetSettingResult } = await import('@/api/publisher')
  storeGetSettingResult.mockResolvedValue({
    code: 0,
    data: JSON.stringify({ version: 1, commands: customCommands }),
  })
  const wrapper = mount(QuickCollectPanel, {
    global: {
      plugins: [makeI18n()],
      components: { EmptyState: { template: '<div data-testid="empty-state"><slot /></div>' } },
    },
  })
  await flushPromises()
  return wrapper
}

describe('QuickCollectPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    quickCollectListPresets.mockResolvedValue({ code: 0, data: PRESETS })
  })

  it('渲染内置卡；内置卡没有编辑/删除入口，但有执行入口', async () => {
    const w = await mountPanel()
    expect(w.find('[data-testid="quick-collect-card-builtin-ai-trends"]').exists()).toBe(true)
    expect(w.find('[data-testid="quick-collect-run-builtin-ai-trends"]').exists()).toBe(true)
    expect(w.find('[data-testid="quick-collect-edit-builtin-ai-trends"]').exists()).toBe(false)
    expect(w.find('[data-testid="quick-collect-delete-builtin-ai-trends"]').exists()).toBe(false)
    expect(w.find('[data-testid="quick-collect-empty"]').exists()).toBe(true)
  })

  it('执行成功：调用桥接、emit collected、提示素材条数', async () => {
    quickCollectRun.mockResolvedValue({
      code: 0,
      data: { id: 'qc-item-1', title: 'AI 领域动向 · 2026-10-11', content: '正文', quickCollect: { materialCount: 5 } },
    })
    const w = await mountPanel()
    const notify = notifySpies
    await w.find('[data-testid="quick-collect-run-builtin-ai-trends"]').trigger('click')
    await flushPromises()

    expect(quickCollectRun).toHaveBeenCalledTimes(1)
    const [command, requestId] = quickCollectRun.mock.calls[0]
    expect(command.id).toBe('builtin-ai-trends')
    expect(typeof requestId).toBe('string')
    expect(requestId.length).toBeGreaterThan(0)
    const emitted = w.emitted('collected')
    expect(emitted).toHaveLength(1)
    expect(emitted[0][0].id).toBe('qc-item-1')
    expect(notify.notifySuccess).toHaveBeenCalledWith('collection.quickCollect.runSuccess', { params: { count: '5' } })
  })

  it('未配置大模型（-101）：卡内出文案、不 emit、错误 toast', async () => {
    quickCollectRun.mockResolvedValue({ code: -101, message: 'QC_LLM_NOT_CONFIGURED' })
    const w = await mountPanel()
    const notify = notifySpies
    await w.find('[data-testid="quick-collect-run-builtin-ai-trends"]').trigger('click')
    await flushPromises()

    expect(w.emitted('collected')).toBeUndefined()
    const err = w.find('[data-testid="quick-collect-error"]')
    expect(err.exists()).toBe(true)
    expect(err.text()).toContain('未配置默认大模型')
    expect(notify.notifyError).toHaveBeenCalledWith('collection.quickCollect.errorLlmNotConfigured', { params: {} })
  })

  it('校验类失败（-2 + 领域码）复用表单文案', async () => {
    quickCollectRun.mockResolvedValue({ code: -2, message: 'QC_TITLE_TOO_LONG' })
    const w = await mountPanel()
    await w.find('[data-testid="quick-collect-run-builtin-ai-trends"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="quick-collect-error"]').text()).toContain('标题最多 40 字')
  })

  it('运行期间其它执行入口与管理入口禁用', async () => {
    let resolveRun
    quickCollectRun.mockImplementation(() => new Promise((resolve) => { resolveRun = resolve }))
    const w = await mountPanel([CUSTOM])
    await w.find('[data-testid="quick-collect-run-builtin-ai-trends"]').trigger('click')
    await flushPromises()

    expect(w.find('[data-testid="quick-collect-run-builtin-risk-alert"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="quick-collect-edit-qc-1"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="quick-collect-delete-qc-1"]').attributes('disabled')).toBeDefined()
    expect(w.find('[data-testid="quick-collect-add"]').attributes('disabled')).toBeDefined()

    resolveRun({ code: 0, data: { id: 'x', content: 'c', quickCollect: { materialCount: 0 } } })
    await flushPromises()
    expect(w.find('[data-testid="quick-collect-run-builtin-risk-alert"]').attributes('disabled')).toBeUndefined()
  })

  it('新增自定义指令：弹窗保存后入列并落盘', async () => {
    const w = await mountPanel()
    await w.find('[data-testid="quick-collect-add"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="quick-collect-dialog"]').exists()).toBe(true)

    await w.find('[data-testid="quick-collect-title-input"]').setValue('我的新指令')
    await w.find('[data-testid="quick-collect-prompt-input"]').setValue('请检索最近 24 小时的 AI 动态，输出三条建议关注。')
    await w.find('[data-testid="quick-collect-keywords-input"]').setValue('AI, LLM')
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    await flushPromises()

    expect(storeSetSetting).toHaveBeenCalledTimes(1)
    const [key, raw] = storeSetSetting.mock.calls[0]
    expect(key).toBe('quick_collect_commands')
    expect(JSON.parse(raw).commands.map((c) => c.title)).toEqual(['我的新指令'])
    expect(w.find('[data-testid="quick-collect-dialog"]').exists()).toBe(false)
  })

  it('弹窗校验失败时阻断保存（标题为空）', async () => {
    const w = await mountPanel()
    await w.find('[data-testid="quick-collect-add"]').trigger('click')
    await flushPromises()
    await w.find('[data-testid="quick-collect-prompt-input"]').setValue('请检索最近 24 小时的 AI 动态，输出三条建议关注。')
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    await flushPromises()

    expect(storeSetSetting).not.toHaveBeenCalled()
    expect(w.find('[data-testid="quick-collect-title-error"]').text()).toContain('请填写标题')
    expect(w.find('[data-testid="quick-collect-dialog"]').exists()).toBe(true)
  })

  it('删除自定义指令：确认后移除并落盘', async () => {
    const w = await mountPanel([CUSTOM])
    expect(w.find('[data-testid="quick-collect-card-qc-1"]').exists()).toBe(true)
    await w.find('[data-testid="quick-collect-delete-qc-1"]').trigger('click')
    await flushPromises()
    expect(w.find('[data-testid="quick-collect-card-qc-1"]').exists()).toBe(false)
    expect(JSON.parse(storeSetSetting.mock.calls[0][1]).commands).toEqual([])
  })

  it('无关键词的指令照常可执行（skipped 路径不阻塞）', async () => {
    quickCollectRun.mockResolvedValue({ code: 0, data: { id: 'y', content: 'c', quickCollect: { materialCount: 0, retrieval: 'skipped' } } })
    const w = await mountPanel()
    const notify = notifySpies
    await w.find('[data-testid="quick-collect-run-builtin-risk-alert"]').trigger('click')
    await flushPromises()
    expect(w.emitted('collected')).toHaveLength(1)
    expect(notify.notifyInfo).toHaveBeenCalledWith('collection.quickCollect.runSuccessNoMaterial')
  })

  it('内置目录读取失败时出提示条', async () => {
    quickCollectListPresets.mockResolvedValue({ code: -1, message: 'QC_IPC_UNAVAILABLE', data: [] })
    const w = await mountPanel()
    expect(w.find('[data-testid="quick-collect-presets-error"]').exists()).toBe(true)
  })
})
