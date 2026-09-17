import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'

// Mock @/api/publisher
const storeListPublishHistoryMock = vi.fn()
const pipelineHistoryMock = vi.fn()
vi.mock('@/api/publisher', () => ({
  storeListPublishHistory: (...args) => storeListPublishHistoryMock(...args),
  pipelineHistory: (...args) => pipelineHistoryMock(...args),
}))

// Mock vue-router
const pushSpy = vi.fn()
vi.mock('vue-router', () => ({
  useRouter: () => ({ push: pushSpy }),
}))

import CreateHistory from './CreateHistory.vue'
import i18n from '@/i18n'
import { config as vtuConfig } from '@vue/test-utils'
vtuConfig.global.plugins = [i18n]

describe('CreateHistory', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    storeListPublishHistoryMock.mockResolvedValue({ code: 0, data: { records: [] } })
    pipelineHistoryMock.mockResolvedValue({ code: 0, data: [] })
  })

  // ─── 渲染 ───
  it('渲染页面标题和说明', async () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    expect(w.text()).toContain('创作历史')
    expect(w.text()).toContain('查看已渲染的视频和流水线运行记录')
  })

  it('默认显示渲染记录 tab', async () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    expect(w.vm.tab).toBe('renders')
    // tab 按钮有 active class
    const tabs = w.findAll('.tab')
    expect(tabs[0].classes()).toContain('active')
    expect(tabs[1].classes()).not.toContain('active')
  })

  it('切换到流水线记录 tab', async () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await w.findAll('.tab')[1].trigger('click')
    expect(w.vm.tab).toBe('pipelines')
    expect(pipelineHistoryMock).toHaveBeenCalled()
  })

  // ─── 空状态 ───
  it('渲染记录为空时显示空状态', async () => {
    storeListPublishHistoryMock.mockResolvedValue({ code: 0, data: { records: [] } })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    expect(w.text()).toContain('暂无渲染记录')
  })

  it('流水线记录为空时显示空状态', async () => {
    pipelineHistoryMock.mockResolvedValue({ code: 0, data: [] })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await w.findAll('.tab')[1].trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    expect(w.text()).toContain('暂无流水线运行记录')
  })

  // ─── 渲染记录列表 ───
  it('加载并显示渲染记录列表', async () => {
    storeListPublishHistoryMock.mockResolvedValue({
      code: 0,
      data: {
        records: [
          { composition: '视频1', outputPath: '/path/1.mp4', status: 'completed', completedAt: '2026-07-15T10:00:00Z' },
          { name: '视频2', outputPath: '/path/2.mp4', status: 'failed', createdAt: '2026-07-14T10:00:00Z' },
        ],
      },
    })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    const cards = w.findAll('.render-card')
    expect(cards.length).toBe(2)
    expect(w.text()).toContain('视频1')
    expect(w.text()).toContain('视频2')
  })

  // ─── 流水线记录列表 ───
  it('加载并显示流水线记录列表', async () => {
    pipelineHistoryMock.mockResolvedValue({
      code: 0,
      data: [
        { pipelineName: 'story-to-video', status: 'completed', completedAt: '2026-07-15T10:00:00Z', stages: [{ name: 'script', status: 'completed' }, { name: 'audio', status: 'completed' }] },
      ],
    })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await w.findAll('.tab')[1].trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    const cards = w.findAll('.pipeline-card')
    expect(cards.length).toBe(1)
    expect(w.text()).toContain('Story To Video')
  })

  // ─── 辅助方法 ───
  it('statusLabel 返回正确的中文标签', () => {
    const w = mount(CreateHistory, { global: { plugins: [i18n], stubs: { UiButton: true } } })
    expect(w.vm.statusLabel('completed')).toBe('已完成')
    expect(w.vm.statusLabel('running')).toBe('运行中')
    expect(w.vm.statusLabel('failed')).toBe('生成失败')
    expect(w.vm.statusLabel('cancelled')).toBe('已取消')
    expect(w.vm.statusLabel('paused')).toBe('已暂停')
    expect(w.vm.statusLabel('interrupted')).toBe('已中断')
    expect(w.vm.statusLabel(null)).toBe('已完成')
    expect(w.vm.statusLabel('unknown')).toBe('unknown')
  })

  it('stale running（长时间无更新）归入已中断而非已暂停', async () => {
    const staleDate = new Date(Date.now() - 31 * 60 * 1000).toISOString()
    pipelineHistoryMock.mockResolvedValue({
      code: 0,
      data: [
        { id: 'run-stale', pipelineName: 'story-to-video', status: 'running', updatedAt: staleDate, stages: [{ name: 'compose', status: 'running' }] },
      ],
    })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await w.findAll('.tab')[1].trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    expect(w.vm.pipelines[0].status).toBe('interrupted')
    expect(w.vm.pipelines[0].pausedStage).toBe('compose')
    w.unmount()
  })
  it('stageClass 从对象提取 status', () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    expect(w.vm.stageClass({ status: 'completed' })).toBe('completed')
    expect(w.vm.stageClass({ status: 'running' })).toBe('running')
    expect(w.vm.stageClass('raw-string')).toBe('')
    expect(w.vm.stageClass(null)).toBe('')
  })

  it('shortName 截断超长名称', () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    expect(w.vm.shortName('short')).toBe('short')
    expect(w.vm.shortName('this-is-a-very-long-stage-name')).toBe('this-is-a-...')
    expect(w.vm.shortName('')).toBe('')
    expect(w.vm.shortName(null)).toBe('')
  })

  it('humanName 将连字符名称转为 Title Case', () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    expect(w.vm.humanName('story-to-video')).toBe('Story To Video')
    expect(w.vm.humanName('script-generation')).toBe('Script Generation')
    expect(w.vm.humanName('')).toBe('')
    expect(w.vm.humanName(null)).toBe('')
  })

  it('formatTime 格式化 ISO 时间字符串', () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    const result = w.vm.formatTime('2026-07-15T10:00:00Z')
    expect(result).toBeTruthy()
    expect(typeof result).toBe('string')
    // 无效输入返回空
    expect(w.vm.formatTime(null)).toBe('')
    expect(w.vm.formatTime('')).toBe('')
  })

  // ─── 错误处理 ───
  it('loadRenders 异常时静默 fallback 不崩溃', async () => {
    storeListPublishHistoryMock.mockRejectedValue(new Error('network error'))
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    expect(w.vm.renderLoading).toBe(false)
    expect(w.vm.renders).toEqual([])
  })

  it('loadPipelines 异常时静默 fallback 不崩溃', async () => {
    pipelineHistoryMock.mockRejectedValue(new Error('network error'))
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await w.findAll('.tab')[1].trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    expect(w.vm.pipelineLoading).toBe(false)
    expect(w.vm.pipelines).toEqual([])
  })

  it('流水线历史 IPC 超时时停止加载并显示重试错误', async () => {
    pipelineHistoryMock.mockImplementation(() => new Promise(() => {}))
    vi.useFakeTimers()
    try {
      const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
      w.vm.tab = 'pipelines'
      void w.vm.loadPipelines()

      await vi.advanceTimersByTimeAsync(8000)
      await nextTick()

      expect(w.vm.pipelineLoading).toBe(false)
      expect(w.find('.pipeline-history-error').text()).toContain('加载超时')
    } finally {
      vi.useRealTimers()
    }
  })
  it('并发流水线历史请求只保留最新一次响应', async () => {
    let resolveOldRun;
    pipelineHistoryMock
      .mockImplementationOnce(() => new Promise(resolve => { resolveOldRun = resolve }))
      .mockResolvedValueOnce({ code: 0, data: [{ pipelineName: 'new-pipeline', status: 'completed' }] })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })

    const first = w.vm.loadPipelines()
    await Promise.resolve()
    const second = w.vm.loadPipelines()
    await second
    resolveOldRun({ code: 0, data: [{ pipelineName: 'old-pipeline', status: 'completed' }] })
    await first
    await nextTick()

    expect(w.vm.pipelines.map(item => item.pipelineName)).toEqual(['new-pipeline'])
    expect(w.vm.pipelineLoading).toBe(false)
  })
  // ─── 加载状态 ───
  it('初始化时 renderLoading 为 true', () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    expect(w.vm.renderLoading).toBe(true)
  })

  it('loadRenders 完成后 renderLoading 为 false', async () => {
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    expect(w.vm.renderLoading).toBe(false)
  })
})

  // ─── 后台运行中任务：显示 + 轮询刷新 ───
  it('流水线记录含运行中任务时显示状态并轮询刷新，结束后停止轮询', async () => {
    vi.useFakeTimers()
    const runningData = { code: 0, data: [{
      id: 'run-live-1',
      name: 'story2video-compose',
      pipelineName: 'story2video-compose',
      status: 'running',
      createdAt: '2026-08-07T00:00:00.000Z',
      stages: [{ name: 'split', status: 'completed' }, { name: 'optimize', status: 'running' }],
    }] }
    pipelineHistoryMock.mockResolvedValue(runningData)
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true }, mocks: { $router: { push: pushSpy } } } })
    await nextTick()
    await w.findAll('.tab')[1].trigger('click')
    await vi.advanceTimersByTimeAsync(0)
    await nextTick()

    expect(w.vm.pipelines.length).toBe(1)
    expect(w.text()).toContain('运行中')
    expect(w.text()).toContain('与流水线页面实时同步')
    expect(w.vm.pipelinePollTimer).not.toBeNull()

    // 轮询触发再次加载
    const callsAfterLoad = pipelineHistoryMock.mock.calls.length
    await vi.advanceTimersByTimeAsync(5000)
    expect(pipelineHistoryMock.mock.calls.length).toBeGreaterThan(callsAfterLoad)

    // 任务结束后停止轮询
    pipelineHistoryMock.mockResolvedValue({ code: 0, data: [] })
    await vi.advanceTimersByTimeAsync(5000)
    await nextTick()
    expect(w.vm.pipelinePollTimer).toBeNull()

    w.unmount()
    vi.useRealTimers()
  })

  it('点击运行中卡片跳回创作页', async () => {
    pipelineHistoryMock.mockResolvedValue({ code: 0, data: [{
      id: 'run-live-2', name: 'story2video-compose', pipelineName: 'story2video-compose', status: 'running', stages: [],
    }] })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true }, mocks: { $router: { push: pushSpy } } } })
    await nextTick()
    await w.findAll('.tab')[1].trigger('click')
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    await w.findAll('.pipeline-card')[0].trigger('click')
    expect(pushSpy).toHaveBeenCalledWith('/create')
    w.unmount()
  })

  it('存在运行中流水线时进入页面自动切到流水线记录并显示运行中卡片', async () => {
    pipelineHistoryMock.mockResolvedValue({ code: 0, data: [{
      id: 'run-auto-1', name: 'story2video-compose', pipelineName: 'story2video-compose', status: 'running',
      createdAt: '2026-08-07T00:00:00.000Z',
      stages: [{ name: 'split', status: 'completed' }, { name: 'optimize', status: 'running' }],
    }] })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    // 自动切到流水线记录，运行中卡片直接可见
    expect(w.vm.tab).toBe('pipelines')
    expect(w.vm.runningPipelineCount).toBe(1)
    expect(w.text()).toContain('运行中')
    expect(w.text()).toContain('与流水线页面实时同步')
    w.unmount()
  })

  it('渲染记录 tab 在存在运行中流水线时显示提示横幅，点击横幅切到流水线记录', async () => {
    pipelineHistoryMock.mockResolvedValue({ code: 0, data: [{
      id: 'run-banner-1', name: 'story2video-compose', pipelineName: 'story2video-compose', status: 'running',
      createdAt: '2026-08-07T00:00:00.000Z', stages: [],
    }] })
    const w = mount(CreateHistory, { global: { stubs: { UiButton: true } } })
    await nextTick()
    await new Promise(r => setTimeout(r, 0))
    await nextTick()
    // 切回渲染记录 tab：应显示运行中横幅
    await w.findAll('.tab')[0].trigger('click')
    await nextTick()
    expect(w.text()).toContain('条流水线记录')
    await w.find('.running-banner').trigger('click')
    await nextTick()
    expect(w.vm.tab).toBe('pipelines')
    w.unmount()
  })

