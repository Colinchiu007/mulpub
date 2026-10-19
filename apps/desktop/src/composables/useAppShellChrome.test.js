// @ts-check
/**
 * 壳层 chrome 装配桥（useAppShellChrome）合同。
 *
 * 这个 composable 是从 App.vue 抽出来的（max-lines 500 逼出的重构），所以用例必须同时
 * 回答两个问题：① 抽出后**行为逐字没变**（横幅上报 / 折叠上报 / 广播订阅 / 卸载注销）；
 * ② 抽出这个动作本身没有把接线抽丢 —— App.vue 必须真的 import 并解构它，否则
 * 「模块存在且自测全绿 + 生产零调用点」就是本仓最忌的死接线。
 *
 * 夹具口径：只 mock `@/api/electron-bridge`（IPC 面），`@/stores/sidebar-collapse` 用
 * **真实实现** —— 折叠的持久化真源与「广播不回传」的回环防护是该桥的语义前提，
 * mock 掉就只剩在测我自己写的注释。
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mount } from '@vue/test-utils'
import { defineComponent, h } from 'vue'
import { readFileSync } from 'node:fs'
import path from 'node:path'

const { invokePageManager, getApi } = vi.hoisted(() => ({
  invokePageManager: vi.fn(async () => ({ code: 0 })),
  getApi: vi.fn(() => ({ pageManager: {} })),
}))

vi.mock('@/api/electron-bridge', () => ({
  invokePageManager: (...a) => invokePageManager(...a),
  getApi: () => getApi(),
}))

const { sidebarCollapsed } = await import('@/stores/sidebar-collapse')
const { useAppShellChrome } = await import('./useAppShellChrome')

/** setup 里捕获 composable 的返回值，供「导出完整性」用例按真实调用形态检查 */
let capturedApi = null

/**
 * 宿主组件：把 composable 放在 setup 顶层，onMounted/onBeforeUnmount 才归属这个实例。
 * 渲染两个按钮，分别上报 64（横幅实测高度）与 0（横幅消失的收口态）。
 */
function mountHost (opts = {}, bridge = { pageManager: {} }) {
  getApi.mockReturnValue(bridge)
  const Host = defineComponent({
    setup () {
      capturedApi = useAppShellChrome(opts)
      const { onChromeInset } = capturedApi
      return () => h('div', [
        h('button', { 'data-testid': 'report-64', onClick: () => onChromeInset(64) }),
        h('button', { 'data-testid': 'report-0', onClick: () => onChromeInset(0) }),
      ])
    },
  })
  return mount(Host)
}

function callsOf (name) {
  return invokePageManager.mock.calls.filter(c => c[0] === name)
}

describe('useAppShellChrome', () => {
  beforeEach(() => {
    invokePageManager.mockClear()
    getApi.mockReset()
    getApi.mockReturnValue({ pageManager: {} })
    sidebarCollapsed.value = false
  })

  afterEach(() => { vi.restoreAllMocks() })

  it('导出完整性：App.vue 模板只需要 onChromeInset 这一个出口，且必须是函数', async () => {
    mountHost({ isHomeShell: false })
    expect(Object.keys(capturedApi)).toEqual(['onChromeInset'])
    expect(typeof capturedApi.onChromeInset).toBe('function')
  })

  it('横幅上报的高度原样交给主进程（表现层不直接摸 IPC）', async () => {
    const host = mountHost({ isHomeShell: false })
    await host.get('[data-testid="report-64"]').trigger('click')
    expect(callsOf('setTopInset')).toEqual([['setTopInset', 64]])
  })

  it('0 也必须上报 —— 0 是「无横幅」的收口态，不是非法值', async () => {
    const host = mountHost({ isHomeShell: false })
    await host.get('[data-testid="report-0"]').trigger('click')
    expect(callsOf('setTopInset')).toEqual([['setTopInset', 0]])
  })

  it('主窗口实例挂载时把已持久化的折叠态补报一次，且不改动内存状态', async () => {
    sidebarCollapsed.value = true
    mountHost({ isHomeShell: false })
    expect(callsOf('setSidebarCollapsed')).toEqual([['setSidebarCollapsed', true]])
    expect(sidebarCollapsed.value).toBe(true)
  })

  it('home-shell 实例不得上报折叠态：它是被标签系统管理的网页，不是管理者', async () => {
    sidebarCollapsed.value = true
    mountHost({ isHomeShell: true })
    expect(callsOf('setSidebarCollapsed')).toHaveLength(0)
  })

  it('订阅主进程折叠广播并落到真实 store（多窗口同步的唯一出口）', async () => {
    let emit = null
    const unsub = vi.fn()
    const pm = { onSidebarCollapsedChanged: vi.fn((cb) => { emit = cb; return unsub }) }
    mountHost({ isHomeShell: false }, { pageManager: pm })
    expect(pm.onSidebarCollapsedChanged).toHaveBeenCalledTimes(1)
    expect(typeof emit).toBe('function')

    const before = callsOf('setSidebarCollapsed').length
    emit(true)
    expect(sidebarCollapsed.value).toBe(true)
    // 回环防护由真实 store 承担：广播回来的值不得再上报主进程
    // （挂载那一次「启动补报」是合法调用，所以判据是「没有新增」而不是「总共为 0」）
    expect(callsOf('setSidebarCollapsed')).toHaveLength(before)
  })

  it('老桥未暴露 onSidebarCollapsedChanged 时静默跳过，不得影响挂载', async () => {
    await expect(Promise.resolve(mountHost({ isHomeShell: false }, { pageManager: {} })))
      .resolves.toBeTruthy()
    await expect(Promise.resolve(mountHost({ isHomeShell: false }, {})))
      .resolves.toBeTruthy()
  })

  it('卸载必须注销订阅，否则广播会写进已销毁实例', async () => {
    const unsub = vi.fn()
    const host = mountHost({ isHomeShell: false }, {
      pageManager: { onSidebarCollapsedChanged: () => unsub },
    })
    host.unmount()
    expect(unsub).toHaveBeenCalledTimes(1)
  })

  it('接线锁：App.vue 必须 import 并解构本 composable，且不得留第二份装配代码', () => {
    const src = readFileSync(path.resolve(__dirname, '../App.vue'), 'utf8')
    expect(src).toMatch(/import \{ useAppShellChrome \} from '@\/composables\/useAppShellChrome'/)
    expect(src).toMatch(/const \{ onChromeInset \} = useAppShellChrome\(\{ isHomeShell \}\)/)
    // 两份口径必然漂移：抽出后 App.vue 里再出现这三处，说明有人又抄了一遍
    expect(src).not.toMatch(/invokePageManager\('setTopInset'/)
    expect(src).not.toMatch(/onSidebarCollapsedChanged/)
    expect(src).not.toMatch(/applyRemoteCollapsed/)
  })
})
