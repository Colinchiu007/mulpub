import { describe, expect, it } from 'vitest'
import { mount } from '@vue/test-utils'
import CreateViewHistory from './CreateViewHistory.vue'
import zh from '@/locales/zh'

// 复刻 i18n/index.js toMessageFunctions + vue-i18n 函数消息调用语义：
// 无参返回 key（沿用既有断言约定）；带参且目标为函数消息时用 params 构造 named()
// 上下文执行，使真实插值契约进入断言（字符串消息不再隐式插值，与生产行为一致）。
function resolveLocaleMessage (key) {
  return key.split('.').reduce((node, part) => (node == null ? undefined : node[part]), zh)
}

// 既有断言约定：无参返回 key（供「$t 取不到文案时回退 key」的用例）。
const interpolatingT = (key, params) => {
  if (!params) return key
  const message = resolveLocaleMessage(key)
  if (typeof message === 'function') return message({ named: name => (params[name] ?? '') })
  // 字符串消息：与 vue-i18n 生产语义一致——按 {name} 占位符插值；
  // 占位符不在 params 中时保留原样（便于断言「未解析占位符」这类缺陷）。
  if (typeof message === 'string') {
    return message.replace(/\{(\w+)\}/g, (whole, name) => (params[name] !== undefined ? String(params[name]) : whole))
  }
  return key
}

// formatError 走「先取模板再自行插值」路径（$t(key) 无参 → 模板原文）。
// 该路径需要 mock 在无参时也返回字符串原文，与生产 vue-i18n 一致。
const templateAwareT = (key, params) => {
  const message = resolveLocaleMessage(key)
  if (typeof message === 'string') {
    if (!params) return message
    return message.replace(/\{(\w+)\}/g, (whole, name) => (params[name] !== undefined ? String(params[name]) : whole))
  }
  if (typeof message === 'function' && params) return message({ named: name => (params[name] ?? '') })
  return key
}

const mountHistory = (history, props = {}, t = interpolatingT) => mount(CreateViewHistory, {
  props: { history, ...props },
  global: {
    mocks: { $t: t },
  },
})

