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
  // 真 store 模块的 TERMINAL_PHASES 必须原样带出来：publishProgressStall.js 从它派生
  // 「什么算终态」。这里若在夹具里另抄一份集合，就是「替对方剥壳」的同型错误 ——
  // 终态口径漂移时面板测试会照样绿。
  const actual = await vi.importActual('@/stores/publishProgress')
  // reactive 包装：组件内模板/computed 才能跟踪测试对原始对象的属性变更
  const reactiveStore = reactive(storeStateRaw)
  return { ...actual, usePublishProgressStore: () => reactiveStore }
})

vi.mock('element-plus', () => ({
  ElMessage: (...args) => mockElMessage(...args),
}))

import PublishProgressPanel from './PublishProgressPanel.vue'
import { usePublishProgressStore } from '@/stores/publishProgress'
// 真实现（本文件不 mock 它）：面板测试断言的一切都由它算出来，tick 周期也取自它，
// 免得"15000"这个字面量在测试里再存一份。
import { STALL_TICK_MS, usePublishProgressStall } from '@/stores/publishProgressStall'

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
    document.body.textContent = ''
    mockElMessage.mockReset()
    store = usePublishProgressStore()
    storeStateRaw.sessions = []
    storeStateRaw.panelVisible = false
    storeStateRaw.panelMinimized = false
    storeStateRaw.hasRunning = false
    // 1.8：面板的无更新派生走**真** tracker（publishProgressStall.js），其唯一输入就是
    // sessions[].tasks[].lastEventAt ⇒ 复位 sessions 即复位派生态，不需要也不允许在这里
    // 再摆一组 hasStalledRunning / taskStallMinutes 存根（那会让面板测试测的是夹具）。
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

  it('blocked 等待分钟按四舍五入显示（v3 短档 60–84s 不得显示成「2 分钟」—— QM-6 前端轴 W1）', async () => {
    // 抖动让实际等待 ∈ [标称, 标称×1.4]。v3 短内容档标称 1′ ⇒ 60–84s。
    // 旧口径 `Math.ceil` 会把这整段显示成「等待 2 分钟后重试」，而 8 秒后任务就发出去了
    // —— 相对误差接近 100%，用户读成"倒计时不准/工具坏了"。v2 下同样的绝对误差(≤59s)
    // 摊在 3–20 分钟上看不见，所以这条是**被本次收紧暴露出来**的既有显示口径问题。
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-1': makeTask({ phase: 'blocked', stageKey: 'waiting', percent: null, remainingWait: 84000, bucket: 'account' }),
        't-2': makeTask({ taskId: 't-2', phase: 'blocked', stageKey: 'waiting', percent: null, remainingWait: 126000, bucket: 'account' }),
      },
      taskOrder: ['t-1', 't-2'],
    })]
    wrapper = mountPanel()
    await nextTick()
    const rows = body().querySelectorAll('[data-testid="publish-progress-task"]')
    // 84s → 1 分钟（ceil 会给 2）；126s → 2 分钟（round 与 ceil 同值，证明不是"一律往下取"）
    expect(rows[0].textContent).toContain('等待 1 分钟')
    expect(rows[0].textContent).not.toContain('等待 2 分钟')
    expect(rows[1].textContent).toContain('等待 2 分钟')
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

  // ── publish-frequency-policy-v2：日配额 / 未提交回滚两态 ──────────────────────
  it('日配额用尽：remainingWait 为 0 也必须有行内文案（不是「无等待即无文案」），且带 daily 归因', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-daily': makeTask({
          taskId: 't-daily',
          phase: 'blocked',
          stageKey: 'waiting',
          percent: null,
          remainingWait: 0, // 关键：日配额不是「等一会儿」，剩余等待恒为 0
          bucket: 'daily',
          reason: 'daily_quota',
          daily: { used: 3, max: 3, dayKey: '2026-10-10' },
        }),
      },
      taskOrder: ['t-daily'],
    })]
    wrapper = mountPanel()
    await nextTick()
    const row = body().querySelector('[data-testid="publish-progress-task"]')
    expect(row.querySelector('[data-testid="publish-progress-task-wait"]')).not.toBe(null)
    expect(row.textContent).toContain('今日已达上限（3/3）')
    expect(row.textContent).toContain('明日 00:00')
    expect(row.querySelector('[data-testid="publish-progress-task-bucket"]').textContent)
      .toContain('（本账号每日上限）')
  })

  it('未提交失败回滚：released 行显示「已恢复可发布」，不得显示等待分钟数', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-rel': makeTask({
          taskId: 't-rel',
          phase: 'released',
          stageKey: 'released',
          percent: null,
          remainingWait: null,
          bucket: null,
        }),
      },
      taskOrder: ['t-rel'],
    })]
    wrapper = mountPanel()
    await nextTick()
    const row = body().querySelector('[data-testid="publish-progress-task"]')
    expect(row.querySelector('[data-testid="publish-progress-task-released"]')).not.toBe(null)
    expect(row.textContent).toContain('未提交到平台，已恢复可发布')
    expect(row.textContent).not.toContain('分钟后重试')
  })

  it('bucket 取值未知时不渲染归因标签（不得把未知口径猜成 daily）', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-unknown': makeTask({
          taskId: 't-unknown',
          phase: 'blocked',
          stageKey: 'waiting',
          percent: null,
          remainingWait: 120000,
          bucket: 'mystery',
        }),
      },
      taskOrder: ['t-unknown'],
    })]
    wrapper = mountPanel()
    await nextTick()
    const rows = body().querySelectorAll('[data-testid="publish-progress-task"]')
    expect(rows[0].querySelector('[data-testid="publish-progress-task-bucket"]')).toBe(null)
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

    // 「完成」在真源里是**任务 phase 落终态 ⇒ _recomputeSessionStatus 把 status 收口**，
    // 原先只改 status 造的正是 QM-6 第二轮 i4 说的那条错位态：
    // 关闭判据整条换成 phase 链后，这种「任务还在跑但会话标成 done」必然判还在跑。
    store.hasRunning = false
    store.sessions[0].status = 'done'
    store.sessions[0].tasks['t-1'].phase = 'success'
    await nextTick()
    closeBtn = body().querySelector('[data-testid="publish-progress-close"]')
    expect(closeBtn.hasAttribute('disabled')).toBe(false)
    closeBtn.click()
    await nextTick()
    expect(storeStateRaw.clearFinished).toHaveBeenCalledTimes(1)
  })

  // ─── 1.8 无更新（ux-audit-stale-watchdog）───────────────────────
  // 修前的真实死锁：`:disabled="store.hasRunning"` 只能被终态事件解除，
  // RPA 挂死时终态事件永不到来 ⇒ 转圈 + 按钮永久灰；而且 handleClose 只在
  // `sessions.length===0` 时收起，running 会话清不掉 ⇒ 光解禁按钮仍是"点了没反应"。
  // 这组用例**不摆派生存根**：输入只有 lastEventAt，面板看到的一切都由真 tracker 算出来。
  const MIN = 60000

  it('1.8 部分陈旧仍禁用关闭；全部无更新才解禁', async () => {
    const fresh = Date.now()
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-1': makeTask({ taskId: 't-1', lastEventAt: fresh - 4 * MIN }),
        't-2': makeTask({ taskId: 't-2', lastEventAt: fresh }),
      },
      taskOrder: ['t-1', 't-2'],
    })]
    wrapper = mountPanel()
    await nextTick()

    let closeBtn = body().querySelector('[data-testid="publish-progress-close"]')
    expect(closeBtn.hasAttribute('disabled'), '还有在动的任务就不得解禁').toBe(true)

    // 第二个也停止更新 ⇒ 全部无更新（写必须经 reactive 代理，直改 raw 不触发重渲染）
    store.sessions[0].tasks['t-2'].lastEventAt = Date.now() - 9 * MIN
    await nextTick()
    closeBtn = body().querySelector('[data-testid="publish-progress-close"]')
    expect(closeBtn.hasAttribute('disabled'), '全部无更新时必须可点').toBe(false)
    expect(closeBtn.getAttribute('title'), 'title 必须说清"关掉不取消任务"').toContain('不会取消')
  })

  it('1.8 全部无更新时头部徽标转中性文案并停掉转圈', async () => {
    const fresh = Date.now()
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: { 't-1': makeTask({ lastEventAt: fresh - 7 * MIN }) },
      taskOrder: ['t-1'],
    })]
    wrapper = mountPanel()
    await nextTick()

    const badge = body().querySelector('[data-testid="publish-progress-stall-badge"]')
    expect(badge, '徽标必须存在').toBeTruthy()
    expect(badge.textContent).toContain('7 分钟无更新')
    expect(badge.classList.contains('ppp__badge--stalled')).toBe(true)
    expect(badge.classList.contains('ppp__badge--running')).toBe(false)
    // 转圈是"还在动"的唯一视觉信号；无更新时它必须停 —— 留着就是继续对用户说谎
    expect(badge.querySelector('.ppp__spin')).toBeNull()
  })

  it('1.8 任务行按真实无更新分钟数追加后缀，未陈旧的行不得追加', async () => {
    const fresh = Date.now()
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-1': makeTask({ taskId: 't-1', lastEventAt: fresh - 3 * MIN }),
        't-2': makeTask({ taskId: 't-2', lastEventAt: fresh }),
      },
      taskOrder: ['t-1', 't-2'],
    })]
    wrapper = mountPanel()
    await nextTick()

    const rows = body().querySelectorAll('[data-testid="publish-progress-task"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].textContent).toContain('（3 分钟无更新）')
    expect(rows[1].textContent, '未陈旧的任务不得被贴上无更新').not.toContain('分钟无更新')
  })

  it('1.8 关闭 ≠ 取消：只隐藏可见性，不动 sessions、不碰取消/重试入口', async () => {
    const fresh = Date.now()
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: { 't-1': makeTask({ lastEventAt: fresh - 5 * MIN }) },
      taskOrder: ['t-1'],
    })]
    wrapper = mountPanel()
    await nextTick()

    const closeBtn = body().querySelector('[data-testid="publish-progress-close"]')
    expect(closeBtn.hasAttribute('disabled')).toBe(false)
    closeBtn.click()
    await nextTick()

    expect(storeStateRaw.panelVisible, '解禁必须兑现成"真的关得掉"').toBe(false)
    expect(storeStateRaw.sessions, '关闭不得丢弃任务态（再展开仍是原状态）').toHaveLength(1)
    expect(storeStateRaw.cancelRunning, '关闭不等于取消').not.toHaveBeenCalled()
    expect(storeStateRaw.retryFailed).not.toHaveBeenCalled()
  })

  it('1.8 面板层的新事件必须解除徽标（而不是只有 store 级 computed 被证明，QM-6 i2）', async () => {
    const fresh = Date.now()
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: { 't-1': makeTask({ lastEventAt: fresh - 4 * MIN }) },
      taskOrder: ['t-1'],
    })]
    wrapper = mountPanel()
    await nextTick()
    const badge = body().querySelector('[data-testid="publish-progress-stall-badge"]')
    expect(badge, '先要看到徽标亮着').toBeTruthy()
    expect(badge.textContent).toContain('4 分钟无更新')

    // 新事件：锚点前移，然后走**公共出口**重新盖章墙钟
    //（生产里由 15s tick 推进；这里不靠等真时间，也不给实现开测试专用通道）。
    store.sessions[0].tasks['t-1'].lastEventAt = Date.now()
    usePublishProgressStall(store).endStallClock()
    usePublishProgressStall(store).beginStallClock()
    await nextTick()
    // 徽标是**同一个元素**换类换文案（不是 v-if 拆掉），所以断言取「不再出现无更新字样 + 回到 running 类 + 转圈回来了」
    const after = body().querySelector('[data-testid="publish-progress-stall-badge"]')
    expect(after, '头部徽标必须一直在场').toBeTruthy()
    expect(after.textContent, '新事件后不得再显示无更新').not.toContain('分钟无更新')
    expect(after.classList.contains('ppp__badge--running'), '必须回到进行中的中性档').toBe(true)
    expect(after.querySelector('.ppp__spin'), '转圈是还在动的唯一视觉信号，必须回来').toBeTruthy()
    expect(body().querySelector('[data-testid="publish-progress-close"]').hasAttribute('disabled'), '解除后不得仍可关').toBe(true)
  })

  it('1.8 面板是看门狗时钟的宿主：挂载起一个 tick、卸载必须交还', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const clearIntervalSpy = vi.spyOn(globalThis, 'clearInterval')
    // i1：原先在全局调用历史上 findIndex，等于把「本用例之前所有 mount 都被拆毁了」这条
    // 隐含前提交给文件级 afterEach —— 一旦有人删掉那句 unmount，存活定时器会让
    // beginStallClock 幂等短路，V12 就退化成「挂载起表」的假证明。
    // 现在把前提交进判据：只认本用例挂载之后新增的那一起表。
    const callsAtStart = setIntervalSpy.mock.calls.length
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    // i2 之后「零非终态任务不建表」，所以前提必须是**有活干**（另有一条用例专门钉空态不建表）
    storeStateRaw.sessions = [makeSession({ tasks: { 't-1': makeTask() }, taskOrder: ['t-1'] })]
    wrapper = mountPanel()
    await nextTick()

    const tickIdx = setIntervalSpy.mock.calls.findIndex((c, k) => k >= callsAtStart && c[1] === STALL_TICK_MS)
    expect(tickIdx, '面板挂载必须把墙钟起起来（否则分钟数永远停在挂载那一刻）').toBeGreaterThanOrEqual(0)
    // 句柄取**返回值**：mock.calls[i] 是入参数组，c[0] 是回调函数本身，
    // 拿它去比 clearInterval 的首参会永远不等（本条用例第一次就这么写错了）。
    const timerId = setIntervalSpy.mock.results[tickIdx].value

    clearIntervalSpy.mockClear()
    wrapper.unmount()
    wrapper = null
    const released = clearIntervalSpy.mock.calls.some((c) => c[0] === timerId)
    expect(released, '卸载必须交还同一个句柄 —— 留在场上就是每条路由的白唤醒').toBe(true)
    setIntervalSpy.mockRestore()
    clearIntervalSpy.mockRestore()
  })

  it('1.8 空态挂载不得建看门狗定时器（QM-6 第二轮 i2 的面板侧）', async () => {
    const setIntervalSpy = vi.spyOn(globalThis, 'setInterval')
    const atStart = setIntervalSpy.mock.calls.length
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = false
    storeStateRaw.sessions = []
    wrapper = mountPanel()
    await nextTick()
    const started = setIntervalSpy.mock.calls.slice(atStart).filter((c) => c[1] === STALL_TICK_MS)
    expect(started, '没有任何非终态任务时，面板挂载一个定时器都不建').toHaveLength(0)
    setIntervalSpy.mockRestore()
  })

  it('1.8 混合态：头部仍是「进行中」而卡住的那行挂无更新后缀（QM-6 第二轮 i8 的裁决）', async () => {
    const fresh = Date.now()
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-1': makeTask({ taskId: 't-1', lastEventAt: fresh - 6 * MIN }),
        't-2': makeTask({ taskId: 't-2', lastEventAt: fresh }),
      },
      taskOrder: ['t-1', 't-2'],
    })]
    wrapper = mountPanel()
    await nextTick()

    // 头部的二态裁决（PRD §4）：只有「全部无更新」才把头部切成中性档 ——
    // 部分卡住时头部继续转圈是刻意的（还有东西真的在动），卡住的那条由**行级后缀**说话。
    const badge = body().querySelector('[data-testid="publish-progress-stall-badge"]')
    expect(badge.textContent, '混合态头部不得显示无更新').not.toContain('分钟无更新')
    expect(badge.classList.contains('ppp__badge--running')).toBe(true)
    expect(badge.querySelector('.ppp__spin'), '转圈仍在 —— 确实还有任务在动').toBeTruthy()
    const rows = body().querySelectorAll('[data-testid="publish-progress-task"]')
    expect(rows[0].textContent).toContain('6 分钟无更新')
    expect(rows[1].textContent).not.toContain('分钟无更新')
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
    document.body.textContent = ''
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

  // ── fix-account-interval-ghost-wait：时钟倒挂归因标签（文案 fix-clock-anomaly-copy 重写）──
  it('U1 clockAnomaly=true 的 blocked 行渲染「本机时间跳变」标签；缺席/为假不渲染', async () => {
    storeStateRaw.panelVisible = true
    storeStateRaw.hasRunning = true
    storeStateRaw.sessions = [makeSession({
      tasks: {
        't-a': makeTask({ taskId: 't-a', phase: 'blocked', stageKey: 'waiting', percent: null, remainingWait: 300000, bucket: 'account', clockAnomaly: true }),
        't-b': makeTask({ taskId: 't-b', phase: 'blocked', stageKey: 'waiting', percent: null, remainingWait: 300000, bucket: 'account', clockAnomaly: false }),
      },
      taskOrder: ['t-a', 't-b'],
    })]
    wrapper = mountPanel()
    await nextTick()
    const rows = body().querySelectorAll('[data-testid="publish-progress-task"]')
    expect(rows).toHaveLength(2)
    expect(rows[0].querySelector('[data-testid="publish-progress-task-clock-anomaly"]')).not.toBe(null)
    expect(rows[0].textContent).toContain('（本机时间跳变，已自动缩短等待，无需处理）')
    // 文案纪律（本 PR 的验收点）：不得用「异常」暗示用户要去修故障，不得露内部术语「钳位」
    expect(rows[0].textContent).not.toContain('时钟异常')
    expect(rows[0].textContent).not.toContain('钳位')
    expect(rows[1].querySelector('[data-testid="publish-progress-task-clock-anomaly"]')).toBe(null)
  })

  it('U2 locales zh/en 成对存在 blockedClockAnomaly 键（防露出 key）', () => {
    const zh = fs.readFileSync(path.resolve(__dirname, '../locales/publish-page/zh.js'), 'utf8')
    const en = fs.readFileSync(path.resolve(__dirname, '../locales/publish-page/en.js'), 'utf8')
    expect(zh).toContain('blockedClockAnomaly')
    expect(en).toContain('blockedClockAnomaly')
    expect(zh).toContain('（本机时间跳变，已自动缩短等待，无需处理）')
    expect(en).toContain('(local clock jump — wait shortened automatically, no action needed)')
  })
})
