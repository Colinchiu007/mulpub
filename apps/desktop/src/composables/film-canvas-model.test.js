// @vitest-environment node
// 画布纯模型单测：边合法性矩阵 / 拆分镜铺节点 / 连线注入收集 / 序列化往返净化
import { describe, it, expect } from 'vitest'
const {
  NODE_TYPES, validateCanvasEdge, shotsToNodes, mergeNodesKeepPosition,
  collectShotReferences, buildLocalReferences,
  serializeCanvasState, deserializeCanvasState,
} = require('./film-canvas-model')

describe('validateCanvasEdge 边合法性矩阵', () => {
  it('参考图 -> 分镜 合法', () => {
    expect(validateCanvasEdge({ sourceType: NODE_TYPES.CHARACTER_REF, targetType: NODE_TYPES.SHOT })).toEqual({ ok: true })
    expect(validateCanvasEdge({ sourceType: NODE_TYPES.SCENE_REF, targetType: NODE_TYPES.SHOT })).toEqual({ ok: true })
  })

  it('其余组合全部拒绝并给出 i18n reasonKey', () => {
    const cases = [
      [NODE_TYPES.SHOT, NODE_TYPES.SHOT],
      [NODE_TYPES.ARTIFACT, NODE_TYPES.SHOT],
      [NODE_TYPES.SHOT, NODE_TYPES.CHARACTER_REF],
      [NODE_TYPES.SCRIPT_INPUT, NODE_TYPES.SHOT],
      [NODE_TYPES.CHARACTER_REF, NODE_TYPES.SCENE_REF],
    ]
    for (const [s, t] of cases) {
      const r = validateCanvasEdge({ sourceType: s, targetType: t })
      expect(r.ok).toBe(false)
      expect(r.reasonKey).toMatch(/^filmEngineering\.canvas\.edgeRule\./)
    }
  })

  it('同节点自连与重复边各有专属 reasonKey；未知类型拒绝', () => {
    expect(validateCanvasEdge({ sameNode: true, sourceType: NODE_TYPES.SHOT, targetType: NODE_TYPES.SHOT }).reasonKey)
      .toContain('sameNode')
    expect(validateCanvasEdge({ duplicate: true, sourceType: NODE_TYPES.CHARACTER_REF, targetType: NODE_TYPES.SHOT }).reasonKey)
      .toContain('duplicate')
    expect(validateCanvasEdge({ sourceType: 'evil', targetType: NODE_TYPES.SHOT }).reasonKey).toContain('unknownType')
    expect(validateCanvasEdge({}).reasonKey).toContain('unknownType')
  })
})

describe('shotsToNodes 拆分镜铺节点', () => {
  const shots = [
    { shotId: 'adapt-001', sceneId: 'cold-open', prompt: 'p1' },
    { shotId: 'adapt-002', sceneId: 'cold-open', prompt: 'p2' },
    { shotId: 'adapt-003', sceneId: 'act-2', prompt: 'p3' },
  ]

  it('按 sceneId 聚组，节点 id 带 shot: 前缀，位置为有限数', () => {
    const nodes = shotsToNodes(shots)
    expect(nodes).toHaveLength(3)
    expect(nodes[0].id).toBe('shot:adapt-001')
    expect(nodes.every((n) => n.type === NODE_TYPES.SHOT)).toBe(true)
    expect(nodes[0].position.x === nodes[1].position.x).toBe(false)
    expect(nodes[2].position.y).toBeGreaterThan(nodes[1].position.y)
    expect(nodes.every((n) => Number.isFinite(n.position.x) && Number.isFinite(n.position.y))).toBe(true)
  })

  it('缺 sceneId 回落序号场景；非法入参返回空数组', () => {
    const nodes = shotsToNodes([{ shotId: 'x1', prompt: 'p' }])
    expect(nodes[0].data.sceneId).toBe('scene-1')
    expect(shotsToNodes(null)).toEqual([])
    expect(shotsToNodes([null, { shotId: 'ok' }])).toHaveLength(1)
  })

  it('mergeNodesKeepPosition 保留旧位置、新节点用新位置', () => {
    const next = shotsToNodes(shots)
    const moved = next.map((n, i) => (i === 0 ? { ...n, position: { x: 999, y: 999 } } : n))
    const merged = mergeNodesKeepPosition(next, moved)
    expect(merged[0].position).toEqual({ x: 999, y: 999 })
    expect(merged[1].position).toEqual(next[1].position)
  })
})

