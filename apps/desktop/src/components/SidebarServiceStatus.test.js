import { afterEach, describe, expect, it, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import i18n from '@/i18n'

const serviceStatusState = vi.hoisted(() => ({
  services: [
    { key: 'mainBackend', name: '主服务', status: 'running', port: 8299, reason: 'ok', restartable: true, onDemand: false },
    { key: 'splitterEngine', name: '分句引擎', status: 'running', port: 8002, reason: 'ok', restartable: true, onDemand: false },
    { key: 'promptEngine', name: '提示词优化引擎', status: 'stopped', port: 8013, reason: 'connection_refused', restartable: true, onDemand: false },
    { key: 'callbackServer', name: '回调服务', status: 'running', port: 16521, reason: 'ok', restartable: false, onDemand: false },
    { key: 'mediaServer', name: '媒体服务', status: 'running', port: 0, reason: 'ok', restartable: true, onDemand: false },
    { key: 'alignerEngine', name: '对齐引擎', status: 'standby', port: 8004, reason: 'on_demand', restartable: false, onDemand: true },
  ],
  loaded: true,
  unavailable: false,
  runningCount: 4,
  stoppedCount: 1,
  allRunning: false,
  hasDegradation: true,
  lastSeenRunning: { promptEngine: 1700000000000 },
  restarting: {},
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  refresh: vi.fn(async () => true),
  restart: vi.fn(async () => ({ ok: true })),
}))

vi.mock('@/stores/serviceStatus', () => ({
  useServiceStatusStore: () => serviceStatusState,
}))

import SidebarServiceStatus from './SidebarServiceStatus.vue'

let wrapper

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
  serviceStatusState.restart.mockReset()
  serviceStatusState.restart.mockResolvedValue({ ok: true })
  serviceStatusState.restarting = {}
})

function mountComponent () {
  i18n.global.locale.value = 'zh'
  wrapper = mount(SidebarServiceStatus, {
    global: {
      plugins: [i18n],
      stubs: {
        ElPopover: {
          template: '<div class="el-popover-stub"><slot name="reference" /><slot /></div>',
        },
      },
    },
  })
  return wrapper
}

