/**
 * AutomationView.notify-registration.test.js — 后台通知的**注册时机**合同（UX 审计 2.4）
 *
 * 症状：`onMounted` 原来是 `await load()` 之后才 `onAutomationNotification(...)` 注册。
 * 于是「进入页面 → 首屏列表请求在飞 → 后台任务此刻失败/恢复」这一段窗口里根本没有监听者，
 * 那条通知**永久丢失**（不补发、不排队），用户看到的是"任务失败了但页面什么都没显示"。
 * 这与 AGENTS「全局单例事件监听器生命周期」「宿主事件的置位与收口必须取自同一对语义」同族：
 * **订阅必须先于任何 await 落位**，否则窗口期就是黑洞。
 *
 * 锁的形状：把首屏 `automationList` 做成一个**由本用例亲手结算**的 deferred，
 * 在它 pending 期间调用 notifier —— 注册没提前就取不到回调（红），注册提前了才可能绿。
 * 负控同时存在：`useNotify` 的 mock 必须是可观测的同一个实例，否则"notifyError 被调用"
 * 这句话绿的是夹具而不是组件。
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createI18n } from 'vue-i18n'

const mockState = {
  listRes: { code: 0, data: { tasks: [] } },
  notifier: null,
  registerOrder: [],
  notifyError: vi.fn(),
  notifySuccess: vi.fn(),
}

let resolveList
vi.mock('@/api/automation', () => ({
  automationList: () => {
    mockState.registerOrder.push('list')
    return new Promise((r) => { resolveList(r) })
  },
  automationCreate: () => Promise.resolve({ code: 0, ok: true }),
  automationUpdate: () => Promise.resolve({ code: 0, ok: true }),
  automationRemove: () => Promise.resolve({ code: 0, ok: true }),
  automationRunNow: () => Promise.resolve({ code: 0, ok: true }),
  onAutomationNotification: (cb) => {
    mockState.registerOrder.push('register')
    mockState.notifier = cb
    return () => { mockState.notifier = null }
  },
}))

vi.mock('@/composables/useNotify', () => ({
  useNotify: () => ({ notifyError: mockState.notifyError, notifySuccess: mockState.notifySuccess }),
}))

import AutomationView from '@/views/AutomationView.vue'

const i18n = createI18n({
  legacy: false,
  locale: 'zh',
  messages: {
    zh: {
      automation: {
        title: '自动化', subtitle: 'sub', resourceNotice: 'notice', create: '新建任务',
        createTitle: '新建', editTitle: '编辑', empty: '还没有自动化任务', unreadable: '读取失败',
        saveFailed: '保存失败', colName: '名称', colTrigger: '触发', colAction: '动作',
        colPolicy: '策略', colLastRun: '上次运行', colOps: '操作', actionPipeline: '流水线',
        fieldName: '名称', namePlaceholder: 'ph', fieldTriggers: '触发', triggersHint: 'h',
        triggerAppStart: '启动', triggerDaily: '每天', triggerWeekly: '每周', triggerInterval: '间隔',
        minutesUnit: '分', fieldPolicy: '策略', policySkip: '跳过', policySkipHint: 'h',
        policyAbort: '中断', policyAbortHint: 'h', fieldRetries: '重试', retryNone: '无',
        retryTimes: ({ named }) => named('count'), weekdays: { 1: '一' }, runNow: '运行',
        edit: '编辑', delete: '删除', cancel: '取消', save: '保存', running: '运行中',
        statusCompleted: '成', statusFailed: '败', statusCancelled: '取消', errNameEmpty: 'e1',
        errNameTooLong: 'e2', errNoTrigger: 'e3', errNoWeekday: 'e4', errSaveFailed: 'e5',
        errRunFailed: 'e6', errDeleteFailed: 'e7', errAlreadyRunning: 'e8', created: 'c',
        saved: 's', deleted: 'd', started: 'st',
        notifyFailed: ({ named }) => 'FAILED:' + named('message'),
        notifyRecovered: ({ named }) => 'OK:' + named('message'),
      },
    },
  },
})

describe('AutomationView · 后台通知注册时机（审计 2.4）', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockState.notifier = null
    mockState.registerOrder.length = 0
  })

  it('注册必须先于首屏列表请求（顺序即合同）', async () => {
    let done
    resolveList = (r) => { done = r }
    const w = mount(AutomationView, { global: { plugins: [i18n] } })
    await flushPromises()
    // 合同的方向：先有监听者，再让请求在飞 —— 反序就是本次要修的缺陷。
    expect(mockState.registerOrder.slice(0, 2)).toEqual(['register', 'list'])
    expect(mockState.registerOrder.filter((x) => x === 'register').length,
      '重复注册会让一条通知触发多次 toast').toBe(1)
    done(mockState.listRes)
    await flushPromises()
    w.unmount()
  })

  it('首屏请求在飞期间到达的失败通知不得丢：notifyError 必须被调用且带上原文', async () => {
    let done
    resolveList = (r) => { done = r }
    const w = mount(AutomationView, { global: { plugins: [i18n] } })
    await flushPromises()

    // 此刻 load() 仍 pending —— 这正是要锁的那段窗口
    expect(mockState.notifyError).not.toHaveBeenCalled()
    const during = mockState.notifier
    expect(during, '窗口期内没有监听者 = 本次要修的缺陷本身').toBeTypeOf('function')
    during({ level: 'error', message: '上一轮任务失败' })
    expect(mockState.notifyError).toHaveBeenCalledWith('automation.notifyFailed', { message: '上一轮任务失败' })
    expect(mockState.notifySuccess).not.toHaveBeenCalled()

    done(mockState.listRes)
    await flushPromises()
    w.unmount()
  })

  it('同一窗口内的恢复通知走成功档（两档不得合并成一条出口）', async () => {
    let done
    resolveList = (r) => { done = r }
    const w = mount(AutomationView, { global: { plugins: [i18n] } })
    await flushPromises()
    mockState.notifier({ level: 'recovered', message: '已恢复' })
    expect(mockState.notifySuccess).toHaveBeenCalledWith('automation.notifyRecovered', { message: '已恢复' })
    expect(mockState.notifyError).not.toHaveBeenCalled()
    done(mockState.listRes)
    await flushPromises()
    w.unmount()
  })

  it('负控：payload 为空时不得产出任何 toast（"有事件"不等于"有内容"）', async () => {
    let done
    resolveList = (r) => { done = r }
    const w = mount(AutomationView, { global: { plugins: [i18n] } })
    await flushPromises()
    mockState.notifier(null)
    mockState.notifier(undefined)
    expect(mockState.notifyError).not.toHaveBeenCalled()
    expect(mockState.notifySuccess).not.toHaveBeenCalled()
    done(mockState.listRes)
    await flushPromises()
    w.unmount()
  })
})
