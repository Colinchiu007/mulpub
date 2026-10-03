// @ts-check
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'
import fs from 'node:fs'
import path from 'node:path'

const mockElMessage = vi.hoisted(() => vi.fn())

const storeStateRaw = vi.hoisted(() => ({
  sessions: [],
  panelVisible: false,
  panelMinimized: false,
  firstHideToastShown: false,
  retrying: false,
  cancelling: false,
  hasRunning: false,
  aggregate: { total: 0, done: 0, succeeded: 0, failed: 0, cancelled: 0 },
  init: vi.fn(),
  minimizePanel: vi.fn(),
  expandPanel: vi.fn(),
  consumeFirstHideToast: vi.fn(() => false),
  retryFailed: vi.fn(async () => ({ ok: 0, fail: 0 })),
  retryOne: vi.fn(async () => ({ ok: 0, fail: 0 })),
  cancelRunning: vi.fn(async () => ({ ok: 0, fail: 0 })),
  clearFinished: vi.fn(),
  sessionFailedCount: vi.fn(() => 0),
}))

vi.mock('@/stores/publishProgress', async () => {
  const { reactive } = await import('vue')
  // reactive 包装：组件内模板/computed 才能跟踪测试对原始对象的属性变更
  const reactiveStore = reactive(storeStateRaw)
  return { usePublishProgressStore: () => reactiveStore }
})

vi.mock('element-plus', () => ({
  ElMessage: (...args) => mockElMessage(...args),
}))

import PublishProgressPanel from './PublishProgressPanel.vue'
import { usePublishProgressStore } from '@/stores/publishProgress'

function makeSession(overrides = {}) {
  return {
    id: 's-1',
    batchId: null,
    title: '测试文章标题',
    createdAt: Date.now(),
    status: 'running',
    finishedAt: null,
    tasks: {},
    taskOrder: [],
    log: [],
    ...overrides,
  }
}

function makeTask(overrides = {}) {
  return {
    taskId: 't-1',
    platform: 'douyin',
    phase: 'progress',
    stageKey: 'upload',
    stage: 'uploading video...',
    percent: 40,
    result: null,
    error: null,
    remainingWait: null,
    retriesLeft: null,
    bucket: null,
    startedAt: Date.now(),
    endedAt: null,
    lastEventAt: Date.now(),
    ...overrides,
  }
}

function mountPanel() {
  // 不在此强制 locale：en 用例需要先切 locale 再挂载（afterEach 统一回 zh）
  return mount(PublishProgressPanel, { global: { plugins: [i18n] } })
}

function body() {
  return document.body
}

