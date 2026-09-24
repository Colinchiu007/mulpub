// @ts-check
/**
 * 影视工程画布纯模型（无 Vue / DOM 依赖，node 环境可测）
 *
 * 职责：
 *  - 节点类型与边合法性矩阵（连线即上游注入下游，非法连线拒绝并返回 i18n key）
 *  - adaptScript 结果 -> 分镜节点网格布局（按场景聚组）
 *  - 连线参考收集：某分镜节点的上游参考图路径（角色/场景两路）
 *  - 画布状态序列化/反序列化（持久化合同，schemaVersion 白名单净化）
 *
 * 文案合同：本模块不注入 i18n、不产出中文字面量，只返回 locale key。
 */

/** 节点类型（与 Vue Flow node.type 一一对应） */
const NODE_TYPES = {
  SCRIPT_INPUT: 'scriptInput',
  CHARACTER_REF: 'characterRef',
  SCENE_REF: 'sceneRef',
  SHOT: 'shot',
  ARTIFACT: 'artifact',
}

const ALL_NODE_TYPES = new Set(Object.values(NODE_TYPES))

/**
 * 边合法性矩阵：key = 上游类型，value = 允许连接的下游类型集合。
 * v1 锁定最小闭环：参考图注入分镜；分镜 -> 产物为生成结果自动挂载，不允许手连。
 */
const EDGE_RULES = {
  [NODE_TYPES.SCRIPT_INPUT]: new Set([]),
  [NODE_TYPES.CHARACTER_REF]: new Set([NODE_TYPES.SHOT]),
  [NODE_TYPES.SCENE_REF]: new Set([NODE_TYPES.SHOT]),
  [NODE_TYPES.SHOT]: new Set([]),
  [NODE_TYPES.ARTIFACT]: new Set([]),
}

/**
 * 校验一条候选边是否合法。
 * @param {{sourceType?: string, targetType?: string, sameNode?: boolean, duplicate?: boolean}} candidate
 * @returns {{ok: boolean, reasonKey?: string}}
 */
function validateCanvasEdge (candidate) {
  const { sourceType, targetType, sameNode, duplicate } = candidate || {}
  if (sameNode) return { ok: false, reasonKey: 'filmEngineering.canvas.edgeRule.sameNode' }
  if (duplicate) return { ok: false, reasonKey: 'filmEngineering.canvas.edgeRule.duplicate' }
  if (!ALL_NODE_TYPES.has(sourceType) || !ALL_NODE_TYPES.has(targetType)) {
    return { ok: false, reasonKey: 'filmEngineering.canvas.edgeRule.unknownType' }
  }
  if (!EDGE_RULES[sourceType].has(targetType)) {
    return { ok: false, reasonKey: 'filmEngineering.canvas.edgeRule.unsupportedPair' }
  }
  return { ok: true }
}

/** 网格布局默认参数（px）：同场景分镜横向排，场景簇纵向堆叠 */
const LAYOUT = { COL_GAP: 360, ROW_GAP: 220, SCENE_GAP: 120, PER_ROW: 4 }

/**
 * 把 adaptScript 的 adaptedShots 铺为分镜节点（按 sceneId 聚组、组内按顺序网格排布）。
 * @param {Array<{shotId: string, sceneId?: string, prompt?: string}>} adaptedShots
 * @param {{x0?: number, y0?: number}} [origin]
 * @returns {Array<{id: string, type: string, position: {x: number, y: number}, data: {shot: object}}>}
 */
function shotsToNodes (adaptedShots, origin) {
  const x0 = (origin && Number.isFinite(origin.x0)) ? origin.x0 : 80
  const y0 = (origin && Number.isFinite(origin.y0)) ? origin.y0 : 80
  if (!Array.isArray(adaptedShots)) return []
  /** @type {Map<string, object[]>} */
  const groups = new Map()
  adaptedShots.forEach((shot, i) => {
    if (!shot || typeof shot !== 'object') return
    const key = typeof shot.sceneId === 'string' && shot.sceneId ? shot.sceneId : 'scene-' + (i + 1)
    if (!groups.has(key)) groups.set(key, [])
    groups.get(key).push(shot)
  })
  const nodes = []
  let y = y0
  for (const [sceneId, shots] of groups.entries()) {
    shots.forEach((shot, idx) => {
      const col = idx % LAYOUT.PER_ROW
      const row = Math.floor(idx / LAYOUT.PER_ROW)
      nodes.push({
        id: 'shot:' + String(shot.shotId || sceneId + '-' + (idx + 1)),
        type: NODE_TYPES.SHOT,
        position: { x: x0 + col * LAYOUT.COL_GAP, y: y + row * LAYOUT.ROW_GAP },
        data: { shot, sceneId },
      })
    })
    const rows = Math.ceil(shots.length / LAYOUT.PER_ROW)
    y += Math.max(rows, 1) * LAYOUT.ROW_GAP + LAYOUT.SCENE_GAP
  }
  return nodes
}

/**
 * 合并节点并保留既有位置（重铺/复原时不打乱用户已拖动的布局）。
 * 以 id 匹配；prev 中不存在的取 next 位置。
 */
function mergeNodesKeepPosition (nextNodes, prevNodes) {
  const prevById = new Map((prevNodes || []).map((n) => [n.id, n]))
  return (nextNodes || []).map((n) => {
    const prev = prevById.get(n.id)
    if (prev && prev.position) return { ...n, position: prev.position }
    return n
  })
}

