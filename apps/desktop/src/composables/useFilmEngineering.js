// @ts-check
/**
 * useFilmEngineering.js — 影视工程流水线 composable（《Hell Grind》复刻）
 *
 * 职责：
 *   - kit 状态检查（可用 → 空态 + 重试）
 *   - 分镜库：场景树 / 分镜列表 / 分镜详情（提示词 + 引用素材解析）
 *   - 一键复制：full / blocks / characters / geo 四模式（文本由主进程组装）
 *   - 多选：批量复制 / 导出 JSON|Markdown / 勾选生成图片（≤20）
 *   - 剧本套用：剧本 + 角色映射 → 套用 Hell Grind 提示词架构生成分镜
 *   - 方法论：prompt-doctrine 展示
 *
 * 依赖 window.electronAPI.filmEngineering（Electron 窗口）；浏览器直开 Vite 时静默降级。
 * 所有 IPC 返回统一信封 { code, data?, message? }，code === 0 为成功。
 */
import { ref, reactive } from 'vue'
import { getApi } from '@/api/electron-bridge'
import { formatUserError } from '@/utils/user-facing-error'
import { writeClipboard } from '@/utils/clipboard'
import i18n from '@/i18n'
import { useNotify } from './useNotify'
import {
  story2videoConfigProfileList,
  story2videoConfigProfileCreate,
  story2videoConfigProfileRename,
  story2videoConfigProfileDelete,
} from '@/api/publisher'

const t = (key) => i18n.global.t(key)

const api = () => (getApi() || {}).filmEngineering || null

const COPY_MODES = ['full', 'blocks', 'characters', 'geo']
const FILM_ENGINEERING_PIPELINE_ID = 'film-engineering'

function cloneJson (value) {
  try { return JSON.parse(JSON.stringify(value)) } catch (_) { return null }
}

function normalizeCharacterEntries (entries) {
  const output = []
  const source = Array.isArray(entries) ? entries : []
  for (const entry of source) {
    if (output.length >= 10) break
    const key = typeof entry?.key === 'string' ? entry.key.trim() : ''
    const value = typeof entry?.value === 'string' ? entry.value.trim() : ''
    if (key && value) output.push({ key, value })
  }
  return output
}

// 剪贴板写入已抽取为共享工具 @/utils/clipboard（BUGFIX-REWRITE-QUALITY-UX / DRY）

function unwrap (res) {
  if (res && res.code === 0) return { ok: true, data: res.data }
  return { ok: false, error: formatUserError(res, { fallback: t('filmEngineering.errorFallback') }).message }
}

