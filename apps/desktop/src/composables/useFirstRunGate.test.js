/**
 * useFirstRunGate —— 启动判定的行为合同（UX 审计 1.4）
 *
 * 这里刻意**不**用真实 vue-router：判据要断言的是"在什么条件下导航、在什么条件下不动"，
 * 夹具必须与真实被消费的返回值逐字同形（`{ code, data: { setupDone } }`），
 * 并且必须能造出"桥不可用"那一档 —— 否则兜底伪装成成功这件事不可表示（本仓「契约夹具不得替对方剥壳」同族）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { maybeEnterFirstRun, __resetFirstRunGateForTest } from './useFirstRunGate'

function fakeRouter (path = '/home') {
  const push = vi.fn(async () => {})
  return { push, currentRoute: { value: { path } } }
}

describe('maybeEnterFirstRun', () => {
  beforeEach(() => {
    __resetFirstRunGateForTest()
  })

  it('无标记（setupDone=false）⇒ 导航到 /first-run', async () => {
    const router = fakeRouter()
    const res = await maybeEnterFirstRun({
      router,
      check: async () => ({ code: 0, data: { setupDone: false } }),
    })
    expect(res).toEqual({ action: 'navigated' })
    expect(router.push).toHaveBeenCalledTimes(1)
    expect(router.push).toHaveBeenCalledWith('/first-run')
  })

  it('已标记（setupDone=true）⇒ 绝不打扰用户（升级用户不得被拦进向导）', async () => {
    const router = fakeRouter()
    const res = await maybeEnterFirstRun({
      router,
      check: async () => ({ code: 0, data: { setupDone: true } }),
    })
    expect(res).toEqual({ action: 'skipped', reason: 'done' })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('桥不可用（兜底档 code=-1）⇒ 不得导航，也不得把"没读到"当成"还没做过"', async () => {
    const router = fakeRouter()
    const res = await maybeEnterFirstRun({
      router,
      check: async () => ({ code: -1, message: 'electronAPI not available', data: null }),
    })
    expect(res).toEqual({ action: 'skipped', reason: 'unavailable' })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('data 里缺 setupDone 或类型不对 ⇒ 同样按"无从判定"处理（不得用 undefined 猜）', async () => {
    for (const payload of [
      { code: 0, data: {} },
      { code: 0, data: { setupDone: 'false' } },
      { code: 0, data: null },
      { code: 0 },
      null,
    ]) {
      __resetFirstRunGateForTest()
      const router = fakeRouter()
      const res = await maybeEnterFirstRun({ router, check: async () => payload })
      expect(res, JSON.stringify(payload)).toEqual({ action: 'skipped', reason: 'unavailable' })
      expect(router.push).not.toHaveBeenCalled()
    }
  })

  it('check 抛错 ⇒ 出声并保持当前路由，不把异常抛给挂载链', async () => {
    const warn = vi.fn()
    const router = fakeRouter()
    const res = await maybeEnterFirstRun({
      router,
      warn,
      check: async () => { throw new Error('ipc boom') },
    })
    expect(res).toEqual({ action: 'skipped', reason: 'check-threw' })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('ipc boom'))
    expect(router.push).not.toHaveBeenCalled()
  })

  it('判定只发生一次：第二次挂载不得再 push（App 重挂载是常态）', async () => {
    const router = fakeRouter()
    const check = vi.fn(async () => ({ code: 0, data: { setupDone: false } }))
    const first = await maybeEnterFirstRun({ router, check })
    const second = await maybeEnterFirstRun({ router, check })
    expect(first).toEqual({ action: 'navigated' })
    expect(second).toEqual({ action: 'skipped', reason: 'already-decided' })
    expect(router.push).toHaveBeenCalledTimes(1)
    // 闩生效后不得再花钱问一次主进程
    expect(check).toHaveBeenCalledTimes(1)
  })

  it('已在 /first-run 时不重复 push（vue-router 同路由会抛 NavigationDuplicated）', async () => {
    const router = fakeRouter('/first-run')
    const res = await maybeEnterFirstRun({
      router,
      check: async () => ({ code: 0, data: { setupDone: false } }),
    })
    expect(res).toEqual({ action: 'skipped', reason: 'already-there' })
    expect(router.push).not.toHaveBeenCalled()
  })

  it('没有 router（异常装配）⇒ 不崩，如实报 no-router', async () => {
    const res = await maybeEnterFirstRun({
      check: async () => ({ code: 0, data: { setupDone: false } }),
    })
    expect(res).toEqual({ action: 'skipped', reason: 'no-router' })
  })

  it('router.push 拒绝时必须放开闩（否则一次性失败把新用户永久挡在向导外）', async () => {
    // QM-6 i2：原实现把 `decided = true` 放在 push 之前且不回收 —— 守卫 reject/redirect
    // 这类一次性失败后，本会话再也不判第二次，且只留一条 App.vue 的日志。
    const pushes = []
    const router = {
      currentRoute: { value: { path: '/' } },
      push: (p) => { pushes.push(p); return Promise.reject(new Error('guard rejected')) },
    }
    const check = async () => ({ code: 0, data: { setupDone: false } })
    const warns = []
    const first = await maybeEnterFirstRun({ router, check, warn: (m) => warns.push(m) })
    expect(first).toEqual({ action: 'skipped', reason: 'push-failed' })
    expect(warns.some((m) => String(m).includes('latch released'))).toBe(true)

    const second = await maybeEnterFirstRun({
      router: { currentRoute: { value: { path: '/' } }, push: (p) => { pushes.push(p); return Promise.resolve() } },
      check,
      warn: (m) => warns.push(m),
    })
    expect(second).toEqual({ action: 'navigated' })
    expect(pushes.length).toBe(2)
  })

  it('不传 warn 时默认必须真出声（生产接线就是「不传」这一支）', async () => {
    // QM-6 i6：默认值原先是 noop，而 App.vue 恰好不传 warn ⇒ gate 内部 catch 到的
    // "check 抛错"这一支在生产里零输出 —— 那条"check 抛错 ⇒ 出声"的契约只对测试成立。
    const spy = vi.spyOn(console, 'warn').mockImplementation(() => {})
    try {
      await maybeEnterFirstRun({ router: null, check: async () => { throw new Error('bridge gone') } })
      expect(spy.mock.calls.some((c) => String(c[0]).includes('startup check threw'))).toBe(true)
    } finally {
      spy.mockRestore()
    }
  })

  it('App.vue 必须真的在挂载时调用判定（否则向导仍然不可达）', async () => {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const url = await import('node:url')
    const here = path.dirname(url.fileURLToPath(import.meta.url))
    const src = fs.readFileSync(path.resolve(here, '..', 'App.vue'), 'utf8')
    // QM-6 i7：只 toContain('maybeEnterFirstRun') 时，「保留 import、删掉调用」也照样绿 ——
    // 那正是本批原来的失效形态（判定函数写得再好也无人执行）。所以判据必须是**调用形态**，
    // 且锚点落在 import 行以外（import 语句本身含同名标识符，会顶掉锚点）。
    const callForm = /maybeEnterFirstRun\(\s*\{\s*router\s*\}\s*\)/
    const nonImportHits = src
      .split(/\r?\n/)
      .filter((line) => !/^\s*import\s/.test(line))
      .filter((line) => callForm.test(line))
    expect(nonImportHits.length, 'App.vue 未接 useFirstRunGate ⇒ 首启向导仍不可达').toBeGreaterThan(0)
    // 接线还必须挂在挂载时机上，否则调用点在别的分支里 = 首启时不执行
    expect(src, 'App.vue 的判定必须在 onMounted 内（首启时机）').toMatch(/onMounted\s*\(/)
  })
})
