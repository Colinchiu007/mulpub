/**
 * useBgmLibrary — 背景音乐素材库状态域（CreateView 拆分第 2 步，FRONTEND-FILE-SPLIT-PLAN-2026-10 v3 §2.2）
 *
 * 承接 CreateView 的 BGM 素材库状态与方法（s2vBgmLibrary* 七元组 + CRUD）。
 * 设计约束：
 *   - 模块级单例（设备级资源，跨组件共享同一份）；无实例依赖（不调 watch/onMounted），
 *     壳 CreateView 以「方法代理 + computed get/set 状态桥接」接入（§2.3），旧测试触点不变；
 *   - BGM 素材库弹窗与删除确认弹窗为应用级模态浮层，按 QM-2 浮层互斥合同登记
 *     唯一 owner 并成对释放（§2.4）；
 *   - 跨域写点（s2vConfig.bgmPath、showStory2VideoErrorDialog、resolveMediaImportFailure、
 *     validateStory2VideoFile）经 setupBgmLibraryDeps 注入，不反向 import 壳。
 */
import { reactive, toRefs } from 'vue'
import {
  story2videoBgmLibraryList,
  story2videoBgmLibraryAdd,
  story2videoBgmLibraryRename,
  story2videoBgmLibraryDelete,
  story2videoBgmLibraryStatus,
} from '@/api/publisher'
import { STORY2VIDEO_NOTIFICATION_KEYS } from '@/story2video/story2video-notifications'
import {
  suspendEmbeddedViewsForOverlay,
  releaseEmbeddedViewsForOverlay,
} from '@/composables/useEmbeddedViewSuspension'

/** 浮层 owner（QM-2 浮层互斥合同，禁止模式匹配式命名，逐个枚举） */
export const BGM_LIBRARY_OVERLAY_OWNER = 'create-bgm-library-dialog'
export const BGM_LIBRARY_DELETE_OVERLAY_OWNER = 'create-bgm-library-delete-dialog'

/**
 * 历史 BGM 路径状态（s2v-bgm-legacy-repair）：
 * 「已选音频（未入库）」原先把三种本质不同的状态混为一谈，现细分为：
 *   idle      = 无历史路径 / 已命中库条目
 *   checking  = 已发起主进程只读核验
 *   available = 文件仍可用，但不在素材库
 *   missing   = 文件已丢失（临时目录老化回收 / 手动删除）
 *   unusable  = 文件存在但不可用于合成（格式/大小/位置/类型）
 *   unknown   = 核验通道不可用（浏览器态/旧主进程）——失败开放，不阻断启动
 */
export const LEGACY_BGM_STATUS = Object.freeze({
  IDLE: 'idle',
  CHECKING: 'checking',
  AVAILABLE: 'available',
  MISSING: 'missing',
  UNUSABLE: 'unusable',
  UNKNOWN: 'unknown',
})

/** 需要启动前阻断的状态（未知不阻断，避免把“无法核验”误判成“文件已丢失”） */
export const LEGACY_BGM_BLOCKING_STATES = Object.freeze([LEGACY_BGM_STATUS.MISSING, LEGACY_BGM_STATUS.UNUSABLE])

const USABLE_INSPECT_REASON = 'ok'

/** 模块级状态（单例：BGM 素材库为设备级资源，跨组件共享同一份） */
const state = reactive({
  s2vBgmLibrary: [],
  s2vBgmLibraryLoading: false,
  s2vBgmLibraryDialogOpen: false,
  s2vBgmLibraryRenamingId: '',
  s2vBgmLibraryRenameDraft: '',
  s2vBgmLibraryDeleteDialogOpen: false,
  s2vBgmLibraryDeleteTargetId: null,
  // 历史路径核验状态：{ state, path, reason, exists }
  s2vLegacyBgmStatus: { state: LEGACY_BGM_STATUS.IDLE, path: '', reason: '', exists: false },
})

/** 核验请求代际：只有最新请求的响应可以落地（防旧路径响应覆盖新选择） */
let legacyBgmVerifySeq = 0

/** 壳注入的跨域依赖（setupBgmLibraryDeps 一次性注入；window 兜底防测试/早调用时序） */
let deps = typeof window !== 'undefined' ? (window.__bgmLibraryDeps || null) : null