describe('CreateViewHistory', () => {
  it('renders accessible status tabs with all selected by default', () => {
    const wrapper = mountHistory([])
    const tablist = wrapper.find('[role="tablist"]')
    expect(tablist.exists()).toBe(true)
    const tabs = wrapper.findAll('[role="tab"]')
    // 6 个状态标签：paused 与 interrupted 聚合为「可恢复」tab，卡片内仍区分
    expect(tabs).toHaveLength(6)
    expect(tabs.map(tab => tab.attributes('data-status'))).toEqual(['all', 'running', 'recoverable', 'failed', 'completed', 'cancelled'])
    expect(tabs[0].attributes('aria-selected')).toBe('true')
    expect(tabs[0].attributes('tabindex')).toBe('0')
    expect(wrapper.find('[data-testid="history-sort-select"]').exists()).toBe(true)
  })

  it('supports Arrow/Home/End keyboard tab selection', async () => {
    const wrapper = mountHistory([{ id: 'running', status: 'running' }])
    const tablist = wrapper.find('[role="tablist"]')
    await tablist.trigger('keydown', { key: 'ArrowRight' })
    expect(wrapper.emitted('update:historyFilter')?.at(-1)).toEqual(['running'])
    await tablist.trigger('keydown', { key: 'End' })
    expect(wrapper.emitted('update:historyFilter')?.at(-1)).toEqual(['cancelled'])
    await tablist.trigger('keydown', { key: 'Home' })
    expect(wrapper.emitted('update:historyFilter')?.at(-1)).toEqual(['all'])
  })

  it('recoverable 聚合 paused 且与 failed 分离，并按有效时间排序', async () => {
    const wrapper = mountHistory([
      { id: 'failed', status: 'failed', updatedAt: '2026-08-15T12:00:00Z', pausedStage: 'compose', error: 'boom' },
      { id: 'paused', status: 'paused', updatedAt: '2026-08-15T11:00:00Z', pausedStage: 'compose' },
    ])
    await wrapper.find('[role="tab"][data-status="recoverable"]').trigger('click')
    expect(wrapper.findAll('.history-item')).toHaveLength(1)
    expect(wrapper.find('.history-item').attributes('data-history-id')).toBe('paused')
    await wrapper.find('[role="tab"][data-status="failed"]').trigger('click')
    expect(wrapper.findAll('.history-item')).toHaveLength(1)
    expect(wrapper.text()).toContain('boom')
    expect(wrapper.text()).toContain('history.failedStage')
  })

  it('keeps the same card contract in every status tab, including title fallback, thumbnail slot and video duration', async () => {
    const statuses = ['running', 'recoverable', 'failed', 'completed', 'cancelled']
    const wrapper = mountHistory(statuses.map((status, index) => ({
      id: 'task-' + status,
      projectId: 'project-' + status,
      status: status === 'recoverable' ? 'paused' : status,
      sourceText: '任务文案 ' + status,
      videoDuration: 61,
      duration: 900000,
      updatedAt: '2026-08-15T' + String(12 - index).padStart(2, '0') + ':00:00Z',
    })))

    for (const status of statuses) {
      await wrapper.find('[role="tab"][data-status="' + status + '"]').trigger('click')
      const card = wrapper.find('[data-history-id="task-' + status + '"]')
      expect(card.find('.history-name').text()).toContain('任务文案 ' + status)
      expect(card.find('[data-testid="history-thumbnail"]').exists()).toBe(true)
      expect(card.text()).toContain('create.history.notGenerated')
      expect(card.text()).toContain('create.history.contentPreview')
      expect(card.text()).toContain('任务文案 ' + status)
      expect(card.text()).toContain('create.history.videoDuration')
      expect(card.text()).not.toContain('undefined')
      expect(card.text()).not.toContain('null')
    }
  })

  it('thumbnail 加载失败时回退到稳定的未生成占位', async () => {
    const item = { id: 'thumbnail-error', projectId: 'project-thumbnail-error', status: 'completed', thumbnailUrl: 'media://stale' }
    const wrapper = mountHistory([item])
    const image = wrapper.find('[data-testid="history-thumbnail"] img')
    expect(image.exists()).toBe(true)

    await image.trigger('error')

    expect(item.thumbnailUrl).toBeNull()
    expect(item.thumbnailStatus).toBe('failed')
    expect(wrapper.find('[data-testid="history-thumbnail"] img').exists()).toBe(false)
    expect(wrapper.find('[data-testid="history-thumbnail"]').text()).toContain('create.history.notGenerated')
  })

  it('uses explicit media duration and never renders pipeline execution duration as video duration', () => {
    const wrapper = mountHistory([
      { id: 'video-duration', status: 'completed', duration: 900000, video: { duration: 65 } },
      { id: 'missing-video-duration', status: 'completed', duration: 900000 },
      { id: 'invalid-video-duration', status: 'completed', videoDuration: 'NaN', duration: 900000 },
    ])
    expect(wrapper.vm.videoDuration(wrapper.props('history')[0])).toBe(65)
    expect(wrapper.vm.videoDuration(wrapper.props('history')[1])).toBeNull()
    expect(wrapper.vm.videoDuration(wrapper.props('history')[2])).toBeNull()
    expect(wrapper.find('[data-history-id="video-duration"]').text()).toContain('1 create.history.minutes 5 create.history.seconds')
    expect(wrapper.find('[data-history-id="missing-video-duration"]').text()).toContain('create.history.notGenerated')
  })

  it('仅非 running 且有真实项目（historyType=story2video-project）的卡片点击进入编辑页，running 不可进入而 cancelled 可编辑', async () => {
    const wrapper = mountHistory([
      { id: 'running', historyType: 'story2video-project', projectId: 'proj-r', status: 'running', updatedAt: '2026-08-15T12:00:00Z' },
      { id: 'cancelled', historyType: 'story2video-project', projectId: 'proj-c', status: 'cancelled', updatedAt: '2026-08-15T11:00:00Z' },
    ])
    const bodies = wrapper.findAll('.history-item-body')
    expect(bodies[0].attributes('role')).toBeUndefined()
    expect(bodies[0].attributes('tabindex')).toBeUndefined()
    expect(wrapper.find('[data-history-id="running"]').classes()).not.toContain('is-interactive')
    await bodies[0].trigger('click')
    expect(wrapper.emitted('open-result')).toBeUndefined()
    expect(wrapper.emitted('resume-history')).toBeUndefined()
    expect(bodies[1].attributes('role')).toBe('button')
    expect(bodies[1].attributes('tabindex')).toBe('0')
    expect(wrapper.find('[data-history-id="cancelled"]').classes()).toContain('is-interactive')
    await bodies[1].trigger('click')
    expect(wrapper.emitted('open-result')?.[0]).toEqual([{ id: 'cancelled', historyType: 'story2video-project', projectId: 'proj-c', status: 'cancelled', updatedAt: '2026-08-15T11:00:00Z' }])
  })

  it('run-only 记录（historyType=pipeline-run）即使带 projectId 也不可编辑，避免结果页加载失败', async () => {
    // 复现 run_1787423794598_86az：cancelled 的 run-only 记录 projectId 被主进程回退为 runId，
    // 项目实际不存在，点击编辑会进入结果页加载失败。必须用 historyType 区分真实项目。
    const wrapper = mountHistory([
      { id: 'run-only-cancelled', historyType: 'pipeline-run', projectId: 'run-only-cancelled', status: 'cancelled', updatedAt: '2026-08-15T11:00:00Z' },
      { id: 'run-only-failed', historyType: 'pipeline-run', projectId: 'run-only-failed', status: 'failed', updatedAt: '2026-08-15T10:00:00Z' },
    ])
    const bodies = wrapper.findAll('.history-item-body')
    for (const body of bodies) {
      expect(body.attributes('role')).toBeUndefined()
      expect(body.attributes('tabindex')).toBeUndefined()
      await body.trigger('click')
    }
    expect(wrapper.emitted('open-result')).toBeUndefined()
    expect(wrapper.emitted('resume-history')).toBeUndefined()
    // 编辑按钮也不显示
    expect(wrapper.find('[data-testid="history-edit-recompose-button"]').exists()).toBe(false)
    expect(wrapper.find('[data-testid="history-policy-edit-button"]').exists()).toBe(false)
  })

  it('recoverable 聚合 tab 同时展示已暂停与已中断，卡片内仍用不同图标/提示区分', async () => {
    const wrapper = mountHistory([
      { id: 'interrupted-1', status: 'interrupted', pausedStage: 'generate_assets', updatedAt: '2026-08-15T12:00:00Z' },
      { id: 'manual-paused', status: 'paused', pausedStage: 'compose', updatedAt: '2026-08-15T11:00:00Z' },
    ])
    const interrupted = wrapper.find('[data-history-id="interrupted-1"]')
    expect(interrupted.classes()).toContain('status-interrupted')
    expect(interrupted.text()).toContain('create.history.interruptedStage')
    expect(interrupted.text()).toContain('create.history.interruptedHint')
    // 中断任务可断点继续（快照仍为 running，恢复链不变）
    expect(interrupted.find('.s2v-btn-resume').exists()).toBe(true)

    // 「可恢复」聚合 tab 同时覆盖 paused 与 interrupted，按有效时间倒序
    await wrapper.find('[role="tab"][data-status="recoverable"]').trigger('click')
    const ids = wrapper.findAll('.history-item').map(item => item.attributes('data-history-id'))
    expect(ids).toEqual(['interrupted-1', 'manual-paused'])
    // 卡片内仍以底层状态区分：已暂停卡片显示暂停环节，无中断提示
    const paused = wrapper.find('[data-history-id="manual-paused"]')
    expect(paused.classes()).toContain('status-paused')
    expect(paused.text()).toContain('create.history.pausedStage')
  })

  it('无项目匹配的 run 卡片用 params 回退标题与文案预览，不再显示流水线名词与「未生成」', () => {
    const wrapper = mountHistory([
      {
        id: 'run-only-1',
        pipeline: 'story2video-compose',
        status: 'failed',
        error: 'provider timeout',
        params: { text: '这是任务的原始文案内容', title: '发布标题甲' },
      },
      {
        id: 'run-only-2',
        pipeline: 'story2video-compose',
        status: 'interrupted',
        params: { text: '仅有文案没有标题' },
      },
    ])
    const first = wrapper.find('[data-history-id="run-only-1"]')
    expect(first.find('.history-name').text()).toContain('发布标题甲')
    expect(first.find('.prompt-preview-text').text()).toContain('这是任务的原始文案内容')
    expect(first.find('.prompt-preview-text').text()).not.toContain('create.history.notGenerated')

    const second = wrapper.find('[data-history-id="run-only-2"]')
    // 无 params.title 时标题回退到 params.text 前 60 字，而不是流水线名称
    expect(second.find('.history-name').text()).toContain('仅有文案没有标题')
    expect(second.find('.history-name').text()).not.toContain('create.pipelines.story2video-compose')
    expect(second.find('.prompt-preview-text').text()).toContain('仅有文案没有标题')
  })

  it('shows localized paused checkpoint and both failed stage and error details', () => {
    const wrapper = mountHistory([
      { id: 'paused', status: 'paused', pausedStage: 'compose', checkpoint: { type: 'scene_asset_selection' } },
      { id: 'failed', status: 'failed', pausedStage: 'optimize', error: 'provider unavailable' },
    ])
    const paused = wrapper.find('[data-history-id="paused"]')
    expect(paused.text()).toContain('create.history.pausedStage')
    expect(paused.text()).toContain('create.history.environments.sceneAssetSelection')
    const failed = wrapper.find('[data-history-id="failed"]')
    expect(failed.text()).toContain('create.history.failedStage')
    expect(failed.text()).toContain('create.history.errorSummary')
    expect(failed.text()).toContain('provider unavailable')
  })

  it('re-sorts visible cards when an updated history prop arrives', async () => {
    const wrapper = mountHistory([
      { id: 'a', status: 'running', updatedAt: '2026-08-15T10:00:00Z' },
      { id: 'b', status: 'running', updatedAt: '2026-08-15T11:00:00Z' },
    ])
    expect(wrapper.findAll('.history-item').map(card => card.attributes('data-history-id'))).toEqual(['b', 'a'])
    await wrapper.setProps({ history: [
      { id: 'a', status: 'running', updatedAt: '2026-08-15T12:00:00Z' },
      { id: 'b', status: 'running', updatedAt: '2026-08-15T11:00:00Z' },
    ] })
    expect(wrapper.findAll('.history-item').map(card => card.attributes('data-history-id'))).toEqual(['a', 'b'])
  })

  it('显式操作按钮（继续/删除）不触发进入编辑页', async () => {
    const wrapper = mountHistory([
      { id: 'failed-1', projectId: 'proj-1', status: 'failed', pausedStage: 'compose', error: 'boom' },
    ])
    await wrapper.find('.s2v-btn-resume').trigger('click')
    expect(wrapper.emitted('resume-history')).toHaveLength(1)
    expect(wrapper.emitted('open-result')).toBeUndefined()
    await wrapper.find('[data-testid="history-delete-button"]').trigger('click')
    expect(wrapper.emitted('delete-history')).toHaveLength(1)
    expect(wrapper.emitted('open-result')).toBeUndefined()
  })

  it('已取消卡片允许删除，也可以进入编辑页但不会自动恢复', async () => {
    const wrapper = mountHistory([{ id: 'cancelled-1', historyType: 'story2video-project', projectId: 'proj-c', status: 'cancelled' }])
    const body = wrapper.find('.history-item-body')
    expect(body.attributes('role')).toBe('button')
    await body.trigger('click')
    expect(wrapper.emitted('open-result')).toHaveLength(1)
    expect(wrapper.find('.s2v-btn-danger').exists()).toBe(true)
    await wrapper.find('[data-testid="history-delete-button"]').trigger('click')
    expect(wrapper.emitted('delete-history')).toHaveLength(1)
    expect(wrapper.emitted('open-result')).toHaveLength(1)
  })

  it('卡片统一展示通用信息（标题/时间/耗时/ID/流水线）与状态附加信息（失败环节/失败原因）', () => {
    const wrapper = mountHistory([
      {
        id: 'failed-1', projectId: 'proj-1', pipeline: 'story2video-compose', status: 'failed',
        title: '失败任务', updatedAt: '2026-08-15T12:00:00Z', createdAt: '2026-08-15T10:00:00Z',
        duration: 125000, mode: 'auto', pausedStage: 'optimize', error: 'provider timeout with a very long message',
        segments: [{ text: '提示词 A', promptTranslation: 'Prompt A' }],
        stages: [{ name: 'optimize', status: 'failed' }],
      },
    ])
    const card = wrapper.find('[data-history-id="failed-1"]')
    expect(card.text()).toContain('失败任务')
    expect(card.text()).toContain('create.history.updatedAt')
    expect(card.text()).toContain('create.history.createdAt')
    expect(card.text()).toContain('create.history.duration')
    expect(card.text()).toContain('create.history.videoDuration')
    expect(card.text()).toContain('create.history.projectId')
    expect(card.text()).toContain('create.history.contentPreview')
    expect(card.text()).toContain('提示词 A')
    expect(card.text()).toContain('Prompt A')
    expect(card.text()).toContain('create.history.failedStage')
    // 失败原因使用多语言自然语言（formatPipelineError：短文本透传原文）
    expect(card.find('[data-testid="history-failure-reason"]').text()).toContain('provider timeout with a very long message')
    expect(card.find('[data-testid="history-failure-reason"]').text()).not.toContain('…')
  })

  it('compose 预检失败带稳定 errorCode → 卡片渲染自然语言上限提示，不显示英文原文（2026-10-20 事故回归）', () => {
    const wrapper = mountHistory([
      {
        id: 'failed-size', projectId: 'proj-size', pipeline: 'story2video-compose', status: 'failed',
        title: '超限任务', updatedAt: '2026-08-15T12:00:00Z', createdAt: '2026-08-15T10:00:00Z',
        pausedStage: 'compose', error: 'Input media exceeds the total size limit',
        errorCode: 'COMPOSE_INPUT_SIZE_EXCEEDED',
        errorParams: { limitMb: '512MB', actualMb: '780MB' },
        stages: [{ name: 'compose', status: 'failed' }],
      },
    ], {}, templateAwareT)
    const reason = wrapper.find('[data-testid="history-failure-reason"]').text()
    expect(reason).not.toContain('Input media exceeds the total size limit')
    expect(reason).toContain('512MB')
    expect(reason).toContain('780MB')
    expect(reason).not.toContain('story2video.compose_input_size_exceeded')
  })

  it('存量数据只有英文原文（无 errorCode、无体积数字）→ 归一化为自然语言，且无占位符残留', () => {
    const wrapper = mountHistory([
      {
        id: 'failed-legacy', projectId: 'proj-legacy', pipeline: 'story2video-compose', status: 'failed',
        title: '存量任务', updatedAt: '2026-08-15T12:00:00Z', createdAt: '2026-08-15T10:00:00Z',
        pausedStage: 'compose', error: 'Input media exceeds the total size limit',
        stages: [{ name: 'compose', status: 'failed' }],
      },
    ], {}, templateAwareT)
    const reason = wrapper.find('[data-testid="history-failure-reason"]').text()
    expect(reason).not.toContain('Input media exceeds the total size limit')
    expect(reason).not.toContain('story2video.compose_input_size_exceeded')
    // ⛔ CCG 外部评审 i2（2026-10-20）：原文本身不带体积数字 ⇒ params 里没有 actualMb/limitMb。
    // 若不做兜底，用户会看到字面「{actualMb}」——比原英文原文更糟。此处锁死「不得残留花括号」。
    expect(reason).not.toMatch(/\{[^{}]*\}/)
    expect(reason).not.toContain('{actualMb}')
    expect(reason).not.toContain('{limitMb}')
    expect(reason.length).toBeGreaterThan(0)
    // 正向断言：体积未知时必须走 _no_numbers 变体（而不是靠安全网把占位符清成空串）。
    // zh 文案以「超过上限」收束第一句，且不得出现「允许上限」这类兜底填充物。
    expect(reason).not.toContain('允许上限')
    expect(reason).toContain('超过上限')
  })

  it('completed+projectId 卡片显示编辑与重新合成按钮并发出 open-result', async () => {
    const wrapper = mountHistory([
      { id: 'done-1', historyType: 'story2video-project', projectId: 'proj-1', status: 'completed', updatedAt: '2026-08-15T12:00:00Z' },
      { id: 'no-proj', status: 'completed', updatedAt: '2026-08-15T11:00:00Z' },
    ])
    const buttons = wrapper.findAll('[data-testid="history-edit-recompose-button"]')
    expect(buttons).toHaveLength(1)
    await buttons[0].trigger('click')
    expect(wrapper.emitted('open-result')).toHaveLength(1)
    expect(wrapper.emitted('open-result')[0][0].id).toBe('done-1')
  })

  it('completed+projectId 卡片标题回退原文案前 60 字，编辑按钮发出 open-result', async () => {
    const wrapper = mountHistory([
      {
        id: 'done-1', historyType: 'story2video-project', projectId: 'proj-1', pipeline: 'story2video-compose', status: 'completed',
        segments: [
          { id: 's1', text: '场景一文案', prompt: '图词一' },
          { id: 's2', text: '', prompt: '图词二' },
        ],
      },
    ])
    const card = wrapper.find('[data-history-id="done-1"]')
    expect(card.find('.history-name').text()).toContain('场景一文案')
    const editButton = card.find('[data-testid="history-edit-recompose-button"]')
    expect(editButton.exists()).toBe(true)
    await editButton.trigger('click')
    expect(wrapper.emitted('open-result')).toHaveLength(1)
    expect(wrapper.emitted('open-result')[0][0].projectId).toBe('proj-1')
  })

  it('卡片文案预览统一按 120 字截断（长文案显示省略号）', () => {
    const longText = '旁白'.repeat(80)
    const wrapper = mountHistory([
      {
        id: 'done-long', projectId: 'proj-1', pipeline: 'story2video-compose', status: 'completed',
        segments: [
          { id: 's1', text: longText, prompt: 'A young prince in weathered bronze-toned leather armor' },
          { id: 's2', text: '', prompt: 'only-prompt' },
        ],
      },
    ])
    expect(wrapper.find('.prompt-preview-text').text()).toContain('…')
    expect(wrapper.find('.prompt-preview-text').text()).toHaveLength(120)
  })

  it('政策失败卡片显示不可恢复提示（含场景号），可恢复失败不显示', () => {
    const wrapper = mountHistory([
      {
        id: 'policy-1',
        status: 'failed',
        error: 'Asset scene generation failed. Image #49: Image generation requires user input after content-policy review; Image #73: Image generation requires user input after content-policy review; Image #74: Image generation requires user input after content-policy review',
      },
      { id: 'retry-1', status: 'failed', error: 'provider timeout, please retry' },
    ])
    const policyCard = wrapper.find('[data-history-id="policy-1"]')
    const hint = policyCard.find('[data-testid="history-policy-resume-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('create.history.policyResumeBlockedLabel')
    expect(hint.text()).toContain('涉及场景：#49、#73-74')
    expect(hint.text()).toContain('#49、#73-74')
    expect(policyCard.find('.s2v-btn-resume').exists()).toBe(false)
    expect(wrapper.find('[data-history-id="retry-1"]').find('[data-testid="history-policy-resume-hint"]').exists()).toBe(false)
    expect(wrapper.find('[data-history-id="retry-1"]').find('.s2v-btn-resume').exists()).toBe(true)
  })

  it('政策失败无法解析场景号时显示兜底提示', () => {
    const wrapper = mountHistory([
      { id: 'policy-2', status: 'failed', error: 'content-policy review failed' },
    ])
    const hint = wrapper.find('[data-history-id="policy-2"]').find('[data-testid="history-policy-resume-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('create.history.policyResumeBlockedGeneric')
    expect(hint.text()).not.toContain('#')
  })

  it('政策失败卡片内联展示含场景号提示（旧弹窗能力收敛到卡片）', () => {
    const wrapper = mountHistory([
      {
        id: 'policy-3',
        status: 'failed',
        error: 'Image #49: Image generation requires user input after content-policy review; Image #73: Image generation requires user input after content-policy review',
      },
    ])
    const hint = wrapper.find('[data-history-id="policy-3"]').find('[data-testid="history-policy-resume-hint"]')
    expect(hint.exists()).toBe(true)
    expect(hint.text()).toContain('create.history.policyResumeBlockedLabel')
    expect(hint.text()).toContain('#49、#73')
  })

  it('历史卡片耗时优先使用运行记录 activeMs', () => {
    const wrapper = mountHistory([{
      id: 'run-active-ms', projectId: 'project-active-ms', status: 'running', activeMs: 65000, duration: 3600000,
    }])
    const duration = wrapper.find('.history-meta-item')
    expect(duration.exists()).toBe(true)
    expect(wrapper.vm.historyDuration(wrapper.props('history')[0])).toBe(65000)
    expect(wrapper.vm.formatDuration(65000)).toContain('create.history.minutes')
    expect(wrapper.vm.formatDuration(65000)).toContain('create.history.seconds')
    expect(wrapper.vm.historyDuration(wrapper.props('history')[0])).not.toBe(3600000)
  })

  it('政策失败且有项目时卡片显示修改并重新生成按钮，点击发出 open-result', async () => {
    const wrapper = mountHistory([
      {
        id: 'policy-edit-1', historyType: 'story2video-project', projectId: 'proj-p1', status: 'failed',
        error: 'Image #49: Image generation requires user input after content-policy review',
      },
    ])
    const card = wrapper.find('[data-history-id="policy-edit-1"]')
    const editButton = card.find('[data-testid="history-policy-edit-button"]')
    expect(editButton.exists()).toBe(true)
    expect(editButton.text()).toContain('create.history.policyEditAndRegenerate')
    expect(card.find('.s2v-btn-resume').exists()).toBe(false)
    await editButton.trigger('click')
    expect(wrapper.emitted('open-result')).toHaveLength(1)
    expect(wrapper.emitted('open-result')[0][0].id).toBe('policy-edit-1')
    expect(wrapper.emitted('open-history-detail')).toBeUndefined()
  })

  it('政策失败但无项目时不显示修改按钮，可恢复失败只显示断点继续', () => {
    const wrapper = mountHistory([
      { id: 'policy-no-proj', status: 'failed', error: 'content-policy review failed' },
      { id: 'retry-edit-1', status: 'failed', error: 'provider timeout, please retry' },
    ])
    const policyCard = wrapper.find('[data-history-id="policy-no-proj"]')
    expect(policyCard.find('[data-testid="history-policy-edit-button"]').exists()).toBe(false)
    expect(policyCard.find('[data-testid="history-policy-resume-hint"]').exists()).toBe(true)
    expect(policyCard.find('.s2v-btn-resume').exists()).toBe(false)
    const retryCard = wrapper.find('[data-history-id="retry-edit-1"]')
    expect(retryCard.find('[data-testid="history-policy-edit-button"]').exists()).toBe(false)
    expect(retryCard.find('.s2v-btn-resume').exists()).toBe(true)
  })

  it('政策失败且有项目时卡片内联修改按钮发出 open-result', async () => {
    const wrapper = mountHistory([
      {
        id: 'policy-detail-edit', historyType: 'story2video-project', projectId: 'proj-p9', status: 'failed',
        error: 'Image #73: Image generation requires user input after content-policy review',
      },
    ])
    const card = wrapper.find('[data-history-id="policy-detail-edit"]')
    const editButton = card.find('[data-testid="history-policy-edit-button"]')
    expect(editButton.exists()).toBe(true)
    expect(editButton.text()).toContain('create.history.policyEditAndRegenerate')
    await editButton.trigger('click')
    expect(wrapper.emitted('open-result')).toHaveLength(1)
    expect(wrapper.emitted('open-result')[0][0].projectId).toBe('proj-p9')
  })

  it('任务项目 ID 完整显示不截断（旧 22 位与新 13 位均全显）', () => {
    const longId = 'run_1787360004146_izko' // 旧格式 22 位
    const shortId = 'lf3k9a2b_7xq1' // 新格式 13 位
    const wrapper = mountHistory([
      { id: 'old', projectId: longId, status: 'completed', updatedAt: '2026-08-15T12:00:00Z' },
      { id: 'new', projectId: shortId, status: 'completed', updatedAt: '2026-08-15T12:00:00Z' },
    ])
    const oldCard = wrapper.find('[data-history-id="old"]')
    const newCard = wrapper.find('[data-history-id="new"]')
    expect(oldCard.find('[data-testid="history-task-id"]').text()).toBe(longId)
    expect(newCard.find('[data-testid="history-task-id"]').text()).toBe(shortId)
  })

  it('批量删除进行中（deleting=true）禁用批量删除按钮与选择复选框（AC-1）', async () => {
    const wrapper = mountHistory([
      { id: 'a', projectId: 'p-a', status: 'completed', updatedAt: '2026-08-15T12:00:00Z' },
      { id: 'b', projectId: 'p-b', status: 'completed', updatedAt: '2026-08-15T11:00:00Z' },
    ])
    const batchButton = wrapper.find('[data-testid="history-batch-delete-button"]')
    expect(batchButton.exists()).toBe(true)
    // 先全选，使批量删除按钮在 deleting 之前可用
    await wrapper.find('[data-testid="history-select-all"]').trigger('change')
    expect(wrapper.find('[data-testid="history-batch-delete-button"]').attributes('disabled')).toBeUndefined()
    await wrapper.setProps({ deleting: true })
    expect(wrapper.find('[data-testid="history-batch-delete-button"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="history-select-all"]').attributes('disabled')).toBeDefined()
    expect(wrapper.find('[data-testid="history-select-checkbox"]').attributes('disabled')).toBeDefined()
  })

  it('pruneSelection 按 displayHistory 校验 identity，避免全量列表 index fallback 误清除选中', async () => {
    // 无稳定身份（id/projectId/runId 全空）的目标项：
    // displayHistory（failed 筛选后截断 500）中 index=1 -> identity='1'
    // 全量 history 中 index=2 -> identity='2'
    const noIdentityItem = { status: 'failed', updatedAt: '2026-08-15T10:00:00Z' }
    const history = [
      { id: 'stable', projectId: 'p-stable', status: 'failed', updatedAt: '2026-08-15T12:00:00Z' },
      { id: 'skip', projectId: 'p-skip', status: 'completed', updatedAt: '2026-08-15T11:00:00Z' },
      noIdentityItem,
    ]
    const wrapper = mountHistory(history)
    await wrapper.find('[role="tab"][data-status="failed"]').trigger('click')
    wrapper.vm.toggleSelect(noIdentityItem, 1)
    expect(wrapper.vm.selectedIdentities).toContain('1')
    await wrapper.setProps({ history: history.map(item => ({ ...item })) })
    expect(wrapper.vm.selectedIdentities).toContain('1')
    expect(wrapper.vm.isSelected(noIdentityItem, 1)).toBe(true)
  })
})

describe('sort dropdown', () => {
  it('renders sort select with default value updatedDesc', () => {
    const wrapper = mount(CreateViewHistory, {
      props: { history: [{ id: '1', status: 'completed', title: 'Test', updatedAt: '2026-08-15T10:00:00Z' }] },
      global: { mocks: { $t: interpolatingT } },
    })
    const select = wrapper.find('[data-testid="history-sort-select"]')
    expect(select.exists()).toBe(true)
    // Vue v-model binds to the select value
    expect(wrapper.vm.sortMode).toBe('updatedDesc')
  })

  it('changes sort mode when user selects an option', async () => {
    const wrapper = mount(CreateViewHistory, {
      props: { history: [
        { id: 'b', title: 'B', status: 'completed', updatedAt: '2026-08-15T10:00:00Z' },
        { id: 'a', title: 'A', status: 'completed', updatedAt: '2026-08-20T10:00:00Z' },
      ] },
      global: { mocks: { $t: interpolatingT } },
    })
    expect(wrapper.vm.filteredHistory.map(item => item.id)).toEqual(['a', 'b'])
    const select = wrapper.find('[data-testid="history-sort-select"]')
    await select.setValue('updatedAsc')
    expect(wrapper.vm.sortMode).toBe('updatedAsc')
    expect(wrapper.vm.filteredHistory.map(item => item.id)).toEqual(['b', 'a'])
  })
})

describe('duplicate title detection', () => {
  it('shows duplicate title tag when two items have exact same title', () => {
    const items = [
      { id: '1', title: 'Same Title', status: 'completed', updatedAt: '2026-08-15T10:00:00Z' },
      { id: '2', title: 'Same Title', status: 'completed', updatedAt: '2026-08-14T10:00:00Z' },
      { id: '3', title: 'Different', status: 'completed', updatedAt: '2026-08-13T10:00:00Z' },
    ]
    const wrapper = mount(CreateViewHistory, {
      props: { history: items },
      global: { mocks: { $t: interpolatingT } },
    })
    const tags = wrapper.findAll('[data-testid="history-duplicate-title-tag"]')
    expect(tags.length).toBe(2)
  })

  it('does not show duplicate tag when all titles are unique', () => {
    const items = [
      { id: '1', title: 'A', status: 'completed', updatedAt: '2026-08-15T10:00:00Z' },
      { id: '2', title: 'B', status: 'completed', updatedAt: '2026-08-14T10:00:00Z' },
    ]
    const wrapper = mount(CreateViewHistory, {
      props: { history: items },
      global: { mocks: { $t: interpolatingT } },
    })
    const tags = wrapper.findAll('[data-testid="history-duplicate-title-tag"]')
    expect(tags.length).toBe(0)
  })

  it('excludes items without explicit title from duplicate detection', () => {
    const items = [
      { id: '1', title: '', status: 'completed', updatedAt: '2026-08-15T10:00:00Z' },
      { id: '2', title: '', status: 'completed', updatedAt: '2026-08-14T10:00:00Z' },
    ]
    const wrapper = mount(CreateViewHistory, {
      props: { history: items },
      global: { mocks: { $t: interpolatingT } },
    })
    const tags = wrapper.findAll('[data-testid="history-duplicate-title-tag"]')
    expect(tags.length).toBe(0)
  })
})

describe('download video button', () => {
  it('shows download button for completed items with videoPath', () => {
    const items = [
      { id: '1', title: 'Test', status: 'completed', videoPath: '/path/to/video.mp4', updatedAt: '2026-08-15T10:00:00Z' },
    ]
    const wrapper = mount(CreateViewHistory, {
      props: { history: items },
      global: { mocks: { $t: interpolatingT } },
    })
    const btn = wrapper.find('[data-testid="history-download-button"]')
    expect(btn.exists()).toBe(true)
  })

  it('hides download button for completed items without videoPath', () => {
    const items = [
      { id: '1', title: 'Test', status: 'completed', videoPath: '', updatedAt: '2026-08-15T10:00:00Z' },
    ]
    const wrapper = mount(CreateViewHistory, {
      props: { history: items },
      global: { mocks: { $t: interpolatingT } },
    })
    const btn = wrapper.find('[data-testid="history-download-button"]')
    expect(btn.exists()).toBe(false)
  })

  it('hides download button for non-completed items', () => {
    const items = [
      { id: '1', title: 'Test', status: 'running', videoPath: '/path/to/video.mp4', updatedAt: '2026-08-15T10:00:00Z' },
    ]
    const wrapper = mount(CreateViewHistory, {
      props: { history: items },
      global: { mocks: { $t: interpolatingT } },
    })
    const btn = wrapper.find('[data-testid="history-download-button"]')
    expect(btn.exists()).toBe(false)
  })

  it('emits download-history event when download button clicked', async () => {
    const items = [
      { id: '1', title: 'Test', status: 'completed', videoPath: '/path/to/video.mp4', updatedAt: '2026-08-15T10:00:00Z' },
    ]
    const wrapper = mount(CreateViewHistory, {
      props: { history: items },
      global: { mocks: { $t: interpolatingT } },
    })
    const btn = wrapper.find('[data-testid="history-download-button"]')
    await btn.trigger('click')
    expect(wrapper.emitted('download-history')).toBeTruthy()
    expect(wrapper.emitted('download-history')[0][0]).toEqual(items[0])
  })
})