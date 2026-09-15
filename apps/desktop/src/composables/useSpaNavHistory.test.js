import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { createRouter, createWebHashHistory } from 'vue-router'
import { useSpaNavHistory } from './useSpaNavHistory'

/**
 * useSpaNavHistory 单测
 *
 * 覆盖 2026-09-15 修复的 NavBar 箭头按钮可用性判据：
 * home 标签（虚拟标签）下后退/前进按钮以 vue-router 历史栈为准。
 *
 * ⚠️ jsdom 的 window.history 跨测试共享且不支持 traversal（history.back() 为
 * no-op）。「后退/前进」用 replaceState + PopStateEvent 按真实浏览器 popstate
 * 语义（触发时 history.state 已是目标条目状态）模拟；旧 router 实例的 popstate
 * 监听无法注销，因此全文件共用一个 router 实例，用例按顺序推进同一条历史栈，
 * 快照索引固定：[0]='/'、[1]='/a'、[2]='/b'。
 */

function flush () {
  return new Promise(resolve => setTimeout(resolve, 0))
}

const stateSnapshots = []

function snapshot () {
  stateSnapshots.push({
    state: JSON.parse(JSON.stringify(window.history.state)),
    hash: window.location.hash
  })
}

/** 模拟浏览器历史遍历：恢复目标条目 state+URL 并派发 popstate（state 必须随事件携带，vue-router 依赖 event.state） */
function simulateHistoryGo (snapshotIndex) {
  const { state, hash } = stateSnapshots[snapshotIndex]
  window.history.replaceState(state, '', hash)
  window.dispatchEvent(new PopStateEvent('popstate', { state }))
}

describe('useSpaNavHistory（单 router 顺序流）', () => {
  let router
  let spaNav

  beforeAll(async () => {
    // 模拟全新会话：归零 position
    window.history.replaceState(null, '', '#/')
    router = createRouter({
      history: createWebHashHistory(),
      routes: [
        { path: '/', component: { template: '<div />' } },
        { path: '/a', component: { template: '<div />' } },
        { path: '/b', component: { template: '<div />' } }
      ]
    })
    await router.push('/')
    await flush()
    snapshot() // [0] = /
    spaNav = useSpaNavHistory(router)
    spaNav.attach()
  })

  afterAll(() => {
    spaNav.dispose()
  })

  it('初始位于栈首：后退不可用、前进不可用', () => {
    expect(spaNav.canGoBack.value).toBe(false)
    expect(spaNav.canGoForward.value).toBe(false)
  })

  it('push /a、/b 后：后退可用、前进不可用', async () => {
    await router.push('/a')
    snapshot() // [1] = /a
    await router.push('/b')
    snapshot() // [2] = /b
    expect(spaNav.canGoBack.value).toBe(true)
    expect(spaNav.canGoForward.value).toBe(false)
  })

  it('后退一步（/b→/a）：后退仍可用、前进恢复可用', async () => {
    simulateHistoryGo(1)
    await flush()
    expect(spaNav.canGoBack.value).toBe(true)
    expect(spaNav.canGoForward.value).toBe(true)
  })

  it('后退到栈首（→/）：后退不可用、前进可用', async () => {
    simulateHistoryGo(0)
    await flush()
    expect(spaNav.canGoBack.value).toBe(false)
    expect(spaNav.canGoForward.value).toBe(true)
  })

  it('前进两步回栈顶（→/a→/b）：前进不可用', async () => {
    simulateHistoryGo(1)
    await flush()
    simulateHistoryGo(2)
    await flush()
    expect(spaNav.canGoBack.value).toBe(true)
    expect(spaNav.canGoForward.value).toBe(false)
  })

  it('后退后发起新导航：前进历史被截断', async () => {
    simulateHistoryGo(1) // back → /a
    await flush()
    expect(spaNav.canGoForward.value).toBe(true)
    await router.push('/b') // 新导航（push）：前进栈截断
    expect(spaNav.canGoForward.value).toBe(false)
    expect(spaNav.canGoBack.value).toBe(true)
  })

  it('dispose 后不再同步历史变化', async () => {
    spaNav.dispose()
    await router.push('/')
    // dispose 时位于 /b（后退可用），之后导航不再更新状态
    expect(spaNav.canGoBack.value).toBe(true)
    expect(spaNav.canGoForward.value).toBe(false)
  })
})
