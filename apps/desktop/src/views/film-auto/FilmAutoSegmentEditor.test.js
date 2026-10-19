// @vitest-environment jsdom
/**
 * FilmAutoSegmentEditor 契约测试（openspec change: film-auto-mode，design D15/D16/任务 5.4）
 *
 * 锁定：草稿与真值分离、脏标记、必填/长度校验（失败不提交）、保存只提交变化字段、
 * 重生成走独立事件、块结构缺失只黄提示不阻断、成品预览 URL 按平台正确拼装。
 */
import { describe, it, expect, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

vi.mock('vue-i18n', () => ({
  useI18n: () => ({ t: (k, p) => (p ? k + ':' + JSON.stringify(p) : k) }),
}))

import FilmAutoSegmentEditor from './FilmAutoSegmentEditor.vue'

// 2026-10-19：块标题由 5 项补齐为 7 项（补 SCENE CONTEXT 与 STYLE）；夹具随之补齐，
// 否则「完整提示词」会被判缺块、黄提示恒出现。
const FULL_PROMPT = [
  'EXT. STREET',
  '[CHARACTER: ROKO] walks.',
  '',
  'SCENE CONTEXT',
  'EXACT 3 CHARACTERS',
  '',
  'GEO SPATIAL LAYOUT',
  'alley left',
  '',
  'ACTION TIMING',
  '0-2s',
  '',
  'AUDIO',
  'rain',
  '',
  'CHARACTER ACTING',
  'tense',
  '',
  'STYLE',
  'Photoreal. NON-IP.',
  '',
  'POSITIVE CONSTRAINTS',
  '8K',
].join('\n')

function makeShot (overrides = {}) {
  return {
    index: 0,
    shotId: 'auto-000',
    prompt: 'PROMPT-0',
    seconds: 5,
    status: 'done',
    outputPath: 'C:\\tmp\\film-engineering\\auto\\auto-1\\b0\\shot_000.mp4',
    error: null,
    ...overrides,
  }
}

function mountEditor (shot, props = {}) {
  return mount(FilmAutoSegmentEditor, {
    props: { shot, shotIndex: shot ? shot.index : 0, ...props },
    global: {
      stubs: { ElInput: true, ElButton: true, ElSelect: true, ElOption: true },
    },
  })
}

describe('FilmAutoSegmentEditor · 草稿与校验', () => {
  it('草稿初值取自片段真值；未改动时不是脏的', () => {
    const w = mountEditor(makeShot())
    expect(w.vm.draftPrompt).toBe('PROMPT-0')
    expect(w.vm.draftSeconds).toBe(5)
    expect(w.vm.changed).toBe(false)
    w.unmount()
  })

  it('改动提示词/时长后变脏；「恢复原文」回到真值', async () => {
    const w = mountEditor(makeShot())
    w.vm.draftPrompt = 'NEW'
    await nextTick()
    expect(w.vm.changed).toBe(true)
    w.vm.draftSeconds = 8
    await nextTick()
    expect(w.vm.changed).toBe(true)
    w.vm.draftPrompt = 'PROMPT-0'
    await nextTick()
    expect(w.vm.changed).toBe(true) // 仅时长不同仍为脏
    w.vm.restoreOriginal()
    w.vm.draftSeconds = 5
    await nextTick()
    expect(w.vm.changed).toBe(false)
    w.unmount()
  })

  it('空提示词 → 报错且不提交保存', async () => {
    const w = mountEditor(makeShot())
    w.vm.draftPrompt = '   '
    await nextTick()
    await w.vm.save()
    expect(w.emitted('save')).toBeUndefined()
    expect(w.vm.$el.querySelector('[data-testid="fa-segment-error"]')).toBeTruthy()
    w.unmount()
  })

  it('超长提示词 → 报错且不提交保存', async () => {
    const w = mountEditor(makeShot())
    w.vm.draftPrompt = 'x'.repeat(50001)
    await nextTick()
    await w.vm.save()
    expect(w.emitted('save')).toBeUndefined()
    expect(w.vm.promptTooLong).toBe(true)
    w.unmount()
  })

  it('保存只提交变化的字段（提示词必带、时长按需）', async () => {
    const w = mountEditor(makeShot())
    w.vm.draftPrompt = 'NEW'
    await nextTick()
    await w.vm.save()
    const first = w.emitted('save')[0][0]
    expect(first.shotIndex).toBe(0)
    expect(first.patch).toEqual({ prompt: 'NEW' })

    const w2 = mountEditor(makeShot())
    w2.vm.draftSeconds = 10
    await nextTick()
    await w2.vm.save()
    expect(w2.emitted('save')[0][0].patch).toEqual({ prompt: 'PROMPT-0', seconds: 10 })
    w.unmount()
    w2.unmount()
  })

  it('重新生成为独立事件（不由保存顺带触发）', async () => {
    const w = mountEditor(makeShot())
    await w.vm.regenerate()
    expect(w.emitted('regenerate')[0]).toEqual([0])
    expect(w.emitted('save')).toBeUndefined()
    w.unmount()
  })
})

describe('FilmAutoSegmentEditor · 块结构与预览', () => {
  it('缺块时给出黄提示（列出缺失块）但不阻断保存', async () => {
    const w = mountEditor(makeShot({ prompt: 'EXT. X\n[CHARACTER: ROKO] walks.' }))
    await nextTick()
    expect(w.vm.blockCheck.ok).toBe(false)
    const hint = w.find('[data-testid="fa-segment-block-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('GEO SPATIAL LAYOUT')
    w.vm.draftPrompt = FULL_PROMPT
    await nextTick()
    expect(w.vm.blockCheck.ok).toBe(true)
    expect(w.find('[data-testid="fa-segment-block-hint"]').exists()).toBe(false)
    w.unmount()
  })

  it('成品预览 URL 按平台拼装；无产物时不渲染 video', async () => {
    const w = mountEditor(makeShot())
    expect(w.vm.fileUrl).toBe('file:///C:/tmp/film-engineering/auto/auto-1/b0/shot_000.mp4')
    expect(w.find('[data-testid="fa-segment-video"]').exists()).toBe(true)
    w.unmount()

    const w2 = mountEditor(makeShot({ outputPath: null, status: 'pending' }))
    expect(w2.vm.fileUrl).toBe('')
    expect(w2.find('[data-testid="fa-segment-video"]').exists()).toBe(false)
    expect(w2.find('[data-testid="fa-segment-nopreview"]').exists()).toBe(true)
    w2.unmount()
  })

  it('片段为 null 时不崩（面板未选中场景）', () => {
    const w = mountEditor(null)
    expect(w.vm.draftPrompt).toBe('')
    expect(w.vm.fileUrl).toBe('')
    w.unmount()
  })
})
