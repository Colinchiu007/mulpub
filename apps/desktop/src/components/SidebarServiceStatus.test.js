import { afterEach, describe, expect, it, vi } from 'vitest'
import { mount } from '@vue/test-utils'
import i18n from '@/i18n'

const serviceStatusState = vi.hoisted(() => ({
  services: [
    { key: 'mainBackend', name: '主服务', status: 'running', port: 8299 },
    { key: 'splitterEngine', name: '分句引擎', status: 'running', port: 8002 },
    { key: 'promptEngine', name: '提示词优化引擎', status: 'stopped', port: 8013 },
    { key: 'callbackServer', name: '回调服务', status: 'running', port: 16521 },
    { key: 'mediaServer', name: '媒体服务', status: 'running', port: 0 },
    { key: 'alignerEngine', name: '对齐引擎', status: 'standby', port: 8004 },
  ],
  loaded: true,
  unavailable: false,
  runningCount: 4,
  allRunning: false,
  startPolling: vi.fn(),
  stopPolling: vi.fn(),
  refresh: vi.fn(async () => true),
}))

vi.mock('@/stores/serviceStatus', () => ({
  useServiceStatusStore: () => serviceStatusState,
}))

import SidebarServiceStatus from './SidebarServiceStatus.vue'

let wrapper

afterEach(() => {
  wrapper?.unmount()
  wrapper = null
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

  it('部分运行时显示 degraded 摘要与逐服务明细', () => {
    const cmp = mountComponent()

    const summary = cmp.get('[data-testid="mp-service-status"]')
    expect(summary.text()).toBe('4 项服务运行中')
    expect(summary.classes()).toContain('is-degraded')

    const list = cmp.get('[data-testid="mp-service-list"]')
    expect(list.findAll('.mp-service-item')).toHaveLength(6)
    expect(cmp.get('[data-testid="mp-service-promptEngine"]').text()).toContain('已停止')
    expect(cmp.get('[data-testid="mp-service-alignerEngine"]').text()).toContain('待命')
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
    } finally {
      serviceStatusState.allRunning = false
    }
  })
})
