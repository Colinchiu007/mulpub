/**
 * QuickCollectCommandDialog — 表单校验 / 预填 / 计数器
 *
 * 表单是"用户唯一能写错的地方"，逐条钉死：空标题、40/41 字边界、短指令、
 * 关键词数量与长度、重名（编辑自己不算重名）、编辑态预填、提交时才全量报错。
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'
import QuickCollectCommandDialog from './QuickCollectCommandDialog.vue'

const messages = {
  zh: {
    collection: {
      quickCollect: {
        dialogAddTitle: '新增快捷采集指令',
        dialogEditTitle: '编辑快捷采集指令',
        dialogIntro: '标题用于区分指令，内容就是发给大模型的提示词。',
        titleLabel: '标题',
        titleHint: '给这条指令起个一眼能认出的名字（1–40 字）',
        titlePlaceholder: '例如：AI 领域动向',
        titleCounter: '{count} / 40',
        promptLabel: '快捷采集内容（AI 指令）',
        promptHint: '建议写清：要检索什么、输出什么格式',
        promptPlaceholder: '例如：请检索过去 24 小时内值得关注的 AI 开源项目…',
        promptCounter: '{count} / 4000',
        keywordsFieldLabel: '检索关键词（可选）',
        keywordsHint: '逗号分隔，最多 5 个',
        keywordsPlaceholder: '例如：AI, 大模型, 开源项目',
        windowFieldLabel: '素材时间范围',
        sourcesLabel: '素材来源：Reddit · Hacker News · GitHub',
        window24: '最近 24 小时',
        window48: '最近 48 小时',
        window168: '最近 7 天',
        window0: '不限时间',
        save: '保存',
        cancel: '取消',
        errTitleRequired: '请填写标题',
        errTitleTooLong: '标题最多 40 字',
        errTitleDuplicate: '已存在同名指令，请换一个标题',
        errPromptRequired: '请填写快捷采集内容',
        errPromptShort: '指令太短了，至少 10 字，否则大模型无法执行',
        errPromptTooLong: '指令最多 4000 字',
        errKeywordsTooMany: '最多 5 个关键词',
        errKeywordTooLong: '单个关键词最多 30 字',
        errWindowInvalid: '请选择素材时间范围',
      },
    },
  },
  en: { collection: { quickCollect: {} } },
}

const EXISTING = [
  { id: 'qc-a', title: 'AI 领域动向', builtin: false },
  { id: 'qc-b', title: '别人家的指令', builtin: false },
]

const VALID_PROMPT = '请检索最近 24 小时的 AI 动态，输出三条建议关注。'

function mountDialog (props = {}) {
  return mount(QuickCollectCommandDialog, {
    props: { visible: true, command: null, existing: EXISTING, ...props },
    global: { plugins: [createI18n({ legacy: false, locale: 'zh', messages })] },
  })
}

describe('QuickCollectCommandDialog', () => {
  beforeEach(() => { /* 无共享状态 */ })

  it('新增态用新增标题；提交空表单时逐字段报错且不 emit save', async () => {
    const w = mountDialog()
    expect(w.find('[data-testid="quick-collect-dialog-title"]').text()).toBe('新增快捷采集指令')
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    expect(w.emitted('save')).toBeUndefined()
    expect(w.find('[data-testid="quick-collect-title-error"]').text()).toBe('请填写标题')
    expect(w.find('[data-testid="quick-collect-prompt-error"]').text()).toBe('请填写快捷采集内容')
  })

  it('标题 41 字 → 超长错误；40 字 → 通过', async () => {
    const w = mountDialog()
    await w.find('[data-testid="quick-collect-title-input"]').setValue('x'.repeat(41))
    await w.find('[data-testid="quick-collect-prompt-input"]').setValue(VALID_PROMPT)
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    expect(w.find('[data-testid="quick-collect-title-error"]').text()).toBe('标题最多 40 字')
    expect(w.emitted('save')).toBeUndefined()

    await w.find('[data-testid="quick-collect-title-input"]').setValue('x'.repeat(40))
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    expect(w.emitted('save')).toHaveLength(1)
    expect(w.emitted('save')[0][0].title).toBe('x'.repeat(40))
  })

  it('指令 9 字 → 过短；关键词 6 个 → 过多；关键词 31 字 → 过长', async () => {
    const w = mountDialog()
    await w.find('[data-testid="quick-collect-title-input"]').setValue('新指令')
    await w.find('[data-testid="quick-collect-prompt-input"]').setValue('一二三四五六七八九')
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    expect(w.find('[data-testid="quick-collect-prompt-error"]').text()).toContain('至少 10 字')

    await w.find('[data-testid="quick-collect-prompt-input"]').setValue(VALID_PROMPT)
    await w.find('[data-testid="quick-collect-keywords-input"]').setValue('a,b,c,d,e,f')
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    expect(w.find('[data-testid="quick-collect-keywords-error"]').text()).toBe('最多 5 个关键词')

    await w.find('[data-testid="quick-collect-keywords-input"]').setValue('k'.repeat(31))
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    expect(w.find('[data-testid="quick-collect-keywords-error"]').text()).toBe('单个关键词最多 30 字')
    expect(w.emitted('save')).toBeUndefined()
  })

  it('重名标题被拒（大小写/空白不敏感）；编辑自己不算重名', async () => {
    const w = mountDialog()
    await w.find('[data-testid="quick-collect-title-input"]').setValue('  ai 领域动向 ')
    await w.find('[data-testid="quick-collect-prompt-input"]').setValue(VALID_PROMPT)
    await w.find('[data-testid="quick-collect-save"]').trigger('click')
    expect(w.find('[data-testid="quick-collect-title-error"]').text()).toContain('已存在同名指令')
    expect(w.emitted('save')).toBeUndefined()

    const edit = mountDialog({ command: { id: 'qc-a', title: 'AI 领域动向', prompt: VALID_PROMPT, keywords: [], windowHours: 48 } })
    expect(edit.find('[data-testid="quick-collect-dialog-title"]').text()).toBe('编辑快捷采集指令')
    await edit.find('[data-testid="quick-collect-save"]').trigger('click')
    expect(edit.emitted('save')).toHaveLength(1)
  })

  it('编辑态预填字段（关键词数组 → 逗号文本）', async () => {
    const w = mountDialog({
      command: { id: 'qc-a', title: '旧标题', prompt: '旧指令内容至少十个字。', keywords: ['AI', 'LLM'], windowHours: 168 },
    })
    expect(w.find('[data-testid="quick-collect-title-input"]').element.value).toBe('旧标题')
    expect(w.find('[data-testid="quick-collect-prompt-input"]').element.value).toBe('旧指令内容至少十个字。')
    expect(w.find('[data-testid="quick-collect-keywords-input"]').element.value).toBe('AI, LLM')
    expect(w.find('[data-testid="quick-collect-window-select"]').element.value).toBe('168')
  })

  it('计数器与占位示例文案来自 locale', async () => {
    const w = mountDialog()
    expect(w.find('[data-testid="quick-collect-title-input"]').attributes('placeholder')).toBe('例如：AI 领域动向')
    expect(w.find('[data-testid="quick-collect-prompt-input"]').attributes('placeholder')).toContain('例如：请检索过去 24 小时内值得关注的 AI 开源项目')
    expect(w.find('[data-testid="quick-collect-keywords-input"]').attributes('placeholder')).toBe('例如：AI, 大模型, 开源项目')
    expect(w.text()).toContain('0 / 40')
    await w.find('[data-testid="quick-collect-title-input"]').setValue('abcd')
    expect(w.text()).toContain('4 / 40')
  })

  it('blur 只报当前字段（不因未触碰的字段标红）', async () => {
    const w = mountDialog()
    await w.find('[data-testid="quick-collect-title-input"]').setValue('新指令')
    await w.find('[data-testid="quick-collect-title-input"]').trigger('blur')
    expect(w.find('[data-testid="quick-collect-title-error"]').exists()).toBe(false)
    expect(w.find('[data-testid="quick-collect-prompt-error"]').exists()).toBe(false)
  })

  it('取消关闭弹窗（emit update:visible=false），不提交', async () => {
    const w = mountDialog()
    await w.find('[data-testid="quick-collect-cancel"]').trigger('click')
    expect(w.emitted('update:visible')[0]).toEqual([false])
    expect(w.emitted('save')).toBeUndefined()
  })

  it('可见为 false 时不渲染任何内容', () => {
    const w = mountDialog({ visible: false })
    expect(w.find('[data-testid="quick-collect-dialog"]').exists()).toBe(false)
  })
})
