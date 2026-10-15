import { beforeEach, describe, expect, it, vi } from 'vitest'
import { nextTick, reactive } from 'vue'

const invokePageManagerMock = vi.hoisted(() => vi.fn())

vi.mock('@/api/electron-bridge', async (importOriginal) => {
  const mod = await importOriginal()
  return {
    ...mod,
    invokePageManager: invokePageManagerMock,
  }
})

vi.mock('vue-router', () => ({
  useRoute: vi.fn(),
}))

import { ROUTE_TAB_TITLES, resolveRouteTabTitle, useTabDocumentTitle, ROUTE_PREFIX_ROOTS } from './useTabDocumentTitle'
import { useRoute } from 'vue-router'

/** 搭一个响应式 route mock（watch 依赖 route.fullPath，必须经 reactivity 触发） */
function setupRoute (initialPath = '/') {
  const route = reactive({ fullPath: initialPath })
  useRoute.mockReturnValue(route)
  return {
    push (v) { route.fullPath = v },
    route,
  }
}

beforeEach(() => {
  invokePageManagerMock.mockReset()
  invokePageManagerMock.mockResolvedValue({ code: 0 })
  document.title = '汤姆鱼'
})

describe('resolveRouteTabTitle（纯函数判定表）', () => {
  it('精确 path 命中：/rewrite → sidebar.nav.rewrite（文案改写）', () => {
    expect(resolveRouteTabTitle('/rewrite')).toBe('文案改写')
  })

  it('参数路由前缀命中：/board/p-123 → 素材看板', () => {
    expect(resolveRouteTabTitle('/board/p-123')).toBe('素材看板')
    expect(resolveRouteTabTitle('/board/p-123/contact-sheet')).toBe('场景审批')
    expect(resolveRouteTabTitle('/replay/p-123')).toBe('生产回放')
  })

  it('query 路由：/create?view=history 按 path 部分命中 → 视频创作', () => {
    expect(resolveRouteTabTitle('/create?view=history')).toBe('视频创作')
  })

  it('未知路径回退品牌名「汤姆鱼」', () => {
    expect(resolveRouteTabTitle('/no-such-page')).toBe('汤姆鱼')
  })

  it('空/null 回退品牌名', () => {
    expect(resolveRouteTabTitle('')).toBe('汤姆鱼')
    expect(resolveRouteTabTitle(null)).toBe('汤姆鱼')
  })

  it('映射表覆盖登记过的全部内部路由 path（规模 + 覆盖度双锁，防解析退化与腐化）', () => {
    // 模块级一次性构建：精确表 25 条 + 前缀表普通条目 2 条 + contact-sheet 子路由条目 1 条 = 28
    expect(ROUTE_TAB_TITLES.size).toBeGreaterThanOrEqual(28)
  })

  it('route-registry 全部非 redirect 路由被映射表覆盖（显式例外清单，防新增路由静默回退品牌名）', async () => {
    const { ROUTE_REGISTRY } = await import('@/config/route-registry')
    const registered = ROUTE_REGISTRY.filter(e => e.view !== '').map(e => e.path)
    expect(registered.length).toBeGreaterThanOrEqual(32)
    // 已知例外：暗路由在 home-shell 新标签中正常可达但暂用品牌名回退（补键计划见 PRD §9.2）
    const exceptions = new Set(['/first-run', '/create/result', '/video-clone', '/film-engineering/classic'])
    const unresolved = []
    for (const path of registered) {
      if (exceptions.has(path)) continue
      const clean = path.split('?')[0]
      // 与 resolveRouteTabTitle 相同的判定（不含 i18n）：精确命中或前缀命中
      const exact = ROUTE_TAB_TITLES.has(clean)
      const prefix = ROUTE_PREFIX_ROOTS.some(root => clean.startsWith(root))
      if (!exact && !prefix) unresolved.push(clean)
    }
    expect(unresolved).toEqual([])
  })
})

describe('useTabDocumentTitle（行为）', () => {
  it('初始挂载即上报当前路由标题', async () => {
    setupRoute('/rewrite')
    const { start, stop } = useTabDocumentTitle()
    start()
    await Promise.resolve()
    expect(document.title).toBe('文案改写')
    expect(invokePageManagerMock).toHaveBeenCalledWith('reportTabTitle', '文案改写')
    stop()
  })

  it('路由切换 → document.title 与主进程上报同步更新（文案改写 → 发布）', async () => {
    const routeCtl = setupRoute('/rewrite')
    const { start, stop } = useTabDocumentTitle()
    start()
    await nextTick()
    expect(document.title).toBe('文案改写')

    routeCtl.push('/publish/history')
    await nextTick()
    await nextTick()
    expect(document.title).toBe('发布记录')
    expect(invokePageManagerMock).toHaveBeenLastCalledWith('reportTabTitle', '发布记录')
    stop()
  }, 10000)

  it('未知路由 → 回退品牌名并上报', async () => {
    const routeCtl = setupRoute('/')
    const { start, stop } = useTabDocumentTitle()
    start()
    routeCtl.push('/unknown-page')
    await nextTick()
    await nextTick()
    expect(document.title).toBe('汤姆鱼')
    expect(invokePageManagerMock).toHaveBeenLastCalledWith('reportTabTitle', '汤姆鱼')
    stop()
  })

  it('IPC 上报失败静默降级：document.title 仍更新、rejection 被吞不产生 unhandled rejection', async () => {
    const unhandled = []
    const onUnhandled = (reason) => unhandled.push(reason)
    process.on('unhandledRejection', onUnhandled)
    try {
      invokePageManagerMock.mockRejectedValue(new Error('ipc down'))
      setupRoute('/rewrite')
      const { start, stop } = useTabDocumentTitle()
      start()
      // 等待微任务队列清空：让 mock rejection 真正冒出来
      await new Promise(r => setTimeout(r, 0))
      await new Promise(r => setTimeout(r, 0))
      expect(document.title).toBe('文案改写')
      expect(unhandled).toEqual([])
      stop()
    } finally {
      process.off('unhandledRejection', onUnhandled)
    }
  })

  it('stop 后路由变化不再上报', async () => {
    const routeCtl = setupRoute('/rewrite')
    const { start, stop } = useTabDocumentTitle()
    start()
    await Promise.resolve()
    invokePageManagerMock.mockClear()
    stop()
    routeCtl.push('/publish')
    await Promise.resolve()
    expect(invokePageManagerMock).not.toHaveBeenCalled()
  })

  it('Electron 环境外（非 home-shell 实例）不上报 IPC，但 document.title 仍同步', async () => {
    // 模拟无 pageManager API（invokePageManager 返回 undefined）
    invokePageManagerMock.mockReturnValue(undefined)
    setupRoute('/rewrite')
    const { start, stop } = useTabDocumentTitle()
    start()
    await Promise.resolve()
    expect(document.title).toBe('文案改写')
    stop()
  })
})