export function useFilmEngineering () {
  // 统一通知通道（D1 决策）：toast 走 useNotify（带 notify:log 上报）
  const { notifyError, notifySuccess, notifyWarning } = useNotify()
  const status = ref(null)
  const statusLoading = ref(false)
  const scenes = ref([])
  const scenesLoading = ref(false)
  const selectedSceneId = ref(null)
  const shots = ref([])
  const shotsLoading = ref(false)
  const shotDetail = ref(null)
  const detailLoading = ref(false)
  const doctrine = ref(null)
  const doctrineLoading = ref(false)
  const selectedShotIds = ref([])
  const copyMode = ref('full')
  const generating = ref(false)
  const exportLoading = ref(false)
  const adapt = reactive({
    script: '',
    characterMap: { ROKO: '', JAXX: '', LULU: '', REIN: '' },
    llmEnabled: false,
    adaptedShots: [],
    warnings: [],
    loading: false,
  })

  function setError (target, e) {
    target.value = formatUserError(e, { fallback: t('filmEngineering.errorFallback') }).message
  }

  async function loadStatus () {
    const a = api()
    if (!a) { status.value = { available: false, error: t('filmEngineering.noDesktopWarning'), filmMeta: null, sceneCount: 0, shotCount: 0, referenceCount: 0 }; return false }
    statusLoading.value = true
    try {
      const res = await a.status()
      if (res && res.code === 0) {
        status.value = res.data
        return res.data && res.data.available === true
      }
      status.value = { available: false, error: formatUserError(res, { fallback: t('filmEngineering.unavailable') }).message, filmMeta: null, sceneCount: 0, shotCount: 0, referenceCount: 0 }
      return false
    } catch (e) {
      setError(status, e)
      return false
    } finally {
      statusLoading.value = false
    }
  }

  async function loadScenes () {
    const a = api()
    if (!a) return
    scenesLoading.value = true
    try {
      const res = await a.listScenes()
      if (res && res.code === 0) {
        scenes.value = res.data || []
        if (!selectedSceneId.value) {
          const firstWithShots = scenes.value.find((s) => s.shotCount > 0)
          if (firstWithShots) await selectScene(firstWithShots.id)
        }
        return
      }
      notifyWarning('filmEngineering.sceneLoadFailed', { message: formatUserError(res, { fallback: t('filmEngineering.sceneLoadFailed') }).message })
    } catch (e) {
      notifyWarning('filmEngineering.sceneLoadFailed', { message: formatUserError(e, { fallback: t('filmEngineering.sceneLoadFailed') }).message })
    } finally {
      scenesLoading.value = false
    }
  }

  async function selectScene (sceneId) {
    const a = api()
    if (!a || !sceneId) return
    selectedSceneId.value = sceneId
    shots.value = []
    selectedShotIds.value = []
    shotsLoading.value = true
    try {
      const res = await a.listShots(sceneId)
      if (res && res.code === 0) shots.value = res.data || []
      else notifyWarning('filmEngineering.shotLoadFailed', { message: formatUserError(res, { fallback: t('filmEngineering.shotLoadFailed') }).message })
    } catch (e) {
      notifyWarning('filmEngineering.shotLoadFailed', { message: formatUserError(e, { fallback: t('filmEngineering.shotLoadFailed') }).message })
    } finally {
      shotsLoading.value = false
    }
  }

  async function openShot (shotId) {
    const a = api()
    if (!a || !shotId) return
    detailLoading.value = true
    try {
      const res = await a.getShot(shotId)
      if (res && res.code === 0) shotDetail.value = res.data
      else notifyWarning('filmEngineering.detailLoadFailed', { message: formatUserError(res, { fallback: t('filmEngineering.detailLoadFailed') }).message })
    } catch (e) {
      notifyWarning('filmEngineering.detailLoadFailed', { message: formatUserError(e, { fallback: t('filmEngineering.detailLoadFailed') }).message })
    } finally {
      detailLoading.value = false
    }
  }

  async function loadDoctrine () {
    const a = api()
    if (!a || doctrine.value) return
    doctrineLoading.value = true
    try {
      const res = await a.doctrine()
      if (res && res.code === 0) doctrine.value = res.data
    } catch (_) { /* 方法论展示失败不打断主流程 */ } finally {
      doctrineLoading.value = false
    }
  }

  function toggleShot (shotId) {
    const idx = selectedShotIds.value.indexOf(shotId)
    if (idx >= 0) selectedShotIds.value.splice(idx, 1)
    else selectedShotIds.value.push(shotId)
  }

  function toggleAllInScene () {
    const all = shots.value.map((s) => s.shotId)
    const every = all.every((id) => selectedShotIds.value.includes(id))
    selectedShotIds.value = every ? [] : all
  }

  async function copyText (shotId, mode) {
    const a = api()
    if (!a) { notifyWarning('filmEngineering.noDesktopWarning', { message: t('filmEngineering.noDesktopWarning') }); return false }
    try {
      const res = await a.copyText(shotId, mode)
      if (res && res.code === 0) {
        const ok = await writeClipboard(res.data.text)
        notifySuccess('filmEngineering.promptCopied', { message: ok ? t('filmEngineering.promptCopied') : t('filmEngineering.copyFailed') })
        return ok
      }
      notifyWarning('filmEngineering.copyFailed', { message: formatUserError(res, { fallback: t('filmEngineering.copyFailed') }).message })
      return false
    } catch (e) {
      notifyWarning('filmEngineering.copyFailed', { message: formatUserError(e, { fallback: t('filmEngineering.copyFailed') }).message })
      return false
    }
  }

  async function copySelected () {
    const a = api()
    if (!a) { notifyWarning('filmEngineering.noDesktopWarning', { message: t('filmEngineering.noDesktopWarning') }); return false }
    if (selectedShotIds.value.length === 0) { notifyWarning('filmEngineering.selectFirst', { message: t('filmEngineering.selectFirst') }); return false }
    try {
      const res = await a.copyTexts(selectedShotIds.value.slice(), copyMode.value)
      if (res && res.code === 0) {
        const ok = await writeClipboard(res.data.text)
        notifySuccess('filmEngineering.copiedCount', { message: ok ? t('filmEngineering.copiedCount') + ' ' + res.data.count + ' ' + t('filmEngineering.shotsUnit') : t('filmEngineering.copyFailed') })
        return ok
      }
      notifyWarning('filmEngineering.copyBatchFailed', { message: formatUserError(res, { fallback: t('filmEngineering.copyBatchFailed') }).message })
      return false
    } catch (e) {
      notifyWarning('filmEngineering.copyBatchFailed', { message: formatUserError(e, { fallback: t('filmEngineering.copyBatchFailed') }).message })
      return false
    }
  }

  function selectedShotsPayload () {
    const byId = new Map(shots.value.map((s) => [s.shotId, s]))
    const list = []
    for (const id of selectedShotIds.value) {
      const s = byId.get(id)
      if (s) list.push({ shotId: s.shotId, sceneId: s.sceneId, prompt: s.prompt, model: s.model, refTokens: s.refTokens || [] })
    }
    return JSON.parse(JSON.stringify(list))
  }

  function buildConfigProfileSnapshot (roleEntries = []) {
    const entries = normalizeCharacterEntries(roleEntries)
    const characterMap = {}
    for (const entry of entries) characterMap[entry.key] = entry.value
    return {
      schemaVersion: 1,
      capturedAt: new Date().toISOString(),
      kind: 'film-engineering',
      filmEngineering: {
        copyMode: COPY_MODES.includes(copyMode.value) ? copyMode.value : 'full',
        characterMap,
        llmEnabled: adapt.llmEnabled === true,
      },
    }
  }

  function applyConfigProfileSnapshot (snapshot, roleEntries = null) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot) || snapshot.kind !== 'film-engineering') return false
    const config = snapshot.filmEngineering
    if (!config || typeof config !== 'object' || Array.isArray(config)) return false
    if (!COPY_MODES.includes(config.copyMode) || typeof config.llmEnabled !== 'boolean') return false
    if (!config.characterMap || typeof config.characterMap !== 'object' || Array.isArray(config.characterMap)) return false
    const normalized = normalizeCharacterEntries(Object.entries(config.characterMap).map(([key, value]) => ({ key, value })))
    copyMode.value = config.copyMode
    adapt.llmEnabled = config.llmEnabled
    adapt.characterMap = Object.fromEntries(normalized.map((entry) => [entry.key, entry.value]))
    if (Array.isArray(roleEntries)) {
      roleEntries.splice(0, roleEntries.length, ...normalized)
    }
    return true
  }

  async function loadConfigProfiles () {
    const result = await story2videoConfigProfileList()
    if (!result || result.code !== 0) return result || { code: -1, message: t('create.story2video.configProfile.loadFailed') }
    if (!Array.isArray(result.data)) return { code: -1, message: t('create.story2video.configProfile.loadFailed') }
    const data = result.data
    return data.filter((profile) => profile && typeof profile === 'object').map(cloneJson).filter(Boolean)
  }

  async function saveConfigProfile (name, roleEntries = [], options = {}) {
    const snapshot = cloneJson(options.snapshot || buildConfigProfileSnapshot(roleEntries))
    if (!snapshot) return { code: -2, message: t('create.story2video.configProfile.snapshotInvalid') }
    return story2videoConfigProfileCreate({
      pipelineId: FILM_ENGINEERING_PIPELINE_ID,
      name,
      snapshot,
      overwrite: options.overwrite === true,
    })
  }

  async function renameConfigProfile (id, name) { return story2videoConfigProfileRename(id, name) }
  async function deleteConfigProfile (id) { return story2videoConfigProfileDelete(id) }

  function downloadText (text, fileName) {
    try {
      const blob = new Blob([text], { type: 'application/octet-stream' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = fileName
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
      return true
    } catch (_) {
      return false
    }
  }

  async function exportSelected (format) {
    const a = api()
    if (!a) { notifyWarning('filmEngineering.noDesktopWarning', { message: t('filmEngineering.noDesktopWarning') }); return false }
    if (selectedShotIds.value.length === 0) { notifyWarning('filmEngineering.selectFirst', { message: t('filmEngineering.selectFirst') }); return false }
    exportLoading.value = true
    try {
      const res = await a.exportPrompts(selectedShotsPayload(), format)
      if (res && res.code === 0) {
        const text = res.data.export[format === 'markdown' ? 'markdown' : 'json']
        downloadText(text, res.data.fileName)
        notifySuccess('filmEngineering.exported', { message: t('filmEngineering.exported') + ' ' + res.data.fileName })
        return true
      }
      notifyWarning('filmEngineering.exportFailed', { message: formatUserError(res, { fallback: t('filmEngineering.exportFailed') }).message })
      return false
    } catch (e) {
      notifyWarning('filmEngineering.exportFailed', { message: formatUserError(e, { fallback: t('filmEngineering.exportFailed') }).message })
      return false
    } finally {
      exportLoading.value = false
    }
  }

  async function generateSelected () {
    const a = api()
    if (!a) { notifyWarning('filmEngineering.noDesktopWarning', { message: t('filmEngineering.noDesktopWarning') }); return false }
    if (selectedShotIds.value.length === 0) { notifyWarning('filmEngineering.selectFirst', { message: t('filmEngineering.selectFirst') }); return false }
    if (selectedShotIds.value.length > 20) { notifyWarning('filmEngineering.maxGenerate', { message: t('filmEngineering.maxGenerate') }); return false }
    generating.value = true
    try {
      const res = await a.generateSelected(selectedShotsPayload(), { aspectRatio: '16:9' })
      if (res && res.code === 0) {
        const failed = (res.data.results || []).filter((r) => r.code !== 0)
        if (failed.length > 0) {
          notifyWarning('filmEngineering.generatePartial', { message: t('filmEngineering.generatePartial') + ' ' + failed.length + ' ' + t('filmEngineering.generateFailed') })
        } else {
          notifySuccess('filmEngineering.generateSubmitted', { message: t('filmEngineering.generateSubmitted') + ' ' + res.data.results.length + ' ' + t('filmEngineering.shotsUnit') })
        }
        return res.data
      }
      notifyWarning('filmEngineering.generateFailedMsg', { message: formatUserError(res, { fallback: t('filmEngineering.generateFailedMsg') }).message })
      return null
    } catch (e) {
      notifyWarning('filmEngineering.generateFailedMsg', { message: formatUserError(e, { fallback: t('filmEngineering.generateFailedMsg') }).message })
      return null
    } finally {
      generating.value = false
    }
  }

  async function adaptScript () {
    const a = api()
    if (!a) { notifyWarning('filmEngineering.noDesktopWarning', { message: t('filmEngineering.noDesktopWarning') }); return false }
    const characterMap = {}
    for (const [k, v] of Object.entries(adapt.characterMap)) {
      if (typeof v === 'string' && v.trim()) characterMap[k] = v.trim()
    }
    adapt.loading = true
    adapt.adaptedShots = []
    adapt.warnings = []
    try {
      const res = await a.adaptScript({ script: adapt.script, characterMap, llmEnabled: adapt.llmEnabled })
      if (res && res.code === 0) {
        adapt.adaptedShots = res.data.adaptedShots || []
        adapt.warnings = res.data.warnings || []
        notifySuccess('filmEngineering.adaptDone', { message: t('filmEngineering.adaptDone') + ' ' + adapt.adaptedShots.length + ' ' + t('filmEngineering.shotsUnit') })
        return true
      }
      notifyWarning('filmEngineering.adaptFailed', { message: formatUserError(res, { fallback: t('filmEngineering.adaptFailed') }).message })
      return false
    } catch (e) {
      notifyWarning('filmEngineering.adaptFailed', { message: formatUserError(e, { fallback: t('filmEngineering.adaptFailed') }).message })
      return false
    } finally {
      adapt.loading = false
    }
  }

  async function copyAdaptedShot (shot, index) {
    // 套用分镜为前端本地产物（虚拟 shotId），不经过主进程 copy-texts，直接写剪贴板
    const ok = await writeClipboard(shot.prompt || '')
    notifySuccess('filmEngineering.copiedShot', { message: ok ? t('filmEngineering.copiedShot') + ' ' + (index + 1) + ' ' + t('filmEngineering.promptCopied') : t('filmEngineering.copyFailed') })
    return ok
  }

  async function refreshAll () {
    const ok = await loadStatus()
    if (!ok) return false
    await Promise.all([loadScenes(), loadDoctrine()])
    return true
  }

  return {
    status, statusLoading, scenes, scenesLoading, selectedSceneId,
    shots, shotsLoading, shotDetail, detailLoading,
    doctrine, doctrineLoading, selectedShotIds, copyMode, generating, exportLoading, adapt,
    COPY_MODES,
    loadStatus, loadScenes, selectScene, openShot, loadDoctrine,
    toggleShot, toggleAllInScene, copyText, copySelected, exportSelected, generateSelected,
    adaptScript, copyAdaptedShot, refreshAll,
    buildConfigProfileSnapshot, applyConfigProfileSnapshot,
    loadConfigProfiles, saveConfigProfile, renameConfigProfile, deleteConfigProfile,
  }
}