describe('PublishProgressPanel.vue — 全局进度面板（publish-progress-ux）', () => {
  let wrapper
  /** reactive 代理：挂载后的状态变更必须经代理（raw 直改不触发重渲染） */
  let store

  beforeEach(() => {
    vi.useRealTimers()
    document.body.innerHTML = ''
    mockElMessage.mockReset()
    store = usePublishProgressStore()
    storeStateRaw.sessions = []
    storeStateRaw.panelVisible = false
    storeStateRaw.panelMinimized = false
    storeStateRaw.hasRunning = false
    storeStateRaw.cancelling = false
    storeStateRaw.aggregate = { total: 0, done: 0, succeeded: 0, failed: 0, cancelled: 0 }
    storeStateRaw.consumeFirstHideToast.mockReset().mockReturnValue(false)
    storeStateRaw.retryFailed.mockReset().mockResolvedValue({ ok: 0, fail: 0 })
    storeStateRaw.retryOne.mockReset().mockResolvedValue({ ok: 0, fail: 0 })
    storeStateRaw.cancelRunning.mockReset().mockResolvedValue({ ok: 0, fail: 0 })
    storeStateRaw.sessionFailedCount.mockReset().mockReturnValue(0)
    storeStateRaw.minimizePanel.mockReset()
    storeStateRaw.expandPanel.mockReset()
    storeStateRaw.clearFinished.mockReset()
    storeStateRaw.init.mockReset()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
    i18n.global.locale.value = 'zh'
  })

  it('setup 调用 store.init()（App 级订阅接线）', () => {
    wrapper = mountPanel()
    expect(storeStateRaw.init).toHaveBeenCalledTimes(1)
  })

  it('展开浮卡：标题/汇总（成功口径）/任务行（平台+阶段词+dot-stepper+百分比）渲染', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.aggregate = { total: 2, done: 1, succeeded: 1, failed: 0, cancelled: 0 }
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-1': makeTask(),
        't-2': makeTask({ taskId: 't-2', platform: 'zhihu', phase: 'success', stageKey: 'done', percent: 100, endedAt: Date.now() }),
      },
      taskOrder: ['t-1', 't-2'],
    })]
    wrapper = mountPanel()
    await nextTick()

    const card = body().querySelector('[data-testid="publish-progress-panel"]')
    expect(card).toBeTruthy()
    expect(card.textContent).toContain('发布进度')
    expect(card.textContent).toContain('成功 1/2')
    const taskRows = card.querySelectorAll('[data-testid="publish-progress-task"]')
    expect(taskRows).toHaveLength(2)
    // 运行行：平台 + 当前步词（状态列承载最具体状态）+ 百分比
    expect(taskRows[0].textContent).toContain('抖音')
    expect(taskRows[0].textContent).toContain('上传')
    expect(taskRows[0].textContent).toContain('40%')
    // 成功行：去冗余——不显示 100%（终态图标已表达）
    expect(taskRows[1].textContent).toContain('知乎')
    expect(taskRows[1].textContent).toContain('成功')
    expect(taskRows[1].textContent).not.toContain('100%')
  })

  it('dot-stepper：运行行渲染 6 圆点（当前步高亮），只显示当前步一个词（不整链渲染文字）', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask({ stageKey: 'upload' }) }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()

    const row = body().querySelector('[data-testid="publish-progress-task"]')
    const dots = row.querySelectorAll('.ppp__dot')
    expect(dots).toHaveLength(6)
    expect(row.querySelectorAll('.ppp__dot--current')).toHaveLength(1)
    // 当前步=upload（第 2 步）：过去步 1 个
    expect(row.querySelectorAll('.ppp__dot--past')).toHaveLength(1)
    // 只渲染当前步词「上传」，不整链渲染其余 5 词
    expect(row.textContent).toContain('上传')
    for (const word of ['准备', '填写', '提交', '校验', '完成']) {
      expect(row.textContent).not.toContain(word)
    }
  })

  it('queued 任务不预渲染步骤链（未开始不预支 6 步认知负担）', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask({ phase: 'queued', stageKey: 'detail', percent: null, stage: '' }) }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()
    const row = body().querySelector('[data-testid="publish-progress-task"]')
    expect(row.querySelectorAll('.ppp__dot')).toHaveLength(0)
    expect(row.textContent).toContain('排队中')
  })

  it('cancelled 任务：中性「已取消」态渲染（非失败红态）', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = false
    storeStateRaw.sessions = [makeSession({
      status: 'done',
      tasks: { 't-1': makeTask({ phase: 'cancelled', stageKey: 'detail', stage: '⊘ 已取消', percent: null, endedAt: Date.now() }) },
      taskOrder: ['t-1'],
    })]
    wrapper = mountPanel()
    await nextTick()
    const row = body().querySelector('[data-testid="publish-progress-task"]')
    expect(row.textContent).toContain('已取消')
    expect(row.classList.contains('ppp__task--cancelled')).toBe(true)
  })

  it('blocked 任务：等待分钟数 + 归因两档可区分，归因缺席时不猜档', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-1': makeTask({ phase: 'blocked', stageKey: 'waiting', percent: null, remainingWait: 1800000, bucket: 'platform' }),
        't-2': makeTask({ taskId: 't-2', phase: 'blocked', stageKey: 'waiting', percent: null, remainingWait: 600000, bucket: 'account' }),
        't-3': makeTask({ taskId: 't-3', phase: 'blocked', stageKey: 'waiting', percent: null, remainingWait: 60000 }),
      },
      taskOrder: ['t-1', 't-2', 't-3'],
    })]
    wrapper = mountPanel()
    await nextTick()
    const rows = body().querySelectorAll('[data-testid="publish-progress-task"]')
    expect(rows).toHaveLength(3)
    expect(rows[0].textContent).toContain('等待 30 分钟后重试')
    expect(rows[0].textContent).toContain('（同平台其他账号间隔）')
    expect(rows[1].textContent).toContain('（本账号间隔）')
    expect(rows[1].textContent).not.toContain('同平台')
    expect(rows[2].querySelector('[data-testid="publish-progress-task-bucket"]')).toBe(null)
  })

  it('汇总口径：成功数直给 + 失败/取消单列（failed 不计入「已完成」）', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = false
    storeStateRaw.aggregate = { total: 4, done: 4, succeeded: 2, failed: 1, cancelled: 1 }
    storeStateRaw.sessions = [makeSession({ status: 'done' })]
    wrapper = mountPanel()
    await nextTick()
    const summary = body().querySelector('[data-testid="publish-progress-summary"]')
    expect(summary.textContent).toContain('成功 2/4')
    expect(summary.textContent).toContain('1 个失败')
    expect(summary.textContent).toContain('1 个已取消')
    expect(summary.textContent).not.toContain('已完成 4/4')
  })

  it('单会话扁平：无会话头徽标/无卡片嵌套；多会话分组呈现', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask() }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()
    let sessionEl = body().querySelector('.ppp__session')
    expect(sessionEl.classList.contains('ppp__session--flat')).toBe(true)
    expect(body().querySelectorAll('.ppp__session-head')).toHaveLength(0)

    // 多会话：分组卡 + 会话头（标题 + 点徽标）
    store.sessions.push(makeSession({
      id: 's-2', title: '第二篇', tasks: { 't-9': makeTask({ taskId: 't-9', platform: 'weibo' }) }, taskOrder: ['t-9'],
    }))
    await nextTick()
    sessionEl = body().querySelector('.ppp__session')
    expect(sessionEl.classList.contains('ppp__session--flat')).toBe(false)
    expect(body().querySelectorAll('.ppp__session-head')).toHaveLength(2)
    expect(body().querySelectorAll('.ppp__session-badge')).toHaveLength(2)
  })

  it('无标题会话 fallback 标题带时间（区分多会话）', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    const created = new Date('2026-09-29T14:32:00')
    storeStateRaw.sessions = [makeSession({ title: '', createdAt: created.getTime(), tasks: { 't-1': makeTask() }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()
    // 单会话无头；推成多会话后头标题可见
    store.sessions.push(makeSession({ id: 's-2', title: '第二篇', tasks: {}, taskOrder: [] }))
    await nextTick()
    const head = body().querySelector('.ppp__session-title')
    expect(head.textContent).toMatch(/^发布 · \d{2}:\d{2}$/)
  })

  it('footer 警示条：运行中显示勿关提示 + 取消入口；无运行任务时不显示', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask() }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()
    let footer = body().querySelector('[data-testid="publish-progress-footer"]')
    expect(footer).toBeTruthy()
    let hint = footer.querySelector('.ppp__hint')
    expect(hint.textContent.trim()).toBe('发布后台进行中，请勿关闭应用')
    expect(footer.querySelector('[data-testid="publish-progress-cancel"]')).toBeTruthy()

    store.hasRunning = false
    store.sessions[0].status = 'done'
    await nextTick()
    footer = body().querySelector('[data-testid="publish-progress-footer"]')
    expect(footer).toBeNull()
    // 兼容旧选择器：hint 元素随 footer 一起消失
    expect(body().querySelector('[data-testid="publish-progress-hint"]')).toBeNull()
  })

  it('取消两步内联确认：首次点击进入确认态（不调 IPC），再点才执行', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask() }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()

    const cancelBtn = body().querySelector('[data-testid="publish-progress-cancel"]')
    cancelBtn.click()
    await nextTick()
    expect(storeStateRaw.cancelRunning).not.toHaveBeenCalled()
    expect(cancelBtn.textContent).toContain('确认取消？')

    cancelBtn.click()
    await Promise.resolve()
    expect(storeStateRaw.cancelRunning).toHaveBeenCalledTimes(1)
  })

  it('取消确认态 4 秒超时自动退出（防误触滞留）', async () => {
    vi.useFakeTimers()
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask() }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()

    const cancelBtn = body().querySelector('[data-testid="publish-progress-cancel"]')
    cancelBtn.click()
    await nextTick()
    vi.advanceTimersByTime(4100)
    await nextTick()
    expect(cancelBtn.textContent).toContain('取消全部任务')
    expect(storeStateRaw.cancelRunning).not.toHaveBeenCalled()
  })

  it('最小化：调 minimizePanel；首次隐藏弹一次性 toast，二次不弹', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask() }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()

    storeStateRaw.consumeFirstHideToast.mockReturnValueOnce(true)
    const minimizeBtn = body().querySelector('[data-testid="publish-progress-minimize"]')
    expect(minimizeBtn).toBeTruthy()
    minimizeBtn.click()
    await nextTick()
    expect(storeStateRaw.minimizePanel).toHaveBeenCalledTimes(1)
    expect(storeStateRaw.consumeFirstHideToast).toHaveBeenCalledTimes(1)
    expect(mockElMessage).toHaveBeenCalledTimes(1)
    expect(mockElMessage.mock.calls[0][0]).toMatchObject({ message: '发布将在后台继续进行，请勿关闭应用软件' })

    // 二次最小化：consumeFirstHideToast 返回 false → 不再弹
    minimizeBtn.click()
    await nextTick()
    expect(mockElMessage).toHaveBeenCalledTimes(1)
  })

  it('胶囊态：渲染 pillRunning 汇总 + 勿关提示，点击恢复展开', async () => {
    storeStateRaw.panelMinimized = true
    storeStateRaw.hasRunning = true
    storeStateRaw.aggregate = { total: 3, done: 1, succeeded: 1, failed: 0, cancelled: 0 }
    wrapper = mountPanel()
    await nextTick()

    const pill = body().querySelector('[data-testid="publish-progress-pill"]')
    expect(pill).toBeTruthy()
    expect(pill.textContent).toContain('发布中 1/3')
    expect(pill.textContent).toContain('请勿关闭应用')
    expect(body().querySelector('[data-testid="publish-progress-panel"]')).toBeNull()

    pill.click()
    await nextTick()
    expect(storeStateRaw.expandPanel).toHaveBeenCalledTimes(1)
  })

  it('胶囊完成态：显示 pillDone + 失败计数', async () => {
    storeStateRaw.panelMinimized = true
    storeStateRaw.hasRunning = false
    storeStateRaw.aggregate = { total: 3, done: 3, succeeded: 2, failed: 1, cancelled: 0 }
    storeStateRaw.sessions = [makeSession({ status: 'done' })]
    wrapper = mountPanel()
    await nextTick()
    const pill = body().querySelector('[data-testid="publish-progress-pill"]')
    expect(pill.textContent).toContain('发布完成 3/3')
    expect(pill.textContent).toContain('1 个失败')
  })

  it('失败任务：错误行 + 内联「重试此任务」/「复制错误」+ 会话级「重试失败项」', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = false
    storeStateRaw.sessions = [makeSession({
      status: 'done',
      tasks: {
        't-1': makeTask({ phase: 'failed', stageKey: 'failed', percent: 100, error: '平台 Cookie 缺失（账号未登录）', endedAt: Date.now() }),
      },
      taskOrder: ['t-1'],
    })]
    storeStateRaw.sessionFailedCount.mockReturnValue(1)
    storeStateRaw.retryOne.mockResolvedValue({ ok: 1, fail: 0 })
    wrapper = mountPanel()
    await nextTick()

    const card = body().querySelector('[data-testid="publish-progress-panel"]')
    expect(card.textContent).toContain('平台 Cookie 缺失（账号未登录）')
    // 单任务内联重试
    const taskRetryBtn = card.querySelector('[data-testid="publish-progress-task-retry"]')
    expect(taskRetryBtn).toBeTruthy()
    taskRetryBtn.click()
    await Promise.resolve()
    expect(storeStateRaw.retryOne).toHaveBeenCalledWith('s-1', 't-1')
    // 会话级重试失败项（批量入口保留）
    const retryBtn = card.querySelector('[data-testid="publish-progress-retry-failed"]')
    expect(retryBtn).toBeTruthy()
    expect(retryBtn.textContent).toContain('重试失败项（1）')
    retryBtn.click()
    await Promise.resolve()
    expect(storeStateRaw.retryFailed).toHaveBeenCalledWith('s-1')
  })

  it('复制错误信息：完整错误文本入剪贴板 + 成功 toast；失败时错误 toast', async () => {
    const writeText = vi.fn().mockResolvedValue()
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true })
    try {
      storeStateRaw.panelVisible = true
      storeStateRaw.hasRunning = false
      storeStateRaw.sessions = [makeSession({
        status: 'done',
        tasks: { 't-1': makeTask({ phase: 'failed', stageKey: 'failed', error: '完整错误文本ABC' }) },
        taskOrder: ['t-1'],
      })]
      wrapper = mountPanel()
      await nextTick()

      const copyBtn = body().querySelector('[data-testid="publish-progress-task-copy-error"]')
      copyBtn.click()
      await Promise.resolve()
      expect(writeText).toHaveBeenCalledWith('完整错误文本ABC')
      expect(mockElMessage).toHaveBeenCalledTimes(1)
      expect(mockElMessage.mock.calls[0][0]).toMatchObject({ message: '已复制到剪贴板', type: 'success' })

      // 剪贴板拒绝 → 错误 toast，不静默
      writeText.mockRejectedValueOnce(new Error('denied'))
      copyBtn.click()
      await Promise.resolve()
      expect(mockElMessage).toHaveBeenCalledTimes(2)
      expect(mockElMessage.mock.calls[1][0]).toMatchObject({ message: '复制失败', type: 'error' })
    } finally {
      delete navigator.clipboard
    }
  })

  it('运行中关闭按钮 disabled；完成后可点（清除已完成）', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask() }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()
    let closeBtn = body().querySelector('[data-testid="publish-progress-close"]')
    expect(closeBtn.hasAttribute('disabled')).toBe(true)

    store.hasRunning = false
    store.sessions[0].status = 'done'
    await nextTick()
    closeBtn = body().querySelector('[data-testid="publish-progress-close"]')
    expect(closeBtn.hasAttribute('disabled')).toBe(false)
    closeBtn.click()
    await nextTick()
    expect(storeStateRaw.clearFinished).toHaveBeenCalledTimes(1)
  })

  it('展开态无会话：显示空态文案', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.sessions = []
    wrapper = mountPanel()
    await nextTick()
    const card = body().querySelector('[data-testid="publish-progress-panel"]')
    expect(card.textContent).toContain('暂无进行中的发布')
  })

  it('非模态负向锁：源码不得接入浮层互斥（PRD-OVERLAY-VIEW-SUSPENSION §6 口径）', () => {
    const source = fs.readFileSync(
      path.resolve(__dirname, 'PublishProgressPanel.vue'),
      'utf-8',
    )
    expect(source).not.toContain('suspendEmbeddedViewsForOverlay')
    expect(source).not.toContain('useEmbeddedViewSuspension')
    expect(source).not.toContain('ElMessageBox')
  })

  it('英文 locale：胶囊与状态标签走 en 文案', async () => {
    i18n.global.locale.value = 'en'
    try {
      storeStateRaw.panelMinimized = true
      storeStateRaw.hasRunning = true
      storeStateRaw.aggregate = { total: 2, done: 1, succeeded: 1, failed: 0, cancelled: 0 }
      wrapper = mountPanel()
      await nextTick()
      const pill = body().querySelector('[data-testid="publish-progress-pill"]')
      expect(pill.textContent).toContain('Publishing 1/2')
      expect(pill.textContent).toContain('keep the app open')
    } finally {
      i18n.global.locale.value = 'zh'
    }
  })
})