/**
 * 收集某分镜节点的上游参考图（连线即注入）。
 * @param {string} shotNodeId
 * @param {Array<{id: string, type: string, data?: object}>} nodes
 * @param {Array<{source: string, target: string}>} edges
 * @returns {{character: string[], scene: string[]}}
 */
function collectShotReferences (shotNodeId, nodes, edges) {
  const byId = new Map((nodes || []).map((n) => [n.id, n]))
  const out = { character: [], scene: [] }
  for (const e of edges || []) {
    if (e.target !== shotNodeId) continue
    const src = byId.get(e.source)
    if (!src) continue
    const p = src.data && typeof src.data.path === 'string' ? src.data.path : null
    if (!p) continue
    if (src.type === NODE_TYPES.CHARACTER_REF && !out.character.includes(p)) out.character.push(p)
    if (src.type === NODE_TYPES.SCENE_REF && !out.scene.includes(p)) out.scene.push(p)
  }
  return out
}

/**
 * 构造 generateSelected 的 localReferences 负载（仅包含有参考的镜）。
 * @param {Array<{shotId: string}>} shots 与节点 data.shot 对应
 * @param {object} nodes
 * @param {object} edges 节点 id 前缀约定 'shot:'
 */
function buildLocalReferences (shots, nodes, edges) {
  const refs = []
  for (const shot of shots || []) {
    const collected = collectShotReferences('shot:' + shot.shotId, nodes, edges)
    const paths = [...collected.character, ...collected.scene]
    if (paths.length > 0) refs.push({ shotId: shot.shotId, paths })
  }
  return refs
}

const CANVAS_SCHEMA_VERSION = 1

/** 净化后的可持久化节点白名单形状（用户可控内容不进文件名，路径只信服务端返回） */
function sanitizeNode (n) {
  if (!n || typeof n.id !== 'string' || !ALL_NODE_TYPES.has(n.type)) return null
  const x = Number(n.position && n.position.x)
  const y = Number(n.position && n.position.y)
  if (!Number.isFinite(x) || !Number.isFinite(y)) return null
  const data = {}
  const src = n.data && typeof n.data === 'object' ? n.data : {}
  if (typeof src.label === 'string' && src.label) data.label = src.label.slice(0, 200)
  if (typeof src.path === 'string' && src.path) data.path = src.path.slice(0, 1000)
  if (typeof src.mime === 'string') data.mime = src.mime.slice(0, 100)
  if (src.shot && typeof src.shot === 'object') data.shot = src.shot
  if (typeof src.sceneId === 'string') data.sceneId = src.sceneId.slice(0, 200)
  if (typeof src.status === 'string') data.status = src.status.slice(0, 40)
  return { id: n.id.slice(0, 300), type: n.type, position: { x, y }, data }
}

/**
 * 序列化画布状态（工程文件 schema v1）。
 * @returns {{schemaVersion: number, nodes: Array<object>, edges: Array<object>, meta: object}}
 */
function serializeCanvasState (nodes, edges, meta) {
  const outNodes = (nodes || []).map(sanitizeNode).filter(Boolean)
  const ids = new Set(outNodes.map((n) => n.id))
  const outEdges = []
  for (const e of edges || []) {
    if (!e || typeof e.source !== 'string' || typeof e.target !== 'string') continue
    if (!ids.has(e.source) || !ids.has(e.target)) continue
    outEdges.push({ id: String(e.id || e.source + '->' + e.target).slice(0, 620), source: e.source, target: e.target })
  }
  return {
    schemaVersion: CANVAS_SCHEMA_VERSION,
    nodes: outNodes,
    edges: outEdges,
    meta: meta && typeof meta === 'object' ? {
      taskId: typeof meta.taskId === 'string' ? meta.taskId.slice(0, 200) : '',
      updatedAt: Number.isFinite(Number(meta.updatedAt)) ? Number(meta.updatedAt) : 0,
    } : { taskId: '', updatedAt: 0 },
  }
}

/**
 * 反序列化并净化（版本不符/结构损坏返回 null，调用方回落空画布）。
 * @param {unknown} raw
 */
function deserializeCanvasState (raw) {
  let obj = raw
  if (typeof raw === 'string') {
    try { obj = JSON.parse(raw) } catch { return null }
  }
  if (!obj || typeof obj !== 'object') return null
  if (obj.schemaVersion !== CANVAS_SCHEMA_VERSION) return null
  if (!Array.isArray(obj.nodes) || !Array.isArray(obj.edges)) return null
  const nodes = obj.nodes.map(sanitizeNode).filter(Boolean)
  const ids = new Set(nodes.map((n) => n.id))
  const edges = obj.edges.filter((e) => e && ids.has(e.source) && ids.has(e.target))
    .map((e) => ({ id: String(e.id || e.source + '->' + e.target), source: e.source, target: e.target }))
  return { schemaVersion: CANVAS_SCHEMA_VERSION, nodes, edges, meta: (obj.meta && typeof obj.meta === 'object') ? obj.meta : {} }
}

module.exports = {
  NODE_TYPES,
  ALL_NODE_TYPES: [...ALL_NODE_TYPES],
  EDGE_RULES: Object.fromEntries(Object.entries(EDGE_RULES).map(([k, v]) => [k, [...v]])),
  LAYOUT,
  CANVAS_SCHEMA_VERSION,
  validateCanvasEdge,
  shotsToNodes,
  mergeNodesKeepPosition,
  collectShotReferences,
  buildLocalReferences,
  serializeCanvasState,
  deserializeCanvasState,
}