describe('连线即注入：collectShotReferences / buildLocalReferences', () => {
  const nodes = [
    { id: 'ref:c1', type: NODE_TYPES.CHARACTER_REF, data: { path: '/media/references/ref-aaaa.png' } },
    { id: 'ref:s1', type: NODE_TYPES.SCENE_REF, data: { path: '/media/references/ref-bbbb.jpg' } },
    { id: 'ref:c2', type: NODE_TYPES.CHARACTER_REF, data: { path: '/media/references/ref-cccc.png' } },
    { id: 'shot:adapt-001', type: NODE_TYPES.SHOT, data: { shot: { shotId: 'adapt-001' } } },
    { id: 'shot:adapt-002', type: NODE_TYPES.SHOT, data: { shot: { shotId: 'adapt-002' } } },
  ]
  const edges = [
    { source: 'ref:c1', target: 'shot:adapt-001' },
    { source: 'ref:s1', target: 'shot:adapt-001' },
    { source: 'ref:c2', target: 'shot:adapt-001' },
    { source: 'ref:c1', target: 'shot:adapt-001' }, // 重复边去重
    { source: 'ref:c1', target: 'shot:adapt-002' },
  ]

  it('按角色/场景两路收集上游路径并去重', () => {
    const r = collectShotReferences('shot:adapt-001', nodes, edges)
    expect(r.character).toEqual(['/media/references/ref-aaaa.png', '/media/references/ref-cccc.png'])
    expect(r.scene).toEqual(['/media/references/ref-bbbb.jpg'])
  })

  it('无 data.path 的节点与未知边被忽略', () => {
    expect(collectShotReferences('shot:nope', nodes, edges)).toEqual({ character: [], scene: [] })
    expect(collectShotReferences('shot:adapt-002', [{ id: 'ref:x', type: NODE_TYPES.CHARACTER_REF, data: {} }, ...nodes], edges).character)
      .toEqual(['/media/references/ref-aaaa.png'])
  })

  it('buildLocalReferences 仅输出有参考的镜且合并角色+场景路径', () => {
    const refs = buildLocalReferences([{ shotId: 'adapt-001' }, { shotId: 'adapt-002' }, { shotId: 'adapt-003' }], nodes, edges)
    expect(refs).toHaveLength(2)
    expect(refs[0]).toEqual({ shotId: 'adapt-001', paths: [
      '/media/references/ref-aaaa.png', '/media/references/ref-cccc.png', '/media/references/ref-bbbb.jpg',
    ] })
    expect(refs[1].paths).toEqual(['/media/references/ref-aaaa.png'])
  })
})

describe('序列化往返（持久化合同）', () => {
  it('sanitize：非法节点类型/坐标与悬空边被剔除', () => {
    const state = serializeCanvasState([
      { id: 'shot:a', type: NODE_TYPES.SHOT, position: { x: 1, y: 2 }, data: { shot: { shotId: 'a' } } },
      { id: 'bad:type', type: 'evil', position: { x: 0, y: 0 }, data: {} },
      { id: 'bad:pos', type: NODE_TYPES.SHOT, position: { x: NaN, y: 0 }, data: {} },
    ], [
      { id: 'e1', source: 'shot:a', target: 'ghost' },
      { id: 'e2', source: 'shot:a', target: 'shot:a' },
    ], { taskId: 't1', updatedAt: 123 })
    expect(state.nodes).toHaveLength(1)
    expect(state.edges).toHaveLength(1)
    expect(state.edges[0].target).toBe('shot:a')
    expect(state.meta.taskId).toBe('t1')
    expect(state.schemaVersion).toBe(1)
  })

  it('往返一致；损坏/版本不符输入返回 null', () => {
    const nodes = shotsToNodes([{ shotId: 'a', sceneId: 's', prompt: 'p' }])
    const s = serializeCanvasState(nodes, [], { taskId: 'x', updatedAt: 1 })
    const back = deserializeCanvasState(JSON.stringify(s))
    expect(back.nodes).toEqual(s.nodes)
    expect(back.edges).toEqual([])
    expect(deserializeCanvasState('not json')).toBeNull()
    expect(deserializeCanvasState({ schemaVersion: 99, nodes: [], edges: [] })).toBeNull()
    expect(deserializeCanvasState(null)).toBeNull()
  })
})