describe('SidebarServiceStatus', () => {
  it('挂载时启动轮询、卸载时停止', () => {
    const cmp = mountComponent()
    expect(serviceStatusState.startPolling).toHaveBeenCalledTimes(1)
    cmp.unmount()
    expect(serviceStatusState.stopPolling).toHaveBeenCalledTimes(1)
  })

  it('部分运行时显示 degraded 结构化两行摘要与逐服务明细', () => {
    const cmp = mountComponent()

    const summary = cmp.get('[data-testid="mp-service-status"]')
    // 整句保留在 aria-label（读屏/悬停语义不丢信息），视觉上拆为整齐两行
    expect(summary.attributes('aria-label')).toBe('1 项服务不可用（4/6 运行中）')
    expect(summary.classes()).toContain('is-degraded')
    expect(cmp.get('[data-testid="mp-service-summary-main"]').text()).toBe('1 项服务不可用')
    expect(cmp.get('[data-testid="mp-service-summary-sub"]').text()).toBe('4/6 运行中')

    const list = cmp.get('[data-testid="mp-service-list"]')
    expect(list.findAll('.mp-service-item')).toHaveLength(6)
    expect(cmp.get('[data-testid="mp-service-promptEngine"]').text()).toContain('已停止')
    // 按需服务显示「按需」而非「待命」，避免被误读为随时可用
    expect(cmp.get('[data-testid="mp-service-alignerEngine"]').text()).toContain('按需')
  })

  it('IPC 不可用时显示不可用摘要', () => {
    serviceStatusState.unavailable = true
    try {
      const cmp = mountComponent()
      const summary = cmp.get('[data-testid="mp-service-status"]')
      expect(summary.text()).toBe('服务状态不可用')
      expect(summary.classes()).toContain('is-degraded')
      expect(cmp.find('[data-testid="mp-service-list"]').text()).toContain('服务状态不可用')
    } finally {
      serviceStatusState.unavailable = false
    }
  })

  it('全部运行时显示 allRunning 摘要', () => {
    serviceStatusState.allRunning = true
    try {
      const cmp = mountComponent()
      expect(cmp.get('[data-testid="mp-service-status"]').text()).toBe('服务运行中')
      expect(cmp.get('[data-testid="mp-service-status"]').classes()).toContain('is-ok')
      // 健康态保持单行，不渲染副行
      expect(cmp.find('[data-testid="mp-service-summary-sub"]').exists()).toBe(false)
    } finally {
      serviceStatusState.allRunning = false
    }
  })

  it('英文降级摘要同样拆两行且无整句括号', async () => {
    const cmp = mountComponent()
    i18n.global.locale.value = 'en'
    await nextTick()

    const summary = cmp.get('[data-testid="mp-service-status"]')
    expect(summary.attributes('aria-label')).toBe('1 service(s) unavailable (4/6 running)')
    expect(cmp.get('[data-testid="mp-service-summary-main"]').text()).toBe('1 service(s) unavailable')
    expect(cmp.get('[data-testid="mp-service-summary-sub"]').text()).toBe('4/6 running')

    i18n.global.locale.value = 'zh'
  })

  it('点击服务项展开详情，展示故障归因与上次运行时间', async () => {
    const cmp = mountComponent()
    expect(cmp.find('[data-testid="mp-service-detail-promptEngine"]').exists()).toBe(false)

    await cmp.get('[data-testid="mp-service-promptEngine"]').trigger('click')

    const detail = cmp.get('[data-testid="mp-service-detail-promptEngine"]')
    expect(detail.text()).toContain('端口无响应')
    expect(detail.text()).toContain('上次运行')
  })

  it('再次点击同一服务项折叠详情', async () => {
    const cmp = mountComponent()
    const item = cmp.get('[data-testid="mp-service-promptEngine"]')

    await item.trigger('click')
    expect(cmp.find('[data-testid="mp-service-detail-promptEngine"]').exists()).toBe(true)

    await item.trigger('click')
    expect(cmp.find('[data-testid="mp-service-detail-promptEngine"]').exists()).toBe(false)
  })

  it('可重启服务展开后展示重试按钮并调用 restart', async () => {
    const cmp = mountComponent()
    await cmp.get('[data-testid="mp-service-promptEngine"]').trigger('click')

    const retry = cmp.get('[data-testid="mp-service-retry-promptEngine"]')
    await retry.trigger('click')

    expect(serviceStatusState.restart).toHaveBeenCalledWith('promptEngine')
  })

  it('不可重启服务不展示重试按钮', async () => {
    const cmp = mountComponent()
    await cmp.get('[data-testid="mp-service-alignerEngine"]').trigger('click')

    expect(cmp.find('[data-testid="mp-service-detail-alignerEngine"]').exists()).toBe(true)
    expect(cmp.find('[data-testid="mp-service-retry-alignerEngine"]').exists()).toBe(false)
  })

  it('运行中的服务展开后不展示重试按钮', async () => {
    const cmp = mountComponent()
    await cmp.get('[data-testid="mp-service-mainBackend"]').trigger('click')

    expect(cmp.find('[data-testid="mp-service-retry-mainBackend"]').exists()).toBe(false)
  })

  it('重试失败时展示对应错误文案', async () => {
    serviceStatusState.restart.mockResolvedValue({ ok: false, message: 'AUTH_REQUIRED' })
    const cmp = mountComponent()

    await cmp.get('[data-testid="mp-service-promptEngine"]').trigger('click')
    await cmp.get('[data-testid="mp-service-retry-promptEngine"]').trigger('click')
    await flushPromises()

    expect(cmp.get('[data-testid="mp-service-detail-promptEngine"]').text()).toContain('需要登录')
  })

  it('未知错误码回退到通用失败文案', async () => {
    serviceStatusState.restart.mockResolvedValue({ ok: false, message: 'SOMETHING_WEIRD' })
    const cmp = mountComponent()

    await cmp.get('[data-testid="mp-service-promptEngine"]').trigger('click')
    await cmp.get('[data-testid="mp-service-retry-promptEngine"]').trigger('click')
    await flushPromises()

    expect(cmp.get('[data-testid="mp-service-detail-promptEngine"]').text()).toContain('操作失败')
  })
})
