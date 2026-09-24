// @ts-check
/**
 * 影视工程画布 composable（视图层桥接，引擎零改动）
 *
 * 职责：nodes/edges 状态管理、剧本拆分镜铺节点、参考图上传落盘成节点、
 * 连线合法性（委托 film-canvas-model）、生成负载构造（连线即注入
 * localReferences）、画布持久化（localStorage -> userData session）。
 *
 * 发起出片/合成不在本模块——继续走 useFilmVideoGen / useFilmProduction 的
 * pipeline 通道（成本 checkpoint、断点续跑合同不因画布旁路）。
 *
 * 文案合同：只透出 errorCode / locale key，不注入 i18n、不产出中文字面量。
 */
import { ref, reactive } from 'vue'
import { getApi } from '@/api/electron-bridge'
import {
  NODE_TYPES, validateCanvasEdge, shotsToNodes, mergeNodesKeepPosition,
  buildLocalReferences, serializeCanvasState, deserializeCanvasState,
} from './film-canvas-model'

const MAX_SCRIPT_LENGTH = 10000
const MAX_REF_BYTES = 10 * 1024 * 1024
const REF_EXT_OK = ['image/png', 'image/jpeg', 'image/webp']
const STORAGE_KEY = 'film-engin…s:v1'
const NODE_ID_GAP = 60

function cloneJson (v) {
  return JSON.parse(JSON.stringify(v))
}

