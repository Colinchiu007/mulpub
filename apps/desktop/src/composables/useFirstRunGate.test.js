/**
 * useFirstRunGate —— 启动判定的行为合同（UX 审计 1.4）
 *
 * 这里刻意**不**用真实 vue-router：判据要断言的是"在什么条件下导航、在什么条件下不动"，
 * 夹具必须与真实被消费的返回值逐字同形（`{ code, data: { setupDone } }`），
 * 并且必须能造出"桥不可用"那一档 —— 否则兜底伪装成成功这件事不可表示（本仓「契约夹具不得替对方剥壳」同族）。
 */
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { maybeEnterFirstRun, __resetFirstRunGateForTest } from './useFirstRunGate'
// 静态导入只为构造**真的** router：守卫挡下时 push resolve 的是宿主 new 出来的
// NavigationFailure（带内部 Symbol），手搓对象造不出这个形态。
// 判据用 `instanceof Error` 而不是官方谓词 `isNavigationFailure`：前者与"哪一份 vue-router
// 实例"无关，后者要求内部 Symbol 属于它自己那份实例 —— 少一层可漂的前提。
// （本文件第一版曾把一次红误归因为"两份实例"，实测真因是守卫方向写反：
//  `beforeEach(() => true)` 是**放行**不是拦截。归因写错时先重跑最小对照，别急着成文。）
import { createRouter, createMemoryHistory } from 'vue-router'

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

/**
 * QM-6 第二轮 i1：vue-router 4 对「被守卫挡下」的导航是 **resolve 一个 NavigationFailure**，
 * 不是 reject。只写 `try { await push } catch {}` 等于把闩的释放挂在一条走不到的通道上：
 * 那种情况下 `await` 正常返回、`decided` 已置位且永不释放 ⇒ 全新用户本会话
 * 静默永久跳过向导，且零日志 —— 与本文件头注释第 1 条的验收标准直接冲突。
 *
 * 前提（push 真的 resolve 而非 reject）由**真 vue-router 实例**自己断言，
 * 不用手搓失败对象：`isNavigationFailure` 要求 `instanceof Error` 且带内部 Symbol，
 * 手搓的形状一律判 false（实测：predicate 是 `error instanceof Error && NavigationFailureSymbol in error`）。
 */
describe('useFirstRunGate —— 导航被守卫挡下（resolve 形态）也必须放开闩并出声', () => {
  beforeEach(() => {
    __resetFirstRunGateForTest()
  })

  it('beforeEach 返回 false ⇒ 判 push-failed、闩放开、日志带宿主的 message', async () => {
    const stub = {}
    const router = createRouter({
      history: createMemoryHistory(),
      routes: [
        { path: '/', component: stub },
        { path: '/first-run', component: stub },
      ],
    })
    let allow = false
    // 守卫的判据是"返回 false 才挡"，返回 true 是放行 —— 写成 `() => block`（block=true）
    // 会把整条测试变成"导航成功"，于是这一格绿在错误的原因上（本文件第一版就这么错过一次）。
    router.beforeEach(() => allow)
    // 先落一个初始位置（真实应用里路由总有初始导航）。
    await router.push('/').catch(() => {})

    const warns = []
    const check = async () => ({ code: 0, data: { setupDone: false } })

    const r1 = await maybeEnterFirstRun({ router, check, warn: (m) => warns.push(String(m)) })

    expect(r1, '被守卫挡下必须报 push-failed，不得谎报 navigated').toEqual({ action: 'skipped', reason: 'push-failed' })
    // 前提自证：导航确实没发生（currentRoute 仍在 /），而 push 没有抛错 —— 这正是 resolve 形态
    expect(router.currentRoute.value.path, '导航确实被挡在门外').toBe('/')
    expect(warns.join('\n'), '必须出声且点明放开闩').toMatch(/latch released/)

    // 闩真的放开了：放行后再判一次必须真的导航（否则"永久跳过"那一格没被证伪）
    allow = true
    const r2 = await maybeEnterFirstRun({ router, check, warn: (m) => warns.push(String(m)) })
    expect(r2.action, '闩未放开时这一条会读到 already-decided').toBe('navigated')
    expect(router.currentRoute.value.path).toBe('/first-run')
  })

  it('导航成功时 push resolve 的是 undefined ⇒ 判 navigated，不得误伤（实测语义）', async () => {
    const warns = []
    const router = { push: async () => undefined }
    const r = await maybeEnterFirstRun({
      router,
      check: async () => ({ code: 0, data: { setupDone: false } }),
      warn: (m) => warns.push(String(m)),
    })
    expect(r.action).toBe('navigated')
    expect(warns, '成功路径不得留日志').toEqual([])
  })

  it('宿主给的 Error 没有可用 message 时，兜底按 type 出声（不得把认不出形态读成成功）', async () => {
    const warns = []
    const err = new Error('   ')
    err.type = 4
    const router = { push: async () => err }
    const r = await maybeEnterFirstRun({
      router,
      check: async () => ({ code: 0, data: { setupDone: false } }),
      warn: (m) => warns.push(String(m)),
    })
    expect(r).toEqual({ action: 'skipped', reason: 'push-failed' })
    expect(warns.join('\n')).toContain('NavigationFailure type=4')
  })
})