/**
 * 注入跨域依赖（壳 CreateView 在 created 调用一次；同步写 window 兜底供模块级单例跨实例取用）。
 * @param {object} d
 * @param {() => object} d.getS2vConfig 取 s2vConfig（写 bgmPath）
 * @param {(payload: object) => void} d.showStory2VideoErrorDialog 错误弹窗
 * @param {(result: object, kindLabel: string) => object} d.resolveMediaImportFailure 媒体导入失败细分
 * @param {(file: File, kind: string) => boolean} d.validateStory2VideoFile 文件校验
 * @param {(kind: string) => string} d.story2videoKindLabel 媒体类别宾语（走 locale，替代硬编码「背景音乐」）
 */
export function setupBgmLibraryDeps (d) {
  deps = d
  if (typeof window !== 'undefined') window.__bgmLibraryDeps = d
}

/** 取依赖（兜底 window 单例：模块级 deps 变量在跨实例/早调用时序下可能为 null） */
function requireDeps () {
  const d = deps || (typeof window !== 'undefined' ? window.__bgmLibraryDeps : null)
  if (!d) throw new Error('[useBgmLibrary] deps not injected: shell component must call setupBgmLibraryDeps first')
  return d
}

async function loadS2VBgmLibrary (options = {}) {
  state.s2vBgmLibraryLoading = true
  try {
    const result = await story2videoBgmLibraryList()
    if (result?.code === 0 && Array.isArray(result.data)) {
      state.s2vBgmLibrary = result.data
    } else if (!options.silent) {
      requireDeps().showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_LOAD_FAILED })
    }
  } catch (_) {
    if (!options.silent) {
      requireDeps().showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_LOAD_FAILED })
    }
  } finally {
    state.s2vBgmLibraryLoading = false
  }
}

// 背景音乐素材库（2026-08-14）：添加成功后入库并自动选中；失败沿用媒体细分提示。
async function addFileToBgmLibrary (file) {
  const s2vConfig = requireDeps().getS2vConfig()
  if (!file || !requireDeps().validateStory2VideoFile(file, 'bgm')) {
    s2vConfig.bgmPath = ''
    return null
  }
  const kindLabel = requireDeps().story2videoKindLabel('bgm')
  try {
    const result = await story2videoBgmLibraryAdd(file)
    if (result?.code === 0 && result.data?.path) {
      await loadS2VBgmLibrary({ silent: true })
      s2vConfig.bgmPath = result.data.path
      return result.data
    }
    s2vConfig.bgmPath = ''
    requireDeps().showStory2VideoErrorDialog(requireDeps().resolveMediaImportFailure(result, kindLabel))
    return null
  } catch (_) {
    s2vConfig.bgmPath = ''
    requireDeps().showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_UNREADABLE, messageParams: { kindLabel } })
    return null
  }
}

async function handleBgmLibraryAddFile (e, fileInputRef) {
  const file = e.target.files?.[0]
  if (!file) return
  const added = await addFileToBgmLibrary(file)
  if (added && fileInputRef) {
    // 允许再次选择同一文件（change 只在值变化时触发）
    fileInputRef.value = ''
  }
}

async function openBgmLibraryDialog () {
  state.s2vBgmLibraryDialogOpen = true
  await suspendEmbeddedViewsForOverlay(BGM_LIBRARY_OVERLAY_OWNER)
  await loadS2VBgmLibrary()
}

function closeBgmLibraryDialog () {
  state.s2vBgmLibraryDialogOpen = false
  cancelBgmRename()
  closeBgmDeleteDialog()
  void releaseEmbeddedViewsForOverlay(BGM_LIBRARY_OVERLAY_OWNER)
}

function startBgmRename (item) {
  state.s2vBgmLibraryRenamingId = item.id
  state.s2vBgmLibraryRenameDraft = item.name
}

async function saveBgmRename () {
  const id = state.s2vBgmLibraryRenamingId
  const name = String(state.s2vBgmLibraryRenameDraft || '').trim()
  if (!id || !name || state.s2vBgmLibraryLoading) return
  state.s2vBgmLibraryLoading = true
  try {
    const result = await story2videoBgmLibraryRename(id, name)
    if (result?.code === 0) {
      await loadS2VBgmLibrary({ silent: true })
      cancelBgmRename()
    } else {
      requireDeps().showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_RENAME_FAILED })
    }
  } catch (_) {
    requireDeps().showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_RENAME_FAILED })
  } finally {
    state.s2vBgmLibraryLoading = false
  }
}