export function useFilmCanvas (opts = {}) {
  const storage = opts.storage || (typeof localStorage !== 'undefined' ? localStorage : null)
  const api = () => (getApi() || {}).filmEngineering || null

  const nodes = ref([])
  const edges = ref([])
  const status = ref(null)
  const adaptLoading = ref(false)
  const uploading = ref(false)
  const form = reactive({
    script: '',
    characterMap: { ROKO: '', JAXX: '', LULU: '', REIN: '' },
    llmEnabled: false,
  })

  function nextFreePosition () {
    if (nodes.value.length === 0) return { x: 80, y: 80 }
    const maxY = Math.max(...nodes.value.map((n) => Number(n.position && n.position.y) || 0))
    const atMax = nodes.value.filter((n) => (Number(n.position && n.position.y) || 0) >= maxY)
    const maxX = Math.max(...atMax.map((n) => Number(n.position && n.position.x) || 0))
    return { x: maxX + NODE_ID_GAP * 2, y: maxY }
  }

  async function refreshStatus () {
    const a = api()
    if (!a) {
      status.value = { available: false, errorCode: 'filmEngineering.canvas.noDesktop' }
      return false
    }
    const res = await a.status()
    if (res && res.code === 0) {
      status.value = res.data
      return true
    }
    status.value = { available: false, errorCode: 'filmEngineering.canvas.engineUnavailable' }
    return false
  }

  /** 铺分镜节点：已有同 id 节点保留（含位置与状态），新镜追加 */
  function appendShotNodes (adaptedShots) {
    const next = shotsToNodes(adaptedShots, { x0: 460, y0: 80 })
    const withPos = mergeNodesKeepPosition(next, nodes.value)
    const ids = new Set(nodes.value.map((n) => n.id))
    const fresh = withPos.filter((n) => !ids.has(n.id))
    nodes.value = [...nodes.value, ...fresh.map((n) => ({ ...n, data: { ...n.data, status: 'idle' } }))]
    return fresh.length
  }

  /** 剧本拆分镜：校验 -> adaptScript -> 铺节点。返回 {ok, errorCode?, ...} */
  async function runAdapt () {
    const script = typeof form.script === 'string' ? form.script.trim() : ''
    if (!script) return { ok: false, errorCode: 'filmEngineering.canvas.adapt.emptyScript' }
    if (script.length > MAX_SCRIPT_LENGTH) return { ok: false, errorCode: 'filmEngineering.canvas.adapt.scriptTooLong' }
    const characterMap = {}
    for (const [k, v] of Object.entries(form.characterMap || {})) {
      if (typeof v === 'string' && v.trim()) characterMap[k] = v.trim()
    }
    const a = api()
    if (!a) return { ok: false, errorCode: 'filmEngineering.canvas.noDesktop' }
    adaptLoading.value = true
    try {
      const res = await a.adaptScript(cloneJson({ script, characterMap, llmEnabled: form.llmEnabled === true }))
      if (!res || res.code !== 0 || !res.data || !Array.isArray(res.data.adaptedShots)) {
        return { ok: false, errorCode: 'filmEngineering.canvas.adapt.failed' }
      }
      const added = appendShotNodes(res.data.adaptedShots)
      persist()
      return {
        ok: true,
        added,
        total: res.data.adaptedShots.length,
        llmEnhanced: res.data.llmEnhanced === true,
        warnings: Array.isArray(res.data.warnings) ? res.data.warnings : [],
      }
    } catch {
      return { ok: false, errorCode: 'filmEngineering.canvas.adapt.failed' }
    } finally {
      adaptLoading.value = false
    }
  }

  /**
   * 上传参考图并落成节点。file 需支持 arrayBuffer()（浏览器 File）。
   * kind: 'character' | 'scene'
   */
  async function uploadReference (file, kind) {
    const type = kind === 'scene' ? NODE_TYPES.SCENE_REF : NODE_TYPES.CHARACTER_REF
    if (!file || typeof file.arrayBuffer !== 'function') {
      return { ok: false, errorCode: 'filmEngineering.canvas.ref.invalidFile' }
    }
    if (!REF_EXT_OK.includes(file.type)) {
      return { ok: false, errorCode: 'filmEngineering.canvas.ref.badType' }
    }
    if (Number(file.size) > MAX_REF_BYTES) {
      return { ok: false, errorCode: 'filmEngineering.canvas.ref.tooLarge' }
    }
    const a = api()
    if (!a || typeof a.uploadReference !== 'function') {
      return { ok: false, errorCode: 'filmEngineering.canvas.noDesktop' }
    }
    uploading.value = true
    try {
      const buf = new Uint8Array(await file.arrayBuffer())
      let binary = ''
      const CHUNK = 0x8000
      for (let i = 0; i < buf.length; i += CHUNK) {
        binary += String.fromCharCode.apply(null, buf.subarray(i, i + CHUNK))
      }
      const dataUrl = 'data:' + file.type + ';base64,' + btoa(binary)
      const res = await a.uploadReference(cloneJson({ dataUrl }))
      if (!res || res.code !== 0 || !res.data || typeof res.data.path !== 'string') {
        return { ok: false, errorCode: 'filmEngineering.canvas.ref.uploadFailed' }
      }
      const label = typeof file.name === 'string' ? file.name.slice(0, 200) : res.data.fileName
      const id = 'ref:' + res.data.fileName
      nodes.value = [...nodes.value, {
        id,
        type,
        position: nextFreePosition(),
        data: { path: res.data.path, mime: res.data.mime, label, bytes: res.data.bytes, status: 'ready' },
      }]
      persist()
      return { ok: true, node: id }
    } catch {
      return { ok: false, errorCode: 'filmEngineering.canvas.ref.uploadFailed' }
    } finally {
      uploading.value = false
    }
  }

  function nodeById (id) {
    return nodes.value.find((n) => n.id === id) || null
  }

  /** 连线校验（含同节点/重复边检测），返回 {ok, reasonKey?} */
  function canConnect (connection) {
    if (!connection || !connection.source || !connection.target) return { ok: false, reasonKey: 'filmEngineering.canvas.edgeRule.unknownType' }
    const src = nodeById(connection.source)
    const tgt = nodeById(connection.target)
    if (!src || !tgt) return { ok: false, reasonKey: 'filmEngineering.canvas.edgeRule.unknownType' }
    if (connection.source === connection.target) {
      return validateCanvasEdge({ sameNode: true, sourceType: src.type, targetType: tgt.type })
    }
    const dup = edges.value.some((e) => e.source === connection.source && e.target === connection.target)
    if (dup) return validateCanvasEdge({ duplicate: true, sourceType: src.type, targetType: tgt.type })
    return validateCanvasEdge({ sourceType: src.type, targetType: tgt.type })
  }

  /** 通过校验才落边；返回 {ok, reasonKey?} */
  function addEdge (connection) {
    const verdict = canConnect(connection)
    if (!verdict.ok) return verdict
    edges.value = [...edges.value, {
      id: connection.source + '->' + connection.target,
      source: connection.source,
      target: connection.target,
    }]
    persist()
    return { ok: true }
  }

  function removeNodes (ids) {
    const kill = new Set(Array.isArray(ids) ? ids : [ids])
    nodes.value = nodes.value.filter((n) => !kill.has(n.id))
    edges.value = edges.value.filter((e) => !kill.has(e.source) && !kill.has(e.target))
    persist()
  }

  function setShotStatus (shotId, patch) {
    const id = 'shot:' + shotId
    nodes.value = nodes.value.map((n) => (n.id === id ? { ...n, data: { ...n.data, ...(patch || {}) } } : n))
  }

  /**
   * 构造生成负载：selectedShots（纯 JSON）+ localReferences（连线注入）。
   * @param {string[]} shotIds 参与生成的分镜 id（节点 data.shot.shotId）
   */
  function buildGeneratePayload (shotIds) {
    const shots = []
    for (const sid of shotIds || []) {
      const node = nodeById('shot:' + sid)
      if (node && node.data && node.data.shot) shots.push(node.data.shot)
    }
    const localReferences = buildLocalReferences(shots, nodes.value, edges.value)
    return cloneJson({ selectedShots: shots, localReferences })
  }

  // ── 持久化（D6：userData session 存储，重启复原）────────────────────
  function persist () {
    if (!storage) return
    try {
      storage.setItem(STORAGE_KEY, JSON.stringify(serializeCanvasState(nodes.value, edges.value, {
        taskId: '', updatedAt: Date.now(),
      })))
    } catch { /* 存储满等写入失败不影响画布内存态 */ }
  }

  function restore () {
    if (!storage) return false
    let raw = null
    try { raw = storage.getItem(STORAGE_KEY) } catch { return false }
    if (!raw) return false
    const state = deserializeCanvasState(raw)
    if (!state) return false
    nodes.value = state.nodes
    edges.value = state.edges
    return true
  }

  function clearCanvas () {
    nodes.value = []
    edges.value = []
    if (storage) { try { storage.removeItem(STORAGE_KEY) } catch { /* 忽略 */ } }
  }

  return {
    nodes, edges, status, adaptLoading, uploading, form,
    refreshStatus, runAdapt, appendShotNodes, uploadReference,
    canConnect, addEdge, removeNodes, setShotStatus, nodeById,
    buildGeneratePayload, persist, restore, clearCanvas,
    STORAGE_KEY,
  }
}