describe('PublishProgressPanel.vue — 完成自动收敛（publish-progress-panel-refine）', () => {
  let wrapper
  let store

  beforeEach(() => {
    vi.useFakeTimers()
    document.body.innerHTML = ''
    mockElMessage.mockReset()
    store = usePublishProgressStore()
    storeStateRaw.sessions = []
    storeStateRaw.panelVisible = true
    storeStateRaw.panelMinimized = false
    storeStateRaw.hasRunning = true
    storeStateRaw.cancelling = false
    storeStateRaw.aggregate = { total: 2, done: 2, succeeded: 2, failed: 0, cancelled: 0 }
    storeStateRaw.consumeFirstHideToast.mockReset().mockReturnValue(false)
    storeStateRaw.minimizePanel.mockReset()
    storeStateRaw.init.mockReset()
  })

  afterEach(() => {
    wrapper?.unmount()
    wrapper = null
    vi.useRealTimers()
    i18n.global.locale.value = 'zh'
  })

  function mountAllSuccess() {
    storeStateRaw.sessions = [makeSession({
      status: 'running',
      tasks: {
        't-1': makeTask(),
        't-2': makeTask({ taskId: 't-2', platform: 'zhihu', phase: 'progress', stageKey: 'fill' }),
      },
      taskOrder: ['t-1', 't-2'],
    })]
    wrapper = mountPanel()
    return wrapper
  }

  it('全部成功 + 5 秒无操作 → 自动最小化（不弹首次隐藏 toast）', async () => {
    mountAllSuccess()
    await nextTick()

    store.hasRunning = false
    store.sessions[0].status = 'done'
    for (const id of ['t-1', 't-2']) store.sessions[0].tasks[id].phase = 'success'
    await nextTick()

    vi.advanceTimersByTime(4999)
    expect(storeStateRaw.minimizePanel).not.toHaveBeenCalled()
    vi.advanceTimersByTime(2)
    expect(storeStateRaw.minimizePanel).toHaveBeenCalledTimes(1)
    // 自动收敛不是用户最小化：不触发首次隐藏教育 toast
    expect(storeStateRaw.consumeFirstHideToast).not.toHaveBeenCalled()
    expect(mockElMessage).not.toHaveBeenCalled()
  })

  it('收敛计时中面板交互（pointerdown）→ 取消收敛', async () => {
    mountAllSuccess()
    await nextTick()

    store.hasRunning = false
    store.sessions[0].status = 'done'
    for (const id of ['t-1', 't-2']) store.sessions[0].tasks[id].phase = 'success'
    await nextTick()

    const card = body().querySelector('[data-testid="publish-progress-panel"]')
    card.dispatchEvent(new Event('pointerdown'))
    vi.advanceTimersByTime(6000)
    expect(storeStateRaw.minimizePanel).not.toHaveBeenCalled()
  })

  it('存在失败任务 → 不自动收敛（不遮蔽恢复入口）', async () => {
    mountAllSuccess()
    await nextTick()

    store.hasRunning = false
    store.sessions[0].status = 'done'
    store.sessions[0].tasks['t-1'].phase = 'success'
    store.sessions[0].tasks['t-2'].phase = 'failed'
    store.aggregate = { total: 2, done: 2, succeeded: 1, failed: 1, cancelled: 0 }
    await nextTick()

    vi.advanceTimersByTime(10000)
    expect(storeStateRaw.minimizePanel).not.toHaveBeenCalled()
  })

  it('存在已取消任务 → 不自动收敛', async () => {
    mountAllSuccess()
    await nextTick()

    store.hasRunning = false
    store.sessions[0].status = 'done'
    store.sessions[0].tasks['t-1'].phase = 'success'
    store.sessions[0].tasks['t-2'].phase = 'cancelled'
    store.aggregate = { total: 2, done: 2, succeeded: 1, failed: 0, cancelled: 1 }
    await nextTick()

    vi.advanceTimersByTime(10000)
    expect(storeStateRaw.minimizePanel).not.toHaveBeenCalled()
  })

  it('用户手动展开完成态面板 → 不触发自动收敛（展开即被收回是骚扰）', async () => {
    storeStateRaw.panelVisible = false
    storeStateRaw.panelMinimized = true
    storeStateRaw.hasRunning = false
    storeStateRaw.sessions = [makeSession({
      status: 'done',
      tasks: { 't-1': makeTask({ phase: 'success', stageKey: 'done' }) },
      taskOrder: ['t-1'],
    })]
    wrapper = mountPanel()
    await nextTick()

    store.panelVisible = true
    store.panelMinimized = false
    await nextTick()
    vi.advanceTimersByTime(10000)
    expect(storeStateRaw.minimizePanel).not.toHaveBeenCalled()
  })
})