function cancelBgmRename () {
  state.s2vBgmLibraryRenamingId = ''
  state.s2vBgmLibraryRenameDraft = ''
}

function requestBgmDelete (item) {
  state.s2vBgmLibraryDeleteTargetId = item.id
  state.s2vBgmLibraryDeleteDialogOpen = true
  // 删除确认弹窗是素材库弹窗内的二级浮层：挂起独立 owner（素材库 owner 已由 openBgmLibraryDialog 挂起）
  void suspendEmbeddedViewsForOverlay(BGM_LIBRARY_DELETE_OVERLAY_OWNER)
}

function closeBgmDeleteDialog () {
  state.s2vBgmLibraryDeleteDialogOpen = false
  state.s2vBgmLibraryDeleteTargetId = null
  // 释放成对只在「删除确认弹窗独立开启」时进行；被 closeBgmLibraryDialog 级联调用时
  // 删除弹窗本就未独立挂起（requestBgmDelete 才挂起），此处重复 release 幂等返回 false
  void releaseEmbeddedViewsForOverlay(BGM_LIBRARY_DELETE_OVERLAY_OWNER)
}

async function confirmBgmDelete () {
  const id = state.s2vBgmLibraryDeleteTargetId
  if (!id || state.s2vBgmLibraryLoading) return
  state.s2vBgmLibraryLoading = true
  const s2vConfig = requireDeps().getS2vConfig()
  try {
    const result = await story2videoBgmLibraryDelete(id)
    if (result?.code === 0) {
      const target = state.s2vBgmLibrary.find((item) => item.id === id)
      // 删除当前选中项时回退为「不使用背景音乐」
      if (target && String(s2vConfig.bgmPath) === String(target.path)) s2vConfig.bgmPath = ''
      await loadS2VBgmLibrary({ silent: true })
      closeBgmDeleteDialog()
    } else {
      requireDeps().showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_DELETE_FAILED })
    }
  } catch (_) {
    requireDeps().showStory2VideoErrorDialog({ messageKey: STORY2VIDEO_NOTIFICATION_KEYS.BGM_LIBRARY_DELETE_FAILED })
  } finally {
    state.s2vBgmLibraryLoading = false
  }
}

/** 卸载兜底：任何路径都释放两个 owner（release 对未知/已释放 owner 幂等返回 false，双路径安全） */
async function releaseAllOverlays () {
  await releaseEmbeddedViewsForOverlay(BGM_LIBRARY_OVERLAY_OWNER)
  await releaseEmbeddedViewsForOverlay(BGM_LIBRARY_DELETE_OVERLAY_OWNER)
}

/** 复位历史路径状态（路径清空 / 已入库 / 用户显式修复后调用；同时使在途响应失效） */
function resetLegacyBgmLibraryStatus () {
  legacyBgmVerifySeq += 1
  state.s2vLegacyBgmStatus = { state: LEGACY_BGM_STATUS.IDLE, path: '', reason: '', exists: false }
}

/** 把主进程 inspect 结果映射为 UI 状态（唯一映射点，面板不自行解释 reason） */
function mapInspectResultToLegacyStatus (path, data) {
  if (!data || typeof data !== 'object') {
    return { state: LEGACY_BGM_STATUS.UNKNOWN, path, reason: '', exists: false }
  }
  const reason = String(data.reason || '')
  const exists = data.exists === true
  if (reason === USABLE_INSPECT_REASON) {
    // 已命中库条目：不再是“历史未入库”，复位为常规选择
    if (data.inLibrary === true) return { state: LEGACY_BGM_STATUS.IDLE, path: '', reason, exists }
    return { state: LEGACY_BGM_STATUS.AVAILABLE, path, reason, exists }
  }
  if (reason === 'missing') return { state: LEGACY_BGM_STATUS.MISSING, path, reason, exists }
  if (reason === 'invalid_argument') {
    // 历史配置理论上都是绝对路径；出现非法入参说明数据异常，按未知处理（不阻断）。
    return { state: LEGACY_BGM_STATUS.UNKNOWN, path, reason, exists }
  }
  return { state: LEGACY_BGM_STATUS.UNUSABLE, path, reason, exists }
}

