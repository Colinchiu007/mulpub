// @vitest-environment node
// useFilmCanvas 契约单测：adapt 校验与铺节点 / 连线门禁 / 生成负载脱壳与注入 / 持久化往返
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mockApi = vi.hoisted(() => ({ filmEngineering: {} }))
vi.mock('@/api/electron-bridge', () => ({ getApi: () => mockApi }))

const { useFilmCanvas } = await import('./useFilmCanvas')

function makeStorage () {
  const map = new Map()
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    _map: map,
  }
}

beforeEach(() => {
  mockApi.filmEngineering = {
    status: vi.fn(async () => ({ code: 0, data: { available: true, filmMeta: { title: 'Hell Grind' } } })),
    adaptScript: vi.fn(async () => ({
      code: 0,
      data: {
        adaptedShots: [
          { shotId: 'adapt-001', sceneId: 'cold-open', prompt: 'p1' },
          { shotId: 'adapt-002', sceneId: 'cold-open', prompt: 'p2' },
        ],
        llmEnhanced: false,
        warnings: [],
      },
    })),
    uploadReference: vi.fn(async () => ({ code: 0, data: { path: '/tmp/film/references/ref-aabb.png', fileName: 'ref-aabb.png', bytes: 10, mime: 'image/png' } })),
  }
})

describe('runAdapt 初始拆分镜流', () => {
  it('空剧本与超长剧本前端拦截，不发 IPC', async () => {
    const c = useFilmCanvas({ storage: makeStorage() })
    expect((await c.runAdapt()).errorCode).toContain('emptyScript')
    expect(mockApi.filmEngineering.adaptScript).not.toHaveBeenCalled()
    c.form.script = 'x'.repeat(10001)
    expect((await c.runAdapt()).errorCode).toContain('scriptTooLong')
    expect(mockApi.filmEngineering.adaptScript).not.toHaveBeenCalled()
  })

  it('成功后铺分镜节点并透传 characterMap 仅留非空键', async () => {
    const c = useFilmCanvas({ storage: makeStorage() })
    c.form.script = '第一场\n\n剧情。'
    c.form.characterMap.ROKO = '小强'
    c.form.characterMap.JAXX = '  '
    const r = await c.runAdapt()
    expect(r.ok).toBe(true)
    expect(r.added).toBe(2)
    expect(c.nodes.value.every((n) => n.type === 'shot')).toBe(true)
    const payload = mockApi.filmEngineering.adaptScript.mock.calls[0][0]
    expect(payload.characterMap).toEqual({ ROKO: '小强' })
    expect(payload.llmEnabled).toBe(false)
  })

  it('重复执行不产生重复节点（同 shotId 保留原位）', async () => {
    const c = useFilmCanvas({ storage: makeStorage() })
    c.form.script = 'x'
    await c.runAdapt()
    const first = [...c.nodes.value]
    const r2 = await c.runAdapt()
    expect(r2.added).toBe(0)
    expect(c.nodes.value.map((n) => n.id)).toEqual(first.map((n) => n.id))
  })

  it('IPC 失败信封返回 failed errorCode，不抛异常', async () => {
    mockApi.filmEngineering.adaptScript = vi.fn(async () => ({ code: -2, message: 'boom' }))
    const c = useFilmCanvas({ storage: makeStorage() })
    c.form.script = 'x'
    expect((await c.runAdapt()).errorCode).toContain('failed')
  })
})

describe('连线门禁与注入', () => {
  function seeded () {
    const c = useFilmCanvas({ storage: makeStorage() })
    c.nodes.value = [
      { id: 'ref:c1', type: 'characterRef', position: { x: 0, y: 0 }, data: { path: '/r/a.png' } },
      { id: 'ref:s1', type: 'sceneRef', position: { x: 0, y: 1 }, data: { path: '/r/b.jpg' } },
      { id: 'shot:adapt-001', type: 'shot', position: { x: 1, y: 1 }, data: { shot: { shotId: 'adapt-001', prompt: 'p' } } },
      { id: 'shot:adapt-002', type: 'shot', position: { x: 2, y: 1 }, data: { shot: { shotId: 'adapt-002', prompt: 'q' } } },
    ]
    return c
  }

  it('参考->分镜 放行并落边；分镜->分镜 拒绝且不落边', () => {
    const c = seeded()
    expect(c.addEdge({ source: 'ref:c1', target: 'shot:adapt-001' }).ok).toBe(true)
    const bad = c.addEdge({ source: 'shot:adapt-001', target: 'shot:adapt-002' })
    expect(bad.ok).toBe(false)
    expect(bad.reasonKey).toContain('unsupportedPair')
    expect(c.edges.value).toHaveLength(1)
  })

  it('重复边与自连被拒', () => {
    const c = seeded()
    c.addEdge({ source: 'ref:c1', target: 'shot:adapt-001' })
    expect(c.canConnect({ source: 'ref:c1', target: 'shot:adapt-001' }).reasonKey).toContain('duplicate')
    expect(c.canConnect({ source: 'ref:c1', target: 'ref:c1' }).reasonKey).toContain('sameNode')
  })

  it('buildGeneratePayload 携带 localReferences 且为纯 JSON（连线即注入）', () => {
    const c = seeded()
    c.addEdge({ source: 'ref:c1', target: 'shot:adapt-001' })
    c.addEdge({ source: 'ref:s1', target: 'shot:adapt-001' })
    const p = c.buildGeneratePayload(['adapt-001', 'adapt-002'])
    expect(p.selectedShots).toHaveLength(2)
    expect(p.localReferences).toEqual([{ shotId: 'adapt-001', paths: ['/r/a.png', '/r/b.jpg'] }])
    expect(() => JSON.parse(JSON.stringify(p))).not.toThrow()
  })

  it('removeNodes 级联删边', () => {
    const c = seeded()
    c.addEdge({ source: 'ref:c1', target: 'shot:adapt-001' })
    c.removeNodes(['ref:c1'])
    expect(c.nodes.value.find((n) => n.id === 'ref:c1')).toBeUndefined()
    expect(c.edges.value).toHaveLength(0)
  })
})

describe('参考图上传前端校验', () => {
  it('类型白名单与 10MB 上限在渲染端先拦', async () => {
    const c = useFilmCanvas({ storage: makeStorage() })
    expect((await c.uploadReference({ type: 'image/gif', size: 10, arrayBuffer: async () => new ArrayBuffer(10) }, 'character')).errorCode).toContain('badType')
    expect((await c.uploadReference({ type: 'image/png', size: 11 * 1024 * 1024, arrayBuffer: async () => new ArrayBuffer(10) }, 'character')).errorCode).toContain('tooLarge')
    expect(mockApi.filmEngineering.uploadReference).not.toHaveBeenCalled()
  })
})

describe('持久化往返', () => {
  it('persist -> 新实例 restore 恢复节点与边；clearCanvas 抹除', async () => {
    const storage = makeStorage()
    const c = useFilmCanvas({ storage })
    c.form.script = 'x'
    await c.runAdapt()
    c.nodes.value = [...c.nodes.value, { id: 'ref:c1', type: 'characterRef', position: { x: 5, y: 5 }, data: { path: '/r/a.png', label: 'a.png' } }]
    c.addEdge({ source: 'ref:c1', target: 'shot:adapt-001' })
    c.persist()

    const c2 = useFilmCanvas({ storage })
    expect(c2.restore()).toBe(true)
    expect(c2.nodes.value).toHaveLength(3)
    expect(c2.edges.value).toHaveLength(1)
    c2.clearCanvas()
    const c3 = useFilmCanvas({ storage })
    expect(c3.restore()).toBe(false)
  })
})