/**
 * 只读核验历史 BGM 路径（同一路径单请求；旧响应按代际丢弃）。
 * @param {string} rawPath
 */
async function verifyLegacyBgmLibraryPath (rawPath) {
  const path = String(rawPath || '').trim()
  const seq = ++legacyBgmVerifySeq
  if (!path) {
    state.s2vLegacyBgmStatus = { state: LEGACY_BGM_STATUS.IDLE, path: '', reason: '', exists: false }
    return
  }
  state.s2vLegacyBgmStatus = { state: LEGACY_BGM_STATUS.CHECKING, path, reason: '', exists: false }
  let result
  try {
    result = await story2videoBgmLibraryStatus(path)
  } catch (_) {
    result = null
  }
  if (seq !== legacyBgmVerifySeq) return // 已被更新的路径/复位取代
  if (!result || result.code !== 0) {
    state.s2vLegacyBgmStatus = { state: LEGACY_BGM_STATUS.UNKNOWN, path, reason: '', exists: false }
    return
  }
  state.s2vLegacyBgmStatus = mapInspectResultToLegacyStatus(path, result.data)
}

/**
 * 把当前历史 BGM 加入素材库：成功后自动选中库内新路径（持久目录，不再受临时目录老化影响）。
 * 仅当状态为 available（已确认文件可用）才执行，避免把丢失/不可用文件复制入库。
 * @returns {Promise<object|null>} 新库条目，失败返回 null
 */
async function adoptLegacyBgmLibrary () {
  if (state.s2vLegacyBgmStatus.state !== LEGACY_BGM_STATUS.AVAILABLE) return null
  const s2vConfig = requireDeps().getS2vConfig()
  const current = String(s2vConfig.bgmPath || '').trim()
  if (!current) return null
  const kindLabel = requireDeps().story2videoKindLabel('bgm')
  try {
    const result = await story2videoBgmLibraryAdd(current)
    if (result?.code === 0 && result.data?.path) {
      await loadS2VBgmLibrary({ silent: true })
      s2vConfig.bgmPath = result.data.path
      resetLegacyBgmLibraryStatus()
      return result.data
    }
    requireDeps().showStory2VideoErrorDialog(requireDeps().resolveMediaImportFailure(result, kindLabel))
    return null
  } catch (_) {
    requireDeps().showStory2VideoErrorDialog({
      messageKey: STORY2VIDEO_NOTIFICATION_KEYS.MEDIA_UNREADABLE,
      messageParams: { kindLabel },
    })
    return null
  }
}

/** 清除历史 BGM 选择（=「不使用背景音乐」），解除启动门禁并复位状态。 */
async function clearLegacyBgmLibrarySelection () {
  const s2vConfig = requireDeps().getS2vConfig()
  s2vConfig.bgmPath = ''
  resetLegacyBgmLibraryStatus()
}

/** 测试复位（模块级单例状态跨用例泄漏防护）：仅测试环境使用 */
export function resetBgmLibraryForTest () {
  state.s2vBgmLibrary = []
  state.s2vBgmLibraryLoading = false
  state.s2vBgmLibraryDialogOpen = false
  state.s2vBgmLibraryRenamingId = ''
  state.s2vBgmLibraryRenameDraft = ''
  state.s2vBgmLibraryDeleteDialogOpen = false
  state.s2vBgmLibraryDeleteTargetId = null
  legacyBgmVerifySeq += 1
  state.s2vLegacyBgmStatus = { state: LEGACY_BGM_STATUS.IDLE, path: '', reason: '', exists: false }
  deps = typeof window !== 'undefined' ? (window.__bgmLibraryDeps || null) : null
}

/** 状态桥接用 toRefs（壳 CreateView computed get/set 委托到这里） */
export const bgmLibraryRefs = toRefs(state)

export const bgmLibraryMethods = {
  loadS2VBgmLibrary,
  addFileToBgmLibrary,
  handleBgmLibraryAddFile,
  openBgmLibraryDialog,
  closeBgmLibraryDialog,
  startBgmRename,
  saveBgmRename,
  cancelBgmRename,
  requestBgmDelete,
  closeBgmDeleteDialog,
  confirmBgmDelete,
  releaseAllOverlays,
  verifyLegacyBgmLibraryPath,
  adoptLegacyBgmLibrary,
  clearLegacyBgmLibrarySelection,
  resetLegacyBgmLibraryStatus,
}
